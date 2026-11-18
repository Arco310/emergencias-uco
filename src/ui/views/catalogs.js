// Editores de catálogos (claves, motivos, sectores, tipos de aviso y de recurso).
// Se reutilizan en la configuración global, en cada preventivo y en las plantillas.
import { G, A, F } from '../state.js';
import { esc, attr, openSheet, closeSheet, refreshSheets, fieldsHtml, readForm, toast, confirmDlg, chip } from '../dom.js';
import { icon, unitSvg } from '../icons.js';
import { clone, uid, isHexColor, contrastText } from '../../core/util.js';
import { CATEGORIAS_CLAVE, ICONOS, FORMAS, TAMANOS } from '../../core/defaults.js';
import { validateCatalog } from '../../core/commands.js';

export const CAT_TITLE = { claves: 'Claves operativas', motivosEsp: 'Motivos de clave especial', sectores: 'Sectores', tiposAviso: 'Tipos de aviso', tiposRecurso: 'Tipos de recurso' };
let ED = null; // editor abierto { cat, list, all, onSave, state, readonly }

/**
 * opts: { cat, catalogs (objeto con todos los catálogos, para referencias cruzadas), onSave(list), state (estado del preventivo, para validar uso), readonly, scopeLabel }
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
  const rows = list.map((it, i) => `<li class="cat-row">
      ${itemPreview(cat, it)}
      <div class="grow"><b>${esc(cat === 'claves' ? it.codigo + ' · ' + it.nombre : it.nombre)}</b><small class="muted">${esc(itemSummary(cat, it))}</small></div>
      ${readonly ? '' : `<div class="row gap-s">
        <button class="btn icon ghost" data-a="cat.move" data-i="${i}" data-d="-1" aria-label="Subir"${i === 0 ? ' disabled' : ''}>▲</button>
        <button class="btn icon ghost" data-a="cat.move" data-i="${i}" data-d="1" aria-label="Bajar"${i === list.length - 1 ? ' disabled' : ''}>▼</button>
        ${cat === 'tiposRecurso' ? `<button class="btn icon ghost" data-a="cat.dup" data-i="${i}" aria-label="Duplicar">${icon('copiar')}</button>` : ''}
        <button class="btn icon ghost" data-a="cat.edit" data-i="${i}" aria-label="Editar">${icon('editar')}</button>
        ${cat === 'claves' && it.base ? '' : `<button class="btn icon ghost" data-a="cat.del" data-i="${i}" aria-label="Eliminar">${icon('papelera')}</button>`}
      </div>`}
    </li>`).join('');
  return `${cat === 'claves' ? `<p class="note">${icon('info')} La clave base <b>${esc((list.find(c => c.base) || {}).codigo || 'C0')}</b> es la única que usa el color C0 personalizado de cada unidad. Las claves en uso por alguna unidad no se pueden eliminar.</p>` : ''}
    <ul class="cat-list">${rows || '<li class="muted">Sin elementos</li>'}</ul>
    ${readonly ? '' : `<button class="btn" data-a="cat.add">${icon('mas_add')}<span>Añadir</span></button>`}`;
}
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
  if (cat === 'tiposAviso') { const tr = ED.catalogs.tiposRecurso || []; return it.compatibles && it.compatibles.length ? 'Compatibles: ' + it.compatibles.map(id => (tr.find(t => t.id === id) || {}).nombre || id).join(', ') : 'Compatible con todos los recursos'; }
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
  if (cat === 'tiposAviso') return [{ name: 'nombre', label: 'Nombre', required: true }, { name: 'color', label: 'Color', type: 'color' },
    { name: 'compatibles', label: 'Tipos de recurso compatibles (vacío = todos)', type: 'checks', options: (ED.catalogs.tiposRecurso || []).map(t => [t.id, t.nombre]) }];
  if (cat === 'tiposRecurso') return [
    { name: 'nombre', label: 'Nombre', required: true }, { name: 'categoria', label: 'Categoría', placeholder: 'Sanitario, Logística…' },
    { name: 'subtipos', label: 'Subtipos', type: 'tags' }, { name: 'caracteristicas', label: 'Características', type: 'tags' },
    { name: 'color', label: 'Color C0 predeterminado para unidades nuevas', type: 'color' },
    { name: 'icono', label: 'Icono', type: 'select', options: Object.entries(ICONOS) },
    { name: 'forma', label: 'Forma', type: 'select', options: Object.entries(FORMAS) },
    { name: 'tam', label: 'Tamaño', type: 'select', options: Object.entries(TAMANOS) },
    { name: 'activo', label: 'Activo (se ofrece al crear unidades)', type: 'checkbox', help: 'Desactivar no cambia las unidades que ya lo usan ni los preventivos existentes.' },
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
A['cat.dup'] = el => { const it = clone(ED.list[Number(el.dataset.i)]); it.id = uid('rt_'); it.nombre += ' (copia)'; ED.list.splice(Number(el.dataset.i) + 1, 0, it); refreshSheets(); };
A['cat.move'] = el => { const i = Number(el.dataset.i), d = Number(el.dataset.d); const l = ED.list; [l[i], l[i + d]] = [l[i + d], l[i]]; refreshSheets(); };
A['cat.del'] = async el => {
  const i = Number(el.dataset.i); const it = ED.list[i];
  if (!(await confirmDlg({ title: 'Eliminar', text: '¿Eliminar "' + (it.nombre || it.codigo) + '"? Solo se permite si no está en uso.', ok: 'Eliminar', danger: true }))) return;
  const list = ED.list.filter((_, k) => k !== i);
  if (ED.cat === 'claves') for (const c of list) c.transiciones = (c.transiciones || []).filter(x => x !== it.codigo);
  if (ED.cat === 'tiposRecurso') ED.catalogs = { ...ED.catalogs };
  ED.list = list; refreshSheets();
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
