#!/usr/bin/env node
// Servidor de sincronización del Gestor de Emergencias UCO.
// - Sin dependencias (solo Node.js 18+). Gratuito y autoalojado.
// - Almacena las operaciones CIFRADAS de extremo a extremo: el servidor no puede leer los datos.
// - Asigna números de aviso definitivos y correlativos (por orden de llegada).
// - Opcionalmente sirve la propia aplicación (--static) para alojar todo en un único sitio.
//
// Uso: node server.mjs --port 8443 --data ./datos [--static ../dist/app] [--cert cert.pem --key key.pem]
//                      [--origins https://usuario.github.io] [--host 0.0.0.0]
import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const VERSION = '1.0.1';
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

const PID_RE = /^[A-Za-z0-9_-]{4,80}$/;
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
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,OPTIONS');
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

async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean); // api v1 ...
  if (parts[2] === 'salud') return send(res, 200, { ok: true, version: VERSION, hora: Date.now() });
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
  log(`Servidor de sincronización UCO ${VERSION} en ${args.cert ? 'https' : 'http'}://${HOST}:${PORT}  datos: ${DATA}${STATIC ? '  app: ' + STATIC : ''}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { log('Deteniendo servidor'); server.close(() => process.exit(0)); setTimeout(() => process.exit(0), 2000).unref(); });
