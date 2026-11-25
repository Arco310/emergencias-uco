// 1.4.0 · §7: permisos granulares por usuario, perfiles reutilizables, alcance por preventivo y protecciones.
import test from 'node:test';
import assert from 'node:assert/strict';
import { PERMISOS, PERM_KEYS, IMPLICA, defaultRoles, permsOf, permisosEfectivos, permisosOp, comprobarCambioUsuario, normalizarPerfil, accesoPreventivo } from '../../src/core/perms.js';

const perfiles = defaultRoles();
const U = (extra = {}) => ({ id: 'u1', usuario: 'ana', estado: 'activo', perfil: 'rol_operador', ...extra });

test('catálogo agrupado por módulos, con consulta y modificación', () => {
  const mods = [...new Set(PERMISOS.map(p => p[2]))];
  assert.deepEqual(mods, ['Preventivos', 'Unidades y recursos', 'Avisos', 'Descansos', 'Planos y mapas', 'Informes y datos', 'Control operativo', 'Administración']);
  for (const k of ['preventivos.ver', 'preventivos.iniciar', 'preventivos.archivar', 'preventivos.historico', 'unidades.ver', 'sectores.gestionar', 'avisos.ver', 'avisos.historico', 'descansos.ver', 'descansos.iniciar', 'descansos.finalizar', 'planos.ver', 'planos.vista', 'informes.generar', 'importar', 'bitacora.ver', 'auditoria.ver', 'usuarios.crear', 'usuarios.editar', 'usuarios.aprobar', 'usuarios.permisos'])
    assert.ok(PERM_KEYS.includes(k), k);
  assert.equal(new Set(PERM_KEYS).size, PERM_KEYS.length, 'sin claves repetidas');
  for (const [k, v] of Object.entries(IMPLICA)) for (const x of [k, ...v]) assert.ok(PERM_KEYS.includes(x), x);
  assert.ok(PERMISOS.filter(p => p[3] === 'ver').length >= 8, 'permisos de consulta diferenciados');
});

test('perfiles: plantillas configurables; los antiguos conservan la consulta y lo que incluían', () => {
  assert.deepEqual(defaultRoles().map(r => r.id), ['rol_admin', 'rol_coordinador', 'rol_adminprev', 'rol_operador', 'rol_consulta']);
  const antiguo = { id: 'rol_x', nombre: 'Personal 1.3', permisos: ['descansos.gestionar', 'planos.editar'] };
  const n = normalizarPerfil(antiguo);
  for (const k of ['unidades.ver', 'avisos.ver', 'planos.ver', 'preventivos.ver']) assert.ok(n.permisos.includes(k), k);
  const ef = permisosEfectivos(U({ perfil: 'rol_x' }), [antiguo]);
  for (const k of ['descansos.iniciar', 'descansos.finalizar', 'planos.vista']) assert.ok(ef.has(k), 'incluido: ' + k);
  // permsOf sigue funcionando para el código existente
  assert.ok(permsOf(perfiles, 'rol_operador').has('avisos.crear'));
});

test('permisos efectivos: perfil + ajustes individuales; estados sin acceso', () => {
  let ef = permisosEfectivos(U(), perfiles);
  assert.ok(ef.has('avisos.crear') && !ef.has('usuarios.admin'));
  ef = permisosEfectivos(U({ ajustes: { mas: ['unidades.colores'], menos: ['avisos.crear', 'descansos.finalizar'] } }), perfiles);
  assert.ok(ef.has('unidades.colores')); assert.ok(!ef.has('avisos.crear'));
  assert.ok(ef.has('descansos.iniciar') && !ef.has('descansos.finalizar'), 'se puede quitar un permiso incluido');
  for (const estado of ['pendiente', 'suspendido', 'desactivado', 'invitado', 'rechazado']) assert.equal(permisosEfectivos(U({ estado }), perfiles).size, 0, estado);
  assert.equal(permisosEfectivos(U({ perfil: null }), perfiles).size, 0, 'sin perfil: sin permisos');
  assert.equal(permisosEfectivos(U({ perfil: 'no_existe' }), perfiles).size, 0, 'denegación por defecto');
});

test('alcance por preventivo: acceso solo a los elegidos y perfil propio en cada uno', () => {
  const u = U({ perfil: 'rol_consulta', alcance: { tipo: 'seleccion', preventivos: { p1: 'rol_adminprev', p2: null } } });
  assert.ok(accesoPreventivo(u, 'p1') && accesoPreventivo(u, 'p2') && !accesoPreventivo(u, 'p3'));
  assert.ok(permisosEfectivos(u, perfiles, 'p1').has('preventivos.editar'), 'administrador en p1');
  assert.ok(!permisosEfectivos(u, perfiles, 'p2').has('avisos.crear'), 'consulta en p2');
  assert.equal(permisosEfectivos(u, perfiles, 'p3').size, 0, 'nada en p3');
  assert.ok(accesoPreventivo(U(), 'cualquiera'), 'alcance por defecto: todos');
});

test('permiso que exige cada operación (lo mismo que comprueba la app)', () => {
  const st = { prev: { cfg: { descansoMin: 30 }, cat: { claves: [{ codigo: 'C0', base: true, transiciones: ['C1'] }, { codigo: 'C1', transiciones: ['C0'] }, { codigo: 'C9', transiciones: [] }] } }, units: { u1: { id: 'u1', clave: 'C0', sit: 'activa' }, u2: { id: 'u2', clave: 'C0', sit: 'archivada' } }, avisos: {} };
  const P = (k, x = {}, e = 'u1') => permisosOp({ k, x, e }, st);
  assert.deepEqual(P('unit.create'), ['unidades.crear']);
  assert.deepEqual(P('unit.update', { f: { nombre: { o: 'a', n: 'b' } } }), ['unidades.editar']);
  assert.deepEqual(P('unit.update', { f: { tipo: { o: 'a', n: 'b' } } }), ['unidades.editar', 'unidades.tipos']);
  assert.deepEqual(P('unit.clave', { o: 'C0', n: 'C1' }), ['estados.cambiar']);
  assert.deepEqual(P('unit.clave', { o: 'C0', n: 'C9' }), ['estados.cambiar', 'estados.forzar'], 'transición no permitida');
  assert.deepEqual(P('unit.sit', { o: 'activa', n: 'desactivada' }), ['unidades.editar']);
  assert.deepEqual(P('unit.sit', { o: 'activa', n: 'archivada' }), ['unidades.archivar']);
  assert.deepEqual(P('unit.sit', { o: 'archivada', n: 'activa' }, 'u2'), ['unidades.archivar']);
  assert.deepEqual(P('unit.rest', { dur: 30 }), ['descansos.iniciar']);
  assert.deepEqual(P('unit.rest', { dur: 45 }), ['descansos.iniciar', 'descansos.duracion']);
  assert.deepEqual(P('unit.restEnd', {}), ['descansos.finalizar']);
  assert.deepEqual(P('prev.estado', { o: 'preparacion', n: 'activo' }), ['preventivos.iniciar']);
  assert.deepEqual(P('prev.estado', { o: 'activo', n: 'cerrado' }), ['preventivos.cerrar']);
  assert.deepEqual(P('prev.estado', { o: 'cerrado', n: 'activo' }), ['preventivos.reabrir']);
  assert.deepEqual(P('prev.archivo', { n: true }), ['preventivos.archivar']);
  assert.deepEqual(P('prev.cat', { cat: 'sectores' }), ['sectores.gestionar']);
  assert.deepEqual(P('prev.cat', { cat: 'claves' }), ['config.editar']);
  assert.deepEqual(P('prev.update', { f: { 'cfg.vistaMapa': { o: null, n: 'satelite' } } }), ['planos.vista']);
  assert.deepEqual(P('prev.update', { f: { 'cfg.descansoMin': { o: 30, n: 20 } } }), ['preventivos.editar', 'descansos.duracion']);
  assert.deepEqual(P('aviso.estado', { o: 'pendiente', n: 'finalizado' }), ['avisos.finalizar']);
  assert.deepEqual(P('aviso.estado', { o: 'finalizado', n: 'pendiente' }), ['avisos.finalizar']);
  assert.deepEqual(P('aviso.estado', { o: 'pendiente', n: 'en_curso' }), ['avisos.asignar']);
  assert.deepEqual(P('aviso.create', { a: { tipo: 'ta_1' } }), ['avisos.crear']);
  assert.deepEqual(P('aviso.asig', { u: 'u1' }), ['avisos.asignar']);
  // Pasar a la clave base para asignar (forma parte de la asignación) no exige forzar
  const lote = [{ k: 'unit.clave', e: 'u1', b: 'b1', x: { o: 'C1', n: 'C0' } }, { k: 'aviso.asig', e: 'a1', b: 'b1', x: { u: 'u1' } }];
  st.units.u1.clave = 'C1'; st.prev.cat.claves[1].transiciones = [];
  assert.deepEqual(permisosOp(lote[0], st, lote), ['estados.cambiar']);
  assert.deepEqual(permisosOp(lote[0], st, []), ['estados.cambiar', 'estados.forzar']);
  assert.deepEqual(P('conf.resolve', {}), ['conflictos.resolver']);
  // Incorporar un tipo general al preventivo al crear (o cambiar de tipo) una unidad: basta con ese permiso
  const o = [{ id: 'rt_a' }]; const n = [{ id: 'rt_a' }, { id: 'rt_dron' }];
  const inc = [{ k: 'prev.cat', b: 'b7', x: { cat: 'tiposRecurso', o, n } }, { k: 'unit.create', b: 'b7', e: 'u9', x: { u: { tipo: 'rt_dron' } } }];
  assert.deepEqual(permisosOp(inc[0], st, inc), ['unidades.crear']);
  const inc2 = [inc[0], { k: 'unit.update', b: 'b7', e: 'u1', x: { f: { tipo: { o: 'rt_a', n: 'rt_dron' } } } }];
  assert.deepEqual(permisosOp(inc2[0], st, inc2), ['unidades.tipos']);
  assert.deepEqual(permisosOp(inc[0], st, [inc[0]]), ['config.editar'], 'sola, es un cambio de catálogo');
  // Unidades copiadas al crear un preventivo (plantilla o duplicado)
  const nuevo = [{ k: 'prev.create', b: 'b8', x: {} }, { k: 'unit.create', b: 'b8', e: 'u5', x: { u: { tipo: 'rt_a' } } }];
  assert.deepEqual(permisosOp(nuevo[1], st, nuevo), ['preventivos.crear']);
  assert.equal(P('desconocida'), null, 'operación desconocida: se rechaza');
});

test('protecciones: nadie cambia sus propios permisos ni concede lo que no tiene; siempre queda un administrador', () => {
  const admin = { id: 'a1', usuario: 'jefa', estado: 'activo', perfil: 'rol_admin' };
  const coord = { id: 'c1', usuario: 'coord', estado: 'activo', perfil: 'rol_coordinador', ajustes: { mas: ['usuarios.permisos', 'usuarios.editar'] } };
  const oper = U();
  const usuarios = [admin, coord, oper];
  const ok = (actor, antes, despues) => comprobarCambioUsuario({ actor, antes, despues, perfiles, usuarios });
  assert.throws(() => ok(oper, oper, { ...oper, perfil: 'rol_admin' }), /permiso/i, 'un operador no asigna permisos');
  assert.throws(() => ok(coord, coord, { ...coord, ajustes: { mas: ['usuarios.admin'] } }), /propios/i);
  assert.throws(() => ok(admin, admin, { ...admin, perfil: 'rol_operador' }), /propios/i);
  assert.throws(() => ok(coord, oper, { ...oper, perfil: 'rol_admin' }), /administrador/i, 'no hace administrador a nadie');
  assert.throws(() => ok(coord, oper, { ...oper, ajustes: { mas: ['copias.gestionar'] } }), /no tienes los permisos/i, 'no concede lo que no tiene');
  assert.throws(() => ok(coord, admin, { ...admin, estado: 'suspendido' }), /administrador/i, 'solo un administrador modifica a otro');
  ok(coord, oper, { ...oper, ajustes: { mas: ['unidades.colores'] } });
  ok(admin, coord, { ...coord, perfil: 'rol_admin' });
  const solo = [admin, oper];
  assert.throws(() => comprobarCambioUsuario({ actor: { ...admin, id: 'otro', perfil: 'rol_admin' }, antes: admin, despues: { ...admin, estado: 'desactivado' }, perfiles, usuarios: solo }), /al menos un administrador/i);
});
