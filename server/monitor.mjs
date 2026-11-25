// Monitorización del servidor (1.5.0 · §4): estado general, almacenamiento, recursos, sincronización,
// copias de seguridad y alertas administrativas con su origen, su hora y su historial.
// Nunca devuelve contraseñas, tokens, claves, códigos ni rutas completas de la instalación: solo datos técnicos.
// No hace comprobaciones contra servicios externos (no generan consumo ni gastos).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const GiB = 2 ** 30;
const MAX_ERRORES = 50, MAX_RECHAZOS = 20, MAX_HISTORIAL = 100;
export const RECIENTE_MS = 3 * 60000; // un dispositivo envía un latido por minuto mientras la app está abierta

/** Mensaje apto para el panel: sin tokens, claves largas ni nombres de usuario en las rutas */
export function limpiarMensaje(m) {
  return String(m || '').slice(0, 300)
    .replace(/Bearer\s+\S+/gi, 'Bearer …')
    .replace(/\b[0-9a-fA-F]{24,}\b/g, '…')
    .replace(/[A-Za-z0-9+/=_-]{40,}/g, '…')
    .replace(/([A-Za-z]:\\Users\\)[^\\]+/gi, '$1…')
    .replace(/(\/home\/|\/Users\/)[^/\s]+/g, '$1…');
}

/** Tamaño de una carpeta con un límite de entradas (no bloquea el servidor con carpetas enormes) */
function tamCarpeta(dir, limite = 20000) {
  let tam = 0, n = 0, completo = true; const pila = [dir];
  while (pila.length) {
    const d = pila.pop(); let ents;
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { continue; }
    for (const e of ents) {
      if (++n > limite) { completo = false; pila.length = 0; break; }
      const p = path.join(d, e.name);
      if (e.isDirectory()) pila.push(p);
      else { try { tam += fs.statSync(p).size; } catch { } }
    }
  }
  return { tam, completo };
}

/** Copias de datos que hace el actualizador: copias/datos-AAAA-MM-DDTHH-MM-SS-motivo */
function leerCopias(BASE) {
  if (!BASE) return null;
  const dir = path.join(BASE, 'copias'); let nombres = [];
  try { nombres = fs.readdirSync(dir).filter(x => x.startsWith('datos-')); } catch { return []; }
  return nombres.map(n => {
    const m = n.match(/^datos-(\d{4})-(\d{2})-(\d{2})T(\d{2})-(\d{2})-(\d{2})-?(.*)$/);
    const fecha = m ? Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : null;
    const { tam, completo } = tamCarpeta(path.join(dir, n));
    return { nombre: n, fecha, motivo: m && m[7] ? m[7].replace(/-de-/g, ' de ').replace(/-/g, ' ') : '', tam, completo, resultado: tam > 0 ? 'correcta' : 'vacía o ilegible' };
  }).sort((a, b) => (b.fecha || 0) - (a.fecha || 0));
}

export function crearMonitor({ DATA, BASE = null, version = '', ahora = () => Date.now(), statfs = p => fs.statfsSync(p), intervaloCpu = 15000 } = {}) {
  const inicio = ahora();
  const F = DATA ? path.join(DATA, '_servidor', 'monitor.json') : null;
  let historial = [];
  try { historial = (JSON.parse(fs.readFileSync(F, 'utf8')).alertas || []).slice(-MAX_HISTORIAL); } catch { }
  const errores = []; const rechazos = [];
  const sync = { recibidas: 0, rechazadas: 0, porCodigo: {}, ultimaRecepcion: null, preventivos: new Map() };
  const almacen = { errores: 0, ultimoError: null };
  // CPU del proceso (porcentaje de un núcleo) medido a intervalos; la carga del sistema no existe en Windows
  let cpuPrev = { t: process.hrtime.bigint(), u: process.cpuUsage() }; let cpuPct = null;
  function medirCpu() {
    const t = process.hrtime.bigint(); const u = process.cpuUsage();
    const dt = Number(t - cpuPrev.t) / 1000; const du = (u.user - cpuPrev.u.user) + (u.system - cpuPrev.u.system);
    if (dt > 0) cpuPct = Math.round((du / dt) * 1000) / 10;
    cpuPrev = { t, u };
  }
  const reloj = intervaloCpu ? setInterval(medirCpu, intervaloCpu) : null; if (reloj && reloj.unref) reloj.unref();

  function error(origen, e) {
    errores.push({ t: ahora(), origen: String(origen || 'Servidor').slice(0, 60), mensaje: limpiarMensaje(e && e.message ? e.message : e) });
    if (errores.length > MAX_ERRORES) errores.shift();
  }
  function operaciones(pid, { aceptadas = 0, rechazos: rs = [] } = {}) {
    const t = ahora();
    sync.recibidas += aceptadas; if (aceptadas) sync.ultimaRecepcion = t;
    if (pid && aceptadas) sync.preventivos.set(pid, t);
    for (const r of rs) {
      sync.rechazadas++; const c = String(r.codigo || 'otro').slice(0, 30); sync.porCodigo[c] = (sync.porCodigo[c] || 0) + 1;
      rechazos.push({ t, codigo: c, error: limpiarMensaje(r.error) }); if (rechazos.length > MAX_RECHAZOS) rechazos.shift();
    }
  }
  /** Escribe, lee y borra un archivo pequeño en la carpeta de datos: la prueba real de que se puede guardar */
  function pruebaAlmacenamiento() {
    const f = path.join(DATA, '_servidor', 'monitor-prueba.tmp'); const dato = 'uco-' + ahora() + '-' + Math.random().toString(36).slice(2);
    const t0 = process.hrtime.bigint();
    try {
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, dato); const leido = fs.readFileSync(f, 'utf8'); fs.rmSync(f, { force: true });
      if (leido !== dato) throw new Error('El contenido leído no coincide con el escrito');
      return { estado: 'ok', ms: Math.round(Number(process.hrtime.bigint() - t0) / 1e5) / 10 };
    } catch (e) {
      almacen.errores++; almacen.ultimoError = { t: ahora(), mensaje: limpiarMensaje(e.code || e.message) };
      return { estado: 'error', ms: null, error: limpiarMensaje(e.code || e.message) };
    }
  }
  function disco() {
    try { const s = statfs(DATA); return { libre: s.bavail * s.bsize, total: s.blocks * s.bsize }; } catch { return null; }
  }
  const ultimaHora = lista => lista.filter(x => ahora() - x.t < 3600000).length;

  function calcularAlertas(e, extra = {}) {
    const out = [];
    const add = (clave, nivel, origen, mensaje) => out.push({ clave, nivel, origen, mensaje });
    if (e.almacenamiento.estado === 'error') add('almacenamiento', 'critica', 'Almacenamiento', 'No se puede escribir ni leer en la carpeta de datos: ' + (e.almacenamiento.prueba.error || ''));
    const d = e.almacenamiento;
    if (d.discoLibre != null && d.discoTotal) {
      const pct = d.discoLibre / d.discoTotal * 100;
      if (d.discoLibre < 1 * GiB || pct < 5) add('disco', 'alta', 'Disco', 'Queda muy poco espacio libre: ' + (d.discoLibre / GiB).toFixed(1) + ' GB (' + pct.toFixed(0) + ' %).');
      else if (d.discoLibre < 5 * GiB || pct < 10) add('disco', 'moderada', 'Disco', 'Queda poco espacio libre: ' + (d.discoLibre / GiB).toFixed(1) + ' GB (' + pct.toFixed(0) + ' %).');
    }
    const m = e.recursos.memoria;
    if (m.sistemaTotal && m.sistemaLibre / m.sistemaTotal < 0.05) add('memoria', 'moderada', 'Memoria', 'La memoria libre del equipo es inferior al 5 %.');
    if (e.copias.error) add('copias', 'alta', 'Copias de seguridad', e.copias.error);
    if (ultimaHora(rechazos) >= 20) add('rechazos', 'moderada', 'Sincronización', ultimaHora(rechazos) + ' operaciones rechazadas en la última hora.');
    if (ultimaHora(errores) >= 5) add('errores', 'moderada', 'Servidor', ultimaHora(errores) + ' errores en la última hora.');
    if (extra.codigos && extra.codigos !== 'ok') add('codigos', 'alta', 'Servidor', 'El servidor no puede leer sus códigos: vuelve a ejecutar el instalador en el PC servidor.');
    if (extra.actualizacion) add('actualizacion', 'moderada', 'Actualizaciones', limpiarMensaje(extra.actualizacion));
    for (const c of extra.conflictosAntiguos || []) add('conflictos:' + c.pid, 'moderada', 'Sincronización', 'Conflictos sin resolver desde hace más de 30 min en «' + c.nombre + '» (' + c.n + ').');
    return out;
  }
  /** Activas frente a las de la consulta anterior: las nuevas empiezan ahora; las que desaparecen se cierran */
  function actualizarHistorial(activas) {
    const t = ahora(); let cambio = false;
    const abiertas = new Map(historial.filter(h => h.hasta == null).map(h => [h.clave, h]));
    for (const a of activas) {
      const h = abiertas.get(a.clave);
      if (h) { a.desde = h.desde; if (h.mensaje !== a.mensaje || h.nivel !== a.nivel) { h.mensaje = a.mensaje; h.nivel = a.nivel; cambio = true; } abiertas.delete(a.clave); }
      else { a.desde = t; historial.push({ clave: a.clave, nivel: a.nivel, origen: a.origen, mensaje: a.mensaje, desde: t, hasta: null }); cambio = true; }
    }
    for (const h of abiertas.values()) { h.hasta = t; cambio = true; }
    if (historial.length > MAX_HISTORIAL) historial = historial.slice(-MAX_HISTORIAL);
    if (cambio && F) { try { fs.mkdirSync(path.dirname(F), { recursive: true }); fs.writeFileSync(F, JSON.stringify({ alertas: historial })); } catch { } }
  }

  /**
   * Estado completo. extra: { dispositivos (latidos del espacio), actualizaciones (estado del actualizador),
   * codigos ('ok' si el servidor lee sus códigos), control (modo servidor: conflictos e incoherencias por preventivo) }
   */
  function estado({ dispositivos = {}, actualizaciones = null, codigos = 'ok', control = null } = {}) {
    const t = ahora(); if (!reloj) medirCpu();
    const prueba = pruebaAlmacenamiento(); const dk = disco();
    const datos = prueba.estado === 'ok' ? tamCarpeta(DATA) : { tam: null, completo: false };
    const copias = leerCopias(BASE);
    const errAct = actualizaciones && actualizaciones.error ? String(actualizaciones.error) : '';
    const e = {
      generado: t,
      servidor: { estado: 'ok', version, iniciado: inicio, actividadSeg: Math.round((t - inicio) / 1000), api: 'ok', node: process.version, plataforma: process.platform, errores: errores.slice(-10).reverse(), erroresUltimaHora: ultimaHora(errores) },
      almacenamiento: { estado: prueba.estado, prueba, errores: almacen.errores, ultimoError: almacen.ultimoError, datosTam: datos.tam, datosCompleto: datos.completo, discoLibre: dk ? dk.libre : null, discoTotal: dk ? dk.total : null },
      recursos: {
        memoria: { proceso: process.memoryUsage().rss, sistemaLibre: os.freemem(), sistemaTotal: os.totalmem() },
        cpu: { proceso: cpuPct, nucleos: (os.cpus() || []).length || 1, carga: process.platform === 'win32' ? null : os.loadavg()[0] },
      },
      sincronizacion: {
        recibidas: sync.recibidas, rechazadas: sync.rechazadas, porCodigo: { ...sync.porCodigo }, ultimaRecepcion: sync.ultimaRecepcion,
        rechazos: rechazos.slice(-10).reverse(), desde: inicio,
        dispositivos: Object.values(dispositivos || {}).map(d => ({ nombre: d.nombre || '—', version: d.version || '', visto: d.visto || null, reciente: !!d.visto && t - d.visto < RECIENTE_MS }))
          .sort((a, b) => (b.visto || 0) - (a.visto || 0)),
        preventivosActivos: [...sync.preventivos.values()].filter(x => t - x < 3600000).length,
        control,
      },
      copias: copias == null
        ? { disponible: false, lista: [], ultima: null, programacion: 'Servidor arrancado sin la instalación: no hay carpeta de copias.', destino: null, error: null }
        : { disponible: true, lista: copias.slice(0, 5).map(({ nombre, ...c }) => c), ultima: copias[0] ? (({ nombre, ...c }) => c)(copias[0]) : null, destino: 'Carpeta «copias» de la instalación (se conservan las 5 últimas)', programacion: 'No hay copias programadas en el servidor: se hacen automáticamente antes de cada actualización y de cada reinstalación (cada dispositivo guarda además sus propias copias).', error: /copia/i.test(errAct) ? limpiarMensaje(errAct) : null },
    };
    const activas = calcularAlertas(e, { codigos, actualizacion: errAct && !/copia/i.test(errAct) ? errAct : '', conflictosAntiguos: control ? control.filter(p => p.conflictoMasAntiguo && t - p.conflictoMasAntiguo > 30 * 60000).map(p => ({ pid: p.pid, nombre: p.nombre, n: p.conflictos })) : [] });
    actualizarHistorial(activas);
    e.alertas = { activas: activas.map(({ clave, ...a }) => a), historial: historial.slice(-30).reverse().map(({ clave, ...h }) => h) };
    return e;
  }
  return { error, operaciones, estado, detener() { if (reloj) clearInterval(reloj); } };
}
