// Bitácora, cronologías individuales y estadísticas operativas.
import { G, A, F, CH, filt } from '../state.js';
import { esc, attr, toast, empty, btn, tabs, saveFile, fileStamp, safeName, chip } from '../dom.js';
import { icon, unitSvg } from '../icons.js';
import { now, fmtTime, fmtDateTime, fmtDur, norm } from '../../core/util.js';
import { claveDef, unitLabel, avisoLabel } from '../../core/engine.js';
import { unitVisual } from '../../core/visual.js';
import { logEntries, CATEGORIAS, unitChronology, CRONO_TIPOS, AVISO_ESTADO } from '../../core/timeline.js';
import { prevStats, unitStats, avisoStats, avisoTimes, TIEMPOS_AVISO } from '../../core/stats.js';
import { csvTables } from '../../core/exporters.js';
import { Engine } from '../../core/engine.js';
import { tipoAvisoDef, etiquetaTipoAviso } from '../../core/incidentes.js';
import { opcionesTipoAviso } from './incidente.js';

const S = () => G.core.state; const P = () => G.core.state.prev;
const can = p => G.core.can(p);
const named = (list, id) => ((list || []).find(x => x.id === id) || {}).nombre || '';

// ======================= bitácora =======================
export function renderLog() {
  const f = filt('log'); const eng = G.core.engine();
  const usuarios = [...new Set(eng.ops.map(o => o.u && o.u.n).filter(Boolean))];
  let list = logEntries(eng, { cat: f.cat || '', usuario: f.u || '', texto: f.q || '', incluirNoop: !!f.noop }).reverse();
  if (f.conf) list = list.filter(e => e.estado === 'conflict');
  const total = list.length; const lim = f.lim || 200;
  return `<p class="muted">Registro cronológico e inalterable de toda la actividad del preventivo: fecha, usuario, elemento, acción y valores anterior y nuevo.</p>
  <div class="toolbar">
    <div class="search">${icon('buscar')}<input id="q_log" type="search" placeholder="Buscar en la bitácora" aria-label="Buscar en la bitácora" value="${attr(f.q || '')}" data-c="log.q" data-live="1"></div>
    <select data-c="log.cat" aria-label="Categoría"><option value="">Todas las categorías</option>${Object.entries(CATEGORIAS).map(([k, l]) => `<option value="${k}"${f.cat === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
    <select data-c="log.u" aria-label="Usuario"><option value="">Todos los usuarios</option>${usuarios.map(u => `<option${f.u === u ? ' selected' : ''}>${esc(u)}</option>`).join('')}</select>
    <label class="switch sm"><input type="checkbox" data-c="log.conf"${f.conf ? ' checked' : ''}><span>Solo conflictos</span></label>
    <label class="switch sm"><input type="checkbox" data-c="log.noop"${f.noop ? ' checked' : ''}><span>Incluir operaciones sin efecto</span></label>
    ${can('exportar') ? btn('CSV', 'log.csv', { ic: 'descargar' }) : ''}
  </div>
  <p class="muted small">${total} registros</p>
  <div class="log">${list.slice(0, lim).map(e => `<div class="log-row cat-${e.cat}${e.estado !== 'ok' ? ' st-' + e.estado : ''}">
    <time>${fmtDateTime(e.t, true)}</time>
    <div class="grow"><div><b>${esc(e.elemento)}</b> · ${esc(e.accion)}${e.estado === 'conflict' ? ' <span class="chip bad sm">conflicto</span>' : e.estado === 'noop' ? ' <span class="chip muted sm">sin efecto</span>' : ''}</div>
      ${e.anterior || e.nuevo ? `<div class="small">${e.anterior ? `<span class="old">${esc(e.anterior)}</span> → ` : ''}<span class="new">${esc(e.nuevo)}</span></div>` : ''}
      ${e.motivoEstado ? `<div class="small bad-t">${esc(e.motivoEstado)}</div>` : ''}
      <div class="muted small">${esc(e.usuario)} · ${esc(e.dispositivo)}</div></div></div>`).join('') || empty('Sin registros con este filtro')}</div>
  ${total > lim ? `<div class="row center">${btn('Mostrar más', 'log.more')}</div>` : ''}`;
}
CH['log.q'] = el => { filt('log').q = el.value; G.render(); };
CH['log.cat'] = el => { filt('log').cat = el.value; G.render(); };
CH['log.u'] = el => { filt('log').u = el.value; G.render(); };
CH['log.conf'] = el => { filt('log').conf = el.checked; G.render(); };
CH['log.noop'] = el => { filt('log').noop = el.checked; G.render(); };
A['log.more'] = () => { const f = filt('log'); f.lim = (f.lim || 200) + 300; G.render(); };
A['log.csv'] = async () => { const T = csvTables(G.core.engine(), now()); await saveFile(safeName(P().nombre) + '-bitacora-' + fileStamp() + '.csv', T.bitacora, 'text/csv;charset=utf-8'); };

// ======================= cronología de unidad =======================
const TODAS = '__todas';
export function renderChrono() {
  const s = S(); const f = filt('cronologia'); const t = now();
  const units = Object.values(s.units).sort((a, b) => (a.ind || '').localeCompare(b.ind || '', 'es', { numeric: true }));
  if (!units.length) return empty('No hay unidades');
  // «Todas las unidades»: registro conjunto, con los acontecimientos más recientes primero
  const todas = f.unit === TODAS;
  const uid = todas ? null : f.unit && s.units[f.unit] ? f.unit : units[0].id;
  const u = uid ? s.units[uid] : null;
  const tipos = f.tipos || Object.keys(CRONO_TIPOS);
  let ev;
  if (todas) { ev = []; for (const x of units) for (const e of unitChronology(G.core.engine(), x.id, t)) ev.push({ ...e, u: x, prev: P().nombre, pid: G.core.cur }); }
  else {
    ev = unitChronology(G.core.engine(), uid, t).map(e => ({ ...e, prev: P().nombre, pid: G.core.cur }));
    if (f.otros && f.otros.ind === u.ind) ev = ev.concat(f.otros.ev);
  }
  ev = ev.filter(e => tipos.includes(e.tipo) && (!f.desde || e.t >= f.desde) && (!f.hasta || e.t <= f.hasta)).sort((a, b) => (todas ? b.t - a.t : a.t - b.t));
  const total = ev.length; const lim = f.lim || 300; if (todas) ev = ev.slice(0, lim);
  const unidadChip = x => `<button type="button" class="uchip" data-a="u.open" data-id="${x.id}" style="--bc:${attr(x.colorC0)}">${esc(x.ind)}</button> `;
  return `<div class="toolbar">
    <select data-c="cr.unit" aria-label="Unidad"><option value="${TODAS}"${todas ? ' selected' : ''}>Todas las unidades</option>${units.map(x => `<option value="${x.id}"${x.id === uid ? ' selected' : ''}>${esc(x.ind)}${x.nombre ? ' · ' + esc(x.nombre) : ''}${x.eliminada ? ' (eliminada)' : x.sit === 'archivada' ? ' (archivada)' : ''}</option>`).join('')}</select>
    <label class="fld-inline">Desde <input type="datetime-local" data-c="cr.desde" value="${f.desde ? toLocalI(f.desde) : ''}"></label>
    <label class="fld-inline">Hasta <input type="datetime-local" data-c="cr.hasta" value="${f.hasta ? toLocalI(f.hasta) : ''}"></label>
    ${todas ? '' : btn(f.otros && f.otros.ind === u.ind ? 'Solo este preventivo' : 'Incluir otros preventivos', 'cr.otros', { ic: 'capas' })}
  </div>
  <div class="chips-row">${Object.entries(CRONO_TIPOS).map(([k, l]) => `<button class="tchip${tipos.includes(k) ? ' on' : ''}" data-a="cr.tipo" data-v="${k}">${esc(l)}</button>`).join('')}</div>
  ${todas ? `<p class="muted small">Registro de las ${units.length} unidades a la vez, con lo más reciente primero (${total} acontecimientos). Toca una unidad para abrirla.</p>`
    : `<div class="row gap"><span>${unitSvg(unitVisual(P(), u, t), { px: 40 })}</span><div><b>${esc(u.ind)}</b> ${esc(u.nombre || '')}<div class="muted small">La cronología se reconstruye desde el registro: no se pierde al cambiar la configuración de la unidad.</div></div></div>`}
  <ul class="tl big" data-crono="${todas ? 'todas' : 'unidad'}">${ev.map(e => `<li class="t-${e.tipo}"><time>${fmtDateTime(e.t)}</time><span>${e.u ? unidadChip(e.u) : ''}${e.color ? `<i class="dot" style="background:${attr(e.color)}"></i>` : ''}${esc(e.texto)}${e.dur != null ? ` <b class="dur">${fmtDur(e.dur)}${e.abierta ? ' (en curso)' : ''}</b>` : ''}${e.pid !== G.core.cur ? ` <span class="chip sm muted">${esc(e.prev)}</span>` : ''}</span></li>`).join('') || '<li class="muted">Sin acontecimientos con estos filtros</li>'}</ul>
  ${todas && total > lim ? `<div class="row center">${btn('Mostrar más (quedan ' + (total - lim) + ')', 'cr.more')}</div>` : ''}`;
}
function toLocalI(ms) { const d = new Date(ms); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + 'T' + p(d.getHours()) + ':' + p(d.getMinutes()); }
CH['cr.unit'] = el => { filt('cronologia').unit = el.value; filt('cronologia').lim = 0; G.render(); };
A['cr.more'] = () => { const f = filt('cronologia'); f.lim = (f.lim || 300) + 500; G.render(); };
CH['cr.desde'] = el => { filt('cronologia').desde = el.value ? new Date(el.value).getTime() : null; G.render(); };
CH['cr.hasta'] = el => { filt('cronologia').hasta = el.value ? new Date(el.value).getTime() : null; G.render(); };
A['cr.tipo'] = el => { const f = filt('cronologia'); const all = Object.keys(CRONO_TIPOS); const cur = new Set(f.tipos || all); cur.has(el.dataset.v) ? cur.delete(el.dataset.v) : cur.add(el.dataset.v); f.tipos = [...cur]; G.render(); };
A['cr.otros'] = async () => {
  const f = filt('cronologia'); const s = S(); const u = s.units[f.unit] || Object.values(s.units)[0];
  if (f.otros && f.otros.ind === u.ind) { f.otros = null; G.render(); return; }
  const ev = [];
  for (const sum of G.core.summaries || []) {
    if (sum.id === G.core.cur) continue;
    const ops = await G.core.repo.loadOps(sum.id); const e = new Engine(ops); if (!e.state.prev) continue;
    const other = Object.values(e.state.units).find(x => (x.ind || '').toLowerCase() === (u.ind || '').toLowerCase());
    if (!other) continue;
    const until = e.state.prev.cerradoEn || now();
    for (const x of unitChronology(e, other.id, until)) ev.push({ ...x, prev: e.state.prev.nombre, pid: sum.id });
  }
  f.otros = { ind: u.ind, ev }; toast(ev.length ? 'Añadidos ' + ev.length + ' acontecimientos de otros preventivos' : 'No hay actividad de esta unidad en otros preventivos'); G.render();
};

// ======================= estadísticas =======================
const hbars = (items, fmt = v => v) => {
  const max = Math.max(1, ...items.map(i => i.value));
  return `<div class="hbars">${items.map(i => `<div class="hb"><span class="hb-l">${esc(i.label)}</span><span class="hb-t"><i style="width:${(i.value / max * 100).toFixed(1)}%;background:${attr(i.color || 'var(--acc)')}"></i></span><b class="hb-v">${esc(fmt(i.value))}</b></div>`).join('') || '<p class="muted">Sin datos</p>'}</div>`;
};
const cols = (items, color = 'var(--acc)') => {
  const max = Math.max(1, ...items.map(i => i.value)); const every = Math.ceil(items.length / 12);
  return `<div class="cols" role="img" aria-label="Distribución temporal">${items.map((i, k) => `<div class="col" title="${attr(i.label + ': ' + i.value)}"><i style="height:${(i.value / max * 100).toFixed(1)}%;background:${color}"></i><span>${k % every === 0 ? esc(i.label) : ''}</span></div>`).join('')}</div><p class="muted small">Máximo: ${max}</p>`;
};
function lineChart(series, labels) {
  const W = 600, H = 150; const n = labels.length; const max = Math.max(1, ...series.flatMap(s => s.values));
  const pts = s => s.values.map((v, i) => (n > 1 ? (i / (n - 1)) * W : 0).toFixed(1) + ',' + (H - (v / max) * (H - 6) - 3).toFixed(1)).join(' ');
  return `<div class="line-c"><svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="Evolución">${[0.25, 0.5, 0.75].map(f => `<line x1="0" x2="${W}" y1="${H * f}" y2="${H * f}" class="grid"/>`).join('')}${series.map(s => `<polyline points="${pts(s)}" fill="none" stroke="${s.color}" stroke-width="2.5" vector-effect="non-scaling-stroke"/>`).join('')}</svg>
  <div class="row between muted small"><span>${esc(labels[0] || '')}</span><span>máx. ${max}</span><span>${esc(labels[n - 1] || '')}</span></div>
  <div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div></div>`;
}

export function renderStats() {
  if (!can('estadisticas.ver')) return empty('No tienes permiso para consultar estadísticas');
  const f = filt('stats'); const tab = f.tab || 'prev';
  return tabs([['prev', 'Preventivo'], ['unid', 'Por unidad'], ['avis', 'Por aviso']], tab, 'st.tab') +
    (tab === 'prev' ? statsPrev() : tab === 'unid' ? statsUnits() : statsAvisos());
}
A['st.tab'] = el => { filt('stats').tab = el.dataset.v; G.render(); };
function statsPrev() {
  const s = S(); const p = P(); const t = now(); const st = prevStats(s, t);
  const tot = st.avisos;
  return `<div class="kpis small">
    <div class="kpi"><b>${fmtDur(st.duracion)}</b><span>Duración analizada</span></div>
    <div class="kpi"><b>${Object.keys(st.recursos.porTipo).reduce((n, k) => n + st.recursos.porTipo[k], 0)}</b><span>Unidades</span></div>
    <div class="kpi"><b>${tot.total}</b><span>Avisos</span></div>
    <div class="kpi"><b>${tot.porEstado.finalizado || 0}</b><span>Finalizados</span></div>
    <div class="kpi"><b>${st.descansos.total}</b><span>Descansos</span></div>
    <div class="kpi"><b>${fmtDur(st.descansos.tiempo)}</b><span>Tiempo en descanso</span></div>
  </div>
  <div class="grid2">
    <section class="card pad"><h3>Avisos por hora</h3>${cols(st.serie.map(b => ({ label: fmtTime(b.t), value: b.avisos })))}</section>
    <section class="card pad"><h3>Evolución: avisos abiertos y unidades ocupadas</h3>${lineChart([{ name: 'Avisos abiertos', color: '#C62828', values: st.evol.map(e => e.abiertos) }, { name: 'Unidades ocupadas', color: '#1565C0', values: st.evol.map(e => e.ocupadas) }], st.evol.map(e => fmtTime(e.t)))}</section>
    <section class="card pad"><h3>Tiempo acumulado por clave</h3>${hbars(p.cat.claves.map(k => ({ label: k.codigo + ' ' + k.nombre, value: st.claveTotales[k.codigo] || 0, color: k.color })), fmtDur)}</section>
    <section class="card pad"><h3>Avisos por tipo</h3>${hbars(Object.entries(tot.porTipo).map(([k, v]) => ({ label: k === '_' ? 'Sin tipo' : etiquetaTipoAviso(p.cat.tiposAviso, k), value: v, color: (tipoAvisoDef(p.cat.tiposAviso, k) || {}).color })))}</section>
    <section class="card pad"><h3>Avisos por sector</h3>${hbars(Object.entries(tot.porSector).map(([k, v]) => ({ label: k === '_' ? 'Sin sector' : named(p.cat.sectores, k), value: v, color: (p.cat.sectores.find(x => x.id === k) || {}).color })))}</section>
    <section class="card pad"><h3>Recursos por tipo</h3>${hbars(Object.entries(st.recursos.porTipo).map(([k, v]) => ({ label: k === '_' ? 'Sin tipo' : named(p.cat.tiposRecurso, k), value: v, color: (p.cat.tiposRecurso.find(x => x.id === k) || {}).color })))}</section>
    <section class="card pad"><h3>Recursos por sector</h3>${hbars(Object.entries(st.recursos.porSector).map(([k, v]) => ({ label: k === '_' ? 'Pendiente de asignación' : k === 'otros' ? 'Otros (ubicaciones personalizadas)' : named(p.cat.sectores, k), value: v, color: (p.cat.sectores.find(x => x.id === k) || {}).color })))}</section>
    <section class="card pad"><h3>Unidades ocupadas y en descanso por hora</h3>${cols(st.serie.map(b => ({ label: fmtTime(b.t), value: b.ocupadas })), '#1565C0')}${cols(st.serie.map(b => ({ label: fmtTime(b.t), value: b.descansos })), '#9E9E9E')}</section>
  </div>`;
}
function statsUnits() {
  const s = S(); const p = P(); const t = now(); const f = filt('stats');
  const rows = Object.values(s.units).filter(u => !u.eliminada).map(u => ({ u, st: unitStats(s, u, p.estado === 'cerrado' && p.cerradoEn ? p.cerradoEn : t) })).sort((a, b) => (a.u.ind || '').localeCompare(b.u.ind || '', 'es', { numeric: true }));
  const claves = p.cat.claves;
  return `<p class="muted small">Tiempos reales calculados desde los cambios de clave registrados. "—" indica que no hay datos suficientes.</p>
  <div class="scroll"><table class="tbl stats-t"><thead><tr><th>Unidad</th><th class="num">Servicio</th><th>Tiempo por clave</th><th class="num">Avisos</th><th class="num">En avisos</th><th class="num">Medio/aviso</th><th class="num">Descansos</th><th class="num">En descanso</th><th class="num">Cambios</th></tr></thead><tbody>
  ${rows.map(({ u, st }) => `<tr><td><b>${esc(u.ind)}</b></td><td class="num">${fmtDur(st.servicio)}</td>
    <td><div class="stack-bar" title="${attr(claves.map(k => k.codigo + ': ' + fmtDur(st.porClave[k.codigo] || 0)).join(' · '))}">${claves.map(k => { const v = st.porClave[k.codigo] || 0; return v && st.servicio ? `<i style="width:${(v / st.servicio * 100).toFixed(2)}%;background:${attr(k.color)}"></i>` : ''; }).join('')}</div></td>
    <td class="num">${st.nAvisos}</td><td class="num">${fmtDur(st.enAvisos)}</td><td class="num">${st.medioPorAviso != null ? fmtDur(st.medioPorAviso) : '—'}</td><td class="num">${st.nDescansos}</td><td class="num">${fmtDur(st.enDescanso)}</td><td class="num">${st.cambiosClave}</td></tr>`).join('')}
  </tbody></table></div>
  <div class="legend">${claves.map(c => `<span><i style="background:${attr(c.color)}"></i>${esc(c.codigo)} ${esc(c.nombre)}</span>`).join('')}</div>
  <h3>Detalle por clave</h3>
  <div class="scroll"><table class="tbl"><thead><tr><th>Unidad</th>${claves.map(k => `<th class="num">${esc(k.codigo)}</th>`).join('')}</tr></thead><tbody>
  ${rows.map(({ u, st }) => `<tr><td>${esc(u.ind)}</td>${claves.map(k => `<td class="num">${st.porClave[k.codigo] ? fmtDur(st.porClave[k.codigo]) : '—'}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
}
function statsAvisos() {
  const s = S(); const p = P(); const f = filt('stats');
  const st = avisoStats(s, { tipo: f.tipo || '', sector: f.sector || '' });
  return `<div class="toolbar">
    <select data-c="st.tipo"><option value="">Todos los tipos</option>${opcionesTipoAviso(p.cat.tiposAviso, f.tipo || '')}</select>
    <select data-c="st.sector"><option value="">Todos los sectores</option>${p.cat.sectores.map(x => `<option value="${x.id}"${f.sector === x.id ? ' selected' : ''}>${esc(x.nombre)}</option>`).join('')}</select>
  </div>
  <div class="kpis small"><div class="kpi"><b>${st.total}</b><span>Total</span></div>${Object.entries(AVISO_ESTADO).map(([k, l]) => `<div class="kpi"><b>${st.porEstado[k] || 0}</b><span>${l}</span></div>`).join('')}</div>
  <div class="times big">${Object.entries(TIEMPOS_AVISO).map(([k, [l, d]]) => { const a = st.tiempos[k]; return `<div title="${attr(d)}"><span>${esc(l)}</span><b>${a.media != null ? fmtDur(a.media) : '—'}</b><small>mediana ${a.mediana != null ? fmtDur(a.mediana) : '—'} · ${a.n} con datos${st.sinDatos[k] ? ' · ' + st.sinDatos[k] + ' sin datos' : ''}</small><small class="muted">${esc(d)}</small></div>`; }).join('')}</div>
  <div class="scroll"><table class="tbl"><thead><tr><th>Aviso</th><th>Hora</th><th>Tipo</th><th>Sector</th><th>Estado</th><th class="num">Unid.</th>${Object.values(TIEMPOS_AVISO).map(([l]) => `<th class="num">${esc(l.replace('Tiempo de ', ''))}</th>`).join('')}</tr></thead><tbody>
  ${st.rows.sort((a, b) => (a.a.t ?? a.a.creado) - (b.a.t ?? b.a.creado)).map(r => `<tr data-a="a.open" data-id="${r.a.id}" class="clickable"><td><b>${esc(avisoLabel(r.a))}</b></td><td>${fmtTime(r.a.t ?? r.a.creado)}</td><td>${esc(etiquetaTipoAviso(p.cat.tiposAviso, r.a.tipo))}</td><td>${esc(named(p.cat.sectores, r.a.sector))}</td><td>${esc(AVISO_ESTADO[r.a.estado])}</td><td class="num">${r.unidades}</td>${Object.keys(TIEMPOS_AVISO).map(k => `<td class="num">${r[k] != null ? fmtDur(r[k]) : '—'}</td>`).join('')}</tr>`).join('')}
  </tbody></table></div>`;
}
CH['st.tipo'] = el => { filt('stats').tipo = el.value; G.render(); };
CH['st.sector'] = el => { filt('stats').sector = el.value; G.render(); };
