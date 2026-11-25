// Utilidades de interfaz: paneles (hojas), diálogos, avisos emergentes,
// formularios declarativos y archivos.
import { escapeHtml, uid, isoDate, fmtTime } from '../core/util.js';
import { icon } from './icons.js';
import { G } from './state.js';

export const esc = escapeHtml;
export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];
export const attr = v => esc(v == null ? '' : v);

// ---------------- hojas / diálogos ----------------
const stack = [];
export function sheets() { return stack; }

/**
 * Abre un panel. opts: { title, render: () => html, size: 's'|'m'|'l', live, onClose, footer: () => html }
 * live = true → se vuelve a dibujar cuando cambian los datos.
 */
export function openSheet(opts) {
  const id = uid('sh_');
  stack.push({ id, ...opts });
  drawLayer();
  // Entrada de historial para que el botón Atrás de Android cierre el panel.
  // No se retrocede al cerrar desde la interfaz (evita carreras con history.back()).
  pushSheetEntry();
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    if (!el) return;
    const f = el.querySelector('[autofocus]') || el.querySelector('.sheet-body input:not([type=hidden]):not([disabled]), .sheet-body select, .sheet-body textarea');
    if (f && opts.focus !== false && !matchMedia('(pointer: coarse)').matches) f.focus();
    opts.onMount && opts.onMount(el);
    if (G.tick) G.tick();
  });
  return id;
}
export function closeSheet(id) {
  const i = id ? stack.findIndex(s => s.id === id) : stack.length - 1;
  if (i < 0) return;
  const [s] = stack.splice(i, 1);
  drawLayer();
  s.onClose && s.onClose();
}
function pushSheetEntry() {
  try { if (!(history.state && history.state.uco === 'sheet')) history.pushState({ uco: 'sheet' }, ''); } catch { /* entorno sin historial */ }
}
export function closeAllSheets() { while (stack.length) closeSheet(); }
/** Botón Atrás: cierra el panel superior. Devuelve true si lo ha gestionado. */
export function handlePop() {
  if (stack.length) { closeSheet(); if (stack.length) pushSheetEntry(); return true; }
  return false;
}
export function refreshSheets() {
  for (const s of stack) if (s.live) {
    const el = document.getElementById(s.id); if (!el) continue;
    const body = el.querySelector('.sheet-body');
    const st = body.scrollTop;
    // Al sustituir el contenido, Chrome lanza «change» desde el campo que tenía el foco con su valor ANTIGUO
    // (aún conectado). Mientras se repinta se ignoran esos eventos: si no, deshacen lo que se acaba de elegir.
    G.repintandoHoja = true;
    try { body.innerHTML = s.render(); } finally { G.repintandoHoja = false; }
    body.scrollTop = st;
    if (s.footer) el.querySelector('.sheet-foot').innerHTML = s.footer();
    if (s.title && typeof s.title === 'function') el.querySelector('.sheet-title').innerHTML = s.title();
  }
  if (G.tick) G.tick();
}
export function drawLayer() {
  const layer = document.getElementById('layer'); if (!layer) return;
  const existing = new Set(stack.map(s => s.id));
  for (const el of [...layer.children]) if (!existing.has(el.id)) el.remove();
  stack.forEach((s, i) => {
    if (document.getElementById(s.id)) { document.getElementById(s.id).style.zIndex = 100 + i * 2; return; }
    const wrap = document.createElement('div');
    wrap.id = s.id; wrap.className = 'sheet-wrap size-' + (s.size || 'm') + (s.dialog ? ' is-dialog' : '');
    wrap.style.zIndex = 100 + i * 2;
    const title = typeof s.title === 'function' ? s.title() : esc(s.title || '');
    wrap.innerHTML = `<div class="sheet-backdrop" data-a="sheet.close"></div>
      <section class="sheet" role="dialog" aria-modal="true" aria-label="${attr(typeof s.title === 'string' ? s.title : '')}">
        <header class="sheet-head"><h2 class="sheet-title">${title}</h2>
        <button class="btn icon ghost" data-a="sheet.close" aria-label="Cerrar">${icon('cerrar')}</button></header>
        <div class="sheet-body">${s.render()}</div>
        <footer class="sheet-foot">${s.footer ? s.footer() : ''}</footer>
      </section>`;
    layer.appendChild(wrap);
  });
  document.body.classList.toggle('has-sheet', stack.length > 0);
}
export function topSheetEl() { const s = stack[stack.length - 1]; return s ? document.getElementById(s.id) : null; }

/** Diálogo de confirmación o de entrada. Devuelve true/false o el valor escrito (null si cancela). */
export function confirmDlg({ title = 'Confirmar', text = '', html = '', ok = 'Aceptar', cancel = 'Cancelar', danger = false, input = null, fields = null }) {
  return new Promise(resolve => {
    let done = false;
    const finish = v => { if (done) return; done = true; resolve(v); };
    const id = openSheet({
      title, size: 's', dialog: true,
      render: () => `<form data-f="dlg.submit" data-dlg="${'d' + stack.length}">
        ${text ? `<p class="dlg-text">${esc(text)}</p>` : ''}${html}
        ${input ? field({ name: '_v', type: 'text', required: true, ...input }, { _v: input.value || '' }) : ''}
        ${fields ? fieldsHtml(fields, {}) : ''}
        <div class="row end gap">${cancel ? `<button type="button" class="btn ghost" data-a="dlg.cancel">${esc(cancel)}</button>` : ''}
        <button class="btn ${danger ? 'danger' : 'primary'}" type="submit">${esc(ok)}</button></div></form>`,
      onClose: () => finish(input || fields ? null : false),
      onMount: el => {
        const form = el.querySelector('form');
        form._resolve = v => { finish(v); closeSheet(id); };
        if (input || fields) { const f = form.querySelector('input,select,textarea'); if (f) f.focus(); }
      },
      focus: false,
    });
  });
}
export function dialogSubmit(form) {
  const name = form.querySelector('[name=_v]');
  const extra = form.querySelectorAll('[data-field]');
  if (extra.length) { const vals = {}; for (const el of extra) vals[el.name] = readControl(el); form._resolve(vals); return; }
  form._resolve(name ? name.value : true);
}

// ---------------- avisos emergentes ----------------
export function toast(msg, kind = 'info', ms = 3800) {
  const box = document.getElementById('toasts'); if (!box) return;
  while (box.children.length >= 2) box.firstElementChild.remove();
  const el = document.createElement('div');
  el.className = 'toast ' + kind; el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
  el.innerHTML = `${icon(kind === 'error' ? 'alerta' : kind === 'ok' ? 'ok' : 'info')}<span>${esc(msg)}</span>`;
  box.appendChild(el);
  setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 300); }, ms);
}

// ---------------- formularios declarativos ----------------
/**
 * Campo: { name, label, type, options:[[v,l]], required, help, placeholder, min, max, step, disabled, rows, inherit }
 * Tipos: text, password, number, textarea, select, color, checkbox, checks, date, time, datetime, tags, hidden, range
 */
export function field(f, values = {}) {
  const v = values[f.name] ?? f.value ?? '';
  const id = 'f_' + f.name.replace(/[^a-z0-9_]/gi, '_');
  const req = f.required ? ' required' : '';
  const dis = f.disabled ? ' disabled' : '';
  const ph = f.placeholder ? ` placeholder="${attr(f.placeholder)}"` : '';
  const help = f.help ? `<small class="help">${esc(f.help)}</small>` : '';
  const lab = f.label ? `<label for="${id}">${esc(f.label)}${f.required ? ' <span class="req">*</span>' : ''}</label>` : '';
  const da = ` data-field="1" data-type="${f.type || 'text'}"`;
  switch (f.type) {
    case 'hidden': return `<input type="hidden" name="${attr(f.name)}" value="${attr(v)}"${da}>`;
    case 'textarea': return `<div class="fld">${lab}<textarea id="${id}" name="${attr(f.name)}" rows="${f.rows || 3}"${req}${dis}${ph}${da}>${esc(v)}</textarea>${help}</div>`;
    case 'select': return `<div class="fld">${lab}<select id="${id}" name="${attr(f.name)}"${req}${dis}${f.attrs ? ' ' + f.attrs : ''}${da}>${(f.options || []).map(([ov, ol]) => `<option value="${attr(ov)}"${String(ov) === String(v ?? '') ? ' selected' : ''}>${esc(ol)}</option>`).join('')}</select>${help}</div>`;
    case 'checkbox': return `<div class="fld check"><label class="switch"><input type="checkbox" name="${attr(f.name)}"${v === true || v === 'true' ? ' checked' : ''}${dis}${da}><span>${esc(f.label)}</span></label>${help}</div>`;
    case 'checks': {
      const set = new Set(Array.isArray(v) ? v : []);
      return `<fieldset class="fld checks"${da} data-name="${attr(f.name)}"><legend>${esc(f.label || '')}</legend><div class="chk-grid">${(f.options || []).map(([ov, ol]) => `<label class="chk"><input type="checkbox" data-group="${attr(f.name)}" value="${attr(ov)}"${set.has(ov) ? ' checked' : ''}${dis}><span>${esc(ol)}</span></label>`).join('')}</div>${help}</fieldset>`;
    }
    case 'color': return `<div class="fld">${lab}<div class="row gap"><input type="color" id="${id}" name="${attr(f.name)}" value="${attr(v || '#2E7D32')}"${dis}${da}><code class="muted">${esc(v)}</code></div>${help}</div>`;
    case 'tags': return `<div class="fld">${lab}<input id="${id}" name="${attr(f.name)}" value="${attr(Array.isArray(v) ? v.join(', ') : v)}"${req}${dis}${ph}${da}>${help || '<small class="help">Separados por comas</small>'}</div>`;
    case 'datetime': return `<div class="fld">${lab}<input type="datetime-local" id="${id}" name="${attr(f.name)}" value="${attr(v ? toLocalInput(v) : '')}"${req}${dis}${da}>${help}</div>`;
    case 'number': case 'range': return `<div class="fld">${lab}<input type="${f.type}" id="${id}" name="${attr(f.name)}" value="${attr(v)}"${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''} step="${f.step || 1}" inputmode="numeric"${req}${dis}${ph}${da}>${help}</div>`;
    default: return `<div class="fld">${lab}<input type="${f.type || 'text'}" id="${id}" name="${attr(f.name)}" value="${attr(v)}"${req}${dis}${ph}${f.autocomplete ? ` autocomplete="${f.autocomplete}"` : ''}${f.maxlength ? ` maxlength="${f.maxlength}"` : ''}${f.attrs ? ' ' + f.attrs : ''}${da}>${help}</div>`;
  }
}
export function fieldsHtml(fields, values = {}) { return fields.map(f => (typeof f === 'string' ? f : field(f, values))).join(''); }
export function toLocalInput(ms) { const d = new Date(ms); return isoDate(ms) + 'T' + fmtTime(ms); }
function readControl(el) {
  const t = el.dataset.type;
  if (t === 'checks') return $$('input[data-group]', el).filter(x => x.checked).map(x => x.value);
  if (t === 'checkbox') return el.checked;
  if (t === 'number' || t === 'range') return el.value === '' ? null : Number(el.value);
  if (t === 'tags') return el.value.split(',').map(s => s.trim()).filter(Boolean);
  if (t === 'datetime') return el.value ? new Date(el.value).getTime() : null;
  return el.value;
}
/** Lee los campos declarativos de un formulario */
export function readForm(form) {
  const out = {};
  for (const el of form.querySelectorAll('[data-field]')) {
    const name = el.name || el.dataset.name; if (!name) continue;
    out[name] = readControl(el);
  }
  return out;
}

// ---------------- avisos del sistema ----------------
/**
 * Muestra un aviso del sistema. Chrome para Android no permite `new Notification()`
 * (lanza «Illegal constructor»): allí el aviso debe mostrarlo el service worker.
 * El constructor solo se usa como alternativa en escritorio. Devuelve true si se mostró.
 */
export async function systemNotify(title, opts = {}) {
  if (!window.Notification || Notification.permission !== 'granted') return false;
  const o = { icon: 'icons/icon-192.png', lang: 'es', data: { url: location.href }, ...opts };
  try {
    const reg = navigator.serviceWorker && await navigator.serviceWorker.getRegistration();
    if (reg && reg.active) { await reg.showNotification(title, o); return true; }
  } catch (e) { console.warn('Aviso del sistema:', e); }
  try { new Notification(title, o); return true; } catch { return false; }
}

// ---------------- archivos ----------------
/** En Android el selector no reconoce extensiones propias (.ucosync, .ucobak) y deja esos
 * archivos en gris; allí se muestran todos y el contenido se valida al leerlo. */
export function fileAccept(accept, ua = navigator.userAgent) {
  return /Android/i.test(ua) && accept.split(',').some(t => t.trim().startsWith('.')) ? '' : accept;
}
export function pickFile(accept = '*/*') {
  return new Promise(resolve => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = fileAccept(accept);
    inp.onchange = () => resolve(inp.files && inp.files[0] ? inp.files[0] : null);
    inp.click();
  });
}
export function readText(file) { return file.text(); }
export async function readBytes(file) { return new Uint8Array(await file.arrayBuffer()); }

/** Guarda o comparte un archivo generado. En Android ofrece compartir (WhatsApp, correo, Drive…). */
export async function saveFile(name, data, mime = 'application/octet-stream', { share = false } = {}) {
  const blob = data instanceof Blob ? data : new Blob([data], { type: mime });
  if (G.preview) return previewSave(name, blob);
  if (share && navigator.canShare) {
    try {
      const file = new File([blob], name, { type: mime });
      if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return 'compartido'; }
    } catch (e) { if (e && e.name === 'AbortError') return 'cancelado'; }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = name; a.rel = 'noopener';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return 'descargado';
}
/** Vista previa publicada en Claude: las descargas pasan por la capacidad "downloads" del visor */
async function previewSave(name, blob) {
  const d = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('downloads') : null;
  if (!d) throw new Error('La vista previa no permite descargas. Usa la aplicación alojada.');
  try { await d.save({ filename: name, data: blob }); return 'descargado'; }
  catch (e) {
    if (e && e.code === 'declined') return 'cancelado';
    if (e && (e.code === 'rejected_extension' || e.code === 'extension_not_enabled')) throw new Error('Este tipo de archivo no se puede descargar en la vista previa');
    throw new Error('No se pudo descargar: ' + ((e && e.message) || e));
  }
}
export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); toast('Copiado', 'ok'); return true; }
  catch {
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    let ok = false; try { ok = document.execCommand('copy'); } catch { }
    ta.remove(); toast(ok ? 'Copiado' : 'No se pudo copiar', ok ? 'ok' : 'error'); return ok;
  }
}
export function fileStamp() { const d = new Date(); const p = n => String(n).padStart(2, '0'); return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes()); }
export function safeName(s) { return String(s || 'preventivo').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9_-]+/g, '_').slice(0, 40); }

// ---------------- piezas de interfaz ----------------
export function chip(text, color, cls = '') {
  return `<span class="chip ${cls}"${color ? ` style="--c:${attr(color)}"` : ''}>${esc(text)}</span>`;
}
export function empty(text, actionHtml = '') { return `<div class="empty">${icon('info')}<p>${esc(text)}</p>${actionHtml}</div>`; }
export function btn(label, a, { cls = '', ic = '', data = {}, disabled = false, title = '' } = {}) {
  const d = Object.entries(data).map(([k, v]) => ` data-${k}="${attr(v)}"`).join('');
  return `<button type="button" class="btn ${cls}" data-a="${a}"${d}${disabled ? ' disabled' : ''}${title ? ` title="${attr(title)}"` : ''}>${ic ? icon(ic) : ''}${label ? `<span>${esc(label)}</span>` : ''}</button>`;
}
export function tabs(items, active, action, extra = {}) {
  const d = Object.entries(extra).map(([k, v]) => ` data-${k}="${attr(v)}"`).join('');
  return `<div class="tabs-bar" role="tablist">${items.map(([k, l, n]) => `<button type="button" role="tab" class="tab${k === active ? ' on' : ''}" aria-selected="${k === active}" data-a="${action}" data-v="${attr(k)}"${d}>${esc(l)}${n != null ? ` <b>${n}</b>` : ''}</button>`).join('')}</div>`;
}
