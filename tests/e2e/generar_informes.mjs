// Datos del escenario E2E 16 (1.5.0, informes al finalizar), generados con los mismos comandos de la aplicación.
// Uso: node tests/e2e/generar_informes.mjs <salida.json>
import { writeFileSync } from 'node:fs';
import { Device, createPrev, makeClock, unitByInd, C } from '../unit/helpers.mjs';
import { normAGeo } from '../../src/core/geo.js';

const ZONA = { tipo: 'mapa', nombre: 'Puerta del Sol', proveedor: 'osm', bounds: { n: 40.4180, s: 40.4155, e: -3.7015, w: -3.7055 }, centro: { lat: 40.41675, lon: -3.7035 }, zoom: 18 };
const pos = (x, y) => ({ x, y, ...normAGeo(ZONA.bounds, x, y) });
const MIN = 60000;
// Preventivo de dos horas que termina ahora: plano, sector delimitado, avisos (uno sin terminar), descanso y cambio de ubicación
const clock = makeClock(Date.now() - 120 * MIN); const A = new Device({ pid: 'prev_inf', clock });
createPrev(A, { nombre: 'Maratón popular' });
A.run(C.prevUpdate, { participantes: [{ nombre: 'Lola Pérez', rol: 'Responsable sanitaria' }] });
A.run(C.planoSet, ZONA);
const sec = structuredClone(A.s.prev.cat.sectores); sec[0].zona = { pts: [pos(0.05, 0.05), pos(0.45, 0.05), pos(0.45, 0.95), pos(0.05, 0.95)] };
A.run(C.catUpdate, 'sectores', sec);
for (const [ind, tipo, sector, x, y] of [['SVB-1', 'rt_svb', 'sec_1', 0.2, 0.3], ['SVB-2', 'rt_svb', 'sec_2', 0.7, 0.3], ['SVA-1', 'rt_sva', 'sec_1', 0.3, 0.7]]) {
  A.run(C.unitCreate, { ind, tipo, sector }); A.run(C.unitPlan, unitByInd(A, ind).id, pos(x, y));
}
clock.advance(20 * MIN);
const a1 = A.run(C.avisoCreate, { tipo: A.s.prev.cat.tiposAviso[0].id, desc: 'Caída en el kilómetro 3', plan: pos(0.3, 0.4) }, { unidades: [unitByInd(A, 'SVB-1').id] })[0].e;
clock.advance(25 * MIN); A.run(C.avisoFinalizar, a1, { liberarUnidades: true });
A.run(C.unitRest, unitByInd(A, 'SVB-2').id);
clock.advance(10 * MIN); A.run(C.unitLoc, unitByInd(A, 'SVA-1').id, { txt: 'Meta, carpa sanitaria', lat: 40.4166, lon: -3.7032 });
clock.advance(20 * MIN); A.run(C.avisoCreate, { tipo: A.s.prev.cat.tiposAviso[1].id, desc: 'Mareo en meta', plan: pos(0.6, 0.8) });
writeFileSync(process.argv[2], JSON.stringify({ prev_inf: A.store }));
