// Datos del escenario E2E 15 (1.5.0, plantillas de preventivo), generados con los mismos comandos de la aplicación.
// Uso: node tests/e2e/generar_plantillas.mjs <salida.json>
import { writeFileSync } from 'node:fs';
import { Device, createPrev, makeClock, unitByInd, C } from '../unit/helpers.mjs';
import { normAGeo } from '../../src/core/geo.js';

const ZONA = { tipo: 'mapa', nombre: 'Puerta del Sol', proveedor: 'osm', bounds: { n: 40.4180, s: 40.4155, e: -3.7015, w: -3.7055 }, centro: { lat: 40.41675, lon: -3.7035 }, zoom: 18 };
const pos = (x, y) => ({ x, y, ...normAGeo(ZONA.bounds, x, y) });

// Preventivo de origen: plano, un sector propio delimitado, puntos, reglas ajustadas y un aviso (que nunca debe copiarse)
const A = new Device({ pid: 'prev_origen', clock: makeClock(Date.now() - 30 * 60000) });
createPrev(A, { nombre: 'Concierto en Sol' });
A.run(C.planoSet, ZONA);
A.run(C.catUpdate, 'sectores', [...A.s.prev.cat.sectores, { id: 'sec_grada', nombre: 'Grada norte', color: '#6D4C41', zona: { pts: [pos(0.1, 0.1), pos(0.5, 0.1), pos(0.3, 0.4)] } }]);
for (const [ind, tipo, sector, x, y] of [['SVB-1', 'rt_svb', 'sec_1', 0.2, 0.3], ['SVB-2', 'rt_svb', 'sec_2', 0.7, 0.3], ['SVA-1', 'rt_sva', 'sec_grada', 0.3, 0.2]]) {
  A.run(C.unitCreate, { ind, tipo, sector }); A.run(C.unitPlan, unitByInd(A, ind).id, pos(x, y));
}
A.run(C.catUpdate, 'puntos', [
  { id: 'pt_puerta', nombre: 'Puerta 3', categoria: 'cp_acceso', pos: pos(0.1, 0.5) },
  { id: 'pt_hosp', nombre: 'Hospital de referencia', categoria: 'cp_hospital', pos: pos(0.9, 0.1) },
]);
A.run(C.reglasSet, { aviso_sin_unidad: { nivel: 'alta' } });
A.run(C.avisoCreate, { tipo: A.s.prev.cat.tiposAviso[0].id, desc: 'Aviso que no se copia' }, { unidades: [unitByInd(A, 'SVB-1').id] });
writeFileSync(process.argv[2], JSON.stringify({ prev_origen: A.store }));
