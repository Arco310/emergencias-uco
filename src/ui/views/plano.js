// Plano de coordinación operativa (Leaflet). Dos tipos de plano:
//  - cartográfico (zona de mapa importada): posiciones en coordenadas geográficas reales (WGS84);
//  - de imagen (foto o captura, funciona sin Internet): posiciones normalizadas (0…1).
// Las unidades usan el mismo sistema visual que las tarjetas. Arrastrar mueve la unidad (se guarda al
// soltar y llega a los demás dispositivos); doble clic o pulsación larga abre el selector de claves;
// «UNIDADES PENDIENTES DE ASIGNACIÓN» admite arrastrar al plano y desde el plano; avisos por punto o zona.
import { G, A, F, CH, filt } from '../state.js';
import { esc, attr, toast, confirmDlg, btn, empty, pickFile, readBytes, closeSheet, openSheet } from '../dom.js';
import { icon, unitSvg, SIZE_PX } from '../icons.js';
import { now } from '../../core/util.js';
import { liveUnits, unitLabel } from '../../core/engine.js';
import { unitVisual, effectiveVis } from '../../core/visual.js';
import * as C from '../../core/commands.js';
import { geoANorm, normAGeo, hasCoords, fmtCoords, round6 } from '../../core/geo.js';
import { openUnit, openAviso, avisoNumber, nuevoAvisoEn } from './ops.js';
import { L, crearMapa, capaBase, aLatLngBounds, NOMBRE_PROVEEDOR } from '../mapa.js';
import { abrirSelectorMapa, abrirBiblioteca, incorporarAlPreventivo } from './cartografia.js';

const urls = new Map(); const loading = new Set();
const S = () => G.core.state;
const P = () => G.core.state.prev;
const can = p => G.core.can(p);
const editable = () => P().estado !== 'cerrado' && !P().archivado;
const operativo = () => P().estado === 'activo';
const clamp = v => Math.min(1, Math.max(0, v));
let M = null; // mapa vivo: { key, pid, el, map, u: Map, a: Map, z: Map, dibujo }

function blobUrl(id) {
  if (urls.has(id)) return urls.get(id);
  if (!loading.has(id)) {
    loading.add(id);
    G.core.repo.getBlob(id).then(b => {
      loading.delete(id);
      urls.set(id, b ? URL.createObjectURL(new Blob([b.bytes], { type: b.mime || 'image/png' })) : null); G.render();
    }).catch(() => { loading.delete(id); });
  }
  return undefined;
}
const esMapa = pl => !!pl && pl.tipo === 'mapa';

// ---------- coordenadas ----------
/** Posición guardada → punto del mapa */
function aLatLng(pos) {
  const pl = P().plano;
  if (esMapa(pl)) {
    // Coordenadas reales si caen dentro de este plano; si no (se cambió de plano), la posición relativa
    if (pos.lat != null) { const n = geoANorm(pl.bounds, pos.lat, pos.lon); if (n.x >= -0.001 && n.x <= 1.001 && n.y >= -0.001 && n.y <= 1.001) return L.latLng(pos.lat, pos.lon); }
    const g = normAGeo(pl.bounds, pos.x, pos.y); return L.latLng(g.lat, g.lon);
  }
  return L.latLng(-pos.y * pl.h, pos.x * pl.w);
}
/** Punto del mapa → posición a guardar (dentro de los límites del plano) */
function dePunto(ll) {
  const pl = P().plano;
  if (esMapa(pl)) {
    const n = geoANorm(pl.bounds, ll.lat, ll.lng); const x = clamp(n.x), y = clamp(n.y);
    const g = x !== n.x || y !== n.y ? normAGeo(pl.bounds, x, y) : { lat: round6(ll.lat), lon: round6(ll.lng) };
    return { x, y, lat: g.lat, lon: g.lon };
  }
  return { x: clamp(ll.lng / pl.w), y: clamp(-ll.lat / pl.h) };
}
const dentro = ll => { const pl = P().plano; if (esMapa(pl)) { const n = geoANorm(pl.bounds, ll.lat, ll.lng); return n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1; } return ll.lng >= 0 && ll.lng <= pl.w && ll.lat <= 0 && ll.lat >= -pl.h; };
/** Posición del aviso en el plano: la marcada en él o, en planos cartográficos, sus coordenadas */
function posAviso(a) {
  if (a.plan) return a.plan;
  const pl = P().plano;
  if (esMapa(pl) && hasCoords(a.loc)) { const n = geoANorm(pl.bounds, a.loc.lat, a.loc.lon); if (n.x >= 0 && n.x <= 1 && n.y >= 0 && n.y <= 1) return { ...n, lat: a.loc.lat, lon: a.loc.lon }; }
  return null;
}

// ---------- vista ----------
export function renderPlano() {
  const p = P(); const s = S(); const f = filt('plano'); const t = now();
  const canEdit = editable() && can('planos.editar');
  const pl = p.plano;
  const tools = `<div class="toolbar plan-tools">
    ${canEdit ? btn(pl && !esMapa(pl) ? 'Cambiar imagen' : 'Importar imagen', 'plan.import', { ic: 'subir', cls: pl ? '' : 'primary' }) : ''}
    ${canEdit ? btn('Importar desde Google Maps', 'plan.google', { ic: 'mapa', cls: pl ? '' : 'primary' }) : ''}
    ${canEdit ? btn('Biblioteca de planos', 'plan.biblio', { ic: 'capas' }) : ''}
    ${pl && operativo() && can('avisos.crear') ? btn(f.dibujo ? 'Cancelar zona' : 'Aviso por zona', 'plan.zona', { ic: 'zona', cls: f.dibujo ? 'primary' : '' }) : ''}
    ${pl ? `${btn('', 'plan.fit', { ic: 'ajustar', title: 'Ver todo el plano' })}
    <label class="switch sm"><input type="checkbox" data-c="plan.layer" data-v="avisos"${f.hideAvisos ? '' : ' checked'}><span>Avisos</span></label>
    <label class="switch sm"><input type="checkbox" data-c="plan.layer" data-v="labels"${f.hideLabels ? '' : ' checked'}><span>Etiquetas</span></label>` : ''}
  </div>`;
  if (!pl) return tools + empty('No hay plano. Importa una zona de mapa (Google Maps o la biblioteca de planos: conserva las coordenadas reales) o una imagen del recinto (funciona sin Internet).');
  if (!esMapa(pl)) {
    const url = blobUrl(pl.blob);
    if (url === undefined) return tools + `<div class="empty">${icon('plano')}<p>Cargando plano…</p></div>`;
    if (url === null) return tools + empty('La imagen del plano no está en este dispositivo todavía. Se descargará al sincronizar.');
  }
  const pend = liveUnits(s).filter(u => !u.plan && u.sit !== 'archivada');
  const placing = f.place ? s.units[f.place] : null;
  const placingAviso = f.placeAviso ? s.avisos[f.placeAviso] : null;
  const zonas = Object.values(s.avisos).filter(a => a.zona && a.zona.pts && a.zona.pts.length >= 3);
  return `${tools}
  ${placingAviso ? `<div class="banner info">${icon('pin')}<div>Toca en el plano para situar el aviso <b>${esc(avisoNumber(placingAviso))}</b>.</div>${btn('Cancelar', 'plan.cancelPlace', { cls: 'ghost' })}</div>` : ''}
  ${placing ? `<div class="banner info">${icon('pin')}<div>Toca en el plano para colocar <b>${esc(placing.ind)}</b>.</div>${btn('Cancelar', 'plan.cancelPick', { cls: 'ghost' })}</div>` : ''}
  ${f.dibujo ? `<div class="banner info">${icon('zona')}<div>Toca en el plano para marcar los puntos de la zona (${(f.dibujo.pts || []).length} marcados, mínimo 3).</div>
    <div class="row gap-s">${btn('Deshacer punto', 'plan.zonaUndo', { cls: 'ghost sm' })}${btn('Crear aviso en la zona', 'plan.zonaOk', { cls: 'primary sm' })}${zonas.length ? btn('Usar una zona existente', 'plan.zonaExist', { cls: 'ghost sm' }) : ''}</div></div>` : ''}
  <div class="coord">
    <aside class="coord-pend" data-pendientes>
      <h3>Unidades pendientes de asignación <span class="chip sm">${pend.length}</span></h3>
      ${pend.length ? `<div class="pend-list">${pend.map(u => `<button type="button" class="uchip${f.place === u.id ? ' on' : ''}" data-a="plan.pick" data-id="${u.id}" data-arrastre="${u.id}" style="--bc:${attr(u.colorC0)}" title="Arrástrala al plano o tócala y luego toca el plano">${unitSvg(unitVisual(p, u, t), { px: 22 })}${esc(u.ind)}</button>`).join('')}</div>` : '<p class="muted small">Ninguna. Para devolver una unidad aquí, arrástrala desde el plano a este recuadro.</p>'}
    </aside>
    <div class="coord-host" id="coord-host"></div>
  </div>
  <p class="muted small coord-ayuda">${canEdit ? 'Arrastra una unidad para moverla (se guarda al soltar). ' : ''}Doble clic o pulsación larga sobre una unidad: cambiar su clave. ${operativo() && can('avisos.crear') ? 'Toca un punto libre del plano para crear un aviso en él.' : ''}${esMapa(pl) ? ' Plano cartográfico «' + esc(pl.nombre || '') + '» (' + esc(NOMBRE_PROVEEDOR[pl.proveedor] || '') + '), con coordenadas reales.' : ''}</p>
  <div class="legend">${p.cat.claves.map(c => `<span><i style="background:${attr(c.color)}"></i>${esc(c.codigo)} ${esc(c.nombre)}</span>`).join('')}<span><i style="background:#9E9E9E"></i>Descanso</span></div>`;
}

export function afterRender() {
  const host = document.getElementById('coord-host'); if (!host) return;
  const pl = P().plano; const key = G.core.cur + '|' + JSON.stringify(esMapa(pl) ? pl.bounds : [pl.blob, pl.w, pl.h]);
  if (!M || M.key !== key) { destruir(); crear(host, key); }
  else if (M.el.parentNode !== host) { host.appendChild(M.el); M.map.invalidateSize(); }
  sincronizar();
  activarArrastrePendientes();
}
export function destruir() { if (M) { try { M.map.remove(); } catch { } M = null; } }

function crear(host, key) {
  const pl = P().plano;
  const el = document.createElement('div'); el.className = 'coord-map'; host.appendChild(el);
  let map;
  if (esMapa(pl)) {
    const b = aLatLngBounds(pl.bounds);
    map = crearMapa(el, { bounds: pl.bounds, minZoom: Math.max(3, (pl.zoom || 16) - 4), maxBounds: b.pad(2) });
    // Las teselas vistas se guardan para trabajar sin conexión; más allá de su detalle se amplían las guardadas
    capaBase(map, { maxNativeZoom: Math.max(17, (pl.zoom || 16) + 2) });
    L.rectangle(b, { color: '#C62828', weight: 2, fill: false, dashArray: '6 5', interactive: false }).addTo(map);
  } else {
    map = L.map(el, { crs: L.CRS.Simple, minZoom: -6, maxZoom: 4, zoomSnap: 0.25, doubleClickZoom: false, attributionControl: false });
    const b = [[-pl.h, 0], [0, pl.w]];
    L.imageOverlay(urls.get(pl.blob), b, { className: 'plano-img' }).addTo(map);
    map.fitBounds(b, { animate: false }); map.setMaxBounds(L.latLngBounds(b).pad(0.6));
  }
  M = { key, pid: G.core.cur, el, map, u: new Map(), a: new Map(), z: new Map(), dibujo: null, movido: false };
  map.on('click', clicMapa);
  map.on('dragstart zoomstart', ev => { if (ev && ev.hard !== true) M && (M.movido = true); });
  // El tamaño definitivo del contenedor se conoce tras maquetar: se vuelve a encuadrar el plano completo
  setTimeout(() => { if (!M || M.map !== map) return; map.invalidateSize(); if (!M.movido && !filt('plano').focus) A['plan.fit'](); M.movido = false; }, 250);
  const f = filt('plano');
  if (f.focus) { const u = S().units[f.focus]; if (u && u.plan) map.setView(aLatLng(u.plan), Math.max(map.getZoom(), esMapa(pl) ? 18 : 0)); }
}

// ---------- marcadores ----------
function iconoUnidad(u) {
  const p = P(); const f = filt('plano'); const v = unitVisual(p, u, now()); const vis = effectiveVis(p, u);
  const px = SIZE_PX[v.tam] || 38;
  const label = f.hideLabels || vis.etiqueta === 'ninguna' ? '' : vis.etiqueta === 'nombre' ? (u.nombre || u.ind) : vis.etiqueta === 'ambos' ? u.ind + (u.nombre ? ' · ' + u.nombre : '') : u.ind;
  const html = `<div class="mk${f.focus === u.id ? ' focus' : ''}" data-mk="u" data-id="${u.id}">${unitSvg(v, { px, title: unitLabel(u) + ' · ' + u.clave })}${label ? `<span class="mk-l">${esc(label)}</span>` : ''}</div>`;
  return { html, px };
}
function sincronizar() {
  if (!M) return;
  const s = S(); const p = P(); const f = filt('plano');
  const puede = editable() && can('planos.editar');
  const vivos = new Set();
  for (const u of liveUnits(s)) {
    if (!u.plan || u.sit === 'archivada' || effectiveVis(p, u).enPlano === false) continue;
    vivos.add(u.id);
    const { html, px } = iconoUnidad(u); const sig = html + JSON.stringify(u.plan) + puede;
    let m = M.u.get(u.id);
    if (!m) {
      m = L.marker(aLatLng(u.plan), { icon: L.divIcon({ html, className: 'mk-wrap', iconSize: [px, px], iconAnchor: [px / 2, px / 2] }), draggable: puede, keyboard: false, autoPan: true, riseOnHover: true });
      eventosUnidad(m, u.id); m.addTo(M.map); M.u.set(u.id, m);
    } else if (m._sig !== sig && !m._arrastrando) {
      m.setLatLng(aLatLng(u.plan)); m.setIcon(L.divIcon({ html, className: 'mk-wrap', iconSize: [px, px], iconAnchor: [px / 2, px / 2] }));
      if (m.dragging) puede ? m.dragging.enable() : m.dragging.disable();
    }
    m._sig = sig;
  }
  for (const [id, m] of M.u) if (!vivos.has(id)) { m.remove(); M.u.delete(id); }
  // Avisos: punto y zona
  const av = new Set(); const zs = new Set();
  if (!f.hideAvisos) for (const a of Object.values(s.avisos)) {
    if (a.estado === 'finalizado') continue;
    const pos = posAviso(a);
    if (pos) {
      av.add(a.id); const html = `<div class="mk av est-${a.estado}" data-mk="a" data-id="${a.id}"><span class="mk-av">!</span><span class="mk-l">${esc(avisoNumber(a))}</span></div>`;
      let m = M.a.get(a.id); const sig = html + JSON.stringify(pos);
      if (!m) { m = L.marker(aLatLng(pos), { icon: L.divIcon({ html, className: 'mk-wrap', iconSize: [30, 30], iconAnchor: [15, 15] }), keyboard: false, zIndexOffset: 500 }); m.on('click', () => openAviso(a.id)); m.addTo(M.map); M.a.set(a.id, m); }
      else if (m._sig !== sig) { m.setLatLng(aLatLng(pos)); m.setIcon(L.divIcon({ html, className: 'mk-wrap', iconSize: [30, 30], iconAnchor: [15, 15] })); }
      m._sig = sig;
    }
    if (a.zona && a.zona.pts && a.zona.pts.length >= 3) {
      zs.add(a.id); const col = a.estado === 'en_curso' ? '#1565C0' : a.estado === 'asignado' ? '#B26A00' : '#C62828';
      let z = M.z.get(a.id); const lls = a.zona.pts.map(aLatLng); const sig = JSON.stringify(a.zona.pts) + col;
      if (!z) { z = L.polygon(lls, { color: col, weight: 2, fillOpacity: 0.15, bubblingMouseEvents: false }); z.on('click', () => { if (!filt('plano').dibujo) openAviso(a.id); }); z.bindTooltip('Aviso ' + avisoNumber(a)); z.addTo(M.map); M.z.set(a.id, z); }
      else if (z._sig !== sig) { z.setLatLngs(lls); z.setStyle({ color: col }); }
      z._sig = sig;
    }
  }
  for (const [id, m] of M.a) if (!av.has(id)) { m.remove(); M.a.delete(id); }
  for (const [id, z] of M.z) if (!zs.has(id)) { z.remove(); M.z.delete(id); }
  dibujarBorrador();
}
function eventosUnidad(m, id) {
  let clicT = null;
  m.on('click', () => { clearTimeout(clicT); clicT = setTimeout(() => openUnit(id), 260); });
  m.on('dblclick', ev => { clearTimeout(clicT); L.DomEvent.stop(ev); selectorClave(id); });
  m.on('contextmenu', ev => { clearTimeout(clicT); if (ev.originalEvent) ev.originalEvent.preventDefault(); selectorClave(id); });
  let ultimo = null; const seguir = ev => { ultimo = ev; };
  m.on('dragstart', () => { m._arrastrando = true; const e = m.getElement(); if (e) e.classList.add('arrastrando'); document.addEventListener('pointermove', seguir, true); });
  m.on('dragend', async () => {
    document.removeEventListener('pointermove', seguir, true);
    const e = m.getElement(); if (e) e.classList.remove('arrastrando');
    try {
      // Soltada sobre «Unidades pendientes de asignación»: vuelve a quedar pendiente
      const pend = document.querySelector('[data-pendientes]');
      if (pend && ultimo) { const r = pend.getBoundingClientRect(); if (ultimo.clientX >= r.left && ultimo.clientX <= r.right && ultimo.clientY >= r.top && ultimo.clientY <= r.bottom) { await G.core.exec(C.unitPlan, id, null); toast(unitLabel(S().units[id]) + ': pendiente de asignación', 'ok'); return; } }
      const ll = m.getLatLng();
      if (!dentro(ll)) toast('Fuera del plano: se coloca en el borde', 'warn');
      await G.core.exec(C.unitPlan, id, dePunto(ll));
    } catch (err) { toast(err.message, 'error'); }
    finally { m._arrastrando = false; m._sig = null; G.render(); }
  });
}

// ---------- clic en el plano: colocar, situar avisos, dibujar zonas o crear aviso ----------
async function clicMapa(ev) {
  const f = filt('plano'); const ll = ev.latlng;
  try {
    if (!dentro(ll)) { if (f.place || f.placeAviso || f.dibujo) toast('Toca dentro del plano', 'warn'); return; }
    if (f.dibujo) { f.dibujo.pts.push(dePunto(ll)); G.render(); return; }
    if (f.placeAviso) { const id = f.placeAviso; f.placeAviso = null; await G.core.exec(C.avisoPlan, id, dePunto(ll)); toast('Aviso situado en el plano', 'ok'); openAviso(id); return; }
    if (f.place) {
      const id = f.place; await G.core.exec(C.unitPlan, id, dePunto(ll));
      const next = liveUnits(S()).find(u => !u.plan && u.sit !== 'archivada' && u.id !== id);
      f.place = next ? next.id : null; G.render(); return;
    }
    if (!operativo() || !can('avisos.crear')) return;
    // Crear un aviso en el punto tocado
    const pos = dePunto(ll);
    const pop = L.popup({ closeButton: true, autoPan: true }).setLatLng(ll)
      .setContent(`<div class="pop-aviso"><b>${esMapa(P().plano) ? esc(fmtCoords({ lat: pos.lat, lon: pos.lon })) : 'Punto del plano'}</b><button type="button" class="btn primary sm" data-pop="aviso">${icon('avisos')}<span>Crear aviso aquí</span></button></div>`)
      .openOn(M.map);
    const b = pop.getElement() && pop.getElement().querySelector('[data-pop="aviso"]');
    if (b) b.addEventListener('click', () => { M.map.closePopup(); nuevoAvisoEn({ plan: pos, loc: esMapa(P().plano) ? { txt: '', lat: pos.lat, lon: pos.lon } : null }); });
  } catch (e) { toast(e.message, 'error'); }
}
/** Zona que se está dibujando (polígono provisional con sus vértices) */
function dibujarBorrador() {
  const f = filt('plano'); if (!M) return;
  if (M.dibujo) { M.dibujo.remove(); M.dibujo = null; }
  if (f.dibujo && f.dibujo.pts.length) {
    const lls = f.dibujo.pts.map(aLatLng); const st = { color: '#6A1B9A', weight: 2, dashArray: '5 4', interactive: false };
    M.dibujo = L.featureGroup([lls.length >= 3 ? L.polygon(lls, { ...st, fillOpacity: 0.12 }) : L.polyline(lls, st), ...lls.map(ll => L.circleMarker(ll, { radius: 5, color: '#6A1B9A', fillOpacity: 1, interactive: false }))]).addTo(M.map);
  }
}

// ---------- selector de claves (doble clic / pulsación larga) ----------
function selectorClave(id) {
  const s = S(); const u = s.units[id]; const p = P(); if (!u) return;
  const permitidas = new Set(C.allowedTransitions(s, u));
  const puede = can('estados.cambiar') && operativo() && u.sit === 'activa';
  openSheet({
    title: unitLabel(u) + ' · clave ' + u.clave, size: 's',
    render: () => `${puede ? `<p class="muted small">Elige la nueva clave. Se aplican las mismas reglas que en el resto de la aplicación.</p>
      <div class="claves-grid">${p.cat.claves.map(c => `<button type="button" class="btn clave-btn${c.codigo === u.clave ? ' actual' : ''}${permitidas.has(c.codigo) ? '' : ' no-perm'}" data-a="u.clave" data-id="${u.id}" data-k="${attr(c.codigo)}" style="--kc:${attr(c.color)}"${c.codigo === u.clave ? ' disabled' : ''}><b>${esc(c.codigo)}</b><small>${esc(c.nombre)}</small></button>`).join('')}</div>`
      : `<p class="note">${icon('candado')} ${u.sit !== 'activa' ? 'La unidad no está activa.' : !operativo() ? 'El preventivo no está activo.' : 'No tienes permiso para cambiar claves.'}</p>`}
      <div class="row gap wrap">${btn('Ver ficha', 'plan.ficha', { data: { id } })}${editable() && can('planos.editar') && u.plan ? btn('Quitar del plano (pendiente de asignación)', 'plan.quitar', { cls: 'ghost', data: { id } }) : ''}</div>`,
  });
}
A['plan.ficha'] = el => { closeSheet(); openUnit(el.dataset.id); };
A['plan.quitar'] = async el => { closeSheet(); await G.core.exec(C.unitPlan, el.dataset.id, null); toast(unitLabel(S().units[el.dataset.id]) + ': pendiente de asignación', 'ok'); };

// ---------- unidades pendientes: arrastrar al plano ----------
function activarArrastrePendientes() {
  if (!(editable() && can('planos.editar'))) return;
  for (const chip of document.querySelectorAll('[data-arrastre]')) {
    if (chip._arr) continue; chip._arr = true;
    chip.addEventListener('pointerdown', ev => {
      if (ev.button !== 0) return;
      const id = chip.dataset.arrastre; const x0 = ev.clientX, y0 = ev.clientY; let ghost = null;
      const mover = e => {
        if (!ghost && Math.hypot(e.clientX - x0, e.clientY - y0) < 8) return;
        if (!ghost) { ghost = chip.cloneNode(true); ghost.classList.add('ghost-arrastre'); document.body.appendChild(ghost); chip.classList.add('arrastrando'); }
        ghost.style.left = e.clientX + 'px'; ghost.style.top = e.clientY + 'px';
      };
      const soltar = async e => {
        document.removeEventListener('pointermove', mover, true); document.removeEventListener('pointerup', soltar, true); document.removeEventListener('pointercancel', soltar, true);
        if (!ghost) return; // fue un toque: lo gestiona «plan.pick»
        ghost.remove(); chip.classList.remove('arrastrando'); chip._soltado = Date.now();
        if (!M) return; const r = M.el.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
        const ll = M.map.containerPointToLatLng([e.clientX - r.left, e.clientY - r.top]);
        if (!dentro(ll)) { toast('Suéltala dentro del plano', 'warn'); return; }
        try { await G.core.exec(C.unitPlan, id, dePunto(ll)); toast(unitLabel(S().units[id]) + ' colocada en el plano', 'ok'); } catch (err) { toast(err.message, 'error'); }
      };
      document.addEventListener('pointermove', mover, true); document.addEventListener('pointerup', soltar, true); document.addEventListener('pointercancel', soltar, true);
    });
  }
}

// ---------- acciones ----------
A['plan.fit'] = () => { filt('plano').focus = null; if (!M) return; const pl = P().plano; M.map.fitBounds(esMapa(pl) ? aLatLngBounds(pl.bounds) : [[-pl.h, 0], [0, pl.w]]); };
A['plan.pick'] = el => { const ch = document.querySelector(`[data-arrastre="${el.dataset.id}"]`); if (ch && ch._soltado && Date.now() - ch._soltado < 400) return; const f = filt('plano'); f.place = f.place === el.dataset.id ? null : el.dataset.id; G.render(); };
A['plan.cancelPick'] = () => { filt('plano').place = null; G.render(); };
A['plan.cancelPlace'] = () => { filt('plano').placeAviso = null; G.render(); };
CH['plan.layer'] = el => { const f = filt('plano'); if (el.dataset.v === 'avisos') f.hideAvisos = !el.checked; else f.hideLabels = !el.checked; if (M) { for (const m of M.u.values()) m._sig = null; } G.render(); };
A['plan.zona'] = () => { const f = filt('plano'); f.dibujo = f.dibujo ? null : { pts: [] }; f.place = null; G.render(); };
A['plan.zonaUndo'] = () => { const f = filt('plano'); if (f.dibujo) { f.dibujo.pts.pop(); G.render(); } };
A['plan.zonaOk'] = () => {
  const f = filt('plano'); const pts = f.dibujo ? f.dibujo.pts : [];
  if (pts.length < 3) { toast('Marca al menos 3 puntos para delimitar la zona', 'warn'); return; }
  f.dibujo = null; G.render(); crearAvisoZona(pts);
};
A['plan.zonaExist'] = () => {
  const s = S(); const zonas = Object.values(s.avisos).filter(a => a.zona && a.zona.pts && a.zona.pts.length >= 3);
  openSheet({ title: 'Usar una zona existente', size: 's', render: () => `<p class="muted small">Zonas de otros avisos de este preventivo.</p><ul class="cat-list">${zonas.map(a => `<li class="cat-row"><div class="grow"><b>Aviso ${esc(avisoNumber(a))}</b><small class="muted">${esc(a.desc || '')} · ${a.zona.pts.length} puntos</small></div>${btn('Usar', 'plan.zonaUsar', { cls: 'sm primary', data: { id: a.id } })}</li>`).join('')}</ul>` });
};
A['plan.zonaUsar'] = el => { const a = S().avisos[el.dataset.id]; closeSheet(); filt('plano').dibujo = null; G.render(); crearAvisoZona(a.zona.pts.map(p => ({ ...p }))); };
function crearAvisoZona(pts) {
  // Ubicación del aviso: el centro de la zona
  const cx = pts.reduce((t, p) => t + p.x, 0) / pts.length, cy = pts.reduce((t, p) => t + p.y, 0) / pts.length;
  const pl = P().plano; const g = esMapa(pl) ? normAGeo(pl.bounds, cx, cy) : null;
  nuevoAvisoEn({ plan: { x: cx, y: cy, ...(g || {}) }, loc: g ? { txt: '', lat: g.lat, lon: g.lon } : null, zona: { pts } });
}
A['plan.google'] = () => abrirSelectorMapa({ onConfirm: async r => { if (await incorporarAlPreventivo(r)) { filt('plano').focus = null; G.render(); } } });
A['plan.biblio'] = () => abrirBiblioteca({ onElegir: async r => { if (await incorporarAlPreventivo(r)) G.render(); } });
A['plan.import'] = async () => {
  const file = await pickFile('image/*'); if (!file) return;
  if (P().plano && !(await confirmDlg({ title: 'Cambiar plano', text: 'El plano actual se sustituye; las posiciones relativas de las unidades se conservan. El cambio queda registrado.', ok: 'Cambiar' }))) return;
  const { bytes, w, h, mime } = await prepareImage(file);
  const id = await G.core.repo.putBlob(bytes, { mime, w, h, nombre: file.name });
  await G.core.exec(C.planoSet, { blob: id, w, h, mime, nombre: file.name });
  toast('Plano importado', 'ok'); G.render();
};
/** Reduce imágenes muy grandes para no saturar el almacenamiento del dispositivo */
async function prepareImage(file) {
  const raw = await readBytes(file);
  const bmp = await createImageBitmap(new Blob([raw], { type: file.type || 'image/png' }));
  const MAX = 4096; let w = bmp.width, h = bmp.height;
  if (Math.max(w, h) <= MAX && raw.length < 6 * 1024 * 1024) return { bytes: raw, w, h, mime: file.type || 'image/png' };
  const k = Math.min(1, MAX / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.88));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h, mime: 'image/jpeg' };
}
