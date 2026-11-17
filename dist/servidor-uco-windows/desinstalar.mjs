// Desinstala el servidor de sincronización: quita el arranque automático, lo detiene y deja de
// publicarlo en Internet. Los datos se conservan. Se ejecuta desde desinstalar-servidor.bat.
import { readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import * as U from './comun.mjs';

const leer = f => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };

U.linea(); console.log('Gestor de Emergencias UCO · Desinstalación del servidor de sincronización'); U.linea();
const puerto = U.puertoInstalado(leer(U.RUTAS.arrancar));
U.run(U.SCHTASKS, ['/End', '/TN', U.TAREA]);
const d = U.run(U.SCHTASKS, ['/Delete', '/TN', U.TAREA, '/F']);
console.log((d.code === 0 ? '✔ Arranque automático eliminado' : '· No había tarea programada'));
if (U.SIM) { try { process.kill(Number(leer(join(U.BASE, 'pid-prueba.txt')))); } catch { } }
else { const pid = U.pidEnPuerto(puerto); if (pid) U.run('taskkill', ['/F', '/T', '/PID', pid]); }
console.log('✔ Servidor detenido');
// Dejar de publicarlo en Internet (según la versión de Tailscale, una de estas órdenes)
const intentos = [['funnel', 'reset'], ['serve', 'reset'], ['funnel', '--https=443', 'off']];
let f = null; for (const a of intentos) { const r = U.run(U.TAILSCALE, a); if (r.code === 0) { f = r; break; } }
console.log(f ? '✔ Ya no se publica en Internet (Funnel desactivado)' : '· Funnel no estaba activo o Tailscale no está instalado');
for (const x of [join(U.BASE, 'servidor'), U.RUTAS.app, U.RUTAS.arrancar, U.RUTAS.tarea, join(U.BASE, 'pid-prueba.txt')]) rmSync(x, { recursive: true, force: true });
console.log('\nLos datos se conservan en ' + U.RUTAS.datos + '. Bórralos a mano solo si ya no los necesitas.');
U.linea();
