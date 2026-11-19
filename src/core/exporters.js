// Exportación JSON y CSV de un preventivo (datos reales del registro de operaciones).
import { fmtDateTime, fmtDur, now, enc } from './util.js';
import { claveDef, unitLabel, avisoLabel, SITUACION_LABEL, unitSituation, restEnd, sectorNombre } from './engine.js';
import { unitStats, avisoTimes, prevStats } from './stats.js';
import { logEntries, AVISO_ESTADO } from './timeline.js';
import { fmtCoords } from './geo.js';
import { APP_NAME, APP_VERSION, SCHEMA_VERSION } from './defaults.js';
import { zipStore } from './zip.js';
import { etiquetaTipoAviso } from './incidentes.js';

const named = (list, id) => ((list || []).find(x => x.id === id) || {}).nombre || '';
const mins = ms => (ms == null ? '' : (Math.round(ms / 600) / 100).toString().replace('.', ','));

export function csvCell(v) {
  if (v == null) return '';
  const s = String(v);
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}
/** CSV con separador ";" (Excel en español) y BOM UTF-8 */
export function toCSV(header, rows) {
  return '﻿' + [header, ...rows].map(r => r.map(csvCell).join(';')).join('\r\n') + '\r\n';
}

export function csvTables(engine, until = now()) {
  const s = engine.state; const p = s.prev; const T = {};
  const claves = p.cat.claves.map(c => c.codigo);
  const units = Object.values(s.units).filter(u => !u.eliminada);
  T.unidades = toCSV(
    ['Identificador', 'Nombre', 'Denominación', 'Tipo', 'Subtipo', 'Categoría', 'Sector', 'Clave', 'Situación', 'Color C0', 'Ubicación', 'Coordenadas', 'Equipamiento', 'Características', 'Observaciones', 'Nº avisos', 'Tiempo en avisos (min)', 'Nº descansos', 'Tiempo en descanso (min)', 'Tiempo de servicio (min)'],
    units.map(u => { const st = unitStats(s, u, until); return [u.ind, u.nombre, u.denom, named(p.cat.tiposRecurso, u.tipo), u.subtipo, u.categoria, sectorNombre(p, u, 'Pendiente de asignación'), u.clave, SITUACION_LABEL[unitSituation(s, u, until)], u.colorC0, u.loc ? u.loc.txt : '', fmtCoords(u.loc), (u.equip || []).join(', '), (u.caract || []).join(', '), u.obs, st.nAvisos, mins(st.enAvisos), st.nDescansos, mins(st.enDescanso), mins(st.servicio)]; }));
  T.tiempos_por_clave = toCSV(['Identificador', ...claves.map(c => c + ' (min)')],
    units.map(u => { const st = unitStats(s, u, until); return [u.ind, ...claves.map(c => mins(st.porClave[c] || 0))]; }));
  const avisos = Object.values(s.avisos).sort((a, b) => (a.t ?? a.creado) - (b.t ?? b.creado));
  T.avisos = toCSV(
    ['Número', 'Referencia', 'Fecha y hora', 'Tipo', 'Descripción', 'Ubicación', 'Coordenadas', 'Sector', 'Estado', 'Unidades', 'Asignación (min)', 'Respuesta (min)', 'Intervención (min)', 'Resolución (min)', 'Finalizado', 'Nota de cierre', 'Observaciones'],
    avisos.map(a => { const tm = avisoTimes(a); return [a.num ?? '', a.ref || '', fmtDateTime(a.t ?? a.creado), etiquetaTipoAviso(p.cat.tiposAviso, a.tipo), a.desc, a.loc ? a.loc.txt : '', fmtCoords(a.loc), named(p.cat.sectores, a.sector), AVISO_ESTADO[a.estado], [...new Set(a.part.map(x => unitLabel(s.units[x.u])))].join(', '), mins(tm.asignacion), mins(tm.respuesta), mins(tm.intervencion), mins(tm.resolucion), a.finalizadoEn ? fmtDateTime(a.finalizadoEn) : '', a.cierre ? a.cierre.nota : '', a.obs]; }));
  const parts = [];
  for (const a of avisos) for (const x of a.part) parts.push([avisoLabel(a), unitLabel(s.units[x.u]), fmtDateTime(x.asig), x.llegada ? fmtDateTime(x.llegada) : '', x.salida ? fmtDateTime(x.salida) : '', x.lib ? fmtDateTime(x.lib) : '', x.motivoLib || '']);
  T.participaciones = toCSV(['Aviso', 'Unidad', 'Asignada', 'Llegada al punto', 'Salida del punto', 'Liberada', 'Motivo'], parts);
  const cl = [];
  for (const u of units) u.hc.forEach((c, i) => { const n = u.hc[i + 1]; const d = claveDef(p, c.c); cl.push([u.ind, c.c, d ? d.nombre : '', fmtDateTime(c.t, true), n ? fmtDateTime(n.t, true) : '', mins((n ? n.t : until) - c.t), c.m || '']); });
  T.cambios_de_clave = toCSV(['Unidad', 'Clave', 'Nombre', 'Desde', 'Hasta', 'Duración (min)', 'Motivo'], cl);
  const rs = [];
  for (const u of units) for (const r of u.hr) rs.push([u.ind, fmtDateTime(r.ini, true), r.dur, fmtDateTime(r.finPrev, true), fmtDateTime(restEnd(r), true), mins(Math.min(restEnd(r), until) - r.ini), r.fin != null ? (r.finMotivo || 'Manual') : (r.finPrev <= until ? 'Automático' : 'En curso'), r.por || '']);
  T.descansos = toCSV(['Unidad', 'Inicio', 'Duración prevista (min)', 'Fin previsto', 'Fin real', 'Duración real (min)', 'Finalización', 'Iniciado por'], rs);
  const ls = [];
  for (const u of units) for (const l of u.hl) ls.push([u.ind, fmtDateTime(l.t, true), l.ant ? l.ant.txt : '', l.ant ? fmtCoords(l.ant) : '', l.txt, fmtCoords(l)]);
  T.ubicaciones = toCSV(['Unidad', 'Fecha y hora', 'Ubicación anterior', 'Coordenadas anteriores', 'Ubicación nueva', 'Coordenadas nuevas'], ls);
  T.bitacora = toCSV(['Fecha y hora', 'Usuario', 'Dispositivo', 'Categoría', 'Elemento', 'Acción', 'Valor anterior', 'Valor nuevo', 'Estado', 'Id operación'],
    logEntries(engine, { incluirNoop: true }).map(e => [fmtDateTime(e.t, true), e.usuario, e.dispositivo, e.cat, e.elemento, e.accion, e.anterior, e.nuevo, e.estado + (e.motivoEstado ? ': ' + e.motivoEstado : ''), e.id]));
  return T;
}

export function csvZip(engine, until = now()) {
  const T = csvTables(engine, until);
  return zipStore(Object.entries(T).map(([k, v]) => ({ name: k + '.csv', data: enc.encode(v) })));
}

/** JSON completo: datos, estado final, estadísticas y registro íntegro de operaciones */
export function prevJSON(engine, { usuario = '', dispositivo = '' } = {}) {
  const s = engine.state; const t = now();
  const st = prevStats(s, t);
  return {
    formato: 'uco-preventivo', version: SCHEMA_VERSION, aplicacion: APP_NAME + ' ' + APP_VERSION,
    exportado: new Date(t).toISOString(), exportadoPor: usuario, dispositivo,
    preventivo: s.prev,
    unidades: Object.values(s.units),
    avisos: Object.values(s.avisos),
    conflictos: Object.values(s.conflicts),
    estadisticas: {
      inicio: st.ini, fin: st.fin, duracionMin: Math.round(st.duracion / 60000),
      avisos: { total: st.avisos.total, porEstado: st.avisos.porEstado, tiempos: st.avisos.tiempos },
      descansos: st.descansos, tiempoPorClave: st.claveTotales,
    },
    operaciones: engine.ops.map(o => ({ ...o, estado: (engine.status.get(o.id) || {}).status })),
  };
}
export { fmtDur };
