// 1.4.0 · §3: los tipos de recurso desactivados (o retirados/eliminados) no se ofrecen ni se aceptan
// para unidades NUEVAS; las unidades que ya los usan no cambian.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryAdapter } from '../../src/data/idb.js';
import { AppCore } from '../../src/app/core.js';
import * as C from '../../src/core/commands.js';
import { tiposParaNuevaUnidad, tiposNoDisponibles, plantillasDisponibles } from '../../src/core/recursos.js';
import { Device, createPrev, unitByInd, makeClock } from './helpers.mjs';

async function nucleo(adapter = new MemoryAdapter()) {
  const c = new AppCore(adapter, { servidor: false });
  await c.boot(); c.sync.intervalMs = 999999;
  if (!(await c.repo.isSetup())) await c.setup({ usuario: 'jefe', nombre: 'Jefa', password: 'clave-segura' });
  else await c.login('jefe', 'clave-segura');
  return { c, adapter };
}
const parar = c => { c.sync.stopAll(); c.central.stop(); clearInterval(c._bk); };
async function rechaza(p, re) { await assert.rejects(p, e => { assert.match(e.message, re); return true; }); }

const T = (id, extra = {}) => ({ id, nombre: id.toUpperCase(), color: '#2E7D32', vis: {}, ...extra });

test('selector de unidad nueva: solo tipos activos (preventivo y configuración general)', () => {
  const cfg = { catalogos: { tiposRecurso: [T('a'), T('b', { activo: false }), T('c'), T('g'), T('h', { retirado: true })] }, eliminados: { tiposRecurso: ['c'] } };
  const cat = [T('a'), T('b'), T('c'), T('p'), T('q', { activo: false }), T('r', { retirado: true })];
  const { propios, generales } = tiposParaNuevaUnidad(cat, cfg);
  assert.deepEqual(propios.map(t => t.id), ['a', 'p'], 'b: desactivado en general · c: eliminado en general · q/r: desactivado/retirado en el preventivo');
  assert.deepEqual(generales.map(t => t.id), ['g'], 'h retirado no se ofrece');
  assert.deepEqual([...tiposNoDisponibles(cfg)].sort(), ['b', 'c', 'h']);
});

test('unidades plantilla cuyo tipo no está disponible no se ofrecen', () => {
  const cfg = { catalogos: { tiposRecurso: [T('a'), T('b', { activo: false })] }, eliminados: { tiposRecurso: [] } };
  const plts = [{ id: 'p1', nombre: 'P1', tipo: 'a' }, { id: 'p2', nombre: 'P2', tipo: 'b' }, { id: 'p3', nombre: 'P3', tipo: null }, { id: 'p4', nombre: 'P4', tipo: 'a', activo: false }, { id: 'p5', nombre: 'P5', tipo: 'zz' }];
  assert.deepEqual(plantillasDisponibles(plts, cfg).map(p => p.id), ['p1', 'p3']);
  // El tipo existe en la configuración general pero está retirado en este preventivo
  assert.deepEqual(plantillasDisponibles(plts, cfg, [T('a', { retirado: true })]).map(p => p.id), ['p3']);
});

test('comando: no se crea una unidad con un tipo desactivado, ni aunque se manipule la petición', () => {
  makeClock();
  const A = new Device(); createPrev(A);
  const cat = A.s.prev.cat.tiposRecurso.map(t => (t.id === 'rt_svb' ? { ...t, activo: false } : t));
  A.run(C.catUpdate, 'tiposRecurso', cat);
  assert.throws(() => A.run(C.unitCreate, { ind: 'X1', tipo: 'rt_svb' }), /desactivado.*unidades nuevas/);
  // Tipo de la configuración general desactivado (se envía su definición como si estuviera activo)
  assert.throws(() => A.run(C.unitCreate, { ind: 'X2', tipo: 'rt_dron', tipoDef: { id: 'rt_dron', nombre: 'Dron', activo: false } }), /desactivado/);
  // Desactivado en la configuración general aunque la copia del preventivo siga activa
  A.ctxExtra = { noDisponibles: tiposNoDisponibles({ catalogos: { tiposRecurso: [{ id: 'rt_svb', nombre: 'SVB', activo: false }, { id: 'rt_sva', nombre: 'SVA', activo: false }] } }) };
  assert.throws(() => A.run(C.unitCreate, { ind: 'X3', tipo: 'rt_sva' }), /desactivado/);
  A.ctxExtra = null;
  A.run(C.unitCreate, { ind: 'X4', tipo: 'rt_sva' });
  assert.equal(unitByInd(A, 'X4').tipo, 'rt_sva');
});

test('las unidades existentes de un tipo después desactivado conservan sus datos y se pueden editar', () => {
  makeClock();
  const A = new Device(); createPrev(A);
  A.run(C.unitCreate, { ind: 'S1', tipo: 'rt_svb', nombre: 'Uno' });
  const id = unitByInd(A, 'S1').id;
  A.run(C.catUpdate, 'tiposRecurso', A.s.prev.cat.tiposRecurso.map(t => (t.id === 'rt_svb' ? { ...t, activo: false } : t)));
  assert.equal(A.s.units[id].tipo, 'rt_svb', 'no se modifica la unidad');
  A.run(C.unitUpdate, id, { nombre: 'Uno bis', tipo: 'rt_svb' });
  assert.equal(A.s.units[id].nombre, 'Uno bis');
  assert.equal(A.s.units[id].tipo, 'rt_svb', 'mantener su tipo actual sí se permite');
  A.run(C.unitUpdate, id, { tipo: 'rt_sva' });
  assert.throws(() => A.run(C.unitUpdate, id, { tipo: 'rt_svb' }), /desactivado/, 'volver a elegir un tipo desactivado no');
});

test('núcleo: desactivar un tipo general lo retira de las unidades nuevas en los preventivos existentes', async () => {
  const { c } = await nucleo();
  await c.createPrev({ datos: { nombre: 'Partido', modalidad: 'independiente', activar: true }, seed: c.seedFromConfig() });
  await c.exec(C.unitCreate, { ind: 'SVB 1', tipo: 'rt_svb' });
  await c.guardarTiposRecurso(c.tiposRecursoGenerales().map(t => (t.id === 'rt_svb' ? { ...t, activo: false } : t)));
  assert.ok(c.state.prev.cat.tiposRecurso.some(t => t.id === 'rt_svb' && t.activo !== false), 'la copia del preventivo no se toca');
  await rechaza(c.exec(C.unitCreate, { ind: 'SVB 2', tipo: 'rt_svb' }), /desactivado/);
  const svb = c.plantillasUnidad().find(p => p.tipo === 'rt_svb');
  await rechaza(c.crearUnidadDesdePlantilla(svb.id, { numero: '9' }), /desactivado/);
  assert.ok(!c.plantillasDisponibles().some(p => p.id === svb.id), 'la plantilla no se ofrece');
  assert.ok(!c.tiposParaNuevaUnidad().propios.some(t => t.id === 'rt_svb'));
  assert.equal(Object.values(c.state.units).find(u => u.ind === 'SVB 1').tipo, 'rt_svb', 'la unidad existente conserva su tipo');
  // Reactivar lo vuelve a ofrecer
  await c.guardarTiposRecurso(c.tiposRecursoGenerales().map(t => (t.id === 'rt_svb' ? { ...t, activo: true } : t)));
  await c.exec(C.unitCreate, { ind: 'SVB 2', tipo: 'rt_svb' });
  parar(c);
});
