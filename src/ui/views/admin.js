// Configuración (global y del preventivo), sincronización, cierre e informes,
// usuarios y roles, copias de seguridad, auditoría y permisos del dispositivo.
import { G, A, F, CH, filt } from '../state.js';
import { esc, attr, openSheet, closeSheet, refreshSheets, toast, confirmDlg, fieldsHtml, readForm, chip, empty, btn, tabs, copyText, saveFile, pickFile, readText, readBytes, fileStamp, safeName, systemNotify } from '../dom.js';
import { icon, unitSvg } from '../icons.js';
import { now, fmtDateTime, fmtTime, fmtDur, clone, AppError, contrastText } from '../../core/util.js';
import { APP_NAME, APP_VERSION, KPIS, CAMPOS_TARJETA, ICONOS, FORMAS, CAMPOS_PLANTILLA, DEFAULT_PLANTILLAS_UNIDAD } from '../../core/defaults.js';
import { PERMISOS } from '../../core/perms.js';
import * as C from '../../core/commands.js';
import { unitLabel, avisoLabel, liveUnits } from '../../core/engine.js';
import { buildReport } from '../../core/report.js';
import { prevJSON, csvZip, prevXLSX } from '../../core/exporters.js';
import { sha256hex } from '../../core/crypto.js';
import { registrosInforme } from '../../core/fiabilidad.js';
import { SYNC_ESTADOS } from '../../data/sync.js';
import { openCatalog, catalogButtons, CAT_TITLE, nuevoTipoRecurso } from './catalogs.js';
import { overriddenVis } from '../../core/visual.js';
import { tipoActivo } from '../../core/recursos.js';
import { renderUsuariosServidor, tablaAuditoria, invalidarUsuariosServidor } from './usuarios-servidor.js';
import { resumenMenu } from './incoherencias.js';
import { describirOrigen } from '../../core/templates.js';
import { estadoApp } from '../actualizacion.js';
import { seccionCartografia } from './cartografia.js';

const core = () => G.core;
const S = () => G.core.state; const P = () => G.core.state.prev;
const can = p => G.core.can(p);
const exec = (fn, ...a) => G.core.exec(fn, ...a);
const editable = () => P().estado !== 'cerrado' && !P().archivado;

/** Autorización reforzada: vuelve a pedir la contraseña del usuario */
export async function authorize(text) {
  const pw = await confirmDlg({ title: 'Autorización', text, input: { label: 'Tu contraseña', type: 'password' }, ok: 'Autorizar' });
  if (pw == null) return false;
  if (!(await core().repo.verifyPassword(pw))) { toast('Contraseña incorrecta', 'error'); return false; }
  return true;
}
const tile = (ic, label, a, data = {}, sub = '') => `<button class="tile" data-a="${a}" ${Object.entries(data).map(([k, v]) => `data-${k}="${attr(v)}"`).join(' ')}>${icon(ic)}<span>${esc(label)}${sub ? `<small>${esc(sub)}</small>` : ''}</span></button>`;

// ======================= menú "Más" del preventivo =======================
export function renderPrevMenu() {
  const n = core().engine().pendingConflicts().length;
  return `<div class="grid-btns big">
    ${can('incoherencias.ver') ? tile('alerta', 'Incoherencias', 'nav', { v: 'incoherencias' }, resumenMenu()) : ''}
    ${can('bitacora.ver') ? tile('bitacora', 'Bitácora y auditoría', 'nav', { v: 'bitacora' }) : ''}
    ${can('unidades.ver') ? tile('reloj', 'Cronología de unidades', 'nav', { v: 'cronologia' }) : ''}
    ${can('estadisticas.ver') ? tile('grafico', 'Tiempos y estadísticas', 'nav', { v: 'estadisticas' }) : ''}
    ${can('planos.ver') ? tile('mapa', 'Mapa real', 'nav', { v: 'mapa' }) : ''}
    ${tile('ajustes', 'Configuración del preventivo', 'nav', { v: 'ajustes' })}
    ${tile('sync', 'Sincronización', 'nav', { v: 'sync' }, core().isShared() ? (n ? n + ' conflicto(s)' : SYNC_ESTADOS[core().sync.status(core().cur).estado] || '') : 'Independiente')}
    ${tile('candado', 'Finalizar preventivo e informes', 'nav', { v: 'cierre' })}
    ${can('plantillas.crear') ? tile('plantilla', 'Crear plantilla desde este preventivo', 'tpl.fromPrev') : ''}
    ${can('preventivos.crear') ? tile('copiar', 'Duplicar preventivo', 'prev.dupCurrent') : ''}
    ${tile('ajustes', 'Configuración general', 'nav', { v: 'config' })}
    ${tile('salir', 'Salir del preventivo', 'prev.exit')}
  </div>`;
}
A['prev.dupCurrent'] = () => A['home.new']({ dataset: { origen: 'dup:' + core().cur } });

// ======================= configuración del preventivo =======================
export function renderPrevConfig() {
  const p = P(); const ro = !editable() || !can('preventivos.editar');
  const part = (p.participantes || []).map(x => x.nombre + (x.rol ? ' — ' + x.rol : '')).join('\n');
  const overr = liveUnits(S()).filter(u => overriddenVis(u).some(k => ['icono', 'forma', 'tam'].includes(k)));
  return `${ro ? `<p class="note">${icon('candado')} ${editable() ? 'No tienes permiso para editar el preventivo.' : 'Preventivo cerrado o archivado: solo consulta.'}</p>` : ''}
  <p class="muted">Configuración propia de este preventivo. Es una copia independiente: cambiar la configuración general o la plantilla no la modifica.</p>
  <section class="card pad"><h2>Datos generales</h2><form data-f="pcfg.general">${fieldsHtml([
    { name: 'nombre', label: 'Nombre', required: true, disabled: ro }, { name: 'descripcion', label: 'Descripción', type: 'textarea', disabled: ro },
    '<div class="row gap wrap">', { name: 'fecha', label: 'Fecha', type: 'date', disabled: ro }, { name: 'horaInicio', label: 'Hora de inicio', type: 'time', disabled: ro }, { name: 'horaFin', label: 'Hora de finalización', type: 'time', disabled: ro }, '</div>',
    { name: 'participantes', label: 'Usuarios participantes (uno por línea: Nombre — Rol)', type: 'textarea', rows: 4, disabled: ro },
  ], { ...p, participantes: part })}
  <p class="muted small">Identificador: <code>${esc(p.id)}</code> · creado ${fmtDateTime(p.creado)} por ${esc(p.creadoPor)}${p.origen && p.origen.tipo && p.origen.tipo !== 'nuevo' ? ' · origen: ' + esc(describirOrigen(p.origen)) : ''}</p>
  ${ro ? '' : '<div class="row end"><button class="btn primary">Guardar</button></div>'}</form></section>
  <section class="card pad"><h2>Funcionamiento</h2><form data-f="pcfg.cfg">${fieldsHtml([
    { name: 'descansoMin', label: 'Duración predeterminada del descanso (minutos)', type: 'number', min: 1, max: 600, disabled: ro || !can('descansos.duracion'), help: can('descansos.duracion') ? '' : 'Requiere el permiso "Cambiar duración del descanso"' },
    { name: 'autoFinalizarAviso', label: 'Finalizar automáticamente el aviso cuando todas sus unidades quedan libres', type: 'checkbox', disabled: ro },
    { name: 'avisoCompatibilidadEstricta', label: 'Compatibilidad estricta (impedir asignar recursos no compatibles)', type: 'checkbox', disabled: ro },
    { name: 'kpis', label: 'Indicadores visibles en el centro de control', type: 'checks', options: Object.entries(KPIS), disabled: ro },
    { name: 'camposTarjeta', label: 'Campos visibles en las tarjetas de unidad', type: 'checks', options: Object.entries(CAMPOS_TARJETA), disabled: ro },
  ], p.cfg)}${ro ? '' : '<div class="row end"><button class="btn primary">Guardar</button></div>'}</form></section>
  <section class="card pad"><h2>Catálogos del preventivo</h2>${catalogButtons('pcat.open')}
    ${overr.length && !ro && can('unidades.editar') ? `<p class="muted small">${overr.length} unidad(es) tienen apariencia personalizada que no sigue a su tipo.</p>${btn('Aplicar la apariencia de los tipos a todas las unidades…', 'pcfg.resetVis', { ic: 'capas' })}` : ''}</section>
  <section class="card pad"><h2>Modalidad</h2>
    <p>${p.modalidad === 'compartida' ? '<b>Compartida</b>: varios dispositivos trabajan en el mismo preventivo.' : '<b>Independiente</b>: un único dispositivo, sin servidor.'}</p>
    ${!ro && can('sync.gestionar') ? btn(p.modalidad === 'compartida' ? 'Cambiar a independiente…' : 'Convertir en compartido…', 'pcfg.modalidad', { ic: 'sync' }) : ''}
    <p class="muted small">El cambio de modalidad requiere autorización y queda registrado.</p></section>`;
}
F['pcfg.general'] = async form => {
  const v = readForm(form);
  const participantes = String(v.participantes || '').split('\n').map(l => l.trim()).filter(Boolean).map(l => { const [n, ...r] = l.split(/\s+[—-]\s+/); return { nombre: n.trim(), rol: r.join(' - ').trim() }; });
  const ops = await exec(C.prevUpdate, { nombre: v.nombre, descripcion: v.descripcion, fecha: v.fecha, horaInicio: v.horaInicio, horaFin: v.horaFin, participantes });
  toast(ops.length ? 'Guardado' : 'Sin cambios', ops.length ? 'ok' : 'info');
};
F['pcfg.cfg'] = async form => {
  const v = readForm(form); const ch = {};
  for (const k of ['autoFinalizarAviso', 'avisoCompatibilidadEstricta', 'kpis', 'camposTarjeta']) ch['cfg.' + k] = v[k];
  if (can('descansos.duracion') && v.descansoMin) ch['cfg.descansoMin'] = Number(v.descansoMin);
  const ops = await exec(C.prevUpdate, ch);
  toast(ops.length ? 'Guardado' : 'Sin cambios', ops.length ? 'ok' : 'info');
};
A['pcat.open'] = el => openCatalog({
  cat: el.dataset.cat, catalogs: P().cat, state: S(), scopeLabel: 'este preventivo', scope: 'preventivo',
  readonly: !editable() || !can('config.editar'),
  onSave: list => exec(C.catUpdate, el.dataset.cat, list),
});
A['pcfg.resetVis'] = async () => {
  const units = liveUnits(S()).filter(u => overriddenVis(u).some(k => ['icono', 'forma', 'tam'].includes(k)));
  if (!(await confirmDlg({ title: 'Aplicar apariencia de los tipos', text: 'Se eliminarán las personalizaciones de icono, forma y tamaño de ' + units.length + ' unidad(es): ' + units.map(unitLabel).join(', ') + '. Los colores C0 no cambian.', ok: 'Aplicar', danger: true }))) return;
  if (!(await authorize('Esta acción sobrescribe personalizaciones particulares.'))) return;
  for (const u of units) await exec(C.unitUpdate, u.id, { 'vis.icono': null, 'vis.forma': null, 'vis.tam': null });
  toast('Apariencia aplicada', 'ok');
};
A['pcfg.modalidad'] = async () => {
  const to = P().modalidad === 'compartida' ? 'independiente' : 'compartida';
  let server = '';
  if (to === 'compartida' && core().centralMeta) {
    if (!(await confirmDlg({ title: 'Convertir en compartido', text: 'El preventivo se compartirá automáticamente en el servidor central y aparecerá en todos los dispositivos conectados.', ok: 'Compartir' }))) return;
  } else if (to === 'compartida') {
    const r = await confirmDlg({ title: 'Convertir en compartido', text: 'Este dispositivo no está conectado al servidor central: otros dispositivos podrán incorporarse con un código o por archivo.', ok: 'Continuar', fields: [{ name: 's', label: 'Servidor de sincronización (opcional)', value: core().cfg.syncServidor || '', placeholder: 'https://sync.ejemplo.es' }] });
    if (!r) return; server = r.s;
  } else if (!(await confirmDlg({ title: 'Cambiar a independiente', text: 'Este dispositivo dejará de sincronizar. Los demás no recibirán más cambios de este.', ok: 'Cambiar', danger: true }))) return;
  if (!(await authorize('El cambio de modalidad altera la operativa del preventivo.'))) return;
  await core().setModalidad(to, server); toast('Modalidad: ' + to, 'ok'); G.render();
};

// ======================= sincronización =======================
export function renderSync() {
  const c = core(); const m = c.meta(); const p = P();
  if (!c.isShared()) return `<section class="card pad"><h2>Preventivo independiente</h2><p>Este preventivo se gestiona solo en este dispositivo, sin servidor ni Internet. Puedes convertirlo en compartido para que otros dispositivos participen.</p>
    ${editable() && can('sync.gestionar') && can('preventivos.editar') ? btn('Convertir en compartido…', 'pcfg.modalidad', { cls: 'primary', ic: 'sync' }) : ''}</section>`;
  const st = c.sync.status(c.cur); const conf = c.engine().pendingConflicts();
  let code = ''; try { code = c.joinCode(); } catch { }
  return `<section class="card pad"><h2>Estado</h2>
    <div class="kpis small">
      <div class="kpi"><b>${esc(SYNC_ESTADOS[st.estado] || st.estado || '—')}</b><span>Estado</span></div>
      <div class="kpi"><b>${st.pendientes ?? '—'}</b><span>Cambios pendientes de enviar</span></div>
      <div class="kpi"><b>${st.ultimo ? fmtTime(st.ultimo, true) : '—'}</b><span>Última sincronización</span></div>
      <div class="kpi${conf.length ? ' bad' : ''}"><b>${conf.length}</b><span>Conflictos</span></div>
    </div>
    ${st.error ? `<p class="note bad">${icon('alerta')} ${esc(st.error)}</p>` : ''}
    <p class="muted small">Cada dispositivo trabaja en local: si se pierde la conexión se sigue operando y los cambios se envían al volver. El dispositivo que creó el preventivo no es imprescindible.</p>
    <div class="actions">${m.server ? btn('Sincronizar ahora', 'sync.now', { cls: 'primary', ic: 'sync' }) : ''}</div></section>
  ${m.central ? `<section class="card pad"><h2>Servidor central</h2>
    <p>Compartido automáticamente en el servidor central${c.centralMeta ? ' <b>' + esc(c.centralMeta.nombre || c.centralMeta.server) + '</b>' : ''}. Aparece solo en todos los dispositivos conectados: no hace falta ningún código ni dirección.</p>
    ${can('sync.gestionar') ? `<p class="muted small">Si el servidor se ha reinstalado o ha perdido sus datos, este dispositivo puede volver a enviarle todo el registro del preventivo (sin duplicados y conservando los números de aviso).</p>${btn('Reenviar todo al servidor', 'sync.resend', { ic: 'subir' })}` : ''}</section>` : `<section class="card pad"><h2>Servidor</h2>
    <form data-f="sync.server">${fieldsHtml([{ name: 's', label: 'Dirección del servidor', value: m.server || '', placeholder: 'https://sync.ejemplo.es', disabled: !can('sync.gestionar'), help: 'Vacío: sincronización solo por archivo.' }])}
    ${can('sync.gestionar') ? `<div class="row end gap">${btn('Probar conexión', 'sync.ping', { cls: 'ghost' })}<button class="btn">Guardar servidor</button></div>` : ''}</form>
    ${can('sync.gestionar') && m.server ? `<p class="muted small">Si el servidor se ha reinstalado o ha perdido sus datos, este dispositivo puede volver a enviarle todo el registro del preventivo (sin duplicados y conservando los números de aviso).</p>${btn('Reenviar todo al servidor', 'sync.resend', { ic: 'subir' })}` : ''}</section>
  <section class="card pad"><h2>Incorporar otro dispositivo</h2>
    <p class="muted small">Comparte este código solo con dispositivos autorizados: permite leer y modificar el preventivo. Los datos viajan cifrados de extremo a extremo.</p>
    <textarea readonly rows="3" class="code-box" id="joincode">${esc(code)}</textarea>
    <div class="actions">${btn('Copiar código', 'sync.copy', { ic: 'copiar' })}${navigator.share && !G.preview ? btn('Compartir código', 'sync.shareCode', { ic: 'compartir' }) : ''}</div></section>`}
  <section class="card pad"><h2>Sincronización por archivo (sin red)</h2>
    <p class="muted small">Exporta un paquete y ábrelo en otro dispositivo del preventivo (Bluetooth, USB, mensajería). No crea duplicados aunque se importe varias veces.</p>
    <div class="actions">${btn('Exportar paquete', 'sync.exportBundle', { ic: 'descargar' })}${can('sync.gestionar') ? btn('Importar paquete', 'sync.importBundle', { ic: 'subir' }) : ''}</div></section>
  <section class="card pad"><h2>Conflictos ${conf.length ? `<b class="count bad">${conf.length}</b>` : ''}</h2>
    ${conf.length ? conf.map(x => conflictCard(x)).join('') : '<p class="muted">No hay conflictos pendientes.</p>'}
    ${Object.values(S().conflicts).filter(x => x.estado !== 'pendiente').length ? `<details><summary>Resueltos (${Object.values(S().conflicts).filter(x => x.estado !== 'pendiente').length})</summary>${Object.values(S().conflicts).filter(x => x.estado !== 'pendiente').map(x => `<p class="small">${fmtDateTime(x.t)} · ${esc(x.motivo)} → <b>${esc(x.estado)}</b> por ${esc(x.resueltoPor || '')} ${x.resueltoEn ? fmtDateTime(x.resueltoEn) : ''}</p>`).join('')}</details>` : ''}
  </section>`;
}
function conflictCard(x) {
  const det = Array.isArray(x.detalle) ? x.detalle : null;
  const fmt = v => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v).slice(0, 160) : String(v));
  return `<div class="conf">
    <div><b>${esc(x.motivo)}</b></div>
    <div class="muted small">${fmtDateTime(x.t, true)} · ${esc(x.usuario)} · dispositivo ${esc(x.dev)}</div>
    ${det ? `<table class="tbl small"><thead><tr><th>Campo</th><th>Valor actual</th><th>Valor propuesto</th></tr></thead><tbody>${det.map(d => `<tr><td>${esc(d.campo)}</td><td>${esc(fmt(d.actual))}</td><td>${esc(fmt(d.propuesto))}</td></tr>`).join('')}</tbody></table>` : ''}
    ${can('conflictos.resolver') && editable() ? `<div class="actions">${btn(x.tipo === 'campos' ? 'Aplicar valor propuesto' : x.tipo === 'aviso' ? 'Aceptar' : 'Volver a aplicar', 'conf.res', { cls: 'primary', data: { id: x.id, d: 'aceptar' } })}${btn(x.tipo === 'campos' ? 'Mantener valor actual' : 'Descartar', 'conf.res', { data: { id: x.id, d: 'descartar' } })}</div>` : ''}
  </div>`;
}
A['conf.res'] = async el => { await exec(C.resolverConflicto, el.dataset.id, el.dataset.d); toast('Conflicto resuelto', 'ok'); };
A['sync.now'] = async () => { const st = await core().sync.syncNow(core().cur); toast(SYNC_ESTADOS[st.estado] + (st.error ? ': ' + st.error : ''), st.estado === 'sincronizado' ? 'ok' : st.estado === 'error' ? 'error' : 'info'); G.render(); };
A['sync.resend'] = async () => {
  if (!(await confirmDlg({ title: 'Reenviar todo al servidor', text: 'Se enviará de nuevo todo el registro de este preventivo. El servidor descarta lo que ya tenga.', ok: 'Reenviar' }))) return;
  const st = await core().resendAll(); toast(SYNC_ESTADOS[st.estado] + (st.error ? ': ' + st.error : ''), st.estado === 'sincronizado' ? 'ok' : 'error'); G.render();
};
A['sync.ping'] = async el => { const v = el.closest('form').s.value; try { const r = await core().sync.ping(v); toast('Servidor disponible (versión ' + r.version + ')', 'ok'); } catch (e) { toast('No responde: ' + e.message, 'error'); } };
F['sync.server'] = async form => { await core().setServer(form.s.value); toast('Servidor guardado', 'ok'); G.render(); };
A['sync.copy'] = () => copyText(document.getElementById('joincode').value);
A['sync.shareCode'] = async () => { try { await navigator.share({ title: 'Código del preventivo ' + P().nombre, text: document.getElementById('joincode').value }); } catch { } };
A['sync.exportBundle'] = async () => { const txt = await core().exportBundle(); await saveFile(safeName(P().nombre) + '-' + core().device.code + '-' + fileStamp() + '.ucosync', txt, 'application/json', { share: true }); };
A['sync.importBundle'] = async () => {
  const f = await pickFile('.ucosync,.json,application/json'); if (!f) return;
  const r = await core().importBundle(await readText(f));
  toast(r.nuevas ? r.nuevas + ' cambios incorporados' : 'No había cambios nuevos', 'ok'); G.render();
};

// ======================= cierre e informes =======================
const MIME = { pdf: 'application/pdf', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', json: 'application/json', csv: 'application/zip' };
/** Exportación de los datos actuales (PDF sin versión, Excel, JSON o CSV). Queda registrada en el preventivo. */
export async function exportReport(kind, { share = false } = {}) {
  if (!can('exportar')) throw new AppError('No tienes permiso para exportar', 'permiso');
  const c = core(); const e = c.engine(); const base = safeName(P().nombre) + '-' + fileStamp();
  const meta = await c.horasOps(); const compartido = c.isShared();
  const who = { usuario: c.user.nombre, dispositivo: c.device.nombre, meta, compartido };
  let r, hash = null;
  if (kind === 'pdf') {
    const aviso = toast('Generando el informe PDF…', 'info', 20000); await new Promise(res => setTimeout(res, 60)); // deja pintar el aviso antes del trabajo pesado
    let bytes; try { bytes = await buildReport(e, { usuario: who.usuario, dispositivo: who.dispositivo, horas: { meta, compartido } }); } finally { if (aviso) aviso.remove(); }
    hash = await sha256hex(bytes);
    r = await saveFile(base + '.pdf', bytes, MIME.pdf, { share });
  } else if (kind === 'xlsx') r = await saveFile(base + '.xlsx', prevXLSX(e, who), MIME.xlsx, { share });
  else if (kind === 'json') r = await saveFile(base + '.json', JSON.stringify(prevJSON(e, who), null, 1), MIME.json, { share });
  else if (kind === 'csv') r = await saveFile(base + '-csv.zip', csvZip(e, now(), { meta, compartido }), MIME.csv, { share });
  else return;
  if (r && r !== 'cancelado') { try { await c.registrarInforme('exportar', { formato: kind, hash }); } catch (err) { console.warn('Registro de la exportación', err); } }
  return r;
}
// Versiones guardadas en este dispositivo (se cargan una vez por preventivo y se repinta al tenerlas)
const LOCALES = new Map();
function localesInforme(pid) {
  if (!LOCALES.has(pid)) { LOCALES.set(pid, null); core().repo.versionesInforme(pid).then(v => { LOCALES.set(pid, new Set(v.map(x => x.n))); G.render(); }).catch(() => LOCALES.set(pid, new Set())); }
  return LOCALES.get(pid);
}
/** Informes del preventivo (1.5.0): versiones guardadas, nueva versión con motivo, comprobación y exportaciones */
function seccionInformes(p, s) {
  const shareOk = !!(navigator.canShare && !G.preview);
  const exportes = can('exportar') ? `<div class="actions">${p.estado !== 'cerrado' ? btn('Informe PDF (provisional)', 'rep.do', { cls: 'primary', ic: 'archivo', data: { k: 'pdf' } }) : ''}${btn('Excel (XLSX)', 'rep.do', { ic: 'descargar', data: { k: 'xlsx' } })}${btn('Datos JSON', 'rep.do', { ic: 'descargar', data: { k: 'json' } })}${btn('Tablas CSV (ZIP)', 'rep.do', { ic: 'descargar', data: { k: 'csv' } })}
      ${shareOk && p.estado !== 'cerrado' ? btn('Compartir PDF', 'rep.do', { ic: 'compartir', data: { k: 'pdf', share: 1 } }) : ''}</div>` : '<p class="muted">No tienes permiso para exportar.</p>';
  const intro = '<p class="muted small">Generados en el dispositivo, sin Internet, solo con datos registrados. El PDF incluye información general, configuración y sectores, plano, unidades y su actividad, claves, avisos, descansos, ubicaciones, estadísticas, cronología, incidencias, fiabilidad de las horas, bitácora y auditoría.</p>';
  if (p.estado !== 'cerrado') return `<section class="card pad"><h2>Informes</h2>${intro}<p class="small">Al finalizar el preventivo se genera y se guarda la <b>versión 1</b> del informe. Mientras tanto puedes exportar un informe provisional o los datos.</p>${exportes}</section>`;
  if (!can('informes.ver')) return `<section class="card pad"><h2>Informes</h2><p class="muted">No tienes permiso para consultar los informes.</p>${exportes}</section>`;
  const gens = (s.informes || []).filter(x => x.accion === 'generar').slice().sort((a, b) => b.n - a.n);
  const loc = localesInforme(p.id);
  const ahora = registrosInforme(core().engine().ops); const ult = gens[0];
  const cambios = ult && ult.nOps != null ? ahora - ult.nOps : 0;
  const filas = gens.map(v => `<li class="inf-v"><div class="grow"><b>Versión ${v.n}</b>${v.provisional ? ' ' + chip('Provisional', '#C62828') : ''}${v === ult ? ' ' + chip('Última', '#2E7D32') : ''}
      <div class="muted small">${esc(fmtDateTime(v.t))} · ${esc(v.por)}${v.dev ? ' · ' + esc(v.dev) : ''}</div>
      ${v.motivo ? `<div class="small">Motivo: ${esc(v.motivo)}</div>` : ''}
      ${v.provisional ? `<div class="small bad-txt">${esc([v.pendientes ? v.pendientes + ' cambio(s) sin sincronizar' : '', v.conflictos ? v.conflictos + ' conflicto(s) sin resolver' : ''].filter(Boolean).join(' · ') || 'Generada antes de finalizar')}</div>` : ''}
      <div class="muted small mono" title="Huella SHA-256 del PDF">SHA-256 ${esc((v.hash || '').slice(0, 24))}…</div></div>
      <div class="actions">${loc && loc.has(v.n) ? btn('Ver', 'inf.ver', { ic: 'ojo', data: { n: v.n } }) + (can('exportar') ? btn('Descargar', 'inf.bajar', { ic: 'descargar', data: { n: v.n } }) + (shareOk ? btn('', 'inf.bajar', { cls: 'icon ghost', ic: 'compartir', data: { n: v.n, share: 1 }, title: 'Compartir' }) : '') : '')
        : loc ? `<span class="muted small">PDF guardado en el dispositivo «${esc(v.dev || '—')}»</span>` : ''}</div></li>`).join('');
  const accesos = (s.informes || []).filter(x => x.accion !== 'generar').slice(-30).reverse();
  return `<section class="card pad"><h2>Informes</h2>${intro}
    ${gens.length ? `<ul class="inf-versiones">${filas}</ul>` : '<p class="note warn">Todavía no se ha generado el informe de este preventivo.</p>'}
    ${cambios > 0 ? `<p class="note warn">${icon('alerta')} Hay ${cambios} cambio(s) registrados después de la versión ${ult.n} (por ejemplo, sincronizados más tarde o tras una reapertura). Si están autorizados, genera una nueva versión: la anterior se conserva.</p>` : ''}
    <div class="actions">${can('informes.generar') ? (gens.length ? btn('Nueva versión…', 'inf.nueva', { cls: cambios > 0 ? 'primary' : '', ic: 'archivo' }) : btn('Generar el informe', 'inf.nueva', { cls: 'primary', ic: 'archivo' })) : ''}${gens.length ? btn('Comprobar un PDF…', 'inf.comprobar', { ic: 'escudo', title: 'Comprueba si un archivo PDF es una versión registrada de este informe' }) : ''}</div>
    ${accesos.length ? `<details><summary>Consultas y exportaciones (${(s.informes || []).length - gens.length})</summary><ul class="ref-list small">${accesos.map(r => `<li>${esc(fmtDateTime(r.t))} · ${esc(r.por)}${r.dev ? ' (' + esc(r.dev) + ')' : ''}: ${r.accion === 'consultar' ? 'consultó' : 'exportó'} ${r.n ? 'la versión ' + r.n : 'los datos'} en ${esc((r.formato || 'pdf').toUpperCase())}</li>`).join('')}</ul></details>` : ''}
    <h3>Exportar los datos</h3>${exportes}</section>`;
}
A['inf.nueva'] = async () => {
  const c = core(); const n = (S().informes || []).filter(x => x.accion === 'generar').length;
  let motivo = '';
  if (n) {
    motivo = await confirmDlg({ title: 'Nueva versión del informe', text: 'La versión anterior se conserva sin cambios. Indica por qué se genera una nueva (por ejemplo, correcciones autorizadas tras una reapertura o datos sincronizados después del cierre).', input: { label: 'Motivo de la nueva versión' }, ok: 'Generar versión ' + (n + 1) });
    if (motivo == null) return;
    if (!String(motivo).trim()) return toast('Indica el motivo de la nueva versión', 'error');
  }
  const aviso = toast('Generando el informe…', 'info', 20000); await new Promise(res => setTimeout(res, 60));
  let r; try { r = await c.generarInforme({ motivo }); } finally { if (aviso) aviso.remove(); }
  LOCALES.delete(c.cur); toast('Informe guardado: versión ' + r.n + (r.provisional ? ' (provisional)' : ''), 'ok'); G.render();
};
async function pdfVersion(n) {
  const v = await core().pdfInforme(n); if (!v) throw new AppError('El PDF de esta versión no está en este dispositivo');
  return v;
}
A['inf.ver'] = async el => {
  if (!can('informes.ver')) throw new AppError('No tienes permiso para consultar los informes', 'permiso');
  const n = Number(el.dataset.n); const v = await pdfVersion(n);
  const url = URL.createObjectURL(new Blob([v.bytes], { type: 'application/pdf' }));
  const a = document.createElement('a'); a.href = url; a.target = '_blank'; a.rel = 'noopener'; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 120000);
  await core().registrarInforme('consultar', { n, formato: 'pdf' });
};
A['inf.bajar'] = async el => {
  if (!can('exportar')) throw new AppError('No tienes permiso para exportar', 'permiso');
  const n = Number(el.dataset.n); const v = await pdfVersion(n);
  const r = await saveFile(safeName(P().nombre) + '-informe-v' + n + '.pdf', v.bytes, MIME.pdf, { share: !!el.dataset.share });
  if (r && r !== 'cancelado') await core().registrarInforme('exportar', { n, formato: 'pdf', hash: v.hash });
};
A['inf.comprobar'] = async () => {
  const f = await pickFile('.pdf,application/pdf'); if (!f) return;
  const h = await sha256hex(await readBytes(f));
  const v = (S().informes || []).find(x => x.accion === 'generar' && x.hash === h);
  if (v) toast('El archivo es la versión ' + v.n + ' del informe, generada el ' + fmtDateTime(v.t) + ' por ' + v.por + '. No se ha modificado.', 'ok', 9000);
  else toast('El archivo no coincide con ninguna versión registrada de este informe (puede ser otra exportación o estar modificado).', 'error', 9000);
};
export function renderClose() {
  const p = P(); const s = S(); const t = now();
  const chk = C.closeChecks(s, t); const pend = core().isShared() ? core().sync.status(core().cur).pendientes || 0 : 0;
  const li = (n, txt, route, list) => `<li class="${n ? 'warn' : 'ok'}">${icon(n ? 'alerta' : 'ok')}<span><b>${n}</b> ${esc(txt)}${list && n ? ': ' + esc(list) : ''}</span>${n && route ? btn('Revisar', 'nav', { cls: 'ghost sm', data: { v: route } }) : ''}</li>`;
  return `${seccionInformes(p, s)}
  ${p.estado !== 'cerrado' ? `<section class="card pad"><h2>Finalizar el preventivo</h2>
    <ul class="checks-list">
      ${li(chk.pendientes.length, 'avisos pendientes', 'avisos', chk.pendientes.map(avisoLabel).join(', '))}
      ${li(chk.activos.length, 'avisos activos (asignados o en curso)', 'avisos', chk.activos.map(avisoLabel).join(', '))}
      ${li(chk.ocupadas.length, 'unidades ocupadas', 'unidades', chk.ocupadas.map(unitLabel).join(', '))}
      ${li(chk.descansos.length, 'descansos activos', 'unidades', chk.descansos.map(unitLabel).join(', '))}
      ${li(chk.conflictos.length, 'conflictos de sincronización sin resolver', 'sync')}
      ${core().isShared() ? li(pend, 'cambios de este dispositivo sin enviar al servidor', 'sync') : ''}
    </ul>
    ${can('preventivos.cerrar') && !p.archivado ? btn('Finalizar preventivo…', 'prev.close', { cls: chk.total ? 'danger' : 'primary', ic: 'candado' }) : '<p class="muted">No tienes permiso para finalizar el preventivo.</p>'}
    <p class="muted small">Al finalizar se guardan los datos, se genera el informe y el preventivo queda en solo lectura (consultable) y, si lo eliges, archivado. No se borra nada. La reapertura requiere autorización y queda registrada.</p></section>`
    : `<section class="card pad"><h2>Preventivo finalizado</h2><p>Finalizado el ${fmtDateTime(p.cerradoEn)} por ${esc(p.cerradoPor || '')}.</p>
      ${p.reaperturas && p.reaperturas.length ? `<p class="muted small">Reaperturas: ${p.reaperturas.map(r => fmtDateTime(r.t) + ' · ' + esc(r.por) + ': ' + esc(r.motivo)).join(' | ')}</p>` : ''}
      <div class="actions">${can('preventivos.reabrir') && !p.archivado ? btn('Reabrir…', 'prev.reopen', { ic: 'subir' }) : ''}
      ${can('preventivos.cerrar') ? btn(p.archivado ? 'Recuperar del archivo' : 'Archivar', 'prev.archive', { ic: 'archivar' }) : ''}</div></section>`}`;
}
A['rep.do'] = async el => { const r = await exportReport(el.dataset.k, { share: !!el.dataset.share }); if (r === 'descargado') toast('Archivo generado', 'ok'); };
A['prev.close'] = async () => {
  const s = S(); const chk = C.closeChecks(s, now());
  const r = await confirmDlg({
    title: 'Finalizar preventivo', ok: chk.total ? 'Finalizar con advertencias' : 'Finalizar preventivo', danger: !!chk.total,
    html: (chk.total ? `<p class="note warn">${icon('alerta')} Hay ${chk.total} advertencia(s). Quedarán registradas en la finalización y en el informe.</p>` : '<p>No hay advertencias.</p>')
      + (can('informes.generar') ? '<p class="small">Se generará y guardará la <b>versión 1 del informe</b>, con su huella SHA-256. Generarla no modifica ningún registro.</p>'
        : `<p class="note">${icon('info')} No tienes permiso para generar informes: la versión 1 la generará quien lo tenga.</p>`),
    fields: [...(can('exportar') && can('informes.generar') ? [{ name: 'pdf', label: 'Descargar también el informe PDF', type: 'checkbox', value: false }] : []), { name: 'arch', label: 'Archivar al finalizar', type: 'checkbox', value: true }],
  });
  if (!r) return;
  await core().repo.createBackup('previa', 'Antes del cierre de ' + P().nombre);
  await exec(C.prevCerrar, { confirmarAdvertencias: true });
  // 1.5.0: versión 1 del informe al finalizar (guardada y registrada con su huella); no bloquea el cierre si falla
  let inf = null;
  if (can('informes.generar')) {
    const aviso = toast('Generando el informe…', 'info', 20000);
    try { await new Promise(res => setTimeout(res, 60)); inf = await core().generarInforme({ automatico: true }); LOCALES.delete(core().cur); }
    catch (e) { toast('No se pudo generar el informe: ' + e.message, 'error'); }
    finally { if (aviso) aviso.remove(); }
  }
  if (r.pdf && inf && can('exportar')) {
    try { const rr = await saveFile(safeName(P().nombre) + '-informe-v' + inf.n + '.pdf', inf.bytes, MIME.pdf); if (rr && rr !== 'cancelado') await core().registrarInforme('exportar', { n: inf.n, formato: 'pdf', hash: inf.hash }); }
    catch (e) { toast(e.message, 'error'); }
  }
  if (r.arch) await exec(C.prevArchivar, true);
  await core().autoBackup(true);
  toast('Preventivo finalizado' + (inf ? ' · informe versión ' + inf.n + ' guardado' + (inf.provisional ? ' (provisional)' : '') : ''), 'ok'); G.render();
};
A['prev.reopen'] = async () => {
  const m = await confirmDlg({ title: 'Reabrir preventivo', text: 'La reapertura queda registrada en la auditoría.', input: { label: 'Motivo de la reapertura' }, ok: 'Continuar' });
  if (m == null) return;
  if (!(await authorize('Reabrir un preventivo cerrado requiere autorización.'))) return;
  await exec(C.prevReabrir, m); toast('Preventivo reabierto', 'ok');
};
A['prev.archive'] = async () => { await exec(C.prevArchivar, !P().archivado); toast(P().archivado ? 'Archivado' : 'Recuperado del archivo', 'ok'); };

// ======================= configuración general =======================
export function renderGlobalConfig() {
  const c = core(); const cfg = c.cfg; const ro = !can('config.editar');
  return `${ro ? `<p class="note">${icon('candado')} Solo consulta: no tienes permiso para editar la configuración.</p>` : ''}
  <p class="muted">Ajustes de este dispositivo y valores por defecto para los preventivos nuevos. Cambiarlos <b>no</b> modifica los preventivos ya creados ni sus personalizaciones.</p>
  <section class="card pad"><h2>Apariencia y dispositivo</h2><form data-f="gcfg.basic">${fieldsHtml([
    { name: 'tema', label: 'Tema', type: 'select', options: [['sistema', 'Según el sistema'], ['claro', 'Claro'], ['oscuro', 'Oscuro (operaciones nocturnas)']], disabled: ro },
    { name: 'densidad', label: 'Densidad de información', type: 'select', options: [['normal', 'Normal'], ['compacta', 'Compacta (más datos en pantalla)']], disabled: ro },
    { name: 'devNombre', label: 'Nombre de este dispositivo', value: c.device.nombre, disabled: ro },
    { name: 'devCode', label: 'Código del dispositivo (prefijo de avisos provisionales)', value: c.device.code, maxlength: 4, disabled: ro },
    { name: 'bloqueoMin', label: 'Bloqueo automático por inactividad (minutos, 0 = nunca)', type: 'number', min: 0, max: 480, disabled: ro },
  ], cfg)}${ro ? '' : '<div class="row end"><button class="btn primary">Guardar</button></div>'}</form></section>
  <section class="card pad"><h2>Sincronización</h2><form data-f="gcfg.sync">${fieldsHtml([
    core().centralMeta ? `<p class="note">${icon('sync')} Servidor central: <b>${esc(core().centralMeta.server)}</b> (preconfigurado). Los preventivos compartidos lo usan automáticamente.</p>` : { name: 'syncServidor', label: 'Servidor para preventivos compartidos sin servidor central (opcional)', placeholder: 'https://sync.ejemplo.es', disabled: ro },
    { name: 'syncIntervaloSeg', label: 'Intervalo de sincronización (segundos)', type: 'number', min: 2, max: 300, disabled: ro },
  ], cfg)}${ro ? '' : '<div class="row end"><button class="btn primary">Guardar</button></div>'}</form></section>
  <section class="card pad"><h2>Copias automáticas</h2><form data-f="gcfg.backup">${fieldsHtml([
    { name: 'copiaAutoMin', label: 'Crear copia local cada (minutos, si hay cambios)', type: 'number', min: 1, max: 240, disabled: ro },
    { name: 'copiasAutoMax', label: 'Copias automáticas a conservar', type: 'number', min: 3, max: 200, disabled: ro },
  ], cfg)}${ro ? '' : '<div class="row end"><button class="btn primary">Guardar</button></div>'}</form></section>
  <section class="card pad"><h2>Tipos de recurso y unidades plantilla</h2>
    <p class="muted small">Comunes a todos los preventivos y, con el servidor central, a todos los dispositivos. Se conservan al cerrar la aplicación o reiniciar el equipo.</p>
    <div class="grid-btns"><button class="tile" data-a="gcat.open" data-cat="tiposRecurso">${icon('unidades')}<span>Tipos de recurso</span></button><button class="tile" data-a="nav" data-v="uplantillas">${icon('plantilla')}<span>Unidades plantilla</span></button></div>
    ${seccionIniciales()}
  </section>
  ${seccionCartografia()}
  <section class="card pad"><h2>Valores por defecto de los preventivos nuevos</h2>
    ${catalogButtons('gcat.open')}
    <form data-f="gcfg.prev">${fieldsHtml([
      { name: 'descansoMin', label: 'Duración del descanso (minutos)', type: 'number', min: 1, max: 600, disabled: ro },
      { name: 'autoFinalizarAviso', label: 'Finalizar automáticamente el aviso cuando sus unidades quedan libres', type: 'checkbox', disabled: ro },
      { name: 'avisoCompatibilidadEstricta', label: 'Compatibilidad estricta en asignaciones', type: 'checkbox', disabled: ro },
      { name: 'kpis', label: 'Indicadores del centro de control', type: 'checks', options: Object.entries(KPIS), disabled: ro },
      { name: 'camposTarjeta', label: 'Campos visibles en tarjetas', type: 'checks', options: Object.entries(CAMPOS_TARJETA), disabled: ro },
    ], cfg.prev)}${ro ? '' : '<div class="row end"><button class="btn primary">Guardar</button></div>'}</form></section>`;
}
F['gcfg.basic'] = async form => {
  const v = readForm(form); const c = core();
  await c.saveCfg({ ...c.cfg, tema: v.tema, densidad: v.densidad, bloqueoMin: Number(v.bloqueoMin) || 0 }, 'Apariencia y seguridad');
  if (v.devNombre !== c.device.nombre || v.devCode !== c.device.code) { await c.repo.saveDevice({ nombre: v.devNombre, code: v.devCode }); }
  applyTheme(); toast('Guardado', 'ok');
};
F['gcfg.sync'] = async form => { const v = readForm(form); await core().saveCfg({ ...core().cfg, syncServidor: v.syncServidor ?? core().cfg.syncServidor, syncIntervaloSeg: Number(v.syncIntervaloSeg) || 5 }, 'Sincronización'); toast('Guardado', 'ok'); };
F['gcfg.backup'] = async form => { const v = readForm(form); await core().saveCfg({ ...core().cfg, copiaAutoMin: Number(v.copiaAutoMin) || 10, copiasAutoMax: Number(v.copiasAutoMax) || 20 }, 'Copias automáticas'); toast('Guardado', 'ok'); };
F['gcfg.prev'] = async form => { const v = readForm(form); await core().saveCfg({ ...core().cfg, prev: { ...core().cfg.prev, ...v, descansoMin: Number(v.descansoMin) || 30 } }, 'Valores por defecto de preventivos'); toast('Guardado', 'ok'); };
A['gcat.open'] = el => el.dataset.cat === 'tiposRecurso'
  // Tipos de recurso generales: persistentes y comunes a todos los dispositivos
  ? openCatalog({ cat: 'tiposRecurso', catalogs: core().cfg.catalogos, scopeLabel: 'configuración general', scope: 'general', readonly: !can('recursos.gestionar'), onSave: list => core().guardarTiposRecurso(list) })
  : openCatalog({
    cat: el.dataset.cat, catalogs: core().cfg.catalogos, scopeLabel: 'por defecto', scope: 'defecto', readonly: !can('config.editar'),
    onSave: async list => { const cfg = clone(core().cfg); cfg.catalogos[el.dataset.cat] = list; await core().saveCfg(cfg, 'Catálogo por defecto: ' + CAT_TITLE[el.dataset.cat]); },
  });

// ======================= unidades plantilla =======================
const plVis = (pl, tipos) => { const t = tipos.find(x => x.id === pl.tipo); const col = pl.color || (t && t.color) || '#2E7D32'; return { icono: (pl.vis && pl.vis.icono) || (t && t.vis && t.vis.icono), forma: (pl.vis && pl.vis.forma) || (t && t.vis && t.vis.forma), fill: col, border: col, text: contrastText(col) }; };
export function renderUnitTemplates() {
  const c = core(); const ro = !can('recursos.gestionar'); const tipos = c.tiposRecursoGenerales(); const list = c.plantillasUnidad();
  return `<p class="muted">Al añadir una unidad a un preventivo, una plantilla solo pide el número (y los campos que indiques): tipo, icono, color e indicativo salen de ella. La unidad se crea en C0 y pendiente de asignación. Cambiar una plantilla no modifica las unidades ya creadas.</p>
  ${ro ? `<p class="note">${icon('candado')} Solo consulta: gestionar plantillas requiere el permiso «Gestionar tipos de recurso y unidades plantilla».</p>` : `<div class="row end">${btn('Nueva plantilla', 'upl.edit', { cls: 'primary', ic: 'mas_add' })}</div>`}
  <ul class="cat-list">${list.map(pl => { const t = tipos.find(x => x.id === pl.tipo);
    return `<li class="cat-row${pl.activo === false ? ' off' : ''}" data-plantilla="${attr(pl.id)}">${unitSvg(plVis(pl, tipos), { px: 36 })}
      <div class="grow"><b>${esc(pl.nombre)}</b>${pl.activo === false ? ' ' + chip('Desactivada', '#757575') : pl.tipo && !(t && tipoActivo(t)) ? ' ' + chip('Tipo no disponible: no se ofrece', '#E65100') : ''}<small class="muted">${esc([t ? t.nombre : 'Sin tipo', 'Indicativo: ' + [pl.prefijo, 'nº'].filter(Boolean).join(' '), (pl.campos || []).length ? 'Pide: ' + pl.campos.map(k => CAMPOS_PLANTILLA[k]).join(', ') : 'Solo pide el número', pl.usada ? 'en uso' : ''].filter(Boolean).join(' · '))}</small></div>
      ${ro ? '' : `<div class="row gap-s">${btn('', 'upl.edit', { cls: 'icon ghost', ic: 'editar', data: { id: pl.id }, title: 'Editar' })}${btn('', 'upl.dup', { cls: 'icon ghost', ic: 'copiar', data: { id: pl.id }, title: 'Duplicar' })}${btn(pl.activo === false ? 'Activar' : 'Desactivar', 'upl.toggle', { cls: 'sm ghost', data: { id: pl.id } })}${btn('', 'upl.del', { cls: 'icon ghost', ic: 'papelera', data: { id: pl.id }, title: 'Eliminar' })}</div>`}
    </li>`; }).join('') || '<li class="muted">No hay unidades plantilla</li>'}</ul>`;
}
let UPL = null; // plantilla en edición (para no perder lo escrito al crear un tipo nuevo)
A['upl.edit'] = el => abrirEditorPlantilla(el.dataset.id || null);
function abrirEditorPlantilla(id, preset = null) {
  const c = core();
  UPL = preset || (id ? clone(c.plantillasUnidad().find(x => x.id === id)) : { nombre: '', prefijo: '', tipo: '', color: '#1565C0', vis: { forma: 'circulo', icono: 'coche' }, campos: [], obligatorios: [], valores: { subtipo: '', caract: [] }, activo: true });
  openSheet({ title: id ? 'Editar plantilla · ' + UPL.nombre : 'Nueva unidad plantilla', size: 'm', onClose: () => { UPL = null; }, render: () => {
    const tipos = c.tiposRecursoGenerales().filter(t => tipoActivo(t) || t.id === UPL.tipo);
    const val = { nombre: UPL.nombre, prefijo: UPL.prefijo, tipo: UPL.tipo || '', color: UPL.color || '#1565C0', forma: (UPL.vis || {}).forma || '', icono: (UPL.vis || {}).icono || '', campos: UPL.campos || [], obligatorios: UPL.obligatorios || [], subtipo: (UPL.valores || {}).subtipo || '', caract: (UPL.valores || {}).caract || [], activo: UPL.activo !== false };
    return `<form data-f="upl.save" data-id="${attr(id || '')}">${fieldsHtml([
      { name: 'nombre', label: 'Nombre de la plantilla', required: true, placeholder: 'p. ej. UPR' },
      { name: 'tipo', label: 'Tipo de recurso', type: 'select', options: [['', 'Sin tipo'], ...tipos.map(t => [t.id, t.nombre + (tipoActivo(t) ? '' : t.retirado ? ' (retirado)' : ' (desactivado)')])] },
      `<div class="row end"><button type="button" class="btn sm ghost" data-a="upl.nuevoTipo">${icon('mas_add')}<span>Nuevo tipo de recurso</span></button></div>`,
      { name: 'prefijo', label: 'Prefijo del indicativo', placeholder: 'UPR', help: 'Indicativo = prefijo + número (p. ej. UPR 8025)' },
      { name: 'forma', label: 'Forma o símbolo del icono', type: 'select', options: [['', '(la del tipo)'], ...Object.entries(FORMAS)] },
      { name: 'icono', label: 'Icono', type: 'select', options: [['', '(el del tipo)'], ...Object.entries(ICONOS)] },
      { name: 'color', label: 'Color predeterminado (C0)', type: 'color' },
      { name: 'campos', label: 'Además del número, pedir al crear la unidad', type: 'checks', options: Object.entries(CAMPOS_PLANTILLA) },
      { name: 'obligatorios', label: 'De esos campos, obligatorios', type: 'checks', options: Object.entries(CAMPOS_PLANTILLA) },
      '<h3>Valores predeterminados de la unidad</h3>',
      { name: 'subtipo', label: 'Subtipo' }, { name: 'caract', label: 'Características', type: 'tags' },
      { name: 'activo', label: 'Activa (se ofrece al añadir unidades)', type: 'checkbox' },
    ], val)}<div class="row end gap"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">Guardar</button></div></form>`;
  } });
}
const leerPlantilla = form => { const v = readForm(form); return { ...UPL, nombre: v.nombre, prefijo: v.prefijo, tipo: v.tipo || null, color: v.color, vis: { forma: v.forma || '', icono: v.icono || '' }, campos: v.campos || [], obligatorios: v.obligatorios || [], valores: { subtipo: v.subtipo || '', caract: v.caract || [] }, activo: !!v.activo }; };
A['upl.nuevoTipo'] = el => {
  const form = el.closest('form'); const id = form.dataset.id || null; const p = leerPlantilla(form);
  nuevoTipoRecurso(t => { closeSheet(); abrirEditorPlantilla(id, { ...p, tipo: t.id }); });
};
F['upl.save'] = async form => {
  const p = leerPlantilla(form); p.id = form.dataset.id || null;
  const r = await core().guardarPlantillaUnidad(p); UPL = null;
  closeSheet(); toast('Plantilla «' + r.nombre + '» guardada', 'ok'); G.render();
};
A['upl.dup'] = async el => { const r = await core().duplicarPlantillaUnidad(el.dataset.id); toast('Plantilla duplicada: ' + r.nombre, 'ok'); G.render(); };
A['upl.toggle'] = async el => { const pl = core().plantillasUnidad().find(x => x.id === el.dataset.id); await core().activarPlantillaUnidad(el.dataset.id, pl.activo === false); toast(pl.activo === false ? 'Plantilla activada' : 'Plantilla desactivada', 'ok'); G.render(); };
A['upl.del'] = async el => {
  // Vista previa: qué unidades salieron de ella (no cambian: copiaron sus valores al crearse)
  const ref = await core().referenciasPlantillaUnidad(el.dataset.id); const pl = ref.plantilla;
  const n = ref.preventivos.reduce((a, p) => a + p.unidades, 0);
  const html = n ? `<p class="dlg-text">Se ${n === 1 ? 'creó 1 unidad' : 'crearon ' + n + ' unidades'} con ella:</p><ul class="ref-list">${ref.preventivos.map(p => `<li>${esc(p.nombre)} · ${p.unidades} ${p.unidades === 1 ? 'unidad' : 'unidades'}</li>`).join('')}</ul><p class="muted small">Esas unidades conservan todos sus datos e historial. La plantilla deja de ofrecerse.</p>`
    : `<p class="muted small">No se ha usado en los preventivos de este dispositivo.</p>`;
  const ini = DEFAULT_PLANTILLAS_UNIDAD.some(x => x.id === pl.id) ? '<p class="muted small">Es una plantilla inicial: no volverá a añadirse sola; se puede restaurar desde Configuración general.</p>' : '';
  if (!(await confirmDlg({ title: 'Eliminar «' + pl.nombre + '»', html: html + ini, ok: 'Eliminar', danger: true }))) return;
  await core().borrarPlantillaUnidad(pl.id); toast('Plantilla eliminada', 'ok'); G.render();
};
/** Configuraciones iniciales eliminadas: se restauran solo a petición */
function seccionIniciales() {
  if (!can('recursos.gestionar')) return '';
  const ini = core().inicialesEliminadas(); const n = ini.tiposRecurso.length + ini.plantillasUnidad.length;
  return n ? `<p class="muted small">${n} ${n === 1 ? 'configuración inicial eliminada' : 'configuraciones iniciales eliminadas'}: no vuelven a añadirse solas.</p><div class="row">${btn('Restaurar configuraciones iniciales…', 'ini.abrir', { cls: 'sm ghost', ic: 'subir' })}</div>` : '';
}
A['ini.abrir'] = () => {
  const ini = core().inicialesEliminadas();
  openSheet({
    title: 'Restaurar configuraciones iniciales', size: 'm',
    render: () => `<form data-f="ini.restaurar"><p class="muted">Marca las que quieras recuperar. Se añaden de nuevo a la configuración general${core().centralMeta ? ' y a todos los dispositivos conectados' : ''}.</p>${fieldsHtml([
      ...(ini.tiposRecurso.length ? [{ name: 'tipos', label: 'Tipos de recurso', type: 'checks', options: ini.tiposRecurso.map(t => [t.id, t.nombre]) }] : []),
      ...(ini.plantillasUnidad.length ? [{ name: 'plts', label: 'Unidades plantilla', type: 'checks', options: ini.plantillasUnidad.map(p => [p.id, p.nombre]) }] : []),
    ], { tipos: [], plts: [] })}<div class="row end gap"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">Restaurar</button></div></form>`,
  });
};
F['ini.restaurar'] = async form => {
  const v = readForm(form);
  const n = await core().restaurarIniciales({ tiposRecurso: v.tipos || [], plantillasUnidad: v.plts || [] });
  closeSheet(); toast(n ? n + ' restaurada(s)' : 'No has marcado ninguna', n ? 'ok' : 'info'); G.render();
};
export function applyTheme() {
  const cfg = core() && core().cfg; if (!cfg) return;
  // "Según el sistema": se respeta el tema del sistema (o el del visor en la vista previa)
  if (cfg.tema === 'claro' || cfg.tema === 'oscuro') document.documentElement.dataset.theme = cfg.tema === 'claro' ? 'light' : 'dark';
  else if (!G.preview) delete document.documentElement.dataset.theme;
  document.documentElement.classList.toggle('compact', cfg.densidad === 'compacta');
}
G.applyTheme = applyTheme;

// ======================= sistema =======================
export function renderSystemMenu() {
  const ce = core().centralEstado();
  return `<div class="grid-btns big">
    ${tile('sync', 'Servidor central', 'nav', { v: 'central' }, ce.meta ? ({ conectado: 'Conectado', sin_conexion: 'Sin conexión', error: 'Error', pendiente: 'Cambios pendientes', sincronizando: 'Sincronizando…', sesion: 'Inicia sesión para sincronizar', cuenta: 'Cuenta no activa' }[ce.st.estado] || 'Configurado') : 'Sin configurar')}
    ${tile('usuario', core().modoServidor() ? 'Usuarios y permisos' : 'Usuarios y roles', 'nav', { v: 'usuarios' }, core().modoServidor() ? 'En el servidor central' : '')}
    ${tile('archivar', 'Copias de seguridad', 'nav', { v: 'copias' })}
    ${can('auditoria.ver') ? tile('bitacora', 'Auditoría del sistema', 'nav', { v: 'auditoria' }) : ''}
    ${can('sistema.estado') ? tile('grafico', 'Estado del sistema', 'nav', { v: 'estado' }, 'Servidor, datos, sincronización y copias') : ''}
    ${tile('descargar', 'Actualizaciones', 'nav', { v: 'actualizaciones' }, core().bloqueoSync ? 'Actualización necesaria' : estadoApp().lista ? 'Versión ' + (estadoApp().lista.version || 'nueva') + ' lista' : 'Versión ' + APP_VERSION)}
    ${tile('escudo', 'Permisos del dispositivo', 'nav', { v: 'permisos' })}
    ${tile('llave', 'Mi cuenta', 'nav', { v: 'cuenta' })}
    ${tile('info', 'Acerca de', 'nav', { v: 'acerca' })}
  </div>`;
}

// ---------- servidor central ----------
let CENTRAL_DISP = null;
const CFG_NOMBRE = id => id === 'roles' ? 'Roles y permisos' : id.startsWith('usr:') ? 'Usuario' : id;
export function renderCentral() {
  const c = core(); const { meta, st, remoto, consultado, servidor } = c.centralEstado();
  const gestion = can('central.gestionar');
  if (!meta) {
    if (!consultado) { c.consultarCentral(); return '<p class="muted">Comprobando el servidor central…</p>'; }
    const intro = `<div class="note">Con el servidor central, los preventivos compartidos y los usuarios son los mismos en todos los dispositivos. No hay que escribir direcciones ni códigos: en cada dispositivo basta con iniciar sesión. Los datos viajan cifrados de extremo a extremo; el servidor no puede leerlos.</div>`;
    if (remoto && remoto.antiguo) return `${intro}<section class="card pad"><h3>El servidor necesita actualizarse</h3><p class="muted small">${esc(servidor)} tiene la versión ${esc(remoto.version || '?')}. El servidor central necesita la 1.1.0 o posterior: ejecuta el instalador nuevo en el PC servidor (guarda una copia de los datos y vuelve atrás solo si algo falla).</p>${btn('Reintentar', 'central.retry', { ic: 'sync' })}</section>`;
    if (!remoto) return `${intro}<section class="card pad"><h3>Sin conexión con el servidor central</h3><p class="muted small">No se ha podido contactar con ${esc(servidor)}. Este dispositivo sigue funcionando en local.</p>${btn('Reintentar', 'central.retry', { ic: 'sync' })}</section>`;
    if (remoto.org) return `${intro}<section class="card pad"><h3>Conectar este dispositivo</h3>
      <p class="muted small">El servidor central <b>${esc(remoto.nombre || servidor)}</b> ya está activo. Inicia sesión con tu usuario y contraseña del servidor central (los mismos que en cualquier otro dispositivo conectado).</p>
      <form data-f="central.conectar">${fieldsHtml([
        { name: 'u', label: 'Usuario', required: true, value: c.user ? c.user.usuario : '', attrs: 'autocomplete="username" autocapitalize="none"' },
        { name: 'p', label: 'Contraseña', type: 'password', required: true, attrs: 'autocomplete="current-password"' },
      ])}<p class="muted small">Los preventivos compartidos de este dispositivo pasarán al servidor central. Si en este dispositivo había usuarios con el mismo nombre que en el servidor, se usarán los del servidor.</p>
      <div class="row end"><button class="btn primary">Conectar</button></div></form></section>`;
    return `${intro}${gestion ? `<section class="card pad"><h3>Activar el servidor central</h3>
      <p class="muted small">Se hace <b>una sola vez</b> para toda la organización. Hace falta el <b>código de administración del servidor</b>: lo muestra el instalador al terminar y se puede consultar en el PC servidor con «MOSTRAR-CODIGO-ADMIN».</p>
      <form data-f="central.activar">${fieldsHtml([
        { name: 'codigo', label: 'Código de administración del servidor', required: true, placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX', attrs: 'autocomplete="off" autocapitalize="characters"' },
        { name: 'p', label: 'Tu contraseña (para entrar también desde otros dispositivos)', type: 'password', required: true, attrs: 'autocomplete="current-password"' },
        { name: 'nombre', label: 'Nombre de la organización', value: 'Gestor de Emergencias UCO' },
      ])}<p class="muted small">Se publicarán los usuarios, roles y preventivos compartidos de este dispositivo.</p>
      <div class="row end"><button class="btn primary">Activar servidor central</button></div></form></section>` : '<p class="note">El servidor central aún no está activado. Debe activarlo un administrador.</p>'}`;
  }
  const est = { conectado: ['Conectado', 'ok'], sincronizando: ['Sincronizando…', 'ok'], pendiente: ['Cambios pendientes', 'warn'], sin_conexion: ['Sin conexión: se sigue trabajando en local y se sincroniza al volver', 'warn'], error: ['Error: ' + (st.error || ''), 'bad'], sesion: ['Inicia sesión para sincronizar', 'warn'], cuenta: ['Cuenta no activa: ' + (st.error || ''), 'bad'] }[st.estado] || ['Comprobando…', 'muted'];
  const ms = c.modoServidor();
  const disp = CENTRAL_DISP ? Object.entries(CENTRAL_DISP).sort((a, b) => b[1].visto - a[1].visto) : null;
  const confl = c._centralConflictos || [];
  const rech = c._centralRechazos || [];
  if (!c._centralRechazosP) c._centralRechazosP = c.repo.rechazos().then(r => { const antes = JSON.stringify(c._centralRechazos || []); c._centralRechazos = r; c._centralRechazosP = null; if (JSON.stringify(r) !== antes) G.render(); }).catch(() => { c._centralRechazosP = null; });
  if (!c._centralConflictosP) c._centralConflictosP = c.central.datos().then(d => { c._centralConflictos = Object.entries(d.conflictos).map(([id, x]) => ({ id, ...x })); c._centralConflictosP = null; if (c._centralConflictos.length !== confl.length) G.render(); });
  return `<section class="card pad"><h3>Estado</h3>
      <dl class="kv">
        <dt>Estado</dt><dd><span class="chip ${est[1]}" data-central-estado="${attr(st.estado || '')}">${esc(est[0])}</span></dd>
        <dt>Servidor</dt><dd>${esc(meta.server)} <span class="muted small">(preconfigurado, HTTPS)</span></dd>
        <dt>Organización</dt><dd>${esc(meta.nombre || '—')}${meta.pruebas ? ' ' + chip('PRUEBAS · CLAUDE_TEST', '#C62828') : ''}</dd>
        <dt>Última comunicación</dt><dd>${st.ultimo ? esc(fmtDateTime(st.ultimo)) : '—'}</dd>
        <dt>Modo</dt><dd>${ms ? chip('Servidor que valida', '#1565C0') + ' <span class="muted small">usuarios, permisos y operaciones comprobados en el servidor</span>' : chip('Cifrado de extremo a extremo', '#607D8B') + ' <span class="muted small">el servidor no lee los datos ni comprueba permisos</span>'}</dd>
      </dl>
      ${st.estado === 'sesion' ? `<form data-f="central.sesion" class="note warn">${icon('llave')} Tu sesión del servidor ha caducado o no se ha abierto todavía en este dispositivo. Tus cambios se guardan aquí y se enviarán al volver a entrar.
        ${c.user && c.user.metodo === 'pin' ? `<div class="row gap wrap">${btn('Volver a entrar con mi PIN', 'central.reentrar', { cls: 'primary' })}</div>` : `<div class="row gap wrap"><input type="password" name="p" placeholder="Tu contraseña" autocomplete="current-password" aria-label="Contraseña" required><button class="btn primary">Abrir sesión</button></div>`}</form>` : ''}
      <div class="row gap wrap">${btn('Comprobar ahora', 'central.sync', { ic: 'sync' })}${gestion ? btn('Ver dispositivos', 'central.disp', { ic: 'usuario' }) : ''}</div>
      <p class="muted small">Para añadir un dispositivo: abre la aplicación en él e inicia sesión con tu usuario y contraseña. No hay que configurar nada más.</p>
    </section>
    ${confl.length ? `<section class="card pad"><h3>Cambios simultáneos por resolver ${chip(String(confl.length), '#C62828')}</h3><p class="muted small">Otro dispositivo cambió lo mismo a la vez. Elige qué versión se conserva; nunca se sobrescribe sin avisar.</p>
      ${confl.map(x => `<div class="conf"><b>${esc(CFG_NOMBRE(x.id))}</b>${x.id.startsWith('usr:') && (x.mio || x.suyo) ? ' ' + esc((x.mio || x.suyo).usuario || '') : ''}<div class="muted small">${esc(fmtDateTime(x.t))}</div>
        ${can('usuarios.admin') || gestion ? `<div class="actions">${btn('Mantener la de este dispositivo', 'central.resolver', { data: { id: x.id, v: 'mio' } })}${btn('Usar la del servidor', 'central.resolver', { cls: 'primary', data: { id: x.id, v: 'suyo' } })}</div>` : ''}</div>`).join('')}</section>` : ''}
    ${rech.length ? seccionRechazos(rech) : ''}
    ${disp ? `<section class="card pad"><h3>Dispositivos conectados</h3><table class="tbl"><thead><tr><th>Dispositivo</th><th>Versión</th><th>Última comunicación</th></tr></thead><tbody>${disp.map(([id, d]) => `<tr><td>${esc(d.nombre || id)}${id === c.device.id ? ' (este)' : ''}</td><td>${esc(d.version || '—')}</td><td>${esc(fmtDateTime(d.visto))}</td></tr>`).join('')}</tbody></table></section>` : ''}
    ${gestion && !ms ? seccionMigracion() : ''}
    ${gestion ? `<section class="card pad"><h3>Este dispositivo</h3><p class="muted small">Si este dispositivo deja de usar el servidor central, los preventivos ya descargados se conservan en él.</p>${btn('Dejar de usar el servidor central aquí', 'central.olvidar', { cls: 'danger ghost' })}</section>` : ''}`;
}
/** Cambios que el servidor no aceptó (p. ej. hechos sin conexión con permisos o tipos ya retirados): nunca desaparecen en silencio */
function seccionRechazos(rech) {
  const nuevos = rech.filter(r => !r.revisado).reverse(); const revisados = rech.filter(r => r.revisado).reverse();
  const fila = r => `<li><b>${esc(r.que || r.k || 'Cambio')}</b>${r.prev ? ` <span class="muted">· ${esc(r.prev)}</span>` : ''}<div class="small">${esc(r.error || '')}</div><div class="muted small">${esc(fmtDateTime(r.t))}${r.autor ? ' · hecho por ' + esc(r.autor) : ''}${r.revisado ? ' · revisado' + (r.revisadoPor ? ' por ' + esc(r.revisadoPor) : '') : ''}</div></li>`;
  return `<section class="card pad" data-rechazos><h3>Cambios rechazados por el servidor ${nuevos.length ? chip(String(nuevos.length), '#C62828') : ''}</h3>
    <p class="muted small">El servidor no aceptó estos cambios (por ejemplo, hechos sin conexión con un permiso o un tipo de recurso que ya no estaba vigente). No se han aplicado en ningún dispositivo: si siguen siendo necesarios, vuelve a hacerlos.</p>
    ${nuevos.length ? `<ul class="ref-list">${nuevos.slice(0, 30).map(fila).join('')}</ul><div class="row end">${btn('Marcar como revisados', 'central.rechazosRevisados', { ic: 'ok' })}</div>` : ''}
    ${revisados.length ? `<details class="retirados"><summary>Revisados (${revisados.length})</summary><ul class="ref-list">${revisados.slice(0, 50).map(fila).join('')}</ul></details>` : ''}</section>`;
}
A['central.rechazosRevisados'] = async () => { await core().marcarRechazosRevisados(); core()._centralRechazos = null; toast('Marcados como revisados', 'ok'); G.render(); };
/** Paso del espacio central al modo servidor (1.4.0): explica las consecuencias y pide el código del servidor */
function seccionMigracion() {
  return `<section class="card pad" data-migracion><h3>${icon('escudo')} Pasar al modo servidor (1.4.0)</h3>
    <p class="muted small">Con este cambio el servidor comprueba los usuarios y permisos de cada operación (lo que alguien no tiene permitido se rechaza aunque manipule la aplicación), puede suspender cuentas al momento, admitir solicitudes de cuenta y cuentas con código + PIN.</p>
    <ul class="small">
      <li><b>Consecuencia:</b> el servidor custodiará la clave del espacio y podrá leer los preventivos compartidos (siguen cifrados en su disco). Deja de haber cifrado de extremo a extremo.</li>
      <li>Se hace una copia de los datos del espacio antes de cambiar nada; las contraseñas siguen siendo las mismas.</li>
      <li>Todos los dispositivos deben tener la versión 1.4.0 para seguir sincronizando.</li>
      <li>Los preventivos independientes no cambian.</li>
    </ul>
    <form data-f="central.migrar">${fieldsHtml([
      { name: 'codigo', label: 'Código de administración del servidor', required: true, placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX', attrs: 'autocomplete="off" autocapitalize="characters"' },
      { name: 'p', label: 'Tu contraseña', type: 'password', required: true, attrs: 'autocomplete="current-password"' },
      { name: 'ok', label: 'He leído las consecuencias y quiero pasar al modo servidor', type: 'checkbox' },
    ])}
    <div class="row end"><button class="btn primary">Pasar al modo servidor</button></div></form></section>`;
}
F['central.migrar'] = async form => {
  const v = readForm(form);
  if (!v.ok) { toast('Confirma que has leído las consecuencias', 'error'); return; }
  toast('Pasando el espacio central al modo servidor…', 'info', 5000);
  const r = await core().migrarAlModoServidor({ codigo: v.codigo, password: v.p });
  invalidarUsuariosServidor();
  toast('Hecho: ' + r.usuarios + ' usuario(s) y ' + r.preventivos + ' preventivo(s) en modo servidor. Copia previa: ' + r.copia, 'ok', 10000); G.render();
};
F['central.sesion'] = async form => { await core().renovarSesion(form.p.value); toast('Sesión abierta: se sincroniza de nuevo', 'ok'); G.render(); };
A['central.reentrar'] = async () => { await core().logout(); };
A['central.retry'] = async () => { await core().consultarCentral(); G.render(); };
F['central.activar'] = async form => {
  const v = readForm(form);
  toast('Activando el servidor central…', 'info', 4000);
  const m = await core().centralActivar({ codigo: v.codigo, password: v.p, nombre: v.nombre });
  toast('Servidor central activado (' + m.server + '). En los demás dispositivos basta con iniciar sesión.', 'ok', 8000);
  G.render();
};
F['central.conectar'] = async form => {
  const v = readForm(form);
  toast('Conectando con el servidor central…', 'info', 4000);
  await core().centralConectar({ usuario: v.u, password: v.p });
  toast('Dispositivo conectado al servidor central', 'ok', 6000);
  G.go('inicio');
};
A['central.sync'] = async () => { const st = await core().central.syncNow(); toast(st.estado === 'conectado' ? 'Servidor central: conectado' : 'Servidor central: ' + (st.error || st.estado), st.estado === 'conectado' ? 'ok' : 'warn'); G.render(); };
A['central.disp'] = async () => { CENTRAL_DISP = await core().central.dispositivos(); G.render(); };
A['central.resolver'] = async el => {
  const c = core(); await c.central.resolverConfig(el.dataset.id, el.dataset.v);
  if (el.dataset.v === 'suyo') await c._centralConfig([el.dataset.id]);
  c._centralConflictos = (c._centralConflictos || []).filter(x => x.id !== el.dataset.id);
  toast('Resuelto', 'ok'); G.render();
};
A['central.olvidar'] = async () => {
  if (!(await confirmDlg({ title: 'Dejar de usar el servidor central', text: 'Este dispositivo dejará de recibir preventivos, usuarios y configuración del servidor central. Los datos ya descargados se conservan aquí.', ok: 'Dejar de usarlo', danger: true }))) return;
  await core().centralOlvidar(); CENTRAL_DISP = null; toast('Este dispositivo ya no usa el servidor central', 'ok'); G.render();
};

// ---------- usuarios y roles ----------
let USERS = null, ROLES = null;
export function renderUsers() {
  if (core().modoServidor()) return renderUsuariosServidor();
  if (!can('usuarios.admin')) return empty('No tienes permiso para administrar usuarios y roles');
  if (!USERS || !ROLES) { Promise.all([core().repo.listUsers(), core().repo.getRoles()]).then(([u, r]) => { USERS = u; ROLES = r; G.render(); }); return `<p class="muted">Cargando…</p>`; }
  const f = filt('users'); const tab = f.tab || 'u';
  return tabs([['u', 'Usuarios', USERS.length], ['r', 'Roles y permisos', ROLES.length]], tab, 'users.tab') + (tab === 'u' ? usersList() : rolesMatrix());
}
A['users.tab'] = el => { filt('users').tab = el.dataset.v; G.render(); };
function usersList() {
  const rn = id => (ROLES.find(r => r.id === id) || {}).nombre || id;
  return `<div class="row end">${btn('Nuevo usuario', 'users.edit', { cls: 'primary', ic: 'mas_add' })}</div>
  <div class="scroll"><table class="tbl"><thead><tr><th>Nombre</th><th>Usuario</th><th>Rol</th><th>Estado</th><th>Último acceso</th><th></th></tr></thead><tbody>
  ${USERS.map(u => `<tr><td>${esc(u.nombre)}</td><td><code>${esc(u.usuario)}</code></td><td>${esc(rn(u.rol))}</td><td>${u.activo ? chip('Activo', '#2E7D32') : chip('Inactivo', '#757575')}</td><td>${u.ultimoAcceso ? fmtDateTime(u.ultimoAcceso) : '—'}</td><td>${btn('', 'users.edit', { cls: 'icon ghost', ic: 'editar', data: { id: u.id }, title: 'Editar' })}</td></tr>`).join('')}
  </tbody></table></div><p class="muted small">Los usuarios no se eliminan para conservar la autoría de los registros: se desactivan.</p>`;
}
A['users.edit'] = el => {
  const u = el.dataset.id ? USERS.find(x => x.id === el.dataset.id) : { activo: true, rol: 'rol_operador' };
  openSheet({ title: u.id ? 'Editar usuario' : 'Nuevo usuario', size: 's', render: () => `<form data-f="users.save" data-id="${u.id || ''}">${fieldsHtml([
    { name: 'nombre', label: 'Nombre y apellidos', required: true }, { name: 'usuario', label: 'Usuario', required: true },
    { name: 'rol', label: 'Rol', type: 'select', options: ROLES.map(r => [r.id, r.nombre]) },
    { name: 'activo', label: 'Usuario activo', type: 'checkbox' },
    { name: 'pw', label: (u.id ? 'Nueva contraseña (vacío = no cambiar)' : 'Contraseña inicial') + ' · mínimo ' + core().minPassword() + ' caracteres', type: 'password', required: !u.id, autocomplete: 'new-password', help: core().centralMeta ? 'La cuenta sirve en todos los dispositivos conectados al servidor central.' : '' },
  ], u)}<div class="row end gap"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">Guardar</button></div></form>` });
};
F['users.save'] = async form => {
  const v = readForm(form);
  await core().saveUser({ id: form.dataset.id || null, usuario: v.usuario, nombre: v.nombre, rol: v.rol, activo: v.activo }, v.pw || null);
  USERS = null; closeSheet(); toast('Usuario guardado', 'ok'); await core().repo.refreshSession(); G.render();
};
function rolesMatrix() {
  const groups = {}; for (const [k, l, g] of PERMISOS) (groups[g] = groups[g] || []).push([k, l]);
  return `<p class="muted small">Matriz de permisos. Se aplica en la lógica de negocio: una acción sin permiso se rechaza aunque se intente desde otra pantalla.</p>
  <div class="row end gap">${btn('Nuevo rol', 'roles.add', { ic: 'mas_add' })}${btn('Guardar matriz', 'roles.save', { cls: 'primary', ic: 'ok' })}</div>
  <div class="scroll"><table class="tbl matrix"><thead><tr><th>Permiso</th>${ROLES.map((r, i) => `<th><span>${esc(r.nombre)}</span>${r.sistema ? '' : `<button class="btn icon ghost sm" data-a="roles.del" data-i="${i}" aria-label="Eliminar rol">${icon('papelera')}</button>`}<button class="btn icon ghost sm" data-a="roles.ren" data-i="${i}" aria-label="Renombrar">${icon('editar')}</button></th>`).join('')}</tr></thead><tbody>
  ${Object.entries(groups).map(([g, ps]) => `<tr class="grp"><td colspan="${ROLES.length + 1}">${esc(g)}</td></tr>` + ps.map(([k, l]) => `<tr><td>${esc(l)}</td>${ROLES.map((r, i) => `<td class="c"><input type="checkbox" aria-label="${attr(r.nombre + ': ' + l)}" data-c="roles.tog" data-i="${i}" data-p="${k}"${r.permisos.includes(k) ? ' checked' : ''}${r.id === 'rol_admin' && k === 'usuarios.admin' ? ' disabled' : ''}></td>`).join('')}</tr>`).join('')).join('')}
  </tbody></table></div>`;
}
CH['roles.tog'] = el => { const r = ROLES[Number(el.dataset.i)]; const s = new Set(r.permisos); el.checked ? s.add(el.dataset.p) : s.delete(el.dataset.p); r.permisos = [...s]; };
A['roles.add'] = async () => { const n = await confirmDlg({ title: 'Nuevo rol', input: { label: 'Nombre del rol' }, ok: 'Crear' }); if (!n) return; ROLES.push({ id: 'rol_' + Date.now().toString(36), nombre: n, permisos: ['estadisticas.ver'] }); G.render(); };
A['roles.ren'] = async el => { const r = ROLES[Number(el.dataset.i)]; const n = await confirmDlg({ title: 'Renombrar rol', input: { label: 'Nombre', value: r.nombre }, ok: 'Aceptar' }); if (n) { r.nombre = n; G.render(); } };
A['roles.del'] = async el => { const i = Number(el.dataset.i); if (USERS.some(u => u.rol === ROLES[i].id)) { toast('Hay usuarios con ese rol', 'error'); return; } ROLES.splice(i, 1); G.render(); };
A['roles.save'] = async () => { await core().saveRoles(ROLES); ROLES = null; toast('Roles y permisos guardados', 'ok'); G.render(); };

// ---------- copias de seguridad ----------
let BK = null;
export function renderBackups() {
  if (!can('copias.gestionar')) return empty('No tienes permiso para gestionar copias de seguridad');
  if (!BK) { core().repo.listBackups().then(b => { BK = b; G.render(); }); return '<p class="muted">Cargando…</p>'; }
  const T = { auto: 'Automática', manual: 'Manual', previa: 'Punto de restauración' };
  const list = BK; BK = null;
  return `<section class="card pad"><h2>Copias y restauración</h2>
    <p class="muted small">Todo se guarda cifrado en este dispositivo. Se crean copias automáticas periódicas y puntos de restauración antes de operaciones importantes (cierre, restauración). Para proteger los datos ante la pérdida del dispositivo, exporta una copia completa cifrada y guárdala fuera.</p>
    <div class="actions">${btn('Crear copia ahora', 'bk.create', { cls: 'primary', ic: 'archivar' })}${btn('Exportar copia completa (cifrada)', 'bk.export', { ic: 'descargar' })}${btn('Exportación sin cifrar (JSON)', 'bk.exportPlain', { ic: 'descargar' })}${btn('Restaurar desde archivo', 'bk.import', { ic: 'subir' })}${btn('Verificar integridad', 'bk.verify', { ic: 'escudo' })}</div>
    ${G.lastVerify ? `<p class="note ${G.lastVerify.ok ? 'ok' : 'bad'}">${icon(G.lastVerify.ok ? 'ok' : 'alerta')} Integridad ${G.lastVerify.ok ? 'correcta' : 'con errores'}: ${G.lastVerify.ops} operaciones (${G.lastVerify.opsMal} ilegibles), ${G.lastVerify.docs} documentos (${G.lastVerify.docsMal}), ${G.lastVerify.blobs} archivos (${G.lastVerify.blobsMal}), ${G.lastVerify.copias} copias (${G.lastVerify.copiasMal} dañadas).</p>` : ''}</section>
  <section class="card pad"><h2>Copias locales <b class="count">${list.length}</b></h2>
  <div class="scroll"><table class="tbl"><thead><tr><th>Fecha</th><th>Tipo</th><th>Nota</th><th class="num">Operaciones</th><th>Huella</th><th></th></tr></thead><tbody>
  ${list.map(b => `<tr><td>${fmtDateTime(b.t, true)}</td><td>${esc(T[b.tipo] || b.tipo)}</td><td>${esc(b.nota || '')}</td><td class="num">${b.size}</td><td><code>${esc((b.integridad || '').slice(0, 10))}</code></td><td class="row gap-s">${btn('Restaurar', 'bk.restore', { cls: 'sm', data: { id: b.id } })}${btn('', 'bk.del', { cls: 'icon ghost sm', ic: 'papelera', data: { id: b.id }, title: 'Eliminar copia' })}</td></tr>`).join('') || '<tr><td colspan="6" class="muted">Sin copias todavía</td></tr>'}
  </tbody></table></div></section>`;
}
A['bk.create'] = async () => { const n = await confirmDlg({ title: 'Nueva copia', input: { label: 'Nota (opcional)', value: '' }, ok: 'Crear copia' }); if (n == null) return; await core().repo.createBackup('manual', n); BK = null; toast('Copia creada', 'ok'); G.render(); };
A['bk.del'] = async el => { if (!(await confirmDlg({ title: 'Eliminar copia', text: 'Se elimina esta copia local (no afecta a los datos actuales).', ok: 'Eliminar', danger: true }))) return; await core().repo.deleteBackup(el.dataset.id); BK = null; G.render(); };
A['bk.verify'] = async () => { toast('Verificando…'); G.lastVerify = await core().repo.verify(); G.render(); };
A['bk.export'] = async () => {
  const r = await confirmDlg({ title: 'Copia completa cifrada', text: 'Incluye usuarios, preventivos, plantillas, planos y auditoría. Permite restaurar todo en otro dispositivo. Guarda la contraseña: sin ella no se puede abrir.', ok: 'Exportar', fields: [{ name: 'p1', label: 'Contraseña de la copia', type: 'password', required: true }, { name: 'p2', label: 'Repite la contraseña', type: 'password', required: true }] });
  if (!r) return; if (r.p1 !== r.p2) { toast('Las contraseñas no coinciden', 'error'); return; }
  const txt = await core().repo.exportBackupFile(r.p1);
  await saveFile('copia-uco-' + safeName(core().device.nombre) + '-' + fileStamp() + '.ucobak', txt, 'application/json', { share: true });
};
A['bk.exportPlain'] = async () => {
  if (!(await confirmDlg({ title: 'Exportación sin cifrar', text: 'El archivo contendrá todos los datos legibles (sin contraseñas). Trátalo como información sensible.', ok: 'Exportar', danger: true }))) return;
  if (!(await authorize('Exportar los datos sin cifrar requiere autorización.'))) return;
  const txt = await core().repo.exportBackupFile('');
  await saveFile('exportacion-uco-' + fileStamp() + '.json', txt, 'application/json');
};
A['bk.import'] = async () => {
  const f = await pickFile('.ucobak,.json,application/json'); if (!f) return;
  const text = await readText(f);
  let pw = null; try { JSON.parse(text).formato === 'uco-copia-cifrada' && (pw = await confirmDlg({ title: 'Copia cifrada', input: { label: 'Contraseña de la copia', type: 'password' }, ok: 'Abrir' })); } catch { }
  const p = await core().repo.parseBackupFile(text, pw);
  await restoreFlow(p, 'Archivo ' + f.name);
};
A['bk.restore'] = async el => { const p = await core().repo.readBackup(el.dataset.id); await restoreFlow(p, 'Copia local'); };
async function restoreFlow(p, origen) {
  const nPrev = p.docs.filter(d => d.id.startsWith('sum:')).length;
  const r = await confirmDlg({
    title: 'Restaurar copia', ok: 'Restaurar', danger: true,
    html: `<p>${esc(origen)} · creada ${fmtDateTime(p.creada)} en ${esc(p.dispositivo.nombre)}<br>${p.ops.length} operaciones · ${nPrev} preventivos · ${p.docs.filter(d => d.id.startsWith('tpl:')).length} plantillas · integridad verificada</p>`,
    fields: [{ name: 'modo', label: 'Modo', type: 'select', options: [['fusionar', 'Fusionar: añade lo que falte, sin borrar nada (recomendado)'], ['reemplazar', 'Reemplazar: restauración completa (sustituye usuarios y datos)']] }],
  });
  if (!r) return;
  if (!(await authorize('Restaurar una copia modifica los datos del dispositivo. Antes se crea un punto de restauración.'))) return;
  const st = await core().repo.restore(p, r.modo);
  BK = null;
  if (r.modo === 'reemplazar') { toast('Restauración completa realizada. Inicia sesión de nuevo.', 'ok', 7000); await core().logout(); G.render(); return; }
  await core().refreshSummaries();
  if (core().cur) await core().openPrev(core().cur);
  toast('Restaurado: ' + st.ops + ' operaciones, ' + st.docs + ' documentos, ' + st.blobs + ' archivos', 'ok', 6000); G.render();
}

// ---------- auditoría del sistema ----------
let AUD = null;
let AUD_SRV = null;
export function renderAudit() {
  // Modo servidor: también la auditoría del servidor (usuarios, permisos, rechazos), filtrable por usuario
  const f = filt('aud'); const tab = core().modoServidor() ? f.tab || 'srv' : 'dev';
  const pest = core().modoServidor() ? tabs([['srv', 'Servidor central'], ['dev', 'Este dispositivo']], tab, 'aud.tab') : '';
  if (tab === 'srv') {
    if (!AUD_SRV) { core().auditoriaServidor({ usuario: f.usuario || '' }).then(a => { AUD_SRV = a; G.render(); }).catch(e => { AUD_SRV = { error: e.message }; G.render(); }); return pest + '<p class="muted">Cargando la auditoría del servidor…</p>'; }
    const out = pest + `<div class="row gap wrap"><p class="muted grow">Altas, aprobaciones, cambios de estado y de permisos, códigos, accesos revocados, migración y operaciones rechazadas: quién, qué, a quién y cuándo.</p>
      <input type="search" placeholder="Filtrar por usuario" value="${attr(f.usuario || '')}" data-c="aud.usuario" aria-label="Filtrar por usuario">${btn('Actualizar', 'aud.reload', { ic: 'sync' })}</div>
      ${AUD_SRV.error ? `<p class="note bad">${esc(AUD_SRV.error)}</p>` : tablaAuditoria(AUD_SRV)}`;
    AUD_SRV = null; return out;
  }
  if (!AUD) { core().repo.listAudit().then(a => { AUD = a; G.render(); }); return pest + '<p class="muted">Cargando…</p>'; }
  const out = pest + `<div class="row between"><p class="muted">Operaciones administrativas del dispositivo: accesos, usuarios, roles, configuración, plantillas, copias y restauraciones. Cada preventivo tiene además su propia bitácora.</p>${btn('Actualizar', 'aud.reload', { ic: 'sync' })}</div>
  <div class="log">${AUD.slice(0, 500).map(e => `<div class="log-row"><time>${fmtDateTime(e.t, true)}</time><div class="grow"><b>${esc(e.elemento)}</b> · ${esc(e.accion)}${e.anterior || e.nuevo ? `<div class="small">${e.anterior ? `<span class="old">${esc(e.anterior)}</span> → ` : ''}<span class="new">${esc(e.nuevo)}</span></div>` : ''}<div class="muted small">${esc(e.usuario)} · ${esc(e.dispositivo)}</div></div></div>`).join('') || empty('Sin registros')}</div>`;
  AUD = null; return out;
}
A['aud.reload'] = () => { AUD = null; AUD_SRV = null; G.render(); };
A['aud.tab'] = el => { filt('aud').tab = el.dataset.v; G.render(); };
CH['aud.usuario'] = el => { filt('aud').usuario = el.value.trim(); AUD_SRV = null; G.render(); };

// ---------- permisos del dispositivo ----------
const PERMS = {};
async function refreshPerms() {
  const q = async name => { try { return (await navigator.permissions.query({ name })).state; } catch { return 'desconocido'; } };
  PERMS.storage = navigator.storage && navigator.storage.persisted ? (await navigator.storage.persisted() ? 'granted' : 'prompt') : 'no disponible';
  try { const e = await navigator.storage.estimate(); PERMS.usage = e.usage; PERMS.quota = e.quota; } catch { }
  PERMS.geo = navigator.geolocation ? await q('geolocation') : 'no disponible';
  PERMS.notif = window.Notification ? Notification.permission : 'no disponible';
  PERMS.wake = 'wakeLock' in navigator ? (G.wakeLock && !G.wakeLock.released ? 'granted' : 'prompt') : 'no disponible';
  PERMS.share = navigator.canShare ? 'granted' : 'no disponible';
  PERMS.vibrate = navigator.vibrate ? 'granted' : 'no disponible';
  PERMS.installed = matchMedia('(display-mode: standalone)').matches ? 'granted' : G.installPrompt ? 'prompt' : 'manual';
  PERMS.loaded = true; G.render();
}
const ST = { granted: ['Concedido', 'ok'], denied: ['Denegado', 'bad'], prompt: ['Pendiente', 'warn'], default: ['Pendiente', 'warn'], 'no disponible': ['No disponible', 'muted'], desconocido: ['Desconocido', 'muted'], manual: ['Manual', 'warn'] };
export function renderDevicePerms() {
  if (!PERMS.loaded) { refreshPerms(); return '<p class="muted">Comprobando permisos…</p>'; }
  // action: botón para conceder (si falta); test: botón «Probar» (si ya está concedido)
  const row = (k, title, desc, action, label, test) => { const [l, c] = ST[PERMS[k]] || [PERMS[k], 'muted']; return `<div class="perm-row"><div class="grow"><b>${esc(title)}</b><p class="muted small">${esc(desc)}</p></div><span class="chip ${c}">${esc(l)}</span>${action && PERMS[k] !== 'granted' && PERMS[k] !== 'no disponible' ? btn(label || 'Solicitar', action, { cls: 'primary sm' }) : ''}${test && PERMS[k] === 'granted' ? btn('Probar', test, { cls: 'sm' }) : ''}</div>`; };
  return `<p class="muted">Permisos que la aplicación necesita para funcionar plenamente en este dispositivo. Ninguno es obligatorio para la operativa básica sin conexión.</p>
  ${G.preview ? `<p class="note warn">${icon('info')} En la vista previa el visor de Claude no permite conceder estos permisos. Solicítalos desde la aplicación publicada.</p>` : ''}
  <div class="row end">${btn('Solicitar todos los permisos', 'perm.all', { cls: 'primary', ic: 'escudo' })}</div>
  <div class="card">${row('storage', 'Almacenamiento persistente', 'Evita que el navegador borre los datos si falta espacio. Muy recomendable.' + (PERMS.usage != null ? ' Uso: ' + Math.round(PERMS.usage / 1048576) + ' MB de ' + Math.round(PERMS.quota / 1048576) + ' MB.' : ''), 'perm.storage')}
  ${row('geo', 'Ubicación (GPS)', 'Para registrar la posición de unidades y avisos con un toque. La ubicación manual funciona sin GPS.', 'perm.geo')}
  ${row('notif', 'Notificaciones', 'Avisa del fin de los descansos mientras la aplicación está abierta.', 'perm.notif', null, 'perm.notifTest')}
  ${row('wake', 'Pantalla siempre encendida', 'Mantiene la pantalla activa durante el servicio (mientras la aplicación esté visible).', 'perm.wake', 'Activar')}
  ${row('installed', 'Instalar como aplicación', PERMS.installed === 'manual' ? 'En Chrome para Android: menú ⋮ → "Instalar aplicación" o "Añadir a pantalla de inicio".' : 'Abre la aplicación a pantalla completa y sin barra del navegador.', PERMS.installed === 'prompt' ? 'perm.install' : null, 'Instalar')}
  ${row('share', 'Compartir archivos', 'Enviar informes y paquetes por WhatsApp, correo o Drive.', null)}
  ${row('vibrate', 'Vibración', 'Alerta táctil al terminar un descanso.', null, null, 'perm.vibrate')}</div>
  <div class="row end">${btn('Comprobar de nuevo', 'perm.refresh', { ic: 'sync' })}</div>`;
}
A['perm.refresh'] = () => { PERMS.loaded = false; G.render(); };

/**
 * Solicita todos los permisos pertinentes del dispositivo, en el orden que mejor
 * aprovecha la pulsación del usuario (algunos navegadores la exigen).
 */
export async function requestAllPerms() {
  const res = [];
  const add = (n, ok, extra = '') => res.push({ n, ok, extra });
  if (G.installPrompt && !matchMedia('(display-mode: standalone)').matches) {
    try { G.installPrompt.prompt(); const c = await G.installPrompt.userChoice; G.installPrompt = null; add('Instalación', c.outcome === 'accepted'); } catch { add('Instalación', false); }
  }
  if (window.Notification) {
    try { const r = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission; add('Notificaciones', r === 'granted', r === 'denied' ? 'bloqueadas: actívalas en los ajustes del sitio' : ''); } catch { add('Notificaciones', false); }
  } else add('Notificaciones', false, 'no disponibles');
  if (navigator.geolocation) {
    const r = await new Promise(ok => navigator.geolocation.getCurrentPosition(() => ok(''), e => ok(e && e.code === 1 ? 'denegada' : 'sin señal'), { timeout: 20000, maximumAge: 60000 }));
    add('Ubicación', !r, r);
  } else add('Ubicación', false, 'no disponible');
  if (navigator.storage && navigator.storage.persist) {
    try { add('Almacenamiento persistente', await navigator.storage.persist(), 'el navegador lo concede al instalar la aplicación o usarla a menudo'); } catch { add('Almacenamiento persistente', false); }
  }
  if ('wakeLock' in navigator) {
    try { G.wakeWanted = true; await acquireWake(); add('Pantalla encendida', true); } catch { add('Pantalla encendida', false); }
  }
  try { localStorage.setItem('uco:permisos', String(Date.now())); } catch { }
  try { await core().repo.audit('Solicitud de permisos del dispositivo', 'Dispositivo', '', res.map(r => r.n + ': ' + (r.ok ? 'concedido' : 'no concedido')).join(' | ')); } catch { }
  PERMS.loaded = false;
  return res;
}
A['perm.all'] = async () => {
  const res = await requestAllPerms();
  const okN = res.filter(r => r.ok).length;
  toast(okN + ' de ' + res.length + ' permisos concedidos' + (res.some(r => !r.ok) ? ': revisa los pendientes' : ''), okN === res.length ? 'ok' : 'info', 6000);
  if (document.querySelector('[data-perm-onboard]')) closeSheet();
  G.render();
};
/** Al entrar por primera vez en un dispositivo se ofrecen todos los permisos */
G.askPerms = () => {
  if (G.preview) return;
  try { if (localStorage.getItem('uco:permisos')) return; } catch { return; }
  openSheet({
    title: 'Permisos del dispositivo', size: 's',
    render: () => `<div data-perm-onboard="1"><p>Para funcionar plenamente en operaciones, la aplicación necesita:</p>
      <ul class="plain"><li><b>Instalación</b> como aplicación (pantalla completa, sin barra del navegador).</li>
      <li><b>Notificaciones</b> para avisar del fin de los descansos.</li><li><b>Ubicación</b> (GPS) para registrar posiciones con un toque.</li>
      <li><b>Almacenamiento persistente</b> para que el navegador no borre datos por falta de espacio.</li><li><b>Pantalla encendida</b> durante el servicio.</li></ul>
      <p class="muted small">Ninguno es obligatorio: la operativa básica funciona sin ellos y sin conexión. Puedes cambiarlos en Sistema → Permisos del dispositivo.</p>
      <div class="row end gap"><button class="btn ghost" data-a="perm.later">Ahora no</button><button class="btn primary" data-a="perm.all">Solicitar todos</button></div></div>`,
  });
};
A['perm.later'] = () => { try { localStorage.setItem('uco:permisos', 'pospuesto'); } catch { } closeSheet(); };
A['perm.storage'] = async () => { const ok = await navigator.storage.persist(); toast(ok ? 'Almacenamiento persistente concedido' : 'El navegador no lo ha concedido todavía (se concede al instalar la aplicación o usarla con frecuencia)', ok ? 'ok' : 'info', 6000); PERMS.loaded = false; G.render(); };
A['perm.geo'] = () => new Promise(res => navigator.geolocation.getCurrentPosition(() => { toast('Ubicación permitida', 'ok'); PERMS.loaded = false; G.render(); res(); }, e => { toast('Ubicación: ' + (e.code === 1 ? 'permiso denegado' : e.message), 'error'); PERMS.loaded = false; G.render(); res(); }, { timeout: 15000 }));
A['perm.notif'] = async () => { const r = await Notification.requestPermission(); toast('Notificaciones: ' + (ST[r] || [r])[0], r === 'granted' ? 'ok' : 'info'); PERMS.loaded = false; G.render(); };
A['perm.wake'] = async () => {
  G.wakeWanted = true;
  try { await acquireWake(); toast('La pantalla permanecerá encendida', 'ok'); }
  catch (e) { toast('No se pudo activar: ' + e.message, 'error'); }
  PERMS.loaded = false; G.render();
};
A['perm.install'] = async () => { const p = G.installPrompt; if (!p) return; p.prompt(); const r = await p.userChoice; G.installPrompt = null; toast(r.outcome === 'accepted' ? 'Aplicación instalada' : 'Instalación cancelada'); PERMS.loaded = false; G.render(); };
A['perm.vibrate'] = () => { navigator.vibrate([200, 100, 200]); };
A['perm.notifTest'] = async () => {
  const ok = await systemNotify('Prueba de aviso', { body: 'Así se avisará del fin de los descansos.', tag: 'uco-prueba' });
  toast(ok ? 'Aviso de prueba enviado: debe aparecer en la barra de notificaciones' : 'No se pudo mostrar el aviso en este dispositivo', ok ? 'ok' : 'error', 6000);
};
/** Pantalla encendida: el sistema la libera al salir de la aplicación; se recupera al volver */
async function acquireWake() {
  if (G.wakeLock && !G.wakeLock.released) return G.wakeLock;
  const l = await navigator.wakeLock.request('screen');
  l.addEventListener('release', () => { if (G.wakeLock === l) G.wakeLock = null; });
  return (G.wakeLock = l);
}
document.addEventListener('visibilitychange', async () => { if (!document.hidden && G.wakeWanted && 'wakeLock' in navigator) { try { await acquireWake(); } catch { } } });

// ---------- cuenta ----------
export function renderAccount() {
  const c = core(); const u = c.user;
  if (c.centralMeta && c._credPend === undefined) c.repo.db.get('users', u.id).then(r => { c._credPend = !(r && r.cred && r.cred.central); G.render(); });
  return `<section class="card pad"><h2>${esc(u.nombre)}</h2><p class="muted">${esc(u.usuario)} · rol ${esc(u.rolNombre)}</p>
    <p class="small">Permisos: ${PERMISOS.filter(p => u.perms.has(p[0])).map(p => esc(p[1])).join(' · ')}</p>
    ${c.centralMeta ? (c._credPend ? `<p class="note warn">${icon('info')} Tu cuenta aún no está disponible en otros dispositivos. Si tu contraseña tiene menos de 8 caracteres, cámbiala aquí; si no, se publicará sola la próxima vez que inicies sesión con conexión.</p>` : `<p class="note">${icon('ok')} Tu usuario y contraseña sirven en cualquier dispositivo conectado al servidor central.</p>`) : ''}</section>
  <section class="card pad"><h2>Cambiar contraseña</h2><form data-f="acc.pw">${fieldsHtml([
    { name: 'old', label: 'Contraseña actual', type: 'password', required: true, autocomplete: 'current-password' },
    { name: 'p1', label: 'Nueva contraseña (mínimo ' + c.minPassword() + ' caracteres)', type: 'password', required: true, autocomplete: 'new-password' },
    { name: 'p2', label: 'Repite la nueva contraseña', type: 'password', required: true, autocomplete: 'new-password' },
  ])}<div class="row end"><button class="btn primary">Cambiar</button></div></form></section>
  <div class="actions">${btn('Bloquear pantalla', 'session.lock', { ic: 'candado' })}${btn('Cerrar sesión', 'session.logout', { ic: 'salir' })}</div>`;
}
F['acc.pw'] = async form => { const v = readForm(form); if (v.p1 !== v.p2) { toast('Las contraseñas no coinciden', 'error'); return; } await core().changeOwnPassword(v.old, v.p1); form.reset(); core()._credPend = undefined; toast('Contraseña cambiada' + (core().centralMeta ? ': vale ya en todos los dispositivos conectados' : ''), 'ok'); G.render(); };

export function renderAbout() {
  const c = core();
  const act = estadoApp().activa;
  return `<section class="card pad"><h2>${APP_NAME}</h2><p>Versión ${APP_VERSION}${act && act.build ? ' (compilación ' + esc(act.build) + ')' : ''} · dispositivo ${esc(c.device.nombre)} (${esc(c.device.code)}) · <code>${esc(c.device.id)}</code></p>
    <p>Almacenamiento: ${G.storageKind === 'indexeddb' ? 'IndexedDB cifrado (AES-256-GCM)' : 'memoria (vista previa, no persistente)'} · ${navigator.serviceWorker && navigator.serviceWorker.controller ? 'funcionamiento sin conexión activo' : 'sin conexión no activado todavía (se activa al recargar la aplicación alojada)'}</p></section>
  <section class="card pad"><h2>Servicios externos y costes</h2><ul class="plain">
    <li><b>Google Maps</b> (mapa incrustado y enlaces, sin clave de API): gratuito. Solo se usa al consultar el mapa real y requiere Internet.</li>
    <li><b>OpenStreetMap Nominatim</b> (búsqueda de coordenadas): gratuito, uso limitado a 1 consulta por segundo.</li>
    <li><b>Servidor de sincronización propio</b> (incluido, sin dependencias): gratuito; solo hay coste si se aloja en un servidor de pago.</li>
    <li>No se usa ningún otro servicio ni se envían datos a terceros. Los datos sincronizados viajan cifrados de extremo a extremo.</li></ul></section>`;
}
