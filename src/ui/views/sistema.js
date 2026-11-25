// Sistema → Estado del sistema (1.5.0 · §4): monitorización del servidor central y de este dispositivo.
// Solo con el permiso «sistema.estado». En el modo anterior (sin cuentas en el servidor) el servidor pide
// además su código de administración: se guarda solo en memoria mientras la aplicación está abierta.
// Las comprobaciones de cartografía son manuales (como mucho una por minuto) y nunca se comprueba Google.
import { G, A, F } from '../state.js';
import { esc, btn, chip, toast, fieldsHtml, readForm } from '../dom.js';
import { icon } from '../icons.js';
import { fmtDateTime, fmtDur, AppError } from '../../core/util.js';
import { APP_VERSION } from '../../core/defaults.js';
import { NIVELES } from '../../core/validaciones.js';
import { capasVista } from '../../core/mapas.js';

const core = () => G.core;
const can = p => G.core.can(p);
/** Estado consultado: servidor, este dispositivo, caída del servidor y comprobación de cartografía */
const D = { srv: null, disp: null, cargando: false, error: null, t: 0, caida: null, codigo: null, pideCodigo: false, carto: null, cartoT: 0, timer: null };
const fecha = t => (t ? fmtDateTime(t) : '—');
const fila = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
const GB = n => (n == null ? '—' : (n / 2 ** 30).toFixed(n < 10 * 2 ** 30 ? 1 : 0) + ' GB');
const MB = n => (n == null ? '—' : n < 2 ** 20 ? Math.max(1, Math.round(n / 1024)) + ' KB' : (n / 2 ** 20).toFixed(0) + ' MB');
const NIVEL = k => NIVELES[k] || { nombre: k, color: '#546E7A' };
const ESTADO = { ok: ['Correcto', '#2E7D32'], error: ['Con errores', '#C62828'] };

async function cargar(forzar = false) {
  if (D.cargando || (!forzar && Date.now() - D.t < 10000)) return;
  D.cargando = true; D.error = null; G.render();
  try { D.disp = await core().estadoDispositivo(); } catch (e) { D.disp = null; }
  if (core().centralMeta) {
    try {
      D.srv = await core().estadoSistema({ codigo: D.codigo }); D.caida = null; D.pideCodigo = false;
    } catch (e) {
      if (e.status === 403 && !core().modoServidor()) { D.pideCodigo = true; D.srv = null; if (D.codigo) { D.codigo = null; D.error = e.message; } }
      else if (e.status === 404) D.error = 'El servidor central es de una versión anterior: actualízalo para ver su estado.';
      else if (!e.status) { D.caida = D.caida || Date.now(); D.error = 'El servidor no responde: ' + e.message; }
      else D.error = e.message;
    }
  }
  D.cargando = false; D.t = Date.now();
  // Mientras la pantalla esté abierta se actualiza sola cada 30 s (el servidor guarda el estado 10 s en caché)
  clearTimeout(D.timer); D.timer = setTimeout(() => { if (G.ui.route === 'estado') cargar(true); }, 30000);
  G.render();
}

function alertas() {
  const s = D.srv; const act = [];
  if (D.caida) act.push({ nivel: 'critica', origen: 'Servidor', mensaje: 'El servidor central no responde.', desde: D.caida });
  if (D.disp && !D.disp.online) act.push({ nivel: 'moderada', origen: 'Este dispositivo', mensaje: 'Sin conexión a la red: se trabaja en local y se enviará al volver.', desde: null });
  if (s) act.push(...s.alertas.activas);
  const hist = s ? s.alertas.historial.filter(h => h.hasta != null) : [];
  return `<section class="card pad" data-estado="alertas"><h2>${icon('alerta')} Alertas</h2>
    ${act.length ? `<ul class="inc-lista">${act.sort((a, b) => NIVEL(b.nivel).orden - NIVEL(a.nivel).orden).map(a => `<li class="inc-row" style="border-left:4px solid ${NIVEL(a.nivel).color}">
      <div>${chip(NIVEL(a.nivel).nombre, NIVEL(a.nivel).color)} <b>${esc(a.origen)}</b></div><div>${esc(a.mensaje)}</div>
      <div class="muted small">${a.desde ? 'Desde ' + fecha(a.desde) : ''}</div></li>`).join('')}</ul>` : `<p class="ok-txt">${icon('ok')} Sin alertas.</p>`}
    ${hist.length ? `<details><summary>Historial (${hist.length})</summary><ul class="ref-list small">${hist.map(h => `<li>${esc(NIVEL(h.nivel).nombre)} · <b>${esc(h.origen)}</b>: ${esc(h.mensaje)} <span class="muted">(${fecha(h.desde)} – ${fecha(h.hasta)})</span></li>`).join('')}</ul></details>` : ''}
  </section>`;
}

function servidor(s) {
  const v = s.servidor; const e = ESTADO[v.estado] || ESTADO.ok;
  return `<section class="card pad"><h2>${icon('sync')} Servidor</h2><dl class="kv">
    ${fila('Estado', chip(e[0], e[1]))}${fila('Versión instalada', esc(v.version) + (s.actualizaciones && s.actualizaciones.actualizable ? ' ' + chip('Hay una versión nueva: ' + s.actualizaciones.disponible, '#B26A00') : ''))}
    ${fila('En marcha desde (último reinicio)', fecha(v.iniciado))}${fila('Tiempo de actividad', esc(fmtDur(v.actividadSeg * 1000)))}
    ${fila('API', chip(v.api === 'ok' ? 'Responde' : v.api, v.api === 'ok' ? '#2E7D32' : '#C62828'))}${fila('Espacio', esc(s.espacio.nombre || '—') + ' · ' + (s.espacio.modo === 'servidor' ? 'modo servidor (cuentas en el servidor)' : 'modo anterior'))}
    ${fila('Errores en la última hora', String(v.erroresUltimaHora))}</dl>
    ${v.errores.length ? `<details><summary>Errores recientes (${v.errores.length})</summary><ul class="ref-list small">${v.errores.map(x => `<li>${fecha(x.t)} · ${esc(x.origen)}: ${esc(x.mensaje)}</li>`).join('')}</ul></details>` : ''}</section>`;
}

function almacenamiento(s) {
  const a = s.almacenamiento; const e = ESTADO[a.estado] || ESTADO.error;
  const pct = a.discoTotal ? Math.round((1 - a.discoLibre / a.discoTotal) * 100) : null;
  return `<section class="card pad"><h2>${icon('archivo')} Datos y almacenamiento</h2><dl class="kv">
    ${fila('Estado', chip(e[0], e[1]) + ' <span class="muted small">(prueba real de escritura y lectura)</span>')}
    ${fila('Tiempo de respuesta', a.prueba && a.prueba.ms != null ? a.prueba.ms + ' ms' : '—')}
    ${fila('Errores de acceso desde el arranque', String(a.errores) + (a.ultimoError ? ' · último: ' + fecha(a.ultimoError.t) + ' (' + esc(a.ultimoError.mensaje) + ')' : ''))}
    ${fila('Datos del servidor', a.datosTam != null ? MB(a.datosTam) + (a.datosCompleto ? '' : ' (al menos)') : '—')}
    ${fila('Disco', a.discoTotal ? GB(a.discoLibre) + ' libres de ' + GB(a.discoTotal) : 'No disponible')}</dl>
    ${pct != null ? `<div class="barra" role="img" aria-label="Disco ocupado al ${pct} %"><span style="width:${pct}%;background:${pct > 90 ? '#C62828' : pct > 80 ? '#B26A00' : '#2E7D32'}"></span></div>` : ''}</section>`;
}

function recursos(s) {
  const r = s.recursos; const m = r.memoria;
  return `<section class="card pad"><h2>${icon('grafico')} Recursos del equipo</h2><dl class="kv">
    ${fila('Memoria del servidor (proceso)', MB(m.proceso))}${fila('Memoria del equipo', GB(m.sistemaLibre) + ' libres de ' + GB(m.sistemaTotal))}
    ${fila('CPU del servidor (proceso)', r.cpu.proceso != null ? r.cpu.proceso + ' % de un núcleo' : 'Midiendo…')}${fila('Núcleos', String(r.cpu.nucleos))}
    ${fila('Carga media del equipo', r.cpu.carga != null ? r.cpu.carga.toFixed(2) : 'No disponible en Windows')}</dl></section>`;
}

function sincronizacion(s) {
  const y = s.sincronizacion;
  const disp = y.dispositivos.length ? `<ul class="ref-list small">${y.dispositivos.map(d => `<li>${chip(d.reciente ? 'Activo' : 'Sin actividad reciente', d.reciente ? '#2E7D32' : '#757575')} <b>${esc(d.nombre)}</b> · versión ${esc(d.version || '—')} · última señal ${fecha(d.visto)}</li>`).join('')}</ul>` : '<p class="muted small">Ningún dispositivo ha enviado señal todavía.</p>';
  const ctrl = y.control ? `<h3>Preventivos cargados en el servidor</h3>${y.control.length ? `<table class="tbl small"><thead><tr><th>Preventivo</th><th>Conflictos sin resolver</th><th>Incoherencias abiertas</th></tr></thead><tbody>${y.control.map(p => `<tr><td>${esc(p.nombre)}</td><td>${p.conflictos}${p.conflictoMasAntiguo ? ' <span class="muted">(desde ' + fecha(p.conflictoMasAntiguo) + ')</span>' : ''}</td><td>${Object.entries(p.incoherencias).map(([k, n]) => esc(NIVEL(k).nombre) + ': ' + n).join(' · ') || '0'}</td></tr>`).join('')}</tbody></table>` : '<p class="muted small">Ninguno cargado desde el último arranque.</p>'}` : '<p class="muted small">Los conflictos e incoherencias de cada preventivo se ven dentro del preventivo (en el modo anterior el servidor no puede leer los datos).</p>';
  return `<section class="card pad"><h2>${icon('red')} Sincronización</h2>
    <p class="muted small">Un dispositivo cuenta como conectado solo si ha enviado una señal de actividad en los últimos 3 minutos (no basta con tener la sesión abierta).</p>
    ${disp}<dl class="kv">
    ${fila('Operaciones recibidas desde el arranque', String(y.recibidas) + (y.ultimaRecepcion ? ' · última ' + fecha(y.ultimaRecepcion) : ''))}
    ${fila('Operaciones rechazadas', String(y.rechazadas) + (Object.keys(y.porCodigo).length ? ' (' + Object.entries(y.porCodigo).map(([k, n]) => esc(k) + ': ' + n).join(', ') + ')' : ''))}
    ${fila('Preventivos con actividad en la última hora', String(y.preventivosActivos))}</dl>
    ${y.rechazos.length ? `<details><summary>Últimos rechazos (${y.rechazos.length})</summary><ul class="ref-list small">${y.rechazos.map(x => `<li>${fecha(x.t)} · ${esc(x.codigo)}: ${esc(x.error)}</li>`).join('')}</ul></details>` : ''}
    ${ctrl}</section>`;
}

function copias(s) {
  const c = s.copias; const u = c.ultima; const d = D.disp;
  return `<section class="card pad"><h2>${icon('archivar')} Copias de seguridad</h2><dl class="kv">
    ${c.disponible ? fila('Última copia del servidor', u ? fecha(u.fecha) + ' · ' + esc(u.motivo || '') + ' · ' + MB(u.tam) + ' · ' + chip(u.resultado === 'correcta' ? 'Correcta' : u.resultado, u.resultado === 'correcta' ? '#2E7D32' : '#C62828') : 'Todavía no hay ninguna') : ''}
    ${c.destino ? fila('Destino', esc(c.destino)) : ''}${fila('Programación', esc(c.programacion))}
    ${c.error ? fila('Error reciente', `<span class="bad-txt">${esc(c.error)}</span>`) : ''}
    ${d ? fila('Este dispositivo', d.ultimaCopia ? 'última copia local ' + fecha(d.ultimaCopia.t) + ' (' + esc(d.ultimaCopia.tipo) + ') · ' + d.copias + ' guardadas' : 'sin copias locales') : ''}</dl></section>`;
}

function dispositivo() {
  const d = D.disp; if (!d) return '';
  const st = d.central || {};
  return `<section class="card pad"><h2>${icon('telefono')} Este dispositivo</h2><dl class="kv">
    ${fila('Aplicación', 'versión ' + esc(APP_VERSION))}${fila('Conexión', d.online ? chip('En línea', '#2E7D32') : chip('Sin conexión', '#C62828'))}
    ${fila('Servidor central', core().centralMeta ? esc(st.estado || '—') + (st.ultimo ? ' · última sincronización ' + fecha(st.ultimo) : '') : 'No configurado')}
    ${fila('Cambios sin enviar', d.pendientes.length ? d.pendientes.map(p => esc(p.nombre) + ': ' + p.n).join(' · ') : 'Ninguno')}
    ${fila('Almacenamiento del navegador', d.almacen ? MB(d.almacen.usado) + ' usados de ' + GB(d.almacen.cuota) : 'No disponible')}</dl></section>`;
}

/** Cartografía: una tesela de cada servicio sin clave, solo cuando se pide (sin consumo apreciable) */
function cargarImagen(url, ms = 8000) {
  return new Promise(res => {
    const img = new Image(); const t0 = performance.now(); let fin = false;
    const acabar = ok => { if (fin) return; fin = true; res({ ok, ms: Math.round(performance.now() - t0) }); };
    img.onload = () => acabar(true); img.onerror = () => acabar(false); setTimeout(() => acabar(false), ms);
    img.referrerPolicy = 'no-referrer'; img.src = url;
  });
}
const tesela = (tpl, z, x, y) => tpl.replace('{z}', z).replace('{x}', x).replace('{y}', y);
A['est.carto'] = async () => {
  if (Date.now() - D.cartoT < 60000) return toast('Espera un minuto entre comprobaciones', 'info');
  D.cartoT = Date.now(); D.carto = { comprobando: true }; G.render();
  const osm = capasVista('osm', 'estandar')[0].url; const ign = capasVista('osm', 'satelite')[0].url;
  const [a, b] = await Promise.all([cargarImagen(tesela(osm, 5, 15, 12)), cargarImagen(tesela(ign, 5, 15, 12))]);
  D.carto = { t: Date.now(), osm: a, ign: b }; G.render();
};
function externos() {
  const c = D.carto; const res = r => (r ? (r.ok ? chip('Disponible', '#2E7D32') + ' <span class="muted small">' + r.ms + ' ms</span>' : chip('Sin respuesta', '#C62828')) : '<span class="muted">Sin comprobar</span>');
  return `<section class="card pad"><h2>${icon('mapa')} Servicios externos</h2>
    <p class="muted small">Se comprueba desde este dispositivo, solo al pulsar, con una única tesela de cada servicio. Google Maps no se comprueba para no generar consumo en su clave.</p>
    <dl class="kv">${fila('OpenStreetMap (mapa)', c && c.comprobando ? 'Comprobando…' : res(c && c.osm))}${fila('IGN · PNOA (satélite)', c && c.comprobando ? 'Comprobando…' : res(c && c.ign))}
    ${c && c.t ? fila('Comprobado', fecha(c.t)) : ''}</dl>
    <div class="row wrap gap">${btn('Comprobar cartografía', 'est.carto', { ic: 'mapa', disabled: !!(c && c.comprobando) })}</div></section>`;
}

F['est.codigo'] = async form => {
  const v = readForm(form); const c = String(v.codigo || '').trim();
  if (!c) return toast('Escribe el código de administración del servidor', 'error');
  D.codigo = c; await cargar(true);
  if (D.srv) toast('Estado del servidor cargado', 'ok');
};
A['est.cargar'] = () => cargar(true);

export function renderEstado() {
  if (!can('sistema.estado')) throw new AppError('No tienes permiso para consultar el estado del sistema', 'permiso');
  if (!D.t && !D.cargando) setTimeout(() => cargar(true), 0);
  const c = core(); const s = D.srv;
  const pide = D.pideCodigo && !s ? `<section class="card pad"><h2>${icon('llave')} Código de administración del servidor</h2>
      <p class="muted small">Este servidor funciona en el modo anterior (sin cuentas): para ver su estado técnico hace falta su código de administración (en el PC servidor: MOSTRAR-CODIGO-ADMIN). Solo se guarda en memoria mientras la aplicación está abierta.</p>
      <form data-f="est.codigo">${fieldsHtml([{ name: 'codigo', label: 'Código de administración', type: 'password', autocomplete: 'off', required: true }])}<div class="row end"><button class="btn primary">Ver el estado</button></div></form></section>` : '';
  return `<div class="row wrap gap" style="align-items:center;justify-content:space-between">
      <p class="muted small" style="margin:0">${D.cargando ? 'Consultando…' : D.t ? 'Actualizado ' + fecha(D.t) + ' · se actualiza solo cada 30 s' : ''}</p>
      ${btn('Actualizar', 'est.cargar', { ic: 'sync', disabled: D.cargando })}</div>
    ${D.error ? `<p class="note bad">${icon('alerta')} ${esc(D.error)}</p>` : ''}
    ${alertas()}${pide}
    ${!c.centralMeta ? '<p class="note">Este dispositivo no está conectado a un servidor central: solo se muestra su propio estado.</p>' : ''}
    ${s ? servidor(s) + almacenamiento(s) + recursos(s) + sincronizacion(s) + copias(s) : ''}
    ${dispositivo()}${externos()}
    <p class="muted small">Por seguridad, este panel no muestra contraseñas, tokens, claves ni rutas del servidor, y cada consulta queda registrada.</p>`;
}
