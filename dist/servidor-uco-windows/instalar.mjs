// Instala el servidor de sincronización del Gestor de Emergencias UCO en este equipo Windows:
// copia los archivos, crea una tarea que lo arranca al encender el equipo y lo publica en
// Internet con una dirección HTTPS fija mediante Tailscale Funnel.
// Se ejecuta desde instalar-servidor.bat (con permisos de administrador).
import { cpSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync, copyFileSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import * as U from './comun.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const preguntar = async txt => {
  if (process.env.UCO_SIN_PREGUNTAS) return '';
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try { return (await rl.question(txt)).trim(); } finally { rl.close(); }
};
// Respuestas dadas de antemano (opcional): opciones.json junto al instalador, p. ej. { "evitarSuspension": true }
const OPC_FILE = process.env.UCO_OPCIONES || join(AQUI, 'opciones.json');
const OPC = (() => { try { return JSON.parse(readFileSync(OPC_FILE, 'utf8')); } catch { return {}; } })();
/** Quita una opción ya aplicada (p. ej. un código de pruebas) para que no quede guardada en opciones.json */
const quitarOpcion = k => { try { const o = JSON.parse(readFileSync(OPC_FILE, 'utf8')); delete o[k]; writeFileSync(OPC_FILE, JSON.stringify(o, null, 1)); } catch { /* sin opciones.json */ } };
const fallo = msg => { console.log('\n[ERROR] ' + msg); process.exit(1); };
const ok = msg => console.log('[OK] ' + msg);
const libre = p => new Promise(res => { const s = createServer(); s.once('error', () => res(false)); s.listen(p, '127.0.0.1', () => s.close(() => res(true))); });

/** Detiene el servidor instalado (tarea programada y proceso) */
async function detener(puerto) {
  U.run(U.SCHTASKS, ['/End', '/TN', U.TAREA]);
  if (U.SIM) { try { process.kill(Number(readFileSync(join(U.BASE, 'pid-prueba.txt'), 'utf8'))); } catch { } }
  else { const pid = U.pidEnPuerto(puerto); if (pid) U.run('taskkill', ['/F', '/T', '/PID', pid]); }
  await U.esperar(async () => !(await U.salud(U.local(puerto), 1000)), 15);
}
function arrancar(puerto) {
  if (U.SIM) {
    const ch = spawn(U.NODE, U.argsServidor(puerto), { detached: true, stdio: 'ignore' }); ch.unref();
    writeFileSync(join(U.BASE, 'pid-prueba.txt'), String(ch.pid));
  } else U.run(U.SCHTASKS, ['/Run', '/TN', U.TAREA]);
}
const sello = () => new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
/** Conserva solo las n copias de datos más recientes */
function limpiarCopias(dir, n) {
  const c = readdirSync(dir).filter(x => x.startsWith('datos-')).sort();
  for (const x of c.slice(0, Math.max(0, c.length - n))) rmSync(join(dir, x), { recursive: true, force: true });
}

async function elegirPuerto() {
  // Reinstalación: si ya responde el servidor del Gestor, se detiene para sustituirlo
  if (await U.salud(U.local(U.PUERTO))) {
    console.log('Hay una instalación anterior en marcha: se detiene para actualizarla.');
    await detener(U.PUERTO);
  }
  for (let p = U.PUERTO; p < U.PUERTO + 20; p++) if (await libre(p)) return p;
  fallo('No hay ningún puerto libre entre ' + U.PUERTO + ' y ' + (U.PUERTO + 19) + '.');
}

async function main() {
  U.linea(); console.log('Gestor de Emergencias UCO · Instalación del servidor de sincronización'); U.linea();
  for (const f of [join(AQUI, 'servidor', 'server.mjs'), join(AQUI, 'app', 'index.html')]) if (!existsSync(f)) fallo('Falta ' + f + '. Descomprime el paquete completo antes de instalar.');

  // 1. Archivos en una carpeta fija del equipo
  const puerto = await elegirPuerto();
  // Actualización: se guarda la versión instalada (para volver atrás) y una copia de los datos
  const COPIAS = join(U.BASE, 'copias'); const ANT = join(COPIAS, 'anterior');
  const habia = existsSync(U.RUTAS.servidor);
  if (habia) {
    rmSync(ANT, { recursive: true, force: true }); mkdirSync(ANT, { recursive: true });
    copyFileSync(U.RUTAS.servidor, join(ANT, 'server.mjs'));
    if (existsSync(U.RUTAS.app)) cpSync(U.RUTAS.app, join(ANT, 'app'), { recursive: true });
    if (existsSync(U.RUTAS.datos)) {
      const d = join(COPIAS, 'datos-' + sello()); cpSync(U.RUTAS.datos, d, { recursive: true });
      limpiarCopias(COPIAS, 5); ok('Copia de seguridad de los datos en ' + d);
    }
    // Las copias contienen los códigos del servidor: solo sistema y administradores
    if (!U.SIM) U.run(U.ICACLS, [COPIAS, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '/T', '/C', '/Q']);
  }
  mkdirSync(dirname(U.RUTAS.servidor), { recursive: true });
  cpSync(join(AQUI, 'servidor', 'server.mjs'), U.RUTAS.servidor);
  rmSync(U.RUTAS.app, { recursive: true, force: true }); cpSync(join(AQUI, 'app'), U.RUTAS.app, { recursive: true });
  mkdirSync(U.RUTAS.datos, { recursive: true });
  const SRV = join(U.RUTAS.datos, '_servidor'); mkdirSync(SRV, { recursive: true });
  // Código SOLO para el entorno de pruebas (CLAUDE_TEST), si se indica en opciones.json: crea y borra
  // espacios de pruebas, nunca el real ni sus datos. Se retira de opciones.json una vez aplicado.
  if (OPC.codigoPruebas) {
    if (!/^[0-9A-Z]{5}(-[0-9A-Z]{5}){3}$/i.test(String(OPC.codigoPruebas))) fallo('codigoPruebas de opciones.json no tiene el formato XXXXX-XXXXX-XXXXX-XXXXX');
    writeFileSync(join(SRV, 'codigo-pruebas.txt'), String(OPC.codigoPruebas).toUpperCase() + '\n');
    quitarOpcion('codigoPruebas'); ok('Código del entorno de pruebas (CLAUDE_TEST) instalado');
  }
  copyFileSync(join(AQUI, 'MOSTRAR-CODIGO-ADMIN.bat'), join(U.BASE, 'MOSTRAR-CODIGO-ADMIN.bat'));
  writeFileSync(U.RUTAS.arrancar, U.arrancarCmd(puerto));
  writeFileSync(U.RUTAS.tarea, U.utf16(U.tareaXml()));
  ok('Archivos en ' + U.BASE + ' (datos en ' + U.RUTAS.datos + ')');

  // 2. Tarea programada: arranca al encender el equipo, sin necesidad de iniciar sesión
  const t = U.run(U.SCHTASKS, ['/Create', '/TN', U.TAREA, '/XML', U.RUTAS.tarea, '/F']);
  if (t.code !== 0) fallo('No se pudo crear la tarea programada: ' + t.out.trim());
  ok('Arranque automático al encender el equipo (tarea «' + U.TAREA + '»)');
  arrancar(puerto);
  const v = await U.esperar(() => U.salud(U.local(puerto)), 40);
  if (!v && habia) {
    // Vuelta atrás automática: se restaura la versión anterior, que sí funcionaba
    console.log('[AVISO] La nueva versión no arranca: se restaura la anterior.');
    await detener(puerto);
    copyFileSync(join(ANT, 'server.mjs'), U.RUTAS.servidor);
    if (existsSync(join(ANT, 'app'))) { rmSync(U.RUTAS.app, { recursive: true, force: true }); cpSync(join(ANT, 'app'), U.RUTAS.app, { recursive: true }); }
    arrancar(puerto);
    const va = await U.esperar(() => U.salud(U.local(puerto)), 40);
    fallo(va ? 'La nueva versión no arrancó. Se ha restaurado la anterior (versión ' + va + '), que sigue funcionando. Revisa ' + U.RUTAS.registro : 'El servidor no arranca ni con la versión anterior. Revisa ' + U.RUTAS.registro);
  }
  if (!v) fallo('El servidor no ha arrancado. Revisa ' + U.RUTAS.registro);
  // Los códigos del servidor solo pueden leerlos el sistema (el servidor) y los administradores
  if (!U.SIM) {
    const r = U.run(U.ICACLS, [SRV, '/inheritance:r', '/grant:r', '*S-1-5-18:(OI)(CI)F', '*S-1-5-32-544:(OI)(CI)F', '/T', '/C', '/Q']);
    if (r.code === 0) ok('Códigos del servidor protegidos (solo sistema y administradores)');
    else console.log('[AVISO] No se pudieron restringir los permisos de ' + SRV + ': ' + r.out.trim());
  }
  ok('Servidor en marcha en este equipo (versión ' + v + ', puerto ' + puerto + ')');

  // 3. Tailscale: sesión iniciada y modo desatendido (sigue activo aunque nadie inicie sesión en Windows)
  if (!U.SIM && !existsSync(U.TAILSCALE)) fallo('Tailscale no está instalado. Descárgalo de https://tailscale.com/download/windows y vuelve a ejecutar el instalador.');
  let ts = U.tailscaleEstado();
  if (ts.estado !== 'Running') {
    console.log('\nInicia sesión en Tailscale: si no se abre el navegador, abre el enlace que aparece abajo (cuenta gratuita; puedes entrar con Google, Microsoft o GitHub).');
    U.run(U.TAILSCALE, ['up', '--unattended'], { eco: true });
    ts = U.tailscaleEstado();
  } else U.run(U.TAILSCALE, ['set', '--unattended']);
  if (ts.estado !== 'Running') fallo('Tailscale no ha iniciado sesión (estado: ' + ts.estado + '). Vuelve a ejecutar el instalador.');
  ok('Tailscale conectado como ' + ts.dns);

  // 4. Publicación en Internet con HTTPS (Tailscale Funnel), persistente tras reiniciar
  let f = U.run(U.TAILSCALE, ['funnel', '--bg', String(puerto)], { eco: true });
  for (let i = 0; i < 2 && f.code !== 0; i++) {
    await preguntar('\nSi arriba aparece un enlace para activar Funnel (o HTTPS) en tu red de Tailscale, ábrelo, actívalo y pulsa Intro aquí: ');
    f = U.run(U.TAILSCALE, ['funnel', '--bg', String(puerto)], { eco: true });
  }
  if (f.code !== 0) fallo('No se pudo activar Funnel. Actívalo en https://login.tailscale.com/admin/settings/features y vuelve a ejecutar el instalador.');
  const url = 'https://' + ts.dns + '/';
  console.log('\nComprobando la dirección pública (la primera vez el certificado puede tardar un par de minutos)…');
  const pub = await U.esperar(() => U.salud(process.env.UCO_URL_PRUEBA || url, 8000), U.SIM ? 10 : 150, 5000);
  if (pub) ok('Responde desde Internet: ' + url);
  else console.log('[AVISO] Todavía no responde desde Internet. Espera unos minutos y comprueba con estado-servidor.bat.');

  // 5. Evitar la suspensión del equipo enchufado: solo con permiso (respuesta en opciones.json o pregunta)
  let evitar = OPC.evitarSuspension;
  if (typeof evitar !== 'boolean') evitar = U.SIM ? false : !/^n/i.test(await preguntar('\n¿Evitar que este PC se suspenda cuando está enchufado? Así el servidor sigue disponible. (S/n): '));
  if (evitar) {
    const r = U.run(U.POWERCFG, ['/change', 'standby-timeout-ac', '0']);
    if (r.code === 0) ok('Suspensión desactivada con el PC enchufado'); else console.log('[AVISO] No se pudo desactivar la suspensión: ' + r.out.trim());
  } else console.log('[--] Suspensión del equipo sin cambios');

  const activo = await U.centralActivo(U.local(puerto));
  writeFileSync(U.RUTAS.direccion, [
    'Servidor central del Gestor de Emergencias UCO', '', 'Dirección: ' + url, '',
    'La aplicación ya conoce esta dirección: no hay que escribirla en ningún dispositivo.', '',
    'Primera vez (una sola vez para toda la organización): en la aplicación, Sistema → Servidor central',
    '→ «Activar el servidor central», con el código de administración. Para verlo, ejecuta',
    U.BASE + '\\MOSTRAR-CODIGO-ADMIN.bat (pide permisos de administrador).', '',
    'Después, en cada dispositivo basta con abrir la aplicación e iniciar sesión.', '',
    'Datos (haz copia de esta carpeta): ' + U.RUTAS.datos, 'Registro: ' + U.RUTAS.registro, ''].join('\r\n'));
  U.linea();
  console.log('SERVIDOR INSTALADO\n');
  console.log('  Dirección:  ' + url + '   (la aplicación ya la conoce)');
  if (activo) console.log('  Servidor central activo: ' + (activo.nombre || 'sí') + '. En cada dispositivo basta con iniciar sesión.\n');
  else {
    console.log('  Falta activar el servidor central (una sola vez): en la aplicación,');
    console.log('  Sistema → Servidor central → «Activar», con el código de administración.');
    console.log('  Para verlo: ' + U.BASE + '\\MOSTRAR-CODIGO-ADMIN.bat\n');
  }
  console.log('  Este PC debe estar encendido y con Internet durante los preventivos.');
  console.log('  Si se apaga, los dispositivos siguen trabajando y se sincronizan al volver.');
  console.log('  Instrucciones guardadas en ' + U.RUTAS.direccion);
  U.linea();
}

main().catch(e => fallo(e && e.message ? e.message : String(e)));
