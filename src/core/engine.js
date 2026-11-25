// Motor del preventivo: reconstruye el estado aplicando el registro de operaciones
// en orden HLC. Es determinista: cualquier dispositivo con el mismo conjunto de
// operaciones obtiene exactamente el mismo estado y los mismos conflictos.
//
// Reglas críticas implementadas aquí (además de en la capa de comandos):
//  - Color C0: solo se modifica estando en la clave base (C0).
//  - Descanso: imposible con aviso activo; la unidad en descanso no es asignable.
//  - Claves que requieren aviso, claves que liberan el aviso, motivo obligatorio.
//  - Preventivo cerrado o archivado: no admite cambios operativos.
//  - Modificaciones simultáneas: nunca se sobrescriben en silencio (conflicto).
import { clone, same, getPath, setPath } from './util.js';
import { DEFAULT_CATEGORIAS_PUNTO } from './defaults.js';

export class Reject extends Error {
  constructor(msg, detail) { super(msg); this.detail = detail; }
}

const CLOSED_OK = new Set(['prev.estado', 'prev.archivo']);
// Registro de informes (1.5.0): se genera al finalizar y se consulta después, también archivado; no cambia nada operativo
const SIEMPRE_OK = new Set(['informe.reg']);
const PREV_FIELDS = /^(nombre|descripcion|fecha|horaInicio|horaFin|lugar|participantes|modalidad|cfg\.[A-Za-z0-9_.]+)$/;
const UNIT_FIELDS = /^(ind|nombre|denom|tipo|subtipo|categoria|sector|sectorOtro|desc|obs|equip|caract|vis(\.[A-Za-z0-9_]+)?)$/;
/** Sector «OTROS»: ubicación personalizada de una unidad dentro del preventivo, sin crear categorías globales */
export const SECTOR_OTROS = 'otros';
/** Nombre del sector de una unidad (o aviso) teniendo en cuenta OTROS y la ausencia de sector */
export function sectorNombre(p, x, vacio = '') {
  if (!x || !x.sector) return vacio;
  if (x.sector === SECTOR_OTROS) return 'Otros: ' + (x.sectorOtro || 'sin indicar');
  const sec = ((p && p.cat && p.cat.sectores) || []).find(e => e.id === x.sector);
  return sec ? sec.nombre : x.sector;
}
const AVISO_FIELDS = /^(tipo|desc|t|loc|sector|obs|zona|cierre\.[a-z]+)$/;
export const CATALOGOS = ['claves', 'motivosEsp', 'sectores', 'tiposAviso', 'tiposRecurso', 'categoriasPunto', 'puntos'];

export function emptyState() {
  // numAviso: índice número → aviso, para detectar duplicados sin recorrer todos los avisos
  return { prev: null, units: {}, avisos: {}, conflicts: {}, maxNum: 0, lastT: 0, numAviso: {}, revisiones: {}, informes: [] };
}

// ---------- utilidades de consulta ----------
export function claveDef(prev, code) { return (prev && prev.cat && prev.cat.claves || []).find(c => c.codigo === code) || null; }
export function baseClave(prev) { return (prev && prev.cat && prev.cat.claves || []).find(c => c.base) || { codigo: 'C0', nombre: 'Disponible', categoria: 'disponible', base: true }; }
export function alAsignarClave(prev) { return (prev && prev.cat && prev.cat.claves || []).find(c => c.alAsignar) || null; }
export function isResting(u, t) { const d = u && u.descanso; return !!(d && d.fin == null && t < d.finPrev); }
export function restEnd(d) { return d ? (d.fin != null ? d.fin : d.finPrev) : null; }
export function activePart(a, uid) { return a.part.find(p => p.u === uid && p.lib == null) || null; }
export function activeParts(a) { return a.part.filter(p => p.lib == null); }
export function unitLabel(u) { return u ? (u.ind || u.nombre || u.id) : '?'; }
export function avisoLabel(a) { return a ? (a.num != null ? 'Nº ' + a.num : (a.ref ? a.ref + ' (prov.)' : 'sin número')) : '?'; }

/** Situación operativa resumida de una unidad en el instante t */
export function unitSituation(s, u, t) {
  if (u.eliminada) return 'eliminada';
  if (u.sit === 'archivada') return 'archivada';
  if (u.sit === 'desactivada') return 'fuera';
  if (isResting(u, t)) return 'descanso';
  const def = claveDef(s.prev, u.clave);
  if (u.aviso) return 'ocupada';
  if (!def) return 'ocupada';
  if (def.categoria === 'fuera_servicio') return 'fuera';
  if (def.categoria === 'no_disponible') return 'especial';
  if (def.categoria === 'ocupada') return 'ocupada';
  return 'disponible';
}
export const SITUACION_LABEL = {
  disponible: 'Disponible', ocupada: 'Ocupada', descanso: 'En descanso', especial: 'Clave especial',
  fuera: 'Fuera de servicio', archivada: 'Archivada', eliminada: 'Eliminada',
};

export function liveUnits(s) { return Object.values(s.units).filter(u => !u.eliminada && u.sit !== 'archivada'); }

/** Indicadores del centro de control */
export function counts(s, t) {
  const r = { total: 0, disponibles: 0, ocupadas: 0, descanso: 0, especial: 0, fuera: 0, pendientes: 0, activos: 0, finalizados: 0, porSector: {} };
  for (const u of liveUnits(s)) {
    r.total++;
    const k = unitSituation(s, u, t);
    if (k === 'disponible') r.disponibles++; else if (k === 'ocupada') r.ocupadas++; else if (k === 'descanso') r.descanso++;
    else if (k === 'especial') r.especial++; else if (k === 'fuera') r.fuera++;
    const sec = u.sector || '_';
    const ps = r.porSector[sec] || (r.porSector[sec] = { total: 0, disponibles: 0 });
    ps.total++; if (k === 'disponible') ps.disponibles++;
  }
  for (const a of Object.values(s.avisos)) {
    if (a.estado === 'finalizado') r.finalizados++; else if (a.estado === 'pendiente') r.pendientes++; else r.activos++;
  }
  return r;
}

// ---------- utilidades internas ----------
function getUnit(s, id) {
  const u = s.units[id]; if (!u) throw new Reject('Unidad inexistente');
  if (u.eliminada) throw new Reject('La unidad ' + unitLabel(u) + ' fue eliminada');
  return u;
}
function getAviso(s, id) { const a = s.avisos[id]; if (!a) throw new Reject('Aviso inexistente'); return a; }

function applyFields(target, f, allowed) {
  for (const path of Object.keys(f || {})) if (!allowed.test(path)) throw new Reject('Campo no modificable: ' + path);
  const conflicts = []; let changed = 0;
  for (const [path, ch] of Object.entries(f || {})) {
    const cur = getPath(target, path);
    if (same(cur, ch.o)) { setPath(target, path, clone(ch.n)); changed++; }
    else if (same(cur, ch.n)) { /* el mismo cambio ya está aplicado */ }
    else conflicts.push({ campo: path, actual: clone(cur ?? null), propuesto: clone(ch.n ?? null), anterior: clone(ch.o ?? null) });
  }
  return { conflicts, changed };
}

function setClave(s, u, code, t, motivo, op, auto) {
  const old = claveDef(s.prev, u.clave); const def = claveDef(s.prev, code);
  u.clave = code; u.claveDesde = t; u.motivoEsp = def && def.requiereMotivo ? (motivo || null) : null;
  u.hc.push({ t, c: code, m: motivo || null, op: op.id, auto: auto || null });
  if (u.aviso) {
    const a = s.avisos[u.aviso]; const p = a && activePart(a, u.id);
    if (a && p) {
      if (old && old.llegada && !(def && def.llegada)) { p.salida = t; a.salidaPuntoEn = Math.max(a.salidaPuntoEn || 0, t); }
      if (def && def.llegada && p.llegada == null) { p.llegada = t; if (a.llegadaEn == null) a.llegadaEn = t; }
      if (def && def.avisoEnCurso && a.enCursoEn == null) a.enCursoEn = t;
      if (def && def.liberaAviso) releasePart(s, a, u, t, 'Clave ' + code);
      avisoEstado(s, a, t);
    }
  }
}

function releasePart(s, a, u, t, motivo) {
  const p = activePart(a, u.id); if (!p) return;
  const cur = claveDef(s.prev, u.clave);
  if (cur && cur.llegada && p.salida == null) { p.salida = t; a.salidaPuntoEn = Math.max(a.salidaPuntoEn || 0, t); }
  p.lib = t; p.motivoLib = motivo || null;
  if (u.aviso === a.id) u.aviso = null;
  if (!activeParts(a).length && s.prev.cfg && s.prev.cfg.autoFinalizarAviso && a.enCursoEn != null && a.finalizadoEn == null) {
    a.finalizadoEn = t; a.finAuto = true;
  }
}

function avisoEstado(s, a, t) {
  let e;
  if (a.finalizadoEn != null) e = 'finalizado';
  else if (a.enCursoEn != null) e = 'en_curso';
  else if (activeParts(a).length) e = 'asignado';
  else e = 'pendiente';
  if (e !== a.estado) { a.hist.push({ t, o: a.estado, n: e }); a.estado = e; }
}

function registerConflict(s, op, tipo, motivo, detalle) {
  s.conflicts[op.id] = {
    id: op.id, k: op.k, e: op.e, t: op.t, h: op.h, dev: op.dn || op.d, usuario: op.u ? op.u.n : '',
    tipo, motivo, detalle: detalle == null ? null : clone(detalle), estado: 'pendiente',
  };
}

// ---------- manejadores por tipo de operación ----------
const H = {};

H['prev.create'] = (s, op) => {
  if (s.prev) throw new Reject('El preventivo ya existe');
  const p = clone(op.x.prev);
  p.id = op.p; p.creado = op.t; p.creadoPor = op.u ? op.u.n : '';
  p.estado = 'preparacion'; p.archivado = false; p.reaperturas = [];
  p.cfg = p.cfg || {}; p.cat = p.cat || {};
  if (!Array.isArray(p.cat.categoriasPunto)) p.cat.categoriasPunto = clone(DEFAULT_CATEGORIAS_PUNTO); // preventivos anteriores a la 1.5.0
  for (const c of CATALOGOS) if (!Array.isArray(p.cat[c])) p.cat[c] = [];
  if (!p.cat.claves.some(c => c.base)) throw new Reject('El catálogo de claves no tiene clave base (C0)');
  s.prev = p;
};

// Revisión de una incoherencia detectada (1.5.0): queda en el preventivo con su historial; no cambia nada más
/** Registro de informes (1.5.0): versiones generadas, exportaciones y consultas. Solo añade; nunca cambia lo operativo */
H['informe.reg'] = (s, op) => {
  const x = op.x || {};
  const r = { id: op.id, accion: x.accion, formato: x.formato || null, t: op.t, por: op.u ? op.u.n : '', dev: op.dn || op.d || '' };
  for (const k of ['n', 'hash', 'motivo', 'provisional', 'pendientes', 'conflictos', 'nOps']) if (x[k] != null) r[k] = x[k];
  s.informes = [...(s.informes || []), r];
};
H['revision.set'] = (s, op) => {
  const x = op.x || {}; if (!x.id || !x.firma) throw new Reject('Revisión no válida');
  s.revisiones = s.revisiones || {};
  const cur = s.revisiones[x.id]; const base = cur && cur.firma === x.firma ? cur : { id: x.id, firma: x.firma, regla: x.regla || '', entidad: x.entidad || null, hist: [] };
  const e = { t: op.t, por: op.u ? op.u.n : '', estado: x.estado, nota: x.nota || '', asignadoA: x.asignadoA || null };
  s.revisiones[x.id] = { ...base, estado: x.estado, nota: x.nota || '', asignadoA: x.asignadoA || (x.estado === 'asignada' ? null : base.asignadoA || null), t: op.t, por: e.por, hist: [...base.hist, e] };
};

H['prev.update'] = (s, op) => {
  const r = applyFields(s.prev, op.x.f, PREV_FIELDS);
  return { fieldConflicts: r.conflicts, noop: !r.changed && !r.conflicts.length };
};

const PREV_TRANS = { preparacion: ['activo', 'cerrado'], activo: ['cerrado'], cerrado: ['activo'] };
H['prev.estado'] = (s, op) => {
  const p = s.prev; const { o, n, motivo } = op.x;
  if (p.estado !== o) {
    if (p.estado === n) return { noop: true };
    throw new Reject('Cambio de estado simultáneo del preventivo (actual: ' + p.estado + ')');
  }
  if (!(PREV_TRANS[o] || []).includes(n)) throw new Reject('Transición de preventivo no permitida: ' + o + ' → ' + n);
  if (p.archivado) throw new Reject('El preventivo está archivado');
  if (o === 'cerrado' && n === 'activo') {
    if (!motivo) throw new Reject('La reapertura requiere motivo');
    p.reaperturas.push({ t: op.t, por: op.u ? op.u.n : '', motivo });
  }
  p.estado = n;
  if (n === 'activo' && p.activadoEn == null) p.activadoEn = op.t;
  if (n === 'cerrado') { p.cerradoEn = op.t; p.cerradoPor = op.u ? op.u.n : ''; p.cierreAvisos = op.x.advertencias || null; }
};

H['prev.archivo'] = (s, op) => {
  const p = s.prev; const n = !!op.x.n;
  if (p.archivado === n) return { noop: true };
  if (n && p.estado === 'activo') throw new Reject('Cierra el preventivo antes de archivarlo');
  p.archivado = n; p.archivadoEn = n ? op.t : null;
};

H['prev.cat'] = (s, op) => {
  const { cat, o, n } = op.x;
  if (!CATALOGOS.includes(cat)) throw new Reject('Catálogo desconocido');
  const cur = s.prev.cat[cat];
  if (!same(cur, o)) {
    if (same(cur, n)) return { noop: true };
    return { fieldConflicts: [{ campo: 'cat.' + cat, actual: clone(cur), propuesto: clone(n), anterior: clone(o) }] };
  }
  if (cat === 'claves') {
    if (!n.some(c => c.base)) throw new Reject('Debe existir la clave base (C0)');
    const codes = new Set(n.map(c => c.codigo));
    if (codes.size !== n.length) throw new Reject('Códigos de clave duplicados');
    for (const u of Object.values(s.units)) if (!u.eliminada && !codes.has(u.clave)) throw new Reject('La clave ' + u.clave + ' está en uso por ' + unitLabel(u));
  }
  s.prev.cat[cat] = clone(n);
};

H['prev.plano'] = (s, op) => {
  const cur = s.prev.plano || null;
  if (!same(cur, op.x.o)) {
    if (same(cur, op.x.n)) return { noop: true };
    return { fieldConflicts: [{ campo: 'plano', actual: clone(cur), propuesto: clone(op.x.n), anterior: clone(op.x.o) }] };
  }
  s.prev.plano = clone(op.x.n);
};

H['unit.create'] = (s, op) => {
  const d = op.x.u;
  if (s.units[op.e]) throw new Reject('La unidad ya existe');
  const base = baseClave(s.prev).codigo;
  const u = {
    id: op.e, ind: d.ind || '', nombre: d.nombre || '', denom: d.denom || '', tipo: d.tipo || null, subtipo: d.subtipo || '',
    categoria: d.categoria || '', sector: d.sector || null, sectorOtro: d.sector === SECTOR_OTROS ? String(d.sectorOtro || '') : '', desc: d.desc || '', obs: d.obs || '',
    equip: clone(d.equip || []), caract: clone(d.caract || []), vis: clone(d.vis || {}), plantilla: d.plantilla ? clone(d.plantilla) : null,
    colorC0: d.colorC0 || '#2E7D32', clave: base, claveDesde: op.t, motivoEsp: null,
    sit: 'activa', aviso: null, descanso: null, loc: d.loc ? { ...clone(d.loc), t: op.t } : null, plan: d.plan ? clone(d.plan) : null,
    creada: op.t, eliminada: false,
    hc: [{ t: op.t, c: base, m: null, op: op.id }], hs: [{ t: op.t, s: 'activa' }], hr: [], hl: d.loc ? [{ t: op.t, ...clone(d.loc), op: op.id }] : [],
    ha: [], hn: [],
  };
  s.units[u.id] = u;
  const dup = u.ind && Object.values(s.units).find(x => x !== u && !x.eliminada && x.sit !== 'archivada' && x.ind && x.ind.toLowerCase() === u.ind.toLowerCase());
  if (dup) return { warning: 'Indicativo duplicado: ' + u.ind };
};

H['unit.update'] = (s, op) => {
  const u = getUnit(s, op.e);
  const r = applyFields(u, op.x.f, UNIT_FIELDS);
  return { fieldConflicts: r.conflicts, noop: !r.changed && !r.conflicts.length };
};

H['unit.clave'] = (s, op) => {
  const u = getUnit(s, op.e); const { o, n, motivo } = op.x;
  if (u.sit !== 'activa') throw new Reject('La unidad no está activa');
  if (u.clave !== o) {
    if (u.clave === n) return { noop: true };
    throw new Reject('Cambio de clave simultáneo: ' + unitLabel(u) + ' está en ' + u.clave, { actual: u.clave, propuesto: n });
  }
  const def = claveDef(s.prev, n); if (!def) throw new Reject('Clave inexistente: ' + n);
  if (def.requiereMotivo && !motivo) throw new Reject('La clave ' + n + ' requiere indicar el motivo');
  if (def.requiereAviso && !u.aviso) throw new Reject('La clave ' + n + ' requiere un aviso activo');
  if (def.requiereAviso && isResting(u, op.t)) throw new Reject('La unidad está en descanso');
  setClave(s, u, n, op.t, motivo, op);
};

H['unit.color'] = (s, op) => {
  const u = getUnit(s, op.e); const base = baseClave(s.prev).codigo;
  if (u.clave !== base) throw new Reject('El color ' + base + ' solo puede modificarse con la unidad en ' + base, { clave: u.clave });
  if (u.colorC0 !== op.x.o) {
    if (u.colorC0 === op.x.n) return { noop: true };
    return { fieldConflicts: [{ campo: 'colorC0', actual: u.colorC0, propuesto: op.x.n, anterior: op.x.o }] };
  }
  u.colorC0 = op.x.n;
};

H['unit.sit'] = (s, op) => {
  const u = getUnit(s, op.e); const { o, n } = op.x;
  if (!['activa', 'desactivada', 'archivada'].includes(n)) throw new Reject('Situación no válida');
  if (u.sit !== o) { if (u.sit === n) return { noop: true }; throw new Reject('Cambio simultáneo de situación de ' + unitLabel(u)); }
  if (n !== 'activa' && u.aviso) throw new Reject(unitLabel(u) + ' tiene un aviso activo');
  if (n !== 'activa' && isResting(u, op.t)) { u.descanso.fin = op.t; u.descanso.finMotivo = 'Desactivación'; }
  u.sit = n; u.hs.push({ t: op.t, s: n });
};

H['unit.delete'] = (s, op) => {
  const u = getUnit(s, op.e);
  if (u.aviso) throw new Reject(unitLabel(u) + ' tiene un aviso activo');
  if (u.hc.length > 1 || u.ha.length || u.hr.length || u.hn.length || u.hl.length > 1) throw new Reject(unitLabel(u) + ' tiene actividad registrada: archívala en lugar de eliminarla');
  u.eliminada = true; u.eliminadaEn = op.t;
};

H['unit.loc'] = (s, op) => {
  const u = getUnit(s, op.e); const n = op.x.n || null;
  const cur = u.loc ? { txt: u.loc.txt || '', lat: u.loc.lat ?? null, lon: u.loc.lon ?? null } : null;
  const nn = n ? { txt: n.txt || '', lat: n.lat ?? null, lon: n.lon ?? null } : null;
  const extra = n ? Object.fromEntries(['fuente', 'prec', 'ref'].filter(k => n[k] != null).map(k => [k, n[k]])) : {}; // origen (1.5.0)
  const curX = u.loc ? Object.fromEntries(['fuente', 'prec', 'ref'].filter(k => u.loc[k] != null).map(k => [k, u.loc[k]])) : {};
  if (same(cur, nn) && same(curX, extra)) return { noop: true };
  u.loc = nn ? { ...nn, ...extra, t: op.t } : null;
  u.hl.push({ t: op.t, ...(nn || { txt: '', lat: null, lon: null }), ant: cur, op: op.id });
};

H['unit.plan'] = (s, op) => {
  const u = getUnit(s, op.e); const n = op.x.n || null;
  if (same(u.plan, n)) return { noop: true };
  u.plan = n ? { x: n.x, y: n.y, ...(n.lat != null ? { lat: n.lat, lon: n.lon } : {}) } : null;
};

H['unit.rest'] = (s, op) => {
  const u = getUnit(s, op.e); const dur = Number(op.x.dur);
  if (!(dur > 0 && dur <= 24 * 60)) throw new Reject('Duración de descanso no válida');
  if (u.sit !== 'activa') throw new Reject('La unidad no está activa');
  if (u.aviso) throw new Reject(unitLabel(u) + ' tiene un aviso activo: no puede iniciar descanso', { aviso: u.aviso });
  if (isResting(u, op.t)) throw new Reject(unitLabel(u) + ' ya está en descanso');
  const def = claveDef(s.prev, u.clave);
  if (def && (def.categoria === 'ocupada' || def.categoria === 'fuera_servicio')) throw new Reject('No puede iniciar descanso en clave ' + u.clave);
  u.descanso = { id: op.x.rid || op.id, ini: op.t, dur, finPrev: op.t + dur * 60000, fin: null, por: op.u ? op.u.n : '' };
  u.hr.push(u.descanso);
};

H['unit.restEnd'] = (s, op) => {
  const u = getUnit(s, op.e); const d = u.descanso;
  if (!d || (op.x.rid && d.id !== op.x.rid) || d.fin != null || op.t >= d.finPrev) return { noop: true };
  d.fin = op.t; d.finMotivo = op.x.motivo || 'Manual';
};

H['unit.nota'] = (s, op) => {
  const u = getUnit(s, op.e);
  u.hn.push({ t: op.t, txt: String(op.x.txt || ''), tipo: op.x.tipo || 'observacion', por: op.u ? op.u.n : '' });
};

H['aviso.create'] = (s, op) => {
  if (s.avisos[op.e]) throw new Reject('El aviso ya existe');
  const d = op.x.a || {};
  const a = {
    id: op.e, num: op.num != null ? op.num : null, ref: op.ref || null,
    tipo: d.tipo || null, desc: d.desc || '', t: d.t || op.t, loc: d.loc ? clone(d.loc) : null, sector: d.sector || null,
    obs: d.obs || '', plan: d.plan ? clone(d.plan) : null, zona: d.zona ? clone(d.zona) : null, part: [], estado: 'pendiente', hist: [{ t: op.t, o: null, n: 'pendiente' }],
    creado: op.t, creadoPor: op.u ? op.u.n : '', asignadoEn: null, enCursoEn: null, llegadaEn: null, salidaPuntoEn: null,
    finalizadoEn: null, cierre: null, notas: [], reaperturas: [],
  };
  s.avisos[a.id] = a;
  if (a.num != null) {
    const otro = s.numAviso[a.num];
    s.maxNum = Math.max(s.maxNum, a.num);
    if (otro && otro !== a.id) return { warning: 'Número de aviso duplicado: ' + a.num };
    s.numAviso[a.num] = a.id;
  }
};

H['aviso.update'] = (s, op) => {
  const a = getAviso(s, op.e);
  const r = applyFields(a, op.x.f, AVISO_FIELDS);
  return { fieldConflicts: r.conflicts, noop: !r.changed && !r.conflicts.length };
};

H['aviso.plan'] = (s, op) => {
  const a = getAviso(s, op.e); const n = op.x.n || null;
  if (same(a.plan, n)) return { noop: true };
  a.plan = n ? { x: n.x, y: n.y, ...(n.lat != null ? { lat: n.lat, lon: n.lon } : {}) } : null;
};

H['aviso.asig'] = (s, op) => {
  const a = getAviso(s, op.e); const u = getUnit(s, op.x.u);
  if (a.finalizadoEn != null) throw new Reject('El aviso ' + avisoLabel(a) + ' está finalizado');
  if (u.aviso === a.id) return { noop: true };
  if (u.sit !== 'activa') throw new Reject(unitLabel(u) + ' no está activa');
  if (u.aviso) throw new Reject(unitLabel(u) + ' ya está asignada a otro aviso', { aviso: u.aviso });
  if (isResting(u, op.t)) throw new Reject(unitLabel(u) + ' está en descanso', { descanso: true });
  const def = claveDef(s.prev, u.clave);
  if (def && def.categoria !== 'disponible') throw new Reject(unitLabel(u) + ' no está disponible (clave ' + u.clave + ')', { clave: u.clave });
  a.part.push({ u: u.id, asig: op.t, lib: null, llegada: null, salida: null, motivoLib: null });
  u.aviso = a.id; if (!u.ha.includes(a.id)) u.ha.push(a.id);
  if (a.asignadoEn == null) a.asignadoEn = op.t;
  const al = alAsignarClave(s.prev);
  if (al && def && def.categoria === 'disponible' && u.clave !== al.codigo) setClave(s, u, al.codigo, op.t, null, op, 'asignacion');
  avisoEstado(s, a, op.t);
};

H['aviso.lib'] = (s, op) => {
  const a = getAviso(s, op.e); const u = getUnit(s, op.x.u);
  if (!activePart(a, u.id)) return { noop: true };
  releasePart(s, a, u, op.t, op.x.motivo || 'Liberada');
  const def = claveDef(s.prev, u.clave);
  if (def && def.requiereAviso) setClave(s, u, baseClave(s.prev).codigo, op.t, 'Liberada del aviso', op, 'liberacion');
  avisoEstado(s, a, op.t);
};

H['aviso.estado'] = (s, op) => {
  const a = getAviso(s, op.e); const { n } = op.x;
  if (n === 'finalizado') {
    if (a.finalizadoEn != null) return { noop: true };
    for (const p of activeParts(a)) {
      const u = s.units[p.u];
      releasePart(s, a, u, op.t, 'Aviso finalizado');
      const def = claveDef(s.prev, u.clave);
      if (def && def.requiereAviso) setClave(s, u, baseClave(s.prev).codigo, op.t, 'Aviso finalizado', op, 'finalizacion');
    }
    a.finalizadoEn = op.t; a.finAuto = false; a.cierre = { nota: op.x.nota || '', por: op.u ? op.u.n : '' };
  } else if (n === 'en_curso') {
    if (a.finalizadoEn != null) {
      if (op.x.o !== 'finalizado') throw new Reject('El aviso está finalizado');
      if (!op.x.motivo) throw new Reject('La reapertura requiere motivo');
      a.finalizadoEn = null; a.reaperturas.push({ t: op.t, motivo: op.x.motivo, por: op.u ? op.u.n : '' });
    }
    if (a.enCursoEn == null) a.enCursoEn = op.t;
  } else if (n === 'pendiente') {
    if (a.finalizadoEn == null) return { noop: true };
    if (!op.x.motivo) throw new Reject('La reapertura requiere motivo');
    a.finalizadoEn = null; a.reaperturas.push({ t: op.t, motivo: op.x.motivo, por: op.u ? op.u.n : '' });
  } else throw new Reject('Estado de aviso no válido');
  avisoEstado(s, a, op.t);
};

H['aviso.nota'] = (s, op) => {
  const a = getAviso(s, op.e);
  a.notas.push({ t: op.t, txt: String(op.x.txt || ''), por: op.u ? op.u.n : '' });
};

H['conf.resolve'] = (s, op, ctx) => {
  const c = s.conflicts[op.x.op];
  if (!c || c.estado !== 'pendiente') return { noop: true };
  if (op.x.d === 'descartar') {
    c.estado = 'descartado';
  } else if (op.x.d === 'aceptar') {
    if (c.tipo === 'campos') {
      const target = c.k.startsWith('unit.') ? getUnit(s, c.e) : c.k.startsWith('aviso.') ? getAviso(s, c.e) : s.prev;
      for (const f of c.detalle || []) {
        const val = op.x.valores && Object.prototype.hasOwnProperty.call(op.x.valores, f.campo) ? op.x.valores[f.campo] : f.propuesto;
        if (f.campo.startsWith('cat.')) s.prev.cat[f.campo.slice(4)] = clone(val);
        else setPath(target, f.campo, clone(val));
      }
    } else if (c.tipo === 'op') {
      const orig = ctx.lookup && ctx.lookup(c.id);
      if (!orig) throw new Reject('Operación original no disponible');
      const again = { ...orig, t: op.t, h: op.h };
      const fn = H[orig.k];
      const r = fn(s, again, ctx) || {};
      if (r.fieldConflicts && r.fieldConflicts.length) throw new Reject('Sigue habiendo diferencias; elige valores');
    }
    c.estado = 'aceptado';
  } else throw new Reject('Decisión no válida');
  c.resueltoPor = op.u ? op.u.n : ''; c.resueltoEn = op.t;
};

export const OP_KINDS = Object.keys(H);

/**
 * Aplica una operación. Nunca deja el estado a medias por una validación:
 * los manejadores validan antes de modificar.
 * strict = true se usa para validar órdenes locales (sin registrar conflictos).
 */
export function applyOp(s, op, ctx = {}) {
  try {
    if (op.k !== 'prev.create') {
      if (!s.prev) throw new Reject('Preventivo no creado');
      if (s.prev.archivado && op.k !== 'prev.archivo' && !SIEMPRE_OK.has(op.k)) throw new Reject('El preventivo está archivado');
      if (s.prev.estado === 'cerrado' && !CLOSED_OK.has(op.k) && !SIEMPRE_OK.has(op.k)) throw new Reject('El preventivo está cerrado');
    }
    const fn = H[op.k]; if (!fn) throw new Reject('Operación desconocida: ' + op.k);
    const r = fn(s, op, ctx) || {};
    if (op.t > s.lastT) s.lastT = op.t;
    if (r.fieldConflicts && r.fieldConflicts.length) {
      if (!ctx.strict) registerConflict(s, op, 'campos', 'Modificación simultánea de ' + r.fieldConflicts.map(f => f.campo).join(', '), r.fieldConflicts);
      return { status: 'conflict', reason: 'Los datos han cambiado mientras se editaban (' + r.fieldConflicts.map(f => f.campo).join(', ') + ')', partial: true };
    }
    if (r.warning) {
      if (ctx.strict) return { status: 'conflict', reason: r.warning };
      registerConflict(s, op, 'aviso', r.warning, null);
      return { status: 'ok', warning: r.warning };
    }
    return { status: r.noop ? 'noop' : 'ok' };
  } catch (e) {
    const internal = !(e instanceof Reject);
    if (internal && ctx.strict) throw e;
    const reason = internal ? 'Error interno al aplicar la operación: ' + e.message : e.message;
    if (!ctx.strict) registerConflict(s, op, 'op', reason, e.detail);
    return { status: 'conflict', reason };
  }
}

export const cmpOps = (a, b) => (a.h < b.h ? -1 : a.h > b.h ? 1 : 0);

/**
 * Copia perezosa del estado para validar acciones sin tocar el original: cada unidad, aviso o
 * conflicto se copia la primera vez que se consulta (lectura o escritura) y el resto no se copia.
 * Evita copiar el estado completo en cada pulsación, cuyo coste crece con el tamaño del preventivo.
 */
function lazyMap(src) {
  const cache = Object.create(null);
  const has = k => typeof k === 'string' && (k in cache || Object.prototype.hasOwnProperty.call(src, k));
  const get = k => (typeof k !== 'string' ? undefined : k in cache ? cache[k] : Object.prototype.hasOwnProperty.call(src, k) ? (cache[k] = clone(src[k])) : undefined);
  return new Proxy({}, {
    get: (_, k) => get(k),
    set: (_, k, v) => { cache[k] = v; return true; },
    has: (_, k) => has(k),
    deleteProperty: () => { throw new Error('No se admite borrar durante la validación'); },
    ownKeys: () => [...new Set([...Object.keys(src), ...Object.keys(cache)])],
    getOwnPropertyDescriptor: (_, k) => (has(k) ? { value: get(k), writable: true, enumerable: true, configurable: true } : undefined),
  });
}
export function lazyCopy(s) {
  return { ...s, prev: clone(s.prev), units: lazyMap(s.units), avisos: lazyMap(s.avisos), conflicts: lazyMap(s.conflicts), numAviso: { ...s.numAviso }, revisiones: { ...(s.revisiones || {}) }, informes: s.informes || [] };
}

/** Motor de un preventivo: registro ordenado + estado derivado */
export class Engine {
  constructor(ops = []) {
    this.ops = []; this.byId = new Map(); this.status = new Map(); this.state = emptyState(); this.version = 0;
    if (ops.length) this.load(ops);
  }
  load(ops) {
    this.ops = []; this.byId = new Map();
    for (const op of ops) if (!this.byId.has(op.id)) { this.byId.set(op.id, op); this.ops.push(op); }
    this.ops.sort(cmpOps); this.replay();
  }
  replay() {
    this.state = emptyState(); this.status = new Map();
    for (const op of this.ops) this._apply(op);
    this.version++;
  }
  _apply(op) {
    const r = applyOp(this.state, op, { lookup: id => this.byId.get(id) });
    this.status.set(op.id, r); return r;
  }
  /** Incorpora operaciones nuevas (locales o remotas). Devuelve cuántas eran nuevas. */
  add(ops) {
    const nuevos = ops.filter(o => !this.byId.has(o.id));
    if (!nuevos.length) return 0;
    for (const o of nuevos) this.byId.set(o.id, o);
    nuevos.sort(cmpOps);
    const last = this.ops.length ? this.ops[this.ops.length - 1].h : '';
    if (nuevos[0].h > last) { for (const o of nuevos) { this.ops.push(o); this._apply(o); } this.version++; }
    else { this.ops.push(...nuevos); this.ops.sort(cmpOps); this.replay(); }
    return nuevos.length;
  }
  /** Valida un lote sobre una copia del estado, sin modificar nada */
  dryRun(ops) {
    const s = lazyCopy(this.state);
    for (const op of ops) {
      const r = applyOp(s, op, { strict: true, lookup: id => this.byId.get(id) });
      if (r.status === 'conflict') return { ok: false, reason: r.reason, op };
    }
    return { ok: true, state: s };
  }
  /** Número definitivo asignado por el servidor (o localmente) */
  setNumber(opId, num) {
    const op = this.byId.get(opId); if (!op || op.num === num) return false;
    const antes = op.num; op.num = num;
    // Caso habitual (el servidor numera un aviso que aún no tenía número y el número está libre):
    // se actualiza en el sitio con el mismo resultado que reconstruir todo el registro
    const s = this.state; const a = op.k === 'aviso.create' ? s.avisos[op.e] : null;
    if (antes == null && a && a.num == null && !s.numAviso[num] && !s.conflicts[opId]) {
      a.num = num; s.numAviso[num] = a.id; s.maxNum = Math.max(s.maxNum, num); this.version++; return true;
    }
    this.replay(); return true;
  }
  applied() { return this.ops.filter(o => { const r = this.status.get(o.id); return r && r.status === 'ok'; }); }
  pendingConflicts() { return Object.values(this.state.conflicts).filter(c => c.estado === 'pendiente'); }
}
