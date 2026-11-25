// Exportación JSON y CSV de un preventivo (datos reales del registro de operaciones).
import { fmtDateTime, fmtDur, now, enc } from './util.js';
import { claveDef, unitLabel, avisoLabel, SITUACION_LABEL, unitSituation, restEnd, sectorNombre } from './engine.js';
import { unitStats, avisoTimes, prevStats } from './stats.js';
import { logEntries, AVISO_ESTADO } from './timeline.js';
import { fmtCoords } from './geo.js';
import { APP_NAME, APP_VERSION, SCHEMA_VERSION } from './defaults.js';
import { zipStore } from './zip.js';
import { etiquetaTipoAviso } from './incidentes.js';
import { xlsxLibro } from './xlsx.js';
import { ACCIONES_INFORME, FORMATOS_INFORME } from './ubicacion.js';

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

const tabla = (cabecera, filas) => ({ cabecera, filas });
/** Tablas de datos del preventivo (las mismas para CSV y para Excel) */
export function tablasDatos(engine, until = now()) {
  const s = engine.state; const p = s.prev; const T = {};
  const claves = p.cat.claves.map(c => c.codigo);
  const units = Object.values(s.units).filter(u => !u.eliminada);
  T.unidades = tabla(
    ['Identificador', 'Nombre', 'Denominación', 'Tipo', 'Subtipo', 'Categoría', 'Sector', 'Clave', 'Situación', 'Color C0', 'Ubicación', 'Coordenadas', 'Equipamiento', 'Características', 'Observaciones', 'Nº avisos', 'Tiempo en avisos (min)', 'Nº descansos', 'Tiempo en descanso (min)', 'Tiempo de servicio (min)'],
    units.map(u => { const st = unitStats(s, u, until); return [u.ind, u.nombre, u.denom, named(p.cat.tiposRecurso, u.tipo), u.subtipo, u.categoria, sectorNombre(p, u, 'Pendiente de asignación'), u.clave, SITUACION_LABEL[unitSituation(s, u, until)], u.colorC0, u.loc ? u.loc.txt : '', fmtCoords(u.loc), (u.equip || []).join(', '), (u.caract || []).join(', '), u.obs, st.nAvisos, mins(st.enAvisos), st.nDescansos, mins(st.enDescanso), mins(st.servicio)]; }));
  T.tiempos_por_clave = tabla(['Identificador', ...claves.map(c => c + ' (min)')],
    units.map(u => { const st = unitStats(s, u, until); return [u.ind, ...claves.map(c => mins(st.porClave[c] || 0))]; }));
  const avisos = Object.values(s.avisos).sort((a, b) => (a.t ?? a.creado) - (b.t ?? b.creado));
  T.avisos = tabla(
    ['Número', 'Referencia', 'Fecha y hora', 'Tipo', 'Descripción', 'Ubicación', 'Coordenadas', 'Sector', 'Estado', 'Unidades', 'Asignación (min)', 'Respuesta (min)', 'Intervención (min)', 'Resolución (min)', 'Finalizado', 'Nota de cierre', 'Observaciones'],
    avisos.map(a => { const tm = avisoTimes(a); return [a.num ?? '', a.ref || '', fmtDateTime(a.t ?? a.creado), etiquetaTipoAviso(p.cat.tiposAviso, a.tipo), a.desc, a.loc ? a.loc.txt : '', fmtCoords(a.loc), named(p.cat.sectores, a.sector), AVISO_ESTADO[a.estado], [...new Set(a.part.map(x => unitLabel(s.units[x.u])))].join(', '), mins(tm.asignacion), mins(tm.respuesta), mins(tm.intervencion), mins(tm.resolucion), a.finalizadoEn ? fmtDateTime(a.finalizadoEn) : '', a.cierre ? a.cierre.nota : '', a.obs]; }));
  const parts = [];
  for (const a of avisos) for (const x of a.part) parts.push([avisoLabel(a), unitLabel(s.units[x.u]), fmtDateTime(x.asig), x.llegada ? fmtDateTime(x.llegada) : '', x.salida ? fmtDateTime(x.salida) : '', x.lib ? fmtDateTime(x.lib) : '', x.motivoLib || '']);
  T.participaciones = tabla(['Aviso', 'Unidad', 'Asignada', 'Llegada al punto', 'Salida del punto', 'Liberada', 'Motivo'], parts);
  const cl = [];
  for (const u of units) u.hc.forEach((c, i) => { const n = u.hc[i + 1]; const d = claveDef(p, c.c); cl.push([u.ind, c.c, d ? d.nombre : '', fmtDateTime(c.t, true), n ? fmtDateTime(n.t, true) : '', mins((n ? n.t : until) - c.t), c.m || '']); });
  T.cambios_de_clave = tabla(['Unidad', 'Clave', 'Nombre', 'Desde', 'Hasta', 'Duración (min)', 'Motivo'], cl);
  const rs = [];
  for (const u of units) for (const r of u.hr) rs.push([u.ind, fmtDateTime(r.ini, true), r.dur, fmtDateTime(r.finPrev, true), fmtDateTime(restEnd(r), true), mins(Math.min(restEnd(r), until) - r.ini), r.fin != null ? (r.finMotivo || 'Manual') : (r.finPrev <= until ? 'Automático' : 'En curso'), r.por || '']);
  T.descansos = tabla(['Unidad', 'Inicio', 'Duración prevista (min)', 'Fin previsto', 'Fin real', 'Duración real (min)', 'Finalización', 'Iniciado por'], rs);
  const ls = [];
  for (const u of units) for (const l of u.hl) ls.push([u.ind, fmtDateTime(l.t, true), l.ant ? l.ant.txt : '', l.ant ? fmtCoords(l.ant) : '', l.txt, fmtCoords(l)]);
  T.ubicaciones = tabla(['Unidad', 'Fecha y hora', 'Ubicación anterior', 'Coordenadas anteriores', 'Ubicación nueva', 'Coordenadas nuevas'], ls);
  T.bitacora = tabla(['Fecha y hora', 'Usuario', 'Dispositivo', 'Categoría', 'Elemento', 'Acción', 'Valor anterior', 'Valor nuevo', 'Estado', 'Id operación'],
    logEntries(engine, { incluirNoop: true }).map(e => [fmtDateTime(e.t, true), e.usuario, e.dispositivo, e.cat, e.elemento, e.accion, e.anterior, e.nuevo, e.estado + (e.motivoEstado ? ': ' + e.motivoEstado : ''), e.id]));
  return T;
}

export function csvTables(engine, until = now()) {
  return Object.fromEntries(Object.entries(tablasDatos(engine, until)).map(([k, t]) => [k, toCSV(t.cabecera, t.filas)]));
}

/** Horas de cada registro (1.5.0): declarada por el dispositivo, recibida en el servidor y sincronizada aquí.
 *  meta: Map id → { rx, sy } guardado en este dispositivo. No se corrige ni se estima ninguna hora. */
export function tablaHoras(engine, meta = new Map(), { compartido = false } = {}) {
  const filas = logEntries(engine, { incluirNoop: true }).map(e => {
    const op = engine.byId.get(e.id) || {}; const m = meta.get(e.id) || {};
    const rx = m.rx ?? op.rx ?? null; const sy = m.sy ?? op.sy ?? null;
    return [fmtDateTime(e.t, true), rx != null ? fmtDateTime(rx, true) : (compartido ? 'Sin dato' : 'No aplica (independiente)'), sy != null ? fmtDateTime(sy, true) : '',
      rx != null ? Math.round((rx - e.t) / 60000) : '', e.dispositivo, e.usuario, e.elemento, e.accion, e.id];
  });
  return tabla(['Hora declarada por el dispositivo', 'Recibida en el servidor', 'Sincronizada en este dispositivo', 'Diferencia declarada-recibida (min)', 'Dispositivo', 'Usuario', 'Elemento', 'Acción', 'Id operación'], filas);
}
/** Registro de versiones, exportaciones y consultas del informe */
export function tablaRegistroInforme(s) {
  return tabla(['Fecha y hora', 'Acción', 'Versión', 'Formato', 'Usuario', 'Dispositivo', 'Motivo', 'SHA-256', 'Provisional'],
    (s.informes || []).map(r => [fmtDateTime(r.t, true), ACCIONES_INFORME[r.accion] || r.accion, r.n ?? '', FORMATOS_INFORME[r.formato] || r.formato || '', r.por, r.dev, r.motivo || '', r.hash || '', r.provisional ? 'Sí' + (r.pendientes ? ' (' + r.pendientes + ' sin sincronizar)' : '') : '']));
}

export function csvZip(engine, until = now(), { meta = null, compartido = false } = {}) {
  const T = csvTables(engine, until);
  // 1.5.0: con los datos de sincronización se añaden las horas de cada registro y el registro del informe
  if (meta) { const h = tablaHoras(engine, meta, { compartido }); T.horas_de_registro = toCSV(h.cabecera, h.filas); }
  if ((engine.state.informes || []).length) { const r = tablaRegistroInforme(engine.state); T.registro_del_informe = toCSV(r.cabecera, r.filas); }
  return zipStore(Object.entries(T).map(([k, v]) => ({ name: k + '.csv', data: enc.encode(v) })));
}

const NOMBRES_TABLA = { unidades: 'Unidades', tiempos_por_clave: 'Tiempos por clave', avisos: 'Avisos', participaciones: 'Participaciones', cambios_de_clave: 'Cambios de clave', descansos: 'Descansos', ubicaciones: 'Ubicaciones', bitacora: 'Bitácora' };
/** En Excel, los minutos van como números (en CSV llevan coma decimal) */
function numerico(t) {
  const cols = t.cabecera.map((h, i) => (/\(min\)/.test(h) ? i : -1)).filter(i => i >= 0);
  if (!cols.length) return t;
  return { ...t, filas: t.filas.map(f => f.map((v, i) => (cols.includes(i) && typeof v === 'string' && /^-?(0|[1-9]\d*)(,\d+)?$/.test(v) ? Number(v.replace(',', '.')) : v))) };
}
/** Libro de Excel del preventivo (1.5.0): resumen, las mismas tablas que el CSV, horas de registro y registro del informe */
export function prevXLSX(engine, { usuario = '', dispositivo = '', meta = new Map(), compartido = false } = {}) {
  const s = engine.state; const p = s.prev; const t = now(); const st = prevStats(s, t);
  const resumen = tabla(['Dato', 'Valor'], [
    ['Preventivo', p.nombre], ['Fecha', p.fecha || ''], ['Horario previsto', (p.horaInicio || '') + (p.horaFin ? ' – ' + p.horaFin : '')],
    ['Estado', p.estado === 'cerrado' ? 'Finalizado' : p.estado === 'activo' ? 'Activo' : 'En preparación'], ['Modalidad', p.modalidad === 'compartida' ? 'Compartida' : 'Independiente'],
    ['Activado', p.activadoEn ? fmtDateTime(p.activadoEn) : ''], ['Finalizado', p.cerradoEn ? fmtDateTime(p.cerradoEn) + ' por ' + (p.cerradoPor || '') : ''],
    ['Duración analizada (min)', Math.round(st.duracion / 60000)], ['Unidades', Object.values(s.units).filter(u => !u.eliminada).length],
    ['Avisos', st.avisos.total], ['Descansos', st.descansos.total], ['Exportado', fmtDateTime(t) + (usuario ? ' por ' + usuario : '')],
    ['Aplicación', APP_NAME + ' ' + APP_VERSION + (dispositivo ? ' · ' + dispositivo : '')],
    ['Horas', 'Los tiempos usan la hora declarada por cada dispositivo; la hoja «Horas de registro» muestra también la recepción en el servidor y la sincronización.'],
  ]);
  const hojas = [{ nombre: 'Resumen', ...resumen }, ...Object.entries(tablasDatos(engine, t)).map(([k, x]) => ({ nombre: NOMBRES_TABLA[k] || k, ...numerico(x) }))];
  hojas.push({ nombre: 'Horas de registro', ...tablaHoras(engine, meta, { compartido }) });
  if ((s.informes || []).length) hojas.push({ nombre: 'Registro del informe', ...tablaRegistroInforme(s) });
  return xlsxLibro(hojas, { titulo: 'Preventivo ' + p.nombre, autor: usuario, fecha: new Date(t) });
}

/** JSON completo: datos, estado final, estadísticas y registro íntegro de operaciones */
export function prevJSON(engine, { usuario = '', dispositivo = '', meta = null } = {}) {
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
    // t: hora declarada por el dispositivo; rx: recepción en el servidor; sy: sincronización en el dispositivo que exporta (1.5.0)
    horas: { t: 'Hora declarada por el dispositivo', rx: 'Hora de recepción en el servidor', sy: 'Hora de sincronización en el dispositivo que exporta' },
    informes: engine.state.informes || [],
    operaciones: engine.ops.map(o => { const m = meta && meta.get(o.id); return { ...o, ...(m ? { rx: m.rx ?? o.rx ?? null, sy: m.sy ?? o.sy ?? null } : {}), estado: (engine.status.get(o.id) || {}).status }; }),
  };
}
export { fmtDur };
