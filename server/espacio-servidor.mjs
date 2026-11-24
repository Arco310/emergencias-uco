// Espacio central en «modo servidor» (1.4.0). Ver docs/DISENO-1.4.0.md.
// El servidor custodia la clave del espacio y la de cada preventivo compartido (datos/_servidor/claves),
// lleva el directorio de usuarios (estados, método de acceso, perfil, permisos y alcance), las sesiones,
// el registro público con aprobación, los códigos de un solo uso y la auditoría, y valida cada operación
// (identidad, permisos y reglas) antes de guardarla. Los datos siguen cifrados en disco.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { Engine, applyOp, lazyCopy, permisosEfectivos, permisosOp, comprobarCambioUsuario, defaultRoles, normalizarPerfil, estadoUsuario, accesoPreventivo, PERM_KEYS, PERM_LABEL, motivoTipoNoDisponible, orgKeys, prevKeys, open, seal, unb64 } from './nucleo.mjs';

const SESION_MS = 90 * 24 * 3600e3;      // una sesión caduca a los 90 días sin usarse
const CODIGO_MS = Number(process.env.UCO_CODIGO_MS) || 72 * 3600e3; // un código de activación o restablecimiento caduca a las 72 h
const RETO_BITS = 16;                    // prueba de trabajo del registro (~1–2 s en un móvil)
const REGISTROS_HORA = 10; const MAX_PENDIENTES = 25;
const ABC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const USUARIO_RE = /^[a-z0-9][a-z0-9._@-]{1,49}$/;
const ESTADOS = ['pendiente', 'activo', 'suspendido', 'desactivado', 'rechazado', 'invitado'];
const TRANSICIONES = {
  pendiente: ['activo', 'rechazado'], invitado: ['desactivado', 'activo'], activo: ['suspendido', 'desactivado'],
  suspendido: ['activo', 'desactivado'], desactivado: ['activo'], rechazado: ['activo'],
};

export const normUsuario = u => String(u || '').trim().toLowerCase().replace(/\s+/g, '.');
const sha256hex = s => crypto.createHash('sha256').update(s).digest('hex');
export const cuentaUid = (org, usuario) => sha256hex('uco-cuenta:' + org + ':' + normUsuario(usuario));
const normCodigo = s => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
const err = (status, msg, codigo) => Object.assign(new Error(msg), { status, codigo });
const safeEq = (a, b) => { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); };
const ceros = buf => { let n = 0; for (const b of buf) { if (b === 0) { n += 8; continue; } n += Math.clz32(b) - 24; break; } return n; };
const nuevoCodigo = () => { const b = crypto.randomBytes(10); const c = Array.from(b, x => ABC[x % ABC.length]).join(''); return c.slice(0, 4) + '-' + c.slice(4, 8) + '-' + c.slice(8); };
const tipoActivo = t => !!t && t.activo !== false && !t.retirado;
/** Reglas de cambios de usuarios (compartidas con la app): sus errores llegan como 403 o 400 */
function comprobar(args) { try { comprobarCambioUsuario(args); } catch (e) { throw err(e.code === 'permiso' ? 403 : 400, e.message, e.code || 'regla'); } }
const MENSAJE_ESTADO = {
  pendiente: 'Tu cuenta está pendiente de aprobación por un administrador.',
  suspendido: 'Tu cuenta está suspendida. Habla con un administrador.',
  desactivado: 'Tu cuenta está desactivada. Habla con un administrador.',
  rechazado: 'Tu solicitud de cuenta fue rechazada.',
  invitado: 'Tu cuenta aún no está activada: usa el código de activación que te dio el administrador.',
};

/** deps: { DATA, log, writeAtomic, appendDurable, secretoServidor, comprobarCodigo, limiteAcceso, falloAcceso, limpiarFallos, orgSave, VERSION } */
export function crearModoServidor(deps) {
  const { DATA, log, writeAtomic, appendDurable, secretoServidor, comprobarCodigo, limiteAcceso, falloAcceso, limpiarFallos, orgSave } = deps;
  const CLAVES_DIR = path.join(DATA, '_servidor', 'claves');
  const pidOrg = new Map(); // preventivo → espacio (para exigir sesión en sus operaciones)

  // ---------------- custodia de claves ----------------
  const claveFile = org => path.join(CLAVES_DIR, org + '.json');
  const leerClaves = org => { try { return JSON.parse(fs.readFileSync(claveFile(org), 'utf8')); } catch { return null; } };
  function guardarClaves(org, c) { fs.mkdirSync(CLAVES_DIR, { recursive: true }); writeAtomic(claveFile(org), JSON.stringify(c)); try { fs.chmodSync(claveFile(org), 0o600); } catch { } }

  const activo = o => !!(o && o.meta && o.meta.modo === 'servidor');
  const rd = (o, n, def) => { try { return JSON.parse(fs.readFileSync(path.join(o.dir, n), 'utf8')); } catch { return def; } };
  function guardar(o, ...nombres) {
    const ms = o.ms; const datos = { usuarios: ms.usuarios, sesiones: ms.sesiones, perfiles: ms.perfiles, ajustes: ms.ajustes };
    for (const n of nombres) writeAtomic(path.join(o.dir, n + '.json'), JSON.stringify(datos[n]));
  }
  async function _preparar(o) {
    const claves = leerClaves(o.meta.org);
    if (!claves || !claves.org) throw err(500, 'Faltan las claves del espacio central en el servidor (datos\\_servidor\\claves)');
    const ms = {
      claves, k: await orgKeys(unb64(claves.org)), pk: new Map(), motores: new Map(), cfg: new Map(), retos: new Map(), regs: [],
      usuarios: rd(o, 'usuarios.json', {}), sesiones: rd(o, 'sesiones.json', {}), perfiles: rd(o, 'perfiles.json', null) || defaultRoles(),
      ajustes: { registroAbierto: true, ...rd(o, 'ajustes.json', {}) }, porUid: new Map(), guardadoSes: 0,
    };
    for (const u of Object.values(ms.usuarios)) ms.porUid.set(cuentaUid(o.meta.org, u.usuario), u.id);
    for (const [id, v] of Object.entries(o.config)) {
      if (v.borrado) { ms.cfg.set(id, null); continue; }
      try { ms.cfg.set(id, (await open(ms.k.key, v.c)).data); } catch { /* elemento de otra clave: se ignora */ }
    }
    for (const pid of Object.keys(claves.prevs || {})) pidOrg.set(pid, o.meta.org);
    o.ms = ms; return ms;
  }
  const preparar = o => (o.ms ? Promise.resolve(o.ms) : (o._msP ||= _preparar(o).catch(e => { o._msP = null; throw e; })));

  // ---------------- directorio de usuarios ----------------
  const estadoVisible = u => (u.estado === 'invitado' && u.codigo && Date.now() > u.codigo.exp ? 'caducado' : estadoUsuario(u));
  const perfilPublico = u => ({
    id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.perfil || null, perfil: u.perfil || null, activo: estadoUsuario(u) === 'activo',
    estado: estadoUsuario(u), metodo: u.metodo || 'password', ajustes: u.ajustes || { mas: [], menos: [] }, alcance: u.alcance || { tipo: 'todos' },
    creado: u.creado || 0, cred: { v: u.credV || 'v0', central: true },
  });
  const listado = (o, u) => ({
    ...perfilPublico(u), estadoVisible: estadoVisible(u), ultimoAcceso: u.ultimoAcceso || 0, creadoPor: u.creadoPor || '', origen: u.origen || '',
    aprobado: u.aprobado || null, codigo: u.codigo ? { tipo: u.codigo.tipo, exp: u.codigo.exp } : null,
    dispositivos: Object.entries(u.dispositivos || {}).map(([dev, d]) => ({ dev, nombre: d.nombre || '', creado: d.creado, ultimo: d.ultimo || 0 })),
    sesiones: Object.values(o.ms.sesiones).filter(s => s.uid === u.id && s.sver === (u.sver || 0)).length,
    conContrasena: !!(u.pw || o.cuentas[cuentaUid(o.meta.org, u.usuario)]),
  });
  /** El servidor escribe los elementos usr:* y roles del espacio (cifrados con su clave): los dispositivos los reciben como siempre */
  async function publicar(o, id, data, borrado = false) {
    const cur = o.config[id]; const v = cur ? cur.v : 0;
    o.config[id] = { v: v + 1, c: await seal(o.ms.k.key, { id, data }), borrado, sq: ++o.meta.seq, t: Date.now() };
    o.ms.cfg.set(id, borrado ? null : data);
    orgSave(o, 'config', 'meta');
  }
  const publicarUsuario = (o, u) => publicar(o, 'usr:' + u.id, perfilPublico(u));
  const publicarPerfiles = o => publicar(o, 'roles', o.ms.perfiles);
  function auditar(o, quien, accion, objetivo = '', antes = '', despues = '') {
    const e = { t: Date.now(), actor: quien && quien.u ? { id: quien.u.id, usuario: quien.u.usuario, nombre: quien.u.nombre } : null, dev: (quien && quien.dev) || '', accion, objetivo, antes: String(antes || '').slice(0, 4000), despues: String(despues || '').slice(0, 4000) };
    try { appendDurable(path.join(o.dir, 'auditoria.jsonl'), JSON.stringify(e) + '\n'); } catch (x) { log('Auditoría no guardada', x.message); }
  }
  const resumen = u => JSON.stringify({ usuario: u.usuario, nombre: u.nombre, estado: estadoUsuario(u), metodo: u.metodo || 'password', perfil: u.perfil || null, ajustes: u.ajustes || null, alcance: u.alcance || null });

  // ---------------- sesiones ----------------
  function nuevaSesion(o, u, dev) {
    const tok = crypto.randomBytes(32).toString('hex'); const t = Date.now();
    o.ms.sesiones[sha256hex(tok)] = { uid: u.id, dev: String(dev || '').slice(0, 80), creado: t, ultimo: t, sver: u.sver || 0 };
    u.ultimoAcceso = t;
    for (const [h, s] of Object.entries(o.ms.sesiones)) if (t - s.ultimo > SESION_MS) delete o.ms.sesiones[h];
    guardar(o, 'sesiones', 'usuarios');
    return tok;
  }
  /** Sesión de la petición: { u, dev, h } · null si no hay o no vale · error 403 si la cuenta no está activa */
  async function autenticar(req, o) {
    const hdr = req.headers.authorization || ''; const tok = hdr.startsWith('Bearer ') ? hdr.slice(7) : '';
    if (!/^[0-9a-f]{64}$/.test(tok)) return null;
    const ms = await preparar(o); const h = sha256hex(tok); const s = ms.sesiones[h];
    if (!s) return null;
    const u = ms.usuarios[s.uid];
    if (u && estadoUsuario(u) !== 'activo') throw err(403, MENSAJE_ESTADO[estadoUsuario(u)] || 'Tu cuenta no está activa', 'cuenta_' + estadoUsuario(u));
    if (!u || (u.sver || 0) !== s.sver || Date.now() - s.ultimo > SESION_MS) { delete ms.sesiones[h]; guardar(o, 'sesiones'); return null; }
    s.ultimo = Date.now();
    if (Date.now() - ms.guardadoSes > 600000) { ms.guardadoSes = Date.now(); guardar(o, 'sesiones'); }
    return { u, dev: s.dev, h, ms };
  }
  const efectivos = (o, u, pid = null) => permisosEfectivos(u, o.ms.perfiles, pid);
  function exige(o, quien, perms, pid = null) {
    const ef = efectivos(o, quien.u, pid);
    const falta = perms.filter(k => !ef.has(k));
    if (falta.length) throw err(403, 'No tienes permiso para: ' + falta.map(k => (PERM_LABEL[k] || k).toLowerCase()).join(', ') + '.', 'permiso');
  }
  const exigeAlguno = (o, quien, perms) => { const ef = efectivos(o, quien.u); if (!perms.some(k => ef.has(k))) throw err(403, 'No tienes permiso para administrar usuarios', 'permiso'); };
  const respuestaAcceso = (o, u, sesion) => ({ ok: true, modo: 'servidor', sesion, secret: o.ms.claves.org, usuario: perfilPublico(u), nombre: o.meta.nombre, pruebas: o.meta.pruebas });
  function comprobarEstado(u) {
    const e = estadoUsuario(u);
    if (e !== 'activo') throw err(403, MENSAJE_ESTADO[e] || 'Tu cuenta no está activa', 'cuenta_' + e);
  }

  // ---------------- rutas públicas (sin sesión) ----------------
  async function publico(req, res, url, parts, o, { send, readJson }) {
    const ms = await preparar(o); const org = o.meta.org;
    const r = parts[4]; const r2 = parts[5];
    // Sal de la cuenta (cuenta inexistente: sal señuelo estable, indistinguible de una real)
    if (r === 'acceso' && r2 === 'sal' && req.method === 'POST') {
      const b = await readJson(req);
      if (!/^[0-9a-f]{64}$/.test(b.uid || '')) return send(res, 400, { error: 'Datos no válidos' });
      const id = ms.porUid.get(b.uid); const u = id && ms.usuarios[id]; const pw = u && (u.pw || o.cuentas[b.uid]);
      if (pw) return send(res, 200, { salt: pw.salt, iter: pw.iter });
      return send(res, 200, { salt: crypto.createHmac('sha256', secretoServidor()).update(org + ':' + b.uid).digest().subarray(0, 16).toString('base64'), iter: 600000 });
    }
    // Acceso con contraseña: el dispositivo demuestra que la conoce (prueba derivada); recibe una sesión
    if (r === 'acceso' && !r2 && req.method === 'POST') {
      const b = await readJson(req);
      if (!/^[0-9a-f]{64}$/.test(b.uid || '') || typeof b.prueba !== 'string' || b.prueba.length > 100) return send(res, 400, { error: 'Datos no válidos' });
      limiteAcceso(b.uid);
      const id = ms.porUid.get(b.uid); const u = id && ms.usuarios[id];
      const pw = u && (u.pw || o.cuentas[b.uid]);
      const h = sha256hex(Buffer.from(b.prueba, 'base64'));
      if (!u || !pw || !safeEq(h, pw.verif)) { falloAcceso(b.uid); return send(res, 403, { error: 'Usuario o contraseña incorrectos' }); }
      limpiarFallos(b.uid);
      comprobarEstado(u);
      const sesion = nuevaSesion(o, u, b.dev);
      return send(res, 200, { ...respuestaAcceso(o, u, sesion), wrap: o.cuentas[b.uid] ? o.cuentas[b.uid].wrap : null });
    }
    // Acceso con PIN: la credencial del dispositivo (que el PIN desbloquea en el propio dispositivo)
    if (r === 'acceso' && r2 === 'dispositivo' && req.method === 'POST') {
      const b = await readJson(req);
      if (!/^[0-9a-f]{64}$/.test(b.uid || '') || !/^[0-9a-f]{64}$/.test(b.cred || '') || !/^[A-Za-z0-9_-]{4,80}$/.test(b.dev || '')) return send(res, 400, { error: 'Datos no válidos' });
      limiteAcceso('dev:' + b.uid);
      const id = ms.porUid.get(b.uid); const u = id && ms.usuarios[id]; const d = u && (u.dispositivos || {})[b.dev];
      if (!d || !safeEq(sha256hex(b.cred), d.credHash)) { falloAcceso('dev:' + b.uid); return send(res, 403, { error: 'Este dispositivo ya no puede entrar con PIN: pide un código de activación nuevo', codigo: 'dispositivo' }); }
      limpiarFallos('dev:' + b.uid);
      comprobarEstado(u);
      d.ultimo = Date.now();
      return send(res, 200, respuestaAcceso(o, u, nuevaSesion(o, u, b.dev)));
    }
    // Activación con código de un solo uso (cuenta sin contraseña o restablecimiento de contraseña)
    if (r === 'activacion' && req.method === 'POST') {
      const b = await readJson(req);
      const uid = cuentaUid(org, b.usuario);
      if (!/^[A-Za-z0-9_-]{4,80}$/.test(b.dev || '')) return send(res, 400, { error: 'Datos no válidos' });
      limiteAcceso('act:' + uid);
      const id = ms.porUid.get(uid); const u = id && ms.usuarios[id]; const c = u && u.codigo;
      if (!c || Date.now() > c.exp || !safeEq(sha256hex(normCodigo(b.codigo)), c.hash)) { falloAcceso('act:' + uid); return send(res, 403, { error: 'Código no válido o caducado. Pide uno nuevo a un administrador.', codigo: 'codigo' }); }
      if (!['invitado', 'activo'].includes(estadoUsuario(u))) comprobarEstado(u);
      const antes = resumen(u);
      if ((u.metodo || 'password') === 'pin') {
        if (!/^[0-9a-f]{64}$/.test(b.cred || '')) return send(res, 400, { error: 'Falta la credencial del dispositivo' });
        u.dispositivos = { ...(u.dispositivos || {}), [b.dev]: { credHash: sha256hex(b.cred), nombre: String(b.devNombre || '').slice(0, 80), creado: Date.now() } };
      } else {
        const pw = b.pw || {};
        if (typeof pw.salt !== 'string' || pw.salt.length > 64 || !Number.isInteger(pw.iter) || pw.iter < 100000 || pw.iter > 5000000 || !/^[0-9a-f]{64}$/.test(pw.verif || '')) return send(res, 400, { error: 'Falta la contraseña nueva' });
        u.pw = { salt: pw.salt, iter: pw.iter, verif: pw.verif }; u.credV = 'v' + crypto.randomBytes(6).toString('hex');
      }
      delete u.codigo; limpiarFallos('act:' + uid);
      if (u.estado === 'invitado') u.estado = 'activo';
      const sesion = nuevaSesion(o, u, b.dev);
      await publicarUsuario(o, u);
      auditar(o, { u, dev: b.dev }, c.tipo === 'restablecer' ? 'Contraseña restablecida con código' : 'Cuenta activada en un dispositivo', u.usuario, antes, resumen(u) + (b.devNombre ? ' · dispositivo ' + String(b.devNombre).slice(0, 80) : ''));
      return send(res, 200, respuestaAcceso(o, u, sesion));
    }
    // Registro público: prueba de trabajo + límites; la cuenta queda pendiente y sin permisos
    if (r === 'registro') {
      if (!ms.ajustes.registroAbierto) return send(res, 403, { error: 'El registro de cuentas está desactivado. Pide a un administrador que te dé de alta.', codigo: 'registro_cerrado' });
      const firmar = (reto, exp, dif) => crypto.createHmac('sha256', secretoServidor()).update(org + ':' + reto + ':' + exp + ':' + dif).digest('hex');
      if (r2 === 'reto' && req.method === 'GET') {
        const reto = crypto.randomBytes(16).toString('hex'); const exp = Date.now() + 10 * 60000;
        return send(res, 200, { reto, exp, dificultad: RETO_BITS, firma: firmar(reto, exp, RETO_BITS) });
      }
      if (!r2 && req.method === 'POST') {
        const b = await readJson(req); const t = Date.now();
        if (!/^[0-9a-f]{32}$/.test(b.reto || '') || !Number.isInteger(b.exp) || b.exp < t || b.dificultad !== RETO_BITS || !safeEq(firmar(b.reto, b.exp, b.dificultad), String(b.firma || '')) || ms.retos.has(b.reto)) return send(res, 400, { error: 'La comprobación ha caducado: vuelve a intentarlo', codigo: 'reto' });
        if (ceros(crypto.createHash('sha256').update(b.reto + ':' + String(b.nonce)).digest()) < RETO_BITS) return send(res, 400, { error: 'Comprobación anti-abuso no superada', codigo: 'reto' });
        for (const [k, e] of ms.retos) if (e < t) ms.retos.delete(k);
        ms.retos.set(b.reto, b.exp);
        ms.regs = ms.regs.filter(x => t - x < 3600e3);
        if (ms.regs.length >= REGISTROS_HORA) return send(res, 429, { error: 'Demasiadas solicitudes de cuenta: inténtalo dentro de un rato', codigo: 'limite' });
        if (Object.values(ms.usuarios).filter(u => u.estado === 'pendiente').length >= MAX_PENDIENTES) return send(res, 429, { error: 'Hay demasiadas solicitudes pendientes de revisar: inténtalo más tarde', codigo: 'limite' });
        const usuario = normUsuario(b.usuario); const nombre = String(b.nombre || '').trim().slice(0, 80);
        if (!USUARIO_RE.test(usuario)) return send(res, 400, { error: 'El nombre de usuario debe tener entre 2 y 50 caracteres: letras sin acentos, números, punto, guion o @' });
        if (!nombre) return send(res, 400, { error: 'Indica tu nombre' });
        if (typeof b.salt !== 'string' || b.salt.length > 64 || !Number.isInteger(b.iter) || b.iter < 100000 || b.iter > 5000000 || !/^[0-9a-f]{64}$/.test(b.verif || '')) return send(res, 400, { error: 'Datos no válidos' });
        if (ms.porUid.has(cuentaUid(org, usuario)) || o.cuentas[cuentaUid(org, usuario)]) return send(res, 409, { error: 'Ese nombre de usuario ya existe: elige otro', codigo: 'duplicado' });
        ms.regs.push(t);
        const u = { id: 'usr_' + crypto.randomBytes(9).toString('base64url'), usuario, nombre, estado: 'pendiente', metodo: 'password', perfil: null, pw: { salt: b.salt, iter: b.iter, verif: b.verif }, origen: 'registro', creado: t };
        ms.usuarios[u.id] = u; ms.porUid.set(cuentaUid(org, usuario), u.id);
        guardar(o, 'usuarios'); await publicarUsuario(o, u);
        auditar(o, null, 'Solicitud de cuenta (registro desde el inicio de sesión)', usuario, '', resumen(u));
        return send(res, 201, { ok: true, estado: 'pendiente', mensaje: MENSAJE_ESTADO.pendiente });
      }
    }
    return undefined;
  }

  // ---------------- rutas con sesión: usuario, administración ----------------
  async function privado(req, res, url, parts, o, quien, { send, readJson }) {
    const ms = o.ms; const r = parts[4];
    if (r === 'yo' && req.method === 'GET') return send(res, 200, { usuario: perfilPublico(quien.u), permisos: [...efectivos(o, quien.u)], perfiles: ms.perfiles });
    if (r === 'sesion' && parts[5] === 'cerrar' && req.method === 'POST') { delete ms.sesiones[quien.h]; guardar(o, 'sesiones'); return send(res, 200, { ok: true }); }
    if (r !== 'admin') return undefined;
    const a = parts[5];
    if (a === 'usuarios') {
      exigeAlguno(o, quien, ['usuarios.crear', 'usuarios.editar', 'usuarios.aprobar', 'usuarios.permisos']);
      const lista = () => Object.values(ms.usuarios);
      if (!parts[6] && req.method === 'GET') return send(res, 200, { usuarios: lista().map(u => listado(o, u)), perfiles: ms.perfiles, ajustes: ms.ajustes });
      if (!parts[6] && req.method === 'POST') {
        const b = await readJson(req);
        const usuario = normUsuario(b.usuario); const nombre = String(b.nombre || usuario).trim().slice(0, 80);
        if (!USUARIO_RE.test(usuario)) throw err(400, 'Nombre de usuario no válido (2–50 caracteres: letras sin acentos, números, punto, guion o @)');
        if (ms.porUid.has(cuentaUid(o.meta.org, usuario))) throw err(409, 'Ese nombre de usuario ya existe', 'duplicado');
        const metodo = b.metodo === 'pin' ? 'pin' : 'password';
        const pw = metodo === 'password' && b.pw && /^[0-9a-f]{64}$/.test(b.pw.verif || '') && Number.isInteger(b.pw.iter) && b.pw.iter >= 100000 && b.pw.iter <= 5000000 && typeof b.pw.salt === 'string' && b.pw.salt.length <= 64 ? { salt: b.pw.salt, iter: b.pw.iter, verif: b.pw.verif } : null;
        const u = { id: 'usr_' + crypto.randomBytes(9).toString('base64url'), usuario, nombre, metodo, estado: pw ? 'activo' : 'invitado', perfil: limpiarPerfil(ms, b.perfil), ajustes: limpiarAjustes(b.ajustes), alcance: limpiarAlcance(b.alcance), creado: Date.now(), creadoPor: quien.u.usuario, origen: 'administrador' };
        if (pw) { u.pw = pw; u.credV = 'v' + crypto.randomBytes(6).toString('hex'); }
        comprobar({ actor: quien.u, antes: null, despues: u, perfiles: ms.perfiles, usuarios: lista() });
        let codigo = null;
        if (!pw) { codigo = nuevoCodigo(); u.codigo = { hash: sha256hex(normCodigo(codigo)), tipo: 'activacion', exp: Date.now() + CODIGO_MS, creadoPor: quien.u.usuario }; }
        ms.usuarios[u.id] = u; ms.porUid.set(cuentaUid(o.meta.org, usuario), u.id);
        guardar(o, 'usuarios'); await publicarUsuario(o, u);
        auditar(o, quien, 'Alta de usuario', usuario, '', resumen(u) + (codigo ? ' · código de activación emitido' : ''));
        return send(res, 201, { usuario: listado(o, u), codigo });
      }
      const u = parts[6] && ms.usuarios[parts[6]];
      if (!u) throw err(404, 'Usuario no encontrado');
      if (!parts[7] && req.method === 'PATCH') {
        const b = await readJson(req); const antes = JSON.parse(JSON.stringify(u));
        const despues = { ...u };
        if ('nombre' in b) despues.nombre = String(b.nombre || u.usuario).trim().slice(0, 80);
        if ('perfil' in b) despues.perfil = limpiarPerfil(ms, b.perfil);
        if ('ajustes' in b) despues.ajustes = limpiarAjustes(b.ajustes);
        if ('alcance' in b) despues.alcance = limpiarAlcance(b.alcance);
        if ('estado' in b) {
          if (!ESTADOS.includes(b.estado)) throw err(400, 'Estado no válido');
          if (b.estado !== estadoUsuario(u) && !(TRANSICIONES[estadoUsuario(u)] || []).includes(b.estado)) throw err(400, 'No se puede pasar de «' + estadoUsuario(u) + '» a «' + b.estado + '»');
          despues.estado = b.estado;
          if (b.estado === 'activo' && estadoUsuario(u) === 'pendiente') despues.aprobado = { por: quien.u.usuario, t: Date.now() };
          if (b.estado === 'activo' && !despues.pw && !o.cuentas[cuentaUid(o.meta.org, u.usuario)] && !Object.keys(u.dispositivos || {}).length) throw err(400, 'La cuenta no tiene ninguna forma de entrar todavía: genera un código de activación');
        }
        let codigo = null;
        if ('metodo' in b && (b.metodo === 'pin' ? 'pin' : 'password') !== (u.metodo || 'password')) {
          // Cambiar el método exige activar de nuevo: se retiran las credenciales anteriores y se emite un código
          despues.metodo = b.metodo === 'pin' ? 'pin' : 'password'; delete despues.pw; despues.dispositivos = {}; despues.sver = (u.sver || 0) + 1;
          if (estadoUsuario(u) === 'activo') despues.estado = 'invitado';
          codigo = nuevoCodigo(); despues.codigo = { hash: sha256hex(normCodigo(codigo)), tipo: 'activacion', exp: Date.now() + CODIGO_MS, creadoPor: quien.u.usuario };
        }
        comprobar({ actor: quien.u, antes: u, despues, perfiles: ms.perfiles, usuarios: Object.values(ms.usuarios) });
        if (estadoUsuario(despues) !== 'activo' && estadoUsuario(u) === 'activo') despues.sver = (despues.sver || 0) + 1; // cierra sus sesiones
        if ('metodo' in b && despues.metodo !== (u.metodo || 'password')) delete o.cuentas[cuentaUid(o.meta.org, u.usuario)];
        ms.usuarios[u.id] = despues; guardar(o, 'usuarios'); if ('metodo' in b) orgSave(o, 'cuentas');
        await publicarUsuario(o, despues);
        auditar(o, quien, accionCambio(antes, despues), u.usuario, resumen(antes), resumen(despues) + (codigo ? ' · código de activación emitido' : ''));
        return send(res, 200, { usuario: listado(o, despues), codigo });
      }
      if (parts[7] === 'codigo' && req.method === 'POST') {
        exige(o, quien, ['usuarios.editar']);
        if (quien.u.id === u.id) throw err(403, 'No puedes generarte un código a ti mismo: pídeselo a otro administrador', 'permiso');
        comprobar({ actor: quien.u, antes: u, despues: u, perfiles: ms.perfiles, usuarios: Object.values(ms.usuarios) });
        if (['rechazado', 'desactivado', 'pendiente'].includes(estadoUsuario(u))) throw err(400, 'Activa antes la cuenta');
        const codigo = nuevoCodigo(); const tipo = (u.metodo || 'password') === 'pin' || u.estado === 'invitado' ? 'activacion' : 'restablecer';
        u.codigo = { hash: sha256hex(normCodigo(codigo)), tipo, exp: Date.now() + CODIGO_MS, creadoPor: quien.u.usuario };
        guardar(o, 'usuarios');
        auditar(o, quien, tipo === 'activacion' ? 'Código de activación emitido' : 'Código para restablecer la contraseña emitido', u.usuario, '', 'Caduca ' + new Date(u.codigo.exp).toISOString());
        return send(res, 200, { usuario: listado(o, u), codigo });
      }
      if (parts[7] === 'revocar' && req.method === 'POST') {
        exige(o, quien, ['usuarios.editar']);
        comprobar({ actor: quien.u, antes: u, despues: u, perfiles: ms.perfiles, usuarios: Object.values(ms.usuarios) });
        const b = await readJson(req); let det;
        if (b.dev) {
          const d = (u.dispositivos || {})[b.dev]; if (d) delete u.dispositivos[b.dev];
          for (const [h, s] of Object.entries(ms.sesiones)) if (s.uid === u.id && s.dev === b.dev) delete ms.sesiones[h];
          det = 'Dispositivo ' + ((d && d.nombre) || b.dev) + ': acceso con PIN y sesiones retirados';
        } else { u.sver = (u.sver || 0) + 1; if (b.dispositivos) u.dispositivos = {}; det = 'Todas las sesiones cerradas' + (b.dispositivos ? ' y accesos con PIN retirados' : ''); }
        guardar(o, 'usuarios', 'sesiones');
        auditar(o, quien, 'Accesos revocados', u.usuario, '', det);
        return send(res, 200, { usuario: listado(o, u) });
      }
    }
    if (a === 'perfiles') {
      if (req.method === 'GET') { exigeAlguno(o, quien, ['usuarios.crear', 'usuarios.editar', 'usuarios.aprobar', 'usuarios.permisos']); return send(res, 200, { perfiles: ms.perfiles }); }
      if (req.method === 'PUT') {
        exige(o, quien, ['usuarios.permisos']);
        const b = await readJson(req); const nuevos = b.perfiles;
        if (!Array.isArray(nuevos) || nuevos.length > 100) throw err(400, 'Perfiles no válidos');
        const ef = efectivos(o, quien.u); const ids = new Set();
        const lista = nuevos.map(p => {
          if (!/^[A-Za-z0-9_-]{3,60}$/.test(p.id || '') || ids.has(p.id)) throw err(400, 'Identificador de perfil no válido o repetido');
          ids.add(p.id);
          const nombre = String(p.nombre || '').trim().slice(0, 60); if (!nombre) throw err(400, 'Todos los perfiles necesitan nombre');
          const permisos = [...new Set((p.permisos || []).filter(k => PERM_KEYS.includes(k)))];
          const previo = ms.perfiles.find(x => x.id === p.id);
          const antes = new Set(previo ? normalizarPerfil(previo).permisos : []);
          const extra = permisos.filter(k => !antes.has(k) && !ef.has(k));
          if (extra.length) throw err(403, 'No tienes los permisos que intentas añadir al perfil «' + nombre + '»: ' + extra.map(k => PERM_LABEL[k]).join(', '), 'permiso');
          return { id: p.id, nombre, permisos, v: 2, ...(previo && previo.sistema ? { sistema: true } : {}) };
        });
        const admin = lista.find(p => p.id === 'rol_admin');
        if (!admin) throw err(400, 'El perfil Administrador no se puede eliminar');
        admin.permisos = [...PERM_KEYS];
        for (const p of ms.perfiles) if (!ids.has(p.id) && Object.values(ms.usuarios).some(u => u.perfil === p.id || Object.values((u.alcance && u.alcance.preventivos) || {}).includes(p.id)))
          throw err(400, 'El perfil «' + p.nombre + '» lo usa algún usuario: cámbiaselo antes de eliminarlo');
        const antesTxt = JSON.stringify(ms.perfiles.map(p => [p.nombre, normalizarPerfil(p).permisos.length]));
        ms.perfiles = lista; guardar(o, 'perfiles'); await publicarPerfiles(o);
        auditar(o, quien, 'Perfiles de permisos modificados', 'Perfiles', antesTxt, JSON.stringify(lista.map(p => [p.nombre, p.permisos.length])));
        return send(res, 200, { perfiles: ms.perfiles });
      }
    }
    if (a === 'ajustes') {
      if (req.method === 'GET') return send(res, 200, { ajustes: ms.ajustes });
      if (req.method === 'PUT') {
        exige(o, quien, ['usuarios.admin']);
        const b = await readJson(req); const antes = JSON.stringify(ms.ajustes);
        if ('registroAbierto' in b) ms.ajustes.registroAbierto = !!b.registroAbierto;
        guardar(o, 'ajustes');
        auditar(o, quien, 'Ajustes de cuentas', 'Registro desde el inicio de sesión', antes, JSON.stringify(ms.ajustes));
        return send(res, 200, { ajustes: ms.ajustes });
      }
    }
    if (a === 'auditoria' && req.method === 'GET') {
      exige(o, quien, ['auditoria.ver']);
      const filtro = url.searchParams.get('usuario') || ''; const lim = Math.min(2000, Math.max(1, Number(url.searchParams.get('limite') || 500)));
      let out = [];
      try { out = fs.readFileSync(path.join(o.dir, 'auditoria.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean); } catch { }
      if (filtro) out = out.filter(e => (e.actor && (e.actor.id === filtro || e.actor.usuario === filtro)) || e.objetivo === filtro);
      return send(res, 200, { registros: out.slice(-lim).reverse() });
    }
    return undefined;
  }
  const limpiarPerfil = (ms, p) => (p && ms.perfiles.some(x => x.id === p) ? p : null);
  const limpiarAjustes = a => ({ mas: [...new Set(((a && a.mas) || []).filter(k => PERM_KEYS.includes(k)))], menos: [...new Set(((a && a.menos) || []).filter(k => PERM_KEYS.includes(k)))] });
  function limpiarAlcance(a) {
    if (!a || a.tipo !== 'seleccion') return { tipo: 'todos' };
    const p = {}; for (const [pid, perf] of Object.entries(a.preventivos || {}).slice(0, 500)) if (/^[A-Za-z0-9][A-Za-z0-9_-]{3,79}$/.test(pid)) p[pid] = typeof perf === 'string' ? perf : null;
    return { tipo: 'seleccion', preventivos: p };
  }
  function accionCambio(a, d) {
    const ea = estadoUsuario(a), ed = estadoUsuario(d);
    if (ea !== ed) return { activo: ea === 'pendiente' ? 'Registro aprobado' : 'Cuenta reactivada', rechazado: 'Registro rechazado', suspendido: 'Cuenta suspendida', desactivado: 'Cuenta desactivada', invitado: 'Método de acceso cambiado' }[ed] || 'Estado de cuenta cambiado';
    if ((a.metodo || 'password') !== (d.metodo || 'password')) return 'Método de acceso cambiado';
    return JSON.stringify([a.perfil, a.ajustes, a.alcance]) !== JSON.stringify([d.perfil, d.ajustes, d.alcance]) ? 'Permisos modificados' : 'Usuario modificado';
  }

  // ---------------- configuración y registro de preventivos ----------------
  function permisoConfig(id) {
    if (id.startsWith('usr:') || id === 'roles') return null; // solo los escribe el servidor
    if (id.startsWith('tipo:') || id.startsWith('plt:')) return 'recursos.gestionar';
    if (id.startsWith('mapa:')) return 'planos.editar';
    return 'config.editar';
  }
  /** Comprueba un cambio de configuración general antes de guardarlo; devuelve los datos descifrados */
  async function validarConfig(o, quien, id, b) {
    const perm = permisoConfig(id);
    if (!perm) throw err(403, 'Los usuarios y perfiles se gestionan desde la administración del servidor', 'permiso');
    exige(o, quien, [perm]);
    let data = null;
    if (!b.borrado) { try { const x = await open(o.ms.k.key, b.c); if (x.id !== id) throw new Error(); data = x.data; } catch { throw err(400, 'Elemento cifrado con otra clave'); } }
    return data;
  }
  const configGuardada = (o, id, data, borrado) => o.ms.cfg.set(id, borrado ? null : data);
  /** Entrada del registro de preventivos: el servidor obtiene la clave del preventivo y la custodia */
  async function validarRegistro(o, quien, pid, w) {
    let info; try { info = await open(o.ms.k.key, w); } catch { throw err(400, 'Registro cifrado con otra clave'); }
    if (info.pid && info.pid !== pid) throw err(400, 'Registro de otro preventivo');
    const nuevo = !o.prevs[pid];
    if (nuevo) exige(o, quien, ['preventivos.crear']);
    else if (!accesoPreventivo(quien.u, pid)) throw err(403, 'No tienes acceso a este preventivo', 'permiso');
    const cl = o.ms.claves.prevs || (o.ms.claves.prevs = {});
    if (info.secret) {
      if (cl[pid] && cl[pid] !== info.secret) throw err(409, 'El preventivo ya existe con otra clave');
      if (!cl[pid]) { cl[pid] = info.secret; guardarClaves(o.meta.org, o.ms.claves); pidOrg.set(pid, o.meta.org); }
    }
  }
  const puedeVerPrev = (o, u, pid) => accesoPreventivo(u, pid) && efectivos(o, u, pid).has('preventivos.ver');

  // ---------------- operaciones de los preventivos ----------------
  async function clavesPrev(o, pid) {
    if (o.ms.pk.has(pid)) return o.ms.pk.get(pid);
    const s = (o.ms.claves.prevs || {})[pid]; if (!s) return null;
    const k = await prevKeys(unb64(s)); o.ms.pk.set(pid, k); return k;
  }
  async function motorPrev(o, pid, p) {
    if (o.ms.motores.has(pid)) return o.ms.motores.get(pid);
    const k = await clavesPrev(o, pid); if (!k) throw err(409, 'El servidor aún no tiene la clave de este preventivo: vuelve a intentarlo en un momento', 'sin_clave');
    const ops = [];
    for (const r of p.ops) { try { const op = await open(k.key, r.c); op.sq = r.sq; op.num = r.num ?? null; ops.push(op); } catch { /* registro ilegible: se ignora */ } }
    const e = new Engine(ops); o.ms.motores.set(pid, e); return e;
  }
  /** Política de recursos (§3): un tipo desactivado, retirado o eliminado no sirve para unidades nuevas */
  function tipoNoDisponible(o, s, tipoId, lote, op) {
    if (!tipoId) return null;
    const noDisp = new Set();
    if (o.ms.cfg.has('tipo:' + tipoId)) { const g = o.ms.cfg.get('tipo:' + tipoId); if (!tipoActivo(g)) noDisp.add(tipoId); }
    let t = s.prev && s.prev.cat.tiposRecurso.find(x => x.id === tipoId);
    if (!t) { const inc = lote.find(x => x.k === 'prev.cat' && x.b === op.b && x.x && x.x.cat === 'tiposRecurso'); t = inc && inc.x.n.find(x => x.id === tipoId); }
    return t ? motivoTipoNoDisponible(t, noDisp) : null;
  }
  /** Valida un lote de operaciones de un preventivo del espacio. Devuelve por operación { ok, op } o { error, codigo }.
   *  Las aceptadas se aplican al estado del servidor (las siguientes del lote ya las ven). */
  async function validarOps(o, pid, quien, recs, p) {
    const k = await clavesPrev(o, pid);
    if (!k) throw err(409, 'El servidor aún no tiene la clave de este preventivo: vuelve a intentarlo en un momento', 'sin_clave');
    const motor = await motorPrev(o, pid, p);
    const ops = []; for (const r of recs) { try { ops.push(await open(k.key, r.c)); } catch { ops.push(null); } }
    const ef = efectivos(o, quien.u, pid);
    const out = [];
    // Copia del estado sobre la que se van aplicando las aceptadas: cada operación se valida viendo las anteriores del lote
    const st = lazyCopy(motor.state); const lookup = id => motor.byId.get(id);
    for (const [i, op] of ops.entries()) {
      const rechazo = (error, codigo = 'permiso') => { out.push({ error, codigo }); auditar(o, quien, 'Operación rechazada', pid, op ? op.k + ' ' + op.e : '', error); };
      if (!op) { rechazo('Operación cifrada con otra clave', 'clave'); continue; }
      if (op.id !== recs[i].id || op.p !== pid) { rechazo('Operación de otro preventivo', 'datos'); continue; }
      if (!op.u || op.u.id !== quien.u.id) { rechazo('La operación no la ha hecho el usuario de esta sesión', 'identidad'); continue; }
      if (op.d !== quien.dev) { rechazo('La operación no procede de este dispositivo', 'identidad'); continue; }
      if (!puedeVerPrev(o, quien.u, pid)) { rechazo('No tienes acceso a este preventivo'); continue; }
      const req = permisosOp(op, st, ops.filter(Boolean));
      if (!req) { rechazo('Operación no reconocida por el servidor (¿aplicación sin actualizar?)', 'datos'); continue; }
      const falta = req.filter(x => !ef.has(x));
      if (falta.length) { rechazo('No tienes permiso para: ' + falta.map(x => (PERM_LABEL[x] || x).toLowerCase()).join(', ')); continue; }
      const enAlta = ops.some(x => x && x.k === 'prev.create' && x.b === op.b);
      const tipo = op.k === 'unit.create' && !enAlta ? op.x && op.x.u && op.x.u.tipo : op.k === 'unit.update' ? op.x && op.x.f && op.x.f.tipo && op.x.f.tipo.n : null;
      const motivo = tipoNoDisponible(o, st, tipo, ops.filter(Boolean), op);
      if (motivo) { const t = ((st.prev && st.prev.cat.tiposRecurso.find(x => x.id === tipo)) || {}).nombre || tipo; rechazo('El tipo de recurso «' + t + '» está ' + motivo + ': no se puede usar en unidades nuevas. Actualiza los datos de la aplicación y elige otro tipo.', 'tipo_inactivo'); continue; }
      out.push({ ok: true, op });
      applyOp(st, op, { lookup });
    }
    return out;
  }
  /** Las aceptadas, ya guardadas con su secuencia y número, pasan al estado del servidor */
  function aplicar(o, pid, ops) { const m = o.ms && o.ms.motores.get(pid); if (m && ops.length) m.add(ops); }

  // ---------------- alta en modo servidor y migración de un espacio 1.3.0 ----------------
  /** Espacio nuevo creado por una app 1.4.0: el servidor custodia la clave y el creador es el primer administrador */
  async function iniciarEspacio(o, secret, admin, dev) {
    guardarClaves(o.meta.org, { org: secret, prevs: {} });
    o.meta.modo = 'servidor'; o.meta.minCliente = '1.4.0'; o.meta.modoDesde = Date.now();
    await preparar(o);
    const u = { id: admin.id || 'usr_' + crypto.randomBytes(9).toString('base64url'), usuario: normUsuario(admin.usuario), nombre: String(admin.nombre || admin.usuario).trim().slice(0, 80), estado: 'activo', metodo: 'password', perfil: 'rol_admin', pw: admin.pw, credV: 'v' + crypto.randomBytes(6).toString('hex'), creado: Date.now(), origen: 'creador' };
    if (!USUARIO_RE.test(u.usuario) || !u.pw || !/^[0-9a-f]{64}$/.test(u.pw.verif || '')) throw err(400, 'Datos del administrador no válidos');
    o.ms.usuarios[u.id] = u; o.ms.porUid.set(cuentaUid(o.meta.org, u.usuario), u.id);
    orgSave(o, 'meta'); guardar(o, 'usuarios', 'perfiles', 'ajustes');
    await publicarPerfiles(o); await publicarUsuario(o, u);
    auditar(o, { u, dev }, 'Espacio central creado en modo servidor', o.meta.nombre || o.meta.org, '', 'Administrador ' + u.usuario);
    return nuevaSesion(o, u, dev);
  }
  /** Migración 1.3.0 → 1.4.0: con la clave del espacio, el servidor lee usuarios, perfiles y preventivos ya guardados */
  async function migrar(o, secretB64, { usuario = '', dev = '' } = {}) {
    if (activo(o)) throw err(409, 'El espacio central ya está en modo servidor');
    const k = await orgKeys(unb64(secretB64));
    if (k.tokenHash !== o.meta.tokenHash) throw err(403, 'La clave no corresponde a este espacio central');
    // Copia de seguridad de los archivos del espacio (los preventivos no se modifican)
    const copia = path.join(DATA, '_servidor', 'copias', o.meta.org + '-' + new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(copia, { recursive: true });
    for (const f of fs.readdirSync(o.dir)) { const src = path.join(o.dir, f); if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(copia, f)); }
    const prevs = {};
    for (const [pid, v] of Object.entries(o.prevs)) { try { const info = await open(k.key, v.w); if (info.secret) prevs[pid] = info.secret; } catch { } }
    const usuarios = {}; let perfiles = null;
    for (const [id, v] of Object.entries(o.config)) {
      if (v.borrado) continue;
      let data; try { data = (await open(k.key, v.c)).data; } catch { continue; }
      if (id === 'roles' && Array.isArray(data)) perfiles = data;
      if (id.startsWith('usr:') && data && data.usuario) {
        const c = o.cuentas[cuentaUid(o.meta.org, data.usuario)];
        usuarios[data.id] = { id: data.id, usuario: normUsuario(data.usuario), nombre: data.nombre || data.usuario, estado: data.activo === false ? 'desactivado' : 'activo', metodo: 'password', perfil: data.rol || null, creado: data.creado || Date.now(), credV: (data.cred && data.cred.v) || 'v0', origen: 'migracion', ...(c ? { pw: { salt: c.salt, iter: c.iter, verif: c.verif } } : {}) };
      }
    }
    if (!Object.values(usuarios).some(u => u.estado === 'activo' && u.perfil === 'rol_admin')) throw err(400, 'No se ha encontrado ningún administrador activo en el espacio: no se migra');
    guardarClaves(o.meta.org, { org: secretB64, prevs });
    writeAtomic(path.join(o.dir, 'usuarios.json'), JSON.stringify(usuarios));
    writeAtomic(path.join(o.dir, 'perfiles.json'), JSON.stringify(perfiles || defaultRoles()));
    o.meta.modo = 'servidor'; o.meta.minCliente = '1.4.0'; o.meta.modoDesde = Date.now(); orgSave(o, 'meta');
    o.ms = null; o._msP = null; await preparar(o);
    for (const u of Object.values(o.ms.usuarios)) await publicarUsuario(o, u);
    await publicarPerfiles(o);
    const actor = Object.values(o.ms.usuarios).find(u => u.usuario === normUsuario(usuario)) || null;
    auditar(o, actor ? { u: actor, dev } : null, 'Espacio central migrado al modo servidor (1.4.0)', o.meta.nombre || o.meta.org, '', Object.keys(usuarios).length + ' usuarios, ' + Object.keys(prevs).length + ' preventivos · copia: ' + path.basename(copia));
    log('Espacio central migrado al modo servidor', o.meta.org, Object.keys(usuarios).length, 'usuarios', Object.keys(prevs).length, 'preventivos');
    return { usuarios: Object.keys(usuarios).length, preventivos: Object.keys(prevs).length, copia: path.basename(copia) };
  }

  /** Al arrancar: qué preventivos pertenecen a espacios en modo servidor (sus operaciones exigen sesión) */
  function indexar() {
    let n = 0;
    try { for (const f of fs.readdirSync(CLAVES_DIR)) if (f.endsWith('.json')) { const c = leerClaves(f.slice(0, -5)); for (const pid of Object.keys((c && c.prevs) || {})) { pidOrg.set(pid, f.slice(0, -5)); n++; } } } catch { }
    return n;
  }
  /** Preventivo nuevo de un espacio en modo servidor: el servidor custodia su clave desde el alta */
  async function custodiarPrev(o, quien, pid, secretB64, tokenHash) {
    exige(o, quien, ['preventivos.crear']);
    const k = await prevKeys(unb64(secretB64));
    if (k.tokenHash !== tokenHash) throw err(400, 'La clave del preventivo no coincide');
    const cl = o.ms.claves.prevs || (o.ms.claves.prevs = {});
    if (cl[pid] && cl[pid] !== secretB64) throw err(409, 'Ese preventivo ya existe con otra clave');
    cl[pid] = secretB64; guardarClaves(o.meta.org, o.ms.claves); pidOrg.set(pid, o.meta.org);
  }
  /** Cambio de la propia contraseña (prueba derivada en el dispositivo; nunca llega la contraseña) */
  async function cambiarContrasena(o, quien, uid, b) {
    if (uid !== cuentaUid(o.meta.org, quien.u.usuario)) throw err(403, 'Solo puedes cambiar tu propia contraseña', 'permiso');
    if (typeof b.salt !== 'string' || b.salt.length > 64 || !Number.isInteger(b.iter) || b.iter < 100000 || b.iter > 5000000 || !/^[0-9a-f]{64}$/.test(b.verif || '')) throw err(400, 'Datos no válidos');
    if ((quien.u.metodo || 'password') !== 'password') throw err(400, 'Tu cuenta entra con PIN: no tiene contraseña');
    quien.u.pw = { salt: b.salt, iter: b.iter, verif: b.verif }; quien.u.credV = 'v' + crypto.randomBytes(6).toString('hex');
    guardar(o, 'usuarios'); await publicarUsuario(o, quien.u);
    auditar(o, quien, 'Cambio de contraseña', quien.u.usuario, '', 'Las demás sesiones siguen abiertas; los otros dispositivos piden la nueva contraseña');
  }

  return { activo, preparar, autenticar, publico, privado, exige, validarConfig, configGuardada, validarRegistro, puedeVerPrev, validarOps, aplicar, iniciarEspacio, migrar, indexar, custodiarPrev, cambiarContrasena, orgDePrev: pid => pidOrg.get(pid) || null };
}
