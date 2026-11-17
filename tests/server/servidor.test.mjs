// Pruebas reales del servidor de sincronización (se arranca como proceso independiente).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uco-srv-'));
let PORT = 18500 + Math.floor(Math.random() * 400);
let proc;
const base = () => `http://127.0.0.1:${PORT}/api/v1`;
const token = crypto.randomBytes(32).toString('hex');
const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token };

async function start() {
  proc = spawn(process.execPath, [path.join(ROOT, 'server/server.mjs'), '--port', String(PORT), '--data', DATA, '--host', '127.0.0.1', '--quiet'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { const r = await fetch(base() + '/salud'); if (r.ok) return; } catch { } await new Promise(r => setTimeout(r, 100)); }
  throw new Error('El servidor no arrancó');
}
async function stop() { proc.kill('SIGTERM'); await new Promise(r => proc.on('exit', r)); }
const post = (p, b, h = H) => fetch(base() + p, { method: 'POST', headers: h, body: JSON.stringify(b) });

test.before(start);
test.after(async () => { await stop(); fs.rmSync(DATA, { recursive: true, force: true }); });

test('salud y registro del preventivo', async () => {
  const r = await (await fetch(base() + '/salud')).json();
  assert.equal(r.ok, true);
  let res = await post('/prev', { pid: 'prev_test1', tokenHash });
  assert.equal(res.status, 201);
  res = await post('/prev', { pid: 'prev_test1', tokenHash });
  assert.equal(res.status, 200, 'registro idempotente');
  res = await post('/prev', { pid: 'prev_test1', tokenHash: 'a'.repeat(64) });
  assert.equal(res.status, 409, 'no se puede suplantar un preventivo existente');
});

test('autenticación obligatoria', async () => {
  const r = await fetch(base() + '/prev/prev_test1/ops?after=0');
  assert.equal(r.status, 401);
  const r2 = await fetch(base() + '/prev/prev_test1/ops?after=0', { headers: { Authorization: 'Bearer malo' } });
  assert.equal(r2.status, 401);
});

test('envío idempotente, numeración concurrente única y lectura incremental', async () => {
  const lots = Array.from({ length: 20 }, (_, i) => ({ ops: [
    { id: 'op_n' + i, d: 'dev' + (i % 3), h: '0000000000000' + i, nn: true, c: 'cifrado' + i },
    { id: 'op_x' + i, d: 'dev' + (i % 3), h: '0000000000001' + i, c: 'otro' + i },
  ] }));
  const results = await Promise.all(lots.map(l => post('/prev/prev_test1/ops', l).then(r => r.json())));
  const nums = results.flatMap(r => r.res.map(x => x.num)).filter(x => x != null).sort((a, b) => a - b);
  assert.deepEqual(nums, Array.from({ length: 20 }, (_, i) => i + 1), 'números correlativos sin huecos ni duplicados');
  // reenvío: mismo resultado, sin duplicar
  const again = await (await post('/prev/prev_test1/ops', lots[3])).json();
  assert.equal(again.res[0].num, results[3].res[0].num);
  const all = await (await fetch(base() + '/prev/prev_test1/ops?after=0&limit=1000', { headers: H })).json();
  assert.equal(all.ops.length, 40);
  const part = await (await fetch(base() + '/prev/prev_test1/ops?after=35', { headers: H })).json();
  assert.equal(part.ops.length, 5);
  assert.equal(part.ops[0].sq, 36);
});

test('archivos (planos) cifrados', async () => {
  const data = crypto.randomBytes(5000);
  const put = await fetch(base() + '/prev/prev_test1/blobs/blob_12345678', { method: 'PUT', headers: { Authorization: H.Authorization, 'Content-Type': 'application/octet-stream' }, body: data });
  assert.equal(put.status, 200);
  const got = Buffer.from(await (await fetch(base() + '/prev/prev_test1/blobs/blob_12345678', { headers: H })).arrayBuffer());
  assert.ok(got.equals(data));
});

test('persistencia tras reinicio y continuidad de la numeración', async () => {
  await stop(); await start();
  const all = await (await fetch(base() + '/prev/prev_test1/ops?after=0&limit=1000', { headers: H })).json();
  assert.equal(all.ops.length, 40);
  const r = await (await post('/prev/prev_test1/ops', { ops: [{ id: 'op_tras_reinicio', d: 'devZ', h: '9', nn: true, c: 'x' }] })).json();
  assert.equal(r.res[0].num, 21);
  assert.equal(r.res[0].sq, 41);
});

test('CORS para la aplicación alojada en otro dominio', async () => {
  const r = await fetch(base() + '/prev/prev_test1/ops', { method: 'OPTIONS', headers: { Origin: 'https://ejemplo.github.io', 'Access-Control-Request-Method': 'POST' } });
  assert.equal(r.status, 204);
  assert.equal(r.headers.get('access-control-allow-origin'), '*');
  assert.match(r.headers.get('access-control-allow-headers'), /Authorization/);
});
