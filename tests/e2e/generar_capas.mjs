// Datos del escenario E2E 12 (1.5.0, capas y filtros), generados con los mismos comandos de la aplicación.
// Uso: node tests/e2e/generar_capas.mjs <salida.json>
import { writeFileSync } from 'node:fs';
import { Device, createPrev, makeClock, unitByInd, C } from '../unit/helpers.mjs';
import { normAGeo } from '../../src/core/geo.js';

const ZONA = { tipo: 'mapa', nombre: 'Puerta del Sol', proveedor: 'osm', bounds: { n: 40.4180, s: 40.4155, e: -3.7015, w: -3.7055 }, centro: { lat: 40.41675, lon: -3.7035 }, zoom: 18 };
const pos = (x, y) => ({ x, y, ...normAGeo(ZONA.bounds, x, y) });

// Preventivo con un poco de todo: unidades en distintas situaciones, avisos activo y finalizado,
// un sector delimitado y dos puntos (uno de interés y otro de apoyo)
// Hora real (hace 5 minutos): así el descanso de SVB-2 sigue en curso mientras dura la prueba
const clock = makeClock(Date.now() - 5 * 60000); const A = new Device({ pid: 'prev_capas', clock });
createPrev(A, { nombre: 'Concierto en Sol' });
A.run(C.planoSet, ZONA);
for (const [ind, tipo, sector, x, y] of [['SVB-1', 'rt_svb', 'sec_1', 0.2, 0.3], ['SVB-2', 'rt_svb', 'sec_2', 0.7, 0.3], ['SVA-1', 'rt_sva', 'sec_1', 0.3, 0.7]]) {
  A.run(C.unitCreate, { ind, tipo, sector }); A.run(C.unitPlan, unitByInd(A, ind).id, pos(x, y));
}
A.run(C.unitRest, unitByInd(A, 'SVB-2').id);
const tipos = A.s.prev.cat.tiposAviso;
A.run(C.avisoCreate, { tipo: tipos[0].id, desc: 'Activo', plan: pos(0.5, 0.5) }, { unidades: [unitByInd(A, 'SVA-1').id] });
const fin = A.run(C.avisoCreate, { tipo: tipos[1].id, desc: 'Ya atendido', plan: pos(0.8, 0.8) })[0].e;
A.run(C.avisoFinalizar, fin, {});
const sec = structuredClone(A.s.prev.cat.sectores);
sec[0].zona = { pts: [pos(0.05, 0.05), pos(0.45, 0.05), pos(0.45, 0.95), pos(0.05, 0.95)] };
A.run(C.catUpdate, 'sectores', sec);
A.run(C.catUpdate, 'puntos', [
  { id: 'pt_puerta', nombre: 'Puerta 3', categoria: 'cp_acceso', pos: pos(0.1, 0.5) },
  { id: 'pt_hosp', nombre: 'Hospital de referencia', categoria: 'cp_hospital', pos: pos(0.9, 0.1) },
]);

// Preventivo grande: 150 unidades muy juntas (agrupación y fluidez)
const B = new Device({ pid: 'prev_grande', clock: makeClock(Date.now() - 5 * 60000) });
createPrev(B, { nombre: 'Maratón (150 unidades)' });
B.run(C.planoSet, ZONA);
for (let i = 0; i < 150; i++) {
  const ind = 'U' + String(i + 1).padStart(3, '0');
  B.run(C.unitCreate, { ind, tipo: i % 2 ? 'rt_svb' : 'rt_sva', sector: 'sec_1' });
  B.run(C.unitPlan, unitByInd(B, ind).id, pos(0.4 + (i % 15) * 0.012, 0.4 + Math.floor(i / 15) * 0.012));
}
writeFileSync(process.argv[2], JSON.stringify({ prev_capas: A.store, prev_grande: B.store }));
