// Plano de coordinación operativa (Leaflet). Dos tipos de plano:
//  - cartográfico (zona de mapa importada): posiciones en coordenadas geográficas reales (WGS84);
//  - de imagen (foto o captura, funciona sin Internet): posiciones normalizadas (0…1).
// Las unidades usan el mismo sistema visual que las tarjetas. Arrastrar mueve la unidad (se guarda al
// soltar y llega a los demás dispositivos); doble clic o pulsación larga abre el selector de claves;
// «UNIDADES PENDIENTES DE ASIGNACIÓN» admite arrastrar al plano y desde el plano; avisos por punto o zona.
import { G, A, F, CH, filt } from '../state.js';
import { esc, attr, toast, confirmDlg, btn, empty, pickFile, readBytes, closeSheet, openSheet, refreshSheets, fieldsHtml, readForm } from '../dom.js';
import { icon, unitSvg, SIZE_PX } from '../icons.js';
import { now, uid } from '../../core/util.js';
import { liveUnits, unitLabel, unitSituation, SITUACION_LABEL, sectorNombre, activeParts } from '../../core/engine.js';
import { normalizarFiltros, filtrosActivos, filtrarUnidades, filtrarAvisos, sectoresVisibles, puntosVisibles, leyenda, agrupar, categoriasPunto, centroide, DISPONIBILIDAD, simboloDisponibilidad, GRUPOS_PUNTO, sectorDePunto } from '../../core/capas.js';
import { unitVisual, effectiveVis } from '../../core/visual.js';
import * as C from '../../core/commands.js';
import { geoANorm, normAGeo, hasCoords, fmtCoords, round6, haversineKm } from '../../core/geo.js';
import { openUnit, openAviso, avisoNumber, nuevoAvisoEn } from './ops.js';
import { L, crearMapa, capaBase, aLatLngBounds, NOMBRE_PROVEEDOR, proveedor } from '../mapa.js';
import { VISTAS_MAPA, VISTA_DEFECTO, nombreVista } from '../../core/mapas.js';
import { abrirSelectorMapa, abrirBiblioteca, incorporarAlPreventivo } from './cartografia.js';
import { etiquetaTipoAviso } from '../../core/incidentes.js';
import { AVISO_ESTADO } from '../../core/timeline.js';

const urls = new Map(); const loading = new Set();
const S = () => G.core.state;
const P = () => G.core.state.prev;
const can = p => G.core.can(p);
const editable = () => P().estado !== 'cerrado' && !P().archivado;
const operativo = () => P().estado === 'activo';
const clamp = v => Math.min(1, Math.max(0, v));
let M = null; // mapa vivo: { key, pid, el, map, u: Map, a: Map, z: Map, s: Map, p: Map, g: grupo, dibujo }

// Capas y filtros: preferencias de visualización de cada persona en este dispositivo, por preventivo.
// No cambian los datos ni lo que ven los demás; ocultar no es desactivar ni eliminar.
const VISTA = new Map(); const TOCADA = new Set();
export function filtrosPlano() {
  const pid = G.core.cur;
  if (!VISTA.has(pid)) {
    VISTA.set(pid, normalizarFiltros({}));
    G.core.repo.getDoc('vista:' + pid, null).then(v => { if (v && !TOCADA.has(pid)) { VISTA.set(pid, normalizarFiltros(v)); G.render(); refreshSheets(); } }).catch(() => { });
  }
  return VISTA.get(pid);
}
function guardarFiltros(fl) {
  const pid = G.core.cur; TOCADA.add(pid); VISTA.set(pid, normalizarFiltros(fl));
  G.core.repo.putDoc('vista:' + pid, VISTA.get(pid)).catch(() => { });
  G.render(); refreshSheets();
}

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
/** Tipo de mapa elegido para este preventivo (solo planos cartográficos) */
const vistaActual = () => (P().cfg && P().cfg.vistaMapa) || VISTA_DEFECTO;
const puedeVista = () => editable() && (can('planos.vista') || can('planos.editar'));

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
  const pl = p.plano; const fl = filtrosPlano(); const nfl = filtrosActivos(fl);
  const tools = `<div class="toolbar plan-tools">
    <!-- primero lo operativo; configurar el plano, al final (en el móvil la barra es una sola fila desplazable) -->
    ${pl && operativo() && can('avisos.crear') ? btn(f.marcarAviso || f.nuevoAviso ? 'Cancelar el aviso' : 'Nuevo aviso en el mapa', f.marcarAviso || f.nuevoAviso ? 'plan.avisoCancelar' : 'plan.avisoMapa', { ic: 'avisos', cls: f.marcarAviso || f.nuevoAviso ? 'primary' : '' }) : ''}
    ${pl && operativo() && can('avisos.crear') ? btn(f.dibujo ? 'Cancelar zona' : 'Aviso por zona', 'plan.zona', { ic: 'zona', cls: f.dibujo ? 'primary' : '' }) : ''}
    ${pl ? `${btn('', 'plan.fit', { ic: 'ajustar', title: 'Ver todo el plano' })}
    ${btn('Capas y filtros' + (nfl ? ' · ' + nfl : ''), 'plan.capas', { ic: 'filtro', cls: nfl ? 'primary' : '', title: nfl ? nfl + ' filtro(s) activo(s)' : 'Elegir qué se ve en el plano' })}
    ${nfl ? btn('Restablecer', 'plan.restablecer', { cls: 'ghost sm', title: 'Volver a ver todo' }) : ''}
    ${btn('Lista', 'plan.lista', { ic: 'lista', title: 'Los elementos del plano en una lista (alternativa al mapa)' })}
    <label class="switch sm"><input type="checkbox" data-c="plan.capa" data-v="avisos"${fl.capas.avisos ? ' checked' : ''}><span>Avisos</span></label>
    <label class="switch sm"><input type="checkbox" data-c="plan.capa" data-v="etiquetas"${fl.capas.etiquetas ? ' checked' : ''}><span>Etiquetas</span></label>` : ''}
    ${esMapa(pl) ? btn(nombreVista(vistaActual()), 'plan.vista', { ic: 'capas', title: 'Tipo de mapa: estándar, satélite, híbrido o relieve', disabled: !puedeVista(), cls: 'vista-btn' }) : ''}
    ${canEdit ? btn(pl && !esMapa(pl) ? 'Cambiar imagen' : 'Importar imagen', 'plan.import', { ic: 'subir', cls: pl ? '' : 'primary' }) : ''}
    ${canEdit ? btn('Importar desde Google Maps', 'plan.google', { ic: 'mapa', cls: pl ? '' : 'primary' }) : ''}
    ${canEdit ? btn('Biblioteca de planos', 'plan.biblio', { ic: 'capas' }) : ''}
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
  ${f.dibujo ? `<div class="banner info">${icon('zona')}<div>${f.dibujo.para ? `Toca en el plano para delimitar <b>${esc(f.dibujo.para.nombre)}</b>` : 'Toca en el plano para marcar los puntos de la zona'} (${(f.dibujo.pts || []).length} marcados, mínimo 3).</div>
    <div class="row gap-s">${btn('Deshacer punto', 'plan.zonaUndo', { cls: 'ghost sm' })}${btn(f.dibujo.para ? 'Guardar delimitación' : 'Crear aviso en la zona', 'plan.zonaOk', { cls: 'primary sm' })}${!f.dibujo.para && zonas.length ? btn('Usar una zona existente', 'plan.zonaExist', { cls: 'ghost sm' }) : ''}${f.dibujo.para ? btn('Cancelar', 'plan.zona', { cls: 'ghost sm' }) : ''}</div></div>` : ''}
  ${f.marcarAviso && !f.nuevoAviso ? `<div class="banner info">${icon('avisos')}<div>Toca en el plano el lugar del aviso. ¿Prefieres no usar el mapa? Indica la dirección, un sector, un punto del plano o las coordenadas en el formulario.</div><div class="row gap-s">${btn('Sin el mapa', 'plan.avisoSinMapa', { cls: 'sm' })}${btn('Cancelar', 'plan.avisoCancelar', { cls: 'ghost sm' })}</div></div>` : ''}
  ${f.nuevoAviso ? bannerAvisoProvisional(f) : ''}
  ${f.situarPunto ? `<div class="banner info">${icon('pin')}<div>Toca en el plano para situar <b>${esc(f.situarPunto.nombre)}</b>.</div>${btn('Cancelar', 'plan.puntoCancelar', { cls: 'ghost' })}</div>` : ''}
  <div class="coord">
    <aside class="coord-pend" data-pendientes>
      <h3>Unidades pendientes de asignación <span class="chip sm">${pend.length}</span></h3>
      ${pend.length ? `<div class="pend-list">${pend.map(u => `<button type="button" class="uchip${f.place === u.id ? ' on' : ''}" data-a="plan.pick" data-id="${u.id}" data-arrastre="${u.id}" style="--bc:${attr(u.colorC0)}" title="Arrástrala al plano o tócala y luego toca el plano">${unitSvg(unitVisual(p, u, t), { px: 22 })}${esc(u.ind)}</button>`).join('')}</div>` : '<p class="muted small">Ninguna. Para devolver una unidad aquí, arrástrala desde el plano a este recuadro.</p>'}
    </aside>
    <div class="coord-host" id="coord-host">${tarjetaMapa()}</div>
  </div>
  <p class="muted small coord-ayuda">${canEdit ? 'Arrastra una unidad para moverla (se guarda al soltar). ' : ''}Doble clic o pulsación larga sobre una unidad: cambiar su clave. ${operativo() && can('avisos.crear') ? 'Toca un punto libre del plano para crear un aviso en él.' : ''}${esMapa(pl) ? ' Plano cartográfico «' + esc(pl.nombre || '') + '» (' + esc(NOMBRE_PROVEEDOR[pl.proveedor] || '') + '), con coordenadas reales. Vista: ' + esc(nombreVista(vistaActual())) + '.' : ' Plano de imagen: no tiene vistas de mapa (satélite, relieve…); para usarlas, importa una zona de mapa.'}</p>
  ${leyendaHtml(p, fl)}`;
}

export function afterRender() {
  const host = document.getElementById('coord-host'); if (!host) return;
  const pl = P().plano; const key = G.core.cur + '|' + JSON.stringify(esMapa(pl) ? pl.bounds : [pl.blob, pl.w, pl.h]);
  if (!M || M.key !== key) { destruir(); crear(host, key); }
  else if (M.el.parentNode !== host) { host.appendChild(M.el); M.map.invalidateSize(); }
  if (esMapa(pl) && M.vista !== vistaActual()) cambiarVista();
  sincronizar();
  activarArrastrePendientes();
}
export function destruir() { if (M) { try { if (M.base) M.base.quitar(); M.map.remove(); } catch { } M = null; } }

function crear(host, key) {
  const pl = P().plano;
  const el = document.createElement('div'); el.className = 'coord-map'; host.appendChild(el);
  let map;
  if (esMapa(pl)) {
    const b = aLatLngBounds(pl.bounds);
    map = crearMapa(el, { bounds: pl.bounds, minZoom: Math.max(3, (pl.zoom || 16) - 4), maxBounds: b.pad(2) });
    // Las teselas vistas se guardan para trabajar sin conexión; más allá de su detalle se amplían las guardadas.
    // El fondo depende del tipo de mapa del preventivo (se cambia sin rehacer el mapa ni tocar los marcadores).
    L.rectangle(b, { color: '#C62828', weight: 2, fill: false, dashArray: '6 5', interactive: false }).addTo(map);
  } else {
    map = L.map(el, { crs: L.CRS.Simple, minZoom: -6, maxZoom: 4, zoomSnap: 0.25, doubleClickZoom: false, attributionControl: false });
    const b = [[-pl.h, 0], [0, pl.w]];
    L.imageOverlay(urls.get(pl.blob), b, { className: 'plano-img' }).addTo(map);
    map.fitBounds(b, { animate: false }); map.setMaxBounds(L.latLngBounds(b).pad(0.6));
  }
  M = { key, pid: G.core.cur, el, map, u: new Map(), a: new Map(), z: new Map(), s: new Map(), p: new Map(), g: L.layerGroup().addTo(map), dibujo: null, movido: false, vista: null, base: null };
  map.on('zoomend', () => sincronizar()); // la agrupación depende del zoom
  if (esMapa(pl)) cambiarVista();
  map.on('click', clicMapa);
  map.on('dragstart zoomstart', ev => { if (ev && ev.hard !== true) M && (M.movido = true); });
  // El tamaño definitivo del contenedor se conoce tras maquetar: se vuelve a encuadrar el plano completo
  setTimeout(() => { if (!M || M.map !== map) return; map.invalidateSize(); if (!M.movido && !filt('plano').focus) A['plan.fit'](); M.movido = false; }, 250);
  const f = filt('plano');
  if (f.focus) { const u = S().units[f.focus]; if (u && u.plan) map.setView(aLatLng(u.plan), Math.max(map.getZoom(), esMapa(pl) ? 18 : 0)); }
}

/** Pone el fondo del tipo de mapa elegido (quita el anterior). Las capas de unidades, avisos y zonas no cambian. */
function cambiarVista() {
  if (!M) return;
  const m = M; const vista = vistaActual(); const pl = P().plano;
  m.vista = vista;
  const anterior = m.base; m.base = null;
  capaBase(m.map, { maxNativeZoom: Math.max(17, (pl.zoom || 16) + 2), vista }).then(b => {
    if (M !== m || m.vista !== vista) { b.quitar(); return; } // el mapa o la vista cambiaron mientras se cargaba
    if (anterior) anterior.quitar();
    m.base = b;
  }).catch(e => console.warn('Tipo de mapa', e));
}
A['plan.vista'] = () => {
  const actual = vistaActual(); const prov = proveedor();
  openSheet({
    title: 'Tipo de mapa', size: 's',
    render: () => `<div class="vistas">${VISTAS_MAPA.map(v => `<button type="button" class="vista${v.id === actual ? ' on' : ''}" data-a="plan.vistaSel" data-v="${v.id}" aria-pressed="${v.id === actual}">
        <span class="vista-img v-${v.id}" aria-hidden="true"></span><b>${esc(v.nombre)}</b><small class="muted">${esc(v.desc)}</small></button>`).join('')}</div>
      <p class="muted small">${prov === 'google' ? 'Fondos de Google Maps (clave configurada en Configuración general).' : 'Mapa de OpenStreetMap; satélite, híbrido y relieve del Instituto Geográfico Nacional (gratuitos, solo España).'} Solo cambia el fondo de este preventivo, en todos sus dispositivos: las posiciones, los avisos y los sectores no cambian.</p>`,
  });
};
A['plan.vistaSel'] = async el => {
  const v = el.dataset.v; closeSheet();
  const ops = await G.core.exec(C.prevVistaMapa, v);
  if (ops.length) toast('Tipo de mapa: ' + nombreVista(v), 'ok');
};

// ---------- marcadores ----------
function iconoUnidad(u) {
  const p = P(); const f = filt('plano'); const v = unitVisual(p, u, now()); const vis = effectiveVis(p, u);
  const px = SIZE_PX[v.tam] || 38;
  const label = !filtrosPlano().capas.etiquetas || vis.etiqueta === 'ninguna' ? '' : vis.etiqueta === 'nombre' ? (u.nombre || u.ind) : vis.etiqueta === 'ambos' ? u.ind + (u.nombre ? ' · ' + u.nombre : '') : u.ind;
  // Disponibilidad con símbolo (no solo color): ocupada, descanso, clave especial, fuera de servicio
  const sit = unitSituation(S(), u, now()); const sim = sit === 'disponible' ? '' : simboloDisponibilidad(sit);
  const html = `<div class="mk${f.focus === u.id ? ' focus' : ''}${f.sel && f.sel.id === u.id ? ' sel' : ''}" data-mk="u" data-id="${u.id}" data-sit="${sit}">${unitSvg(v, { px, title: unitLabel(u) + ' · ' + u.clave + ' · ' + (SITUACION_LABEL[sit] || sit) })}${sim ? `<span class="mk-disp d-${sit}" aria-hidden="true">${sim}</span>` : ''}${label ? `<span class="mk-l">${esc(label)}</span>` : ''}</div>`;
  return { html, px };
}
function sincronizar() {
  if (!M) return;
  const s = S(); const p = P(); const f = filt('plano'); const fl = filtrosPlano(); const t = now();
  const puede = editable() && can('planos.editar');
  // 1) Qué se ve según capas y filtros (los datos no cambian)
  const uVis = filtrarUnidades(s, fl, t).filter(u => u.plan && effectiveVis(p, u).enPlano !== false);
  const aVis = filtrarAvisos(s, fl);
  const ptVis = puntosVisibles(p, fl);
  // 2) Agrupación cuando hay muchos elementos: por rejilla de pantalla (nunca la unidad que se arrastra ni la seleccionada)
  const candidatos = [];
  for (const u of uVis) { const m = M.u.get(u.id); if (!(m && m._arrastrando) && !(f.sel && f.sel.id === u.id) && f.focus !== u.id) candidatos.push({ id: 'u:' + u.id, ll: aLatLng(u.plan) }); }
  for (const a of aVis) { const pos = posAviso(a); if (pos) candidatos.push({ id: 'a:' + a.id, ll: aLatLng(pos) }); }
  for (const pt of ptVis) if (pt.pos) candidatos.push({ id: 'p:' + pt.id, ll: aLatLng(pt.pos) });
  const ag = agrupar(candidatos.map(c => { const q = M.map.latLngToContainerPoint(c.ll); return { id: c.id, x: q.x, y: q.y, ll: c.ll }; }), { celda: 56, umbral: UMBRAL_AGRUPAR });
  const agrupados = new Set(ag.grupos.flatMap(g => g.ids));
  // 3) Unidades
  const vivos = new Set();
  for (const u of uVis) {
    if (agrupados.has('u:' + u.id)) continue;
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
  for (const [id, m] of M.u) if (!vivos.has(id) && !m._arrastrando) { m.remove(); M.u.delete(id); }
  // 4) Avisos: punto y zona (los finalizados, solo si se piden, en gris y con borde discontinuo)
  const av = new Set(); const zs = new Set();
  for (const a of aVis) {
    const fin = a.estado === 'finalizado'; const pos = posAviso(a);
    if (pos && !agrupados.has('a:' + a.id)) {
      av.add(a.id);
      const html = `<div class="mk av est-${a.estado}${fin ? ' fin' : ''}${a.num == null && a.ref ? ' prov' : ''}${f.sel && f.sel.id === a.id ? ' sel' : ''}" data-mk="a" data-id="${a.id}" title="Aviso ${attr(avisoNumber(a))}${fin ? ' (finalizado)' : ''}"><span class="mk-av">${fin ? '✓' : '!'}</span><span class="mk-l">${esc(avisoNumber(a))}</span></div>`;
      let m = M.a.get(a.id); const sig = html + JSON.stringify(pos);
      if (!m) { m = L.marker(aLatLng(pos), { icon: L.divIcon({ html, className: 'mk-wrap', iconSize: [30, 30], iconAnchor: [15, 15] }), keyboard: false, zIndexOffset: fin ? 100 : 500 }); m.on('click', () => seleccionar('a', a.id)); m.addTo(M.map); M.a.set(a.id, m); }
      else if (m._sig !== sig) { m.setLatLng(aLatLng(pos)); m.setIcon(L.divIcon({ html, className: 'mk-wrap', iconSize: [30, 30], iconAnchor: [15, 15] })); }
      m._sig = sig;
    }
    if (a.zona && a.zona.pts && a.zona.pts.length >= 3) {
      zs.add(a.id); const col = fin ? '#757575' : a.estado === 'en_curso' ? '#1565C0' : a.estado === 'asignado' ? '#B26A00' : '#C62828';
      let z = M.z.get(a.id); const lls = a.zona.pts.map(aLatLng); const sig = JSON.stringify(a.zona.pts) + col;
      if (!z) { z = L.polygon(lls, { color: col, weight: 2, fillOpacity: fin ? 0.05 : 0.15, dashArray: fin ? '4 4' : null, bubblingMouseEvents: false }); z.on('click', ev => { if (modoColocar()) return clicMapa(ev); seleccionar('a', a.id); }); z.bindTooltip('Aviso ' + avisoNumber(a)); z.addTo(M.map); M.z.set(a.id, z); }
      else if (z._sig !== sig) { z.setLatLngs(lls); z.setStyle({ color: col, dashArray: fin ? '4 4' : null, fillOpacity: fin ? 0.05 : 0.15 }); }
      z._sig = sig;
    }
  }
  for (const [id, m] of M.a) if (!av.has(id)) { m.remove(); M.a.delete(id); }
  for (const [id, z] of M.z) if (!zs.has(id)) { z.remove(); M.z.delete(id); }
  // 5) Sectores con delimitación (color y nombre; se ocultan uno a uno)
  const ss = new Set();
  for (const sec of sectoresVisibles(p, fl)) {
    ss.add(sec.id); const lls = sec.zona.pts.map(aLatLng); const sig = JSON.stringify(sec.zona.pts) + sec.color + sec.nombre + fl.capas.etiquetas;
    let z = M.s.get(sec.id);
    if (z && z._sig !== sig) { z.remove(); z = null; }
    if (!z) {
      const pol = L.polygon(lls, { color: sec.color || '#455A64', weight: 2, dashArray: '8 6', fillOpacity: 0.06, interactive: false });
      z = L.featureGroup([pol, ...(fl.capas.etiquetas ? [etiquetaMapa(centroide(sec.zona.pts), sec.nombre, 'sec-label', () => seleccionar('s', sec.id))] : [])]);
      z.addTo(M.map); pol.bringToBack(); z._sig = sig; M.s.set(sec.id, z);
    }
  }
  for (const [id, z] of M.s) if (!ss.has(id)) { z.remove(); M.s.delete(id); }
  // 6) Puntos de interés y de apoyo (marcador con icono y nombre, o zona)
  const cats = new Map(categoriasPunto(p).map(c => [c.id, c])); const ps = new Set();
  for (const pt of ptVis) {
    if (pt.pos && agrupados.has('p:' + pt.id)) continue;
    const c = cats.get(pt.categoria); ps.add(pt.id);
    const sig = JSON.stringify([pt, c, fl.capas.etiquetas, f.sel && f.sel.id === pt.id]);
    let m = M.p.get(pt.id);
    if (m && m._sig !== sig) { m.remove(); m = null; }
    if (!m) {
      if (pt.zona) {
        m = L.featureGroup([L.polygon(pt.zona.pts.map(aLatLng), { color: c.color, weight: 2, fillOpacity: 0.12, interactive: false }), etiquetaMapa(centroide(pt.zona.pts), fl.capas.etiquetas ? pt.nombre : c.nombre, 'poi-label', () => seleccionar('p', pt.id))]);
      } else {
        const html = `<div class="mk poi${f.sel && f.sel.id === pt.id ? ' sel' : ''}" data-mk="p" data-id="${pt.id}" style="--pc:${attr(c.color)}" title="${attr(pt.nombre + ' · ' + c.nombre)}"><span class="mk-poi">${icon(c.icono || 'pin')}</span>${fl.capas.etiquetas ? `<span class="mk-l">${esc(pt.nombre)}</span>` : ''}</div>`;
        m = L.marker(aLatLng(pt.pos), { icon: L.divIcon({ html, className: 'mk-wrap', iconSize: [28, 28], iconAnchor: [14, 14] }), keyboard: false, zIndexOffset: 200 });
      }
      if (!pt.zona) m.on('click', ev => { if (modoColocar()) return clicMapa(ev); seleccionar('p', pt.id); });
      m.addTo(M.map); m._sig = sig; M.p.set(pt.id, m);
    }
  }
  for (const [id, m] of M.p) if (!ps.has(id)) { m.remove(); M.p.delete(id); }
  // 7) Grupos: número de elementos; al tocarlo se acerca
  M.g.clearLayers();
  for (const g of ag.grupos) {
    const lls = g.ids.map(id => candidatos.find(c => c.id === id).ll); const b = L.latLngBounds(lls);
    const tipos = new Set(g.ids.map(id => id[0]));
    const m = L.marker(b.getCenter(), { icon: L.divIcon({ html: `<div class="mk grupo" title="${g.n} elementos: acércate para verlos">${g.n}</div>`, className: 'mk-wrap', iconSize: [40, 40], iconAnchor: [20, 20] }), keyboard: false, zIndexOffset: 800 });
    m._tipos = [...tipos]; m.on('click', () => M.map.fitBounds(b.pad(0.4), { maxZoom: M.map.getMaxZoom() }));
    M.g.addLayer(m);
  }
  // 8) Aviso nuevo: marcador provisional (arrastrable) hasta confirmar la ubicación
  const prov = f.nuevoAviso;
  if (prov) {
    const ll = aLatLng(prov.pos);
    if (!M.prov) {
      M.prov = L.marker(ll, { icon: L.divIcon({ html: '<div class="mk av nuevo" title="Ubicación del nuevo aviso (provisional)"><span class="mk-av">!</span><span class="mk-l">Nuevo aviso</span></div>', className: 'mk-wrap', iconSize: [30, 30], iconAnchor: [15, 15] }), draggable: true, keyboard: false, zIndexOffset: 1000 });
      M.prov.on('dragend', () => { const f2 = filt('plano'); if (!f2.nuevoAviso || !M.prov) return; const ll2 = M.prov.getLatLng(); if (!dentro(ll2)) toast('Fuera del plano: se coloca en el borde', 'warn'); f2.nuevoAviso = { pos: dePunto(ll2) }; G.render(); });
      M.prov.addTo(M.map);
    } else M.prov.setLatLng(ll);
  } else if (M.prov) { M.prov.remove(); M.prov = null; }
  dibujarBorrador();
}
const UMBRAL_AGRUPAR = 60;
/** ¿Se está colocando o dibujando algo? Entonces los toques sobre elementos van al plano */
const modoColocar = () => { const f = filt('plano'); return !!(f.dibujo || f.situarPunto || f.marcarAviso || f.nuevoAviso || f.place || f.placeAviso); };
/** Etiqueta de texto en el mapa que se puede tocar (nombre de un sector o de una zona) */
function etiquetaMapa(pos, texto, cls, onClick) {
  const m = L.marker(aLatLng(pos), { icon: L.divIcon({ html: `<div class="${cls}" role="button" title="${attr(texto)}: ver detalles">${esc(texto)}</div>`, className: 'mk-wrap lbl-wrap', iconSize: [0, 0] }), keyboard: false, zIndexOffset: -100 });
  m.on('click', ev => { if (modoColocar()) return clicMapa(ev); onClick(); });
  return m;
}

// ---------- aviso desde el mapa: ajuste accesible del marcador provisional ----------
const pasosAjuste = pl => (esMapa(pl) ? [[1, '1 m'], [5, '5 m'], [25, '25 m']] : [[0.5, '0,5 %'], [2, '2 %'], [5, '5 %']]);
function textoProv(pos) {
  const p = P(); const sec = sectorDePunto(p.cat.sectores, pos); const nomSec = sec ? ((p.cat.sectores || []).find(x => x.id === sec) || {}).nombre : '';
  return (esMapa(p.plano) ? fmtCoords({ lat: pos.lat, lon: pos.lon }) : 'punto del plano (' + Math.round(pos.x * 100) + ' %, ' + Math.round(pos.y * 100) + ' %)') + (nomSec ? ' · sector ' + nomSec : '');
}
function bannerAvisoProvisional(f) {
  const pl = P().plano; const pasos = pasosAjuste(pl); const paso = f.pasoAviso && pasos.some(x => x[0] === f.pasoAviso) ? f.pasoAviso : pasos[1][0];
  return `<div class="banner info aviso-prov" data-ajuste tabindex="0" role="group" aria-label="Ubicación del nuevo aviso. Flechas: ajustar. Intro: usar esta ubicación. Escape: cancelar.">
    ${icon('pin')}<div class="grow"><b>Ubicación del nuevo aviso:</b> <span aria-live="polite" data-prov-pos>${esc(textoProv(f.nuevoAviso.pos))}</span><br>
    <span class="muted small">Marcada en el mapa (no es una posición GPS). Ajústala arrastrando el marcador, con estos botones o con las teclas de dirección.</span>
    <div class="ajuste">${[['n', '↑', 'Mover hacia arriba (norte)'], ['s', '↓', 'Mover hacia abajo (sur)'], ['o', '←', 'Mover a la izquierda (oeste)'], ['e', '→', 'Mover a la derecha (este)']].map(([d, t, l]) => `<button type="button" class="btn" data-a="plan.mover" data-d="${d}" aria-label="${l}" title="${l}">${t}</button>`).join('')}
      <label class="small">Paso <select data-c="plan.paso" aria-label="Distancia de cada ajuste">${pasos.map(([v, l]) => `<option value="${v}"${v === paso ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div></div>
    <div class="row gap-s">${btn('Usar esta ubicación', 'plan.avisoUsar', { cls: 'primary' })}${btn('Cancelar', 'plan.avisoCancelar', { cls: 'ghost' })}</div></div>`;
}
function moverProvisional(dir, foco) {
  const f = filt('plano'); if (!f.nuevoAviso) return;
  const pl = P().plano; const pasos = pasosAjuste(pl); const paso = f.pasoAviso && pasos.some(x => x[0] === f.pasoAviso) ? f.pasoAviso : pasos[1][0];
  let dx, dy;
  if (esMapa(pl)) { const b = pl.bounds; dx = paso / (haversineKm(b.n, b.w, b.n, b.e) * 1000); dy = paso / (haversineKm(b.n, b.w, b.s, b.w) * 1000); }
  else { dx = dy = paso / 100; }
  const q = { x: f.nuevoAviso.pos.x, y: f.nuevoAviso.pos.y };
  if (dir === 'n') q.y -= dy; else if (dir === 's') q.y += dy; else if (dir === 'o') q.x -= dx; else if (dir === 'e') q.x += dx;
  q.x = clamp(q.x); q.y = clamp(q.y);
  f.nuevoAviso = { pos: esMapa(pl) ? { ...q, ...normAGeo(pl.bounds, q.x, q.y) } : q };
  G.render(); enfocar(foco || '[data-ajuste]');
}
/** Devuelve el foco tras repintar (la pantalla se vuelve a dibujar) */
function enfocar(sel) { requestAnimationFrame(() => requestAnimationFrame(() => { const el = document.querySelector(sel); if (el) el.focus({ preventScroll: true }); })); }
A['plan.avisoMapa'] = () => { const f = filt('plano'); f.sel = null; f.place = null; f.dibujo = null; f.situarPunto = null; f.marcarAviso = true; G.render(); };
A['plan.avisoSinMapa'] = () => { const f = filt('plano'); f.marcarAviso = false; f.nuevoAviso = null; G.render(); nuevoAvisoEn({}); };
A['plan.avisoCancelar'] = () => { const f = filt('plano'); f.marcarAviso = false; f.nuevoAviso = null; G.render(); };
A['plan.mover'] = el => moverProvisional(el.dataset.d, `[data-a="plan.mover"][data-d="${el.dataset.d}"]`);
CH['plan.paso'] = el => { filt('plano').pasoAviso = Number(el.value); };
A['plan.avisoUsar'] = () => {
  const f = filt('plano'); const prov = f.nuevoAviso; if (!prov) return;
  const pl = P().plano; const pos = prov.pos; f.nuevoAviso = null; G.render();
  const loc = esMapa(pl) ? { txt: '', lat: pos.lat, lon: pos.lon, fuente: 'mapa', t: now() } : { txt: 'Punto del plano', lat: null, lon: null, fuente: 'mapa', t: now() };
  nuevoAvisoEn({ plan: pos, loc, sector: sectorDePunto(P().cat.sectores, pos) });
};
if (typeof document !== 'undefined') document.addEventListener('keydown', ev => {
  const g = ev.target && ev.target.closest ? ev.target.closest('[data-ajuste]') : null; if (!g || ev.target.tagName === 'SELECT') return;
  const d = { ArrowUp: 'n', ArrowDown: 's', ArrowLeft: 'o', ArrowRight: 'e' }[ev.key];
  if (d) { ev.preventDefault(); moverProvisional(d, ev.target === g ? '[data-ajuste]' : null); }
  else if (ev.key === 'Enter' && ev.target === g) { ev.preventDefault(); A['plan.avisoUsar'](); }
  else if (ev.key === 'Escape') { ev.preventDefault(); A['plan.avisoCancelar'](); }
});
function eventosUnidad(m, id) {
  let clicT = null;
  m.on('click', () => { clearTimeout(clicT); clicT = setTimeout(() => seleccionar('u', id), 260); });
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
    // Un toque fuera de los elementos cierra la ficha contextual (también fuera del plano)
    if (f.sel && !f.place && !f.placeAviso && !f.dibujo && !f.situarPunto && !f.marcarAviso && !f.nuevoAviso) { f.sel = null; G.render(); return; }
    if (!dentro(ll)) { if (f.marcarAviso || f.nuevoAviso) { toast('Toca dentro del plano', 'warn'); return; } if (f.place || f.placeAviso || f.dibujo) toast('Toca dentro del plano', 'warn'); return; }
    if (f.dibujo) { f.dibujo.pts.push(dePunto(ll)); G.render(); return; }
    if (f.situarPunto) { const d = f.situarPunto; f.situarPunto = null; await guardarPunto({ ...d, pos: dePunto(ll) }); return; }
    if (f.placeAviso) { const id = f.placeAviso; f.placeAviso = null; await G.core.exec(C.avisoPlan, id, dePunto(ll)); toast('Aviso situado en el plano', 'ok'); openAviso(id); return; }
    if (f.place) {
      const id = f.place; await G.core.exec(C.unitPlan, id, dePunto(ll));
      const next = liveUnits(S()).find(u => !u.plan && u.sit !== 'archivada' && u.id !== id);
      f.place = next ? next.id : null; G.render(); return;
    }
    if (!operativo() || !can('avisos.crear')) return;
    // Aviso en el punto tocado: marcador provisional que se ajusta y se confirma antes del formulario
    f.marcarAviso = false; f.sel = null; f.nuevoAviso = { pos: dePunto(ll) }; G.render(); enfocar('[data-ajuste]');
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
A['plan.zona'] = () => { const f = filt('plano'); f.dibujo = f.dibujo ? null : { pts: [] }; f.place = null; G.render(); };
A['plan.zonaUndo'] = () => { const f = filt('plano'); if (f.dibujo) { f.dibujo.pts.pop(); G.render(); } };
A['plan.zonaOk'] = () => {
  const f = filt('plano'); const pts = f.dibujo ? f.dibujo.pts : [];
  if (pts.length < 3) { toast('Marca al menos 3 puntos para delimitar la zona', 'warn'); return; }
  const para = f.dibujo.para; f.dibujo = null; G.render();
  if (para && para.k === 'sector') return guardarDelimitacion(para.id, pts);
  if (para && para.k === 'punto') return guardarPunto({ ...para.datos, zona: { pts } });
  crearAvisoZona(pts);
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
  nuevoAvisoEn({ plan: { x: cx, y: cy, ...(g || {}) }, loc: g ? { txt: '', lat: g.lat, lon: g.lon, fuente: 'mapa', t: now() } : null, zona: { pts }, sector: sectorDePunto(P().cat.sectores, { x: cx, y: cy }) });
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
// ---------- ficha contextual (sin salir del mapa) ----------
function seleccionar(k, id) { const f = filt('plano'); f.sel = { k, id }; G.render(); }
function tarjetaMapa() {
  const f = filt('plano'); if (!f.sel) return '';
  const s = S(); const p = P(); const t = now(); const { k, id } = f.sel;
  let cab = '', det = [], acc = '';
  if (k === 'u') {
    const u = s.units[id]; if (!u) return ''; const sit = unitSituation(s, u, t); const a = u.aviso && s.avisos[u.aviso];
    cab = unitLabel(u);
    det = [`Clave ${esc(u.clave)}`, `${simboloDisponibilidad(sit) ? simboloDisponibilidad(sit) + ' ' : ''}${esc(SITUACION_LABEL[sit] || sit)}`, esc(((p.cat.tiposRecurso || []).find(x => x.id === u.tipo) || {}).nombre || ''), 'Sector ' + esc(sectorNombre(p, u, '—')), a ? 'Aviso ' + esc(avisoNumber(a)) : ''];
    acc = btn('Ficha', 'plan.selAbrir', { cls: 'primary sm' }) + (can('estados.cambiar') && operativo() && u.sit === 'activa' ? btn('Cambiar clave', 'plan.selClave', { cls: 'sm' }) : '');
  } else if (k === 'a') {
    const a = s.avisos[id]; if (!a) return '';
    const part = activeParts(a).map(x => s.units[x.u]).filter(Boolean).map(unitLabel);
    cab = 'Aviso ' + avisoNumber(a);
    det = [esc(etiquetaTipoAviso(p.cat.tiposAviso, a.tipo) || a.desc || ''), esc(AVISO_ESTADO[a.estado] || a.estado), a.num == null && a.ref ? '<b>Pendiente de confirmar por el servidor</b>' : '', part.length ? 'Unidades: ' + esc(part.join(', ')) : 'Sin unidades', a.loc && a.loc.txt ? esc(a.loc.txt) : ''];
    acc = btn('Abrir aviso', 'plan.selAbrir', { cls: 'primary sm' });
  } else if (k === 's') {
    const sec = (p.cat.sectores || []).find(x => x.id === id); if (!sec) return '';
    const us = liveUnits(s).filter(u => u.sector === id); const av = Object.values(s.avisos).filter(a => a.sector === id && a.estado !== 'finalizado');
    cab = 'Sector ' + sec.nombre;
    det = [`${us.length} unidad(es)`, `${us.filter(u => unitSituation(s, u, t) === 'disponible').length} disponible(s)`, `${av.length} aviso(s) activo(s)`];
    acc = editable() && can('sectores.gestionar') ? btn('Cambiar delimitación', 'plan.secDelimitar', { cls: 'sm', data: { id } }) : '';
  } else if (k === 'p') {
    const pt = (p.cat.puntos || []).find(x => x.id === id); if (!pt) return ''; const c = categoriasPunto(p).find(x => x.id === pt.categoria) || {};
    cab = pt.nombre; det = [esc(c.nombre || ''), esc(GRUPOS_PUNTO[c.grupo] || ''), esc(pt.desc || '')];
    acc = editable() && can('planos.editar') ? btn('Editar', 'plan.puntoEditar', { cls: 'sm', data: { id } }) + btn('Quitar', 'plan.puntoQuitar', { cls: 'sm danger-ghost', data: { id } }) : '';
  }
  return `<div class="map-card" role="region" aria-live="polite" aria-label="${attr(cab)}" data-map-card="${k}"><div class="grow"><b>${esc(cab)}</b><div class="small">${det.filter(Boolean).join(' · ')}</div></div><div class="row gap-s wrap">${acc}${btn('', 'plan.selCerrar', { cls: 'icon ghost', ic: 'cerrar', title: 'Cerrar' })}</div></div>`;
}
A['plan.selCerrar'] = () => { filt('plano').sel = null; G.render(); };
A['plan.selAbrir'] = () => { const sel = filt('plano').sel; if (!sel) return; if (sel.k === 'u') openUnit(sel.id); else if (sel.k === 'a') openAviso(sel.id); };
A['plan.selClave'] = () => { const sel = filt('plano').sel; if (sel) selectorClave(sel.id); };

// ---------- leyenda ----------
function leyendaHtml(p, fl) {
  const ley = leyenda(p, fl); const usadas = new Set((p.cat.puntos || []).map(x => x.categoria)); const s = S();
  const prov = Object.values(s.avisos).some(a => a.num == null && a.ref && a.estado !== 'finalizado');
  return `<div class="legend" aria-label="Leyenda del plano">${ley.claves.map(c => `<span><i style="background:${attr(c.color)}"></i>${esc(c.codigo)} ${esc(c.nombre)}</span>`).join('')}<span><i style="background:#9E9E9E"></i>Descanso</span>
    ${ley.disponibilidad.filter(d => d.id !== 'disponible').map(d => `<span><b class="sim d-${d.id}" aria-hidden="true">${d.simbolo}</b>${esc(d.nombre)}</span>`).join('')}
    ${fl.capas.avisos ? '<span><b class="sim av" aria-hidden="true">!</b>Aviso activo</span>' : ''}${fl.capas.finalizados ? '<span><b class="sim av fin" aria-hidden="true">✓</b>Aviso finalizado</span>' : ''}${prov ? '<span><b class="sim av prov" aria-hidden="true">!</b>Aviso pendiente de confirmar</span>' : ''}
    ${ley.categorias.filter(c => usadas.has(c.id)).map(c => `<span><b class="sim poi" style="--pc:${attr(c.color)}" aria-hidden="true">${icon(c.icono || 'pin')}</b>${esc(c.nombre)}</span>`).join('')}</div>`;
}

// ---------- capas y filtros ----------
CH['plan.capa'] = el => { const fl = structuredClone(filtrosPlano()); fl.capas[el.dataset.v] = el.checked; guardarFiltros(fl); };
CH['plan.secVer'] = el => { const fl = structuredClone(filtrosPlano()); const id = el.dataset.id; fl.sectoresOcultos = el.checked ? fl.sectoresOcultos.filter(x => x !== id) : [...fl.sectoresOcultos, id]; guardarFiltros(fl); };
CH['plan.catVer'] = el => { const fl = structuredClone(filtrosPlano()); const id = el.dataset.id; fl.categoriasOcultas = el.checked ? fl.categoriasOcultas.filter(x => x !== id) : [...fl.categoriasOcultas, id]; guardarFiltros(fl); };
A['plan.filtro'] = el => { const fl = structuredClone(filtrosPlano()); const k = el.dataset.campo; const v = el.dataset.v; fl[k] = fl[k].includes(v) ? fl[k].filter(x => x !== v) : [...fl[k], v]; guardarFiltros(fl); };
A['plan.restablecer'] = () => { guardarFiltros({}); toast('Se ve todo de nuevo', 'ok'); };
A['plan.capas'] = () => openSheet({ title: 'Capas y filtros', size: 'm', live: true, render: renderCapas });
function renderCapas() {
  const fl = filtrosPlano(); const p = P(); const s = S(); const t = now(); const vivas = liveUnits(s);
  const sw = (k, label, n) => `<label class="switch"><input type="checkbox" data-c="plan.capa" data-v="${k}"${fl.capas[k] ? ' checked' : ''}><span>${esc(label)}${n != null ? ` <span class="muted">(${n})</span>` : ''}</span></label>`;
  const chips = (campo, titulo, items) => items.length ? `<fieldset class="filtro"><legend>${esc(titulo)}</legend><div class="chips-f">${items.map(([id, label, extra]) => { const on = fl[campo].includes(id); return `<button type="button" class="chip-f${on ? ' on' : ''}" aria-pressed="${on}" data-a="plan.filtro" data-campo="${campo}" data-v="${attr(id)}">${extra || ''}${esc(label)}</button>`; }).join('')}</div></fieldset>` : '';
  const sw2 = c => `<i class="sw" style="background:${attr(c || '#9E9E9E')}"></i>`;
  const avisos = Object.values(s.avisos); const puntos = p.cat.puntos || []; const cats = categoriasPunto(p);
  const conZona = (p.cat.sectores || []).filter(x => x.zona);
  return `<p class="muted small">Solo cambia lo que ves tú en este dispositivo y en este preventivo: los datos y lo que ven los demás no cambian. En cada filtro, sin marcar = todos.</p>
    <h3>Qué se ve</h3><div class="capas-grid">${sw('unidades', 'Unidades', filtrarUnidades(s, fl, t).length + ' de ' + vivas.length)}${sw('avisos', 'Avisos activos', avisos.filter(a => a.estado !== 'finalizado').length)}${sw('finalizados', 'Avisos finalizados', avisos.filter(a => a.estado === 'finalizado').length)}${sw('sectores', 'Sectores delimitados', conZona.length)}${sw('interes', GRUPOS_PUNTO.interes, puntos.filter(x => (cats.find(c => c.id === x.categoria) || {}).grupo === 'interes').length)}${sw('apoyo', GRUPOS_PUNTO.apoyo, puntos.filter(x => (cats.find(c => c.id === x.categoria) || {}).grupo === 'apoyo').length)}${sw('etiquetas', 'Etiquetas')}</div>
    <h3>Unidades</h3>
    ${chips('tipos', 'Tipo de recurso', [...new Set(vivas.map(u => u.tipo).filter(Boolean))].map(id => [id, ((p.cat.tiposRecurso || []).find(x => x.id === id) || {}).nombre || id]))}
    ${chips('claves', 'Clave', p.cat.claves.map(c => [c.codigo, c.codigo + ' · ' + c.nombre, sw2(c.color)]))}
    ${chips('disponibilidad', 'Disponibilidad', DISPONIBILIDAD.map(d => [d.id, d.nombre, `<b class="sim" aria-hidden="true">${d.simbolo}</b>`]))}
    ${chips('sectores', 'Sector', (p.cat.sectores || []).map(x => [x.id, x.nombre, sw2(x.color)]))}
    <h3>Avisos</h3>${chips('tiposAviso', 'Tipo de aviso', [...new Set(avisos.map(a => a.tipo).filter(Boolean))].map(id => [id, etiquetaTipoAviso(p.cat.tiposAviso, id) || id])) || '<p class="muted small">Aún no hay avisos con tipo.</p>'}
    <h3>Sectores</h3><ul class="ref-list capas-list">${(p.cat.sectores || []).map(x => `<li class="row gap wrap">${sw2(x.color)}<b class="grow">${esc(x.nombre)}</b>
      ${x.zona ? `<label class="switch sm"><input type="checkbox" data-c="plan.secVer" data-id="${attr(x.id)}"${fl.sectoresOcultos.includes(x.id) ? '' : ' checked'}><span>Ver</span></label>` : '<span class="muted small">sin delimitar</span>'}
      ${x.zona ? btn('Detalles', 'plan.secFicha', { cls: 'sm ghost', data: { id: x.id } }) : ''}
      ${editable() && can('sectores.gestionar') ? btn(x.zona ? 'Cambiar delimitación' : 'Delimitar en el plano', 'plan.secDelimitar', { cls: 'sm', data: { id: x.id } }) + (x.zona ? btn('Quitar delimitación', 'plan.secQuitarZona', { cls: 'sm ghost', data: { id: x.id } }) : '') : ''}</li>`).join('')}</ul>
    <h3>Puntos del plano</h3>${editable() && can('planos.editar') ? `<div class="row">${btn('Añadir punto', 'plan.puntoNuevo', { ic: 'mas_add', cls: 'sm' })}</div>` : ''}
    ${Object.entries(GRUPOS_PUNTO).map(([g, nom]) => `<fieldset class="filtro"><legend>${esc(nom)}</legend><ul class="ref-list capas-list">${cats.filter(c => c.grupo === g).map(c => { const n = puntos.filter(x => x.categoria === c.id).length; return `<li class="row gap"><b class="sim poi" style="--pc:${attr(c.color)}" aria-hidden="true">${icon(c.icono || 'pin')}</b><span class="grow">${esc(c.nombre)} <span class="muted">(${n})</span></span><label class="switch sm"><input type="checkbox" data-c="plan.catVer" data-id="${attr(c.id)}"${fl.categoriasOcultas.includes(c.id) ? '' : ' checked'}><span>Ver</span></label></li>`; }).join('')}</ul></fieldset>`).join('')}
    <h3>Leyenda</h3>${leyendaHtml(p, fl)}
    <div class="row end gap">${btn('Restablecer', 'plan.restablecer', { ic: 'sync' })}<button type="button" class="btn primary" data-a="sheet.close">Hecho</button></div>`;
}

A['plan.secFicha'] = el => { closeSheet(); seleccionar('s', el.dataset.id); };
// ---------- alternativa al mapa: los mismos elementos en una lista ----------
A['plan.lista'] = () => openSheet({ title: 'Elementos del plano', size: 'l', live: true, render: renderListaPlano });
function renderListaPlano() {
  const s = S(); const p = P(); const fl = filtrosPlano(); const t = now();
  const posTxt = pos => !pos ? 'sin situar en el plano' : esMapa(p.plano) && pos.lat != null ? fmtCoords({ lat: pos.lat, lon: pos.lon }) : 'en el plano a ' + Math.round(pos.x * 100) + ' %, ' + Math.round(pos.y * 100) + ' %';
  const acc = (k, id, pos, ficha) => `<span class="row gap-s">${pos ? btn('Ver en el plano', 'plan.verEn', { cls: 'sm', data: { k, id } }) : ''}${ficha ? btn('Ficha', 'plan.fichaDe', { cls: 'sm ghost', data: { k, id } }) : ''}</span>`;
  const us = filtrarUnidades(s, fl, t); const avs = filtrarAvisos(s, fl); const pts = puntosVisibles(p, fl); const secs = sectoresVisibles(p, fl); const cats = categoriasPunto(p);
  return `<p class="muted small">Lo mismo que muestra el plano, en forma de lista y con las mismas capas y filtros. «Ver en el plano» lo centra y abre su ficha.</p>
    <h3>Unidades (${us.length})</h3><ul class="ref-list lista-plano">${us.map(u => { const sit = unitSituation(s, u, t); return `<li class="row gap wrap"><span class="grow"><b>${esc(unitLabel(u))}</b> · clave ${esc(u.clave)} · ${simboloDisponibilidad(sit)} ${esc(SITUACION_LABEL[sit] || sit)} · sector ${esc(sectorNombre(p, u, '—'))} · ${esc(posTxt(u.plan))}</span>${acc('u', u.id, u.plan, true)}</li>`; }).join('') || '<li class="muted">Ninguna con estas capas y filtros</li>'}</ul>
    <h3>Avisos (${avs.length})</h3><ul class="ref-list lista-plano">${avs.map(a => `<li class="row gap wrap"><span class="grow"><b>Aviso ${esc(avisoNumber(a))}</b>${a.num == null && a.ref ? ' (pendiente de confirmar)' : ''} · ${esc(AVISO_ESTADO[a.estado] || a.estado)} · ${esc(etiquetaTipoAviso(p.cat.tiposAviso, a.tipo) || a.desc || '')} · ${esc(a.loc && a.loc.txt ? a.loc.txt : posTxt(posAviso(a)))}</span>${acc('a', a.id, posAviso(a), true)}</li>`).join('') || '<li class="muted">Ninguno con estas capas y filtros</li>'}</ul>
    <h3>Puntos (${pts.length})</h3><ul class="ref-list lista-plano">${pts.map(pt => `<li class="row gap wrap"><span class="grow"><b>${esc(pt.nombre)}</b> · ${esc((cats.find(c => c.id === pt.categoria) || {}).nombre || '')}${pt.zona ? ' · zona' : ''}</span>${acc('p', pt.id, pt.pos || centroide(pt.zona.pts), false)}</li>`).join('') || '<li class="muted">Ninguno</li>'}</ul>
    <h3>Sectores delimitados (${secs.length})</h3><ul class="ref-list lista-plano">${secs.map(x => `<li class="row gap wrap"><span class="grow"><b>${esc(x.nombre)}</b> · ${liveUnits(s).filter(u => u.sector === x.id).length} unidad(es)</span>${acc('s', x.id, centroide(x.zona.pts), false)}</li>`).join('') || '<li class="muted">Ninguno</li>'}</ul>`;
}
A['plan.verEn'] = el => {
  const { k, id } = el.dataset; const s = S(); const p = P(); let pos = null;
  if (k === 'u') pos = s.units[id] && s.units[id].plan;
  else if (k === 'a') pos = s.avisos[id] && posAviso(s.avisos[id]);
  else if (k === 'p') { const pt = (p.cat.puntos || []).find(x => x.id === id); pos = pt && (pt.pos || centroide(pt.zona.pts)); }
  else if (k === 's') { const sec = (p.cat.sectores || []).find(x => x.id === id); pos = sec && sec.zona && centroide(sec.zona.pts); }
  closeSheet(); if (M && pos) M.map.setView(aLatLng(pos), Math.max(M.map.getZoom(), esMapa(p.plano) ? 18 : 0));
  seleccionar(k, id); enfocar('[data-map-card] button');
};
A['plan.fichaDe'] = el => { closeSheet(); if (el.dataset.k === 'u') openUnit(el.dataset.id); else openAviso(el.dataset.id); };
// ---------- delimitación de sectores ----------
A['plan.secDelimitar'] = el => {
  const sec = (P().cat.sectores || []).find(x => x.id === el.dataset.id); if (!sec) return;
  closeSheet(); const f = filt('plano'); f.sel = null; f.place = null; f.dibujo = { pts: [], para: { k: 'sector', id: sec.id, nombre: sec.nombre } }; G.render();
};
async function guardarDelimitacion(id, pts) {
  const lista = structuredClone(P().cat.sectores); const sec = lista.find(x => x.id === id); if (!sec) return;
  sec.zona = { pts: pts.map(q => ({ ...q })) };
  try { await G.core.exec(C.catUpdate, 'sectores', lista); toast('Delimitación de «' + sec.nombre + '» guardada', 'ok'); filt('plano').sel = { k: 's', id }; G.render(); } catch (e) { toast(e.message, 'error'); }
}
A['plan.secQuitarZona'] = async el => {
  const lista = structuredClone(P().cat.sectores); const sec = lista.find(x => x.id === el.dataset.id); if (!sec) return;
  if (!(await confirmDlg({ title: 'Quitar la delimitación', text: 'El sector ' + sec.nombre + ' deja de dibujarse en el plano. Sus unidades y avisos no cambian.', ok: 'Quitar' }))) return;
  delete sec.zona; await G.core.exec(C.catUpdate, 'sectores', lista); toast('Delimitación quitada', 'ok'); G.render(); refreshSheets();
};

// ---------- puntos de interés y de apoyo ----------
let PT = null;
function formPunto() {
  const cats = categoriasPunto(P());
  return `<form data-f="plan.puntoForm">${fieldsHtml([
    { name: 'nombre', label: 'Nombre', required: true, maxlength: 80, value: PT.nombre || '' },
    { name: 'categoria', label: 'Categoría', type: 'select', options: cats.map(c => [c.id, GRUPOS_PUNTO[c.grupo] + ' · ' + c.nombre]), value: PT.categoria || cats[0].id },
    { name: 'desc', label: 'Descripción (opcional)', type: 'textarea', value: PT.desc || '' },
    { name: 'modo', label: 'Situarlo en el plano', type: 'select', options: [['punto', 'Tocando un punto'], ['zona', 'Dibujando una zona (p. ej. zona restringida o de riesgo)'], ...(PT.id ? [['igual', 'Dejarlo donde está']] : [])], value: PT.id ? 'igual' : 'punto' },
  ])}<div class="row end gap"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">${PT.id ? 'Guardar' : 'Continuar'}</button></div></form>`;
}
A['plan.puntoNuevo'] = () => { PT = {}; closeSheet(); openSheet({ title: 'Nuevo punto', size: 's', render: formPunto }); };
A['plan.puntoEditar'] = el => { const pt = (P().cat.puntos || []).find(x => x.id === el.dataset.id); if (!pt) return; PT = { ...pt }; openSheet({ title: 'Editar punto', size: 's', render: formPunto }); };
F['plan.puntoForm'] = async form => {
  const v = readForm(form); const d = { id: PT.id, nombre: v.nombre.trim(), categoria: v.categoria, desc: (v.desc || '').trim() };
  closeSheet(); const f = filt('plano'); f.sel = null;
  if (v.modo === 'igual') return guardarPunto({ ...d, pos: PT.pos, zona: PT.zona });
  if (v.modo === 'zona') { f.dibujo = { pts: [], para: { k: 'punto', nombre: d.nombre, datos: d } }; G.render(); return; }
  f.situarPunto = d; G.render();
};
A['plan.puntoCancelar'] = () => { filt('plano').situarPunto = null; G.render(); };
async function guardarPunto(d) {
  const lista = structuredClone(P().cat.puntos || []); const i = d.id ? lista.findIndex(x => x.id === d.id) : -1;
  const it = { id: d.id || uid('pt_'), nombre: d.nombre, categoria: d.categoria, desc: d.desc || '' };
  if (d.zona) it.zona = d.zona; else it.pos = d.pos;
  if (i >= 0) lista[i] = it; else lista.push(it);
  try { await G.core.exec(C.catUpdate, 'puntos', lista); toast(i >= 0 ? 'Punto guardado' : 'Punto añadido', 'ok'); filt('plano').sel = { k: 'p', id: it.id }; G.render(); } catch (e) { toast(e.message, 'error'); }
}
A['plan.puntoQuitar'] = async el => {
  const lista = (P().cat.puntos || []).filter(x => x.id !== el.dataset.id); const pt = (P().cat.puntos || []).find(x => x.id === el.dataset.id); if (!pt) return;
  if (!(await confirmDlg({ title: 'Quitar punto', text: '«' + pt.nombre + '» deja de estar en el plano de este preventivo. Queda registrado en la bitácora.', ok: 'Quitar', danger: true }))) return;
  await G.core.exec(C.catUpdate, 'puntos', lista); filt('plano').sel = null; toast('Punto quitado', 'ok'); G.render();
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
