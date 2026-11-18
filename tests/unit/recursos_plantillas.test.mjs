// Fase 2: tipos de recurso persistentes de la configuración general, sector OTROS y unidades plantilla.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryAdapter } from '../../src/data/idb.js';
import { AppCore } from '../../src/app/core.js';
import * as C from '../../src/core/commands.js';
import { sectorNombre } from '../../src/core/engine.js';
import { Device, createPrev, mkUser, unitByInd, makeClock } from './helpers.mjs';

async function nucleo(adapter = new MemoryAdapter()) {
  const c = new AppCore(adapter, { servidor: false });
  await c.boot(); c.sync.intervalMs = 999999;
  if (!(await c.repo.isSetup())) await c.setup({ usuario: 'jefe', nombre: 'Jefa', password: 'clave-segura' });
  else await c.login('jefe', 'clave-segura');
  return { c, adapter };
}
const parar = c => { c.sync.stopAll(); c.central.stop(); clearInterval(c._bk); };
async function rechaza(p, re) { await assert.rejects(p, e => { assert.match(e.message, re); return true; }); }

test('unidades plantilla de ejemplo (UPR, SVB, VIRES) como datos configurables, con su tipo de recurso', async () => {
  const { c } = await nucleo();
  const nombres = c.plantillasUnidad().map(p => p.nombre);
  assert.deepEqual(nombres, ['UPR', 'Soporte Vital Básico (SVB)', 'VIRES']);
  const upr = c.plantillasUnidad().find(p => p.nombre === 'UPR');
  assert.equal(upr.prefijo, 'UPR'); assert.equal(upr.vis.forma, 'triangulo'); assert.equal(upr.color, '#1565C0');
  assert.equal(c.tiposRecursoGenerales().find(t => t.id === upr.tipo).nombre, 'Vehículo ligero');
  parar(c);
});

test('UPR: solo se pide el número y se genera la unidad completa en C0, pendiente de asignación', async () => {
  const { c } = await nucleo();
  const seed = c.seedFromConfig();
  seed.cat.tiposRecurso = seed.cat.tiposRecurso.filter(t => t.id !== 'rt_vl'); // preventivo anterior sin ese tipo
  await c.createPrev({ datos: { nombre: 'Partido', modalidad: 'independiente', activar: true }, seed });
  const id = c.plantillasUnidad().find(p => p.nombre === 'UPR').id;
  await c.crearUnidadDesdePlantilla(id, { numero: '8025' });
  const u = Object.values(c.state.units).find(x => x.ind === 'UPR 8025');
  assert.ok(u, 'indicativo UPR 8025');
  assert.equal(u.tipo, 'rt_vl');
  assert.equal(c.state.prev.cat.tiposRecurso.find(t => t.id === 'rt_vl').nombre, 'Vehículo ligero', 'el tipo se incorpora al catálogo del preventivo');
  assert.equal(u.vis.forma, 'triangulo'); assert.equal(u.colorC0, '#1565C0');
  assert.equal(u.clave, 'C0'); assert.equal(u.sector, null, 'pendiente de asignación'); assert.equal(u.plan, null);
  assert.deepEqual(u.plantilla, { id, nombre: 'UPR' });
  await rechaza(c.crearUnidadDesdePlantilla(id, { numero: '8025' }), /Ya existe una unidad con el identificador UPR 8025/);
  await rechaza(c.crearUnidadDesdePlantilla(id, { numero: '  ' }), /número/);
  // Sigue siendo una unidad normal: cambia de clave, se edita y se ubica
  await c.exec(C.unitClave, u.id, 'C6');
  assert.equal(c.state.units[u.id].clave, 'C6');
  await c.exec(C.unitUpdate, u.id, { ind: 'UPR 8025-B', sector: 'sec_1' });
  assert.equal(c.state.units[u.id].ind, 'UPR 8025-B'); assert.equal(c.state.units[u.id].sector, 'sec_1');
  parar(c);
});

test('cambiar una plantilla no modifica las unidades creadas; usada no se elimina, se desactiva', async () => {
  const { c } = await nucleo();
  await c.createPrev({ datos: { nombre: 'Concierto', modalidad: 'independiente', activar: true }, seed: c.seedFromConfig() });
  const p = await c.guardarPlantillaUnidad({ nombre: 'Moto sanitaria', tipo: 'rt_eqsan', prefijo: 'msa', color: '#AA0000', vis: { forma: 'rombo', icono: 'cruz' }, campos: ['nombre', 'sector'], obligatorios: ['nombre'] });
  assert.equal(p.prefijo, 'MSA');
  await rechaza(c.crearUnidadDesdePlantilla(p.id, { numero: '1' }), /obligatorio/);
  await c.crearUnidadDesdePlantilla(p.id, { numero: '1', nombre: 'Moto 1', sector: 'otros', sectorOtro: 'Puerta 7' });
  const u = Object.values(c.state.units).find(x => x.ind === 'MSA 1');
  assert.equal(u.nombre, 'Moto 1'); assert.equal(u.sector, 'otros'); assert.equal(u.sectorOtro, 'Puerta 7');
  await c.guardarPlantillaUnidad({ ...c.plantillasUnidad().find(x => x.id === p.id), color: '#00AA00', prefijo: 'MOTO' });
  assert.equal(c.state.units[u.id].colorC0, '#AA0000', 'la unidad conserva sus valores');
  assert.equal(c.state.units[u.id].ind, 'MSA 1');
  await rechaza(c.borrarPlantillaUnidad(p.id), /desactívala/);
  await c.activarPlantillaUnidad(p.id, false);
  assert.ok(!c.plantillasUnidad({ activas: true }).some(x => x.id === p.id));
  await rechaza(c.crearUnidadDesdePlantilla(p.id, { numero: '2', nombre: 'x' }), /no está disponible/);
  const d = await c.duplicarPlantillaUnidad(p.id);
  assert.equal(d.nombre, 'Moto sanitaria (copia)'); assert.equal(d.usada, false);
  await c.borrarPlantillaUnidad(d.id);
  assert.ok(!c.plantillasUnidad().some(x => x.id === d.id), 'una plantilla sin usar sí se elimina');
  await rechaza(c.guardarPlantillaUnidad({ nombre: 'UPR', prefijo: 'X' }), /Ya existe/);
  parar(c);
});

test('tipos de recurso: se crean al vuelo, persisten tras reiniciar y sirven en cualquier preventivo', async () => {
  const { c, adapter } = await nucleo();
  await c.createPrev({ datos: { nombre: 'P1', modalidad: 'independiente', activar: true }, seed: c.seedFromConfig() });
  const t = await c.crearTipoRecurso({ nombre: 'Dron', categoria: 'Apoyo', color: '#455A64', vis: { icono: 'antena', forma: 'rombo' } });
  // El tipo aún no está en el catálogo de este preventivo: se incorpora al crear la unidad
  await c.exec(C.unitCreate, { ind: 'DRON-1', tipo: t.id, tipoDef: t });
  assert.ok(c.state.prev.cat.tiposRecurso.some(x => x.id === t.id));
  parar(c);
  // «Reinicio»: nuevo núcleo sobre los mismos datos
  const { c: c2 } = await nucleo(adapter);
  assert.ok(c2.tiposRecursoGenerales().some(x => x.id === t.id && x.nombre === 'Dron'), 'sigue tras reiniciar');
  await c2.createPrev({ datos: { nombre: 'P2', modalidad: 'independiente', activar: true }, seed: c2.seedFromConfig() });
  assert.ok(c2.state.prev.cat.tiposRecurso.some(x => x.id === t.id), 'disponible en un preventivo nuevo');
  // No se elimina si lo usa una plantilla; se puede desactivar
  await c2.guardarPlantillaUnidad({ nombre: 'Dron', tipo: t.id, prefijo: 'DRON' });
  await rechaza(c2.guardarTiposRecurso(c2.tiposRecursoGenerales().filter(x => x.id !== t.id)), /lo usa la unidad plantilla/);
  await c2.guardarTiposRecurso(c2.tiposRecursoGenerales().map(x => (x.id === t.id ? { ...x, activo: false } : x)));
  assert.ok(!c2.tiposRecursoGenerales({ activos: true }).some(x => x.id === t.id));
  assert.equal(c2.state.prev.cat.tiposRecurso.find(x => x.id === t.id).nombre, 'Dron', 'el preventivo conserva su copia');
  parar(c2);
});

test('permisos: un operador crea unidades con plantilla, pero no gestiona tipos ni plantillas', async () => {
  const { c } = await nucleo();
  await c.saveUser({ usuario: 'oper', nombre: 'Operador', rol: 'rol_operador', activo: true }, 'clave-oper');
  await c.createPrev({ datos: { nombre: 'P', modalidad: 'independiente', activar: true }, seed: c.seedFromConfig() });
  const pid = c.cur;
  await c.logout(); await c.login('oper', 'clave-oper'); await c.openPrev(pid);
  await rechaza(c.crearTipoRecurso({ nombre: 'X' }), /permiso/);
  await rechaza(c.guardarPlantillaUnidad({ nombre: 'Y', prefijo: 'Y' }), /permiso/);
  await c.crearUnidadDesdePlantilla(c.plantillasUnidad().find(p => p.nombre === 'VIRES').id, { numero: '3' });
  assert.ok(Object.values(c.state.units).some(u => u.ind === 'VIRES 3'));
  parar(c);
});

test('sector OTROS: ubicación personalizada solo para el preventivo, sin crear sectores globales', () => {
  makeClock();
  const A = new Device(); createPrev(A);
  assert.throws(() => A.run(C.unitCreate, { ind: 'A1', sector: 'otros' }), /ubicación o sector personalizado/);
  A.run(C.unitCreate, { ind: 'A1', sector: 'otros', sectorOtro: '  Puerta 7 ' });
  const u = unitByInd(A, 'A1');
  assert.equal(u.sectorOtro, 'Puerta 7');
  assert.equal(sectorNombre(A.s.prev, u), 'Otros: Puerta 7');
  assert.equal(A.s.prev.cat.sectores.length, 4, 'no se crea ningún sector');
  assert.throws(() => A.run(C.unitCreate, { ind: 'A2', sector: 'sec_inexistente' }), /no existe/);
  // Pasar a un sector normal limpia la ubicación personalizada
  A.run(C.unitUpdate, u.id, { sector: 'sec_2' });
  assert.equal(unitByInd(A, 'A1').sectorOtro, '');
  A.run(C.unitUpdate, u.id, { sector: 'otros', sectorOtro: 'Carpa VIP' });
  assert.equal(sectorNombre(A.s.prev, unitByInd(A, 'A1')), 'Otros: Carpa VIP');
  // El catálogo de sectores puede editarse aunque haya unidades en OTROS
  A.run(C.catUpdate, 'sectores', A.s.prev.cat.sectores.slice(0, 3));
  assert.equal(sectorNombre(A.s.prev, { sector: null }, 'Pendiente de asignación'), 'Pendiente de asignación');
  // Otro dispositivo reproduce lo mismo
  const B = new Device({ id: 'devB', code: 'B' }); B.receive(A.store);
  assert.equal(unitByInd(B, 'A1').sectorOtro, 'Carpa VIP');
});

test('una unidad con un tipo de la configuración general lo incorpora al preventivo (también al cambiar de tipo)', () => {
  makeClock();
  const A = new Device(); createPrev(A);
  const dron = { id: 'rt_dron', nombre: 'Dron', categoria: 'Apoyo', color: '#455A64', vis: { icono: 'antena', forma: 'rombo' }, activo: true };
  assert.throws(() => A.run(C.unitCreate, { ind: 'D1', tipo: 'rt_dron' }), /no existe en este preventivo/);
  A.run(C.unitCreate, { ind: 'D1', tipo: 'rt_svb' });
  A.run(C.unitUpdate, unitByInd(A, 'D1').id, { tipo: 'rt_dron', tipoDef: dron });
  assert.equal(unitByInd(A, 'D1').tipo, 'rt_dron');
  const t = A.s.prev.cat.tiposRecurso.find(x => x.id === 'rt_dron');
  assert.equal(t.nombre, 'Dron'); assert.equal(t.activo, undefined, 'el estado de activación es de la configuración general');
  // Sin permiso para cambiar tipos no se puede
  const op = mkUser('rol_operador', 'Op');
  assert.throws(() => A.as(op, d => d.run(C.unitUpdate, unitByInd(A, 'D1').id, { tipo: 'rt_svb' })), /permiso/);
});
