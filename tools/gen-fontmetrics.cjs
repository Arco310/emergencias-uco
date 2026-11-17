// Genera src/core/fontmetrics.js con los anchos de Helvetica (WinAnsi 32-255)
const F = require('/opt/npm-tools/node_modules/@pdf-lib/standard-fonts');
const fs = require('fs');
const enc = F.Encodings.WinAnsi;
function widths(name) {
  const f = F.Font.load(name);
  const out = [];
  for (let code = 32; code <= 255; code++) {
    let g = null;
    try { const cp = Object.entries(enc.unicodeMappings || {}).find(([u, v]) => v[0] === code); g = cp ? cp[1][1] : null; } catch (e) {}
    const w = g ? f.getWidthOfGlyph(g) : null;
    out.push(w == null ? 0 : w);
  }
  return out;
}
console.log(Object.keys(F.Encodings.WinAnsi).slice(0,5));
const H = widths('Helvetica'), B = widths('Helvetica-Bold');
fs.writeFileSync('src/core/fontmetrics.js',
`// Anchos de glifo (1/1000 em) de Helvetica y Helvetica-Bold para WinAnsi 32..255.
// Generado con tools/gen-fontmetrics.cjs a partir de las métricas AFM estándar de Adobe.
export const HELV = ${JSON.stringify(H)};
export const HELV_B = ${JSON.stringify(B)};
`);
console.log('A=',H[65-32],'a=',H[97-32],'space=',H[0],'ñ=',H[0xF1-32],'€=',H[0x80-32], 'B a=', B[97-32], 'zeros', H.filter(x=>!x).length);
