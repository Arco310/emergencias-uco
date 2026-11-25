// 1.5.0 · Libro Excel (XLSX) propio, sin librerías: estructura Office Open XML mínima y válida.
import test from 'node:test';
import assert from 'node:assert/strict';
import { xlsxLibro, nombreHoja } from '../../src/core/xlsx.js';
import { crc32 } from '../../src/core/zip.js';

/** Lee un ZIP sin compresión (como los que genera la aplicación) */
function leerZip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength); const out = {}; let p = 0; const td = new TextDecoder();
  while (dv.getUint32(p, true) === 0x04034b50) {
    assert.equal(dv.getUint16(p + 8, true), 0, 'sin compresión');
    const crc = dv.getUint32(p + 14, true); const size = dv.getUint32(p + 18, true); const nl = dv.getUint16(p + 26, true); const xl = dv.getUint16(p + 28, true);
    const name = td.decode(bytes.subarray(p + 30, p + 30 + nl)); const data = bytes.subarray(p + 30 + nl + xl, p + 30 + nl + xl + size);
    assert.equal(crc32(data), crc, 'CRC de ' + name);
    out[name] = td.decode(data); p += 30 + nl + xl + size;
  }
  return out;
}

test('libro XLSX: partes obligatorias, una hoja por tabla, textos y números con su tipo', () => {
  const z = leerZip(xlsxLibro([
    { nombre: 'Unidades', cabecera: ['Identificador', 'Avisos', 'Nota'], filas: [['SVB-1', 3, 'A & B <ok>'], ['SVA-1', 0, '  espacios  '], ['VIR', null, 'línea\u0001rara']] },
    { nombre: 'Avisos', cabecera: ['Nº'], filas: [[12.5]] },
  ], { titulo: 'Informe «Concierto»', autor: 'Ana' }));
  for (const f of ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml', 'docProps/core.xml']) assert.ok(z[f], f);
  assert.match(z['[Content_Types].xml'], /worksheets\/sheet2\.xml" ContentType="application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.worksheet\+xml"/);
  assert.match(z['xl/workbook.xml'], /<sheet name="Unidades" sheetId="1" r:id="rId1"\/><sheet name="Avisos" sheetId="2" r:id="rId2"\/>/);
  const h = z['xl/worksheets/sheet1.xml'];
  assert.match(h, /<c r="A1" t="inlineStr" s="1"><is><t>Identificador<\/t><\/is><\/c>/, 'cabecera en negrita');
  assert.match(h, /<c r="B2"><v>3<\/v><\/c>/, 'número como número');
  assert.match(h, /<t>A &amp; B &lt;ok&gt;<\/t>/, 'texto escapado');
  assert.match(h, /<t xml:space="preserve">  espacios  <\/t>/);
  assert.match(h, /<t>línearara<\/t>/, 'caracteres de control fuera');
  assert.doesNotMatch(h, /r="B4"/, 'celda vacía omitida');
  assert.match(h, /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/, 'cabecera fija');
  assert.match(h, /<autoFilter ref="A1:C4"\/>/);
  assert.match(z['xl/worksheets/sheet2.xml'], /<v>12.5<\/v>/);
  assert.match(z['docProps/core.xml'], /<dc:title>Informe «Concierto»<\/dc:title>/);
});

test('nombres de hoja válidos para Excel: sin caracteres prohibidos, 31 caracteres como máximo y sin repetir', () => {
  const usados = new Set();
  assert.equal(nombreHoja('Avisos/tipo: [raro]*?', usados), 'Avisos tipo raro');
  assert.equal(nombreHoja('Avisos tipo raro', usados), 'Avisos tipo raro (2)');
  const largo = nombreHoja('x'.repeat(40), usados); assert.equal(largo.length, 31);
  assert.equal(nombreHoja('', usados), 'Hoja');
  assert.equal(nombreHoja("'Historial'", usados), 'Historial');
});

test('preventivo en Excel: resumen, las mismas tablas que el CSV y las horas de cada registro', async () => {
  const { Device, createPrev, unitByInd, C } = await import('./helpers.mjs');
  const { prevXLSX, tablasDatos } = await import('../../src/core/exporters.js');
  const d = new Device({ pid: 'prev_x' }); createPrev(d, { nombre: 'Concierto' });
  d.run(C.unitCreate, { ind: 'SVB-1', tipo: 'rt_svb', sector: 'sec_1' });
  d.run(C.avisoCreate, { tipo: d.s.prev.cat.tiposAviso[0].id, desc: 'Caída' }, { unidades: [unitByInd(d, 'SVB-1').id] });
  const op = d.engine.ops[d.engine.ops.length - 1];
  const meta = new Map([[op.id, { rx: op.t + 5 * 60000, sy: op.t + 5 * 60000 + 3000 }]]);
  const z = leerZip(prevXLSX(d.engine, { usuario: 'Ana', dispositivo: 'Tablet', meta, compartido: true }));
  const nombres = [...z['xl/workbook.xml'].matchAll(/<sheet name="([^"]+)"/g)].map(m => m[1]);
  assert.deepEqual(nombres.slice(0, 2), ['Resumen', 'Unidades']);
  for (const n of ['Avisos', 'Tiempos por clave', 'Bitácora', 'Horas de registro']) assert.ok(nombres.includes(n), n);
  assert.equal(nombres.length, 2 + Object.keys(tablasDatos(d.engine)).length);
  const u = z['xl/worksheets/sheet2.xml']; assert.match(u, /<t>SVB-1<\/t>/);
  const horas = z['xl/worksheets/sheet' + (nombres.indexOf('Horas de registro') + 1) + '.xml'];
  assert.match(horas, /Hora declarada por el dispositivo/); assert.match(horas, /Recibida en el servidor/); assert.match(horas, /Sincronizada en este dispositivo/);
  assert.match(horas, /<v>5<\/v>/, 'diferencia de 5 min entre la hora declarada y la recepción');
});
