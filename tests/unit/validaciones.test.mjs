// 1.5.0 · §5: detección de incoherencias operativas. Detectar, informar y proponer: nunca cambiar datos.
// Algunas contradicciones no las permite el motor (p. ej. descanso con aviso activo); el detector debe
// encontrarlas igualmente si llegan con datos antiguos, importaciones o fallos: esos estados se construyen aquí.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../src/core/commands.js';
import { REGLAS, NIVELES, detectarIncoherencias } from '../../src/core/validaciones.js';
import { permisosOp } from '../../src/core/perms.js';
import { Device, createPrev, unitByInd, makeClock, mkUser, MIN } from './helpers.mjs';

function preparado() {
  const clock = makeClock(); const d = new Device({ clock }); createPrev(d);
  for (const [ind, tipo, sector] of [['SVB-1', 'rt_svb', 'sec_1'], ['SVB-2', 'rt_svb', 'sec_2'], ['SVA-1', 'rt_sva', 'sec_1']]) d.run(C.unitCreate, { ind, tipo, sector });
  return { d, clock, id: ind => unitByInd(d, ind).id };
}
const reglas = l => l.map(h => h.regla).sort();

test('catálogo de reglas ampliable: cada regla explica qué, por qué, consecuencias y qué hacer', () => {
  assert.deepEqual(Object.keys(NIVELES), ['info', 'moderada', 'alta', 'critica']);
  const ids = new Set();
  for (const r of REGLAS) {
    assert.ok(r.id && !ids.has(r.id), r.id); ids.add(r.id);
    for (const k of ['titulo', 'porque', 'consecuencias', 'recomendacion', 'grupo']) assert.ok(r[k], r.id + ' ' + k);
    assert.ok(NIVELES[r.nivel], r.id); assert.equal(typeof r.detectar, 'function');
  }
  for (const g of ['unidades', 'avisos', 'descansos', 'preventivo', 'sincronizacion']) assert.ok(REGLAS.some(r => r.grupo === g), g);
});

test('unidades: disponible con aviso activo, en descanso con aviso, inactiva con aviso y referencias rotas', () => {
  const { d, clock, id } = preparado();
  const a1 = d.run(C.avisoCreate, { desc: 'Caída' }, { unidades: [id('SVB-1')] })[0].e;
  const t = clock.now(); const s = structuredClone(d.s);
  s.units[id('SVB-1')].clave = 'C0'; // datos incoherentes: «disponible» con aviso activo
  s.units[id('SVA-1')].aviso = a1; s.avisos[a1].part.push({ u: id('SVA-1'), asig: t, lib: null });
  s.units[id('SVA-1')].descanso = { id: 'r1', ini: t - 5 * MIN, dur: 30, finPrev: t + 25 * MIN, fin: null };
  s.units[id('SVB-2')].sector = 'sec_que_ya_no_existe';
  const l = detectarIncoherencias(s, { t });
  const de = (regla, u) => l.find(h => h.regla === regla && h.entidad.id === u);
  assert.ok(de('unidad_disponible_con_aviso', id('SVB-1')), reglas(l));
  const desc = de('descanso_con_aviso', id('SVA-1')); assert.ok(desc); assert.equal(desc.nivel, 'critica');
  assert.ok(de('referencia_inexistente', id('SVB-2')));
  for (const h of l) for (const k of ['titulo', 'porque', 'consecuencias', 'recomendacion', 'detalle']) assert.ok(h[k], h.regla + ' ' + k);
  assert.ok(l.every(h => h.entidad.nombre), 'qué unidad, aviso o preventivo');
});

test('asignación incompatible: la misma unidad activa en dos avisos (crítica)', () => {
  const { d, clock, id } = preparado();
  const a1 = d.run(C.avisoCreate, { desc: 'Uno' }, { unidades: [id('SVB-1')] })[0].e;
  const a2 = d.run(C.avisoCreate, { desc: 'Dos' })[0].e;
  const t = clock.now(); const s = structuredClone(d.s); s.avisos[a2].part.push({ u: id('SVB-1'), asig: t, lib: null });
  const h = detectarIncoherencias(s, { t }).find(x => x.regla === 'unidad_en_dos_avisos');
  assert.ok(h); assert.equal(h.nivel, 'critica'); assert.equal(h.entidad.id, id('SVB-1')); assert.match(h.detalle, /Nº 1.*Nº 2|Nº 2.*Nº 1/);
  assert.ok(a1);
});

test('avisos y descansos según el tiempo (umbrales): sin unidad, abierto demasiado, duración incoherente', () => {
  const { d, clock, id } = preparado();
  d.run(C.avisoCreate, { desc: 'Esperando' });
  assert.ok(!detectarIncoherencias(d.s, { t: clock.now() + 5 * MIN }).some(h => h.regla === 'aviso_sin_unidad'), 'aún no');
  const l = detectarIncoherencias(d.s, { t: clock.now() + 20 * MIN });
  const h = l.find(x => x.regla === 'aviso_sin_unidad'); assert.ok(h); assert.equal(h.nivel, 'moderada'); assert.equal(h.desde, clock.now());
  assert.ok(detectarIncoherencias(d.s, { t: clock.now() + 200 * MIN }).some(x => x.regla === 'aviso_abierto_demasiado'));
  const s = structuredClone(d.s); s.units[id('SVB-2')].descanso = { id: 'r2', ini: clock.now(), dur: 600, finPrev: clock.now() + 600 * MIN, fin: null };
  assert.ok(detectarIncoherencias(s, { t: clock.now() + MIN }).some(x => x.regla === 'descanso_duracion' && x.entidad.id === id('SVB-2')));
});

test('sincronización: cambios rechazados sin revisar, conflictos, cambios sin enviar y datos sin sincronizar', () => {
  const { d, clock } = preparado(); const t = clock.now();
  const s = structuredClone(d.s); s.conflicts.c1 = { id: 'c1', estado: 'pendiente', t: t - 30 * MIN, campo: 'cat.sectores' };
  const sync = { compartido: true, rechazos: [{ id: 'op1', que: 'Unidad X · Alta', error: 'No tienes permiso', t: t - 3 * MIN }], pendientes: { n: 4, desde: t - 15 * MIN }, ultimoSync: t - 40 * MIN };
  const r = reglas(detectarIncoherencias(s, { t, sync }));
  for (const k of ['rechazos_sin_revisar', 'conflicto_pendiente', 'cambios_sin_enviar', 'sin_sincronizar']) assert.ok(r.includes(k), k + ' en ' + r);
  assert.ok(!reglas(detectarIncoherencias(s, { t, sync: { ...sync, rechazos: [{ ...sync.rechazos[0], revisado: t }] } })).includes('rechazos_sin_revisar'));
});

test('sin duplicados: el mismo problema en la misma unidad es una sola advertencia, aunque se detecte varias veces', () => {
  const { d, clock } = preparado();
  for (let i = 0; i < 3; i++) d.run(C.avisoCreate, { desc: 'Sin unidad ' + i });
  const t = clock.now() + 30 * MIN; const a = detectarIncoherencias(d.s, { t }); const b = detectarIncoherencias(d.s, { t });
  assert.deepEqual(a.map(h => h.id), b.map(h => h.id), 'estable entre detecciones');
  assert.equal(new Set(a.map(h => h.id)).size, a.length, 'una por regla y elemento');
  assert.equal(a.filter(h => h.regla === 'aviso_sin_unidad').length, 3, 'tres avisos distintos, tres advertencias');
});

test('ninguna detección cambia datos operativos', () => {
  const { d, clock, id } = preparado(); d.run(C.avisoCreate, { desc: 'X' }, { unidades: [id('SVB-1')] });
  const antes = JSON.stringify(d.s); const ops = d.store.length;
  detectarIncoherencias(d.s, { t: clock.now() + 500 * MIN, sync: { compartido: true, pendientes: { n: 9, desde: 0 }, ultimoSync: 0 } });
  assert.equal(JSON.stringify(d.s), antes); assert.equal(d.store.length, ops, 'no se genera ninguna operación');
});

test('revisar, asignar y resolver: queda en el preventivo con su historial; si la situación cambia, vuelve a avisar', () => {
  const { d, clock } = preparado();
  const a = d.run(C.avisoCreate, { desc: 'Pendiente' })[0].e;
  clock.advance(20 * MIN);
  let h = detectarIncoherencias(d.s, { t: clock.now() }).find(x => x.regla === 'aviso_sin_unidad' && x.entidad.id === a);
  d.run(C.incoherenciaRevisar, h, { estado: 'asignada', asignadoA: { id: 'usr_ana', nombre: 'Ana' }, nota: 'Lo mira Ana' });
  d.run(C.incoherenciaRevisar, h, { estado: 'resuelta', nota: 'Se esperaba a la ambulancia de relevo' });
  h = detectarIncoherencias(d.s, { t: clock.now() }).find(x => x.id === h.id);
  assert.equal(h.revision.estado, 'resuelta'); assert.equal(h.revision.hist.length, 2); assert.equal(h.revision.hist[0].asignadoA.nombre, 'Ana');
  assert.equal(d.s.avisos[a].estado, 'pendiente', 'revisar no toca el aviso');
  // La revisión vale para esa situación concreta: si cambia, vuelve a aparecer como nueva
  const s = structuredClone(d.s); s.avisos[a].creado += MIN; s.avisos[a].t = s.avisos[a].creado;
  assert.ok(!detectarIncoherencias(s, { t: clock.now() }).find(x => x.id === h.id).revision);
  assert.deepEqual(permisosOp({ k: 'revision.set', x: {} }), ['incoherencias.revisar']);
  assert.throws(() => d.as(mkUser('rol_consulta', 'Consulta'), x => x.run(C.incoherenciaRevisar, h, { estado: 'revisada' })), /permiso/i);
});

test('niveles y umbrales ajustables por reglas aprobadas (con permiso) y reglas desactivables', () => {
  const { d, clock } = preparado(); d.run(C.avisoCreate, { desc: 'Pendiente' });
  d.run(C.reglasSet, { aviso_sin_unidad: { nivel: 'alta', umbral: 5 }, aviso_abierto_demasiado: { activa: false } });
  const l = detectarIncoherencias(d.s, { t: clock.now() + 8 * MIN });
  assert.equal(l.find(x => x.regla === 'aviso_sin_unidad').nivel, 'alta');
  assert.ok(!detectarIncoherencias(d.s, { t: clock.now() + 500 * MIN }).some(x => x.regla === 'aviso_abierto_demasiado'));
  assert.throws(() => d.run(C.reglasSet, { aviso_sin_unidad: { nivel: 'tremenda' } }), /nivel/i);
  assert.throws(() => d.run(C.reglasSet, { no_existe: { nivel: 'alta' } }), /regla/i);
  assert.deepEqual(permisosOp({ k: 'prev.update', x: { f: { 'cfg.reglas': {} } } }), ['incoherencias.reglas']);
  assert.throws(() => d.as(mkUser('rol_operador', 'Ope'), x => x.run(C.reglasSet, { aviso_sin_unidad: { nivel: 'info' } })), /permiso/i);
});
