// 1.4.0 · §2 y §8A/B: eliminar configuraciones de recursos (también las iniciales) de forma segura:
// referencias visibles, reasignar, eliminar con sus plantillas (autorización expresa) o retirar del uso;
// nunca se borran unidades ni historial, y lo eliminado no reaparece al reiniciar ni al actualizar.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MemoryAdapter } from '../../src/data/idb.js';
import { AppCore } from '../../src/app/core.js';
import * as C from '../../src/core/commands.js';
import { migrarDatos } from '../../src/data/migraciones.js';
import { referenciasTipoPrev, duplicarTipo } from '../../src/core/recursos.js';
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
const tipo = (c, id) => c.tiposRecursoGenerales().find(t => t.id === id);
const auditoria = async c => (await c.repo.listAudit()).map(a => a.accion + ' · ' + a.elemento + ' · ' + a.nuevo).join('\n');

test('un tipo inicial sin referencias se elimina del todo y no reaparece al reiniciar ni al actualizar', async () => {
  const { c, adapter } = await nucleo();
  await c.createPrev({ datos: { nombre: 'Partido', modalidad: 'independiente', activar: true }, seed: c.seedFromConfig() });
  await c.exec(C.unitCreate, { ind: 'EQ 1', tipo: 'rt_eqsan' });
  const ref = await c.referenciasTipoRecurso('rt_eqsan');
  assert.equal(ref.bloquean.length, 0, 'ninguna plantilla ni tipo de aviso lo necesita');
  assert.deepEqual(ref.preventivos.map(p => [p.nombre, p.unidades]), [['Partido', 1]], 'se informa del preventivo que lo usa');
  await c.eliminarTipoRecurso('rt_eqsan');
  assert.equal(tipo(c, 'rt_eqsan'), undefined);
  assert.ok(c.cfg.eliminados.tiposRecurso.includes('rt_eqsan'));
  assert.match(await auditoria(c), /Tipo de recurso eliminado · Equipo sanitario/);
  // El preventivo conserva su copia y su unidad, pero ya no se ofrece para unidades nuevas
  assert.equal(Object.values(c.state.units).find(u => u.ind === 'EQ 1').tipo, 'rt_eqsan');
  assert.ok(c.state.prev.cat.tiposRecurso.some(t => t.id === 'rt_eqsan'));
  assert.ok(!c.tiposParaNuevaUnidad().propios.some(t => t.id === 'rt_eqsan'));
  await rechaza(c.exec(C.unitCreate, { ind: 'EQ 2', tipo: 'rt_eqsan' }), /no se puede usar/);
  parar(c);
  // Reinicio: sigue eliminado
  const { c: c2 } = await nucleo(adapter);
  assert.equal(tipo(c2, 'rt_eqsan'), undefined);
  // Actualización que vuelve a ejecutar las migraciones que añaden los valores iniciales
  await c2.repo.db.put('meta', { k: 'schema', v: 2 });
  await c2.eliminarTipoRecurso('rt_sp_vais', { modo: 'conPlantillas' });
  await migrarDatos(c2.repo, { migrarCfg: x => c2._migrarCfg(x) });
  c2.cfg = c2._migrarCfg(await c2.repo.getCfg());
  assert.equal(tipo(c2, 'rt_sp_vais'), undefined, 'la migración no reintroduce un tipo eliminado');
  assert.ok(!c2.plantillasUnidad().some(p => p.id === 'plt_sp_vais'), 'ni su plantilla');
  assert.ok(tipo(c2, 'rt_sp_alfa'), 'los demás iniciales siguen');
  parar(c2);
});

test('con referencias: se muestran y eliminar sin resolverlas se rechaza explicando qué hacer', async () => {
  const { c } = await nucleo();
  const ref = await c.referenciasTipoRecurso('rt_svb');
  assert.deepEqual(ref.plantillas.map(p => p.nombre), ['Soporte Vital Básico (SVB)']);
  assert.deepEqual(ref.tiposAviso.map(a => a.nombre), ['Traslado'], 'Traslado admite también SVA y transporte: no bloquea');
  assert.deepEqual(ref.bloquean.map(b => b.nombre), ['Soporte Vital Básico (SVB)']);
  await rechaza(c.eliminarTipoRecurso('rt_svb'), /unidad plantilla «Soporte Vital Básico \(SVB\)».*reasígnala.*retíralo/i);
  assert.ok(tipo(c, 'rt_svb'), 'no se ha eliminado nada');
  parar(c);
});

test('reasignar: las plantillas y la compatibilidad pasan al otro tipo y el tipo se elimina', async () => {
  const { c } = await nucleo();
  await c.createPrev({ datos: { nombre: 'Maratón', modalidad: 'independiente', activar: true }, seed: c.seedFromConfig() });
  await c.exec(C.unitCreate, { ind: 'SVB 1', tipo: 'rt_svb' });
  await rechaza(c.eliminarTipoRecurso('rt_svb', { modo: 'reasignar', destino: 'rt_svb' }), /otro tipo/);
  await c.eliminarTipoRecurso('rt_svb', { modo: 'reasignar', destino: 'rt_sva' });
  assert.equal(tipo(c, 'rt_svb'), undefined);
  assert.equal(c.plantillasUnidad().find(p => p.id === 'plt_svb').tipo, 'rt_sva');
  const tras = c.cfg.catalogos.tiposAviso.find(a => a.id === 'ta_tras');
  assert.deepEqual(tras.compatibles, ['rt_sva', 'rt_transp']);
  assert.equal(Object.values(c.state.units).find(u => u.ind === 'SVB 1').tipo, 'rt_svb', 'las unidades de los preventivos no se tocan');
  assert.match(await auditoria(c), /Tipo de recurso eliminado · Ambulancia SVB · .*reasignado a «Ambulancia SVA»/);
  parar(c);
});

test('eliminar con sus unidades plantilla (autorización expresa): las unidades creadas conservan sus datos', async () => {
  const { c } = await nucleo();
  await c.createPrev({ datos: { nombre: 'Concierto', modalidad: 'independiente', activar: true }, seed: c.seedFromConfig() });
  await c.crearUnidadDesdePlantilla('plt_sp_papa', { numero: '1' });
  await rechaza(c.eliminarTipoRecurso('rt_sp_papa'), /unidad plantilla/);
  await c.eliminarTipoRecurso('rt_sp_papa', { modo: 'conPlantillas' });
  assert.equal(tipo(c, 'rt_sp_papa'), undefined);
  assert.ok(!c.plantillasUnidad().some(p => p.id === 'plt_sp_papa'));
  assert.ok(c.cfg.eliminados.plantillasUnidad.includes('plt_sp_papa'));
  const u = Object.values(c.state.units).find(x => x.ind === 'PAPA 1');
  assert.equal(u.tipo, 'rt_sp_papa'); assert.equal(u.plantilla.nombre, 'PAPA · Unidad de psiquiatría');
  parar(c);
});

test('retirar del uso: se conserva para el historial, no se ofrece y se puede restaurar', async () => {
  const { c } = await nucleo();
  await c.createPrev({ datos: { nombre: 'Feria', modalidad: 'independiente', activar: true }, seed: c.seedFromConfig() });
  await c.eliminarTipoRecurso('rt_vir', { modo: 'retirar' });
  assert.equal(tipo(c, 'rt_vir').retirado, true);
  assert.ok(!c.tiposParaNuevaUnidad().propios.some(t => t.id === 'rt_vir'));
  assert.ok(!c.plantillasDisponibles().some(p => p.id === 'plt_vires'), 'su plantilla deja de ofrecerse');
  assert.match(await auditoria(c), /Tipo de recurso retirado del uso · Vehículo de intervención rápida/);
  await c.restaurarTipoRecurso('rt_vir');
  assert.equal(tipo(c, 'rt_vir').retirado, undefined);
  assert.ok(c.plantillasDisponibles().some(p => p.id === 'plt_vires'));
  parar(c);
});

test('unidad plantilla ya usada: se puede eliminar viendo antes qué unidades salieron de ella', async () => {
  const { c, adapter } = await nucleo();
  await c.createPrev({ datos: { nombre: 'Gala', modalidad: 'independiente', activar: true }, seed: c.seedFromConfig() });
  await c.crearUnidadDesdePlantilla('plt_upr', { numero: '8025' });
  const ref = await c.referenciasPlantillaUnidad('plt_upr');
  assert.deepEqual(ref.preventivos.map(p => [p.nombre, p.unidades]), [['Gala', 1]]);
  await c.borrarPlantillaUnidad('plt_upr');
  assert.ok(!c.plantillasUnidad().some(p => p.id === 'plt_upr'));
  assert.equal(Object.values(c.state.units).find(u => u.ind === 'UPR 8025').plantilla.id, 'plt_upr', 'la unidad conserva su origen');
  assert.match(await auditoria(c), /Unidad plantilla eliminada · UPR/);
  parar(c);
  const { c: c2 } = await nucleo(adapter);
  assert.ok(!c2.plantillasUnidad().some(p => p.id === 'plt_upr'), 'no reaparece al reiniciar');
  parar(c2);
});

test('restaurar configuraciones iniciales eliminadas es una acción explícita', async () => {
  const { c } = await nucleo();
  await c.eliminarTipoRecurso('rt_sp_eco', { modo: 'conPlantillas' });
  const el = c.inicialesEliminadas();
  assert.deepEqual(el.tiposRecurso.map(t => t.id), ['rt_sp_eco']);
  assert.deepEqual(el.plantillasUnidad.map(p => p.id), ['plt_sp_eco']);
  await c.restaurarIniciales({ tiposRecurso: ['rt_sp_eco'], plantillasUnidad: ['plt_sp_eco'] });
  assert.ok(tipo(c, 'rt_sp_eco')); assert.ok(c.plantillasUnidad().some(p => p.id === 'plt_sp_eco'));
  assert.deepEqual(c.cfg.eliminados.tiposRecurso, []);
  parar(c);
});

test('duplicar un tipo: nuevo identificador, mismas propiedades y materiales, sin referencias', async () => {
  const { c } = await nucleo();
  await c.guardarTiposRecurso(c.tiposRecursoGenerales().map(t => (t.id === 'rt_svb' ? { ...t, caracteristicas: ['Camilla', 'DEA'], subtipos: ['SVB-A'], retirado: undefined } : t)));
  // El editor de tipos duplica en su lista y se guarda con «Guardar cambios»
  let lista = c.tiposRecursoGenerales();
  const d = duplicarTipo(lista, 'rt_svb'); lista = [...lista, d];
  assert.notEqual(d.id, 'rt_svb'); assert.equal(d.nombre, 'Ambulancia SVB (copia)');
  assert.deepEqual(d.caracteristicas, ['Camilla', 'DEA']); assert.deepEqual(d.subtipos, ['SVB-A']);
  assert.equal(d.color, tipo(c, 'rt_svb').color); assert.deepEqual(d.vis, tipo(c, 'rt_svb').vis);
  assert.equal(duplicarTipo(lista, 'rt_svb').nombre, 'Ambulancia SVB (copia 2)');
  assert.equal(duplicarTipo([{ id: 'x', nombre: 'X', retirado: true, orden: 3 }], 'x').retirado, undefined, 'la copia no hereda la retirada');
  await c.guardarTiposRecurso(lista);
  assert.ok(tipo(c, d.id));
  assert.ok(!c.plantillasUnidad().some(p => p.tipo === d.id), 'ninguna plantilla pasa a la copia');
  parar(c);
});

test('preventivo: un tipo usado no se borra del historial; se retira y, si se quiere, se reasignan sus unidades', () => {
  makeClock();
  const A = new Device(); createPrev(A);
  A.run(C.unitCreate, { ind: 'V1', tipo: 'rt_vir' }); A.run(C.unitCreate, { ind: 'V2', tipo: 'rt_vir' }); A.run(C.unitCreate, { ind: 'V3', tipo: 'rt_vir' });
  A.run(C.unitSit, unitByInd(A, 'V3').id, 'archivada');
  const ref = referenciasTipoPrev(A.s, 'rt_vir');
  assert.deepEqual(ref.unidades.map(u => u.ind), ['V1', 'V2']);
  assert.deepEqual(ref.archivadas.map(u => u.ind), ['V3']);
  assert.ok(ref.historial > 0);
  assert.equal(referenciasTipoPrev(A.s, 'rt_com').historial, 0, 'un tipo sin usar no tiene historial');
  assert.throws(() => A.run(C.tipoRecursoRetirar, 'rt_vir', { destino: 'rt_vir' }), /otro tipo/);
  A.run(C.tipoRecursoRetirar, 'rt_vir', { destino: 'rt_sva' });
  assert.equal(unitByInd(A, 'V1').tipo, 'rt_sva'); assert.equal(unitByInd(A, 'V2').tipo, 'rt_sva');
  assert.equal(unitByInd(A, 'V3').tipo, 'rt_vir', 'la archivada conserva su tipo');
  assert.equal(A.s.prev.cat.tiposRecurso.find(t => t.id === 'rt_vir').retirado, true, 'se conserva para el historial');
  assert.throws(() => A.run(C.unitCreate, { ind: 'V4', tipo: 'rt_vir' }), /retirado/);
  // Otro dispositivo reproduce lo mismo
  const B = new Device({ id: 'devB', code: 'B' }); B.receive(A.store);
  assert.equal(unitByInd(B, 'V1').tipo, 'rt_sva');
});
