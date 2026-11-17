// Capa de comandos (lógica de negocio): valida permisos y reglas de la operativa
// y genera las operaciones. Ninguna pantalla modifica datos sin pasar por aquí.
import { uid, now, clone, same, AppError, isHexColor, getPath } from './util.js';
import { require as needPerm, can } from './perms.js';
import { claveDef, baseClave, isResting, activeParts, unitLabel, avisoLabel, CATALOGOS } from './engine.js';

function mkOp(ctx, k, e, x, b) {
  return {
    id: uid('op_'), p: ctx.pid, d: ctx.device.id, dn: ctx.device.nombre || '', h: ctx.hlc.tick(), t: now(),
    u: { id: ctx.user.id, n: ctx.user.nombre }, k, e, x: clone(x), b,
  };
}
const fail = (msg, code = 'regla', extra) => { throw new AppError(msg, code, extra); };

function S(ctx) { if (!ctx.engine || !ctx.engine.state.prev) fail('No hay un preventivo abierto'); return ctx.engine.state; }
function editable(ctx) {
  const s = S(ctx);
  if (s.prev.archivado) fail('El preventivo está archivado. Recupéralo del historial para modificarlo.');
  if (s.prev.estado === 'cerrado') fail('El preventivo está cerrado. Debe reabrirse con autorización para modificarlo.');
  return s;
}
function operativo(ctx) {
  const s = editable(ctx);
  if (s.prev.estado !== 'activo') fail('Activa el preventivo para operar (avisos, claves y descansos).');
  return s;
}
function unit(s, id) { const u = s.units[id]; if (!u || u.eliminada) fail('Unidad no encontrada'); return u; }
function aviso(s, id) { const a = s.avisos[id]; if (!a) fail('Aviso no encontrado'); return a; }
function fieldsDiff(target, cambios) {
  const f = {};
  for (const [k, v] of Object.entries(cambios)) {
    const cur = getPath(target, k);
    if (!same(cur ?? null, v ?? null)) f[k] = { o: cur === undefined ? null : clone(cur), n: v === undefined ? null : clone(v) };
  }
  return f;
}
function checkInd(s, ind, exceptId) {
  const v = String(ind || '').trim();
  if (!v) fail('El identificador (indicativo) es obligatorio');
  const dup = Object.values(s.units).find(u => u.id !== exceptId && !u.eliminada && u.sit !== 'archivada' && (u.ind || '').toLowerCase() === v.toLowerCase());
  if (dup) fail('Ya existe una unidad con el identificador ' + v);
  return v;
}

// ---------------- Preventivos ----------------
export function prevCreate(ctx, { datos, cat, cfg, unidades = [], plano = null, origen = null }) {
  needPerm(ctx.user, 'preventivos.crear');
  if (!String(datos.nombre || '').trim()) fail('El nombre del preventivo es obligatorio');
  if (!['independiente', 'compartida'].includes(datos.modalidad)) fail('Selecciona la modalidad');
  if (!cat || !Array.isArray(cat.claves) || !cat.claves.some(c => c.base)) fail('Falta el catálogo de claves');
  const b = uid('b_');
  const prev = {
    nombre: String(datos.nombre).trim(), descripcion: datos.descripcion || '', fecha: datos.fecha || '', horaInicio: datos.horaInicio || '',
    horaFin: datos.horaFin || '', lugar: datos.lugar || null, modalidad: datos.modalidad, participantes: clone(datos.participantes || []),
    cfg: clone(cfg), cat: clone(cat), plano: plano ? clone(plano) : null, origen: origen ? clone(origen) : { tipo: 'nuevo' },
  };
  const ops = [mkOp(ctx, 'prev.create', ctx.pid, { prev }, b)];
  const inds = new Set();
  for (const u of unidades) {
    const ind = String(u.ind || '').trim(); if (!ind) continue;
    if (inds.has(ind.toLowerCase())) fail('Identificador de unidad repetido en la plantilla: ' + ind);
    inds.add(ind.toLowerCase());
    ops.push(mkOp(ctx, 'unit.create', uid('u_'), { u: { ...clone(u), ind } }, b));
  }
  if (datos.activar) ops.push(mkOp(ctx, 'prev.estado', ctx.pid, { o: 'preparacion', n: 'activo' }, b));
  return ops;
}

export function prevUpdate(ctx, cambios) {
  needPerm(ctx.user, 'preventivos.editar');
  const s = editable(ctx);
  if ('nombre' in cambios && !String(cambios.nombre || '').trim()) fail('El nombre es obligatorio');
  if (Object.keys(cambios).some(k => k.startsWith('cfg.descanso')) && !can(ctx.user, 'descansos.duracion')) needPerm(ctx.user, 'descansos.duracion');
  const f = fieldsDiff(s.prev, cambios);
  if (!Object.keys(f).length) return [];
  return [mkOp(ctx, 'prev.update', ctx.pid, { f }, uid('b_'))];
}

export function prevActivar(ctx) {
  needPerm(ctx.user, 'preventivos.editar');
  const s = editable(ctx);
  if (s.prev.estado !== 'preparacion') fail('El preventivo ya está activo');
  return [mkOp(ctx, 'prev.estado', ctx.pid, { o: 'preparacion', n: 'activo' }, uid('b_'))];
}

/** Comprobaciones previas al cierre */
export function closeChecks(s, t) {
  const r = { pendientes: [], activos: [], ocupadas: [], descansos: [], conflictos: [] };
  for (const a of Object.values(s.avisos)) { if (a.estado === 'pendiente') r.pendientes.push(a); else if (a.estado !== 'finalizado') r.activos.push(a); }
  for (const u of Object.values(s.units)) {
    if (u.eliminada || u.sit === 'archivada') continue;
    const def = claveDef(s.prev, u.clave);
    if (u.aviso || (def && def.categoria === 'ocupada')) r.ocupadas.push(u);
    if (isResting(u, t)) r.descansos.push(u);
  }
  r.conflictos = Object.values(s.conflicts).filter(c => c.estado === 'pendiente');
  r.total = r.pendientes.length + r.activos.length + r.ocupadas.length + r.descansos.length + r.conflictos.length;
  return r;
}

export function prevCerrar(ctx, { confirmarAdvertencias = false } = {}) {
  needPerm(ctx.user, 'preventivos.cerrar');
  const s = editable(ctx);
  const chk = closeChecks(s, now());
  if (chk.total && !confirmarAdvertencias) fail('Hay advertencias pendientes antes del cierre', 'advertencias', chk);
  const adv = chk.total ? {
    pendientes: chk.pendientes.map(avisoLabel), activos: chk.activos.map(avisoLabel), ocupadas: chk.ocupadas.map(unitLabel),
    descansos: chk.descansos.map(unitLabel), conflictos: chk.conflictos.length,
  } : null;
  return [mkOp(ctx, 'prev.estado', ctx.pid, { o: s.prev.estado, n: 'cerrado', advertencias: adv }, uid('b_'))];
}

export function prevReabrir(ctx, motivo) {
  needPerm(ctx.user, 'preventivos.reabrir');
  const s = S(ctx);
  if (s.prev.archivado) fail('Recupera primero el preventivo del archivo');
  if (s.prev.estado !== 'cerrado') fail('El preventivo no está cerrado');
  if (!String(motivo || '').trim()) fail('Indica el motivo de la reapertura');
  return [mkOp(ctx, 'prev.estado', ctx.pid, { o: 'cerrado', n: 'activo', motivo: String(motivo).trim() }, uid('b_'))];
}

export function prevArchivar(ctx, archivar) {
  needPerm(ctx.user, 'preventivos.cerrar');
  const s = S(ctx);
  if (archivar && s.prev.estado === 'activo') fail('Cierra el preventivo antes de archivarlo');
  if (!!s.prev.archivado === !!archivar) return [];
  return [mkOp(ctx, 'prev.archivo', ctx.pid, { n: !!archivar }, uid('b_'))];
}

export function catUpdate(ctx, cat, lista) {
  needPerm(ctx.user, 'config.editar');
  const s = editable(ctx);
  if (!CATALOGOS.includes(cat)) fail('Catálogo desconocido');
  const cur = s.prev.cat[cat];
  if (same(cur, lista)) return [];
  validateCatalog(cat, lista, s);
  return [mkOp(ctx, 'prev.cat', ctx.pid, { cat, o: cur, n: lista }, uid('b_'))];
}

/** Validación de catálogos (también se usa para la configuración global y plantillas) */
export function validateCatalog(cat, lista, s) {
  if (!Array.isArray(lista)) fail('Catálogo no válido');
  if (cat === 'claves') {
    const base = lista.filter(c => c.base);
    if (base.length !== 1) fail('Debe existir exactamente una clave base (C0)');
    const codes = new Set();
    for (const c of lista) {
      if (!String(c.codigo || '').trim()) fail('Todas las claves necesitan código');
      if (codes.has(c.codigo)) fail('Código de clave repetido: ' + c.codigo);
      codes.add(c.codigo);
      if (!isHexColor(c.color)) fail('Color no válido en la clave ' + c.codigo);
      if (!String(c.nombre || '').trim()) fail('La clave ' + c.codigo + ' necesita nombre');
    }
    for (const c of lista) for (const tcode of c.transiciones || []) if (!codes.has(tcode)) fail('La clave ' + c.codigo + ' tiene una transición a ' + tcode + ', que no existe');
    if (lista.filter(c => c.alAsignar).length > 1) fail('Solo una clave puede aplicarse automáticamente al asignar');
    if (s) for (const u of Object.values(s.units)) if (!u.eliminada && !codes.has(u.clave)) fail('No se puede eliminar la clave ' + u.clave + ': la usa ' + unitLabel(u));
  } else if (cat === 'motivosEsp') {
    if (lista.some(m => !String(m || '').trim())) fail('Hay motivos vacíos');
  } else {
    const ids = new Set();
    for (const it of lista) {
      if (!it.id) fail('Elemento sin identificador');
      if (ids.has(it.id)) fail('Identificador repetido en el catálogo');
      ids.add(it.id);
      if (!String(it.nombre || '').trim()) fail('Todos los elementos necesitan nombre');
    }
    if (s) {
      if (cat === 'sectores') {
        for (const u of Object.values(s.units)) if (!u.eliminada && u.sector && !ids.has(u.sector)) fail('El sector está en uso por ' + unitLabel(u));
        for (const a of Object.values(s.avisos)) if (a.sector && !ids.has(a.sector)) fail('El sector está en uso por el aviso ' + avisoLabel(a));
      }
      if (cat === 'tiposRecurso') for (const u of Object.values(s.units)) if (!u.eliminada && u.tipo && !ids.has(u.tipo)) fail('El tipo está en uso por ' + unitLabel(u));
      if (cat === 'tiposAviso') for (const a of Object.values(s.avisos)) if (a.tipo && !ids.has(a.tipo)) fail('El tipo está en uso por el aviso ' + avisoLabel(a));
    }
  }
}

export function planoSet(ctx, meta) {
  needPerm(ctx.user, 'planos.editar');
  const s = editable(ctx);
  const cur = s.prev.plano || null;
  if (same(cur, meta)) return [];
  return [mkOp(ctx, 'prev.plano', ctx.pid, { o: cur, n: meta }, uid('b_'))];
}

// ---------------- Unidades ----------------
const UNIT_EDIT = ['ind', 'nombre', 'denom', 'tipo', 'subtipo', 'categoria', 'sector', 'desc', 'obs', 'equip', 'caract', 'vis'];

export function unitCreate(ctx, d) {
  needPerm(ctx.user, 'unidades.crear');
  const s = editable(ctx);
  const ind = checkInd(s, d.ind);
  const tipo = d.tipo ? s.prev.cat.tiposRecurso.find(t => t.id === d.tipo) : null;
  const color = isHexColor(d.colorC0) ? d.colorC0 : (tipo && isHexColor(tipo.color) ? tipo.color : '#2E7D32');
  const u = {
    ind, nombre: d.nombre || '', denom: d.denom || '', tipo: d.tipo || null, subtipo: d.subtipo || '',
    categoria: d.categoria || (tipo ? tipo.categoria : ''), sector: d.sector || null, desc: d.desc || '', obs: d.obs || '',
    equip: d.equip || [], caract: d.caract || [], vis: d.vis || {}, colorC0: color, loc: d.loc || null,
  };
  return [mkOp(ctx, 'unit.create', uid('u_'), { u }, uid('b_'))];
}

export function unitUpdate(ctx, id, cambios) {
  needPerm(ctx.user, 'unidades.editar');
  const s = editable(ctx); const u = unit(s, id);
  for (const k of Object.keys(cambios)) if (!UNIT_EDIT.includes(k.split('.')[0])) fail('Campo no editable: ' + k);
  if ('ind' in cambios) cambios.ind = checkInd(s, cambios.ind, id);
  if ('tipo' in cambios && (cambios.tipo || null) !== (u.tipo || null)) needPerm(ctx.user, 'unidades.tipos');
  const f = fieldsDiff(u, cambios);
  if (!Object.keys(f).length) return [];
  return [mkOp(ctx, 'unit.update', id, { f }, uid('b_'))];
}

/** Claves a las que puede pasar la unidad (transiciones permitidas) */
export function allowedTransitions(s, u) {
  const def = claveDef(s.prev, u.clave);
  return def ? (def.transiciones || []) : [];
}

export function unitClave(ctx, id, code, { motivo = null, forzar = false } = {}) {
  needPerm(ctx.user, 'estados.cambiar');
  const s = operativo(ctx); const u = unit(s, id);
  if (u.sit !== 'activa') fail(unitLabel(u) + ' no está activa');
  if (u.clave === code) return [];
  const def = claveDef(s.prev, code); if (!def) fail('Clave inexistente');
  if (!allowedTransitions(s, u).includes(code)) {
    if (!forzar) fail('Transición no permitida: ' + u.clave + ' → ' + code, 'transicion');
    needPerm(ctx.user, 'estados.forzar');
  }
  if (def.requiereMotivo && !String(motivo || '').trim()) fail('La clave ' + code + ' requiere indicar el motivo', 'motivo');
  if (def.requiereAviso && !u.aviso) fail('La clave ' + code + ' requiere que la unidad tenga un aviso activo. Asígnala a un aviso.');
  if (def.requiereAviso && isResting(u, now())) fail(unitLabel(u) + ' está en descanso');
  return [mkOp(ctx, 'unit.clave', id, { o: u.clave, n: code, motivo: def.requiereMotivo ? String(motivo).trim() : null, forzado: !!forzar }, uid('b_'))];
}

export function unitColor(ctx, id, color) {
  needPerm(ctx.user, 'unidades.colores');
  const s = editable(ctx); const u = unit(s, id);
  const base = baseClave(s.prev);
  if (u.clave !== base.codigo) fail('El color ' + base.codigo + ' solo se puede modificar cuando la unidad está en ' + base.codigo + '.', 'color_bloqueado');
  if (!isHexColor(color)) fail('Color no válido');
  if (color.toUpperCase() === String(u.colorC0).toUpperCase()) return [];
  return [mkOp(ctx, 'unit.color', id, { o: u.colorC0, n: color.toUpperCase() }, uid('b_'))];
}

export function unitSit(ctx, id, n, motivo) {
  needPerm(ctx.user, n === 'archivada' || u_isArchived(ctx, id) ? 'unidades.archivar' : 'unidades.editar');
  const s = editable(ctx); const u = unit(s, id);
  if (u.sit === n) return [];
  if (n !== 'activa' && u.aviso) fail(unitLabel(u) + ' tiene un aviso activo. Libérala antes.');
  if (n === 'activa') checkInd(s, u.ind, u.id);
  return [mkOp(ctx, 'unit.sit', id, { o: u.sit, n, motivo: motivo || null }, uid('b_'))];
}
function u_isArchived(ctx, id) { const u = ctx.engine && ctx.engine.state.units[id]; return u && u.sit === 'archivada'; }

/** ¿Tiene actividad registrada? (entonces se archiva en lugar de eliminar) */
export function hasActivity(u) { return u.hc.length > 1 || u.ha.length > 0 || u.hr.length > 0 || u.hn.length > 0 || u.hl.length > 1; }

export function unitDelete(ctx, id) {
  needPerm(ctx.user, 'unidades.archivar');
  const s = editable(ctx); const u = unit(s, id);
  if (hasActivity(u)) fail(unitLabel(u) + ' tiene actividad registrada. Se debe archivar en lugar de eliminar.', 'actividad');
  return [mkOp(ctx, 'unit.delete', id, {}, uid('b_'))];
}

export function unitLoc(ctx, id, loc) {
  needPerm(ctx.user, 'ubicaciones.editar');
  const s = editable(ctx); const u = unit(s, id);
  const norm = l => (l && (String(l.txt || '').trim() || l.lat != null) ? { txt: String(l.txt || '').trim(), lat: l.lat ?? null, lon: l.lon ?? null } : null);
  const n = norm(loc); const cur = norm(u.loc);
  if (n && (n.lat != null) !== (n.lon != null)) fail('Coordenadas incompletas');
  if (n && n.lat != null && (Math.abs(n.lat) > 90 || Math.abs(n.lon) > 180)) fail('Coordenadas fuera de rango');
  if (same(cur, n)) return [];
  return [mkOp(ctx, 'unit.loc', id, { o: cur, n }, uid('b_'))];
}

export function unitPlan(ctx, id, pos) {
  needPerm(ctx.user, 'planos.editar');
  const s = editable(ctx); const u = unit(s, id);
  const n = pos ? { x: Math.min(1, Math.max(0, +pos.x)), y: Math.min(1, Math.max(0, +pos.y)) } : null;
  if (same(u.plan, n)) return [];
  return [mkOp(ctx, 'unit.plan', id, { o: u.plan, n }, uid('b_'))];
}

export function unitRest(ctx, id, durMin) {
  needPerm(ctx.user, 'descansos.gestionar');
  const s = operativo(ctx); const u = unit(s, id);
  const def = s.prev.cfg.descansoMin || 30;
  const dur = durMin == null ? def : Number(durMin);
  if (!(dur > 0 && dur <= 24 * 60)) fail('Duración no válida');
  if (dur !== def) needPerm(ctx.user, 'descansos.duracion');
  if (u.sit !== 'activa') fail(unitLabel(u) + ' no está activa');
  if (u.aviso) fail(unitLabel(u) + ' tiene un aviso activo: no puede iniciar un descanso.', 'descanso_aviso');
  if (isResting(u, now())) fail(unitLabel(u) + ' ya está en descanso');
  const cd = claveDef(s.prev, u.clave);
  if (cd && (cd.categoria === 'ocupada' || cd.categoria === 'fuera_servicio')) fail('No puede iniciar descanso en clave ' + u.clave + ' (' + cd.nombre + ')');
  return [mkOp(ctx, 'unit.rest', id, { dur, rid: uid('r_') }, uid('b_'))];
}

export function unitRestEnd(ctx, id, motivo = 'Manual') {
  needPerm(ctx.user, 'descansos.gestionar');
  const s = operativo(ctx); const u = unit(s, id);
  if (!isResting(u, now())) fail(unitLabel(u) + ' no está en descanso');
  return [mkOp(ctx, 'unit.restEnd', id, { rid: u.descanso.id, motivo }, uid('b_'))];
}

export function unitNota(ctx, id, txt, tipo = 'observacion') {
  needPerm(ctx.user, 'notas.crear');
  const s = editable(ctx); unit(s, id);
  if (!String(txt || '').trim()) fail('Escribe el texto');
  return [mkOp(ctx, 'unit.nota', id, { txt: String(txt).trim(), tipo }, uid('b_'))];
}

// ---------------- Avisos ----------------
export function avisoCreate(ctx, d, { unidades = [], forzarIncompatible = false } = {}) {
  needPerm(ctx.user, 'avisos.crear');
  const s = operativo(ctx);
  if (!d.tipo && !String(d.desc || '').trim()) fail('Indica el tipo o la descripción del aviso');
  const id = uid('a_'); const b = uid('b_');
  const a = { tipo: d.tipo || null, desc: String(d.desc || '').trim(), t: d.t || null, loc: d.loc || null, sector: d.sector || null, obs: d.obs || '', plan: d.plan || null };
  const op = mkOp(ctx, 'aviso.create', id, { a }, b);
  if (ctx.mode === 'compartida') { op.nn = true; op.nr = true; } else { op.nl = true; }
  const ops = [op];
  if (unidades.length) {
    needPerm(ctx.user, 'avisos.asignar');
    for (const uidv of unidades) ops.push(...assignOps(ctx, s, { id, tipo: a.tipo, finalizadoEn: null }, uidv, { forzarIncompatible }, b));
  }
  return ops;
}

export function avisoUpdate(ctx, id, cambios) {
  needPerm(ctx.user, 'avisos.editar');
  const s = editable(ctx); const a = aviso(s, id);
  const f = fieldsDiff(a, cambios);
  if (!Object.keys(f).length) return [];
  return [mkOp(ctx, 'aviso.update', id, { f }, uid('b_'))];
}

export function avisoPlan(ctx, id, pos) {
  needPerm(ctx.user, 'planos.editar');
  const s = editable(ctx); const a = aviso(s, id);
  const n = pos ? { x: Math.min(1, Math.max(0, +pos.x)), y: Math.min(1, Math.max(0, +pos.y)) } : null;
  if (same(a.plan, n)) return [];
  return [mkOp(ctx, 'aviso.plan', id, { o: a.plan, n }, uid('b_'))];
}

/** Compatibilidad entre el tipo de aviso y el tipo de recurso */
export function isCompatible(s, tipoAvisoId, u) {
  const ta = (s.prev.cat.tiposAviso || []).find(t => t.id === tipoAvisoId);
  if (!ta || !ta.compatibles || !ta.compatibles.length) return true;
  return ta.compatibles.includes(u.tipo);
}

function assignOps(ctx, s, a, unitId, { forzarIncompatible = false, terminarDescanso = false, pasarBase = false } = {}, b) {
  const u = unit(s, unitId);
  const ops = [];
  if (a.finalizadoEn != null) fail('El aviso está finalizado');
  if (u.sit !== 'activa') fail(unitLabel(u) + ' no está activa');
  if (u.aviso && u.aviso !== a.id) {
    const other = s.avisos[u.aviso];
    fail(unitLabel(u) + ' ya está asignada al aviso ' + avisoLabel(other) + '. Libérala antes de asignarla.', 'ocupada', { aviso: u.aviso });
  }
  if (u.aviso === a.id) return [];
  if (!isCompatible(s, a.tipo, u)) {
    if (!forzarIncompatible || s.prev.cfg.avisoCompatibilidadEstricta) fail(unitLabel(u) + ' no es compatible con este tipo de aviso', 'incompatible');
  }
  if (isResting(u, now())) {
    if (!terminarDescanso) fail(unitLabel(u) + ' está en descanso', 'descanso', { unit: u.id });
    needPerm(ctx.user, 'descansos.gestionar');
    ops.push(mkOp(ctx, 'unit.restEnd', u.id, { rid: u.descanso.id, motivo: 'Asignación a aviso' }, b));
  }
  const def = claveDef(s.prev, u.clave);
  if (def && def.categoria !== 'disponible') {
    if (!pasarBase) fail(unitLabel(u) + ' no está disponible (clave ' + u.clave + ' ' + def.nombre + ')', 'no_disponible', { clave: u.clave });
    needPerm(ctx.user, 'estados.cambiar');
    const base = baseClave(s.prev);
    const permitido = (def.transiciones || []).includes(base.codigo);
    if (!permitido) needPerm(ctx.user, 'estados.forzar');
    ops.push(mkOp(ctx, 'unit.clave', u.id, { o: u.clave, n: base.codigo, motivo: null, forzado: !permitido }, b));
  }
  ops.push(mkOp(ctx, 'aviso.asig', a.id, { u: u.id }, b));
  return ops;
}

export function avisoAsignar(ctx, id, unitId, opts = {}) {
  needPerm(ctx.user, 'avisos.asignar');
  const s = operativo(ctx); const a = aviso(s, id);
  return assignOps(ctx, s, a, unitId, opts, uid('b_'));
}

export function avisoLiberar(ctx, id, unitId, motivo) {
  needPerm(ctx.user, 'avisos.asignar');
  const s = operativo(ctx); const a = aviso(s, id); const u = unit(s, unitId);
  if (!a.part.some(p => p.u === u.id && p.lib == null)) fail(unitLabel(u) + ' no está asignada a este aviso');
  return [mkOp(ctx, 'aviso.lib', id, { u: unitId, motivo: motivo || 'Liberada por el operador' }, uid('b_'))];
}

export function avisoFinalizar(ctx, id, { nota = '', liberarUnidades = false } = {}) {
  needPerm(ctx.user, 'avisos.finalizar');
  const s = operativo(ctx); const a = aviso(s, id);
  if (a.finalizadoEn != null) fail('El aviso ya está finalizado');
  const ocupadas = activeParts(a).map(p => s.units[p.u]).filter(u => { const d = claveDef(s.prev, u.clave); return d && d.requiereAviso; });
  if (ocupadas.length && !liberarUnidades) fail('Unidades todavía asignadas: ' + ocupadas.map(unitLabel).join(', '), 'unidades_activas', { unidades: ocupadas.map(u => u.id) });
  return [mkOp(ctx, 'aviso.estado', id, { o: a.estado, n: 'finalizado', nota: String(nota || '').trim() }, uid('b_'))];
}

export function avisoReabrir(ctx, id, motivo) {
  needPerm(ctx.user, 'avisos.finalizar');
  const s = operativo(ctx); const a = aviso(s, id);
  if (a.finalizadoEn == null) fail('El aviso no está finalizado');
  if (!String(motivo || '').trim()) fail('Indica el motivo de la reapertura');
  return [mkOp(ctx, 'aviso.estado', id, { o: 'finalizado', n: a.enCursoEn != null ? 'en_curso' : 'pendiente', motivo: String(motivo).trim() }, uid('b_'))];
}

export function avisoEnCurso(ctx, id) {
  needPerm(ctx.user, 'avisos.asignar');
  const s = operativo(ctx); const a = aviso(s, id);
  if (a.finalizadoEn != null || a.enCursoEn != null) return [];
  return [mkOp(ctx, 'aviso.estado', id, { o: a.estado, n: 'en_curso' }, uid('b_'))];
}

export function avisoNota(ctx, id, txt) {
  needPerm(ctx.user, 'notas.crear');
  const s = editable(ctx); aviso(s, id);
  if (!String(txt || '').trim()) fail('Escribe el texto');
  return [mkOp(ctx, 'aviso.nota', id, { txt: String(txt).trim() }, uid('b_'))];
}

// ---------------- Conflictos ----------------
export function resolverConflicto(ctx, conflictId, decision, valores) {
  needPerm(ctx.user, 'conflictos.resolver');
  const s = editable(ctx);
  const c = s.conflicts[conflictId];
  if (!c || c.estado !== 'pendiente') fail('El conflicto ya no está pendiente');
  if (!['aceptar', 'descartar'].includes(decision)) fail('Decisión no válida');
  return [mkOp(ctx, 'conf.resolve', ctx.pid, { op: conflictId, d: decision, valores: valores || null }, uid('b_'))];
}
