// Informe PDF del preventivo (se genera sin Internet).
import { PDFDoc } from './pdf.js';
import { fmtDateTime, fmtDur, fmtTime, now } from './util.js';
import { claveDef, unitLabel, avisoLabel, SITUACION_LABEL, unitSituation, restEnd, counts, sectorNombre } from './engine.js';
import { prevStats, avisoTimes, TIEMPOS_AVISO } from './stats.js';
import { logEntries, AVISO_ESTADO } from './timeline.js';
import { fmtCoords } from './geo.js';
import { APP_NAME, APP_VERSION } from './defaults.js';
import { etiquetaTipoAviso, tipoAvisoDef } from './incidentes.js';
import { describirOrigen } from './templates.js';

const named = (list, id) => ((list || []).find(x => x.id === id) || {}).nombre || '—';
const PEST = { preparacion: 'En preparación', activo: 'Activo', cerrado: 'Finalizado' };

export async function buildReport(engine, { usuario = '', dispositivo = '' } = {}) {
  const s = engine.state; const p = s.prev; const t = now();
  const st = prevStats(s, t);
  const doc = new PDFDoc({ title: 'Informe del preventivo: ' + p.nombre, author: usuario });
  doc.footer = APP_NAME + ' · ' + p.nombre + ' · generado ' + fmtDateTime(t);

  // 1. Información general
  doc.h1('Informe del preventivo');
  doc.para(p.nombre, { size: 14, bold: true, color: '#212121' });
  doc.kv([
    ['Fecha', p.fecha || '—'], ['Horario previsto', (p.horaInicio || '—') + ' – ' + (p.horaFin || '—')],
    ['Lugar', p.lugar ? [p.lugar.txt, fmtCoords(p.lugar)].filter(Boolean).join(' · ') : '—'], ['Modalidad', p.modalidad === 'compartida' ? 'Compartida (varios dispositivos)' : 'Independiente'],
    ['Estado', PEST[p.estado] + (p.archivado ? ' (archivado)' : '')], ['Creado', fmtDateTime(p.creado) + ' por ' + (p.creadoPor || '—')],
    ['Activado', p.activadoEn ? fmtDateTime(p.activadoEn) : '—'], ['Finalizado', p.cerradoEn ? fmtDateTime(p.cerradoEn) + ' por ' + (p.cerradoPor || '—') : '—'],
    ['Duración analizada', fmtDur(st.duracion)], ['Origen', describirOrigen(p.origen)],
    ['Informe generado', fmtDateTime(t) + ' por ' + (usuario || '—')], ['Aplicación', APP_NAME + ' ' + APP_VERSION + (dispositivo ? ' · ' + dispositivo : '')],
  ]);
  if (p.descripcion) doc.para(p.descripcion);
  if (p.reaperturas && p.reaperturas.length) doc.para('Reaperturas: ' + p.reaperturas.map(r => fmtDateTime(r.t) + ' (' + r.por + '): ' + r.motivo).join(' | '), { color: '#B71C1C' });
  if (p.cierreAvisos) {
    const w = p.cierreAvisos;
    doc.para('Finalizado con advertencias: ' + [w.pendientes.length && 'avisos pendientes ' + w.pendientes.join(', '), w.activos.length && 'avisos activos ' + w.activos.join(', '), w.ocupadas.length && 'unidades ocupadas ' + w.ocupadas.join(', '), w.descansos.length && 'descansos activos ' + w.descansos.join(', '), w.conflictos && w.conflictos + ' conflictos sin resolver'].filter(Boolean).join('; '), { color: '#B71C1C' });
  }

  // 2. Estadísticas
  const c = counts(s, t);
  doc.h2('Resumen y estadísticas');
  doc.kv([
    ['Unidades', c.total], ['Disponibles / ocupadas', c.disponibles + ' / ' + c.ocupadas], ['En descanso', c.descanso], ['Fuera de servicio / clave especial', c.fuera + ' / ' + c.especial],
    ['Avisos totales', st.avisos.total], ['Pendientes / activos / finalizados', c.pendientes + ' / ' + c.activos + ' / ' + c.finalizados],
    ['Descansos', st.descansos.total + ' (' + fmtDur(st.descansos.tiempo) + ')'], ['Conflictos', Object.values(s.conflicts).length + ' (' + Object.values(s.conflicts).filter(x => x.estado === 'pendiente').length + ' pendientes)'],
  ]);
  doc.table([{ label: 'Indicador', w: 2.2 }, { label: 'Avisos con datos', w: 1, align: 'right' }, { label: 'Media', w: 1, align: 'right' }, { label: 'Mediana', w: 1, align: 'right' }, { label: 'Mínimo', w: 1, align: 'right' }, { label: 'Máximo', w: 1, align: 'right' }],
    Object.entries(TIEMPOS_AVISO).map(([k, [lbl]]) => { const a = st.avisos.tiempos[k]; return [lbl, a.n + ' de ' + st.avisos.total, fmtDur(a.media), fmtDur(a.mediana), fmtDur(a.min), fmtDur(a.max)]; }));
  doc.para(Object.values(TIEMPOS_AVISO).map(([l, d]) => l + ': ' + d).join(' '), { size: 7.5, color: '#555555' });
  if (st.avisos.total) {
    doc.para('Avisos por tipo', { bold: true });
    doc.bars(Object.entries(st.avisos.porTipo).map(([k, v]) => ({ label: k === '_' ? 'Sin tipo' : etiquetaTipoAviso(p.cat.tiposAviso, k), value: v, color: (tipoAvisoDef(p.cat.tiposAviso, k) || {}).color || '#546E7A' })));
    doc.para('Avisos por sector', { bold: true });
    doc.bars(Object.entries(st.avisos.porSector).map(([k, v]) => ({ label: k === '_' ? 'Sin sector' : named(p.cat.sectores, k), value: v, color: ((p.cat.sectores.find(x => x.id === k)) || {}).color || '#546E7A' })));
    doc.para('Distribución temporal de avisos (por hora)', { bold: true });
    doc.columns(st.serie.map(b => ({ label: fmtTime(b.t), value: b.avisos })));
  }
  doc.para('Tiempo acumulado por clave (todas las unidades)', { bold: true });
  doc.bars(p.cat.claves.map(k => ({ label: k.codigo + ' ' + k.nombre, value: st.claveTotales[k.codigo] || 0, color: k.color, text: fmtDur(st.claveTotales[k.codigo] || 0) })));

  // 3. Unidades
  doc.h2('Unidades');
  const units = Object.values(s.units).filter(u => !u.eliminada).sort((a, b) => unitLabel(a).localeCompare(unitLabel(b)));
  const byU = new Map(st.porUnidad.map(x => [x.u.id, x]));
  doc.table([{ label: 'Identificador', w: 1.2 }, { label: 'Nombre', w: 1.4 }, { label: 'Tipo', w: 1.5 }, { label: 'Sector', w: 1 }, { label: 'Clave final', w: 1.3 }, { label: 'Situación', w: 1 }, { label: 'Avisos', w: 0.7, align: 'right' }, { label: 'En avisos', w: 1, align: 'right' }, { label: 'Descansos', w: 0.9, align: 'right' }, { label: 'Servicio', w: 1, align: 'right' }],
    units.map(u => { const x = byU.get(u.id); const d = claveDef(p, u.clave); return [u.ind, u.nombre, named(p.cat.tiposRecurso, u.tipo), sectorNombre(p, u, 'Pendiente'), u.clave + ' ' + (d ? d.nombre : ''), SITUACION_LABEL[unitSituation(s, u, t)], x.nAvisos, fmtDur(x.enAvisos), x.nDescansos + ' · ' + fmtDur(x.enDescanso), fmtDur(x.servicio)]; }),
    { colorCol: { 0: ri => units[ri].colorC0 } });

  // 4. Estados
  doc.h2('Tiempo por clave y unidad');
  const claves = p.cat.claves;
  doc.table([{ label: 'Unidad', w: 1.3 }, ...claves.map(k => ({ label: k.codigo, w: 1, align: 'right' })), { label: 'Cambios', w: 0.8, align: 'right' }],
    units.map(u => { const x = byU.get(u.id); return [u.ind, ...claves.map(k => (x.porClave[k.codigo] ? fmtDur(x.porClave[k.codigo]) : '—')), x.cambiosClave]; }), { size: 7.5 });
  doc.para('Claves: ' + claves.map(k => k.codigo + ' ' + k.nombre).join(' · '), { size: 7.5, color: '#555555' });

  // 5. Avisos
  doc.h2('Avisos');
  const avisos = Object.values(s.avisos).sort((a, b) => (a.t ?? a.creado) - (b.t ?? b.creado));
  doc.table([{ label: 'Nº', w: 0.8 }, { label: 'Hora', w: 0.7 }, { label: 'Tipo', w: 1.2 }, { label: 'Descripción / ubicación', w: 2.4 }, { label: 'Sector', w: 0.9 }, { label: 'Unidades', w: 1.2 }, { label: 'Estado', w: 0.9 }, { label: 'Asig.', w: 0.75, align: 'right' }, { label: 'Resp.', w: 0.75, align: 'right' }, { label: 'Interv.', w: 0.75, align: 'right' }, { label: 'Resol.', w: 0.75, align: 'right' }],
    avisos.map(a => { const tm = avisoTimes(a); return [avisoLabel(a), fmtTime(a.t ?? a.creado), etiquetaTipoAviso(p.cat.tiposAviso, a.tipo), [a.desc, a.loc && a.loc.txt].filter(Boolean).join(' · '), named(p.cat.sectores, a.sector), [...new Set(a.part.map(x => unitLabel(s.units[x.u])))].join(', '), AVISO_ESTADO[a.estado], fmtDur(tm.asignacion), fmtDur(tm.respuesta), fmtDur(tm.intervencion), fmtDur(tm.resolucion)]; }), { size: 7 });

  // 6. Descansos
  doc.h2('Descansos');
  const rs = [];
  for (const u of units) for (const r of u.hr) rs.push([u.ind, fmtDateTime(r.ini), r.dur + ' min', fmtTime(r.finPrev), fmtTime(restEnd(r)), fmtDur(Math.min(restEnd(r), t) - r.ini), r.fin != null ? (r.finMotivo || 'Manual') : (r.finPrev <= t ? 'Automático' : 'En curso')]);
  doc.table([{ label: 'Unidad', w: 1 }, { label: 'Inicio', w: 1.4 }, { label: 'Prevista', w: 0.8 }, { label: 'Fin previsto', w: 0.9 }, { label: 'Fin real', w: 0.9 }, { label: 'Duración', w: 0.9, align: 'right' }, { label: 'Finalización', w: 1.2 }], rs);

  // 7. Ubicaciones
  doc.h2('Historial de ubicaciones');
  const ls = [];
  for (const u of units) for (const l of u.hl) ls.push({ t: l.t, r: [fmtDateTime(l.t), u.ind, l.ant ? [l.ant.txt, fmtCoords(l.ant)].filter(Boolean).join(' · ') : '—', [l.txt, fmtCoords(l)].filter(Boolean).join(' · ') || '—'] });
  doc.table([{ label: 'Fecha y hora', w: 1.2 }, { label: 'Unidad', w: 0.9 }, { label: 'Ubicación anterior', w: 2 }, { label: 'Ubicación nueva', w: 2 }], ls.sort((a, b) => a.t - b.t).map(x => x.r));

  // 8. Resumen cronológico
  doc.h2('Resumen cronológico');
  const keyEv = logEntries(engine).filter(e => ['preventivo', 'aviso'].includes(e.cat) || e.accion === 'Asignación de unidad');
  doc.table([{ label: 'Hora', w: 1.2 }, { label: 'Elemento', w: 1.4 }, { label: 'Acción', w: 1.4 }, { label: 'Detalle', w: 3 }], keyEv.map(e => [fmtDateTime(e.t), e.elemento, e.accion, e.nuevo]), { size: 7.5 });

  // 9. Bitácora
  doc.h2('Bitácora completa');
  const log = logEntries(engine, { incluirNoop: true });
  doc.table([{ label: 'Fecha y hora', w: 1.15 }, { label: 'Usuario', w: 0.9 }, { label: 'Elemento', w: 1.2 }, { label: 'Acción', w: 1.2 }, { label: 'Valor anterior', w: 1.6 }, { label: 'Valor nuevo', w: 1.9 }],
    log.map(e => [fmtDateTime(e.t, true), e.usuario, e.elemento, e.accion + (e.estado !== 'ok' ? ' [' + e.estado + ']' : ''), e.anterior, e.nuevo]), { size: 6.8 });

  // 10. Auditoría
  doc.h2('Auditoría');
  doc.para('Cambios de configuración, catálogos, estados del preventivo y resolución de conflictos.', { size: 8.5, color: '#555555' });
  const aud = log.filter(e => ['configuracion', 'preventivo', 'conflicto'].includes(e.cat));
  doc.table([{ label: 'Fecha y hora', w: 1.15 }, { label: 'Usuario', w: 0.9 }, { label: 'Dispositivo', w: 1 }, { label: 'Elemento', w: 1.2 }, { label: 'Acción', w: 1.1 }, { label: 'Anterior', w: 1.5 }, { label: 'Nuevo', w: 1.5 }],
    aud.map(e => [fmtDateTime(e.t, true), e.usuario, e.dispositivo, e.elemento, e.accion, e.anterior, e.nuevo]), { size: 6.8 });
  const conf = Object.values(s.conflicts);
  if (conf.length) {
    doc.para('Conflictos de sincronización', { bold: true });
    doc.table([{ label: 'Hora', w: 1 }, { label: 'Usuario', w: 1 }, { label: 'Motivo', w: 3 }, { label: 'Estado', w: 1 }, { label: 'Resuelto por', w: 1 }],
      conf.map(x => [fmtDateTime(x.t), x.usuario, x.motivo, x.estado, x.resueltoPor || '']), { size: 7 });
  }
  return doc.buildCompressed();
}
