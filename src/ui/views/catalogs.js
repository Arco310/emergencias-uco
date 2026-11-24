// Editores de catálogos (claves, motivos, sectores, tipos de aviso y de recurso).
// Se reutilizan en la configuración global, en cada preventivo y en las plantillas.
import { G, A, F } from '../state.js';
import { esc, attr, openSheet, closeSheet, refreshSheets, fieldsHtml, readForm, toast, confirmDlg, chip } from '../dom.js';
import { icon, unitSvg } from '../icons.js';
import { clone, uid, isHexColor, contrastText } from '../../core/util.js';
import { CATEGORIAS_CLAVE, ICONOS, FORMAS, TAMANOS, DEFAULT_TIPOS_RECURSO } from '../../core/defaults.js';
import { validateCatalog, tipoRecursoRetirar, catUpdate } from '../../core/commands.js';
import { tipoActivo, referenciasTipoPrev, explicacionBloqueo, duplicarTipo } from '../../core/recursos.js';
import { unitLabel } from '../../core/engine.js';

export const CAT_TITLE = { claves: 'Claves operativas', motivosEsp: 'Motivos de clave especial', sectores: 'Sectores', tiposAviso: 'Tipos de aviso', tiposRecurso: 'Tipos de recurso' };
let ED = null; // editor abierto { cat, list, all, onSave, state, readonly }

/**
 * opts: { cat, catalogs (objeto con todos los catálogos, para referencias cruzadas), onSave(list), state (estado del preventivo, para validar uso), readonly, scopeLabel,
 *         scope: 'general' (tipos de recurso de la configuración general) | 'preventivo' | 'plantilla' | 'defecto' }
 * Eliminar un tipo de recurso de la configuración general o de un preventivo muestra antes dónde se usa
 * y ofrece reasignar, eliminar con sus plantillas o retirarlo del uso (se aplica en el momento).
 */
export function openCatalog(opts) {
  ED = { ...opts, list: clone(opts.catalogs[opts.cat]) };
  openSheet({
    title: CAT_TITLE[opts.cat] + (opts.scopeLabel ? ' · ' + opts.scopeLabel : ''), size: 'l', live: true,
    render: renderEditor,
    footer: () => ED.readonly ? '' : `<div class="row end gap"><button class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary" data-a="cat.save">${icon('ok')}<span>Guardar cambios</span></button></div>`,
    onClose: () => { ED = null; },
  });
}

function renderEditor() {
  if (!ED) return '';
  const { cat, list, readonly } = ED;
  if (cat === 'motivosEsp') {
    return `<p class="muted">Lista desplegable que se muestra al pasar una unidad a la clave especial. Un motivo por línea.</p>
      <textarea id="motivos" rows="10" ${readonly ? 'disabled' : ''} data-c="cat.motivos" data-live="1">${esc(list.join('\n'))}</textarea>`;
  }
  // Los tipos retirados del uso no se listan con los demás: van aparte, con la opción de restaurarlos
  const vis = list.map((_, i) => i).filter(i => !(cat === 'tiposRecurso' && list[i].retirado));
  const rows = vis.map((i, k) => { const it = list[i]; return `<li class="cat-row">
      ${itemPreview(cat, it)}
      <div class="grow"><b>${esc(cat === 'claves' || (cat === 'tiposAviso' && it.codigo) ? it.codigo + ' · ' + it.nombre : it.nombre)}</b><small class="muted">${esc(itemSummary(cat, it))}</small></div>
      ${readonly ? '' : `<div class="row gap-s">
        <button class="btn icon ghost" data-a="cat.move" data-i="${i}" data-d="-1" aria-label="Subir"${k === 0 ? ' disabled' : ''}>▲</button>
        <button class="btn icon ghost" data-a="cat.move" data-i="${i}" data-d="1" aria-label="Bajar"${k === vis.length - 1 ? ' disabled' : ''}>▼</button>
        ${cat === 'tiposRecurso' ? `<button class="btn icon ghost" data-a="cat.dup" data-i="${i}" aria-label="Duplicar" title="Duplicar">${icon('copiar')}</button>` : ''}
        <button class="btn icon ghost" data-a="cat.edit" data-i="${i}" aria-label="Editar">${icon('editar')}</button>
        ${cat === 'claves' && it.base ? '' : `<button class="btn icon ghost" data-a="cat.del" data-i="${i}" aria-label="Eliminar" title="Eliminar">${icon('papelera')}</button>`}
      </div>`}
    </li>`; }).join('');
  const ret = cat === 'tiposRecurso' ? list.map((it, i) => [it, i]).filter(([it]) => it.retirado) : [];
  return `${cat === 'claves' ? `<p class="note">${icon('info')} La clave base <b>${esc((list.find(c => c.base) || {}).codigo || 'C0')}</b> es la única que usa el color C0 personalizado de cada unidad. Las claves en uso por alguna unidad no se pueden eliminar.</p>` : ''}
    <ul class="cat-list">${rows || '<li class="muted">Sin elementos</li>'}</ul>
    ${readonly ? '' : `<button class="btn" data-a="cat.add">${icon('mas_add')}<span>Añadir</span></button>`}
    ${ret.length ? `<details class="retirados"><summary>Retirados del uso (${ret.length})</summary>
      <p class="muted small">No se ofrecen para unidades nuevas. Se conservan para las unidades, los informes y el historial que los usan.</p>
      <ul class="cat-list">${ret.map(([it, i]) => `<li class="cat-row off">${itemPreview(cat, it)}<div class="grow"><b>${esc(it.nombre)}</b><small class="muted">Retirado</small></div>${readonly ? '' : btnRestaurar(i)}</li>`).join('')}</ul></details>` : ''}`;
}
const btnRestaurar = i => `<button type="button" class="btn sm ghost" data-a="cat.restaurar" data-i="${i}">${icon('subir')}<span>Restaurar</span></button>`;
function itemPreview(cat, it) {
  if (cat === 'tiposRecurso') {
    const v = { ...(it.vis || {}), fill: it.color || '#2E7D32', border: it.color || '#2E7D32', text: contrastText(it.color || '#2E7D32') };
    return unitSvg(v, { px: 34 });
  }
  return `<span class="swatch" style="background:${attr(it.color || '#999')}"></span>`;
}
function itemSummary(cat, it) {
  if (cat === 'claves') return [CATEGORIAS_CLAVE[it.categoria], it.especial && 'especial', it.requiereAviso && 'requiere aviso', it.alAsignar && 'al asignar', it.requiereMotivo && 'pide motivo', it.liberaAviso && 'libera el aviso', '→ ' + (it.transiciones || []).join(', ')].filter(Boolean).join(' · ');
  if (cat === 'tiposRecurso') return [it.activo === false && 'DESACTIVADO', it.categoria, (it.subtipos || []).join('/'), (it.caracteristicas || []).join(', '), ICONOS[(it.vis || {}).icono], FORMAS[(it.vis || {}).forma]].filter(Boolean).join(' · ');
  if (cat === 'tiposAviso') { const tr = ED.catalogs.tiposRecurso || []; return [it.grupo || 'Otros tipos', it.cierre && 'código de cierre', it.compatibles && it.compatibles.length ? 'Compatibles: ' + it.compatibles.map(id => (tr.find(t => t.id === id) || {}).nombre || id).join(', ') : 'Compatible con todos los recursos'].filter(Boolean).join(' · '); }
  return '';
}

function itemFields(cat, it) {
  if (cat === 'claves') {
    const codes = ED.list.map(c => c.codigo).filter(c => c !== it.codigo);
    return [
      { name: 'codigo', label: 'Código', required: true, disabled: !!it.base, value: it.codigo, help: it.base ? 'El código de la clave base no se puede cambiar.' : '' },
      { name: 'nombre', label: 'Nombre', required: true }, { name: 'descripcion', label: 'Descripción', type: 'textarea', rows: 2 },
      { name: 'color', label: 'Color', type: 'color' },
      { name: 'categoria', label: 'Categoría operativa', type: 'select', options: Object.entries(CATEGORIAS_CLAVE) },
      { name: 'transiciones', label: 'Transiciones permitidas desde esta clave', type: 'checks', options: codes.map(c => [c, c]) },
      { name: 'especial', label: 'Clave especial (grupo aparte)', type: 'checkbox' },
      { name: 'requiereAviso', label: 'Requiere aviso activo', type: 'checkbox' },
      { name: 'alAsignar', label: 'Se aplica automáticamente al asignar a un aviso', type: 'checkbox' },
      { name: 'avisoEnCurso', label: 'Pone el aviso "En curso"', type: 'checkbox' },
      { name: 'llegada', label: 'Marca la llegada al punto (tiempo de respuesta)', type: 'checkbox' },
      { name: 'liberaAviso', label: 'Libera la unidad del aviso', type: 'checkbox' },
      { name: 'requiereMotivo', label: 'Obliga a indicar motivo (desplegable)', type: 'checkbox' },
    ];
  }
  if (cat === 'sectores') return [{ name: 'nombre', label: 'Nombre', required: true }, { name: 'color', label: 'Color', type: 'color' }];
  if (cat === 'tiposAviso') return [{ name: 'codigo', label: 'Código del incidente (opcional)', placeholder: '1.2', help: 'Número con el que se elige al crear un aviso. Un código como 1.6.1 aparece debajo de 1.6.' },
    { name: 'nombre', label: 'Descripción', required: true },
    { name: 'grupo', label: 'Carpeta', placeholder: '1. Accidente de Tráfico', help: 'Carpeta en la que aparece al crear un aviso. Vacío: «Otros tipos».' },
    { name: 'color', label: 'Color', type: 'color' },
    { name: 'compatibles', label: 'Tipos de recurso compatibles (vacío = todos)', type: 'checks', options: (ED.catalogs.tiposRecurso || []).filter(t => tipoActivo(t) || (it.compatibles || []).includes(t.id)).map(t => [t.id, t.nombre + (tipoActivo(t) ? '' : t.retirado ? ' (retirado)' : ' (desactivado)')]) }];
  if (cat === 'tiposRecurso') return [
    { name: 'nombre', label: 'Nombre', required: true }, { name: 'categoria', label: 'Categoría', placeholder: 'Sanitario, Logística…' },
    { name: 'subtipos', label: 'Subtipos', type: 'tags' }, { name: 'caracteristicas', label: 'Características y materiales', type: 'tags', help: 'Material o equipamiento asociado (p. ej. Camilla, DEA, Oxígeno): se proponen al crear unidades de este tipo.' },
    { name: 'color', label: 'Color C0 predeterminado para unidades nuevas', type: 'color' },
    { name: 'icono', label: 'Icono', type: 'select', options: Object.entries(ICONOS) },
    { name: 'forma', label: 'Forma', type: 'select', options: Object.entries(FORMAS) },
    { name: 'tam', label: 'Tamaño', type: 'select', options: Object.entries(TAMANOS) },
    { name: 'activo', label: 'Activo (se ofrece al crear unidades)', type: 'checkbox', help: 'Desactivado deja de ofrecerse al crear unidades (en la configuración general, en todos los preventivos). Las unidades que ya lo usan no cambian.' },
  ];
  return [];
}
/** Alta de un tipo de recurso general sin abrir el catálogo completo (p. ej. desde el formulario de unidad) */
export function nuevoTipoRecurso(onCreated) {
  const it = { ...defaultItemTipo(), activo: true };
  openSheet({
    title: 'Nuevo tipo de recurso', size: 'm',
    render: () => `<p class="muted small">Se guarda en la configuración general: queda disponible en todos los preventivos y en todos los dispositivos conectados.</p>
      <form data-f="cat.nuevoTipo">${fieldsHtml(itemFields('tiposRecurso', it), { ...it, ...it.vis })}
      <div class="row end gap"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">Crear tipo</button></div></form>`,
  });
  NUEVO_TIPO_CB = onCreated;
}
let NUEVO_TIPO_CB = null;
F['cat.nuevoTipo'] = async form => {
  const v = readForm(form); const { icono, forma, tam, ...rest } = v;
  const t = await G.core.crearTipoRecurso({ ...rest, vis: { icono, forma, tam } });
  closeSheet(); toast('Tipo «' + t.nombre + '» creado y guardado en la configuración general', 'ok');
  if (NUEVO_TIPO_CB) { const cb = NUEVO_TIPO_CB; NUEVO_TIPO_CB = null; cb(t); }
};
const defaultItemTipo = () => ({ id: uid('rt_'), nombre: '', categoria: '', subtipos: [], caracteristicas: [], color: '#2E7D32', vis: { icono: 'ambulancia', forma: 'circulo', tam: 'm' } });

function openItem(i) {
  const cat = ED.cat; const isNew = i == null;
  const it = isNew ? defaultItem(cat) : clone(ED.list[i]);
  const values = { ...it, ...(cat === 'tiposRecurso' ? (it.vis || {}) : {}) };
  openSheet({
    title: (isNew ? 'Nuevo · ' : 'Editar · ') + CAT_TITLE[cat], size: 'm',
    render: () => `<form data-f="cat.item" data-i="${isNew ? '' : i}">${fieldsHtml(itemFields(cat, it), values)}
      <div class="row end gap"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">Aceptar</button></div></form>`,
  });
}
function defaultItem(cat) {
  if (cat === 'claves') return { codigo: 'C' + ED.list.length, nombre: '', descripcion: '', color: '#607D8B', categoria: 'ocupada', transiciones: [ED.list.find(c => c.base).codigo] };
  if (cat === 'sectores') return { id: uid('sec_'), nombre: '', color: '#1E88E5' };
  if (cat === 'tiposAviso') return { id: uid('ta_'), nombre: '', color: '#C62828', compatibles: [] };
  return { ...defaultItemTipo(), activo: true };
}

F['cat.item'] = form => {
  const v = readForm(form); const cat = ED.cat;
  const i = form.dataset.i === '' ? null : Number(form.dataset.i);
  const base = i == null ? defaultItem(cat) : clone(ED.list[i]);
  let it;
  if (cat === 'tiposRecurso') { const { icono, forma, tam, ...rest } = v; it = { ...base, ...rest, vis: { ...(base.vis || {}), icono, forma, tam } }; if (it.activo !== false) delete it.activo; }
  else it = { ...base, ...v };
  if (cat === 'claves' && base.base) it.codigo = base.codigo;
  if (cat === 'tiposAviso') for (const k of ['codigo', 'grupo']) { it[k] = String(it[k] || '').trim(); if (!it[k]) delete it[k]; }
  if (cat === 'claves') { it.codigo = String(it.codigo || '').trim().toUpperCase(); for (const k of ['especial', 'requiereAviso', 'alAsignar', 'avisoEnCurso', 'llegada', 'liberaAviso', 'requiereMotivo']) if (!it[k]) delete it[k]; }
  if (!isHexColor(it.color)) it.color = '#607D8B';
  const list = clone(ED.list);
  if (i == null) list.push(it); else {
    const old = list[i]; list[i] = it;
    if (cat === 'claves' && old.codigo !== it.codigo) for (const c of list) c.transiciones = (c.transiciones || []).map(x => (x === old.codigo ? it.codigo : x));
  }
  if (cat === 'claves' && it.alAsignar) for (const c of list) if (c !== it) delete c.alAsignar;
  ED.list = list; closeSheet(); refreshSheets();
};
A['cat.add'] = () => openItem(null);
A['cat.edit'] = el => openItem(Number(el.dataset.i));
A['cat.dup'] = el => { const i = Number(el.dataset.i); const it = duplicarTipo(ED.list, ED.list[i].id, uid('rt_')); ED.list.splice(i + 1, 0, it); refreshSheets(); toast('Copia creada: «' + it.nombre + '». Guarda los cambios para conservarla.', 'info', 5000); };
A['cat.move'] = el => {
  const i = Number(el.dataset.i), d = Number(el.dataset.d); const l = ED.list;
  // Salta los elementos que no se muestran (tipos retirados)
  let j = i + d; while (j >= 0 && j < l.length && ED.cat === 'tiposRecurso' && l[j].retirado) j += d;
  if (j < 0 || j >= l.length) return;
  [l[i], l[j]] = [l[j], l[i]]; refreshSheets();
};
A['cat.del'] = async el => {
  const i = Number(el.dataset.i); const it = ED.list[i];
  if (ED.cat === 'tiposRecurso' && ED.scope === 'general' && G.core.tiposRecursoGenerales().some(t => t.id === it.id)) return previaGeneral(it);
  if (ED.cat === 'tiposRecurso' && ED.scope === 'preventivo') {
    const e = G.core.engine(G.core.cur); const ref = e && e.state.prev.cat.tiposRecurso.some(t => t.id === it.id) ? referenciasTipoPrev(e.state, it.id, e.ops) : null;
    if (ref && (ref.historial || ref.tiposAviso.length)) return previaPreventivo(it, ref);
  }
  if (!(await confirmDlg({ title: 'Eliminar', text: '¿Eliminar "' + (it.nombre || it.codigo) + '"? Solo se permite si no está en uso.', ok: 'Eliminar', danger: true }))) return;
  const list = ED.list.filter((_, k) => k !== i);
  if (ED.cat === 'claves') for (const c of list) c.transiciones = (c.transiciones || []).filter(x => x !== it.codigo);
  if (ED.cat === 'tiposRecurso') ED.catalogs = { ...ED.catalogs };
  ED.list = list; refreshSheets();
};
// ---------- vista previa antes de eliminar un tipo de recurso ----------
let PREVIA = null;
const listaRef = (titulo, items, nota = '') => items.length ? `<div class="ref-block"><h4>${esc(titulo)} <b class="count">${items.length}</b></h4><ul class="ref-list">${items.slice(0, 30).map(x => `<li>${esc(x)}</li>`).join('')}${items.length > 30 ? `<li class="muted">… y ${items.length - 30} más</li>` : ''}</ul>${nota ? `<p class="muted small">${esc(nota)}</p>` : ''}</div>` : '';
const destinoSel = tipos => `<select id="ctr_dest" aria-label="Tipo de destino">${tipos.map(t => `<option value="${attr(t.id)}">${esc(t.nombre)}</option>`).join('')}</select>`;
/** Tipo de recurso de la configuración general */
async function previaGeneral(it) {
  const c = G.core; const ref = await c.referenciasTipoRecurso(it.id);
  const otros = c.tiposRecursoGenerales().filter(t => t.id !== it.id && tipoActivo(t));
  const nPl = ref.plantillas.length; const soloPlantillas = ref.bloquean.length > 0 && ref.bloquean.every(b => b.clase === 'plantilla');
  const nada = !nPl && !ref.tiposAviso.length && !ref.preventivos.length && !ref.plantillasPrev.length;
  PREVIA = { scope: 'general', id: it.id, nombre: it.nombre };
  openSheet({
    title: 'Eliminar · ' + it.nombre, size: 'm',
    render: () => `<h3>Dónde se usa</h3>
      ${nada ? `<p class="note">${icon('ok')} No se usa en ninguna configuración ni preventivo de este dispositivo: se puede eliminar del todo.</p>` : ''}
      ${listaRef('Unidades plantilla', ref.plantillas.map(p => p.nombre))}
      ${listaRef('Tipos de aviso por defecto (compatibilidad)', ref.tiposAviso.map(a => (a.codigo ? a.codigo + ' · ' : '') + a.nombre + (a.exclusivo ? ' — solo admite este tipo' : '')), ref.tiposAviso.some(a => !a.exclusivo) ? 'Al eliminarlo se quita de su lista de tipos compatibles.' : '')}
      ${listaRef('Preventivos de este dispositivo', ref.preventivos.map(p => p.nombre + (p.unidades ? ' · ' + p.unidades + (p.unidades === 1 ? ' unidad' : ' unidades') : ' · sin unidades de este tipo')), 'Conservan su propia copia del tipo: sus unidades, avisos, informes e historial no cambian. Deja de ofrecerse para unidades nuevas.')}
      ${listaRef('Plantillas de preventivo', ref.plantillasPrev.map(t => t.nombre), 'Conservan su propia copia.')}
      ${ref.bloquean.length ? `<p class="note warn">${icon('alerta')} ${esc(explicacionBloqueo(it, ref.bloquean))}</p>` : ''}
      <h3>¿Qué quieres hacer?</h3>
      ${!ref.bloquean.length ? `<div class="opt">${btnA('Eliminar definitivamente', 'ctr.eliminar', 'danger', 'papelera')}<p class="muted small">No volverá a añadirse sola${esInicial(it.id) ? '. Es una configuración inicial: se puede restaurar desde Configuración general' : ''}.</p></div>` : `
        ${otros.length ? `<div class="opt"><label for="ctr_dest">Reasignar a otro tipo y eliminar</label><div class="row gap wrap">${destinoSel(otros)}${btnA('Reasignar y eliminar', 'ctr.reasignar', 'primary')}</div><p class="muted small">Las unidades plantilla${ref.tiposAviso.length ? ' y la compatibilidad de los tipos de aviso' : ''} pasan al tipo elegido.</p></div>` : ''}
        ${soloPlantillas ? `<div class="opt">${btnA(nPl === 1 ? 'Eliminar también su unidad plantilla' : 'Eliminar también sus ' + nPl + ' unidades plantilla', 'ctr.conPlantillas', 'danger-ghost', 'papelera')}<p class="muted small">Las unidades ya creadas con ${nPl === 1 ? 'ella' : 'ellas'} conservan sus datos.</p></div>` : ''}`}
      <div class="opt">${btnA('Retirar del uso', 'ctr.retirar', '', 'archivar')}<p class="muted small">No se elimina: deja de ofrecerse${nPl ? ' (y sus unidades plantilla tampoco se ofrecen)' : ''}. Se puede restaurar.</p></div>`,
    footer: () => `<div class="row end"><button class="btn ghost" data-a="sheet.close">Cancelar</button></div>`,
  });
}
const btnA = (label, a, cls = '', ic = '') => `<button type="button" class="btn ${cls}" data-a="${a}">${ic ? icon(ic) : ''}<span>${esc(label)}</span></button>`;
const esInicial = id => DEFAULT_TIPOS_RECURSO.some(t => t.id === id);
async function aplicarGeneral(modo, destino = null) {
  const { id, nombre } = PREVIA;
  await G.core.eliminarTipoRecurso(id, { modo, destino });
  closeSheet(); PREVIA = null;
  if (ED && ED.cat === 'tiposRecurso') {
    const i = ED.list.findIndex(x => x.id === id);
    if (i >= 0) { if (modo === 'retirar') ED.list[i] = { ...ED.list[i], retirado: true }; else ED.list.splice(i, 1); }
    ED.catalogs = G.core.cfg.catalogos; refreshSheets();
  }
  toast(modo === 'retirar' ? '«' + nombre + '» retirado del uso' : '«' + nombre + '» eliminado' + (modo === 'reasignar' ? ' y reasignado' : ''), 'ok', 5000);
}
A['ctr.eliminar'] = () => aplicarGeneral('eliminar');
A['ctr.reasignar'] = () => aplicarGeneral('reasignar', document.getElementById('ctr_dest').value);
A['ctr.retirar'] = () => aplicarGeneral('retirar');
A['ctr.conPlantillas'] = async () => {
  if (!(await confirmDlg({ title: 'Eliminar con sus unidades plantilla', text: 'Se eliminarán el tipo «' + PREVIA.nombre + '» y las unidades plantilla que lo usan. Las unidades ya creadas en los preventivos no cambian.', ok: 'Eliminar', danger: true }))) return;
  await aplicarGeneral('conPlantillas');
};
/** Tipo de recurso usado en un preventivo: se retira (se conserva para el historial) y, si se quiere, antes se reasignan sus unidades */
function previaPreventivo(it, ref) {
  const otros = G.core.tiposParaNuevaUnidad().propios.filter(t => t.id !== it.id);
  const n = ref.unidades.length;
  PREVIA = { scope: 'preventivo', id: it.id, nombre: it.nombre };
  openSheet({
    title: 'Eliminar · ' + it.nombre, size: 'm',
    render: () => `<h3>Dónde se usa en este preventivo</h3>
      ${listaRef('Unidades', ref.unidades.map(unitLabel))}
      ${listaRef('Unidades archivadas', ref.archivadas.map(unitLabel), 'Conservan su tipo.')}
      ${listaRef('Tipos de aviso (compatibilidad)', ref.tiposAviso.map(a => (a.codigo ? a.codigo + ' · ' : '') + a.nombre))}
      <p class="note">${icon('info')} ${ref.historial ? 'Figura en el historial del preventivo, así que no se borra: se retira del uso. ' : ''}No se ofrecerá para unidades nuevas; las unidades, los avisos, los informes y el historial lo conservan.</p>
      <h3>¿Qué quieres hacer?</h3>
      ${(n || ref.tiposAviso.length) && otros.length ? `<div class="opt"><label for="ctr_dest">${n ? 'Reasignar ' + (n === 1 ? 'la unidad' : 'las ' + n + ' unidades') + ' a' : 'Cambiar en la compatibilidad por'}</label><div class="row gap wrap">${destinoSel(otros)}${btnA('Reasignar y retirar', 'ctp.reasignar', 'primary')}</div></div>` : ''}
      <div class="opt">${btnA(n ? 'Retirar sin reasignar' : 'Retirar del uso', 'ctp.retirar', '', 'archivar')}</div>`,
    footer: () => `<div class="row end"><button class="btn ghost" data-a="sheet.close">Cancelar</button></div>`,
  });
}
async function aplicarPreventivo(destino = null) {
  const { id, nombre } = PREVIA;
  await G.core.exec(tipoRecursoRetirar, id, { destino });
  closeSheet(); PREVIA = null;
  if (ED && ED.cat === 'tiposRecurso') {
    const i = ED.list.findIndex(x => x.id === id); if (i >= 0) ED.list[i] = { ...ED.list[i], retirado: true };
    ED.catalogs = G.core.state.prev.cat; refreshSheets();
  }
  toast('«' + nombre + '» retirado del uso' + (destino ? '; unidades reasignadas' : ''), 'ok', 5000);
}
A['ctp.reasignar'] = () => aplicarPreventivo(document.getElementById('ctr_dest').value);
A['ctp.retirar'] = () => aplicarPreventivo(null);
A['cat.restaurar'] = async el => {
  const i = Number(el.dataset.i); const it = ED.list[i];
  if (ED.scope === 'general' && G.core.tiposRecursoGenerales().some(t => t.id === it.id)) await G.core.restaurarTipoRecurso(it.id);
  else if (ED.scope === 'preventivo' && G.core.state.prev.cat.tiposRecurso.some(t => t.id === it.id)) {
    const cur = G.core.state.prev.cat.tiposRecurso;
    await G.core.exec(catUpdate, 'tiposRecurso', cur.map(x => { if (x.id !== it.id) return x; const y = { ...x }; delete y.retirado; return y; }));
  }
  const n = { ...it }; delete n.retirado; ED.list[i] = n; refreshSheets();
  toast('«' + it.nombre + '» vuelve a estar disponible', 'ok');
};
A['cat.motivos'] = () => { };
import { CH } from '../state.js';
CH['cat.motivos'] = el => { ED.list = el.value.split('\n').map(s => s.trim()).filter(Boolean); };
A['cat.save'] = async () => {
  validateCatalog(ED.cat, ED.list, ED.state || null);
  await ED.onSave(clone(ED.list));
  toast('Catálogo guardado', 'ok');
  closeSheet();
};

/** Bloque de botones para abrir cada catálogo */
export function catalogButtons(action, extra = {}) {
  const d = Object.entries(extra).map(([k, v]) => ` data-${k}="${attr(v)}"`).join('');
  return `<div class="grid-btns">${Object.entries(CAT_TITLE).map(([k, t]) => `<button class="tile" data-a="${action}" data-cat="${k}"${d}>${icon(k === 'claves' ? 'capas' : k === 'sectores' ? 'mapa' : k === 'tiposAviso' ? 'avisos' : k === 'tiposRecurso' ? 'unidades' : 'lista')}<span>${t}</span></button>`).join('')}</div>`;
}
export function claveChips(claves) { return claves.map(c => chip(c.codigo + ' ' + c.nombre, c.color)).join(' '); }
