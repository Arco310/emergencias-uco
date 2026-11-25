// Fiabilidad de las horas registradas (1.5.0 · informe verificable).
// Cada operación tiene hasta tres horas distintas, que nunca se mezclan ni se corrigen:
//  - t:  hora declarada por el dispositivo que hizo el cambio (la que usan los tiempos operativos);
//  - rx: hora en que el servidor la recibió por primera vez (solo en preventivos compartidos);
//  - sy: hora en que este dispositivo la recibió del servidor o recibió su confirmación.
// Aquí solo se describe qué se sabe y qué no: no se reconstruye ni se estima ningún dato.
import { fmtDur } from './util.js';

export const UMBRAL_DIFERIDO = 2 * 60000; // más de 2 min entre la hora declarada y la recepción: registro diferido
export const UMBRAL_RELOJ = 60000;        // declarada más de 1 min después de recibirse: reloj del dispositivo adelantado

const pl = (n, uno, varios) => n + ' ' + (n === 1 ? uno : varios);

/** Registros que no cambian el contenido del informe: su propio registro y el archivado */
export const NO_CAMBIAN_INFORME = new Set(['informe.reg', 'prev.archivo']);
/** Número de registros que cuentan para el informe (para saber si hay cambios después de una versión) */
export const registrosInforme = ops => ops.filter(o => !NO_CAMBIAN_INFORME.has(o.k)).length;

/**
 * ops: operaciones del preventivo; meta: Map id → { rx, sy, ps } guardado en este dispositivo.
 * Devuelve recuentos, registros diferidos, datos por dispositivo y las limitaciones en texto.
 */
export function fiabilidadHoras(ops, meta = new Map(), { compartido = false } = {}) {
  const porDisp = new Map(); const diferidos = [];
  let total = 0, conServidor = 0, sinServidor = 0, pendientes = 0;
  for (const op of ops) {
    if (op.k === 'informe.reg') continue; // el registro de informes no es un hecho operativo
    total++;
    const m = meta.get(op.id) || {};
    const rx = m.rx ?? op.rx ?? null; const sy = m.sy ?? op.sy ?? null;
    const d = porDisp.get(op.d) || { id: op.d, nombre: op.dn || op.d || '—', ops: 0, diferidos: 0, maxRetraso: 0, adelanto: 0, sinServidor: 0 };
    d.ops++;
    if (m.ps) pendientes++;
    if (rx == null) { if (compartido) { sinServidor++; d.sinServidor++; } }
    else {
      conServidor++;
      const retraso = rx - op.t;
      if (retraso > UMBRAL_DIFERIDO) { d.diferidos++; d.maxRetraso = Math.max(d.maxRetraso, retraso); diferidos.push({ op, rx, sy, retraso }); }
      if (-retraso > UMBRAL_RELOJ) d.adelanto = Math.max(d.adelanto, -retraso);
    }
    porDisp.set(op.d, d);
  }
  const limitaciones = [];
  if (!compartido) limitaciones.push('Preventivo independiente: todas las horas son las declaradas por este dispositivo; no hay hora de servidor con la que contrastarlas.');
  else {
    if (pendientes) limitaciones.push(pl(pendientes, 'cambio de este dispositivo sin enviar al servidor', 'cambios de este dispositivo sin enviar al servidor') + ': puede faltar información de otros dispositivos y el informe es provisional.');
    const sinHora = sinServidor - pendientes;
    if (sinHora > 0) limitaciones.push(pl(sinHora, 'operación sin hora de recepción del servidor', 'operaciones sin hora de recepción del servidor') + ' (registradas antes de la versión 1.5.0 o incorporadas por archivo): solo consta la hora declarada.');
    if (diferidos.length) limitaciones.push(pl(diferidos.length, 'operación registrada sin conexión o enviada con retraso', 'operaciones registradas sin conexión o enviadas con retraso') + ' (más de 2 min entre la hora declarada y su recepción): sus tiempos son los declarados por el dispositivo.');
    for (const d of porDisp.values()) if (d.adelanto) limitaciones.push('El reloj del dispositivo «' + d.nombre + '» iba adelantado al menos ' + fmtDur(d.adelanto) + ' respecto al servidor: sus horas declaradas pueden ser posteriores a las reales.');
  }
  diferidos.sort((a, b) => a.op.t - b.op.t);
  return { compartido, total, conServidor, sinServidor, pendientes, diferidos, dispositivos: [...porDisp.values()], limitaciones };
}
