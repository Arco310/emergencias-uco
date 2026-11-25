// Plantillas de preventivo. Una plantilla es una copia independiente: sus cambios
// posteriores no afectan a los preventivos ya creados, y nunca se copian
// identificadores, números de aviso, historiales ni datos operativos.
import { clone, uid, now } from './util.js';
import { defaultCatalogs, DEFAULT_PREV_CFG, SCHEMA_VERSION } from './defaults.js';
import { CATALOGOS } from './engine.js';

const UNIT_REF_FIELDS = ['ind', 'nombre', 'denom', 'tipo', 'subtipo', 'categoria', 'sector', 'desc', 'obs', 'equip', 'caract', 'vis', 'colorC0'];

export function unitReference(u) {
  const r = {};
  for (const k of UNIT_REF_FIELDS) if (u[k] !== undefined) r[k] = clone(u[k]);
  if (u.plan) r.plan = clone(u.plan);
  return r;
}

export function newTemplate({ nombre, descripcion = '', contenido, origen = { tipo: 'manual' } }) {
  const t = now();
  return {
    id: uid('tpl_'), nombre: String(nombre || 'Plantilla').trim(), descripcion, favorita: false, activa: true,
    creada: t, modificada: t, version: SCHEMA_VERSION, revision: 1, revisiones: [], usos: [], origen, contenido: normalizeContent(contenido),
  };
}

export function normalizeContent(c = {}) {
  const cat = { ...defaultCatalogs(), ...(c.cat || {}) };
  for (const k of CATALOGOS) if (!Array.isArray(cat[k])) cat[k] = defaultCatalogs()[k];
  return {
    cat: clone(cat),
    cfg: { ...clone(DEFAULT_PREV_CFG), ...clone(c.cfg || {}) },
    unidades: clone(c.unidades || []),
    plano: c.plano ? clone(c.plano) : null,
    participantes: clone(c.participantes || []),
    roles: clone(c.roles || []),
    modalidad: c.modalidad === 'compartida' ? 'compartida' : 'independiente',
    duracionHoras: c.duracionHoras || null,
    descripcionPrev: c.descripcionPrev || '',
  };
}

export function contentFromConfig(globalCfg) {
  return normalizeContent({ cat: globalCfg.catalogos, cfg: globalCfg.prev });
}

/** Qué se puede incluir o no al crear una plantilla (y si va incluido por defecto). Las personas
 *  previstas son datos personales: solo se copian si se pide expresamente. */
export const ELEMENTOS_PLANTILLA = [
  ['tiposRecurso', 'Tipos de recurso', true],
  ['unidades', 'Unidades previstas', true],
  ['sectores', 'Sectores (con su delimitación)', true],
  ['puntos', 'Puntos de interés y de apoyo', true],
  ['plano', 'Plano y posiciones', true],
  ['capas', 'Capas cartográficas (tipo de mapa)', true],
  ['tiposAviso', 'Configuración de avisos (tipos y códigos)', true],
  ['parametros', 'Parámetros operativos (claves, motivos, descansos…)', true],
  ['reglas', 'Reglas de incoherencias', true],
  ['participantes', 'Usuarios y roles previstos (datos personales)', false],
];
/** Quita de un contenido lo que no se incluye sin dejar referencias rotas. Lo excluido vuelve a «base»
 *  (valores iniciales o la configuración general). `inc[k] === false` excluye; `unidades` (identificadores)
 *  y `sectores` (ids) eligen cuáles se conservan. Sin plano no hay posiciones, puntos ni delimitaciones
 *  (todas se expresan sobre el plano). Se conservan los tipos de recurso que usan las unidades o la
 *  compatibilidad de los tipos de aviso. */
export function recortarContenido(c0, inc = {}, base = null, { unidades = null, sectores = null } = {}) {
  const c = normalizeContent(clone(c0)); const b = normalizeContent(clone(base || {}));
  const si = k => inc[k] !== false;
  if (!si('unidades')) c.unidades = [];
  else if (Array.isArray(unidades)) { const keep = new Set(unidades); c.unidades = c.unidades.filter(u => keep.has(u.ind)); }
  if (!si('plano')) { c.plano = null; for (const u of c.unidades) delete u.plan; c.cat.puntos = []; for (const x of c.cat.sectores) delete x.zona; }
  if (!si('sectores')) c.cat.sectores = clone(b.cat.sectores);
  else if (Array.isArray(sectores)) { const keep = new Set(sectores); c.cat.sectores = c.cat.sectores.filter(x => keep.has(x.id)); }
  const secs = new Set(c.cat.sectores.map(x => x.id));
  for (const u of c.unidades) if (u.sector && !secs.has(u.sector)) delete u.sector;
  if (!si('puntos')) { c.cat.puntos = []; c.cat.categoriasPunto = clone(b.cat.categoriasPunto); }
  if (!si('tiposAviso')) c.cat.tiposAviso = clone(b.cat.tiposAviso);
  if (!si('parametros')) {
    const { vistaMapa, reglas } = c.cfg; c.cfg = clone(b.cfg);
    if (vistaMapa !== undefined) c.cfg.vistaMapa = vistaMapa; if (reglas !== undefined) c.cfg.reglas = reglas;
    c.cat.claves = clone(b.cat.claves); c.cat.motivosEsp = clone(b.cat.motivosEsp);
  }
  if (!si('capas')) { if (b.cfg.vistaMapa) c.cfg.vistaMapa = clone(b.cfg.vistaMapa); else delete c.cfg.vistaMapa; }
  if (!si('reglas')) { if (b.cfg.reglas) c.cfg.reglas = clone(b.cfg.reglas); else delete c.cfg.reglas; }
  if (!si('tiposRecurso')) {
    const usados = new Set([...c.unidades.map(u => u.tipo), ...c.cat.tiposAviso.flatMap(a => a.compatibles || [])].filter(Boolean));
    const ids = new Set(b.cat.tiposRecurso.map(x => x.id));
    c.cat.tiposRecurso = [...clone(b.cat.tiposRecurso), ...c.cat.tiposRecurso.filter(x => usados.has(x.id) && !ids.has(x.id))];
  }
  if (!si('participantes')) c.participantes = [];
  return c;
}
/** Contenido de plantilla a partir de un preventivo (también finalizado). Lo que no se incluye vuelve a los
 *  valores iniciales (ver recortarContenido). Las personas previstas solo se copian si se pide. */
export function contentFromPrev(state, opts = {}) {
  const inc = Object.fromEntries(ELEMENTOS_PLANTILLA.map(([k, , def]) => [k, opts[k] ?? def]));
  const p = state.prev;
  const unidades = Object.values(state.units).filter(u => !u.eliminada && u.sit !== 'archivada').map(unitReference);
  return recortarContenido({
    cat: p.cat, cfg: p.cfg || {}, participantes: p.participantes || [], roles: opts.roles || [], modalidad: p.modalidad,
    descripcionPrev: p.descripcion || '', unidades, plano: p.plano || null,
  }, inc, null);
}
/** Texto del origen de un preventivo: plantilla y versión (y lo que no se heredó), duplicado o nuevo */
export function describirOrigen(o) {
  if (!o || !o.tipo || o.tipo === 'nuevo') return 'Nuevo (configuración general)';
  if (o.tipo === 'duplicado') return 'Duplicado de «' + (o.nombre || '') + '»';
  if (o.tipo !== 'plantilla') return o.tipo + (o.nombre ? ' «' + o.nombre + '»' : '');
  const et = Object.fromEntries(ELEMENTOS_PLANTILLA.map(([k, l]) => [k, l.charAt(0).toLowerCase() + l.slice(1)]));
  const extra = [];
  if (o.excluidos && o.excluidos.length) extra.push('sin heredar: ' + o.excluidos.map(k => et[k] || k).join(', '));
  if (o.unidadesOmitidas) extra.push(o.unidadesOmitidas + (o.unidadesOmitidas === 1 ? ' unidad prevista sin incluir' : ' unidades previstas sin incluir'));
  return 'Plantilla «' + (o.nombre || '') + '»' + (o.revision ? ', versión ' + o.revision : '') + (extra.length ? ' (' + extra.join('; ') + ')' : '');
}
/** ¿Cambia lo que crea la plantilla? (marcarla como favorita o registrar un uso no es otra versión) */
export function cambioContenido(a, b) { return JSON.stringify([a.nombre, a.descripcion, a.contenido]) !== JSON.stringify([b.nombre, b.descripcion, b.contenido]); }
/** Versión siguiente: conserva la anterior tal cual (las 20 últimas) */
export function versionarPlantilla(ant, nueva, por = '') {
  const rev = ant.revision || 1;
  const snap = { revision: rev, t: ant.modificada, por: ant.modificadaPor || '', nombre: ant.nombre, descripcion: ant.descripcion || '', contenido: clone(ant.contenido) };
  return { ...nueva, revision: rev + 1, revisiones: [...(ant.revisiones || []), snap].slice(-20), modificadaPor: por };
}

/** Semilla para crear un preventivo desde una plantilla (copia profunda) */
export function seedFromTemplate(tpl, { incluir = {}, unidades = null, sectores = null } = {}, base = null) {
  const c = recortarContenido(tpl.contenido, incluir, base, { unidades, sectores });
  const excluidos = ELEMENTOS_PLANTILLA.map(e => e[0]).filter(k => incluir[k] === false);
  const origen = { tipo: 'plantilla', id: tpl.id, nombre: tpl.nombre, version: tpl.modificada, revision: tpl.revision || 1 };
  if (excluidos.length) origen.excluidos = excluidos;
  const nU = (tpl.contenido.unidades || []).length - c.unidades.length; if (nU > 0 && incluir.unidades !== false) origen.unidadesOmitidas = nU;
  return {
    cat: c.cat, cfg: c.cfg, plano: c.plano, participantes: c.participantes, modalidad: c.modalidad,
    descripcion: c.descripcionPrev, unidades: c.unidades.map(unitReference), origen,
  };
}

export function exportTemplate(tpl) {
  return { formato: 'uco-plantilla', version: SCHEMA_VERSION, exportada: now(), plantilla: clone(tpl) };
}
export function importTemplate(obj) {
  const tpl = obj && obj.formato === 'uco-plantilla' ? obj.plantilla : obj;
  if (!tpl || !tpl.contenido) throw new Error('El archivo no contiene una plantilla válida');
  const t = newTemplate({ nombre: tpl.nombre, descripcion: tpl.descripcion || '', contenido: tpl.contenido, origen: { tipo: 'importada', nombre: tpl.nombre } });
  return t;
}
