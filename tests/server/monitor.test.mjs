// 1.5.0 · §4: monitorización del servidor. Estado, recursos, almacenamiento, sincronización, copias y alertas,
// sin secretos y solo para administradores (modo anterior: código de administración del servidor).
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { crearMonitor, limpiarMensaje } from '../../server/monitor.mjs';

const tmp = p => fs.mkdtempSync(path.join(os.tmpdir(), p));

test('mensajes de error sin secretos: tokens, claves largas y rutas de usuario se ocultan', () => {
  const m = limpiarMensaje('Fallo con Bearer abcdef123456 y clave ' + 'a1'.repeat(32) + ' en C:\\Users\\Pepe\\GestorUCO\\datos');
  assert.doesNotMatch(m, /abcdef123456|a1a1a1a1a1a1|Pepe/);
  assert.match(m, /Bearer …/); assert.match(m, /C:\\Users\\…\\GestorUCO/);
});

test('estado del servidor: actividad, almacenamiento, recursos, sincronización y copias; alertas con su origen e historial', () => {
  const DATA = tmp('uco-mon-'), BASE = tmp('uco-base-'); let t = Date.UTC(2026, 10, 25, 10, 0, 0);
  let libre = 50 * 2 ** 30;
  const M = crearMonitor({ DATA, BASE, version: '1.5.0', ahora: () => t, statfs: () => ({ bavail: libre / 4096, blocks: 100 * 2 ** 30 / 4096, bsize: 4096 }), intervaloCpu: 0 });
  fs.mkdirSync(path.join(BASE, 'copias', 'datos-2026-11-24T22-00-00-antes-de-v1.5.0'), { recursive: true });
  fs.writeFileSync(path.join(BASE, 'copias', 'datos-2026-11-24T22-00-00-antes-de-v1.5.0', 'ops.jsonl'), 'x'.repeat(2048));
  t += 3 * 3600000;
  M.operaciones('prev_1', { aceptadas: 12, rechazos: [{ codigo: 'permiso', error: 'No tienes permiso para: eliminar unidades.' }] });
  M.error('API', new Error('Algo falló con token ' + 'f0'.repeat(32)));
  let e = M.estado({ dispositivos: { dev_a: { nombre: 'Tablet', version: '1.5.0', visto: t - 60000 }, dev_b: { nombre: 'Móvil', version: '1.4.0', visto: t - 3600000 } } });
  assert.equal(e.servidor.version, '1.5.0'); assert.equal(e.servidor.actividadSeg, 3 * 3600); assert.equal(e.servidor.api, 'ok');
  assert.equal(e.servidor.errores.length, 1); assert.doesNotMatch(JSON.stringify(e), /f0f0f0f0f0/);
  assert.equal(e.almacenamiento.estado, 'ok'); assert.ok(e.almacenamiento.prueba.ms >= 0); assert.equal(e.almacenamiento.discoLibre, 50 * 2 ** 30);
  assert.ok(e.recursos.memoria.sistemaTotal > 0 && e.recursos.memoria.proceso > 0); assert.ok(e.recursos.cpu.nucleos >= 1);
  assert.equal(e.sincronizacion.recibidas, 12); assert.equal(e.sincronizacion.rechazadas, 1); assert.equal(e.sincronizacion.porCodigo.permiso, 1);
  assert.deepEqual(e.sincronizacion.dispositivos.map(d => [d.nombre, d.reciente]), [['Tablet', true], ['Móvil', false]], 'conectado = latido reciente, no sesión abierta');
  assert.equal(e.copias.lista.length, 1); assert.equal(e.copias.ultima.motivo, 'antes de v1.5.0'); assert.ok(e.copias.ultima.tam >= 2048);
  assert.equal(e.copias.ultima.fecha, Date.UTC(2026, 10, 24, 22, 0, 0));
  assert.match(e.copias.programacion, /antes de cada actualización/i);
  assert.equal(e.alertas.activas.length, 0, JSON.stringify(e.alertas.activas));
  // Poco espacio: alerta con origen y hora; al recuperarse queda en el historial con su final
  libre = 0.5 * 2 ** 30; t += 60000;
  e = M.estado({});
  const a = e.alertas.activas.find(x => x.origen === 'Disco');
  assert.ok(a && a.nivel === 'alta' && a.desde === t, JSON.stringify(e.alertas.activas));
  libre = 40 * 2 ** 30; t += 120000;
  e = M.estado({});
  assert.ok(!e.alertas.activas.some(x => x.origen === 'Disco'));
  const h = e.alertas.historial.find(x => x.origen === 'Disco'); assert.equal(h.hasta, t);
  // El historial se conserva tras reiniciar el servidor
  const M2 = crearMonitor({ DATA, BASE, version: '1.5.0', ahora: () => t, statfs: () => ({ bavail: 1e9, blocks: 2e9, bsize: 4096 }), intervaloCpu: 0 });
  assert.ok(M2.estado({}).alertas.historial.some(x => x.origen === 'Disco'));
  // Almacenamiento inaccesible: alerta crítica
  fs.rmSync(DATA, { recursive: true, force: true }); fs.writeFileSync(DATA, 'no es una carpeta');
  e = M.estado({});
  assert.equal(e.almacenamiento.estado, 'error'); assert.ok(e.alertas.activas.some(x => x.nivel === 'critica' && x.origen === 'Almacenamiento'));
  fs.rmSync(DATA, { force: true });
});

// ---- Por HTTP: solo con el código de administración del servidor (modo anterior) ----
const DATA = tmp('uco-mon-http-'); const PORT = 21500 + Math.floor(Math.random() * 300); const base = `http://127.0.0.1:${PORT}/api/v1`;
let proc;
const req = (p, { method = 'GET', body, token } = {}) => fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
test.before(async () => {
  proc = spawn(process.execPath, [path.join(path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..'), 'server/server.mjs'), '--port', String(PORT), '--data', DATA, '--host', '127.0.0.1', '--quiet'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(base + '/salud')).ok) return; } catch { } await new Promise(r => setTimeout(r, 100)); }
  throw new Error('El servidor no arrancó');
});
test.after(async () => { proc.kill('SIGTERM'); await new Promise(r => proc.on('exit', r)); fs.rmSync(DATA, { recursive: true, force: true }); });

test('estado del sistema por HTTP: exige el código de administración, no devuelve secretos y se guarda en caché unos segundos', async () => {
  const codigo = fs.readFileSync(path.join(DATA, '_servidor', 'codigo-admin.txt'), 'utf8').trim();
  const tok = crypto.randomBytes(32).toString('hex'); const org = 'org_mon' + crypto.randomBytes(3).toString('hex');
  assert.equal((await req('/org', { method: 'POST', body: { org, tokenHash: crypto.createHash('sha256').update(tok).digest('hex'), codigo } })).status, 201);
  await req('/org/' + org + '/latido', { method: 'POST', token: tok, body: { dev: 'dev_tablet', nombre: 'Tablet', version: '1.5.0' } });
  assert.equal((await req('/org/' + org + '/admin/estado', { method: 'POST', body: {} })).status, 401, 'sin el token del espacio');
  assert.equal((await req('/org/' + org + '/admin/estado', { method: 'POST', token: tok, body: {} })).status, 403, 'un dispositivo del espacio sin el código no lo ve');
  const r = await req('/org/' + org + '/admin/estado', { method: 'POST', token: tok, body: { codigo } });
  assert.equal(r.status, 200); const e = await r.json();
  for (const k of ['servidor', 'almacenamiento', 'recursos', 'sincronizacion', 'copias', 'alertas']) assert.ok(e[k], k);
  assert.equal(e.sincronizacion.dispositivos[0].nombre, 'Tablet');
  const txt = JSON.stringify(e);
  for (const secreto of [codigo, tok, DATA]) assert.ok(!txt.includes(secreto), 'no incluye ' + secreto.slice(0, 6));
  const r2 = await (await req('/org/' + org + '/admin/estado', { method: 'POST', token: tok, body: { codigo } })).json();
  assert.equal(r2.generado, e.generado, 'caché de 10 s');
});
