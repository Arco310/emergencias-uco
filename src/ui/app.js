// Arranque de la aplicación, navegación, distribución móvil/tablet y eventos globales.
import { openStorage, entornoPruebas } from '../data/idb.js';
import { AppCore } from '../app/core.js';
import { G, A, F, CH } from './state.js';
import { esc, $, $$, toast, closeSheet, handlePop, refreshSheets, drawLayer, dialogSubmit, sheets, openSheet, confirmDlg, systemNotify, selectorDe } from './dom.js';
import { icon } from './icons.js';
import { fmtClock, fmtDur, now, AppError } from '../core/util.js';
import { APP_NAME, APP_VERSION } from '../core/defaults.js';
import { isResting } from '../core/engine.js';
import { SYNC_ESTADOS } from '../data/sync.js';
import * as auth from './views/auth.js';
import * as home from './views/home.js';
import * as ops from './views/ops.js';
import * as plano from './views/plano.js';
import * as analysis from './views/analysis.js';
import { renderIncoherencias, insigniaIncoherencias } from './views/incoherencias.js';
import * as admin from './views/admin.js';
import * as actualizaciones from './views/actualizaciones.js';
import { iniciarActualizaciones, arranqueOk, estadoApp } from './actualizacion.js';

/* global __PREVIEW__ */
G.preview = typeof __PREVIEW__ !== 'undefined' && __PREVIEW__;
G.version = APP_VERSION;

const VIEWS = {
  // Fuera de un preventivo
  inicio: { t: 'Preventivos', ic: 'inicio', scope: 'g', r: home.renderHome },
  plantillas: { t: 'Plantillas', ic: 'plantilla', scope: 'g', r: home.renderTemplates },
  config: { t: 'Configuración general', ic: 'ajustes', scope: 'g', r: admin.renderGlobalConfig },
  uplantillas: { t: 'Unidades plantilla', ic: 'plantilla', scope: 'g', r: admin.renderUnitTemplates, parent: 'config' },
  sistema: { t: 'Sistema', ic: 'mas', scope: 'g', r: admin.renderSystemMenu },
  usuarios: { t: 'Usuarios y roles', ic: 'usuario', scope: 'g', r: admin.renderUsers, parent: 'sistema' },
  copias: { t: 'Copias de seguridad', ic: 'archivar', scope: 'g', r: admin.renderBackups, parent: 'sistema' },
  auditoria: { t: 'Auditoría del sistema', ic: 'bitacora', scope: 'g', r: admin.renderAudit, parent: 'sistema', perm: 'auditoria.ver' },
  permisos: { t: 'Permisos del dispositivo', ic: 'escudo', scope: 'g', r: admin.renderDevicePerms, parent: 'sistema' },
  cuenta: { t: 'Mi cuenta', ic: 'usuario', scope: 'g', r: admin.renderAccount, parent: 'sistema' },
  acerca: { t: 'Acerca de', ic: 'info', scope: 'g', r: admin.renderAbout, parent: 'sistema' },
  central: { t: 'Servidor central', ic: 'sync', scope: 'g', r: admin.renderCentral, parent: 'sistema' },
  actualizaciones: { t: 'Actualizaciones', ic: 'descargar', scope: 'g', r: actualizaciones.renderActualizaciones, parent: 'sistema' },
  // Dentro de un preventivo
  panel: { t: 'Centro de control', ic: 'panel', scope: 'p', r: ops.renderPanel },
  unidades: { t: 'Unidades', ic: 'unidades', scope: 'p', r: ops.renderUnits, perm: 'unidades.ver' },
  avisos: { t: 'Avisos', ic: 'avisos', scope: 'p', r: ops.renderAvisos, perm: 'avisos.ver' },
  plano: { t: 'Plano táctico', ic: 'plano', scope: 'p', r: plano.renderPlano, full: true, perm: 'planos.ver' },
  mas: { t: 'Más', ic: 'mas', scope: 'p', r: admin.renderPrevMenu },
  bitacora: { t: 'Bitácora y auditoría', ic: 'bitacora', scope: 'p', r: analysis.renderLog, parent: 'mas', perm: 'bitacora.ver' },
  incoherencias: { t: 'Incoherencias', ic: 'alerta', scope: 'p', r: renderIncoherencias, parent: 'mas', perm: 'incoherencias.ver' },
  cronologia: { t: 'Cronología de unidades', ic: 'reloj', scope: 'p', r: analysis.renderChrono, parent: 'mas', perm: 'unidades.ver' },
  estadisticas: { t: 'Tiempos y estadísticas', ic: 'grafico', scope: 'p', r: analysis.renderStats, parent: 'mas', perm: 'estadisticas.ver' },
  mapa: { t: 'Mapa real', ic: 'mapa', scope: 'p', r: ops.renderMap, parent: 'mas', perm: 'planos.ver' },
  ajustes: { t: 'Configuración del preventivo', ic: 'ajustes', scope: 'p', r: admin.renderPrevConfig, parent: 'mas' },
  sync: { t: 'Sincronización', ic: 'sync', scope: 'p', r: admin.renderSync, parent: 'mas' },
  cierre: { t: 'Finalizar preventivo e informes', ic: 'archivo', scope: 'p', r: admin.renderClose, parent: 'mas' },
};
const NAV_P = ['panel', 'unidades', 'avisos', 'plano', 'mas'];
const NAV_G = ['inicio', 'plantillas', 'config', 'sistema'];

export function go(route, params = {}) {
  if (!VIEWS[route]) route = G.core && G.core.cur ? 'panel' : 'inicio';
  G.ui.route = route; G.ui.params = params;
  try { if (location.hash !== '#' + route) history.replaceState(history.state, '', '#' + route); } catch { }
  render(); window.scrollTo(0, 0); const m = $('#main'); if (m) m.scrollTop = 0;
}
A['nav'] = el => go(el.dataset.v);
A['sheet.close'] = () => closeSheet();
A['dlg.cancel'] = () => closeSheet();
F['dlg.submit'] = form => dialogSubmit(form);

let renderQueued = false;
/** Entorno de pruebas (CLAUDE_TEST): aviso permanente, datos y espacio central separados de los reales */
const pruebasBar = () => G.pruebas ? `<div class="pruebas-bar" role="status">${icon('alerta')} ENTORNO DE PRUEBAS · CLAUDE_TEST — datos ficticios, separados de los reales</div>` : '';
/** Aviso de versión nueva de la aplicación lista (o de que hay que actualizar para seguir sincronizando) */
function actBar() {
  const s = estadoApp(); const b = (t, a, cls, data = {}) => `<button type="button" class="btn sm ${cls}" data-a="${a}"${Object.entries(data).map(([k, v]) => ` data-${k}="${esc(v)}"`).join('')}>${esc(t)}</button>`;
  if (s.aplicando) return `<div class="act-bar" role="status" data-act-bar="aplicando">${icon('sync')}<span>Aplicando la versión nueva…</span></div>`;
  if (G.core && G.core.bloqueoSync) return `<div class="act-bar bad" role="alert" data-act-bar="obsoleta" title="${esc(G.core.bloqueoSync)}">${icon('alerta')}<span>Actualiza la aplicación para seguir sincronizando</span>${s.lista ? b('Actualizar', 'act.aplicar', 'primary') : b('Ver', 'nav', '', { v: 'actualizaciones' })}</div>`;
  if (s.lista) return `<div class="act-bar" role="status" data-act-bar="lista">${icon('descargar')}<span>Versión ${esc(s.lista.version || 'nueva')} lista</span>${b('Actualizar', 'act.aplicar', 'primary')}${G.core && G.core.session ? b('Detalles', 'nav', 'ghost', { v: 'actualizaciones' }) : ''}</div>`;
  return '';
}
/** Valores escritos por el usuario (distintos de los iniciales) en los campos de la pantalla */
function camposEscritos(root) {
  const out = new Map();
  for (const el of root.querySelectorAll('input[id], textarea[id], select[id]')) {
    if (el.type === 'checkbox' || el.type === 'radio' || el.type === 'file' || el.type === 'hidden') continue;
    const cambiado = el.tagName === 'SELECT' ? [...el.options].some(o => o.selected !== o.defaultSelected) : el.value !== el.defaultValue;
    if (cambiado) out.set(el.id, el.value);
  }
  return out;
}
function restaurarCampos(root, vals) {
  for (const [id, v] of vals) { const el = root.querySelector('#' + CSS.escape(id)); if (el && (el.tagName === 'SELECT' ? [...el.options].some(o => o.value === v) : true)) el.value = v; }
}
/** Casillas y opciones de un formulario que el usuario ha cambiado y aún no ha enviado. Los interruptores
 *  que se aplican al momento (data-c) no se guardan: tras repintar deben mostrar el estado real. */
const CASILLAS = 'form[data-f] input[type=checkbox][name]:not([data-c]), form[data-f] input[type=radio][name]:not([data-c])';
function casillasEscritas(root) {
  const out = [];
  for (const el of root.querySelectorAll(CASILLAS)) if (el.checked !== el.defaultChecked) out.push([el.closest('form').dataset.f, el.name, el.value, el.checked]);
  return out;
}
function restaurarCasillas(root, lista) {
  for (const [f, name, value, checked] of lista) {
    const el = [...root.querySelectorAll(CASILLAS)].find(x => x.closest('form').dataset.f === f && x.name === name && x.value === value);
    if (el) el.checked = checked;
  }
}
/** Repintado por un evento (sincronización, versión, servidor central…): nunca borra lo que el usuario
 *  está escribiendo en la pantalla */
function renderPasivo() {
  const app = $('#app'); const vals = app ? camposEscritos(app) : new Map(); const cas = app ? casillasEscritas(app) : [];
  render();
  if (app && vals.size) restaurarCampos(app, vals);
  if (app && cas.length) restaurarCasillas(app, cas);
}
export function render() {
  renderQueued = false;
  const app = $('#app'); if (!app) return;
  const core = G.core;
  if (!core || !core.session || auth.blocking()) { app.className = 'app auth'; app.innerHTML = pruebasBar() + actBar() + auth.renderAuth(); drawLayer(); return; }
  if (G.applyTheme) G.applyTheme();
  let route = G.ui.route;
  const v0 = VIEWS[route];
  if (!v0 || (v0.scope === 'p' && !core.cur)) route = G.ui.route = 'inicio';
  if (v0 && v0.scope === 'g' && core.cur && !['cuenta', 'permisos', 'acerca'].includes(route)) { /* se permite consultar ajustes globales */ }
  const v = VIEWS[route];
  const focusId = document.activeElement && document.activeElement.id;
  // Sin id (p. ej. un botón): se vuelve a encontrar por sus atributos para que el teclado no pierda el foco
  const focusSel = !focusId && document.activeElement && app.contains(document.activeElement) ? selectorDe(document.activeElement) : null;
  const selStart = focusId && document.activeElement.selectionStart;
  const main = $('#main'); const scroll = main ? main.scrollTop : 0;
  let body;
  // Permisos de consulta (1.4.0): sin permiso no se muestra la pantalla y se explica por qué
  if (v.perm && !core.can(v.perm)) body = `<div class="empty">${icon('candado')}<p>No tienes permiso para consultar esta sección. Si lo necesitas, pídeselo a un administrador.</p></div>`;
  else try { body = v.r(); } catch (e) { console.error(e); body = `<div class="empty">${icon('alerta')}<p>Error al mostrar la pantalla: ${esc(e.message)}</p></div>`; }
  app.className = 'app' + (v.full ? ' full' : '') + (core.cur ? ' in-prev' : '');
  app.innerHTML = layout(route, v, body);
  const m2 = $('#main'); if (m2 && G.ui._lastRoute === route) m2.scrollTop = scroll;
  G.ui._lastRoute = route;
  if (focusId) { const el = document.getElementById(focusId); if (el) { el.focus(); try { if (selStart != null) el.setSelectionRange(selStart, selStart); } catch { } } }
  else if (focusSel) { const el = app.querySelector(focusSel); if (el) el.focus({ preventScroll: true }); }
  refreshSheets();
  tick();
  if (v.after) v.after();
  plano.afterRender && route === 'plano' && plano.afterRender();
}
export function queueRender() { if (!renderQueued) { renderQueued = true; requestAnimationFrame(renderPasivo); } }

function layout(route, v, body) {
  const core = G.core; const s = core.state; const inPrev = !!core.cur && !!s;
  const nav = (inPrev ? NAV_P : NAV_G).filter(k => !VIEWS[k].perm || G.core.can(VIEWS[k].perm));
  const activeNav = v.parent || route;
  const navHtml = cls => `<nav class="${cls}" aria-label="Navegación">${nav.map(k => `<button type="button" class="nav-i${k === activeNav ? ' on' : ''}" data-a="nav" data-v="${k}" aria-current="${k === activeNav ? 'page' : 'false'}">${icon(VIEWS[k].ic)}<span>${VIEWS[k].t === 'Centro de control' ? 'Panel' : VIEWS[k].t === 'Plano táctico' ? 'Plano' : VIEWS[k].t.replace('Configuración general', 'Ajustes')}</span>${badge(k)}</button>`).join('')}</nav>`;
  const st = inPrev ? s.prev : null;
  const est = st ? { preparacion: ['En preparación', 'warn'], activo: ['Activo', 'ok'], cerrado: ['Cerrado', 'muted'] }[st.estado] : null;
  return `
  ${pruebasBar()}${actBar()}${G.preview ? `<div class="preview-bar">${icon('info')} Vista previa: los datos pueden no conservarse y no hay modo sin conexión, sincronización, GPS ni descargas. Para uso real, aloja la aplicación.</div>` : ''}
  <header class="top">
    ${inPrev ? `<button class="btn icon ghost" data-a="prev.exit" title="Volver a preventivos" aria-label="Volver a preventivos">${icon('atras')}</button>` : `<span class="logo">${logoSvg()}</span>`}
    <div class="top-title">${inPrev ? `<b>${esc(st.nombre)}</b><span class="chip sm ${est[1]}">${est[0]}${st.archivado ? ' · archivado' : ''}</span>` : `<b>${APP_NAME}</b>`}
      ${v.parent ? `<span class="crumb">${esc(v.t)}</span>` : ''}</div>
    <div class="top-act">${inPrev ? insigniaIncoherencias() : ''}${inPrev ? syncBadge() : ''}${netBadge()}
      <button class="btn icon ghost" data-a="user.menu" aria-label="Usuario: ${esc(core.user.nombre)}">${icon('usuario')}</button></div>
  </header>
  ${navHtml('rail')}
  <main id="main" tabindex="-1">${v.parent ? `<div class="subhead"><button class="btn ghost sm" data-a="nav" data-v="${v.parent}">${icon('atras')}<span>${esc(VIEWS[v.parent].t)}</span></button><h1>${esc(v.t)}</h1></div>` : ''}${body}</main>
  ${navHtml('bottom')}`;
}
function badge(k) {
  const s = G.core.state; if (!s) return '';
  if (k === 'avisos') { const n = Object.values(s.avisos).filter(a => a.estado === 'pendiente').length; return n ? `<i class="nbadge">${n}</i>` : ''; }
  if (k === 'mas') { const n = G.core.engine().pendingConflicts().length; return n ? `<i class="nbadge">${n}</i>` : ''; }
  return '';
}
function syncBadge() {
  const core = G.core;
  if (!core.isShared()) return '';
  const st = core.sync.status(core.cur);
  const conf = core.engine().pendingConflicts().length;
  const k = conf ? 'conflicto' : st.estado || 'pendiente';
  const cls = { sincronizado: 'ok', pendiente: 'warn', sincronizando: 'info', sin_conexion: 'muted', error: 'bad', conflicto: 'bad', local: 'muted' }[k] || 'muted';
  return `<button class="sync-b ${cls}" data-a="nav" data-v="sync" title="${esc(SYNC_ESTADOS[k] || k)}">${icon('sync')}<span>${esc(SYNC_ESTADOS[k] || k)}${st.pendientes ? ' · ' + st.pendientes : ''}</span></button>`;
}
function netBadge() { return navigator.onLine === false ? `<span class="net-off" title="Sin conexión: todo sigue funcionando en este dispositivo">${icon('sinred')}<span>Sin conexión</span></span>` : ''; }
export function logoSvg() {
  return `<svg viewBox="0 0 48 48" width="30" height="30" aria-hidden="true"><rect width="48" height="48" rx="11" fill="#B71C1C"/><path d="M20 9h8v11h11v8H28v11h-8V28H9v-8h11z" fill="#fff"/></svg>`;
}

// ---------------- eventos globales ----------------
async function runAction(fn, el, ev) {
  try { await fn(el, ev); }
  catch (e) {
    if (e && e.name === 'AbortError') return;
    // Los avisos de validación para el usuario (AppError) no son fallos del programa
    if (e instanceof AppError) console.warn(e.message); else console.error(e);
    toast(e instanceof AppError || (e && e.code) ? e.message : 'Error: ' + (e && e.message ? e.message : e), 'error', 6000);
  }
}
function bindGlobal() {
  document.addEventListener('click', ev => {
    const el = ev.target.closest('[data-a]'); if (!el || el.disabled) return;
    const fn = A[el.dataset.a]; if (!fn) { console.warn('Acción sin manejador', el.dataset.a); return; }
    if (el.tagName === 'A' && el.getAttribute('href') && !el.dataset.prevent) { /* enlace real */ } else ev.preventDefault();
    runAction(fn, el, ev);
  });
  document.addEventListener('submit', ev => {
    const form = ev.target.closest('form[data-f]'); if (!form) return;
    ev.preventDefault();
    const fn = F[form.dataset.f]; if (!fn) return;
    const b = form.querySelector('[type=submit]'); if (b) b.disabled = true;
    runAction(async () => { try { await fn(form, ev); } finally { if (b && b.isConnected) b.disabled = false; } }, form, ev);
  });
  const onCh = ev => { if (G.repintandoHoja) return; const el = ev.target.closest('[data-c]'); if (!el) return; const fn = CH[el.dataset.c]; if (fn) runAction(fn, el, ev); };
  document.addEventListener('change', onCh);
  // Escape cierra el panel de encima (convención de los diálogos; un diálogo de confirmación cuenta como «Cancelar»)
  document.addEventListener('keydown', ev => { if (ev.key === 'Escape' && !ev.defaultPrevented && document.body.classList.contains('has-sheet')) { ev.preventDefault(); closeSheet(); } });
  document.addEventListener('input', ev => { const el = ev.target.closest('[data-c][data-live]'); if (el) onCh(ev); });
  window.addEventListener('popstate', () => {
    if (!handlePop()) { const r = location.hash.slice(1); if (r && r !== G.ui.route && VIEWS[r]) go(r); }
    else { try { if (location.hash !== '#' + G.ui.route) history.replaceState(history.state, '', '#' + G.ui.route); } catch { } }
  });
  window.addEventListener('online', () => { queueRender(); if (G.core && G.core.cur && G.core.isShared()) G.core.sync.syncNow(G.core.cur); });
  window.addEventListener('offline', queueRender);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && G.core && G.core.cur && G.core.isShared()) G.core.sync.syncNow(G.core.cur); if (document.hidden && G.core) G.core.autoBackup(); });
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); G.installPrompt = e; });
  for (const evn of ['pointerdown', 'keydown']) document.addEventListener(evn, () => { G.lastActivity = Date.now(); }, { passive: true });
  window.addEventListener('pagehide', () => { if (G.core) G.core.autoBackup(); });
}

// ---------------- temporizadores (cuentas atrás con marcas de tiempo reales) ----------------
const restSeen = new Set();
function tick() {
  const t = now();
  for (const el of $$('[data-cd]')) { const end = Number(el.dataset.cd); el.textContent = fmtClock(end - t); el.classList.toggle('late', end - t < 60000); }
  for (const el of $$('[data-since]')) el.textContent = fmtDur(t - Number(el.dataset.since));
}
function restWatch() {
  const core = G.core; if (!core || !core.state) return;
  const t = now(); let ended = false;
  for (const u of Object.values(core.state.units)) {
    const d = u.descanso; if (!d || d.fin != null) continue;
    const key = d.id;
    if (t >= d.finPrev && !restSeen.has(key)) {
      restSeen.add(key);
      if (t - d.finPrev < 15000) {
        ended = true;
        toast('Fin del descanso: ' + (u.ind || u.nombre), 'info', 8000);
        try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch { }
        systemNotify('Fin del descanso', { body: ((u.ind || '') + ' ' + (u.nombre || '')).trim(), tag: key, vibrate: [200, 100, 200] }).catch(() => { });
      }
    } else if (t < d.finPrev) restSeen.delete(key);
  }
  if (ended) queueRender();
}
function lockWatch() {
  const core = G.core; if (!core || !core.session || G.locked) return;
  const min = Number(core.cfg && core.cfg.bloqueoMin) || 0;
  if (min > 0 && Date.now() - (G.lastActivity || Date.now()) > min * 60000) lockScreen();
}
export function lockScreen() {
  if (G.locked) return; G.locked = true;
  openSheet({
    title: 'Sesión bloqueada', size: 's', dialog: true, onClose: () => { if (G.locked) setTimeout(lockScreen, 0); G.locked = false; },
    render: () => `<form data-f="unlock"><p>Introduce la contraseña de <b>${esc(G.core.user.nombre)}</b> para continuar.</p>
      <div class="fld"><label for="f_unlock">Contraseña</label><input type="password" id="f_unlock" name="p" autocomplete="current-password" required></div>
      <div class="row between gap"><button type="button" class="btn ghost" data-a="session.logout">Cerrar sesión</button><button class="btn primary">Desbloquear</button></div></form>`,
  });
}
F['unlock'] = async form => {
  const ok = await G.core.repo.verifyPassword(form.p.value);
  if (!ok) { toast('Contraseña incorrecta', 'error'); return; }
  G.locked = false; G.lastActivity = Date.now(); closeSheet();
};

A['user.menu'] = () => {
  const u = G.core.user;
  openSheet({
    title: u.nombre, size: 's',
    render: () => `<p class="muted">${esc(u.usuario)} · ${esc(u.rolNombre)} · ${esc(G.core.device.nombre)} (${esc(G.core.device.code)})</p>
    <div class="menu">
      <button class="menu-i" data-a="menu.go" data-v="cuenta">${icon('usuario')}<span>Mi cuenta y contraseña</span></button>
      <button class="menu-i" data-a="menu.go" data-v="permisos">${icon('escudo')}<span>Permisos del dispositivo</span></button>
      <button class="menu-i" data-a="session.lock">${icon('candado')}<span>Bloquear pantalla</span></button>
      <button class="menu-i" data-a="session.logout">${icon('salir')}<span>Cerrar sesión</span></button>
    </div>`,
  });
};
A['menu.go'] = el => { closeSheet(); setTimeout(() => go(el.dataset.v), 0); };
A['session.lock'] = () => { closeSheet(); setTimeout(lockScreen, 50); };
A['session.logout'] = async () => {
  while (sheets().length) closeSheet();
  G.locked = false;
  await G.core.logout(); G.ui.route = 'inicio'; render();
};
A['prev.exit'] = () => { G.core.closePrev(); try { localStorage.removeItem('uco:last'); } catch { } go('inicio'); };

// ---------------- arranque ----------------
async function boot() {
  const root = document.getElementById('app');
  root.innerHTML = `<div class="splash">${logoSvg()}<p>Cargando…</p></div>`;
  let storage;
  try { storage = await openStorage(); } catch (e) { root.innerHTML = '<div class="splash"><p>No se pudo abrir el almacenamiento: ' + esc(e.message) + '</p></div>'; if (window.__ucoFallo) window.__ucoFallo('No se pudo abrir el almacenamiento: ' + e.message); return; }
  G.storageKind = storage.kind;
  if (storage.kind === 'memoria') G.preview = true;
  G.pruebas = entornoPruebas();
  // En el entorno de pruebas se puede apuntar a otro servidor (?servidor=…) o desactivarlo (?servidor=no)
  const qs = new URLSearchParams(location.search).get('servidor');
  const core = new AppCore(storage, { pruebas: G.pruebas, ...(G.pruebas && qs ? { servidor: qs === 'no' ? false : qs } : {}) });
  G.core = core; G.go = go; G.render = queueRender; G.tick = tick; G.lastActivity = Date.now();
  await core.boot();
  core.on((type, data) => {
    if (type === 'change' && data && data.remote && data.pid === core.cur) { queueRender(); return; }
    if (type === 'sync') { if (data.pid === core.cur) queueRender(); return; }
    if (type === 'mensaje') { toast(data.texto, data.tipo || 'info', 8000); queueRender(); return; }
    queueRender();
  });
  bindGlobal();
  setInterval(tick, 1000);
  setInterval(restWatch, 2000);
  setInterval(lockWatch, 15000);
  const h = location.hash.slice(1); if (VIEWS[h]) G.ui.route = G.ui.bootRoute = h; // pantalla a recuperar tras recargar e iniciar sesión
  render();
  arranqueOk(); // la aplicación ha arrancado: no hace falta la pantalla de recuperación
  // Actualizaciones: service worker con activación controlada y versión del servidor central
  iniciarActualizaciones().catch(e => console.warn('Actualizaciones', e));
  if (navigator.storage && navigator.storage.persist) { try { G.persisted = await navigator.storage.persisted(); } catch { } }
}
/** Tras iniciar sesión: abre el último preventivo usado */
export async function afterLogin() {
  // La ruta se fija antes de abrir el preventivo: un repintado intermedio (sin preventivo abierto) no debe cambiarla
  const want = G.ui.bootRoute || G.ui.route; G.ui.bootRoute = null;
  try { const last = localStorage.getItem('uco:last'); if (last && (G.core.summaries || []).some(s => s.id === last)) { await G.core.openPrev(last); go(['panel', 'unidades', 'avisos', 'plano'].includes(want) ? want : 'panel'); return; } } catch (e) { console.warn(e); }
  go('inicio');
  if (navigator.storage && navigator.storage.persist && !G.preview) { try { G.persisted = await navigator.storage.persist(); } catch { } }
}
async function afterLoginWrap() {
  await afterLogin();
  setTimeout(() => { if (G.askPerms) G.askPerms(); }, 700);
}
G.afterLogin = afterLoginWrap;
export { VIEWS, APP_VERSION };

if (typeof window !== 'undefined') window.addEventListener('DOMContentLoaded', boot);
// expuesto para pruebas automatizadas
if (typeof window !== 'undefined') window.__UCO = G;
