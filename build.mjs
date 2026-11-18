// Compilación: genera la aplicación instalable (dist/app) y la vista previa (dist/preview.html).
// Uso: node build.mjs        (requiere esbuild: npm install)
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

let esbuild;
try { esbuild = (await import('esbuild')).default; }
catch { esbuild = (await import('/opt/npm-tools/node_modules/esbuild/lib/main.js')).default; }

const ROOT = path.dirname(new URL(import.meta.url).pathname);
const { APP_VERSION } = await import('./src/core/defaults.js');
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
// Estilos de Leaflet (cartografía, licencia BSD-2) + estilos propios
const LEAFLET = path.join(ROOT, 'node_modules/leaflet');
const css = (await esbuild.transform(fs.readFileSync(path.join(LEAFLET, 'dist/leaflet.css'), 'utf8') + '\n' + fs.readFileSync(path.join(ROOT, 'src/ui/styles.css'), 'utf8'), { loader: 'css', minify: true })).code;
const favicon = 'data:image/png;base64,' + fs.readFileSync(path.join(ROOT, 'pwa/icons/favicon-64.png')).toString('base64');

// Arranque vigilado: si la aplicación no llega a arrancar (error o bloqueo), se muestra una pantalla de
// recuperación sin dependencias: reintentar, volver a la versión anterior guardada en el dispositivo o
// buscar una versión corregida. Los datos (IndexedDB) no se tocan.
const RECUPERACION = `(function(){
var ok=false,errs=[],visto=false;
window.__ucoArranqueOk=function(){ok=true;var r=document.getElementById('uco-recuperacion');if(r)r.remove();};
window.__ucoFallo=function(m){errs.push(String(m));mostrar()};
function sw(msg){return new Promise(function(res){try{var c=navigator.serviceWorker&&navigator.serviceWorker.controller;if(!c)return res(null);var ch=new MessageChannel();ch.port1.onmessage=function(e){res(e.data)};c.postMessage(msg,[ch.port2]);setTimeout(function(){res(null)},3000)}catch(e){res(null)}})}
function boton(t,fn,prim){var b=document.createElement('button');b.type='button';b.textContent=t;b.style.cssText='display:block;width:100%;min-height:48px;margin:10px 0 0;border-radius:10px;font:600 16px system-ui,sans-serif;border:1px solid #556;cursor:pointer;'+(prim?'background:#B71C1C;color:#fff;border-color:#B71C1C':'background:#232a31;color:#fff');b.onclick=fn;return b}
function mostrar(){if(ok||visto)return;visto=true;var d=document.createElement('div');d.id='uco-recuperacion';d.setAttribute('role','alertdialog');
d.style.cssText='position:fixed;inset:0;z-index:99999;background:#14181C;color:#eef;font:15px/1.45 system-ui,sans-serif;padding:24px;overflow:auto';
var w=document.createElement('div');w.style.cssText='max-width:440px;margin:6vh auto 0';
var h=document.createElement('h1');h.textContent='La aplicación no ha podido arrancar';h.style.cssText='font-size:21px;margin:0 0 10px';
var p=document.createElement('p');p.textContent='Tus datos están a salvo en este dispositivo: no se ha borrado nada. Puedes reintentar o volver a la versión anterior de la aplicación.';
var det=document.createElement('pre');det.textContent=errs.slice(0,3).join('\\n')||'La aplicación tarda demasiado en arrancar.';det.style.cssText='white-space:pre-wrap;font-size:12px;opacity:.75;margin:10px 0;max-height:120px;overflow:auto';
w.appendChild(h);w.appendChild(p);w.appendChild(det);
w.appendChild(boton('Reintentar',function(){location.reload()},true));
sw({tipo:'ESTADO'}).then(function(e){if(e&&e.anterior&&!e.revertida)w.appendChild(boton('Usar la versión anterior'+(e.versionAnterior?' ('+e.versionAnterior+')':''),function(){sw({tipo:'REVERTIR'}).then(function(r){if(r&&r.ok){try{sessionStorage.setItem('uco:revertida','1')}catch(x){}location.reload()}else alert((r&&r.error)||'No se pudo')})}));
w.appendChild(boton('Buscar una versión corregida',function(){navigator.serviceWorker&&navigator.serviceWorker.getRegistration().then(function(g){return g&&g.update()}).catch(function(){}).then(function(){setTimeout(function(){location.reload()},1500)})}));
if(!errs.length)w.appendChild(boton('Seguir esperando',function(){visto=false;d.remove();setTimeout(mostrar,20000)}))});
d.appendChild(w);(document.body||document.documentElement).appendChild(d)}
window.addEventListener('error',function(e){if(ok)return;errs.push(String(e.message||e.error||'Error'));setTimeout(mostrar,1200)});
window.addEventListener('unhandledrejection',function(e){if(ok)return;var r=e.reason;errs.push(String(r&&r.message||r||'Error'));setTimeout(mostrar,1200)});
setTimeout(mostrar,25000);
})();`;

function html({ js, preview }) {
  // Cartografía: teselas de OpenStreetMap y, si se configura una clave, Google Maps Platform (dominios
  // según la guía de CSP de Google). La app no usa eval; Google lo exige para algunas funciones.
  const G_MAPS = 'https://*.googleapis.com https://*.gstatic.com https://*.google.com https://*.ggpht.com https://*.googleusercontent.com';
  const csp = "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: " + G_MAPS + "; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https://tile.openstreetmap.org " + G_MAPS + "; font-src 'self' https://fonts.gstatic.com; connect-src 'self' https: http://localhost:* http://127.0.0.1:*; frame-src https://www.google.com https://maps.google.com https://www.openstreetmap.org; worker-src 'self' blob:; manifest-src 'self'; base-uri 'self'; form-action 'none'; object-src 'none'";
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
<script>${RECUPERACION}</script>
<script>${js}</script>
</body>
</html>
`;
}

const appHtml = html({ js: await bundle(false), preview: false });
fs.writeFileSync(path.join(APP, 'index.html'), appHtml);
// Integridad: el service worker de esta compilación solo instala un index.html con esta suma SHA-256
const sha = crypto.createHash('sha256').update(appHtml).digest('hex');
const version = sha.slice(0, 12);
fs.writeFileSync(path.join(APP, 'sw.js'), fs.readFileSync(path.join(ROOT, 'pwa/sw.js'), 'utf8').replace('__VERSION__', version).replace('__SHA256__', sha).replace('__APP_VERSION__', APP_VERSION));
// Versión publicada (la consultan la app y el panel de actualizaciones; siempre sin caché)
fs.writeFileSync(path.join(APP, 'version.json'), JSON.stringify({ version: APP_VERSION, build: version, sha256: sha, fecha: new Date().toISOString() }, null, 1));
fs.copyFileSync(path.join(ROOT, 'pwa/manifest.webmanifest'), path.join(APP, 'manifest.webmanifest'));
for (const f of fs.readdirSync(path.join(ROOT, 'pwa/icons'))) fs.copyFileSync(path.join(ROOT, 'pwa/icons', f), path.join(APP, 'icons', f));
fs.writeFileSync(path.join(APP, '.nojekyll'), '');
// Licencias de terceros incluidas en la aplicación
fs.writeFileSync(path.join(APP, 'LICENCIAS-TERCEROS.txt'), 'Gestor de Emergencias UCO incluye:\n\nLeaflet ' + JSON.parse(fs.readFileSync(path.join(LEAFLET, 'package.json'), 'utf8')).version + ' (https://leafletjs.com)\n' + fs.readFileSync(path.join(LEAFLET, 'LICENSE'), 'utf8') + '\nCartografía: datos © colaboradores de OpenStreetMap (ODbL), https://www.openstreetmap.org/copyright. Google Maps Platform, si se configura, según sus condiciones de servicio.\n');
fs.writeFileSync(path.join(DIST, 'preview.html'), html({ js: await bundle(true), preview: true }));
// Paquete del servidor de sincronización para Windows: dist/servidor-uco-windows/ y su ZIP
const { zipStore } = await import('./src/core/zip.js');
const PW = path.join(DIST, 'servidor-uco-windows');
fs.cpSync(path.join(ROOT, 'servidor-windows'), PW, { recursive: true });
fs.mkdirSync(path.join(PW, 'servidor'), { recursive: true });
for (const f of ['server.mjs', 'actualizador.mjs', 'lanzador.mjs']) fs.copyFileSync(path.join(ROOT, 'server', f), path.join(PW, 'servidor', f));
fs.cpSync(APP, path.join(PW, 'app'), { recursive: true });
const zfiles = [];
const addDir = (dir, prefix) => { for (const f of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) { const p = path.join(dir, f.name); if (f.isDirectory()) addDir(p, prefix + f.name + '/'); else zfiles.push({ name: prefix + f.name, data: fs.readFileSync(p) }); } };
addDir(PW, 'servidor-uco-windows/');
fs.writeFileSync(path.join(DIST, 'servidor-uco-windows.zip'), zipStore(zfiles, new Date(2026, 0, 1, 12, 0, 0)));
const kb = f => (fs.statSync(f).size / 1024).toFixed(0) + ' KB';
console.log('Servidor para Windows: dist/servidor-uco-windows.zip (' + kb(path.join(DIST, 'servidor-uco-windows.zip')) + ', ' + zfiles.length + ' archivos)');
console.log('Aplicación: dist/app/index.html (' + kb(path.join(APP, 'index.html')) + ') versión ' + APP_VERSION + ' (compilación ' + version + ')');
console.log('Vista previa: dist/preview.html (' + kb(path.join(DIST, 'preview.html')) + ')');
