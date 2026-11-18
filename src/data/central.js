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
import { orgKeys, seal, open, cuentaDerivar, sha256hex, CUENTA_ITER } from '../core/crypto.js';
import { normServer } from './sync.js';

export const CENTRAL_ESTADOS = {
  sin_configurar: 'Sin configurar', conectado: 'Conectado', sincronizando: 'Sincronizando…',
  sin_conexion: 'Sin conexión', error: 'Error', pendiente: 'Cambios pendientes',
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
    return { server, org: (j && j.org) || null, nombre: (j && j.nombre) || '', pruebas: !!(j && j.pruebas), version: j && j.version };
  }

  // ---------------- alta ----------------
  /** Primer dispositivo: crea el espacio central con el código de administración del servidor */
  async crear({ server, nombre, codigo, principal = true }) {
    server = normServer(server);
    if (!server) throw new AppError('No hay servidor central configurado');
    const secret = randomBytes(32); const k = await orgKeys(secret);
    const org = 'org_' + b64url(randomBytes(12));
    const r = await this._req(server, '/org', { method: 'POST', body: { org, tokenHash: k.tokenHash, nombre: nombre || '', pruebas: !!this.h.pruebas, codigo, principal } });
    const meta = { server, org, secret: b64(secret), nombre: nombre || '', pruebas: !!this.h.pruebas, alta: now(), lastSeq: 0, creador: true, principal: !!(r && r.principal) };
    await this.h.repo.putDoc('central', meta); await this._saveDatos(VACIO()); this._k = null;
    return { ...meta, secretBytes: secret };
  }
  /** Acceso con cuenta desde un dispositivo nuevo: devuelve el secreto del espacio. 403 = credenciales incorrectas */
  async acceder({ server, org, usuario, password }) {
    server = normServer(server);
    const uid = await cuentaUid(org, usuario); const base = '/org/' + encodeURIComponent(org) + '/acceso';
    const s = await this._req(server, base + '/sal', { method: 'POST', body: { uid } });
    const d = await cuentaDerivar(password, unb64(s.salt), s.iter);
    const r = await this._req(server, base, { method: 'POST', body: { uid, prueba: b64(d.prueba) } });
    let o; try { o = await open(d.envKey, r.wrap); } catch { throw new AppError('No se pudo abrir la clave del servidor central'); }
    return { server, org, secret: unb64(o.s), nombre: r.nombre || '', pruebas: !!r.pruebas };
  }
  /** Vincula este dispositivo al espacio con su secreto (obtenido con una cuenta o con un enlace de alta) */
  async unirConSecreto({ server, org, secret, nombre = '', pruebas = false }) {
    if (!!pruebas !== !!this.h.pruebas) throw new AppError(pruebas ? 'Ese espacio es del entorno de pruebas (CLAUDE_TEST): ábrelo en el entorno de pruebas' : 'Ese espacio es el real: no puede usarse en el entorno de pruebas');
    server = normServer(server);
    const k = await orgKeys(secret);
    const info = await this._req(server, '/org/' + encodeURIComponent(org), { token: k.token });
    const meta = { server, org, secret: b64(secret), nombre: info.nombre || nombre, pruebas: !!info.pruebas, alta: now(), lastSeq: 0, principal: !!info.principal };
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
    const d = await this.datos(); d.pendCuentas[await cuentaUid(meta.org, usuario)] = rec;
    await this._saveDatos(d); this.kick();
  }
  /** Retira la cuenta del servidor (usuario desactivado o renombrado): ya no podrá entrar en dispositivos nuevos */
  async borrarCuenta(usuario) {
    const meta = await this.meta(); if (!meta) return;
    const d = await this.datos(); d.pendCuentas[await cuentaUid(meta.org, usuario)] = null;
    await this._saveDatos(d); this.kick();
  }
  async olvidar() { this.stop(); await this.h.repo.delDoc('central'); await this.h.repo.delDoc('central:datos'); this._k = null; this._set({ estado: 'sin_configurar', error: null }); }
  codigoAlta(meta) { return encodeAltaCode({ server: meta.server, org: meta.org, secret: unb64(meta.secret), nombre: meta.nombre, pruebas: meta.pruebas }); }

  // ---------------- datos compartidos ----------------
  async registrarPrev(pid, info) {
    const d = await this.datos(); d.pendPrevs[pid] = info; d.registro[pid] = { ...(d.registro[pid] || {}), ...info, pid };
    await this._saveDatos(d); this.kick();
  }
  /** Guarda un elemento de la configuración general; se envía con la versión en la que se basaba */
  async guardarConfig(id, data, { borrado = false } = {}) {
    const d = await this.datos(); const cur = d.items[id];
    const base = d.pendCfg[id] ? d.pendCfg[id].base : cur ? cur.v : 0;
    d.pendCfg[id] = { base, data, borrado }; d.items[id] = { ...(cur || { v: 0 }), data, borrado, local: true };
    await this._saveDatos(d); this.kick();
    return d.items[id];
  }
  /** Resolver un conflicto de configuración: conservar la versión de este dispositivo o la del servidor */
  async resolverConfig(id, quedarse) {
    const d = await this.datos(); const c = d.conflictos[id]; if (!c) return;
    if (quedarse === 'mio') d.pendCfg[id] = { base: c.v, data: c.mio, borrado: !!c.mioBorrado };
    else { d.items[id] = { v: c.v, data: c.suyo, borrado: !!c.suyoBorrado }; delete d.pendCfg[id]; }
    delete d.conflictos[id]; await this._saveDatos(d); this.kick();
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
      this._set({ estado: 'sincronizando', server: meta.server });
      const k = await this.keys(meta); const tok = k.token; const base = '/org/' + encodeURIComponent(meta.org);
      const d = await this.datos(); const cambiados = [];
      // 1. Enviar registros de preventivos, cuentas y configuración pendientes
      for (const [pid, info] of Object.entries(d.pendPrevs)) {
        await this._req(meta.server, base + '/prevs/' + encodeURIComponent(pid), { method: 'PUT', token: tok, body: { w: await seal(k.key, { ...info, pid }) } });
        delete d.pendPrevs[pid];
      }
      for (const [uid, rec] of Object.entries(d.pendCuentas || {})) {
        await this._req(meta.server, base + '/cuentas/' + uid, rec ? { method: 'PUT', token: tok, body: rec } : { method: 'DELETE', token: tok });
        delete d.pendCuentas[uid];
      }
      for (const [id, p] of Object.entries(d.pendCfg)) {
        try {
          const r = await this._req(meta.server, base + '/config/' + encodeURIComponent(id), { method: 'PUT', token: tok, body: { base: p.base, c: await seal(k.key, { id, data: p.data }), borrado: !!p.borrado } });
          d.items[id] = { v: r.v, data: p.data, borrado: !!p.borrado, sq: r.sq }; cambiados.push(id);
        } catch (e) {
          if (e.status !== 409) throw e;
          const a = e.body && e.body.actual;
          const suyo = a ? (await open(k.key, a.c)).data : null;
          // Si el otro dispositivo guardó exactamente lo mismo no hay conflicto real
          if (!(a && !!a.borrado === !!p.borrado && stableStringify(suyo) === stableStringify(p.data))) d.conflictos[id] = { v: a ? a.v : 0, mio: p.data, mioBorrado: !!p.borrado, suyo, suyoBorrado: a ? !!a.borrado : true, t: now() };
          if (a) { d.items[id] = { v: a.v, data: suyo, borrado: !!a.borrado, sq: a.sq }; cambiados.push(id); }
        }
        delete d.pendCfg[id];
      }
      // 2. Recibir cambios de otros dispositivos
      const r = await this._req(meta.server, base + '/cambios?desde=' + (meta.lastSeq || 0), { token: tok });
      const entradas = [];
      for (const x of r.prevs) {
        try { const info = await open(k.key, x.w); d.registro[x.pid] = { ...info, pid: x.pid, sq: x.sq }; entradas.push(d.registro[x.pid]); } catch { /* entrada de otra clave: se ignora */ }
      }
      for (const x of r.config) {
        if (d.pendCfg[x.id]) continue; // hay un cambio local en vuelo: se resolverá al enviarlo
        try { const o = await open(k.key, x.c); d.items[x.id] = { v: x.v, data: o.data, borrado: !!x.borrado, sq: x.sq }; cambiados.push(x.id); } catch { }
      }
      meta.lastSeq = r.last; meta.ultimo = now();
      await this.h.repo.putDoc('central', meta); await this._saveDatos(d);
      if (entradas.length) await this.h.onPrevs(entradas);
      if (cambiados.length && this.h.onConfig) await this.h.onConfig([...new Set(cambiados)]);
      // 3. Latido (versión y última comunicación) como mucho cada minuto
      if (Date.now() - this._latido > 60000) {
        const dev = this.h.device();
        await this._req(meta.server, base + '/latido', { method: 'POST', token: tok, body: { dev: dev.id, nombre: dev.nombre || '', version: this.h.version } }).catch(() => { });
        this._latido = Date.now();
      }
      const pend = Object.keys(d.pendPrevs).length + Object.keys(d.pendCfg).length + Object.keys(d.pendCuentas || {}).length;
      return this._set({ estado: pend ? 'pendiente' : 'conectado', ultimo: now(), error: null, conflictos: Object.keys(d.conflictos).length });
    } catch (e) {
      return this._set({ estado: e.code === 'red' ? 'sin_conexion' : 'error', error: e.message, ultimoIntento: now() });
    }
  }
  async dispositivos() {
    const meta = await this.meta(); if (!meta) return {};
    const k = await this.keys(meta);
    return (await this._req(meta.server, '/org/' + encodeURIComponent(meta.org) + '/dispositivos', { token: k.token })).dispositivos;
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
