#!/usr/bin/env node
// Lanzador del servidor central del Gestor de Emergencias UCO (lo mantiene en marcha arrancar.cmd).
// - Arranca server.mjs y lo vuelve a arrancar si se detiene.
// - Si el servidor sale para actualizarse (código 75), activa la versión ya verificada y probada
//   (actualizaciones/preparada), guardando antes la versión en uso en copias/anterior.
// - Vigila la versión nueva durante un periodo de prueba: si no responde o se cae, vuelve sola a la
//   anterior. Los datos nunca se tocan aquí (el actualizador hace una copia antes de cada despliegue).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ARGS = process.argv.slice(2);
const opt = k => { const i = ARGS.indexOf('--' + k); return i >= 0 ? ARGS[i + 1] : null; };
const BASE = path.resolve(opt('base') || path.join(AQUI, '..'));
const DATA = path.resolve(opt('data') || path.join(BASE, 'datos'));
const APP = path.resolve(opt('static') || path.join(BASE, 'app'));
const PORT = opt('port') || '8787';
const PRUEBA_S = Number(process.env.UCO_PRUEBA_S || 60);
const F_DEP = path.join(DATA, '_servidor', 'despliegue.json');
const PREP = path.join(BASE, 'actualizaciones', 'preparada');
const ANT = path.join(BASE, 'copias', 'anterior');
const REVERTIR = path.join(BASE, 'actualizaciones', 'REVERTIR');
const SALIDA_ACTUALIZAR = 75;

function log(...a) {
  const l = new Date().toISOString() + ' [lanzador] ' + a.join(' ');
  console.log(l);
  try { fs.mkdirSync(path.join(DATA, '_servidor'), { recursive: true }); fs.appendFileSync(path.join(DATA, '_servidor', 'despliegues.log'), l + '\n'); } catch { }
}
const leerDep = () => { try { return JSON.parse(fs.readFileSync(F_DEP, 'utf8')); } catch { return { historial: [] }; } };
function guardarDep(d) { fs.mkdirSync(path.dirname(F_DEP), { recursive: true }); fs.writeFileSync(F_DEP + '.tmp', JSON.stringify(d, null, 1)); fs.renameSync(F_DEP + '.tmp', F_DEP); }
const anotar = (d, r) => { d.historial = [...(d.historial || []), { t: Date.now(), ...r }].slice(-50); };
async function salud() {
  try { const j = await (await fetch(`http://127.0.0.1:${PORT}/api/v1/salud`, { signal: AbortSignal.timeout(2500) })).json(); return j && j.servicio === 'gestor-emergencias-uco' ? j.version : null; } catch { return null; }
}
/** Copia el código del servidor (*.mjs) y la aplicación de una ubicación a otra */
function copiarCodigo(de, a) {
  fs.mkdirSync(a.servidor, { recursive: true });
  for (const f of fs.readdirSync(de.servidor)) if (f.endsWith('.mjs')) fs.copyFileSync(path.join(de.servidor, f), path.join(a.servidor, f));
  if (fs.existsSync(de.app)) { fs.rmSync(a.app, { recursive: true, force: true }); fs.cpSync(de.app, a.app, { recursive: true }); }
}
function aplicarPreparada() {
  const lista = path.join(PREP, 'LISTA.json'); if (!fs.existsSync(lista)) return false;
  const info = JSON.parse(fs.readFileSync(lista, 'utf8'));
  log('Activando la versión', info.version);
  fs.rmSync(ANT, { recursive: true, force: true });
  copiarCodigo({ servidor: AQUI, app: APP }, { servidor: path.join(ANT, 'servidor'), app: path.join(ANT, 'app') });
  copiarCodigo({ servidor: path.join(PREP, 'servidor'), app: path.join(PREP, 'app') }, { servidor: AQUI, app: APP });
  const d = leerDep(); d.probando = { version: info.version, desde: Date.now(), anterior: d.instalada || null }; d.estado = 'probando'; guardarDep(d);
  fs.rmSync(PREP, { recursive: true, force: true });
  return true;
}
const versionDe = f => { try { const m = /const VERSION = '([^']+)'/.exec(fs.readFileSync(f, 'utf8')); return m ? m[1] : null; } catch { return null; } };
function volverAnterior(motivo) {
  const srvAnt = path.join(ANT, 'servidor', 'server.mjs');
  if (!fs.existsSync(srvAnt)) { log('No hay versión anterior guardada:', motivo); return false; }
  log('Volviendo a la versión anterior:', motivo);
  const d = leerDep(); const de = d.probando ? d.probando.version : versionDe(path.join(AQUI, 'server.mjs')) || d.instalada;
  copiarCodigo({ servidor: path.join(ANT, 'servidor'), app: path.join(ANT, 'app') }, { servidor: AQUI, app: APP });
  const a = versionDe(srvAnt);
  anotar(d, { version: de, resultado: 'revertida', a, motivo }); d.estado = 'revertida'; d.instalada = a || d.instalada; d.fecha = Date.now(); delete d.probando; guardarDep(d);
  return true;
}

let actual = null;
async function main() {
  try { fs.writeFileSync(path.join(DATA, '_servidor', 'lanzador.pid'), String(process.pid)); } catch { }
  aplicarPreparada(); // actualización preparada que no llegó a activarse (por ejemplo, por un corte de luz)
  for (;;) {
    const hijo = actual = spawn(process.execPath, [path.join(AQUI, 'server.mjs'), ...ARGS], { stdio: 'inherit', env: { ...process.env, UCO_LANZADOR: '1', UCO_BASE_INSTALACION: BASE } });
    let salida = null; const fin = new Promise(r => hijo.once('exit', c => { salida = c; r(c); }));
    const d = leerDep();
    if (d.estado === 'probando') {
      // Periodo de prueba de la versión recién activada
      let v = null;
      for (let i = 0; i < PRUEBA_S && salida === null && !v; i++) { await new Promise(r => setTimeout(r, 1000)); v = await salud(); }
      const esperada = d.probando && d.probando.version;
      if (v && salida === null && (!esperada || v === esperada)) {
        const d2 = leerDep(); anotar(d2, { version: v, resultado: 'correcta', anterior: d2.probando ? d2.probando.anterior : null }); d2.estado = 'activa'; d2.instalada = v; d2.fecha = Date.now(); delete d2.probando; guardarDep(d2);
        log('Versión', v, 'activa y funcionando');
      } else {
        const motivo = salida !== null ? 'se detuvo durante el periodo de prueba (código ' + salida + ')' : !v ? 'no respondía' : 'arrancó otra versión (' + v + ')';
        if (salida === null) hijo.kill();
        await fin;
        volverAnterior(motivo);
        continue;
      }
    }
    const code = await fin;
    if (code === SALIDA_ACTUALIZAR) {
      if (fs.existsSync(REVERTIR)) { fs.rmSync(REVERTIR, { force: true }); volverAnterior('solicitado por un administrador'); continue; }
      if (aplicarPreparada()) continue;
    }
    log('El servidor se detuvo (código ' + code + '); arrancar.cmd lo volverá a arrancar');
    process.exit(code === SALIDA_ACTUALIZAR ? 0 : code || 0);
  }
}
for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { if (actual && actual.exitCode == null) actual.kill(sig); setTimeout(() => process.exit(0), 300); });
main();
