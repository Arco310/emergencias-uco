// Pruebas de las reglas críticas: claves C0-C6/CESP, color C0, descansos, avisos y numeración.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Device, createPrev, unitByInd, makeClock, mkUser, C, MIN, T0 } from './helpers.mjs';
import { Engine, isResting, counts, unitSituation } from '../../src/core/engine.js';
import { unitVisual, REST_COLOR } from '../../src/core/visual.js';

function setup(extra = {}) {
  const clock = makeClock();
  const dev = new Device({ clock, ...extra });
  createPrev(dev, { unidades: [
    { ind: 'AMB-01', nombre: 'Ambulancia 1', tipo: 'rt_svb', sector: 'sec_1', colorC0: '#123456' },
    { ind: 'AMB-02', nombre: 'Ambulancia 2', tipo: 'rt_svb', sector: 'sec_2', colorC0: '#654321' },
    { ind: 'VIR-01', tipo: 'rt_vir', sector: 'sec_1' },
  ] });
  return { clock, dev, a1: unitByInd(dev, 'AMB-01'), a2: unitByInd(dev, 'AMB-02'), v1: unitByInd(dev, 'VIR-01') };
}

test('preventivo: creación, activación y unidades desde la creación', () => {
  const { dev } = setup();
  assert.equal(dev.s.prev.estado, 'activo');
  assert.equal(Object.keys(dev.s.units).length, 3);
  assert.equal(unitByInd(dev, 'AMB-01').clave, 'C0');
});

test('color C0: solo editable en C0, borde siempre C0, recuperación al volver a C0', () => {
  const { dev, clock, a1 } = setup();
  dev.run(C.unitColor, a1.id, '#ff0000');
  assert.equal(dev.s.units[a1.id].colorC0, '#FF0000');
  let v = unitVisual(dev.s.prev, dev.s.units[a1.id], clock.now());
  assert.equal(v.fill, '#FF0000', 'en C0 el color principal es el personalizado');
  assert.equal(v.border, '#FF0000');
  // Pasa a C1 (asignación a aviso)
  const [av] = dev.run(C.avisoCreate, { tipo: 'ta_san', desc: 'Caída' });
  dev.run(C.avisoAsignar, av.e, a1.id);
  assert.equal(dev.s.units[a1.id].clave, 'C1');
  v = unitVisual(dev.s.prev, dev.s.units[a1.id], clock.now());
  assert.equal(v.fill, '#F9A825', 'fuera de C0 el color principal es el de la clave');
  assert.equal(v.border, '#FF0000', 'el borde conserva el color C0');
  assert.throws(() => dev.run(C.unitColor, a1.id, '#00ff00'), /solo se puede modificar/);
  // Regreso a C0
  dev.run(C.unitClave, a1.id, 'C0');
  v = unitVisual(dev.s.prev, dev.s.units[a1.id], clock.now());
  assert.equal(v.fill, '#FF0000', 'al regresar a C0 recupera el color personalizado');
  // Independiente por unidad
  assert.equal(dev.s.units[unitByInd(dev, 'AMB-02').id].colorC0, '#654321');
  // Persistencia: reconstrucción desde el registro
  const e2 = new Engine(dev.store);
  assert.equal(e2.state.units[a1.id].colorC0, '#FF0000');
});

test('color C0: el motor rechaza un cambio de color fuera de C0 aunque llegue de otro dispositivo', () => {
  const { dev, a1 } = setup();
  const [av] = dev.run(C.avisoCreate, { tipo: 'ta_san', desc: 'x' });
  dev.run(C.avisoAsignar, av.e, a1.id);
  const fake = { id: 'op_fake', p: dev.pid, d: 'devZ', h: dev.hlc.tick(), t: Date.now(), u: { id: 'z', n: 'Z' }, k: 'unit.color', e: a1.id, x: { o: '#123456', n: '#000000' } };
  dev.receive([fake]);
  assert.equal(dev.s.units[a1.id].colorC0, '#123456');
  assert.equal(dev.engine.status.get('op_fake').status, 'conflict');
});

test('claves: transiciones permitidas, motivo obligatorio en CESP y requisito de aviso', () => {
  const { dev, a1 } = setup();
  assert.throws(() => dev.run(C.unitClave, a1.id, 'C2'), /requiere que la unidad tenga un aviso/);
  assert.throws(() => dev.run(C.unitClave, a1.id, 'C4'), /Transición no permitida/);
  assert.throws(() => dev.run(C.unitClave, a1.id, 'CESP'), /requiere indicar el motivo/);
  dev.run(C.unitClave, a1.id, 'CESP', { motivo: 'Repostaje' });
  assert.equal(dev.s.units[a1.id].clave, 'CESP');
  assert.equal(dev.s.units[a1.id].motivoEsp, 'Repostaje');
  assert.equal(unitSituation(dev.s, dev.s.units[a1.id], Date.now()), 'especial');
  dev.run(C.unitClave, a1.id, 'C6');
  assert.equal(unitSituation(dev.s, dev.s.units[a1.id], Date.now()), 'fuera');
  dev.run(C.unitClave, a1.id, 'C0');
  // Forzar una transición no permitida requiere permiso específico
  const [av] = dev.run(C.avisoCreate, { desc: 'x' });
  dev.run(C.avisoAsignar, av.e, a1.id);
  dev.as(mkUser('rol_operador', 'Op'), op => {
    assert.throws(() => op.run(C.unitClave, a1.id, 'C4'), /Transición no permitida/);
    assert.throws(() => op.run(C.unitClave, a1.id, 'C4', { forzar: true }), /permiso/);
  });
  dev.run(C.unitClave, a1.id, 'C4', { forzar: true });
  assert.equal(dev.s.units[a1.id].clave, 'C4');
});

test('avisos: flujo completo C1→C5, liberación al volver a C0 y finalización', () => {
  const { dev, clock, a1, a2 } = setup();
  const [av] = dev.run(C.avisoCreate, { tipo: 'ta_san', desc: 'Lipotimia', loc: { txt: 'Puerta 3' } });
  let a = dev.s.avisos[av.e];
  assert.equal(a.estado, 'pendiente');
  assert.equal(a.num, 1);
  clock.advance(2 * MIN); dev.run(C.avisoAsignar, av.e, a1.id);
  a = dev.s.avisos[av.e];
  assert.equal(a.estado, 'asignado');
  assert.equal(dev.s.units[a1.id].clave, 'C1', 'la asignación alerta automáticamente (C1)');
  assert.equal(dev.s.units[a1.id].aviso, av.e);
  assert.deepEqual(dev.run(C.avisoAsignar, av.e, a1.id), [], 'reasignar la misma unidad no genera operaciones');
  clock.advance(MIN); dev.run(C.unitClave, a1.id, 'C2');
  assert.equal(dev.s.avisos[av.e].estado, 'en_curso');
  clock.advance(7 * MIN); dev.run(C.unitClave, a1.id, 'C3');
  assert.equal(dev.s.avisos[av.e].llegadaEn, clock.now());
  clock.advance(20 * MIN); dev.run(C.unitClave, a1.id, 'C4');
  clock.advance(15 * MIN); dev.run(C.unitClave, a1.id, 'C5');
  // No se puede finalizar con unidades todavía ocupadas sin confirmación
  assert.throws(() => dev.run(C.avisoFinalizar, av.e, {}), /Unidades todavía asignadas/);
  clock.advance(15 * MIN); dev.run(C.unitClave, a1.id, 'C0');
  assert.equal(dev.s.units[a1.id].aviso, null, 'C0 libera la unidad del aviso');
  assert.equal(dev.s.avisos[av.e].estado, 'en_curso', 'el aviso sigue en curso hasta finalizarlo');
  dev.run(C.avisoFinalizar, av.e, { nota: 'Trasladado' });
  assert.equal(dev.s.avisos[av.e].estado, 'finalizado');
  assert.equal(counts(dev.s, clock.now()).finalizados, 1);
  // Una unidad puede gestionar avisos secuenciales
  const [av2] = dev.run(C.avisoCreate, { tipo: 'ta_san', desc: 'Segundo' });
  dev.run(C.avisoAsignar, av2.e, a1.id);
  assert.deepEqual(dev.s.units[a1.id].ha, [av.e, av2.e]);
  // No puede estar en dos avisos a la vez
  const [av3] = dev.run(C.avisoCreate, { tipo: 'ta_san', desc: 'Tercero' });
  assert.throws(() => dev.run(C.avisoAsignar, av3.e, a1.id), /ya está asignada/);
  // Finalizar liberando unidades
  dev.run(C.avisoAsignar, av3.e, a2.id);
  dev.run(C.avisoFinalizar, av3.e, { liberarUnidades: true });
  assert.equal(dev.s.units[a2.id].clave, 'C0');
  assert.equal(dev.s.units[a2.id].aviso, null);
});

test('avisos: numeración correlativa que no depende de los avisos visibles', () => {
  const { dev } = setup();
  const nums = [];
  for (let i = 0; i < 5; i++) { const [op] = dev.run(C.avisoCreate, { desc: 'A' + i }); nums.push(dev.s.avisos[op.e].num); }
  assert.deepEqual(nums, [1, 2, 3, 4, 5]);
  // finalizar avisos no reutiliza números
  for (const a of Object.values(dev.s.avisos).slice(0, 3)) dev.run(C.avisoFinalizar, a.id, {});
  const [op] = dev.run(C.avisoCreate, { desc: 'nuevo' });
  assert.equal(dev.s.avisos[op.e].num, 6);
});

test('descansos: bloqueo con aviso activo, temporizador real, recuperación tras recargar y fin automático', () => {
  const { dev, clock, a1, a2 } = setup();
  const [av] = dev.run(C.avisoCreate, { desc: 'x' });
  dev.run(C.avisoAsignar, av.e, a1.id);
  assert.throws(() => dev.run(C.unitRest, a1.id), /aviso activo/);
  // Bloqueo también en el motor (operación remota)
  const fake = { id: 'op_r', p: dev.pid, d: 'devZ', h: dev.hlc.tick(), t: clock.now(), u: { id: 'z', n: 'Z' }, k: 'unit.rest', e: a1.id, x: { dur: 30 } };
  dev.receive([fake]);
  assert.equal(dev.engine.status.get('op_r').status, 'conflict');
  assert.equal(isResting(dev.s.units[a1.id], clock.now()), false);
  // Descanso de AMB-02 (30 min por defecto)
  const t0 = clock.now();
  dev.run(C.unitRest, a2.id);
  const u = dev.s.units[a2.id];
  assert.equal(u.descanso.finPrev, t0 + 30 * MIN);
  assert.equal(unitVisual(dev.s.prev, u, clock.now()).fill, REST_COLOR, 'en descanso aparece en gris');
  assert.equal(unitVisual(dev.s.prev, u, clock.now()).border, '#654321');
  assert.equal(unitSituation(dev.s, u, clock.now()), 'descanso');
  // No asignable durante el descanso
  assert.throws(() => dev.run(C.avisoAsignar, av.e, a2.id), /descanso/);
  // Recarga: se reconstruye desde el registro con las marcas de tiempo reales
  clock.advance(12 * MIN);
  const e2 = new Engine(dev.store);
  const u2 = e2.state.units[a2.id];
  assert.equal(isResting(u2, clock.now()), true);
  assert.equal(u2.descanso.finPrev - clock.now(), 18 * MIN, 'tiempo restante correcto tras recargar');
  // Fin automático sin sobrescribir la clave
  clock.advance(18 * MIN);
  assert.equal(isResting(dev.s.units[a2.id], clock.now()), false);
  assert.equal(dev.s.units[a2.id].clave, 'C0');
  dev.run(C.avisoAsignar, av.e, a2.id);
  assert.equal(dev.s.units[a2.id].clave, 'C1');
});

test('descansos: duración distinta de la predeterminada requiere permiso; fin manual; asignación terminando descanso', () => {
  const clock = makeClock();
  const dev = new Device({ clock, user: mkUser('rol_operador', 'Operador') });
  const admin = mkUser();
  dev.user = admin; createPrev(dev, { unidades: [{ ind: 'U1' }, { ind: 'U2' }] }); dev.user = mkUser('rol_operador', 'Operador');
  const u1 = unitByInd(dev, 'U1');
  assert.throws(() => dev.run(C.unitRest, u1.id, 45), /duración/);
  dev.run(C.unitRest, u1.id);
  clock.advance(5 * MIN);
  dev.run(C.unitRestEnd, u1.id);
  assert.equal(isResting(dev.s.units[u1.id], clock.now()), false);
  assert.equal(dev.s.units[u1.id].descanso.fin, clock.now());
  dev.run(C.unitRest, u1.id);
  const [av] = dev.run(C.avisoCreate, { desc: 'x' });
  dev.run(C.avisoAsignar, av.e, u1.id, { terminarDescanso: true });
  assert.equal(dev.s.units[u1.id].aviso, av.e);
});

test('unidades: indicativo único, eliminación solo sin actividad, archivado conserva historial', () => {
  const { dev, a1, v1 } = setup();
  assert.throws(() => dev.run(C.unitCreate, { ind: 'amb-01' }), /Ya existe/);
  const [op] = dev.run(C.unitCreate, { ind: 'NUEVA', tipo: 'rt_log' });
  dev.run(C.unitDelete, op.e);
  assert.equal(dev.s.units[op.e].eliminada, true);
  dev.run(C.unitClave, a1.id, 'CESP', { motivo: 'Repostaje' });
  assert.throws(() => dev.run(C.unitDelete, a1.id), /actividad registrada/);
  dev.run(C.unitSit, a1.id, 'archivada');
  assert.equal(dev.s.units[a1.id].sit, 'archivada');
  assert.equal(dev.s.units[a1.id].hc.length, 2, 'el historial se conserva');
  dev.run(C.unitSit, a1.id, 'activa');
  // cambio de tipo requiere permiso específico
  dev.as(mkUser('rol_operador', 'Op'), op2 => {
    assert.throws(() => op2.run(C.unitUpdate, v1.id, { tipo: 'rt_svb' }), /permiso/);
    op2.run(C.unitUpdate, v1.id, { nombre: 'Rápida 1' });
  });
  assert.equal(dev.s.units[v1.id].nombre, 'Rápida 1');
});

test('personalización: la unidad hereda del tipo y sus personalizaciones no se sobrescriben', () => {
  const { dev, clock, a1, a2 } = setup();
  dev.run(C.unitUpdate, a1.id, { 'vis.forma': 'rombo' });
  const tipos = dev.s.prev.cat.tiposRecurso.map(t => (t.id === 'rt_svb' ? { ...t, vis: { ...t.vis, forma: 'triangulo', icono: 'cruz' } } : t));
  dev.run(C.catUpdate, 'tiposRecurso', tipos);
  const v1 = unitVisual(dev.s.prev, dev.s.units[a1.id], clock.now());
  const v2 = unitVisual(dev.s.prev, dev.s.units[a2.id], clock.now());
  assert.equal(v1.forma, 'rombo', 'personalización particular conservada');
  assert.equal(v1.icono, 'cruz', 'lo no personalizado se hereda del tipo');
  assert.equal(v2.forma, 'triangulo');
});

test('catálogos: no se puede eliminar una clave en uso ni dejar sin clave base', () => {
  const { dev } = setup();
  const sinBase = dev.s.prev.cat.claves.filter(c => !c.base);
  assert.throws(() => dev.run(C.catUpdate, 'claves', sinBase), /clave base/);
  const sinC0 = dev.s.prev.cat.claves.filter(c => c.codigo !== 'C0').map((c, i) => (i === 0 ? { ...c, base: true } : c));
  assert.throws(() => dev.run(C.catUpdate, 'claves', sinC0), /C0|transición/);
  const renom = dev.s.prev.cat.claves.map(c => (c.codigo === 'C1' ? { ...c, nombre: 'Activada' } : c));
  dev.run(C.catUpdate, 'claves', renom);
  assert.equal(dev.s.prev.cat.claves.find(c => c.codigo === 'C1').nombre, 'Activada');
});

test('cierre: advertencias, solo lectura y reapertura con autorización registrada', () => {
  const { dev, clock, a1 } = setup();
  const [av] = dev.run(C.avisoCreate, { desc: 'x' });
  dev.run(C.avisoAsignar, av.e, a1.id);
  try { dev.run(C.prevCerrar, {}); assert.fail('debía pedir confirmación'); }
  catch (e) { assert.equal(e.code, 'advertencias'); assert.equal(e.extra.activos.length, 1); assert.equal(e.extra.ocupadas.length, 1); }
  dev.run(C.prevCerrar, { confirmarAdvertencias: true });
  assert.equal(dev.s.prev.estado, 'cerrado');
  assert.ok(dev.s.prev.cierreAvisos);
  assert.throws(() => dev.run(C.avisoCreate, { desc: 'y' }), /cerrado/);
  assert.throws(() => dev.run(C.unitUpdate, a1.id, { nombre: 'x' }), /cerrado/);
  // operación remota tardía posterior al cierre: conflicto, no se aplica
  clock.advance(MIN);
  dev.receive([{ id: 'op_late', p: dev.pid, d: 'devZ', h: dev.hlc.tick(), t: clock.now(), u: { id: 'z', n: 'Z' }, k: 'unit.update', e: a1.id, x: { f: { nombre: { o: 'Ambulancia 1', n: 'Tarde' } } } }]);
  assert.equal(dev.s.units[a1.id].nombre, 'Ambulancia 1');
  // reapertura
  dev.as(mkUser('rol_operador', 'Op'), opDev => assert.throws(() => opDev.run(C.prevReabrir, 'x'), /permiso/));
  assert.throws(() => dev.run(C.prevReabrir, ''), /motivo/);
  dev.run(C.prevReabrir, 'Corrección de datos');
  assert.equal(dev.s.prev.estado, 'activo');
  assert.equal(dev.s.prev.reaperturas[0].motivo, 'Corrección de datos');
  assert.equal(dev.s.prev.reaperturas[0].por, 'Admin');
  dev.run(C.prevCerrar, { confirmarAdvertencias: true });
  dev.run(C.prevArchivar, true);
  assert.equal(dev.s.prev.archivado, true);
  dev.run(C.prevArchivar, false);
  assert.equal(dev.s.prev.archivado, false);
});

test('permisos: perfil Consulta no puede operar; Operador no puede configurar', () => {
  const { dev, a1 } = setup();
  dev.as(mkUser('rol_consulta', 'Lector'), cons => {
    assert.throws(() => cons.run(C.avisoCreate, { desc: 'x' }), /permiso/);
    assert.throws(() => cons.run(C.unitClave, a1.id, 'C6'), /permiso/);
    assert.throws(() => cons.run(C.unitRest, a1.id), /permiso/);
  });
  dev.as(mkUser('rol_operador', 'Op'), op => {
    assert.throws(() => op.run(C.catUpdate, 'sectores', []), /permiso/);
    assert.throws(() => op.run(C.prevCerrar, {}), /permiso/);
    assert.throws(() => op.run(C.unitColor, a1.id, '#000000'), /permiso/);
    const [av] = op.run(C.avisoCreate, { desc: 'ok' });
    assert.equal(dev.engine.status.get(av.id).status, 'ok');
    assert.equal(dev.s.avisos[av.e].creadoPor, 'Op');
  });
});
