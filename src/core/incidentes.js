// Códigos de incidente (tipos de aviso con número) organizados en carpetas.
// Catálogo por defecto: códigos de incidentes de SAMUR-Protección Civil. Se guardan como tipos de aviso
// normales (catálogo «tiposAviso», editable en la configuración general, en cada preventivo y en las
// plantillas) con tres datos más:
//   codigo  número del incidente (1.2, 1.6.1, 9, AS-2.1…)
//   grupo   carpeta en la que aparece al crear un aviso («1. Accidente de Tráfico»…)
//   padre   código del que cuelga un código de cierre (AS-1.1 → 8.12); opcional
// Los avisos guardan el identificador del tipo (inc_1_2…), estable entre dispositivos y versiones.
import { clone } from './util.js';

const G = (codigo, nombre, color, items) => ({ codigo, nombre, color, items });
/** Grupos y códigos, tal como los fija la jefatura de SAMUR-Protección Civil */
export const GRUPOS_INCIDENTE = [
  G('1', 'Accidente de Tráfico', '#EF6C00', [
    ['1.1', 'Accidente sin especificar'], ['1.2', 'Accidente con menos de 3 víctimas'], ['1.3', 'Accidente con tres o más víctimas confirmadas'],
    ['1.4', 'Atropello'], ['1.5', 'Accidente de motocicleta'], ['1.6', 'Accidente de bicicleta'], ['1.6.1', 'Accidente de patinete'],
    ['1.7', 'Accidente de autobús'], ['1.8', 'Accidente con vehículo pesado'],
  ]),
  G('2', 'Accidente no de tráfico', '#D84315', [
    ['2.1', 'Heridas'], ['2.2', 'Atrapamientos / enterramientos'], ['2.3', 'Casual: caída, etc.'], ['2.4', 'Agresión sin especificar'],
    ['2.4.1', 'Agresión por spray de autodefensa'], ['2.5', 'Arma blanca'], ['2.6', 'Arma de fuego'], ['2.7', 'Precipitado'],
    ['2.8', 'Autolisis traumática'], ['2.9', 'Arrollamiento por metro o tren'], ['2.10', 'Quemado'], ['2.11', 'Electrocución'],
    ['2.12', 'Ahogamiento'], ['2.12.1', 'OVACE'], ['2.13', 'Agresión sexual'], ['2.13.1', 'Agresión sexual facilitada por drogas'],
    ['2.14', 'Dispositivos eléctricos de control policial'],
  ]),
  G('3', 'Enfermedad', '#C62828', [
    ['3.1', 'Parada cardiorrespiratoria'], ['3.2', 'Inconsciente sin filiar causa'], ['3.3', 'Infarto o Patología coronaria'], ['3.4', 'Convulsión'],
    ['3.5', 'Intoxicación por drogas de abuso'], ['3.6', 'Intoxicación por fármacos y/o productos tóxicos'], ['3.7', 'Autolisis no traumática'],
    ['3.8', 'Urgencias endocrino-metabólicas'], ['3.9', 'Intoxicación etílica'], ['3.10', 'Otros'], ['3.11', 'Patología respiratoria'],
    ['3.12', 'Patología cardiovascular'], ['3.13', 'Patología neurológica'], ['3.14', 'Patología digestiva'], ['3.15', 'Patología obstétrica'],
    ['3.16', 'Patología ginecológica'], ['3.17', 'Patología urológica'], ['3.18', 'Patología infecciosa'], ['3.19', 'Patología psicosomática'],
    ['3.20', 'Patología anafiláctica'], ['3.21', 'Patologías por agentes físicos (Frío/Calor)'],
  ]),
  G('4', 'Específica de bomberos o colectivos', '#795548', [
    ['4.1', 'Incendio'], ['4.2', 'Explosión'], ['4.3', 'Apertura de puerta'], ['4.4', 'Derrumbamientos'], ['4.5', 'Servicios especiales'],
    ['4.6', 'Preventivos'], ['4.7', 'Riesgo químico'], ['4.8', 'Riesgo nuclear'], ['4.9', 'Riesgo biológico'],
    ['4.10', 'Incendio con víctimas confirmadas'], ['4.11', 'Petición de apoyo por parte de bomberos'],
  ]),
  G('5', 'Psiquiátrico y sociosanitario', '#6A1B9A', [
    ['5.1', 'Orden judicial'], ['5.2', 'Orden médica'], ['5.3', 'Orden médica urgente / orden médica en paciente muy agresivo'],
    ['5.4', 'Certificación psiquiátrica'], ['5.5', 'Problema social'], ['5.6', 'Huelga de hambre'], ['5.7', 'Violencia de género'],
    ['5.8', 'Maltrato a menores'], ['5.9', 'Atención sociosanitaria a personas mayores en riesgo social o con sospecha de maltrato'],
    ['5.10', 'Desamparo sobrevenido en persona dependiente'],
  ]),
  G('6', 'Cadáver', '#37474F', [
    ['6.1', 'Domicilio'], ['6.2', 'Vía pública'], ['6.3', 'Local público (incluye centro sanitario)'],
    ['6.4', 'Fallecimiento personas sin hogar con independencia lugar del suceso'],
  ]),
  G('7', 'Especiales', '#263238', [
    ['7.1', 'Amenaza de bomba'], ['7.2', 'Atentado explosivo'], ['7.3', 'Otro tipo de atentado'], ['7.4', 'Accidente de tren'],
    ['7.5', 'Accidente de avión'], ['7.6', 'Accidente de transporte de mercancías peligrosas'],
  ]),
  G('8', 'Servicios programados', '#1565C0', [
    ['8.1', 'Presencia de una unidad, sin SVA ni PSA'], ['8.2', 'Presencia de 2 o 3 unidades, sin SVA ni PSA'],
    ['8.3', 'Presencia de más de 3 unidades, sin SVA ni PSA'],
    ['8.4', 'Presencia de una o más unidades SVA, sin PSA, sin sobrepasar 3 recursos en total'],
    ['8.4.1', 'Presencia de una o más unidades SVA, sin PSA, sumando más de 3 recursos en total'],
    ['8.5', 'Despliegue de PSA, con o sin otras unidades (máximo 3 recursos en total)'],
    ['8.5.1', 'Despliegue de PSA, con otros recursos (más de 3 recursos en total)'],
    ['8.6', 'Presencia de todos los medios y recursos de SAMUR-Protección Civil'], ['8.7', 'Servicio preventivo desde el operativo ordinario'],
    ['8.8', 'Emergencia en la ciudad de Madrid con necesidad de refuerzo de medios (orden de Directivo de Guardia)'],
    ['8.9', 'Emergencia con refuerzo de medios (orden de Directivo de Guardia) fuera de la ciudad de Madrid'],
    ['8.10', 'CECOR externo en dispositivo de riesgo previsible'], ['8.11', 'CECOR interno en dispositivo de riesgo previsible'],
    ['8.12', 'Servicio de análisis de riesgos'],
    ['AS-1.1', 'Identificación y registro de riesgos específicos para planes de distrito (zonas inundables, heladas, etc.)', '8.12'],
    ['AS-1.2', 'Identificación de riesgos en zona/local ante futura celebración de evento de riesgo previsible', '8.12'],
    ['8.13', 'Servicio de seguimiento de riesgos'],
    ['AS-2.1', 'Riesgos meteorológicos: nevadas', '8.13'], ['AS-2.2', 'Riesgos meteorológicos: lluvias torrenciales', '8.13'],
    ['AS-2.3', 'Riesgos meteorológicos: otras, a indicar', '8.13'],
    ['AS-3.1', 'Riesgos antrópicos: manifestaciones', '8.13'], ['AS-3.2', 'Riesgos antrópicos: concentraciones', '8.13'],
    ['AS-3.3', 'Riesgos antrópicos: fiestas', '8.13'], ['AS-3.4', 'Riesgos antrópicos: otros', '8.13'],
    ['AS-4.1', 'Simulacros de evacuación: verificación de instalaciones', '8.13'], ['AS-4.2', 'Simulacros de evacuación: activación en tiempo real', '8.13'],
    ['AS-4.3', 'Simulacros de evacuación: mixto, verificación y activación', '8.13'],
    ['8.14', 'Servicio de formación/divulgación externa'], ['8.15', 'Servicio de logística y otros'],
  ]),
  G('9', 'Donación de órganos', '#00838F', [['9', 'Donante en asistolia']]),
  G('10', 'Componentes heridos', '#283593', [
    ['10.1', 'SAMUR - Protección Civil'], ['10.2', 'Policía Municipal'], ['10.3', 'Bombero de Madrid'], ['10.4', 'Policía Nacional'],
    ['10.5', 'Otras instituciones'],
  ]),
  G('15', 'Psicológicos', '#AD1457', [
    ['15.1', 'Atención psicológica a la víctima primaria'], ['15.2', 'Atención psicológica a familiares y allegados'],
    ['15.3', 'Atención psicológica a implicados'], ['15.4', 'Atención psicológica a testigos'],
    ['15.5', 'Atención psicológica a intervinientes de SAMUR-Protección Civil'],
    ['15.6', 'Atención psicológica a intervinientes de Cuerpos y Fuerzas de Seguridad'],
    ['15.7', 'Atención psicológica a intervinientes de Bomberos'], ['15.8', 'Programa de Sensibilización y Reeducación vial'],
    ['15.9', 'Colaboración del Romeo en el suceso sin paciente «in situ»'], ['15.10', 'Activación/Presencia del Romeo en situación de preventivo'],
  ]),
];

/** Identificador estable de un código: 1.6.1 → inc_1_6_1, AS-2.1 → inc_as_2_1 */
export const idIncidente = codigo => 'inc_' + String(codigo).toLowerCase().replace(/[^a-z0-9]+/g, '_');
export const nombreGrupo = g => g.codigo + '. ' + g.nombre;

/** Códigos de incidente como elementos del catálogo de tipos de aviso */
export function tiposAvisoIncidentes() {
  const out = [];
  for (const g of GRUPOS_INCIDENTE) for (const [codigo, nombre, padre] of g.items) {
    const it = { id: idIncidente(codigo), codigo, nombre, grupo: nombreGrupo(g), color: g.color, compatibles: [] };
    if (padre) { it.padre = padre; it.cierre = true; }
    out.push(it);
  }
  return out;
}
const POR_ID = new Map(tiposAvisoIncidentes().map(t => [t.id, t]));

/** Tipo de aviso por id: primero el catálogo dado (el del preventivo) y, si no está, los códigos por defecto */
export function tipoAvisoDef(lista, id) {
  if (!id) return null;
  return (lista || []).find(t => t.id === id) || POR_ID.get(id) || null;
}
/** Texto de un tipo de aviso: «1.2 · Accidente con menos de 3 víctimas» o el nombre si no tiene código */
export function etiquetaTipo(t) { return t ? (t.codigo ? t.codigo + ' · ' + t.nombre : t.nombre || '') : ''; }
export function etiquetaTipoAviso(lista, id) { return etiquetaTipo(tipoAvisoDef(lista, id)); }

/** Compara códigos por tramos numéricos (1.2 < 1.6 < 1.6.1 < 1.10; AS-… detrás de los números) */
export function compararCodigo(a, b) {
  const tr = c => String(c || '').split(/[.\-]/).map(x => (/^\d+$/.test(x) ? Number(x) : x));
  const x = tr(a), y = tr(b);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    if (x[i] === undefined) return -1; if (y[i] === undefined) return 1;
    if (x[i] === y[i]) continue;
    if (typeof x[i] === 'number' && typeof y[i] === 'number') return x[i] - y[i];
    if (typeof x[i] === 'number') return -1; if (typeof y[i] === 'number') return 1;
    return String(x[i]).localeCompare(String(y[i]), 'es');
  }
  return 0;
}

export const OTROS_TIPOS = 'Otros tipos';
/**
 * Carpetas para elegir el tipo de un aviso: [{ nombre, color, items: [{ t, nivel }] }].
 * Los códigos con número van en su grupo, ordenados, con los subcódigos (1.6.1) y los códigos de
 * cierre (AS-…) justo debajo de su código. Los tipos sin carpeta van al final, en «Otros tipos».
 */
export function carpetasTipos(lista) {
  const grupos = new Map();
  for (const t of lista || []) {
    const g = String(t.grupo || '').trim() || OTROS_TIPOS;
    if (!grupos.has(g)) grupos.set(g, []);
    grupos.get(g).push(t);
  }
  const nombres = [...grupos.keys()].sort((a, b) => (a === OTROS_TIPOS) - (b === OTROS_TIPOS) || a.localeCompare(b, 'es', { numeric: true }));
  return nombres.map(nombre => {
    const ts = grupos.get(nombre);
    const conCodigo = new Map(ts.filter(t => t.codigo).map(t => [String(t.codigo), t]));
    const padreDe = t => {
      if (t.padre && conCodigo.has(String(t.padre))) return String(t.padre);
      const c = String(t.codigo || ''); const k = c.lastIndexOf('.');
      if (/^\d+(\.\d+){2,}$/.test(c) && conCodigo.has(c.slice(0, k))) return c.slice(0, k);
      return null;
    };
    const hijos = new Map(); const raices = [];
    for (const t of ts) { const p = t.codigo ? padreDe(t) : null; if (p) { if (!hijos.has(p)) hijos.set(p, []); hijos.get(p).push(t); } else raices.push(t); }
    const orden = (a, b) => (a.codigo && b.codigo ? compararCodigo(a.codigo, b.codigo) : a.codigo ? -1 : b.codigo ? 1 : String(a.nombre).localeCompare(String(b.nombre), 'es'));
    const items = [];
    const poner = (t, nivel) => { items.push({ t, nivel }); for (const h of (hijos.get(String(t.codigo)) || []).sort(orden)) poner(h, nivel + 1); };
    for (const t of raices.sort(orden)) poner(t, 0);
    const color = (ts.find(t => t.codigo) || ts[0] || {}).color || '#546E7A';
    return { nombre, color, items };
  });
}

/** Códigos por defecto que faltan en una lista de tipos de aviso (para completar catálogos ya existentes) */
export function incidentesQueFaltan(lista) {
  const ids = new Set((lista || []).map(t => t.id));
  return tiposAvisoIncidentes().filter(t => !ids.has(t.id)).map(clone);
}
export const tieneCodigos = lista => (lista || []).some(t => t.codigo);
