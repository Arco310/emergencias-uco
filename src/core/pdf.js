// Generador de PDF propio (PDF 1.4, Helvetica estándar, codificación WinAnsi).
// Funciona sin Internet y sin librerías. Maqueta en flujo: títulos, párrafos,
// pares clave-valor, tablas con salto de página y gráficos de barras sencillos.
import { HELV, HELV_B } from './fontmetrics.js';
import { enc } from './util.js';

const WIN = { 0x20AC: 0x80, 0x201A: 0x82, 0x0192: 0x83, 0x201E: 0x84, 0x2026: 0x85, 0x2020: 0x86, 0x2021: 0x87, 0x02C6: 0x88, 0x2030: 0x89, 0x0160: 0x8A, 0x2039: 0x8B, 0x0152: 0x8C, 0x017D: 0x8E, 0x2018: 0x91, 0x2019: 0x92, 0x201C: 0x93, 0x201D: 0x94, 0x2022: 0x95, 0x2013: 0x96, 0x2014: 0x97, 0x02DC: 0x98, 0x2122: 0x99, 0x0161: 0x9A, 0x203A: 0x9B, 0x0153: 0x9C, 0x017E: 0x9E, 0x0178: 0x9F };
const SUBST = { '→': '->', '←': '<-', '≥': '>=', '≤': '<=', '✓': 'Sí', '✗': 'No', '⚠': '!', '\t': ' ' };

/** Convierte texto Unicode a códigos WinAnsi (los no representables se sustituyen) */
export function toWinAnsi(str) {
  const out = [];
  for (const ch of String(str ?? '')) {
    if (SUBST[ch]) { for (const c of SUBST[ch]) out.push(c.charCodeAt(0)); continue; }
    const cp = ch.codePointAt(0);
    if (cp === 10 || cp === 13) { out.push(32); continue; }
    if (cp >= 32 && cp < 127) out.push(cp);
    else if (cp >= 0xA0 && cp <= 0xFF) out.push(cp);
    else if (WIN[cp]) out.push(WIN[cp]);
    else out.push(63);
  }
  return out;
}
function pdfStr(codes) {
  let s = '(';
  for (const c of codes) {
    if (c === 40 || c === 41 || c === 92) s += '\\' + String.fromCharCode(c);
    else if (c < 32 || c > 126) s += '\\' + c.toString(8).padStart(3, '0');
    else s += String.fromCharCode(c);
  }
  return s + ')';
}
function rgb(hex) {
  const v = String(hex || '#000000').replace('#', '');
  return [0, 2, 4].map(i => (parseInt(v.slice(i, i + 2), 16) / 255).toFixed(3)).join(' ');
}
const n2 = x => (Math.round(x * 100) / 100).toString();

export class PDFDoc {
  constructor({ title = 'Informe', author = '', margin = 36, landscape = false } = {}) {
    this.W = landscape ? 841.89 : 595.28; this.H = landscape ? 595.28 : 841.89;
    this.m = margin; this.pages = []; this.title = title; this.author = author;
    this.footer = ''; this.addPage();
  }
  addPage() { this.cur = []; this.pages.push(this.cur); this.y = this.m; return this; }
  get width() { return this.W - 2 * this.m; }
  textWidth(str, size = 10, bold = false) {
    const t = bold ? HELV_B : HELV; let w = 0;
    for (const c of toWinAnsi(str)) w += c >= 32 ? (t[c - 32] || 500) : 500;
    return w * size / 1000;
  }
  wrap(str, width, size = 10, bold = false) {
    const lines = [];
    for (const para of String(str ?? '').split(/\n/)) {
      const words = para.split(/\s+/).filter(Boolean); let line = '';
      if (!words.length) { lines.push(''); continue; }
      for (let w of words) {
        while (this.textWidth(w, size, bold) > width && w.length > 1) {
          // palabra más ancha que la columna: se corta
          let k = w.length - 1; while (k > 1 && this.textWidth(w.slice(0, k), size, bold) > width) k--;
          if (line) { lines.push(line); line = ''; }
          lines.push(w.slice(0, k)); w = w.slice(k);
        }
        const test = line ? line + ' ' + w : w;
        if (this.textWidth(test, size, bold) <= width) line = test; else { if (line) lines.push(line); line = w; }
      }
      lines.push(line);
    }
    return lines;
  }
  // ---- primitivas (coordenadas desde arriba) ----
  text(x, y, str, { size = 10, bold = false, color = '#111111' } = {}) {
    this.cur.push('BT ' + rgb(color) + ' rg /' + (bold ? 'F2' : 'F1') + ' ' + n2(size) + ' Tf 1 0 0 1 ' + n2(x) + ' ' + n2(this.H - y - size * 0.8) + ' Tm ' + pdfStr(toWinAnsi(str)) + ' Tj ET');
  }
  rect(x, y, w, h, { fill = null, stroke = null, lw = 0.5 } = {}) {
    let s = '';
    if (fill) s += rgb(fill) + ' rg ';
    if (stroke) s += rgb(stroke) + ' RG ' + n2(lw) + ' w ';
    s += n2(x) + ' ' + n2(this.H - y - h) + ' ' + n2(w) + ' ' + n2(h) + ' re ' + (fill && stroke ? 'B' : fill ? 'f' : 'S');
    this.cur.push(s);
  }
  line(x1, y1, x2, y2, { color = '#999999', lw = 0.5 } = {}) {
    this.cur.push(rgb(color) + ' RG ' + n2(lw) + ' w ' + n2(x1) + ' ' + n2(this.H - y1) + ' m ' + n2(x2) + ' ' + n2(this.H - y2) + ' l S');
  }
  // ---- flujo ----
  ensure(h) { if (this.y + h > this.H - this.m - 18) { this.addPage(); return true; } return false; }
  space(h = 8) { this.y += h; }
  h1(str, color = '#B71C1C') { this.ensure(40); this.text(this.m, this.y, str, { size: 18, bold: true, color }); this.y += 26; }
  h2(str) {
    this.ensure(46); this.y += 6;
    this.text(this.m, this.y, str, { size: 13, bold: true, color: '#1A237E' });
    this.y += 17; this.line(this.m, this.y, this.W - this.m, this.y, { color: '#1A237E', lw: 0.8 }); this.y += 7;
  }
  para(str, { size = 9.5, color = '#222222', bold = false } = {}) {
    const lh = size * 1.35;
    for (const l of this.wrap(str, this.width, size, bold)) { this.ensure(lh); this.text(this.m, this.y, l, { size, color, bold }); this.y += lh; }
    this.y += 3;
  }
  kv(pairs, { cols = 2, size = 9.5 } = {}) {
    const colW = this.width / cols; const lh = size * 1.4;
    for (let i = 0; i < pairs.length; i += cols) {
      let rowH = lh;
      const cells = pairs.slice(i, i + cols).map(([k, v]) => {
        const kw = Math.min(colW * 0.45, this.textWidth(k + ': ', size, true) + 2);
        const lines = this.wrap(String(v ?? '—'), colW - kw - 8, size);
        rowH = Math.max(rowH, lines.length * lh); return { k, kw, lines };
      });
      this.ensure(rowH);
      cells.forEach((c, j) => {
        const x = this.m + j * colW;
        this.text(x, this.y, c.k + ':', { size, bold: true, color: '#444444' });
        c.lines.forEach((l, li) => this.text(x + c.kw, this.y + li * lh, l, { size }));
      });
      this.y += rowH + 2;
    }
    this.y += 4;
  }
  /** cols: [{ label, w (fracción), align }] rows: [[...]] */
  table(cols, rows, { size = 8, header = '#ECEFF1', zebra = '#FAFAFA', colorCol = null } = {}) {
    const total = cols.reduce((n, c) => n + (c.w || 1), 0);
    const widths = cols.map(c => (c.w || 1) / total * this.width);
    const lh = size * 1.3, pad = 3;
    const drawHeader = () => {
      const hl = cols.map((c, i) => this.wrap(c.label, widths[i] - 2 * pad, size, true));
      const hh = Math.max(...hl.map(l => l.length)) * lh + 2 * pad;
      this.ensure(hh + lh * 2);
      this.rect(this.m, this.y, this.width, hh, { fill: header });
      let x = this.m;
      hl.forEach((ls, i) => { ls.forEach((l, li) => this.text(x + pad, this.y + pad + li * lh, l, { size, bold: true, color: '#263238' })); x += widths[i]; });
      this.y += hh;
    };
    drawHeader();
    if (!rows.length) { this.text(this.m + pad, this.y + pad, 'Sin datos', { size, color: '#777777' }); this.y += lh + 2 * pad; return; }
    rows.forEach((r, ri) => {
      const cl = r.map((v, i) => this.wrap(v == null ? '' : String(v), widths[i] - 2 * pad, size));
      const rh = Math.max(...cl.map(l => l.length)) * lh + 2 * pad;
      if (this.ensure(rh)) drawHeader();
      if (ri % 2 && zebra) this.rect(this.m, this.y, this.width, rh, { fill: zebra });
      let x = this.m;
      cl.forEach((ls, i) => {
        if (colorCol && colorCol[i] && colorCol[i](ri)) this.rect(x + 1, this.y + 2, 4, rh - 4, { fill: colorCol[i](ri) });
        ls.forEach((l, li) => {
          const tw = this.textWidth(l, size);
          const tx = cols[i].align === 'right' ? x + widths[i] - pad - tw : x + pad + (colorCol && colorCol[i] ? 4 : 0);
          this.text(tx, this.y + pad + li * lh, l, { size });
        });
        x += widths[i];
      });
      this.line(this.m, this.y + rh, this.W - this.m, this.y + rh, { color: '#E0E0E0', lw: 0.3 });
      this.y += rh;
    });
    this.y += 8;
  }
  /** Gráfico de barras horizontal: items [{ label, value, color, text }] */
  bars(items, { size = 8.5, maxBars = 30, unit = '' } = {}) {
    const list = items.slice(0, maxBars); const lh = 13;
    const labelW = Math.min(this.width * 0.35, Math.max(60, ...list.map(i => this.textWidth(i.label, size) + 6)));
    const max = Math.max(1, ...list.map(i => i.value));
    const barW = this.width - labelW - 70;
    for (const it of list) {
      this.ensure(lh);
      this.text(this.m, this.y + 1, it.label, { size });
      const w = Math.max(0.5, (it.value / max) * barW);
      this.rect(this.m + labelW, this.y + 1, w, lh - 4, { fill: it.color || '#1E88E5' });
      this.text(this.m + labelW + w + 4, this.y + 1, it.text != null ? it.text : String(it.value) + unit, { size, color: '#333333' });
      this.y += lh;
    }
    this.y += 6;
  }
  /** Histograma vertical: values [{ label, value }] */
  columns(values, { h = 110, color = '#C62828', size = 7 } = {}) {
    this.ensure(h + 30);
    const n = Math.max(1, values.length), gap = 2, w = (this.width - 30) / n;
    const max = Math.max(1, ...values.map(v => v.value));
    const top = this.y, base = this.y + h;
    this.line(this.m + 28, base, this.W - this.m, base, { color: '#90A4AE' });
    this.text(this.m, top, String(max), { size, color: '#555555' });
    this.text(this.m, base - size, '0', { size, color: '#555555' });
    values.forEach((v, i) => {
      const bh = (v.value / max) * (h - 4); const x = this.m + 30 + i * w;
      if (bh > 0) this.rect(x + gap / 2, base - bh, Math.max(1, w - gap), bh, { fill: color });
      const every = Math.ceil(n / 12);
      if (i % every === 0) this.text(x, base + 3, v.label, { size, color: '#555555' });
    });
    this.y = base + 16;
  }
  build() {
    const total = this.pages.length;
    this.pages.forEach((p, i) => {
      const y = this.H - this.m + 6;
      p.push('BT 0.45 0.45 0.45 rg /F1 7.5 Tf 1 0 0 1 ' + n2(this.m) + ' ' + n2(this.H - y - 6) + ' Tm ' + pdfStr(toWinAnsi(this.footer || this.title)) + ' Tj ET');
      const pg = 'Página ' + (i + 1) + ' de ' + total;
      p.push('BT 0.45 0.45 0.45 rg /F1 7.5 Tf 1 0 0 1 ' + n2(this.W - this.m - this.textWidth(pg, 7.5)) + ' ' + n2(this.H - y - 6) + ' Tm ' + pdfStr(toWinAnsi(pg)) + ' Tj ET');
    });
    const objs = [];
    const add = s => { objs.push(s); return objs.length; };
    add('<< /Type /Catalog /Pages 2 0 R >>');
    add(null); // páginas (se rellena después)
    const f1 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
    const f2 = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
    const d = new Date(); const pd = x => String(x).padStart(2, '0');
    const date = 'D:' + d.getFullYear() + pd(d.getMonth() + 1) + pd(d.getDate()) + pd(d.getHours()) + pd(d.getMinutes()) + pd(d.getSeconds());
    const info = add('<< /Title ' + pdfStr(toWinAnsi(this.title)) + ' /Author ' + pdfStr(toWinAnsi(this.author)) + ' /Producer (Gestor de Emergencias UCO) /CreationDate (' + date + ') >>');
    const kids = [];
    for (const p of this.pages) {
      const content = p.join('\n');
      const c = add('<< /Length ' + content.length + ' >>\nstream\n' + content + '\nendstream');
      kids.push(add('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ' + n2(this.W) + ' ' + n2(this.H) + '] /Resources << /Font << /F1 ' + f1 + ' 0 R /F2 ' + f2 + ' 0 R >> >> /Contents ' + c + ' 0 R >>'));
    }
    objs[1] = '<< /Type /Pages /Kids [' + kids.map(k => k + ' 0 R').join(' ') + '] /Count ' + kids.length + ' >>';
    let out = '%PDF-1.4\n%âãÏÓ\n';
    const offsets = [];
    // la cabecera binaria ocupa 4 bytes en Latin-1 → se codifica byte a byte más abajo
    objs.forEach((o, i) => { offsets.push(out.length); out += (i + 1) + ' 0 obj\n' + o + '\nendobj\n'; });
    const xref = out.length;
    out += 'xref\n0 ' + (objs.length + 1) + '\n0000000000 65535 f \n' + offsets.map(o => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += 'trailer\n<< /Size ' + (objs.length + 1) + ' /Root 1 0 R /Info ' + info + ' 0 R >>\nstartxref\n' + xref + '\n%%EOF\n';
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xFF;
    return bytes;
  }
}
export { enc };
