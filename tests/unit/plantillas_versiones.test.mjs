// 1.5.0 · §3: plantillas de preventivo — qué se incluye, versiones, preventivos independientes y permisos.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../../src/core/commands.js';
import { Engine } from '../../src/core/engine.js';
import { defaultCatalogs } from '../../src/core/defaults.js';
import { ELEMENTOS_PLANTILLA, contentFromPrev, newTemplate, seedFromTemplate, versionarPlantilla, cambioContenido, describirOrigen } from '../../src/core/templates.js';
import { permisosOp, permsOf, defaultRoles } from '../../src/core/perms.js';
import { Device, createPrev, unitByInd, makeClock, MIN } from './helpers.mjs';

function preventivo() {
  const clock = makeClock(); const d = new Device({ clock }); createPrev(d, { nombre: 'Concierto' });
  d.run(C.unitCreate, { ind: 'SVB-1', tipo: 'rt_svb', sector: 'sec_1' });
  d.run(C.unitPlan, unitByInd(d, 'SVB-1').id, { x: 0.2, y: 0.3 });
  d.run(C.catUpdate, 'puntos', [{ id: 'pt_1', nombre: 'Puerta 3', categoria: 'cp_acceso', pos: { x: 0.1, y: 0.5 } }]);
  d.run(C.reglasSet, { aviso_sin_unidad: { nivel: 'alta' } });
  d.run(C.prevUpdate, { participantes: [{ nombre: 'Ana Pérez', rol: 'Coordinadora' }] });
  d.run(C.avisoCreate, { desc: 'Caída' }, { unidades: [unitByInd(d, 'SVB-1').id] });
  return { d, clock };
}

test('elegir qué se incluye en la plantilla; los datos personales, solo si se piden', () => {
  const keys = ELEMENTOS_PLANTILLA.map(e => e[0]);
  for (const k of ['tiposRecurso', 'unidades', 'sectores', 'puntos', 'plano', 'capas', 'tiposAviso', 'parametros', 'reglas', 'participantes']) assert.ok(keys.includes(k), k);
  const { d } = preventivo();
  const todo = contentFromPrev(d.s);
  assert.equal(todo.unidades.length, 1); assert.equal(todo.cat.puntos.length, 1); assert.equal(todo.cfg.reglas.aviso_sin_unidad.nivel, 'alta');
  assert.deepEqual(todo.participantes, [], 'las personas previstas no se copian si no se piden');
  const poco = contentFromPrev(d.s, { unidades: false, puntos: false, reglas: false, plano: false, participantes: true });
  assert.equal(poco.unidades.length, 0); assert.deepEqual(poco.cat.puntos, []); assert.equal(poco.cfg.reglas, undefined); assert.equal(poco.plano, null);
  assert.equal(poco.participantes[0].nombre, 'Ana Pérez');
  // Excluir los tipos de recurso no rompe las unidades incluidas: se conservan los tipos que usan
  const sinTipos = contentFromPrev(d.s, { tiposRecurso: false });
  assert.ok(sinTipos.cat.tiposRecurso.some(t => t.id === 'rt_svb'));
  assert.deepEqual(sinTipos.cat.tiposRecurso.map(t => t.id).sort(), defaultCatalogs().tiposRecurso.map(t => t.id).sort());
});

test('desde un preventivo finalizado: sin avisos, estados en curso, historiales ni identificadores repetidos', () => {
  const { d } = preventivo();
  d.run(C.prevCerrar, { confirmarAdvertencias: true });
  assert.equal(d.s.prev.estado, 'cerrado');
  const c = contentFromPrev(d.s);
  const u = c.unidades[0];
  for (const k of ['id', 'clave', 'aviso', 'hc', 'hl', 'hr', 'descanso', 'plan']) if (k !== 'plan') assert.equal(u[k], undefined, k);
  assert.ok(!JSON.stringify(c).includes('Caída'), 'ningún aviso');
  // El preventivo nuevo tiene datos propios
  const t = newTemplate({ nombre: 'Concierto tipo', contenido: c });
  const n = new Device({ pid: 'prev_2' }); const seed = seedFromTemplate(t);
  n.run(C.prevCreate, { datos: { nombre: 'Concierto 2', modalidad: 'independiente', activar: true }, ...seed });
  const u2 = unitByInd(n, 'SVB-1');
  assert.notEqual(u2.id, unitByInd(d, 'SVB-1').id); assert.equal(u2.clave, 'C0'); assert.equal(Object.keys(n.s.avisos).length, 0);
  assert.equal(n.s.prev.origen.tipo, 'plantilla'); assert.equal(n.s.prev.origen.revision, 1);
});

test('versiones: cambiar el contenido crea la versión siguiente y conserva la anterior; los preventivos ya creados no cambian', () => {
  const { d } = preventivo();
  const t1 = newTemplate({ nombre: 'Concierto tipo', contenido: contentFromPrev(d.s) });
  assert.equal(t1.revision, 1); assert.deepEqual(t1.revisiones, []);
  const n = new Device({ pid: 'prev_v1' }); n.run(C.prevCreate, { datos: { nombre: 'Con la v1', modalidad: 'independiente' }, ...seedFromTemplate(t1) });
  const antes = JSON.stringify(n.s.prev.cat);
  const t2 = structuredClone(t1); t2.contenido.cat.sectores.push({ id: 'sec_x', nombre: 'Escenario', color: '#000000' });
  assert.ok(cambioContenido(t1, t2)); assert.ok(!cambioContenido(t1, { ...structuredClone(t1), favorita: true }), 'marcar favorita no es otra versión');
  const v2 = versionarPlantilla(t1, t2, 'Rosa');
  assert.equal(v2.revision, 2); assert.equal(v2.revisiones.length, 1); assert.equal(v2.revisiones[0].revision, 1);
  assert.ok(!v2.revisiones[0].contenido.cat.sectores.some(x => x.id === 'sec_x'), 'la versión 1 se conserva tal cual');
  assert.equal(seedFromTemplate(v2).origen.revision, 2);
  assert.equal(JSON.stringify(n.s.prev.cat), antes, 'el preventivo creado con la v1 no cambia');
});

test('permiso para usar plantillas, comprobado también en el servidor', () => {
  assert.deepEqual(permisosOp({ k: 'prev.create', x: { prev: { origen: { tipo: 'plantilla', id: 'tpl_1' } } } }), ['preventivos.crear', 'plantillas.usar']);
  assert.deepEqual(permisosOp({ k: 'prev.create', x: { prev: {} } }), ['preventivos.crear']);
  assert.ok(permsOf(defaultRoles(), 'rol_coordinador').has('plantillas.usar'), 'quien crea preventivos puede usar plantillas');
  const sin = { id: 'u', nombre: 'Sin plantillas', perms: new Set(['preventivos.crear', 'preventivos.ver']) };
  const d = new Device({ pid: 'prev_p', user: sin });
  const { d: o } = preventivo(); const t = newTemplate({ nombre: 'T', contenido: contentFromPrev(o.s) });
  assert.throws(() => d.run(C.prevCreate, { datos: { nombre: 'X', modalidad: 'independiente' }, ...seedFromTemplate(t) }), /permiso/i);
});

test('excluir sectores o plano no deja referencias rotas (unidades sin sector inexistente; sin plano no hay posiciones, puntos ni delimitaciones)', () => {
  const { d } = preventivo();
  d.run(C.catUpdate, 'sectores', [...d.s.prev.cat.sectores, { id: 'sec_norte', nombre: 'Grada norte', color: '#123456', zona: { pts: [{ x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.3, y: 0.4 }] } }]);
  d.run(C.unitCreate, { ind: 'SVA-1', tipo: 'rt_sva', sector: 'sec_norte' });
  const sinSec = contentFromPrev(d.s, { sectores: false });
  assert.deepEqual(sinSec.cat.sectores.map(x => x.id).sort(), defaultCatalogs().sectores.map(x => x.id).sort());
  assert.equal(sinSec.unidades.find(u => u.ind === 'SVA-1').sector, undefined, 'la unidad no apunta a un sector que no existe');
  assert.equal(sinSec.unidades.find(u => u.ind === 'SVB-1').sector, 'sec_1', 'los sectores iniciales se conservan');
  const sinPlano = contentFromPrev(d.s, { plano: false });
  assert.deepEqual(sinPlano.cat.puntos, [], 'los puntos se sitúan en el plano');
  assert.equal(sinPlano.cat.sectores.find(x => x.id === 'sec_norte').zona, undefined, 'la delimitación depende del plano');
  assert.ok(sinPlano.unidades.every(u => !u.plan));
});

test('crear un preventivo eligiendo lo heredado: unidades y sectores previstos, y lo excluido sale de la configuración general', () => {
  const { d } = preventivo();
  d.run(C.catUpdate, 'sectores', [...d.s.prev.cat.sectores, { id: 'sec_norte', nombre: 'Grada norte', color: '#123456' }]);
  d.run(C.catUpdate, 'tiposRecurso', [...d.s.prev.cat.tiposRecurso, { id: 'rt_dron', nombre: 'Dron', color: '#000000', vis: {} }]);
  d.run(C.catUpdate, 'tiposAviso', d.s.prev.cat.tiposAviso.map((a, i) => (i === 0 ? { ...a, compatibles: ['rt_dron'] } : a)));
  d.run(C.unitCreate, { ind: 'SVA-1', tipo: 'rt_sva', sector: 'sec_norte' });
  d.run(C.unitCreate, { ind: 'VIR-1', tipo: 'rt_vir', sector: 'sec_2' });
  const t = newTemplate({ nombre: 'Concierto tipo', contenido: contentFromPrev(d.s) });
  const base = { cat: defaultCatalogs(), cfg: { descansoMin: 45 } };
  const seed = seedFromTemplate(t, { unidades: ['SVB-1', 'SVA-1'], sectores: ['sec_1', 'sec_2'], incluir: { puntos: false, parametros: false, tiposRecurso: false } }, base);
  assert.deepEqual(seed.unidades.map(u => u.ind).sort(), ['SVA-1', 'SVB-1'], 'solo las unidades elegidas');
  assert.deepEqual(seed.cat.sectores.map(x => x.id).sort(), ['sec_1', 'sec_2']);
  assert.equal(seed.unidades.find(u => u.ind === 'SVA-1').sector, undefined, 'sector no heredado: la unidad queda sin sector');
  assert.deepEqual(seed.cat.puntos, []);
  assert.equal(seed.cfg.descansoMin, 45, 'parámetros de la configuración general');
  assert.equal(seed.cfg.reglas.aviso_sin_unidad.nivel, 'alta', 'las reglas se heredan aparte de los parámetros');
  assert.ok(seed.cat.tiposRecurso.some(x => x.id === 'rt_dron'), 'se conserva el tipo al que apunta la compatibilidad de un tipo de aviso');
  assert.deepEqual(seed.origen.excluidos.sort(), ['parametros', 'puntos', 'tiposRecurso']);
  const n = new Device({ pid: 'prev_s' }); n.run(C.prevCreate, { datos: { nombre: 'Concierto 3', modalidad: 'independiente' }, ...seed });
  assert.equal(Object.values(n.s.units).length, 2);
  assert.deepEqual(seedFromTemplate(t).unidades.length, 3, 'sin opciones se hereda todo');
});

test('permisos separados para crear, modificar y utilizar plantillas; los perfiles anteriores conservan lo que podían hacer', async () => {
  const { PERMISOS, permisosEfectivos } = await import('../../src/core/perms.js');
  const claves = PERMISOS.map(p => p[0]);
  for (const k of ['plantillas.crear', 'plantillas.gestionar', 'plantillas.usar']) assert.ok(claves.includes(k), k);
  const roles = defaultRoles();
  assert.ok(permsOf(roles, 'rol_coordinador').has('plantillas.crear'));
  // Un perfil antiguo con «gestionar» sigue pudiendo crear; uno que solo crea no modifica
  const perfiles = [...roles, { id: 'p_ant', nombre: 'Antiguo', permisos: ['preventivos.ver', 'plantillas.gestionar'] }, { id: 'p_crea', nombre: 'Crea', permisos: ['preventivos.ver', 'plantillas.crear'] }];
  const antiguo = permisosEfectivos({ id: 'u1', perfil: 'p_ant' }, perfiles);
  assert.ok(antiguo.has('plantillas.crear'));
  const soloCrea = permisosEfectivos({ id: 'u2', perfil: 'p_crea' }, perfiles);
  assert.ok(soloCrea.has('plantillas.crear') && !soloCrea.has('plantillas.gestionar'));
});

test('cada preventivo identifica la plantilla y la versión con que se creó', () => {
  assert.equal(describirOrigen({ tipo: 'plantilla', nombre: 'Concierto tipo', revision: 3 }), 'Plantilla «Concierto tipo», versión 3');
  assert.match(describirOrigen({ tipo: 'plantilla', nombre: 'C', revision: 1, excluidos: ['plano', 'puntos'], unidadesOmitidas: 2 }), /sin heredar: plano y posiciones, puntos de interés y de apoyo.*2 unidades previstas sin incluir/i);
  assert.equal(describirOrigen({ tipo: 'plantilla', nombre: 'Antigua' }), 'Plantilla «Antigua»', 'preventivos anteriores a las versiones');
  assert.equal(describirOrigen({ tipo: 'duplicado', nombre: 'Concierto' }), 'Duplicado de «Concierto»');
  assert.equal(describirOrigen(null), 'Nuevo (configuración general)');
  assert.equal(describirOrigen({ tipo: 'nuevo' }), 'Nuevo (configuración general)');
});
