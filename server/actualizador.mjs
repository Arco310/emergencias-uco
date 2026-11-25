// Actualizador del servidor central del Gestor de Emergencias UCO.
// - Consulta las versiones publicadas del repositorio oficial (GitHub Releases, por HTTPS).
// - Descarga el paquete y comprueba su integridad: SHA-256 calculado por GitHub al publicarlo y lista
//   de sumas publicada en la misma versión. Nunca ejecuta código sin verificarlo.
// - Lo prueba arrancándolo con una COPIA de los datos antes de activarlo.
// - Lo deja preparado; el lanzador (lanzador.mjs) lo activa con un reinicio controlado, lo vigila
//   durante un periodo de prueba y vuelve a la versión anterior si falla.
// - No interrumpe preventivos en curso: «ventana segura» = sin escrituras durante un tiempo.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import net from 'node:net';
import { spawn } from 'node:child_process';

export const SALIDA_ACTUALIZAR = 75;
export const REPO_OFICIAL = 'Arco310/emergencias-uco';
export const nombrePaquete = v => `servidor-uco-windows-v${v}.zip`;
export const semver = s => { const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(s || '').trim()); return m ? m.slice(1).map(Number) : null; };
/** ¿a es una versión posterior a b? */
export function posterior(a, b) {
  const x = semver(a), y = semver(b); if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');

/** Lector de ZIP (entradas sin comprimir o «deflate»). Rechaza rutas peligrosas (zip-slip) */
export function leerZip(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf.buffer, buf.byteOffset, buf.byteLength);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('El paquete no es un ZIP válido');
  const n = buf.readUInt16LE(eocd + 10); let p = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Directorio del ZIP dañado');
    const metodo = buf.readUInt16LE(p + 10), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const ln = buf.readUInt16LE(p + 28), le = buf.readUInt16LE(p + 30), lc = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const nombre = buf.subarray(p + 46, p + 46 + ln).toString('utf8');
    p += 46 + ln + le + lc;
    if (nombre.endsWith('/')) continue;
    if (nombre.includes('\\') || nombre.split('/').some(s => s === '..' || s === '') || path.isAbsolute(nombre) || /^[A-Za-z]:/.test(nombre)) throw new Error('Ruta no permitida en el paquete: ' + nombre);
    if (buf.readUInt32LE(off) !== 0x04034b50) throw new Error('Entrada del ZIP dañada');
    const ini = off + 30 + buf.readUInt16LE(off + 26) + buf.readUInt16LE(off + 28);
    const raw = buf.subarray(ini, ini + csize);
    const datos = metodo === 0 ? Buffer.from(raw) : metodo === 8 ? zlib.inflateRawSync(raw) : null;
    if (!datos) throw new Error('Compresión no admitida en ' + nombre);
    if (datos.length !== usize) throw new Error('Tamaño incorrecto en ' + nombre);
    out.set(nombre, datos);
  }
  return out;
}

const libre = () => new Promise((res, rej) => { const s = net.createServer(); s.once('error', rej); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });

/**
 * DATA: carpeta de datos; BASE: carpeta de la instalación (contiene servidor/, app/, copias/);
 * version: versión en marcha; lanzador: true si lo arrancó lanzador.mjs (necesario para activar).
 */
export function crearActualizador({ DATA, BASE, version, lanzador = false, log = () => { }, fetchImpl = fetch, api = 'https://api.github.com', repo = REPO_OFICIAL, salir = code => process.exit(code), idleMin = 30, periodico = true, esperaInicial = 10000 }) {
  const F_EST = path.join(DATA, '_servidor', 'actualizaciones.json');
  const F_DEP = path.join(DATA, '_servidor', 'despliegue.json');
  const LOG = path.join(DATA, '_servidor', 'despliegues.log');
  const PREP = BASE ? path.join(BASE, 'actualizaciones', 'preparada') : null;
  const leer = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
  const guardar = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f + '.tmp', JSON.stringify(o, null, 1)); fs.renameSync(f + '.tmp', f); };
  const est = { disponible: null, comprobado: 0, programada: null, preparada: null, error: null, ...leer(F_EST, {}) };
  const act = { ultimaEscritura: 0, escrituras: 0, preventivos: new Map() };
  let ocupado = null; // tarea en curso (comprobar / preparar)
  const registro = (...a) => { const l = new Date().toISOString() + ' ' + a.join(' '); log('[actualizaciones]', ...a); try { fs.mkdirSync(path.dirname(LOG), { recursive: true }); fs.appendFileSync(LOG, l + '\n'); } catch { } };
  const persistir = () => guardar(F_EST, { ...est });
  const historial = (resultado, extra = {}) => { const d = leer(F_DEP, { historial: [] }); d.historial = [...(d.historial || []), { t: Date.now(), resultado, ...extra }].slice(-50); guardar(F_DEP, d); };

  async function obtener(url, binario = false) {
    const r = await fetchImpl(url, { headers: { Accept: binario ? 'application/octet-stream' : 'application/vnd.github+json', 'User-Agent': 'GestorUCO-servidor/' + version }, redirect: 'follow' });
    if (!r.ok) throw Object.assign(new Error('No se pudo descargar ' + url.split('?')[0] + ' (' + r.status + ')'), { status: r.status });
    return binario ? Buffer.from(await r.arrayBuffer()) : r.json();
  }
  /** Consulta la última versión publicada en el repositorio oficial */
  async function comprobar({ minIntervalo = 0 } = {}) {
    if (ocupado) return estado();
    if (minIntervalo && est.comprobado && Date.now() - est.comprobado < minIntervalo) return estado();
    ocupado = 'comprobando';
    try {
      const j = await obtener(`${api}/repos/${repo}/releases/latest`);
      const v = semver(j.tag_name) ? semver(j.tag_name).join('.') : null;
      // Origen: con la API oficial, los archivos solo pueden descargarse de las versiones del repositorio oficial
      const deOrigen = a => api !== 'https://api.github.com' || String(a.browser_download_url || '').startsWith(`https://github.com/${repo}/releases/download/`);
      const zip = v && (j.assets || []).find(a => a.name === nombrePaquete(v) && deOrigen(a));
      const sumas = (j.assets || []).find(a => a.name === 'SHA256SUMS.txt' && deOrigen(a));
      est.disponible = v && zip && sumas ? { version: v, publicada: j.published_at || null, notas: String(j.body || '').slice(0, 4000), url: zip.browser_download_url, tam: zip.size || null, digest: zip.digest || null, sumas: sumas.browser_download_url, enlace: j.html_url || null } : null;
      est.comprobado = Date.now(); est.versionComprobada = version; est.sinVersiones = false; est.error = v && (!zip || !sumas) ? 'La versión ' + v + ' no incluye el paquete del servidor o su lista de sumas' : null;
      persistir();
    } catch (e) {
      est.comprobado = Date.now(); est.versionComprobada = version;
      // El repositorio todavía no tiene ninguna versión publicada: no es un error
      if (e.status === 404) { est.disponible = null; est.error = null; est.sinVersiones = true; }
      else { est.error = e.message; registro('Error al comprobar:', e.message); }
      persistir();
    }
    finally { ocupado = null; }
    return estado();
  }
  /** Descarga, verifica, prueba y deja preparada la versión disponible */
  async function preparar() {
    if (!BASE) throw Object.assign(new Error('Este servidor no se instaló con el instalador: no puede actualizarse solo'), { status: 409 });
    if (ocupado) throw Object.assign(new Error('Ya hay una tarea de actualización en curso'), { status: 409 });
    const d = est.disponible;
    if (!d || !posterior(d.version, version)) throw Object.assign(new Error('No hay ninguna versión posterior a la ' + version), { status: 409 });
    ocupado = 'preparando';
    const TMP = path.join(BASE, 'actualizaciones', 'descarga');
    try {
      registro('Preparando la versión', d.version);
      const zip = await obtener(d.url, true);
      const h = sha256(zip);
      // Integridad: suma calculada por GitHub al publicar el archivo y lista de sumas de la misma versión
      if (d.digest && d.digest !== 'sha256:' + h) throw new Error('La suma SHA-256 del paquete no coincide con la registrada por GitHub');
      const lineas = (await obtener(d.sumas, true)).toString('utf8').split(/\r?\n/);
      const linea = lineas.map(l => l.trim().split(/\s+\*?/)).find(([, n]) => n === nombrePaquete(d.version));
      if (!linea || linea[0].toLowerCase() !== h) throw new Error('La suma SHA-256 del paquete no coincide con la lista publicada');
      // Contenido: rutas seguras, estructura esperada y versión coherente
      const ent = leerZip(zip); const raiz = 'servidor-uco-windows/';
      const srv = ent.get(raiz + 'servidor/server.mjs'); const app = ent.get(raiz + 'app/index.html');
      if (!srv || !app) throw new Error('El paquete no tiene la estructura esperada');
      const vp = /const VERSION = '([^']+)'/.exec(srv.toString('utf8'));
      if (!vp || vp[1] !== d.version) throw new Error('La versión del paquete no coincide con la publicada');
      fs.rmSync(TMP, { recursive: true, force: true });
      for (const [n, b] of ent) {
        let rel = null;
        if (n.startsWith(raiz + 'servidor/') && n.endsWith('.mjs') && !n.slice(raiz.length + 9).includes('/')) rel = path.join('servidor', path.basename(n));
        else if (n.startsWith(raiz + 'app/')) rel = path.join('app', ...n.slice(raiz.length + 4).split('/'));
        if (!rel) continue;
        const f = path.join(TMP, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, b);
      }
      // Prueba de funcionamiento con una copia de los datos (migraciones incluidas)
      const copia = path.join(BASE, 'actualizaciones', 'prueba-datos');
      fs.rmSync(copia, { recursive: true, force: true }); fs.cpSync(DATA, copia, { recursive: true });
      const vprueba = await probar(path.join(TMP, 'servidor', 'server.mjs'), copia);
      fs.rmSync(copia, { recursive: true, force: true });
      if (vprueba !== d.version) throw new Error('La versión nueva no superó la prueba de funcionamiento');
      fs.rmSync(PREP, { recursive: true, force: true }); fs.mkdirSync(path.dirname(PREP), { recursive: true }); fs.renameSync(TMP, PREP);
      fs.writeFileSync(path.join(PREP, 'LISTA.json'), JSON.stringify({ version: d.version, sha256: h, preparada: Date.now() }));
      est.preparada = { version: d.version, sha256: h, t: Date.now() }; est.error = null; persistir();
      registro('Versión', d.version, 'verificada (SHA-256 ' + h.slice(0, 16) + '…), probada y preparada');
      return estado();
    } catch (e) {
      fs.rmSync(TMP, { recursive: true, force: true });
      est.error = e.message; persistir(); historial('fallida', { version: d.version, motivo: e.message }); registro('Preparación fallida:', e.message);
      throw Object.assign(e, { status: e.status || 422 });
    } finally { ocupado = null; }
  }
  /** Arranca la versión nueva en un puerto libre con la copia de los datos y comprueba que responde */
  async function probar(server, datos) {
    const port = await libre();
    // Entorno aislado: la instancia de prueba no es la del lanzador ni conoce la instalación real
    const env = { ...process.env, UCO_PRUEBA_ACTUALIZACION: '1' }; delete env.UCO_LANZADOR; delete env.UCO_BASE_INSTALACION;
    const hijo = spawn(process.execPath, [server, '--port', String(port), '--host', '127.0.0.1', '--data', datos, '--quiet'], { stdio: 'ignore', env });
    try {
      for (let i = 0; i < 40; i++) {
        await new Promise(r => setTimeout(r, 250));
        try { const j = await (await fetch(`http://127.0.0.1:${port}/api/v1/salud`, { signal: AbortSignal.timeout(1500) })).json(); if (j && j.servicio === 'gestor-emergencias-uco') return j.version; } catch { }
        if (hijo.exitCode != null) break;
      }
      return null;
    } finally { hijo.kill(); }
  }
  const inactivo = () => Date.now() - act.ultimaEscritura >= idleMin * 60000;
  /** Programa la activación: «ahora» (si no hay actividad o se fuerza) o en la próxima ventana segura */
  function programar(modo, { forzar = false } = {}) {
    if (!lanzador) throw Object.assign(new Error('Este servidor no tiene el lanzador de actualizaciones: ejecuta una vez el instalador nuevo en el PC servidor'), { status: 409 });
    if (!est.preparada || !fs.existsSync(path.join(PREP, 'LISTA.json'))) throw Object.assign(new Error('Primero hay que preparar (descargar y verificar) la versión nueva'), { status: 409 });
    if (modo === 'ahora' && !forzar && Date.now() - act.ultimaEscritura < 2 * 60000) throw Object.assign(new Error('Hay actividad en los preventivos ahora mismo: usa la ventana segura o fuerza la instalación'), { status: 409, code: 'actividad' });
    est.programada = { modo: modo === 'ahora' ? 'ahora' : 'ventana', t: Date.now() }; persistir();
    registro('Activación programada:', est.programada.modo, forzar ? '(forzada)' : '');
    if (modo === 'ahora') setTimeout(activar, 1500);
    return estado();
  }
  function cancelar() { est.programada = null; persistir(); registro('Activación cancelada'); return estado(); }
  let mantenimiento = false;
  /** Copia de seguridad de los datos antes de activar otra versión (se conservan las 5 más recientes) */
  function copiaDatos(motivo) {
    const dir = path.join(BASE, 'copias'); fs.mkdirSync(dir, { recursive: true });
    const destino = path.join(dir, 'datos-' + new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19) + '-' + motivo);
    fs.cpSync(DATA, destino, { recursive: true });
    const c = fs.readdirSync(dir).filter(x => x.startsWith('datos-')).sort();
    for (const x of c.slice(0, Math.max(0, c.length - 5))) fs.rmSync(path.join(dir, x), { recursive: true, force: true });
    return destino;
  }
  function activar() {
    if (mantenimiento || !est.programada || !est.preparada) return;
    mantenimiento = true; // desde aquí no se aceptan escrituras: la copia es coherente
    try { registro('Copia de seguridad de los datos:', copiaDatos('antes-de-v' + est.preparada.version)); }
    catch (e) { mantenimiento = false; est.error = 'No se pudo hacer la copia de seguridad previa: ' + e.message; persistir(); registro('Activación cancelada:', est.error); return; }
    registro('Reinicio controlado para activar la versión', est.preparada.version);
    est.programada = null; persistir();
    setTimeout(() => salir(SALIDA_ACTUALIZAR), 800);
  }
  /** Volver a la versión anterior (la guarda el lanzador en copias/anterior) */
  function revertir() {
    if (!lanzador || !BASE) throw Object.assign(new Error('Solo es posible con el lanzador de actualizaciones'), { status: 409 });
    if (!fs.existsSync(path.join(BASE, 'copias', 'anterior', 'servidor', 'server.mjs'))) throw Object.assign(new Error('No hay ninguna versión anterior guardada'), { status: 409 });
    fs.mkdirSync(path.join(BASE, 'actualizaciones'), { recursive: true });
    mantenimiento = true;
    try { registro('Copia de seguridad de los datos:', copiaDatos('antes-de-revertir-v' + version)); }
    catch (e) { mantenimiento = false; throw Object.assign(new Error('No se pudo hacer la copia de seguridad previa: ' + e.message), { status: 500 }); }
    fs.writeFileSync(path.join(BASE, 'actualizaciones', 'REVERTIR'), String(Date.now()));
    registro('Vuelta a la versión anterior solicitada');
    setTimeout(() => salir(SALIDA_ACTUALIZAR), 800);
    return estado();
  }
  function estado() {
    const dep = leer(F_DEP, { historial: [] });
    return {
      instalada: version, lanzador, disponible: est.disponible, actualizable: !!(est.disponible && posterior(est.disponible.version, version)),
      comprobado: est.comprobado, sinVersiones: !!est.sinVersiones, preparada: est.preparada, programada: est.programada, error: est.error, tarea: ocupado,
      despliegue: { estado: dep.estado || 'activa', fecha: dep.fecha || null, instalada: dep.instalada || version, ultimo: (dep.historial || []).slice(-1)[0] || null, historial: (dep.historial || []).slice(-10).reverse() },
      actividad: { ultimaEscritura: act.ultimaEscritura || null, inactivoMin: act.ultimaEscritura ? Math.floor((Date.now() - act.ultimaEscritura) / 60000) : null, preventivosConActividad: [...act.preventivos.values()].filter(t => Date.now() - t < 30 * 60000).length },
    };
  }
  // Comprobación periódica (cada 6 h) y activación en la ventana segura
  let ultimaComp = est.comprobado || 0;
  const reloj = periodico ? setInterval(() => {
    if (Date.now() - ultimaComp > 6 * 3600000) { ultimaComp = Date.now(); comprobar(); }
    if (est.programada && est.programada.modo === 'ventana' && inactivo()) activar();
  }, 60000) : null; if (reloj) reloj.unref();
  // Versión recién instalada: lo guardado lo consultó la versión anterior. Se vuelve a consultar al arrancar
  // (una sola vez) en lugar de esperar a la siguiente comprobación periódica. Reiniciar la misma versión no consulta.
  const inicial = periodico && est.comprobado && est.versionComprobada !== version
    ? setTimeout(() => { ultimaComp = Date.now(); comprobar(); }, esperaInicial) : null;
  if (inicial && inicial.unref) inicial.unref();
  return {
    comprobar, preparar, programar, cancelar, revertir, estado, activar,
    auditar: texto => registro(texto),
    get mantenimiento() { return mantenimiento; },
    escritura(pid) { act.ultimaEscritura = Date.now(); act.escrituras++; if (pid) act.preventivos.set(pid, Date.now()); },
    detener() { if (reloj) clearInterval(reloj); if (inicial) clearTimeout(inicial); },
  };
}
