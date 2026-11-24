// 1.4.0 · §4: tipo de mapa (estándar, satélite, híbrido, relieve) por preventivo.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../src/core/commands.js';
import { VISTAS_MAPA, capasVista, sesionGoogleVista, maxZoomEn } from '../../src/core/mapas.js';
import { Device, createPrev, unitByInd, makeClock, mkUser } from './helpers.mjs';

const ZONA = { tipo: 'mapa', nombre: 'Estadio', proveedor: 'osm', bounds: { n: 40.455, s: 40.451, e: -3.686, w: -3.691 }, centro: { lat: 40.453, lon: -3.688 }, zoom: 17 };

test('capas de cada vista: OpenStreetMap + IGN sin clave; Google con clave', () => {
  assert.deepEqual(VISTAS_MAPA.map(v => v.id), ['estandar', 'satelite', 'hibrido', 'relieve']);
  const osm = capasVista('osm', 'estandar');
  assert.equal(osm.length, 1); assert.match(osm[0].url, /^https:\/\/tile\.openstreetmap\.org\/\{z\}\/\{x\}\/\{y\}\.png$/);
  const sat = capasVista('osm', 'satelite');
  assert.match(sat[0].url, /^https:\/\/www\.ign\.es\/wmts\/pnoa-ma\?.*layer=OI\.OrthoimageCoverage.*tilematrixset=GoogleMapsCompatible.*TileMatrix=\{z\}&TileRow=\{y\}&TileCol=\{x\}/);
  assert.match(sat[0].atribucion, /Instituto Geográfico Nacional/); assert.match(sat[0].atribucion, /CC BY 4\.0/);
  const hib = capasVista('osm', 'hibrido');
  assert.equal(hib.length, 2); assert.match(hib[1].url, /layer=IGNBaseOrto/); assert.match(hib[1].url, /Format=image\/png/);
  assert.match(capasVista('osm', 'relieve')[0].url, /wmts\/mapa-raster\?.*layer=MTN/);
  assert.deepEqual(capasVista('osm', 'desconocida'), capasVista('osm', 'estandar'), 'valor desconocido: la vista actual de siempre');
  for (const v of ['satelite', 'hibrido', 'relieve']) for (const c of capasVista('osm', v)) assert.equal(c.maxNativeZoom, 20);
  assert.deepEqual(capasVista('google', 'hibrido'), [{ google: { mapType: 'satellite', layerTypes: ['layerRoadmap'], overlay: false } }]);
});

test('Google: parámetros de sesión de la Map Tiles API para cada vista', () => {
  assert.deepEqual(sesionGoogleVista('estandar'), { mapType: 'roadmap' });
  assert.deepEqual(sesionGoogleVista('satelite'), { mapType: 'satellite' });
  assert.deepEqual(sesionGoogleVista('hibrido'), { mapType: 'satellite', layerTypes: ['layerRoadmap'], overlay: false });
  assert.deepEqual(sesionGoogleVista('relieve'), { mapType: 'terrain', layerTypes: ['layerRoadmap'] }, 'terrain exige layerRoadmap');
  const rects = [{ maxZoom: 19, north: 90, south: -90, east: 180, west: -180 }, { maxZoom: 9, north: 90, south: -90, east: 180, west: -180 }, { maxZoom: 22, north: 41, south: 40, east: -3, west: -4 }];
  assert.equal(maxZoomEn(rects, 40.45, -3.69), 22); assert.equal(maxZoomEn(rects, 10, 10), 19); assert.equal(maxZoomEn([], 0, 0), null);
});

test('cambiar el tipo de mapa: solo en ese preventivo, sin tocar posiciones, y llega a los demás dispositivos', () => {
  makeClock();
  const A = new Device(); createPrev(A);
  assert.throws(() => A.run(C.prevVistaMapa, 'satelite'), /plano/i, 'sin plano cartográfico no hay vista satélite');
  A.run(C.planoSet, ZONA);
  A.run(C.unitCreate, { ind: 'U1' });
  A.run(C.unitPlan, unitByInd(A, 'U1').id, { x: 0.3, y: 0.6, lat: 40.4536, lon: -3.6895 });
  const antes = JSON.stringify([unitByInd(A, 'U1').plan, A.s.prev.plano]);
  assert.equal(A.s.prev.cfg.vistaMapa, undefined, 'por defecto, el mapa de siempre');
  A.run(C.prevVistaMapa, 'hibrido');
  assert.equal(A.s.prev.cfg.vistaMapa, 'hibrido');
  assert.equal(JSON.stringify([unitByInd(A, 'U1').plan, A.s.prev.plano]), antes, 'posiciones y plano intactos');
  assert.deepEqual(A.run(C.prevVistaMapa, 'hibrido'), [], 'sin cambios no genera operación');
  assert.throws(() => A.run(C.prevVistaMapa, 'nocturno'), /no válido/);
  // Otro preventivo no cambia
  const P2 = new Device({ pid: 'prev_2' }); createPrev(P2, { nombre: 'Otro' }); P2.run(C.planoSet, ZONA);
  assert.equal(P2.s.prev.cfg.vistaMapa, undefined);
  // Otro dispositivo del mismo preventivo recibe la vista
  const B = new Device({ id: 'devB', code: 'B' }); B.receive(A.store);
  assert.equal(B.s.prev.cfg.vistaMapa, 'hibrido');
});

test('plano de imagen: no se ofrece vista satélite', () => {
  makeClock();
  const A = new Device(); createPrev(A);
  A.run(C.planoSet, { tipo: 'imagen', blob: 'blob_1', w: 1000, h: 700, nombre: 'Recinto' });
  assert.throws(() => A.run(C.prevVistaMapa, 'satelite'), /imagen/);
});

test('permisos: cambiar la vista requiere «Cambiar la visualización del mapa» (incluido en «Editar planos»)', () => {
  makeClock();
  const A = new Device(); createPrev(A); A.run(C.planoSet, ZONA);
  const consulta = mkUser('rol_consulta', 'Consulta');
  assert.throws(() => A.as(consulta, d => d.run(C.prevVistaMapa, 'satelite')), /visualización del mapa/);
  const operador = mkUser('rol_operador', 'Operador');
  A.as(operador, d => d.run(C.prevVistaMapa, 'satelite'));
  const soloVista = { id: 'usr_v', nombre: 'Vista', perms: new Set(['planos.vista']) };
  A.as(soloVista, d => d.run(C.prevVistaMapa, 'relieve'));
  assert.equal(A.s.prev.cfg.vistaMapa, 'relieve');
  assert.throws(() => A.as(soloVista, d => d.run(C.planoSet, null)), /permiso/, 'cambiar la vista no permite editar el plano');
});
