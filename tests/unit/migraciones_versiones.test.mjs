// Fase 5: migraciones de los datos locales con copia previa, compatibilidad de versiones y bloqueo de la
// sincronización cuando la aplicación es anterior a la mínima que admite el servidor.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryAdapter } from '../../src/data/idb.js';
import { AppCore } from '../../src/app/core.js';
import { migrarDatos, esquemaLocal, ESQUEMA_DATOS, MIGRACIONES } from '../../src/data/migraciones.js';
import { compararVersiones, posterior } from '../../src/core/versiones.js';
import { APP_VERSION, DEFAULT_PLANTILLAS_UNIDAD } from '../../src/core/defaults.js';
import { PERM_KEYS } from '../../src/core/perms.js';

async function nucleo(adapter = new MemoryAdapter(), opts = { servidor: false }) {
  const c = new AppCore(adapter, opts);
  await c.boot(); c.sync.intervalMs = 999999;
  if (!(await c.repo.isSetup())) await c.setup({ usuario: 'jefe', nombre: 'Jefa', password: 'clave-segura' });
  else await c.login('jefe', 'clave-segura');
  return { c, adapter };
}
const parar = c => { c.sync.stopAll(); c.central.stop(); clearInterval(c._bk); };

test('comparación de versiones', () => {
  assert.equal(compararVersiones('1.2.0', '1.10.0'), -1);
  assert.equal(compararVersiones('v2.0.0', '1.99.99'), 1);
  assert.equal(compararVersiones('1.2.0', '1.2.0'), 0);
  assert.ok(posterior('1.2.1', '1.2.0')); assert.ok(!posterior('1.2.0', '1.2.0')); assert.ok(!posterior('x', '1.0.0'));
});

test('dispositivo nuevo: ya nace con el esquema actual y no migra', async () => {
  const { c } = await nucleo();
  assert.equal(await esquemaLocal(c.repo), ESQUEMA_DATOS);
  assert.equal(c.migracion.estado, 'al_dia');
  assert.equal((await c.repo.listBackups()).filter(b => b.tipo === 'migracion').length, 0);
  parar(c);
});

test('datos de la 1.1.0 (esquema 1): copia previa, migración, auditoría y nada se pierde', async () => {
  const adapter = new MemoryAdapter();
  const { c } = await nucleo(adapter);
  await c.createPrev({ datos: { nombre: 'Partido', modalidad: 'independiente', activar: true }, seed: c.seedFromConfig() });
  const pid = c.cur;
  // Simula un dispositivo de la versión anterior: esquema 1 y configuración sin unidades plantilla guardadas
  const cfg = await c.repo.getCfg(); delete cfg.plantillasUnidad; await c.repo.putDoc('cfg', cfg);
  await adapter.put('meta', { k: 'schema', v: 1 });
  parar(c); await c.logout();
  const { c: c2 } = await nucleo(adapter);
  assert.equal(c2.migracion.estado, 'migrado'); assert.equal(c2.migracion.desde, 1); assert.equal(c2.migracion.hasta, ESQUEMA_DATOS);
  assert.equal(await esquemaLocal(c2.repo), ESQUEMA_DATOS);
  const copias = (await c2.repo.listBackups()).filter(b => b.tipo === 'migracion');
  assert.equal(copias.length, 1, 'copia de seguridad previa a la migración');
  const copia = await c2.repo.readBackup(copias[0].id);
  assert.ok(!copia.docs.find(d => d.id === 'cfg').data.plantillasUnidad, 'la copia guarda los datos tal como estaban antes');
  assert.equal((await c2.repo.getDoc('cfg')).plantillasUnidad.length, DEFAULT_PLANTILLAS_UNIDAD.length, 'las unidades plantilla quedan guardadas');
  assert.ok((await c2.repo.listAudit()).some(a => a.accion === 'Migración de datos'), 'queda en la auditoría');
  assert.ok(c2.summaries.some(s => s.id === pid), 'el preventivo sigue ahí');
  // Repetir no vuelve a migrar ni a copiar
  parar(c2); await c2.logout();
  const { c: c3 } = await nucleo(adapter);
  assert.equal(c3.migracion.estado, 'al_dia');
  assert.equal((await c3.repo.listBackups()).filter(b => b.tipo === 'migracion').length, 1);
  parar(c3);
});

test('una migración que falla no avanza el esquema y se reintenta; datos de una versión posterior no se tocan', async () => {
  const { c } = await nucleo();
  await c.repo.db.put('meta', { k: 'schema', v: 1 });
  let intentos = 0;
  const fallida = [{ v: 2, version: 'x', nombre: 'falla', run: async () => { intentos++; throw new Error('fallo de prueba'); } }];
  await assert.rejects(migrarDatos(c.repo, {}, fallida, 2), /fallo de prueba/);
  assert.equal(await esquemaLocal(c.repo), 1, 'el esquema no avanza');
  const ok = [{ v: 2, version: 'x', nombre: 'ok', run: async () => { intentos++; } }];
  assert.equal((await migrarDatos(c.repo, {}, ok, 2)).estado, 'migrado');
  assert.equal(intentos, 2);
  await c.repo.db.put('meta', { k: 'schema', v: 9 });
  assert.equal((await migrarDatos(c.repo, {}, MIGRACIONES)).estado, 'posterior');
  assert.equal(await esquemaLocal(c.repo), 9, 'no se rebaja');
  parar(c);
});

test('las copias previas a migraciones se limitan a las 5 últimas', async () => {
  const { c } = await nucleo();
  for (let i = 0; i < 7; i++) await c.repo.createBackup('migracion', 'prueba ' + i);
  assert.equal((await c.repo.listBackups()).filter(b => b.tipo === 'migracion').length, 5);
  parar(c);
});

test('permiso «Gestionar las actualizaciones»: el administrador lo tiene, el operador no', async () => {
  const { c } = await nucleo();
  assert.ok(PERM_KEYS.includes('actualizaciones.gestionar'));
  assert.ok(c.can('actualizaciones.gestionar'));
  const roles = await c.repo.getRoles();
  assert.ok(!roles.find(r => r.id === 'rol_operador').permisos.includes('actualizaciones.gestionar'));
  parar(c);
});

test('acciones sobre el servidor: sin permiso o sin código no se envía nada', async () => {
  const { c } = await nucleo();
  let llamadas = 0; c.central.accionActualizaciones = async () => { llamadas++; return {}; };
  await assert.rejects(c.accionActualizacionServidor('preparar', {}), /código de administración/);
  await assert.rejects(c.accionActualizacionServidor('borrar-todo', { codigo: 'X' }), /no válida/);
  c.user.perms.delete('actualizaciones.gestionar');
  await assert.rejects(c.accionActualizacionServidor('ahora', { codigo: 'AAAAA-BBBBB-CCCCC-DDDDD' }), /permiso/);
  assert.equal(llamadas, 0);
  parar(c);
});

test('aplicación anterior a la mínima que admite el servidor: la sincronización se detiene y los cambios se conservan', async () => {
  const { c } = await nucleo(new MemoryAdapter(), { servidor: 'https://servidor.prueba' });
  const respuestas = { '/version': { ok: true, version: '9.0.0', minCliente: '9.0.0', esquema: 2 } };
  c._detectarOrigen = async () => { };
  c.central._req = async (srv, p) => { if (respuestas[p]) return respuestas[p]; throw Object.assign(new Error('no'), { status: 404 }); };
  const v = await c.versionServidor();
  assert.equal(v.version, '9.0.0');
  assert.match(c.bloqueoSync, new RegExp(APP_VERSION.replace(/\./g, '\\.') + '.*9\\.0\\.0'));
  assert.ok(c._bloqueo('https://servidor.prueba'), 'bloquea con ese servidor');
  assert.equal(c._bloqueo('https://otro.servidor'), null, 'no con otros');
  // La sincronización de un preventivo compartido con ese servidor queda en «bloqueado», con los cambios guardados
  c.sync.h.repo.getPrevMeta = async () => ({ modalidad: 'compartida', server: 'https://servidor.prueba' });
  c.sync.h.repo.countPending = async () => 3;
  const st = await c.sync.syncNow('prev_x');
  assert.equal(st.estado, 'bloqueado'); assert.equal(st.pendientes, 3);
  // Cuando el servidor vuelve a admitir esta versión, se desbloquea
  respuestas['/version'] = { ok: true, version: '9.0.0', minCliente: APP_VERSION, esquema: 2 };
  await c.versionServidor();
  assert.equal(c.bloqueoSync, null);
  parar(c);
});
