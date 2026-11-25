// 1.5.0 · §6–7: ubicación de los avisos con su origen y su hora, y validación también en el servidor.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../src/core/commands.js';
import { FUENTES_LOC, normalizarLoc, motivoLocNoValida, describirFuente, motivoContenidoNoValido } from '../../src/core/ubicacion.js';
import { Device, createPrev, unitByInd, makeClock } from './helpers.mjs';

function preparado() { const clock = makeClock(); const d = new Device({ clock }); createPrev(d); d.run(C.unitCreate, { ind: 'SVB-1', tipo: 'rt_svb' }); return { d, clock }; }

test('origen de la ubicación: se guarda y se describe (marcada en el mapa no es GPS)', () => {
  const { d, clock } = preparado();
  const id = d.run(C.avisoCreate, { desc: 'Caída', loc: { txt: '', lat: 40.4168, lon: -3.7038, fuente: 'mapa', t: clock.now() } })[0].e;
  const loc = d.s.avisos[id].loc;
  assert.equal(loc.fuente, 'mapa'); assert.equal(loc.t, clock.now());
  assert.match(describirFuente(loc), /marcada en el mapa/i); assert.match(describirFuente(loc), /no es una posición GPS/i);
  assert.match(describirFuente({ lat: 1, lon: 1, fuente: 'gps', prec: 12 }), /GPS.*±12 m/);
  assert.equal(describirFuente(null), '');
  for (const k of ['mapa', 'gps', 'direccion', 'coordenadas', 'punto', 'sector']) assert.ok(FUENTES_LOC[k], k);
  // Corregir la ubicación es una modificación del aviso (permiso de editar avisos) que queda en la bitácora
  d.run(C.avisoUpdate, id, { loc: { txt: 'Puerta 3', lat: 40.417, lon: -3.704, fuente: 'punto', ref: 'pt_1', t: clock.advance(60000) } });
  assert.equal(d.s.avisos[id].loc.fuente, 'punto'); assert.equal(d.s.avisos[id].loc.ref, 'pt_1');
});

test('ubicaciones no válidas: fuera de rango, incompletas, no numéricas u origen desconocido', () => {
  const { d } = preparado();
  assert.throws(() => d.run(C.avisoCreate, { desc: 'X', loc: { lat: 120, lon: 3 } }), /coordenadas/i);
  assert.throws(() => d.run(C.avisoCreate, { desc: 'X', loc: { lat: 40.1 } }), /latitud y longitud/i);
  assert.throws(() => d.run(C.avisoCreate, { desc: 'X', loc: { lat: 'cuarenta', lon: 3 } }), /coordenadas/i);
  assert.throws(() => d.run(C.avisoCreate, { desc: 'X', loc: { txt: 'a', fuente: 'satelite_espia' } }), /origen/i);
  assert.throws(() => d.run(C.avisoCreate, { desc: 'X', loc: { txt: 'x'.repeat(301) } }), /demasiado larga/i);
  const id = d.run(C.avisoCreate, { desc: 'Bien', loc: { txt: 'Calle Mayor 1' } })[0].e;
  assert.throws(() => d.run(C.avisoUpdate, id, { loc: { lat: 40, lon: 200 } }), /coordenadas/i);
  // Las unidades conservan también el origen de su ubicación
  const u = unitByInd(d, 'SVB-1');
  d.run(C.unitLoc, u.id, { txt: '', lat: 40.41, lon: -3.7, fuente: 'gps', prec: 8 });
  assert.equal(d.s.units[u.id].loc.fuente, 'gps'); assert.equal(d.s.units[u.id].loc.prec, 8);
  assert.throws(() => d.run(C.unitLoc, u.id, { lat: 91, lon: 0 }), /coordenadas/i);
  assert.deepEqual(normalizarLoc({ txt: '  ', lat: null, lon: null }), null);
  assert.equal(motivoLocNoValida(null), null);
});

test('el servidor comprueba la ubicación aunque se salte la aplicación', () => {
  const bueno = { k: 'aviso.create', x: { a: { loc: { txt: '', lat: 40.4, lon: -3.7, fuente: 'mapa' } } } };
  assert.equal(motivoContenidoNoValido(bueno), null);
  assert.match(motivoContenidoNoValido({ k: 'aviso.create', x: { a: { loc: { lat: 400, lon: 0 } } } }), /coordenadas/i);
  assert.match(motivoContenidoNoValido({ k: 'aviso.update', x: { f: { loc: { o: null, n: { lat: 0, lon: 999 } } } } }), /coordenadas/i);
  assert.match(motivoContenidoNoValido({ k: 'unit.loc', x: { n: { lat: NaN, lon: 1 } } }), /coordenadas/i);
  assert.equal(motivoContenidoNoValido({ k: 'unit.clave', x: {} }), null);
});
