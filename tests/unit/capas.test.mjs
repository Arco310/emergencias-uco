// 1.5.0 · §1: capas y filtros del mapa, puntos de interés y delimitación de sectores.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../src/core/commands.js';
import { Engine } from '../../src/core/engine.js';
import { defaultCatalogs } from '../../src/core/defaults.js';
import { permisosOp } from '../../src/core/perms.js';
import {
  DEFAULT_CATEGORIAS_PUNTO, FILTROS_DEFECTO, normalizarFiltros, filtrosActivos, filtrarUnidades, filtrarAvisos,
  agrupar, leyenda, sectorDePunto, categoriasPunto,
} from '../../src/core/capas.js';
import { Device, createPrev, unitByInd, makeClock, mkUser } from './helpers.mjs';

function preparado() {
  const clock = makeClock(); const d = new Device({ clock }); createPrev(d);
  d.run(C.unitCreate, { ind: 'SVB-1', tipo: 'rt_svb', sector: 'sec_1' });
  d.run(C.unitCreate, { ind: 'SVB-2', tipo: 'rt_svb', sector: 'sec_2' });
  d.run(C.unitCreate, { ind: 'SVA-1', tipo: 'rt_sva', sector: 'sec_1' });
  return { d, clock };
}

test('categorías de puntos: las de partida (interés y apoyo), configurables y validadas', () => {
  const ids = DEFAULT_CATEGORIAS_PUNTO.map(c => c.id);
  assert.ok(ids.length >= 12, 'accesos, encuentro, puesto sanitario, coordinación, restringida, riesgo, hospital, centro, asistencia, abastecimiento, apoyo, otros');
  assert.deepEqual([...new Set(DEFAULT_CATEGORIAS_PUNTO.map(c => c.grupo))].sort(), ['apoyo', 'interes']);
  assert.deepEqual(defaultCatalogs().categoriasPunto, DEFAULT_CATEGORIAS_PUNTO);
  const { d } = preparado();
  assert.deepEqual(d.s.prev.cat.categoriasPunto, DEFAULT_CATEGORIAS_PUNTO); assert.deepEqual(d.s.prev.cat.puntos, []);
  const nuevas = [...DEFAULT_CATEGORIAS_PUNTO, { id: 'cp_helipuerto', nombre: 'Helipuerto', grupo: 'apoyo', color: '#00897B', icono: 'cruz' }];
  d.run(C.catUpdate, 'categoriasPunto', nuevas);
  assert.equal(categoriasPunto(d.s.prev).length, nuevas.length);
  assert.throws(() => d.run(C.catUpdate, 'categoriasPunto', [{ id: 'x', nombre: 'X', grupo: 'otro', color: '#000000' }]), /grupo/i);
  assert.throws(() => d.run(C.catUpdate, 'categoriasPunto', [{ id: 'x', nombre: 'X', grupo: 'apoyo', color: 'rojo' }]), /color/i);
});

test('preventivo anterior a la 1.5.0: tiene las categorías de partida y ningún punto', () => {
  const { d } = preparado();
  const viejo = d.store.map(o => structuredClone(o));
  const c = viejo.find(o => o.k === 'prev.create'); delete c.x.prev.cat.categoriasPunto; delete c.x.prev.cat.puntos;
  const e = new Engine(); e.add(viejo);
  assert.deepEqual(e.state.prev.cat.categoriasPunto, DEFAULT_CATEGORIAS_PUNTO); assert.deepEqual(e.state.prev.cat.puntos, []);
});

test('puntos de interés y delimitación de sectores: validados, con su permiso y en la bitácora', () => {
  const { d } = preparado();
  d.run(C.catUpdate, 'puntos', [{ id: 'pt_1', nombre: 'Puerta 3', categoria: 'cp_acceso', pos: { x: 0.2, y: 0.3 } }]);
  assert.equal(d.s.prev.cat.puntos[0].nombre, 'Puerta 3');
  assert.throws(() => d.run(C.catUpdate, 'puntos', [{ id: 'pt_2', nombre: 'X', categoria: 'no_existe', pos: { x: 0.1, y: 0.1 } }]), /categor/i);
  assert.throws(() => d.run(C.catUpdate, 'puntos', [{ id: 'pt_2', nombre: 'Sin sitio', categoria: 'cp_acceso' }]), /posición o una zona/i);
  const sec = structuredClone(d.s.prev.cat.sectores);
  sec[0].zona = { pts: [{ x: 0.1, y: 0.1 }, { x: 0.4, y: 0.1 }] };
  assert.throws(() => d.run(C.catUpdate, 'sectores', sec), /al menos 3 puntos/i);
  sec[0].zona.pts.push({ x: 0.25, y: 0.4 });
  d.run(C.catUpdate, 'sectores', sec);
  assert.equal(d.s.prev.cat.sectores[0].zona.pts.length, 3);
  // Permisos: los puntos son parte del plano; la delimitación, de los sectores
  assert.deepEqual(permisosOp({ k: 'prev.cat', x: { cat: 'puntos' } }), ['planos.editar']);
  assert.deepEqual(permisosOp({ k: 'prev.cat', x: { cat: 'categoriasPunto' } }), ['planos.editar']);
  assert.deepEqual(permisosOp({ k: 'prev.cat', x: { cat: 'sectores' } }), ['sectores.gestionar']);
  const consulta = mkUser('rol_consulta', 'Consulta');
  assert.throws(() => d.as(consulta, x => x.run(C.catUpdate, 'puntos', [])), /permiso/i);
});

test('sector de un punto: según la delimitación dibujada', () => {
  const sectores = [{ id: 'sec_1', nombre: 'Norte', zona: { pts: [{ x: 0, y: 0 }, { x: 0.5, y: 0 }, { x: 0.5, y: 0.5 }, { x: 0, y: 0.5 }] } }, { id: 'sec_2', nombre: 'Sin zona' }];
  assert.equal(sectorDePunto(sectores, { x: 0.2, y: 0.2 }), 'sec_1');
  assert.equal(sectorDePunto(sectores, { x: 0.8, y: 0.8 }), null);
  assert.equal(sectorDePunto(sectores, null), null);
});

test('filtros de unidades combinables (tipo, clave, disponibilidad, sector) sin tocar los datos', () => {
  const { d, clock } = preparado();
  d.run(C.unitRest, unitByInd(d, 'SVB-2').id);
  const antes = JSON.stringify(d.s);
  const t = clock.now();
  const ver = f => filtrarUnidades(d.s, normalizarFiltros(f), t).map(u => u.ind).sort();
  assert.deepEqual(ver({}), ['SVA-1', 'SVB-1', 'SVB-2']);
  assert.deepEqual(ver({ tipos: ['rt_svb'] }), ['SVB-1', 'SVB-2']);
  assert.deepEqual(ver({ disponibilidad: ['descanso'] }), ['SVB-2']);
  assert.deepEqual(ver({ sectores: ['sec_1'] }), ['SVA-1', 'SVB-1']);
  assert.deepEqual(ver({ tipos: ['rt_svb'], sectores: ['sec_1'] }), ['SVB-1']);
  assert.deepEqual(ver({ claves: ['C0'], disponibilidad: ['disponible'] }), ['SVA-1', 'SVB-1']);
  assert.deepEqual(ver({ capas: { unidades: false } }), []);
  assert.equal(JSON.stringify(d.s), antes, 'filtrar no cambia el estado');
});

test('avisos: activos por defecto, finalizados solo si se piden, filtro por tipo', () => {
  const { d } = preparado();
  const [tA, tB] = d.s.prev.cat.tiposAviso;
  const a1 = d.run(C.avisoCreate, { tipo: tA.id, desc: 'Uno' })[0].e;
  const a2 = d.run(C.avisoCreate, { tipo: tB.id, desc: 'Dos' })[0].e;
  d.run(C.avisoFinalizar, a2, {});
  const ver = f => filtrarAvisos(d.s, normalizarFiltros(f)).map(a => a.id).sort();
  assert.deepEqual(ver({}), [a1]);
  assert.deepEqual(ver({ capas: { finalizados: true } }), [a1, a2].sort());
  assert.deepEqual(ver({ capas: { finalizados: true }, tiposAviso: [tB.id] }), [a2]);
  assert.deepEqual(ver({ capas: { avisos: false, finalizados: true } }), [a2], 'ocultar activos no oculta los finalizados pedidos');
});

test('restablecer y número de filtros activos', () => {
  assert.deepEqual(normalizarFiltros({}), FILTROS_DEFECTO);
  assert.equal(filtrosActivos(normalizarFiltros({})), 0);
  const f = normalizarFiltros({ tipos: ['rt_svb'], capas: { finalizados: true }, sectoresOcultos: ['sec_2'] });
  assert.equal(filtrosActivos(f), 3);
  assert.deepEqual(normalizarFiltros(JSON.parse('{"capas":{"unidades":"si"},"tipos":"x"}')), FILTROS_DEFECTO, 'valores corruptos: vuelve a lo normal');
});

test('agrupación por rejilla: solo con muchos elementos y solo los que están juntos en pantalla', () => {
  const cerca = Array.from({ length: 4 }, (_, i) => ({ id: 'c' + i, x: 100 + i * 5, y: 100 + i * 5 }));
  const lejos = [{ id: 'l1', x: 400, y: 50 }, { id: 'l2', x: 50, y: 400 }];
  const pocos = agrupar([...cerca, ...lejos], { celda: 60, umbral: 10 });
  assert.equal(pocos.grupos.length, 0, 'por debajo del umbral no se agrupa'); assert.equal(pocos.sueltos.length, 6);
  const r = agrupar([...cerca, ...lejos], { celda: 60, umbral: 3 });
  assert.equal(r.grupos.length, 1); assert.deepEqual(r.grupos[0].ids.sort(), ['c0', 'c1', 'c2', 'c3']); assert.equal(r.grupos[0].n, 4);
  assert.deepEqual(r.sueltos.map(x => x.id).sort(), ['l1', 'l2']);
});

test('leyenda: claves, disponibilidad con símbolo (no solo color) y categorías visibles', () => {
  const { d } = preparado();
  const ley = leyenda(d.s.prev, normalizarFiltros({ categoriasOcultas: ['cp_hospital'] }));
  assert.ok(ley.claves.some(c => c.codigo === 'C0' && /^#/.test(c.color)));
  for (const k of ['disponible', 'ocupada', 'descanso', 'fuera']) { const x = ley.disponibilidad.find(i => i.id === k); assert.ok(x && x.simbolo && x.nombre, k); }
  assert.equal(new Set(ley.disponibilidad.map(x => x.simbolo)).size, ley.disponibilidad.length, 'cada estado con su símbolo');
  assert.ok(!ley.categorias.some(c => c.id === 'cp_hospital'), 'una categoría oculta no sale en la leyenda');
  assert.ok(ley.categorias.some(c => c.id === 'cp_acceso'));
});
