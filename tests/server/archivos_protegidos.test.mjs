// Regresión de la 1.2.0 en Windows: si el servidor no puede leer sus códigos protegidos (permisos mal
// puestos en datos\_servidor), debe seguir arrancando y sincronizando, explicarlo con claridad (no un
// «Error interno»), avisarlo en /version (lo comprueban el instalador y el panel) y recuperarse al
// repararse los permisos, sin reiniciar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uco-arch-'));
const PORT = 19300 + Math.floor(Math.random() * 400);
const base = `http://127.0.0.1:${PORT}/api/v1`;
// Simulación de «no se puede leer»: en el lugar del código hay algo que no es un archivo legible
const ADMIN = path.join(DATA, '_servidor', 'codigo-admin.txt');
let proc;
const env = { ...process.env }; delete env.UCO_CODIGO_ADMIN; delete env.UCO_CODIGO_PRUEBAS;

test.before(async () => {
  fs.mkdirSync(ADMIN, { recursive: true });
  proc = spawn(process.execPath, [path.join(ROOT, 'server/server.mjs'), '--port', String(PORT), '--data', DATA, '--host', '127.0.0.1', '--quiet'], { stdio: 'ignore', env });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/salud')).ok) return; } catch { } await new Promise(r => setTimeout(r, 100)); }
  throw new Error('El servidor no arrancó con los códigos ilegibles');
});
test.after(async () => { proc.kill('SIGTERM'); await new Promise(r => proc.on('exit', r)); fs.rmSync(DATA, { recursive: true, force: true }); });

test('con los códigos ilegibles el servidor arranca, sincroniza y lo explica', async () => {
  const v = await (await fetch(base + '/version')).json();
  assert.equal(v.archivos, 'error', 'lo indica para el instalador y el panel');
  // Los preventivos se siguen sincronizando
  const tok = crypto.randomBytes(32).toString('hex');
  const r = await fetch(base + '/prev', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pid: 'prev_archivos', tokenHash: crypto.createHash('sha256').update(tok).digest('hex') }) });
  assert.equal(r.status, 201);
  // Activar el espacio central: mensaje claro (no «Error interno»)
  const o = await fetch(base + '/org', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org: 'org_archivos01', tokenHash: 'a'.repeat(64), nombre: 'x', codigo: 'AAAAA-BBBBB-CCCCC-DDDDD' }) });
  assert.equal(o.status, 500);
  assert.match((await o.json()).error, /no puede leer sus códigos.*instalador/);
});

test('al repararse los permisos vuelve a funcionar sin reiniciar', async () => {
  fs.rmSync(ADMIN, { recursive: true, force: true });
  fs.writeFileSync(ADMIN, 'ABCDE-FGHJK-LMNPQ-RSTUV\n');
  const v = await (await fetch(base + '/version')).json();
  assert.equal(v.archivos, 'ok');
  const o = await fetch(base + '/org', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ org: 'org_archivos01', tokenHash: 'a'.repeat(64), nombre: 'x', codigo: 'XXXXX-XXXXX-XXXXX-XXXXX' }) });
  assert.equal(o.status, 403, 'código incorrecto, ya no un fallo de lectura');
});
