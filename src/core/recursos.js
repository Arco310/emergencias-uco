// Disponibilidad de tipos de recurso y unidades plantilla para unidades NUEVAS.
// Un tipo se puede usar en una unidad nueva si no está desactivado ni retirado en el catálogo del
// preventivo y, cuando también existe en la configuración general, tampoco está desactivado, retirado
// ni eliminado allí. Las unidades que ya usan un tipo no disponible no cambian.

/** El elemento no está desactivado ni retirado */
export const tipoActivo = t => !!t && t.activo !== false && !t.retirado;

/** Ids de tipos de la configuración general que no se pueden usar en unidades nuevas */
export function tiposNoDisponibles(cfg) {
  const out = new Set((cfg && cfg.eliminados && cfg.eliminados.tiposRecurso) || []);
  for (const t of (cfg && cfg.catalogos && cfg.catalogos.tiposRecurso) || []) if (!tipoActivo(t)) out.add(t.id);
  return out;
}

/** Motivo por el que un tipo no se puede usar en una unidad nueva (null si se puede) */
export function motivoTipoNoDisponible(t, noDisponibles) {
  if (!t) return null;
  if (t.retirado) return 'retirado';
  if (t.activo === false || (noDisponibles && noDisponibles.has(t.id))) return 'desactivado';
  return null;
}

/** Tipos que se ofrecen al crear una unidad: los del preventivo y los generales que aún no tiene */
export function tiposParaNuevaUnidad(catTipos = [], cfg) {
  const no = tiposNoDisponibles(cfg);
  const propios = (catTipos || []).filter(t => tipoActivo(t) && !no.has(t.id));
  const generales = ((cfg && cfg.catalogos && cfg.catalogos.tiposRecurso) || []).filter(g => tipoActivo(g) && !(catTipos || []).some(x => x.id === g.id));
  return { propios, generales };
}

/** Unidades plantilla activas cuyo tipo (si tienen) se puede usar en una unidad nueva */
export function plantillasDisponibles(plts = [], cfg, catTipos = null) {
  const generales = (cfg && cfg.catalogos && cfg.catalogos.tiposRecurso) || [];
  const no = tiposNoDisponibles(cfg);
  return (plts || []).filter(p => {
    if (!tipoActivo(p)) return false;
    if (!p.tipo) return true;
    const g = generales.find(t => t.id === p.tipo);
    if (!g || !tipoActivo(g) || no.has(p.tipo)) return false;
    const enPrev = catTipos && catTipos.find(t => t.id === p.tipo);
    return !enPrev || tipoActivo(enPrev);
  });
}

// ---------------- referencias (vista previa antes de eliminar) ----------------
const porInd = (a, b) => String(a.ind || '').localeCompare(String(b.ind || ''), 'es', { numeric: true });
const tocaTipo = (x, id) => !!x && typeof x === 'object' && (x.tipo === id || (x.u && x.u.tipo === id) || (x.n && x.n.tipo === id) || (x.o && x.o.tipo === id));

/** Dónde se usa un tipo de recurso dentro de un preventivo: unidades en uso, archivadas, tipos de aviso
 *  (compatibilidad) e historial (unidades que lo tuvieron y operaciones que lo mencionan). */
export function referenciasTipoPrev(s, id, ops = []) {
  const todas = Object.values(s.units).filter(u => u.tipo === id);
  const unidades = todas.filter(u => !u.eliminada && u.sit !== 'archivada').sort(porInd);
  const archivadas = todas.filter(u => !u.eliminada && u.sit === 'archivada').sort(porInd);
  const tiposAviso = (s.prev.cat.tiposAviso || []).filter(a => (a.compatibles || []).includes(id));
  const historial = todas.length + (ops || []).filter(op => op.k && op.k.startsWith('unit.') && tocaTipo(op.x, id)).length;
  return { unidades, archivadas, tiposAviso, historial };
}

/** Dónde se usa un tipo de recurso en la configuración general. «bloquean»: lo que hay que resolver
 *  antes de eliminarlo (unidades plantilla y tipos de aviso que solo admiten ese tipo). */
export function referenciasTipoEnConfig(cfg, id) {
  const plantillas = (cfg.plantillasUnidad || []).filter(p => p.tipo === id).map(p => ({ id: p.id, nombre: p.nombre, clase: 'plantilla' }));
  const tiposAviso = ((cfg.catalogos && cfg.catalogos.tiposAviso) || []).filter(a => (a.compatibles || []).includes(id))
    .map(a => ({ id: a.id, nombre: a.nombre, codigo: a.codigo || '', clase: 'tipoAviso', exclusivo: (a.compatibles || []).every(x => x === id) }));
  return { plantillas, tiposAviso, bloquean: [...plantillas, ...tiposAviso.filter(a => a.exclusivo)] };
}

/** Copia de un tipo de recurso con identificador nuevo (sin referencias ni estado de retirada) */
export function duplicarTipo(lista, id, nuevoId = 'rt_' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36)) {
  const t = lista.find(x => x.id === id); if (!t) return null;
  let nombre = t.nombre + ' (copia)';
  for (let n = 2; lista.some(x => x.nombre === nombre); n++) nombre = t.nombre + ' (copia ' + n + ')';
  const d = { ...JSON.parse(JSON.stringify(t)), id: nuevoId, nombre };
  delete d.retirado; delete d.orden;
  return d;
}

/** Texto que explica por qué un tipo de recurso general aún no se puede eliminar y qué hacer */
export function explicacionBloqueo(tipo, bloquean) {
  const pl = bloquean.filter(b => b.clase === 'plantilla').map(b => '«' + b.nombre + '»');
  const ta = bloquean.filter(b => b.clase === 'tipoAviso').map(b => '«' + (b.codigo ? b.codigo + ' · ' : '') + b.nombre + '»');
  const partes = [];
  if (pl.length) partes.push((pl.length === 1 ? 'la unidad plantilla ' : 'las unidades plantilla ') + pl.join(', '));
  if (ta.length) partes.push((ta.length === 1 ? 'el tipo de aviso ' : 'los tipos de aviso ') + ta.join(', ') + ' (solo admite' + (ta.length === 1 ? '' : 'n') + ' este tipo)');
  const una = pl.length + ta.length === 1;
  return 'No se puede eliminar «' + tipo.nombre + '» todavía: lo usa' + (una ? ' ' : 'n ') + partes.join(' y ') + '. '
    + (una ? 'Reasígnala' : 'Reasígnalas') + ' a otro tipo' + (pl.length && !ta.length ? ', ' + (pl.length === 1 ? 'elimínala' : 'elimínalas') + ' junto con el tipo' : '')
    + ' o retíralo del uso (deja de ofrecerse y se conserva para el historial).';
}
