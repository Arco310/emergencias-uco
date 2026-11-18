// Preventivos (crear, duplicar, unirse, archivar, exportar) y plantillas reutilizables.
import { G, A, F, CH, filt } from '../state.js';
import { esc, attr, openSheet, closeSheet, refreshSheets, toast, confirmDlg, fieldsHtml, readForm, chip, empty, btn, tabs, saveFile, pickFile, readText, readBytes, fileStamp, safeName } from '../dom.js';
import { icon, unitSvg } from '../icons.js';
import { now, fmtDateTime, fmtDate, isoDate, clone, uid, contrastText } from '../../core/util.js';
import { KPIS, CAMPOS_TARJETA } from '../../core/defaults.js';
import * as C from '../../core/commands.js';
import { newTemplate, contentFromConfig, exportTemplate, importTemplate, normalizeContent } from '../../core/templates.js';
import { prevJSON } from '../../core/exporters.js';
import { openCatalog, catalogButtons, CAT_TITLE } from './catalogs.js';
import { unitFields, unitValues, unitFromForm } from './ops.js';
import { effectiveVis } from '../../core/visual.js';

const core = () => G.core;
const can = p => G.core.can(p);
const EST = { preparacion: ['En preparación', 'warn'], activo: ['Activo', 'ok'], cerrado: ['Cerrado', 'muted'] };

// ======================= preventivos =======================
export function renderHome() {
  const f = filt('home'); const tab = f.tab || 'act';
  const sums = [...(core().summaries || [])].sort((a, b) => (b.actualizado || 0) - (a.actualizado || 0));
  const act = sums.filter(s => !s.archivado && s.estado !== 'cerrado');
  const hist = sums.filter(s => s.archivado || s.estado === 'cerrado');
  const list = tab === 'act' ? act : hist;
  const disp = (core().centralDisp || []).filter(x => tab === 'act' ? !x.archivado && x.estado !== 'cerrado' : x.archivado || x.estado === 'cerrado');
  return `<div class="page-head"><h1>Preventivos</h1><div class="actions">
      ${can('preventivos.crear') ? btn('Nuevo preventivo', 'home.new', { cls: 'primary', ic: 'mas_add' }) : ''}
      ${can('sync.gestionar') && !core().centralMeta ? btn('Unirse con código', 'home.join', { ic: 'sync' }) : ''}
    </div></div>
  ${centralBanner()}
  ${tabs([['act', 'En curso', act.length + disp.length], ['hist', 'Historial', hist.length]], tab, 'home.tab')}
  <div class="plist">${list.map(card).join('')}${disp.map(cardCentral).join('')}${!list.length && !disp.length ? empty(tab === 'act' ? 'No hay preventivos en curso. Crea uno nuevo.' : 'El historial está vacío.') : ''}</div>`;
}
/** Estado del servidor central en la pantalla de inicio */
function centralBanner() {
  const { meta, st, remoto } = core().centralEstado();
  if (meta) {
    const est = { conectado: ['Conectado', 'ok'], sincronizando: ['Sincronizando…', 'ok'], pendiente: ['Cambios pendientes', 'warn'], sin_conexion: ['Sin conexión: se trabaja en local', 'warn'], error: ['Error', 'bad'] }[st.estado] || ['Comprobando…', 'muted'];
    return `<div class="central-bar" data-central-estado="${attr(st.estado || '')}"><span class="chip ${est[1]}">Servidor central: ${esc(est[0])}</span><span class="muted small">${esc(meta.nombre || meta.server)}${st.ultimo ? ' · ' + esc(fmtDateTime(st.ultimo)) : ''}</span>${btn('Detalles', 'nav', { cls: 'sm ghost', data: { v: 'central' } })}</div>`;
  }
  if (remoto && remoto.antiguo) return can('central.gestionar') ? `<div class="note" data-central-aviso="actualizar">El servidor (versión ${esc(remoto.version || '?')}) debe actualizarse a la 1.1.0 o posterior para usar el servidor central. Mientras tanto todo funciona como hasta ahora.</div>` : '';
  if (remoto && remoto.org) return `<div class="note" data-central-aviso="conectar">Este dispositivo aún no está conectado al <b>servidor central</b>. Conéctalo una vez con tu usuario y contraseña del servidor y los preventivos compartidos aparecerán solos. ${btn('Conectar', 'nav', { cls: 'sm primary', data: { v: 'central' } })}</div>`;
  if (remoto && can('central.gestionar')) return `<div class="note" data-central-aviso="activar">El <b>servidor central</b> está disponible pero aún no se ha activado. Actívalo una sola vez y los preventivos compartidos y los usuarios serán comunes a todos los dispositivos. ${btn('Activar', 'nav', { cls: 'sm primary', data: { v: 'central' } })}</div>`;
  return '';
}
function cardCentral(x) {
  const e = EST[x.estado] || ['?', 'muted'];
  return `<article class="pcard pcard-central">
    <button class="pcard-main" data-a="home.openCentral" data-id="${attr(x.pid)}">
      <span class="row gap-s wrap"><b class="pname">${esc(x.nombre)}</b><span class="chip ${e[1]}">${e[0]}</span>${chip('En el servidor central', '#1565C0')}</span>
      <span class="muted small">${x.fecha ? esc(fmtDate(new Date(x.fecha + 'T12:00').getTime())) : 'Sin fecha'}${x.por ? ' · creado en ' + esc(x.por) : ''}</span>
      <span class="muted small">Todavía no se ha abierto en este dispositivo: pulsa para descargarlo y abrirlo.</span>
    </button></article>`;
}
A['home.openCentral'] = async el => {
  toast('Descargando el preventivo del servidor central…', 'info', 4000);
  await core().abrirCentral(el.dataset.id);
  try { localStorage.setItem('uco:last', el.dataset.id); } catch { }
  G.go('panel');
};
function card(s) {
  const e = EST[s.estado] || ['?', 'muted'];
  return `<article class="pcard">
    <button class="pcard-main" data-a="home.open" data-id="${s.id}">
      <span class="row gap-s wrap"><b class="pname">${esc(s.nombre)}</b><span class="chip ${e[1]}">${e[0]}</span>${s.archivado ? chip('Archivado', '#757575') : ''}${s.modalidad === 'compartida' ? chip('Compartido', '#1565C0') : ''}${s.conflictos ? chip(s.conflictos + ' conflictos', '#C62828') : ''}</span>
      <span class="muted small">${s.fecha ? esc(fmtDate(new Date(s.fecha + 'T12:00').getTime())) : 'Sin fecha'}${s.horaInicio ? ' · ' + esc(s.horaInicio) + (s.horaFin ? '–' + esc(s.horaFin) : '') : ''}${s.origen && s.origen.nombre ? ' · desde ' + esc(s.origen.nombre) : ''}</span>
      <span class="pstats"><span><b>${s.unidades}</b> unidades</span><span><b>${s.avisos}</b> avisos</span><span><b>${s.activos}</b> abiertos</span></span>
      <span class="muted small">Última actividad: ${s.actualizado ? fmtDateTime(s.actualizado) : '—'}</span>
    </button>
    <div class="pcard-act">
      ${can('preventivos.crear') ? btn('', 'home.new', { cls: 'icon ghost', ic: 'copiar', data: { origen: 'dup:' + s.id }, title: 'Duplicar' }) : ''}
      ${can('exportar') ? btn('', 'home.export', { cls: 'icon ghost', ic: 'descargar', data: { id: s.id }, title: 'Exportar JSON' }) : ''}
      ${can('preventivos.cerrar') && s.estado !== 'activo' ? btn('', 'home.archive', { cls: 'icon ghost', ic: 'archivar', data: { id: s.id, v: s.archivado ? '0' : '1' }, title: s.archivado ? 'Recuperar del historial' : 'Archivar' }) : ''}
    </div></article>`;
}
A['home.tab'] = el => { filt('home').tab = el.dataset.v; G.render(); };
A['home.open'] = async el => {
  await core().openPrev(el.dataset.id);
  try { localStorage.setItem('uco:last', el.dataset.id); } catch { }
  G.go('panel');
};
A['home.archive'] = async el => {
  const arch = el.dataset.v === '1';
  if (!(await confirmDlg({ title: arch ? 'Archivar preventivo' : 'Recuperar del historial', text: arch ? 'Pasará al historial en solo lectura. Podrás recuperarlo.' : 'Volverá a la lista de preventivos (si está cerrado seguirá en solo lectura).', ok: arch ? 'Archivar' : 'Recuperar' }))) return;
  await core().execOn(el.dataset.id, C.prevArchivar, arch); G.render();
};
A['home.export'] = async el => {
  const e = core().engines.get(el.dataset.id) || await core().loadEngine(el.dataset.id);
  await saveFile(safeName(e.state.prev.nombre) + '-' + fileStamp() + '.json', JSON.stringify(prevJSON(e, { usuario: core().user.nombre, dispositivo: core().device.nombre }), null, 1), 'application/json');
};

// ---------- nuevo preventivo ----------
let TPLS = [];
A['home.new'] = async el => {
  const pre = (el && el.dataset && el.dataset.origen) || 'cfg';
  TPLS = await core().repo.listTemplates();
  const sums = core().summaries || [];
  const opts = [['cfg', 'En blanco (configuración general)'], ...TPLS.map(t => ['tpl:' + t.id, (t.favorita ? '★ ' : '') + 'Plantilla: ' + t.nombre]), ...sums.map(s => ['dup:' + s.id, 'Duplicar: ' + s.nombre])];
  const today = isoDate(now());
  const srcName = pre.startsWith('dup:') ? (sums.find(s => s.id === pre.slice(4)) || {}).nombre : '';
  openSheet({
    title: 'Nuevo preventivo', size: 'l',
    render: () => `<form data-f="home.create">
      <h3>Origen</h3>${fieldsHtml([
        { name: 'origen', label: 'Partir de', type: 'select', options: opts, value: pre, help: 'La plantilla o el preventivo de origen se copian: los cambios posteriores en ellos no afectan a este preventivo. Nunca se copian avisos, números ni historiales.' },
        { name: 'copUnits', label: 'Copiar unidades (duplicar)', type: 'checkbox', value: true }, { name: 'copPlan', label: 'Copiar plano táctico y posiciones (duplicar)', type: 'checkbox', value: true },
      ])}
      <h3>Datos</h3>${fieldsHtml([
        { name: 'nombre', label: 'Nombre del preventivo', required: true, value: srcName ? srcName + ' (copia)' : '' },
        { name: 'descripcion', label: 'Descripción', type: 'textarea', rows: 2 },
        '<div class="row gap wrap">', { name: 'fecha', label: 'Fecha', type: 'date', value: today }, { name: 'horaInicio', label: 'Hora de inicio', type: 'time' }, { name: 'horaFin', label: 'Hora de finalización', type: 'time' }, '</div>',
        { name: 'lugar', label: 'Lugar (dirección)', placeholder: 'Se puede completar después con coordenadas' },
      ])}
      <h3>Modalidad</h3>${fieldsHtml(modalidadFields())}
      <div class="row end gap sticky-foot"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">Crear preventivo</button></div></form>`,
  });
};
F['home.create'] = async form => {
  const v = readForm(form); const c = core();
  let seed;
  if (v.origen.startsWith('tpl:')) {
    const t = TPLS.find(x => x.id === v.origen.slice(4)) || await c.repo.getTemplate(v.origen.slice(4));
    seed = c.seedFromTemplate(t);
  } else if (v.origen.startsWith('dup:')) {
    const pid = v.origen.slice(4);
    if (!c.engines.has(pid)) await c.loadEngine(pid);
    seed = c.seedFromPrev(pid, { unidades: v.copUnits, plano: v.copPlan });
  } else seed = c.seedFromConfig();
  const datos = { nombre: v.nombre, descripcion: v.descripcion || seed.descripcion || '', fecha: v.fecha, horaInicio: v.horaInicio, horaFin: v.horaFin, lugar: v.lugar ? { txt: v.lugar, lat: null, lon: null } : null, modalidad: v.modalidad, activar: v.activar, participantes: seed.participantes || [] };
  const pid = await c.createPrev({ datos, seed });
  try { localStorage.setItem('uco:last', pid); } catch { }
  closeSheet();
  toast((v.activar ? 'Preventivo creado y activo' : 'Preventivo creado en preparación: revisa la configuración y actívalo') + (c.meta(pid).central ? '. Compartido en el servidor central.' : ''), 'ok', 6000);
  G.go('panel');
  // Compartido sin servidor central: se muestra el código de incorporación (por archivo o con un servidor propio)
  if (v.modalidad === 'compartida' && !c.meta(pid).central) setTimeout(() => G.go('sync'), 50);
};
/** Modalidad: con servidor central no se pregunta ninguna dirección; se usa automáticamente */
function modalidadFields() {
  const central = core().centralMeta;
  const act = { name: 'activar', label: 'Activar ahora (si no, queda "en preparación" para revisar unidades, plano y configuración)', type: 'checkbox', value: false };
  if (central) return [{ name: 'modalidad', label: 'Modalidad de funcionamiento', type: 'select', value: 'compartida', options: [['compartida', 'Compartida en el servidor central (' + (central.nombre || central.server) + ')'], ['independiente', 'Independiente: solo en este dispositivo']], help: 'Los preventivos compartidos aparecen solos en todos los dispositivos dados de alta. No hay que escribir ninguna dirección.' }, act];
  const srv = core().cfg.syncServidor;
  return [{ name: 'modalidad', label: 'Modalidad de funcionamiento', type: 'select', options: [['independiente', 'Independiente: un único dispositivo, sin Internet ni servidor'], ['compartida', srv ? 'Compartida con código de incorporación (servidor ' + srv + ')' : 'Compartida por archivo (sin servidor)']], help: 'Para que los preventivos se compartan solos entre dispositivos, configura una vez el servidor central (Sistema → Servidor central).' }, act];
}

// ---------- unirse ----------
A['home.join'] = () => openSheet({
  title: 'Unirse a un preventivo compartido', size: 'm',
  render: () => `<form data-f="home.joinSubmit">
    <p class="muted">Pega el código de incorporación que te ha facilitado el coordinador (empieza por <code>UCO1.</code>).</p>
    ${fieldsHtml([{ name: 'code', label: 'Código', type: 'textarea', rows: 4, required: true }])}
    <div class="row end gap"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">Unirse</button></div></form>`,
});
F['home.joinSubmit'] = async form => {
  const r = await core().joinPrev(form.code.value);
  closeSheet();
  if (r.ok) { try { localStorage.setItem('uco:last', r.pid); } catch { } toast('Incorporado al preventivo', 'ok'); G.go('panel'); return; }
  const go = await confirmDlg({ title: 'Sin conexión con el servidor', text: (r.error ? r.error + '. ' : '') + 'Puedes importar un paquete de sincronización (.ucosync) exportado desde otro dispositivo del preventivo.', ok: 'Importar paquete', cancel: 'Más tarde' });
  if (!go) return;
  const f = await pickFile('.ucosync,.json,application/json'); if (!f) return;
  const imp = await core().importBundle(await readText(f));
  await core().openPrev(imp.pid); toast('Preventivo importado (' + imp.nuevas + ' operaciones)', 'ok'); G.go('panel');
};

// ======================= plantillas =======================
let TL = null;
export function renderTemplates() {
  if (!TL) { core().repo.listTemplates().then(t => { TL = t; G.render(); }); return '<p class="muted">Cargando…</p>'; }
  const list = TL; TL = null;
  const gest = can('plantillas.gestionar');
  return `<div class="page-head"><h1>Plantillas</h1><div class="actions">
    ${gest ? btn('Nueva plantilla', 'tpl.new', { cls: 'primary', ic: 'mas_add' }) : ''}${gest ? btn('Importar', 'tpl.import', { ic: 'subir' }) : ''}</div></div>
  <p class="muted">Preparan preventivos habituales: tipos de recurso, unidades de referencia, sectores, plano, tipos de aviso, claves, roles previstos y preferencias. Cambiar una plantilla no modifica los preventivos ya creados.</p>
  <div class="plist">${list.map(t => `<article class="pcard">
    <button class="pcard-main" data-a="tpl.edit" data-id="${t.id}"><span class="row gap-s"><b class="pname">${t.favorita ? '★ ' : ''}${esc(t.nombre)}</b>${chip(t.contenido.modalidad === 'compartida' ? 'Compartida' : 'Independiente', '#546E7A')}</span>
      ${t.descripcion ? `<span class="small">${esc(t.descripcion)}</span>` : ''}
      <span class="pstats"><span><b>${t.contenido.unidades.length}</b> unidades</span><span><b>${t.contenido.cat.sectores.length}</b> sectores</span><span><b>${t.contenido.cat.tiposRecurso.length}</b> tipos</span><span>${t.contenido.plano ? 'con plano' : 'sin plano'}</span></span>
      <span class="muted small">Usada ${t.usos.length} ${t.usos.length === 1 ? 'vez' : 'veces'}${t.usos.length ? ' · última: ' + fmtDateTime(t.usos[t.usos.length - 1].t) : ''} · modificada ${fmtDateTime(t.modificada)}</span></button>
    <div class="pcard-act">
      ${can('preventivos.crear') ? btn('', 'home.new', { cls: 'icon ghost', ic: 'play', data: { origen: 'tpl:' + t.id }, title: 'Crear preventivo con esta plantilla' }) : ''}
      ${gest ? btn('', 'tpl.fav', { cls: 'icon ghost' + (t.favorita ? ' on' : ''), ic: 'estrella', data: { id: t.id }, title: t.favorita ? 'Quitar de favoritas' : 'Marcar como favorita' }) : ''}
      ${gest ? btn('', 'tpl.dup', { cls: 'icon ghost', ic: 'copiar', data: { id: t.id }, title: 'Duplicar' }) : ''}
      ${btn('', 'tpl.export', { cls: 'icon ghost', ic: 'descargar', data: { id: t.id }, title: 'Exportar' })}
      ${gest ? btn('', 'tpl.del', { cls: 'icon ghost', ic: 'papelera', data: { id: t.id }, title: 'Eliminar' }) : ''}
    </div></article>`).join('') || empty('No hay plantillas. Crea una desde la configuración general o desde un preventivo existente (Más → Crear plantilla).')}</div>`;
}
const reloadT = () => { TL = null; G.render(); };
A['tpl.new'] = async () => {
  const r = await confirmDlg({ title: 'Nueva plantilla', ok: 'Crear', fields: [{ name: 'nombre', label: 'Nombre', required: true }, { name: 'descripcion', label: 'Descripción', type: 'textarea' }] });
  if (!r) return;
  const t = newTemplate({ nombre: r.nombre, descripcion: r.descripcion, contenido: contentFromConfig(core().cfg), origen: { tipo: 'manual' } });
  await core().repo.saveTemplate(t, 'Creación de plantilla'); toast('Plantilla creada', 'ok'); reloadT(); openTpl(t);
};
A['tpl.fromPrev'] = async () => {
  const r = await confirmDlg({ title: 'Plantilla desde este preventivo', ok: 'Crear plantilla', fields: [
    { name: 'nombre', label: 'Nombre', required: true, value: core().state.prev.nombre }, { name: 'descripcion', label: 'Descripción', type: 'textarea' },
    { name: 'unidades', label: 'Incluir unidades como referencia', type: 'checkbox', value: true }, { name: 'plano', label: 'Incluir plano y posiciones', type: 'checkbox', value: true }] });
  if (!r) return;
  await core().templateFromCurrent(r); toast('Plantilla creada (sin avisos, números ni historiales)', 'ok', 5000);
};
A['tpl.fav'] = async el => { const t = await core().repo.getTemplate(el.dataset.id); t.favorita = !t.favorita; await core().repo.saveTemplate(t, t.favorita ? 'Plantilla marcada como favorita' : 'Plantilla desmarcada como favorita'); reloadT(); };
A['tpl.dup'] = async el => {
  const t = await core().repo.getTemplate(el.dataset.id);
  const n = newTemplate({ nombre: t.nombre + ' (copia)', descripcion: t.descripcion, contenido: clone(t.contenido), origen: { tipo: 'duplicada', id: t.id, nombre: t.nombre } });
  await core().repo.saveTemplate(n, 'Duplicación de plantilla'); toast('Plantilla duplicada', 'ok'); reloadT();
};
A['tpl.del'] = async el => {
  const t = await core().repo.getTemplate(el.dataset.id);
  if (!(await confirmDlg({ title: 'Eliminar plantilla', text: '¿Eliminar «' + t.nombre + '»? Los preventivos creados con ella no se ven afectados.', ok: 'Eliminar', danger: true }))) return;
  await core().repo.deleteTemplate(t.id); reloadT();
};
A['tpl.export'] = async el => {
  const t = await core().repo.getTemplate(el.dataset.id);
  const out = exportTemplate(t);
  if (t.contenido.plano && t.contenido.plano.blob) { const b = await core().repo.getBlob(t.contenido.plano.blob); out.planoB64 = b ? b64bytes(b.bytes) : null; }
  await saveFile('plantilla-' + safeName(t.nombre) + '.json', JSON.stringify(out), 'application/json', { share: true });
};
function b64bytes(u) { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
A['tpl.import'] = async () => {
  const f = await pickFile('.json,application/json'); if (!f) return;
  const obj = JSON.parse(await readText(f));
  const t = importTemplate(obj);
  if (obj.planoB64 && t.contenido.plano) {
    const bin = atob(obj.planoB64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    t.contenido.plano.blob = await core().repo.putBlob(u, t.contenido.plano);
  }
  await core().repo.saveTemplate(t, 'Importación de plantilla'); toast('Plantilla importada', 'ok'); reloadT();
};

// ---------- editor de plantilla ----------
let TP = null;
A['tpl.edit'] = async el => openTpl(await core().repo.getTemplate(el.dataset.id));
function openTpl(t) {
  TP = { t: clone(t), tab: 'gen' };
  openSheet({ title: () => 'Plantilla · ' + esc(TP ? TP.t.nombre : ''), size: 'l', live: true, render: tplBody, onClose: () => { TP = null; reloadT(); } });
}
const saveTP = async (accion = 'Modificación de plantilla') => { TP.t.contenido = normalizeContent(TP.t.contenido); await core().repo.saveTemplate(TP.t, accion); refreshSheets(); toast('Plantilla guardada', 'ok'); };
function tplBody() {
  if (!TP) return '';
  const t = TP.t; const c = t.contenido; const ro = !can('plantillas.gestionar');
  const head = `${tabs([['gen', 'General'], ['cat', 'Catálogos'], ['uni', 'Unidades', c.unidades.length], ['pref', 'Preferencias'], ['plano', 'Plano'], ['usos', 'Usos', t.usos.length]], TP.tab, 'tp.tab')}`;
  if (TP.tab === 'gen') return head + `<form data-f="tp.gen">${fieldsHtml([
    { name: 'nombre', label: 'Nombre', required: true, disabled: ro }, { name: 'descripcion', label: 'Descripción de la plantilla', type: 'textarea', disabled: ro },
    { name: 'descripcionPrev', label: 'Descripción que tendrá el preventivo', type: 'textarea', disabled: ro },
    { name: 'modalidad', label: 'Modalidad prevista', type: 'select', options: [['independiente', 'Independiente'], ['compartida', 'Compartida']], disabled: ro },
    { name: 'participantes', label: 'Usuarios y roles previstos (uno por línea: Nombre — Rol)', type: 'textarea', rows: 4, disabled: ro },
  ], { nombre: t.nombre, descripcion: t.descripcion, descripcionPrev: c.descripcionPrev, modalidad: c.modalidad, participantes: (c.participantes || []).map(p => p.nombre + (p.rol ? ' — ' + p.rol : '')).join('\n') })}
    ${c.roles && c.roles.length ? `<p class="muted small">Roles y permisos de referencia guardados: ${c.roles.map(r => esc(r.nombre)).join(', ')}</p>` : ''}
    ${ro ? '' : '<div class="row end"><button class="btn primary">Guardar</button></div>'}</form>`;
  if (TP.tab === 'cat') return head + `<p class="muted">Catálogos que se copiarán al crear el preventivo.</p>${catalogButtons('tp.cat')}`;
  if (TP.tab === 'uni') return head + `<p class="muted">Unidades de referencia: al crear el preventivo se generan unidades nuevas con su configuración (sin identificadores ni historial).</p>
    ${ro ? '' : `<div class="row end">${btn('Añadir unidad', 'tp.unit', { ic: 'mas_add', cls: 'primary' })}</div>`}
    <ul class="cat-list">${c.unidades.map((u, i) => { const vis = { ...effectiveVis({ cat: c.cat }, u), fill: u.colorC0 || '#2E7D32', border: u.colorC0 || '#2E7D32' }; vis.text = contrastText(vis.fill); return `<li class="cat-row">${unitSvg(vis, { px: 32 })}<div class="grow"><b>${esc(u.ind)}</b> ${esc(u.nombre || '')}<small class="muted">${esc(((c.cat.tiposRecurso.find(x => x.id === u.tipo) || {}).nombre) || 'Sin tipo')}${u.plan ? ' · con posición en plano' : ''}</small></div>${ro ? '' : `${btn('', 'tp.unit', { cls: 'icon ghost', ic: 'editar', data: { i } })}${btn('', 'tp.unitDel', { cls: 'icon ghost', ic: 'papelera', data: { i } })}`}</li>`; }).join('') || '<li class="muted">Sin unidades de referencia</li>'}</ul>`;
  if (TP.tab === 'pref') return head + `<form data-f="tp.pref">${fieldsHtml([
    { name: 'descansoMin', label: 'Duración predeterminada del descanso (minutos)', type: 'number', min: 1, max: 600, disabled: ro },
    { name: 'autoFinalizarAviso', label: 'Finalizar automáticamente el aviso cuando sus unidades quedan libres', type: 'checkbox', disabled: ro },
    { name: 'avisoCompatibilidadEstricta', label: 'Compatibilidad estricta', type: 'checkbox', disabled: ro },
    { name: 'kpis', label: 'Indicadores del centro de control', type: 'checks', options: Object.entries(KPIS), disabled: ro },
    { name: 'camposTarjeta', label: 'Campos visibles en tarjetas', type: 'checks', options: Object.entries(CAMPOS_TARJETA), disabled: ro },
  ], c.cfg)}${ro ? '' : '<div class="row end"><button class="btn primary">Guardar</button></div>'}</form>`;
  if (TP.tab === 'plano') return head + (c.plano ? `<p>Plano: <b>${esc(c.plano.nombre || 'imagen')}</b> (${c.plano.w}×${c.plano.h})</p>` : '<p class="muted">Sin plano.</p>') + (ro ? '' : `<div class="actions">${btn(c.plano ? 'Cambiar imagen' : 'Importar imagen', 'tp.plano', { ic: 'subir' })}${c.plano ? btn('Quitar plano', 'tp.planoDel', { ic: 'papelera' }) : ''}</div>`);
  return head + `<ul class="tl">${t.usos.slice().reverse().map(u => `<li><time>${fmtDateTime(u.t)}</time><span>${esc(u.nombre)}</span></li>`).join('') || '<li class="muted">Todavía no se ha utilizado</li>'}</ul>`;
}
A['tp.tab'] = el => { TP.tab = el.dataset.v; refreshSheets(); };
F['tp.gen'] = async form => {
  const v = readForm(form);
  TP.t.nombre = v.nombre; TP.t.descripcion = v.descripcion;
  Object.assign(TP.t.contenido, { descripcionPrev: v.descripcionPrev, modalidad: v.modalidad, participantes: String(v.participantes || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [n, ...r] = l.split(/\s+[—-]\s+/); return { nombre: n.trim(), rol: r.join(' - ').trim() }; }) });
  await saveTP();
};
F['tp.pref'] = async form => { const v = readForm(form); TP.t.contenido.cfg = { ...TP.t.contenido.cfg, ...v, descansoMin: Number(v.descansoMin) || 30 }; await saveTP(); };
A['tp.cat'] = el => openCatalog({ cat: el.dataset.cat, catalogs: TP.t.contenido.cat, scopeLabel: 'plantilla', readonly: !can('plantillas.gestionar'), onSave: async list => { TP.t.contenido.cat[el.dataset.cat] = list; await saveTP('Catálogo de plantilla: ' + CAT_TITLE[el.dataset.cat]); } });
A['tp.unit'] = el => {
  const i = el.dataset.i == null ? null : Number(el.dataset.i); const c = TP.t.contenido;
  const u = i == null ? { vis: {} } : c.unidades[i];
  openSheet({ title: i == null ? 'Unidad de referencia' : 'Editar ' + u.ind, size: 'l', render: () => `<form data-f="tp.unitSave" data-i="${i == null ? '' : i}">${fieldsHtml(unitFields(c.cat, u, { create: true, colorField: true }), { ...unitValues({ ...u, equip: u.equip || [], caract: u.caract || [] }), colorC0: u.colorC0 || '' })}
    <div class="row end gap sticky-foot"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">Aceptar</button></div></form>` });
};
F['tp.unitSave'] = async form => {
  const d = unitFromForm(readForm(form)); const c = TP.t.contenido; const i = form.dataset.i === '' ? null : Number(form.dataset.i);
  if (!String(d.ind || '').trim()) { toast('El identificador es obligatorio', 'error'); return; }
  if (c.unidades.some((x, k) => k !== i && (x.ind || '').toLowerCase() === d.ind.toLowerCase())) { toast('Identificador repetido en la plantilla', 'error'); return; }
  if (!d.colorC0) { const tp = c.cat.tiposRecurso.find(x => x.id === d.tipo); d.colorC0 = tp ? tp.color : '#2E7D32'; }
  if (i == null) c.unidades.push(d); else c.unidades[i] = { ...c.unidades[i], ...d };
  closeSheet(); await saveTP();
};
A['tp.unitDel'] = async el => { TP.t.contenido.unidades.splice(Number(el.dataset.i), 1); await saveTP(); };
A['tp.plano'] = async () => {
  const f = await pickFile('image/*'); if (!f) return;
  const bytes = await readBytes(f); const bmp = await createImageBitmap(new Blob([bytes], { type: f.type }));
  const id = await core().repo.putBlob(bytes, { mime: f.type, w: bmp.width, h: bmp.height, nombre: f.name });
  TP.t.contenido.plano = { blob: id, w: bmp.width, h: bmp.height, mime: f.type, nombre: f.name }; await saveTP();
};
A['tp.planoDel'] = async () => { TP.t.contenido.plano = null; for (const u of TP.t.contenido.unidades) delete u.plan; await saveTP(); };
