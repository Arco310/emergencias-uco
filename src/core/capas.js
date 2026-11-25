// Capas y filtros del mapa (1.5.0). Funciones puras: filtrar u ocultar nunca cambia los datos del
// preventivo ni lo que ven los demás (los filtros son preferencias de visualización de cada persona).
import { unitSituation, liveUnits } from './engine.js';
import { DEFAULT_CATEGORIAS_PUNTO } from './defaults.js';

export { DEFAULT_CATEGORIAS_PUNTO };

/** Categorías de puntos del preventivo (las de partida si es anterior a la 1.5.0) */
export function categoriasPunto(p) {
  const c = p && p.cat && p.cat.categoriasPunto;
  return Array.isArray(c) && c.length ? c : DEFAULT_CATEGORIAS_PUNTO;
}
export const GRUPOS_PUNTO = { interes: 'Puntos de interés', apoyo: 'Infraestructura y apoyo' };

/** Disponibilidad en el mapa: cada estado con un símbolo propio (no se distingue solo por el color) */
export const DISPONIBILIDAD = [
  { id: 'disponible', nombre: 'Disponible', simbolo: '✓' },
  { id: 'ocupada', nombre: 'Ocupada (en aviso o clave ocupada)', simbolo: '●' },
  { id: 'descanso', nombre: 'En descanso', simbolo: '‖' },
  { id: 'especial', nombre: 'Clave especial', simbolo: '◆' },
  { id: 'fuera', nombre: 'Fuera de servicio', simbolo: '✕' },
];
export const simboloDisponibilidad = id => (DISPONIBILIDAD.find(d => d.id === id) || {}).simbolo || '';

const CAPAS = { unidades: true, avisos: true, finalizados: false, sectores: true, interes: true, apoyo: true, etiquetas: true };
const LISTAS = ['tipos', 'claves', 'disponibilidad', 'sectores', 'tiposAviso', 'sectoresOcultos', 'categoriasOcultas'];
export const FILTROS_DEFECTO = Object.freeze({ capas: Object.freeze({ ...CAPAS }), ...Object.fromEntries(LISTAS.map(k => [k, Object.freeze([])])) });

/** Filtros válidos a partir de lo guardado (lo desconocido o dañado vuelve a su valor normal) */
export function normalizarFiltros(f = {}) {
  const src = f && typeof f === 'object' ? f : {};
  const capas = {};
  for (const [k, v] of Object.entries(CAPAS)) capas[k] = src.capas && typeof src.capas[k] === 'boolean' ? src.capas[k] : v;
  const out = { capas };
  for (const k of LISTAS) out[k] = Array.isArray(src[k]) ? src[k].filter(x => typeof x === 'string') : [];
  return out;
}
/** Número de filtros distintos de los normales (para el aviso «hay filtros activos») */
export function filtrosActivos(f) {
  let n = 0;
  for (const [k, v] of Object.entries(CAPAS)) if (f.capas[k] !== v) n++;
  for (const k of LISTAS) if (f[k].length) n++;
  return n;
}

/** Unidades que se ven con los filtros (combinables: todos deben cumplirse) */
export function filtrarUnidades(s, f, t) {
  if (!f.capas.unidades) return [];
  return liveUnits(s).filter(u =>
    (!f.tipos.length || f.tipos.includes(u.tipo)) &&
    (!f.claves.length || f.claves.includes(u.clave)) &&
    (!f.sectores.length || f.sectores.includes(u.sector)) &&
    (!f.disponibilidad.length || f.disponibilidad.includes(unitSituation(s, u, t))));
}
/** Avisos que se ven: los activos por defecto; los finalizados solo si se piden */
export function filtrarAvisos(s, f) {
  return Object.values(s.avisos).filter(a => {
    const fin = a.estado === 'finalizado';
    if (fin ? !f.capas.finalizados : !f.capas.avisos) return false;
    return !f.tiposAviso.length || f.tiposAviso.includes(a.tipo);
  });
}
export function sectoresVisibles(p, f) { return f.capas.sectores ? (p.cat.sectores || []).filter(x => x.zona && x.zona.pts && x.zona.pts.length >= 3 && !f.sectoresOcultos.includes(x.id)) : []; }
export function puntosVisibles(p, f) {
  const cats = new Map(categoriasPunto(p).map(c => [c.id, c]));
  return (p.cat.puntos || []).filter(x => { const c = cats.get(x.categoria); return c && f.capas[c.grupo] !== false && !f.categoriasOcultas.includes(c.id); });
}

/** Leyenda de lo que se puede ver: claves (color y código), disponibilidad (símbolo) y categorías */
export function leyenda(p, f) {
  return {
    claves: (p.cat.claves || []).map(c => ({ codigo: c.codigo, nombre: c.nombre, color: c.color })),
    disponibilidad: DISPONIBILIDAD.map(d => ({ ...d })),
    categorias: categoriasPunto(p).filter(c => f.capas[c.grupo] !== false && !f.categoriasOcultas.includes(c.id)),
  };
}

/** Agrupación por rejilla de pantalla: solo cuando hay más elementos que el umbral */
export function agrupar(items, { celda = 60, umbral = 60 } = {}) {
  if (items.length <= umbral) return { sueltos: items.slice(), grupos: [] };
  const celdas = new Map();
  for (const it of items) { const k = Math.floor(it.x / celda) + ':' + Math.floor(it.y / celda); if (!celdas.has(k)) celdas.set(k, []); celdas.get(k).push(it); }
  const sueltos = []; const grupos = [];
  for (const lista of celdas.values()) {
    if (lista.length === 1) { sueltos.push(lista[0]); continue; }
    grupos.push({ ids: lista.map(x => x.id), n: lista.length, x: lista.reduce((a, b) => a + b.x, 0) / lista.length, y: lista.reduce((a, b) => a + b.y, 0) / lista.length });
  }
  return { sueltos, grupos };
}

/** Punto dentro de un polígono (coordenadas relativas del plano) */
export function dentroDe(pts, pos) {
  let dentro = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]; const b = pts[j];
    if ((a.y > pos.y) !== (b.y > pos.y) && pos.x < ((b.x - a.x) * (pos.y - a.y)) / (b.y - a.y) + a.x) dentro = !dentro;
  }
  return dentro;
}
/** Sector cuya delimitación contiene el punto (o null) */
export function sectorDePunto(sectores, pos) {
  if (!pos) return null;
  const s = (sectores || []).find(x => x.zona && x.zona.pts && x.zona.pts.length >= 3 && dentroDe(x.zona.pts, pos));
  return s ? s.id : null;
}
/** Centro aproximado de un polígono (para la etiqueta del sector) */
export function centroide(pts) { return { x: pts.reduce((a, b) => a + b.x, 0) / pts.length, y: pts.reduce((a, b) => a + b.y, 0) / pts.length }; }
