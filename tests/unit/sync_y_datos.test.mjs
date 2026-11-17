// Pruebas de convergencia multidispositivo, conflictos, plantillas, estadísticas,
// exportaciones, PDF, cifrado y sugerencias.
import test from 'node:test';
import { inflateSync } from 'node:zlib';
import assert from 'node:assert/strict';
import { Device, createPrev, unitByInd, makeClock, mkUser, C, MIN, T0 } from './helpers.mjs';
import { Engine, isResting } from '../../src/core/engine.js';
import { HLC } from '../../src/core/hlc.js';
import { stableStringify, clone } from '../../src/core/util.js';
import { newTemplate, contentFromPrev, seedFromTemplate, exportTemplate, importTemplate } from '../../src/core/templates.js';
import { unitStats, avisoTimes, prevStats, avisoStats } from '../../src/core/stats.js';
import { csvTables, prevJSON, toCSV, csvZip } from '../../src/core/exporters.js';
import { buildReport } from '../../src/core/report.js';
import { suggestUnits } from '../../src/core/suggest.js';
import { logEntries, unitChronology } from '../../src/core/timeline.js';
import * as K from '../../src/core/crypto.js';
import { crc32 } from '../../src/core/zip.js';
import { parseCoords, haversineKm } from '../../src/core/geo.js';
import { toWinAnsi } from '../../src/core/pdf.js';

function pair() {
  const clock = makeClock();
  const A = new Device({ id: 'devA', code: 'A', mode: 'compartida', clock, user: mkUser('rol_admin', 'Ana') });
  const B = new Device({ id: 'devB', code: 'B', mode: 'compartida', clock, user: mkUser('rol_operador', 'Benito') });
  createPrev(A, { unidades: [{ ind: 'U1', nombre: 'Uno' }, { ind: 'U2', nombre: 'Dos' }, { ind: 'U3' }] });
  B.receive(A.store);
  return { clock, A, B };
}
const snapshot = d => stableStringify({ units: d.s.units, avisos: d.s.avisos, prev: d.s.prev, conflicts: d.s.conflicts });

test('multidispositivo: el mismo conjunto de operaciones produce el mismo estado en cualquier orden', () => {
  const { clock, A, B } = pair();
  const u1 = unitByInd(A, 'U1'), u2 = unitByInd(A, 'U2');
  // Ambos trabajan sin conexión
  clock.advance(MIN);
  const opsA = [...A.run(C.avisoCreate, { desc: 'Aviso de A' }), ...A.run(C.unitClave, u1.id, 'CESP', { motivo: 'Repostaje' })];
  const opsB = [...B.run(C.avisoCreate, { desc: 'Aviso de B' }), ...B.run(C.unitRest, u2.id)];
  clock.advance(MIN);
  // Reconexión: cada uno recibe lo del otro (B también recibe duplicados)
  A.receive(opsB); B.receive(opsA); B.receive(opsA);
  assert.equal(snapshot(A), snapshot(B), 'estados idénticos tras sincronizar');
  assert.equal(Object.keys(A.s.avisos).length, 2, 'sin duplicados ni pérdidas');
  // Un tercer dispositivo que recibe todo en orden inverso converge igual
  const Cdev = new Device({ id: 'devC', code: 'C', mode: 'compartida', clock });
  Cdev.receive([...A.store, ...opsB].reverse());
  assert.equal(snapshot(Cdev), snapshot(A));
  // Referencias provisionales distintas por dispositivo
  const refs = Object.values(A.s.avisos).map(a => a.ref).sort();
  assert.deepEqual(refs, ['A-1', 'B-1']);
});

test('multidispositivo: modificaciones simultáneas generan conflicto (no gana la última escritura)', () => {
  const { clock, A, B } = pair();
  const u1 = unitByInd(A, 'U1');
  clock.advance(MIN);
  const a = A.run(C.unitUpdate, u1.id, { nombre: 'Nombre A' });
  clock.advance(1000);
  const b = B.run(C.unitUpdate, u1.id, { nombre: 'Nombre B' });
  A.receive(b); B.receive(a);
  assert.equal(snapshot(A), snapshot(B));
  assert.equal(A.s.units[u1.id].nombre, 'Nombre A', 'se mantiene el primer cambio aplicado');
  const conf = A.engine.pendingConflicts();
  assert.equal(conf.length, 1);
  assert.equal(conf[0].tipo, 'campos');
  assert.equal(conf[0].detalle[0].propuesto, 'Nombre B');
  // Un operador no puede resolver; el administrador sí
  assert.throws(() => B.run(C.resolverConflicto, conf[0].id, 'aceptar'), /permiso/);
  const r = A.run(C.resolverConflicto, conf[0].id, 'aceptar');
  B.receive(r);
  assert.equal(A.s.units[u1.id].nombre, 'Nombre B');
  assert.equal(snapshot(A), snapshot(B));
  assert.equal(A.engine.pendingConflicts().length, 0);
});

test('multidispositivo: asignación y descanso simultáneos sobre la misma unidad', () => {
  const { clock, A, B } = pair();
  const u3 = unitByInd(A, 'U3');
  clock.advance(MIN);
  const av = A.run(C.avisoCreate, { desc: 'urgente' });
  B.receive(av);
  clock.advance(1000);
  const asg = A.run(C.avisoAsignar, av[0].e, u3.id);
  clock.advance(1000);
  const rest = B.run(C.unitRest, u3.id); // B no sabe que está asignada
  A.receive(rest); B.receive(asg);
  assert.equal(snapshot(A), snapshot(B));
  assert.equal(A.s.units[u3.id].aviso, av[0].e, 'la asignación (anterior) prevalece');
  assert.equal(isResting(A.s.units[u3.id], clock.now()), false, 'el descanso con aviso activo no se aplica');
  const c = A.engine.pendingConflicts();
  assert.equal(c.length, 1);
  assert.match(c[0].motivo, /aviso activo/);
  // Descartar el conflicto queda registrado
  A.run(C.resolverConflicto, c[0].id, 'descartar');
  assert.equal(A.s.conflicts[c[0].id].estado, 'descartado');
  assert.equal(A.s.conflicts[c[0].id].resueltoPor, 'Ana');
});

test('numeración del servidor: números definitivos únicos aunque se creen a la vez', () => {
  const { clock, A, B } = pair();
  clock.advance(MIN);
  const a = A.run(C.avisoCreate, { desc: 'a' }); const b = B.run(C.avisoCreate, { desc: 'b' });
  assert.ok(a[0].nn && b[0].nn);
  // El servidor numera por orden de llegada
  A.receive(b); B.receive(a);
  let n = 0; for (const op of [b[0], a[0]]) { n++; A.engine.setNumber(op.id, n); B.engine.setNumber(op.id, n); }
  assert.equal(snapshot(A), snapshot(B));
  const nums = Object.values(A.s.avisos).map(x => x.num).sort();
  assert.deepEqual(nums, [1, 2]);
});

test('HLC: orden total y monotonía con relojes desfasados', () => {
  let tA = 1000, tB = 500;
  const a = new HLC('A', () => tA), b = new HLC('B', () => tB);
  const h1 = a.tick(); b.recv(h1); const h2 = b.tick();
  assert.ok(h2 > h1, 'un evento causalmente posterior ordena después aunque su reloj esté atrasado');
  const h3 = a.tick(); assert.ok(h3 > h1);
});

test('plantillas: copia independiente, sin identificadores ni datos operativos', () => {
  const { clock, A } = pair();
  const u1 = unitByInd(A, 'U1');
  A.run(C.unitColor, u1.id, '#AA0000');
  A.run(C.unitPlan, u1.id, { x: 0.25, y: 0.5 });
  A.run(C.avisoCreate, { desc: 'no debe copiarse' });
  const tpl = newTemplate({ nombre: 'Concierto', contenido: contentFromPrev(A.s) });
  assert.equal(tpl.contenido.unidades.length, 3);
  assert.ok(!('id' in tpl.contenido.unidades[0]));
  assert.equal(tpl.contenido.unidades.find(u => u.ind === 'U1').plan.x, 0.25);
  // Crear preventivo desde la plantilla
  const D = new Device({ id: 'devD', pid: 'prev_2', clock });
  const seed = seedFromTemplate(tpl);
  D.run(C.prevCreate, { datos: { nombre: 'Concierto 2', modalidad: 'independiente', activar: true }, cat: seed.cat, cfg: seed.cfg, unidades: seed.unidades, origen: seed.origen });
  assert.equal(Object.keys(D.s.avisos).length, 0, 'no se copian avisos');
  const nu = unitByInd(D, 'U1');
  assert.notEqual(nu.id, u1.id, 'identificadores nuevos');
  assert.equal(nu.colorC0, '#AA0000');
  assert.equal(nu.hc.length, 1, 'sin historial copiado');
  assert.equal(D.s.prev.origen.nombre, 'Concierto');
  // Modificar la plantilla después no cambia el preventivo creado
  tpl.contenido.cat.sectores.push({ id: 'sec_x', nombre: 'Nuevo' });
  tpl.contenido.unidades[0].nombre = 'Cambiado';
  assert.equal(D.s.prev.cat.sectores.find(s => s.id === 'sec_x'), undefined);
  assert.notEqual(unitByInd(D, tpl.contenido.unidades[0].ind).nombre, 'Cambiado');
  // Exportar / importar
  const imp = importTemplate(JSON.parse(JSON.stringify(exportTemplate(tpl))));
  assert.notEqual(imp.id, tpl.id);
  assert.equal(imp.contenido.unidades.length, 3);
});

test('estadísticas: tiempos verificados con datos conocidos', () => {
  const clock = makeClock();
  const d = new Device({ clock });
  createPrev(d, { unidades: [{ ind: 'X1' }, { ind: 'X2' }] });
  const x1 = unitByInd(d, 'X1'), x2 = unitByInd(d, 'X2');
  const t0 = clock.now();
  const [av] = d.run(C.avisoCreate, { desc: 'Prueba' });             // 08:00
  clock.advance(2 * MIN); d.run(C.avisoAsignar, av.e, x1.id);       // 08:02 asignación (C1)
  clock.advance(1 * MIN); d.run(C.unitClave, x1.id, 'C2');           // 08:03 en ruta
  clock.advance(7 * MIN); d.run(C.unitClave, x1.id, 'C3');           // 08:10 en el punto
  clock.advance(20 * MIN); d.run(C.unitClave, x1.id, 'C4');          // 08:30 traslado
  clock.advance(15 * MIN); d.run(C.unitClave, x1.id, 'C5');          // 08:45 hospital
  clock.advance(15 * MIN); d.run(C.unitClave, x1.id, 'C0');          // 09:00 disponible
  d.run(C.avisoFinalizar, av.e, {});                                  // 09:00 finalizado
  d.run(C.unitRest, x2.id);                                           // 09:00 descanso 30'
  clock.advance(60 * MIN);                                            // 10:00
  const tm = avisoTimes(d.s.avisos[av.e]);
  assert.equal(tm.asignacion, 2 * MIN);
  assert.equal(tm.respuesta, 10 * MIN);
  assert.equal(tm.intervencion, 20 * MIN);
  assert.equal(tm.resolucion, 60 * MIN);
  const st = unitStats(d.s, d.s.units[x1.id], clock.now());
  assert.equal(st.porClave.C1, 1 * MIN);
  assert.equal(st.porClave.C2, 7 * MIN);
  assert.equal(st.porClave.C3, 20 * MIN);
  assert.equal(st.porClave.C4, 15 * MIN);
  assert.equal(st.porClave.C5, 15 * MIN);
  assert.equal(st.porClave.C0, 2 * MIN + 60 * MIN);
  assert.equal(st.servicio, 120 * MIN);
  assert.equal(st.nAvisos, 1);
  assert.equal(st.enAvisos, 58 * MIN);
  assert.equal(st.cambiosClave, 6);
  const s2 = unitStats(d.s, d.s.units[x2.id], clock.now());
  assert.equal(s2.nDescansos, 1);
  assert.equal(s2.enDescanso, 30 * MIN);
  // Sin datos: no se calcula
  const [av2] = d.run(C.avisoCreate, { desc: 'sin datos' });
  const t2 = avisoTimes(d.s.avisos[av2.e]);
  assert.equal(t2.respuesta, null);
  const agg = avisoStats(d.s);
  assert.equal(agg.tiempos.respuesta.n, 1);
  assert.equal(agg.sinDatos.respuesta, 1);
  const ps = prevStats(d.s, clock.now());
  assert.equal(ps.avisos.total, 2);
  assert.equal(ps.descansos.total, 1);
  assert.equal(t0 >= T0, true);
  // Cronología de la unidad con duraciones
  const cr = unitChronology(d.engine, x1.id, clock.now());
  const c3 = cr.find(e => e.tipo === 'clave' && /C3/.test(e.texto));
  assert.equal(c3.dur, 20 * MIN);
});

test('exportación: CSV, JSON, ZIP y PDF con contenido real', async () => {
  const { clock, A } = pair();
  const u1 = unitByInd(A, 'U1');
  A.run(C.unitUpdate, u1.id, { obs: 'Texto; con "comillas"\ny salto' });
  const [av] = A.run(C.avisoCreate, { desc: 'Caída en grada', loc: { txt: 'Grada Norte', lat: 40.4168, lon: -3.7038 } });
  A.run(C.avisoAsignar, av.e, u1.id);
  clock.advance(5 * MIN);
  const T = csvTables(A.engine, clock.now());
  assert.ok(T.unidades.startsWith('﻿Identificador;'));
  assert.ok(T.unidades.includes('"Texto; con ""comillas""\ny salto"'));
  assert.ok(T.avisos.includes('Caída en grada'));
  assert.ok(T.bitacora.includes('Asignación de unidad'));
  assert.equal(toCSV(['a'], [['x;y']]), '﻿a\r\n"x;y"\r\n');
  const j = prevJSON(A.engine, { usuario: 'Ana' });
  assert.equal(j.formato, 'uco-preventivo');
  assert.equal(j.avisos.length, 1);
  assert.equal(j.operaciones.length, A.engine.ops.length);
  const e2 = new Engine(j.operaciones.map(({ estado, ...o }) => o));
  assert.equal(stableStringify(e2.state.units), stableStringify(A.s.units), 'el JSON permite reconstruir el preventivo');
  const z = csvZip(A.engine, clock.now());
  assert.equal(z[0], 0x50); assert.equal(z[1], 0x4B);
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xCBF43926);
  const pdf = await buildReport(A.engine, { usuario: 'Ana' });
  const txt = Buffer.from(pdf).toString('latin1');
  assert.ok(txt.startsWith('%PDF-1.4'));
  assert.ok(txt.trimEnd().endsWith('%%EOF'));
  assert.match(txt, /\/Type \/Page /);
  // El contenido de las páginas va comprimido (FlateDecode): se descomprime para comprobar el texto
  const streams = [...txt.matchAll(/<< \/Length (\d+) \/Filter \/FlateDecode >>\nstream\n/g)];
  assert.ok(streams.length >= 1, 'páginas comprimidas');
  const plano = streams.map(m => { const ini = m.index + m[0].length; const n = Number(m[1]);
    assert.equal(txt.slice(ini + n, ini + n + 10), '\nendstream', 'longitud declarada exacta');
    return inflateSync(Buffer.from(txt.slice(ini, ini + n), 'latin1')).toString('latin1'); }).join('\n');
  assert.ok(plano.includes('(Informe del preventivo)'));
  assert.ok(plano.includes('Ca\\355da en grada'), 'texto en español codificado en WinAnsi');
  const xref = Number(txt.match(/startxref\n(\d+)/)[1]);
  assert.equal(txt.slice(xref, xref + 4), 'xref', 'tabla xref en la posición declarada');
  assert.deepEqual(toWinAnsi('ñ€→'), [0xF1, 0x80, 45, 62]);
});

test('cifrado: claves envueltas, contraseña incorrecta, sellado y claves de preventivo', async () => {
  const dek = await K.genDek();
  const w = await K.wrapDek(dek, 'Secreta123', 1000);
  const back = await K.unwrapDek(w, 'Secreta123');
  const rec = await K.encryptJSON(back, { a: 1, txt: 'ñ' });
  assert.deepEqual(await K.decryptJSON(dek, rec), { a: 1, txt: 'ñ' });
  await assert.rejects(() => K.unwrapDek(w, 'otra'));
  const secret = new Uint8Array(16).fill(7);
  const k1 = await K.prevKeys(secret), k2 = await K.prevKeys(secret);
  assert.equal(k1.token, k2.token);
  assert.equal(k1.tokenHash, await K.sha256hex(k1.token));
  const sealed = await K.seal(k1.key, { hola: 'mundo' });
  assert.deepEqual(await K.open(k2.key, sealed), { hola: 'mundo' });
  const code = K.newRecoveryCode();
  assert.match(code, /^[0-9A-Z]{5}(-[0-9A-Z]{5}){5}$/);
});

test('sugerencias: prioriza cercanía, compatibilidad y sector; excluye descanso y ocupadas', () => {
  const clock = makeClock();
  const d = new Device({ clock });
  createPrev(d, { unidades: [
    { ind: 'CERCA', tipo: 'rt_svb', sector: 'sec_1', loc: { txt: 'a', lat: 40.0, lon: -3.0 } },
    { ind: 'LEJOS', tipo: 'rt_svb', sector: 'sec_1', loc: { txt: 'b', lat: 40.2, lon: -3.0 } },
    { ind: 'INCOMP', tipo: 'rt_log', sector: 'sec_1', loc: { txt: 'c', lat: 40.0, lon: -3.0001 } },
    { ind: 'DESC', tipo: 'rt_svb', sector: 'sec_1', loc: { txt: 'd', lat: 40.0, lon: -3.0 } },
  ] });
  d.run(C.unitRest, unitByInd(d, 'DESC').id);
  const [av] = d.run(C.avisoCreate, { tipo: 'ta_tras', desc: 'Traslado', sector: 'sec_1', loc: { txt: 'x', lat: 40.0005, lon: -3.0 } });
  const sug = suggestUnits(d.s, d.s.avisos[av.e], clock.now());
  assert.equal(sug[0].u.ind, 'CERCA');
  assert.equal(sug[sug.length - 1].u.ind, 'DESC');
  assert.match(sug[sug.length - 1].blocked, /descanso/);
  assert.ok(sug.findIndex(x => x.u.ind === 'INCOMP') > sug.findIndex(x => x.u.ind === 'LEJOS'), 'incompatible por detrás');
  assert.throws(() => d.run(C.avisoAsignar, av.e, unitByInd(d, 'INCOMP').id), /no es compatible/);
  d.run(C.avisoAsignar, av.e, unitByInd(d, 'INCOMP').id, { forzarIncompatible: true });
});

test('geo: coordenadas desde enlaces de Google Maps y distancias', () => {
  assert.deepEqual(parseCoords('https://www.google.com/maps/place/X/@37.8847,-4.7792,17z'), { lat: 37.8847, lon: -4.7792 });
  assert.deepEqual(parseCoords('37.88, -4.77'), { lat: 37.88, lon: -4.77 });
  assert.deepEqual(parseCoords('https://maps.google.com/?q=37.1,-4.2'), { lat: 37.1, lon: -4.2 });
  assert.equal(parseCoords('Calle Mayor'), null);
  assert.ok(Math.abs(haversineKm(40, -3, 41, -3) - 111.2) < 0.5);
});

test('bitácora: registra usuario, elemento, acción, valor anterior y nuevo', () => {
  const { A } = pair();
  const u1 = unitByInd(A, 'U1');
  A.run(C.unitClave, u1.id, 'CESP', { motivo: 'Avituallamiento' });
  const e = logEntries(A.engine, { entidad: u1.id }).find(x => x.k === 'unit.clave');
  assert.equal(e.usuario, 'Ana');
  assert.equal(e.elemento, 'Unidad U1');
  assert.equal(e.anterior, 'C0 Disponible');
  assert.match(e.nuevo, /CESP Clave especial · Motivo: Avituallamiento/);
});

test('geo: mapas incrustables sin clave (Google y OpenStreetMap)', async () => {
  const { googleEmbedUrl, osmEmbedUrl, embedUrl, googleMapsUrl } = await import('../../src/core/geo.js');
  const loc = { txt: 'Plaza de las Tendillas, Córdoba', lat: 37.8847, lon: -4.7792 };
  assert.equal(googleEmbedUrl(loc), 'https://maps.google.com/maps?q=37.8847%2C-4.7792&z=16&output=embed');
  assert.equal(googleEmbedUrl({ txt: 'Calle Mayor 1' }), 'https://maps.google.com/maps?q=Calle%20Mayor%201&z=16&output=embed');
  assert.match(osmEmbedUrl(loc), /^https:\/\/www\.openstreetmap\.org\/export\/embed\.html\?bbox=-4\.783200%2C37\.880700%2C-4\.775200%2C37\.888700&layer=mapnik&marker=37\.884700%2C-4\.779200$/);
  assert.equal(osmEmbedUrl({ txt: 'sin coordenadas' }), '');
  assert.equal(embedUrl({ txt: 'x' }, 'osm'), googleEmbedUrl({ txt: 'x' }), 'sin coordenadas se usa Google');
  assert.equal(googleMapsUrl(loc), 'https://www.google.com/maps/search/?api=1&query=37.8847%2C-4.7792');
});
