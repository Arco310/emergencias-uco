// 1.4.0 · La aplicación (núcleo, sin interfaz) contra el servidor en «modo servidor»: alta del espacio,
// usuarios del servidor, operaciones rechazadas que se deshacen en el dispositivo, datos antiguos de tipos
// inactivos, registro con aprobación, código + PIN, suspensión y migración de un espacio 1.3.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryAdapter } from '../../src/data/idb.js';
import { AppCore } from '../../src/app/core.js';
import * as C from '../../src/core/commands.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uco-msapp-'));
const PORT = 21500 + Math.floor(Math.random() * 400);
const SERVER = `http://127.0.0.1:${PORT}`;
const ADMIN = 'MSAPP-ADMIN-PRUEB-ALOC1';
let proc; const cores = []; const mensajes = [];
async function dispositivo({ pruebas = false } = {}) {
  const c = new AppCore(new MemoryAdapter(), { servidor: SERVER, pruebas });
  await c.boot(); c.central.cuentaIter = 100000; c.sync.intervalMs = 999999; c.central.intervalMs = 999999;
  c.on((t, d) => { if (t === 'mensaje') mensajes.push(d.texto); });
  cores.push(c); return c;
}
async function rechaza(p, re) { await assert.rejects(p, e => { assert.match(e.message, re); return true; }); }
test.before(async () => {
  proc = spawn(process.execPath, [path.join(ROOT, 'server/server.mjs'), '--port', String(PORT), '--data', DATA, '--host', '127.0.0.1', '--quiet'], { stdio: 'ignore', env: { ...process.env, UCO_CODIGO_ADMIN: ADMIN } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(SERVER + '/api/v1/salud')).ok) return; } catch { } await new Promise(r => setTimeout(r, 100)); }
  throw new Error('servidor no disponible');
});
test.after(async () => { for (const c of cores) { c.sync.stopAll(); c.central.stop(); clearInterval(c._bk); } proc.kill('SIGTERM'); await new Promise(r => proc.on('exit', r)); fs.rmSync(DATA, { recursive: true, force: true }); });

let A, B, pid, operId;
test('la administradora activa el servidor central en modo servidor y da de alta a un operador', async () => {
  A = await dispositivo();
  await A.consultarCentral();
  await A.setup({ usuario: 'jefa', nombre: 'Jefa', password: 'clave-jefa-1' });
  await A.centralActivar({ codigo: ADMIN, password: 'clave-jefa-1' });
  assert.ok(A.modoServidor()); assert.ok(A._sesionToken(), 'tiene sesión del servidor');
  const r = await A.crearUsuarioServidor({ usuario: 'oper', nombre: 'Operador', password: 'clave-oper-1', perfil: 'rol_operador' });
  assert.equal(r.usuario.estado, 'activo'); operId = r.usuario.id;
  await rechaza(A.saveUser({ usuario: 'x', nombre: 'X', rol: 'rol_operador', activo: true }, 'clave-x-12'), /servidor/);
});

test('el operador entra en un dispositivo nuevo con su perfil y sus permisos', async () => {
  B = await dispositivo();
  await B.consultarCentral();
  assert.equal(B.centralRemoto.modo, 'servidor'); assert.equal(B.centralRemoto.registroAbierto, true);
  await B.accederCentral('oper', 'clave-oper-1');
  assert.equal(B.user.usuario, 'oper'); assert.ok(B._sesionToken());
  assert.ok(B.can('avisos.crear') && B.can('unidades.ver') && !B.can('usuarios.admin') && !B.can('unidades.archivar'));
});

test('preventivo del espacio: lo permitido se sincroniza; lo no permitido lo rechaza el servidor y se deshace en el dispositivo', async () => {
  pid = await A.createPrev({ datos: { nombre: 'Maratón', modalidad: 'compartida', activar: true }, seed: A.seedFromConfig() });
  await A.exec(C.unitCreate, { ind: 'SVB-1', tipo: 'rt_svb' });
  await A.sync.syncNow(pid); await A.central.syncNow();
  await B.central.syncNow();
  assert.ok((await B.centralDisponibles()).some(x => x.pid === pid));
  await B.abrirCentral(pid);
  assert.ok(Object.values(B.state.units).some(u => u.ind === 'SVB-1'));
  await B.exec(C.unitCreate, { ind: 'SVA-2', tipo: 'rt_sva' });
  const st = await B.sync.syncNow(pid);
  assert.equal(st.estado, 'sincronizado', JSON.stringify(st));
  await A.sync.syncNow(pid);
  assert.ok(Object.values(A.state.units).some(u => u.ind === 'SVA-2'), 'llega a la administradora');
  // App manipulada: se salta la comprobación local de permisos para archivar una unidad
  const u = Object.values(B.state.units).find(x => x.ind === 'SVB-1');
  const ctx = { ...B.ctxFor(pid), user: { ...B.user, perms: new Set([...B.user.perms, 'unidades.archivar']) } };
  await B._commit(pid, B.engine(pid), C.unitSit(ctx, u.id, 'archivada'));
  assert.equal(B.state.units[u.id].sit, 'archivada', 'en el dispositivo manipulado parece hecho');
  mensajes.length = 0;
  await B.sync.syncNow(pid);
  assert.equal(B.state.units[u.id].sit, 'activa', 'el servidor lo rechaza y el dispositivo lo deshace');
  assert.ok(mensajes.some(m => /rechazado.*archivar/i.test(m)), mensajes.join(' | '));
  const rech = await B.repo.rechazos();
  assert.equal(rech.length, 1); assert.equal(rech[0].k, 'unit.sit');
  await A.sync.syncNow(pid);
  assert.equal(A.state.units[u.id].sit, 'activa', 'a los demás nunca les llega');
});

test('datos antiguos: un tipo desactivado en el servidor no se puede usar aunque el dispositivo no lo sepa todavía', async () => {
  await A.guardarTiposRecurso(A.tiposRecursoGenerales().map(t => (t.id === 'rt_svb' ? { ...t, activo: false } : t)));
  await A.central.syncNow();
  // B no ha descargado la configuración nueva: para él SVB sigue activo
  assert.ok(B.tiposParaNuevaUnidad().propios.some(t => t.id === 'rt_svb'));
  await B.exec(C.unitCreate, { ind: 'SVB-7', tipo: 'rt_svb' });
  mensajes.length = 0;
  await B.sync.syncNow(pid);
  assert.ok(!Object.values(B.state.units).some(x => x.ind === 'SVB-7'), 'la unidad desaparece del dispositivo');
  assert.ok(mensajes.some(m => /Ambulancia SVB.*desactivado/.test(m)), mensajes.join(' | '));
  await B.central.syncNow();
  assert.ok(!B.tiposParaNuevaUnidad().propios.some(t => t.id === 'rt_svb'), 'al sincronizar ya no se ofrece');
});

test('registro desde el inicio de sesión: pendiente hasta que un administrador lo aprueba', async () => {
  const N = await dispositivo();
  await N.consultarCentral();
  const r = await N.registrarse({ usuario: 'nuevo', nombre: 'Nuevo Voluntario', password: 'clave-nuevo-1' });
  assert.equal(r.estado, 'pendiente');
  await rechaza(N.registrarse({ usuario: 'nuevo', nombre: 'Otro', password: 'clave-otro-12' }), /ya existe/);
  await rechaza(N.accederCentral('nuevo', 'clave-nuevo-1'), /pendiente de aprobación/);
  const l = await A.usuariosServidor();
  const nuevo = l.usuarios.find(x => x.usuario === 'nuevo');
  assert.equal(nuevo.estado, 'pendiente'); assert.equal(nuevo.origen, 'registro');
  await A.cambiarUsuarioServidor(nuevo.id, { estado: 'activo', perfil: 'rol_consulta' });
  await N.accederCentral('nuevo', 'clave-nuevo-1');
  assert.ok(N.can('unidades.ver') && !N.can('avisos.crear') && !N.can('usuarios.admin'), 'solo consulta');
});

test('cuenta sin contraseña: código de un solo uso y PIN en el dispositivo (también sin conexión)', async () => {
  const r = await A.crearUsuarioServidor({ usuario: 'luis', nombre: 'Luis', metodo: 'pin', perfil: 'rol_operador' });
  assert.ok(r.codigo); assert.equal(r.usuario.estado, 'invitado');
  const D = await dispositivo();
  await D.consultarCentral();
  await rechaza(D.consultarCodigo('luis', 'AAAA-BBBB-CC'), /no válido/);
  assert.equal((await D.consultarCodigo('luis', r.codigo)).metodo, 'pin');
  await rechaza(D.activarCuenta({ usuario: 'luis', codigo: r.codigo, pin: '12' }), /entre 6 y 12 cifras/);
  await D.activarCuenta({ usuario: 'luis', codigo: r.codigo, pin: '482913', dispositivo: 'Móvil de Luis' });
  assert.equal(D.user.usuario, 'luis'); assert.ok(D._sesionToken()); assert.ok(D.can('avisos.crear'));
  await D.logout();
  // Sin conexión: el PIN se comprueba en el dispositivo
  D.central._req = async () => { throw Object.assign(new Error('Sin conexión'), { code: 'red' }); };
  await rechaza(D.loginPin('luis', '000000'), /PIN incorrecto/);
  await D.loginPin('luis', '482913');
  assert.equal(D.user.usuario, 'luis');
  await D.logout();
  for (let i = 0; i < 5; i++) await rechaza(D.loginPin('luis', '111111'), i < 4 ? /PIN incorrecto/ : /retirado el acceso con PIN/);
  await rechaza(D.loginPin('luis', '482913'), /no tiene PIN/, 'tras 5 fallos seguidos se retira el PIN de este dispositivo');
});

test('suspender una cuenta: el dispositivo cierra la sesión al sincronizar y ya no entra', async () => {
  await A.cambiarUsuarioServidor(operId, { estado: 'suspendido' });
  await B.central.syncNow();
  assert.equal(B.user, null, 'sesión cerrada');
  await rechaza(B.login('oper', 'clave-oper-1'), /incorrectos|suspendida/);
  const aud = await A.auditoriaServidor();
  assert.ok(aud.some(x => x.accion === 'Cuenta suspendida' && x.actor.usuario === 'jefa' && x.objetivo === 'oper'));
});

test('migración de un espacio 1.3.0 desde la aplicación: mismas cuentas, los preventivos siguen y el servidor valida', async () => {
  const T = await dispositivo({ pruebas: true });
  await T.consultarCentral();
  await T.setup({ usuario: 'jefe', nombre: 'Jefe', password: 'clave-jefe-1' });
  await T.centralActivar({ codigo: ADMIN, password: 'clave-jefe-1', modo: 'cifrado' });
  assert.ok(!T.modoServidor());
  await T.saveUser({ usuario: 'ana', nombre: 'Ana', rol: 'rol_operador', activo: true }, 'clave-ana-11');
  const p = await T.createPrev({ datos: { nombre: 'Feria', modalidad: 'compartida', activar: true }, seed: T.seedFromConfig() });
  await T.exec(C.unitCreate, { ind: 'U-1' });
  await T.sync.syncNow(p); await T.central.syncNow();
  await rechaza(T.migrarAlModoServidor({ codigo: 'XXXXX', password: 'clave-jefe-1' }), /incorrecto/i);
  const r = await T.migrarAlModoServidor({ codigo: ADMIN, password: 'clave-jefe-1' });
  assert.equal(r.usuarios, 2); assert.equal(r.preventivos, 1);
  assert.ok(T.modoServidor()); assert.ok(T._sesionToken());
  await T.exec(C.unitCreate, { ind: 'U-2' });
  assert.equal((await T.sync.syncNow(p)).estado, 'sincronizado');
  // Ana entra en otro dispositivo con su contraseña de siempre y trabaja en el preventivo
  const U = await dispositivo({ pruebas: true });
  await U.consultarCentral();
  await U.accederCentral('ana', 'clave-ana-11');
  await U.abrirCentral(p);
  assert.deepEqual(Object.values(U.state.units).map(x => x.ind).sort(), ['U-1', 'U-2']);
  assert.ok(U.can('avisos.crear') && !U.can('usuarios.admin'));
});
