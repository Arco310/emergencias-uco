// Cartografía con Leaflet (incluido en la aplicación, sin CDN: funciona sin conexión).
// Proveedores: OpenStreetMap (sin clave, por defecto) y Google Maps Platform (Map Tiles API y
// Places API, oficiales) cuando se configura una clave. Coordenadas en WGS84; visualización Web Mercator.
import * as L from 'leaflet';
import { G } from './state.js';
import { nominatimUrl, round6 } from '../core/geo.js';

export { L };
const ATRIB_OSM = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">colaboradores de OpenStreetMap</a>';

export function claveGoogle() { const c = G.core && G.core.cfg && G.core.cfg.cartografia; return (c && c.googleKey) || ''; }
/** Proveedor activo: Google Maps si hay clave configurada; si no, OpenStreetMap */
export function proveedor() { return claveGoogle() ? 'google' : 'osm'; }
export const NOMBRE_PROVEEDOR = { google: 'Google Maps', osm: 'OpenStreetMap' };

export const aLatLngBounds = b => L.latLngBounds([b.s, b.w], [b.n, b.e]);
export const deLatLngBounds = lb => ({ n: round6(lb.getNorth()), s: round6(lb.getSouth()), e: round6(lb.getEast()), w: round6(lb.getWest()) });

/** Crea un mapa Leaflet en un elemento. El doble clic se reserva para acciones propias (no hace zoom) */
export function crearMapa(el, { bounds, centro, zoom, minZoom, maxZoom = 21, maxBounds } = {}) {
  const map = L.map(el, { zoomControl: true, doubleClickZoom: false, minZoom, maxZoom, zoomSnap: 0.25, wheelPxPerZoomLevel: 90, tapHold: true, maxBounds, maxBoundsViscosity: maxBounds ? 0.8 : 0 });
  map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');
  if (bounds) map.fitBounds(aLatLngBounds(bounds), { animate: false });
  else map.setView([centro ? centro.lat : 40.4168, centro ? centro.lon : -3.7038], zoom || 15, { animate: false });
  return map;
}

// ---- Google Maps Platform: Map Tiles API (sesión de teselas) ----
let sesionG = null;
async function sesionGoogle(key) {
  if (sesionG && sesionG.key === key && sesionG.exp > Date.now() + 3600e3) return sesionG;
  const r = await fetch('https://tile.googleapis.com/v1/createSession?key=' + encodeURIComponent(key), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mapType: 'roadmap', language: 'es-ES', region: 'ES' }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.session) throw new Error((j.error && j.error.message) || 'Google Maps no está disponible');
  sesionG = { key, session: j.session, exp: Number(j.expiry) * 1000 || Date.now() + 86400e3 };
  return sesionG;
}
/** Atribución obligatoria de Google: logotipo y derechos de los datos de la zona visible */
function atribucionGoogle(map, s) {
  let t = null;
  const upd = async () => {
    const b = map.getBounds(); const z = Math.round(map.getZoom());
    try {
      const r = await fetch(`https://tile.googleapis.com/tile/v1/viewport?session=${s.session}&key=${encodeURIComponent(s.key)}&zoom=${z}&north=${b.getNorth()}&south=${b.getSouth()}&east=${b.getEast()}&west=${b.getWest()}`);
      const j = await r.json();
      map.attributionControl.setPrefix('<b class="glogo">Google</b> ' + (j.copyright ? String(j.copyright).replace(/[<>&]/g, '') : ''));
    } catch { /* sin conexión: se mantiene la última */ }
  };
  map.on('moveend', () => { clearTimeout(t); t = setTimeout(upd, 400); }); upd();
}

/** Capa base de teselas del proveedor activo. Si Google falla, se usa OpenStreetMap */
export async function capaBase(map, { maxNativeZoom } = {}) {
  if (proveedor() === 'google') {
    try {
      const s = await sesionGoogle(claveGoogle());
      const capa = L.tileLayer('https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=' + s.session + '&key=' + encodeURIComponent(s.key), { maxZoom: 21, maxNativeZoom: Math.min(22, maxNativeZoom || 22), attribution: '' });
      capa.addTo(map); atribucionGoogle(map, s);
      return { capa, prov: 'google' };
    } catch (e) { console.warn('Google Maps no disponible; se usa OpenStreetMap', e); }
  }
  // crossOrigin: el service worker puede leer la fecha de cada tesela y guardarlas para usarlas sin conexión
  const capa = L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 21, maxNativeZoom: Math.min(19, maxNativeZoom || 19), attribution: ATRIB_OSM, crossOrigin: true });
  capa.addTo(map);
  return { capa, prov: 'osm' };
}

// ---- Búsqueda de lugares ----
let ultNominatim = 0;
/** Busca direcciones, calles, plazas, edificios o lugares. Devuelve [{ nombre, direccion, lat, lon, bounds }] */
export async function buscarLugar(q) {
  q = String(q || '').trim(); if (!q) return [];
  if (proveedor() === 'google') {
    const r = await fetch('https://places.googleapis.com/v1/places:searchText', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': claveGoogle(), 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location,places.viewport' },
      body: JSON.stringify({ textQuery: q, languageCode: 'es', regionCode: 'ES', maxResultCount: 6 }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((j.error && j.error.message) || 'No se pudo buscar en Google Maps');
    return (j.places || []).map(p => ({
      nombre: (p.displayName && p.displayName.text) || q, direccion: p.formattedAddress || '', lat: p.location.latitude, lon: p.location.longitude,
      bounds: p.viewport ? { n: p.viewport.high.latitude, s: p.viewport.low.latitude, e: p.viewport.high.longitude, w: p.viewport.low.longitude } : null,
    }));
  }
  // Nominatim: como máximo una consulta por segundo y solo al pulsar «Buscar» (política de uso de OSM)
  const w = 1100 - (Date.now() - ultNominatim); if (w > 0) await new Promise(r => setTimeout(r, w));
  ultNominatim = Date.now();
  const r = await fetch(nominatimUrl(q));
  if (!r.ok) throw new Error('No se pudo buscar el lugar');
  return (await r.json()).map(x => {
    const bb = x.boundingbox || [];
    return { nombre: x.name || String(x.display_name || '').split(',')[0], direccion: x.display_name || '', lat: +x.lat, lon: +x.lon, bounds: bb.length === 4 ? { s: +bb[0], n: +bb[1], w: +bb[2], e: +bb[3] } : null };
  });
}
