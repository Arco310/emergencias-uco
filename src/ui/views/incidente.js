// Selector del tipo de incidente por carpetas: «Nuevo aviso» (al tocar el código se crea el aviso) y el
// campo «Tipo de incidente» de los formularios de aviso (al tocar el código se elige).
// Carpetas → códigos con su descripción; los subcódigos (1.6.1) y los códigos de cierre (AS-…) debajo de
// su código. Buscador por número o texto. La navegación no repinta el panel: no se pierde lo escrito.
import { G, A, CH } from '../state.js';
import { esc, attr, openSheet, closeSheet, toast, btn } from '../dom.js';
import { icon } from '../icons.js';
import { norm } from '../../core/util.js';
import { carpetasTipos, etiquetaTipo, tipoAvisoDef, tieneCodigos, incidentesQueFaltan } from '../../core/incidentes.js';
import * as C from '../../core/commands.js';

const P = () => G.core.state.prev;
let SEL = null; // { onPick(id), onMasDatos(), actual, sinTipo }

/** Abre el selector. onPick recibe el id del tipo ('' = sin tipo, solo si sinTipo) */
export function abrirSelectorIncidente({ titulo = 'Tipo de incidente', onPick, onMasDatos = null, actual = '', sinTipo = false }) {
  SEL = { onPick, onMasDatos, actual, sinTipo };
  openSheet({ title: titulo, size: 'l', focus: false, render: renderSelector, onClose: () => { SEL = null; } });
}

function renderSelector() {
  if (!SEL) return '';
  const p = P(); const lista = p.cat.tiposAviso || [];
  const carpetas = carpetasTipos(lista);
  const editable = p.estado !== 'cerrado' && !p.archivado;
  const faltan = !tieneCodigos(lista);
  return `${faltan ? `<div class="note">${icon('info')} Este preventivo se creó antes de los códigos de incidente.
      ${editable && G.core.can('config.editar') ? `<div class="row end">${btn('Añadir los códigos de incidente', 'inc.anadir', { cls: 'primary sm', ic: 'mas_add' })}</div>` : ' Un administrador puede añadirlos desde aquí.'}</div>` : ''}
    <div class="search inc-q">${icon('buscar')}<input type="search" placeholder="Buscar código o incidente" data-c="inc.q" data-live="1" aria-label="Buscar tipo de incidente" autocomplete="off" enterkeyhint="search"></div>
    ${SEL.sinTipo ? `<button type="button" class="inc-it${!SEL.actual ? ' sel' : ''}" data-a="inc.pick" data-id=""><span class="grow muted">Sin tipo</span></button>` : ''}
    <div class="inc-dirs" data-inc-dirs>
      ${carpetas.map((c, i) => `<button type="button" class="inc-dir" data-a="inc.dir" data-i="${i}" style="--tc:${attr(c.color)}"><span class="inc-dot"></span><span class="grow">${esc(c.nombre)}</span><small class="muted">${c.items.length}</small><span class="inc-chev" aria-hidden="true">›</span></button>`).join('') || '<p class="muted">No hay tipos de aviso en este preventivo.</p>'}
    </div>
    ${carpetas.map((c, i) => `<div class="inc-list" data-inc-list="${i}" hidden>
      <div class="row gap-s"><button type="button" class="btn ghost sm" data-a="inc.back">${icon('atras')}<span>Carpetas</span></button><h3 class="inc-title grow" style="--tc:${attr(c.color)}">${esc(c.nombre)}</h3></div>
      ${c.items.map(x => itemHtml(x.t, x.nivel)).join('')}</div>`).join('')}
    <div class="inc-res" data-inc-res hidden></div>
    ${SEL.onMasDatos ? `<div class="row end"><button type="button" class="btn ghost" data-a="inc.mas">${icon('editar')}<span>Más datos antes de crear…</span></button></div>` : ''}`;
}
function itemHtml(t, nivel = 0) {
  return `<button type="button" class="inc-it niv-${Math.min(nivel, 2)}${SEL && SEL.actual === t.id ? ' sel' : ''}" data-a="inc.pick" data-id="${attr(t.id)}" style="--tc:${attr(t.color || '#546E7A')}">${t.codigo ? `<b class="inc-cod">${esc(t.codigo)}</b>` : ''}<span class="grow">${esc(t.nombre)}${t.cierre ? ' <small class="muted">· código de cierre</small>' : ''}</span></button>`;
}
const cuerpo = el => el.closest('.sheet-body');
function verCarpeta(body, i) {
  body.querySelector('[data-inc-dirs]').hidden = i != null;
  for (const l of body.querySelectorAll('[data-inc-list]')) l.hidden = String(i) !== l.dataset.incList;
  body.scrollTop = 0;
}
A['inc.dir'] = el => verCarpeta(cuerpo(el), el.dataset.i);
A['inc.back'] = el => verCarpeta(cuerpo(el), null);
CH['inc.q'] = el => {
  const body = cuerpo(el); if (!body || !SEL) return;
  // Al tocar un resultado, el buscador pierde el foco y emite «change» con el mismo texto: si se volviera a
  // pintar la lista, el toque caería en un botón ya sustituido y se perdería
  if (el.dataset.ult === el.value) return; el.dataset.ult = el.value;
  const q = norm(el.value.trim()); const res = body.querySelector('[data-inc-res]');
  if (!q) { res.hidden = true; res.innerHTML = ''; verCarpeta(body, null); return; }
  for (const l of body.querySelectorAll('[data-inc-list]')) l.hidden = true;
  body.querySelector('[data-inc-dirs]').hidden = true;
  const hits = [];
  for (const c of carpetasTipos(P().cat.tiposAviso || [])) for (const { t } of c.items) {
    const cod = norm(String(t.codigo || ''));
    if ((cod && cod.startsWith(q)) || norm(etiquetaTipo(t) + ' ' + c.nombre).includes(q)) hits.push(t);
  }
  res.hidden = false;
  res.innerHTML = hits.slice(0, 60).map(t => itemHtml(t)).join('') || '<p class="muted">Ningún tipo coincide con la búsqueda.</p>';
};
A['inc.pick'] = el => {
  if (!SEL) return;
  const cb = SEL.onPick; const id = el.dataset.id || '';
  closeSheet(); // cierra el selector (y deja abierto lo que hubiera debajo)
  return cb(id);
};
A['inc.mas'] = () => { if (!SEL) return; const cb = SEL.onMasDatos; closeSheet(); return cb(); };
A['inc.anadir'] = async el => {
  const lista = P().cat.tiposAviso || []; const falta = incidentesQueFaltan(lista);
  if (falta.length) await G.core.exec(C.catUpdate, 'tiposAviso', [...lista, ...falta]);
  toast(falta.length + ' códigos de incidente añadidos a este preventivo', 'ok');
  const body = cuerpo(el); if (body && SEL) body.innerHTML = renderSelector();
};

/** Campo «Tipo de incidente» de un formulario de aviso (el valor va en un campo oculto) */
export function campoTipoAviso(lista, valor = '') {
  const t = tipoAvisoDef(lista, valor);
  return `<div class="fld"><label>Tipo de incidente</label><input type="hidden" name="tipo" data-field value="${attr(valor || '')}">
    <button type="button" class="btn inc-campo" data-a="inc.campo" style="--tc:${attr(t ? t.color || '#546E7A' : '#9E9E9E')}"><span class="inc-dot"></span><span class="grow" data-tipo-lbl>${t ? esc(etiquetaTipo(t)) : 'Sin tipo · elegir…'}</span><span class="inc-chev" aria-hidden="true">›</span></button></div>`;
}
A['inc.campo'] = el => {
  const form = el.closest('form'); const inp = form.querySelector('input[name=tipo]');
  abrirSelectorIncidente({
    actual: inp.value, sinTipo: true,
    onPick: id => {
      inp.value = id; const t = tipoAvisoDef(P().cat.tiposAviso, id);
      el.querySelector('[data-tipo-lbl]').textContent = t ? etiquetaTipo(t) : 'Sin tipo · elegir…';
      el.style.setProperty('--tc', t ? t.color || '#546E7A' : '#9E9E9E');
    },
  });
};

/** Opciones de un desplegable de filtro por tipo, agrupadas por carpeta */
export function opcionesTipoAviso(lista, sel = '') {
  return carpetasTipos(lista).map(c => `<optgroup label="${attr(c.nombre)}">${c.items.map(({ t, nivel }) => `<option value="${attr(t.id)}"${sel === t.id ? ' selected' : ''}>${nivel ? ' ' : ''}${esc(etiquetaTipo(t))}</option>`).join('')}</optgroup>`).join('');
}
