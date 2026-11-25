// Auditoría automática de accesibilidad y adaptación de una pantalla (WCAG 2.2 AA como referencia).
// Se ejecuta dentro de la página con Playwright: `page.evaluate(código, opciones)`.
// Comprueba lo que se puede medir sin una persona:
//  - 1.4.10 Reorganización: nada se sale por los lados del ancho de la ventana (salvo dentro de un contenedor
//    con desplazamiento propio, como tablas, pestañas, la barra del plano o el propio mapa), y ninguna palabra
//    queda partida entre dos líneas por falta de espacio;
//  - 2.5.8 Tamaño del objetivo (mínimo AA: 24 × 24 px), sin contar enlaces dentro de un texto ni el mapa;
//  - 1.4.3 Contraste del texto (4,5:1; 3:1 para texto grande), con el color de fondo real compuesto;
// Los nombres accesibles se comprueban aparte con el árbol de accesibilidad del navegador (aria_snapshot).
// No sustituye a la revisión con lectores de pantalla.
(opts) => {
  opts = opts || {};
  const vw = document.documentElement.clientWidth;
  const visible = el => {
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false;
    const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false;
    return !el.closest('[hidden], [aria-hidden="true"], .sr-only, .leaflet-tile-pane');
  };
  const desc = el => {
    const t = (el.getAttribute('aria-label') || el.title || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40);
    return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + (el.dataset.a ? '[' + el.dataset.a + ']' : '') + (t ? ' «' + t + '»' : '');
  };
  const pantalla = (opts.dentro && document.querySelector(opts.dentro)) || document.body;
  const todos = [...pantalla.querySelectorAll('*')].filter(el => !el.closest('svg') || el.tagName.toLowerCase() === 'svg');

  // --- Reorganización: elementos fuera del ancho de la ventana sin desplazamiento propio
  const desbordan = [];
  const conScrollPropio = el => {
    for (let p = el.parentElement; p && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const cs = getComputedStyle(p);
      if (/(auto|scroll)/.test(cs.overflowX) && p.scrollWidth > p.clientWidth + 1) return true;
      if (p.classList.contains('leaflet-container')) return true;
    }
    return false;
  };
  for (const el of todos) {
    if (!visible(el)) continue;
    const r = el.getBoundingClientRect();
    if ((r.right > vw + 1 || r.left < -1) && !conScrollPropio(el)) {
      // Solo el elemento más externo que se sale (no todos sus hijos)
      if (!desbordan.some(d => d.el.contains(el))) desbordan.push({ el, r });
    }
  }

  // --- Reorganización: palabras partidas entre dos líneas (columna demasiado estrecha para leer bien).
  // Nada se sale del ancho, pero el texto queda roto («configura/do», una letra por línea…).
  const partidas = [];
  const recorrido = document.createTreeWalker(pantalla, NodeFilter.SHOW_TEXT);
  for (let n = recorrido.nextNode(); n; n = recorrido.nextNode()) {
    const el = n.parentElement; if (!el || !n.textContent.trim() || el.closest('svg, .leaflet-container, .mono, code, pre, input, textarea')) continue;
    if (!visible(el)) continue;
    const re = /[A-Za-zÁÉÍÓÚÜÑáéíóúüñ]{4,}/g; let m;
    while ((m = re.exec(n.textContent))) {
      const r = document.createRange(); r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
      const lineas = new Set([...r.getClientRects()].filter(x => x.width > 0).map(x => Math.round(x.top)));
      if (lineas.size > 1) { partidas.push(desc(el) + ` «${m[0]}» partida en ${lineas.size} líneas`); break; }
    }
    if (partidas.length >= 12) break;
  }

  // --- Tamaño de los objetivos táctiles
  const interactivos = todos.filter(el => el.matches('button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [tabindex]:not([tabindex="-1"])') && visible(el));
  const pequenos = [];
  for (const el of interactivos) {
    if (el.closest('.leaflet-container') && !el.closest('.leaflet-control-container')) continue; // marcadores: contenido del mapa
    if (el.tagName === 'A' && el.closest('p, li, dd, td, .small, .note, .leaflet-control-attribution') && !el.classList.contains('btn')) continue; // enlace dentro de un texto o de la atribución del mapa (excepción de la norma)
    let r = el.getBoundingClientRect();
    // Casilla o interruptor dentro de su etiqueta: el objetivo es la etiqueta entera
    const lab = el.matches('input[type=checkbox], input[type=radio]') ? el.closest('label') : null;
    if (lab) r = lab.getBoundingClientRect();
    if (lab && el.matches('.switch input, input.sr-only')) r = lab.getBoundingClientRect();
    if (r.width < 24 - 0.5 || r.height < 24 - 0.5) pequenos.push(desc(lab || el) + ` ${Math.round(r.width)}×${Math.round(r.height)}`);
  }

  // --- Contraste del texto
  // Colores calculados: rgb()/rgba() o color(srgb r g b / a) (lo que devuelve color-mix)
  const rgba = c => {
    let m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (m) { const v = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1]; }
    m = /color\(srgb ([^)]+)\)/.exec(c || '');
    if (m) { const v = m[1].split(/[ /]+/).filter(Boolean).map(Number); return [v[0] * 255, v[1] * 255, v[2] * 255, v.length > 3 ? v[3] : 1]; }
    return [0, 0, 0, 0];
  };
  const mezcla = (a, b) => [0, 1, 2].map(i => a[i] * a[3] + b[i] * (1 - a[3])).concat(1);
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
  const fondo = el => {
    const capas = [];
    for (let e = el; e; e = e.parentElement) {
      if (e.classList && e.classList.contains('leaflet-container')) return null; // sobre el mapa: depende de las teselas
      const cs = getComputedStyle(e);
      if (cs.backgroundImage && cs.backgroundImage !== 'none' && !/gradient/.test(cs.backgroundImage)) return null; // imagen: no se puede medir
      if (/gradient/.test(cs.backgroundImage)) return null;
      const c = rgba(cs.backgroundColor); if (c[3] > 0) { capas.push(c); if (c[3] >= 1) break; }
    }
    let base = rgba(getComputedStyle(document.body).backgroundColor); if (base[3] < 1) base = [255, 255, 255, 1];
    for (const c of capas.reverse()) base = mezcla(c, base);
    return base;
  };
  const bajos = [];
  for (const el of todos) {
    if (!visible(el)) continue;
    if (![...el.childNodes].some(n => n.nodeType === 3 && n.textContent.trim())) continue;
    if (el.closest('[disabled], [aria-disabled="true"], .leaflet-tile-pane')) continue; // controles inactivos: excepción de la norma
    const cs = getComputedStyle(el);
    let op = 1; for (let e = el; e; e = e.parentElement) op *= Number(getComputedStyle(e).opacity);
    if (op < 0.99) continue; // atenuado a propósito (p. ej. inactivo): se informa aparte si hiciera falta
    const bg = fondo(el); if (!bg) continue;
    const fg = mezcla(rgba(cs.color), bg);
    const px = parseFloat(cs.fontSize); const negrita = Number(cs.fontWeight) >= 700;
    const grande = px >= 24 || (negrita && px >= 18.66);
    const minimo = grande ? 3 : 4.5; const r = ratio(fg, bg);
    if (r < minimo - 0.005) bajos.push(desc(el) + ` ${r.toFixed(2)}:1 (mín. ${minimo})`);
  }
  return {
    ancho: vw,
    desbordan: desbordan.map(d => desc(d.el) + ` [${Math.round(d.r.left)}–${Math.round(d.r.right)}]`).slice(0, 12),
    partidas,
    pequenos: [...new Set(pequenos)].slice(0, 30),
    contraste: [...new Set(bajos)].slice(0, 30),
    interactivos: interactivos.length,
  };
}
