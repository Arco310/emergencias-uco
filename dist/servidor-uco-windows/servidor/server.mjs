#!/usr/bin/env node
// Servidor de sincronización del Gestor de Emergencias UCO.
// - Sin dependencias (solo Node.js 18+). Gratuito y autoalojado.
// - Almacena las operaciones CIFRADAS de extremo a extremo: el servidor no puede leer los datos.
// - Asigna números de aviso definitivos y correlativos (por orden de llegada).
// - Opcionalmente sirve la propia aplicación (--static) para alojar todo en un único sitio.
// - Espacio central (organización): registro de preventivos y configuración general compartidos,
//   también cifrados de extremo a extremo con la clave de la organización (que el servidor no conoce).
//   Crear un espacio central exige el código de administración del servidor.
//
// Uso: node server.mjs --port 8443 --data ./datos [--static ../dist/app] [--cert cert.pem --key key.pem]
//                      [--origins https://usuario.github.io] [--host 0.0.0.0] [--admin-file ruta]
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const VERSION = '1.1.0';
const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'true']);
  return acc;
}, []));
const PORT = Number(args.port || process.env.PORT || 8443);
const HOST = args.host || '0.0.0.0';
const DATA = path.resolve(args.data || './datos-servidor');
const STATIC = args.static ? path.resolve(args.static) : null;
const ORIGINS = (args.origins || process.env.ORIGINS || '*').split(',').map(s => s.trim()).filter(Boolean);
const MAX_BODY = 25 * 1024 * 1024;
fs.mkdirSync(DATA, { recursive: true });
const ORG_DIR = path.join(DATA, '_org');
// Código de administración del servidor: se genera la primera vez y se guarda junto a los datos.
// El instalador de Windows restringe el acceso a esa carpeta a administradores y SYSTEM.
const ADMIN_FILE = path.resolve(args['admin-file'] || path.join(DATA, '_servidor', 'codigo-admin.txt'));
function codigoAdmin() {
  if (process.env.UCO_CODIGO_ADMIN) return process.env.UCO_CODIGO_ADMIN.trim();
  if (!fs.existsSync(ADMIN_FILE)) {
    const ABC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; const b = crypto.randomBytes(20);
    const code = Array.from(b, x => ABC[x % ABC.length]).join('').match(/.{5}/g).join('-');
    fs.mkdirSync(path.dirname(ADMIN_FILE), { recursive: true });
    fs.writeFileSync(ADMIN_FILE, code + '\n', { mode: 0o600 });
    log('Código de administración del servidor creado en', ADMIN_FILE);
  }
  return fs.readFileSync(ADMIN_FILE, 'utf8').trim();
}
// Código SOLO para pruebas (perfil CLAUDE_TEST): permite crear y borrar espacios de pruebas, nunca el real.
const PRUEBAS_FILE = path.resolve(args['pruebas-file'] || path.join(DATA, '_servidor', 'codigo-pruebas.txt'));
function nuevoCodigo(file, etiqueta) {
  const ABC = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; const b = crypto.randomBytes(20);
  const code = Array.from(b, x => ABC[x % ABC.length]).join('').match(/.{5}/g).join('-');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, code + '\n', { mode: 0o600 });
  log(etiqueta + ' creado en', file);
}
function codigoPruebas() {
  if (process.env.UCO_CODIGO_PRUEBAS) return process.env.UCO_CODIGO_PRUEBAS.trim();
  if (!fs.existsSync(PRUEBAS_FILE)) nuevoCodigo(PRUEBAS_FILE, 'Código de pruebas (CLAUDE_TEST)');
  return fs.readFileSync(PRUEBAS_FILE, 'utf8').trim();
}
// Secreto del servidor: solo para respuestas señuelo (no revela qué cuentas existen)
const SECRETO_FILE = path.join(DATA, '_servidor', 'secreto.bin');
let SECRETO = null;
function secretoServidor() {
  if (SECRETO) return SECRETO;
  if (!fs.existsSync(SECRETO_FILE)) { fs.mkdirSync(path.dirname(SECRETO_FILE), { recursive: true }); fs.writeFileSync(SECRETO_FILE, crypto.randomBytes(32), { mode: 0o600 }); }
  return (SECRETO = fs.readFileSync(SECRETO_FILE));
}
const normCodigo = s => String(s || '').toUpperCase().replace(/[^0-9A-Z]/g, '');
// Límite de intentos con código erróneo (global: detrás de Tailscale todas las peticiones llegan desde 127.0.0.1)
const fallos = { n: 0, desde: 0 };
function comprobarCodigo(codigo, { pruebas = false } = {}) {
  if (Date.now() - fallos.desde > 15 * 60000) { fallos.n = 0; fallos.desde = Date.now(); }
  if (fallos.n >= 10) throw Object.assign(new Error('Demasiados intentos fallidos; espera 15 minutos'), { status: 429 });
  const c = normCodigo(codigo);
  if (c && safeEq(c, normCodigo(codigoAdmin()))) return 'admin';
  if (c && pruebas && safeEq(c, normCodigo(codigoPruebas()))) return 'pruebas';
  fallos.n++;
  throw Object.assign(new Error('Código de administración del servidor incorrecto'), { status: 403 });
}
// Espacio central principal de cada entorno: lo que encuentra una app recién instalada
const CENTRAL_FILE = path.join(DATA, '_servidor', 'central.json');
function principal() { try { return JSON.parse(fs.readFileSync(CENTRAL_FILE, 'utf8')); } catch { return { produccion: null, pruebas: null }; } }
function guardarPrincipal(p) { fs.mkdirSync(path.dirname(CENTRAL_FILE), { recursive: true }); writeAtomic(CENTRAL_FILE, JSON.stringify(p)); }
// Cuentas: límite de intentos por cuenta y global (la contraseña nunca llega al servidor)
const CUENTA_ITER = 600000;
const fallosCuenta = new Map(); const fallosAcceso = { n: 0, desde: 0 };
function limiteAcceso(uid) {
  const t = Date.now();
  if (t - fallosAcceso.desde > 15 * 60000) { fallosAcceso.n = 0; fallosAcceso.desde = t; }
  const f = fallosCuenta.get(uid);
  if (f && t - f.desde > 15 * 60000) fallosCuenta.delete(uid);
  if (fallosAcceso.n >= 200 || (fallosCuenta.get(uid) || { n: 0 }).n >= 8) throw Object.assign(new Error('Demasiados intentos fallidos; espera 15 minutos'), { status: 429 });
}
function falloAcceso(uid) {
  fallosAcceso.n++;
  const f = fallosCuenta.get(uid) || { n: 0, desde: Date.now() }; f.n++; fallosCuenta.set(uid, f);
  if (fallosCuenta.size > 10000) fallosCuenta.clear();
}

const PID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{3,79}$/; // no empieza por «_»: reservado para _org y _servidor
const ORG_RE = /^org_[A-Za-z0-9_-]{4,60}$/;
const ITEM_RE = /^[A-Za-z0-9_:.-]{1,100}$/;
const UID_RE = /^[0-9a-f]{64}$/;
const ID_RE = /^[A-Za-z0-9_:.-]{1,120}$/;
const cache = new Map();

function log(...a) { if (!args.quiet) console.log(new Date().toISOString(), ...a); }
function sha256hex(s) { return crypto.createHash('sha256').update(s).digest('hex'); }
function safeEq(a, b) { const x = Buffer.from(String(a)), y = Buffer.from(String(b)); return x.length === y.length && crypto.timingSafeEqual(x, y); }
function writeAtomic(file, data) { const tmp = file + '.tmp'; fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); }

function load(pid) {
  if (cache.has(pid)) return cache.get(pid);
  const dir = path.join(DATA, pid);
  const metaFile = path.join(dir, 'meta.json');
  if (!fs.existsSync(metaFile)) return null;
  const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
  const ops = []; const ids = new Map();
  const opsFile = path.join(dir, 'ops.jsonl');
  if (fs.existsSync(opsFile)) {
    for (const line of fs.readFileSync(opsFile, 'utf8').split('\n')) {
      if (!line.trim()) continue;
      try { const o = JSON.parse(line); if (!ids.has(o.id)) { ids.set(o.id, o); ops.push(o); } } catch { /* línea incompleta tras un corte: se ignora */ }
    }
  }
  // Coherencia de contadores tras un posible corte de energía
  for (const o of ops) { if (o.sq >= meta.nextSq) meta.nextSq = o.sq + 1; if (o.num != null && o.num >= meta.nextNum) meta.nextNum = o.num + 1; }
  const p = { dir, meta, ops, ids };
  cache.set(pid, p); return p;
}

function appendDurable(file, text) {
  const fd = fs.openSync(file, 'a');
  try { fs.writeSync(fd, text); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function cors(req, res) {
  const origin = req.headers.origin;
  if (ORIGINS.includes('*')) res.setHeader('Access-Control-Allow-Origin', '*');
  else if (origin && ORIGINS.includes(origin)) { res.setHeader('Access-Control-Allow-Origin', origin); res.setHeader('Vary', 'Origin'); }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization,Content-Type');
  res.setHeader('Access-Control-Max-Age', '600');
  if (req.headers['access-control-request-private-network']) res.setHeader('Access-Control-Allow-Private-Network', 'true');
}
function send(res, code, obj, headers = {}) {
  const body = typeof obj === 'string' || Buffer.isBuffer(obj) ? obj : JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': typeof obj === 'object' && !Buffer.isBuffer(obj) ? 'application/json; charset=utf-8' : 'application/octet-stream', 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let n = 0;
    req.on('data', c => { n += c.length; if (n > MAX_BODY) { reject(Object.assign(new Error('Cuerpo demasiado grande'), { status: 413 })); req.destroy(); } else chunks.push(c); });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
async function readJson(req) { const b = await readBody(req); try { return JSON.parse(b.toString('utf8') || '{}'); } catch { throw Object.assign(new Error('JSON no válido'), { status: 400 }); } }
function auth(req, p) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  return tok && safeEq(sha256hex(tok), p.meta.tokenHash);
}

// ---------------- espacio central (organización) ----------------
const orgs = new Map();
function orgLoad(org) {
  if (orgs.has(org)) return orgs.get(org);
  const dir = path.join(ORG_DIR, org);
  const f = n => path.join(dir, n);
  if (!fs.existsSync(f('meta.json'))) return null;
  const rd = (n, def) => { try { return JSON.parse(fs.readFileSync(f(n), 'utf8')); } catch { return def; } };
  const o = { dir, meta: rd('meta.json', null), prevs: rd('prevs.json', {}), config: rd('config.json', {}), disp: rd('dispositivos.json', {}), cuentas: rd('cuentas.json', {}) };
  orgs.set(org, o); return o;
}
function orgSave(o, ...names) {
  const datos = { meta: o.meta, prevs: o.prevs, config: o.config, dispositivos: o.disp, cuentas: o.cuentas };
  for (const n of names) writeAtomic(path.join(o.dir, n + '.json'), JSON.stringify(datos[n]));
}
function orgAuth(req, o) {
  const h = req.headers.authorization || '';
  const tok = h.startsWith('Bearer ') ? h.slice(7) : '';
  return tok && safeEq(sha256hex(tok), o.meta.tokenHash);
}
async function apiOrg(req, res, url, parts) {
  if (parts.length === 3 && req.method === 'POST') {
    const b = await readJson(req);
    if (!ORG_RE.test(b.org || '') || !/^[0-9a-f]{64}$/.test(b.tokenHash || '')) return send(res, 400, { error: 'Datos no válidos' });
    const quien = comprobarCodigo(b.codigo, { pruebas: !!b.pruebas });
    if (quien === 'pruebas' && !b.pruebas) return send(res, 403, { error: 'El código de pruebas solo sirve para espacios de pruebas' });
    const ex = orgLoad(b.org);
    if (ex) return safeEq(ex.meta.tokenHash, b.tokenHash) ? send(res, 200, { ok: true, existente: true, principal: principal()[ex.meta.pruebas ? 'pruebas' : 'produccion'] === b.org }) : send(res, 409, { error: 'Ese espacio central ya existe con otra clave' });
    const dir = path.join(ORG_DIR, b.org); fs.mkdirSync(dir, { recursive: true });
    const o = { dir, meta: { org: b.org, tokenHash: b.tokenHash, nombre: String(b.nombre || '').slice(0, 80), pruebas: !!b.pruebas, creado: Date.now(), seq: 0 }, prevs: {}, config: {}, disp: {}, cuentas: {} };
    orgSave(o, 'meta', 'prevs', 'config', 'dispositivos', 'cuentas'); orgs.set(b.org, o);
    // Espacio principal: el real solo se fija una vez (cambiarlo exige intervención en el propio servidor);
    // el de pruebas se puede sustituir.
    let esPrincipal = false;
    if (b.principal) {
      const pr = principal(); const slot = o.meta.pruebas ? 'pruebas' : 'produccion';
      if (!pr[slot] || !orgLoad(pr[slot]) || o.meta.pruebas) { pr[slot] = b.org; guardarPrincipal(pr); esPrincipal = true; }
    }
    log('Espacio central creado', b.org, o.meta.pruebas ? '(pruebas)' : '', esPrincipal ? '(principal)' : '');
    return send(res, 201, { ok: true, principal: esPrincipal });
  }
  const org = parts[3];
  if (!ORG_RE.test(org || '')) return send(res, 400, { error: 'Espacio central no válido' });
  const o = orgLoad(org);
  if (!o) return send(res, 404, { error: 'Espacio central no encontrado en este servidor' });
  // Borrado de un espacio de PRUEBAS (y de sus preventivos): solo con el código de administración
  if (parts.length === 4 && req.method === 'DELETE') {
    const b = await readJson(req);
    comprobarCodigo(b.codigo, { pruebas: true });
    if (!o.meta.pruebas) return send(res, 403, { error: 'Solo se pueden borrar espacios centrales de pruebas' });
    let n = 0;
    for (const pid of Object.keys(o.prevs)) {
      if (!PID_RE.test(pid)) continue;
      const d = path.join(DATA, pid);
      if (fs.existsSync(d)) { fs.rmSync(d, { recursive: true, force: true }); cache.delete(pid); n++; }
    }
    fs.rmSync(o.dir, { recursive: true, force: true }); orgs.delete(org);
    const pr = principal(); if (pr.pruebas === org) { pr.pruebas = null; guardarPrincipal(pr); }
    log('Espacio central de pruebas borrado', org, n, 'preventivos');
    return send(res, 200, { ok: true, preventivosBorrados: n });
  }
  // Acceso con cuenta (usuario y contraseña) desde un dispositivo nuevo. La contraseña nunca llega aquí:
  // el dispositivo demuestra que la conoce y recibe la clave del espacio envuelta con ella.
  if (parts[4] === 'acceso' && req.method === 'POST') {
    const b = await readJson(req);
    if (!UID_RE.test(b.uid || '')) return send(res, 400, { error: 'Datos no válidos' });
    const c = o.cuentas[b.uid];
    if (parts[5] === 'sal') {
      if (c) return send(res, 200, { salt: c.salt, iter: c.iter });
      // cuenta inexistente: sal señuelo estable, indistinguible de una real
      const salt = crypto.createHmac('sha256', secretoServidor()).update(org + ':' + b.uid).digest().subarray(0, 16).toString('base64');
      return send(res, 200, { salt, iter: CUENTA_ITER });
    }
    if (parts.length !== 5 || typeof b.prueba !== 'string' || b.prueba.length > 100) return send(res, 400, { error: 'Datos no válidos' });
    limiteAcceso(b.uid);
    const h = crypto.createHash('sha256').update(Buffer.from(b.prueba, 'base64')).digest('hex');
    if (!c || !safeEq(h, c.verif)) { falloAcceso(b.uid); return send(res, 403, { error: 'Usuario o contraseña incorrectos' }); }
    fallosCuenta.delete(b.uid);
    return send(res, 200, { wrap: c.wrap, nombre: o.meta.nombre, pruebas: o.meta.pruebas });
  }
  if (!orgAuth(req, o)) return send(res, 401, { error: 'Credenciales del espacio central no válidas' });
  const what = parts[4];
  if (!what && req.method === 'GET') return send(res, 200, { org, nombre: o.meta.nombre, pruebas: o.meta.pruebas, creado: o.meta.creado, seq: o.meta.seq, version: VERSION, principal: principal()[o.meta.pruebas ? 'pruebas' : 'produccion'] === org });
  // Cuentas: las publica un dispositivo ya dado de alta (al crear un usuario o cambiar su contraseña)
  if (what === 'cuentas' && UID_RE.test(parts[5] || '')) {
    if (req.method === 'PUT') {
      const b = await readJson(req);
      if (typeof b.salt !== 'string' || b.salt.length > 64 || !Number.isInteger(b.iter) || b.iter < 100000 || b.iter > 5000000 || !/^[0-9a-f]{64}$/.test(b.verif || '') || typeof b.wrap !== 'string' || b.wrap.length > 4096) return send(res, 400, { error: 'Datos no válidos' });
      o.cuentas[parts[5]] = { salt: b.salt, iter: b.iter, verif: b.verif, wrap: b.wrap, t: Date.now() };
      orgSave(o, 'cuentas'); fallosCuenta.delete(parts[5]);
      return send(res, 200, { ok: true });
    }
    if (req.method === 'DELETE') { delete o.cuentas[parts[5]]; orgSave(o, 'cuentas'); return send(res, 200, { ok: true }); }
  }
  // Cambios desde una secuencia: registro de preventivos y configuración general
  if (what === 'cambios' && req.method === 'GET') {
    const desde = Math.max(0, Number(url.searchParams.get('desde') || 0));
    const prevs = Object.entries(o.prevs).filter(([, v]) => v.sq > desde).map(([pid, v]) => ({ pid, w: v.w, sq: v.sq }));
    const config = Object.entries(o.config).filter(([, v]) => v.sq > desde).map(([id, v]) => ({ id, v: v.v, c: v.c, borrado: !!v.borrado, sq: v.sq }));
    return send(res, 200, { prevs, config, last: o.meta.seq });
  }
  if (what === 'prevs' && parts[5] && req.method === 'PUT') {
    const pid = parts[5]; if (!PID_RE.test(pid)) return send(res, 400, { error: 'Preventivo no válido' });
    const b = await readJson(req);
    if (typeof b.w !== 'string' || b.w.length > 64 * 1024) return send(res, 400, { error: 'Datos no válidos' });
    const cur = o.prevs[pid];
    if (cur && cur.w === b.w) return send(res, 200, { ok: true, sq: cur.sq });
    o.prevs[pid] = { w: b.w, sq: ++o.meta.seq, t: Date.now() };
    orgSave(o, 'prevs', 'meta');
    return send(res, 200, { ok: true, sq: o.prevs[pid].sq });
  }
  // Configuración general: control optimista por elemento (nunca se sobrescribe en silencio)
  if (what === 'config' && parts[5] && req.method === 'PUT') {
    let id; try { id = decodeURIComponent(parts[5]); } catch { id = ''; }
    if (!ITEM_RE.test(id)) return send(res, 400, { error: 'Elemento no válido' });
    const b = await readJson(req);
    if (!Number.isInteger(b.base) || b.base < 0 || typeof b.c !== 'string' || b.c.length > 256 * 1024) return send(res, 400, { error: 'Datos no válidos' });
    const cur = o.config[id];
    const v = cur ? cur.v : 0;
    if (b.base !== v) return send(res, 409, { error: 'El elemento ha cambiado en otro dispositivo', actual: cur ? { id, v: cur.v, c: cur.c, borrado: !!cur.borrado, sq: cur.sq } : null });
    o.config[id] = { v: v + 1, c: b.c, borrado: !!b.borrado, sq: ++o.meta.seq, t: Date.now() };
    orgSave(o, 'config', 'meta');
    return send(res, 200, { ok: true, v: v + 1, sq: o.config[id].sq });
  }
  // Latido de cada dispositivo: versión y última comunicación (panel de administración)
  if (what === 'latido' && req.method === 'POST') {
    const b = await readJson(req);
    if (!/^[A-Za-z0-9_-]{4,80}$/.test(b.dev || '')) return send(res, 400, { error: 'Dispositivo no válido' });
    o.disp[b.dev] = { nombre: String(b.nombre || '').slice(0, 80), version: String(b.version || '').slice(0, 20), visto: Date.now() };
    orgSave(o, 'dispositivos');
    return send(res, 200, { ok: true, version: VERSION, hora: Date.now() });
  }
  if (what === 'dispositivos' && req.method === 'GET') return send(res, 200, { dispositivos: o.disp, version: VERSION });
  return send(res, 404, { error: 'No encontrado' });
}

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // api v1 ...
  if (parts[2] === 'salud') return send(res, 200, { ok: true, servicio: 'gestor-emergencias-uco', version: VERSION, hora: Date.now() });
  if (parts[2] === 'org') return apiOrg(req, res, url, parts);
  // Espacio central principal (público: solo identifica el espacio; acceder exige una cuenta)
  if (parts[2] === 'central' && req.method === 'GET') {
    const slot = url.searchParams.get('entorno') === 'pruebas' ? 'pruebas' : 'produccion';
    const org = principal()[slot]; const o = org && orgLoad(org);
    return send(res, 200, o ? { ok: true, org, nombre: o.meta.nombre, pruebas: o.meta.pruebas, version: VERSION } : { ok: true, org: null, version: VERSION });
  }
  if (parts[2] !== 'prev') return send(res, 404, { error: 'No encontrado' });
  if (parts.length === 3 && req.method === 'POST') {
    const b = await readJson(req);
    if (!PID_RE.test(b.pid || '') || !/^[0-9a-f]{64}$/.test(b.tokenHash || '')) return send(res, 400, { error: 'Datos no válidos' });
    const ex = load(b.pid);
    if (ex) return safeEq(ex.meta.tokenHash, b.tokenHash) ? send(res, 200, { ok: true, existente: true, nextNum: ex.meta.nextNum }) : send(res, 409, { error: 'Ese preventivo ya existe con otra clave' });
    const dir = path.join(DATA, b.pid); fs.mkdirSync(path.join(dir, 'blobs'), { recursive: true });
    const meta = { pid: b.pid, tokenHash: b.tokenHash, nextSq: 1, nextNum: Math.max(1, (Number(b.startNum) || 0) + 1), creado: Date.now() };
    writeAtomic(path.join(dir, 'meta.json'), JSON.stringify(meta));
    log('Preventivo registrado', b.pid);
    return send(res, 201, { ok: true, nextNum: meta.nextNum });
  }
  const pid = parts[3];
  if (!PID_RE.test(pid || '')) return send(res, 400, { error: 'Preventivo no válido' });
  const p = load(pid);
  if (!p) return send(res, 404, { error: 'Preventivo no registrado en el servidor' });
  if (!auth(req, p)) return send(res, 401, { error: 'Credenciales no válidas' });
  const what = parts[4];
  if (what === 'ops' && req.method === 'POST') {
    const b = await readJson(req);
    if (!Array.isArray(b.ops) || b.ops.length > 2000) return send(res, 400, { error: 'Lote no válido' });
    const out = []; let lines = ''; let metaChanged = false;
    for (const o of b.ops) {
      if (!o || !ID_RE.test(o.id || '') || !ID_RE.test(o.d || '') || typeof o.h !== 'string' || o.h.length > 160 || typeof o.c !== 'string' || o.c.length > 4 * 1024 * 1024) return send(res, 400, { error: 'Operación no válida' });
    }
    for (const o of b.ops) {
      const ex = p.ids.get(o.id);
      if (ex) { out.push({ id: o.id, sq: ex.sq, num: ex.num ?? null }); continue; } // idempotente
      // Si la operación ya tenía número definitivo (reenvío tras recuperar el servidor), se conserva
      const prevNum = Number.isInteger(o.num) && o.num > 0 ? o.num : null;
      const rec = { id: o.id, d: o.d, h: o.h, sq: p.meta.nextSq++, num: prevNum != null ? prevNum : o.nn ? p.meta.nextNum++ : null, c: o.c, r: Date.now() };
      if (prevNum != null && prevNum >= p.meta.nextNum) p.meta.nextNum = prevNum + 1;
      p.ids.set(rec.id, rec); p.ops.push(rec); lines += JSON.stringify(rec) + '\n'; metaChanged = true;
      out.push({ id: rec.id, sq: rec.sq, num: rec.num });
    }
    if (lines) appendDurable(path.join(p.dir, 'ops.jsonl'), lines);
    if (metaChanged) writeAtomic(path.join(p.dir, 'meta.json'), JSON.stringify(p.meta));
    return send(res, 200, { res: out, last: p.meta.nextSq - 1 });
  }
  if (what === 'ops' && req.method === 'GET') {
    const after = Math.max(0, Number(url.searchParams.get('after') || 0));
    const limit = Math.min(2000, Math.max(1, Number(url.searchParams.get('limit') || 500)));
    // las operaciones están en orden de sq: búsqueda binaria del inicio
    let lo = 0, hi = p.ops.length; while (lo < hi) { const m = (lo + hi) >> 1; if (p.ops[m].sq <= after) lo = m + 1; else hi = m; }
    const slice = p.ops.slice(lo, lo + limit).map(o => ({ id: o.id, d: o.d, h: o.h, sq: o.sq, num: o.num, c: o.c }));
    return send(res, 200, { ops: slice, last: p.meta.nextSq - 1, more: lo + limit < p.ops.length });
  }
  if (what === 'blobs' && parts[5] && /^[A-Za-z0-9_-]{8,100}$/.test(parts[5])) {
    const file = path.join(p.dir, 'blobs', parts[5] + '.bin');
    if (req.method === 'PUT') {
      const body = await readBody(req);
      if (!fs.existsSync(file)) { fs.mkdirSync(path.dirname(file), { recursive: true }); writeAtomic(file, body); }
      return send(res, 200, { ok: true });
    }
    if (req.method === 'GET') return fs.existsSync(file) ? send(res, 200, fs.readFileSync(file)) : send(res, 404, { error: 'No existe' });
    if (req.method === 'HEAD') { res.writeHead(fs.existsSync(file) ? 200 : 404); return res.end(); }
  }
  return send(res, 404, { error: 'No encontrado' });
}

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.txt': 'text/plain; charset=utf-8', '.md': 'text/markdown; charset=utf-8' };
function serveStatic(req, res, url) {
  if (!STATIC) return send(res, 404, { error: 'No encontrado' });
  let rel = decodeURIComponent(url.pathname); if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(STATIC, rel));
  if (!file.startsWith(STATIC + path.sep) && file !== STATIC) return send(res, 403, { error: 'Prohibido' });
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return send(res, 404, 'No encontrado', { 'Content-Type': 'text/plain; charset=utf-8' });
  const ext = path.extname(file);
  const noCache = ['.html', '.webmanifest'].includes(ext) || path.basename(file) === 'sw.js';
  res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': noCache ? 'no-cache' : 'public, max-age=3600', 'X-Content-Type-Options': 'nosniff' });
  fs.createReadStream(file).pipe(res);
}

async function handler(req, res) {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) {
      cors(req, res);
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      return await api(req, res, url);
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Método no permitido' });
    return serveStatic(req, res, url);
  } catch (e) {
    log('Error', e.message);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'Error interno' });
  }
}

const server = args.cert && args.key
  ? https.createServer({ cert: fs.readFileSync(args.cert), key: fs.readFileSync(args.key) }, handler)
  : http.createServer(handler);
server.listen(PORT, HOST, () => {
  codigoAdmin(); codigoPruebas(); secretoServidor();
  log(`Servidor de sincronización UCO ${VERSION} en ${args.cert ? 'https' : 'http'}://${HOST}:${PORT}  datos: ${DATA}${STATIC ? '  app: ' + STATIC : ''}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { log('Deteniendo servidor'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
