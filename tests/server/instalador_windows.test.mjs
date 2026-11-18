// Instalador del servidor para Windows, ejecutado en modo simulado: las órdenes de Windows
// (schtasks) y de Tailscale se sustituyen por programas de prueba que registran lo que se les
// pide; el servidor de sincronización arranca de verdad con los mismos argumentos que en Windows.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, chmodSync, cpSync, rmSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const PKG = new URL('../../dist/servidor-uco-windows/', import.meta.url).pathname;
const libre = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });

function entorno({ tsInicial = 'Running' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'uco-win-'));
  const log = join(dir, 'ordenes.log'), est = join(dir, 'ts-estado');
  writeFileSync(est, tsInicial);
  const fake = (nombre, cuerpo) => { const f = join(dir, nombre); writeFileSync(f, '#!/bin/sh\necho "' + nombre + ' $*" >> "' + log + '"\n' + cuerpo); chmodSync(f, 0o755); return f; };
  const powercfg = fake('powercfg', 'exit 0\n');
  const schtasks = fake('schtasks', 'case "$1" in /Query) [ -f "' + dir + '/tarea" ] && echo "GestorUCO Servidor  Listo" && exit 0; exit 1;;\n /Create) touch "' + dir + '/tarea";;\n /Delete) rm -f "' + dir + '/tarea";;\nesac\nexit 0\n');
  const tailscale = fake('tailscale', 'case "$1" in status) echo "{\\"BackendState\\":\\"$(cat ' + est + ')\\",\\"Self\\":{\\"DNSName\\":\\"pc-prueba.tail1234.ts.net.\\"}}";;\n up) echo Running > "' + est + '";;\nesac\nexit 0\n');
  return { dir, log, base: join(dir, 'GestorUCO'), schtasks, tailscale, powercfg };
}
const correr = (script, e, puerto, extra = {}, pkg = PKG) => spawnSync(process.execPath, [join(pkg, script)], {
  encoding: 'utf8', timeout: 90000,
  env: { ...process.env, UCO_SIMULAR: '1', UCO_SIN_PREGUNTAS: '1', UCO_BASE: e.base, UCO_PUERTO: String(puerto), UCO_SCHTASKS: e.schtasks, UCO_TAILSCALE: e.tailscale, UCO_POWERCFG: e.powercfg, UCO_URL_PRUEBA: 'http://127.0.0.1:' + puerto + '/', ...extra },
});

test('instalador para Windows: instala, arranca, publica, informa del estado y desinstala conservando los datos', async () => {
  assert.ok(existsSync(join(PKG, 'instalar-servidor.bat')), 'paquete generado por build.mjs');
  const e = entorno({ tsInicial: 'NeedsLogin' }); const p = await libre();
  const opc = join(e.dir, 'opciones.json'); writeFileSync(opc, JSON.stringify({ evitarSuspension: true, codigoPruebas: 'PRUEB-ASDEL-INSTA-LADOR' }));
  const r = correr('instalar.mjs', e, p, { UCO_OPCIONES: opc });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /SERVIDOR INSTALADO/);
  assert.match(r.stdout, /https:\/\/pc-prueba\.tail1234\.ts\.net\//);
  assert.match(r.stdout, /Responde desde Internet/);
  // Archivos instalados
  for (const f of ['servidor/server.mjs', 'app/index.html', 'app/sw.js', 'datos', 'DIRECCION.txt']) assert.ok(existsSync(join(e.base, f)), f);
  assert.match(readFileSync(join(e.base, 'DIRECCION.txt'), 'utf8'), /Dirección: https:\/\/pc-prueba\.tail1234\.ts\.net\//);
  // Servidor central: la app ya conoce la dirección; falta activarlo una vez con el código de administración
  assert.match(r.stdout, /la aplicación ya la conoce/);
  assert.match(r.stdout, /Falta activar el servidor central/);
  assert.ok(existsSync(join(e.base, 'MOSTRAR-CODIGO-ADMIN.bat')), 'utilidad para ver el código de administración');
  assert.match(readFileSync(join(e.base, 'datos', '_servidor', 'codigo-admin.txt'), 'utf8'), /^[2-9A-Z]{5}(-[2-9A-Z]{5}){3}/);
  // Código del entorno de pruebas (CLAUDE_TEST): instalado y retirado de opciones.json
  assert.equal(readFileSync(join(e.base, 'datos', '_servidor', 'codigo-pruebas.txt'), 'utf8').trim(), 'PRUEB-ASDEL-INSTA-LADOR');
  assert.ok(!('codigoPruebas' in JSON.parse(readFileSync(opc, 'utf8'))), 'el código de pruebas no queda en opciones.json');
  assert.equal(JSON.parse(readFileSync(opc, 'utf8')).evitarSuspension, true, 'el resto de opciones se conservan');
  const cmd = readFileSync(join(e.base, 'arrancar.cmd'), 'utf8');
  assert.ok(cmd.includes('\r\n') && !/[^\r]\n/.test(cmd), 'arrancar.cmd con saltos de línea de Windows');
  assert.match(cmd, new RegExp('--port ' + p + ' --host 127\\.0\\.0\\.1 --data'), 'solo escucha en el propio equipo');
  assert.match(cmd, /:bucle[\s\S]*ping -n 11 127\.0\.0\.1 >nul\r\ngoto bucle/, 'se reinicia si se detiene');
  // Tarea programada: XML en UTF-16 con BOM, arranque con el equipo, cuenta SYSTEM y sin límite de tiempo
  const raw = readFileSync(join(e.base, 'tarea.xml'));
  assert.deepEqual([...raw.subarray(0, 2)], [0xFF, 0xFE], 'UTF-16 LE con BOM');
  const xml = raw.subarray(2).toString('utf16le');
  for (const t of ['<BootTrigger>', '<UserId>S-1-5-18</UserId>', '<ExecutionTimeLimit>PT0S</ExecutionTimeLimit>', '<DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>', '<RestartOnFailure>', 'arrancar.cmd&quot;</Arguments>'])
    assert.ok(xml.includes(t), 'tarea.xml contiene ' + t);
  assert.equal((xml.match(/<(\w+)[ >]/g) || []).length, (xml.match(/<\/\w+>/g) || []).length, 'etiquetas equilibradas');
  // Órdenes ejecutadas
  const ordenes = readFileSync(e.log, 'utf8');
  assert.match(ordenes, /schtasks \/Create \/TN GestorUCO Servidor \/XML .*tarea\.xml \/F/);
  assert.match(ordenes, /tailscale up --unattended/, 'inicia sesión en Tailscale si hace falta');
  assert.match(ordenes, new RegExp('tailscale funnel --bg ' + p), 'publica el puerto del servidor con HTTPS');
  assert.match(ordenes, /powercfg \/change standby-timeout-ac 0/, 'evita la suspensión solo porque opciones.json lo autoriza');
  // El servidor funciona de verdad con esos argumentos
  const salud = await (await fetch('http://127.0.0.1:' + p + '/api/v1/salud')).json();
  assert.equal(salud.servicio, 'gestor-emergencias-uco');
  // Estado
  const s = correr('estado.mjs', e, p);
  assert.match(s.stdout, /\[OK\] Arranque automático/); assert.match(s.stdout, /\[OK\] En este equipo: funcionando/);
  assert.match(s.stdout, /\[OK\] Tailscale: conectado \(pc-prueba\.tail1234\.ts\.net\)/); assert.match(s.stdout, /\[OK\] Desde Internet: responde/);
  assert.match(s.stdout, /Servidor central: sin activar/);
  // Desinstalación: detiene, quita la tarea y Funnel, conserva los datos
  writeFileSync(join(e.base, 'datos', 'prueba.txt'), 'dato');
  const d = correr('desinstalar.mjs', e, p);
  assert.equal(d.status, 0, d.stdout + d.stderr);
  const o2 = readFileSync(e.log, 'utf8');
  assert.match(o2, /schtasks \/Delete \/TN GestorUCO Servidor \/F/); assert.match(o2, /tailscale funnel reset/);
  assert.ok(existsSync(join(e.base, 'datos', 'prueba.txt')), 'los datos se conservan');
  assert.ok(!existsSync(join(e.base, 'servidor')) && !existsSync(join(e.base, 'app')));
  await new Promise(r => setTimeout(r, 500));
  await assert.rejects(fetch('http://127.0.0.1:' + p + '/api/v1/salud', { signal: AbortSignal.timeout(2000) }), 'servidor detenido');
});

test('instalador para Windows: si el puerto está ocupado por otro programa, usa el siguiente libre', async () => {
  const e = entorno(); const p = await libre();
  const otro = createServer(() => { }); await new Promise(r => otro.listen(p, '127.0.0.1', r));
  try {
    const r = correr('instalar.mjs', e, p, { UCO_URL_PRUEBA: 'http://127.0.0.1:' + (p + 1) + '/' });
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, new RegExp('puerto ' + (p + 1)));
    assert.match(readFileSync(join(e.base, 'arrancar.cmd'), 'utf8'), new RegExp('--port ' + (p + 1)));
    assert.match(readFileSync(e.log, 'utf8'), new RegExp('tailscale funnel --bg ' + (p + 1)));
    assert.match(readFileSync(e.log, 'utf8'), /tailscale set --unattended/, 'con sesión ya iniciada solo activa el modo desatendido');
    assert.doesNotMatch(readFileSync(e.log, 'utf8'), /powercfg/, 'sin autorización no se cambia la suspensión');
  } finally {
    otro.close(); correr('desinstalar.mjs', e, p + 1);
  }
});

test('instalador para Windows: actualización con copia de datos y vuelta atrás automática si la nueva versión no arranca', async () => {
  const e = entorno(); const p = await libre();
  let r = correr('instalar.mjs', e, p);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  writeFileSync(join(e.base, 'datos', 'dato-real.txt'), 'no se pierde');
  // Paquete con un servidor que no arranca
  const roto = mkdtempSync(join(tmpdir(), 'uco-pkg-roto-'));
  cpSync(PKG, roto, { recursive: true });
  writeFileSync(join(roto, 'servidor', 'server.mjs'), 'process.exit(3);\n');
  try {
    r = correr('instalar.mjs', e, p, {}, roto);
    assert.notEqual(r.status, 0, 'el instalador informa del fallo');
    assert.match(r.stdout, /Copia de seguridad de los datos/);
    assert.match(r.stdout, /se ha restaurado la anterior \(versión \d+\.\d+\.\d+\)/i, r.stdout);
    const salud = await (await fetch('http://127.0.0.1:' + p + '/api/v1/salud')).json();
    assert.equal(salud.servicio, 'gestor-emergencias-uco', 'el servidor anterior sigue funcionando');
    const copias = readdirSync(join(e.base, 'copias')).filter(x => x.startsWith('datos-'));
    assert.equal(copias.length, 1);
    assert.equal(readFileSync(join(e.base, 'copias', copias[0], 'dato-real.txt'), 'utf8'), 'no se pierde', 'copia previa de los datos');
    assert.equal(readFileSync(join(e.base, 'datos', 'dato-real.txt'), 'utf8'), 'no se pierde');
    assert.doesNotMatch(readFileSync(join(e.base, 'servidor', 'server.mjs'), 'utf8'), /process\.exit\(3\)/, 'se restauró el servidor anterior');
  } finally {
    correr('desinstalar.mjs', e, p); rmSync(roto, { recursive: true, force: true });
  }
});
