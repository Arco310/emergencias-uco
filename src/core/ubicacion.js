// Ubicación de avisos y unidades (1.5.0): siempre con su origen, para no confundir un punto marcado a
// mano con una posición GPS real, y validada igual en el dispositivo y en el servidor.
import { fmtTime } from './util.js';

export const FUENTES_LOC = {
  mapa: 'Marcada en el mapa (no es una posición GPS)',
  gps: 'Posición GPS del dispositivo',
  direccion: 'Dirección escrita',
  coordenadas: 'Coordenadas introducidas a mano',
  punto: 'Punto del plano',
  sector: 'Centro del sector',
};
const num = v => (v === null || v === undefined || v === '' ? null : typeof v === 'number' ? v : Number.NaN);

/** Solo los campos conocidos; null si no hay ni texto ni coordenadas */
export function normalizarLoc(l) {
  if (!l || typeof l !== 'object') return null;
  const txt = String(l.txt || '').trim(); const lat = num(l.lat); const lon = num(l.lon);
  if (!txt && lat == null && lon == null) return null;
  const out = { txt, lat, lon };
  if (l.fuente) out.fuente = String(l.fuente);
  if (l.prec != null && Number.isFinite(+l.prec)) out.prec = Math.round(+l.prec);
  if (l.ref) out.ref = String(l.ref).slice(0, 60);
  if (l.t != null && Number.isFinite(+l.t)) out.t = +l.t;
  return out;
}
/** Mensaje si la ubicación no es válida (o null) */
export function motivoLocNoValida(l) {
  if (!l) return null;
  if (typeof l !== 'object') return 'Ubicación no válida';
  if (String(l.txt || '').length > 300) return 'La descripción de la ubicación es demasiado larga (máximo 300 caracteres)';
  const lat = num(l.lat); const lon = num(l.lon);
  if ((lat == null) !== (lon == null)) return 'Indica latitud y longitud';
  if (lat != null && !(Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return 'Coordenadas no válidas: la latitud va de -90 a 90 y la longitud de -180 a 180';
  if (l.fuente && !FUENTES_LOC[l.fuente]) return 'Origen de la ubicación desconocido';
  return null;
}
/** «Marcada en el mapa (no es una posición GPS) · 03:12» */
export function describirFuente(l) {
  if (!l || !l.fuente || !FUENTES_LOC[l.fuente]) return '';
  return FUENTES_LOC[l.fuente] + (l.fuente === 'gps' && l.prec != null ? ' (±' + l.prec + ' m)' : '') + (l.t ? ' · ' + fmtTime(l.t) : '');
}
/** Comprobación del contenido de una operación (la usa también el servidor) */
export function motivoContenidoNoValido(op) {
  const x = op && op.x || {};
  if (op.k === 'aviso.create') return motivoLocNoValida(x.a && x.a.loc);
  if (op.k === 'aviso.update') return x.f && x.f.loc ? motivoLocNoValida(x.f.loc.n) : null;
  if (op.k === 'unit.loc') return motivoLocNoValida(x.n);
  if (op.k === 'informe.reg') return motivoInformeNoValido(x);
  return null;
}
/** Registro de un informe (1.5.0): qué se hizo, con qué versión y con qué huella */
export const ACCIONES_INFORME = { generar: 'Informe generado', exportar: 'Informe exportado', consultar: 'Informe consultado' };
export const FORMATOS_INFORME = { pdf: 'PDF', xlsx: 'Excel (XLSX)', csv: 'CSV', json: 'JSON' };
export function motivoInformeNoValido(x = {}) {
  if (!ACCIONES_INFORME[x.accion]) return 'Acción de informe no válida';
  if (x.formato != null && !FORMATOS_INFORME[x.formato]) return 'Formato de informe no válido';
  if (x.accion === 'generar' && !(Number.isInteger(x.n) && x.n >= 1)) return 'Número de versión del informe no válido';
  if (x.n != null && !(Number.isInteger(x.n) && x.n >= 1 && x.n < 100000)) return 'Número de versión del informe no válido';
  if (x.accion === 'generar' && x.hash == null) return 'Falta la huella del informe';
  if (x.hash != null && !/^[0-9a-f]{64}$/.test(x.hash)) return 'Huella SHA-256 del informe no válida';
  if (x.motivo != null && (typeof x.motivo !== 'string' || x.motivo.length > 500)) return 'Motivo del informe demasiado largo';
  for (const k of ['pendientes', 'nOps', 'conflictos']) if (x[k] != null && !(Number.isInteger(x[k]) && x[k] >= 0)) return 'Dato del informe no válido: ' + k;
  return null;
}
