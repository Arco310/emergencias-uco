// Migraciones de los datos locales (IndexedDB cifrada) entre versiones de la aplicación.
//
// Reglas (no cambiar sin revisar todas las versiones publicadas):
// 1. Antes de migrar se crea una copia de seguridad cifrada en el propio dispositivo (tipo «migracion»,
//    se conservan las 5 últimas): si algo sale mal, se restaura desde Sistema → Copias de seguridad.
// 2. Cada migración es idempotente (puede repetirse sin efecto) y compatible hacia atrás: solo añade o
//    completa datos, nunca borra ni cambia el significado de los existentes. Así la versión anterior de
//    la aplicación sigue pudiendo leerlos si hay que volver a ella.
// 3. El número de esquema solo avanza cuando la migración termina bien. Si falla, se sigue trabajando
//    con los datos como estaban y se reintenta en el siguiente inicio de sesión.
// 4. Las migraciones se ejecutan con la sesión abierta (los datos están cifrados con la clave local) y
//    con autoridad del sistema: no dependen de los permisos del usuario que inicia sesión.
import { clone, same } from '../core/util.js';
import { TIPOS_RECURSO_SAMUR, PLANTILLAS_SAMUR } from '../core/defaults.js';
import { tiposAvisoIncidentes, incidentesQueFaltan } from '../core/incidentes.js';

export const ESQUEMA_DATOS = 3;

/** Añade a una lista los elementos que faltan (por identificador), sin tocar los que ya hay ni volver a
 *  añadir los que se eliminaron a propósito (configuración «eliminados») */
function anadirQueFaltan(lista, extra, eliminados = []) {
  const ids = new Set([...(lista || []).map(x => x.id), ...(eliminados || [])]);
  return [...(lista || []), ...extra.filter(x => !ids.has(x.id)).map(clone)];
}
const eliminadosDe = (cfg, clase) => (cfg.eliminados && cfg.eliminados[clase]) || [];

export const MIGRACIONES = [
  {
    v: 2, version: '1.2.0', nombre: 'Configuración general guardada completa en el dispositivo (tipos de recurso y unidades plantilla incluidos)',
    // Hasta la 1.1.0 lo que faltaba en la configuración guardada (unidades plantilla de ejemplo, tipos que
    // usan…) se completaba con los valores por defecto de cada versión. Desde la 1.2.0 se guarda la
    // configuración efectiva completa: si una versión futura cambia esos valores por defecto, la
    // configuración de este dispositivo no cambia sin que nadie lo decida.
    async run({ repo, migrarCfg }) {
      const guardada = await repo.getDoc('cfg', null);
      const efectiva = await repo.getCfg();
      const nueva = migrarCfg ? migrarCfg(clone(efectiva)) : efectiva;
      if (!same(guardada, nueva)) await repo.saveCfg(nueva, 'Migración de datos (esquema 2)');
    },
  },
  {
    v: 3, version: '1.3.0', nombre: 'Tipos de unidad y unidades plantilla de SAMUR-Protección Civil y códigos de incidente',
    // Decisión del usuario en la 1.3.0: añadirlos a los valores predeterminados. Solo se añade lo que falta
    // (por identificador); lo que ya hay no cambia. Los preventivos existentes no se tocan: sus códigos se
    // añaden desde la propia aplicación (Nuevo aviso → «Añadir los códigos de incidente»).
    async run({ repo }) {
      const cfg = await repo.getCfg();
      const nueva = clone(cfg);
      nueva.catalogos.tiposRecurso = anadirQueFaltan(nueva.catalogos.tiposRecurso, TIPOS_RECURSO_SAMUR, eliminadosDe(nueva, 'tiposRecurso'));
      nueva.plantillasUnidad = anadirQueFaltan(nueva.plantillasUnidad, PLANTILLAS_SAMUR, eliminadosDe(nueva, 'plantillasUnidad'));
      nueva.catalogos.tiposAviso = anadirQueFaltan(nueva.catalogos.tiposAviso, tiposAvisoIncidentes());
      if (!same(cfg, nueva)) await repo.saveCfg(nueva, 'Migración de datos (esquema 3): tipos y unidades plantilla SAMUR-PC y códigos de incidente');
      // Plantillas de preventivo: también llevan los códigos, para los preventivos que se creen con ellas
      for (const t of await repo.listTemplates()) {
        const cat = t.contenido && t.contenido.cat;
        if (!cat || !Array.isArray(cat.tiposAviso)) continue;
        const falta = incidentesQueFaltan(cat.tiposAviso); if (!falta.length) continue;
        cat.tiposAviso = [...cat.tiposAviso, ...falta];
        await repo.saveTemplate(t, 'Migración de datos: códigos de incidente añadidos a la plantilla');
      }
    },
  },
];

export async function esquemaLocal(repo) {
  const m = await repo.db.get('meta', 'schema');
  return (m && Number(m.v)) || 1;
}

/** Aplica las migraciones pendientes. Devuelve { estado: 'al_dia' | 'migrado' | 'posterior', ... } */
export async function migrarDatos(repo, ctx = {}, lista = MIGRACIONES, objetivo = ESQUEMA_DATOS) {
  const actual = await esquemaLocal(repo);
  // Datos de una versión posterior de la aplicación (p. ej. tras volver a la anterior): no se tocan
  if (actual > objetivo) return { estado: 'posterior', actual, esperado: objetivo };
  const pend = lista.filter(m => m.v > actual && m.v <= objetivo).sort((a, b) => a.v - b.v);
  if (!pend.length) return { estado: 'al_dia', actual };
  const hasta = pend[pend.length - 1].v;
  const copia = await repo.createBackup('migracion', 'Antes de actualizar los datos del esquema ' + actual + ' al ' + hasta);
  const hechas = [];
  for (const m of pend) {
    await m.run({ repo, ...ctx });
    await repo.db.put('meta', { k: 'schema', v: m.v });
    await repo.audit('Migración de datos', 'Esquema ' + m.v + ' (versión ' + m.version + ')', 'Esquema ' + (hechas.length ? hechas[hechas.length - 1] : actual), m.nombre);
    hechas.push(m.v);
  }
  return { estado: 'migrado', desde: actual, hasta, copia, hechas };
}
