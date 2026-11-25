// Repositorio local cifrado: usuarios, sesiones, configuración, plantillas,
// operaciones de preventivos, archivos (planos), auditoría y copias de seguridad.
import { uid, now, b64, unb64, stableStringify, AppError, clone, base32, randomBytes } from '../core/util.js';
import * as K from '../core/crypto.js';
import { defaultGlobalConfig, SCHEMA_VERSION, APP_VERSION } from '../core/defaults.js';
import { defaultRoles, permsOf, PERM_KEYS, permisosEfectivos } from '../core/perms.js';
import { ESQUEMA_DATOS } from './migraciones.js';
import { cambioContenido, versionarPlantilla } from '../core/templates.js';

const LOCK_AFTER = 5;
const credV = u => (u && u.cred && u.cred.v) || 'v0';
// rx: hora de recepción en el servidor; sy: hora en que este dispositivo recibió la operación o su confirmación (1.5.0)
const META_FIELDS = ['num', 'ref', 'sq', 'ps', 'rx', 'sy'];

export class Repo {
  constructor(db) { this.db = db; this.dek = null; this.device = null; this.session = null; }

  // ---------------- dispositivo ----------------
  async init() {
    let d = await this.db.get('meta', 'device');
    if (!d) {
      d = { k: 'device', v: { id: 'dev_' + base32(randomBytes(8)).toLowerCase(), nombre: 'Dispositivo', code: base32(randomBytes(2)).slice(0, 2).replace(/[0-9]/g, c => 'ABCDEFGHJK'[c]), creado: now() } };
      await this.db.put('meta', d);
      await this.db.put('meta', { k: 'schema', v: ESQUEMA_DATOS }); // dispositivo nuevo: ya con el esquema actual
    }
    this.device = d.v;
    return this.device;
  }
  async saveDevice(patch) {
    if (patch.code != null) { patch.code = String(patch.code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4); if (!patch.code) throw new AppError('Código de dispositivo no válido'); }
    this.device = { ...this.device, ...patch };
    await this.db.put('meta', { k: 'device', v: this.device });
    await this.audit('Configuración del dispositivo', 'Dispositivo', '', JSON.stringify(patch));
  }
  async isSetup() { return (await this.db.count('users')) > 0; }

  // ---------------- cifrado ----------------
  async enc(obj) { if (!this.dek) throw new AppError('Sesión cerrada'); return K.encryptJSON(this.dek, obj); }
  async dec(rec) { if (!this.dek) throw new AppError('Sesión cerrada'); return K.decryptJSON(this.dek, rec); }
  async getDoc(id, def = null) { const r = await this.db.get('docs', id); return r ? this.dec(r.enc) : def; }
  async putDoc(id, data) { await this.db.put('docs', { id, enc: await this.enc(data) }); }
  async delDoc(id) { await this.db.del('docs', id); }

  // ---------------- alta inicial y sesiones ----------------
  async setup({ usuario, nombre, password }) {
    if (await this.isSetup()) throw new AppError('El sistema ya está configurado');
    validatePassword(password, this.minPassword);
    usuario = normUser(usuario); if (!usuario) throw new AppError('Indica un nombre de usuario');
    const dek = await K.genDek(); this.dek = dek;
    const recovery = K.newRecoveryCode();
    const recWrap = await K.wrapDek(dek, K.normalizeRecovery(recovery));
    await this.db.put('meta', { k: 'crypto', v: { recovery: recWrap, creado: now() } });
    const user = { id: uid('usr_'), usuario, nombre: String(nombre || usuario).trim(), rol: 'rol_admin', activo: true, creado: now(), fallos: 0, bloqueoHasta: 0, wrap: await K.wrapDek(dek, password) };
    await this.db.put('users', user);
    await this.putDoc('roles', defaultRoles());
    await this.putDoc('cfg', defaultGlobalConfig());
    await this._startSession(user);
    await this.audit('Configuración inicial', 'Sistema', '', 'Administrador ' + user.usuario + ' creado');
    return { recovery, user };
  }
  async listUsersPublic() { return (await this.db.getAll('users')).map(u => ({ id: u.id, usuario: u.usuario, nombre: u.nombre, activo: u.activo, pin: !!u.pinWrap })); }
  /** Errores con código: «no_existe» y «sin_clave_local» permiten intentarlo con la cuenta del servidor central */
  async login(usuario, password) {
    const users = await this.db.getAll('users');
    const u = users.find(x => x.usuario === normUser(usuario));
    if (!u) throw new AppError('Usuario o contraseña incorrectos', 'no_existe');
    if (!u.activo) throw new AppError('Usuario o contraseña incorrectos');
    if (u.bloqueoHasta > now()) throw new AppError('Demasiados intentos. Espera ' + Math.ceil((u.bloqueoHasta - now()) / 1000) + ' s.');
    if (!u.wrap) throw new AppError('Usuario o contraseña incorrectos', 'sin_clave_local');
    try { this.dek = await K.unwrapDek(u.wrap, password); }
    catch {
      u.fallos = (u.fallos || 0) + 1;
      if (u.fallos >= LOCK_AFTER) u.bloqueoHasta = now() + Math.min(15 * 60000, 30000 * 2 ** (u.fallos - LOCK_AFTER));
      await this.db.put('users', u);
      throw new AppError('Usuario o contraseña incorrectos', 'credenciales');
    }
    u.fallos = 0; u.bloqueoHasta = 0; u.ultimoAcceso = now();
    await this.db.put('users', u);
    await this._startSession(u);
    await this.audit('Inicio de sesión', 'Usuario ' + u.usuario, '', '');
    return this.session;
  }
  async _startSession(u) {
    const roles = await this.getRoles();
    const perfilId = u.perfil !== undefined ? u.perfil : u.rol;
    const rol = roles.find(r => r.id === perfilId);
    // Permisos efectivos: perfil + ajustes individuales (1.4.0); los usuarios anteriores solo tienen rol
    const datos = { rol: u.rol, perfil: perfilId, ajustes: u.ajustes || null, alcance: u.alcance || null, estado: u.estado || (u.activo === false ? 'desactivado' : 'activo') };
    this.session = { user: { id: u.id, nombre: u.nombre, usuario: u.usuario, rol: perfilId, rolNombre: rol ? rol.nombre : (perfilId ? '' : 'Sin perfil'), metodo: u.metodo || 'password', datos, perms: permisosEfectivos({ ...datos, id: u.id }, roles) }, inicio: now() };
    return this.session;
  }
  /** Permisos del usuario de la sesión dentro de un preventivo (alcance por preventivo) */
  async permisosEn(pid) {
    if (!this.session) return new Set();
    const roles = await this.getRoles();
    return permisosEfectivos({ ...this.session.user.datos, id: this.session.user.id }, roles, pid);
  }

  // ---------------- acceso con PIN (cuentas sin contraseña, 1.4.0) ----------------
  /** Guarda el acceso con PIN en este dispositivo: la clave de datos envuelta con el PIN y la credencial del dispositivo */
  async establecerPin(userId, pin, cred) {
    if (!/^\d{6,12}$/.test(String(pin || ''))) throw new AppError('El PIN debe tener entre 6 y 12 cifras');
    const u = await this.db.get('users', userId);
    if (!u || !this.dek) throw new AppError('Sesión cerrada');
    u.pinWrap = await K.wrapDek(this.dek, 'pin:' + pin); u.pinCred = await this.enc({ cred }); u.pinFallos = 0; u.metodo = 'pin';
    await this.db.put('users', u);
    await this.audit('Acceso con PIN configurado', 'Usuario ' + u.usuario, '', 'PIN válido solo en este dispositivo');
  }
  /** Entra con PIN. Tras 5 PIN erróneos seguidos se borra el acceso con PIN en este dispositivo (los datos se conservan). */
  async loginPin(usuario, pin) {
    const u = (await this.db.getAll('users')).find(x => x.usuario === normUser(usuario));
    if (!u || !u.activo) throw new AppError('Usuario o PIN incorrectos');
    if (!u.pinWrap) throw new AppError('Este usuario no tiene PIN en este dispositivo: actívalo con el código que te dio el administrador', 'sin_pin');
    try { this.dek = await K.unwrapDek(u.pinWrap, 'pin:' + pin); }
    catch {
      u.pinFallos = (u.pinFallos || 0) + 1;
      if (u.pinFallos >= LOCK_AFTER) {
        delete u.pinWrap; delete u.pinCred; u.pinFallos = 0; await this.db.put('users', u);
        throw new AppError('Demasiados PIN incorrectos: se ha retirado el acceso con PIN en este dispositivo. Pide un código nuevo al administrador.', 'pin_bloqueado');
      }
      await this.db.put('users', u);
      throw new AppError('PIN incorrecto (' + (LOCK_AFTER - u.pinFallos) + ' intento' + (LOCK_AFTER - u.pinFallos === 1 ? '' : 's') + ' más antes de bloquearlo)', 'credenciales');
    }
    u.pinFallos = 0; u.ultimoAcceso = now(); await this.db.put('users', u);
    await this._startSession(u);
    await this.audit('Inicio de sesión', 'Usuario ' + u.usuario, '', 'Con PIN');
    return { cred: u.pinCred ? (await this.dec(u.pinCred)).cred : null };
  }

  // ---------------- sesiones del servidor central (modo servidor) ----------------
  async sesionesCentral() { return this.dek ? (await this.getDoc('central:sesiones', {})) : {}; }
  async guardarSesionCentral(userId, token) { const s = await this.sesionesCentral(); if (token) s[userId] = { token, t: now() }; else delete s[userId]; await this.putDoc('central:sesiones', s); return s; }
  /** Operaciones rechazadas por el servidor: se quitan del dispositivo y quedan anotadas para consultarlas */
  async descartarOps(ids) { for (const id of ids) await this.db.del('ops', id); }
  async anotarRechazos(lista) { const r = (await this.getDoc('rechazos', [])).concat(lista).slice(-200); await this.putDoc('rechazos', r); return r; }
  async rechazos() { return this.getDoc('rechazos', []); }
  async marcarRechazosRevisados(por) { const t = Date.now(); const r = (await this.getDoc('rechazos', [])).map(x => (x.revisado ? x : { ...x, revisado: t, revisadoPor: por || '' })); await this.putDoc('rechazos', r); return r; }
  async refreshSession() { if (!this.session) return null; const u = await this.db.get('users', this.session.user.id); return u ? this._startSession(u) : null; }
  async verifyPassword(password) {
    const u = await this.db.get('users', this.session.user.id);
    try { await K.unwrapDek(u.wrap, password); return true; } catch { return false; }
  }
  async logout() { if (this.session) await this.audit('Cierre de sesión', 'Usuario ' + this.session.user.usuario, '', ''); this.session = null; this.dek = null; }

  // ---------------- servidor central: identidad común a todos los dispositivos ----------------
  /** Puntero no secreto al espacio central (dirección e identificador): permite comprobar una cuenta antes de abrir los datos */
  async centralPointer() { const r = await this.db.get('meta', 'central'); return r ? r.v : null; }
  async setCentralPointer(p) { if (p) await this.db.put('meta', { k: 'central', v: p }); else await this.db.del('meta', 'central'); }
  /** Guarda la clave de datos de este dispositivo envuelta con el secreto del espacio central */
  async setOrgWrap(secret) {
    if (!this.dek) throw new AppError('Sesión cerrada');
    const c = await this.db.get('meta', 'crypto');
    await this.db.put('meta', { k: 'crypto', v: { ...(c ? c.v : { recovery: null, creado: now() }), orgWrap: await K.wrapDekSecreto(this.dek, secret) } });
  }
  async clearOrgWrap() { const c = await this.db.get('meta', 'crypto'); if (c && c.v.orgWrap) { delete c.v.orgWrap; await this.db.put('meta', c); } }
  /** Dispositivo nuevo que entra con una cuenta del servidor central: clave de datos propia ligada al espacio */
  async setupCentral(secret) {
    if (await this.isSetup()) throw new AppError('El sistema ya está configurado');
    const dek = await K.genDek(); this.dek = dek;
    await this.db.put('meta', { k: 'crypto', v: { recovery: null, orgWrap: await K.wrapDekSecreto(dek, secret), creado: now() } });
    await this.putDoc('roles', defaultRoles());
    await this.putDoc('cfg', defaultGlobalConfig());
  }
  /** Abre los datos de este dispositivo con el secreto del espacio (cuenta ya comprobada en el servidor) */
  async unlockConSecreto(secret) {
    const c = await this.db.get('meta', 'crypto');
    if (!c || !c.v.orgWrap) throw new AppError('Este dispositivo no está vinculado al servidor central');
    try { this.dek = await K.unwrapDekSecreto(c.v.orgWrap, secret); } catch { throw new AppError('La cuenta pertenece a otro espacio central distinto del de este dispositivo'); }
  }
  async userByName(usuario) { return (await this.db.getAll('users')).find(x => x.usuario === normUser(usuario)) || null; }
  /** Primer acceso de un usuario en este dispositivo (o tras cambiar su contraseña en otro): guarda su clave local */
  async establecerClaveLocal(userId, password) {
    const u = await this.db.get('users', userId);
    if (!u || !u.activo) throw new AppError('Usuario o contraseña incorrectos');
    u.wrap = await K.wrapDek(this.dek, password); u.wrapV = credV(u); u.fallos = 0; u.bloqueoHasta = 0; u.ultimoAcceso = now();
    await this.db.put('users', u);
    await this._startSession(u);
    await this.audit('Inicio de sesión', 'Usuario ' + u.usuario, '', 'Primer acceso en este dispositivo con su cuenta del servidor central');
    return this.session;
  }
  /** Perfil común de un usuario (sin claves locales ni contadores) */
  perfil(u) { return { id: u.id, usuario: u.usuario, nombre: u.nombre, rol: u.rol, activo: u.activo !== false, creado: u.creado || 0, cred: { v: credV(u), central: !!(u.cred && u.cred.central) } }; }
  async perfiles() { return (await this.db.getAll('users')).map(u => this.perfil(u)); }
  /** Aplica un perfil recibido del servidor central. Devuelve el usuario local sustituido (mismo nombre, otro id) */
  async aplicarPerfil(p, { borrado = false } = {}) {
    const users = await this.db.getAll('users'); let sustituido = null;
    for (const x of users) if (x.usuario === normUser(p.usuario) && x.id !== p.id) { await this.db.del('users', x.id); sustituido = x; }
    const cur = users.find(x => x.id === p.id);
    const u = { fallos: 0, bloqueoHasta: 0, ...(cur || {}), id: p.id, usuario: normUser(p.usuario), nombre: p.nombre, rol: p.rol, activo: !borrado && p.activo !== false, creado: p.creado || now(), cred: { v: (p.cred && p.cred.v) || 'v0', central: !!(p.cred && p.cred.central) } };
    // Datos del directorio del servidor (1.4.0): estado, método de acceso, perfil, ajustes y alcance
    for (const k of ['estado', 'metodo', 'perfil', 'ajustes', 'alcance']) if (k in p) u[k] = p[k];
    if (borrado) u.estado = 'desactivado';
    if (u.wrap && (u.wrapV || 'v0') !== credV(u)) { delete u.wrap; delete u.wrapV; } // contraseña cambiada en otro dispositivo
    await this.db.put('users', u);
    return sustituido;
  }
  async marcarCuentaPublicada(userId) { const u = await this.db.get('users', userId); if (u) { u.cred = { v: credV(u), central: true }; await this.db.put('users', u); } return u; }

  /** Recupera el acceso con la clave de recuperación y fija una nueva contraseña */
  async recover(code, usuario, newPassword) {
    validatePassword(newPassword, this.minPassword);
    const c = await this.db.get('meta', 'crypto');
    if (!c || !c.v.recovery) throw new AppError('Este dispositivo usa las cuentas del servidor central: pide a un administrador que restablezca tu contraseña e inicia sesión con la nueva');
    let dek; try { dek = await K.unwrapDek(c.v.recovery, K.normalizeRecovery(code)); } catch { throw new AppError('Clave de recuperación incorrecta'); }
    const u = (await this.db.getAll('users')).find(x => x.usuario === normUser(usuario));
    if (!u) throw new AppError('Usuario no encontrado');
    u.wrap = await K.wrapDek(dek, newPassword); u.fallos = 0; u.bloqueoHasta = 0; u.activo = true;
    u.cred = { v: 'v' + uid(''), central: false }; u.wrapV = u.cred.v;
    await this.db.put('users', u);
    this.dek = dek; await this._startSession(u);
    await this.audit('Recuperación de acceso', 'Usuario ' + u.usuario, '', 'Contraseña restablecida con la clave de recuperación');
    return this.session;
  }

  // ---------------- usuarios y roles ----------------
  needAdmin() { if (!this.session || !this.session.user.perms.has('usuarios.admin')) throw new AppError('No tienes permiso para administrar usuarios y roles', 'permiso'); }
  async listUsers() { return (await this.db.getAll('users')).map(({ wrap, ...u }) => u); }
  async saveUser(data, password) {
    this.needAdmin();
    const users = await this.db.getAll('users');
    const usuario = normUser(data.usuario); if (!usuario) throw new AppError('Nombre de usuario obligatorio');
    if (users.some(u => u.usuario === usuario && u.id !== data.id)) throw new AppError('Ese nombre de usuario ya existe');
    const roles = await this.getRoles();
    if (!roles.some(r => r.id === data.rol)) throw new AppError('Rol no válido');
    let u = data.id ? users.find(x => x.id === data.id) : null;
    const before = u ? { usuario: u.usuario, nombre: u.nombre, rol: u.rol, activo: u.activo } : null;
    if (!u) { if (!password) throw new AppError('Indica una contraseña inicial'); u = { id: uid('usr_'), creado: now(), fallos: 0, bloqueoHasta: 0 }; }
    if (u.id === this.session.user.id && (data.rol !== u.rol || data.activo === false)) {
      const admins = users.filter(x => x.activo && x.rol === 'rol_admin' && x.id !== u.id);
      if (!admins.length) throw new AppError('Debe quedar al menos un administrador activo');
    }
    this.ultimoCambioUsuario = { usuarioAnterior: u.usuario && u.usuario !== usuario ? u.usuario : null };
    Object.assign(u, { usuario, nombre: String(data.nombre || usuario).trim(), rol: data.rol, activo: data.activo !== false });
    if (password) { validatePassword(password, this.minPassword); u.wrap = await K.wrapDek(this.dek, password); u.fallos = 0; u.bloqueoHasta = 0; u.cred = { v: 'v' + uid(''), central: false }; u.wrapV = u.cred.v; }
    await this.db.put('users', u);
    await this.audit(before ? 'Modificación de usuario' : 'Alta de usuario', 'Usuario ' + usuario, before ? JSON.stringify(before) : '', JSON.stringify({ usuario, nombre: u.nombre, rol: u.rol, activo: u.activo }) + (password ? ' (contraseña establecida)' : ''));
    return u.id;
  }
  async changeOwnPassword(oldPwd, newPwd) {
    if (!(await this.verifyPassword(oldPwd))) throw new AppError('La contraseña actual no es correcta');
    validatePassword(newPwd, this.minPassword);
    const u = await this.db.get('users', this.session.user.id);
    u.wrap = await K.wrapDek(this.dek, newPwd); u.cred = { v: 'v' + uid(''), central: false }; u.wrapV = u.cred.v; await this.db.put('users', u);
    await this.audit('Cambio de contraseña', 'Usuario ' + u.usuario, '', '');
  }
  async getRoles() {
    const roles = await this.getDoc('roles', defaultRoles());
    // Migración: el rol de sistema «Administrador» tiene siempre todos los permisos, también los nuevos
    const adm = roles.find(r => r.id === 'rol_admin' && r.sistema);
    if (adm) for (const k of PERM_KEYS) if (!adm.permisos.includes(k)) adm.permisos.push(k);
    return roles;
  }
  async saveRoles(roles) {
    this.needAdmin();
    const before = await this.getRoles();
    const admin = roles.find(r => r.id === 'rol_admin');
    if (!admin || !admin.permisos.includes('usuarios.admin')) throw new AppError('El rol Administrador debe conservar la administración de usuarios');
    const users = await this.db.getAll('users');
    for (const u of users) if (!roles.some(r => r.id === u.rol)) throw new AppError('El rol de ' + u.usuario + ' no puede eliminarse');
    await this.putDoc('roles', roles);
    await this.audit('Modificación de roles y permisos', 'Roles', summarizeRoles(before), summarizeRoles(roles));
    await this.refreshSession();
  }

  // ---------------- configuración global ----------------
  async getCfg() { const c = await this.getDoc('cfg', null); return { ...defaultGlobalConfig(), ...(c || {}) }; }
  async saveCfg(cfg, detalle = 'Configuración general') {
    const before = await this.getCfg();
    await this.putDoc('cfg', cfg);
    await this.audit('Modificación de configuración', detalle, diffKeys(before, cfg, 'o'), diffKeys(before, cfg, 'n'));
  }

  // ---------------- plantillas ----------------
  async listTemplates() {
    const docs = await this.db.getAll('docs'); const out = [];
    for (const d of docs) if (d.id.startsWith('tpl:')) out.push(await this.dec(d.enc));
    return out.sort((a, b) => (b.favorita - a.favorita) || a.nombre.localeCompare(b.nombre));
  }
  async getTemplate(id) { return this.getDoc('tpl:' + id); }

  // ---------------- informes guardados (1.5.0) ----------------
  /** Versiones del informe generadas en este dispositivo (el PDF se guarda cifrado como archivo interno) */
  async versionesInforme(pid) { return ((await this.getDoc('inf:' + pid)) || { versiones: [] }).versiones; }
  async guardarVersionInforme(pid, v) {
    const d = (await this.getDoc('inf:' + pid)) || { pid, versiones: [] };
    d.versiones.push(v); await this.putDoc('inf:' + pid, d);
    await this.audit('Informe generado', 'Preventivo ' + pid, '', 'versión ' + v.n + ' · SHA-256 ' + v.hash.slice(0, 16) + '…' + (v.provisional ? ' · provisional' : ''));
  }
  async saveTemplate(t, accion = 'Modificación de plantilla') {
    // Versiones (1.5.0): si cambia lo que crea la plantilla, la anterior se conserva tal cual
    const ant = await this.getTemplate(t.id); const por = this.session ? this.session.user.nombre : '';
    if (ant && cambioContenido(ant, t)) Object.assign(t, versionarPlantilla(ant, t, por));
    else if (!t.revision) { t.revision = (ant && ant.revision) || 1; t.revisiones = (ant && ant.revisiones) || []; }
    t.modificada = now(); if (por && !t.modificadaPor) t.modificadaPor = por;
    await this.putDoc('tpl:' + t.id, t);
    await this.audit(accion, 'Plantilla ' + t.nombre + ' (versión ' + t.revision + ')', '', '');
    return t;
  }
  async deleteTemplate(id) {
    const t = await this.getTemplate(id);
    await this.db.del('docs', 'tpl:' + id);
    await this.audit('Eliminación de plantilla', 'Plantilla ' + (t ? t.nombre : id), '', '');
  }

  // ---------------- preventivos ----------------
  async listSummaries() {
    const docs = await this.db.getAll('docs'); const out = [];
    for (const d of docs) if (d.id.startsWith('sum:')) out.push(await this.dec(d.enc));
    return out;
  }
  async saveSummary(pid, sum) { await this.putDoc('sum:' + pid, sum); }
  async getPrevMeta(pid) { return this.getDoc('pmeta:' + pid, {}); }
  async savePrevMeta(pid, meta) { await this.putDoc('pmeta:' + pid, meta); }

  _body(op) { const b = { ...op }; for (const k of META_FIELDS) delete b[k]; return b; }
  async _record(op, ps) {
    return { id: op.id, p: op.p, h: op.h, d: op.d, nn: !!op.nn, nl: !!op.nl, nr: !!op.nr, num: op.num ?? null, ref: op.ref ?? null, sq: op.sq ?? null, rx: op.rx ?? null, sy: op.sy ?? null, ps: ps ? 1 : 0, enc: await this.enc(this._body(op)) };
  }
  /** Guarda operaciones locales (asignación atómica de números) y devuelve las operaciones completas */
  async appendOps(pid, ops, { shared = false } = {}) {
    const recs = await Promise.all(ops.map(op => this._record(op, shared && op.sq == null)));
    await this.db.appendOps(pid, recs, this.device.code);
    recs.forEach((r, i) => { ops[i].num = r.num; ops[i].ref = r.ref; });
    return ops;
  }
  /** Guarda operaciones recibidas de otros dispositivos */
  async storeRemoteOps(pid, ops) {
    const recs = await Promise.all(ops.map(op => this._record(op, false)));
    await this.db.putMany('ops', recs);
  }
  async loadOps(pid) {
    const recs = await this.db.getAll('ops', 'p', pid);
    // Se descifran por lotes en paralelo: el cifrado del navegador trabaja fuera del hilo
    // principal y así un preventivo grande abre varias veces más rápido que de uno en uno
    const out = new Array(recs.length);
    for (let i = 0; i < recs.length; i += 512) {
      await Promise.all(recs.slice(i, i + 512).map(async (r, j) => {
        const op = await this.dec(r.enc);
        op.num = r.num; op.ref = r.ref || op.ref || null; op.sq = r.sq; op.rx = r.rx ?? null; op.sy = r.sy ?? null;
        out[i + j] = op;
      }));
    }
    return out;
  }
  async opMeta(id) { return this.db.get('ops', id); }
  /** Horas de cada operación sin descifrarla: servidor (rx), sincronización (sy), pendiente (ps) */
  async metaOps(pid) { return (await this.db.getAll('ops', 'p', pid)).map(r => ({ id: r.id, sq: r.sq ?? null, rx: r.rx ?? null, sy: r.sy ?? null, ps: !!r.ps })); }
  async pendingOps(pid) {
    const recs = await this.db.getAll('ops', 'pend', [pid, 1]);
    const out = [];
    for (const r of recs) { const op = await this.dec(r.enc); op.num = r.num; op.ref = r.ref; out.push(op); }
    return out.sort((a, b) => (a.h < b.h ? -1 : 1));
  }
  async countPending(pid) { return (await this.db.getAll('ops', 'pend', [pid, 1])).length; }
  async markSynced(results) {
    const recs = [];
    const t = now();
    for (const r of results) { const rec = await this.db.get('ops', r.id); if (!rec) continue; rec.sq = r.sq; if (r.num != null) rec.num = r.num; if (r.rx != null) rec.rx = r.rx; if (rec.ps || rec.sy == null) rec.sy = t; rec.ps = 0; recs.push(rec); }
    if (recs.length) await this.db.putMany('ops', recs);
  }
  async setOpServerMeta(id, sq, num, rx = null) {
    const rec = await this.db.get('ops', id); if (!rec) return false;
    let ch = false;
    if (rec.sq !== sq) { rec.sq = sq; ch = true; }
    if (num != null && rec.num !== num) { rec.num = num; ch = true; }
    if (rx != null && rec.rx !== rx) { rec.rx = rx; ch = true; }
    if (rec.ps) { rec.ps = 0; rec.sy = now(); ch = true; }
    if (ch) await this.db.put('ops', rec);
    return ch;
  }
  async markAllPending(pid) {
    const recs = (await this.db.getAll('ops', 'p', pid)).filter(r => r.d === this.device.id && r.sq == null);
    for (const r of recs) r.ps = 1;
    await this.db.putMany('ops', recs);
    return recs.length;
  }
  /** Recuperación del servidor: vuelve a enviar todo el registro (el servidor descarta duplicados) */
  async markAllForResend(pid) {
    const recs = await this.db.getAll('ops', 'p', pid);
    for (const r of recs) r.ps = 1;
    for (let i = 0; i < recs.length; i += 500) await this.db.putMany('ops', recs.slice(i, i + 500));
    return recs.length;
  }
  async maxCounter(pid, num) { const k = 'num:' + pid; const cur = (await this.db.get('meta', k)) || { k, v: 0 }; if (num > cur.v) { cur.v = num; await this.db.put('meta', cur); } }

  // ---------------- archivos (planos) ----------------
  async putBlob(bytes, meta = {}) {
    const id = 'blob_' + (await K.sha256hex(bytes)).slice(0, 40);
    if (!(await this.db.get('blobs', id))) await this.db.put('blobs', { id, mime: meta.mime || 'image/png', w: meta.w || 0, h: meta.h || 0, nombre: meta.nombre || '', size: bytes.length, enc: await K.encryptBytes(this.dek, bytes) });
    return id;
  }
  async getBlob(id) {
    const r = await this.db.get('blobs', id); if (!r) return null;
    return { ...r, enc: undefined, bytes: await K.decryptBytes(this.dek, r.enc) };
  }
  async hasBlob(id) { return !!(await this.db.get('blobs', id)); }

  // ---------------- auditoría del sistema ----------------
  async audit(accion, elemento, anterior, nuevo) {
    if (!this.dek) return;
    const e = { accion, elemento, anterior: String(anterior || ''), nuevo: String(nuevo || ''), usuario: this.session ? this.session.user.nombre : '', dispositivo: this.device ? this.device.nombre : '' };
    const t = now();
    await this.db.put('audit', { id: uid('aud_'), t, enc: await this.enc(e) });
  }
  async listAudit() {
    const recs = await this.db.getAll('audit'); const out = [];
    for (const r of recs) { try { out.push({ id: r.id, t: r.t, ...(await this.dec(r.enc)) }); } catch { out.push({ id: r.id, t: r.t, accion: 'Registro ilegible', elemento: '', anterior: '', nuevo: '', usuario: '' }); } }
    return out.sort((a, b) => b.t - a.t);
  }

  // ---------------- copias de seguridad ----------------
  async _collect({ blobs = false, dek = false } = {}) {
    const payload = {
      formato: 'uco-copia', version: SCHEMA_VERSION, app: APP_VERSION, creada: now(), dispositivo: { id: this.device.id, nombre: this.device.nombre },
      meta: (await this.db.getAll('meta')).filter(m => m.k !== 'device'),
      users: await this.db.getAll('users'),
      docs: [], ops: [], audit: [], blobs: [],
    };
    for (const d of await this.db.getAll('docs')) payload.docs.push({ id: d.id, data: await this.dec(d.enc) });
    for (const r of await this.db.getAll('ops')) { const { enc: e, ...m } = r; payload.ops.push({ ...m, body: await this.dec(e) }); }
    for (const a of await this.db.getAll('audit')) payload.audit.push({ id: a.id, t: a.t, data: await this.dec(a.enc) });
    if (blobs) for (const b of await this.db.getAll('blobs')) { const { enc: e, ...m } = b; payload.blobs.push({ ...m, data: b64(await K.decryptBytes(this.dek, e)) }); }
    if (dek) payload.dek = b64(await K.exportRaw(this.dek));
    payload.users = payload.users.map(u => ({ ...u, wrap: u.wrap ? { ...u.wrap, salt: b64(u.wrap.salt), iv: b64(u.wrap.iv), ct: b64(u.wrap.ct) } : null }));
    // La clave local envuelta con el secreto del espacio central no viaja en las copias
    payload.meta = payload.meta.map(m => (m.k === 'crypto' ? { k: 'crypto', v: { ...m.v, orgWrap: undefined, recovery: m.v.recovery ? { ...m.v.recovery, salt: b64(m.v.recovery.salt), iv: b64(m.v.recovery.iv), ct: b64(m.v.recovery.ct) } : null } } : m));
    payload.integridad = await K.sha256hex(stableStringify({ ...payload, integridad: undefined }));
    return payload;
  }
  async createBackup(tipo = 'manual', nota = '') {
    const p = await this._collect();
    const rec = { id: uid('bak_'), t: now(), tipo, nota, size: p.ops.length, integridad: p.integridad, enc: await this.enc(p) };
    await this.db.put('backups', rec);
    if (tipo === 'auto' || tipo === 'migracion') {
      const max = tipo === 'auto' ? (await this.getCfg()).copiasAutoMax || 20 : 5;
      const autos = (await this.db.getAll('backups')).filter(b => b.tipo === tipo).sort((a, b) => b.t - a.t);
      for (const old of autos.slice(max)) await this.db.del('backups', old.id);
    }
    if (tipo !== 'auto') await this.audit('Copia de seguridad', 'Copia ' + tipo, '', nota || '');
    return rec.id;
  }
  async listBackups() { return (await this.db.getAll('backups')).map(({ enc: e, ...b }) => b).sort((a, b) => b.t - a.t); }
  async deleteBackup(id) { await this.db.del('backups', id); await this.audit('Eliminación de copia de seguridad', id, '', ''); }
  async readBackup(id) {
    const r = await this.db.get('backups', id); if (!r) throw new AppError('Copia no encontrada');
    const p = await this.dec(r.enc);
    await verifyPayload(p);
    return p;
  }
  /** Archivo exportable. Con contraseña: cifrado e incluye la clave de datos (restauración completa en otro dispositivo). */
  async exportBackupFile(password) {
    const p = await this._collect({ blobs: true, dek: !!password });
    if (!password) { delete p.dek; p.users = p.users.map(u => ({ ...u, wrap: null })); p.integridad = await K.sha256hex(stableStringify({ ...p, integridad: undefined })); return JSON.stringify(p); }
    validatePassword(password);
    const salt = randomBytes(16);
    const key = await K.deriveKek(password, salt);
    const r = await K.encryptJSON(key, p);
    await this.audit('Exportación de copia completa', 'Sistema', '', 'Copia cifrada');
    return JSON.stringify({ formato: 'uco-copia-cifrada', version: SCHEMA_VERSION, creada: now(), salt: b64(salt), iter: K.PBKDF2_ITER, iv: b64(r.iv), ct: b64(r.ct) });
  }
  async parseBackupFile(text, password) {
    let obj; try { obj = JSON.parse(text); } catch { throw new AppError('El archivo no es una copia válida'); }
    if (obj.formato === 'uco-copia-cifrada') {
      if (!password) throw new AppError('La copia está cifrada: indica su contraseña', 'password');
      const key = await K.deriveKek(password, unb64(obj.salt), obj.iter);
      try { obj = await K.decryptJSON(key, { iv: unb64(obj.iv), ct: unb64(obj.ct) }); } catch { throw new AppError('Contraseña de la copia incorrecta'); }
    }
    if (obj.formato !== 'uco-copia') throw new AppError('El archivo no es una copia del Gestor UCO');
    await verifyPayload(obj);
    return obj;
  }
  /** Restaura una copia. modo: 'fusionar' (sin pérdidas) o 'reemplazar' (completa). */
  async restore(p, modo = 'fusionar') {
    const fresh = !(await this.isSetup());
    if (fresh) {
      // Dispositivo nuevo (sin configurar): solo restauración completa de una copia cifrada
      if (modo !== 'reemplazar' || !p.dek) throw new AppError('En un dispositivo sin configurar solo puede restaurarse una copia completa cifrada');
      this.dek = await K.importAes(unb64(p.dek), true);
    } else {
      await this.createBackup('previa', 'Antes de restaurar (' + modo + ')');
    }
    const stats = { ops: 0, docs: 0, blobs: 0 };
    if (modo === 'reemplazar') {
      if (p.dek && !fresh) {
        // Se adopta la clave de datos de la copia: las copias locales se vuelven a cifrar con ella
        const old = [];
        for (const b of await this.db.getAll('backups')) { try { old.push({ ...b, data: await this.dec(b.enc) }); } catch { /* ilegible: se descarta */ } }
        this.dek = await K.importAes(unb64(p.dek), true);
        for (const b of old) { const { data, ...m } = b; await this.db.put('backups', { ...m, enc: await this.enc(data) }); }
      }
      if (!p.dek && !p.users.every(u => u.wrap)) throw new AppError('Esta copia no permite restauración completa. Usa "fusionar".');
      await this.db.clear(['users', 'docs', 'ops', 'blobs', 'audit']);
      for (const m of p.meta) if (m.k !== 'device') await this.db.put('meta', m.k === 'crypto' ? { k: 'crypto', v: { ...m.v, recovery: unwrapB64(m.v.recovery) } } : m);
      await this.db.putMany('users', p.users.map(u => ({ ...u, wrap: unwrapB64(u.wrap) })));
    }
    const existing = new Set((await this.db.getAll('ops')).map(r => r.id));
    const recs = [];
    for (const o of p.ops) {
      if (existing.has(o.id)) continue;
      const { body, ...m } = o;
      recs.push({ ...m, ps: m.d === this.device.id ? m.ps || 0 : 0, enc: await this.enc(body) });
    }
    for (let i = 0; i < recs.length; i += 500) await this.db.putMany('ops', recs.slice(i, i + 500));
    stats.ops = recs.length;
    for (const d of p.docs) {
      const cur = await this.db.get('docs', d.id);
      if (cur && modo !== 'reemplazar') {
        if (d.id.startsWith('tpl:')) { const c = await this.dec(cur.enc); if ((d.data.modificada || 0) <= (c.modificada || 0)) continue; }
        else if (!d.id.startsWith('sum:')) continue;
      }
      await this.putDoc(d.id, d.data); stats.docs++;
    }
    for (const b of p.blobs || []) if (!(await this.db.get('blobs', b.id))) { const { data, ...m } = b; await this.db.put('blobs', { ...m, enc: await K.encryptBytes(this.dek, unb64(data)) }); stats.blobs++; }
    const auds = new Set((await this.db.getAll('audit')).map(a => a.id));
    for (const a of p.audit) if (!auds.has(a.id)) await this.db.put('audit', { id: a.id, t: a.t, enc: await this.enc(a.data) });
    for (const m of p.meta) if (/^(num|ref):/.test(m.k)) { const cur = await this.db.get('meta', m.k); if (!cur || cur.v < m.v) await this.db.put('meta', m); }
    // Vinculación con el servidor central: se rehace con el secreto restaurado (o se retira si ya no hay)
    const cen = await this.getDoc('central');
    if (cen && cen.secret) { await this.setOrgWrap(unb64(cen.secret)); await this.setCentralPointer({ server: cen.server, org: cen.org, pruebas: !!cen.pruebas, nombre: cen.nombre || '' }); }
    else if (modo === 'reemplazar') { await this.setCentralPointer(null); await this.clearOrgWrap(); }
    await this.audit('Restauración de copia', 'Sistema', '', modo + ': ' + stats.ops + ' operaciones, ' + stats.docs + ' documentos, ' + stats.blobs + ' archivos');
    return stats;
  }
  /** Verificación de integridad de la base de datos local */
  async verify() {
    const r = { ops: 0, opsMal: 0, docs: 0, docsMal: 0, blobs: 0, blobsMal: 0, copias: 0, copiasMal: 0, planosFaltan: [] };
    for (const o of await this.db.getAll('ops')) { r.ops++; try { await this.dec(o.enc); } catch { r.opsMal++; } }
    for (const d of await this.db.getAll('docs')) { r.docs++; try { await this.dec(d.enc); } catch { r.docsMal++; } }
    for (const b of await this.db.getAll('blobs')) { r.blobs++; try { await K.decryptBytes(this.dek, b.enc); } catch { r.blobsMal++; } }
    for (const b of await this.db.getAll('backups')) { r.copias++; try { await verifyPayload(await this.dec(b.enc)); } catch { r.copiasMal++; } }
    r.ok = !r.opsMal && !r.docsMal && !r.blobsMal && !r.copiasMal;
    await this.audit('Verificación de integridad', 'Sistema', '', r.ok ? 'Correcta' : 'Con errores');
    return r;
  }
}

async function verifyPayload(p) {
  const h = await K.sha256hex(stableStringify({ ...p, integridad: undefined }));
  if (h !== p.integridad) throw new AppError('La copia está dañada o ha sido modificada (integridad no válida)');
}
function unwrapB64(w) { return w ? { ...w, salt: typeof w.salt === 'string' ? unb64(w.salt) : w.salt, iv: typeof w.iv === 'string' ? unb64(w.iv) : w.iv, ct: typeof w.ct === 'string' ? unb64(w.ct) : w.ct } : null; }
/** Con servidor central (acceso público por Internet) se exigen al menos 8 caracteres */
export function validatePassword(p, min = 6) {
  if (String(p || '').length < min) throw new AppError('La contraseña debe tener al menos ' + min + ' caracteres');
}
function normUser(u) { return String(u || '').trim().toLowerCase().replace(/\s+/g, '.'); }
function summarizeRoles(roles) { return roles.map(r => r.nombre + ' (' + r.permisos.length + ' permisos)').join(', '); }
function diffKeys(a, b, side) {
  const out = [];
  for (const k of new Set([...Object.keys(a || {}), ...Object.keys(b || {})])) {
    if (stableStringify(a[k]) !== stableStringify(b[k])) out.push(k + ': ' + short(side === 'o' ? a[k] : b[k]));
  }
  return out.join(' | ');
}
function short(v) { const s = typeof v === 'object' ? JSON.stringify(v) : String(v); return s.length > 80 ? s.slice(0, 77) + '…' : s; }
export { clone };
