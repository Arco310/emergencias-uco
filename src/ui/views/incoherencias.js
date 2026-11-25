// Incoherencias operativas (1.5.0): UCO detecta, informa y propone. Nunca cambia estados, finaliza avisos,
// inicia descansos ni reasigna unidades por sí solo: las decisiones son de quien coordina.
import { G, A, F, CH, filt } from '../state.js';
import { esc, attr, btn, chip, empty, tabs, toast, openSheet, closeSheet, confirmDlg, fieldsHtml, readForm } from '../dom.js';
import { icon } from '../icons.js';
import { fmtTime, fmtDateTime, now } from '../../core/util.js';
import * as C from '../../core/commands.js';
import { REGLAS, NIVELES, GRUPOS_REGLA, resumenIncoherencias } from '../../core/validaciones.js';
import { openUnit, openAviso } from './ops.js';

const core = () => G.core; const can = p => core().can(p);
let INC = null; let CARGANDO = false; // { pid, lista, firma, t }
const firmaDe = l => JSON.stringify(l.map(h => [h.id, h.nivel, h.desde, h.revision && h.revision.estado, h.revision && h.revision.t]));
/** Vuelve a calcular (barato) y repinta solo si algo cambió */
export function refrescarIncoherencias(forzar = false) {
  const pid = core().cur; if (!pid || !can('incoherencias.ver') || CARGANDO) return;
  if (!forzar && INC && INC.pid === pid && Date.now() - INC.t < 3000) return;
  CARGANDO = true;
  core().incoherencias(pid).then(lista => {
    const f = firmaDe(lista); const cambio = !INC || INC.pid !== pid || INC.firma !== f;
    INC = { pid, lista, firma: f, t: Date.now() }; if (cambio) G.render();
  }).catch(() => { }).finally(() => { CARGANDO = false; });
}
const lista = () => (INC && INC.pid === core().cur ? INC.lista : []);
const abierta = h => !h.revision || h.revision.estado === 'abierta' || h.revision.estado === 'asignada';
const chipNivel = n => chip(NIVELES[n].nombre, NIVELES[n].color);
const hace = t => (t ? fmtTime(t) + ' (hace ' + Math.max(0, Math.round((now() - t) / 60000)) + ' min)' : '—');

/** Distintivo de la barra superior: cuántas sin revisar y el nivel más alto */
export function insigniaIncoherencias() {
  if (!core().cur || !can('incoherencias.ver')) return '';
  refrescarIncoherencias();
  const r = resumenIncoherencias(lista()); if (!r.n) return '';
  return `<button class="sync-b inc-b nivel-${r.nivel}" data-a="nav" data-v="incoherencias" title="${attr(r.n + ' incoherencia(s) sin revisar; la más grave: ' + NIVELES[r.nivel].nombre)}">${icon('alerta')}<span>${r.n} · ${esc(NIVELES[r.nivel].nombre)}</span></button>`;
}
export function resumenMenu() { const r = resumenIncoherencias(lista()); return r.n ? r.n + ' sin revisar · ' + NIVELES[r.nivel].nombre : 'Ninguna abierta'; }

export function renderIncoherencias() {
  if (!can('incoherencias.ver')) return empty('No tienes permiso para consultar las incoherencias');
  refrescarIncoherencias();
  const f = filt('incoherencias'); const tab = f.tab || 'abiertas'; const l = lista();
  const ab = l.filter(abierta); const rev = l.filter(h => !abierta(h));
  return `<p class="note">${icon('escudo')} UCO detecta situaciones contradictorias y propone qué hacer, pero <b>no cambia nada por sí solo</b>: las decisiones las toma quien coordina.</p>
    ${tabs([['abiertas', 'Abiertas', ab.length], ['revisadas', 'Revisadas o resueltas', rev.length], ['reglas', 'Reglas']], tab, 'inc.tab')}
    ${tab === 'reglas' ? renderReglas() : renderLista(tab === 'abiertas' ? ab : rev, tab)}`;
}
A['inc.tab'] = el => { filt('incoherencias').tab = el.dataset.v; G.render(); };
A['inc.nivel'] = el => { const f = filt('incoherencias'); f.nivel = f.nivel === el.dataset.v ? '' : el.dataset.v; G.render(); };

function renderLista(l, tab) {
  const f = filt('incoherencias');
  const vis = f.nivel ? l.filter(h => h.nivel === f.nivel) : l;
  const filtro = `<div class="chips-f" role="group" aria-label="Filtrar por nivel">${Object.entries(NIVELES).reverse().map(([k, n]) => { const c = l.filter(h => h.nivel === k).length; return `<button type="button" class="chip-f${f.nivel === k ? ' on' : ''}" aria-pressed="${f.nivel === k}" data-a="inc.nivel" data-v="${k}"><i class="sw" style="background:${n.color}"></i>${esc(n.nombre)} (${c})</button>`; }).join('')}</div>`;
  if (!vis.length) return filtro + empty(tab === 'abiertas' ? 'No hay incoherencias abiertas.' : 'Nada revisado todavía.');
  // Agrupadas por regla: el mismo problema en varios elementos aparece junto
  const grupos = new Map(); for (const h of vis) { if (!grupos.has(h.regla)) grupos.set(h.regla, []); grupos.get(h.regla).push(h); }
  return filtro + [...grupos.values()].map(hs => { const r = hs[0];
    return `<details class="card pad inc-grupo nivel-${r.nivel}" open><summary><b>${esc(r.titulo)}</b> ${chipNivel(r.nivel)} <span class="muted">${hs.length} · ${esc(GRUPOS_REGLA[r.grupo] || r.grupo)}</span></summary>
      <p class="small"><b>Por qué:</b> ${esc(r.porque)} <b>Consecuencias:</b> ${esc(r.consecuencias)}</p>
      <p class="small"><b>Qué hacer:</b> ${esc(r.recomendacion)}</p>
      <ul class="inc-list">${hs.map(filaIncoherencia).join('')}</ul></details>`; }).join('');
}
function filaIncoherencia(h) {
  const rv = h.revision; const puede = can('incoherencias.revisar');
  return `<li class="inc-row" data-inc="${attr(h.id)}">
    <div class="grow"><b>${esc(h.entidad.nombre)}</b> ${h.desde ? `<span class="muted small">desde las ${esc(hace(h.desde))}</span>` : ''}<div class="small">${esc(h.detalle)}</div>
      ${rv ? `<div class="small muted">${esc({ revisada: 'Revisada', asignada: 'Asignada a ' + ((rv.asignadoA && rv.asignadoA.nombre) || '—'), resuelta: 'Resuelta', abierta: 'Reabierta' }[rv.estado] || rv.estado)} por ${esc(rv.por)} · ${esc(fmtDateTime(rv.t))}${rv.nota ? ' — ' + esc(rv.nota) : ''}</div>` : ''}</div>
    <div class="row gap-s wrap">${['u', 'a', 'prev'].includes(h.entidad.k) ? btn(h.entidad.k === 'u' ? 'Abrir unidad' : h.entidad.k === 'a' ? 'Abrir aviso' : 'Ver', 'inc.abrir', { cls: 'sm', data: { id: h.id } }) : ''}
      ${puede && abierta(h) ? btn('Marcar como revisada', 'inc.marcar', { cls: 'sm', data: { id: h.id, v: 'revisada' } }) + btn('Asignar…', 'inc.asignar', { cls: 'sm ghost', data: { id: h.id } }) + btn('Resolver…', 'inc.marcar', { cls: 'sm ghost', data: { id: h.id, v: 'resuelta' } }) : ''}
      ${puede && !abierta(h) ? btn('Reabrir', 'inc.marcar', { cls: 'sm ghost', data: { id: h.id, v: 'abierta' } }) : ''}
      ${rv && rv.hist && rv.hist.length ? btn('Historial', 'inc.historial', { cls: 'sm ghost', data: { id: h.id } }) : ''}</div></li>`;
}
const buscar = id => lista().find(h => h.id === id);
A['inc.abrir'] = el => {
  const h = buscar(el.dataset.id); if (!h) return;
  if (h.entidad.k === 'u') return openUnit(h.entidad.id);
  if (h.entidad.k === 'a') return openAviso(h.entidad.id);
  if (h.regla === 'rechazos_sin_revisar') return G.go('central');
  if (h.regla === 'conflicto_pendiente' || h.regla === 'cambios_sin_enviar' || h.regla === 'sin_sincronizar') return G.go('sync');
  G.go('ajustes');
};
async function revisar(h, opts) { await core().exec(C.incoherenciaRevisar, h, opts); refrescarIncoherencias(true); }
A['inc.marcar'] = async el => {
  const h = buscar(el.dataset.id); if (!h) return; const v = el.dataset.v;
  const nota = await confirmDlg({ title: { revisada: 'Marcar como revisada', resuelta: 'Resolver', abierta: 'Reabrir' }[v], text: h.entidad.nombre + ': ' + h.detalle, ok: { revisada: 'Marcar', resuelta: 'Resolver', abierta: 'Reabrir' }[v], input: { label: v === 'resuelta' ? 'Cómo se ha resuelto' : 'Nota (opcional)', value: '' } });
  if (nota == null) return;
  if (v === 'resuelta' && !String(nota).trim()) { toast('Indica cómo se ha resuelto', 'error'); return; }
  await revisar(h, { estado: v, nota }); toast({ revisada: 'Marcada como revisada', resuelta: 'Resuelta', abierta: 'Reabierta' }[v], 'ok');
};
let ASG = null;
A['inc.asignar'] = async el => {
  const h = buscar(el.dataset.id); if (!h) return;
  const usuarios = (await core().repo.listUsersPublic()).filter(u => u.activo !== false);
  ASG = h;
  openSheet({ title: 'Asignar la resolución', size: 's', render: () => `<form data-f="inc.asignar"><p class="small">${esc(h.titulo)} · ${esc(h.entidad.nombre)}</p>${fieldsHtml([
    { name: 'u', label: 'Quién se encarga', type: 'select', required: true, options: usuarios.map(u => [u.id, u.nombre + ' (' + u.usuario + ')']) },
    { name: 'nota', label: 'Nota (opcional)', type: 'textarea', rows: 2 },
  ])}<div class="row end gap"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">Asignar</button></div></form>`, onClose: () => { ASG = null; } });
  F['inc.asignar'] = async form => {
    const v = readForm(form); const u = usuarios.find(x => x.id === v.u); const h2 = ASG; closeSheet();
    await revisar(h2, { estado: 'asignada', asignadoA: { id: u.id, nombre: u.nombre }, nota: v.nota }); toast('Asignada a ' + u.nombre, 'ok');
  };
};
A['inc.historial'] = el => {
  const h = buscar(el.dataset.id); if (!h || !h.revision) return;
  openSheet({ title: 'Historial · ' + h.entidad.nombre, size: 'm', render: () => `<p class="small">${esc(h.titulo)}</p><ul class="ref-list">${h.revision.hist.slice().reverse().map(e => `<li><b>${esc({ revisada: 'Revisada', asignada: 'Asignada', resuelta: 'Resuelta', abierta: 'Reabierta' }[e.estado] || e.estado)}</b>${e.asignadoA ? ' a ' + esc(e.asignadoA.nombre) : ''} · ${esc(e.por)} · ${esc(fmtDateTime(e.t))}${e.nota ? `<div class="small">${esc(e.nota)}</div>` : ''}</li>`).join('')}</ul>` });
};

// ---------- reglas aprobadas: nivel, umbral y si están activas ----------
function renderReglas() {
  const cfg = (core().state.prev.cfg && core().state.prev.cfg.reglas) || {}; const puede = can('incoherencias.reglas') && core().state.prev.estado !== 'cerrado';
  return `<p class="muted small">Ajustes de este preventivo. Los cambios quedan en la bitácora y llegan a todos los dispositivos.${puede ? '' : ' Solo puede cambiarlos quien tenga «Ajustar las reglas de incoherencias».'}</p>
    <form data-f="inc.reglas"><table class="tbl reglas"><thead><tr><th>Regla</th><th>Nivel</th><th>Umbral (min)</th><th>Activa</th></tr></thead><tbody>${REGLAS.map(r => { const c = cfg[r.id] || {};
      return `<tr><td><b>${esc(r.titulo)}</b><div class="muted small">${esc(GRUPOS_REGLA[r.grupo])}</div></td>
        <td><select name="nivel_${r.id}" aria-label="Nivel de ${attr(r.titulo)}"${puede ? '' : ' disabled'}>${Object.entries(NIVELES).map(([k, n]) => `<option value="${k}"${(c.nivel || r.nivel) === k ? ' selected' : ''}>${esc(n.nombre)}</option>`).join('')}</select></td>
        <td>${r.umbral != null ? `<input type="number" name="umbral_${r.id}" min="1" max="1440" value="${attr(c.umbral ?? r.umbral)}" aria-label="Umbral en minutos de ${attr(r.titulo)}"${puede ? '' : ' disabled'}>` : '—'}</td>
        <td><input type="checkbox" name="activa_${r.id}" aria-label="${attr(r.titulo)} activa"${c.activa === false ? '' : ' checked'}${puede ? '' : ' disabled'}></td></tr>`; }).join('')}</tbody></table>
    ${puede ? `<div class="row end gap">${btn('Valores por defecto', 'inc.reglasDefecto', { cls: 'ghost' })}<button class="btn primary">Guardar reglas</button></div>` : ''}</form>`;
}
F['inc.reglas'] = async form => {
  const n = {};
  for (const r of REGLAS) {
    const nivel = form.querySelector(`[name="nivel_${r.id}"]`).value; const act = form.querySelector(`[name="activa_${r.id}"]`).checked; const um = form.querySelector(`[name="umbral_${r.id}"]`);
    const c = {}; if (nivel !== r.nivel) c.nivel = nivel; if (!act) c.activa = false; if (um && Number(um.value) !== r.umbral) c.umbral = Number(um.value);
    if (Object.keys(c).length) n[r.id] = c;
  }
  const ops = await core().exec(C.reglasSet, n); toast(ops.length ? 'Reglas guardadas' : 'Sin cambios', 'ok'); refrescarIncoherencias(true); G.render();
};
A['inc.reglasDefecto'] = async () => {
  if (!(await confirmDlg({ title: 'Valores por defecto', text: 'Todas las reglas vuelven a su nivel y umbral iniciales y quedan activas.', ok: 'Restablecer' }))) return;
  await core().exec(C.reglasSet, {}); toast('Reglas restablecidas', 'ok'); refrescarIncoherencias(true); G.render();
};
