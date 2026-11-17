// Estado del servidor de sincronización: tarea programada, servidor en este equipo,
// Tailscale y respuesta desde Internet. Se ejecuta desde estado-servidor.bat.
import { readFileSync } from 'node:fs';
import * as U from './comun.mjs';

const leer = f => { try { return readFileSync(f, 'utf8'); } catch { return ''; } };

async function main() {
  U.linea(); console.log('Gestor de Emergencias UCO · Estado del servidor de sincronización'); U.linea();
  const t = U.run(U.SCHTASKS, ['/Query', '/TN', U.TAREA]);
  console.log((t.code === 0 ? '✔' : '✖') + ' Arranque automático: ' + (t.code === 0 ? 'tarea «' + U.TAREA + '» creada' : 'no instalado (ejecuta instalar-servidor.bat)'));
  const puerto = U.puertoInstalado(leer(U.RUTAS.arrancar));
  const v = await U.salud(U.local(puerto));
  console.log((v ? '✔' : '✖') + ' En este equipo: ' + (v ? 'funcionando (versión ' + v + ', puerto ' + puerto + ')' : 'no responde. Revisa ' + U.RUTAS.registro));
  const ts = U.tailscaleEstado();
  console.log((ts.estado === 'Running' ? '✔' : '✖') + ' Tailscale: ' + (ts.estado === 'Running' ? 'conectado (' + ts.dns + ')' : ts.estado));
  if (ts.dns) {
    const url = 'https://' + ts.dns + '/';
    const p = await U.salud(process.env.UCO_URL_PRUEBA || url, 10000);
    console.log((p ? '✔' : '✖') + ' Desde Internet: ' + (p ? 'responde en ' + url : 'no responde en ' + url));
    if (!p) console.log('  Comprueba que Funnel está activo: «tailscale funnel status» debe mostrar la dirección.');
  }
  console.log('\nDatos: ' + U.RUTAS.datos);
  U.linea();
}
main();
