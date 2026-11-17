// Instala el servidor de sincronización del Gestor de Emergencias UCO en este equipo Windows:
// copia los archivos, crea una tarea que lo arranca al encender el equipo y lo publica en
// Internet con una dirección HTTPS fija mediante Tailscale Funnel.
// Se ejecuta desde instalar-servidor.bat (con permisos de administrador).
import { cpSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
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
const OPC = (() => { try { return JSON.parse(readFileSync(process.env.UCO_OPCIONES || join(AQUI, 'opciones.json'), 'utf8')); } catch { return {}; } })();
const fallo = msg => { console.log('\n[ERROR] ' + msg); process.exit(1); };
const ok = msg => console.log('[OK] ' + msg);
const libre = p => new Promise(res => { const s = createServer(); s.once('error', () => res(false)); s.listen(p, '127.0.0.1', () => s.close(() => res(true))); });

async function elegirPuerto() {
  // Reinstalación: si ya responde el servidor del Gestor, se detiene para sustituirlo
  if (await U.salud(U.local(U.PUERTO))) {
    console.log('Hay una instalación anterior en marcha: se detiene para actualizarla.');
    U.run(U.SCHTASKS, ['/End', '/TN', U.TAREA]);
    const pid = U.pidEnPuerto(U.PUERTO); if (pid) U.run('taskkill', ['/F', '/T', '/PID', pid]);
    await U.esperar(async () => !(await U.salud(U.local(U.PUERTO), 1000)), 15);
  }
  for (let p = U.PUERTO; p < U.PUERTO + 20; p++) if (await libre(p)) return p;
  fallo('No hay ningún puerto libre entre ' + U.PUERTO + ' y ' + (U.PUERTO + 19) + '.');
}

async function main() {
  U.linea(); console.log('Gestor de Emergencias UCO · Instalación del servidor de sincronización'); U.linea();
  for (const f of [join(AQUI, 'servidor', 'server.mjs'), join(AQUI, 'app', 'index.html')]) if (!existsSync(f)) fallo('Falta ' + f + '. Descomprime el paquete completo antes de instalar.');

  // 1. Archivos en una carpeta fija del equipo
  const puerto = await elegirPuerto();
  mkdirSync(dirname(U.RUTAS.servidor), { recursive: true });
  cpSync(join(AQUI, 'servidor', 'server.mjs'), U.RUTAS.servidor);
  rmSync(U.RUTAS.app, { recursive: true, force: true }); cpSync(join(AQUI, 'app'), U.RUTAS.app, { recursive: true });
  mkdirSync(U.RUTAS.datos, { recursive: true });
  writeFileSync(U.RUTAS.arrancar, U.arrancarCmd(puerto));
  writeFileSync(U.RUTAS.tarea, U.utf16(U.tareaXml()));
  ok('Archivos en ' + U.BASE + ' (datos en ' + U.RUTAS.datos + ')');

  // 2. Tarea programada: arranca al encender el equipo, sin necesidad de iniciar sesión
  const t = U.run(U.SCHTASKS, ['/Create', '/TN', U.TAREA, '/XML', U.RUTAS.tarea, '/F']);
  if (t.code !== 0) fallo('No se pudo crear la tarea programada: ' + t.out.trim());
  ok('Arranque automático al encender el equipo (tarea «' + U.TAREA + '»)');
  if (U.SIM) {
    const ch = spawn(U.NODE, U.argsServidor(puerto), { detached: true, stdio: 'ignore' }); ch.unref();
    writeFileSync(join(U.BASE, 'pid-prueba.txt'), String(ch.pid));
  } else U.run(U.SCHTASKS, ['/Run', '/TN', U.TAREA]);
  const v = await U.esperar(() => U.salud(U.local(puerto)), 40);
  if (!v) fallo('El servidor no ha arrancado. Revisa ' + U.RUTAS.registro);
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

  writeFileSync(U.RUTAS.direccion, [
    'Servidor de sincronización del Gestor de Emergencias UCO', '', 'Dirección: ' + url, '',
    'En la aplicación de cada dispositivo: Sistema → Configuración general →',
    '«Servidor por defecto para preventivos compartidos» → pega la dirección.',
    'También puede indicarse al crear un preventivo compartido.', '',
    'Datos (haz copia de esta carpeta): ' + U.RUTAS.datos, 'Registro: ' + U.RUTAS.registro, ''].join('\r\n'));
  U.linea();
  console.log('SERVIDOR INSTALADO\n');
  console.log('  Dirección:  ' + url);
  console.log('  En la aplicación: Sistema → Configuración general → «Servidor por defecto');
  console.log('  para preventivos compartidos» → pega la dirección.\n');
  console.log('  Este PC debe estar encendido y con Internet durante los preventivos.');
  console.log('  Si se apaga, los dispositivos siguen trabajando y se sincronizan al volver.');
  console.log('  Dirección guardada en ' + U.RUTAS.direccion);
  U.linea();
}

main().catch(e => fallo(e && e.message ? e.message : String(e)));
