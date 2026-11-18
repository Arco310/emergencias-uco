// Iconos de la interfaz y símbolos de unidades (SVG propios, sin dependencias).
import { escapeHtml as esc } from '../core/util.js';

const P = {
  inicio: 'M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z',
  panel: 'M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z',
  unidades: 'M2 7h11v9H2zM13 10h4l3 3v3h-7zM6 18.5a1.5 1.5 0 1 0 0-.01M16 18.5a1.5 1.5 0 1 0 0-.01',
  avisos: 'M12 3a6 6 0 0 0-6 6v4l-2 3h16l-2-3V9a6 6 0 0 0-6-6zM10 19a2 2 0 0 0 4 0',
  plano: 'M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3zM9 3v15M15 6v15',
  mas: 'M5 12h.01M12 12h.01M19 12h.01',
  atras: 'M15 5l-7 7 7 7',
  mas_add: 'M12 5v14M5 12h14',
  enlace: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  zona: 'M4 7l6-3 9 4-2 11-10 1z',
  buscar: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4',
  sync: 'M4 12a8 8 0 0 1 14-5.3L20 9M20 4v5h-5M20 12a8 8 0 0 1-14 5.3L4 15M4 20v-5h5',
  usuario: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0',
  candado: 'M6 11h12v10H6zM8 11V8a4 4 0 0 1 8 0v3',
  ajustes: 'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  grafico: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  lista: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  reloj: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7v5l3 3',
  archivo: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h6',
  descargar: 'M12 4v11M7 10l5 5 5-5M5 20h14',
  subir: 'M12 20V9M7 14l5-5 5 5M5 4h14',
  compartir: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  copiar: 'M9 9h11v11H9zM5 15H4V4h11v1',
  papelera: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  editar: 'M4 20h4L19 9l-4-4L4 16zM14 6l4 4',
  estrella: 'M12 3l2.8 5.8 6.2.9-4.5 4.4 1 6.2-5.5-2.9-5.5 2.9 1-6.2L3 9.7l6.2-.9z',
  archivar: 'M3 4h18v4H3zM5 8v12h14V8M10 12h4',
  ok: 'M5 12l5 5 9-10',
  cerrar: 'M6 6l12 12M18 6L6 18',
  pin: 'M12 22s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
  gps: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM12 2v3M12 19v3M2 12h3M19 12h3',
  filtro: 'M3 5h18l-7 8v6l-4 2v-8z',
  ojo: 'M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12zM12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
  alerta: 'M12 3l10 18H2zM12 10v5M12 18h.01',
  info: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 11v6M12 7.5h.01',
  cafe: 'M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h2a2 2 0 0 1 0 4h-2M8 3v3M12 3v3',
  play: 'M7 4l13 8-13 8z',
  stop: 'M6 6h12v12H6z',
  capas: 'M12 3l9 5-9 5-9-5zM3 13l9 5 9-5',
  zoomin: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M11 8v6M8 11h6',
  zoomout: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM20 20l-4-4M8 11h6',
  ajustar: 'M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5',
  mapa: 'M12 22s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12zM12 12.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5',
  bitacora: 'M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 18a2 2 0 0 1 2-2h12M9 8h6M9 11h6',
  plantilla: 'M4 4h16v5H4zM4 12h7v8H4zM14 12h6v8h-6z',
  escudo: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  llave: 'M15 7a4 4 0 1 1-3.5 6L4 20.5V17h3v-3h3l1.5-1.5A4 4 0 0 1 15 7z',
  red: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01',
  sinred: 'M2 9a15 15 0 0 1 20 0M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M3 3l18 18',
  salir: 'M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3',
  nota: 'M5 4h14v12l-4 4H5zM15 20v-4h4',
  telefono: 'M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2',
};

export function icon(name, cls = '', title = '') {
  const d = P[name] || P.info;
  return `<svg class="ic ${cls}" viewBox="0 0 24 24" aria-hidden="${title ? 'false' : 'true'}"${title ? ` role="img" aria-label="${esc(title)}"` : ''}><path d="${d}"/></svg>`;
}

// ---------- símbolos de unidades ----------
const SHAPES = {
  circulo: '<circle cx="24" cy="24" r="19.5"/>',
  cuadrado: '<rect x="5" y="5" width="38" height="38" rx="6"/>',
  rombo: '<path d="M24 2.5L45.5 24 24 45.5 2.5 24z"/>',
  triangulo: '<path d="M24 4.5l21 38H3z" stroke-linejoin="round"/>',
  hexagono: '<path d="M13 5h22l11 19-11 19H13L2 24z" stroke-linejoin="round"/>',
  escudo: '<path d="M24 3l19 6v15c0 11-8.5 18-19 21C13.5 42 5 35 5 24V9z"/>',
};
const GLYPHS = {
  ambulancia: '<path d="M3 8h11v8H3zM14 11h4l3 3v2h-7z"/><circle cx="7" cy="17.5" r="1.6"/><circle cx="17" cy="17.5" r="1.6"/><path d="M8.5 9.5v4M6.5 11.5h4"/>',
  coche: '<path d="M3 15v-3l2-5h14l2 5v3zM3 12h18"/><circle cx="7.5" cy="16" r="1.7"/><circle cx="16.5" cy="16" r="1.7"/>',
  mando: '<path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.4 6.7 19.4l1.2-6-4.5-4.1 6-.7z"/>',
  camion: '<path d="M2 6h12v10H2zM14 9h4l4 4v3h-8z"/><circle cx="6" cy="17.5" r="1.7"/><circle cx="18" cy="17.5" r="1.7"/>',
  furgoneta: '<path d="M2 8h13l5 4v5H2zM15 8v4h5"/><circle cx="6.5" cy="17.5" r="1.7"/><circle cx="16.5" cy="17.5" r="1.7"/>',
  cruz: '<path d="M9.5 3h5v6.5H21v5h-6.5V21h-5v-6.5H3v-5h6.5z"/>',
  equipo: '<circle cx="8" cy="8" r="2.6"/><circle cx="16" cy="8" r="2.6"/><path d="M3 19c0-3 2.2-5.5 5-5.5s5 2.5 5 5.5M11 19c0-3 2.2-5.5 5-5.5s5 2.5 5 5.5"/>',
  antena: '<path d="M12 10v11M8 21h8M12 10a2 2 0 1 0 0-.01M7.5 5.5a6.5 6.5 0 0 0 0 9M16.5 5.5a6.5 6.5 0 0 1 0 9"/>',
  tienda: '<path d="M2 20L12 4l10 16zM12 4v16M9 20l3-5 3 5"/>',
  moto: '<circle cx="5.5" cy="16" r="3"/><circle cx="18.5" cy="16" r="3"/><path d="M5.5 16l4-6h5l4 6M14 6h3l1.5 4"/>',
  bici: '<circle cx="5.5" cy="16" r="3.5"/><circle cx="18.5" cy="16" r="3.5"/><path d="M5.5 16l4-7h6l3 7M9.5 9L12 16h3"/>',
  pie: '<circle cx="12" cy="4.5" r="2"/><path d="M12 7v6l-3 7M12 13l3 7M8 10l4-2 4 2"/>',
  dron: '<path d="M5 5l14 14M19 5L5 19"/><circle cx="5" cy="5" r="2.5"/><circle cx="19" cy="5" r="2.5"/><circle cx="5" cy="19" r="2.5"/><circle cx="19" cy="19" r="2.5"/>',
  barco: '<path d="M3 15h18l-3 5H6zM12 3v12M12 4l6 8h-6"/>',
  fuego: '<path d="M12 3c1 4 6 6 6 11a6 6 0 0 1-12 0c0-3 2-4 2-7 2 1 3 3 3 5 1-2 1-6 1-9z"/>',
  escudo: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z"/>',
  bandera: '<path d="M5 21V3M5 4h12l-2 4 2 4H5"/>',
  ninguno: '',
};
const BORDE = { fino: 2, normal: 3.4, grueso: 5 };
export const SIZE_PX = { s: 30, m: 38, l: 48, xl: 60 };

/** Símbolo SVG de una unidad según su apariencia (unitVisual) */
export function unitSvg(v, { px, title = '' } = {}) {
  const size = px || SIZE_PX[v.tam] || 38;
  const sw = BORDE[v.borde] || 3.4;
  const shape = SHAPES[v.forma] || SHAPES.circulo;
  const glyph = GLYPHS[v.icono] ?? '';
  return `<svg class="usym${v.resting ? ' rest' : ''}" width="${size}" height="${size}" viewBox="0 0 48 48" role="img" aria-label="${esc(title)}">
<g fill="${v.fill}" stroke="${v.border}" stroke-width="${sw}">${shape}</g>
${glyph ? `<g transform="translate(12 12)" fill="none" stroke="${v.text}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${glyph}</g>` : ''}
${v.resting ? `<g transform="translate(31 30)"><circle cx="7" cy="7" r="7" fill="#424242" stroke="#fff" stroke-width="1.5"/><path d="M7 3.5v3.8l2.3 1.6" stroke="#fff" stroke-width="1.6" fill="none" stroke-linecap="round"/></g>` : ''}
</svg>`;
}
export const GLYPH_NAMES = Object.keys(GLYPHS);
export const SHAPE_NAMES = Object.keys(SHAPES);
