// Bitácora, auditoría y cronologías legibles a partir de las operaciones.
import { claveDef, unitLabel, avisoLabel, restEnd } from './engine.js';
import { fmtTime, fmtDateTime, fmtDur } from './util.js';
import { fmtCoords } from './geo.js';
import { CATEGORIAS_CLAVE } from './defaults.js';
import { tipoAvisoDef, etiquetaTipo, etiquetaTipoAviso } from './incidentes.js';
import { describirOrigen } from './templates.js';
import { ACCIONES_INFORME, FORMATOS_INFORME } from './ubicacion.js';
import { REGLAS } from './validaciones.js';

export const CATEGORIAS = {
  preventivo: 'Preventivo', configuracion: 'Configuración', unidad: 'Unidades', clave: 'Claves', aviso: 'Avisos',
  asignacion: 'Asignaciones', descanso: 'Descansos', ubicacion: 'Ubicaciones', plano: 'Planos', nota: 'Observaciones', conflicto: 'Conflictos',
  control: 'Control operativo', informe: 'Informes',
};

const FIELD = {
  nombre: 'Nombre', descripcion: 'Descripción', fecha: 'Fecha', horaInicio: 'Hora de inicio', horaFin: 'Hora de finalización', lugar: 'Lugar',
  participantes: 'Participantes', ind: 'Identificador', denom: 'Denominación', tipo: 'Tipo', subtipo: 'Subtipo', categoria: 'Categoría',
  sector: 'Sector', sectorOtro: 'Ubicación personalizada (OTROS)', desc: 'Descripción', obs: 'Observaciones', equip: 'Equipamiento', caract: 'Características', t: 'Hora del aviso',
  loc: 'Ubicación', 'vis.icono': 'Icono', 'vis.forma': 'Forma', 'vis.tam': 'Tamaño', 'vis.borde': 'Borde', 'vis.etiqueta': 'Etiqueta',
  'vis.tarjeta': 'Diseño de tarjeta', 'vis.campos': 'Campos visibles', 'vis.enPlano': 'Mostrar en plano', vis: 'Apariencia',
  'cfg.descansoMin': 'Duración del descanso (min)', 'cfg.autoFinalizarAviso': 'Finalizar avisos automáticamente', 'cfg.camposTarjeta': 'Campos de tarjeta',
  'cfg.kpis': 'Indicadores del panel', 'cfg.avisoCompatibilidadEstricta': 'Compatibilidad estricta', 'cierre.nota': 'Nota de cierre',
};
const CATNAME = { claves: 'Claves', motivosEsp: 'Motivos de clave especial', sectores: 'Sectores', tiposAviso: 'Tipos de aviso', tiposRecurso: 'Tipos de recurso' };
const SIT = { activa: 'Activa', desactivada: 'Desactivada', archivada: 'Archivada' };
const PEST = { preparacion: 'En preparación', activo: 'Activo', cerrado: 'Finalizado' };
export const AVISO_ESTADO = { pendiente: 'Pendiente', asignado: 'Asignado', en_curso: 'En curso', finalizado: 'Finalizado' };

function cname(s, code) { const d = claveDef(s.prev, code); return d ? code + ' ' + d.nombre : code; }
function named(list, id) { const x = (list || []).find(e => e.id === id); return x ? x.nombre : (id || '—'); }

export function fmtValue(s, campo, v) {
  if (v == null || v === '') return '—';
  if (campo === 'sector') return v === 'otros' ? 'Otros (ubicación personalizada)' : named(s.prev && s.prev.cat.sectores, v);
  if (campo === 'tipo') { const ta = tipoAvisoDef(s.prev && s.prev.cat.tiposAviso, v); return ta ? etiquetaTipo(ta) : named(s.prev && s.prev.cat.tiposRecurso, v); }
  if (campo === 'loc' || campo === 'lugar') return [v.txt, fmtCoords(v)].filter(Boolean).join(' · ') || '—';
  if (campo === 't') return fmtDateTime(v);
  if (typeof v === 'boolean') return v ? 'Sí' : 'No';
  if (Array.isArray(v)) return v.map(x => (typeof x === 'object' ? (x.nombre || JSON.stringify(x)) : x)).join(', ') || '—';
  if (typeof v === 'object') return Object.entries(v).map(([k, x]) => (FIELD['vis.' + k] || k) + ': ' + (Array.isArray(x) ? x.join(', ') : x)).join('; ');
  return String(v);
}
function fieldsText(s, f, side) {
  return Object.entries(f || {}).map(([k, ch]) => (FIELD[k] || k) + ': ' + fmtValue(s, k.split('.')[0] === 'vis' ? k : k, ch[side])).join(' | ');
}

/** Entrada legible de bitácora para una operación */
export function describeOp(s, op, status) {
  const u = op.k.startsWith('unit.') ? s.units[op.e] : null;
  const a = op.k.startsWith('aviso.') ? s.avisos[op.e] : null;
  const x = op.x || {};
  let cat = 'preventivo', elem = 'Preventivo', acc = op.k, ant = '', nue = '';
  switch (op.k) {
    case 'prev.create': acc = 'Creación del preventivo'; nue = (x.prev && x.prev.nombre) + ' · modalidad ' + (x.prev && x.prev.modalidad) + (x.prev && x.prev.origen && x.prev.origen.nombre ? ' · origen: ' + describirOrigen(x.prev.origen) : ''); break;
    case 'prev.update': cat = Object.keys(x.f || {}).some(k => k.startsWith('cfg.')) ? 'configuracion' : 'preventivo'; acc = 'Modificación'; ant = fieldsText(s, x.f, 'o'); nue = fieldsText(s, x.f, 'n'); break;
    case 'prev.estado': acc = x.o === 'cerrado' ? 'Reapertura' : x.n === 'activo' ? 'Activación' : x.n === 'cerrado' ? 'Finalización' : 'Cambio de estado'; ant = PEST[x.o] || x.o; nue = (PEST[x.n] || x.n) + (x.motivo ? ' · Motivo: ' + x.motivo : '') + (x.advertencias ? ' · Cerrado con advertencias' : ''); break;
    case 'prev.archivo': acc = x.n ? 'Archivado' : 'Recuperado del archivo'; break;
    case 'prev.cat': cat = 'configuracion'; elem = 'Catálogo: ' + (CATNAME[x.cat] || x.cat); acc = 'Modificación de catálogo'; ant = catSummary(x.cat, x.o); nue = catSummary(x.cat, x.n); break;
    case 'prev.plano': cat = 'plano'; elem = 'Plano'; acc = x.n ? 'Plano importado' : 'Plano retirado'; ant = x.o ? x.o.nombre || 'Imagen' : '—'; nue = x.n ? (x.n.nombre || 'Imagen') + (x.n.tipo === 'mapa' ? ' (cartográfico: ' + x.n.bounds.s.toFixed(4) + ', ' + x.n.bounds.w.toFixed(4) + ' — ' + x.n.bounds.n.toFixed(4) + ', ' + x.n.bounds.e.toFixed(4) + ')' : ' (' + x.n.w + '×' + x.n.h + ')') : '—'; break;
    case 'unit.create': cat = 'unidad'; acc = 'Alta de unidad'; nue = [x.u.ind, x.u.nombre, named(s.prev && s.prev.cat.tiposRecurso, x.u.tipo)].filter(Boolean).join(' · '); break;
    case 'unit.update': cat = 'unidad'; acc = 'Modificación'; ant = fieldsText(s, x.f, 'o'); nue = fieldsText(s, x.f, 'n'); break;
    case 'unit.clave': cat = 'clave'; acc = 'Cambio de clave' + (x.forzado ? ' (forzado)' : ''); ant = cname(s, x.o); nue = cname(s, x.n) + (x.motivo ? ' · Motivo: ' + x.motivo : ''); break;
    case 'unit.color': cat = 'unidad'; acc = 'Color C0'; ant = x.o; nue = x.n; break;
    case 'unit.sit': cat = 'unidad'; acc = x.n === 'activa' ? 'Reactivación' : x.n === 'archivada' ? 'Archivado' : 'Desactivación'; ant = SIT[x.o]; nue = SIT[x.n] + (x.motivo ? ' · ' + x.motivo : ''); break;
    case 'unit.delete': cat = 'unidad'; acc = 'Eliminación'; break;
    case 'unit.loc': cat = 'ubicacion'; acc = 'Cambio de ubicación'; ant = fmtValue(s, 'loc', x.o); nue = fmtValue(s, 'loc', x.n); break;
    case 'unit.plan': cat = 'plano'; acc = x.n ? 'Posición en plano' : 'Retirada del plano'; ant = x.o ? pct(x.o) : '—'; nue = x.n ? pct(x.n) : '—'; break;
    case 'unit.rest': cat = 'descanso'; acc = 'Inicio de descanso'; nue = x.dur + ' min · fin previsto ' + fmtTime(op.t + x.dur * 60000); break;
    case 'unit.restEnd': cat = 'descanso'; acc = 'Fin de descanso'; nue = x.motivo || 'Manual'; break;
    case 'unit.nota': cat = 'nota'; acc = x.tipo === 'incidencia' ? 'Incidencia' : 'Observación'; nue = x.txt; break;
    case 'aviso.create': cat = 'aviso'; acc = 'Nuevo aviso'; nue = [etiquetaTipoAviso(s.prev && s.prev.cat.tiposAviso, x.a.tipo), x.a.desc, x.a.loc && x.a.loc.txt, x.a.zona && 'zona de ' + x.a.zona.pts.length + ' puntos'].filter(Boolean).join(' · '); break;
    case 'aviso.update': cat = 'aviso'; acc = 'Modificación'; ant = fieldsText(s, x.f, 'o'); nue = fieldsText(s, x.f, 'n'); break;
    case 'aviso.plan': cat = 'plano'; acc = x.n ? 'Posición en plano' : 'Retirada del plano'; ant = x.o ? pct(x.o) : '—'; nue = x.n ? pct(x.n) : '—'; break;
    case 'aviso.asig': cat = 'asignacion'; acc = 'Asignación de unidad'; nue = unitLabel(s.units[x.u]); break;
    case 'aviso.lib': cat = 'asignacion'; acc = 'Liberación de unidad'; ant = unitLabel(s.units[x.u]); nue = x.motivo || ''; break;
    case 'aviso.estado': cat = 'aviso'; acc = x.n === 'finalizado' ? 'Finalización' : x.o === 'finalizado' ? 'Reapertura' : 'Marcado en curso'; ant = AVISO_ESTADO[x.o] || x.o || ''; nue = (AVISO_ESTADO[x.n] || x.n) + (x.nota ? ' · ' + x.nota : '') + (x.motivo ? ' · Motivo: ' + x.motivo : ''); break;
    case 'aviso.nota': cat = 'nota'; acc = 'Nota en aviso'; nue = x.txt; break;
    case 'conf.resolve': cat = 'conflicto'; acc = 'Resolución de conflicto'; nue = x.d === 'aceptar' ? 'Aceptado' : 'Descartado'; break;
    case 'revision.set': {
      cat = 'control'; const regla = REGLAS.find(r => r.id === x.regla);
      elem = 'Incoherencia' + (regla ? ': ' + regla.titulo : '');
      acc = { revisada: 'Marcada como revisada', asignada: 'Asignada', resuelta: 'Resuelta', abierta: 'Reabierta' }[x.estado] || 'Revisión';
      nue = [x.entidad && x.entidad.nombre, x.asignadoA && x.asignadoA.nombre ? 'asignada a ' + x.asignadoA.nombre : '', x.nota].filter(Boolean).join(' · '); break;
    }
    case 'informe.reg':
      cat = 'informe'; elem = 'Informe'; acc = (ACCIONES_INFORME[x.accion] || 'Informe') + (x.n ? ' (versión ' + x.n + ')' : '');
      nue = [FORMATOS_INFORME[x.formato], x.hash && 'SHA-256 ' + x.hash.slice(0, 16) + '…', x.motivo && 'Motivo: ' + x.motivo,
        x.provisional && 'provisional' + (x.pendientes ? ': ' + x.pendientes + (x.pendientes === 1 ? ' cambio sin sincronizar' : ' cambios sin sincronizar') : '') + (x.conflictos ? (x.pendientes ? ', ' : ': ') + x.conflictos + ' conflicto(s) sin resolver' : '')].filter(Boolean).join(' · ');
      break;
  }
  if (u) elem = 'Unidad ' + unitLabel(u);
  if (a) elem = 'Aviso ' + avisoLabel(a);
  return {
    id: op.id, t: op.t, h: op.h, usuario: op.u ? op.u.n : '', dispositivo: op.dn || op.d, cat, elemento: elem, accion: acc,
    anterior: ant || '', nuevo: nue || '', entidad: op.e, k: op.k,
    estado: status ? status.status : 'ok', motivoEstado: status && status.reason ? status.reason : '',
  };
}
/** Posición en el plano: coordenadas reales en planos cartográficos; si no, posición relativa */
function pct(p) { return p.lat != null ? p.lat.toFixed(5) + ', ' + p.lon.toFixed(5) : Math.round(p.x * 100) + '%, ' + Math.round(p.y * 100) + '%'; }
function catSummary(cat, list) {
  if (!Array.isArray(list)) return '—';
  if (cat === 'motivosEsp') return list.join(', ');
  return list.length + ' elementos: ' + list.map(e => e.codigo ? e.codigo + ' ' + e.nombre : e.nombre).join(', ');
}

/** Bitácora completa (con filtros) */
export function logEntries(engine, { cat, entidad, usuario, texto, desde, hasta, incluirNoop = false } = {}) {
  const s = engine.state; const out = [];
  for (const op of engine.ops) {
    const st = engine.status.get(op.id);
    if (!incluirNoop && st && st.status === 'noop') continue;
    const e = describeOp(s, op, st);
    if (cat && e.cat !== cat) continue;
    if (entidad && !(op.e === entidad || (op.x && op.x.u === entidad))) continue;
    if (usuario && e.usuario !== usuario) continue;
    if (desde && e.t < desde) continue;
    if (hasta && e.t > hasta) continue;
    if (texto) { const q = texto.toLowerCase(); if (![e.elemento, e.accion, e.anterior, e.nuevo, e.usuario].join(' ').toLowerCase().includes(q)) continue; }
    out.push(e);
  }
  return out;
}

/** Cronología individual de una unidad (estado derivado: independiente de la pantalla) */
export function unitChronology(engine, unitId, until) {
  const s = engine.state; const u = s.units[unitId]; if (!u) return [];
  const ev = [];
  ev.push({ t: u.creada, tipo: 'alta', texto: 'Alta en el preventivo', dur: null });
  for (let i = 0; i < u.hc.length; i++) {
    const c = u.hc[i]; const nxt = u.hc[i + 1];
    if (i === 0) continue;
    const def = claveDef(s.prev, c.c);
    ev.push({
      t: c.t, tipo: 'clave', color: def ? def.color : null,
      texto: 'Clave ' + cname(s, c.c) + (c.m ? ' · ' + c.m : '') + (c.auto === 'asignacion' ? ' (automática al asignar)' : c.auto ? ' (automática)' : ''),
      dur: (nxt ? nxt.t : until) - c.t, abierta: !nxt,
    });
  }
  for (let i = 1; i < u.hs.length; i++) ev.push({ t: u.hs[i].t, tipo: 'situacion', texto: 'Situación: ' + SIT[u.hs[i].s], dur: null });
  for (const r of u.hr) {
    ev.push({ t: r.ini, tipo: 'descanso', texto: 'Inicio de descanso (' + r.dur + ' min, fin previsto ' + fmtTime(r.finPrev) + ')', dur: Math.min(restEnd(r), until) - r.ini, abierta: restEnd(r) > until });
    if (r.fin != null) ev.push({ t: r.fin, tipo: 'descanso', texto: 'Fin de descanso: ' + (r.finMotivo || 'manual'), dur: null });
    else if (r.finPrev <= until) ev.push({ t: r.finPrev, tipo: 'descanso', texto: 'Fin de descanso (automático al cumplirse el tiempo)', dur: null });
  }
  for (let i = 0; i < u.hl.length; i++) { const l = u.hl[i]; ev.push({ t: l.t, tipo: 'ubicacion', texto: 'Ubicación: ' + ([l.txt, fmtCoords(l)].filter(Boolean).join(' · ') || 'sin ubicación'), dur: (u.hl[i + 1] ? u.hl[i + 1].t : until) - l.t }); }
  for (const n of u.hn) ev.push({ t: n.t, tipo: n.tipo === 'incidencia' ? 'incidencia' : 'observacion', texto: (n.tipo === 'incidencia' ? 'Incidencia: ' : 'Observación: ') + n.txt + (n.por ? ' (' + n.por + ')' : ''), dur: null });
  for (const aid of u.ha) {
    const a = s.avisos[aid]; if (!a) continue;
    for (const p of a.part) {
      if (p.u !== u.id) continue;
      ev.push({ t: p.asig, tipo: 'aviso', texto: 'Asignada al aviso ' + avisoLabel(a) + (a.desc ? ' · ' + a.desc : ''), dur: (p.lib != null ? p.lib : until) - p.asig, abierta: p.lib == null, aviso: a.id });
      if (p.llegada != null) ev.push({ t: p.llegada, tipo: 'aviso', texto: 'Llegada al punto del aviso ' + avisoLabel(a), dur: null, aviso: a.id });
      if (p.lib != null) ev.push({ t: p.lib, tipo: 'aviso', texto: 'Liberada del aviso ' + avisoLabel(a) + (p.motivoLib ? ' · ' + p.motivoLib : ''), dur: null, aviso: a.id });
    }
  }
  for (const op of engine.ops) {
    if (op.e !== unitId) continue;
    const st = engine.status.get(op.id); if (!st || st.status !== 'ok') continue;
    if (op.k === 'unit.update' || op.k === 'unit.color' || op.k === 'unit.plan') {
      const d = describeOp(s, op, st);
      ev.push({ t: op.t, tipo: 'modificacion', texto: d.accion + ': ' + (d.anterior ? d.anterior + ' → ' : '') + d.nuevo, dur: null, usuario: d.usuario });
    }
  }
  return ev.sort((x, y) => x.t - y.t);
}
export const CRONO_TIPOS = {
  alta: 'Altas', clave: 'Claves', aviso: 'Avisos', descanso: 'Descansos', ubicacion: 'Ubicaciones',
  observacion: 'Observaciones', incidencia: 'Incidencias', situacion: 'Situación', modificacion: 'Modificaciones',
};

/** Historial de un aviso */
export function avisoHistory(engine, avisoId) {
  const s = engine.state; const a = s.avisos[avisoId]; if (!a) return [];
  const ev = a.hist.map(h => ({ t: h.t, texto: 'Estado: ' + (AVISO_ESTADO[h.n] || h.n), tipo: 'estado' }));
  for (const p of a.part) {
    const u = s.units[p.u];
    ev.push({ t: p.asig, texto: 'Asignada ' + unitLabel(u), tipo: 'asignacion' });
    if (p.llegada != null) ev.push({ t: p.llegada, texto: unitLabel(u) + ' llega al punto', tipo: 'llegada' });
    if (p.salida != null) ev.push({ t: p.salida, texto: unitLabel(u) + ' deja el punto', tipo: 'salida' });
    if (p.lib != null) ev.push({ t: p.lib, texto: 'Liberada ' + unitLabel(u) + (p.motivoLib ? ' · ' + p.motivoLib : ''), tipo: 'liberacion' });
  }
  for (const n of a.notas) ev.push({ t: n.t, texto: 'Nota: ' + n.txt + (n.por ? ' (' + n.por + ')' : ''), tipo: 'nota' });
  for (const r of a.reaperturas) ev.push({ t: r.t, texto: 'Reabierto: ' + r.motivo + (r.por ? ' (' + r.por + ')' : ''), tipo: 'reapertura' });
  for (const p of a.part) {
    const u = s.units[p.u]; if (!u) continue;
    for (const c of u.hc) if (c.t > p.asig && (p.lib == null || c.t <= p.lib) && c.auto !== 'asignacion') ev.push({ t: c.t, texto: unitLabel(u) + ' → ' + cname(s, c.c), tipo: 'clave' });
  }
  return ev.sort((x, y) => x.t - y.t);
}

export function claveCategoria(cat) { return CATEGORIAS_CLAVE[cat] || cat; }
export { fmtDur };
