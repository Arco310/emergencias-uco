// Prueba de rendimiento del motor con preventivos grandes, generados con los mismos
// comandos que usa la aplicación (reglas, validación y conflictos incluidos).
// Uso: node tests/perf/rendimiento.mjs [unidades avisos] → resultados en tests/perf/resultados-motor.json
import { performance } from 'node:perf_hooks';
import { writeFileSync } from 'node:fs';
import { Device, createPrev, makeClock, C } from '../unit/helpers.mjs';
import { Engine } from '../../src/core/engine.js';
import { prevStats, avisoStats, unitStats } from '../../src/core/stats.js';
import { logEntries, unitChronology } from '../../src/core/timeline.js';
import { buildReport } from '../../src/core/report.js';
import { prevJSON, csvZip } from '../../src/core/exporters.js';
import { clone } from '../../src/core/util.js';

const ms = (f, n = 1) => { const t = []; let r; for (let i = 0; i < n; i++) { const a = performance.now(); r = f(); t.push(performance.now() - a); } t.sort((x, y) => x - y); return { ms: +t[Math.floor(t.length / 2)].toFixed(1), r }; };
const TIPOS_AV = ['ta_san', 'ta_san', 'ta_san', 'ta_acc', 'ta_inc', 'ta_seg', 'ta_log', 'ta_desap', 'ta_tras', 'ta_otro'];
const TIPOS_U = ['rt_svb', 'rt_svb', 'rt_sva', 'rt_psa', 'rt_eqsan', 'rt_eqint', 'rt_log', 'rt_coord'];
const SECT = ['sec_1', 'sec_2', 'sec_3', 'sec_base'];

/** Genera un preventivo con nU unidades y nA avisos con ciclo completo de claves */
export function generar(nU, nA, seed = 1) {
  let x = seed; const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const pick = a => a[Math.floor(rnd() * a.length)];
  const clock = makeClock(); const dev = new Device({ clock });
  createPrev(dev);
  const ids = [];
  for (let i = 0; i < nU; i++) { const [op] = dev.run(C.unitCreate, { ind: 'U' + String(i + 1).padStart(3, '0'), nombre: 'Unidad ' + (i + 1), tipo: pick(TIPOS_U), sector: pick(SECT) }); ids.push(op.e); clock.advance(1000); }
  const libres = new Set(ids); const tCmd = [];
  const run = (...a) => { const t0 = performance.now(); try { return dev.run(...a); } finally { tCmd.push(performance.now() - t0); } };
  const paso = 12 * 3600000 / nA; // avisos repartidos en 12 horas
  for (let i = 0; i < nA; i++) {
    clock.advance(Math.round(paso * (0.5 + rnd())));
    const u = pick([...libres]); libres.delete(u);
    const tipos = TIPOS_AV.filter(t => C.isCompatible(dev.s, t, dev.s.units[u])); // tipo de aviso compatible con la unidad
    const [av] = run(C.avisoCreate, { tipo: tipos.length ? pick(tipos) : null, desc: 'Aviso ' + (i + 1) + ': persona atendida', sector: pick(SECT), loc: rnd() < 0.5 ? { txt: 'Punto ' + (i % 40), lat: 37.88 + rnd() / 100, lon: -4.78 + rnd() / 100 } : null });
    run(C.avisoAsignar, av.e, u); clock.advance(30000);
    run(C.unitClave, u, 'C2'); clock.advance(240000);
    if (rnd() < 0.3) run(C.unitLoc, u, { lat: 37.88 + rnd() / 100, lon: -4.78 + rnd() / 100, txt: '' });
    run(C.unitClave, u, 'C3'); clock.advance(600000);
    if (rnd() < 0.5) run(C.avisoNota, av.e, 'Valoración realizada, paciente consciente y orientado');
    if (rnd() < 0.3) { run(C.unitClave, u, 'C4'); clock.advance(900000); run(C.unitClave, u, 'C5'); clock.advance(600000); }
    run(C.unitClave, u, 'C0'); run(C.avisoFinalizar, av.e, { nota: 'Resuelto' });
    if (rnd() < 0.1) { run(C.unitNota, u, 'Revisión de material'); }
    libres.add(u);
  }
  return { dev, clock, tCmd };
}

async function medir(nU, nA) {
  const t0 = performance.now();
  const { dev, clock, tCmd } = generar(nU, nA);
  const gen = performance.now() - t0;
  const ops = dev.store; const s = dev.s; const until = clock.now();
  const tail = tCmd.slice(-500); const cmdUlt = tail.reduce((a, b) => a + b, 0) / tail.length;
  const out = { unidades: nU, avisos: nA, operaciones: ops.length, generacion_s: +(gen / 1000).toFixed(1),
    accion_media_ms_al_final: +cmdUlt.toFixed(2), accion_max_ms: +Math.max(...tail).toFixed(1) };
  out.tam_registro_MB = +(JSON.stringify(ops).length / 1048576).toFixed(2);
  out.tam_estado_MB = +(JSON.stringify(s).length / 1048576).toFixed(2);
  const u0 = Object.keys(s.units)[0];
  out.validacion_accion_ms = ms(() => dev.engine.dryRun(C.unitNota({ ...dev.ctx }, u0, 'x')), 20).ms;
  out.clonado_estado_ms = ms(() => clone(s), 10).ms;
  const copia = ops.map(o => clone(o));
  out.reconstruccion_completa_ms = ms(() => new Engine(copia), 3).ms; // lo que se hace al abrir el preventivo
  const e = new Engine(copia);
  const av = copia.find(o => o.k === 'aviso.create');
  // Modo compartido: un aviso nuevo, aún sin número, recibe el número definitivo del servidor
  { const nuevo = { ...clone(av), id: 'op_srv', e: 'av_srv', h: copia[copia.length - 1].h + 'z', num: undefined, nl: undefined };
    e.add([nuevo]); const a = performance.now(); e.setNumber('op_srv', e.state.maxNum + 1); out.numero_servidor_ms = +(performance.now() - a).toFixed(2); }
  out.renumeracion_completa_ms = ms(() => { av.num = (av.num || 0) + 1000; e.setNumber(av.id, av.num + 1); }, 3).ms;
  const viejo = { ...clone(copia[copia.length - 1]), id: 'op_tarde', h: copia[Math.floor(copia.length / 2)].h.replace(/.$/, 'z'), k: 'unit.nota', e: u0, x: { txt: 'llega tarde', tipo: 'observacion' } };
  { const e2 = new Engine(copia); const a = performance.now(); e2.add([clone(viejo)]); out.op_remota_desordenada_ms = +(performance.now() - a).toFixed(1); } // llega una operación de otro dispositivo con hora anterior
  out.estadisticas_ms = ms(() => prevStats(s, until), 3).ms;
  out.estadisticas_avisos_ms = ms(() => avisoStats(s, {}), 3).ms;
  out.estadisticas_unidades_ms = ms(() => Object.values(s.units).map(u => unitStats(s, u, until)), 3).ms;
  out.cronologia_unidad_ms = ms(() => unitChronology(e, u0, until), 3).ms;
  out.bitacora_completa_ms = ms(() => logEntries(e, {}).length, 3).ms;
  out.bitacora_entradas = logEntries(e, {}).length;
  { const a = performance.now(); const pdf = await buildReport(e, { usuario: 'Prueba', dispositivo: 'Servidor' }); out.informe_pdf_ms = +(performance.now() - a).toFixed(1); out.informe_pdf_MB = +(pdf.length / 1048576).toFixed(2); out.informe_pdf_paginas = (Buffer.from(pdf).toString('latin1').match(/\/Type \/Page /g) || []).length; }
  const js = ms(() => JSON.stringify(prevJSON(e, {})), 1); out.exportacion_json_ms = js.ms; out.exportacion_json_MB = +(js.r.length / 1048576).toFixed(2);
  const z = ms(() => csvZip(e, until), 1); out.exportacion_csv_ms = z.ms; out.exportacion_csv_MB = +(z.r.length / 1048576).toFixed(2);
  out.memoria_MB = +(process.memoryUsage().heapUsed / 1048576).toFixed(0);
  return out;
}

const principal = import.meta.url === new URL(process.argv[1], 'file://').href;
const niveles = !principal ? [] : process.argv.length > 3 ? [[+process.argv[2], +process.argv[3]]] : [[50, 300], [150, 1500], [300, 3000]];
const res = [];
for (const [u, a] of niveles) { const r = await medir(u, a); res.push(r); console.log(JSON.stringify(r)); }
if (principal) writeFileSync(new URL('./resultados-motor.json', import.meta.url), JSON.stringify({ fecha: new Date().toISOString(), node: process.version, resultados: res }, null, 1));
