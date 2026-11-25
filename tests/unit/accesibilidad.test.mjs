// 1.5.0 §7 y §8 (WCAG 2.2 AA como referencia): contraste del texto que la aplicación coloca sobre colores
// configurables (claves, tipos, códigos de incidente…) y de las etiquetas de colores en los temas claro y oscuro.
// Comprobaciones automáticas; no sustituyen a la revisión con lectores de pantalla.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { contrastText, contrastRatio } from '../../src/core/util.js';
import { defaultCatalogs } from '../../src/core/defaults.js';
import { GRUPOS_INCIDENTE } from '../../src/core/incidentes.js';
import { NIVELES } from '../../src/core/validaciones.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CSS = fs.readFileSync(path.join(ROOT, 'src/ui/styles.css'), 'utf8');
const hex = h => { h = h.replace('#', ''); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const aHex = c => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
const mezcla = (a, b, p) => aHex(hex(a).map((v, i) => v * p + hex(b)[i] * (1 - p)));

/** Colores de partida que el usuario puede ver como fondo o como tinte de una etiqueta */
function paleta() {
  const c = new Map(); const add = (n, v) => { if (/^#[0-9a-f]{6}$/i.test(v || '')) c.set(v.toUpperCase(), n); };
  for (const g of GRUPOS_INCIDENTE) add('grupo ' + g.codigo, g.color);
  for (const [k, lista] of Object.entries(defaultCatalogs())) if (Array.isArray(lista)) for (const x of lista) add(k + ' ' + (x.codigo || x.nombre || x.id), x.color);
  for (const [k, n] of Object.entries(NIVELES)) add('nivel ' + k, n.color);
  return c;
}
/** Variables del tema: claro (:root) y oscuro (preferencia del sistema) */
function tema(oscuro) {
  const bloque = oscuro ? /@media \(prefers-color-scheme:dark\)\{:root:not\(\[data-theme=light\]\)\{([^}]+)\}/.exec(CSS)[1] : /:root\{color-scheme:light dark;([^}]+)\}/.exec(CSS)[1];
  const base = /:root\{color-scheme:light dark;([^}]+)\}/.exec(CSS)[1];
  const v = {}; for (const b of [base, bloque]) for (const m of b.matchAll(/--([a-z-]+):(#[0-9A-Fa-f]{6})/g)) v[m[1]] = m[2];
  return v;
}

test('el texto sobre cualquier color configurable (claves, tipos, unidades) alcanza 4,5:1', () => {
  const malos = [];
  for (let r = 0; r < 256; r += 15) for (let g = 0; g < 256; g += 15) for (let b = 0; b < 256; b += 15) {
    const c = aHex([r, g, b]); const t = contrastText(c); const ratio = contrastRatio(c, t);
    if (ratio < 4.5) malos.push(`${c} con ${t}: ${ratio.toFixed(2)}`);
  }
  assert.deepEqual(malos.slice(0, 5), [], `${malos.length} colores por debajo de 4,5:1`);
});

test('etiquetas de colores (chips): texto legible en los temas claro y oscuro con todos los colores de partida', () => {
  const regla = /\.chip\{[^}]*background:color-mix\(in srgb,var\(--c,#607D8B\) (\d+)%,transparent\);color:color-mix\(in srgb,var\(--c,#607D8B\) (\d+)%,var\(--ink\)\)/.exec(CSS);
  assert.ok(regla, 'regla .chip encontrada');
  const fondoP = Number(regla[1]) / 100; const textoP = Number(regla[2]) / 100;
  const malos = [];
  for (const oscuro of [false, true]) {
    const v = tema(oscuro);
    for (const [c, n] of [...paleta(), ...['ok', 'warn', 'bad', 'info'].map(k => [v[k], k])]) for (const f of [v.card, v.bg]) {
      const r = contrastRatio(mezcla(c, v.ink, textoP), mezcla(c, f, fondoP));
      if (r < 4.5) malos.push(`${oscuro ? 'oscuro' : 'claro'} ${n} ${c} sobre ${f}: ${r.toFixed(2)}`);
    }
  }
  assert.deepEqual(malos, []);
});

test('colores de estado y botones principales en el tema oscuro: texto y cifras legibles', () => {
  const v = tema(true);
  // Texto de estado (avisos, requeridos, «sin alertas»…) sobre las tarjetas y el fondo
  for (const k of ['ok', 'warn', 'bad', 'info', 'muted']) for (const f of [v.card, v.bg]) assert.ok(contrastRatio(v[k], f) >= 4.5, `${k} ${v[k]} sobre ${f}`);
  // Botón principal, burbujas de aviso y botón flotante: texto del acento sobre el acento
  assert.ok(contrastRatio(v['acc-ink'], v.acc) >= 4.5, `acento ${v.acc} con ${v['acc-ink']}`);
  // Cifras del panel (texto grande: 3:1)
  for (const k of ['k-ocup', 'k-desc', 'k-esp', 'k-fuera']) assert.ok(contrastRatio(v[k], v.card) >= 3, `${k} ${v[k]}`);
  const claro = tema(false);
  assert.ok(contrastRatio(claro['acc-ink'], claro.acc) >= 4.5);
  for (const k of ['k-ocup', 'k-desc', 'k-esp', 'k-fuera']) assert.ok(contrastRatio(claro[k], claro.card) >= 3, `claro ${k}`);
});
