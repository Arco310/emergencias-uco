// Informe PDF del preventivo (se genera sin Internet).
import { PDFDoc } from './pdf.js';
import { fmtDateTime, fmtDur, fmtTime, now } from './util.js';
import { claveDef, unitLabel, avisoLabel, SITUACION_LABEL, unitSituation, restEnd, counts, sectorNombre } from './engine.js';
import { prevStats, avisoTimes, TIEMPOS_AVISO } from './stats.js';
import { logEntries, describeOp, AVISO_ESTADO } from './timeline.js';
import { fmtCoords } from './geo.js';
import { APP_NAME, APP_VERSION } from './defaults.js';
import { etiquetaTipoAviso, tipoAvisoDef } from './incidentes.js';
import { describirOrigen } from './templates.js';
import { activePeriods } from './stats.js';
import { fiabilidadHoras } from './fiabilidad.js';
import { detectarIncoherencias, NIVELES } from './validaciones.js';
import { ACCIONES_INFORME, FORMATOS_INFORME } from './ubicacion.js';
import { nombreVista } from './mapas.js';

const named = (list, id) => ((list || []).find(x => x.id === id) || {}).nombre || '—';
const PEST = { preparacion: 'En preparación', activo: 'Activo', cerrado: 'Finalizado' };

/** Color aclarado (mezcla con blanco) para rellenos del esquema del plano */
function aclarar(hex, k = 0.75) {
  const v = String(hex || '#999999').replace('#', ''); if (!/^[0-9a-fA-F]{6}$/.test(v)) return '#EEEEEE';
  return '#' + [0, 2, 4].map(i => Math.round(parseInt(v.slice(i, i + 2), 16) * (1 - k) + 255 * k).toString(16).padStart(2, '0')).join('');
}
/** Identidad UCO en la cabecera de la primera página */
function identidad(doc, t) {
  const x = doc.m, y = doc.y;
  doc.rect(x, y, 26, 26, { fill: '#C62828' });
  doc.rect(x + 10, y + 5, 6, 16, { fill: '#FFFFFF' }); doc.rect(x + 5, y + 10, 16, 6, { fill: '#FFFFFF' });
  doc.text(x + 34, y + 2, APP_NAME, { size: 12, bold: true, color: '#C62828' });
  doc.text(x + 34, y + 15, 'Coordinación de recursos sanitarios en preventivos', { size: 8, color: '#555555' });
  const f = 'Generado el ' + fmtDateTime(t); doc.text(doc.W - doc.m - doc.textWidth(f, 8), y + 9, f, { size: 8, color: '#555555' });
  doc.y += 34; doc.line(doc.m, doc.y, doc.W - doc.m, doc.y, { color: '#C62828', lw: 1.2 }); doc.y += 10;
}
/** Esquema del plano: sectores delimitados, puntos, avisos y unidades en su última posición (sin fondo: se genera sin Internet) */
function esquemaPlano(doc, s) {
  const p = s.prev; const pl = p.plano;
  let asp = 1.4;
  if (pl.tipo === 'mapa' && pl.bounds) { const b = pl.bounds; const lat = (b.n + b.s) / 2 * Math.PI / 180; asp = Math.max(0.3, Math.min(4, ((b.e - b.w) * Math.cos(lat)) / Math.max(1e-9, b.n - b.s))); }
  else if (pl.w && pl.h) asp = Math.max(0.3, Math.min(4, pl.w / pl.h));
  const W = doc.width; const H = Math.min(330, W / asp); const w = H * asp; const x0 = doc.m + (W - w) / 2;
  doc.ensure(H + 110); doc.h2('Plano del preventivo'); const y0 = doc.y; // el título va con el esquema
  const X = q => x0 + Math.max(0, Math.min(1, q.x)) * w; const Y = q => y0 + Math.max(0, Math.min(1, q.y)) * H;
  doc.rect(x0, y0, w, H, { fill: '#F7F8FA', stroke: '#90A4AE', lw: 0.8 });
  for (const sec of p.cat.sectores || []) {
    if (!sec.zona || !(sec.zona.pts || []).length) continue;
    const pts = sec.zona.pts.map(q => [X(q), Y(q)]);
    doc.poly(pts, { fill: aclarar(sec.color, 0.8), stroke: sec.color || '#607D8B', lw: 1 });
    const cx = pts.reduce((a, q) => a + q[0], 0) / pts.length, cy = pts.reduce((a, q) => a + q[1], 0) / pts.length;
    doc.text(cx - doc.textWidth(sec.nombre, 7.5, true) / 2, cy - 4, sec.nombre, { size: 7.5, bold: true, color: '#37474F' });
  }
  const cats = new Map((p.cat.categoriasPunto || []).map(c => [c.id, c]));
  for (const pt of p.cat.puntos || []) {
    if (!pt.pos) continue; const c = cats.get(pt.categoria) || {};
    doc.rect(X(pt.pos) - 3.5, Y(pt.pos) - 3.5, 7, 7, { fill: c.color || '#546E7A', stroke: '#FFFFFF', lw: 0.6 });
    doc.text(X(pt.pos) + 5, Y(pt.pos) - 3.5, pt.nombre, { size: 6.5, color: '#37474F' });
  }
  for (const a of Object.values(s.avisos)) {
    if (!a.plan) continue; const ax = X(a.plan), ay = Y(a.plan);
    const col = (tipoAvisoDef(p.cat.tiposAviso, a.tipo) || {}).color || '#E65100';
    doc.poly([[ax, ay - 5], [ax + 5, ay], [ax, ay + 5], [ax - 5, ay]], { fill: a.estado === 'finalizado' ? '#BDBDBD' : col, stroke: '#FFFFFF', lw: 0.6 });
    doc.text(ax + 6, ay - 3, avisoLabel(a), { size: 6.5, bold: true, color: '#BF360C' });
  }
  for (const u of Object.values(s.units)) {
    if (u.eliminada || !u.plan) continue; const ux = X(u.plan), uy = Y(u.plan); const d = claveDef(p, u.clave);
    doc.circle(ux, uy, 5, { fill: (d && d.color) || '#607D8B', stroke: u.colorC0 || '#263238', lw: 1.6 });
    doc.text(ux + 7, uy - 3.5, u.ind, { size: 7, bold: true, color: '#212121' });
  }
  doc.y = y0 + H + 6;
  doc.para('Unidades (círculo): color de su clave al cierre y borde con su color C0. Avisos (rombo, gris si finalizado). Puntos de interés y de apoyo (cuadrado). Zonas sombreadas: sectores delimitados.'
    + (pl.tipo === 'mapa' ? ' Esquema sin el mapa de fondo: el informe se genera sin Internet.' : ''), { size: 7.5, color: '#555555' });
}
const PCT = (a, b) => (b > 0 ? Math.round(a / b * 100) + ' %' : '—');

export async function buildReport(engine, { usuario = '', dispositivo = '', version = null, horas = null } = {}) {
  const s = engine.state; const p = s.prev; const t = now();
  const st = prevStats(s, t);
  const doc = new PDFDoc({ title: 'Informe del preventivo: ' + p.nombre, author: usuario });
  doc.footer = APP_NAME + ' · ' + p.nombre + ' · generado ' + fmtDateTime(t) + (version ? ' · versión ' + version.n + (version.provisional ? ' (provisional)' : '') : '');
  identidad(doc, t);

  // 1. Información general
  doc.h1('Informe del preventivo');
  doc.para(p.nombre, { size: 14, bold: true, color: '#212121' });
  if (version) {
    doc.para('Versión ' + version.n + ' del informe' + (version.motivo ? ' · Motivo: ' + version.motivo : version.n === 1 ? ' · generada al finalizar el preventivo' : ''), { size: 10, bold: true, color: '#1A237E' });
    if (version.provisional) {
      const por = [p.estado !== 'cerrado' && 'el preventivo no está finalizado', version.pendientes && version.pendientes + ' cambio(s) de este dispositivo sin sincronizar', version.conflictos && version.conflictos + ' conflicto(s) sin resolver'].filter(Boolean);
      const txt = 'PROVISIONAL' + (por.length ? ': ' + por.join('; ') + '.' : '.') + ' Puede faltar información; genera una nueva versión cuando se resuelva.';
      const lines = doc.wrap(txt, doc.width - 16, 9, true); const hh = lines.length * 12 + 8;
      doc.ensure(hh + 4); doc.rect(doc.m, doc.y, doc.width, hh, { fill: '#FFEBEE', stroke: '#C62828', lw: 0.8 });
      lines.forEach((l, i) => doc.text(doc.m + 8, doc.y + 5 + i * 12, l, { size: 9, bold: true, color: '#B71C1C' }));
      doc.y += hh + 6;
    }
  }
  doc.kv([
    ['Fecha', p.fecha || '—'], ['Horario previsto', (p.horaInicio || '—') + ' – ' + (p.horaFin || '—')],
    ['Lugar', p.lugar ? [p.lugar.txt, fmtCoords(p.lugar)].filter(Boolean).join(' · ') : '—'], ['Modalidad', p.modalidad === 'compartida' ? 'Compartida (varios dispositivos)' : 'Independiente'],
    ['Estado', PEST[p.estado] + (p.archivado ? ' (archivado)' : '')], ['Creado', fmtDateTime(p.creado) + ' por ' + (p.creadoPor || '—')],
    ['Activado', p.activadoEn ? fmtDateTime(p.activadoEn) : '—'], ['Finalizado', p.cerradoEn ? fmtDateTime(p.cerradoEn) + ' por ' + (p.cerradoPor || '—') : '—'],
    ['Duración analizada', fmtDur(st.duracion)], ['Origen', describirOrigen(p.origen)],
    ['Informe generado', fmtDateTime(t) + ' por ' + (usuario || '—')], ['Aplicación', APP_NAME + ' ' + APP_VERSION + (dispositivo ? ' · ' + dispositivo : '')],
  ]);
  if (p.descripcion) doc.para(p.descripcion);
  const parts = p.participantes || [];
  if (parts.length) {
    const resp = parts.filter(x => /respons|coordin|jef|direc|mando/i.test(x.rol || ''));
    doc.para('Responsables', { bold: true });
    doc.para(resp.length ? resp.map(x => x.nombre + (x.rol ? ' (' + x.rol + ')' : '')).join(' · ') : 'Sin responsable indicado entre los participantes.', { size: 9 });
    if (parts.length > resp.length) doc.para('Participantes previstos: ' + parts.filter(x => !resp.includes(x)).map(x => x.nombre + (x.rol ? ' (' + x.rol + ')' : '')).join(' · '), { size: 8.5, color: '#444444' });
  }
  if (p.reaperturas && p.reaperturas.length) doc.para('Reaperturas: ' + p.reaperturas.map(r => fmtDateTime(r.t) + ' (' + r.por + '): ' + r.motivo).join(' | '), { color: '#B71C1C' });
  if (p.cierreAvisos) {
    const w = p.cierreAvisos;
    doc.para('Finalizado con advertencias: ' + [w.pendientes.length && 'avisos pendientes ' + w.pendientes.join(', '), w.activos.length && 'avisos activos ' + w.activos.join(', '), w.ocupadas.length && 'unidades ocupadas ' + w.ocupadas.join(', '), w.descansos.length && 'descansos activos ' + w.descansos.join(', '), w.conflictos && w.conflictos + ' conflictos sin resolver'].filter(Boolean).join('; '), { color: '#B71C1C' });
  }

  // 1b. Configuración y sectores utilizados (1.5.0)
  doc.h2('Configuración y sectores utilizados');
  const unidadesVivas = Object.values(s.units).filter(u => !u.eliminada);
  const tiposUsados = new Set(unidadesVivas.map(u => u.tipo));
  doc.kv([
    ['Plano', p.plano ? (p.plano.nombre || 'Plano') + (p.plano.tipo === 'mapa' ? ' (cartográfico)' : ' (imagen)') : 'Sin plano'],
    ['Tipo de mapa', p.plano && p.plano.tipo === 'mapa' ? nombreVista((p.cfg || {}).vistaMapa) : '—'],
    ['Claves operativas', p.cat.claves.map(k => k.codigo).join(', ')], ['Tipos de aviso disponibles', String((p.cat.tiposAviso || []).length)],
    ['Tipos de recurso utilizados', [...tiposUsados].map(id => named(p.cat.tiposRecurso, id)).join(', ') || '—'], ['Descanso por defecto', ((p.cfg || {}).descansoMin || 30) + ' min'],
    ['Reglas de incoherencias', (p.cfg || {}).reglas && Object.keys(p.cfg.reglas).length ? Object.keys(p.cfg.reglas).length + ' ajustadas para este preventivo' : 'Las predeterminadas'],
    ['Puntos de interés y de apoyo', String((p.cat.puntos || []).length)],
  ]);
  const avPorSec = {}; for (const a of Object.values(s.avisos)) avPorSec[a.sector || '_'] = (avPorSec[a.sector || '_'] || 0) + 1;
  doc.table([{ label: 'Sector', w: 2 }, { label: 'Delimitado en el plano', w: 1.2 }, { label: 'Unidades', w: 0.8, align: 'right' }, { label: 'Avisos', w: 0.8, align: 'right' }],
    (p.cat.sectores || []).map(x => [x.nombre, x.zona ? 'Sí' : 'No', unidadesVivas.filter(u => u.sector === x.id).length, avPorSec[x.id] || 0])
      .concat(avPorSec._ || unidadesVivas.some(u => !u.sector) ? [['Sin sector', '—', unidadesVivas.filter(u => !u.sector).length, avPorSec._ || 0]] : []));
  if (p.plano) esquemaPlano(doc, s);

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

  // 2b. Utilización de los recursos (1.5.0): solo tiempos registrados
  doc.h2('Utilización de los recursos');
  const enAvisosTotal = st.porUnidad.reduce((a, x) => a + x.enAvisos, 0); const servTotal = st.porUnidad.reduce((a, x) => a + x.servicio, 0);
  const interv = st.porUnidad.reduce((a, x) => a + x.participaciones.length, 0);
  doc.kv([['Intervenciones (asignaciones a avisos)', String(interv)], ['Tiempo total en avisos', fmtDur(enAvisosTotal)], ['Tiempo total en descanso', fmtDur(st.descansos.tiempo)], ['Ocupación media en avisos', PCT(enAvisosTotal, servTotal)]]);
  doc.table([{ label: 'Unidad', w: 1.1 }, { label: 'En servicio', w: 1, align: 'right' }, { label: 'En avisos', w: 1, align: 'right' }, { label: 'Ocupación', w: 0.9, align: 'right' }, { label: 'En descanso', w: 1, align: 'right' }, { label: 'Intervenciones', w: 1, align: 'right' }],
    st.porUnidad.slice().sort((a, b) => unitLabel(a.u).localeCompare(unitLabel(b.u))).map(x => [x.u.ind, fmtDur(x.servicio), fmtDur(x.enAvisos), PCT(x.enAvisos, x.servicio), fmtDur(x.enDescanso), x.participaciones.length]));

  // 3. Unidades
  doc.h2('Unidades');
  const units = Object.values(s.units).filter(u => !u.eliminada).sort((a, b) => unitLabel(a).localeCompare(unitLabel(b)));
  const byU = new Map(st.porUnidad.map(x => [x.u.id, x]));
  doc.table([{ label: 'Identificador', w: 1.2 }, { label: 'Nombre', w: 1.4 }, { label: 'Tipo', w: 1.5 }, { label: 'Sector', w: 1 }, { label: 'Clave final', w: 1.3 }, { label: 'Situación', w: 1 }, { label: 'Avisos', w: 0.7, align: 'right' }, { label: 'En avisos', w: 1, align: 'right' }, { label: 'Descansos', w: 0.9, align: 'right' }, { label: 'Servicio', w: 1, align: 'right' }],
    units.map(u => { const x = byU.get(u.id); const d = claveDef(p, u.clave); return [u.ind, u.nombre, named(p.cat.tiposRecurso, u.tipo), sectorNombre(p, u, 'Pendiente'), u.clave + ' ' + (d ? d.nombre : ''), SITUACION_LABEL[unitSituation(s, u, t)], x.nAvisos, fmtDur(x.enAvisos), x.nDescansos + ' · ' + fmtDur(x.enDescanso), fmtDur(x.servicio)]; }),
    { colorCol: { 0: ri => units[ri].colorC0 } });
  const incid = detectarIncoherencias(s, { t: st.fin });
  doc.para('Actividad por unidad', { bold: true });
  doc.table([{ label: 'Unidad', w: 0.9 }, { label: 'Periodos de actividad', w: 1.6 }, { label: 'Claves utilizadas', w: 1.2 }, { label: 'Ubicaciones', w: 0.8, align: 'right' }, { label: 'Descansos', w: 0.8, align: 'right' }, { label: 'Avisos atendidos', w: 1.4 }, { label: 'Incidencias', w: 0.8, align: 'right' }],
    units.map(u => {
      const per = activePeriods(u, st.fin).map(([a, b]) => fmtTime(a) + '–' + fmtTime(b)).join(', ') || '—';
      const cl = [...new Set(u.hc.map(c => c.c))].join(', ');
      const avs = [...new Set(u.ha)].map(id => s.avisos[id]).filter(Boolean).map(avisoLabel).join(', ') || '—';
      const nInc = incid.filter(h => h.entidad && h.entidad.id === u.id).length + (u.notas || []).filter(n => n.tipo === 'incidencia').length;
      return [u.ind, per, cl, u.hl.length, u.hr.length, avs, nInc];
    }), { size: 7.5 });

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

  // 5b. Avisos al cierre (1.5.0)
  doc.para('Avisos al cierre', { bold: true });
  const abiertos = avisos.filter(a => a.estado !== 'finalizado');
  doc.kv([['Finalizados', String(avisos.length - abiertos.length)], ['Pendientes', String(avisos.filter(a => a.estado === 'pendiente').length)], ['Asignados', String(avisos.filter(a => a.estado === 'asignado').length)], ['En curso', String(avisos.filter(a => a.estado === 'en_curso').length)]]);
  doc.para(abiertos.length ? 'Avisos sin finalizar al cierre: ' + abiertos.map(a => avisoLabel(a) + ' (' + (AVISO_ESTADO[a.estado] || a.estado) + ')').join(', ') : 'Todos los avisos estaban finalizados al cierre.', { size: 9, color: abiertos.length ? '#B71C1C' : '#2E7D32' });

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

  // 8. Cronología de acontecimientos relevantes (1.5.0: incorporaciones, cambios operativos, descansos, ubicaciones e incidencias)
  doc.h2('Cronología');
  doc.para('Inicio, incorporación de unidades, cambios de clave, avisos y asignaciones, descansos, cambios de ubicación, incidencias y finalización, por la hora declarada.', { size: 8.5, color: '#555555' });
  const keyEv = logEntries(engine).filter(e => ['preventivo', 'unidad', 'clave', 'aviso', 'asignacion', 'descanso', 'ubicacion', 'conflicto', 'control'].includes(e.cat) || (e.cat === 'nota' && e.accion === 'Incidencia'));
  doc.table([{ label: 'Hora', w: 1.2 }, { label: 'Elemento', w: 1.4 }, { label: 'Acción', w: 1.4 }, { label: 'Detalle', w: 3 }], keyEv.map(e => [fmtDateTime(e.t), e.elemento, e.accion, e.nuevo]), { size: 7.5 });

  // 8b. Incidencias detectadas (1.5.0): incoherencias al cierre, con su revisión; nada se corrige automáticamente
  doc.h2('Incidencias detectadas');
  if (incid.length) {
    doc.para('Situaciones incoherentes detectadas con los datos al cierre (no se ha cambiado nada automáticamente).', { size: 8.5, color: '#555555' });
    doc.table([{ label: 'Nivel', w: 0.8 }, { label: 'Incidencia', w: 2 }, { label: 'Elemento', w: 1.4 }, { label: 'Desde', w: 0.9 }, { label: 'Revisión', w: 1.5 }],
      incid.map(h => [(NIVELES[h.nivel] || {}).nombre || h.nivel, h.titulo, h.entidad ? h.entidad.nombre : '—', h.desde ? fmtTime(h.desde) : '—', h.revision ? h.revision.estado + (h.revision.por ? ' (' + h.revision.por + ')' : '') : 'Sin revisar']), { size: 7.5 });
  } else doc.para('No se detectan situaciones incoherentes con los datos al cierre.', { size: 9 });
  const notasInc = []; for (const u of Object.values(s.units)) for (const n of u.notas || []) if (n.tipo === 'incidencia') notasInc.push([fmtDateTime(n.t), u.ind, n.por || '', n.txt]);
  if (notasInc.length) { doc.para('Incidencias anotadas en las unidades', { bold: true }); doc.table([{ label: 'Hora', w: 1 }, { label: 'Unidad', w: 0.8 }, { label: 'Anotada por', w: 1 }, { label: 'Texto', w: 3.5 }], notasInc, { size: 7.5 }); }

  // 8c. Fiabilidad de los datos y limitaciones (1.5.0): horas declaradas, recibidas y sincronizadas
  doc.h2('Fiabilidad de los datos y limitaciones');
  const compartido = horas ? !!horas.compartido : p.modalidad === 'compartida';
  const f = fiabilidadHoras(engine.ops, (horas && horas.meta) || new Map(), { compartido });
  doc.para('Todos los tiempos del informe se calculan con la hora declarada por el dispositivo que registró cada cambio. En los preventivos compartidos se conserva además la hora en que el servidor lo recibió y la hora en que este dispositivo lo sincronizó; no se corrige ni se estima ninguna hora.', { size: 8.5 });
  doc.kv([['Registros analizados', String(f.total)], ['Con hora de recepción del servidor', compartido ? String(f.conServidor) : 'No aplica (independiente)'], ['Pendientes de enviar desde este dispositivo', String(f.pendientes)], ['Dispositivos que registraron cambios', String(f.dispositivos.length)]], { size: 9 });
  if (f.dispositivos.length) doc.table([{ label: 'Dispositivo', w: 1.6 }, { label: 'Registros', w: 0.8, align: 'right' }, { label: 'Diferidos', w: 0.8, align: 'right' }, { label: 'Mayor retraso', w: 1, align: 'right' }, { label: 'Reloj adelantado', w: 1, align: 'right' }],
    f.dispositivos.map(d => [d.nombre, d.ops, compartido ? d.diferidos : '—', d.maxRetraso ? fmtDur(d.maxRetraso) : '—', d.adelanto ? fmtDur(d.adelanto) : '—']), { size: 7.5 });
  const otras = [];
  for (const [k, [lbl]] of Object.entries(TIEMPOS_AVISO)) if (st.avisos.total && st.avisos.tiempos[k].n < st.avisos.total) otras.push(lbl + ': ' + (st.avisos.total - st.avisos.tiempos[k].n) + ' aviso(s) sin los datos necesarios; no se estiman.');
  const confPend = Object.values(s.conflicts).filter(x => x.estado === 'pendiente').length;
  if (confPend) otras.push(confPend + ' conflicto(s) de sincronización sin resolver: los valores afectados pueden no ser definitivos.');
  if (p.cierreAvisos) otras.push('El preventivo se finalizó con advertencias (ver «Avisos al cierre»).');
  const lim = [...f.limitaciones, ...otras];
  doc.para('Limitaciones', { bold: true });
  for (const l of lim.length ? lim : ['No se han detectado limitaciones en los datos registrados.']) doc.para('• ' + l, { size: 8.5 });
  if (f.diferidos.length) {
    doc.para('Registros diferidos (declarados más de 2 min antes de su recepción en el servidor)', { bold: true });
    doc.table([{ label: 'Hora declarada', w: 1.15 }, { label: 'Recibida en el servidor', w: 1.15 }, { label: 'Sincronizada aquí', w: 1.15 }, { label: 'Diferencia', w: 0.8, align: 'right' }, { label: 'Dispositivo', w: 1 }, { label: 'Acción', w: 1.6 }],
      f.diferidos.slice(0, 200).map(x => { const e = describeOp(s, x.op, engine.status.get(x.op.id)); return [fmtDateTime(x.op.t, true), fmtDateTime(x.rx, true), x.sy ? fmtDateTime(x.sy, true) : '—', fmtDur(x.retraso), e.dispositivo, e.elemento + ': ' + e.accion]; }), { size: 7 });
    if (f.diferidos.length > 200) doc.para('… y ' + (f.diferidos.length - 200) + ' más (todos figuran en la exportación Excel o CSV).', { size: 8 });
  }

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
  // 11. Registro del informe (1.5.0): versiones, exportaciones y consultas
  const reg = s.informes || [];
  if (reg.length) {
    doc.h2('Registro del informe');
    doc.table([{ label: 'Fecha y hora', w: 1.15 }, { label: 'Acción', w: 1.2 }, { label: 'Versión', w: 0.6, align: 'right' }, { label: 'Formato', w: 0.7 }, { label: 'Usuario', w: 0.9 }, { label: 'Dispositivo', w: 0.9 }, { label: 'SHA-256 / motivo', w: 2 }],
      reg.map(r => [fmtDateTime(r.t, true), ACCIONES_INFORME[r.accion] || r.accion, r.n ?? '', FORMATOS_INFORME[r.formato] || r.formato || '', r.por, r.dev, [r.hash ? r.hash.slice(0, 32) + '…' : '', r.motivo].filter(Boolean).join(' · ')]), { size: 7 });
  }
  return doc.buildCompressed();
}
