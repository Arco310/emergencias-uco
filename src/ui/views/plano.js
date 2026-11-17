// Plano táctico: imagen importada (funciona sin Internet), zoom, desplazamiento y
// colocación de unidades y avisos. Las posiciones se guardan como operaciones.
import { G, A, F, CH, filt } from '../state.js';
import { esc, attr, toast, confirmDlg, btn, empty, pickFile, readBytes, closeSheet } from '../dom.js';
import { icon, unitSvg, SIZE_PX } from '../icons.js';
import { now } from '../../core/util.js';
import { liveUnits, unitLabel, claveDef } from '../../core/engine.js';
import { unitVisual, effectiveVis } from '../../core/visual.js';
import * as C from '../../core/commands.js';
import { openUnit, openAviso, avisoNumber } from './ops.js';

const urls = new Map();     // blobId → objectURL
const loading = new Set();
const VT = {};              // pid → { x, y, k }
const S = () => G.core.state;
const P = () => G.core.state.prev;
const can = p => G.core.can(p);
const editable = () => P().estado !== 'cerrado' && !P().archivado;

function blobUrl(id) {
  if (urls.has(id)) return urls.get(id);
  if (!loading.has(id)) {
    loading.add(id);
    G.core.repo.getBlob(id).then(b => {
      loading.delete(id);
      if (b) { urls.set(id, URL.createObjectURL(new Blob([b.bytes], { type: b.mime || 'image/png' }))); G.render(); }
      else { urls.set(id, null); G.render(); }
    }).catch(() => { loading.delete(id); });
  }
  return undefined;
}

export function renderPlano() {
  const p = P(); const s = S(); const f = filt('plano'); const t = now();
  const canEdit = editable() && can('planos.editar');
  const plano = p.plano;
  const tools = `<div class="toolbar plan-tools">
    ${canEdit ? btn(plano ? 'Cambiar imagen' : 'Importar plano', 'plan.import', { ic: 'subir', cls: plano ? '' : 'primary' }) : ''}
    ${plano && canEdit ? btn(f.edit ? 'Terminar edición' : 'Colocar y mover', 'plan.edit', { ic: f.edit ? 'ok' : 'editar', cls: f.edit ? 'primary' : '' }) : ''}
    ${plano ? `${btn('', 'plan.zoom', { ic: 'zoomin', data: { v: 1.4 }, title: 'Ampliar' })}${btn('', 'plan.zoom', { ic: 'zoomout', data: { v: 0.71 }, title: 'Reducir' })}${btn('', 'plan.fit', { ic: 'ajustar', title: 'Ajustar' })}
    <label class="switch sm"><input type="checkbox" data-c="plan.layer" data-v="avisos"${f.hideAvisos ? '' : ' checked'}><span>Avisos</span></label>
    <label class="switch sm"><input type="checkbox" data-c="plan.layer" data-v="labels"${f.hideLabels ? '' : ' checked'}><span>Etiquetas</span></label>` : ''}
  </div>`;
  if (!plano) return tools + empty('No hay plano táctico. Importa una imagen (foto o captura del recinto). Funcionará sin Internet.');
  const url = blobUrl(plano.blob);
  if (url === undefined) return tools + `<div class="empty">${icon('plano')}<p>Cargando plano…</p></div>`;
  if (url === null) return tools + empty('La imagen del plano no está en este dispositivo todavía. Se descargará al sincronizar.');
  const units = liveUnits(s).filter(u => u.sit !== 'archivada');
  const placed = units.filter(u => u.plan && effectiveVis(p, u).enPlano !== false);
  const unplaced = units.filter(u => !u.plan);
  const avisos = f.hideAvisos ? [] : Object.values(s.avisos).filter(a => a.plan && a.estado !== 'finalizado');
  const placing = f.place ? s.units[f.place] : null;
  const placingAviso = f.placeAviso ? s.avisos[f.placeAviso] : null;
  const markers = placed.map(u => {
    const v = unitVisual(p, u, t); const vis = effectiveVis(p, u);
    const label = f.hideLabels || vis.etiqueta === 'ninguna' ? '' : vis.etiqueta === 'nombre' ? (u.nombre || u.ind) : vis.etiqueta === 'ambos' ? u.ind + (u.nombre ? ' · ' + u.nombre : '') : u.ind;
    return `<div class="mk${f.focus === u.id ? ' focus' : ''}" data-mk="u" data-id="${u.id}" style="left:${u.plan.x * plano.w}px;top:${u.plan.y * plano.h}px">${unitSvg(v, { px: SIZE_PX[v.tam] || 38, title: unitLabel(u) })}${label ? `<span class="mk-l">${esc(label)}</span>` : ''}</div>`;
  }).join('') + avisos.map(a => `<div class="mk av est-${a.estado}" data-mk="a" data-id="${a.id}" style="left:${a.plan.x * plano.w}px;top:${a.plan.y * plano.h}px"><span class="mk-av">!</span><span class="mk-l">${esc(avisoNumber(a))}</span></div>`).join('');
  return `${tools}
  ${placingAviso ? `<div class="banner info">${icon('pin')}<div>Toca en el plano para situar el aviso <b>${esc(avisoNumber(placingAviso))}</b>.</div>${btn('Cancelar', 'plan.cancelPlace', { cls: 'ghost' })}</div>` : ''}
  ${f.edit ? `<div class="banner info">${icon('info')}<div>${placing ? `Toca en el plano para colocar <b>${esc(placing.ind)}</b>.` : 'Arrastra las unidades para moverlas. Elige una unidad sin posición para colocarla. Mantén pulsada una unidad para quitarla del plano.'}</div></div>
    ${unplaced.length ? `<div class="chips-row">${unplaced.map(u => `<button class="uchip${f.place === u.id ? ' on' : ''}" data-a="plan.pick" data-id="${u.id}" style="--bc:${attr(u.colorC0)}">${unitSvg(unitVisual(p, u, t), { px: 22 })}${esc(u.ind)}</button>`).join('')}</div>` : '<p class="muted small">Todas las unidades están colocadas.</p>'}` : ''}
  <div class="plan-view${f.edit || placingAviso ? ' editing' : ''}" id="pv">
    <div class="plan-c" id="pc" style="width:${plano.w}px;height:${plano.h}px">
      <img src="${attr(url)}" alt="Plano táctico" width="${plano.w}" height="${plano.h}" draggable="false" id="pimg">
      ${markers}
    </div>
  </div>
  <div class="legend">${p.cat.claves.map(c => `<span><i style="background:${attr(c.color)}"></i>${esc(c.codigo)} ${esc(c.nombre)}</span>`).join('')}<span><i style="background:#9E9E9E"></i>Descanso</span></div>`;
}

function vt() { const pid = G.core.cur; return VT[pid] || null; }
function applyVT() {
  const pc = document.getElementById('pc'); const v = vt(); if (!pc || !v) return;
  pc.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.k})`;
  pc.style.setProperty('--ik', String(1 / v.k));
}
function fit() {
  const pv = document.getElementById('pv'); const plano = P().plano; if (!pv || !plano) return;
  const W = pv.clientWidth, H = pv.clientHeight;
  const k = Math.min(W / plano.w, H / plano.h) * 0.96;
  VT[G.core.cur] = { k, x: (W - plano.w * k) / 2, y: (H - plano.h * k) / 2 };
  applyVT();
}
function zoomAt(factor, cx, cy) {
  const v = vt(); if (!v) return;
  const k2 = Math.min(12, Math.max(0.05, v.k * factor));
  const f = k2 / v.k;
  v.x = cx - (cx - v.x) * f; v.y = cy - (cy - v.y) * f; v.k = k2; applyVT();
}
function relPos(ev) {
  const img = document.getElementById('pimg'); const r = img.getBoundingClientRect();
  return { x: (ev.clientX - r.left) / r.width, y: (ev.clientY - r.top) / r.height };
}

export function afterRender() {
  const pv = document.getElementById('pv'); if (!pv) return;
  if (!vt()) fit(); else applyVT();
  const f = filt('plano');
  if (f.focus && vt()) {
    const u = S().units[f.focus];
    if (u && u.plan) { const plano = P().plano; const v = vt(); v.x = pv.clientWidth / 2 - u.plan.x * plano.w * v.k; v.y = pv.clientHeight / 2 - u.plan.y * plano.h * v.k; applyVT(); }
  }
  const pts = new Map(); let pan = null, pinch = null, drag = null, longT = null;
  pv.addEventListener('pointerdown', ev => {
    pv.setPointerCapture(ev.pointerId);
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    const mk = ev.target.closest('[data-mk]');
    if (pts.size === 2) { drag = null; pan = null; clearTimeout(longT); const [a, b] = [...pts.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 }; return; }
    if (mk) {
      drag = { el: mk, kind: mk.dataset.mk, id: mk.dataset.id, x0: ev.clientX, y0: ev.clientY, moved: false };
      if (f.edit && mk.dataset.mk === 'u') longT = setTimeout(() => { if (drag && !drag.moved) { const id = drag.id; drag = null; removeFromPlan(id); } }, 700);
    } else pan = { x0: ev.clientX, y0: ev.clientY, vx: vt().x, vy: vt().y, moved: false };
  });
  pv.addEventListener('pointermove', ev => {
    if (!pts.has(ev.pointerId)) return;
    pts.set(ev.pointerId, { x: ev.clientX, y: ev.clientY });
    if (pinch && pts.size === 2) {
      const [a, b] = [...pts.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      const r = pv.getBoundingClientRect();
      zoomAt(d / pinch.d, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top); pinch.d = d; return;
    }
    if (drag) {
      const dx = ev.clientX - drag.x0, dy = ev.clientY - drag.y0;
      if (Math.hypot(dx, dy) > 6) { drag.moved = true; clearTimeout(longT); }
      if (drag.moved && f.edit && can('planos.editar')) {
        const p = relPos(ev); const plano = P().plano;
        drag.el.style.left = Math.min(1, Math.max(0, p.x)) * plano.w + 'px'; drag.el.style.top = Math.min(1, Math.max(0, p.y)) * plano.h + 'px';
        drag.pos = p;
      }
      return;
    }
    if (pan) {
      const dx = ev.clientX - pan.x0, dy = ev.clientY - pan.y0;
      if (Math.hypot(dx, dy) > 4) pan.moved = true;
      const v = vt(); v.x = pan.vx + dx; v.y = pan.vy + dy; applyVT();
    }
  });
  const up = async ev => {
    pts.delete(ev.pointerId); clearTimeout(longT);
    if (pinch) { if (pts.size < 2) pinch = null; return; }
    const d = drag, p0 = pan; drag = null; pan = null;
    try {
      if (d) {
        if (d.moved && d.pos && f.edit) {
          if (d.kind === 'u') await G.core.exec(C.unitPlan, d.id, d.pos); else await G.core.exec(C.avisoPlan, d.id, d.pos);
        } else if (!d.moved) { if (d.kind === 'u') openUnit(d.id); else openAviso(d.id); }
        return;
      }
      if (p0 && !p0.moved && ev.type === 'pointerup') {
        const pos = relPos(ev); if (pos.x < 0 || pos.y < 0 || pos.x > 1 || pos.y > 1) return;
        if (f.placeAviso) { const id = f.placeAviso; f.placeAviso = null; await G.core.exec(C.avisoPlan, id, pos); toast('Aviso situado en el plano', 'ok'); openAviso(id); return; }
        if (f.edit && f.place) {
          const id = f.place; await G.core.exec(C.unitPlan, id, pos);
          const next = liveUnits(S()).find(u => !u.plan && u.sit !== 'archivada' && u.id !== id);
          f.place = next ? next.id : null; G.render();
        }
      }
    } catch (e) { toast(e.message, 'error'); G.render(); }
  };
  pv.addEventListener('pointerup', up); pv.addEventListener('pointercancel', up);
  pv.addEventListener('wheel', ev => { ev.preventDefault(); const r = pv.getBoundingClientRect(); zoomAt(ev.deltaY < 0 ? 1.15 : 0.87, ev.clientX - r.left, ev.clientY - r.top); }, { passive: false });
}
async function removeFromPlan(id) {
  const u = S().units[id];
  if (!(await confirmDlg({ title: 'Quitar del plano', text: '¿Quitar ' + unitLabel(u) + ' del plano táctico?', ok: 'Quitar' }))) return;
  await G.core.exec(C.unitPlan, id, null);
}

A['plan.zoom'] = el => { const pv = document.getElementById('pv'); if (pv) zoomAt(Number(el.dataset.v), pv.clientWidth / 2, pv.clientHeight / 2); };
A['plan.fit'] = () => { filt('plano').focus = null; fit(); };
A['plan.edit'] = () => { const f = filt('plano'); f.edit = !f.edit; f.place = null; G.render(); };
A['plan.pick'] = el => { const f = filt('plano'); f.place = f.place === el.dataset.id ? null : el.dataset.id; G.render(); };
A['plan.cancelPlace'] = () => { filt('plano').placeAviso = null; G.render(); };
CH['plan.layer'] = el => { const f = filt('plano'); if (el.dataset.v === 'avisos') f.hideAvisos = !el.checked; else f.hideLabels = !el.checked; G.render(); };
A['plan.import'] = async () => {
  const file = await pickFile('image/*'); if (!file) return;
  if (P().plano && !(await confirmDlg({ title: 'Cambiar plano', text: 'La imagen actual se sustituye; las posiciones relativas de las unidades se conservan. El cambio queda registrado.', ok: 'Cambiar' }))) return;
  const { bytes, w, h, mime } = await prepareImage(file);
  const id = await G.core.repo.putBlob(bytes, { mime, w, h, nombre: file.name });
  await G.core.exec(C.planoSet, { blob: id, w, h, mime, nombre: file.name });
  VT[G.core.cur] = null; toast('Plano importado', 'ok'); G.render();
};
/** Reduce imágenes muy grandes para no saturar el almacenamiento del dispositivo */
async function prepareImage(file) {
  const raw = await readBytes(file);
  const bmp = await createImageBitmap(new Blob([raw], { type: file.type || 'image/png' }));
  const MAX = 4096; let w = bmp.width, h = bmp.height;
  if (Math.max(w, h) <= MAX && raw.length < 6 * 1024 * 1024) return { bytes: raw, w, h, mime: file.type || 'image/png' };
  const k = Math.min(1, MAX / Math.max(w, h)); w = Math.round(w * k); h = Math.round(h * k);
  const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
  cv.getContext('2d').drawImage(bmp, 0, 0, w, h);
  const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.88));
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w, h, mime: 'image/jpeg' };
}
