// Catálogos y configuración por defecto. Todos son editables en la aplicación.
// Cada preventivo guarda su propia copia independiente al crearse.
import { clone } from './util.js';
import { tiposAvisoIncidentes } from './incidentes.js';

export const APP_NAME = 'Gestor de Emergencias UCO';
export const APP_VERSION = '1.3.0';
export const SCHEMA_VERSION = 1;

/**
 * Claves operativas. Campos:
 *  codigo, nombre, descripcion, color
 *  categoria: disponible | ocupada | no_disponible | fuera_servicio
 *  base: clave de disponibilidad (C0). Única que usa el color C0 personalizado.
 *  especial: se muestra en el grupo de claves especiales
 *  requiereAviso: solo puede estar en esta clave con un aviso activo
 *  liberaAviso: al entrar, la unidad queda liberada de su aviso
 *  alAsignar: clave que se aplica automáticamente al asignar la unidad a un aviso
 *  avisoEnCurso: al entrar, el aviso pasa a "En curso"
 *  llegada: marca la llegada al punto (tiempo de respuesta)
 *  requiereMotivo: obliga a indicar motivo (desplegable)
 *  transiciones: claves a las que se puede pasar desde esta
 */
export const DEFAULT_CLAVES = [
  { codigo: 'C0', nombre: 'Disponible', descripcion: 'Unidad operativa y libre, sin aviso asignado.', color: '#2E7D32', categoria: 'disponible', base: true, liberaAviso: true, transiciones: ['C1', 'C2', 'C3', 'C6', 'CESP'] },
  { codigo: 'C1', nombre: 'Alertado', descripcion: 'Unidad alertada para un aviso.', color: '#F9A825', categoria: 'ocupada', requiereAviso: true, alAsignar: true, transiciones: ['C0', 'C2', 'C3', 'C6', 'CESP'] },
  { codigo: 'C2', nombre: 'En ruta', descripcion: 'Unidad desplazándose hacia el punto del aviso.', color: '#EF6C00', categoria: 'ocupada', requiereAviso: true, avisoEnCurso: true, transiciones: ['C0', 'C3', 'C6', 'CESP'] },
  { codigo: 'C3', nombre: 'En el punto', descripcion: 'Unidad en el lugar del aviso.', color: '#C62828', categoria: 'ocupada', requiereAviso: true, avisoEnCurso: true, llegada: true, transiciones: ['C0', 'C4', 'C6', 'CESP'] },
  { codigo: 'C4', nombre: 'Traslado hospitalario', descripcion: 'Unidad trasladando a un paciente al hospital.', color: '#6A1B9A', categoria: 'ocupada', requiereAviso: true, avisoEnCurso: true, transiciones: ['C0', 'C5', 'C6', 'CESP'] },
  { codigo: 'C5', nombre: 'En hospital', descripcion: 'Unidad en el centro hospitalario.', color: '#1565C0', categoria: 'ocupada', requiereAviso: true, avisoEnCurso: true, transiciones: ['C0', 'C6', 'CESP'] },
  { codigo: 'C6', nombre: 'Inoperativo', descripcion: 'Unidad fuera de servicio.', color: '#37474F', categoria: 'fuera_servicio', especial: true, liberaAviso: true, transiciones: ['C0', 'CESP'] },
  { codigo: 'CESP', nombre: 'Clave especial', descripcion: 'Situación especial: se indica el motivo.', color: '#00838F', categoria: 'no_disponible', especial: true, liberaAviso: true, requiereMotivo: true, transiciones: ['C0', 'C6'] },
];

export const CATEGORIAS_CLAVE = {
  disponible: 'Disponible',
  ocupada: 'Ocupada',
  no_disponible: 'No disponible',
  fuera_servicio: 'Fuera de servicio',
};

export const DEFAULT_MOTIVOS_ESP = [
  'Repostaje', 'Limpieza / desinfección', 'Reposición de material', 'Avería', 'Relevo de personal',
  'Avituallamiento', 'Apoyo a otra unidad', 'Otro (especificar)',
];

export const ICONOS = {
  ambulancia: 'Ambulancia', coche: 'Vehículo ligero', mando: 'Mando / coordinación', camion: 'Camión / logística',
  furgoneta: 'Furgoneta', cruz: 'Sanitario', equipo: 'Equipo / personal', antena: 'Comunicaciones',
  tienda: 'Puesto / PSA', moto: 'Moto', bici: 'Bicicleta', pie: 'A pie', dron: 'Dron', barco: 'Embarcación',
  fuego: 'Incendios', escudo: 'Seguridad', bandera: 'Punto / base', ninguno: 'Sin icono',
};
export const FORMAS = { circulo: 'Círculo', cuadrado: 'Cuadrado', rombo: 'Rombo', triangulo: 'Triángulo', hexagono: 'Hexágono', escudo: 'Escudo' };
export const TAMANOS = { s: 'Pequeño', m: 'Mediano', l: 'Grande', xl: 'Muy grande' };
export const BORDES = { fino: 'Fino', normal: 'Normal', grueso: 'Grueso' };
export const ETIQUETAS = { indicativo: 'Indicativo', nombre: 'Nombre', ambos: 'Indicativo y nombre', ninguna: 'Sin etiqueta' };
export const TARJETAS = { compacta: 'Compacta', detallada: 'Detallada' };
export const CAMPOS_TARJETA = {
  tipo: 'Tipo de recurso', sector: 'Sector', clave: 'Clave', aviso: 'Aviso', ubicacion: 'Ubicación',
  descanso: 'Descanso', nombre: 'Nombre', denominacion: 'Denominación', equipamiento: 'Equipamiento', observaciones: 'Observaciones',
};

export const DEFAULT_VIS = {
  icono: 'ambulancia', forma: 'circulo', tam: 'm', borde: 'normal', etiqueta: 'indicativo', tarjeta: 'compacta',
  campos: ['tipo', 'sector', 'clave', 'aviso', 'ubicacion', 'descanso'], enPlano: true,
};

export const DEFAULT_TIPOS_RECURSO = [
  { id: 'rt_svb', nombre: 'Ambulancia SVB', categoria: 'Sanitario', subtipos: ['SVB', 'Colectiva'], caracteristicas: ['Camilla', 'DEA', 'Oxígeno'], color: '#2E7D32', vis: { icono: 'ambulancia', forma: 'circulo', tam: 'm' } },
  { id: 'rt_sva', nombre: 'Ambulancia SVA', categoria: 'Sanitario', subtipos: ['SVA', 'SVAE'], caracteristicas: ['Médico', 'Enfermería', 'DEA', 'Oxígeno'], color: '#1B5E20', vis: { icono: 'ambulancia', forma: 'hexagono', tam: 'm' } },
  { id: 'rt_vir', nombre: 'Vehículo de intervención rápida', categoria: 'Sanitario', subtipos: [], caracteristicas: ['DEA'], color: '#00897B', vis: { icono: 'coche', forma: 'circulo', tam: 'm' } },
  { id: 'rt_coord', nombre: 'Vehículo de coordinación', categoria: 'Mando', subtipos: [], caracteristicas: ['Radio'], color: '#283593', vis: { icono: 'mando', forma: 'rombo', tam: 'm' } },
  { id: 'rt_log', nombre: 'Vehículo logístico', categoria: 'Logística', subtipos: [], caracteristicas: [], color: '#5D4037', vis: { icono: 'camion', forma: 'cuadrado', tam: 'm' } },
  { id: 'rt_transp', nombre: 'Unidad de transporte', categoria: 'Logística', subtipos: [], caracteristicas: [], color: '#6D4C41', vis: { icono: 'furgoneta', forma: 'cuadrado', tam: 'm' } },
  { id: 'rt_eqsan', nombre: 'Equipo sanitario', categoria: 'Sanitario', subtipos: ['A pie', 'En bicicleta'], caracteristicas: ['Mochila SVB', 'DEA'], color: '#43A047', vis: { icono: 'cruz', forma: 'circulo', tam: 's' } },
  { id: 'rt_eqint', nombre: 'Equipo de intervención', categoria: 'Intervención', subtipos: [], caracteristicas: [], color: '#E65100', vis: { icono: 'equipo', forma: 'triangulo', tam: 'm' } },
  { id: 'rt_com', nombre: 'Unidad de comunicaciones', categoria: 'Comunicaciones', subtipos: [], caracteristicas: ['Repetidor'], color: '#455A64', vis: { icono: 'antena', forma: 'escudo', tam: 'm' } },
  { id: 'rt_psa', nombre: 'Puesto sanitario (PSA)', categoria: 'Sanitario', subtipos: [], caracteristicas: ['Camillas'], color: '#AD1457', vis: { icono: 'tienda', forma: 'cuadrado', tam: 'l' } },
  { id: 'rt_vl', nombre: 'Vehículo ligero', categoria: 'Apoyo', subtipos: [], caracteristicas: [], color: '#1565C0', vis: { icono: 'coche', forma: 'triangulo', tam: 'm' } },
];

/** Tipos de unidad de SAMUR-Protección Civil, cada uno con su unidad plantilla (indicativo + número: «ALFA 31») */
const SAMUR = [
  // [prefijo, nombre, categoría, color, icono, forma, tamaño, subtipos]
  ['BASE', 'Base de unidades', 'Base', '#546E7A', 'bandera', 'cuadrado', 'l'],
  ['SAMUR', 'USVA / Directivo de Guardia', 'Sanitario', '#1B5E20', 'ambulancia', 'hexagono', 'm', ['USVA', 'Directivo de Guardia']],
  ['VIR', 'Vehículo de intervención rápida', 'Sanitario', '#004D40', 'coche', 'circulo', 'm'],
  ['ALFA', 'USVB', 'Sanitario', '#2E7D32', 'ambulancia', 'circulo', 'm', ['USVB']],
  ['PAPA', 'Unidad de psiquiatría', 'Sanitario', '#880E4F', 'ambulancia', 'rombo', 'm'],
  ['TANGO', 'Vehículo de transporte', 'Logística', '#6D4C41', 'furgoneta', 'cuadrado', 'm'],
  ['MIKE', 'Coche de mando', 'Mando', '#283593', 'mando', 'rombo', 'm'],
  ['ECO', 'Equipo sanitario a pie', 'Sanitario', '#43A047', 'pie', 'circulo', 's'],
  ['LINCE', 'Equipo sanitario en bicicleta', 'Sanitario', '#7CB342', 'bici', 'circulo', 's'],
  ['HALCÓN', 'Equipo sanitario en moto', 'Sanitario', '#558B2F', 'moto', 'triangulo', 's'],
  ['URO', 'Personal y vehículo de mantenimiento', 'Logística', '#8D6E63', 'furgoneta', 'cuadrado', 'm'],
  ['ZULÚ', 'Personal conductor de vehículos pesados de la columna sanitaria', 'Logística', '#4E342E', 'camion', 'cuadrado', 'm'],
  ['VRALA', 'Vehículo rápido de apoyo logístico y avituallamiento', 'Logística', '#827717', 'furgoneta', 'triangulo', 'm'],
  ['PM', 'Puesto de Mando', 'Mando', '#1A237E', 'mando', 'escudo', 'l'],
  ['PMA', 'Puesto Médico Avanzado', 'Sanitario', '#AD1457', 'tienda', 'cuadrado', 'l'],
  ['VAIS', 'Vehículo de Apoyo Intervención Sanitaria', 'Sanitario', '#00695C', 'camion', 'cuadrado', 'm'],
];
const idSamur = pref => pref.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
export const TIPOS_RECURSO_SAMUR = SAMUR.map(([pref, nombre, categoria, color, icono, forma, tam, subtipos = []]) => (
  { id: 'rt_sp_' + idSamur(pref), nombre: pref + ' · ' + nombre, categoria, subtipos, caracteristicas: [], color, vis: { icono, forma, tam } }));
export const PLANTILLAS_SAMUR = SAMUR.map(([pref, nombre, , color, icono, forma, tam]) => (
  { id: 'plt_sp_' + idSamur(pref), nombre: pref + ' · ' + nombre, activo: true, tipo: 'rt_sp_' + idSamur(pref), prefijo: pref, color, vis: { forma, icono, tam }, campos: [], obligatorios: [], valores: { subtipo: '', caract: [] } }));
DEFAULT_TIPOS_RECURSO.push(...TIPOS_RECURSO_SAMUR);

/** Campos que una unidad plantilla puede pedir al crear la unidad (el número se pide siempre) */
export const CAMPOS_PLANTILLA = { nombre: 'Nombre', denom: 'Denominación', subtipo: 'Subtipo', sector: 'Sector o ubicación', caract: 'Características', obs: 'Observaciones' };

/** Unidades plantilla de ejemplo: datos editables desde Configuración → Unidades plantilla */
export const DEFAULT_PLANTILLAS_UNIDAD = [
  { id: 'plt_upr', nombre: 'UPR', activo: true, tipo: 'rt_vl', prefijo: 'UPR', color: '#1565C0', vis: { forma: 'triangulo', icono: 'coche' }, campos: [], obligatorios: [], valores: { subtipo: '', caract: [] } },
  { id: 'plt_svb', nombre: 'Soporte Vital Básico (SVB)', activo: true, tipo: 'rt_svb', prefijo: 'SVB', color: '#2E7D32', vis: { forma: 'circulo', icono: 'ambulancia' }, campos: [], obligatorios: [], valores: { subtipo: 'SVB', caract: ['Camilla', 'DEA', 'Oxígeno'] } },
  { id: 'plt_vires', nombre: 'VIRES', activo: true, tipo: 'rt_vir', prefijo: 'VIRES', color: '#00897B', vis: { forma: 'circulo', icono: 'coche' }, campos: [], obligatorios: [], valores: { subtipo: '', caract: ['DEA'] } },
  ...PLANTILLAS_SAMUR,
];

export const DEFAULT_SECTORES = [
  { id: 'sec_1', nombre: 'Sector 1', color: '#1E88E5' },
  { id: 'sec_2', nombre: 'Sector 2', color: '#8E24AA' },
  { id: 'sec_3', nombre: 'Sector 3', color: '#F4511E' },
  { id: 'sec_base', nombre: 'Base / PMA', color: '#546E7A' },
];

/** Tipos de aviso: los códigos de incidente (con número y carpeta) y, en «Otros tipos», los generales */
export const DEFAULT_TIPOS_AVISO = [
  ...tiposAvisoIncidentes(),
  { id: 'ta_san', nombre: 'Asistencia sanitaria', color: '#C62828', compatibles: [] },
  { id: 'ta_tras', nombre: 'Traslado', color: '#6A1B9A', compatibles: ['rt_svb', 'rt_sva', 'rt_transp'] },
  { id: 'ta_acc', nombre: 'Accidente', color: '#EF6C00', compatibles: [] },
  { id: 'ta_inc', nombre: 'Incendio', color: '#D84315', compatibles: [] },
  { id: 'ta_desap', nombre: 'Persona desaparecida', color: '#00838F', compatibles: [] },
  { id: 'ta_seg', nombre: 'Seguridad', color: '#283593', compatibles: [] },
  { id: 'ta_log', nombre: 'Logística', color: '#5D4037', compatibles: [] },
  { id: 'ta_otro', nombre: 'Otro', color: '#546E7A', compatibles: [] },
];

export const KPIS = {
  total: 'Total de unidades', disponibles: 'Disponibles', ocupadas: 'Ocupadas', descanso: 'En descanso',
  especial: 'Clave especial', fuera: 'Fuera de servicio', pendientes: 'Avisos pendientes', activos: 'Avisos activos',
  finalizados: 'Avisos finalizados', sectores: 'Recursos por sector',
};

/** Configuración propia de cada preventivo (se copia desde la global o la plantilla) */
export const DEFAULT_PREV_CFG = {
  descansoMin: 30,
  autoFinalizarAviso: false,
  camposTarjeta: [...DEFAULT_VIS.campos],
  kpis: ['total', 'disponibles', 'ocupadas', 'descanso', 'especial', 'fuera', 'pendientes', 'activos', 'finalizados', 'sectores'],
  avisoCompatibilidadEstricta: false,
};

export function defaultCatalogs() {
  return clone({
    claves: DEFAULT_CLAVES, motivosEsp: DEFAULT_MOTIVOS_ESP, sectores: DEFAULT_SECTORES,
    tiposAviso: DEFAULT_TIPOS_AVISO, tiposRecurso: DEFAULT_TIPOS_RECURSO,
  });
}

/** Configuración global del dispositivo */
export function defaultGlobalConfig() {
  return {
    tema: 'sistema',
    densidad: 'normal',
    bloqueoMin: 30,
    syncServidor: '',
    syncIntervaloSeg: 5,
    copiaAutoMin: 10,
    copiasAutoMax: 20,
    catalogos: defaultCatalogs(),
    plantillasUnidad: clone(DEFAULT_PLANTILLAS_UNIDAD),
    prev: clone(DEFAULT_PREV_CFG),
  };
}
