// Actualización automática del servidor central (apartado 15): versión publicada → descarga →
// verificación de integridad → prueba con copia de los datos → reinicio controlado por el lanzador →
// periodo de prueba → activa; vuelta atrás manual y automática; los datos nunca se pierden.
// GitHub se sustituye por un servidor local con el mismo formato de respuesta.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { zipStore } from '../../src/core/zip.js';
import { leerZip, posterior } from '../../server/actualizador.mjs';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const PKG = path.join(ROOT, 'dist/servidor-uco-windows');
const ADMIN = 'ACTUA-LIZAC-IONES-PRUEB';
const BASE = fs.mkdtempSync(path.join(os.tmpdir(), 'uco-act-'));
const PORT = 20400 + Math.floor(Math.random() * 300);
const URL0 = `http://127.0.0.1:${PORT}/api/v1`;
const sha = b => crypto.createHash('sha256').update(b).digest('hex');
const FUENTE = fs.readFileSync(path.join(ROOT, 'server/server.mjs'), 'utf8');
const ACTUAL = /const VERSION = '([^']+)'/.exec(FUENTE)[1];
const MIN = /const MIN_CLIENTE = '([^']+)'/.exec(FUENTE)[1];
let gh, ghPort, lanz; const pub = { release: null, files: new Map() };

/** Paquete de una versión «publicada»: el actual con otro número de versión (o modificado) */
function paquete(version, mod = s => s) {
  const files = [];
  const add = (dir, prefix) => { for (const f of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, f.name); if (f.isDirectory()) add(p, prefix + f.name + '/'); else files.push({ name: prefix + f.name, data: fs.readFileSync(p) }); } };
  add(PKG, 'servidor-uco-windows/');
  for (const f of files) if (f.name.endsWith('servidor/server.mjs')) f.data = Buffer.from(mod(f.data.toString('utf8').replace(/const VERSION = '[^']+'/, `const VERSION = '${version}'`)));
  return Buffer.from(zipStore(files, new Date(2026, 0, 1)));
}
function publicar(version, zip, { digest = true } = {}) {
  const nombre = `servidor-uco-windows-v${version}.zip`;
  pub.files.set('/dl/' + nombre, zip);
  pub.files.set('/dl/SHA256SUMS.txt', Buffer.from(sha(zip) + '  ' + nombre + '\n'));
  pub.release = { tag_name: 'v' + version, published_at: new Date().toISOString(), body: 'Notas de la versión ' + version, html_url: 'https://example.invalid',
    assets: [{ name: nombre, size: zip.length, digest: digest ? 'sha256:' + sha(zip) : null, browser_download_url: `http://127.0.0.1:${ghPort}/dl/${nombre}` }, { name: 'SHA256SUMS.txt', size: 80, browser_download_url: `http://127.0.0.1:${ghPort}/dl/SHA256SUMS.txt` }] };
}
const req = async (p, { method = 'GET', body, token } = {}) => { const r = await fetch(URL0 + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, j: await r.json().catch(() => null) }; };
const esperar = async (fn, ms = 30000) => { const t = Date.now(); while (Date.now() - t < ms) { const v = await fn().catch(() => null); if (v) return v; await new Promise(r => setTimeout(r, 300)); } return null; };
const version = () => esperar(async () => (await fetch(URL0 + '/salud', { signal: AbortSignal.timeout(1500) })).json().then(j => j.version));
let org, tok;

test.before(async () => {
  gh = http.createServer((q, s) => {
    if (q.url.endsWith('/releases/latest')) { if (!pub.release) { s.writeHead(404); return s.end('{}'); } s.writeHead(200, { 'Content-Type': 'application/json' }); return s.end(JSON.stringify(pub.release)); }
    const f = pub.files.get(q.url); if (!f) { s.writeHead(404); return s.end(); } s.writeHead(200); s.end(f);
  });
  await new Promise(r => gh.listen(0, '127.0.0.1', r)); ghPort = gh.address().port;
  // Instalación de prueba con la misma estructura que en Windows
  fs.mkdirSync(path.join(BASE, 'servidor'), { recursive: true });
  for (const f of fs.readdirSync(path.join(PKG, 'servidor'))) fs.copyFileSync(path.join(PKG, 'servidor', f), path.join(BASE, 'servidor', f));
  fs.cpSync(path.join(PKG, 'app'), path.join(BASE, 'app'), { recursive: true });
  lanz = spawn(process.execPath, [path.join(BASE, 'servidor', 'lanzador.mjs'), '--port', String(PORT), '--host', '127.0.0.1', '--data', path.join(BASE, 'datos'), '--static', path.join(BASE, 'app'), '--base', BASE, '--quiet'],
    { stdio: 'ignore', env: { ...process.env, UCO_CODIGO_ADMIN: ADMIN, UCO_GITHUB_API: `http://127.0.0.1:${ghPort}`, UCO_REPO: 'prueba/gestor', UCO_PRUEBA_S: '20', UCO_VENTANA_MIN: '0' } });
  assert.ok(await version(), 'el servidor arranca a través del lanzador');
  const t = crypto.randomBytes(32).toString('hex'); org = 'org_actualizaciones';
  assert.equal((await req('/org', { method: 'POST', body: { org, tokenHash: sha(t), nombre: 'Pruebas', codigo: ADMIN } })).status, 201);
  tok = t;
  // Un preventivo con datos, para comprobar que sobreviven a las actualizaciones
  const tp = crypto.randomBytes(32).toString('hex');
  assert.equal((await req('/prev', { method: 'POST', body: { pid: 'prev_conservar', tokenHash: sha(tp) } })).status, 201);
  assert.equal((await req('/prev/prev_conservar/ops', { method: 'POST', token: tp, body: { ops: [{ id: 'op_1', d: 'dev1', h: '1', c: 'cifrado' }] } })).status, 200);
  pub.tp = tp;
});
test.after(async () => { lanz.kill('SIGTERM'); await new Promise(r => setTimeout(r, 800)); gh.close(); fs.rmSync(BASE, { recursive: true, force: true }); });

test('utilidades: comparación de versiones y lector ZIP con protección de rutas', () => {
  assert.ok(posterior('1.2.0', '1.1.9')); assert.ok(!posterior('1.1.0', '1.1.0')); assert.ok(!posterior('v1.0.9', '1.1.0')); assert.ok(posterior('v2.0.0', '1.9.9'));
  const z = leerZip(zipStore([{ name: 'a/b.txt', data: Buffer.from('hola') }]));
  assert.equal(z.get('a/b.txt').toString(), 'hola');
  assert.throws(() => leerZip(zipStore([{ name: '../fuera.txt', data: Buffer.from('x') }])), /Ruta no permitida/);
});

test('estado y versiones: la app consulta la versión mínima y el servidor expone su estado', async () => {
  const v = await req('/version');
  assert.equal(v.j.version, ACTUAL); assert.equal(v.j.minCliente, MIN); assert.equal(v.j.lanzador, true); assert.equal(v.j.esquema, 2);
  assert.equal((await req(`/org/${org}/admin/actualizaciones`)).status, 401, 'consultar exige ser un dispositivo del espacio');
  const e = (await req(`/org/${org}/admin/actualizaciones`, { token: tok })).j;
  assert.equal(e.instalada, ACTUAL); assert.equal(e.lanzador, true);
  // Las acciones exigen el código de administración (consultar si hay versión nueva, no)
  assert.equal((await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'preparar' } })).status, 403);
  assert.equal((await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'cancelar', codigo: 'AAAAA-BBBBB-CCCCC-DDDDD' } })).status, 403);
  assert.equal((await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'comprobar' } })).status, 200);
  const v2 = await req('/version'); assert.equal(v2.j.disponible, null, 'sin versiones publicadas no hay ninguna disponible');
});

test('paquete manipulado: se rechaza por integridad y no queda nada preparado', async () => {
  const bueno = paquete('9.9.9'); publicar('9.9.9', bueno);
  pub.files.set('/dl/servidor-uco-windows-v9.9.9.zip', Buffer.concat([bueno, Buffer.from('manipulado')]));
  let e = (await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'comprobar', codigo: ADMIN } })).j;
  assert.equal(e.disponible.version, '9.9.9'); assert.equal(e.actualizable, true);
  assert.equal((await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'preparar', codigo: ADMIN } })).status, 202);
  e = await esperar(async () => { const x = (await req(`/org/${org}/admin/actualizaciones`, { token: tok })).j; return x.tarea ? null : x; });
  assert.match(e.error, /SHA-256/); assert.equal(e.preparada, null);
  assert.ok(!fs.existsSync(path.join(BASE, 'actualizaciones', 'preparada')));
  assert.match(fs.readFileSync(path.join(BASE, 'datos', '_servidor', 'despliegue.json'), 'utf8'), /fallida/);
});

test('actualización completa: verificar, probar, reinicio controlado, periodo de prueba y datos intactos', async () => {
  publicar('9.9.9', paquete('9.9.9'));
  await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'comprobar', codigo: ADMIN } });
  assert.equal((await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'preparar', codigo: ADMIN } })).status, 202);
  const e = await esperar(async () => { const x = (await req(`/org/${org}/admin/actualizaciones`, { token: tok })).j; return x.preparada || (x.error && !x.tarea) ? x : null; }, 60000);
  assert.equal(e.preparada && e.preparada.version, '9.9.9', e.error);
  assert.ok(!fs.existsSync(path.join(BASE, 'actualizaciones', 'prueba-datos')), 'la copia de prueba se elimina');
  // Hubo escrituras hace un momento (preparación de la prueba): se fuerza la instalación inmediata
  const r = await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'ahora', codigo: ADMIN, forzar: true } });
  assert.equal(r.status, 200, JSON.stringify(r.j));
  const v = await esperar(async () => { const j = await (await fetch(URL0 + '/salud', { signal: AbortSignal.timeout(1500) })).json(); return j.version === '9.9.9' ? j.version : null; }, 40000);
  assert.equal(v, '9.9.9', 'la versión nueva está en marcha');
  const dep = await esperar(async () => { const d = JSON.parse(fs.readFileSync(path.join(BASE, 'datos', '_servidor', 'despliegue.json'), 'utf8')); return d.estado === 'activa' ? d : null; }, 30000);
  assert.equal(dep.instalada, '9.9.9');
  assert.ok(fs.readFileSync(path.join(BASE, 'copias', 'anterior', 'servidor', 'server.mjs'), 'utf8').includes("const VERSION = '" + ACTUAL + "'"), 'se guarda la versión anterior');
  const copia = fs.readdirSync(path.join(BASE, 'copias')).find(x => x.startsWith('datos-') && x.endsWith('antes-de-v9.9.9'));
  assert.ok(copia, 'copia de seguridad de los datos previa a la activación');
  assert.ok(fs.existsSync(path.join(BASE, 'copias', copia, 'prev_conservar', 'ops.jsonl')), 'la copia contiene los preventivos');
  const ops = await req('/prev/prev_conservar/ops?after=0', { token: pub.tp });
  assert.equal(ops.j.ops.length, 1, 'los datos se conservan'); assert.equal(ops.j.ops[0].c, 'cifrado');
  assert.ok(fs.readFileSync(path.join(BASE, 'datos', '_servidor', 'despliegues.log'), 'utf8').includes('activa y funcionando'), 'registro del despliegue');
});

test('vuelta a la versión anterior a petición del administrador', async () => {
  const r = await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'revertir', codigo: ADMIN } });
  assert.equal(r.status, 200);
  const v = await esperar(async () => { const j = await (await fetch(URL0 + '/salud', { signal: AbortSignal.timeout(1500) })).json(); return j.version === ACTUAL ? j.version : null; }, 40000);
  assert.equal(v, ACTUAL);
  const d = JSON.parse(fs.readFileSync(path.join(BASE, 'datos', '_servidor', 'despliegue.json'), 'utf8'));
  assert.equal(d.instalada, ACTUAL); assert.equal(d.historial.slice(-1)[0].version, '9.9.9'); assert.equal(d.historial.slice(-1)[0].a, ACTUAL);
  assert.equal((await req('/prev/prev_conservar/ops?after=0', { token: pub.tp })).j.ops.length, 1);
  assert.equal((await req(`/org/${org}/admin/actualizaciones`, { token: tok })).j.despliegue.instalada, ACTUAL);
});

test('una versión que falla tras activarse se revierte sola durante el periodo de prueba', async () => {
  // Paquete que supera la prueba con la copia de datos pero falla al arrancar con el lanzador
  publicar('9.9.10', paquete('9.9.10', s => s.replace("import http from 'node:http';", "import http from 'node:http';\nif (process.env.UCO_LANZADOR === '1') process.exit(9);")));
  await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'comprobar', codigo: ADMIN } });
  await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'preparar', codigo: ADMIN } });
  const e = await esperar(async () => { const x = (await req(`/org/${org}/admin/actualizaciones`, { token: tok })).j; return x.preparada && x.preparada.version === '9.9.10' ? x : null; }, 60000);
  assert.ok(e, 'preparada');
  await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'ahora', codigo: ADMIN, forzar: true } });
  const dep = await esperar(async () => { const d = JSON.parse(fs.readFileSync(path.join(BASE, 'datos', '_servidor', 'despliegue.json'), 'utf8')); return d.estado === 'revertida' && d.historial.some(h => h.version === '9.9.10' && h.resultado === 'revertida') ? d : null; }, 60000);
  assert.ok(dep, 'el lanzador vuelve a la versión anterior');
  assert.match(dep.historial.slice(-1)[0].motivo, /periodo de prueba/); assert.equal(dep.instalada, ACTUAL);
  assert.equal(await version(), ACTUAL, 'sigue en servicio con la versión anterior');
  assert.equal((await req('/prev/prev_conservar/ops?after=0', { token: pub.tp })).j.ops.length, 1);
});

test('ventana segura: con actividad reciente no se reinicia «ahora» salvo que se fuerce', async () => {
  publicar('9.9.11', paquete('9.9.11'));
  await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'comprobar', codigo: ADMIN } });
  await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'preparar', codigo: ADMIN } });
  await esperar(async () => { const x = (await req(`/org/${org}/admin/actualizaciones`, { token: tok })).j; return x.preparada && x.preparada.version === '9.9.11' ? x : null; }, 60000);
  await req('/prev/prev_conservar/ops', { method: 'POST', token: pub.tp, body: { ops: [{ id: 'op_2', d: 'dev1', h: '2', c: 'cifrado2' }] } });
  const r = await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'ahora', codigo: ADMIN } });
  assert.equal(r.status, 409); assert.match(r.j.error, /actividad/);
  const c = await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'ventana', codigo: ADMIN } });
  assert.equal(c.j.programada.modo, 'ventana');
  const x = await req(`/org/${org}/admin/actualizaciones`, { method: 'POST', token: tok, body: { accion: 'cancelar', codigo: ADMIN } });
  assert.equal(x.j.programada, null, 'se puede posponer');
});
