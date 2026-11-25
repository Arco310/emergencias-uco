// Datos del escenario E2E 14 (1.5.0, incoherencias), con los comandos de la aplicación y la hora real.
// Uso: node tests/e2e/generar_incoherencias.mjs <salida.json>
import { writeFileSync } from 'node:fs';
import { Device, createPrev, makeClock, unitByInd, C, MIN } from '../unit/helpers.mjs';

const clock = makeClock(Date.now() - 200 * MIN);
const A = new Device({ pid: 'prev_inc', clock }); createPrev(A, { nombre: 'Feria (incoherencias)' });
for (const [ind, tipo] of [['SVB-1', 'rt_svb'], ['SVB-2', 'rt_svb'], ['SVA-1', 'rt_sva']]) A.run(C.unitCreate, { ind, tipo, sector: 'sec_1' });
// Aviso abierto desde hace más de 3 horas, con una unidad
A.run(C.avisoCreate, { desc: 'Atención prolongada' }, { unidades: [unitByInd(A, 'SVA-1').id] });
// Unidad asignada que alguien devuelve a mano (forzando) a C0 sin liberarla del aviso
clock.advance(20 * MIN);
const a2 = A.run(C.avisoCreate, { desc: 'Herida leve' }, { unidades: [unitByInd(A, 'SVB-1').id] })[0].e;
// Dos dispositivos cambian a la vez el nombre del preventivo: conflicto pendiente de resolver
const B = new Device({ id: 'devB', code: 'B', pid: 'prev_inc', clock }); B.receive(A.store);
A.run(C.prevUpdate, { nombre: 'Feria de mayo' }); B.run(C.prevUpdate, { nombre: 'Feria de primavera' }); A.receive(B.store.slice(-1)); A.store.push(...B.store.slice(-1));
// Descanso de 10 horas (duración incoherente)
A.run(C.unitRest, unitByInd(A, 'SVB-2').id, 600);
// Dos avisos sin unidad desde hace más de 30 minutos
clock.set(Date.now() - 40 * MIN);
A.run(C.avisoCreate, { desc: 'Sin unidad 1' }); A.run(C.avisoCreate, { desc: 'Sin unidad 2' });
writeFileSync(process.argv[2], JSON.stringify({ prev_inc: A.store, aviso2: a2 }));
