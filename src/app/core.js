// Núcleo de la aplicación: une repositorio cifrado, motor de preventivos,
// comandos de negocio y sincronización. La interfaz solo habla con esta capa.
import { Repo } from '../data/repo.js';
import { SyncManager, newSecret, decodeJoinCode, encodeJoinCode, normServer } from '../data/sync.js';
import { CentralSync } from '../data/central.js';
import { APP_VERSION, DEFAULT_TIPOS_RECURSO, DEFAULT_PLANTILLAS_UNIDAD } from '../core/defaults.js';
import { SERVIDOR_CENTRAL } from '../config/servidor.js';
import { Engine } from '../core/engine.js';
import { HLC } from '../core/hlc.js';
import * as C from '../core/commands.js';
import { uid, now, b64, unb64, AppError, clone, same, isHexColor } from '../core/util.js';
import { contentFromPrev, seedFromTemplate, newTemplate, contentFromConfig } from '../core/templates.js';
import { counts } from '../core/engine.js';
import { migrarDatos } from '../data/migraciones.js';
import { posterior } from '../core/versiones.js';
import { tiposNoDisponibles, tiposParaNuevaUnidad, plantillasDisponibles, tipoActivo, referenciasTipoEnConfig, explicacionBloqueo } from '../core/recursos.js';
import { permisosEfectivos } from '../core/perms.js';
import { describeOp } from '../core/timeline.js';
import { detectarIncoherencias } from '../core/validaciones.js';

export class AppCore {
  /** opciones: pruebas (entorno CLAUDE_TEST) y servidor (dirección del servidor central; por defecto la
   *  preconfigurada en el navegador y ninguna fuera de él, para que las pruebas nunca toquen el real) */
  constructor(storage, { pruebas = false, servidor } = {}) {
    this.storage = storage; this.pruebas = pruebas;
    this.servidorFijo = servidor !== undefined ? servidor : typeof window !== 'undefined' ? SERVIDOR_CENTRAL : null;
    this.repo = new Repo(storage);
    this.engines = new Map(); this.metas = new Map(); this.cur = null; this.listeners = new Set(); this.dirty = false;
    this.bloqueoSync = null; this.versionRemota = null; this.migracion = null; this._actualizada = null;
    // Modo servidor (1.4.0): sesiones del servidor central por usuario de este dispositivo y perfiles en memoria
    this._sesiones = {}; this._sesionPendiente = null; this.rolesCache = null; this._permsVer = 0; this._pc = null;
    this.sync = new SyncManager({
      repo: this.repo,
      bloqueo: server => this._bloqueo(server),
      onRemoteOps: (pid, ops) => this._remote(pid, ops),
      onNumber: (pid, id, num) => this._number(pid, id, num),
      getPlano: pid => { const e = this.engines.get(pid); return e && e.state.prev ? e.state.prev.plano : null; },
      onStatus: (pid, s) => this.emit('sync', { pid, s }),
      onBlob: pid => this.emit('change', { pid }),
      modoServidor: (pid, meta) => this._modoServidorPrev(pid, meta),
      onRechazos: (pid, lista) => this._rechazos(pid, lista),
      onSesion: msg => this._sinSesion(msg),
      onCuenta: msg => this._cuentaNoActiva(msg),
    });
    this.central = new CentralSync({
      repo: this.repo, version: APP_VERSION, pruebas,
      bloqueo: () => this._bloqueo(this.centralMeta && this.centralMeta.server),
      device: () => ({ id: this.device.id, nombre: this.device.nombre }),
      onPrevs: entries => this._centralPrevs(entries),
      onConfig: ids => this._centralConfig(ids),
      onStatus: st => this.emit('central', { st }),
      sesion: () => this._sesionToken(),
      onSesion: msg => this._sinSesion(msg),
      onCuenta: msg => this._cuentaNoActiva(msg),
      onRechazoConfig: (id, msg) => this.emit('mensaje', { tipo: 'error', texto: 'El servidor ha rechazado un cambio de la configuración general: ' + msg }),
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
  /** Permisos efectivos del usuario: en general o, con un preventivo abierto, los de ese preventivo (alcance) */
  permisos(pid = this.cur) {
    const u = this.user; if (!u) return new Set();
    if (!pid || !this.rolesCache || !u.datos) return u.perms;
    const k = pid + '|' + this._permsVer + '|' + u.id;
    if (!this._pc || this._pc.k !== k) this._pc = { k, set: permisosEfectivos({ ...u.datos, id: u.id }, this.rolesCache, pid) };
    return this._pc.set;
  }
  can(p) { return this.permisos().has(p); }
  async _refrescarPermisos() { this.rolesCache = await this.repo.getRoles(); this._permsVer++; this._pc = null; }

  // ------------- modo servidor (1.4.0): sesiones, rechazos y cuentas -------------
  modoServidor() { return !!(this.centralMeta && this.centralMeta.modo === 'servidor'); }
  _sesionToken(userId = this.user && this.user.id) { const s = userId && this._sesiones[userId]; return (s && s.token) || this._sesionPendiente || null; }
  async _guardarSesion(userId, token) { this._sesiones = await this.repo.guardarSesionCentral(userId, token); this._avisoSesion = false; }
  _modoServidorPrev(pid, meta) {
    if (!this.modoServidor() || !meta || meta.central !== this.centralMeta.org) return null;
    return { org: this.centralMeta.org, sesion: autor => this._sesionToken(autor || (this.user && this.user.id)) };
  }
  /** Operaciones rechazadas por el servidor: el estado local vuelve a ser el del servidor y se avisa */
  async _rechazos(pid, lista) {
    const e = this.engines.get(pid);
    // Descripción legible y nombre del preventivo antes de rehacer el estado (después la operación ya no está)
    const prev = e && e.state.prev ? e.state.prev.nombre : ((this.summaries || []).find(x => x.id === pid) || {}).nombre || '';
    const que = op => { if (!op) return ''; if (!e) return op.k; try { const d = describeOp(e.state, op); return [d.elemento, d.accion, d.nuevo].filter(Boolean).join(' · '); } catch { return op.k; } };
    await this.repo.anotarRechazos(lista.map(r => ({ pid, prev, id: r.id, error: r.error, codigo: r.codigo || '', k: r.op ? r.op.k : '', que: que(r.op), autor: r.op && r.op.u ? r.op.u.n : '', t: now() })));
    if (e) { e.load(await this.repo.loadOps(pid)); await this._summary(pid); this.emit('change', { pid }); }
    for (const r of lista) await this.repo.audit('Operación rechazada por el servidor', (r.op ? r.op.k + ' · ' : '') + pid, '', r.error);
    this.emit('mensaje', { tipo: 'error', texto: (lista.length === 1 ? 'El servidor ha rechazado un cambio: ' : 'El servidor ha rechazado ' + lista.length + ' cambios: ') + lista[0].error, duracion: 12000 });
  }
  /** Cambios rechazados por el servidor: se marcan como revisados (nunca se borran: también quedan en la auditoría) */
  async marcarRechazosRevisados() { const r = await this.repo.marcarRechazosRevisados(this.user ? this.user.usuario : ''); this.emit('central', {}); return r; }
  _sinSesion(msg) { if (this._avisoSesion) return; this._avisoSesion = true; this.emit('mensaje', { tipo: 'warn', texto: (msg || 'Tu sesión del servidor central ha caducado') + '. Tus cambios se guardan en este dispositivo y se enviarán al volver a entrar.', duracion: 10000 }); this.emit('central', {}); }
  async _cuentaNoActiva(msg) {
    if (!this.user) return;
    const u = await this.repo.db.get('users', this.user.id);
    if (u) { u.activo = false; u.estado = /suspend/i.test(msg) ? 'suspendido' : 'desactivado'; await this.repo.db.put('users', u); }
    this.emit('mensaje', { tipo: 'error', texto: msg, duracion: 12000 });
    await this.logout();
  }
  /** Nueva sesión del servidor con la contraseña (al entrar con conexión o cuando la sesión caducó) */
  async renovarSesion(password) {
    if (!this.modoServidor() || !this.user) return;
    const acc = await this._acceder(this.centralMeta.server, this.centralMeta.org, this.user.usuario, password);
    if (acc.sesion) await this._guardarSesion(this.user.id, acc.sesion);
    this.central.kick(); if (this.cur) this.sync.kick(this.cur);
  }
  /** Nueva sesión con la credencial del dispositivo (cuentas con PIN) */
  async _renovarSesionPin(cred) {
    if (!this.modoServidor() || !this.user || !cred) return;
    const acc = await this.central.accederDispositivo({ server: this.centralMeta.server, org: this.centralMeta.org, usuario: this.user.usuario, dev: this.device.id, cred });
    await this._guardarSesion(this.user.id, acc.sesion);
    this.central.kick(); if (this.cur) this.sync.kick(this.cur);
  }
  /** Entrada con PIN (cuentas sin contraseña). Funciona sin conexión; con conexión renueva la sesión si hace falta. */
  async loginPin(usuario, pin) {
    const { cred } = await this.repo.loginPin(usuario, pin);
    await this._afterLogin();
    if (this.modoServidor() && !this._sesionToken()) this._renovarSesionPin(cred).catch(e => { if (e.status === 403) this._cuentaNoActiva(e.message); });
  }
  /** Datos del servidor central para el inicio de sesión de un dispositivo (ya vinculado o nuevo) */
  async _destinoCentral() {
    const ptr = await this.repo.centralPointer();
    if (ptr) return { server: ptr.server, org: ptr.org, vinculado: true };
    const c = this.centralRemoto && this.centralRemoto.org ? this.centralRemoto : await this.consultarCentral();
    if (!c || !c.org) throw new AppError('Sin conexión con el servidor central. Comprueba la conexión a Internet e inténtalo de nuevo.');
    return { server: c.server, org: c.org, vinculado: false };
  }
  /** Solicitud de cuenta desde la pantalla de inicio de sesión: queda pendiente de aprobación */
  async registrarse({ usuario, nombre, password }) {
    if (String(password || '').length < 8) throw new AppError('La contraseña debe tener al menos 8 caracteres');
    const d = await this._destinoCentral();
    try { return await this.central.registrar({ server: d.server, org: d.org, usuario, nombre, password }); }
    catch (e) { if (e.code === 'red') throw new AppError('Sin conexión con el servidor central: el registro necesita conexión'); throw e; }
  }
  /** ¿Qué pide un código de activación? (PIN o contraseña nueva). No lo consume. */
  async consultarCodigo(usuario, codigo) {
    const d = await this._destinoCentral();
    return this.central._req(d.server, '/org/' + encodeURIComponent(d.org) + '/activacion/consultar', { method: 'POST', body: { usuario, codigo } });
  }
  /** Primer acceso con el código de un solo uso del administrador: fija el PIN (o la contraseña) en este dispositivo */
  async activarCuenta({ usuario, codigo, pin = null, password = null, dispositivo = '' }) {
    const d = await this._destinoCentral();
    if (pin != null && !/^\d{6,12}$/.test(String(pin))) throw new AppError('El PIN debe tener entre 6 y 12 cifras');
    if (password != null && String(password).length < 8) throw new AppError('La contraseña debe tener al menos 8 caracteres');
    const cred = pin != null ? Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('') : null;
    if (dispositivo) await this.repo.saveDevice({ nombre: dispositivo });
    const acc = await this.central.activar({ server: d.server, org: d.org, usuario, codigo, dev: this.device.id, devNombre: dispositivo || this.device.nombre || '', cred, password });
    this._sesionPendiente = acc.sesion;
    try {
      if (d.vinculado) await this.repo.unlockConSecreto(acc.secret);
      else { await this.repo.setupCentral(acc.secret); await this._vincular(acc); }
      this.centralMeta = await this.central.meta();
      await this.repo.aplicarPerfil(acc.usuario);
      await this.central.syncNow();
      const u = await this.repo.userByName(usuario);
      if (!u || !u.activo) throw new AppError('Tu usuario no está activo en el servidor central');
      if (pin != null) { await this.repo._startSession(u); await this.repo.establecerPin(u.id, pin, cred); await this.repo._startSession(await this.repo.db.get('users', u.id)); }
      else await this.repo.establecerClaveLocal(u.id, password);
      await this._guardarSesion(u.id, acc.sesion);
    } finally { this._sesionPendiente = null; }
    await this._afterLogin();
  }
  // Administración del espacio en modo servidor (las comprobaciones las hace el servidor)
  async usuariosServidor() { return this.central.admin('usuarios'); }
  async crearUsuarioServidor({ usuario, nombre, metodo = 'password', password = null, perfil = null, ajustes = null, alcance = null }) {
    const body = { usuario, nombre, metodo, perfil, ajustes, alcance };
    if (metodo === 'password' && password) {
      if (String(password).length < 8) throw new AppError('La contraseña debe tener al menos 8 caracteres');
      const { cuentaDerivar, CUENTA_ITER } = await import('../core/crypto.js');
      const salt = crypto.getRandomValues(new Uint8Array(16)); const iter = this.central.cuentaIter || CUENTA_ITER;
      body.pw = { salt: b64(salt), iter, verif: (await cuentaDerivar(password, salt, iter)).verif };
    }
    const r = await this.central.admin('usuarios', { method: 'POST', body });
    this.central.kick(); return r;
  }
  async cambiarUsuarioServidor(id, cambios) { const r = await this.central.admin('usuarios/' + encodeURIComponent(id), { method: 'PATCH', body: cambios }); this.central.kick(); return r; }
  async codigoUsuarioServidor(id) { return this.central.admin('usuarios/' + encodeURIComponent(id) + '/codigo', { method: 'POST', body: {} }); }
  async revocarUsuarioServidor(id, { dev = null, dispositivos = false } = {}) { return this.central.admin('usuarios/' + encodeURIComponent(id) + '/revocar', { method: 'POST', body: { dev, dispositivos } }); }
  async perfilesServidor() { return (await this.central.admin('perfiles')).perfiles; }
  async guardarPerfilesServidor(perfiles) { const r = await this.central.admin('perfiles', { method: 'PUT', body: { perfiles } }); this.central.kick(); return r.perfiles; }
  async ajustesServidor(cambios = null) { return (await this.central.admin('ajustes', cambios ? { method: 'PUT', body: cambios } : {})).ajustes; }
  async auditoriaServidor({ usuario = '', limite = 500 } = {}) { return (await this.central.admin('auditoria?usuario=' + encodeURIComponent(usuario) + '&limite=' + limite)).registros; }
  /** Migración del espacio central 1.3.0 al modo servidor (código de administración del servidor + contraseña propia) */
  async migrarAlModoServidor({ codigo, password }) {
    this._needCentral();
    if (!this.centralMeta) throw new AppError('Este dispositivo no está conectado al servidor central');
    if (this.modoServidor()) throw new AppError('El espacio central ya está en modo servidor');
    if (!(await this.repo.verifyPassword(password))) throw new AppError('Tu contraseña no es correcta');
    await this.central.syncNow(); // lo pendiente sale antes con el formato anterior
    const r = await this.central.migrar({ codigo: String(codigo || '').trim(), usuario: this.user.usuario });
    this.centralMeta = await this.central.meta();
    await this.renovarSesion(password);
    await this.repo.audit('Espacio central migrado al modo servidor', this.centralMeta.server, 'Cifrado de extremo a extremo', r.usuarios + ' usuarios, ' + r.preventivos + ' preventivos');
    this.central.kick(); this.emit('central', {});
    return r;
  }
  async setup(data) { const r = await this.repo.setup(data); await this._afterLogin(); return r; }
  async recover(code, u, p) { await this.repo.recover(code, u, p); await this._afterLogin(); }
  async _afterLogin() {
    // Migraciones de los datos locales (con copia de seguridad previa). Si fallan, se sigue con los datos
    // como estaban y se reintenta en el siguiente inicio de sesión.
    try { this.migracion = await migrarDatos(this.repo, { migrarCfg: c => this._migrarCfg(c) }); }
    catch (e) { console.error('Migración de datos fallida', e); this.migracion = { estado: 'error', error: e.message }; }
    if (this._actualizada) { const a = this._actualizada; this._actualizada = null; await this.repo.audit(a.revertida ? 'Aplicación devuelta a la versión anterior' : 'Actualización de la aplicación', 'Aplicación en este dispositivo', a.de || '', a.a || APP_VERSION); }
    this.cfg = this._migrarCfg(await this.repo.getCfg());
    this.sync.intervalMs = Math.max(2, Number(this.cfg.syncIntervaloSeg) || 5) * 1000;
    this.summaries = await this.repo.listSummaries();
    clearInterval(this._bk);
    this._bk = setInterval(() => this.autoBackup(), Math.max(1, Number(this.cfg.copiaAutoMin) || 10) * 60000);
    this.centralMeta = await this.central.meta();
    this._sesiones = await this.repo.sesionesCentral(); await this._refrescarPermisos();
    // Bajas del espacio central que una migración local hubiera vuelto a añadir: se aplican de nuevo
    if (this.centralMeta) await this._centralConfig([]).catch(e => console.warn('Configuración central', e));
    this.repo.minPassword = this.centralMeta || this.centralRemoto ? 8 : 6;
    if (this.centralMeta) { this.central.start(); this.centralDisponibles().then(x => { this.centralDisp = x; this.emit('central', {}); }).catch(() => { }); }
    this.emit('session', {});
    if (!this.centralMeta) this.consultarCentral(); // ¿hay un espacio central al que conectar este dispositivo?
  }
  async logout() {
    await this.autoBackup();
    this.sync.stopAll(); this.central.stop(); clearInterval(this._bk);
    this.engines.clear(); this.metas.clear(); this.cur = null;
    this._sesiones = {}; this.rolesCache = null; this._pc = null; this._avisoSesion = false;
    await this.repo.logout(); this.emit('session', {});
  }
  async autoBackup(force = false) {
    if (!this.repo.dek || (!this.dirty && !force)) return null;
    this.dirty = false;
    try { return await this.repo.createBackup('auto', 'Copia automática'); } catch (e) { console.warn('Copia automática fallida', e); return null; }
  }
  /** Migraciones de la configuración general: unidades plantilla de ejemplo y los tipos que usan */
  _migrarCfg(cfg) {
    if (!Array.isArray(cfg.plantillasUnidad)) cfg.plantillasUnidad = clone(DEFAULT_PLANTILLAS_UNIDAD);
    const tipos = cfg.catalogos.tiposRecurso;
    if (!cfg.eliminados || typeof cfg.eliminados !== 'object') cfg.eliminados = {};
    for (const k of ['tiposRecurso', 'plantillasUnidad']) if (!Array.isArray(cfg.eliminados[k])) cfg.eliminados[k] = [];
    // Tipo inicial que usa una plantilla y falta en la lista: se completa, salvo que se eliminara a propósito
    for (const p of cfg.plantillasUnidad) if (p.tipo && !tipos.some(t => t.id === p.tipo) && !cfg.eliminados.tiposRecurso.includes(p.tipo)) { const d = DEFAULT_TIPOS_RECURSO.find(t => t.id === p.tipo); if (d) tipos.push(clone(d)); }
    return cfg;
  }

  // ------------- tipos de recurso y unidades plantilla (configuración general, comunes a todos los dispositivos) -------------
  _needRecursos() { if (!this.can('recursos.gestionar')) throw new AppError('No tienes permiso para gestionar tipos de recurso y unidades plantilla', 'permiso'); }
  tiposRecursoGenerales({ activos = false } = {}) { return (this.cfg.catalogos.tiposRecurso || []).filter(t => !activos || t.activo !== false); }
  plantillasUnidad({ activas = false } = {}) { return (this.cfg.plantillasUnidad || []).filter(p => !activas || p.activo !== false); }
  /** Tipos que se ofrecen al crear una unidad en el preventivo abierto (sin desactivados ni retirados) */
  tiposParaNuevaUnidad(pid = this.cur) { const e = pid && this.engine(pid); return tiposParaNuevaUnidad(e && e.state.prev ? e.state.prev.cat.tiposRecurso : [], this.cfg); }
  /** Unidades plantilla que se pueden usar en el preventivo abierto (activas y con un tipo disponible) */
  plantillasDisponibles(pid = this.cur) { const e = pid && this.engine(pid); return plantillasDisponibles(this.cfg.plantillasUnidad, this.cfg, e && e.state.prev ? e.state.prev.cat.tiposRecurso : null); }

  // ------------- eliminar, retirar y restaurar configuraciones de recursos (1.4.0) -------------
  _eliminados() { const e = (this.cfg && this.cfg.eliminados) || {}; return { tiposRecurso: [...(e.tiposRecurso || [])], plantillasUnidad: [...(e.plantillasUnidad || [])] }; }
  async _marcarEliminados(clase, ids, { quitar = false } = {}) {
    const el = this._eliminados(); const set = new Set(el[clase]);
    for (const id of ids) { if (quitar) set.delete(id); else set.add(id); }
    if (set.size === el[clase].length && el[clase].every(x => set.has(x))) return;
    const cfg = clone(this.cfg); cfg.eliminados = { ...el, [clase]: [...set] };
    await this.repo.saveCfg(cfg, quitar ? 'Configuraciones recuperadas' : 'Configuraciones eliminadas'); this.cfg = this._migrarCfg(await this.repo.getCfg()); this.emit('cfg', {});
  }
  /** Recorre los preventivos de este dispositivo sin dejar cargados los que no lo estaban */
  async _recorrerPreventivos(fn) {
    for (const s of await this.refreshSummaries()) {
      let e = this.engines.get(s.id);
      if (!e) { try { e = new Engine(await this.repo.loadOps(s.id)); } catch { continue; } }
      if (e.state.prev) fn(e, s);
    }
  }
  /** Dónde se usa un tipo de recurso general (vista previa antes de eliminarlo o retirarlo) */
  async referenciasTipoRecurso(id) {
    const tipo = this.tiposRecursoGenerales().find(t => t.id === id); if (!tipo) throw new AppError('Tipo de recurso no encontrado');
    const preventivos = [];
    await this._recorrerPreventivos((e, s) => {
      const st = e.state; const n = Object.values(st.units).filter(u => !u.eliminada && u.tipo === id).length;
      if (n || st.prev.cat.tiposRecurso.some(t => t.id === id)) preventivos.push({ id: s.id, nombre: st.prev.nombre, unidades: n });
    });
    const plantillasPrev = (await this.repo.listTemplates()).filter(t => { const c = t.contenido || {}; return ((c.cat && c.cat.tiposRecurso) || []).some(x => x.id === id) || (c.unidades || []).some(u => u.tipo === id); }).map(t => ({ id: t.id, nombre: t.nombre }));
    return { tipo, ...referenciasTipoEnConfig(this.cfg, id), preventivos, plantillasPrev };
  }
  /** Quita (o cambia por «destino») un tipo de recurso de la compatibilidad de los tipos de aviso por defecto */
  async _compatTiposAviso(id, destino) {
    const ta = this.cfg.catalogos.tiposAviso || [];
    if (!ta.some(a => (a.compatibles || []).includes(id))) return [];
    const afect = ta.filter(a => (a.compatibles || []).includes(id));
    const cfg = clone(this.cfg);
    cfg.catalogos.tiposAviso = ta.map(a => ((a.compatibles || []).includes(id) ? { ...a, compatibles: [...new Set(a.compatibles.flatMap(x => (x === id ? (destino ? [destino] : []) : [x])))] } : a));
    await this.repo.saveCfg(cfg, 'Tipos de aviso por defecto: compatibilidad actualizada'); this.cfg = this._migrarCfg(await this.repo.getCfg());
    return afect;
  }
  /** Elimina un tipo de recurso general (también los iniciales). modo:
   *  · 'eliminar': nada de la configuración lo necesita;
   *  · 'reasignar': sus unidades plantilla y la compatibilidad de los tipos de aviso pasan a «destino»;
   *  · 'conPlantillas': elimina también las unidades plantilla que lo usan (autorización expresa);
   *  · 'retirar': no se elimina; deja de ofrecerse y se conserva.
   *  Los preventivos guardan su propia copia del tipo: sus unidades, avisos, informes e historial no cambian. */
  async eliminarTipoRecurso(id, { modo = 'eliminar', destino = null } = {}) {
    this._needRecursos();
    const ref = await this.referenciasTipoRecurso(id); const t = ref.tipo;
    const conserva = ref.preventivos.length ? ref.preventivos.length + ' preventivo(s) conservan su copia y sus unidades' : '';
    if (modo === 'retirar') {
      await this.guardarTiposRecurso(this.tiposRecursoGenerales().map(x => (x.id === id ? { ...x, retirado: true } : x)));
      await this.repo.audit('Tipo de recurso retirado del uso', t.nombre, 'Disponible', ['Retirado', ref.plantillas.length ? 'plantillas sin ofrecer: ' + ref.plantillas.map(p => p.nombre).join(', ') : '', conserva].filter(Boolean).join(' · '));
      return { modo };
    }
    let detalle = '';
    if (modo === 'reasignar') {
      const d = this.tiposRecursoGenerales().find(x => x.id === destino);
      if (!destino || destino === id || !d) throw new AppError('Elige otro tipo de recurso para reasignar');
      if (!tipoActivo(d)) throw new AppError('El tipo «' + d.nombre + '» no está disponible: elige uno activo');
      const lista = clone(this.plantillasUnidad()); const cambiadas = lista.filter(p => p.tipo === id);
      for (const p of cambiadas) p.tipo = destino;
      if (cambiadas.length) await this._guardarPlantillas(lista, 'Unidades plantilla reasignadas de «' + t.nombre + '» a «' + d.nombre + '»', cambiadas);
      const ta = await this._compatTiposAviso(id, destino);
      detalle = 'reasignado a «' + d.nombre + '»' + (cambiadas.length ? ' · plantillas: ' + cambiadas.map(p => p.nombre).join(', ') : '') + (ta.length ? ' · tipos de aviso: ' + ta.map(a => a.nombre).join(', ') : '');
    } else if (modo === 'conPlantillas') {
      const excl = ref.tiposAviso.filter(a => a.exclusivo);
      if (excl.length) throw new AppError(explicacionBloqueo(t, excl), 'en_uso', { referencias: excl });
      const ids = ref.plantillas.map(p => p.id);
      if (ids.length) {
        await this._guardarPlantillas(this.plantillasUnidad().filter(p => !ids.includes(p.id)), 'Unidades plantilla eliminadas con el tipo «' + t.nombre + '»', [], ids);
        await this._marcarEliminados('plantillasUnidad', ids);
        for (const p of ref.plantillas) await this.repo.audit('Unidad plantilla eliminada', p.nombre, '', 'Con su tipo de recurso «' + t.nombre + '»');
      }
      const ta = await this._compatTiposAviso(id, null);
      detalle = [ids.length ? 'con sus unidades plantilla: ' + ref.plantillas.map(p => p.nombre).join(', ') : '', ta.length ? 'quitado de la compatibilidad de: ' + ta.map(a => a.nombre).join(', ') : ''].filter(Boolean).join(' · ');
    } else {
      if (ref.bloquean.length) throw new AppError(explicacionBloqueo(t, ref.bloquean), 'en_uso', { referencias: ref.bloquean });
      const ta = await this._compatTiposAviso(id, null);
      if (ta.length) detalle = 'quitado de la compatibilidad de: ' + ta.map(a => a.nombre).join(', ');
    }
    await this.guardarTiposRecurso(this.tiposRecursoGenerales().filter(x => x.id !== id));
    await this._marcarEliminados('tiposRecurso', [id]);
    await this.repo.audit('Tipo de recurso eliminado', t.nombre, '', [detalle, conserva].filter(Boolean).join(' · ') || 'Sin referencias');
    return { modo };
  }
  /** Vuelve a ofrecer un tipo de recurso retirado */
  async restaurarTipoRecurso(id) {
    this._needRecursos();
    const t = this.tiposRecursoGenerales().find(x => x.id === id); if (!t) throw new AppError('Tipo de recurso no encontrado');
    if (!t.retirado) return t;
    const n = { ...t }; delete n.retirado;
    await this.guardarTiposRecurso(this.tiposRecursoGenerales().map(x => (x.id === id ? n : x)));
    await this.repo.audit('Tipo de recurso restaurado', t.nombre, 'Retirado', 'Disponible');
    return n;
  }
  /** Configuraciones iniciales que se eliminaron a propósito (se pueden restaurar a petición) */
  inicialesEliminadas() {
    const el = this._eliminados();
    return {
      tiposRecurso: DEFAULT_TIPOS_RECURSO.filter(t => el.tiposRecurso.includes(t.id) && !this.tiposRecursoGenerales().some(x => x.id === t.id)).map(t => clone(t)),
      plantillasUnidad: DEFAULT_PLANTILLAS_UNIDAD.filter(p => el.plantillasUnidad.includes(p.id) && !this.plantillasUnidad().some(x => x.id === p.id)).map(p => clone(p)),
    };
  }
  /** Restaura configuraciones iniciales eliminadas (acción explícita del administrador; nunca automática) */
  async restaurarIniciales({ tiposRecurso = [], plantillasUnidad = [] } = {}) {
    this._needRecursos();
    const ini = this.inicialesEliminadas();
    const tipos = ini.tiposRecurso.filter(t => tiposRecurso.includes(t.id));
    const plts = ini.plantillasUnidad.filter(p => plantillasUnidad.includes(p.id));
    for (const p of plts) if (p.tipo && !this.tiposRecursoGenerales().some(t => t.id === p.tipo) && !tipos.some(t => t.id === p.tipo)) {
      const d = DEFAULT_TIPOS_RECURSO.find(t => t.id === p.tipo);
      throw new AppError('Para restaurar la plantilla «' + p.nombre + '» restaura también su tipo de recurso' + (d ? ' «' + d.nombre + '»' : ''));
    }
    if (!tipos.length && !plts.length) return 0;
    if (tipos.length) await this.guardarTiposRecurso([...this.tiposRecursoGenerales(), ...tipos]);
    if (plts.length) await this._guardarPlantillas([...clone(this.plantillasUnidad()), ...plts], 'Unidades plantilla iniciales restauradas', plts);
    await this._marcarEliminados('tiposRecurso', tipos.map(t => t.id), { quitar: true });
    await this._marcarEliminados('plantillasUnidad', plts.map(p => p.id), { quitar: true });
    await this.repo.audit('Configuraciones iniciales restauradas', [...tipos, ...plts].map(x => x.nombre).join(', '), 'Eliminadas', 'Restauradas');
    return tipos.length + plts.length;
  }
  /** Guarda la lista completa de tipos de recurso generales. Nunca se elimina un tipo que use una
   *  unidad plantilla (se puede desactivar); los preventivos guardan su propia copia del catálogo. */
  async guardarTiposRecurso(lista) {
    this._needRecursos();
    C.validateCatalog('tiposRecurso', lista, null);
    const ids = new Set(lista.map(t => t.id));
    for (const p of this.cfg.plantillasUnidad || []) if (p.tipo && !ids.has(p.tipo)) throw new AppError('No se puede eliminar el tipo: lo usa la unidad plantilla «' + p.nombre + '». Puedes desactivarlo.');
    const ant = this.cfg.catalogos.tiposRecurso || [];
    const cfg = clone(this.cfg); cfg.catalogos.tiposRecurso = clone(lista);
    await this.repo.saveCfg(cfg, 'Tipos de recurso'); this.cfg = await this.repo.getCfg(); this.emit('cfg', {});
    if (this.centralMeta) {
      for (const [i, t] of lista.entries()) { const a = ant.find(x => x.id === t.id); if (!a || !same(a, t) || ant.indexOf(a) !== i) await this.central.guardarConfig('tipo:' + t.id, { ...t, orden: i }); }
      for (const a of ant) if (!ids.has(a.id)) await this.central.guardarConfig('tipo:' + a.id, null, { borrado: true });
    }
  }
  /** Crea un tipo de recurso general (p. ej. desde el formulario de una unidad nueva) */
  async crearTipoRecurso(t) {
    const nuevo = { id: t.id || uid('rt_'), nombre: String(t.nombre || '').trim(), categoria: t.categoria || '', subtipos: t.subtipos || [], caracteristicas: t.caracteristicas || [], color: isHexColor(t.color) ? t.color : '#2E7D32', vis: { icono: 'ambulancia', forma: 'circulo', tam: 'm', ...(t.vis || {}) } };
    await this.guardarTiposRecurso([...this.tiposRecursoGenerales(), nuevo]);
    return nuevo;
  }
  _validarPlantilla(p) {
    if (!String(p.nombre || '').trim()) throw new AppError('La plantilla necesita un nombre');
    if (!String(p.prefijo || '').trim() && !(p.campos || []).length) throw new AppError('Indica un prefijo del indicativo');
    if (p.tipo && !this.tiposRecursoGenerales().some(t => t.id === p.tipo)) throw new AppError('El tipo de recurso de la plantilla no existe');
    if (p.color && !isHexColor(p.color)) throw new AppError('Color no válido');
    const dup = this.plantillasUnidad().find(x => x.id !== p.id && x.nombre.trim().toLowerCase() === p.nombre.trim().toLowerCase());
    if (dup) throw new AppError('Ya existe una plantilla con ese nombre');
  }
  async _guardarPlantillas(lista, detalle, cambiadas = [], borradas = []) {
    const cfg = clone(this.cfg); cfg.plantillasUnidad = lista;
    await this.repo.saveCfg(cfg, detalle); this.cfg = await this.repo.getCfg(); this.emit('cfg', {});
    if (this.centralMeta) {
      for (const p of cambiadas) await this.central.guardarConfig('plt:' + p.id, { ...p, orden: lista.findIndex(x => x.id === p.id) });
      for (const id of borradas) await this.central.guardarConfig('plt:' + id, null, { borrado: true });
    }
  }
  async guardarPlantillaUnidad(p) {
    this._needRecursos();
    const lista = clone(this.plantillasUnidad()); const i = lista.findIndex(x => x.id === p.id);
    const prev = i >= 0 ? lista[i] : null;
    const it = { activo: true, campos: [], obligatorios: [], valores: { subtipo: '', caract: [] }, vis: {}, ...(prev || {}), ...clone(p), id: p.id || uid('plt_'), usada: !!(prev && prev.usada) };
    it.nombre = String(it.nombre || '').trim(); it.prefijo = String(it.prefijo || '').trim().toUpperCase();
    it.obligatorios = (it.obligatorios || []).filter(k => (it.campos || []).includes(k));
    this._validarPlantilla(it);
    if (i >= 0) lista[i] = it; else lista.push(it);
    await this._guardarPlantillas(lista, 'Unidad plantilla: ' + it.nombre, [it]);
    return it;
  }
  async duplicarPlantillaUnidad(id) {
    const p = this.plantillasUnidad().find(x => x.id === id); if (!p) throw new AppError('Plantilla no encontrada');
    let nombre = p.nombre + ' (copia)'; for (let n = 2; this.plantillasUnidad().some(x => x.nombre === nombre); n++) nombre = p.nombre + ' (copia ' + n + ')';
    return this.guardarPlantillaUnidad({ ...clone(p), id: null, nombre, usada: false });
  }
  async activarPlantillaUnidad(id, activo) { const p = this.plantillasUnidad().find(x => x.id === id); if (!p) throw new AppError('Plantilla no encontrada'); return this.guardarPlantillaUnidad({ ...p, activo: !!activo }); }
  /** Qué unidades se crearon con una plantilla (vista previa antes de eliminarla) */
  async referenciasPlantillaUnidad(id) {
    const plantilla = this.plantillasUnidad().find(x => x.id === id); if (!plantilla) throw new AppError('Plantilla no encontrada');
    const preventivos = [];
    await this._recorrerPreventivos((e, s) => { const n = Object.values(e.state.units).filter(u => !u.eliminada && u.plantilla && u.plantilla.id === id).length; if (n) preventivos.push({ id: s.id, nombre: e.state.prev.nombre, unidades: n }); });
    return { plantilla, preventivos };
  }
  /** Elimina una unidad plantilla, también si ya se usó: las unidades creadas con ella copiaron sus valores
   *  y no cambian. Queda anotada como eliminada para que no vuelva a añadirse sola. */
  async borrarPlantillaUnidad(id) {
    this._needRecursos();
    const p = this.plantillasUnidad().find(x => x.id === id); if (!p) throw new AppError('Plantilla no encontrada');
    await this._guardarPlantillas(this.plantillasUnidad().filter(x => x.id !== id), 'Unidad plantilla eliminada: ' + p.nombre, [], [id]);
    await this._marcarEliminados('plantillasUnidad', [id]);
    await this.repo.audit('Unidad plantilla eliminada', p.nombre, '', p.usada ? 'Las unidades creadas con ella conservan sus datos' : 'No se había usado');
  }
  /** Crea una unidad en el preventivo abierto a partir de una unidad plantilla */
  async crearUnidadDesdePlantilla(id, valores) {
    const p = this.plantillasUnidad().find(x => x.id === id); if (!p) throw new AppError('Plantilla no encontrada');
    const tipoDef = this.tiposRecursoGenerales().find(t => t.id === p.tipo) || null;
    const ops = await this.exec(C.unitFromTemplate, { ...p, tipoDef }, valores);
    if (!p.usada) {
      // Queda marcada como usada (ya no se puede eliminar, solo desactivar). Sin permiso para gestionar plantillas
      // la marca se guarda igualmente: es un dato de uso, no un cambio de configuración.
      const lista = clone(this.plantillasUnidad()); const it = lista.find(x => x.id === id); it.usada = true;
      await this._guardarPlantillas(lista, 'Unidad plantilla usada: ' + p.nombre, [it]).catch(() => { });
    }
    return ops;
  }

  // ------------- cartografía (configuración general, común a todos los dispositivos) -------------
  /** Clave de Google Maps Platform: nunca en el código; se guarda cifrada y se reparte solo a los
   *  dispositivos del espacio central (el servidor no puede leerla). */
  async guardarCartografia({ googleKey = '' } = {}) {
    if (!this.can('config.editar')) throw new AppError('No tienes permiso para cambiar la cartografía', 'permiso');
    const k = String(googleKey || '').trim();
    if (k && !/^[A-Za-z0-9_-]{20,100}$/.test(k)) throw new AppError('La clave de Google Maps no tiene un formato válido');
    const cfg = clone(this.cfg); cfg.cartografia = { ...(cfg.cartografia || {}), googleKey: k };
    await this.repo.saveCfg(cfg, 'Cartografía: ' + (k ? 'clave de Google Maps configurada' : 'sin clave de Google Maps')); this.cfg = this._migrarCfg(await this.repo.getCfg()); this.emit('cfg', {});
    if (this.centralMeta) await this.central.guardarConfig('cartografia', cfg.cartografia);
  }
  planosBiblioteca() { return this.cfg.bibliotecaPlanos || []; }
  /** Guarda una zona cartográfica en la biblioteca de planos (común a todos los dispositivos) */
  async guardarPlanoBiblioteca(pl) {
    if (!this.can('planos.editar')) throw new AppError('No tienes permiso para gestionar planos', 'permiso');
    const it = { id: pl.id || uid('map_'), nombre: String(pl.nombre || '').trim() || 'Plano', lugar: pl.lugar || '', bounds: pl.bounds, centro: pl.centro, zoom: pl.zoom, creado: pl.creado || now() };
    const lista = this.planosBiblioteca().filter(x => x.id !== it.id).concat(it);
    const cfg = clone(this.cfg); cfg.bibliotecaPlanos = lista;
    await this.repo.saveCfg(cfg, 'Biblioteca de planos: ' + it.nombre); this.cfg = this._migrarCfg(await this.repo.getCfg()); this.emit('cfg', {});
    if (this.centralMeta) await this.central.guardarConfig('mapa:' + it.id, it);
    return it;
  }
  async borrarPlanoBiblioteca(id) {
    if (!this.can('planos.editar')) throw new AppError('No tienes permiso para gestionar planos', 'permiso');
    const cfg = clone(this.cfg); cfg.bibliotecaPlanos = this.planosBiblioteca().filter(x => x.id !== id);
    await this.repo.saveCfg(cfg, 'Biblioteca de planos: eliminado'); this.cfg = this._migrarCfg(await this.repo.getCfg()); this.emit('cfg', {});
    if (this.centralMeta) await this.central.guardarConfig('mapa:' + id, null, { borrado: true });
  }

  async saveCfg(cfg, detalle) {
    if (!this.can('config.editar')) throw new AppError('No tienes permiso para editar la configuración', 'permiso');
    await this.repo.saveCfg(cfg, detalle); this.cfg = this._migrarCfg(await this.repo.getCfg());
    this.sync.intervalMs = Math.max(2, Number(this.cfg.syncIntervaloSeg) || 5) * 1000;
    this.emit('cfg', {});
  }

  // ------------- preventivos -------------
  engine(pid = this.cur) { return this.engines.get(pid) || null; }
  /** Incoherencias del preventivo con los datos de sincronización de este dispositivo (solo detecta e informa) */
  async incoherencias(pid = this.cur) {
    const e = this.engine(pid); if (!e || !e.state.prev) return [];
    const compartido = e.state.prev.modalidad === 'compartida'; const st = this.sync.status(pid);
    let pendientes = null;
    if (compartido) { const l = await this.repo.pendingOps(pid); if (l.length) pendientes = { n: l.length, desde: Math.min(...l.map(o => o.t || now())) }; }
    const rechazos = (await this.repo.rechazos()).filter(r => r.pid === pid);
    return detectarIncoherencias(e.state, { t: now(), sync: { compartido, ultimoSync: st.ultimo || null, pendientes, rechazos } });
  }
  get state() { const e = this.engine(); return e ? e.state : null; }
  meta(pid = this.cur) { return this.metas.get(pid) || {}; }
  isShared(pid = this.cur) { return this.meta(pid).modalidad === 'compartida'; }
  ctxFor(pid, engine) {
    const user = this.user ? { ...this.user, perms: this.permisos(pid) } : this.user;
    return { engine: engine || this.engine(pid), user, device: this.device, hlc: this.hlc, pid, mode: this.isShared(pid) ? 'compartida' : 'independiente', noDisponibles: tiposNoDisponibles(this.cfg) };
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

  // ------------- versiones y actualizaciones -------------
  /** Motivo por el que no se sincroniza con ese servidor (aplicación anterior a la mínima que admite) */
  _bloqueo(server) {
    if (!this.bloqueoSync || !this.versionRemota) return null;
    return !server || normServer(server) === this.versionRemota.server ? this.bloqueoSync : null;
  }
  /** Versión del servidor central y versión mínima de la aplicación que admite (no requiere sesión) */
  async versionServidor() {
    await this._detectarOrigen();
    const srv = this.servidorCentral(); if (!srv) return null;
    let v = null;
    try { v = await this.central._req(srv, '/version', { timeout: 8000 }); }
    catch (e) { v = e.status === 404 ? { antiguo: true, version: await this.central.detectar(srv) } : null; }
    if (!v) return this.versionRemota;
    const previa = this.versionRemota;
    this.versionRemota = { ...v, server: normServer(srv), consultada: now() };
    const antes = this.bloqueoSync;
    this.bloqueoSync = v.minCliente && posterior(v.minCliente, APP_VERSION)
      ? 'Esta aplicación (' + APP_VERSION + ') es anterior a la mínima que admite el servidor central (' + v.minCliente + '). Tus cambios se guardan en este dispositivo y se enviarán en cuanto se actualice.'
      : null;
    if (antes && !this.bloqueoSync) { this.central.kick(); if (this.cur) this.sync.kick(this.cur); }
    // Solo se avisa (y se repinta) si algo cambia
    const clave = x => x ? [x.version, x.minCliente, x.mantenimiento, x.disponible, x.antiguo].join('|') : '';
    if (antes !== this.bloqueoSync || clave(previa) !== clave(this.versionRemota)) this.emit('version', this.versionRemota);
    return this.versionRemota;
  }
  /** Antes de recargar para actualizar: intenta enviar los cambios pendientes (no es imprescindible:
   *  todo está guardado en el dispositivo y se enviará al volver) y devuelve los que quedan */
  async prepararRecarga(ms = 8000) {
    const tareas = [];
    if (this.cur && this.isShared()) tareas.push(this.sync.syncNow(this.cur));
    if (this.centralMeta) tareas.push(this.central.syncNow());
    await Promise.race([Promise.all(tareas).catch(() => null), new Promise(r => setTimeout(r, ms))]);
    if (this.repo.dek) await this.autoBackup().catch(() => null);
    const pendientes = this.cur ? await this.repo.countPending(this.cur).catch(() => 0) : 0;
    return { pendientes };
  }
  /** La aplicación se acaba de actualizar (o de volver a la versión anterior): se anota al iniciar sesión */
  registrarActualizacion(info) { this._actualizada = info; }
  async actualizacionesServidor() { return this.central.adminActualizaciones(); }
  async dispositivosCentral() { return this.central.dispositivos(); }
  /** Acciones sobre el servidor central: permiso de la aplicación y, en el servidor, su código de administración */
  async accionActualizacionServidor(accion, { codigo = '', forzar = false } = {}) {
    if (!this.can('actualizaciones.gestionar')) throw new AppError('No tienes permiso para gestionar las actualizaciones', 'permiso');
    const NOMBRE = { comprobar: 'Comprobar versiones', preparar: 'Descargar y verificar', ahora: 'Instalar ahora', ventana: 'Instalar en la ventana segura', cancelar: 'Cancelar la instalación programada', revertir: 'Volver a la versión anterior' };
    if (!NOMBRE[accion]) throw new AppError('Acción no válida');
    if (accion !== 'comprobar' && !String(codigo).trim()) throw new AppError('Escribe el código de administración del servidor');
    let r = null; let error = null;
    try { r = await this.central.accionActualizaciones({ accion, codigo: String(codigo).trim(), forzar: !!forzar, dispositivo: this.device.id + ' (' + (this.device.nombre || '') + ')', usuario: this.user.usuario }); }
    catch (e) { error = e; }
    await this.repo.audit('Actualización del servidor central', NOMBRE[accion], '', error ? 'Error: ' + error.message : 'Solicitada' + (forzar ? ' (forzada)' : ''));
    if (error) throw error;
    return r;
  }
  /** Longitud mínima de contraseña: 8 con servidor central (acceso por Internet) */
  minPassword() { return this.repo.minPassword || 6; }
  _needCentral() { if (!this.can('central.gestionar')) throw new AppError('No tienes permiso para configurar el servidor central', 'permiso'); }
  async _acceder(server, org, usuario, password) {
    try { return await this.central.acceder({ server, org, usuario, password }); }
    catch (e) {
      // Cuenta que existe pero no está activa (pendiente, suspendida…): el servidor lo explica tras comprobar la contraseña
      if (e.status === 403 && e.body && String(e.body.codigo || '').startsWith('cuenta_')) throw new AppError(e.message, 'cuenta');
      if (e.status === 403) throw new AppError('Usuario o contraseña incorrectos', 'credenciales');
      if (e.status === 429) throw new AppError('Demasiados intentos fallidos con este usuario: espera 15 minutos');
      if (e.code === 'red') throw new AppError('Sin conexión con el servidor central: el primer acceso de un usuario en un dispositivo necesita conexión', 'red');
      throw e;
    }
  }
  /** Vincula el dispositivo al espacio: secreto cifrado, puntero no secreto y clave local envuelta */
  async _vincular({ server, org, secret, nombre, pruebas, sesion = null }) {
    this.centralMeta = await this.central.unirConSecreto({ server, org, secret, nombre, pruebas, sesion });
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
    this._sesionPendiente = acc.sesion || null;
    try {
      await this.repo.setupCentral(acc.secret);
      await this._vincular(acc);
      if (acc.usuario) await this.repo.aplicarPerfil(acc.usuario);
      await this._descargarCentral();
      const u = await this.repo.userByName(usuario);
      if (!u || !u.activo) throw new AppError('Tu usuario no está activo en el servidor central');
      if (dispositivo || this.device.nombre === 'Dispositivo') await this.repo.saveDevice({ nombre: dispositivo || 'Dispositivo de ' + u.nombre });
      await this.repo.establecerClaveLocal(u.id, password);
      if (acc.sesion) await this._guardarSesion(u.id, acc.sesion);
    } finally { this._sesionPendiente = null; }
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
      this._sesionPendiente = acc.sesion || null;
      try {
        await this.repo.unlockConSecreto(acc.secret);
        this.centralMeta = await this.central.meta();
        if (acc.modo === 'servidor' && this.centralMeta && this.centralMeta.modo !== 'servidor') { this.centralMeta.modo = 'servidor'; await this.repo.putDoc('central', this.centralMeta); }
        if (acc.usuario) await this.repo.aplicarPerfil(acc.usuario);
        if (this.centralMeta) await this.central.syncNow(); // perfiles al día (usuario nuevo o contraseña cambiada)
        const usr = await this.repo.userByName(u);
        if (!usr || !usr.activo) { this.repo.dek = null; throw new AppError('Usuario o contraseña incorrectos'); }
        await this.repo.establecerClaveLocal(usr.id, p);
        if (acc.sesion) await this._guardarSesion(usr.id, acc.sesion);
      } finally { this._sesionPendiente = null; }
      await this._afterLogin();
      return;
    }
    await this._afterLogin();
    // Modo servidor: sesión del servidor si este dispositivo aún no la tiene (sin conexión, se pedirá más tarde)
    if (this.modoServidor()) { if (!this._sesionToken()) this.renovarSesion(p).catch(err => { if (err.status === 403) this._cuentaNoActiva(err.message); }); }
    else this._provisionarCuenta(p).catch(err => console.warn('Cuenta central no publicada', err));
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
  async centralActivar({ codigo, password, nombre = 'Gestor de Emergencias UCO', modo = 'servidor' }) {
    this._needCentral();
    if (!(await this.repo.verifyPassword(password))) throw new AppError('Tu contraseña no es correcta');
    if (String(password).length < 8) throw new AppError('Para activar el servidor central tu contraseña debe tener al menos 8 caracteres: cámbiala antes en Sistema → Mi cuenta');
    const c = await this.consultarCentral();
    if (!c) throw new AppError('Sin conexión con el servidor central');
    if (c.org) throw new AppError('El servidor central ya está activado: conecta este dispositivo con tu usuario y contraseña');
    // 1.4.0: el espacio nace en modo servidor (el servidor valida usuarios y permisos). Un servidor anterior
    // no lo admite y sigue como hasta ahora (modo cifrado de extremo a extremo).
    const admin = modo === 'servidor' ? { id: this.user.id, usuario: this.user.usuario, nombre: this.user.nombre, password } : null;
    const m = await this.central.crear({ server: c.server, nombre, codigo, principal: true, admin, dev: this.device.id });
    await this.repo.setOrgWrap(m.secretBytes);
    await this.repo.setCentralPointer({ server: m.server, org: m.org, pruebas: m.pruebas, nombre: m.nombre });
    this.centralMeta = await this.central.meta(); this.repo.minPassword = 8;
    if (this.modoServidor()) {
      await this._guardarSesion(this.user.id, m.sesion);
      const u = await this.repo.marcarCuentaPublicada(this.user.id);
      u.perfil = 'rol_admin'; u.estado = 'activo'; u.metodo = 'password'; await this.repo.db.put('users', u);
    } else {
      await this._publicarDirectorio();
      await this.central.guardarCuenta(this.user.usuario, password);
      const u = await this.repo.marcarCuentaPublicada(this.user.id);
      await this.central.guardarConfig('usr:' + u.id, this.repo.perfil(u));
    }
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
    this._sesionPendiente = acc.sesion || null;
    let u;
    try {
      await this._vincular(acc);
      if (acc.usuario) await this.repo.aplicarPerfil(acc.usuario);
      await this._descargarCentral();
      // La sesión pasa a la cuenta común del usuario que ha conectado
      u = await this.repo.userByName(usuario);
      if (!u || !u.activo) throw new AppError('Tu usuario no está activo en el servidor central');
      await this.repo.establecerClaveLocal(u.id, password);
      if (acc.sesion) await this._guardarSesion(u.id, acc.sesion);
    } finally { this._sesionPendiente = null; }
    const d = await this.central.datos();
    if (this.modoServidor()) {
      // El servidor es quien da de alta a los usuarios: los que solo existían en este dispositivo se desactivan aquí
      for (const x of await this.repo.db.getAll('users')) if (!d.items['usr:' + x.id] && x.activo) { x.activo = false; x.estado = 'desactivado'; await this.repo.db.put('users', x); }
    } else if (this.can('usuarios.admin')) {
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
    if (this.modoServidor()) return; // el directorio lo lleva el servidor
    const d = await this.central.datos();
    if (!soloNuevos || !d.items.roles) await this.central.guardarConfig('roles', await this.repo.getRoles());
    for (const p of await this.repo.perfiles()) {
      if (soloNuevos && d.items['usr:' + p.id]) continue;
      await this.central.guardarConfig('usr:' + p.id, p);
    }
    // Tipos de recurso y unidades plantilla de este dispositivo que aún no estén en el espacio
    for (const [i, t] of this.tiposRecursoGenerales().entries()) if (!d.items['tipo:' + t.id]) await this.central.guardarConfig('tipo:' + t.id, { ...t, orden: i });
    for (const [i, p] of this.plantillasUnidad().entries()) if (!d.items['plt:' + p.id]) await this.central.guardarConfig('plt:' + p.id, { ...p, orden: i });
    for (const [i, m] of this.planosBiblioteca().entries()) if (!d.items['mapa:' + m.id]) await this.central.guardarConfig('mapa:' + m.id, { ...m, orden: i });
    if (!d.items.cartografia && this.cfg.cartografia && this.cfg.cartografia.googleKey) await this.central.guardarConfig('cartografia', this.cfg.cartografia);
  }
  /** Aplica cambios de configuración recibidos del espacio central (usuarios, roles…) */
  async _centralConfig(ids) {
    const d = await this.central.datos(); let usuarios = false;
    if (!this.cfg && this.repo.dek) this.cfg = this._migrarCfg(await this.repo.getCfg());
    const el = this.cfg ? this._eliminados() : null; let elCambio = false;
    const lista = (actual, pref, clase) => {
      // Aplica los elementos recibidos (tipo:… / plt:…) sobre la lista local, respetando el orden común.
      // Las bajas del espacio se aplican siempre (también si una migración local hubiera vuelto a añadir
      // el elemento) y quedan anotadas como eliminadas para que nada las reintroduzca.
      const m = new Map(actual.map((x, i) => [x.id, { ...x, orden: x.orden ?? i }]));
      let cambio = false;
      const claves = new Set(ids.filter(id => id.startsWith(pref)));
      if (clase) for (const [id, it] of Object.entries(d.items)) if (id.startsWith(pref) && it && it.borrado && (m.has(id.slice(pref.length)) || !el[clase].includes(id.slice(pref.length)))) claves.add(id);
      for (const id of claves) {
        const it = d.items[id]; const k = id.slice(pref.length); if (!it) continue;
        if (it.borrado || !it.data) {
          cambio = m.delete(k) || cambio;
          if (clase && !el[clase].includes(k)) { el[clase].push(k); elCambio = true; }
        } else {
          m.set(k, clone(it.data)); cambio = true;
          if (clase && el[clase].includes(k)) { el[clase] = el[clase].filter(x => x !== k); elCambio = true; }
        }
      }
      return cambio ? [...m.values()].sort((a, b) => (a.orden ?? 0) - (b.orden ?? 0)).map(x => { const y = { ...x }; delete y.orden; return y; }) : null;
    };
    const tipos = this.cfg ? lista(this.cfg.catalogos.tiposRecurso || [], 'tipo:', 'tiposRecurso') : null;
    const plts = this.cfg ? lista(this.cfg.plantillasUnidad || [], 'plt:', 'plantillasUnidad') : null;
    const mapas = this.cfg ? lista(this.cfg.bibliotecaPlanos || [], 'mapa:') : null;
    const carto = ids.includes('cartografia') && d.items.cartografia && !d.items.cartografia.borrado ? d.items.cartografia.data : null;
    if ((tipos || plts || mapas || carto || elCambio) && this.repo.dek) {
      const cfg = clone(this.cfg); if (tipos) cfg.catalogos.tiposRecurso = tipos; if (plts) cfg.plantillasUnidad = plts; if (mapas) cfg.bibliotecaPlanos = mapas; if (carto) cfg.cartografia = carto;
      if (elCambio) cfg.eliminados = el;
      await this.repo.saveCfg(cfg, 'Configuración recibida del servidor central'); this.cfg = this._migrarCfg(await this.repo.getCfg()); this.emit('cfg', {});
    }
    for (const id of ids) {
      const it = d.items[id]; if (!it) continue;
      if (id === 'roles') { if (Array.isArray(it.data) && !it.borrado) { await this.repo.putDoc('roles', it.data); usuarios = true; } }
      else if (id.startsWith('usr:')) { if (it.data) { await this.repo.aplicarPerfil(it.data, { borrado: !!it.borrado }); usuarios = true; } }
    }
    if (usuarios) await this._refrescarPermisos();
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
    if (this.modoServidor()) throw new AppError('Con el servidor central los usuarios se gestionan en Sistema → Usuarios y permisos del servidor');
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
    if (this.user && this.user.metodo === 'pin') throw new AppError('Tu cuenta entra con PIN: no tiene contraseña');
    await this.repo.changeOwnPassword(oldPwd, newPwd);
    if (this.centralMeta && this.modoServidor()) { await this.central.guardarCuenta(this.user.usuario, newPwd); return; } // el servidor publica el perfil
    if (this.centralMeta) {
      await this.central.guardarCuenta(this.user.usuario, newPwd);
      const u = await this.repo.marcarCuentaPublicada(this.user.id);
      await this.central.guardarConfig('usr:' + u.id, this.repo.perfil(u));
    }
  }
  async saveRoles(roles) {
    if (this.modoServidor()) throw new AppError('Con el servidor central los perfiles de permisos se gestionan en Sistema → Usuarios y permisos del servidor');
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
