// Operativa: centro de control, unidades, avisos, descansos, ubicaciones y mapa real.
import { G, A, F, CH, filt } from '../state.js';
import { esc, attr, openSheet, closeSheet, refreshSheets, toast, confirmDlg, fieldsHtml, readForm, chip, empty, btn, tabs, copyText, $, toLocalInput } from '../dom.js';
import { icon, unitSvg } from '../icons.js';
import { now, fmtTime, fmtDateTime, fmtDur, norm, clone, contrastText } from '../../core/util.js';
import { claveDef, baseClave, isResting, restEnd, unitSituation, SITUACION_LABEL, counts, liveUnits, unitLabel, avisoLabel, activeParts } from '../../core/engine.js';
import { unitVisual, effectiveVis, overriddenVis, tipoDe } from '../../core/visual.js';
import * as C from '../../core/commands.js';
import { suggestUnits } from '../../core/suggest.js';
import { avisoTimes, TIEMPOS_AVISO } from '../../core/stats.js';
import { avisoHistory, AVISO_ESTADO } from '../../core/timeline.js';
import { hasCoords, fmtCoords, googleMapsUrl, googleEmbedUrl, embedUrl, osmUrl, nominatimUrl, parseCoords, round6, fmtKm } from '../../core/geo.js';
import { ICONOS, FORMAS, TAMANOS, BORDES, ETIQUETAS, TARJETAS, CAMPOS_TARJETA, KPIS } from '../../core/defaults.js';

const core = () => G.core;
const S = () => G.core.state;
const P = () => G.core.state.prev;
const can = p => G.core.can(p);
const named = (list, id) => ((list || []).find(x => x.id === id) || {}).nombre || '';
const exec = (fn, ...a) => G.core.exec(fn, ...a);
const editable = () => P().estado !== 'cerrado' && !P().archivado;
const activo = () => P().estado === 'activo' && !P().archivado;

// ======================= piezas =======================
export function claveChip(code, motivo) {
  const d = claveDef(P(), code);
  return `<span class="chip clave" style="--c:${attr(d ? d.color : '#777')};--t:${contrastText(d ? d.color : '#777')}">${esc(code)}${d ? ' ' + esc(d.nombre) : ''}${motivo ? ' · ' + esc(motivo) : ''}</span>`;
}
function estadoChip(e) { return `<span class="chip est-${e}">${esc(AVISO_ESTADO[e])}</span>`; }
export function avisoNum(a) { return a.num != null ? 'Nº ' + a.num : (a.ref ? a.ref : '—'); }
function sitChip(s, u, t) { const k = unitSituation(s, u, t); return `<span class="chip sit-${k}">${esc(SITUACION_LABEL[k])}</span>`; }

export function unitCard(u, { compact = false, extra = '' } = {}) {
  const s = S(); const p = P(); const t = now();
  const v = unitVisual(p, u, t); const vis = effectiveVis(p, u);
  const campos = (u.vis && u.vis.campos && u.vis.campos.length ? u.vis.campos : p.cfg.camposTarjeta) || [];
  const det = !compact && vis.tarjeta === 'detallada';
  const a = u.aviso ? s.avisos[u.aviso] : null;
  const lines = [];
  if (campos.includes('nombre') && u.nombre) lines.push(esc(u.nombre));
  if (campos.includes('denominacion') && u.denom) lines.push(esc(u.denom));
  if (campos.includes('tipo') && u.tipo) lines.push(esc(named(p.cat.tiposRecurso, u.tipo)) + (u.subtipo ? ' · ' + esc(u.subtipo) : ''));
  if (campos.includes('sector') && u.sector) lines.push(icon('mapa') + esc(named(p.cat.sectores, u.sector)));
  if (campos.includes('aviso') && a) lines.push(icon('avisos') + 'Aviso ' + esc(avisoNum(a)) + (a.desc ? ' · ' + esc(a.desc) : ''));
  if (campos.includes('ubicacion') && u.loc && (u.loc.txt || hasCoords(u.loc))) lines.push(icon('pin') + esc(u.loc.txt || fmtCoords(u.loc)));
  if (campos.includes('descanso') && v.resting) lines.push(`${icon('cafe')}Descanso · quedan <b data-cd="${u.descanso.finPrev}"></b>`);
  if (det && campos.includes('equipamiento') && u.equip.length) lines.push(esc(u.equip.join(', ')));
  if (det && campos.includes('observaciones') && u.obs) lines.push(esc(u.obs));
  return `<button type="button" class="ucard${compact ? ' compact' : ''}${v.resting ? ' resting' : ''}${u.sit !== 'activa' ? ' off' : ''}" data-a="u.open" data-id="${u.id}" style="--bc:${attr(u.colorC0)}">
    <span class="ucard-sym">${unitSvg(v, { px: compact ? 34 : 42, title: unitLabel(u) })}</span>
    <span class="ucard-main"><span class="ucard-top"><b class="uind">${esc(u.ind)}</b>${campos.includes('clave') || compact ? claveChip(u.clave, u.motivoEsp) : ''}</span>
      ${compact ? '' : lines.map(l => `<span class="ucard-line">${l}</span>`).join('')}</span>${extra}
  </button>`;
}

export function avisoCard(a) {
  const s = S(); const p = P();
  const ta = (p.cat.tiposAviso || []).find(x => x.id === a.tipo);
  const units = [...new Set(activeParts(a).map(x => x.u))].map(id => s.units[id]).filter(Boolean);
  return `<button type="button" class="acard est-${a.estado}" data-a="a.open" data-id="${a.id}" style="--tc:${attr(ta ? ta.color : '#546E7A')}">
    <span class="anum${a.num == null ? ' prov' : ''}">${esc(avisoNum(a))}</span>
    <span class="acard-main">
      <span class="row gap-s wrap">${ta ? chip(ta.nombre, ta.color) : ''}${estadoChip(a.estado)}<span class="muted small">${fmtTime(a.t ?? a.creado)}${a.estado !== 'finalizado' ? ' · hace <span data-since="' + (a.t ?? a.creado) + '"></span>' : ''}</span></span>
      ${a.desc ? `<span class="adesc">${esc(a.desc)}</span>` : ''}
      ${a.loc && a.loc.txt ? `<span class="muted small">${icon('pin')}${esc(a.loc.txt)}</span>` : ''}
      ${units.length ? `<span class="row gap-s wrap">${units.map(u => `<span class="uchip" style="--bc:${attr(u.colorC0)}">${esc(u.ind)} ${claveChip(u.clave)}</span>`).join('')}</span>` : ''}
    </span></button>`;
}

// ======================= centro de control =======================
export function renderPanel() {
  const s = S(); const p = P(); const t = now(); const c = counts(s, t);
  const kpis = (p.cfg.kpis || Object.keys(KPIS)).filter(k => k !== 'sectores');
  const KV = { total: [c.total, 'todas'], disponibles: [c.disponibles, 'disponible'], ocupadas: [c.ocupadas, 'ocupada'], descanso: [c.descanso, 'descanso'], especial: [c.especial, 'especial'], fuera: [c.fuera, 'fuera'], pendientes: [c.pendientes, 'a:pendiente'], activos: [c.activos, 'a:activos'], finalizados: [c.finalizados, 'a:finalizados'] };
  const alerts = panelAlerts(s, t, c);
  const activos = Object.values(s.avisos).filter(a => a.estado !== 'finalizado').sort((x, y) => (x.estado === 'pendiente' ? 0 : 1) - (y.estado === 'pendiente' ? 0 : 1) || (x.t ?? x.creado) - (y.t ?? y.creado));
  const units = sortUnits(liveUnits(s)).filter(u => u.sit === 'activa');
  const sectores = (p.cfg.kpis || []).includes('sectores') ? sectorTable(s, c) : '';
  return `
  ${p.estado === 'preparacion' ? `<div class="banner warn">${icon('info')}<div><b>Preventivo en preparación.</b> Revisa unidades, plano y configuración; después actívalo para operar.</div>${can('preventivos.editar') ? btn('Activar', 'prev.activate', { cls: 'primary' }) : ''}</div>` : ''}
  ${p.estado === 'cerrado' ? `<div class="banner">${icon('candado')}<div><b>Preventivo cerrado.</b> Solo consulta. ${p.cerradoEn ? 'Cerrado el ' + fmtDateTime(p.cerradoEn) + '.' : ''}</div></div>` : ''}
  <div class="panel-grid">
    <section class="pcol kpis-col">
      <div class="kpis">${kpis.map(k => `<button class="kpi k-${k}" data-a="kpi.go" data-v="${KV[k][1]}"><b>${KV[k][0]}</b><span>${esc(KPIS[k])}</span></button>`).join('')}</div>
      ${alerts.length ? `<div class="alerts">${alerts.join('')}</div>` : ''}
      ${activo() ? `<div class="quick">
        ${can('avisos.crear') ? btn('Nuevo aviso', 'a.new', { cls: 'primary', ic: 'mas_add' }) : ''}
        ${can('unidades.crear') ? btn('Nueva unidad', 'u.new', { ic: 'unidades' }) : ''}
        ${btn('Plano', 'nav', { ic: 'plano', data: { v: 'plano' } })}
      </div>` : ''}
      ${sectores}
    </section>
    <section class="pcol">
      <div class="col-head"><h2>Avisos activos <b class="count">${activos.length}</b></h2>${btn('Ver todos', 'nav', { cls: 'ghost sm', data: { v: 'avisos' } })}</div>
      <div class="alist">${activos.map(avisoCard).join('') || empty('No hay avisos activos')}</div>
    </section>
    <section class="pcol">
      <div class="col-head"><h2>Unidades <b class="count">${units.length}</b></h2>${btn('Ver todas', 'nav', { cls: 'ghost sm', data: { v: 'unidades' } })}</div>
      <div class="ugrid compact">${units.map(u => unitCard(u, { compact: true })).join('') || empty('Sin unidades. Añade unidades para empezar.', can('unidades.crear') && editable() ? btn('Nueva unidad', 'u.new', { cls: 'primary' }) : '')}</div>
    </section>
  </div>`;
}
function sectorTable(s, c) {
  const p = P(); const rows = (p.cat.sectores || []).map(sec => ({ sec, d: c.porSector[sec.id] || { total: 0, disponibles: 0 } }));
  const sin = c.porSector._;
  return `<div class="card pad-s"><h3>Recursos por sector</h3><table class="tbl"><thead><tr><th>Sector</th><th class="num">Disponibles</th><th class="num">Total</th></tr></thead><tbody>
    ${rows.map(r => `<tr><td><span class="swatch" style="background:${attr(r.sec.color)}"></span>${esc(r.sec.nombre)}</td><td class="num">${r.d.disponibles}</td><td class="num">${r.d.total}</td></tr>`).join('')}
    ${sin ? `<tr><td class="muted">Sin sector</td><td class="num">${sin.disponibles}</td><td class="num">${sin.total}</td></tr>` : ''}</tbody></table></div>`;
}
function panelAlerts(s, t, c) {
  const out = []; const core0 = core();
  const conf = core0.engine().pendingConflicts().length;
  if (conf) out.push(`<button class="alert bad" data-a="nav" data-v="sync">${icon('alerta')}<span>${conf} conflicto(s) de sincronización por resolver</span></button>`);
  if (core0.isShared()) { const st = core0.sync.status(core0.cur); if (st.estado === 'error') out.push(`<button class="alert bad" data-a="nav" data-v="sync">${icon('alerta')}<span>Error de sincronización: ${esc(st.error || '')}</span></button>`); }
  if (activo() && c.total && !c.disponibles) out.push(`<div class="alert warn">${icon('alerta')}<span>No hay unidades disponibles</span></div>`);
  const pend = Object.values(s.avisos).filter(a => a.estado === 'pendiente' && t - (a.t ?? a.creado) > 5 * 60000);
  if (pend.length) out.push(`<button class="alert warn" data-a="kpi.go" data-v="a:pendiente">${icon('avisos')}<span>${pend.length} aviso(s) pendientes de asignar desde hace más de 5 min</span></button>`);
  const fin = liveUnits(s).filter(u => isResting(u, t) && u.descanso.finPrev - t < 5 * 60000);
  if (fin.length) out.push(`<div class="alert info">${icon('cafe')}<span>Descanso terminando: ${fin.map(u => esc(u.ind) + ' (<b data-cd="' + u.descanso.finPrev + '"></b>)').join(', ')}</span></div>`);
  return out;
}
A['kpi.go'] = el => {
  const v = el.dataset.v;
  if (v.startsWith('a:')) { const f = filt('avisos'); f.tab = v === 'a:finalizados' ? 'fin' : 'act'; f.estado = v === 'a:pendiente' ? 'pendiente' : ''; G.go('avisos'); }
  else { filt('unidades').sit = v; G.go('unidades'); }
};
A['prev.activate'] = async () => {
  if (!(await confirmDlg({ title: 'Activar preventivo', text: 'A partir de ahora se registrará la actividad operativa (avisos, claves y descansos).', ok: 'Activar' }))) return;
  await exec(C.prevActivar); toast('Preventivo activo', 'ok');
};

// ======================= unidades =======================
const SIT_TABS = [['todas', 'Todas'], ['disponible', 'Disponibles'], ['ocupada', 'Ocupadas'], ['descanso', 'Descanso'], ['especial', 'Especial'], ['fuera', 'Fuera de servicio'], ['archivada', 'Archivadas']];
function sortUnits(list) { return [...list].sort((a, b) => (a.ind || '').localeCompare(b.ind || '', 'es', { numeric: true })); }
export function renderUnits() {
  const s = S(); const p = P(); const t = now(); const f = filt('unidades');
  const sit = f.sit || 'todas';
  const all = Object.values(s.units).filter(u => !u.eliminada);
  const countOf = k => all.filter(u => (k === 'todas' ? u.sit !== 'archivada' : k === 'archivada' ? u.sit === 'archivada' : u.sit !== 'archivada' && unitSituation(s, u, t) === k)).length;
  let list = all.filter(u => (sit === 'todas' ? u.sit !== 'archivada' : sit === 'archivada' ? u.sit === 'archivada' : u.sit !== 'archivada' && unitSituation(s, u, t) === sit));
  if (f.sector) list = list.filter(u => u.sector === f.sector);
  if (f.tipo) list = list.filter(u => u.tipo === f.tipo);
  if (f.q) { const q = norm(f.q); list = list.filter(u => norm([u.ind, u.nombre, u.denom, named(p.cat.tiposRecurso, u.tipo), u.loc && u.loc.txt].join(' ')).includes(q)); }
  return `
  <div class="toolbar">
    <div class="search">${icon('buscar')}<input id="q_units" type="search" placeholder="Buscar unidad" value="${attr(f.q || '')}" data-c="units.q" data-live="1" aria-label="Buscar unidad"></div>
    <select data-c="units.sector" aria-label="Sector"><option value="">Todos los sectores</option>${(p.cat.sectores || []).map(x => `<option value="${x.id}"${f.sector === x.id ? ' selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select>
    <select data-c="units.tipo" aria-label="Tipo"><option value="">Todos los tipos</option>${(p.cat.tiposRecurso || []).map(x => `<option value="${x.id}"${f.tipo === x.id ? ' selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select>
    ${can('unidades.crear') && editable() ? btn('Nueva unidad', 'u.new', { cls: 'primary fab-dup', ic: 'mas_add' }) : ''}
  </div>
  ${tabs(SIT_TABS.map(([k, l]) => [k, l, countOf(k)]), sit, 'units.sit')}
  <div class="ugrid">${sortUnits(list).map(u => unitCard(u)).join('') || empty('No hay unidades con este filtro')}</div>
  ${can('unidades.crear') && editable() ? `<button class="fab" data-a="u.new" aria-label="Nueva unidad">${icon('mas_add')}</button>` : ''}`;
}
CH['units.q'] = el => { filt('unidades').q = el.value; G.render(); };
CH['units.sector'] = el => { filt('unidades').sector = el.value; G.render(); };
CH['units.tipo'] = el => { filt('unidades').tipo = el.value; G.render(); };
A['units.sit'] = el => { filt('unidades').sit = el.dataset.v; G.render(); };

// ---------- ficha de la unidad ----------
A['u.open'] = el => openUnit(el.dataset.id);
export function openUnit(id) {
  openSheet({ title: () => { const u = S().units[id]; return u ? esc(u.ind) + (u.nombre ? ' · ' + esc(u.nombre) : '') : 'Unidad'; }, size: 'm', live: true, render: () => unitSheet(id) });
}
function unitSheet(id) {
  const s = S(); const p = P(); const u = s.units[id]; const t = now();
  if (!u) return empty('La unidad ya no existe');
  const v = unitVisual(p, u, t); const def = claveDef(p, u.clave); const base = baseClave(p);
  const a = u.aviso ? s.avisos[u.aviso] : null;
  const allowed = C.allowedTransitions(s, u);
  const main = p.cat.claves.filter(c => !c.especial && c.codigo !== u.clave);
  const spec = p.cat.claves.filter(c => c.especial && c.codigo !== u.clave);
  const canState = can('estados.cambiar') && activo() && u.sit === 'activa';
  const kbtn = c => {
    const ok = allowed.includes(c.codigo); const needAv = c.requiereAviso && !u.aviso;
    const dis = !canState || needAv || (isResting(u, t) && c.requiereAviso) || (!ok && !can('estados.forzar'));
    return `<button class="kbtn${ok ? '' : ' forced'}" style="--c:${attr(c.color)};--t:${contrastText(c.color)}" data-a="u.clave" data-id="${u.id}" data-k="${attr(c.codigo)}"${dis ? ' disabled' : ''} title="${attr(c.descripcion || '')}${needAv ? ' (requiere aviso)' : ''}${!ok ? ' (transición no habitual)' : ''}"><b>${esc(c.codigo)}</b><span>${esc(c.nombre)}</span></button>`;
  };
  const rest = u.descanso;
  return `
  <div class="uhead">
    <div class="usym-big">${unitSvg(v, { px: 64, title: unitLabel(u) })}</div>
    <div class="grow">
      <div class="row gap-s wrap">${claveChip(u.clave, u.motivoEsp)} ${sitChip(s, u, t)}</div>
      <p class="muted small">${esc(named(p.cat.tiposRecurso, u.tipo) || 'Sin tipo')}${u.subtipo ? ' · ' + esc(u.subtipo) : ''}${u.sector ? ' · ' + esc(named(p.cat.sectores, u.sector)) : ''} · en ${esc(u.clave)} desde ${fmtTime(u.claveDesde)} (<span data-since="${u.claveDesde}"></span>)</p>
      ${v.resting ? `<p class="rest-box">${icon('cafe')} En descanso desde las ${fmtTime(rest.ini)} (${rest.dur} min) · fin previsto ${fmtTime(rest.finPrev)} · quedan <b data-cd="${rest.finPrev}"></b></p>` : ''}
      ${a ? `<button class="link" data-a="a.open" data-id="${a.id}">${icon('avisos')} Aviso ${esc(avisoNum(a))}${a.desc ? ' · ' + esc(a.desc) : ''}</button>` : ''}
    </div>
  </div>
  ${u.sit === 'activa' ? `<h3>Cambiar clave</h3>
  ${!activo() ? `<p class="muted small">Disponible con el preventivo activo.</p>` : ''}
  <div class="kgrid">${main.filter(c => allowed.includes(c.codigo) || can('estados.forzar')).map(kbtn).join('')}</div>
  ${spec.length ? `<h4>Claves especiales</h4><div class="kgrid">${spec.map(kbtn).join('')}</div>` : ''}` : `<p class="note">${icon('info')} Unidad ${u.sit === 'archivada' ? 'archivada' : 'desactivada (fuera de servicio)'}.</p>`}
  <h3>Acciones</h3>
  <div class="actions">
    ${activo() && can('avisos.asignar') && u.sit === 'activa' ? (a ? btn('Liberar del aviso', 'u.release', { ic: 'cerrar', data: { id: u.id } }) : btn('Asignar a aviso', 'u.assign', { ic: 'avisos', data: { id: u.id } })) : ''}
    ${activo() && can('avisos.crear') && can('avisos.asignar') && !a && u.sit === 'activa' ? btn('Nuevo aviso con esta unidad', 'a.new', { ic: 'mas_add', data: { unit: u.id } }) : ''}
    ${activo() && can('descansos.gestionar') && u.sit === 'activa' ? (v.resting ? btn('Finalizar descanso', 'u.restEnd', { ic: 'stop', data: { id: u.id } }) : btn('Iniciar descanso', 'u.rest', { ic: 'cafe', data: { id: u.id }, disabled: !!u.aviso, title: u.aviso ? 'No se puede descansar con un aviso activo' : '' })) : ''}
    ${editable() && can('ubicaciones.editar') ? btn('Ubicación', 'u.loc', { ic: 'pin', data: { id: u.id } }) : ''}
    ${editable() && can('unidades.colores') ? btn('Color ' + base.codigo, 'u.color', { ic: 'editar', data: { id: u.id }, disabled: u.clave !== base.codigo, title: u.clave !== base.codigo ? 'Solo se puede cambiar en ' + base.codigo : '' }) : ''}
    ${editable() && can('notas.crear') ? btn('Observación', 'u.note', { ic: 'nota', data: { id: u.id } }) : ''}
    ${btn('Cronología', 'u.chrono', { ic: 'reloj', data: { id: u.id } })}
    ${p.plano ? btn('Ver en plano', 'u.inplan', { ic: 'plano', data: { id: u.id } }) : ''}
    ${editable() && can('unidades.editar') ? btn('Editar ficha', 'u.edit', { ic: 'editar', data: { id: u.id } }) : ''}
  </div>
  ${editable() && u.clave !== base.codigo && can('unidades.colores') ? `<p class="muted small">${icon('info')} El color ${base.codigo} se puede modificar solo cuando la unidad está en ${base.codigo}. El borde conserva siempre ese color.</p>` : ''}
  <h3>Ficha</h3>
  <dl class="dl">
    ${dd('Identificador', u.ind)}${dd('Nombre', u.nombre)}${dd('Denominación', u.denom)}${dd('Categoría', u.categoria)}
    ${dd('Ubicación', u.loc ? [u.loc.txt, fmtCoords(u.loc)].filter(Boolean).join(' · ') + ' (' + fmtTime(u.loc.t) + ')' : '')}
    ${dd('Equipamiento', u.equip.join(', '))}${dd('Características', u.caract.join(', '))}${dd('Descripción', u.desc)}${dd('Observaciones', u.obs)}
    ${dd('Color ' + base.codigo, `<span class="swatch" style="background:${attr(u.colorC0)}"></span>${esc(u.colorC0)}`, true)}
  </dl>
  ${u.hn.length ? `<h3>Observaciones e incidencias</h3><ul class="tl">${u.hn.slice().reverse().map(n => `<li><time>${fmtDateTime(n.t)}</time><span>${n.tipo === 'incidencia' ? '<b>Incidencia:</b> ' : ''}${esc(n.txt)} <i class="muted">${esc(n.por || '')}</i></span></li>`).join('')}</ul>` : ''}
  ${editable() ? `<h3>Gestión</h3><div class="actions">
    ${can('unidades.editar') && u.sit !== 'archivada' ? btn(u.sit === 'activa' ? 'Desactivar (fuera de servicio)' : 'Reactivar', 'u.sit', { data: { id: u.id, v: u.sit === 'activa' ? 'desactivada' : 'activa' } }) : ''}
    ${can('unidades.archivar') ? (u.sit === 'archivada' ? btn('Recuperar', 'u.sit', { ic: 'subir', data: { id: u.id, v: 'activa' } }) : btn(C.hasActivity(u) ? 'Archivar' : 'Eliminar', C.hasActivity(u) ? 'u.archive' : 'u.delete', { cls: 'danger-ghost', ic: C.hasActivity(u) ? 'archivar' : 'papelera', data: { id: u.id } })) : ''}
  </div>` : ''}`;
}
function dd(k, v, raw = false) { return v ? `<dt>${esc(k)}</dt><dd>${raw ? v : esc(v)}</dd>` : ''; }

A['u.clave'] = async el => {
  const id = el.dataset.id, k = el.dataset.k; const s = S(); const u = s.units[id]; const p = P();
  const def = claveDef(p, k);
  const allowed = C.allowedTransitions(s, u).includes(k);
  let motivo = null;
  if (!allowed && !(await confirmDlg({ title: 'Transición no habitual', text: u.clave + ' → ' + k + ' no está entre las transiciones permitidas. Se registrará como cambio forzado.', ok: 'Forzar cambio', danger: true }))) return;
  if (def.requiereMotivo) {
    const r = await confirmDlg({ title: k + ' · ' + def.nombre, text: 'Indica el motivo', ok: 'Aplicar', fields: [
      { name: 'm', label: 'Motivo', type: 'select', options: (p.cat.motivosEsp || []).map(m => [m, m]), required: true },
      { name: 'otro', label: 'Detalle (opcional, obligatorio si es "Otro")' }] });
    if (!r) return;
    motivo = /^otro/i.test(r.m) ? (r.otro || '').trim() : r.m + (r.otro ? ' · ' + r.otro : '');
    if (!motivo) { toast('Indica el detalle del motivo', 'error'); return; }
  }
  if (def.liberaAviso && u.aviso) {
    const a = s.avisos[u.aviso];
    if (!(await confirmDlg({ title: 'Liberar del aviso', text: unitLabel(u) + ' pasará a ' + k + ' y quedará liberada del aviso ' + avisoNum(a) + '.', ok: 'Continuar' }))) return;
  }
  await exec(C.unitClave, id, k, { motivo, forzar: !allowed });
};
A['u.release'] = async el => {
  const u = S().units[el.dataset.id]; const a = S().avisos[u.aviso];
  const m = await confirmDlg({ title: 'Liberar ' + unitLabel(u), text: 'La unidad dejará el aviso ' + avisoNum(a) + ' y volverá a ' + baseClave(P()).codigo + '.', input: { label: 'Motivo', value: 'Liberada por el operador' }, ok: 'Liberar' });
  if (m == null) return;
  await exec(C.avisoLiberar, a.id, u.id, m);
};
A['u.assign'] = el => {
  const u = S().units[el.dataset.id];
  const avs = Object.values(S().avisos).filter(a => a.estado !== 'finalizado').sort((x, y) => (y.t ?? y.creado) - (x.t ?? x.creado));
  openSheet({
    title: 'Asignar ' + unitLabel(u) + ' a un aviso', size: 'm',
    render: () => (avs.length ? `<div class="alist">${avs.map(a => `<div class="pick-row">${avisoCard(a)}<button class="btn primary" data-a="assign.do" data-a2="${a.id}" data-u="${u.id}">Asignar</button></div>`).join('')}</div>` : empty('No hay avisos activos')) +
      (can('avisos.crear') ? `<div class="row end">${btn('Nuevo aviso con esta unidad', 'a.new', { ic: 'mas_add', data: { unit: u.id } })}</div>` : ''),
  });
};
A['assign.do'] = async el => { const ok = await assignFlow(el.dataset.a2, el.dataset.u); if (ok && el.closest('.sheet-wrap') && !el.closest('[data-keep]')) closeSheet(); };

/** Asignación con resolución guiada de las restricciones (descanso, clave, compatibilidad, ocupada) */
export async function assignFlow(avisoId, unitId, opts = {}) {
  for (let i = 0; i < 5; i++) {
    try { await exec(C.avisoAsignar, avisoId, unitId, opts); toast('Unidad asignada', 'ok'); return true; }
    catch (e) {
      const u = S().units[unitId];
      if (e.code === 'descanso') {
        if (!(await confirmDlg({ title: 'Unidad en descanso', text: unitLabel(u) + ' está descansando hasta las ' + fmtTime(restEnd(u.descanso)) + '. ¿Finalizar el descanso y asignarla?', ok: 'Finalizar descanso y asignar' }))) return false;
        opts.terminarDescanso = true;
      } else if (e.code === 'no_disponible') {
        if (!(await confirmDlg({ title: 'Unidad no disponible', text: e.message + '. ¿Pasarla a ' + baseClave(P()).codigo + ' y asignarla?', ok: 'Pasar a ' + baseClave(P()).codigo + ' y asignar' }))) return false;
        opts.pasarBase = true;
      } else if (e.code === 'incompatible') {
        if (P().cfg.avisoCompatibilidadEstricta) { toast(e.message, 'error'); return false; }
        if (!(await confirmDlg({ title: 'Recurso no compatible', text: e.message + '. ¿Asignar de todos modos?', ok: 'Asignar igualmente' }))) return false;
        opts.forzarIncompatible = true;
      } else if (e.code === 'ocupada') {
        const other = S().avisos[e.extra.aviso];
        if (!(await confirmDlg({ title: 'Unidad ocupada', text: unitLabel(u) + ' está en el aviso ' + avisoNum(other) + '. ¿Liberarla de ese aviso y asignarla a este?', ok: 'Liberar y asignar', danger: true }))) return false;
        await exec(C.avisoLiberar, other.id, unitId, 'Reasignada a otro aviso');
      } else throw e;
    }
  }
  return false;
}
A['u.rest'] = async el => {
  const id = el.dataset.id; const u = S().units[id]; const def = P().cfg.descansoMin || 30;
  let dur = def;
  if (can('descansos.duracion')) {
    const r = await confirmDlg({ title: 'Descanso de ' + unitLabel(u), ok: 'Iniciar descanso', fields: [{ name: 'd', label: 'Duración (minutos)', type: 'number', min: 1, max: 600, value: def, required: true }] });
    if (!r) return; dur = Number(r.d) || def;
  } else if (!(await confirmDlg({ title: 'Descanso de ' + unitLabel(u), text: 'Duración: ' + def + ' minutos. La unidad aparecerá en gris y no podrá asignarse.', ok: 'Iniciar descanso' }))) return;
  await exec(C.unitRest, id, dur); toast('Descanso iniciado (' + dur + ' min)', 'ok');
};
A['u.restEnd'] = async el => {
  if (!(await confirmDlg({ title: 'Finalizar descanso', text: '¿Terminar el descanso ahora?', ok: 'Finalizar' }))) return;
  await exec(C.unitRestEnd, el.dataset.id);
};
A['u.color'] = el => {
  const u = S().units[el.dataset.id]; const base = baseClave(P()).codigo;
  const PAL = ['#2E7D32', '#1B5E20', '#00897B', '#1565C0', '#283593', '#6A1B9A', '#AD1457', '#C62828', '#EF6C00', '#F9A825', '#5D4037', '#455A64', '#000000', '#FFFFFF'];
  openSheet({
    title: 'Color ' + base + ' de ' + unitLabel(u), size: 's',
    render: () => `<form data-f="u.colorSave" data-id="${u.id}"><p class="muted small">Se muestra como color principal en ${base} y siempre como borde. Es propio de esta unidad.</p>
      <div class="pal">${PAL.map(c => `<button type="button" class="pal-c" style="background:${c}" data-a="pal.pick" data-v="${c}" aria-label="${c}"></button>`).join('')}</div>
      ${fieldsHtml([{ name: 'c', label: 'Color personalizado', type: 'color', value: u.colorC0 }])}
      <div class="row end gap"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">Guardar</button></div></form>`,
  });
};
A['pal.pick'] = el => { const f = el.closest('form'); f.c.value = el.dataset.v; f.querySelector('code').textContent = el.dataset.v; };
F['u.colorSave'] = async form => { await exec(C.unitColor, form.dataset.id, form.c.value); closeSheet(); toast('Color guardado', 'ok'); };
A['u.note'] = async el => {
  const r = await confirmDlg({ title: 'Añadir observación', ok: 'Guardar', fields: [{ name: 'tipo', label: 'Tipo', type: 'select', options: [['observacion', 'Observación'], ['incidencia', 'Incidencia']] }, { name: 'txt', label: 'Texto', type: 'textarea', required: true }] });
  if (!r) return;
  await exec(C.unitNota, el.dataset.id, r.txt, r.tipo);
};
A['u.sit'] = async el => {
  const v = el.dataset.v; const u = S().units[el.dataset.id];
  const txt = { desactivada: 'La unidad quedará fuera de servicio (no asignable) hasta reactivarla.', activa: 'La unidad volverá a estar operativa.', archivada: '' }[v];
  if (!(await confirmDlg({ title: { desactivada: 'Desactivar', activa: 'Reactivar', archivada: 'Archivar' }[v] + ' ' + unitLabel(u), text: txt, ok: 'Aceptar' }))) return;
  await exec(C.unitSit, u.id, v);
};
A['u.archive'] = async el => {
  const u = S().units[el.dataset.id];
  if (!(await confirmDlg({ title: 'Archivar ' + unitLabel(u), text: 'La unidad tiene actividad registrada: se archiva y se conserva todo su historial. Podrás recuperarla.', ok: 'Archivar', danger: true }))) return;
  await exec(C.unitSit, u.id, 'archivada'); closeSheet();
};
A['u.delete'] = async el => {
  const u = S().units[el.dataset.id];
  if (!(await confirmDlg({ title: 'Eliminar ' + unitLabel(u), text: 'La unidad no tiene actividad. Se eliminará de las listas (la operación queda registrada en la bitácora).', ok: 'Eliminar', danger: true }))) return;
  await exec(C.unitDelete, u.id); closeSheet();
};
A['u.chrono'] = el => { closeSheet(); filt('cronologia').unit = el.dataset.id; G.go('cronologia'); };
A['u.inplan'] = el => { closeSheet(); filt('plano').focus = el.dataset.id; G.go('plano'); };

// ---------- formulario de unidad ----------
export function unitFields(cat, u = {}, { create = false, tipoEditable = true, colorField = create } = {}) {
  const tipos = cat.tiposRecurso || [];
  const t = tipos.find(x => x.id === u.tipo);
  const inh = (k, map) => `(heredar del tipo${t && t.vis && t.vis[k] ? ': ' + (map[t.vis[k]] || t.vis[k]) : ''})`;
  return [
    '<h3>Identificación</h3>',
    { name: 'ind', label: 'Identificador (indicativo)', required: true, placeholder: 'AMB-01' },
    { name: 'nombre', label: 'Nombre' }, { name: 'denom', label: 'Denominación' },
    '<h3>Clasificación</h3>',
    { name: 'tipo', label: 'Tipo de recurso', type: 'select', options: [['', 'Sin tipo'], ...tipos.map(x => [x.id, x.nombre])], disabled: !tipoEditable, help: tipoEditable ? '' : 'Cambiar el tipo requiere permiso específico' },
    { name: 'subtipo', label: 'Subtipo', placeholder: t && t.subtipos && t.subtipos.length ? t.subtipos.join(', ') : '' },
    { name: 'categoria', label: 'Categoría', placeholder: t ? t.categoria : '' },
    { name: 'sector', label: 'Sector', type: 'select', options: [['', 'Sin sector'], ...(cat.sectores || []).map(x => [x.id, x.nombre])] },
    '<h3>Descripción</h3>',
    { name: 'desc', label: 'Descripción', type: 'textarea', rows: 2 }, { name: 'obs', label: 'Observaciones', type: 'textarea', rows: 2 },
    { name: 'equip', label: 'Equipamiento', type: 'tags' }, { name: 'caract', label: 'Características', type: 'tags', placeholder: t ? (t.caracteristicas || []).join(', ') : '' },
    '<h3>Apariencia</h3><p class="muted small">Lo que dejes en "heredar" sigue al tipo de recurso. Lo personalizado aquí nunca se sobrescribe al cambiar el tipo.</p>',
    ...(colorField ? [{ name: 'colorC0', label: 'Color C0 (vacío = color del tipo)', type: 'color', value: (t && t.color) || '#2E7D32' }] : []),
    { name: 'v_icono', label: 'Icono', type: 'select', options: [['', inh('icono', ICONOS)], ...Object.entries(ICONOS)] },
    { name: 'v_forma', label: 'Forma', type: 'select', options: [['', inh('forma', FORMAS)], ...Object.entries(FORMAS)] },
    { name: 'v_tam', label: 'Tamaño', type: 'select', options: [['', inh('tam', TAMANOS)], ...Object.entries(TAMANOS)] },
    { name: 'v_borde', label: 'Borde', type: 'select', options: [['', '(predeterminado)'], ...Object.entries(BORDES)] },
    { name: 'v_etiqueta', label: 'Etiqueta en el plano', type: 'select', options: [['', '(predeterminada: indicativo)'], ...Object.entries(ETIQUETAS)] },
    { name: 'v_tarjeta', label: 'Diseño de tarjeta', type: 'select', options: [['', '(predeterminado: compacta)'], ...Object.entries(TARJETAS)] },
    { name: 'v_enPlano', label: 'Representación en el plano', type: 'select', options: [['', '(predeterminado: visible)'], ['si', 'Visible'], ['no', 'Oculta']] },
    { name: 'v_camposOwn', label: 'Campos visibles propios (si no, los del preventivo)', type: 'checkbox' },
    { name: 'v_campos', label: 'Campos visibles en la tarjeta', type: 'checks', options: Object.entries(CAMPOS_TARJETA) },
  ];
}
export function unitValues(u) {
  const vis = u.vis || {};
  return {
    ind: u.ind, nombre: u.nombre, denom: u.denom, tipo: u.tipo || '', subtipo: u.subtipo, categoria: u.categoria, sector: u.sector || '', desc: u.desc, obs: u.obs,
    equip: u.equip || [], caract: u.caract || [], colorC0: u.colorC0, v_icono: vis.icono || '', v_forma: vis.forma || '', v_tam: vis.tam || '', v_borde: vis.borde || '',
    v_etiqueta: vis.etiqueta || '', v_tarjeta: vis.tarjeta || '', v_enPlano: vis.enPlano === true ? 'si' : vis.enPlano === false ? 'no' : '',
    v_camposOwn: !!(vis.campos && vis.campos.length), v_campos: vis.campos || (P() ? P().cfg.camposTarjeta : []) || [],
  };
}
/** Convierte los valores del formulario en datos de unidad (con vis solo personalizada) */
export function unitFromForm(v) {
  const vis = {};
  for (const k of ['icono', 'forma', 'tam', 'borde', 'etiqueta', 'tarjeta']) if (v['v_' + k]) vis[k] = v['v_' + k];
  if (v.v_enPlano) vis.enPlano = v.v_enPlano === 'si';
  if (v.v_camposOwn) vis.campos = v.v_campos;
  const out = { ind: v.ind, nombre: v.nombre || '', denom: v.denom || '', tipo: v.tipo || null, subtipo: v.subtipo || '', categoria: v.categoria || '', sector: v.sector || null, desc: v.desc || '', obs: v.obs || '', equip: v.equip || [], caract: v.caract || [], vis };
  if (v.colorC0) out.colorC0 = v.colorC0.toUpperCase();
  return out;
}
A['u.new'] = () => {
  const p = P();
  openSheet({ title: 'Nueva unidad', size: 'l', render: () => `<form data-f="u.save">${fieldsHtml(unitFields(p.cat, {}, { create: true }), { ...unitValues({ vis: {} }), colorC0: '' })}
    <div class="row end gap sticky-foot"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">Crear unidad</button></div></form>` });
};
A['u.edit'] = el => {
  const u = S().units[el.dataset.id]; const p = P();
  openSheet({ title: 'Editar ' + unitLabel(u), size: 'l', render: () => `<form data-f="u.save" data-id="${u.id}">${fieldsHtml(unitFields(p.cat, u, { tipoEditable: can('unidades.tipos') }), unitValues(u))}
    <div class="row end gap sticky-foot"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">Guardar</button></div></form>` });
};
F['u.save'] = async form => {
  const v = readForm(form); const d = unitFromForm(v);
  if (!form.dataset.id) { await exec(C.unitCreate, d); toast('Unidad creada', 'ok'); closeSheet(); return; }
  const u = S().units[form.dataset.id];
  const cambios = {};
  for (const k of ['ind', 'nombre', 'denom', 'subtipo', 'categoria', 'sector', 'desc', 'obs', 'equip', 'caract']) cambios[k] = d[k];
  if (can('unidades.tipos')) cambios.tipo = d.tipo;
  const keys = new Set([...Object.keys(u.vis || {}), ...Object.keys(d.vis)]);
  for (const k of keys) cambios['vis.' + k] = d.vis[k] ?? null;
  await exec(C.unitUpdate, u.id, cambios); toast('Cambios guardados', 'ok'); closeSheet();
};

// ======================= avisos =======================
export function renderAvisos() {
  const s = S(); const p = P(); const f = filt('avisos'); const tab = f.tab || 'act';
  const all = Object.values(s.avisos);
  const act = all.filter(a => a.estado !== 'finalizado'), fin = all.filter(a => a.estado === 'finalizado');
  let list = tab === 'act' ? act : fin;
  if (f.estado && tab === 'act') list = list.filter(a => a.estado === f.estado);
  if (f.tipo) list = list.filter(a => a.tipo === f.tipo);
  if (f.sector) list = list.filter(a => a.sector === f.sector);
  if (f.q) { const q = norm(f.q); list = list.filter(a => norm([avisoNum(a), a.ref, a.desc, a.loc && a.loc.txt, a.obs, named(p.cat.tiposAviso, a.tipo)].join(' ')).includes(q)); }
  list.sort((x, y) => tab === 'act' ? ((x.estado === 'pendiente' ? 0 : 1) - (y.estado === 'pendiente' ? 0 : 1) || (y.t ?? y.creado) - (x.t ?? x.creado)) : (y.finalizadoEn - x.finalizadoEn));
  // En preventivos grandes se muestran por tandas: miles de tarjetas a la vez ralentizan el móvil
  const lim = f.lim || 100; const total = list.length; list = list.slice(0, lim);
  return `
  <div class="toolbar">
    <div class="search">${icon('buscar')}<input id="q_av" type="search" placeholder="Buscar aviso" value="${attr(f.q || '')}" data-c="av.q" data-live="1" aria-label="Buscar aviso"></div>
    ${tab === 'act' ? `<select data-c="av.estado" aria-label="Estado"><option value="">Todos los estados</option>${['pendiente', 'asignado', 'en_curso'].map(e => `<option value="${e}"${f.estado === e ? ' selected' : ''}>${AVISO_ESTADO[e]}</option>`).join('')}</select>` : ''}
    <select data-c="av.tipo" aria-label="Tipo"><option value="">Todos los tipos</option>${(p.cat.tiposAviso || []).map(x => `<option value="${x.id}"${f.tipo === x.id ? ' selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select>
    <select data-c="av.sector" aria-label="Sector"><option value="">Todos los sectores</option>${(p.cat.sectores || []).map(x => `<option value="${x.id}"${f.sector === x.id ? ' selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select>
    ${activo() && can('avisos.crear') ? btn('Nuevo aviso', 'a.new', { cls: 'primary fab-dup', ic: 'mas_add' }) : ''}
  </div>
  ${tabs([['act', 'Activos', act.length], ['fin', 'Avisos finalizados', fin.length]], tab, 'av.tab')}
  <div class="alist">${list.map(avisoCard).join('') || empty(tab === 'act' ? 'No hay avisos activos' : 'Todavía no hay avisos finalizados')}</div>
  ${total > lim ? `<div class="row center">${btn('Mostrar más (quedan ' + (total - lim) + ')', 'av.more')}</div>` : ''}
  ${activo() && can('avisos.crear') ? `<button class="fab" data-a="a.new" aria-label="Nuevo aviso">${icon('mas_add')}</button>` : ''}`;
}
CH['av.q'] = el => { filt('avisos').q = el.value; filt('avisos').lim = 0; G.render(); };
CH['av.estado'] = el => { filt('avisos').estado = el.value; filt('avisos').lim = 0; G.render(); };
CH['av.tipo'] = el => { filt('avisos').tipo = el.value; filt('avisos').lim = 0; G.render(); };
CH['av.sector'] = el => { filt('avisos').sector = el.value; filt('avisos').lim = 0; G.render(); };
A['av.tab'] = el => { filt('avisos').tab = el.dataset.v; filt('avisos').estado = ''; filt('avisos').lim = 0; G.render(); };
A['av.more'] = () => { const f = filt('avisos'); f.lim = (f.lim || 100) + 200; G.render(); };

function avisoFields(p) {
  return [
    { name: 'tipo', label: 'Tipo de aviso', type: 'select', options: [['', 'Sin tipo'], ...(p.cat.tiposAviso || []).map(x => [x.id, x.nombre])] },
    { name: 'desc', label: 'Descripción', type: 'textarea', rows: 2, placeholder: 'Qué ocurre' },
    { name: 't', label: 'Fecha y hora del aviso', type: 'datetime' },
    `<div class="fld"><label>Ubicación</label><div class="row gap"><span class="grow loc-sum" data-locsum>—</span><button type="button" class="btn sm" data-a="a.formLoc">${icon('pin')}<span>Ubicación…</span></button></div></div>`,
    { name: 'sector', label: 'Sector', type: 'select', options: [['', 'Sin sector'], ...(p.cat.sectores || []).map(x => [x.id, x.nombre])] },
    { name: 'obs', label: 'Observaciones', type: 'textarea', rows: 2 },
  ];
}
function setFormLoc(form, loc) {
  form._loc = loc;
  const el = form.querySelector('[data-locsum]');
  if (el) el.textContent = loc ? [loc.txt, fmtCoords(loc)].filter(Boolean).join(' · ') || '—' : '—';
}
A['a.new'] = el => {
  const p = P(); const unit = el.dataset.unit ? S().units[el.dataset.unit] : null;
  if (unit) closeSheet();
  openSheet({
    title: 'Nuevo aviso' + (unit ? ' con ' + unitLabel(unit) : ''), size: 'l',
    render: () => `<form data-f="a.save" data-tdef="${toLocalInput(now())}"${unit ? ` data-unit="${unit.id}"` : ''}>${fieldsHtml(avisoFields(p), { t: now() })}
      ${unit ? `<p class="note">${icon('unidades')} Se asignará <b>${esc(unitLabel(unit))}</b> al crear el aviso.</p>` : '<p class="muted small">Tras crearlo verás las unidades sugeridas para asignar.</p>'}
      <div class="row end gap sticky-foot"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">Crear aviso</button></div></form>`,
    onMount: el2 => { const f = el2.querySelector('form'); if (unit && unit.loc) setFormLoc(f, { txt: unit.loc.txt, lat: unit.loc.lat, lon: unit.loc.lon }); if (unit && unit.sector) f.sector.value = unit.sector; },
  });
};
A['a.formLoc'] = el => { const form = el.closest('form'); openLocEditor({ title: 'Ubicación del aviso', value: form._loc, onSave: loc => setFormLoc(form, loc) }); };
F['a.save'] = async form => {
  const v = readForm(form);
  // Si no se ha cambiado la hora propuesta, se usa la hora exacta de creación (con segundos)
  const tInput = form.querySelector('[name=t]');
  const t = !form.dataset.id && tInput && tInput.value === form.dataset.tdef ? null : (v.t || null);
  const d = { tipo: v.tipo || null, desc: v.desc, t, loc: form._loc || null, sector: v.sector || null, obs: v.obs };
  if (form.dataset.id) {
    const a0 = S().avisos[form.dataset.id];
    const tOld = a0.t ?? a0.creado;
    await exec(C.avisoUpdate, form.dataset.id, { tipo: d.tipo, desc: d.desc, t: d.t != null && toLocalInput(d.t) !== toLocalInput(tOld) ? d.t : tOld, loc: d.loc, sector: d.sector, obs: d.obs });
    closeSheet(); toast('Aviso actualizado', 'ok'); return;
  }
  let ops;
  if (form.dataset.unit) {
    try { ops = await exec(C.avisoCreate, d, { unidades: [form.dataset.unit] }); }
    catch (e) {
      if (!['descanso', 'no_disponible', 'incompatible', 'ocupada'].includes(e.code)) throw e;
      ops = await exec(C.avisoCreate, d); await assignFlow(ops[0].e, form.dataset.unit);
    }
  } else ops = await exec(C.avisoCreate, d);
  closeSheet(); toast('Aviso creado', 'ok'); openAviso(ops[0].e);
};

A['a.open'] = el => openAviso(el.dataset.id);
export function openAviso(id) {
  openSheet({ title: () => { const a = S().avisos[id]; return a ? 'Aviso ' + esc(avisoNum(a)) : 'Aviso'; }, size: 'l', live: true, render: () => avisoSheet(id) });
}
function avisoSheet(id) {
  const s = S(); const p = P(); const a = s.avisos[id]; const t = now();
  if (!a) return empty('Aviso no encontrado');
  const ta = (p.cat.tiposAviso || []).find(x => x.id === a.tipo);
  const tm = avisoTimes(a);
  const parts = activeParts(a);
  const past = a.part.filter(x => x.lib != null);
  const f = filt('aviso'); const showSug = f.sug === id || (a.estado === 'pendiente' && f.sug !== '-' + id);
  const canOp = activo();
  const unitRow = pp => {
    const u = s.units[pp.u]; if (!u) return '';
    const allowed = C.allowedTransitions(s, u).map(k => claveDef(p, k)).filter(c => c && !c.especial);
    return `<div class="asg-row">
      <button class="asg-unit" data-a="u.open" data-id="${u.id}">${unitSvg(unitVisual(p, u, t), { px: 34 })}<b>${esc(u.ind)}</b>${claveChip(u.clave, u.motivoEsp)}<span class="muted small">desde ${fmtTime(pp.asig)}</span></button>
      ${canOp && can('estados.cambiar') ? `<div class="kgrid mini">${allowed.map(c => `<button class="kbtn sm" style="--c:${attr(c.color)};--t:${contrastText(c.color)}" data-a="u.clave" data-id="${u.id}" data-k="${attr(c.codigo)}" title="${attr(c.nombre)}"><b>${esc(c.codigo)}</b><span>${esc(c.nombre)}</span></button>`).join('')}</div>` : ''}
      ${canOp && can('avisos.asignar') ? `<button class="btn sm ghost" data-a="u.release" data-id="${u.id}">${icon('cerrar')}<span>Liberar</span></button>` : ''}
    </div>`;
  };
  return `
  <div class="row gap-s wrap">${ta ? chip(ta.nombre, ta.color) : ''}${estadoChip(a.estado)}${a.num == null ? `<span class="chip warn">Número provisional ${esc(a.ref || '')}</span>` : a.ref ? `<span class="chip muted">Ref. ${esc(a.ref)}</span>` : ''}</div>
  ${a.desc ? `<p class="adesc big">${esc(a.desc)}</p>` : ''}
  <dl class="dl">
    <dt>Hora del aviso</dt><dd>${fmtDateTime(a.t ?? a.creado)}${a.estado !== 'finalizado' ? ' · hace <span data-since="' + (a.t ?? a.creado) + '"></span>' : ''}</dd>
    ${a.loc && (a.loc.txt || hasCoords(a.loc)) ? `<dt>Ubicación</dt><dd>${esc([a.loc.txt, fmtCoords(a.loc)].filter(Boolean).join(' · '))} <a class="link" href="${attr(googleMapsUrl(a.loc))}" target="_blank" rel="noopener">${icon('mapa')}Google Maps</a></dd>` : ''}
    ${a.sector ? `<dt>Sector</dt><dd>${esc(named(p.cat.sectores, a.sector))}</dd>` : ''}
    ${a.obs ? `<dt>Observaciones</dt><dd>${esc(a.obs)}</dd>` : ''}
    <dt>Creado por</dt><dd>${esc(a.creadoPor)} · ${fmtDateTime(a.creado)}</dd>
    ${a.cierre ? `<dt>Cierre</dt><dd>${fmtDateTime(a.finalizadoEn)} · ${esc(a.cierre.por || '')}${a.cierre.nota ? ' · ' + esc(a.cierre.nota) : ''}${a.finAuto ? ' (automático)' : ''}</dd>` : ''}
  </dl>
  <div class="times">${Object.entries(TIEMPOS_AVISO).map(([k, [l, d]]) => `<div title="${attr(d)}"><span>${esc(l)}</span><b>${tm[k] != null ? fmtDur(tm[k]) : '—'}</b></div>`).join('')}</div>
  <h3>Unidades asignadas <b class="count">${parts.length}</b></h3>
  ${parts.map(unitRow).join('') || `<p class="muted">Ninguna unidad asignada.</p>`}
  ${past.length ? `<p class="muted small">Participaron: ${past.map(x => esc(unitLabel(s.units[x.u])) + ' (' + fmtTime(x.asig) + '–' + fmtTime(x.lib) + ')').join(', ')}</p>` : ''}
  ${canOp && can('avisos.asignar') && a.estado !== 'finalizado' ? (showSug ? suggestions(a, t) : `<button class="btn" data-a="a.sug" data-id="${a.id}">${icon('mas_add')}<span>Asignar unidad</span></button>`) : ''}
  <h3>Acciones</h3>
  <div class="actions">
    ${canOp && can('avisos.finalizar') && a.estado !== 'finalizado' ? btn('Finalizar aviso', 'a.finish', { cls: 'primary', ic: 'ok', data: { id: a.id } }) : ''}
    ${canOp && can('avisos.finalizar') && a.estado === 'finalizado' ? btn('Reabrir', 'a.reopen', { ic: 'subir', data: { id: a.id } }) : ''}
    ${canOp && can('avisos.asignar') && ['pendiente', 'asignado'].includes(a.estado) ? btn('Marcar en curso', 'a.encurso', { ic: 'play', data: { id: a.id } }) : ''}
    ${editable() && can('avisos.editar') ? btn('Editar', 'a.edit', { ic: 'editar', data: { id: a.id } }) : ''}
    ${editable() && can('notas.crear') ? btn('Nota', 'a.note', { ic: 'nota', data: { id: a.id } }) : ''}
    ${editable() && can('planos.editar') && p.plano ? btn(a.plan ? 'Mover en plano' : 'Situar en plano', 'a.inplan', { ic: 'plano', data: { id: a.id } }) : ''}
    ${a.loc && (a.loc.txt || hasCoords(a.loc)) ? `<a class="btn" href="${attr(googleMapsUrl(a.loc))}" target="_blank" rel="noopener">${icon('mapa')}<span>Abrir en Google Maps</span></a>` : ''}
  </div>
  <h3>Historial</h3>
  <ul class="tl">${avisoHistory(core().engine(), a.id).map(e => `<li><time>${fmtTime(e.t, true)}</time><span>${esc(e.texto)}</span></li>`).join('')}</ul>`;
}
function suggestions(a, t) {
  const list = suggestUnits(S(), a, t);
  const ok = list.filter(x => !x.blocked).slice(0, 8), blocked = list.filter(x => x.blocked);
  return `<div class="sug" data-keep="1"><div class="row between"><h4>Unidades sugeridas</h4><button class="btn ghost sm" data-a="a.sugHide" data-id="${a.id}">Ocultar</button></div>
    <p class="muted small">Orientativo: considera distancia, compatibilidad, sector y disponibilidad. Decide el operador.</p>
    ${ok.map(x => `<div class="sug-row">${unitSvg(unitVisual(P(), x.u, t), { px: 30 })}<b>${esc(x.u.ind)}</b><span class="muted small grow">${esc(x.reasons.join(' · '))}</span><button class="btn sm primary" data-a="assign.do" data-a2="${a.id}" data-u="${x.u.id}">Asignar</button></div>`).join('') || '<p class="muted">No hay unidades disponibles.</p>'}
    ${blocked.length ? `<details><summary>No disponibles (${blocked.length})</summary>${blocked.map(x => `<div class="sug-row off">${unitSvg(unitVisual(P(), x.u, t), { px: 26 })}<b>${esc(x.u.ind)}</b><span class="muted small grow">${esc(x.blocked)}</span><button class="btn sm ghost" data-a="assign.do" data-a2="${a.id}" data-u="${x.u.id}">Asignar…</button></div>`).join('')}</details>` : ''}
  </div>`;
}
A['a.sug'] = el => { filt('aviso').sug = el.dataset.id; refreshSheets(); };
A['a.sugHide'] = el => { filt('aviso').sug = '-' + el.dataset.id; refreshSheets(); };
A['a.finish'] = async el => {
  const a = S().avisos[el.dataset.id];
  const busy = activeParts(a).map(x => S().units[x.u]).filter(u => { const d = claveDef(P(), u.clave); return d && d.requiereAviso; });
  const r = await confirmDlg({
    title: 'Finalizar aviso ' + avisoNum(a), ok: 'Finalizar', fields: [{ name: 'nota', label: 'Resultado / nota de cierre', type: 'textarea' }],
    html: busy.length ? `<p class="note warn">${icon('alerta')} Siguen asignadas: <b>${busy.map(u => esc(u.ind) + ' (' + esc(u.clave) + ')').join(', ')}</b>. Al finalizar quedarán liberadas y pasarán a ${esc(baseClave(P()).codigo)}.</p>` : '',
  });
  if (!r) return;
  await exec(C.avisoFinalizar, a.id, { nota: r.nota, liberarUnidades: busy.length > 0 });
  toast('Aviso finalizado', 'ok');
};
A['a.reopen'] = async el => {
  const m = await confirmDlg({ title: 'Reabrir aviso', input: { label: 'Motivo de la reapertura' }, ok: 'Reabrir' });
  if (m == null) return; await exec(C.avisoReabrir, el.dataset.id, m);
};
A['a.encurso'] = async el => { await exec(C.avisoEnCurso, el.dataset.id); };
A['a.note'] = async el => { const m = await confirmDlg({ title: 'Nota en el aviso', input: { label: 'Texto', type: 'text' }, ok: 'Guardar' }); if (m == null) return; await exec(C.avisoNota, el.dataset.id, m); };
A['a.edit'] = el => {
  const a = S().avisos[el.dataset.id]; const p = P();
  openSheet({
    title: 'Editar aviso ' + avisoNum(a), size: 'l',
    render: () => `<form data-f="a.save" data-id="${a.id}">${fieldsHtml(avisoFields(p), { tipo: a.tipo || '', desc: a.desc, t: a.t ?? a.creado, sector: a.sector || '', obs: a.obs })}
    <div class="row end gap sticky-foot"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">Guardar</button></div></form>`,
    onMount: el2 => setFormLoc(el2.querySelector('form'), a.loc),
  });
};
A['a.inplan'] = el => { while (document.querySelector('.sheet-wrap')) closeSheet(); filt('plano').placeAviso = el.dataset.id; G.go('plano'); };

// ======================= ubicaciones y mapa real =======================
let LOC = null;
/** Editor de ubicación: texto, coordenadas, GPS, enlace de Google Maps y búsqueda gratuita (OpenStreetMap) */
export function openLocEditor({ title = 'Ubicación', value = null, onSave }) {
  LOC = { v: { txt: '', lat: null, lon: null, ...(value || {}) }, onSave, results: null };
  openSheet({ title, size: 'm', live: true, render: renderLoc, onClose: () => { LOC = null; } });
}
function renderLoc() {
  if (!LOC) return '';
  const v = LOC.v; const online = navigator.onLine !== false && !G.preview;
  return `<form data-f="loc.save">
    <div class="fld"><label for="f_loctxt">Dirección o descripción</label><input id="f_loctxt" name="txt" value="${attr(v.txt)}" placeholder="Puerta 3, Calle Mayor 10…" data-c="loc.txt" data-live="1"></div>
    <div class="row gap"><div class="fld grow"><label for="f_lat">Latitud</label><input id="f_lat" name="lat" inputmode="decimal" value="${attr(v.lat ?? '')}" data-c="loc.lat" data-live="1"></div>
    <div class="fld grow"><label for="f_lon">Longitud</label><input id="f_lon" name="lon" inputmode="decimal" value="${attr(v.lon ?? '')}" data-c="loc.lon" data-live="1"></div></div>
    <div class="actions">
      <button type="button" class="btn" data-a="loc.gps">${icon('gps')}<span>Mi posición (GPS)</span></button>
      <button type="button" class="btn" data-a="loc.paste">${icon('copiar')}<span>Pegar enlace de Google Maps</span></button>
      <button type="button" class="btn" data-a="loc.search"${online ? '' : ' disabled'}>${icon('buscar')}<span>Buscar coordenadas</span></button>
      ${v.txt || hasCoords(v) ? `<a class="btn" href="${attr(googleMapsUrl(v))}" target="_blank" rel="noopener">${icon('mapa')}<span>Abrir en Google Maps</span></a>` : ''}
    </div>
    ${LOC.results ? `<div class="loc-res">${LOC.results.length ? LOC.results.map((r, i) => `<button type="button" class="menu-i" data-a="loc.pick" data-i="${i}">${icon('pin')}<span>${esc(r.display_name)}</span></button>`).join('') : '<p class="muted">Sin resultados</p>'}<p class="muted small">Datos © colaboradores de OpenStreetMap</p></div>` : ''}
    ${(v.txt || hasCoords(v)) && online ? mapProvider() + `<div class="map-embed"><iframe title="Mapa" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${attr(embedUrl(v, filt('mapa').prov))}"></iframe></div>` : `<p class="muted small">${online ? 'Escribe una dirección o coordenadas para ver el mapa.' : 'Sin conexión: la ubicación manual se guarda igualmente; el mapa se verá al recuperar Internet.'}</p>`}
    <div class="row end gap sticky-foot"><button type="button" class="btn ghost" data-a="loc.clear">Quitar ubicación</button><button class="btn primary">Guardar ubicación</button></div>
  </form>`;
}
CH['loc.txt'] = el => { LOC.v.txt = el.value; };
CH['loc.lat'] = el => { LOC.v.lat = el.value === '' ? null : Number(String(el.value).replace(',', '.')); };
CH['loc.lon'] = el => { LOC.v.lon = el.value === '' ? null : Number(String(el.value).replace(',', '.')); };
A['loc.gps'] = () => new Promise(res => {
  if (!navigator.geolocation || G.preview) { toast('La geolocalización no está disponible aquí', 'error'); return res(); }
  toast('Obteniendo posición…');
  navigator.geolocation.getCurrentPosition(p => { LOC.v.lat = round6(p.coords.latitude); LOC.v.lon = round6(p.coords.longitude); if (!LOC.v.txt) LOC.v.txt = 'Posición GPS (±' + Math.round(p.coords.accuracy) + ' m)'; refreshSheets(); res(); },
    e => { toast('No se pudo obtener la posición: ' + (e.code === 1 ? 'permiso denegado' : e.message), 'error'); res(); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
});
A['loc.paste'] = async () => {
  let text = '';
  try { text = await navigator.clipboard.readText(); } catch { }
  if (!parseCoords(text)) { const r = await confirmDlg({ title: 'Enlace o coordenadas', input: { label: 'Pega el enlace de Google Maps o "lat, lon"', value: text } }); if (r == null) return; text = r; }
  const c = parseCoords(text); if (!c) { toast('No se encontraron coordenadas en el texto', 'error'); return; }
  LOC.v.lat = c.lat; LOC.v.lon = c.lon; refreshSheets();
};
A['loc.search'] = async () => {
  const q = (LOC.v.txt || '').trim(); if (!q) { toast('Escribe primero la dirección', 'error'); return; }
  try { const r = await fetch(nominatimUrl(q), { headers: { Accept: 'application/json' } }); LOC.results = r.ok ? await r.json() : []; }
  catch { toast('No se pudo consultar el buscador', 'error'); LOC.results = []; }
  refreshSheets();
};
A['loc.pick'] = el => { const r = LOC.results[Number(el.dataset.i)]; LOC.v.lat = round6(Number(r.lat)); LOC.v.lon = round6(Number(r.lon)); if (!LOC.v.txt) LOC.v.txt = r.display_name; LOC.results = null; refreshSheets(); };
A['loc.clear'] = async () => { const cb = LOC.onSave; closeSheet(); await cb(null); };
F['loc.save'] = async () => {
  const v = LOC.v; const loc = { txt: String(v.txt || '').trim(), lat: v.lat == null || isNaN(v.lat) ? null : v.lat, lon: v.lon == null || isNaN(v.lon) ? null : v.lon };
  if ((loc.lat == null) !== (loc.lon == null)) { toast('Indica latitud y longitud', 'error'); return; }
  const cb = LOC.onSave; closeSheet(); await cb(loc.txt || loc.lat != null ? loc : null);
};
A['u.loc'] = el => {
  const u = S().units[el.dataset.id];
  openLocEditor({ title: 'Ubicación de ' + unitLabel(u), value: u.loc, onSave: async loc => { const ops = await exec(C.unitLoc, u.id, loc); toast(ops.length ? 'Ubicación registrada' : 'Sin cambios', ops.length ? 'ok' : 'info'); } });
};

function mapProvider() {
  const prov = filt('mapa').prov || 'google';
  return `<div class="row gap-s wrap small"><span class="muted">Mapa:</span>
    <label class="switch sm"><input type="radio" name="mprov" value="google" data-c="map.prov"${prov === 'google' ? ' checked' : ''}><span>Google Maps</span></label>
    <label class="switch sm"><input type="radio" name="mprov" value="osm" data-c="map.prov"${prov === 'osm' ? ' checked' : ''}><span>OpenStreetMap (con coordenadas)</span></label></div>`;
}
CH['map.prov'] = el => { filt('mapa').prov = el.value; G.render(); refreshSheets(); };
export function renderMap() {
  const s = S(); const p = P(); const f = filt('mapa'); const online = navigator.onLine !== false && !G.preview;
  const items = [];
  if (p.lugar && (p.lugar.txt || hasCoords(p.lugar))) items.push({ k: 'prev', n: 'Lugar del preventivo', loc: p.lugar, cls: '' });
  for (const a of Object.values(s.avisos).filter(a => a.estado !== 'finalizado' && a.loc)) items.push({ k: a.id, n: 'Aviso ' + avisoNum(a) + (a.desc ? ' · ' + a.desc : ''), loc: a.loc, cls: 'aviso' });
  for (const u of liveUnits(s).filter(u => u.loc)) items.push({ k: u.id, n: 'Unidad ' + u.ind, loc: u.loc, cls: 'unidad' });
  const sel = items.find(i => i.k === f.sel) || items[0];
  return `<p class="muted">Ubicaciones con dirección o coordenadas. El mapa real (Google Maps) necesita Internet; el plano táctico funciona siempre sin conexión.</p>
  <div class="map-layout">
    <div class="map-list">${items.map(i => `<button class="menu-i${sel && sel.k === i.k ? ' on' : ''} ${i.cls}" data-a="map.sel" data-v="${i.k}">${icon(i.cls === 'aviso' ? 'avisos' : i.cls === 'unidad' ? 'unidades' : 'pin')}<span>${esc(i.n)}<small class="muted">${esc([i.loc.txt, fmtCoords(i.loc)].filter(Boolean).join(' · '))}</small></span></button>`).join('') || empty('No hay ubicaciones registradas todavía')}
      ${editable() && can('preventivos.editar') ? btn(p.lugar ? 'Cambiar lugar del preventivo' : 'Indicar lugar del preventivo', 'map.prevLoc', { ic: 'pin' }) : ''}</div>
    <div class="map-view">${sel ? (online ? mapProvider() + `<div class="map-embed tall"><iframe title="Mapa de ${attr(sel.n)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="${attr(embedUrl(sel.loc, filt('mapa').prov))}"></iframe></div><p class="muted small">Si el mapa de Google no se muestra, cambia a OpenStreetMap o usa «Abrir en Google Maps».</p>` : empty('Sin conexión: el mapa real no está disponible')) + `<div class="actions"><a class="btn" href="${attr(googleMapsUrl(sel.loc))}" target="_blank" rel="noopener">${icon('mapa')}<span>Abrir en Google Maps</span></a>${hasCoords(sel.loc) ? `<a class="btn" href="${attr(osmUrl(sel.loc))}" target="_blank" rel="noopener">${icon('mapa')}<span>Abrir en OpenStreetMap</span></a>` : ''}</div>` : ''}</div>
  </div>`;
}
A['map.sel'] = el => { filt('mapa').sel = el.dataset.v; G.render(); };
A['map.prevLoc'] = () => openLocEditor({ title: 'Lugar del preventivo', value: P().lugar, onSave: async loc => { await exec(C.prevUpdate, { lugar: loc }); } });
export { named, avisoNum as avisoNumber, setFormLoc };
