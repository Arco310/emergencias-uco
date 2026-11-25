// 1.4.0 · Espacio central en «modo servidor»: cuentas, registro, código + PIN, permisos comprobados en el
// servidor (también llamando directamente a la API), política de tipos inactivos, alcance por preventivo,
// auditoría y migración de un espacio 1.3.0. Las operaciones se generan con los comandos reales de la app.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { cuentaDerivar, orgKeys, prevKeys, seal, open } from '../../src/core/crypto.js';
import { b64, unb64, randomBytes, setClock } from '../../src/core/util.js';
import { cuentaUid } from '../../server/espacio-servidor.mjs';
import { Device, createPrev, unitByInd, C } from '../unit/helpers.mjs';
import { defaultRoles, permsOf } from '../../src/core/perms.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uco-ms-'));
const PORT = 21000 + Math.floor(Math.random() * 400);
const ADMIN = 'MSADM-INPRU-EBALO-CAL12';
const base = `http://127.0.0.1:${PORT}/api/v1`;
let proc;
async function api(p, { method = 'GET', body, token } = {}) {
  const r = await fetch(base + p, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body ? JSON.stringify(body) : undefined });
  let j = null; try { j = await r.json(); } catch { }
  return { status: r.status, ...(j || {}) };
}
test.before(async () => {
  // UCO_SERVIDOR_JS: probar el servidor empaquetado para Windows (dist/servidor-uco-windows/servidor/server.mjs)
  proc = spawn(process.execPath, [process.env.UCO_SERVIDOR_JS || path.join(ROOT, 'server/server.mjs'), '--port', String(PORT), '--data', DATA, '--host', '127.0.0.1', '--quiet'], { stdio: 'ignore', env: { ...process.env, UCO_CODIGO_ADMIN: ADMIN, UCO_CODIGO_MS: '1500' } });
  for (let i = 0; i < 60; i++) { try { if ((await fetch(base + '/salud')).ok) return; } catch { } await new Promise(r => setTimeout(r, 100)); }
  throw new Error('El servidor no arrancó');
});
test.after(async () => { setClock(null); proc.kill('SIGTERM'); await new Promise(r => proc.on('exit', r)); fs.rmSync(DATA, { recursive: true, force: true }); });

const ITER = 100000;
async function pw(password) { const salt = randomBytes(16); const d = await cuentaDerivar(password, salt, ITER); return { salt: b64(salt), iter: ITER, verif: d.verif }; }
async function entrar(org, usuario, password, dev = 'dev_' + usuario) {
  const uid = cuentaUid(org, usuario);
  const s = await api('/org/' + org + '/acceso/sal', { method: 'POST', body: { uid } });
  const d = await cuentaDerivar(password, unb64(s.salt), s.iter);
  return api('/org/' + org + '/acceso', { method: 'POST', body: { uid, prueba: b64(d.prueba), dev } });
}
function resolverReto(r) { for (let n = 0; ; n++) { const h = crypto.createHash('sha256').update(r.reto + ':' + n).digest(); if (h[0] === 0 && h[1] === 0) return n; } }
const transporte = op => { const b = { ...op }; delete b.sq; delete b.num; delete b.ps; return b; };
async function enviar(pid, k, ops, token) {
  const body = { ops: await Promise.all(ops.map(async op => ({ id: op.id, d: op.d, h: op.h, nn: !!op.nn, num: op.num ?? null, c: await seal(k.key, transporte(op)) }))) };
  return api('/prev/' + pid + '/ops', { method: 'POST', token, body });
}
const usuarioDe = (id, nombre, rol = 'rol_admin') => ({ id, nombre, perms: permsOf(defaultRoles(), rol) });

let ORG, secret, kOrg, admin, adminId;
test('espacio nuevo en modo servidor: el creador es el primer administrador y entra con su contraseña', async () => {
  secret = randomBytes(32); kOrg = await orgKeys(secret); ORG = 'org_' + crypto.randomBytes(8).toString('hex');
  const r = await api('/org', { method: 'POST', body: { org: ORG, tokenHash: kOrg.tokenHash, nombre: 'UCO pruebas', codigo: ADMIN, principal: true, pruebas: false, modo: 'servidor', secret: b64(secret), admin: { usuario: 'jefa', nombre: 'Jefa', pw: await pw('clave-jefa-1') }, dev: 'dev_jefa' } });
  assert.equal(r.status, 201); assert.equal(r.modo, 'servidor'); assert.match(r.sesion, /^[0-9a-f]{64}$/);
  const a = await entrar(ORG, 'jefa', 'clave-jefa-1');
  assert.equal(a.status, 200); assert.equal(a.secret, b64(secret), 'recibe la clave para abrir los datos del dispositivo');
  admin = a.sesion; adminId = a.usuario.id;
  const yo = await api('/org/' + ORG + '/yo', { token: admin });
  assert.ok(yo.permisos.includes('usuarios.admin'));
  assert.equal((await entrar(ORG, 'jefa', 'otra-clave')).status, 403);
  assert.equal((await api('/version')).minCliente, '1.4.0', 'las apps anteriores deben actualizarse');
  assert.equal((await api('/org/' + ORG, { token: kOrg.token })).status, 401, 'el token del espacio ya no basta');
});

let opeSes, opeId;
test('registro desde el inicio de sesión: anti-abuso, sin duplicados y pendiente de aprobación sin permisos', async () => {
  const reto = await api('/org/' + ORG + '/registro/reto');
  assert.equal(reto.dificultad, 16);
  const datos = { usuario: 'Pepe Operador', nombre: 'Pepe', ...(await pw('clave-pepe-1')) };
  assert.equal((await api('/org/' + ORG + '/registro', { method: 'POST', body: { ...datos, ...reto, nonce: 1 } })).status, 400, 'sin la prueba de trabajo no');
  const nonce = resolverReto(reto);
  const r = await api('/org/' + ORG + '/registro', { method: 'POST', body: { ...datos, ...reto, nonce } });
  assert.equal(r.status, 201); assert.equal(r.estado, 'pendiente');
  assert.equal((await api('/org/' + ORG + '/registro', { method: 'POST', body: { ...datos, ...reto, nonce } })).status, 400, 'el reto no se reutiliza');
  const reto2 = await api('/org/' + ORG + '/registro/reto');
  const dup = await api('/org/' + ORG + '/registro', { method: 'POST', body: { ...datos, ...reto2, nonce: resolverReto(reto2) } });
  assert.equal(dup.status, 409); assert.match(dup.error, /ya existe/);
  const e = await entrar(ORG, 'pepe.operador', 'clave-pepe-1');
  assert.equal(e.status, 403); assert.match(e.error, /pendiente de aprobación/);
  // El administrador puede cerrar el registro
  await api('/org/' + ORG + '/admin/ajustes', { method: 'PUT', token: admin, body: { registroAbierto: false } });
  const c = await api('/org/' + ORG + '/registro/reto'); assert.equal(c.status, 403); assert.equal(c.codigo, 'registro_cerrado');
  await api('/org/' + ORG + '/admin/ajustes', { method: 'PUT', token: admin, body: { registroAbierto: true } });
});

test('aprobación con perfil; el usuario no puede darse permisos ni administrar', async () => {
  const l = await api('/org/' + ORG + '/admin/usuarios', { token: admin });
  const pepe = l.usuarios.find(u => u.usuario === 'pepe.operador');
  assert.equal(pepe.estado, 'pendiente'); assert.equal(pepe.perfil, null);
  const ap = await api('/org/' + ORG + '/admin/usuarios/' + pepe.id, { method: 'PATCH', token: admin, body: { estado: 'activo', perfil: 'rol_operador' } });
  assert.equal(ap.status, 200); assert.equal(ap.usuario.estado, 'activo');
  const e = await entrar(ORG, 'pepe.operador', 'clave-pepe-1', 'dev_pepe');
  assert.equal(e.status, 200); opeSes = e.sesion; opeId = e.usuario.id;
  assert.equal((await api('/org/' + ORG + '/admin/usuarios/' + opeId, { method: 'PATCH', token: opeSes, body: { perfil: 'rol_admin' } })).status, 403);
  assert.equal((await api('/org/' + ORG + '/admin/usuarios', { token: opeSes })).status, 403);
  assert.equal((await api('/org/' + ORG + '/admin/perfiles', { method: 'PUT', token: opeSes, body: { perfiles: defaultRoles() } })).status, 403);
  assert.equal((await api('/org/' + ORG + '/admin/usuarios/' + adminId, { method: 'PATCH', token: admin, body: { perfil: 'rol_operador' } })).status, 403, 'tampoco el administrador cambia sus propios permisos');
});

let pinCodigo, pinId; const CRED = crypto.randomBytes(32).toString('hex');
test('cuenta sin contraseña: código de un solo uso que caduca y PIN ligado al dispositivo', async () => {
  const r = await api('/org/' + ORG + '/admin/usuarios', { method: 'POST', token: admin, body: { usuario: 'Luis', nombre: 'Luis Conductor', metodo: 'pin', perfil: 'rol_consulta' } });
  assert.equal(r.status, 201); assert.match(r.codigo, /^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{2}$/); assert.equal(r.usuario.estado, 'invitado');
  pinCodigo = r.codigo; pinId = r.usuario.id;
  assert.equal((await entrar(ORG, 'luis', '')).status, 403, 'sin contraseña no se entra con contraseña');
  assert.equal((await api('/org/' + ORG + '/activacion', { method: 'POST', body: { usuario: 'luis', codigo: 'AAAA-BBBB-CC', dev: 'dev_luis', cred: CRED } })).status, 403);
  const a = await api('/org/' + ORG + '/activacion', { method: 'POST', body: { usuario: 'luis', codigo: pinCodigo.toLowerCase(), dev: 'dev_luis', devNombre: 'Móvil de Luis', cred: CRED } });
  assert.equal(a.status, 200); assert.equal(a.usuario.estado, 'activo'); assert.ok(a.sesion);
  assert.equal((await api('/org/' + ORG + '/activacion', { method: 'POST', body: { usuario: 'luis', codigo: pinCodigo, dev: 'dev_otro', cred: CRED } })).status, 403, 'un solo uso');
  const uid = cuentaUid(ORG, 'luis');
  assert.equal((await api('/org/' + ORG + '/acceso/dispositivo', { method: 'POST', body: { uid, dev: 'dev_luis', cred: CRED } })).status, 200);
  assert.equal((await api('/org/' + ORG + '/acceso/dispositivo', { method: 'POST', body: { uid, dev: 'dev_luis', cred: crypto.randomBytes(32).toString('hex') } })).status, 403);
  assert.equal((await api('/org/' + ORG + '/acceso/dispositivo', { method: 'POST', body: { uid, dev: 'dev_otro', cred: CRED } })).status, 403, 'solo en ese dispositivo');
  // Revocar el dispositivo le retira el acceso
  await api('/org/' + ORG + '/admin/usuarios/' + pinId + '/revocar', { method: 'POST', token: admin, body: { dev: 'dev_luis' } });
  assert.equal((await api('/org/' + ORG + '/acceso/dispositivo', { method: 'POST', body: { uid, dev: 'dev_luis', cred: CRED } })).status, 403);
  // Código caducado (en estas pruebas caducan a los 1,5 s)
  const c2 = await api('/org/' + ORG + '/admin/usuarios/' + pinId + '/codigo', { method: 'POST', token: admin, body: {} });
  await new Promise(r => setTimeout(r, 1700));
  const cad = await api('/org/' + ORG + '/activacion', { method: 'POST', body: { usuario: 'luis', codigo: c2.codigo, dev: 'dev_luis', cred: CRED } });
  assert.equal(cad.status, 403); assert.match(cad.error, /caducado/);
  const c3 = await api('/org/' + ORG + '/admin/usuarios', { method: 'POST', token: admin, body: { usuario: 'ana.caduca', metodo: 'pin', perfil: 'rol_consulta' } });
  await new Promise(r => setTimeout(r, 1700));
  const l = await api('/org/' + ORG + '/admin/usuarios', { token: admin });
  assert.equal(l.usuarios.find(u => u.id === c3.usuario.id).estadoVisible, 'caducado', 'activación caducada visible');
});

let PID, kPrev, A;
test('operaciones: el servidor comprueba permisos e identidad aunque se llame directamente a la API', async () => {
  // La administradora crea un preventivo compartido del espacio (el servidor custodia su clave)
  const ps = randomBytes(16); kPrev = await prevKeys(ps); PID = 'prev_ms_' + crypto.randomBytes(4).toString('hex');
  assert.equal((await api('/prev', { method: 'POST', body: { pid: PID, tokenHash: kPrev.tokenHash, org: ORG, secret: b64(ps) } })).status, 401, 'sin sesión no');
  assert.equal((await api('/prev', { method: 'POST', token: opeSes, body: { pid: PID, tokenHash: kPrev.tokenHash, org: ORG, secret: b64(ps) } })).status, 403, 'un operador no crea preventivos');
  assert.equal((await api('/prev', { method: 'POST', token: admin, body: { pid: PID, tokenHash: kPrev.tokenHash, org: ORG, secret: b64(ps) } })).status, 201);
  assert.equal((await api('/org/' + ORG + '/prevs/' + PID, { method: 'PUT', token: admin, body: { w: await seal(kOrg.key, { secret: b64(ps), nombre: 'Concierto', pid: PID }) } })).status, 200);
  A = new Device({ id: 'dev_jefa', pid: PID, mode: 'compartida', user: usuarioDe(adminId, 'Jefa') });
  const opsA = [...createPrev(A), ...A.run(C.unitCreate, { ind: 'SVB-1', tipo: 'rt_svb' })];
  const r = await enviar(PID, kPrev, opsA, admin);
  assert.equal(r.status, 200); assert.ok(r.res.every(x => !x.rechazada), JSON.stringify(r.res.filter(x => x.rechazada)));
  // Pepe (operador): crear unidades sí; archivar no, aunque manipule la app
  const B = new Device({ id: 'dev_pepe', code: 'B', pid: PID, mode: 'compartida', user: usuarioDe(opeId, 'Pepe', 'rol_admin') }); B.receive(A.store);
  const okB = await enviar(PID, kPrev, B.run(C.unitCreate, { ind: 'SVB-2', tipo: 'rt_svb' }), opeSes);
  assert.ok(!okB.res[0].rechazada);
  const malo = await enviar(PID, kPrev, B.run(C.unitSit, unitByInd(B, 'SVB-1').id, 'archivada'), opeSes);
  assert.equal(malo.res[0].rechazada, true); assert.equal(malo.res[0].codigo, 'permiso'); assert.match(malo.res[0].error, /eliminar o archivar unidades/);
  const g = await api('/prev/' + PID + '/ops?after=0', { token: opeSes });
  assert.ok(!g.ops.some(o => o.id === malo.res[0].id), 'la operación rechazada no se guarda');
  // Contenido manipulado (1.5.0): coordenadas imposibles en un aviso; la app no lo permite y el servidor tampoco
  const av = B.run(C.avisoCreate, { desc: 'Manipulado', loc: { txt: '', lat: 40.4, lon: -3.7, fuente: 'mapa' } });
  av[0].x.a.loc.lat = 500;
  const r5 = await enviar(PID, kPrev, av, opeSes);
  assert.equal(r5.res[0].rechazada, true); assert.equal(r5.res[0].codigo, 'datos'); assert.match(r5.res[0].error, /coordenadas/i);
  // Registro del informe (1.5.0): el servidor valida la huella y lo admite con el permiso (exportar incluye generar)
  const inf = B.run(C.informeRegistrar, { accion: 'generar', n: 1, hash: 'ab'.repeat(32), formato: 'pdf' });
  inf[0].x.hash = 'no-es-una-huella';
  const r6 = await enviar(PID, kPrev, inf, opeSes);
  assert.equal(r6.res[0].rechazada, true); assert.equal(r6.res[0].codigo, 'datos'); assert.match(r6.res[0].error, /huella/i);
  const r7 = await enviar(PID, kPrev, B.run(C.informeRegistrar, { accion: 'exportar', formato: 'xlsx' }), opeSes);
  assert.ok(!r7.res[0].rechazada, JSON.stringify(r7.res[0])); assert.ok(r7.res[0].rx > 0, 'hora de recepción del servidor');
  // Suplantación: Pepe envía una operación firmada como la administradora, o desde otro dispositivo
  const falsa = A.run(C.unitCreate, { ind: 'X-1' });
  const s1 = await enviar(PID, kPrev, falsa, opeSes);
  assert.equal(s1.res[0].codigo, 'identidad');
  const C2 = new Device({ id: 'dev_robado', pid: PID, mode: 'compartida', user: usuarioDe(opeId, 'Pepe') }); C2.receive(A.store);
  assert.equal((await enviar(PID, kPrev, C2.run(C.unitCreate, { ind: 'X-2' }), opeSes)).res[0].codigo, 'identidad');
  // El token del preventivo (apps 1.3.0) ya no sirve
  assert.equal((await api('/prev/' + PID + '/ops?after=0', { token: kPrev.token })).status, 401);
});

test('tipo de recurso inactivo: el servidor rechaza la unidad nueva aunque el dispositivo tenga datos antiguos', async () => {
  const tipo = { id: 'rt_svb', nombre: 'Ambulancia SVB', activo: false, color: '#2E7D32', vis: {} };
  const put = await api('/org/' + ORG + '/config/' + encodeURIComponent('tipo:rt_svb'), { method: 'PUT', token: admin, body: { base: 0, c: await seal(kOrg.key, { id: 'tipo:rt_svb', data: tipo }) } });
  assert.equal(put.status, 200);
  // El operador no puede tocar la configuración de recursos ni los usuarios
  assert.equal((await api('/org/' + ORG + '/config/' + encodeURIComponent('tipo:rt_x'), { method: 'PUT', token: opeSes, body: { base: 0, c: await seal(kOrg.key, { id: 'tipo:rt_x', data: { id: 'rt_x' } }) } })).status, 403);
  assert.equal((await api('/org/' + ORG + '/config/' + encodeURIComponent('usr:' + opeId), { method: 'PUT', token: admin, body: { base: 1, c: await seal(kOrg.key, { id: 'usr:' + opeId, data: {} }) } })).status, 403, 'los usuarios los escribe solo el servidor');
  const B = new Device({ id: 'dev_pepe', code: 'B', pid: PID, mode: 'compartida', user: usuarioDe(opeId, 'Pepe') });
  B.receive((await api('/prev/' + PID + '/ops?after=0', { token: opeSes })).ops.length ? A.store : []);
  const r = await enviar(PID, kPrev, B.run(C.unitCreate, { ind: 'SVB-9', tipo: 'rt_svb' }), opeSes);
  assert.equal(r.res[0].rechazada, true); assert.equal(r.res[0].codigo, 'tipo_inactivo'); assert.match(r.res[0].error, /Ambulancia SVB.*desactivado/);
  const ok = await enviar(PID, kPrev, B.run(C.unitCreate, { ind: 'SVA-9', tipo: 'rt_sva' }), opeSes);
  assert.ok(!ok.res[0].rechazada, 'con un tipo activo sí');
});

test('estado del sistema (1.5.0): solo con el permiso «sistema.estado»; sin secretos; la consulta queda auditada', async () => {
  const no = await api('/org/' + ORG + '/admin/estado', { method: 'POST', token: opeSes, body: {} });
  assert.equal(no.status, 403); assert.equal(no.codigo, 'permiso');
  const e = await api('/org/' + ORG + '/admin/estado', { method: 'POST', token: admin, body: {} });
  assert.equal(e.status, 200); assert.equal(e.espacio.modo, 'servidor');
  const c = e.sincronizacion.control.find(x => x.pid === PID); assert.ok(c, 'preventivos cargados en el servidor con sus conflictos e incoherencias');
  assert.ok(e.sincronizacion.recibidas > 0 && e.sincronizacion.rechazadas > 0, 'cuenta operaciones aceptadas y rechazadas');
  assert.deepEqual(e.servidor.errores, [], 'ninguna petición atendida sigue ejecutándose ni intenta responder dos veces');
  const txt = JSON.stringify(e); for (const x of [admin, opeSes, ADMIN, b64(secret)]) assert.ok(!txt.includes(x), 'sin secretos');
  const aud = await api('/org/' + ORG + '/admin/auditoria', { token: admin });
  assert.ok(aud.registros.some(r => r.accion === 'Consulta del estado del sistema' && r.actor.usuario === 'jefa'));
});

test('alcance por preventivo y suspensión inmediata', async () => {
  const r = await api('/org/' + ORG + '/admin/usuarios', { method: 'POST', token: admin, body: { usuario: 'eva', nombre: 'Eva', perfil: 'rol_operador', pw: await pw('clave-eva-11'), alcance: { tipo: 'seleccion', preventivos: { otro_prev_1: null } } } });
  assert.equal(r.status, 201); assert.equal(r.usuario.estado, 'activo');
  const e = await entrar(ORG, 'eva', 'clave-eva-11');
  assert.equal((await api('/prev/' + PID + '/ops?after=0', { token: e.sesion })).status, 403, 'sin acceso a ese preventivo');
  const cambios = await api('/org/' + ORG + '/cambios?desde=0', { token: e.sesion });
  assert.ok(!cambios.prevs.some(p => p.pid === PID), 'tampoco lo ve en el registro');
  await api('/org/' + ORG + '/admin/usuarios/' + e.usuario.id, { method: 'PATCH', token: admin, body: { estado: 'suspendido' } });
  const s = await api('/org/' + ORG + '/cambios?desde=0', { token: e.sesion });
  assert.equal(s.status, 403); assert.match(s.error, /suspendida/);
  assert.equal((await entrar(ORG, 'eva', 'clave-eva-11')).status, 403);
});

test('auditoría: quién cambió qué y cuándo, también las operaciones rechazadas', async () => {
  const a = await api('/org/' + ORG + '/admin/auditoria', { token: admin });
  const acciones = a.registros.map(x => x.accion + (x.actor ? ' · ' + x.actor.usuario : ''));
  for (const re of [/Alta de usuario · jefa/, /Registro aprobado · jefa/, /Cuenta suspendida · jefa/, /Operación rechazada · pepe.operador/, /Solicitud de cuenta/, /Accesos revocados · jefa/])
    assert.ok(acciones.some(x => re.test(x)), re + ' en ' + acciones.join(' | '));
  const ap = a.registros.find(x => x.accion === 'Registro aprobado');
  assert.match(ap.despues, /rol_operador/); assert.ok(ap.t > 0);
  assert.equal((await api('/org/' + ORG + '/admin/auditoria', { token: opeSes })).status, 403);
});

test('migración de un espacio 1.3.0: mismas contraseñas, los usuarios pasan al directorio y las apps antiguas deben actualizarse', async () => {
  const s = randomBytes(32); const k = await orgKeys(s); const org = 'org_' + crypto.randomBytes(8).toString('hex');
  assert.equal((await api('/org', { method: 'POST', body: { org, tokenHash: k.tokenHash, nombre: 'Antiguo', codigo: ADMIN, principal: false } })).status, 201);
  // Datos como los dejaba la 1.3.0: perfiles, roles, cuenta y un preventivo registrado
  const perfil = { id: 'usr_jefe', usuario: 'jefe', nombre: 'Jefe', rol: 'rol_admin', activo: true, creado: 1, cred: { v: 'v1', central: true } };
  await api('/org/' + org + '/config/' + encodeURIComponent('usr:usr_jefe'), { method: 'PUT', token: k.token, body: { base: 0, c: await seal(k.key, { id: 'usr:usr_jefe', data: perfil }) } });
  await api('/org/' + org + '/config/roles', { method: 'PUT', token: k.token, body: { base: 0, c: await seal(k.key, { id: 'roles', data: [{ id: 'rol_admin', nombre: 'Administrador', sistema: true, permisos: ['usuarios.admin'] }, { id: 'rol_operador', nombre: 'Operador', sistema: true, permisos: ['avisos.crear'] }] }) } });
  const salt = randomBytes(16); const d = await cuentaDerivar('clave-jefe-1', salt, ITER);
  await api('/org/' + org + '/cuentas/' + cuentaUid(org, 'jefe'), { method: 'PUT', token: k.token, body: { salt: b64(salt), iter: ITER, verif: d.verif, wrap: await seal(d.envKey, { s: b64(s) }) } });
  const ps = randomBytes(16); const kp = await prevKeys(ps); const pid = 'prev_antiguo_1';
  await api('/prev', { method: 'POST', body: { pid, tokenHash: kp.tokenHash } });
  await api('/org/' + org + '/prevs/' + pid, { method: 'PUT', token: k.token, body: { w: await seal(k.key, { secret: b64(ps), nombre: 'Antiguo', pid }) } });
  // Sin el código de administración del servidor no se migra
  assert.equal((await api('/org/' + org + '/admin/migrar', { method: 'POST', token: k.token, body: { secret: b64(s), codigo: 'XXXXX' } })).status, 403);
  const m = await api('/org/' + org + '/admin/migrar', { method: 'POST', token: k.token, body: { secret: b64(s), codigo: ADMIN, usuario: 'jefe', dev: 'dev_jefe' } });
  assert.equal(m.status, 200); assert.equal(m.usuarios, 1); assert.equal(m.preventivos, 1);
  const e = await entrar(org, 'jefe', 'clave-jefe-1');
  assert.equal(e.status, 200, 'la contraseña de siempre sigue valiendo'); assert.equal(e.usuario.perfil, 'rol_admin');
  const viejo = await api('/org/' + org + '/cambios?desde=0', { token: k.token });
  assert.equal(viejo.status, 401); assert.match(viejo.error, /Actualiza la aplicación/);
  assert.equal((await api('/prev/' + pid + '/ops?after=0', { token: kp.token })).status, 401, 'el token del preventivo tampoco');
  assert.equal((await api('/prev/' + pid + '/ops?after=0', { token: e.sesion })).status, 200, 'con sesión sí');
  const yo = await api('/org/' + org + '/yo', { token: e.sesion });
  assert.ok(yo.permisos.includes('avisos.crear') && yo.permisos.includes('preventivos.ver'));
  assert.ok(fs.readdirSync(path.join(DATA, '_servidor', 'copias')).some(f => f.startsWith(org)), 'copia de seguridad previa');
});
