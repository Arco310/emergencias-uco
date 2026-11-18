// IMPORTAR DESDE GOOGLE MAPS y biblioteca de planos: buscar un lugar, encuadrar la zona y
// añadirla al preventivo como plano cartográfico georreferenciado (conserva las coordenadas reales).
import { G, A, F } from '../state.js';
import { esc, attr, openSheet, closeSheet, toast, confirmDlg, fieldsHtml, readForm, btn } from '../dom.js';
import { icon } from '../icons.js';
import { BIBLIOTECA_PLANOS, googleConsultaUrl, boundsValidos } from '../../core/geo.js';
import * as C from '../../core/commands.js';
import { L, crearMapa, capaBase, buscarLugar, proveedor, NOMBRE_PROVEEDOR, aLatLngBounds, deLatLngBounds } from '../mapa.js';

const core = () => G.core;
let SEL = null; // selector abierto: { map, onConfirm, resultados, lugar }

/** Zona elegida: el recuadro marcado en el centro del mapa (lo que se ve dentro del marco) */
function zonaMarcada() {
  const m = SEL.map; const el = m.getContainer(); const W = el.clientWidth, H = el.clientHeight;
  const ix = W * 0.06, iy = H * 0.06;
  const nw = m.containerPointToLatLng([ix, iy]), se = m.containerPointToLatLng([W - ix, H - iy]);
  return deLatLngBounds(L.latLngBounds(se, nw));
}

/**
 * Abre el selector cartográfico. inicial: { nombre, bounds, centro, zoom, lugar } (p. ej. de la biblioteca)
 * onConfirm({ nombre, bounds, centro, zoom, proveedor, guardar, origen })
 */
export function abrirSelectorMapa({ inicial = null, titulo = 'Importar desde Google Maps', onConfirm, guardarOpcion = true } = {}) {
  const prov = proveedor();
  SEL = { onConfirm, resultados: [], lugar: inicial ? inicial.lugar || '' : '', origen: inicial && inicial.id ? inicial.id : null };
  openSheet({
    title: titulo, size: 'l', focus: false,
    render: () => `<div class="carto">
      ${prov === 'osm' ? `<p class="note small">${icon('info')} Google Maps no está configurado en esta organización (falta la clave de Google Maps Platform): se usa <b>OpenStreetMap</b>. El plano conserva igualmente sus coordenadas reales. ${core().can('config.editar') ? 'Puedes añadir la clave en Configuración general → Cartografía.' : ''}</p>` : `<p class="muted small">Cartografía: Google Maps Platform.</p>`}
      <form data-f="carto.buscar" class="row gap carto-buscar"><input name="q" type="search" placeholder="Dirección, calle, plaza, edificio o lugar" value="${attr(inicial ? inicial.consulta || '' : '')}" aria-label="Buscar lugar" data-field="1" data-type="text" autocomplete="off"><button class="btn primary">${icon('buscar')}<span>Buscar</span></button></form>
      <div id="carto-res" class="carto-res"></div>
      <div class="carto-mapa"><div id="carto-map"></div><div class="carto-marco" aria-hidden="true"></div></div>
      <p class="muted small">Desplaza el mapa y acerca o aleja con los botones, la rueda o dos dedos. La zona que quede <b>dentro del marco</b> será el plano.</p>
      <form data-f="carto.ok">${fieldsHtml([
        { name: 'nombre', label: 'Nombre del plano', required: true, value: inicial ? inicial.nombre : '' },
        ...(guardarOpcion && core().can('planos.editar') ? [{ name: 'guardar', label: 'Guardar también en la biblioteca de planos', type: 'checkbox', value: false }] : []),
      ])}<div class="row end gap"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">${icon('ok')}<span>Usar esta zona</span></button></div></form>
    </div>`,
    onMount: async el => {
      const box = el.querySelector('#carto-map');
      SEL.map = crearMapa(box, inicial && boundsValidos(inicial.bounds) ? { bounds: inicial.bounds } : { centro: inicial && inicial.centro, zoom: inicial && inicial.zoom });
      const base = await capaBase(SEL.map); SEL.prov = base.prov;
      setTimeout(() => SEL && SEL.map && SEL.map.invalidateSize(), 250);
    },
    onClose: () => { if (SEL && SEL.map) SEL.map.remove(); SEL = null; },
  });
}
F['carto.buscar'] = async form => {
  const q = readForm(form).q; const box = document.getElementById('carto-res'); if (!SEL || !box) return;
  box.innerHTML = `<p class="muted small">Buscando…</p>`;
  try {
    SEL.resultados = await buscarLugar(q);
    box.innerHTML = SEL.resultados.length ? `<ul class="carto-lista">${SEL.resultados.map((r, i) => `<li><button type="button" class="btn ghost block" data-a="carto.ir" data-i="${i}">${icon('pin')}<span><b>${esc(r.nombre)}</b><small class="muted">${esc(r.direccion)}</small></span></button></li>`).join('')}</ul>` : `<p class="muted small">Sin resultados para «${esc(q)}».</p>`;
    if (SEL.resultados.length === 1) A['carto.ir']({ dataset: { i: '0' } });
  } catch (e) { box.innerHTML = `<p class="note warn small">${esc(e.message)}. Comprueba la conexión.</p>`; }
};
A['carto.ir'] = el => {
  const r = SEL && SEL.resultados[Number(el.dataset.i)]; if (!r) return;
  if (r.bounds && boundsValidos(r.bounds)) SEL.map.fitBounds(aLatLngBounds(r.bounds).pad(0.15)); else SEL.map.setView([r.lat, r.lon], 17);
  SEL.lugar = r.direccion;
  const n = document.querySelector('form[data-f="carto.ok"] [name=nombre]'); if (n && !n.value) n.value = r.nombre;
  const box = document.getElementById('carto-res'); if (box) box.innerHTML = `<p class="muted small">${icon('pin')} ${esc(r.direccion)}</p>`;
};
F['carto.ok'] = async form => {
  if (!SEL) return;
  const v = readForm(form); const b = zonaMarcada();
  if (!boundsValidos(b)) { toast('La zona es demasiado grande: acerca el mapa', 'warn'); return; }
  const c = SEL.map.getCenter();
  const res = { nombre: String(v.nombre || '').trim() || 'Plano', bounds: b, centro: { lat: +c.lat.toFixed(6), lon: +c.lng.toFixed(6) }, zoom: Math.round(SEL.map.getZoom()), proveedor: SEL.prov || proveedor(), guardar: !!v.guardar, lugar: SEL.lugar, origen: SEL.origen };
  const cb = SEL.onConfirm; closeSheet();
  await cb(res);
};

/** Biblioteca de planos: predefinidos de la aplicación y zonas guardadas por la organización */
export function abrirBiblioteca({ onElegir }) {
  const guardados = core().planosBiblioteca();
  openSheet({
    title: 'Biblioteca de planos', size: 'm',
    render: () => `<p class="muted small">Planos cartográficos con su referencia geográfica: al elegir uno se abre su ubicación para ajustar el encuadre antes de incorporarlo.</p>
      <h3>Predefinidos</h3><ul class="cat-list">${BIBLIOTECA_PLANOS.map(p => fila(p, true)).join('')}</ul>
      ${guardados.length ? `<h3>Guardados</h3><ul class="cat-list">${guardados.map(p => fila(p, false)).join('')}</ul>` : ''}`,
  });
  BIB_CB = onElegir;
}
let BIB_CB = null;
const fila = (p, predef) => `<li class="cat-row" data-biblio="${attr(p.id)}">${icon('mapa')}<div class="grow"><b>${esc(p.nombre)}</b><small class="muted">${esc(p.lugar || '')}</small></div>
  <div class="row gap-s">${btn('Abrir', 'biblio.abrir', { cls: 'sm primary', data: { id: p.id } })}${predef ? `<a class="btn sm ghost" href="${attr(googleConsultaUrl(p.consulta))}" target="_blank" rel="noopener" title="Ver en Google Maps">${icon('enlace')}</a>` : core().can('planos.editar') ? btn('', 'biblio.borrar', { cls: 'icon ghost', ic: 'papelera', data: { id: p.id }, title: 'Quitar de la biblioteca' }) : ''}</div></li>`;
A['biblio.abrir'] = el => {
  const p = BIBLIOTECA_PLANOS.find(x => x.id === el.dataset.id) || core().planosBiblioteca().find(x => x.id === el.dataset.id); if (!p) return;
  const cb = BIB_CB; closeSheet();
  abrirSelectorMapa({ inicial: p, titulo: 'Biblioteca · ' + p.nombre, guardarOpcion: false, onConfirm: cb });
};
A['biblio.borrar'] = async el => {
  const p = core().planosBiblioteca().find(x => x.id === el.dataset.id);
  if (!(await confirmDlg({ title: 'Quitar de la biblioteca', text: '¿Quitar «' + p.nombre + '» de la biblioteca? Los preventivos que lo usan no cambian.', ok: 'Quitar', danger: true }))) return;
  await core().borrarPlanoBiblioteca(p.id); closeSheet(); toast('Quitado de la biblioteca', 'ok');
};

/** Incorpora la zona elegida al preventivo abierto como plano cartográfico */
export async function incorporarAlPreventivo(r) {
  const c = core(); const actual = c.state.prev.plano;
  if (actual && !(await confirmDlg({ title: 'Cambiar plano', text: 'El plano actual se sustituye por «' + r.nombre + '». Las unidades conservan su posición relativa; el cambio queda registrado.', ok: 'Cambiar' }))) return false;
  await c.exec(C.planoSet, { tipo: 'mapa', nombre: r.nombre, proveedor: r.proveedor, bounds: r.bounds, centro: r.centro, zoom: r.zoom, origen: r.origen });
  if (r.guardar) await c.guardarPlanoBiblioteca({ nombre: r.nombre, lugar: r.lugar, bounds: r.bounds, centro: r.centro, zoom: r.zoom }).catch(e => toast(e.message, 'warn'));
  toast('Plano cartográfico incorporado: «' + r.nombre + '»', 'ok');
  return true;
}

/** Configuración general → Cartografía (clave de Google Maps Platform) */
export function seccionCartografia() {
  const c = core(); const ro = !c.can('config.editar'); const k = (c.cfg.cartografia || {}).googleKey || '';
  return `<section class="card pad"><h2>Cartografía</h2>
    <p>Proveedor en uso: <b>${NOMBRE_PROVEEDOR[proveedor()]}</b>.</p>
    <p class="muted small">Para usar Google Maps se necesita una clave de Google Maps Platform con <b>Map Tiles API</b> y <b>Places API (New)</b> activadas y restringida a las direcciones de la aplicación (https://arco310.github.io/* y la del servidor central). Google exige una cuenta de facturación. La clave no forma parte del código: se guarda cifrada y, con el servidor central, solo la reciben los dispositivos de la organización. Sin clave se usa OpenStreetMap.</p>
    ${ro ? '' : `<form data-f="carto.clave">${fieldsHtml([{ name: 'googleKey', label: 'Clave de API de Google Maps Platform', type: 'password', value: k, placeholder: k ? '' : 'Sin configurar', autocomplete: 'off' }])}<div class="row end gap">${k ? '<button type="button" class="btn ghost" data-a="carto.quitarClave">Quitar clave</button>' : ''}<button class="btn primary">Guardar</button></div></form>`}
  </section>`;
}
F['carto.clave'] = async form => { const v = readForm(form); await core().guardarCartografia({ googleKey: v.googleKey }); toast(v.googleKey ? 'Clave de Google Maps guardada' : 'Clave quitada: se usa OpenStreetMap', 'ok'); G.render(); };
A['carto.quitarClave'] = async () => { await core().guardarCartografia({ googleKey: '' }); toast('Clave quitada: se usa OpenStreetMap', 'ok'); G.render(); };
