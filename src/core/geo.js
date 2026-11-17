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
