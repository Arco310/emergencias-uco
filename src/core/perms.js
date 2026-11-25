// Permisos, perfiles y alcance por preventivo. La app (capa de comandos) y el servidor usan estas mismas
// funciones: los permisos se comprueban en la lógica de negocio y en el servidor, no solo en la interfaz.
//
// · Perfiles: plantillas reutilizables (los «roles» de versiones anteriores). Cada usuario tiene un perfil
//   y, además, ajustes individuales (permisos añadidos y quitados) y, si se quiere, alcance limitado a
//   unos preventivos (con un perfil propio en cada uno).
// · Permisos efectivos = (perfil ∪ añadidos, con lo que incluyen) − quitados. Denegación por defecto.
import { AppError } from './util.js';

// [clave, etiqueta, módulo, 'ver' si es de consulta]
export const PERMISOS = [
  ['preventivos.ver', 'Consultar preventivos', 'Preventivos', 'ver'],
  ['preventivos.historico', 'Consultar preventivos finalizados y archivados', 'Preventivos', 'ver'],
  ['preventivos.crear', 'Crear y duplicar preventivos', 'Preventivos'],
  ['preventivos.editar', 'Modificar la configuración de los preventivos', 'Preventivos'],
  ['preventivos.iniciar', 'Iniciar (activar) preventivos', 'Preventivos'],
  ['preventivos.cerrar', 'Finalizar preventivos', 'Preventivos'],
  ['preventivos.archivar', 'Archivar y recuperar preventivos', 'Preventivos'],
  ['preventivos.reabrir', 'Reabrir preventivos finalizados', 'Preventivos'],
  ['plantillas.crear', 'Crear plantillas de preventivo (desde la configuración, un preventivo, duplicando o importando)', 'Preventivos'],
  ['plantillas.gestionar', 'Modificar, desactivar y eliminar plantillas de preventivo', 'Preventivos'],
  ['plantillas.usar', 'Crear preventivos a partir de plantillas', 'Preventivos'],
  ['unidades.ver', 'Consultar unidades', 'Unidades y recursos', 'ver'],
  ['unidades.crear', 'Crear unidades', 'Unidades y recursos'],
  ['unidades.editar', 'Modificar unidades y ponerlas fuera de servicio', 'Unidades y recursos'],
  ['unidades.archivar', 'Eliminar o archivar unidades', 'Unidades y recursos'],
  ['unidades.tipos', 'Cambiar el tipo de una unidad', 'Unidades y recursos'],
  ['unidades.colores', 'Modificar colores C0', 'Unidades y recursos'],
  ['ubicaciones.editar', 'Gestionar ubicaciones de las unidades', 'Unidades y recursos'],
  ['estados.cambiar', 'Cambiar claves', 'Unidades y recursos'],
  ['estados.forzar', 'Forzar transiciones de clave no permitidas', 'Unidades y recursos'],
  ['recursos.gestionar', 'Gestionar tipos de recurso, materiales y unidades plantilla', 'Unidades y recursos'],
  ['sectores.gestionar', 'Gestionar sectores', 'Unidades y recursos'],
  ['avisos.ver', 'Consultar avisos', 'Avisos', 'ver'],
  ['avisos.historico', 'Consultar avisos finalizados', 'Avisos', 'ver'],
  ['avisos.crear', 'Crear avisos', 'Avisos'],
  ['avisos.editar', 'Modificar avisos', 'Avisos'],
  ['avisos.asignar', 'Asignar y liberar unidades', 'Avisos'],
  ['avisos.finalizar', 'Finalizar y reabrir avisos', 'Avisos'],
  ['descansos.ver', 'Consultar descansos y su historial', 'Descansos', 'ver'],
  ['descansos.iniciar', 'Iniciar descansos', 'Descansos'],
  ['descansos.finalizar', 'Finalizar descansos', 'Descansos'],
  ['descansos.gestionar', 'Gestionar descansos (iniciar y finalizar)', 'Descansos'],
  ['descansos.duracion', 'Cambiar la duración del descanso', 'Descansos'],
  ['planos.ver', 'Consultar planos', 'Planos y mapas', 'ver'],
  ['planos.editar', 'Importar y modificar planos; colocar unidades y avisos', 'Planos y mapas'],
  ['planos.vista', 'Cambiar la visualización del mapa (satélite, híbrido, relieve)', 'Planos y mapas'],
  ['estadisticas.ver', 'Consultar estadísticas', 'Informes y datos', 'ver'],
  ['bitacora.ver', 'Consultar la bitácora', 'Informes y datos', 'ver'],
  ['informes.generar', 'Generar informes', 'Informes y datos'],
  ['exportar', 'Exportar información', 'Informes y datos'],
  ['importar', 'Importar información', 'Informes y datos'],
  ['notas.crear', 'Añadir observaciones e incidencias', 'Informes y datos'],
  ['auditoria.ver', 'Consultar la auditoría', 'Informes y datos', 'ver'],
  ['incoherencias.ver', 'Consultar las incoherencias detectadas', 'Control operativo', 'ver'],
  ['incoherencias.revisar', 'Revisar, asignar y resolver incoherencias', 'Control operativo'],
  ['incoherencias.reglas', 'Ajustar las reglas de incoherencias (niveles y umbrales)', 'Control operativo'],
  ['usuarios.admin', 'Administración completa de usuarios y perfiles', 'Administración'],
  ['usuarios.crear', 'Crear usuarios', 'Administración'],
  ['usuarios.editar', 'Modificar, suspender y desactivar usuarios', 'Administración'],
  ['usuarios.aprobar', 'Aprobar o rechazar registros', 'Administración'],
  ['usuarios.permisos', 'Asignar permisos y perfiles', 'Administración'],
  ['config.editar', 'Gestionar configuraciones generales y catálogos', 'Administración'],
  ['copias.gestionar', 'Copias de seguridad y restauración', 'Administración'],
  ['conflictos.resolver', 'Resolver conflictos de sincronización', 'Administración'],
  ['sync.gestionar', 'Gestionar la sincronización', 'Administración'],
  ['central.gestionar', 'Configurar el servidor central y dar de alta dispositivos', 'Administración'],
  ['actualizaciones.gestionar', 'Gestionar las actualizaciones del servidor central y de la aplicación', 'Administración'],
];
export const PERM_KEYS = PERMISOS.map(p => p[0]);
export const PERM_LABEL = Object.fromEntries(PERMISOS.map(p => [p[0], p[1]]));
export const PERMISOS_VER = PERMISOS.filter(p => p[3] === 'ver').map(p => p[0]);
/** Permisos que incluyen otros (así los roles anteriores conservan lo que ya podían hacer) */
export const IMPLICA = {
  'preventivos.editar': ['preventivos.iniciar', 'incoherencias.reglas'],
  'avisos.editar': ['incoherencias.revisar'],
  'preventivos.crear': ['plantillas.usar'],
  'plantillas.gestionar': ['plantillas.crear'],
  'incoherencias.revisar': ['incoherencias.ver'],
  'incoherencias.reglas': ['incoherencias.ver'],
  'preventivos.cerrar': ['preventivos.archivar'],
  'descansos.gestionar': ['descansos.iniciar', 'descansos.finalizar'],
  'planos.editar': ['planos.vista'],
  'config.editar': ['sectores.gestionar'],
  'exportar': ['informes.generar'],
  'usuarios.admin': ['usuarios.crear', 'usuarios.editar', 'usuarios.aprobar', 'usuarios.permisos', 'auditoria.ver'],
};
const VER = PERMISOS_VER.filter(k => k !== 'auditoria.ver');
const OPERADOR = [
  ...VER, 'unidades.crear', 'unidades.editar', 'ubicaciones.editar', 'estados.cambiar', 'avisos.crear', 'avisos.editar',
  'avisos.asignar', 'avisos.finalizar', 'descansos.gestionar', 'planos.editar', 'notas.crear', 'exportar', 'sync.gestionar',
];
const ADMIN_PREVENTIVO = [...OPERADOR, 'preventivos.editar', 'preventivos.cerrar', 'unidades.archivar', 'unidades.tipos', 'unidades.colores', 'sectores.gestionar', 'descansos.duracion', 'estados.forzar', 'conflictos.resolver'];
const COORDINADOR = [...ADMIN_PREVENTIVO, 'preventivos.crear', 'preventivos.reabrir', 'plantillas.gestionar', 'recursos.gestionar', 'config.editar', 'importar'];

/** Perfiles iniciales (plantillas configurables; el Administrador es del sistema y siempre lo tiene todo) */
export function defaultRoles() {
  return [
    { id: 'rol_admin', nombre: 'Administrador', sistema: true, v: 2, permisos: [...PERM_KEYS] },
    { id: 'rol_coordinador', nombre: 'Coordinador', v: 2, permisos: [...new Set(COORDINADOR)] },
    { id: 'rol_adminprev', nombre: 'Administrador de preventivo', v: 2, permisos: [...new Set(ADMIN_PREVENTIVO)] },
    { id: 'rol_operador', nombre: 'Operador', sistema: true, v: 2, permisos: [...new Set(OPERADOR)] },
    { id: 'rol_consulta', nombre: 'Consulta', sistema: true, v: 2, permisos: [...VER] },
  ];
}
/** Perfiles creados antes de la 1.4.0: la consulta no se pedía por separado, así que la conservan */
export function normalizarPerfil(p) {
  if (!p) return p;
  if (p.id === 'rol_admin' && p.sistema) return { ...p, permisos: [...new Set([...(p.permisos || []), ...PERM_KEYS])] };
  if ((p.v || 1) >= 2) return p;
  return { ...p, permisos: [...new Set([...(p.permisos || []), ...VER])] };
}
/** Añade los permisos incluidos, también en cadena (A incluye B y B incluye C) */
export function expandir(set) {
  const out = new Set(set); const pend = [...out];
  while (pend.length) for (const x of IMPLICA[pend.pop()] || []) if (!out.has(x)) { out.add(x); pend.push(x); }
  return out;
}

export function permsOf(roles, rolId) {
  const r = (roles || []).find(x => x.id === rolId);
  return expandir(r ? normalizarPerfil(r).permisos : []);
}

/** Estado de la cuenta (las cuentas anteriores solo tenían «activo») */
export const estadoUsuario = u => (u ? u.estado || (u.activo === false ? 'desactivado' : 'activo') : 'desactivado');
/** ¿Puede el usuario abrir este preventivo? (alcance) */
export function accesoPreventivo(u, pid) {
  const a = u && u.alcance;
  if (!a || a.tipo !== 'seleccion') return true;
  return Object.prototype.hasOwnProperty.call(a.preventivos || {}, pid);
}
/** Permisos efectivos de un usuario, en general (pid null) o dentro de un preventivo */
export function permisosEfectivos(u, perfiles, pid = null) {
  if (!u || estadoUsuario(u) !== 'activo') return new Set();
  let perfilId = u.perfil !== undefined ? u.perfil : u.rol;
  if (pid != null && u.alcance && u.alcance.tipo === 'seleccion') {
    if (!accesoPreventivo(u, pid)) return new Set();
    perfilId = u.alcance.preventivos[pid] || perfilId;
  }
  const p = (perfiles || []).find(x => x.id === perfilId);
  if (!p) return new Set();
  const out = expandir(new Set([...normalizarPerfil(p).permisos, ...((u.ajustes && u.ajustes.mas) || [])]));
  for (const k of (u.ajustes && u.ajustes.menos) || []) out.delete(k);
  for (const k of [...out]) if (!PERM_KEYS.includes(k)) out.delete(k);
  return out;
}

// ---------------- permiso que exige cada operación (comprobación del servidor) ----------------
const claveDe = (s, c) => ((s.prev && s.prev.cat && s.prev.cat.claves) || []).find(x => x.codigo === c);
/** Permisos que exige una operación (todos necesarios) o null si no se reconoce.
 *  «lote»: operaciones enviadas juntas (pasar a la clave base dentro de una asignación no es forzar). */
export function permisosOp(op, s, lote = []) {
  const x = op.x || {}; const f = x.f || {};
  switch (op.k) {
    case 'prev.create': return x.prev && x.prev.origen && x.prev.origen.tipo === 'plantilla' ? ['preventivos.crear', 'plantillas.usar'] : ['preventivos.crear'];
    case 'prev.update': {
      const campos = Object.keys(f);
      if (campos.length && campos.every(c => c === 'cfg.vistaMapa')) return ['planos.vista'];
      if (campos.length && campos.every(c => c === 'cfg.reglas')) return ['incoherencias.reglas'];
      return campos.some(c => c.startsWith('cfg.descanso')) ? ['preventivos.editar', 'descansos.duracion'] : ['preventivos.editar'];
    }
    case 'prev.estado':
      if (x.o === 'cerrado' && x.n === 'activo') return ['preventivos.reabrir'];
      if (x.n === 'cerrado') return ['preventivos.cerrar'];
      return ['preventivos.iniciar'];
    case 'prev.archivo': return ['preventivos.archivar'];
    case 'revision.set': return ['incoherencias.revisar'];
    case 'prev.cat': {
      // Tipo general que se incorpora al preventivo al usarlo en una unidad (mismo lote): es parte de esa operación
      if (x.cat === 'tiposRecurso' && Array.isArray(x.o) && Array.isArray(x.n) && x.n.length === x.o.length + 1 && x.o.every((t, i) => JSON.stringify(t) === JSON.stringify(x.n[i]))) {
        const nuevo = x.n[x.n.length - 1].id;
        const uso = lote.find(o => o.b === op.b && ((o.k === 'unit.create' && o.x && o.x.u && o.x.u.tipo === nuevo) || (o.k === 'unit.update' && o.x && o.x.f && o.x.f.tipo && o.x.f.tipo.n === nuevo)));
        if (uso) return [uso.k === 'unit.create' ? 'unidades.crear' : 'unidades.tipos'];
      }
      return [x.cat === 'sectores' ? 'sectores.gestionar' : x.cat === 'puntos' || x.cat === 'categoriasPunto' ? 'planos.editar' : 'config.editar'];
    }
    case 'prev.plano': return ['planos.editar'];
    case 'unit.create': return lote.some(o => o.k === 'prev.create' && o.b === op.b) ? ['preventivos.crear'] : ['unidades.crear'];
    case 'unit.update': return 'tipo' in f ? ['unidades.editar', 'unidades.tipos'] : ['unidades.editar'];
    case 'unit.clave': {
      const u = s && s.units && s.units[op.e]; const def = u && claveDe(s, u.clave);
      const permitido = def && (def.transiciones || []).includes(x.n);
      const base = (claveDe(s, x.n) || {}).base;
      const asignacion = base && lote.some(o => o.k === 'aviso.asig' && o.b === op.b && o.x && o.x.u === op.e);
      return permitido || asignacion || (u && u.clave === x.n) ? ['estados.cambiar'] : ['estados.cambiar', 'estados.forzar'];
    }
    case 'unit.color': return ['unidades.colores'];
    case 'unit.sit': {
      const u = s && s.units && s.units[op.e];
      return x.n === 'archivada' || x.o === 'archivada' || (u && u.sit === 'archivada') ? ['unidades.archivar'] : ['unidades.editar'];
    }
    case 'unit.delete': return ['unidades.archivar'];
    case 'unit.loc': return ['ubicaciones.editar'];
    case 'unit.plan': return ['planos.editar'];
    case 'unit.rest': {
      const def = (s && s.prev && s.prev.cfg && s.prev.cfg.descansoMin) || 30;
      return Number(x.dur) !== def ? ['descansos.iniciar', 'descansos.duracion'] : ['descansos.iniciar'];
    }
    case 'unit.restEnd': return ['descansos.finalizar'];
    case 'unit.nota': case 'aviso.nota': return ['notas.crear'];
    case 'aviso.create': return ['avisos.crear'];
    case 'aviso.update': return ['avisos.editar'];
    case 'aviso.plan': return ['planos.editar'];
    case 'aviso.asig': case 'aviso.lib': return ['avisos.asignar'];
    case 'aviso.estado': return x.n === 'finalizado' || x.o === 'finalizado' ? ['avisos.finalizar'] : ['avisos.asignar'];
    case 'conf.resolve': return ['conflictos.resolver'];
    default: return null;
  }
}

// ---------------- protecciones al cambiar usuarios y permisos ----------------
const esAdmin = (u, perfiles) => permisosEfectivos(u, perfiles).has('usuarios.admin');
const igual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Comprueba que «actor» puede dejar el usuario «antes» como «despues» (o crearlo si antes es null).
 *  Lanza un error explicativo si no. */
export function comprobarCambioUsuario({ actor, antes, despues, perfiles, usuarios }) {
  const pa = permisosEfectivos(actor, perfiles);
  const cambiaPermisos = !antes || ['perfil', 'ajustes', 'alcance', 'rol'].some(k => !igual(antes[k], despues[k]));
  const cambiaEstado = !!antes && estadoUsuario(antes) !== estadoUsuario(despues);
  if (antes && actor.id === antes.id && (cambiaPermisos || cambiaEstado)) throw new AppError('No puedes cambiar tus propios permisos ni el estado de tu cuenta: pídeselo a otro administrador', 'permiso');
  if (!antes && !pa.has('usuarios.crear')) throw new AppError('No tienes permiso para crear usuarios', 'permiso');
  if (cambiaEstado && !(pa.has('usuarios.editar') || (estadoUsuario(antes) === 'pendiente' && pa.has('usuarios.aprobar')))) throw new AppError('No tienes permiso para cambiar el estado de las cuentas', 'permiso');
  if (cambiaPermisos && (antes || despues.perfil) && !pa.has('usuarios.permisos')) throw new AppError('No tienes permiso para asignar permisos', 'permiso');
  if (((antes && esAdmin(antes, perfiles)) || esAdmin({ ...despues, estado: 'activo' }, perfiles)) && !pa.has('usuarios.admin'))
    throw new AppError('Solo un administrador puede modificar o crear cuentas de administrador', 'permiso');
  // No se concede lo que uno no tiene (en general ni en ningún preventivo)
  const ambitos = [null, ...Object.keys((despues.alcance && despues.alcance.preventivos) || {})];
  for (const pid of ambitos) {
    const nuevo = permisosEfectivos({ ...despues, estado: 'activo' }, perfiles, pid);
    const previo = antes ? permisosEfectivos({ ...antes, estado: 'activo' }, perfiles, pid) : new Set();
    const extra = [...nuevo].filter(k => !previo.has(k) && !pa.has(k));
    if (extra.length) throw new AppError('No tienes los permisos que intentas conceder: ' + extra.map(k => PERM_LABEL[k] || k).join(', '), 'permiso');
  }
  // Siempre queda al menos un administrador activo
  const quedan = (usuarios || []).map(u => (antes && u.id === antes.id ? despues : u)).filter(u => esAdmin(u, perfiles));
  if (antes && esAdmin(antes, perfiles) && !quedan.length) throw new AppError('Debe quedar al menos un administrador activo', 'permiso');
}

/** Lanza un error si el usuario no tiene el permiso */
export function require(user, perm) {
  if (!user || !user.perms || !user.perms.has(perm)) {
    throw new AppError('No tienes permiso para: ' + (PERM_LABEL[perm] || perm).toLowerCase() + '.', 'permiso');
  }
}
export function can(user, perm) { return !!(user && user.perms && user.perms.has(perm)); }
