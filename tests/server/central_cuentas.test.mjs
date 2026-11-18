// Servidor central con cuentas comunes: activación única, acceso desde dispositivos nuevos solo con
// usuario y contraseña, preventivos que aparecen solos, cambios de contraseña, bajas, conexión de un
// dispositivo ya en uso y protecciones del acceso público. Sin interfaz, contra el servidor real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryAdapter } from '../../src/data/idb.js';
import { AppCore } from '../../src/app/core.js';
import * as C from '../../src/core/commands.js';
import { cuentaUid } from '../../src/data/central.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uco-cuentas-'));
const PORT = 19600 + Math.floor(Math.random() * 300);
const SERVER = `http://127.0.0.1:${PORT}`;
const ADMIN = 'ADMIN-PRUEBA-LOCAL-0001';
const PRUEBAS = 'PRUEB-ASSOL-OLOCA-L0002';
let proc; const cores = [];

async function dispositivo(nombre, { pruebas = false } = {}) {
  const c = new AppCore(new MemoryAdapter(), { servidor: SERVER, pruebas });
  await c.boot();
  c.central.cuentaIter = 100000; // mínimo admitido por el servidor: pruebas más rápidas
  c.sync.intervalMs = 999999; c.central.intervalMs = 999999;
  cores.push(c); c._nombre = nombre; return c;
}
const api = (p, opts = {}) => fetch(SERVER + '/api/v1' + p, { headers: { 'Content-Type': 'application/json' }, ...opts, body: opts.body ? JSON.stringify(opts.body) : undefined });
const parar = c => { c.sync.stopAll(); c.central.stop(); clearInterval(c._bk); };
async function rechaza(p, re) { await assert.rejects(p, e => { assert.match(e.message, re); return true; }); }

test.before(async () => {
  proc = spawn(process.execPath, [path.join(ROOT, 'server/server.mjs'), '--port', String(PORT), '--data', DATA, '--host', '127.0.0.1', '--quiet'], { stdio: 'ignore', env: { ...process.env, UCO_CODIGO_ADMIN: ADMIN, UCO_CODIGO_PRUEBAS: PRUEBAS } });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(SERVER + '/api/v1/salud')).ok) return; } catch { } await new Promise(r => setTimeout(r, 100)); }
  throw new Error('servidor no disponible');
});
test.after(async () => { for (const c of cores) parar(c); proc.kill('SIGTERM'); await new Promise(r => proc.on('exit', r)); fs.rmSync(DATA, { recursive: true, force: true }); });

let A, B, pidA;

test('sin conexión ni servidor configurado no se consulta ningún servidor (las pruebas nunca tocan el real)', async () => {
  const c = new AppCore(new MemoryAdapter());
  await c.boot();
  assert.equal(c.servidorCentral(), '', 'fuera del navegador no hay servidor por defecto');
  assert.equal(await c.consultarCentral(), null);
});

test('activación única: el primer administrador crea el espacio con el código del servidor', async () => {
  A = await dispositivo('A');
  const r0 = await A.consultarCentral();
  assert.equal(r0.org, null, 'servidor sin activar');
  await A.setup({ usuario: 'jefe', nombre: 'Jefa de guardia', password: 'clave-jefa-1' });
  assert.equal(A.minPassword(), 8, 'con servidor central accesible se exigen 8 caracteres');
  await rechaza(A.centralActivar({ codigo: 'XXXXX-XXXXX-XXXXX-XXXXX', password: 'clave-jefa-1' }), /incorrecto/i);
  await rechaza(A.centralActivar({ codigo: ADMIN, password: 'otra-clave' }), /no es correcta/);
  const m = await A.centralActivar({ codigo: ADMIN, password: 'clave-jefa-1', nombre: 'UCO pruebas' });
  assert.ok(m.org.startsWith('org_'));
  assert.equal(m.principal, true);
  const pub = await (await api('/central')).json();
  assert.equal(pub.org, m.org, 'el servidor publica el espacio principal');
  // un segundo intento no puede sustituir el espacio principal real
  const B0 = await dispositivo('B0');
  await B0.setup({ usuario: 'intruso', nombre: 'X', password: 'clave-intruso' });
  await rechaza(B0.centralActivar({ codigo: ADMIN, password: 'clave-intruso' }), /ya está activado/);
});

test('crear un preventivo no pide servidor: queda compartido y vinculado al espacio central', async () => {
  pidA = await A.createPrev({ datos: { nombre: 'Concierto estadio', modalidad: 'compartida', activar: true }, seed: A.seedFromConfig() });
  const m = A.meta(pidA);
  assert.equal(m.server, SERVER, 'usa el servidor central sin preguntar');
  assert.equal(m.central, A.centralMeta.org);
  await A.exec(C.avisoCreate, { tipo: 'ta_san', desc: 'Mareo puerta 3' });
  await A.sync.syncNow(pidA);
  await A.central.syncNow();
  const d = await A.central.datos();
  assert.ok(d.registro[pidA], 'registrado en el espacio central');
  assert.equal(Object.keys(d.pendPrevs).length, 0);
});

test('el administrador da de alta un usuario y este entra en un dispositivo nuevo solo con usuario y contraseña', async () => {
  const rolOp = (await A.repo.getRoles()).find(r => r.id !== 'rol_admin' && r.id !== 'rol_consulta') || { id: 'rol_consulta' };
  await A.saveUser({ usuario: 'operador', nombre: 'Operador 1', rol: rolOp.id, activo: true }, 'operador-123');
  await A.central.syncNow();
  B = await dispositivo('B');
  assert.equal((await B.consultarCentral()).org, A.centralMeta.org);
  assert.equal(await B.repo.isSetup(), false);
  await rechaza(B.accederCentral('operador', 'contraseña-mala'), /incorrectos/);
  assert.equal(await B.repo.isSetup(), false, 'un intento fallido no deja nada configurado');
  await B.accederCentral('operador', 'operador-123', { dispositivo: 'Móvil operador' });
  assert.equal(B.user.usuario, 'operador');
  assert.equal(B.user.rol, rolOp.id, 'mismo rol y permisos que en el resto de dispositivos');
  assert.equal(B.device.nombre, 'Móvil operador');
  assert.ok(B.centralMeta && B.centralMeta.org === A.centralMeta.org);
  const nombres = (await B.repo.listUsersPublic()).map(u => u.usuario).sort();
  assert.deepEqual(nombres, ['jefe', 'operador'], 'el directorio de usuarios es común');
});

test('los preventivos compartidos aparecen solos en el dispositivo nuevo y se abren sin códigos', async () => {
  const disp = await B.centralDisponibles();
  assert.ok(disp.some(x => x.pid === pidA && x.nombre === 'Concierto estadio'));
  await B.abrirCentral(pidA);
  assert.equal(B.state.prev.nombre, 'Concierto estadio');
  assert.equal(Object.values(B.state.avisos).length, 1, 'llega el aviso creado en A');
  // y lo que hace B llega a A
  await B.exec(C.avisoCreate, { tipo: 'ta_san', desc: 'Caída grada norte' });
  await B.sync.syncNow(pidA); await A.sync.syncNow(pidA);
  assert.equal(Object.values(A.state.avisos).length, 2);
});

test('el nombre y el estado del preventivo se actualizan en el registro de todos los dispositivos', async () => {
  await A.exec(C.prevUpdate, { nombre: 'Concierto estadio (tarde)' });
  await A.central.syncNow(); await B.central.syncNow();
  const d = await B.central.datos();
  assert.equal(d.registro[pidA].nombre, 'Concierto estadio (tarde)');
});

test('un usuario entra por primera vez en otro dispositivo ya conectado (comprobación en el servidor)', async () => {
  await B.logout();
  await rechaza(B.login('jefe', 'mala-clave-1'), /incorrectos/);
  await B.login('jefe', 'clave-jefa-1');
  assert.equal(B.user.usuario, 'jefe');
  await B.logout();
  await B.login('jefe', 'clave-jefa-1'); // ahora ya con su clave local (sirve sin conexión)
  assert.equal(B.user.usuario, 'jefe');
});

test('cambio de contraseña en un dispositivo: la antigua deja de valer en los demás y la nueva sirve en todos', async () => {
  await A.changeOwnPassword('clave-jefa-1', 'clave-jefa-2');
  await A.central.syncNow(); await B.central.syncNow();
  await B.logout();
  await rechaza(B.login('jefe', 'clave-jefa-1'), /incorrectos/);
  await B.login('jefe', 'clave-jefa-2');
  assert.equal(B.user.usuario, 'jefe');
  const C2 = await dispositivo('C2');
  await rechaza(C2.accederCentral('jefe', 'clave-jefa-1'), /incorrectos/);
  await C2.accederCentral('jefe', 'clave-jefa-2');
  assert.equal(C2.user.usuario, 'jefe');
});

test('desactivar un usuario le retira el acceso en dispositivos nuevos y cierra su sesión en los demás', async () => {
  const B2 = await dispositivo('B2');
  await B2.accederCentral('operador', 'operador-123');
  const op = (await A.repo.listUsers()).find(u => u.usuario === 'operador');
  await A.saveUser({ ...op, activo: false });
  await A.central.syncNow();
  let cerrada = false; B2.on(t => { if (t === 'mensaje') cerrada = true; });
  await B2.central.syncNow();
  assert.equal(B2.user, null, 'su sesión se cierra');
  assert.ok(cerrada);
  const C3 = await dispositivo('C3');
  await rechaza(C3.accederCentral('operador', 'operador-123'), /incorrectos/);
  await rechaza(B2.login('operador', 'operador-123'), /incorrectos/);
});

test('un dispositivo que ya se usaba se conecta: sus usuarios y preventivos compartidos pasan al espacio', async () => {
  const D = await dispositivo('D');
  // antes de activar no había servidor: este dispositivo se configuró en local
  await D.setup({ usuario: 'admin2', nombre: 'Admin local', password: 'clave-admin2' });
  const pidD = await D.createPrev({ datos: { nombre: 'Carrera local', modalidad: 'independiente', activar: true }, seed: D.seedFromConfig() });
  await D.setModalidad('compartida', '');
  assert.equal(D.meta(pidD).central, undefined, 'aún no conectado: compartido por archivo');
  await D.centralConectar({ usuario: 'jefe', password: 'clave-jefa-2' });
  assert.equal(D.user.usuario, 'jefe', 'la sesión pasa a la cuenta común');
  assert.equal(D.meta(pidD).central, A.centralMeta.org, 'su preventivo compartido pasa al servidor central');
  await D.sync.syncNow(pidD); await D.central.syncNow(); await A.central.syncNow();
  const da = await A.central.datos();
  assert.ok(da.registro[pidD], 'A ve el preventivo de D');
  assert.ok((await A.repo.listUsersPublic()).some(u => u.usuario === 'admin2'), 'el usuario local de D pasa al directorio común');
  await A.abrirCentral(pidD);
  assert.equal(A.state.prev.nombre, 'Carrera local');
});

test('protecciones del acceso público: sal señuelo, límite de intentos y entornos separados', async () => {
  const org = A.centralMeta.org;
  const uid = await cuentaUid(org, 'no-existe');
  const s1 = await (await api(`/org/${org}/acceso/sal`, { method: 'POST', body: { uid } })).json();
  const s2 = await (await api(`/org/${org}/acceso/sal`, { method: 'POST', body: { uid } })).json();
  assert.equal(s1.salt, s2.salt, 'una cuenta inexistente recibe una sal estable (no se distingue de una real)');
  assert.equal(s1.iter, 600000);
  const uidJ = await cuentaUid(org, 'jefe');
  let ult;
  for (let i = 0; i < 9; i++) ult = await api(`/org/${org}/acceso`, { method: 'POST', body: { uid: uidJ, prueba: Buffer.alloc(32, i).toString('base64') } });
  assert.equal(ult.status, 429, 'tras 8 fallos la cuenta se bloquea 15 minutos');
  // sin el secreto del espacio no se pueden publicar ni borrar cuentas
  assert.equal((await api(`/org/${org}/cuentas/${uidJ}`, { method: 'DELETE' })).status, 401);
  // entorno de pruebas: espacio aparte; el código de pruebas no vale para el real
  const T = await dispositivo('T', { pruebas: true });
  assert.equal((await T.consultarCentral()).org, null, 'el entorno de pruebas no ve el espacio real');
  await T.setup({ usuario: 'claude_test', nombre: 'CLAUDE_TEST', password: 'clave-de-prueba' });
  const mt = await T.centralActivar({ codigo: PRUEBAS, password: 'clave-de-prueba', nombre: 'CLAUDE_TEST' });
  assert.equal(mt.pruebas, true);
  assert.equal((await (await api('/central')).json()).org, org, 'el espacio real sigue siendo el principal');
  assert.equal((await (await api('/central?entorno=pruebas')).json()).org, mt.org);
  const r = await api('/org', { method: 'POST', body: { org: 'org_suplanta', tokenHash: 'a'.repeat(64), codigo: PRUEBAS, principal: true } });
  assert.equal(r.status, 403, 'el código de pruebas no crea espacios reales');
  // limpieza segura del espacio de pruebas
  const del = await api(`/org/${mt.org}`, { method: 'DELETE', body: { codigo: PRUEBAS } });
  assert.equal(del.status, 200);
  assert.equal((await (await api('/central?entorno=pruebas')).json()).org, null);
  assert.equal((await api(`/org/${org}`, { method: 'DELETE', body: { codigo: PRUEBAS } })).status, 403, 'el espacio real no se puede borrar');
});

test('cuenta con el coste de derivación real (600.000 iteraciones PBKDF2)', async () => {
  A.central.cuentaIter = undefined;
  await A.saveUser({ usuario: 'medico', nombre: 'Médico', rol: 'rol_admin', activo: true }, 'medico-2026');
  await A.central.syncNow();
  const E = await dispositivo('E');
  const t = Date.now();
  await E.accederCentral('medico', 'medico-2026');
  assert.equal(E.user.usuario, 'medico');
  assert.ok(Date.now() - t < 15000, 'el acceso tarda un tiempo razonable');
});
