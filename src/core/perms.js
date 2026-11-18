// Matriz de permisos y roles. Los permisos se comprueban en la capa de comandos
// (lógica de negocio), no solo en la interfaz.
import { AppError } from './util.js';

export const PERMISOS = [
  ['preventivos.crear', 'Crear y duplicar preventivos', 'Preventivos'],
  ['preventivos.editar', 'Editar y activar preventivos', 'Preventivos'],
  ['preventivos.cerrar', 'Cerrar y archivar preventivos', 'Preventivos'],
  ['preventivos.reabrir', 'Reabrir preventivos cerrados', 'Preventivos'],
  ['plantillas.gestionar', 'Gestionar plantillas', 'Preventivos'],
  ['config.editar', 'Editar configuración y catálogos', 'Configuración'],
  ['unidades.crear', 'Crear unidades', 'Unidades'],
  ['unidades.editar', 'Editar y desactivar unidades', 'Unidades'],
  ['unidades.archivar', 'Eliminar o archivar unidades', 'Unidades'],
  ['unidades.tipos', 'Cambiar tipos de unidad', 'Unidades'],
  ['unidades.colores', 'Modificar colores C0', 'Unidades'],
  ['ubicaciones.editar', 'Actualizar ubicaciones', 'Unidades'],
  ['estados.cambiar', 'Cambiar claves', 'Claves'],
  ['estados.forzar', 'Forzar transiciones no permitidas', 'Claves'],
  ['avisos.crear', 'Crear avisos', 'Avisos'],
  ['avisos.editar', 'Editar avisos', 'Avisos'],
  ['avisos.asignar', 'Asignar y liberar unidades', 'Avisos'],
  ['avisos.finalizar', 'Finalizar y reabrir avisos', 'Avisos'],
  ['descansos.gestionar', 'Gestionar descansos', 'Descansos'],
  ['descansos.duracion', 'Cambiar duración del descanso', 'Descansos'],
  ['planos.editar', 'Editar planos y posiciones', 'Planos'],
  ['notas.crear', 'Añadir observaciones e incidencias', 'Bitácora'],
  ['estadisticas.ver', 'Consultar estadísticas', 'Informes'],
  ['exportar', 'Exportar datos e informes', 'Informes'],
  ['conflictos.resolver', 'Resolver conflictos de sincronización', 'Sincronización'],
  ['sync.gestionar', 'Gestionar sincronización', 'Sincronización'],
  ['copias.gestionar', 'Copias de seguridad y restauración', 'Sistema'],
  ['usuarios.admin', 'Administrar usuarios y roles', 'Sistema'],
  ['central.gestionar', 'Configurar el servidor central y dar de alta dispositivos', 'Sistema'],
];
export const PERM_KEYS = PERMISOS.map(p => p[0]);
export const PERM_LABEL = Object.fromEntries(PERMISOS.map(p => [p[0], p[1]]));

const OPERADOR = [
  'unidades.crear', 'unidades.editar', 'ubicaciones.editar', 'estados.cambiar', 'avisos.crear', 'avisos.editar',
  'avisos.asignar', 'avisos.finalizar', 'descansos.gestionar', 'planos.editar', 'notas.crear', 'estadisticas.ver',
  'exportar', 'sync.gestionar',
];

export function defaultRoles() {
  return [
    { id: 'rol_admin', nombre: 'Administrador', sistema: true, permisos: [...PERM_KEYS] },
    { id: 'rol_operador', nombre: 'Operador', sistema: true, permisos: [...OPERADOR] },
    { id: 'rol_consulta', nombre: 'Consulta', sistema: true, permisos: ['estadisticas.ver'] },
  ];
}

export function permsOf(roles, rolId) {
  const r = (roles || []).find(x => x.id === rolId);
  return new Set(r ? r.permisos : []);
}

/** Lanza un error si el usuario no tiene el permiso */
export function require(user, perm) {
  if (!user || !user.perms || !user.perms.has(perm)) {
    throw new AppError('No tienes permiso para: ' + (PERM_LABEL[perm] || perm).toLowerCase() + '.', 'permiso');
  }
}
export function can(user, perm) { return !!(user && user.perms && user.perms.has(perm)); }
