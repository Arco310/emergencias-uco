// Actualización de la aplicación en este dispositivo (service worker) y versión del servidor central.
//
// - Comprueba si hay versión nueva al abrir la aplicación, cada 30 minutos, al volver a ella y al
//   recuperar la conexión. La versión nueva se descarga y se verifica sola (integridad SHA-256).
// - Se aplica sola solo cuando no hay nadie trabajando (pantalla de inicio de sesión) o al arrancar.
//   Con una sesión abierta se avisa y el usuario decide cuándo: antes de recargar se intentan enviar
//   los cambios pendientes; en cualquier caso quedan guardados en el dispositivo.
// - Si la versión nueva no arranca, la pantalla de recuperación permite volver a la anterior.
import { G } from './state.js';
import { APP_VERSION } from '../core/defaults.js';
import { posterior } from '../core/versiones.js';

const S = {
  soportado: false, reg: null,
  lista: null,          // versión nueva descargada y verificada, esperando: { version, build, sw }
  activa: null,         // datos del service worker en uso: { version, build, anterior, versionAnterior, revertida }
  comprobando: false, ultima: 0, error: null, aplicando: false,
};
export const estadoApp = () => S;
const cambio = () => { try { G.render(); } catch { } };

/** Mensaje a un service worker con respuesta (o null si no responde) */
function mensaje(sw, msg, ms = 3000) {
  return new Promise(res => {
    if (!sw) return res(null);
    try {
      const ch = new MessageChannel(); const t = setTimeout(() => res(null), ms);
      ch.port1.onmessage = e => { clearTimeout(t); res(e.data); };
      sw.postMessage(msg, [ch.port2]);
    } catch { res(null); }
  });
}
const entradaActiva = () => { const a = document.activeElement; return !!(a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.value); };
/** Momento seguro para aplicarla sin preguntar: sin sesión abierta y sin nada escrito a medias */
const puedeSola = () => !(G.core && G.core.session) && !entradaActiva() && !document.querySelector('.sheet-wrap');
/** ¿Se acaba de recargar para actualizar? (evita bucles si la versión nueva no llega a activarse) */
function recienAplicada() {
  try { const x = JSON.parse(sessionStorage.getItem('uco:actualizando') || 'null'); return x && Date.now() - x.t < 60000 ? x : null; } catch { return null; }
}

async function anotarLista(w) {
  const e = await mensaje(w, { tipo: 'ESTADO' });
  S.lista = { version: (e && e.version) || '', build: e && e.build, sw: w };
  if (puedeSola() && !recienAplicada()) { aplicar({ motivo: 'sin sesión' }); return; }
  cambio();
}

export async function iniciarActualizaciones() {
  if (!('serviceWorker' in navigator) || G.preview || location.protocol === 'file:') return;
  S.soportado = true;
  // Tras recargar: anotar en la auditoría la versión aplicada (o la vuelta a la anterior)
  try {
    const x = JSON.parse(sessionStorage.getItem('uco:actualizando') || 'null');
    if (x && x.a === APP_VERSION) { sessionStorage.removeItem('uco:actualizando'); if (x.de !== APP_VERSION) G.core.registrarActualizacion({ de: x.de, a: APP_VERSION }); }
    else if (x && Date.now() - x.t > 60000) sessionStorage.removeItem('uco:actualizando');
    if (sessionStorage.getItem('uco:revertida')) { sessionStorage.removeItem('uco:revertida'); G.core.registrarActualizacion({ revertida: true, a: APP_VERSION }); }
  } catch { }
  try { S.reg = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }); }
  catch (e) { S.error = 'No se pudo activar el funcionamiento sin conexión: ' + e.message; cambio(); return; }
  const reg = S.reg;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (S.aplicando) location.reload(); });
  reg.addEventListener('updatefound', () => {
    const w = reg.installing; if (!w) return;
    w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) anotarLista(w); });
  });
  // Versión ya descargada en una sesión anterior y esperando
  if (reg.waiting && navigator.serviceWorker.controller) await anotarLista(reg.waiting);
  leerActiva();
  comprobar();
  setInterval(() => comprobar(), 30 * 60000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && Date.now() - S.ultima > 5 * 60000) comprobar(); });
  window.addEventListener('online', () => comprobar());
}
async function leerActiva() {
  const c = navigator.serviceWorker && navigator.serviceWorker.controller;
  S.activa = c ? await mensaje(c, { tipo: 'ESTADO' }) : null; cambio();
}
/** Busca versión nueva de la aplicación y consulta la versión del servidor central */
export async function comprobar() {
  if (!S.reg || S.comprobando) return;
  S.comprobando = true; S.error = null; cambio();
  try { await S.reg.update(); } catch (e) { if (navigator.onLine !== false) S.error = 'No se pudo comprobar: ' + (e.message || e); }
  try { if (G.core) await G.core.versionServidor(); } catch { }
  S.comprobando = false; S.ultima = Date.now();
  if (S.reg.waiting && navigator.serviceWorker.controller && (!S.lista || S.lista.sw !== S.reg.waiting)) await anotarLista(S.reg.waiting);
  cambio();
}
/** La versión del servidor exige una aplicación más nueva que la que hay en este dispositivo */
export const obsoleta = () => !!(G.core && G.core.bloqueoSync);
export const versionServidorPosterior = () => { const v = G.core && G.core.versionRemota; return !!(v && v.version && posterior(v.version, APP_VERSION)); };

/** Aplica la versión nueva: envía lo pendiente (si puede), recuerda la pantalla y recarga una vez */
export async function aplicar({ motivo = 'usuario' } = {}) {
  if (!S.lista || !S.lista.sw || S.aplicando) return false;
  S.aplicando = true; cambio();
  try { if (G.core && G.core.session) await G.core.prepararRecarga(); } catch { }
  try { sessionStorage.setItem('uco:actualizando', JSON.stringify({ de: APP_VERSION, a: S.lista.version, build: S.lista.build, t: Date.now(), motivo })); } catch { }
  const r = await mensaje(S.lista.sw, { tipo: 'ACTIVAR' }, 5000);
  // Si no toma el control en unos segundos se recarga igualmente (la versión en espera se activa al cerrar)
  setTimeout(() => location.reload(), r ? 8000 : 500);
  return true;
}
/** Vuelve a la versión anterior guardada en el dispositivo (recuperación) */
export async function volverAnterior() {
  const c = navigator.serviceWorker && navigator.serviceWorker.controller;
  const r = await mensaje(c, { tipo: 'REVERTIR' });
  if (!r || !r.ok) throw new Error((r && r.error) || 'No se pudo volver a la versión anterior');
  try { if (G.core && G.core.session) await G.core.prepararRecarga(); } catch { }
  try { sessionStorage.setItem('uco:revertida', '1'); } catch { }
  location.reload();
}
/** Deja de usar la versión anterior y vuelve a la actual */
export async function usarActual() {
  const c = navigator.serviceWorker && navigator.serviceWorker.controller;
  const r = await mensaje(c, { tipo: 'NORMAL' });
  if (!r || !r.ok) throw new Error('No se pudo cambiar de versión');
  location.reload();
}
/** La aplicación ha arrancado bien (oculta la pantalla de recuperación si estaba esperando) */
export function arranqueOk() { try { if (window.__ucoArranqueOk) window.__ucoArranqueOk(); } catch { } }
