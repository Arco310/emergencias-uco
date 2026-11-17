// Tiempos y estadísticas calculados a partir del estado derivado (datos reales).
// Si faltan datos para un indicador se devuelve null ("sin datos"), nunca una estimación.
import { claveDef, restEnd, liveUnits, unitSituation } from './engine.js';
import { sum, avg, median } from './util.js';

function clip(a, b, lo, hi) { const x = Math.max(a, lo), y = Math.min(b, hi); return y > x ? y - x : 0; }

/** Periodos en los que la unidad estuvo activa (no desactivada ni archivada) */
export function activePeriods(u, until) {
  const out = []; const end = Math.min(until, u.eliminadaEn != null ? u.eliminadaEn : Infinity);
  for (let i = 0; i < u.hs.length; i++) {
    const cur = u.hs[i], nxt = u.hs[i + 1];
    if (cur.s !== 'activa') continue;
    const b = Math.min(nxt ? nxt.t : end, end);
    if (b > cur.t) out.push([cur.t, b]);
  }
  return out;
}

export function unitStats(s, u, until) {
  const periods = activePeriods(u, until);
  const servicio = sum(periods, p => p[1] - p[0]);
  const porClave = {};
  for (let i = 0; i < u.hc.length; i++) {
    const a = u.hc[i], b = u.hc[i + 1];
    const t1 = b ? b.t : until;
    let d = 0; for (const p of periods) d += clip(a.t, t1, p[0], p[1]);
    if (d > 0) porClave[a.c] = (porClave[a.c] || 0) + d;
  }
  const descansos = u.hr.map(r => ({ ...r, finReal: restEnd(r), dur: Math.max(0, Math.min(restEnd(r), until) - r.ini) })).filter(r => r.ini <= until);
  const parts = [];
  for (const aid of u.ha) {
    const a = s.avisos[aid]; if (!a) continue;
    for (const p of a.part) if (p.u === u.id && p.asig <= until) parts.push({ aviso: a, asig: p.asig, lib: p.lib, dur: Math.max(0, Math.min(p.lib != null ? p.lib : until, until) - p.asig) });
  }
  const nAvisos = new Set(parts.map(p => p.aviso.id)).size;
  const enAvisos = sum(parts, p => p.dur);
  return {
    servicio, porClave, nAvisos, enAvisos, medioPorAviso: nAvisos ? enAvisos / nAvisos : null,
    nDescansos: descansos.length, enDescanso: sum(descansos, r => r.dur), descansos, participaciones: parts,
    cambiosClave: Math.max(0, u.hc.length - 1),
  };
}

/** Tiempos de un aviso (en ms). null = faltan datos. */
export function avisoTimes(a) {
  const t0 = a.t != null ? a.t : a.creado;
  const pos = v => (v != null && v >= 0 ? v : null);
  return {
    asignacion: a.asignadoEn != null ? pos(a.asignadoEn - t0) : null,
    respuesta: a.llegadaEn != null ? pos(a.llegadaEn - t0) : null,
    intervencion: a.llegadaEn != null && a.salidaPuntoEn != null ? pos(a.salidaPuntoEn - a.llegadaEn) : null,
    resolucion: a.finalizadoEn != null ? pos(a.finalizadoEn - t0) : null,
    unidades: new Set(a.part.map(p => p.u)).size,
  };
}
export const TIEMPOS_AVISO = {
  asignacion: ['Tiempo de asignación', 'Desde la hora del aviso hasta la primera unidad asignada.'],
  respuesta: ['Tiempo de respuesta', 'Desde la hora del aviso hasta la llegada de la primera unidad al punto.'],
  intervencion: ['Tiempo de intervención', 'Desde la primera llegada al punto hasta que la última unidad deja el punto.'],
  resolucion: ['Tiempo de resolución', 'Desde la hora del aviso hasta su finalización.'],
};

function agg(values) {
  const v = values.filter(x => x != null);
  return { n: v.length, media: v.length ? avg(v) : null, mediana: median(v), min: v.length ? Math.min(...v) : null, max: v.length ? Math.max(...v) : null };
}

export function avisoStats(s, filtro = {}) {
  let avisos = Object.values(s.avisos);
  if (filtro.tipo) avisos = avisos.filter(a => a.tipo === filtro.tipo);
  if (filtro.sector) avisos = avisos.filter(a => a.sector === filtro.sector);
  if (filtro.desde) avisos = avisos.filter(a => (a.t ?? a.creado) >= filtro.desde);
  if (filtro.hasta) avisos = avisos.filter(a => (a.t ?? a.creado) <= filtro.hasta);
  const rows = avisos.map(a => ({ a, ...avisoTimes(a) }));
  const res = {
    total: avisos.length,
    porEstado: count(avisos, a => a.estado),
    porTipo: count(avisos, a => a.tipo || '_'),
    porSector: count(avisos, a => a.sector || '_'),
    tiempos: {}, sinDatos: {}, rows,
  };
  for (const k of Object.keys(TIEMPOS_AVISO)) { res.tiempos[k] = agg(rows.map(r => r[k])); res.sinDatos[k] = rows.length - res.tiempos[k].n; }
  return res;
}

function count(arr, fn) { const m = {}; for (const x of arr) { const k = fn(x); m[k] = (m[k] || 0) + 1; } return m; }

/** Rango temporal del preventivo */
export function prevRange(s, until) {
  const p = s.prev;
  const ini = p.activadoEn || p.creado;
  const fin = p.cerradoEn && p.estado === 'cerrado' ? p.cerradoEn : until;
  return [ini, Math.max(ini, fin)];
}

export function prevStats(s, until, { bucketMin = 60 } = {}) {
  const [ini, fin] = prevRange(s, until);
  const units = Object.values(s.units).filter(u => !u.eliminada);
  const live = liveUnits(s);
  const porUnidad = units.map(u => ({ u, ...unitStats(s, u, fin) }));
  const avisos = Object.values(s.avisos);
  const bucket = bucketMin * 60000;
  const nb = Math.max(1, Math.min(200, Math.ceil((fin - ini) / bucket) || 1));
  const serie = Array.from({ length: nb }, (_, i) => ({ t: ini + i * bucket, avisos: 0, ocupadas: 0, descansos: 0 }));
  for (const a of avisos) { const t = a.t ?? a.creado; let i = Math.floor((t - ini) / bucket); if (i < 0 && ini - t < 60000) i = 0; if (i >= 0 && i < nb) serie[i].avisos++; }
  for (const pu of porUnidad) {
    for (const p of pu.participaciones) for (const b of serie) if (p.asig < b.t + bucket && (p.lib == null || p.lib > b.t)) b.ocupadas++;
    for (const r of pu.descansos) for (const b of serie) if (r.ini < b.t + bucket && r.finReal > b.t) b.descansos++;
  }
  // Evolución: avisos abiertos y unidades ocupadas en cada instante de muestreo
  const N = 48, step = (fin - ini) / N || 1;
  const evol = [];
  for (let i = 0; i <= N; i++) {
    const t = ini + i * step;
    const abiertos = avisos.filter(a => (a.t ?? a.creado) <= t && (a.finalizadoEn == null || a.finalizadoEn > t)).length;
    let ocup = 0;
    for (const pu of porUnidad) if (pu.participaciones.some(p => p.asig <= t && (p.lib == null || p.lib > t))) ocup++;
    evol.push({ t, abiertos, ocupadas: ocup });
  }
  const recursos = { porTipo: count(live, u => u.tipo || '_'), porSector: count(live, u => u.sector || '_'), porSituacion: count(live, u => unitSituation(s, u, until)) };
  return {
    ini, fin, duracion: fin - ini, recursos, porUnidad, avisos: avisoStats(s), serie, bucketMin, evol,
    descansos: { total: sum(porUnidad, x => x.nDescansos), tiempo: sum(porUnidad, x => x.enDescanso) },
    claveTotales: porUnidad.reduce((m, x) => { for (const [k, v] of Object.entries(x.porClave)) m[k] = (m[k] || 0) + v; return m; }, {}),
  };
}

export function claveName(s, code) { const d = claveDef(s.prev, code); return d ? code + ' ' + d.nombre : code; }
