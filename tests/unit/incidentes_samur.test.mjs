// 1.3.0: códigos de incidente por carpetas como tipos de aviso, tipos de unidad y unidades plantilla de
// SAMUR-Protección Civil, y la migración que los añade a los dispositivos que ya estaban en uso.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryAdapter } from '../../src/data/idb.js';
import { AppCore } from '../../src/app/core.js';
import * as C from '../../src/core/commands.js';
import { esquemaLocal, ESQUEMA_DATOS } from '../../src/data/migraciones.js';
import { DEFAULT_TIPOS_AVISO, DEFAULT_TIPOS_RECURSO, DEFAULT_PLANTILLAS_UNIDAD, TIPOS_RECURSO_SAMUR, PLANTILLAS_SAMUR } from '../../src/core/defaults.js';
import { GRUPOS_INCIDENTE, tiposAvisoIncidentes, carpetasTipos, compararCodigo, etiquetaTipoAviso, incidentesQueFaltan, idIncidente, OTROS_TIPOS } from '../../src/core/incidentes.js';
import { newTemplate, contentFromConfig } from '../../src/core/templates.js';
import { csvTables } from '../../src/core/exporters.js';
import { avisoStats } from '../../src/core/stats.js';

async function nucleo(adapter = new MemoryAdapter()) {
  const c = new AppCore(adapter, { servidor: false });
  await c.boot(); c.sync.intervalMs = 999999;
  if (!(await c.repo.isSetup())) await c.setup({ usuario: 'jefe', nombre: 'Jefa', password: 'clave-segura' });
  else await c.login('jefe', 'clave-segura');
  return { c, adapter };
}
const parar = c => { c.sync.stopAll(); c.central.stop(); clearInterval(c._bk); };
const nuevoPrev = (c, seed = c.seedFromConfig()) => c.createPrev({ datos: { nombre: 'Maratón', modalidad: 'independiente', activar: true }, seed });

test('catálogo de códigos de incidente: 11 grupos, 123 códigos, identificadores y códigos únicos', () => {
  const ts = tiposAvisoIncidentes();
  assert.equal(GRUPOS_INCIDENTE.length, 11);
  assert.deepEqual(GRUPOS_INCIDENTE.map(g => g.codigo), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '15']);
  assert.equal(ts.length, 123);
  assert.equal(new Set(ts.map(t => t.id)).size, ts.length, 'identificadores únicos');
  assert.equal(new Set(ts.map(t => t.codigo)).size, ts.length, 'códigos únicos');
  const t12 = ts.find(t => t.codigo === '1.2');
  assert.equal(t12.id, 'inc_1_2'); assert.equal(t12.nombre, 'Accidente con menos de 3 víctimas'); assert.equal(t12.grupo, '1. Accidente de Tráfico');
  assert.equal(idIncidente('AS-2.1'), 'inc_as_2_1');
  assert.equal(ts.find(t => t.codigo === 'AS-1.1').padre, '8.12');
  assert.equal(ts.find(t => t.codigo === '9').nombre, 'Donante en asistolia');
  // Están en los tipos de aviso por defecto, y los tipos generales de antes también (en «Otros tipos»)
  for (const t of ts) assert.ok(DEFAULT_TIPOS_AVISO.some(x => x.id === t.id));
  assert.ok(DEFAULT_TIPOS_AVISO.some(x => x.id === 'ta_san' && !x.codigo));
});

test('carpetas: grupos en orden, subcódigos y códigos de cierre debajo de su código, «Otros tipos» al final', () => {
  const cs = carpetasTipos(DEFAULT_TIPOS_AVISO);
  assert.deepEqual(cs.map(c => c.nombre.split('.')[0]), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '15', OTROS_TIPOS]);
  const g1 = cs[0].items.map(x => x.t.codigo + '/' + x.nivel);
  assert.deepEqual(g1, ['1.1/0', '1.2/0', '1.3/0', '1.4/0', '1.5/0', '1.6/0', '1.6.1/1', '1.7/0', '1.8/0']);
  const g8 = cs[7].items.map(x => x.t.codigo + '/' + x.nivel);
  assert.deepEqual(g8.slice(0, 7), ['8.1/0', '8.2/0', '8.3/0', '8.4/0', '8.4.1/1', '8.5/0', '8.5.1/1']);
  const i812 = g8.indexOf('8.12/0');
  assert.deepEqual(g8.slice(i812, i812 + 4), ['8.12/0', 'AS-1.1/1', 'AS-1.2/1', '8.13/0']);
  assert.deepEqual(g8.slice(-2), ['8.14/0', '8.15/0']);
  assert.equal(cs[11].items.length, 8, 'los 8 tipos generales en «Otros tipos»');
  assert.ok(compararCodigo('1.10', '1.9') > 0 && compararCodigo('1.6', '1.6.1') < 0 && compararCodigo('8.15', 'AS-1.1') < 0);
});

test('aviso con código de incidente: se guarda el tipo y se muestra con su número en estadísticas e informes', async () => {
  const { c } = await nucleo();
  await nuevoPrev(c);
  assert.equal(c.state.prev.cat.tiposAviso.filter(t => t.codigo).length, 123, 'el preventivo nuevo trae los códigos');
  const ops = await c.exec(C.avisoCreate, { tipo: 'inc_1_2', desc: '' });
  const a = c.state.avisos[ops[0].e];
  assert.equal(a.tipo, 'inc_1_2');
  assert.equal(etiquetaTipoAviso(c.state.prev.cat.tiposAviso, a.tipo), '1.2 · Accidente con menos de 3 víctimas');
  assert.equal(avisoStats(c.state).porTipo.inc_1_2, 1);
  assert.match(csvTables(c.engine(), Date.now()).avisos, /1\.2 · Accidente con menos de 3 víctimas/);
  // Si el catálogo no tuviera el código, se sigue mostrando bien con el catálogo por defecto
  assert.equal(etiquetaTipoAviso([], 'inc_3_1'), '3.1 · Parada cardiorrespiratoria');
  parar(c);
});

test('preventivo anterior sin códigos: se le añaden todos de una vez, sin duplicar, y los repetidos se rechazan', async () => {
  const { c } = await nucleo();
  const seed = c.seedFromConfig(); seed.cat.tiposAviso = seed.cat.tiposAviso.filter(t => !t.codigo);
  await nuevoPrev(c, seed);
  const lista = c.state.prev.cat.tiposAviso;
  assert.equal(lista.length, 8);
  await c.exec(C.catUpdate, 'tiposAviso', [...lista, ...incidentesQueFaltan(lista)]);
  assert.equal(c.state.prev.cat.tiposAviso.length, 131);
  assert.equal(incidentesQueFaltan(c.state.prev.cat.tiposAviso).length, 0, 'repetirlo no añade nada');
  const ops = await c.exec(C.avisoCreate, { tipo: 'inc_1_4', desc: '' });
  assert.equal(c.state.avisos[ops[0].e].tipo, 'inc_1_4');
  const dup = [...c.state.prev.cat.tiposAviso, { id: 'ta_x', codigo: '1.4', nombre: 'Otro atropello', color: '#000000', compatibles: [] }];
  await assert.rejects(c.exec(C.catUpdate, 'tiposAviso', dup), /Código de incidente repetido: 1\.4/);
  parar(c);
});

test('unidad plantilla SAMUR-PC: «ALFA» con el número 31 crea «ALFA 31» de su tipo, en C0 y pendiente de asignación', async () => {
  const { c } = await nucleo();
  await nuevoPrev(c);
  const plt = c.plantillasUnidad().find(p => p.prefijo === 'ALFA');
  assert.equal(plt.nombre, 'ALFA · USVB');
  await c.crearUnidadDesdePlantilla(plt.id, { numero: '31' });
  const u = Object.values(c.state.units).find(x => x.ind === 'ALFA 31');
  assert.ok(u); assert.equal(u.tipo, 'rt_sp_alfa'); assert.equal(u.clave, 'C0'); assert.equal(u.sector, null);
  assert.equal(c.state.prev.cat.tiposRecurso.find(t => t.id === 'rt_sp_alfa').nombre, 'ALFA · USVB');
  const halcon = c.plantillasUnidad().find(p => p.prefijo === 'HALCÓN');
  await c.crearUnidadDesdePlantilla(halcon.id, { numero: '2' });
  assert.ok(Object.values(c.state.units).some(x => x.ind === 'HALCÓN 2' && x.vis.icono === 'moto'));
  parar(c);
});

test('migración al esquema 3: añade tipos, plantillas y códigos que faltan sin tocar lo que ya había', async () => {
  const adapter = new MemoryAdapter();
  const { c } = await nucleo(adapter);
  // Dispositivo de la 1.2.1: configuración con los valores de entonces, cambios propios y una plantilla de preventivo
  const cfg = await c.repo.getCfg();
  cfg.catalogos.tiposAviso = DEFAULT_TIPOS_AVISO.filter(t => !t.codigo);
  cfg.catalogos.tiposRecurso = [...DEFAULT_TIPOS_RECURSO.filter(t => !t.id.startsWith('rt_sp_')), { id: 'rt_dron', nombre: 'Dron', categoria: 'Apoyo', subtipos: [], caracteristicas: [], color: '#455A64', vis: { icono: 'dron', forma: 'circulo', tam: 's' } }];
  cfg.catalogos.tiposRecurso.find(t => t.id === 'rt_svb').nombre = 'SVB (renombrado)';
  cfg.plantillasUnidad = DEFAULT_PLANTILLAS_UNIDAD.filter(p => !p.id.startsWith('plt_sp_')).map(p => (p.id === 'plt_upr' ? { ...p, prefijo: 'U' } : p));
  await c.repo.putDoc('cfg', cfg);
  const contenido = contentFromConfig(cfg); const tpl = newTemplate({ nombre: 'Concierto', contenido });
  await c.repo.saveTemplate(tpl);
  await nuevoPrev(c, { ...c.seedFromConfig(), cat: { ...c.seedFromConfig().cat, tiposAviso: cfg.catalogos.tiposAviso } });
  const pid = c.cur;
  await adapter.put('meta', { k: 'schema', v: 2 });
  parar(c); await c.logout();

  const { c: c2 } = await nucleo(adapter);
  assert.equal(c2.migracion.estado, 'migrado'); assert.equal(c2.migracion.desde, 2); assert.equal(await esquemaLocal(c2.repo), ESQUEMA_DATOS);
  assert.equal((await c2.repo.listBackups()).filter(b => b.tipo === 'migracion').length, 1, 'copia previa');
  const g = await c2.repo.getDoc('cfg');
  for (const t of TIPOS_RECURSO_SAMUR) assert.ok(g.catalogos.tiposRecurso.some(x => x.id === t.id), 'tipo ' + t.nombre);
  for (const p of PLANTILLAS_SAMUR) assert.ok(g.plantillasUnidad.some(x => x.id === p.id), 'plantilla ' + p.nombre);
  assert.equal(g.catalogos.tiposAviso.filter(t => t.codigo).length, 123);
  assert.equal(g.catalogos.tiposRecurso.find(t => t.id === 'rt_svb').nombre, 'SVB (renombrado)', 'lo cambiado se respeta');
  assert.ok(g.catalogos.tiposRecurso.some(t => t.id === 'rt_dron'), 'lo creado se conserva');
  assert.equal(g.plantillasUnidad.find(p => p.id === 'plt_upr').prefijo, 'U');
  assert.deepEqual(g.catalogos.tiposAviso.slice(0, 8).map(t => t.id), DEFAULT_TIPOS_AVISO.filter(t => !t.codigo).map(t => t.id), 'los tipos de antes siguen primero');
  const t2 = await c2.repo.getTemplate(tpl.id);
  assert.equal(t2.contenido.cat.tiposAviso.filter(t => t.codigo).length, 123, 'la plantilla de preventivo también');
  await c2.openPrev(pid);
  assert.equal(c2.state.prev.cat.tiposAviso.length, 8, 'los preventivos existentes no se tocan');
  parar(c2); await c2.logout();
  const { c: c3 } = await nucleo(adapter);
  assert.equal(c3.migracion.estado, 'al_dia');
  assert.equal((await c3.repo.getDoc('cfg')).catalogos.tiposAviso.length, 131, 'repetir no duplica');
  parar(c3);
});
