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

export const ESQUEMA_DATOS = 2;

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
