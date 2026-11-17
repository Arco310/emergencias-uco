// Núcleo de la aplicación: une repositorio cifrado, motor de preventivos,
// comandos de negocio y sincronización. La interfaz solo habla con esta capa.
import { Repo } from '../data/repo.js';
import { SyncManager, newSecret, decodeJoinCode, encodeJoinCode, normServer } from '../data/sync.js';
import { Engine } from '../core/engine.js';
import { HLC } from '../core/hlc.js';
import * as C from '../core/commands.js';
import { uid, now, b64, unb64, AppError, clone } from '../core/util.js';
import { contentFromPrev, seedFromTemplate, newTemplate, contentFromConfig } from '../core/templates.js';
import { counts } from '../core/engine.js';

export class AppCore {
  constructor(storage) {
    this.storage = storage;
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
  }
  on(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  emit(type, data) { for (const fn of this.listeners) { try { fn(type, data); } catch (e) { console.error(e); } } }

  // ------------- arranque y sesión -------------
  async boot() {
    this.device = await this.repo.init();
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
  get user() { return this.repo.session ? this.repo.session.user : null; }
  can(p) { return !!(this.user && this.user.perms.has(p)); }
  async setup(data) { const r = await this.repo.setup(data); await this._afterLogin(); return r; }
  async login(u, p) { await this.repo.login(u, p); await this._afterLogin(); }
  async recover(code, u, p) { await this.repo.recover(code, u, p); await this._afterLogin(); }
  async _afterLogin() {
    this.cfg = await this.repo.getCfg();
    this.sync.intervalMs = Math.max(2, Number(this.cfg.syncIntervaloSeg) || 5) * 1000;
    this.summaries = await this.repo.listSummaries();
    clearInterval(this._bk);
    this._bk = setInterval(() => this.autoBackup(), Math.max(1, Number(this.cfg.copiaAutoMin) || 10) * 60000);
    this.emit('session', {});
  }
  async logout() {
    await this.autoBackup();
    this.sync.stopAll(); clearInterval(this._bk);
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
  }
  async refreshSummaries() { this.summaries = await this.repo.listSummaries(); return this.summaries; }

  async createPrev({ datos, seed, server = '' }) {
    const pid = uid('prev_');
    const engine = new Engine();
    const shared = datos.modalidad === 'compartida';
    const meta = { modalidad: datos.modalidad, nombre: datos.nombre, creado: now() };
    if (shared) { meta.secret = b64(newSecret()); meta.server = normServer(server || this.cfg.syncServidor || ''); meta.lastSq = 0; meta.registrado = false; }
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
      meta.server = normServer(server || meta.server || this.cfg.syncServidor || '');
      meta.startNum = e.state.maxNum; meta.registrado = false; meta.lastSq = meta.lastSq || 0;
      meta.modalidad = 'compartida';
      await this.repo.savePrevMeta(pid, meta); this.metas.set(pid, meta); this.sync.keysCache.delete(pid);
      await this.repo.markAllPending(pid);
      this.sync.start(pid);
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
