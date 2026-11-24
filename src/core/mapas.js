// Tipos de mapa (vista) de un plano cartográfico. Sin dependencias de interfaz: lo usan la aplicación
// (Leaflet) y las pruebas. La vista solo cambia el fondo: posiciones, avisos, sectores y marcadores no cambian.
//
// · Sin clave de Google: OpenStreetMap (estándar) e Instituto Geográfico Nacional de España (satélite PNOA,
//   híbrido PNOA + callejero «IGNBaseOrto» y relieve con el Mapa Topográfico Nacional «MTN»). Servicios WMTS
//   públicos y gratuitos (licencia CC BY 4.0, atribución scne.es), con cobertura de España.
// · Con clave de Google Maps Platform: Map Tiles API (roadmap, satellite, satellite + layerRoadmap, terrain).

export const VISTAS_MAPA = [
  { id: 'estandar', nombre: 'Mapa', desc: 'Calles y lugares (el mapa de siempre)' },
  { id: 'satelite', nombre: 'Satélite', desc: 'Fotografía aérea' },
  { id: 'hibrido', nombre: 'Híbrido', desc: 'Fotografía aérea con calles y nombres' },
  { id: 'relieve', nombre: 'Relieve', desc: 'Mapa topográfico con curvas de nivel' },
];
export const VISTA_DEFECTO = 'estandar';
export const esVista = v => VISTAS_MAPA.some(x => x.id === v);
export const nombreVista = v => (VISTAS_MAPA.find(x => x.id === v) || VISTAS_MAPA[0]).nombre;

export const ATRIB_OSM = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores de OpenStreetMap</a>';
export const ATRIB_IGN = '© <a href="https://www.ign.es" target="_blank" rel="noopener">Instituto Geográfico Nacional</a> (CC BY 4.0 <a href="https://www.scne.es" target="_blank" rel="noopener">scne.es</a>)';

/** Tesela WMTS del IGN en Web Mercator (GoogleMapsCompatible: fila y columna como en XYZ) */
const wmtsIGN = (servicio, capa, formato) => 'https://www.ign.es/wmts/' + servicio + '?service=WMTS&request=GetTile&version=1.0.0&Format=' + formato
  + '&layer=' + capa + '&style=default&tilematrixset=GoogleMapsCompatible&TileMatrix={z}&TileRow={y}&TileCol={x}';
const IGN = {
  pnoa: { url: wmtsIGN('pnoa-ma', 'OI.OrthoimageCoverage', 'image/jpeg'), atribucion: 'PNOA ' + ATRIB_IGN, maxNativeZoom: 20 },
  callejero: { url: wmtsIGN('ign-base', 'IGNBaseOrto', 'image/png'), atribucion: ATRIB_IGN, maxNativeZoom: 20, transparente: true },
  mtn: { url: wmtsIGN('mapa-raster', 'MTN', 'image/jpeg'), atribucion: ATRIB_IGN, maxNativeZoom: 20 },
};
const OSM = { url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', atribucion: ATRIB_OSM, maxNativeZoom: 19 };

/** Parámetros de createSession de la Map Tiles API para cada vista (documentación de Google:
 *  híbrido = satellite + layerRoadmap con overlay false; terrain exige layerRoadmap) */
export function sesionGoogleVista(vista) {
  if (vista === 'satelite') return { mapType: 'satellite' };
  if (vista === 'hibrido') return { mapType: 'satellite', layerTypes: ['layerRoadmap'], overlay: false };
  if (vista === 'relieve') return { mapType: 'terrain', layerTypes: ['layerRoadmap'] };
  return { mapType: 'roadmap' };
}

/** Capas (de abajo arriba) de una vista con el proveedor activo */
export function capasVista(proveedor, vista) {
  const v = esVista(vista) ? vista : VISTA_DEFECTO;
  if (proveedor === 'google') return [{ google: sesionGoogleVista(v) }];
  if (v === 'satelite') return [{ ...IGN.pnoa }];
  if (v === 'hibrido') return [{ ...IGN.pnoa }, { ...IGN.callejero }];
  if (v === 'relieve') return [{ ...IGN.mtn }];
  return [{ ...OSM }];
}

/** Zoom máximo con imagen en un punto, según los rectángulos «maxZoomRects» de la Map Tiles API */
export function maxZoomEn(rects, lat, lon) {
  let max = null;
  for (const r of rects || []) if (lat <= r.north && lat >= r.south && lon <= r.east && lon >= r.west) max = Math.max(max ?? 0, r.maxZoom);
  return max;
}
