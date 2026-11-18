// Service worker del Gestor de Emergencias UCO: permite abrir y usar la aplicación
// sin conexión (modo avión). Los datos están en IndexedDB; aquí solo se guarda la aplicación.
const VERSION = '__VERSION__';
const CACHE = 'uco-app-' + VERSION;
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/maskable-512.png', 'icons/favicon-64.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('uco-app-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
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
  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true }) || (req.mode === 'navigate' ? await cache.match('index.html') : null);
    const network = fetch(req).then(res => { if (res && res.ok && res.type === 'basic') cache.put(req, res.clone()); return res; }).catch(() => null);
    if (cached) { e.waitUntil(network); return cached; }
    const res = await network;
    return res || new Response('Sin conexión', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  })());
});
