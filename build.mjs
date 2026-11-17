// Compilación: genera la aplicación instalable (dist/app) y la vista previa (dist/preview.html).
// Uso: node build.mjs        (requiere esbuild: npm install)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let esbuild;
try { esbuild = (await import('esbuild')).default; }
catch { esbuild = (await import('/opt/npm-tools/node_modules/esbuild/lib/main.js')).default; }

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const DIST = path.join(ROOT, 'dist');
const APP = path.join(DIST, 'app');
fs.rmSync(DIST, { recursive: true, force: true });
fs.mkdirSync(path.join(APP, 'icons'), { recursive: true });

async function bundle(preview) {
  const r = await esbuild.build({
    entryPoints: [path.join(ROOT, 'src/ui/app.js')], bundle: true, format: 'iife', minify: !process.env.UCO_SIN_MINIFICAR, write: false,
    target: ['es2020', 'chrome90'], define: { __PREVIEW__: preview ? 'true' : 'false' }, legalComments: 'none', charset: 'utf8',
  });
  return r.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
}
const css = (await esbuild.transform(fs.readFileSync(path.join(ROOT, 'src/ui/styles.css'), 'utf8'), { loader: 'css', minify: true })).code;
const favicon = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'pwa/icons/favicon-64.png')).toString('base64');

function html({ js, preview }) {
  const csp = "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; frame-src https://www.google.com https://maps.google.com https://www.openstreetmap.org; worker-src 'self'; manifest-src 'self'; base-uri 'self'; form-action 'none'; object-src 'none'";
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
${preview ? '' : `<meta http-equiv="Content-Security-Policy" content="${csp}">\n<link rel="manifest" href="manifest.webmanifest">\n<link rel="apple-touch-icon" href="icons/icon-192.png">`}
<meta name="theme-color" content="#14181C">
<meta name="description" content="Gestor de Emergencias UCO: preventivos, unidades, avisos, descansos, planos y estadísticas. Funciona sin conexión.">
<meta name="referrer" content="strict-origin-when-cross-origin">
<link rel="icon" href="${preview ? favicon : 'icons/favicon-64.png'}">
<title>Gestor de Emergencias UCO</title>
<style>${css}</style>
</head>
<body>
<div id="app" class="app"></div>
<div id="layer"></div>
<div id="toasts" aria-live="polite"></div>
<noscript><p style="padding:2rem">Esta aplicación necesita JavaScript.</p></noscript>
<script>${js}</script>
</body>
</html>
`;
}

const appHtml = html({ js: await bundle(false), preview: false });
fs.writeFileSync(path.join(APP, 'index.html'), appHtml);
const version = crypto.createHash('sha256').update(appHtml).digest('hex').slice(0, 12);
fs.writeFileSync(path.join(APP, 'sw.js'), fs.readFileSync(path.join(ROOT, 'pwa/sw.js'), 'utf8').replace('__VERSION__', version));
fs.copyFileSync(path.join(ROOT, 'pwa/manifest.webmanifest'), path.join(APP, 'manifest.webmanifest'));
for (const f of fs.readdirSync(path.join(ROOT, 'pwa/icons'))) fs.copyFileSync(path.join(ROOT, 'pwa/icons', f), path.join(APP, 'icons', f));
fs.writeFileSync(path.join(APP, '.nojekyll'), '');
fs.writeFileSync(path.join(DIST, 'preview.html'), html({ js: await bundle(true), preview: true }));
const kb = f => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
console.log('Aplicación: dist/app/index.html (' + kb(path.join(APP, 'index.html')) + ') versión ' + version);
console.log('Vista previa: dist/preview.html (' + kb(path.join(DIST, 'preview.html')) + ')');
