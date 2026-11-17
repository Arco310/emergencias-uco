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
    id: uid('tpl_'), nombre: String(nombre || 'Plantilla').trim(), descripcion, favorita: false,
    creada: t, modificada: t, version: SCHEMA_VERSION, usos: [], origen, contenido: normalizeContent(contenido),
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

/** Contenido de plantilla a partir de un preventivo existente */
export function contentFromPrev(state, { unidades = true, plano = true, roles = [] } = {}) {
  const p = state.prev;
  return normalizeContent({
    cat: p.cat, cfg: p.cfg, participantes: p.participantes || [], roles, modalidad: p.modalidad,
    descripcionPrev: p.descripcion || '',
    unidades: unidades ? Object.values(state.units).filter(u => !u.eliminada && u.sit !== 'archivada').map(u => {
      const r = unitReference(u); if (!plano) delete r.plan; return r;
    }) : [],
    plano: plano && p.plano ? p.plano : null,
  });
}

/** Semilla para crear un preventivo desde una plantilla (copia profunda) */
export function seedFromTemplate(tpl) {
  const c = normalizeContent(clone(tpl.contenido));
  return {
    cat: c.cat, cfg: c.cfg, plano: c.plano, participantes: c.participantes, modalidad: c.modalidad,
    descripcion: c.descripcionPrev,
    unidades: c.unidades.map(u => { const r = unitReference(u); return r; }),
    origen: { tipo: 'plantilla', id: tpl.id, nombre: tpl.nombre, version: tpl.modificada },
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
