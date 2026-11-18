// Coordenadas, distancias y enlaces de mapas (sin claves ni servicios de pago).

export function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371, rad = x => x * Math.PI / 180;
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}
export function hasCoords(loc) { return !!(loc && loc.lat != null && loc.lon != null && !isNaN(loc.lat) && !isNaN(loc.lon)); }

const num = '(-?\\d{1,3}(?:\\.\\d+)?)';
/** Extrae coordenadas de un texto "40.41, -3.70" o de un enlace de Google Maps */
export function parseCoords(text) {
  const s = String(text || '').trim();
  if (!s) return null;
  const pats = [
    new RegExp('@' + num + ',' + num), new RegExp('!3d' + num + '!4d' + num),
    new RegExp('[?&](?:q|query|ll|destination|center)=' + num + '(?:,|%2C)\\s*' + num, 'i'),
    new RegExp('^' + num + '\\s*[,; ]\\s*' + num + '$'),
  ];
  for (const re of pats) {
    const m = s.match(re);
    if (m) {
      const lat = parseFloat(m[1]), lon = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return { lat: round6(lat), lon: round6(lon) };
    }
  }
  return null;
}
export const round6 = x => Math.round(x * 1e6) / 1e6;
export function fmtCoords(loc) { return hasCoords(loc) ? loc.lat.toFixed(5) + ', ' + loc.lon.toFixed(5) : ''; }
export function fmtKm(km) { return km == null ? '' : km < 1 ? Math.round(km * 1000) + ' m' : km.toFixed(1).replace('.', ',') + ' km'; }

function query(loc) { return hasCoords(loc) ? loc.lat + ',' + loc.lon : String((loc && loc.txt) || '').trim(); }
/** Enlace para abrir la ubicación en Google Maps (aplicación o web) */
export function googleMapsUrl(loc) { const q = query(loc); return q ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q) : ''; }
/** Mapa de Google incrustable sin clave de API */
export function googleEmbedUrl(loc, zoom = 16) { const q = query(loc); return q ? 'https://maps.google.com/maps?q=' + encodeURIComponent(q) + '&z=' + zoom + '&output=embed' : ''; }
/** Alternativa sin clave: mapa de OpenStreetMap (requiere coordenadas) */
export function osmEmbedUrl(loc) {
  if (!hasCoords(loc)) return '';
  const d = 0.004, f = x => x.toFixed(6);
  return 'https://www.openstreetmap.org/export/embed.html?bbox=' + [f(loc.lon - d), f(loc.lat - d), f(loc.lon + d), f(loc.lat + d)].join('%2C') + '&layer=mapnik&marker=' + f(loc.lat) + '%2C' + f(loc.lon);
}
export function osmUrl(loc) { return hasCoords(loc) ? 'https://www.openstreetmap.org/?mlat=' + loc.lat + '&mlon=' + loc.lon + '#map=17/' + loc.lat + '/' + loc.lon : ''; }
/** URL del mapa incrustado según el proveedor elegido */
export function embedUrl(loc, prov) { return prov === 'osm' && hasCoords(loc) ? osmEmbedUrl(loc) : googleEmbedUrl(loc); }
/** Búsqueda gratuita de OpenStreetMap (Nominatim) — máximo 1 consulta por segundo */
export function nominatimUrl(text) { return 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&accept-language=es&q=' + encodeURIComponent(text); }

// ---------------- Cartografía georreferenciada (WGS84 / Web Mercator, EPSG:3857) ----------------
const RAD = Math.PI / 180;
/** Proyección Web Mercator normalizada (0…1) del mundo */
export const mercX = lon => (lon + 180) / 360;
export const mercY = lat => { const s = Math.sin(Math.max(-85.0511, Math.min(85.0511, lat)) * RAD); return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI); };
const invX = x => x * 360 - 180;
const invY = y => 90 - 360 * Math.atan(Math.exp((y - 0.5) * 2 * Math.PI)) / Math.PI;
/** ¿Extensión geográfica válida? { n, s, e, w } en grados */
export function boundsValidos(b) {
  return !!b && [b.n, b.s, b.e, b.w].every(v => typeof v === 'number' && isFinite(v)) && b.n > b.s && b.e > b.w && b.n <= 85.06 && b.s >= -85.06 && b.w >= -180 && b.e <= 180 && (b.n - b.s) < 10 && (b.e - b.w) < 10;
}
/** Coordenadas geográficas → posición normalizada (0…1) dentro de la extensión del plano */
export function geoANorm(b, lat, lon) {
  const x0 = mercX(b.w), x1 = mercX(b.e), y0 = mercY(b.n), y1 = mercY(b.s);
  return { x: (mercX(lon) - x0) / (x1 - x0), y: (mercY(lat) - y0) / (y1 - y0) };
}
/** Posición normalizada dentro del plano → coordenadas geográficas */
export function normAGeo(b, x, y) {
  const x0 = mercX(b.w), x1 = mercX(b.e), y0 = mercY(b.n), y1 = mercY(b.s);
  return { lat: round6(invY(y0 + y * (y1 - y0))), lon: round6(invX(x0 + x * (x1 - x0))) };
}
/** Extensión con un margen alrededor de un punto (grados) */
export function boundsDe(lat, lon, dLat, dLon) { return { n: round6(lat + dLat), s: round6(lat - dLat), e: round6(lon + dLon), w: round6(lon - dLon) }; }

/** Biblioteca de planos predefinidos de la aplicación (coordenadas de OpenStreetMap/Nominatim) */
export const BIBLIOTECA_PLANOS = [
  { id: 'lib_bernabeu', nombre: 'Estadio Santiago Bernabéu', lugar: 'Paseo de la Castellana, Chamartín, Madrid', centro: { lat: 40.45304, lon: -3.68820 }, zoom: 17, bounds: { n: 40.45545, s: 40.45063, e: -3.68440, w: -3.69200 }, consulta: 'Estadio Santiago Bernabeu Madrid' },
  { id: 'lib_metropolitano', nombre: 'Estadio Metropolitano (Wanda)', lugar: 'Avenida de Luis Aragonés, San Blas-Canillejas, Madrid', centro: { lat: 40.43601, lon: -3.59970 }, zoom: 17, bounds: { n: 40.43900, s: 40.43300, e: -3.59500, w: -3.60440 }, consulta: 'Estadio Metropolitano Madrid' },
  { id: 'lib_sol', nombre: 'Puerta del Sol y alrededores', lugar: 'Centro, Madrid', centro: { lat: 40.41686, lon: -3.70388 }, zoom: 16, bounds: { n: 40.41960, s: 40.41410, e: -3.69940, w: -3.70830 }, consulta: 'Puerta del Sol Madrid' },
];
/** Enlace a Google Maps de una entrada de la biblioteca (referencia; el plano usa la cartografía integrada) */
export const googleConsultaUrl = q => 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(q).replace(/%20/g, '+');
