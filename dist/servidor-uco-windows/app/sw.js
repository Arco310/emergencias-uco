// Service worker del Gestor de Emergencias UCO: permite abrir y usar la aplicación sin conexión
// (modo avión). Los datos están en IndexedDB; aquí solo se guarda la aplicación.
//
// Ciclo de actualización controlado:
// - Cada versión guarda sus archivos en su propia caché («uco-app-<compilación>») y solo sirve esos:
//   nunca se mezclan archivos de dos versiones.
// - Al instalarse comprueba la integridad de la aplicación (SHA-256 de index.html, fijado al compilar).
//   Si no coincide (descarga incompleta, caché intermedia antigua o manipulación) la instalación falla y
//   se sigue usando la versión anterior; se reintenta en la siguiente comprobación.
// - La versión nueva espera («waiting») hasta que la aplicación la active en un momento seguro
//   (mensaje ACTIVAR): nunca interrumpe una operación en curso.
// - Se conserva la versión anterior para recuperarse si la nueva no arranca (mensaje REVERTIR).
const VERSION = '6f272b2fc9e7';
const SHA256 = '6f272b2fc9e7e6a2fb94c85ac294358ee69efb3f93a746fe46a3f49e1151b77e';
const APP_VERSION = '1.2.0';
const CACHE = 'uco-app-' + VERSION;
const META = 'uco-app-meta';
const SHELL = ['index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/favicon-64.png'];

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
async function leerMeta() {
  try { const r = await (await caches.open(META)).match('meta.json'); return r ? await r.json() : {}; } catch { return {}; }
}
async function guardarMeta(m) {
  await (await caches.open(META)).put('meta.json', new Response(JSON.stringify(m), { headers: { 'Content-Type': 'application/json' } }));
}

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const res = await fetch('index.html', { cache: 'reload' });
    if (!res.ok) throw new Error('index.html: ' + res.status);
    const h = hex(await crypto.subtle.digest('SHA-256', await res.clone().arrayBuffer()));
    if (h !== SHA256) throw new Error('La aplicación descargada no coincide con esta versión (integridad)');
    await cache.put('index.html', res);
    for (const u of SHELL.slice(1)) {
      const r = await fetch(u, { cache: 'reload' });
      if (!r.ok) throw new Error(u + ': ' + r.status);
      await cache.put(u, r);
    }
    // Desde una versión anterior a este ciclo (sin registro de versiones) se activa como antes
    const m = await leerMeta();
    if (!m.actual) await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const m = await leerMeta();
    const keys = await caches.keys();
    if (m.actual !== CACHE) {
      // La versión anterior queda guardada para recuperación (si se había vuelto a una anterior, esa).
      // Viniendo de una versión sin registro de versiones, su caché es la anterior.
      let anterior = m.revertida ? m.anterior : m.actual; let vAnt = m.revertida ? m.versionAnterior : m.version;
      if (!m.actual) { const otras = keys.filter(k => k.startsWith('uco-app-') && k !== META && k !== CACHE); if (otras.length === 1) { anterior = otras[0]; vAnt = null; } }
      Object.assign(m, { actual: CACHE, version: APP_VERSION, anterior: anterior && anterior !== CACHE ? anterior : null, versionAnterior: anterior && anterior !== CACHE ? vAnt || null : null, revertida: false, activada: Date.now() });
      await guardarMeta(m);
    }
    await Promise.all(keys.filter(k => k.startsWith('uco-app-') && k !== META && k !== CACHE && k !== m.anterior).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', e => {
  const d = e.data || {}; const port = e.ports && e.ports[0];
  const responder = x => { if (port) port.postMessage(x); };
  e.waitUntil((async () => {
    if (d.tipo === 'ESTADO') {
      const m = await leerMeta();
      return responder({ version: APP_VERSION, build: VERSION, anterior: !!(m.anterior && m.anterior !== CACHE && await caches.has(m.anterior)), versionAnterior: m.versionAnterior || null, revertida: !!m.revertida });
    }
    if (d.tipo === 'ACTIVAR') { await self.skipWaiting(); return responder({ ok: true }); }
    if (d.tipo === 'REVERTIR') {
      const m = await leerMeta();
      if (!m.anterior || !(await caches.has(m.anterior))) return responder({ ok: false, error: 'No hay ninguna versión anterior guardada en este dispositivo' });
      m.revertida = true; await guardarMeta(m); return responder({ ok: true });
    }
    if (d.tipo === 'NORMAL') { const m = await leerMeta(); m.revertida = false; await guardarMeta(m); return responder({ ok: true }); }
    responder({ ok: false });
  })());
});

// Al tocar un aviso (por ejemplo, fin de descanso) se enfoca la aplicación o se abre si estaba cerrada
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const w = wins.find(c => c.url.startsWith(self.registration.scope));
    if (w) { try { return await w.focus(); } catch { } }
    return self.clients.openWindow((e.notification.data && e.notification.data.url) || self.registration.scope);
  })());
});
// Teselas de OpenStreetMap ya vistas: se guardan para poder usar el plano sin conexión. Solo las que el
// usuario ha visto (sin descargas masivas, según la política de uso de OSM) y con un máximo.
const TESELAS = 'uco-teselas-1'; const MAX_TESELAS = 3000;
const SEMANA = 7 * 24 * 3600 * 1000;
async function tesela(req) {
  const cache = await caches.open(TESELAS);
  const hit = await cache.match(req);
  // Reciente: se usa sin volver a pedirla (menos carga para los servidores de OSM)
  const fecha = hit && Date.parse(hit.headers.get('date') || '');
  if (hit && fecha && Date.now() - fecha < SEMANA) return hit;
  try {
    const res = await fetch(req);
    if (res && res.ok) {
      await cache.put(req, res.clone());
      const keys = await cache.keys(); if (keys.length > MAX_TESELAS) for (const k of keys.slice(0, keys.length - MAX_TESELAS)) await cache.delete(k);
      return res;
    }
    return hit || res;
  } catch { return hit || new Response('', { status: 504 }); }
}
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.hostname === 'tile.openstreetmap.org') { e.respondWith(tesela(req)); return; }
  if (url.origin !== location.origin || url.pathname.includes('/api/')) return; // mapas, búsquedas y sincronización: siempre red
  const rel = url.pathname.slice(new URL(self.registration.scope).pathname.length);
  if (rel === 'sw.js' || rel === 'version.json') return; // siempre del servidor
  e.respondWith((async () => {
    // Archivos de la aplicación: solo los de esta versión (o los de la anterior si se ha vuelto a ella)
    const m = await leerMeta();
    const nombre = m.revertida && m.anterior && (await caches.has(m.anterior)) ? m.anterior : CACHE;
    const cache = await caches.open(nombre);
    const clave = req.mode === 'navigate' || rel === '' ? 'index.html' : rel;
    const hit = await cache.match(clave, { ignoreSearch: true });
    if (hit) return hit;
    // Otros archivos (p. ej. licencias): de la red, con copia para usarlos sin conexión
    try {
      const res = await fetch(req);
      if (res && res.ok && res.type === 'basic') { const c = await caches.open(CACHE); await c.put(clave, res.clone()); }
      return res;
    } catch {
      return (await (await caches.open(CACHE)).match(clave, { ignoreSearch: true })) || new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
    }
  })());
});
