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
  bloqueado: 'Actualiza la aplicación', sesion: 'Inicia sesión para sincronizar', cuenta: 'Cuenta no activa',
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

function transportBody(op) { const b = { ...op }; delete b.sq; delete b.num; delete b.ps; delete b.rx; delete b.sy; return b; }

export class SyncManager {
  /**
   * hooks: { repo, onRemoteOps(pid, ops), onNumber(pid, opId, num), getPlano(pid) }
   */
  constructor(hooks) { this.h = hooks; this.keysCache = new Map(); this.st = new Map(); this.timers = new Map(); this.running = new Map(); this.otraVez = new Map(); this.fetch = (...a) => globalThis.fetch(...a); this.intervalMs = 5000; }

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
        let msg = 'Error ' + r.status; let j = null; try { j = await r.json(); if (j.error) msg = j.error; } catch { }
        throw Object.assign(new AppError(msg, 'http'), { status: r.status, body: j });
      }
      return raw ? new Uint8Array(await r.arrayBuffer()) : r.json();
    } catch (e) {
      if (e && e.code === 'http') throw e;
      throw Object.assign(new AppError('Sin conexión con el servidor', 'red'), { cause: e });
    } finally { if (tm) clearTimeout(tm); }
  }
  async ping(server) { return this._req(normServer(server), '/salud', { timeout: 8000 }); }

  async register(pid, { startNum = 0, kk = null } = {}) {
    const meta = await this.h.repo.getPrevMeta(pid);
    if (!meta.server) throw new AppError('No hay servidor configurado');
    const k = await this.keys(pid);
    // Espacio en modo servidor: lo registra el usuario con su sesión y el servidor custodia la clave del preventivo
    const ms = kk && kk.ms;
    const r = await this._req(meta.server, '/prev', { method: 'POST', token: ms ? kk.token : undefined, body: { pid, tokenHash: k.tokenHash, startNum, ...(ms ? { org: ms.org, secret: meta.secret } : {}) } });
    meta.registrado = true; await this.h.repo.savePrevMeta(pid, meta);
    return r;
  }

  async push(pid, meta, k) {
    let total = 0; const sinSesion = new Set();
    for (;;) {
      let pend = await this.h.repo.pendingOps(pid);
      // Modo servidor: cada operación va con la sesión de su autor (el servidor comprueba que coincide)
      if (k.ms) pend = pend.filter(op => { const t = k.ms.sesion(op.u && op.u.id); if (!t) sinSesion.add(op.u ? op.u.n || op.u.id : '?'); return !!t; });
      if (!pend.length) break;
      const autor = k.ms ? pend[0].u && pend[0].u.id : null;
      const delAutor = k.ms ? pend.filter(op => op.u && op.u.id === autor) : pend;
      // Un lote (misma acción) nunca se parte entre dos envíos: el servidor lo valida junto
      let n = Math.min(200, delAutor.length); while (n < delAutor.length && delAutor[n].b && delAutor[n].b === delAutor[n - 1].b) n++;
      const chunk = delAutor.slice(0, n);
      const body = { ops: await Promise.all(chunk.map(async op => ({ id: op.id, d: op.d, h: op.h, nn: !!op.nn, num: op.num ?? null, c: await seal(k.key, transportBody(op)) }))) };
      const r = await this._req(meta.server, '/prev/' + encodeURIComponent(pid) + '/ops', { method: 'POST', token: k.ms ? k.ms.sesion(autor) : k.token, body });
      const rech = r.res.filter(x => x.rechazada);
      await this.h.repo.markSynced(r.res.filter(x => !x.rechazada));
      for (const x of r.res) if (x.num != null) this.h.onNumber(pid, x.id, x.num);
      if (rech.length) {
        // Rechazadas por el servidor (permisos, reglas o datos antiguos): se quitan de este dispositivo y se avisa
        const porId = new Map(chunk.map(op => [op.id, op]));
        await this.h.repo.descartarOps(rech.map(x => x.id));
        if (this.h.onRechazos) await this.h.onRechazos(pid, rech.map(x => ({ ...x, op: porId.get(x.id) || null })));
      }
      total += chunk.length;
      if (pend.length <= chunk.length) break;
    }
    if (sinSesion.size) this._sinSesion = [...sinSesion];
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
          if (await this.h.repo.setOpServerMeta(x.id, x.sq, x.num, x.rx ?? null) && x.num != null && prevNum !== x.num) this.h.onNumber(pid, x.id, x.num);
          continue;
        }
        let op; try { op = await open(k.key, x.c); } catch { throw new AppError('No se pudo descifrar una operación: la clave del preventivo no coincide'); }
        if (op.p !== pid) continue;
        // Las horas del servidor y de recepción las fija quien las conoce, nunca el contenido de la operación
        op.sq = x.sq; op.num = x.num ?? null; op.rx = x.rx ?? null; op.sy = now(); nuevos.push(op);
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
  /** Sincroniza ahora. Si ya hay una sincronización en curso de ese preventivo, espera a que termine y
   *  vuelve a sincronizar una vez (puede haber cambios posteriores): nunca devuelve un estado sin sincronizar. */
  syncNow(pid) {
    if (this.running.has(pid)) {
      if (!this.otraVez.has(pid)) this.otraVez.set(pid, this.running.get(pid).catch(() => null).then(() => { this.otraVez.delete(pid); return this.syncNow(pid); }));
      return this.otraVez.get(pid);
    }
    const p = this._syncNow(pid).finally(() => this.running.delete(pid));
    this.running.set(pid, p);
    return p;
  }
  async _syncNow(pid) {
    try {
      const meta = await this.h.repo.getPrevMeta(pid);
      if (meta.modalidad !== 'compartida') return this._set(pid, { estado: 'desactivado' });
      if (!meta.server) return this._set(pid, { estado: 'local', pendientes: await this.h.repo.countPending(pid) });
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return this._set(pid, { estado: 'sin_conexion', pendientes: await this.h.repo.countPending(pid) });
      // Aplicación anterior a la mínima que admite el servidor: los cambios se guardan aquí y se envían al actualizar
      const bloqueo = this.h.bloqueo && this.h.bloqueo(meta.server);
      if (bloqueo) return this._set(pid, { estado: 'bloqueado', error: bloqueo, pendientes: await this.h.repo.countPending(pid) });
      this._set(pid, { estado: 'sincronizando' });
      const k0 = await this.keys(pid);
      // Espacio central en modo servidor (1.4.0): las peticiones van con la sesión del usuario, no con el token del preventivo
      const ms = this.h.modoServidor ? this.h.modoServidor(pid, meta) : null;
      let k = k0;
      if (ms) {
        const tok = ms.sesion();
        if (!tok) return this._set(pid, { estado: 'sesion', error: 'Inicia sesión con conexión para sincronizar', pendientes: await this.h.repo.countPending(pid) });
        k = { key: k0.key, tokenHash: k0.tokenHash, token: tok, ms };
      }
      if (!meta.registrado) await this.register(pid, { startNum: meta.startNum || 0, kk: k });
      this._sinSesion = null;
      const pushed = await this.push(pid, meta, k);
      const pulled = await this.pull(pid, meta, k);
      await this.syncBlobs(pid, meta, k);
      const pendientes = await this.h.repo.countPending(pid);
      this.fails = 0;
      return this._set(pid, { estado: pendientes ? 'pendiente' : 'sincronizado', pendientes, ultimo: now(), error: null, pushed, pulled, sinSesion: this._sinSesion });
    } catch (e) {
      this.fails = (this.fails || 0) + 1;
      const pendientes = await this.h.repo.countPending(pid).catch(() => 0);
      if (e.status === 401 && e.body && e.body.codigo === 'sesion') { this.h.onSesion && this.h.onSesion(e.message); return this._set(pid, { estado: 'sesion', error: e.message, pendientes, ultimoIntento: now() }); }
      if (e.status === 403 && e.body && String(e.body.codigo || '').startsWith('cuenta_')) { if (this.h.onCuenta) await this.h.onCuenta(e.message); return this._set(pid, { estado: 'cuenta', error: e.message, pendientes, ultimoIntento: now() }); }
      return this._set(pid, { estado: e.code === 'red' ? 'sin_conexion' : 'error', error: e.message, pendientes, ultimoIntento: now() });
    }
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
      ops: await Promise.all(ops.map(async op => ({ id: op.id, d: op.d, h: op.h, num: op.num ?? null, sq: op.sq ?? null, rx: op.rx ?? null, c: await seal(k.key, transportBody(op)) }))),
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
        op.num = x.num ?? null; op.sq = x.sq ?? null; op.rx = x.rx ?? null; op.sy = now(); nuevos.push(op);
      }
    }
    if (nuevos.length) { await this.h.repo.storeRemoteOps(pid, nuevos); await this.h.onRemoteOps(pid, nuevos); }
    for (const [id, n] of nums) this.h.onNumber(pid, id, n);
    for (const bl of b.blobs || []) if (!(await this.h.repo.hasBlob(bl.id))) await this.h.repo.putBlob(await openBytes(k.key, unb64(bl.c)), bl);
    return { pid, nuevas: nuevos.length, total: b.ops.length };
  }
}
