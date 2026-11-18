// Fases 3 y 4: planos cartográficos georreferenciados, posiciones con coordenadas reales y avisos por zona.
import test from 'node:test';
import assert from 'node:assert/strict';
import { geoANorm, normAGeo, boundsValidos, BIBLIOTECA_PLANOS, mercY } from '../../src/core/geo.js';
import { logEntries } from '../../src/core/timeline.js';
import { Device, createPrev, unitByInd, makeClock, mkUser, C } from './helpers.mjs';

const SOL = BIBLIOTECA_PLANOS.find(p => p.id === 'lib_sol');

test('proyección Web Mercator: ida y vuelta con precisión submétrica', () => {
  for (const p of BIBLIOTECA_PLANOS) {
    assert.ok(boundsValidos(p.bounds), p.nombre);
    const n = geoANorm(p.bounds, p.centro.lat, p.centro.lon);
    assert.ok(n.x > 0.3 && n.x < 0.7 && n.y > 0.3 && n.y < 0.7, p.nombre + ': el centro queda dentro del encuadre');
    const g = normAGeo(p.bounds, n.x, n.y);
    assert.ok(Math.abs(g.lat - p.centro.lat) < 2e-6 && Math.abs(g.lon - p.centro.lon) < 2e-6, p.nombre);
  }
  const esq = normAGeo(SOL.bounds, 0, 0); assert.deepEqual([esq.lat, esq.lon], [SOL.bounds.n, SOL.bounds.w]);
  assert.ok(mercY(85.1) === mercY(85.0511), 'latitudes extremas acotadas');
  assert.equal(boundsValidos({ n: 1, s: 2, e: 3, w: 0 }), false);
  assert.equal(boundsValidos({ n: 40, s: 30, e: 10, w: -10 }), false, 'zonas demasiado grandes no');
});

test('biblioteca: Bernabéu, Metropolitano y Sol con coordenadas reales', () => {
  const ids = BIBLIOTECA_PLANOS.map(p => p.nombre);
  assert.ok(ids.some(n => /Bernab/.test(n)) && ids.some(n => /Metropolitano/.test(n)) && ids.some(n => /Sol/.test(n)));
  const b = BIBLIOTECA_PLANOS.find(p => p.id === 'lib_bernabeu');
  assert.ok(Math.abs(b.centro.lat - 40.4530) < 0.001 && Math.abs(b.centro.lon + 3.6882) < 0.001);
});

test('plano cartográfico: se valida la extensión y se guardan posiciones con coordenadas', () => {
  makeClock();
  const A = new Device(); createPrev(A, { unidades: [{ ind: 'U1' }, { ind: 'U2' }] });
  assert.throws(() => A.run(C.planoSet, { tipo: 'mapa', nombre: 'X', bounds: { n: 1, s: 2, e: 3, w: 0 } }), /no es válida/);
  A.run(C.planoSet, { tipo: 'mapa', nombre: 'Sol', proveedor: 'osm', bounds: SOL.bounds, centro: SOL.centro, zoom: 16.4, extra: 'se descarta' });
  const pl = A.s.prev.plano;
  assert.equal(pl.crs, 'EPSG:3857'); assert.equal(pl.zoom, 16); assert.equal(pl.extra, undefined);
  const u1 = unitByInd(A, 'U1');
  const n = geoANorm(SOL.bounds, 40.4170, -3.7040);
  A.run(C.unitPlan, u1.id, { ...n, lat: 40.417, lon: -3.704 });
  assert.deepEqual(unitByInd(A, 'U1').plan, { x: n.x, y: n.y, lat: 40.417, lon: -3.704 });
  assert.throws(() => A.run(C.unitPlan, u1.id, { x: 0.5, y: 0.5, lat: 120, lon: 0 }), /fuera de rango/);
  // Otro dispositivo reproduce las mismas coordenadas
  const B = new Device({ id: 'devB', code: 'B' }); B.receive(A.store);
  assert.equal(unitByInd(B, 'U1').plan.lat, 40.417);
  // Volver a pendiente de asignación sin eliminar la unidad
  A.run(C.unitPlan, u1.id, null);
  assert.equal(unitByInd(A, 'U1').plan, null); assert.equal(unitByInd(A, 'U1').eliminada, false);
  const log = logEntries(A.engine).map(e => e.accion + ' ' + (e.nuevo || ''));
  assert.ok(log.some(l => /Posición en plano 40\.41700, -3\.70400/.test(l)), 'la bitácora registra las coordenadas');
  assert.ok(log.some(l => /Plano importado Sol \(cartográfico/.test(l)));
});

test('avisos por zona: polígono con coordenadas, ubicación en su centro, mismo sistema de avisos', () => {
  makeClock();
  const A = new Device(); createPrev(A);
  A.run(C.planoSet, { tipo: 'mapa', nombre: 'Sol', bounds: SOL.bounds, zoom: 16 });
  const pts = [[0.2, 0.2], [0.6, 0.2], [0.6, 0.5], [0.2, 0.5]].map(([x, y]) => ({ x, y, ...normAGeo(SOL.bounds, x, y) }));
  assert.throws(() => A.run(C.avisoCreate, { desc: 'Zona', zona: { pts: pts.slice(0, 2) } }), /entre 3 y 200/);
  const centro = normAGeo(SOL.bounds, 0.4, 0.35);
  const [op] = A.run(C.avisoCreate, { desc: 'Aglomeración', zona: { pts }, plan: { x: 0.4, y: 0.35, ...centro }, loc: { txt: '', lat: centro.lat, lon: centro.lon } });
  const a = A.s.avisos[op.e];
  assert.equal(a.zona.pts.length, 4); assert.equal(a.zona.pts[2].lat, pts[2].lat);
  assert.equal(a.num, 1, 'numeración normal'); assert.equal(a.estado, 'pendiente');
  assert.equal(a.loc.lat, centro.lat);
  // Se asigna y finaliza como cualquier otro aviso
  A.run(C.unitCreate, { ind: 'AMB-1' });
  A.run(C.avisoAsignar, a.id, unitByInd(A, 'AMB-1').id);
  assert.equal(A.s.avisos[a.id].estado, 'asignado');
  const log = logEntries(A.engine).map(e => e.accion + ' ' + (e.nuevo || ''));
  assert.ok(log.some(l => /Nuevo aviso .*Aglomeración · zona de 4 puntos/.test(l)));
  // Sin permiso de crear avisos no se puede
  assert.throws(() => A.as(mkUser('rol_consulta', 'C'), d => d.run(C.avisoCreate, { desc: 'x', zona: { pts } })), /permiso/);
});
