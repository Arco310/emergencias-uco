// Libro de Excel (XLSX, Office Open XML) generado en el dispositivo, sin librerías ni Internet (1.5.0).
// Estructura mínima y válida: una hoja por tabla, textos en línea («inlineStr»), números como números,
// cabecera en negrita fija y con filtro. Se empaqueta con el mismo ZIP sin compresión de las demás exportaciones.
import { zipStore } from './zip.js';

const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
const NS_MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const NS_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
const NS_PKG = 'http://schemas.openxmlformats.org/package/2006/relationships';

/** Texto apto para XML: escapado y sin caracteres de control no admitidos */
function x(v) {
  return String(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
/** Letra(s) de columna: 0 → A, 26 → AA */
function col(i) { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; }

/** Nombre de hoja admitido por Excel: sin []:*?/\, sin comillas al principio o al final, ≤ 31 caracteres y único */
export function nombreHoja(nombre, usados = new Set()) {
  let n = String(nombre || '').replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim().replace(/^'+|'+$/g, '').trim() || 'Hoja';
  n = n.slice(0, 31).trim();
  let r = n; let k = 2;
  while (usados.has(r.toLowerCase())) { const suf = ' (' + k++ + ')'; r = n.slice(0, 31 - suf.length).trim() + suf; }
  usados.add(r.toLowerCase());
  return r;
}

function celda(ref, v, estilo = 0) {
  if (v == null || v === '') return '';
  const s = estilo ? ' s="' + estilo + '"' : '';
  if (typeof v === 'number' && Number.isFinite(v)) return '<c r="' + ref + '"' + s + '><v>' + v + '</v></c>';
  if (typeof v === 'boolean') return '<c r="' + ref + '" t="b"' + s + '><v>' + (v ? 1 : 0) + '</v></c>';
  const t = x(v);
  const pre = /^\s|\s$/.test(t) ? ' xml:space="preserve"' : '';
  return '<c r="' + ref + '" t="inlineStr"' + s + '><is><t' + pre + '>' + t + '</t></is></c>';
}

function hoja({ cabecera = [], filas = [] }) {
  const ncol = Math.max(cabecera.length, ...filas.map(f => f.length), 1);
  // Anchos aproximados por contenido (entre 8 y 60 caracteres)
  const anchos = Array.from({ length: ncol }, (_, i) => {
    let w = String(cabecera[i] ?? '').length;
    for (const f of filas.slice(0, 500)) w = Math.max(w, String(f[i] ?? '').length);
    return Math.min(60, Math.max(8, w + 2));
  });
  const rows = [];
  rows.push('<row r="1">' + cabecera.map((v, i) => celda(col(i) + '1', v, 1)).join('') + '</row>');
  filas.forEach((f, j) => { const r = j + 2; rows.push('<row r="' + r + '">' + f.map((v, i) => celda(col(i) + r, v)).join('') + '</row>'); });
  const ultima = col(ncol - 1) + (filas.length + 1);
  return XML + '<worksheet xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '">'
    + '<dimension ref="A1:' + ultima + '"/>'
    + '<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'
    + '<sheetFormatPr defaultRowHeight="15"/>'
    + '<cols>' + anchos.map((w, i) => '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + w + '" customWidth="1"/>').join('') + '</cols>'
    + '<sheetData>' + rows.join('') + '</sheetData>'
    + (cabecera.length ? '<autoFilter ref="A1:' + ultima + '"/>' : '')
    + '</worksheet>';
}

const ESTILOS = XML + '<styleSheet xmlns="' + NS_MAIN + '">'
  + '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
  + '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
  + '<fill><patternFill patternType="solid"><fgColor rgb="FFECEFF1"/><bgColor indexed="64"/></patternFill></fill></fills>'
  + '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>'
  + '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>'
  + '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
  + '<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/></cellXfs>'
  + '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>'
  + '</styleSheet>';

/**
 * hojas: [{ nombre, cabecera: [..], filas: [[..], ..] }] → Uint8Array (.xlsx)
 * Los valores numéricos se guardan como números; el resto, como texto.
 */
export function xlsxLibro(hojas, { titulo = '', autor = '', fecha = new Date() } = {}) {
  const usados = new Set();
  const hs = hojas.map((h, i) => ({ ...h, nombre: nombreHoja(h.nombre, usados), n: i + 1 }));
  const iso = (fecha instanceof Date ? fecha : new Date(fecha)).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const files = [
    { name: '[Content_Types].xml', data: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + hs.map(h => '<Override PartName="/xl/worksheets/sheet' + h.n + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('')
      + '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
      + '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>'
      + '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'
      + '</Types>' },
    { name: '_rels/.rels', data: XML + '<Relationships xmlns="' + NS_PKG + '">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
      + '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>'
      + '</Relationships>' },
    { name: 'docProps/core.xml', data: XML + '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">'
      + '<dc:title>' + x(titulo) + '</dc:title><dc:creator>' + x(autor) + '</dc:creator>'
      + '<dcterms:created xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">' + iso + '</dcterms:modified>'
      + '</cp:coreProperties>' },
    { name: 'docProps/app.xml', data: XML + '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Gestor de Emergencias UCO</Application></Properties>' },
    { name: 'xl/workbook.xml', data: XML + '<workbook xmlns="' + NS_MAIN + '" xmlns:r="' + NS_REL + '"><bookViews><workbookView/></bookViews><sheets>'
      + hs.map(h => '<sheet name="' + x(h.nombre) + '" sheetId="' + h.n + '" r:id="rId' + h.n + '"/>').join('') + '</sheets>'
      + (hs.some(h => (h.cabecera || []).length) ? '<definedNames>' + hs.filter(h => (h.cabecera || []).length).map(h => {
        const ncol = Math.max(h.cabecera.length, ...(h.filas || []).map(f => f.length), 1);
        return '<definedName name="_xlnm._FilterDatabase" localSheetId="' + (h.n - 1) + '" hidden="1">\'' + x(h.nombre).replace(/'/g, "''") + '\'!$A$1:$' + col(ncol - 1) + '$' + ((h.filas || []).length + 1) + '</definedName>';
      }).join('') + '</definedNames>' : '')
      + '</workbook>' },
    { name: 'xl/_rels/workbook.xml.rels', data: XML + '<Relationships xmlns="' + NS_PKG + '">'
      + hs.map(h => '<Relationship Id="rId' + h.n + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + h.n + '.xml"/>').join('')
      + '<Relationship Id="rId' + (hs.length + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
      + '</Relationships>' },
    { name: 'xl/styles.xml', data: ESTILOS },
    ...hs.map(h => ({ name: 'xl/worksheets/sheet' + h.n + '.xml', data: hoja(h) })),
  ];
  return zipStore(files, fecha instanceof Date ? fecha : new Date(fecha));
}
