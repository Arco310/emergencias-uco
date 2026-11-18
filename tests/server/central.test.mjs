// Espacio central del servidor: creación protegida, autenticación, registro de preventivos,
// configuración con control optimista, latidos y borrado seguro de espacios de pruebas.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uco-central-'));
const PORT = 18900 + Math.floor(Math.random() * 90);
let proc;
const base = `http://127.0.0.1:${PORT}/api/v1`;
const tok = () => crypto.randomBytes(32).toString('hex');
const hash = t => crypto.createHash('sha256').update(t).digest('hex');
const req = (p, { method = 'GET', body, token } = {}) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });

test.before(async () => {
  proc = spawn(process.execPath, [path.join(ROOT, 'server/server.mjs'), '--port', String(PORT), '--data', DATA, '--host', '127.0.0.1', '--quiet'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/salud')).ok) return; } catch { } await new Promise(r => setTimeout(r, 100)); }
  throw new Error('El servidor no arrancó');
});
test.after(async () => { proc.kill('SIGTERM'); await new Promise(r => proc.on('exit', r)); fs.rmSync(DATA, { recursive: true, force: true }); });
const codigo = () => fs.readFileSync(path.join(DATA, '_servidor', 'codigo-admin.txt'), 'utf8').trim();

test('código de administración: se genera al arrancar, con acceso restringido, y es obligatorio para crear el espacio', async () => {
  const f = path.join(DATA, '_servidor', 'codigo-admin.txt');
  assert.match(codigo(), /^[2-9A-Z]{5}(-[2-9A-Z]{5}){3}$/);
  if (process.platform !== 'win32') assert.equal(fs.statSync(f).mode & 0o077, 0, 'solo legible por su propietario');
  const t = tok();
  let r = await req('/org', { method: 'POST', body: { org: 'org_principal', tokenHash: hash(t), nombre: 'UCO' } });
  assert.equal(r.status, 403);
  r = await req('/org', { method: 'POST', body: { org: 'org_principal', tokenHash: hash(t), nombre: 'UCO', codigo: 'AAAAA-BBBBB-CCCCC-DDDDD' } });
  assert.equal(r.status, 403);
  r = await req('/org', { method: 'POST', body: { org: 'org_principal', tokenHash: hash(t), nombre: 'UCO', codigo: codigo().toLowerCase().replace(/-/g, ' ') } });
  assert.equal(r.status, 201, 'el código admite minúsculas y espacios');
  r = await req('/org', { method: 'POST', body: { org: 'org_principal', tokenHash: hash(tok()), codigo: codigo() } });
  assert.equal(r.status, 409, 'no se puede suplantar un espacio existente');
  r = await req('/org/org_principal', { token: tok() });
  assert.equal(r.status, 401);
  r = await req('/org/org_principal', { token: t });
  assert.equal(r.status, 200); assert.equal((await r.json()).nombre, 'UCO');
  r = await req('/prev', { method: 'POST', body: { pid: '_org', tokenHash: hash(t) } });
  assert.equal(r.status, 400, 'los identificadores que empiezan por «_» están reservados');
});

test('registro de preventivos y cambios incrementales', async () => {
  const t = tok(); const org = 'org_registro';
  await req('/org', { method: 'POST', body: { org, tokenHash: hash(t), codigo: codigo() } });
  let r = await req(`/org/${org}/prevs/prev_a1b2c3`, { method: 'PUT', token: t, body: { w: 'cifrado-1' } });
  assert.equal(r.status, 200); const sq1 = (await r.json()).sq;
  await req(`/org/${org}/prevs/prev_d4e5f6`, { method: 'PUT', token: t, body: { w: 'cifrado-2' } });
  r = await req(`/org/${org}/cambios?desde=0`, { token: t }); let j = await r.json();
  assert.deepEqual(j.prevs.map(p => p.pid).sort(), ['prev_a1b2c3', 'prev_d4e5f6']);
  r = await req(`/org/${org}/cambios?desde=${sq1}`, { token: t }); j = await r.json();
  assert.deepEqual(j.prevs.map(p => p.pid), ['prev_d4e5f6'], 'solo lo nuevo');
  r = await req(`/org/${org}/prevs/prev_a1b2c3`, { method: 'PUT', token: t, body: { w: 'cifrado-1' } });
  assert.equal((await r.json()).sq, sq1, 'reenvío idéntico: idempotente');
});

test('configuración general: control optimista, sin sobrescribir en silencio', async () => {
  const t = tok(); const org = 'org_config';
  await req('/org', { method: 'POST', body: { org, tokenHash: hash(t), codigo: codigo() } });
  let r = await req(`/org/${org}/config/tr:vl`, { method: 'PUT', token: t, body: { base: 0, c: 'A' } });
  assert.equal(r.status, 200); assert.equal((await r.json()).v, 1);
  // Dos dispositivos parten de la versión 1; el segundo en guardar recibe un conflicto con la versión actual
  r = await req(`/org/${org}/config/tr:vl`, { method: 'PUT', token: t, body: { base: 1, c: 'B (dispositivo 1)' } });
  assert.equal(r.status, 200);
  r = await req(`/org/${org}/config/tr:vl`, { method: 'PUT', token: t, body: { base: 1, c: 'C (dispositivo 2)' } });
  assert.equal(r.status, 409); const j = await r.json();
  assert.equal(j.actual.c, 'B (dispositivo 1)'); assert.equal(j.actual.v, 2);
  r = await req(`/org/${org}/config/tr:vl`, { method: 'PUT', token: t, body: { base: 2, c: 'C', borrado: true } });
  assert.equal(r.status, 200);
  r = await req(`/org/${org}/cambios?desde=0`, { token: t });
  const it = (await r.json()).config.find(x => x.id === 'tr:vl');
  assert.equal(it.v, 3); assert.equal(it.borrado, true);
});

test('latidos de dispositivos y persistencia tras reiniciar el servidor', async () => {
  const t = tok(); const org = 'org_latidos';
  await req('/org', { method: 'POST', body: { org, tokenHash: hash(t), codigo: codigo() } });
  await req(`/org/${org}/latido`, { method: 'POST', token: t, body: { dev: 'dev_tablet1', nombre: 'Tablet 1', version: '1.1.0' } });
  await req(`/org/${org}/config/pl:upr`, { method: 'PUT', token: t, body: { base: 0, c: 'UPR' } });
  proc.kill('SIGTERM'); await new Promise(r => proc.on('exit', r));
  proc = spawn(process.execPath, [path.join(ROOT, 'server/server.mjs'), '--port', String(PORT), '--data', DATA, '--host', '127.0.0.1', '--quiet'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/salud')).ok) break; } catch { } await new Promise(r => setTimeout(r, 100)); }
  const d = await (await req(`/org/${org}/dispositivos`, { token: t })).json();
  assert.equal(d.dispositivos.dev_tablet1.nombre, 'Tablet 1');
  const c = await (await req(`/org/${org}/cambios?desde=0`, { token: t })).json();
  assert.equal(c.config[0].c, 'UPR');
});

test('borrado seguro: solo espacios de pruebas, con el código, y con sus preventivos', async () => {
  const t = tok();
  await req('/org', { method: 'POST', body: { org: 'org_claudetest', tokenHash: hash(t), pruebas: true, codigo: codigo() } });
  const pt = tok();
  await req('/prev', { method: 'POST', body: { pid: 'prev_prueba1', tokenHash: hash(pt) } });
  await req('/org/org_claudetest/prevs/prev_prueba1', { method: 'PUT', token: t, body: { w: 'x' } });
  assert.ok(fs.existsSync(path.join(DATA, 'prev_prueba1')));
  let r = await req('/org/org_claudetest', { method: 'DELETE', body: { codigo: 'MAL' } });
  assert.equal(r.status, 403);
  r = await req('/org/org_principal', { method: 'DELETE', body: { codigo: codigo() } });
  assert.equal(r.status, 403, 'un espacio real nunca se borra por la API');
  r = await req('/org/org_claudetest', { method: 'DELETE', body: { codigo: codigo() } });
  assert.equal(r.status, 200); assert.equal((await r.json()).preventivosBorrados, 1);
  assert.ok(!fs.existsSync(path.join(DATA, 'prev_prueba1')) && !fs.existsSync(path.join(DATA, '_org', 'org_claudetest')));
  assert.ok(fs.existsSync(path.join(DATA, '_org', 'org_principal')), 'el espacio real sigue intacto');
});

test('límite de intentos con código erróneo', async () => {
  let last;
  for (let i = 0; i < 12; i++) last = await req('/org', { method: 'POST', body: { org: 'org_fuerza' + i, tokenHash: hash(tok()), codigo: 'NO-ES-EL-CODIGO' } });
  assert.equal(last.status, 429);
  const r = await req('/org', { method: 'POST', body: { org: 'org_tras_bloqueo', tokenHash: hash(tok()), codigo: codigo() } });
  assert.equal(r.status, 429, 'durante el bloqueo tampoco vale el código correcto');
});
