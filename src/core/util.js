// Utilidades generales sin dependencias (navegador y Node 18+).

let clockFn = () => Date.now();
/** Permite fijar un reloj (pruebas). */
export function setClock(fn) { clockFn = fn || (() => Date.now()); }
export function now() { return clockFn(); }

const B32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function randomBytes(n) {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}
export function base32(bytes) {
  let out = '', bits = 0, value = 0;
  for (const b of bytes) {
    value = (value << 8) | b; bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}
export function base32decode(str) {
  const clean = String(str).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  const out = []; let bits = 0, value = 0;
  for (const ch of clean) {
    const i = B32.indexOf(ch); if (i < 0) continue;
    value = (value << 5) | i; bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out);
}
/** Identificador único (≈80 bits aleatorios + marca temporal) */
export function uid(prefix = '') {
  const t = now().toString(36);
  return prefix + t + base32(randomBytes(9)).toLowerCase();
}

export function clone(v) {
  if (v === undefined) return undefined;
  if (typeof structuredClone === 'function') return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}

/** JSON con claves ordenadas: igualdad estructural estable */
export function stableStringify(v) {
  if (v === undefined) return 'null';
  if (v === null || typeof v !== 'object') return JSON.stringify(v);
  if (Array.isArray(v)) return '[' + v.map(stableStringify).join(',') + ']';
  const keys = Object.keys(v).filter(k => v[k] !== undefined).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + stableStringify(v[k])).join(',') + '}';
}
export function same(a, b) { return stableStringify(a ?? null) === stableStringify(b ?? null); }

export function getPath(obj, path) {
  return path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}
export function setPath(obj, path, val) {
  const ks = path.split('.'); let o = obj;
  for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
  if (val === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = val;
}

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

const pad2 = n => String(n).padStart(2, '0');
export function fmtTime(ms, withSec = false) {
  if (ms == null || isNaN(ms)) return '—';
  const d = new Date(ms);
  return pad2(d.getHours()) + ':' + pad2(d.getMinutes()) + (withSec ? ':' + pad2(d.getSeconds()) : '');
}
export function fmtDate(ms) {
  if (ms == null || isNaN(ms)) return '—';
  const d = new Date(ms);
  return pad2(d.getDate()) + '/' + pad2(d.getMonth() + 1) + '/' + d.getFullYear();
}
export function fmtDateTime(ms, withSec = false) {
  if (ms == null || isNaN(ms)) return '—';
  return fmtDate(ms) + ' ' + fmtTime(ms, withSec);
}
export function isoDate(ms) {
  const d = new Date(ms); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
}
/** Duración legible: 1 h 05 min, 4 min 10 s */
export function fmtDur(ms, { sec = false } = {}) {
  if (ms == null || isNaN(ms)) return '—';
  const neg = ms < 0; ms = Math.abs(ms);
  const s = Math.floor(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  let out;
  if (h > 0) out = h + ' h ' + pad2(m) + ' min';
  else if (m > 0) out = m + ' min' + (sec ? ' ' + pad2(r) + ' s' : '');
  else out = r + ' s';
  return (neg ? '-' : '') + out;
}
/** Cuenta atrás mm:ss / h:mm:ss */
export function fmtClock(ms) {
  if (ms == null || isNaN(ms)) return '—';
  ms = Math.max(0, ms);
  const s = Math.ceil(ms / 1000), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  return (h ? h + ':' + pad2(m) : m) + ':' + pad2(r);
}

export function sortBy(arr, fn) {
  return [...arr].sort((a, b) => { const x = fn(a), y = fn(b); return x < y ? -1 : x > y ? 1 : 0; });
}
export function groupBy(arr, fn) {
  const m = new Map(); for (const x of arr) { const k = fn(x); if (!m.has(k)) m.set(k, []); m.get(k).push(x); } return m;
}
export function sum(arr, fn = x => x) { let s = 0; for (const x of arr) s += fn(x) || 0; return s; }
export function avg(arr) { return arr.length ? sum(arr) / arr.length : null; }
export function median(arr) {
  if (!arr.length) return null; const a = [...arr].sort((x, y) => x - y); const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export function b64(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = ''; const CH = 0x8000;
  for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
  return btoa(s);
}
export function unb64(str) {
  const s = atob(str); const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
export function b64url(bytes) { return b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
export function unb64url(str) { str = str.replace(/-/g, '+').replace(/_/g, '/'); while (str.length % 4) str += '='; return unb64(str); }
export const enc = new TextEncoder();
export const dec = new TextDecoder();
export function hex(bytes) { return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join(''); }

/** Color de texto legible sobre un fondo */
export function relLuminance(hexColor) {
  const c = String(hexColor || '#777').replace('#', '');
  const v = c.length === 3 ? c.split('').map(x => x + x).join('') : c.padEnd(6, '0');
  const lin = x => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(parseInt(v.slice(0, 2), 16)) + 0.7152 * lin(parseInt(v.slice(2, 4), 16)) + 0.0722 * lin(parseInt(v.slice(4, 6), 16));
}
export function contrastRatio(a, b) { const x = relLuminance(a), y = relLuminance(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
/** Texto legible (negro o blanco) sobre un fondo: el de mayor contraste WCAG. Con negro puro el mejor de los dos
 *  alcanza siempre 4,58:1 (WCAG AA) sea cual sea el color que configure el usuario; con #111111 había colores
 *  intermedios que se quedaban en 4,35:1. */
export function contrastText(hexColor) {
  return contrastRatio(hexColor, '#000000') >= contrastRatio(hexColor, '#FFFFFF') ? '#000000' : '#FFFFFF';
}
export function isHexColor(s) { return /^#[0-9a-fA-F]{6}$/.test(String(s || '')); }

export class AppError extends Error {
  constructor(msg, code = 'error', extra) { super(msg); this.code = code; this.extra = extra; }
}
export function norm(s) {
  return String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}
