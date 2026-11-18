// Sincronización multidispositivo (modalidad compartida).
//  - Cada dispositivo trabaja siempre en local; el servidor solo intercambia
//    operaciones cifradas de extremo a extremo y asigna números de aviso.
//  - Si el servidor o la red fallan, se sigue trabajando y se reintenta.
//  - Alternativa sin red: paquetes de sincronización por archivo.
import { b64url, unb64url, enc, dec, b64, unb64, now, randomBytes, AppError } from '../core/util.js';
import { prevKeys, seal, open, sealBytes, openBytes } from '../core/crypto.js';

export const SYNC_ESTADOS = {
  sincronizado: 'Sincronizado', pendiente: 'Cambios pendientes', sin_conexion: 'Sin conexión', error: 'Error de sincronización',
  conflicto: 'Conflictos por resolver', local: 'Solo por archivo', desactivado: 'Independiente', sincronizando: 'Sincronizando…',
  bloqueado: 'Actualiza la aplicación',
};

export function encodeJoinCode({ server, pid, secret, nombre }) {
  return 'UCO1.' + b64url(enc.encode(JSON.stringify({ v: 1, s: server || '', p: pid, k: b64url(secret), n: nombre || '' })));
}
export function decodeJoinCode(code) {
  const m = String(code || '').trim().match(/UCO1\.([A-Za-z0-9_-]+)/);
  if (!m) throw new AppError('Código de incorporación no válido');
  let o; try { o = JSON.parse(dec.decode(unb64url(m[1]))); } catch { throw new AppError('Código de incorporación dañado'); }
  if (!o.p || !o.k) throw new AppError('Código de incorporación incompleto');
  return { server: normServer(o.s), pid: o.p, secret: unb64url(o.k), nombre: o.n || '' };
}
export function newSecret() { return randomBytes(16); }
export function normServer(s) { s = String(s || '').trim().replace(/\/+$/, ''); if (s && !/^https?:\/\//i.test(s)) s = 'https://' + s; return s; }

function transportBody(op) { const b = { ...op }; delete b.sq; delete b.num; delete b.ps; return b; }

export class SyncManager {
  /**
   * hooks: { repo, onRemoteOps(pid, ops), onNumber(pid, opId, num), getPlano(pid) }
   */
  constructor(hooks) { this.h = hooks; this.keysCache = new Map(); this.st = new Map(); this.timers = new Map(); this.running = new Set(); this.fetch = (...a) => globalThis.fetch(...a); this.intervalMs = 5000; }

  status(pid) { return this.st.get(pid) || { estado: 'desactivado' }; }
  _set(pid, patch) { const s = { ...this.status(pid), ...patch }; this.st.set(pid, s); this.h.onStatus && this.h.onStatus(pid, s); return s; }

  async keys(pid) {
    if (this.keysCache.has(pid)) return this.keysCache.get(pid);
    const meta = await this.h.repo.getPrevMeta(pid);
    if (!meta.secret) throw new AppError('Este preventivo no tiene clave de sincronización');
    const k = await prevKeys(unb64(meta.secret));
    this.keysCache.set(pid, k); return k;
  }
  async _req(server, path, { method = 'GET', token, body, raw = false, timeout = 20000 } = {}) {
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const tm = ctl ? setTimeout(() => ctl.abort(), timeout) : null;
    try {
      const headers = {};
      if (token) headers.Authorization = 'Bearer ' + token;
      let b = body;
      if (body && !(body instanceof Uint8Array)) { headers['Content-Type'] = 'application/json'; b = JSON.stringify(body); }
      else if (body) headers['Content-Type'] = 'application/octet-stream';
      const r = await this.fetch(server + '/api/v1' + path, { method, headers, body: b, signal: ctl ? ctl.signal : undefined, cache: 'no-store' });
      if (!r.ok) {
        let msg = 'Error ' + r.status; try { const j = await r.json(); if (j.error) msg = j.error; } catch { }
        throw Object.assign(new AppError(msg, 'http'), { status: r.status });
      }
      return raw ? new Uint8Array(await r.arrayBuffer()) : r.json();
    } catch (e) {
      if (e && e.code === 'http') throw e;
      throw Object.assign(new AppError('Sin conexión con el servidor', 'red'), { cause: e });
    } finally { if (tm) clearTimeout(tm); }
  }
  async ping(server) { return this._req(normServer(server), '/salud', { timeout: 8000 }); }

  async register(pid, { startNum = 0 } = {}) {
    const meta = await this.h.repo.getPrevMeta(pid);
    if (!meta.server) throw new AppError('No hay servidor configurado');
    const k = await this.keys(pid);
    const r = await this._req(meta.server, '/prev', { method: 'POST', body: { pid, tokenHash: k.tokenHash, startNum } });
    meta.registrado = true; await this.h.repo.savePrevMeta(pid, meta);
    return r;
  }

  async push(pid, meta, k) {
    let total = 0;
    for (;;) {
      const pend = await this.h.repo.pendingOps(pid);
      if (!pend.length) break;
      const chunk = pend.slice(0, 200);
      const body = { ops: await Promise.all(chunk.map(async op => ({ id: op.id, d: op.d, h: op.h, nn: !!op.nn, num: op.num ?? null, c: await seal(k.key, transportBody(op)) }))) };
      const r = await this._req(meta.server, '/prev/' + encodeURIComponent(pid) + '/ops', { method: 'POST', token: k.token, body });
      await this.h.repo.markSynced(r.res);
      for (const x of r.res) if (x.num != null) this.h.onNumber(pid, x.id, x.num);
      total += chunk.length;
      if (pend.length <= 200) break;
    }
    return total;
  }

  async pull(pid, meta, k) {
    let total = 0, after = meta.lastSq || 0;
    for (;;) {
      const r = await this._req(meta.server, '/prev/' + encodeURIComponent(pid) + '/ops?after=' + after + '&limit=500', { token: k.token });
      const nuevos = [];
      for (const x of r.ops) {
        const m = await this.h.repo.opMeta(x.id);
        if (m) {
          const prevNum = m.num;
          if (await this.h.repo.setOpServerMeta(x.id, x.sq, x.num) && x.num != null && prevNum !== x.num) this.h.onNumber(pid, x.id, x.num);
          continue;
        }
        let op; try { op = await open(k.key, x.c); } catch { throw new AppError('No se pudo descifrar una operación: la clave del preventivo no coincide'); }
        if (op.p !== pid) continue;
        op.sq = x.sq; op.num = x.num ?? null; nuevos.push(op);
      }
      if (nuevos.length) { await this.h.repo.storeRemoteOps(pid, nuevos); await this.h.onRemoteOps(pid, nuevos); total += nuevos.length; }
      after = r.ops.length ? r.ops[r.ops.length - 1].sq : after;
      meta.lastSq = after; await this.h.repo.savePrevMeta(pid, meta);
      if (!r.more) break;
    }
    return total;
  }

  async syncBlobs(pid, meta, k) {
    const plano = this.h.getPlano && this.h.getPlano(pid);
    if (!plano || !plano.blob) return;
    meta.blobsSubidos = meta.blobsSubidos || [];
    const path = '/prev/' + encodeURIComponent(pid) + '/blobs/' + plano.blob;
    if (await this.h.repo.hasBlob(plano.blob)) {
      if (!meta.blobsSubidos.includes(plano.blob)) {
        const b = await this.h.repo.getBlob(plano.blob);
        await this._req(meta.server, path, { method: 'PUT', token: k.token, body: await sealBytes(k.key, b.bytes) });
        meta.blobsSubidos.push(plano.blob); await this.h.repo.savePrevMeta(pid, meta);
      }
    } else {
      try {
        const data = await this._req(meta.server, path, { token: k.token, raw: true });
        const bytes = await openBytes(k.key, data);
        await this.h.repo.putBlob(bytes, { mime: plano.mime, w: plano.w, h: plano.h, nombre: plano.nombre });
        this.h.onBlob && this.h.onBlob(pid, plano.blob);
      } catch (e) { if (!(e.status === 404)) throw e; }
    }
  }

  /** Un ciclo completo: registrar, enviar, recibir, archivos */
  async syncNow(pid) {
    if (this.running.has(pid)) return this.status(pid);
    this.running.add(pid);
    try {
      const meta = await this.h.repo.getPrevMeta(pid);
      if (meta.modalidad !== 'compartida') return this._set(pid, { estado: 'desactivado' });
      if (!meta.server) return this._set(pid, { estado: 'local', pendientes: await this.h.repo.countPending(pid) });
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return this._set(pid, { estado: 'sin_conexion', pendientes: await this.h.repo.countPending(pid) });
      // Aplicación anterior a la mínima que admite el servidor: los cambios se guardan aquí y se envían al actualizar
      const bloqueo = this.h.bloqueo && this.h.bloqueo(meta.server);
      if (bloqueo) return this._set(pid, { estado: 'bloqueado', error: bloqueo, pendientes: await this.h.repo.countPending(pid) });
      this._set(pid, { estado: 'sincronizando' });
      const k = await this.keys(pid);
      if (!meta.registrado) await this.register(pid, { startNum: meta.startNum || 0 });
      const pushed = await this.push(pid, meta, k);
      const pulled = await this.pull(pid, meta, k);
      await this.syncBlobs(pid, meta, k);
      const pendientes = await this.h.repo.countPending(pid);
      this.fails = 0;
      return this._set(pid, { estado: pendientes ? 'pendiente' : 'sincronizado', pendientes, ultimo: now(), error: null, pushed, pulled });
    } catch (e) {
      this.fails = (this.fails || 0) + 1;
      const pendientes = await this.h.repo.countPending(pid).catch(() => 0);
      return this._set(pid, { estado: e.code === 'red' ? 'sin_conexion' : 'error', error: e.message, pendientes, ultimoIntento: now() });
    } finally { this.running.delete(pid); }
  }

  /** Bucle automático con reintentos (espera exponencial ante errores) */
  start(pid) {
    this.stop(pid);
    const loop = async () => {
      const st = await this.syncNow(pid);
      const errorish = st.estado === 'error' || st.estado === 'sin_conexion';
      const wait = errorish ? Math.min(60000, 2000 * 2 ** Math.min(5, (this.fails || 1) - 1)) : this.intervalMs;
      if (this.timers.has(pid)) this.timers.set(pid, setTimeout(loop, wait));
    };
    this.timers.set(pid, setTimeout(loop, 50));
  }
  stop(pid) { const t = this.timers.get(pid); if (t) clearTimeout(t); this.timers.delete(pid); }
  stopAll() { for (const pid of [...this.timers.keys()]) this.stop(pid); }
  kick(pid) {
    if (!this.timers.has(pid)) return;
    clearTimeout(this._kickT); this._kickT = setTimeout(() => this.syncNow(pid), 300);
  }

  // --------- sincronización por archivo ---------
  async exportBundle(pid, nombre) {
    const k = await this.keys(pid);
    const ops = await this.h.repo.loadOps(pid);
    const plano = this.h.getPlano && this.h.getPlano(pid);
    const blobs = [];
    if (plano && plano.blob && await this.h.repo.hasBlob(plano.blob)) {
      const b = await this.h.repo.getBlob(plano.blob);
      blobs.push({ id: plano.blob, mime: b.mime, w: b.w, h: b.h, nombre: b.nombre, c: b64(await sealBytes(k.key, b.bytes)) });
    }
    return JSON.stringify({
      formato: 'uco-sync', version: 1, pid, nombre: nombre || '', creado: now(),
      ops: await Promise.all(ops.map(async op => ({ id: op.id, d: op.d, h: op.h, num: op.num ?? null, sq: op.sq ?? null, c: await seal(k.key, transportBody(op)) }))),
      blobs,
    });
  }
  async importBundle(text) {
    let b; try { b = JSON.parse(text); } catch { throw new AppError('Archivo de sincronización no válido'); }
    if (b.formato !== 'uco-sync') throw new AppError('El archivo no es un paquete de sincronización del Gestor UCO');
    const pid = b.pid; const k = await this.keys(pid);
    const nuevos = []; const nums = [];
    for (let i = 0; i < b.ops.length; i += 256) {
      const lote = b.ops.slice(i, i + 256);
      const metas = await Promise.all(lote.map(x => this.h.repo.opMeta(x.id)));
      const abiertos = await Promise.all(lote.map(async (x, j) => {
        if (metas[j]) return null;
        try { return await open(k.key, x.c); } catch { return undefined; }
      }));
      for (let j = 0; j < lote.length; j++) {
        const x = lote[j], m = metas[j];
        if (m) { if (x.num != null && m.num == null) { await this.h.repo.setOpServerMeta(x.id, m.sq ?? x.sq, x.num); nums.push([x.id, x.num]); } continue; }
        const op = abiertos[j];
        if (!op) throw new AppError('El paquete pertenece a otro preventivo o la clave no coincide');
        op.num = x.num ?? null; op.sq = x.sq ?? null; nuevos.push(op);
      }
    }
    if (nuevos.length) { await this.h.repo.storeRemoteOps(pid, nuevos); await this.h.onRemoteOps(pid, nuevos); }
    for (const [id, n] of nums) this.h.onNumber(pid, id, n);
    for (const bl of b.blobs || []) if (!(await this.h.repo.hasBlob(bl.id))) await this.h.repo.putBlob(await openBytes(k.key, unb64(bl.c)), bl);
    return { pid, nuevas: nuevos.length, total: b.ops.length };
  }
}
