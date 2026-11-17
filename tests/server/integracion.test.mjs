// Integración completa sin interfaz: repositorio cifrado + motor + sincronización real
// contra el servidor, con desconexiones, conflictos, paquetes por archivo y copias.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryAdapter } from '../../src/data/idb.js';
import { AppCore } from '../../src/app/core.js';
import * as C from '../../src/core/commands.js';
import { stableStringify } from '../../src/core/util.js';
import { decodeJoinCode, encodeJoinCode } from '../../src/data/sync.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uco-int-'));
const PORT = 19100 + Math.floor(Math.random() * 400);
const SERVER = `http://127.0.0.1:${PORT}`;
let proc;
const cores = [];

async function newCore(nombre) {
  const c = new AppCore(new MemoryAdapter());
  await c.boot();
  await c.setup({ usuario: 'admin', nombre, password: 'clave-' + nombre });
  await c.repo.saveDevice({ nombre: 'Tablet ' + nombre, code: nombre.slice(0, 1).toUpperCase() });
  c.sync.intervalMs = 999999;
  cores.push(c); return c;
}
const units = c => Object.values(c.state.units).filter(u => !u.eliminada);
const byInd = (c, ind) => units(c).find(u => u.ind === ind);
const snap = c => stableStringify({ u: c.state.units, a: c.state.avisos, p: c.state.prev, k: c.state.conflicts });
function same(x, y) {
  const a = snap(x), b = snap(y);
  if (a === b) return;
  const ax = JSON.parse(a), bx = JSON.parse(b); const diff = [];
  for (const k of ['u', 'a', 'k']) for (const id of new Set([...Object.keys(ax[k]), ...Object.keys(bx[k])])) if (stableStringify(ax[k][id]) !== stableStringify(bx[k][id])) diff.push(k + ':' + id + (ax[k][id] ? '' : ' (falta en 1)') + (bx[k][id] ? '' : ' (falta en 2)'));
  if (stableStringify(ax.p) !== stableStringify(bx.p)) diff.push('prev');
  assert.fail('Estados distintos: ' + diff.join(', '));
}

test.before(async () => {
  proc = spawn(process.execPath, [path.join(ROOT, 'server/server.mjs'), '--port', String(PORT), '--data', DATA, '--host', '127.0.0.1', '--quiet'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(SERVER + '/api/v1/salud')).ok) return; } catch { } await new Promise(r => setTimeout(r, 100)); }
  throw new Error('servidor no disponible');
});
test.after(async () => {
  for (const c of cores) { c.sync.stopAll(); clearInterval(c._bk); }
  proc.kill('SIGTERM'); fs.rmSync(DATA, { recursive: true, force: true });
});

let A, B, joinCode;

test('A crea un preventivo compartido y B se incorpora con el código', async () => {
  A = await newCore('Ana');
  const seed = A.seedFromConfig();
  seed.unidades = [{ ind: 'AMB-1', tipo: 'rt_svb' }, { ind: 'AMB-2', tipo: 'rt_svb' }, { ind: 'VIR-1', tipo: 'rt_vir' }];
  await A.createPrev({ datos: { nombre: 'Maratón', modalidad: 'compartida', activar: true }, seed, server: SERVER });
  A.sync.stop(A.cur);
  const [av] = await A.exec(C.avisoCreate, { tipo: 'ta_san', desc: 'Calambres km 12' });
  let st = await A.sync.syncNow(A.cur);
  assert.equal(st.estado, 'sincronizado', st.error);
  assert.equal(A.state.avisos[av.e].num, 1, 'número definitivo asignado por el servidor');
  assert.equal(A.state.avisos[av.e].ref, 'A-1');
  joinCode = A.joinCode();
  assert.equal(decodeJoinCode(joinCode).server, SERVER);
  B = await newCore('Benito');
  const r = await B.joinPrev(joinCode);
  assert.equal(r.ok, true, JSON.stringify(r));
  B.sync.stop(B.cur);
  assert.equal(B.state.prev.nombre, 'Maratón');
  assert.equal(units(B).length, 3);
  same(A, B);
});

test('avisos creados a la vez en dos dispositivos: sin duplicados y numeración única', async () => {
  const pid = A.cur;
  await A.exec(C.avisoCreate, { desc: 'A1' }); await B.exec(C.avisoCreate, { desc: 'B1' });
  await A.exec(C.avisoCreate, { desc: 'A2' }); await B.exec(C.avisoCreate, { desc: 'B2' });
  await Promise.all([A.sync.syncNow(pid), B.sync.syncNow(pid)]);
  await A.sync.syncNow(pid); await B.sync.syncNow(pid);
  const nums = Object.values(A.state.avisos).map(a => a.num).sort((x, y) => x - y);
  assert.deepEqual(nums, [1, 2, 3, 4, 5]);
  same(A, B);
});

test('desconexión: B sigue trabajando sin red y al reconectar se sincroniza sin pérdidas', async () => {
  const pid = A.cur;
  const realFetch = B.sync.fetch;
  B.sync.fetch = async () => { throw new TypeError('Failed to fetch'); };
  const amb2 = byInd(B, 'AMB-2');
  const [avB] = await B.exec(C.avisoCreate, { desc: 'Sin red', tipo: 'ta_san' });
  await B.exec(C.avisoAsignar, avB.e, amb2.id);
  await B.exec(C.unitClave, amb2.id, 'C2');
  let st = await B.sync.syncNow(pid);
  assert.equal(st.estado, 'sin_conexion');
  assert.equal(st.pendientes, 3);
  assert.equal(B.state.avisos[avB.e].num, null, 'sin red: referencia provisional');
  assert.equal(B.state.avisos[avB.e].ref, 'B-3');
  // A sigue operando
  const vir = byInd(A, 'VIR-1');
  await A.exec(C.unitRest, vir.id);
  await A.sync.syncNow(pid);
  // reconexión
  B.sync.fetch = realFetch;
  st = await B.sync.syncNow(pid);
  assert.equal(st.estado, 'sincronizado', st.error);
  await A.sync.syncNow(pid);
  same(A, B);
  assert.equal(A.state.avisos[avB.e].num, 6, 'número definitivo tras reconectar');
  assert.equal(A.state.units[amb2.id].clave, 'C2');
  assert.ok(A.state.units[vir.id].descanso);
});

test('conflicto: misma unidad editada sin conexión en ambos dispositivos', async () => {
  const pid = A.cur;
  const u = byInd(A, 'AMB-1');
  await A.exec(C.unitUpdate, u.id, { nombre: 'Nombre puesto en A' });
  await new Promise(r => setTimeout(r, 5));
  await B.exec(C.unitUpdate, u.id, { nombre: 'Nombre puesto en B' });
  await A.sync.syncNow(pid); await B.sync.syncNow(pid); await A.sync.syncNow(pid);
  same(A, B);
  const confA = A.engine().pendingConflicts();
  assert.equal(confA.length, 1, 'conflicto detectado, no se sobrescribe en silencio');
  assert.equal(A.state.units[u.id].nombre, 'Nombre puesto en A');
  await A.exec(C.resolverConflicto, confA[0].id, 'aceptar');
  await A.sync.syncNow(pid); await B.sync.syncNow(pid);
  assert.equal(B.state.units[u.id].nombre, 'Nombre puesto en B');
  assert.equal(B.engine().pendingConflicts().length, 0);
  same(A, B);
});

test('sincronización por archivo sin servidor', async () => {
  const Cc = await newCore('Carla');
  const j = decodeJoinCode(joinCode);
  const offlineCode = encodeJoinCode({ server: '', pid: j.pid, secret: j.secret, nombre: j.nombre });
  const r = await Cc.joinPrev(offlineCode);
  assert.equal(r.needBundle, true);
  const bundle = await A.exportBundle(A.cur);
  const imp = await Cc.importBundle(bundle);
  assert.ok(imp.nuevas > 10);
  await Cc.openPrev(j.pid);
  same(Cc, A);
  // un paquete de otro preventivo o manipulado no se acepta
  const bad = JSON.parse(bundle); bad.ops[0].c = bad.ops[0].c.slice(0, -8) + 'AAAAAAA=';
  bad.ops[0].id = 'op_falso';
  await assert.rejects(() => Cc.importBundle(JSON.stringify(bad)));
});

test('copias: exportación cifrada y restauración completa en otro dispositivo', async () => {
  const file = await A.repo.exportBackupFile('Copia-Segura-1');
  assert.ok(!file.includes('Maratón'), 'el archivo de copia está cifrado');
  const D = new AppCore(new MemoryAdapter()); await D.boot(); cores.push(D);
  const p = await D.repo.parseBackupFile(file, 'Copia-Segura-1');
  await assert.rejects(() => D.repo.parseBackupFile(file, 'mala'));
  // restauración completa en un dispositivo nuevo: adopta datos y usuarios de A
  await assert.rejects(() => D.repo.restore(p, 'fusionar'), /sin configurar/);
  await D.repo.restore(p, 'reemplazar');
  D.repo.dek = null;
  await D.login('admin', 'clave-Ana');
  await D.openPrev(A.cur);
  same(D, A);
  // integridad
  const v = await D.repo.verify();
  assert.equal(v.ok, true);
  // una copia alterada se rechaza
  const tampered = JSON.parse(await A.repo.exportBackupFile(''));
  tampered.ops[0].body.x = { hack: true };
  await assert.rejects(() => D.repo.parseBackupFile(JSON.stringify(tampered)), /integridad/);
});

test('seguridad: bloqueo tras intentos fallidos y recuperación con clave', async () => {
  const E = new AppCore(new MemoryAdapter()); await E.boot(); cores.push(E);
  const { recovery } = await E.setup({ usuario: 'jefe', nombre: 'Jefe', password: 'correcta' });
  await E.logout();
  for (let i = 0; i < 5; i++) await assert.rejects(() => E.login('jefe', 'mal'), /incorrectos/);
  await assert.rejects(() => E.login('jefe', 'correcta'), /Demasiados intentos/);
  await E.recover(recovery, 'jefe', 'nueva-clave');
  assert.equal(E.user.usuario, 'jefe');
  await E.logout();
  await E.login('jefe', 'nueva-clave');
  const users = await E.storage.getAll('users');
  assert.ok(!JSON.stringify(users).includes('nueva-clave'), 'la contraseña no se guarda');
});

test('recuperación del servidor: reenvío completo sin duplicados y conservando la numeración', async () => {
  const pid = A.cur;
  const antes = Object.values(A.state.avisos).map(a => a.desc + ':' + a.num).sort();
  // El servidor pierde los datos de este preventivo
  proc.kill('SIGTERM'); await new Promise(r => proc.on('exit', r));
  fs.rmSync(path.join(DATA, pid), { recursive: true, force: true });
  proc = spawn(process.execPath, [path.join(ROOT, 'server/server.mjs'), '--port', String(PORT), '--data', DATA, '--host', '127.0.0.1', '--quiet'], { stdio: 'ignore' });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(SERVER + '/api/v1/salud')).ok) break; } catch { } await new Promise(r => setTimeout(r, 100)); }
  const st = await A.resendAll();
  assert.equal(st.estado, 'sincronizado', st.error);
  // Un dispositivo nuevo se incorpora y recibe todo con los mismos números
  const F = await newCore('Fede');
  const r = await F.joinPrev(A.joinCode());
  assert.equal(r.ok, true, JSON.stringify(r));
  F.sync.stop(F.cur);
  assert.deepEqual(Object.values(F.state.avisos).map(a => a.desc + ':' + a.num).sort(), antes);
  // Un aviso nuevo recibe el siguiente número
  const [av] = await F.exec(C.avisoCreate, { desc: 'Tras recuperar' });
  await F.sync.syncNow(F.cur);
  assert.equal(F.state.avisos[av.e].num, Math.max(...antes.map(x => Number(x.split(':')[1]))) + 1);
});
