// Apariencia de las unidades. Reglas del color C0:
//  - En la clave base (C0) el color principal es el color C0 personalizado.
//  - En el resto de claves el color principal es el de la clave.
//  - El borde conserva siempre el color C0 personalizado.
//  - En descanso el color principal es gris (el borde sigue siendo el C0).
// La apariencia se hereda del tipo de recurso salvo los campos personalizados
// en la propia unidad (u.vis), que nunca se sobrescriben al cambiar el tipo.
import { DEFAULT_VIS } from './defaults.js';
import { claveDef, isResting } from './engine.js';
import { contrastText } from './util.js';

export const REST_COLOR = '#9E9E9E';

export function tipoDe(prev, id) { return (prev && prev.cat.tiposRecurso || []).find(t => t.id === id) || null; }

export function effectiveVis(prev, u) {
  const tipo = tipoDe(prev, u.tipo);
  const own = Object.fromEntries(Object.entries(u.vis || {}).filter(([, v]) => v != null && v !== ''));
  return { ...DEFAULT_VIS, ...((tipo && tipo.vis) || {}), ...own };
}

/** Campos visuales personalizados en la unidad (no heredados) */
export function overriddenVis(u) { return Object.keys(u.vis || {}).filter(k => u.vis[k] != null && u.vis[k] !== ''); }

export function unitVisual(prev, u, t) {
  const vis = effectiveVis(prev, u);
  const def = claveDef(prev, u.clave);
  const resting = isResting(u, t);
  const fill = resting ? REST_COLOR : (def && def.base ? u.colorC0 : (def ? def.color : '#757575'));
  return {
    ...vis, fill, border: u.colorC0, resting, text: contrastText(fill),
    clave: u.clave, claveColor: def ? def.color : '#757575', claveNombre: def ? def.nombre : u.clave, claveBase: !!(def && def.base),
  };
}
