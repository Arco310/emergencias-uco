// 1.5.0 · Informes al finalizar: registro de versiones, accesos y exportaciones sin tocar los registros operativos.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Device, createPrev, unitByInd, mkUser, C } from './helpers.mjs';
import { permisosOp } from '../../src/core/perms.js';
import { logEntries } from '../../src/core/timeline.js';
import { motivoContenidoNoValido } from '../../src/core/ubicacion.js';
import { stableStringify } from '../../src/core/util.js';

const HASH = 'ab'.repeat(32);
function finalizado() {
  const d = new Device({ pid: 'prev_inf' }); createPrev(d, { nombre: 'Concierto' });
  d.run(C.unitCreate, { ind: 'SVB-1', tipo: 'rt_svb', sector: 'sec_1' });
  const a = d.run(C.avisoCreate, { tipo: d.s.prev.cat.tiposAviso[0].id, desc: 'Caída' }, { unidades: [unitByInd(d, 'SVB-1').id] })[0].e;
  d.run(C.avisoFinalizar, a, { liberarUnidades: true });
  d.run(C.prevCerrar, { confirmarAdvertencias: true }); d.run(C.prevArchivar, true);
  return d;
}
const operativo = d => stableStringify({ prev: d.s.prev, units: d.s.units, avisos: d.s.avisos, conflicts: d.s.conflicts, revisiones: d.s.revisiones });

test('registrar un informe no modifica los registros operativos y se admite con el preventivo finalizado y archivado', () => {
  const d = finalizado(); const antes = operativo(d);
  d.run(C.informeRegistrar, { accion: 'generar', n: 1, hash: HASH, formato: 'pdf', provisional: true, pendientes: 2, nOps: 9 });
  d.run(C.informeRegistrar, { accion: 'exportar', n: 1, hash: HASH, formato: 'pdf' });
  d.run(C.informeRegistrar, { accion: 'consultar', n: 1, formato: 'pdf' });
  assert.equal(operativo(d), antes, 'unidades, avisos, preventivo y conflictos intactos');
  assert.deepEqual(d.s.informes.map(x => x.accion), ['generar', 'exportar', 'consultar']);
  const g = d.s.informes[0];
  assert.equal(g.n, 1); assert.equal(g.hash, HASH); assert.equal(g.provisional, true); assert.equal(g.pendientes, 2); assert.equal(g.nOps, 9);
  assert.equal(g.por, 'Admin'); assert.ok(g.t > 0);
  const log = logEntries(d.engine).filter(e => e.k === 'informe.reg');
  assert.equal(log.length, 3);
  assert.equal(log[0].cat, 'informe');
  assert.match(log[0].accion, /Informe generado \(versión 1\)/);
  assert.match(log[0].nuevo, /PDF · SHA-256 abababab.*provisional: 2 cambios sin sincronizar/);
  assert.match(log[1].accion, /Informe exportado/); assert.match(log[2].accion, /Informe consultado/);
});

test('permisos para generar, exportar y consultar el informe, comprobados también en el servidor', () => {
  const d = finalizado();
  const consulta = mkUser('rol_consulta', 'Carla');
  assert.throws(() => d.as(consulta, x => x.run(C.informeRegistrar, { accion: 'generar', n: 1, hash: HASH, formato: 'pdf' })), /permiso/i);
  assert.throws(() => d.as(consulta, x => x.run(C.informeRegistrar, { accion: 'exportar', formato: 'csv' })), /permiso/i);
  d.as(consulta, x => x.run(C.informeRegistrar, { accion: 'consultar', n: 1, formato: 'pdf' }));
  const op = (accion) => ({ k: 'informe.reg', x: { accion } });
  assert.deepEqual(permisosOp(op('generar')), ['informes.generar']);
  assert.deepEqual(permisosOp(op('exportar')), ['exportar']);
  assert.deepEqual(permisosOp(op('consultar')), ['informes.ver']);
});

test('contenido del registro de informes validado (también en el servidor)', () => {
  const op = x => ({ k: 'informe.reg', x });
  assert.equal(motivoContenidoNoValido(op({ accion: 'generar', n: 2, hash: HASH, formato: 'pdf', motivo: 'Corrección autorizada' })), null);
  assert.match(motivoContenidoNoValido(op({ accion: 'borrar' })), /acción/i);
  assert.match(motivoContenidoNoValido(op({ accion: 'generar', n: 1, hash: 'zz', formato: 'pdf' })), /huella/i);
  assert.match(motivoContenidoNoValido(op({ accion: 'exportar', formato: 'exe' })), /formato/i);
  assert.match(motivoContenidoNoValido(op({ accion: 'generar', n: 0, hash: HASH, formato: 'pdf' })), /versión/i);
  const d = finalizado();
  assert.throws(() => d.run(C.informeRegistrar, { accion: 'generar', n: 1, hash: 'zz', formato: 'pdf' }), /huella/i);
});

test('horas verificables: distingue la hora declarada, la de recepción en el servidor y la de sincronización, y explica las limitaciones', async () => {
  const { fiabilidadHoras } = await import('../../src/core/fiabilidad.js');
  const T = Date.UTC(2026, 10, 25, 10, 0, 0); const M = 60000;
  const ops = [
    { id: 'o1', d: 'devA', dn: 'Tablet', k: 'unit.clave', t: T },
    { id: 'o2', d: 'devB', dn: 'Móvil 2', k: 'aviso.create', t: T + M },          // sin conexión: llega 12 min después
    { id: 'o3', d: 'devC', dn: 'Móvil 3', k: 'unit.clave', t: T + 10 * M },       // reloj adelantado 5 min
    { id: 'o4', d: 'devA', dn: 'Tablet', k: 'unit.loc', t: T + 2 * M },           // pendiente de enviar
    { id: 'o5', d: 'devA', dn: 'Tablet', k: 'unit.loc', t: T + 3 * M },           // anterior a 1.5.0 o por archivo
    { id: 'o6', d: 'devA', dn: 'Tablet', k: 'informe.reg', t: T + 4 * M },        // el propio registro del informe no cuenta
  ];
  const meta = new Map([
    ['o1', { rx: T + 2000, sy: T + 3000 }], ['o2', { rx: T + 13 * M, sy: T + 13 * M + 5000 }],
    ['o3', { rx: T + 5 * M, sy: T + 5 * M + 1000 }], ['o4', { ps: true }], ['o5', {}],
  ]);
  const f = fiabilidadHoras(ops, meta, { compartido: true });
  assert.equal(f.total, 5); assert.equal(f.conServidor, 3); assert.equal(f.pendientes, 1); assert.equal(f.sinServidor, 2);
  assert.deepEqual(f.diferidos.map(x => [x.op.id, x.retraso]), [['o2', 12 * M]]);
  assert.equal(f.diferidos[0].sy, T + 13 * M + 5000);
  const txt = f.limitaciones.join(' | ');
  assert.match(txt, /1 cambio de este dispositivo sin enviar/);
  assert.match(txt, /1 operación sin hora de recepción del servidor/);
  assert.match(txt, /1 operación registrada sin conexión o enviada con retraso/);
  assert.match(txt, /reloj del dispositivo «Móvil 3» iba adelantado al menos 5 min/);
  const ind = fiabilidadHoras(ops, new Map(), { compartido: false });
  assert.equal(ind.diferidos.length, 0);
  assert.match(ind.limitaciones.join(' '), /independiente: todas las horas son las declaradas por este dispositivo/i);
});

test('informe PDF verificable: versión, identidad UCO, configuración y sectores, plano, actividad por unidad, horas y limitaciones', async () => {
  const { inflateSync } = await import('node:zlib');
  const { makeClock, MIN } = await import('./helpers.mjs');
  const { buildReport } = await import('../../src/core/report.js');
  const { toWinAnsi } = await import('../../src/core/pdf.js');
  const { normAGeo } = await import('../../src/core/geo.js');
  const W = s => toWinAnsi(s).map(c => (c === 40 || c === 41 || c === 92 ? '\\' + String.fromCharCode(c) : c < 32 || c > 126 ? '\\' + c.toString(8).padStart(3, '0') : String.fromCharCode(c))).join('');
  const ZONA = { tipo: 'mapa', nombre: 'Puerta del Sol', proveedor: 'osm', bounds: { n: 40.4180, s: 40.4155, e: -3.7015, w: -3.7055 }, centro: { lat: 40.41675, lon: -3.7035 }, zoom: 18 };
  const pos = (x, y) => ({ x, y, ...normAGeo(ZONA.bounds, x, y) });
  const clock = makeClock(); const d = new Device({ pid: 'prev_rep', clock, mode: 'compartida' });
  createPrev(d, { nombre: 'Concierto en Sol' });
  d.run(C.prevUpdate, { participantes: [{ nombre: 'Lola Pérez', rol: 'Responsable sanitaria' }, { nombre: 'Juan', rol: 'Operador' }] });
  d.run(C.planoSet, ZONA);
  const sec = structuredClone(d.s.prev.cat.sectores); sec[0].zona = { pts: [pos(0.05, 0.05), pos(0.45, 0.05), pos(0.45, 0.95), pos(0.05, 0.95)] };
  d.run(C.catUpdate, 'sectores', sec);
  d.run(C.unitCreate, { ind: 'SVB-1', tipo: 'rt_svb', sector: 'sec_1' }); d.run(C.unitPlan, unitByInd(d, 'SVB-1').id, pos(0.2, 0.3));
  d.run(C.unitCreate, { ind: 'SVA-1', tipo: 'rt_sva', sector: 'sec_2' });
  clock.advance(10 * MIN);
  const a = d.run(C.avisoCreate, { tipo: d.s.prev.cat.tiposAviso[0].id, desc: 'Caída en grada', plan: pos(0.3, 0.4) }, { unidades: [unitByInd(d, 'SVB-1').id] })[0].e;
  d.run(C.unitRest, unitByInd(d, 'SVA-1').id);
  clock.advance(20 * MIN); d.run(C.avisoFinalizar, a, { liberarUnidades: true });
  clock.advance(15 * MIN); d.run(C.prevCerrar, { confirmarAdvertencias: true });
  const ops = d.engine.ops; const meta = new Map(ops.map((o, i) => [o.id, { rx: o.t + (i === 5 ? 9 * MIN : 1500), sy: o.t + (i === 5 ? 9 * MIN : 1500) + 800 }]));
  const pdf = await buildReport(d.engine, { usuario: 'Ana', dispositivo: 'Tablet', version: { n: 2, motivo: 'Corrección autorizada tras reapertura', provisional: true, pendientes: 1, conflictos: 0 }, horas: { meta, compartido: true } });
  const txt = Buffer.from(pdf).toString('latin1');
  const plano = [...txt.matchAll(/<< \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g)].map(m => inflateSync(Buffer.from(txt.slice(m.index + m[0].length, m.index + m[0].length + Number(m[1])), 'latin1')).toString('latin1')).join('\n');
  for (const s of ['Gestor de Emergencias UCO', 'Versión 2 del informe', 'PROVISIONAL', 'Configuración y sectores utilizados', 'Responsables', 'Lola Pérez (Responsable sanitaria)',
    'Plano del preventivo', 'Actividad por unidad', 'Utilización de los recursos', 'Avisos al cierre', 'Incidencias detectadas', 'Cronología',
    'Fiabilidad de los datos y limitaciones', 'Huella SHA-256 del registro de operaciones', 'Registros diferidos', 'Recibida en el servidor', 'Corrección autorizada tras reapertura'])
    assert.ok(plano.includes(W(s)), 'falta: ' + s);
  assert.match(plano, /(?:-?[\d.]+ ){6}c /, 'unidades dibujadas como círculos en el plano');
  assert.ok(plano.includes(W('Incorporación de unidad')) || plano.includes(W('Alta de unidad')), 'la cronología incluye la incorporación de unidades');
});

test('cambios posteriores a una versión: no cuentan el registro del informe ni el archivado', async () => {
  const { registrosInforme } = await import('../../src/core/fiabilidad.js');
  const d = finalizado(); // finalizado y archivado
  const n = registrosInforme(d.engine.ops);
  assert.equal(n, d.engine.ops.length - 1, 'el archivado al finalizar no cuenta');
  d.run(C.informeRegistrar, { accion: 'consultar', n: 1, formato: 'pdf' });
  d.run(C.prevArchivar, false); d.run(C.prevArchivar, true);
  assert.equal(registrosInforme(d.engine.ops), n, 'consultar o archivar no son cambios para el informe');
});

test('huella del registro de operaciones: la misma para los mismos registros, en cualquier orden y sin datos locales', async () => {
  const { huellaRegistro } = await import('../../src/core/fiabilidad.js');
  const d = finalizado(); const ops = d.engine.ops;
  const h = await huellaRegistro(ops);
  assert.match(h, /^[0-9a-f]{64}$/);
  const desordenadas = [...ops].reverse().map(o => ({ ...o, sq: 99, num: 7, rx: 1, sy: 2, ps: 1 }));
  assert.equal(await huellaRegistro(desordenadas), h, 'no dependen del orden de llegada ni de metadatos de este dispositivo');
  d.run(C.informeRegistrar, { accion: 'consultar', n: 1, formato: 'pdf' });
  assert.equal(await huellaRegistro(d.engine.ops), h, 'consultar el informe no cambia la huella');
  const cambiado = ops.map((o, i) => (i === 3 ? { ...o, x: { ...o.x, manipulado: true } } : o));
  assert.notEqual(await huellaRegistro(cambiado), h, 'cualquier cambio en un registro cambia la huella');
});
