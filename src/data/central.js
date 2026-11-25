// Espacio central del servidor (organización):
//  - Cuentas comunes: un dispositivo nuevo solo necesita usuario y contraseña. El servidor guarda
//    el hash de una prueba derivada de la contraseña y la clave del espacio envuelta con ella.
//  - Alta alternativa de dispositivos con enlace o código de alta.
//  - Registro compartido de preventivos: cualquier dispositivo dado de alta ve y abre los
//    preventivos del espacio sin códigos de incorporación.
//  - Configuración general compartida (tipos de recurso, unidades plantilla…) con control
//    optimista: si dos dispositivos cambian lo mismo, se detecta y se resuelve, nunca se pisa.
// Todo viaja cifrado con la clave de la organización, que el servidor no conoce.
import { b64url, unb64url, enc, dec, b64, unb64, now, randomBytes, AppError, stableStringify } from '../core/util.js';
import { orgKeys, seal, open, cuentaDerivar, sha256hex, sha256, CUENTA_ITER } from '../core/crypto.js';
import { normServer } from './sync.js';

export const CENTRAL_ESTADOS = {
  sin_configurar: 'Sin configurar', conectado: 'Conectado', sincronizando: 'Sincronizando…',
  sin_conexion: 'Sin conexión', error: 'Error', pendiente: 'Cambios pendientes', sesion: 'Inicia sesión para sincronizar', cuenta: 'Cuenta no activa', bloqueado: 'Actualiza la aplicación',
};

export function encodeAltaCode({ server, org, secret, nombre, pruebas }) {
  return 'UCOC1.' + b64url(enc.encode(JSON.stringify({ v: 1, s: server, o: org, k: b64url(secret), n: nombre || '', p: pruebas ? 1 : 0 })));
}
/** Acepta el código o un enlace que lo contenga (…#central=UCOC1.…) */
export function decodeAltaCode(code) {
  const m = String(code || '').trim().match(/UCOC1\.([A-Za-z0-9_-]+)/);
  if (!m) throw new AppError('Código o enlace de alta no válido');
  let o; try { o = JSON.parse(dec.decode(unb64url(m[1]))); } catch { throw new AppError('Código de alta dañado'); }
  if (!o.s || !o.o || !o.k) throw new AppError('Código de alta incompleto');
  return { server: normServer(o.s), org: o.o, secret: unb64url(o.k), nombre: o.n || '', pruebas: !!o.p };
}

const VACIO = () => ({ items: {}, pendCfg: {}, conflictos: {}, pendPrevs: {}, registro: {}, pendCuentas: {} });
export const normUsuario = u => String(u || '').trim().toLowerCase().replace(/\s+/g, '.');
/** Prueba de trabajo del registro: sha256(reto:nonce) con «dif» bits iniciales a cero (~1–2 s en un móvil) */
export async function resolverReto(reto, dif) {
  const ok = h => { let n = 0; for (const b of h) { if (b === 0) { n += 8; if (n >= dif) return true; continue; } n += Math.clz32(b) - 24; break; } return n >= dif; };
  for (let n = 0; n < 1e8; n++) { if (ok(await sha256(reto + ':' + n))) return n; }
  throw new AppError('No se pudo completar la comprobación anti-abuso');
}
/** Identificador opaco de una cuenta en el servidor (no revela el nombre de usuario) */
export const cuentaUid = (org, usuario) => sha256hex('uco-cuenta:' + org + ':' + normUsuario(usuario));

export class CentralSync {
  /** hooks: { repo, device(), version, pruebas, onPrevs(entries), onConfig(ids), onStatus(st) } */
  constructor(hooks) {
    this.h = hooks; this.st = { estado: 'sin_configurar' }; this.timer = null; this.intervalMs = 10000;
    this.fetch = (...a) => globalThis.fetch(...a); this._k = null; this._latido = 0;
  }
  status() { return this.st; }
  _set(patch) { this.st = { ...this.st, ...patch }; this.h.onStatus && this.h.onStatus(this.st); return this.st; }
  async meta() { return this.h.repo.getDoc('central', null); }
  async datos() { return { ...VACIO(), ...(await this.h.repo.getDoc('central:datos', null) || {}) }; }
  async _saveDatos(d) { await this.h.repo.putDoc('central:datos', d); }
  async keys(meta) {
    if (this._k && this._k.org === meta.org) return this._k;
    this._k = { org: meta.org, ...(await orgKeys(unb64(meta.secret))) }; return this._k;
  }
  async _req(server, path, { method = 'GET', token, body, timeout = 20000 } = {}) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const tm = ctl ? setTimeout(() => ctl.abort(), timeout) : null;
    try {
      const headers = {};
      if (token) headers.Authorization = 'Bearer ' + token;
      if (body) headers['Content-Type'] = 'application/json';
      const r = await this.fetch(server + '/api/v1' + path, { method, headers, body: body ? JSON.stringify(body) : undefined, signal: ctl ? ctl.signal : undefined, cache: 'no-store' });
      let j = null; try { j = await r.json(); } catch { }
      if (!r.ok) throw Object.assign(new AppError((j && j.error) || 'Error ' + r.status, 'http'), { status: r.status, body: j });
      return j;
    } catch (e) {
      if (e && e.code === 'http') throw e;
      throw Object.assign(new AppError('Sin conexión con el servidor central', 'red'), { cause: e });
    } finally { if (tm) clearTimeout(tm); }
  }
  /** ¿Responde un servidor del Gestor en esa dirección? Devuelve su versión o null */
  async detectar(server) {
    try { const j = await this._req(normServer(server), '/salud', { timeout: 6000 }); return j && j.servicio === 'gestor-emergencias-uco' ? j.version : null; } catch { return null; }
  }
  /** Espacio central principal que publica el servidor para este entorno: { org, nombre } (org null si aún no existe) */
  async consultar(server) {
    server = normServer(server);
    let j;
    try { j = await this._req(server, '/central?entorno=' + (this.h.pruebas ? 'pruebas' : 'produccion'), { timeout: 8000 }); }
    catch (e) {
      // Servidor anterior a la 1.1.0: responde, pero aún no tiene servidor central
      if (e.status === 404) return { server, org: null, nombre: '', pruebas: false, version: await this.detectar(server), antiguo: true };
      throw e;
    }
    return { server, org: (j && j.org) || null, nombre: (j && j.nombre) || '', pruebas: !!(j && j.pruebas), version: j && j.version, modo: (j && j.modo) || 'cifrado', registroAbierto: !!(j && j.registroAbierto) };
  }
  /** Token de las peticiones: en modo servidor (1.4.0) la sesión del usuario; si no, el del espacio */
  async _token(meta) {
    if (meta.modo === 'servidor') {
      const t = this.h.sesion && this.h.sesion();
      if (!t) throw Object.assign(new AppError('Inicia sesión con conexión para sincronizar con el servidor central', 'sesion'), { status: 401 });
      return t;
    }
    return (await this.keys(meta)).token;
  }
  async _api(path, { method = 'GET', body, timeout } = {}) {
    const meta = await this.meta(); if (!meta) throw new AppError('El servidor central no está configurado en este dispositivo');
    return this._req(meta.server, '/org/' + encodeURIComponent(meta.org) + path, { method, body, token: await this._token(meta), timeout });
  }

  // ---------------- alta ----------------
  /** Primer dispositivo: crea el espacio central con el código de administración del servidor */
  async crear({ server, nombre, codigo, principal = true, admin = null, dev = '' }) {
    server = normServer(server);
    if (!server) throw new AppError('No hay servidor central configurado');
    const secret = randomBytes(32); const k = await orgKeys(secret);
    const org = 'org_' + b64url(randomBytes(12));
    // 1.4.0: con los datos del administrador el espacio nace en modo servidor (el servidor valida permisos)
    let adminBody = null;
    if (admin) { const salt = randomBytes(16); const d = await cuentaDerivar(admin.password, salt, this.cuentaIter || CUENTA_ITER); adminBody = { id: admin.id, usuario: admin.usuario, nombre: admin.nombre, pw: { salt: b64(salt), iter: this.cuentaIter || CUENTA_ITER, verif: d.verif } }; }
    const r = await this._req(server, '/org', { method: 'POST', body: { org, tokenHash: k.tokenHash, nombre: nombre || '', pruebas: !!this.h.pruebas, codigo, principal, ...(adminBody ? { modo: 'servidor', secret: b64(secret), admin: adminBody, dev } : {}) } });
    const meta = { server, org, secret: b64(secret), nombre: nombre || '', pruebas: !!this.h.pruebas, alta: now(), lastSeq: 0, creador: true, principal: !!(r && r.principal), modo: r && r.modo === 'servidor' ? 'servidor' : 'cifrado' };
    await this.h.repo.putDoc('central', meta); await this._saveDatos(VACIO()); this._k = null;
    return { ...meta, secretBytes: secret, sesion: (r && r.sesion) || null };
  }
  /** Acceso con cuenta desde un dispositivo nuevo: devuelve el secreto del espacio. 403 = credenciales incorrectas */
  async acceder({ server, org, usuario, password }) {
    server = normServer(server);
    const uid = await cuentaUid(org, usuario); const base = '/org/' + encodeURIComponent(org) + '/acceso';
    const s = await this._req(server, base + '/sal', { method: 'POST', body: { uid } });
    const d = await cuentaDerivar(password, unb64(s.salt), s.iter);
    const r = await this._req(server, base, { method: 'POST', body: { uid, prueba: b64(d.prueba), dev: this.h.device ? this.h.device().id : '' } });
    if (r.modo === 'servidor') return { server, org, secret: unb64(r.secret), nombre: r.nombre || '', pruebas: !!r.pruebas, modo: 'servidor', sesion: r.sesion, usuario: r.usuario };
    let o; try { o = await open(d.envKey, r.wrap); } catch { throw new AppError('No se pudo abrir la clave del servidor central'); }
    return { server, org, secret: unb64(o.s), nombre: r.nombre || '', pruebas: !!r.pruebas };
  }
  // ---------------- modo servidor (1.4.0): registro, activación con código y acceso con PIN ----------------
  /** Solicitud de cuenta desde el inicio de sesión (queda pendiente de aprobación). Incluye una prueba de trabajo. */
  async registrar({ server, org, usuario, nombre, password }) {
    server = normServer(server); const base = '/org/' + encodeURIComponent(org) + '/registro';
    const reto = await this._req(server, base + '/reto');
    const nonce = await resolverReto(reto.reto, reto.dificultad);
    const salt = randomBytes(16); const iter = this.cuentaIter || CUENTA_ITER; const d = await cuentaDerivar(password, salt, iter);
    return this._req(server, base, { method: 'POST', body: { usuario, nombre, salt: b64(salt), iter, verif: d.verif, ...reto, nonce } });
  }
  /** Primer acceso con el código de un solo uso: con PIN (credencial del dispositivo) o con contraseña nueva */
  async activar({ server, org, usuario, codigo, dev, devNombre, cred = null, password = null }) {
    server = normServer(server);
    const body = { usuario, codigo, dev, devNombre };
    if (cred) body.cred = cred;
    if (password) { const salt = randomBytes(16); const iter = this.cuentaIter || CUENTA_ITER; const d = await cuentaDerivar(password, salt, iter); body.pw = { salt: b64(salt), iter, verif: d.verif }; }
    const r = await this._req(server, '/org/' + encodeURIComponent(org) + '/activacion', { method: 'POST', body });
    return { server, org, secret: unb64(r.secret), nombre: r.nombre || '', pruebas: !!r.pruebas, modo: 'servidor', sesion: r.sesion, usuario: r.usuario };
  }
  /** Acceso con PIN: el PIN desbloquea en el dispositivo su credencial; el servidor comprueba la credencial */
  async accederDispositivo({ server, org, usuario, dev, cred }) {
    server = normServer(server);
    const r = await this._req(server, '/org/' + encodeURIComponent(org) + '/acceso/dispositivo', { method: 'POST', body: { uid: await cuentaUid(org, usuario), dev, cred } });
    return { server, org, secret: unb64(r.secret), modo: 'servidor', sesion: r.sesion, usuario: r.usuario };
  }
  /** Administración del espacio en modo servidor (permisos comprobados en el servidor) */
  admin(path, { method = 'GET', body } = {}) { return this._api('/admin/' + path, { method, body }); }
  yo() { return this._api('/yo'); }
  cerrarSesion() { return this._api('/sesion/cerrar', { method: 'POST', body: {} }).catch(() => null); }
  /** Migración 1.3.0 → 1.4.0: entrega la clave del espacio al servidor (exige el código de administración del servidor) */
  async migrar({ codigo, usuario }) {
    const meta = await this.meta(); if (!meta) throw new AppError('El servidor central no está configurado en este dispositivo');
    const k = await this.keys(meta);
    const r = await this._req(meta.server, '/org/' + encodeURIComponent(meta.org) + '/admin/migrar', { method: 'POST', token: k.token, body: { secret: meta.secret, codigo, usuario, dev: this.h.device ? this.h.device().id : '' }, timeout: 60000 });
    meta.modo = 'servidor'; await this.h.repo.putDoc('central', meta);
    return r;
  }
  /** Vincula este dispositivo al espacio con su secreto (obtenido con una cuenta o con un enlace de alta) */
  async unirConSecreto({ server, org, secret, nombre = '', pruebas = false, sesion = null }) {
    if (!!pruebas !== !!this.h.pruebas) throw new AppError(pruebas ? 'Ese espacio es del entorno de pruebas (CLAUDE_TEST): ábrelo en el entorno de pruebas' : 'Ese espacio es el real: no puede usarse en el entorno de pruebas');
    server = normServer(server);
    const k = await orgKeys(secret);
    const info = await this._req(server, '/org/' + encodeURIComponent(org), { token: sesion || k.token });
    const meta = { server, org, secret: b64(secret), nombre: info.nombre || nombre, pruebas: !!info.pruebas, alta: now(), lastSeq: 0, principal: !!info.principal, modo: info.modo === 'servidor' ? 'servidor' : 'cifrado' };
    await this.h.repo.putDoc('central', meta); await this._saveDatos(VACIO()); this._k = null;
    return meta;
  }
  /** Alta alternativa con el enlace o código generado por un dispositivo ya dado de alta */
  async unir(code) { const j = decodeAltaCode(code); return this.unirConSecreto(j); }
  /** Publica la cuenta de un usuario (al crearlo o cambiar su contraseña): queda en cola si no hay conexión */
  async guardarCuenta(usuario, password, iter = this.cuentaIter || CUENTA_ITER) {
    const meta = await this.meta(); if (!meta) throw new AppError('El servidor central no está configurado');
    const salt = randomBytes(16); const dd = await cuentaDerivar(password, salt, iter);
    const rec = { salt: b64(salt), iter, verif: dd.verif, wrap: await seal(dd.envKey, { s: meta.secret }) };
    const uid = await cuentaUid(meta.org, usuario);
    await this._conDatos(d => { d.pendCuentas[uid] = rec; }); this.kick();
  }
  /** Retira la cuenta del servidor (usuario desactivado o renombrado): ya no podrá entrar en dispositivos nuevos */
  async borrarCuenta(usuario) {
    const meta = await this.meta(); if (!meta) return;
    const uid = await cuentaUid(meta.org, usuario);
    await this._conDatos(d => { d.pendCuentas[uid] = null; }); this.kick();
  }
  async olvidar() { this.stop(); await this.h.repo.delDoc('central'); await this.h.repo.delDoc('central:datos'); this._k = null; this._set({ estado: 'sin_configurar', error: null }); }
  codigoAlta(meta) { return encodeAltaCode({ server: meta.server, org: meta.org, secret: unb64(meta.secret), nombre: meta.nombre, pruebas: meta.pruebas }); }

  // ---------------- datos compartidos ----------------
  /** Toda modificación de los datos del espacio pasa por aquí, de una en una: así ninguna se pierde
   *  aunque se hagan cambios mientras se sincroniza (antes, la sincronización guardaba una copia antigua). */
  _conDatos(fn) {
    const run = (this._mutex || Promise.resolve()).then(async () => { const d = await this.datos(); const r = await fn(d); await this._saveDatos(d); return r; });
    this._mutex = run.catch(() => { });
    return run;
  }
  async registrarPrev(pid, info) {
    await this._conDatos(d => { d.pendPrevs[pid] = info; d.registro[pid] = { ...(d.registro[pid] || {}), ...info, pid }; });
    this.kick();
  }
  /** Guarda un elemento de la configuración general; se envía con la versión en la que se basaba */
  async guardarConfig(id, data, { borrado = false } = {}) {
    const r = await this._conDatos(d => {
      const cur = d.items[id];
      const base = d.pendCfg[id] ? d.pendCfg[id].base : cur ? cur.v : 0;
      d.pendCfg[id] = { base, data, borrado, t: now() + Math.random() }; d.items[id] = { ...(cur || { v: 0 }), data, borrado, local: true };
      return d.items[id];
    });
    this.kick(); return r;
  }
  /** Resolver un conflicto de configuración: conservar la versión de este dispositivo o la del servidor */
  async resolverConfig(id, quedarse) {
    await this._conDatos(d => {
      const c = d.conflictos[id]; if (!c) return;
      if (quedarse === 'mio') d.pendCfg[id] = { base: c.v, data: c.mio, borrado: !!c.mioBorrado, t: now() + Math.random() };
      else { d.items[id] = { v: c.v, data: c.suyo, borrado: !!c.suyoBorrado }; delete d.pendCfg[id]; }
      delete d.conflictos[id];
    });
    this.kick();
  }

  // ---------------- sincronización ----------------
  /** Sincroniza ya. Si hay una en curso, espera a que termine y hace otra (las llamadas en cola se agrupan) */
  syncNow() {
    if (this._pend) return this._pend;
    const prev = this._cur || Promise.resolve();
    const p = prev.catch(() => { }).then(() => { this._pend = null; this._cur = p; return this._sync(); })
      .finally(() => { if (this._cur === p) this._cur = null; });
    this._pend = p; return p;
  }
  async _sync() {
    try {
      const meta = await this.meta();
      if (!meta) return this._set({ estado: 'sin_configurar' });
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return this._set({ estado: 'sin_conexion', server: meta.server });
      const bloqueo = this.h.bloqueo && this.h.bloqueo();
      if (bloqueo) return this._set({ estado: 'bloqueado', error: bloqueo, server: meta.server });
      this._set({ estado: 'sincronizando', server: meta.server });
      const k = await this.keys(meta); const tok = await this._token(meta); const base = '/org/' + encodeURIComponent(meta.org);
      // Modo servidor: los usuarios y perfiles los escribe el servidor (se gestionan desde la administración)
      if (meta.modo === 'servidor') await this._conDatos(d => { for (const id of Object.keys(d.pendCfg)) if (id.startsWith('usr:') || id === 'roles') delete d.pendCfg[id]; });
      const pend = await this.datos(); const cambiados = [];
      // 1. Enviar registros de preventivos, cuentas y configuración pendientes. Un pendiente solo se da por
      //    enviado si no ha cambiado mientras tanto (si cambió, se enviará la versión nueva en la siguiente vuelta).
      for (const [pid, info] of Object.entries(pend.pendPrevs)) {
        await this._req(meta.server, base + '/prevs/' + encodeURIComponent(pid), { method: 'PUT', token: tok, body: { w: await seal(k.key, { ...info, pid }) } });
        await this._conDatos(d => { if (stableStringify(d.pendPrevs[pid]) === stableStringify(info)) delete d.pendPrevs[pid]; });
      }
      for (const [uid, rec] of Object.entries(pend.pendCuentas || {})) {
        await this._req(meta.server, base + '/cuentas/' + uid, rec ? { method: 'PUT', token: tok, body: rec } : { method: 'DELETE', token: tok });
        await this._conDatos(d => { if (stableStringify(d.pendCuentas[uid]) === stableStringify(rec)) delete d.pendCuentas[uid]; });
      }
      for (const [id, p] of Object.entries(pend.pendCfg)) {
        const mismo = d => d.pendCfg[id] && d.pendCfg[id].t === p.t && stableStringify(d.pendCfg[id].data) === stableStringify(p.data);
        try {
          const r = await this._req(meta.server, base + '/config/' + encodeURIComponent(id), { method: 'PUT', token: tok, body: { base: p.base, c: await seal(k.key, { id, data: p.data }), borrado: !!p.borrado } });
          await this._conDatos(d => {
            if (mismo(d)) { d.items[id] = { v: r.v, data: p.data, borrado: !!p.borrado, sq: r.sq }; delete d.pendCfg[id]; cambiados.push(id); }
            else if (d.pendCfg[id]) d.pendCfg[id].base = r.v; // cambiado de nuevo: se envía después sobre esta versión
          });
        } catch (e) {
          if (e.status === 403 && meta.modo === 'servidor') {
            // Sin permiso en el servidor (p. ej. datos antiguos): se descarta y se vuelve a descargar la configuración
            await this._conDatos(d => { if (mismo(d)) delete d.pendCfg[id]; d.rechazos = { ...(d.rechazos || {}), [id]: { error: e.message, t: now() } }; });
            const m0 = await this.meta(); if (m0) { m0.lastSeq = 0; await this.h.repo.putDoc('central', m0); meta.lastSeq = 0; }
            this.h.onRechazoConfig && this.h.onRechazoConfig(id, e.message);
            continue;
          }
          if (e.status !== 409) throw e;
          const a = e.body && e.body.actual;
          const suyo = a ? (await open(k.key, a.c)).data : null;
          await this._conDatos(d => {
            if (!mismo(d)) return;
            // Si el otro dispositivo guardó exactamente lo mismo no hay conflicto real
            if (!(a && !!a.borrado === !!p.borrado && stableStringify(suyo) === stableStringify(p.data))) d.conflictos[id] = { v: a ? a.v : 0, mio: p.data, mioBorrado: !!p.borrado, suyo, suyoBorrado: a ? !!a.borrado : true, t: now() };
            if (a) { d.items[id] = { v: a.v, data: suyo, borrado: !!a.borrado, sq: a.sq }; cambiados.push(id); }
            delete d.pendCfg[id];
          });
        }
      }
      // 2. Recibir cambios de otros dispositivos
      const r = await this._req(meta.server, base + '/cambios?desde=' + (meta.lastSeq || 0), { token: tok });
      const regs = []; const cfgs = [];
      for (const x of r.prevs) { try { regs.push({ ...(await open(k.key, x.w)), pid: x.pid, sq: x.sq }); } catch { /* entrada de otra clave: se ignora */ } }
      for (const x of r.config) { try { cfgs.push({ id: x.id, v: x.v, data: (await open(k.key, x.c)).data, borrado: !!x.borrado, sq: x.sq }); } catch { } }
      const entradas = [];
      const resto = await this._conDatos(d => {
        for (const e of regs) { d.registro[e.pid] = e; entradas.push(e); }
        for (const x of cfgs) {
          if (d.pendCfg[x.id]) continue; // hay un cambio local en vuelo: se resolverá al enviarlo
          const { id, ...it } = x; d.items[id] = it; cambiados.push(id);
        }
        return { pend: Object.keys(d.pendPrevs).length + Object.keys(d.pendCfg).length + Object.keys(d.pendCuentas || {}).length, conflictos: Object.keys(d.conflictos).length };
      });
      const m2 = await this.meta(); if (m2 && m2.org === meta.org) { m2.lastSeq = r.last; m2.ultimo = now(); await this.h.repo.putDoc('central', m2); }
      if (entradas.length) await this.h.onPrevs(entradas);
      if (cambiados.length && this.h.onConfig) await this.h.onConfig([...new Set(cambiados)]);
      // 3. Latido (nombre, versión y última comunicación): cada minuto, o enseguida si cambian el nombre
      // del dispositivo o la versión (p. ej. al dar de alta el dispositivo con su nombre)
      const dev = this.h.device(); const firma = dev.id + '|' + (dev.nombre || '') + '|' + this.h.version;
      if (Date.now() - this._latido > 60000 || firma !== this._firmaLatido) {
        const ok = await this._req(meta.server, base + '/latido', { method: 'POST', token: tok, body: { dev: dev.id, nombre: dev.nombre || '', version: this.h.version } }).then(() => true, () => false);
        this._latido = Date.now(); if (ok) this._firmaLatido = firma;
      }
      return this._set({ estado: resto.pend ? 'pendiente' : 'conectado', ultimo: now(), error: null, conflictos: resto.conflictos });
    } catch (e) {
      // Modo servidor: sesión caducada o revocada (hay que volver a entrar) o cuenta que ya no está activa
      if (e.status === 401 && (e.code === 'sesion' || (e.body && e.body.codigo === 'sesion'))) {
        const m = await this.meta(); if (m && e.body && e.body.modo === 'servidor' && m.modo !== 'servidor') { m.modo = 'servidor'; await this.h.repo.putDoc('central', m); }
        this.h.onSesion && this.h.onSesion(e.message);
        return this._set({ estado: 'sesion', error: e.message, ultimoIntento: now() });
      }
      if (e.status === 403 && e.body && String(e.body.codigo || '').startsWith('cuenta_')) { if (this.h.onCuenta) await this.h.onCuenta(e.message); return this._set({ estado: 'cuenta', error: e.message, ultimoIntento: now() }); }
      return this._set({ estado: e.code === 'red' ? 'sin_conexion' : 'error', error: e.message, ultimoIntento: now() });
    }
  }
  async dispositivos() {
    const meta = await this.meta(); if (!meta) return {};
    return (await this._req(meta.server, '/org/' + encodeURIComponent(meta.org) + '/dispositivos', { token: await this._token(meta) })).dispositivos;
  }
  /** Estado de las actualizaciones del servidor central (lo pueden consultar los dispositivos del espacio) */
  async adminActualizaciones() {
    const meta = await this.meta(); if (!meta) throw new AppError('El servidor central no está configurado en este dispositivo');
    return this._req(meta.server, '/org/' + encodeURIComponent(meta.org) + '/admin/actualizaciones', { token: await this._token(meta) });
  }
  /** Estado del sistema (1.5.0): solo administradores; en el modo anterior, con el código de administración del servidor */
  async estadoSistema({ codigo = null } = {}) {
    const meta = await this.meta(); if (!meta) throw new AppError('El servidor central no está configurado en este dispositivo');
    return this._req(meta.server, '/org/' + encodeURIComponent(meta.org) + '/admin/estado', { method: 'POST', token: await this._token(meta), body: codigo ? { codigo } : {}, timeout: 20000 });
  }
  /** Acción sobre las actualizaciones del servidor: exige además el código de administración del servidor */
  async accionActualizaciones(body) {
    const meta = await this.meta(); if (!meta) throw new AppError('El servidor central no está configurado en este dispositivo');
    return this._req(meta.server, '/org/' + encodeURIComponent(meta.org) + '/admin/actualizaciones', { method: 'POST', token: await this._token(meta), body, timeout: 60000 });
  }
  start() {
    this.stop();
    const loop = async () => {
      const st = await this.syncNow();
      const wait = st.estado === 'sin_conexion' || st.estado === 'error' ? 15000 : this.intervalMs;
      if (this.timer) this.timer = setTimeout(loop, wait);
    };
    this.timer = setTimeout(loop, 50);
  }
  stop() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  kick() { if (!this.timer) return; clearTimeout(this._kickT); this._kickT = setTimeout(() => this.syncNow(), 300); }
}
