// Utilidades comunes del instalador del servidor de sincronización para Windows.
// En pruebas (UCO_SIMULAR=1) las órdenes de Windows y de Tailscale se sustituyen por programas
// de prueba indicados en variables de entorno, para comprobar todo el flujo fuera de Windows.
import { spawnSync } from 'node:child_process';
import { join, win32 } from 'node:path';

export const SIM = !!process.env.UCO_SIMULAR;
export const BASE = process.env.UCO_BASE || join(process.env.ProgramData || 'C:\\ProgramData', 'GestorUCO');
export const PUERTO = Number(process.env.UCO_PUERTO || 8787);
export const TAREA = 'GestorUCO Servidor';
// Rutas de programas de Windows (siempre con barras de Windows, también en la simulación)
export const SCHTASKS = process.env.UCO_SCHTASKS || win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'schtasks.exe');
export const TAILSCALE = process.env.UCO_TAILSCALE || win32.join(process.env.ProgramFiles || 'C:\\Program Files', 'Tailscale', 'tailscale.exe');
export const CMD = win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'cmd.exe');
export const ICACLS = win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'icacls.exe');
export const POWERCFG = process.env.UCO_POWERCFG || win32.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'powercfg.exe');
export const NODE = process.env.UCO_NODE || process.execPath;
export const RUTAS = {
  servidor: join(BASE, 'servidor', 'server.mjs'), app: join(BASE, 'app'), datos: join(BASE, 'datos'),
  arrancar: join(BASE, 'arrancar.cmd'), tarea: join(BASE, 'tarea.xml'), registro: join(BASE, 'registro.txt'), direccion: join(BASE, 'DIRECCION.txt'),
};

/** Argumentos con los que arranca el servidor (solo escucha en el propio equipo: lo publica Tailscale) */
export function argsServidor(puerto = PUERTO) {
  return [RUTAS.servidor, '--port', String(puerto), '--host', '127.0.0.1', '--data', RUTAS.datos, '--static', RUTAS.app];
}
const q = s => '"' + s + '"';

/** Script que mantiene el servidor en marcha: si se detiene, vuelve a arrancarlo a los 10 segundos */
export function arrancarCmd(puerto = PUERTO) {
  const [srv, ...resto] = argsServidor(puerto);
  const args = resto.map(a => (/[\s\\:]/.test(a) ? q(a) : a)).join(' ');
  return ['@echo off', 'cd /d ' + q(BASE), ':bucle',
    `${q(NODE)} ${q(srv)} ${args} >> ${q(RUTAS.registro)} 2>&1`,
    'ping -n 11 127.0.0.1 >nul', 'goto bucle', ''].join('\r\n');
}

const xmlEsc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** Tarea programada de Windows: arranca con el equipo (cuenta SYSTEM), sin límite de tiempo y con reintentos */
export function tareaXml() {
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo>
    <Description>Servidor de sincronización del Gestor de Emergencias UCO. Datos en ${xmlEsc(RUTAS.datos)}</Description>
  </RegistrationInfo>
  <Triggers>
    <BootTrigger>
      <Enabled>true</Enabled>
      <Delay>PT30S</Delay>
    </BootTrigger>
  </Triggers>
  <Principals>
    <Principal id="Author">
      <UserId>S-1-5-18</UserId>
      <RunLevel>HighestAvailable</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <AllowHardTerminate>true</AllowHardTerminate>
    <StartWhenAvailable>true</StartWhenAvailable>
    <RunOnlyIfNetworkAvailable>false</RunOnlyIfNetworkAvailable>
    <IdleSettings>
      <StopOnIdleEnd>false</StopOnIdleEnd>
      <RestartOnIdle>false</RestartOnIdle>
    </IdleSettings>
    <AllowStartOnDemand>true</AllowStartOnDemand>
    <Enabled>true</Enabled>
    <Hidden>false</Hidden>
    <RunOnlyIfIdle>false</RunOnlyIfIdle>
    <WakeToRun>false</WakeToRun>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <Priority>7</Priority>
    <RestartOnFailure>
      <Interval>PT1M</Interval>
      <Count>999</Count>
    </RestartOnFailure>
  </Settings>
  <Actions Context="Author">
    <Exec>
      <Command>${xmlEsc(CMD)}</Command>
      <Arguments>/c ${xmlEsc(q(RUTAS.arrancar))}</Arguments>
      <WorkingDirectory>${xmlEsc(BASE)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`;
}
/** El Programador de tareas espera el XML en UTF-16 con marca de orden de bytes */
export const utf16 = s => Buffer.from('\ufeff' + s.replace(/\r?\n/g, '\r\n'), 'utf16le');

/** Ejecuta una orden y devuelve { code, out } (con eco opcional en pantalla) */
export function run(exe, args, { eco = false } = {}) {
  const r = spawnSync(exe, args, { encoding: 'utf8', stdio: eco ? 'inherit' : 'pipe', windowsHide: true });
  if (r.error) return { code: -1, out: String(r.error.message) };
  return { code: r.status ?? -1, out: (r.stdout || '') + (r.stderr || '') };
}

/** Estado de Tailscale: { estado, dns } a partir de `tailscale status --json` */
export function tailscaleEstado() {
  const r = run(TAILSCALE, ['status', '--json']);
  try { const j = JSON.parse(r.out); return { estado: j.BackendState || 'desconocido', dns: j.Self && j.Self.DNSName ? j.Self.DNSName.replace(/\.$/, '') : '' }; }
  catch { return { estado: r.code === -1 ? 'no instalado' : 'desconocido', dns: '' }; }
}

/** Comprueba el servidor: devuelve la versión si responde el Gestor UCO, o null */
/** Espacio central principal publicado por el servidor ({ org, nombre } o null si aún no se ha activado) */
export async function centralActivo(base, ms = 4000) {
  try { const j = await (await fetch(new URL('api/v1/central', base), { signal: AbortSignal.timeout(ms) })).json(); return j && j.org ? j : null; } catch { return undefined; }
}
export async function salud(base, ms = 4000) {
  try {
    const r = await fetch(new URL('api/v1/salud', base), { signal: AbortSignal.timeout(ms) });
    const j = await r.json();
    return j && j.ok && j.servicio === 'gestor-emergencias-uco' ? j.version : null;
  } catch { return null; }
}
export async function esperar(fn, segundos, cada = 1000) {
  const fin = Date.now() + segundos * 1000;
  while (Date.now() < fin) { const v = await fn(); if (v) return v; await new Promise(r => setTimeout(r, cada)); }
  return null;
}
/** Proceso que escucha en el puerto (solo Windows): para detener una instalación anterior */
export function pidEnPuerto(p) {
  if (SIM) return null;
  const r = run('netstat', ['-ano', '-p', 'tcp']);
  // Una conexión en escucha tiene como dirección remota 0.0.0.0:0 (vale para Windows en cualquier idioma)
  const m = r.out.split(/\r?\n/).map(l => l.trim().split(/\s+/)).find(c => c[0] === 'TCP' && (c[1] || '').endsWith(':' + p) && /^(0\.0\.0\.0|\[::\]):0$/.test(c[2] || ''));
  return m ? m[4] : null;
}
/** Puerto configurado en arrancar.cmd (el instalador puede haber elegido otro si el habitual estaba ocupado) */
export function puertoInstalado(txt) { const m = /--port (\d+)/.exec(txt || ''); return m ? Number(m[1]) : PUERTO; }
export const local = (puerto = PUERTO) => `http://127.0.0.1:${puerto}/`;
export const linea = () => console.log('─'.repeat(64));
