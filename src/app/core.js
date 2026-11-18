// Núcleo de la aplicación: une repositorio cifrado, motor de preventivos,
// comandos de negocio y sincronización. La interfaz solo habla con esta capa.
import { Repo } from '../data/repo.js';
import { SyncManager, newSecret, decodeJoinCode, encodeJoinCode, normServer } from '../data/sync.js';
import { CentralSync } from '../data/central.js';
import { APP_VERSION } from '../core/defaults.js';
import { SERVIDOR_CENTRAL } from '../config/servidor.js';
import { Engine } from '../core/engine.js';
import { HLC } from '../core/hlc.js';
import * as C from '../core/commands.js';
import { uid, now, b64, unb64, AppError, clone } from '../core/util.js';
import { contentFromPrev, seedFromTemplate, newTemplate, contentFromConfig } from '../core/templates.js';
import { counts } from '../core/engine.js';

export class AppCore {
  /** opciones: pruebas (entorno CLAUDE_TEST) y servidor (dirección del servidor central; por defecto la
   *  preconfigurada en el navegador y ninguna fuera de él, para que las pruebas nunca toquen el real) */
  constructor(storage, { pruebas = false, servidor } = {}) {
    this.storage = storage; this.pruebas = pruebas;
    this.servidorFijo = servidor !== undefined ? servidor : typeof window !== 'undefined' ? SERVIDOR_CENTRAL : null;
    this.repo = new Repo(storage);
    this.engines = new Map(); this.metas = new Map(); this.cur = null; this.listeners = new Set(); this.dirty = false;
    this.sync = new SyncManager({
      repo: this.repo,
      onRemoteOps: (pid, ops) => this._remote(pid, ops),
      onNumber: (pid, id, num) => this._number(pid, id, num),
      getPlano: pid => { const e = this.engines.get(pid); return e && e.state.prev ? e.state.prev.plano : null; },
      onStatus: (pid, s) => this.emit('sync', { pid, s }),
      onBlob: pid => this.emit('change', { pid }),
    });
    this.central = new CentralSync({
      repo: this.repo, version: APP_VERSION, pruebas,
      device: () => ({ id: this.device.id, nombre: this.device.nombre }),
      onPrevs: entries => this._centralPrevs(entries),
      onConfig: ids => this._centralConfig(ids),
      onStatus: st => this.emit('central', { st }),
    });
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) { try { fn(type, data); } catch (e) { console.error(e); } } }

  // ------------- arranque y sesión -------------
  async boot() {
    await this.repo.init();
    this.hlc = new HLC(this.device.id);
    const h = await this.storage.get('meta', 'hlc'); if (h && h.v) this.hlc.recv(h.v);
    try {
      if (typeof BroadcastChannel !== 'undefined') {
        this.bc = new BroadcastChannel('uco-gestor');
        this.bc.onmessage = e => this._otherTab(e.data);
      }
    } catch { this.bc = null; }
    return { device: this.device, setup: await this.repo.isSetup() };
  }
  get session() { return this.repo.session; }
  /** Dispositivo actual (siempre el del repositorio: nombre y código al día) */
  get device() { return this.repo.device; }
  get user() { return this.repo.session ? this.repo.session.user : null; }
  can(p) { return !!(this.user && this.user.perms.has(p)); }
  async setup(data) { const r = await this.repo.setup(data); await this._afterLogin(); return r; }
  async recover(code, u, p) { await this.repo.recover(code, u, p); await this._afterLogin(); }
  async _afterLogin() {
    this.cfg = await this.repo.getCfg();
    this.sync.intervalMs = Math.max(2, Number(this.cfg.syncIntervaloSeg) || 5) * 1000;
    this.summaries = await this.repo.listSummaries();
    clearInterval(this._bk);
    this._bk = setInterval(() => this.autoBackup(), Math.max(1, Number(this.cfg.copiaAutoMin) || 10) * 60000);
    this.centralMeta = await this.central.meta();
    this.repo.minPassword = this.centralMeta || this.centralRemoto ? 8 : 6;
    if (this.centralMeta) { this.central.start(); this.centralDisponibles().then(x => { this.centralDisp = x; this.emit('central', {}); }).catch(() => { }); }
    this.emit('session', {});
    if (!this.centralMeta) this.consultarCentral(); // ¿hay un espacio central al que conectar este dispositivo?
  }
  async logout() {
    await this.autoBackup();
    this.sync.stopAll(); this.central.stop(); clearInterval(this._bk);
    this.engines.clear(); this.metas.clear(); this.cur = null;
    await this.repo.logout(); this.emit('session', {});
  }
  async autoBackup(force = false) {
    if (!this.repo.dek || (!this.dirty && !force)) return null;
    this.dirty = false;
    try { return await this.repo.createBackup('auto', 'Copia automática'); } catch (e) { console.warn('Copia automática fallida', e); return null; }
  }
  async saveCfg(cfg, detalle) {
    if (!this.can('config.editar')) throw new AppError('No tienes permiso para editar la configuración', 'permiso');
    await this.repo.saveCfg(cfg, detalle); this.cfg = await this.repo.getCfg();
    this.sync.intervalMs = Math.max(2, Number(this.cfg.syncIntervaloSeg) || 5) * 1000;
    this.emit('cfg', {});
  }

  // ------------- preventivos -------------
  engine(pid = this.cur) { return this.engines.get(pid) || null; }
  get state() { const e = this.engine(); return e ? e.state : null; }
  meta(pid = this.cur) { return this.metas.get(pid) || {}; }
  isShared(pid = this.cur) { return this.meta(pid).modalidad === 'compartida'; }
  ctxFor(pid, engine) {
    return { engine: engine || this.engine(pid), user: this.user, device: this.device, hlc: this.hlc, pid, mode: this.isShared(pid) ? 'compartida' : 'independiente' };
  }
  async loadEngine(pid) {
    const ops = await this.repo.loadOps(pid);
    for (const op of ops) this.hlc.recv(op.h);
    const e = new Engine(ops); this.engines.set(pid, e);
    this.metas.set(pid, await this.repo.getPrevMeta(pid));
    return e;
  }
  async openPrev(pid) {
    if (this.cur && this.cur !== pid) this.sync.stop(this.cur);
    const e = await this.loadEngine(pid);
    if (!e.state.prev) throw new AppError('El preventivo todavía no tiene datos en este dispositivo');
    this.cur = pid;
    if (this.isShared(pid)) this.sync.start(pid);
    this.emit('prev', { pid });
    return e;
  }
  closePrev() { if (this.cur) this.sync.stop(this.cur); this.cur = null; this.emit('prev', { pid: null }); }

  /** Ejecuta un comando de negocio: valida, guarda de forma atómica y aplica */
  async exec(fn, ...args) {
    const pid = this.cur; const engine = this.engine(pid);
    if (!engine) throw new AppError('No hay preventivo abierto');
    return this._commit(pid, engine, fn(this.ctxFor(pid), ...args));
  }
  /** Ejecuta un comando sobre un preventivo que no está abierto (archivar, duplicar…) */
  async execOn(pid, fn, ...args) {
    const e = this.engines.get(pid) || await this.loadEngine(pid);
    return this._commit(pid, e, fn(this.ctxFor(pid, e), ...args));
  }
  async _commit(pid, engine, ops) {
    if (!ops || !ops.length) return [];
    const r = engine.dryRun(ops);
    if (!r.ok) throw new AppError(r.reason, 'regla');
    await this.repo.appendOps(pid, ops, { shared: this.isShared(pid) });
    engine.add(ops);
    this.storage.put('meta', { k: 'hlc', v: ops[ops.length - 1].h }).catch(() => { });
    await this._summary(pid);
    this.dirty = true;
    if (this.isShared(pid)) this.sync.kick(pid);
    try { this.bc && this.bc.postMessage({ pid, dev: this.device.id }); } catch { }
    this.emit('change', { pid });
    return ops;
  }
  async _summary(pid) {
    const e = this.engine(pid); if (!e || !e.state.prev) return;
    const s = e.state; const p = s.prev; const c = counts(s, now());
    const sum = { id: pid, nombre: p.nombre, fecha: p.fecha, horaInicio: p.horaInicio, horaFin: p.horaFin, estado: p.estado, archivado: !!p.archivado, modalidad: p.modalidad, unidades: c.total, avisos: Object.keys(s.avisos).length, activos: c.activos + c.pendientes, actualizado: s.lastT, creado: p.creado, origen: p.origen || null, conflictos: e.pendingConflicts().length };
    await this.repo.saveSummary(pid, sum);
    const i = (this.summaries || []).findIndex(x => x.id === pid);
    if (i >= 0) this.summaries[i] = sum; else (this.summaries = this.summaries || []).push(sum);
    const m = this.meta(pid);
    if (m.central && this.centralMeta && m.central === this.centralMeta.org && (m.regNombre !== sum.nombre || m.regEstado !== sum.estado || !!m.regArchivado !== sum.archivado)) await this._registrarCentral(pid);
  }
  async refreshSummaries() { this.summaries = await this.repo.listSummaries(); return this.summaries; }

  // ------------- servidor central -------------
  /** Dirección del servidor central: la del propio servidor si la app se abre desde él; si no, la
   *  preconfigurada. Solo en el entorno de pruebas puede indicarse otra con ?servidor=. */
  servidorCentral() {
    if (this.centralMeta) return this.centralMeta.server;
    if (this.centralDetectado) return this.centralDetectado;
    return this.servidorFijo ? normServer(this.servidorFijo) : '';
  }
  /** ¿Se sirve la app desde el propio servidor central? (se comprueba una vez) */
  _detectarOrigen() {
    if (!this._origenP) this._origenP = (async () => {
      try {
        if (this.servidorFijo === false || typeof location === 'undefined' || !/^https?:$/.test(location.protocol) || /github\.io$/.test(location.hostname)) return null;
        const v = await this.central.detectar(location.origin);
        this.centralDetectado = v ? normServer(location.origin) : null;
      } catch { this.centralDetectado = null; }
      return this.centralDetectado;
    })();
    return this._origenP;
  }
  /** Espacio central disponible en el servidor: { org, nombre } (org null = sin activar) o null sin conexión */
  async consultarCentral() {
    await this._detectarOrigen();
    const srv = this.servidorCentral();
    try { this.centralRemoto = srv ? await this.central.consultar(srv) : null; }
    catch { this.centralRemoto = null; }
    this.centralConsultado = true;
    if (this.centralRemoto) this.repo.minPassword = 8;
    this.emit('central', {});
    return this.centralRemoto;
  }
  centralEstado() { return { meta: this.centralMeta, st: this.central.status(), remoto: this.centralRemoto || null, consultado: !!this.centralConsultado, servidor: this.servidorCentral() }; }
  /** Longitud mínima de contraseña: 8 con servidor central (acceso por Internet) */
  minPassword() { return this.repo.minPassword || 6; }
  _needCentral() { if (!this.can('central.gestionar')) throw new AppError('No tienes permiso para configurar el servidor central', 'permiso'); }
  async _acceder(server, org, usuario, password) {
    try { return await this.central.acceder({ server, org, usuario, password }); }
    catch (e) {
      if (e.status === 403) throw new AppError('Usuario o contraseña incorrectos', 'credenciales');
      if (e.status === 429) throw new AppError('Demasiados intentos fallidos con este usuario: espera 15 minutos');
      if (e.code === 'red') throw new AppError('Sin conexión con el servidor central: el primer acceso de un usuario en un dispositivo necesita conexión', 'red');
      throw e;
    }
  }
  /** Vincula el dispositivo al espacio: secreto cifrado, puntero no secreto y clave local envuelta */
  async _vincular({ server, org, secret, nombre, pruebas }) {
    this.centralMeta = await this.central.unirConSecreto({ server, org, secret, nombre, pruebas });
    await this.repo.setOrgWrap(secret);
    await this.repo.setCentralPointer({ server: this.centralMeta.server, org, pruebas: !!this.centralMeta.pruebas, nombre: this.centralMeta.nombre });
    this.repo.minPassword = 8;
  }
  async _descargarCentral() {
    const st = await this.central.syncNow();
    if (st.estado !== 'conectado' && st.estado !== 'pendiente') throw new AppError('No se pudo descargar la configuración del servidor central' + (st.error ? ': ' + st.error : ''));
    return st;
  }
  /** Dispositivo nuevo: entra con su cuenta del servidor central, sin configurar nada más */
  async accederCentral(usuario, password, { dispositivo } = {}) {
    const c = this.centralRemoto && this.centralRemoto.org ? this.centralRemoto : await this.consultarCentral();
    if (!c) throw new AppError('Sin conexión con el servidor central. Comprueba la conexión a Internet e inténtalo de nuevo.');
    if (!c.org) throw new AppError('El servidor central aún no está activado: un administrador debe activarlo una vez');
    const acc = await this._acceder(c.server, c.org, usuario, password);
    await this.repo.setupCentral(acc.secret);
    await this._vincular(acc);
    await this._descargarCentral();
    const u = await this.repo.userByName(usuario);
    if (!u || !u.activo) throw new AppError('Tu usuario no está activo en el servidor central');
    if (dispositivo || this.device.nombre === 'Dispositivo') await this.repo.saveDevice({ nombre: dispositivo || 'Dispositivo de ' + u.nombre });
    await this.repo.establecerClaveLocal(u.id, password);
    await this._afterLogin();
  }
  /** Inicio de sesión. Sin clave local para ese usuario (primer acceso aquí, usuario nuevo o contraseña
   *  cambiada en otro dispositivo) se comprueba su cuenta en el servidor central. */
  async login(u, p) {
    try { await this.repo.login(u, p); }
    catch (e) {
      if (!['no_existe', 'sin_clave_local', 'credenciales'].includes(e.code)) throw e;
      const ptr = await this.repo.centralPointer(); if (!ptr) throw e;
      let acc;
      try { acc = await this._acceder(ptr.server, ptr.org, u, p); }
      catch (err) { if (err.code === 'credenciales' || (err.code === 'red' && e.code === 'credenciales')) throw e; throw err; }
      await this.repo.unlockConSecreto(acc.secret);
      this.centralMeta = await this.central.meta();
      if (this.centralMeta) await this.central.syncNow(); // perfiles al día (usuario nuevo o contraseña cambiada)
      const usr = await this.repo.userByName(u);
      if (!usr || !usr.activo) { this.repo.dek = null; throw new AppError('Usuario o contraseña incorrectos'); }
      await this.repo.establecerClaveLocal(usr.id, p);
      await this._afterLogin();
      return;
    }
    await this._afterLogin();
    this._provisionarCuenta(p).catch(err => console.warn('Cuenta central no publicada', err));
  }
  /** Publica la cuenta del usuario que acaba de entrar si aún no lo estaba (usuarios anteriores al servidor central) */
  async _provisionarCuenta(password) {
    if (!this.centralMeta || !this.user || String(password).length < 8) return;
    const u = await this.repo.db.get('users', this.user.id);
    if (!u || (u.cred && u.cred.central)) return;
    await this.central.guardarCuenta(u.usuario, password);
    const u2 = await this.repo.marcarCuentaPublicada(u.id);
    await this.central.guardarConfig('usr:' + u.id, this.repo.perfil(u2));
  }
  /** Primera vez: activa el servidor central (una sola vez, con el código de administración del servidor) */
  async centralActivar({ codigo, password, nombre = 'Gestor de Emergencias UCO' }) {
    this._needCentral();
    if (!(await this.repo.verifyPassword(password))) throw new AppError('Tu contraseña no es correcta');
    if (String(password).length < 8) throw new AppError('Para activar el servidor central tu contraseña debe tener al menos 8 caracteres: cámbiala antes en Sistema → Mi cuenta');
    const c = await this.consultarCentral();
    if (!c) throw new AppError('Sin conexión con el servidor central');
    if (c.org) throw new AppError('El servidor central ya está activado: conecta este dispositivo con tu usuario y contraseña');
    const m = await this.central.crear({ server: c.server, nombre, codigo, principal: true });
    await this.repo.setOrgWrap(m.secretBytes);
    await this.repo.setCentralPointer({ server: m.server, org: m.org, pruebas: m.pruebas, nombre: m.nombre });
    this.centralMeta = await this.central.meta(); this.repo.minPassword = 8;
    await this._publicarDirectorio();
    await this.central.guardarCuenta(this.user.usuario, password);
    const u = await this.repo.marcarCuentaPublicada(this.user.id);
    await this.central.guardarConfig('usr:' + u.id, this.repo.perfil(u));
    const n = await this._centralRegistrarLocales();
    await this.repo.audit('Servidor central activado', 'Espacio central creado en ' + m.server, '', (m.nombre || '') + (n ? ' · ' + n + ' preventivo(s) compartido(s) publicados' : ''));
    this.central.start(); await this.central.syncNow(); this.emit('central', {});
    return this.centralMeta;
  }
  /** Conecta este dispositivo (ya en uso) con el espacio central usando una cuenta del servidor */
  async centralConectar({ usuario, password }) {
    if (!this.user) throw new AppError('Sesión cerrada');
    const c = await this.consultarCentral();
    if (!c) throw new AppError('Sin conexión con el servidor central');
    if (!c.org) throw new AppError('El servidor central aún no está activado');
    const acc = await this._acceder(c.server, c.org, usuario, password);
    const rolesLocales = await this.repo.getRoles();
    await this._vincular(acc);
    await this._descargarCentral();
    // La sesión pasa a la cuenta común del usuario que ha conectado
    const u = await this.repo.userByName(usuario);
    if (!u || !u.activo) throw new AppError('Tu usuario no está activo en el servidor central');
    await this.repo.establecerClaveLocal(u.id, password);
    const d = await this.central.datos();
    if (this.can('usuarios.admin')) {
      // Roles propios de este dispositivo que no existían en el espacio: se añaden
      const cen = (d.items.roles && d.items.roles.data) || null;
      if (!cen) await this.central.guardarConfig('roles', rolesLocales);
      else {
        const ids = new Set(cen.map(r => r.id)); const extra = rolesLocales.filter(r => !ids.has(r.id));
        if (extra.length) { const merged = [...cen, ...extra]; await this.repo.putDoc('roles', merged); await this.central.guardarConfig('roles', merged); }
      }
      await this._publicarDirectorio({ soloNuevos: true });
    } else {
      // Sin permiso para administrar usuarios, los usuarios solo locales de este dispositivo se desactivan
      for (const x of await this.repo.db.getAll('users')) if (!d.items['usr:' + x.id] && x.activo) { x.activo = false; await this.repo.db.put('users', x); }
    }
    const n = await this._centralRegistrarLocales();
    await this.repo.audit('Dispositivo conectado al servidor central', 'Conectado a ' + this.centralMeta.server + ' con el usuario ' + u.usuario, '', n ? n + ' preventivo(s) compartido(s) publicados' : '');
    this.central.start(); this.emit('central', {}); this.emit('session', {});
    return this.centralMeta;
  }
  async centralOlvidar() {
    this._needCentral();
    const s = this.centralMeta && this.centralMeta.server;
    await this.central.olvidar(); this.centralMeta = null;
    await this.repo.setCentralPointer(null); await this.repo.clearOrgWrap();
    await this.repo.audit('Baja del servidor central', 'Este dispositivo deja de usar ' + (s || 'el servidor central') + '. Los datos locales se conservan.');
    this.emit('central', {});
  }
  /** Publica usuarios (perfiles, sin claves) y roles de este dispositivo en el espacio central */
  async _publicarDirectorio({ soloNuevos = false } = {}) {
    const d = await this.central.datos();
    if (!soloNuevos || !d.items.roles) await this.central.guardarConfig('roles', await this.repo.getRoles());
    for (const p of await this.repo.perfiles()) {
      if (soloNuevos && d.items['usr:' + p.id]) continue;
      await this.central.guardarConfig('usr:' + p.id, p);
    }
  }
  /** Aplica cambios de configuración recibidos del espacio central (usuarios, roles…) */
  async _centralConfig(ids) {
    const d = await this.central.datos(); let usuarios = false;
    for (const id of ids) {
      const it = d.items[id]; if (!it) continue;
      if (id === 'roles') { if (Array.isArray(it.data) && !it.borrado) { await this.repo.putDoc('roles', it.data); usuarios = true; } }
      else if (id.startsWith('usr:')) { if (it.data) { await this.repo.aplicarPerfil(it.data, { borrado: !!it.borrado }); usuarios = true; } }
    }
    if (usuarios && this.repo.session) {
      const s = this.repo.session.user;
      const u = (await this.repo.db.get('users', s.id)) || (await this.repo.userByName(s.usuario));
      if (!u || !u.activo) { this.emit('mensaje', { tipo: 'error', texto: 'Tu usuario ha sido desactivado por un administrador' }); await this.logout(); return; }
      await this.repo._startSession(u);
    }
    this.emit('central', { config: ids });
  }
  /** Preventivos compartidos de este dispositivo que pasan al espacio central (por archivo o en el mismo servidor) */
  async _centralRegistrarLocales() {
    const cm = this.centralMeta; if (!cm) return 0; let n = 0;
    for (const s of await this.refreshSummaries()) {
      const m = await this.repo.getPrevMeta(s.id);
      if (m.modalidad !== 'compartida' || m.central) continue;
      if (m.server && normServer(m.server) !== normServer(cm.server)) continue; // compartido en otro servidor: no se toca
      if (!m.server) { m.server = cm.server; m.registrado = false; m.lastSq = m.lastSq || 0; }
      m.central = cm.org; await this.repo.savePrevMeta(s.id, m); this.metas.set(s.id, m); this.sync.keysCache.delete(s.id);
      if (!this.engines.has(s.id)) await this.loadEngine(s.id);
      await this._registrarCentral(s.id); n++;
    }
    return n;
  }
  // Usuarios y roles: se guardan aquí y se comparten con todos los dispositivos del espacio
  async saveUser(data, password) {
    const id = await this.repo.saveUser(data, password);
    if (this.centralMeta) {
      let u = await this.repo.db.get('users', id);
      const ant = this.repo.ultimoCambioUsuario && this.repo.ultimoCambioUsuario.usuarioAnterior;
      if (ant || !u.activo) {
        if (ant) await this.central.borrarCuenta(ant);
        if (!u.activo) await this.central.borrarCuenta(u.usuario);
        u.cred = { v: (u.cred && u.cred.v) || 'v0', central: false }; await this.repo.db.put('users', u);
      }
      if (password && u.activo) { await this.central.guardarCuenta(u.usuario, password); u = await this.repo.marcarCuentaPublicada(id); }
      await this.central.guardarConfig('usr:' + id, this.repo.perfil(u));
    }
    return id;
  }
  async changeOwnPassword(oldPwd, newPwd) {
    await this.repo.changeOwnPassword(oldPwd, newPwd);
    if (this.centralMeta) {
      await this.central.guardarCuenta(this.user.usuario, newPwd);
      const u = await this.repo.marcarCuentaPublicada(this.user.id);
      await this.central.guardarConfig('usr:' + u.id, this.repo.perfil(u));
    }
  }
  async saveRoles(roles) {
    await this.repo.saveRoles(roles);
    if (this.centralMeta) await this.central.guardarConfig('roles', await this.repo.getRoles());
  }
  async _registrarCentral(pid) {
    const m = await this.repo.getPrevMeta(pid); const e = this.engine(pid);
    if (!m.secret || !e || !e.state.prev) return;
    const p = e.state.prev;
    await this.central.registrarPrev(pid, { secret: m.secret, nombre: p.nombre, fecha: p.fecha || '', estado: p.estado, archivado: !!p.archivado, creado: p.creado, actualizado: now(), por: this.device.nombre || '' });
    m.regNombre = p.nombre; m.regEstado = p.estado; m.regArchivado = !!p.archivado;
    await this.repo.savePrevMeta(pid, m); this.metas.set(pid, m);
  }
  /** Preventivos del espacio central recibidos de otros dispositivos */
  async _centralPrevs(entries) {
    if (!this.centralMeta) return;
    for (const x of entries) {
      const m = await this.repo.getPrevMeta(x.pid);
      if (m.secret) { // ya conocido: se actualiza el nombre/estado mostrado
        if (m.central && (m.regNombre !== x.nombre || m.regEstado !== x.estado || !!m.regArchivado !== !!x.archivado)) { Object.assign(m, { regNombre: x.nombre, regEstado: x.estado, regArchivado: !!x.archivado }); await this.repo.savePrevMeta(x.pid, m); }
        continue;
      }
      await this.repo.savePrevMeta(x.pid, { modalidad: 'compartida', secret: x.secret, server: this.centralMeta.server, nombre: x.nombre, lastSq: 0, registrado: true, central: this.centralMeta.org, regNombre: x.nombre, regEstado: x.estado, regArchivado: !!x.archivado, unido: now() });
    }
    this.centralDisp = await this.centralDisponibles();
    this.emit('central', { prevs: entries.map(x => x.pid) });
  }
  /** Preventivos del espacio central que aún no se han abierto en este dispositivo */
  async centralDisponibles() {
    if (!this.centralMeta) return [];
    const d = await this.central.datos(); const locales = new Set((this.summaries || []).map(s => s.id));
    return Object.values(d.registro).filter(x => !locales.has(x.pid)).sort((a, b) => (b.creado || 0) - (a.creado || 0));
  }
  /** Abrir un preventivo del espacio central por primera vez: se descarga y se abre */
  async abrirCentral(pid) {
    const d = await this.central.datos(); const x = d.registro[pid];
    if (!x) throw new AppError('El preventivo no está en el servidor central');
    const m = await this.repo.getPrevMeta(pid);
    if (!m.secret) await this.repo.savePrevMeta(pid, { modalidad: 'compartida', secret: x.secret, server: this.centralMeta.server, nombre: x.nombre, lastSq: 0, registrado: true, central: this.centralMeta.org, regNombre: x.nombre, regEstado: x.estado, regArchivado: !!x.archivado, unido: now() });
    this.sync.keysCache.delete(pid);
    const st = await this.sync.syncNow(pid);
    if (st.estado === 'sin_conexion') throw new AppError('Sin conexión con el servidor central: inténtalo cuando haya red');
    if (st.estado === 'error') throw new AppError(st.error || 'No se pudo descargar el preventivo');
    await this.loadEngine(pid); await this._summary(pid);
    this.centralDisp = await this.centralDisponibles();
    return this.openPrev(pid);
  }

  async createPrev({ datos, seed, server = '' }) {
    const pid = uid('prev_');
    const engine = new Engine();
    const shared = datos.modalidad === 'compartida';
    const meta = { modalidad: datos.modalidad, nombre: datos.nombre, creado: now() };
    // Con servidor central, los preventivos compartidos lo usan siempre: no se pregunta nada
    const central = shared && this.centralMeta ? this.centralMeta : null;
    if (shared) { meta.secret = b64(newSecret()); meta.server = normServer(central ? central.server : server || this.cfg.syncServidor || ''); meta.lastSq = 0; meta.registrado = false; }
    if (central) meta.central = central.org;
    await this.repo.savePrevMeta(pid, meta); this.metas.set(pid, meta);
    const ops = C.prevCreate({ engine, user: this.user, device: this.device, hlc: this.hlc, pid, mode: datos.modalidad }, {
      datos, cat: seed.cat, cfg: seed.cfg, unidades: seed.unidades || [], plano: seed.plano || null, origen: seed.origen || { tipo: 'nuevo' },
    });
    this.engines.set(pid, engine);
    await this._commit(pid, engine, ops);
    if (seed.origen && seed.origen.tipo === 'plantilla') {
      const t = await this.repo.getTemplate(seed.origen.id);
      if (t) { t.usos = [...(t.usos || []), { t: now(), pid, nombre: datos.nombre }]; await this.repo.saveTemplate(t, 'Uso de plantilla'); }
    }
    await this.openPrev(pid);
    if (central) await this._registrarCentral(pid);
    return pid;
  }
  /** Semilla para un preventivo nuevo sin plantilla (configuración global) */
  seedFromConfig() { const c = contentFromConfig(this.cfg); return { cat: c.cat, cfg: c.cfg, unidades: [], plano: null, origen: { tipo: 'nuevo' } }; }
  seedFromPrev(pid, { unidades = true, plano = true } = {}) {
    const e = this.engine(pid); const c = contentFromPrev(e.state, { unidades, plano });
    return { cat: c.cat, cfg: c.cfg, unidades: c.unidades, plano: c.plano, participantes: c.participantes, origen: { tipo: 'duplicado', id: pid, nombre: e.state.prev.nombre } };
  }
  seedFromTemplate(tpl) { return seedFromTemplate(tpl); }

  joinCode(pid = this.cur) {
    const m = this.meta(pid);
    if (m.modalidad !== 'compartida') throw new AppError('El preventivo no es compartido');
    return encodeJoinCode({ server: m.server, pid, secret: unb64(m.secret), nombre: this.engine(pid).state.prev.nombre });
  }
  async joinPrev(code) {
    if (!this.can('sync.gestionar')) throw new AppError('No tienes permiso para gestionar la sincronización', 'permiso');
    const j = decodeJoinCode(code);
    const prevMeta = await this.repo.getPrevMeta(j.pid);
    const meta = { ...prevMeta, modalidad: 'compartida', secret: b64(j.secret), server: j.server, nombre: j.nombre, lastSq: prevMeta.lastSq || 0, registrado: !!j.server, unido: now() };
    await this.repo.savePrevMeta(j.pid, meta); this.metas.set(j.pid, meta); this.sync.keysCache.delete(j.pid);
    await this.repo.audit('Incorporación a preventivo compartido', 'Preventivo ' + (j.nombre || j.pid), '', j.server || 'sin servidor (archivo)');
    if (!j.server) return { pid: j.pid, needBundle: true };
    const st = await this.sync.syncNow(j.pid);
    if (st.estado !== 'sincronizado' && st.estado !== 'pendiente') return { pid: j.pid, needBundle: true, error: st.error || 'No se pudo contactar con el servidor' };
    await this.loadEngine(j.pid); await this._summary(j.pid);
    if (!this.engine(j.pid).state.prev) return { pid: j.pid, needBundle: true, error: 'El servidor todavía no tiene datos de este preventivo' };
    await this.openPrev(j.pid);
    return { pid: j.pid, ok: true };
  }
  async importBundle(text) {
    const r = await this.sync.importBundle(text);
    if (!this.engines.has(r.pid)) await this.loadEngine(r.pid);
    await this._summary(r.pid);
    this.emit('change', { pid: r.pid });
    return r;
  }
  async exportBundle(pid = this.cur) { return this.sync.exportBundle(pid, this.engine(pid).state.prev.nombre); }

  /** Cambio de modalidad (requiere autorización y queda auditado) */
  async setModalidad(modalidad, server) {
    const pid = this.cur; const e = this.engine();
    if (!this.can('preventivos.editar') || !this.can('sync.gestionar')) throw new AppError('Se necesita permiso para editar preventivos y gestionar la sincronización', 'permiso');
    if (e.state.prev.estado === 'cerrado' || e.state.prev.archivado) throw new AppError('El preventivo está cerrado');
    const meta = { ...this.meta(pid) };
    const before = meta.modalidad;
    if (modalidad === 'compartida') {
      if (!meta.secret) meta.secret = b64(newSecret());
      // Con servidor central se comparte siempre en él: no se pregunta ninguna dirección
      const cm = this.centralMeta;
      meta.server = normServer(cm ? cm.server : server || meta.server || this.cfg.syncServidor || '');
      if (cm) meta.central = cm.org;
      meta.startNum = e.state.maxNum; meta.registrado = false; meta.lastSq = meta.lastSq || 0;
      meta.modalidad = 'compartida';
      await this.repo.savePrevMeta(pid, meta); this.metas.set(pid, meta); this.sync.keysCache.delete(pid);
      await this.repo.markAllPending(pid);
      this.sync.start(pid);
      if (cm) await this._registrarCentral(pid);
    } else {
      meta.modalidad = 'independiente';
      await this.repo.savePrevMeta(pid, meta); this.metas.set(pid, meta);
      await this.repo.maxCounter(pid, e.state.maxNum);
      this.sync.stop(pid);
    }
    await this._commit(pid, e, C.prevUpdate(this.ctxFor(pid), { modalidad }));
    await this.repo.audit('Cambio de modalidad', 'Preventivo ' + e.state.prev.nombre, before, modalidad + (meta.server ? ' · ' + meta.server : ''));
    this.emit('change', { pid });
  }
  async setServer(server) {
    const pid = this.cur; const meta = { ...this.meta(pid) };
    if (!this.can('sync.gestionar')) throw new AppError('No tienes permiso para gestionar la sincronización', 'permiso');
    meta.server = normServer(server); meta.registrado = false;
    await this.repo.savePrevMeta(pid, meta); this.metas.set(pid, meta);
    await this.repo.audit('Servidor de sincronización', 'Preventivo ' + this.state.prev.nombre, '', meta.server || 'sin servidor');
    if (meta.server) this.sync.start(pid); else this.sync.stop(pid);
  }

  /** Reenvía todo el registro al servidor (tras perder o cambiar el servidor) */
  async resendAll() {
    const pid = this.cur; if (!this.can('sync.gestionar')) throw new AppError('No tienes permiso para gestionar la sincronización', 'permiso');
    const meta = { ...this.meta(pid), registrado: false, lastSq: 0, startNum: this.engine(pid).state.maxNum, blobsSubidos: [] };
    await this.repo.savePrevMeta(pid, meta); this.metas.set(pid, meta);
    const n = await this.repo.markAllForResend(pid);
    await this.repo.audit('Reenvío completo al servidor', 'Preventivo ' + this.state.prev.nombre, '', n + ' operaciones');
    return this.sync.syncNow(pid);
  }
  async _remote(pid, ops) {
    for (const op of ops) this.hlc.recv(op.h);
    const e = this.engines.get(pid);
    if (e) { e.add(ops); await this._summary(pid); }
    this.dirty = true;
    this.emit('change', { pid, remote: true });
  }
  _number(pid, id, num) {
    const e = this.engines.get(pid);
    if (e && e.setNumber(id, num)) this.emit('change', { pid, remote: true });
  }
  /** Otra pestaña del mismo dispositivo ha guardado cambios: se incorporan sin sustituir nada */
  async _otherTab(msg) {
    if (!msg || !msg.pid || msg.dev !== this.device.id || !this.engines.has(msg.pid) || !this.repo.dek) return;
    const ops = await this.repo.loadOps(msg.pid);
    const e = this.engines.get(msg.pid);
    const nuevos = ops.filter(o => !e.byId.has(o.id));
    let changed = false;
    for (const o of ops) { const cur = e.byId.get(o.id); if (cur && o.num != null && cur.num !== o.num) { e.setNumber(o.id, o.num); changed = true; } }
    if (nuevos.length) { for (const op of nuevos) this.hlc.recv(op.h); e.add(nuevos); changed = true; }
    if (changed) { await this._summary(msg.pid); this.emit('change', { pid: msg.pid, remote: true }); }
  }

  // ------------- plantillas -------------
  async templateFromCurrent({ nombre, descripcion, unidades = true, plano = true }) {
    if (!this.can('plantillas.gestionar')) throw new AppError('No tienes permiso para gestionar plantillas', 'permiso');
    const roles = await this.repo.getRoles();
    const t = newTemplate({ nombre, descripcion, contenido: contentFromPrev(this.state, { unidades, plano, roles }), origen: { tipo: 'preventivo', id: this.cur, nombre: this.state.prev.nombre } });
    await this.repo.saveTemplate(t, 'Creación de plantilla');
    return t;
  }
}
export { C, clone };
