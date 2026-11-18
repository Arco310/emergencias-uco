// Sistema → Actualizaciones: versión de la aplicación en este dispositivo, versión y despliegues del
// servidor central y versión de cada dispositivo del espacio. Consultar está al alcance de todos; las
// acciones sobre el servidor exigen el permiso «Gestionar las actualizaciones» y, en el propio
// servidor, su código de administración (que nunca se guarda en la aplicación).
import { G, A } from '../state.js';
import { esc, toast, confirmDlg, btn } from '../dom.js';
import { icon } from '../icons.js';
import { fmtDateTime, AppError } from '../../core/util.js';
import { APP_VERSION } from '../../core/defaults.js';
import { compararVersiones, posterior } from '../../core/versiones.js';
import { estadoApp, comprobar, aplicar, volverAnterior, usarActual } from '../actualizacion.js';

const core = () => G.core;
const can = p => G.core.can(p);
/** Datos del servidor consultados por esta pantalla */
const D = { srv: null, disp: null, cargando: false, error: null, t: 0, tarea: null };

const RESULTADO = { correcta: ['Correcta', 'ok'], activa: ['Activa', 'ok'], probando: ['En periodo de prueba', 'warn'], revertida: ['Se volvió a la anterior', 'warn'], fallida: ['Fallida', 'bad'] };
const fecha = t => t ? fmtDateTime(t) : '—';
const fila = (k, v) => `<dt>${esc(k)}</dt><dd>${v}</dd>`;
const chip = (t, cls = 'muted') => `<span class="chip sm ${cls}">${esc(t)}</span>`;

async function cargar(forzar = false) {
  if (D.cargando || (!forzar && Date.now() - D.t < 15000)) return;
  D.cargando = true; D.error = null;
  try {
    await core().versionServidor();
    if (core().centralMeta) {
      D.srv = await core().actualizacionesServidor().catch(e => { if (e.status === 404) return { antiguo: true }; throw e; });
      D.disp = await core().dispositivosCentral().catch(() => null);
    }
  } catch (e) { D.error = e.message; }
  D.cargando = false; D.t = Date.now();
  // Mientras se prepara una versión (descarga, verificación y prueba) se sigue consultando
  clearTimeout(D.tarea); if (D.srv && D.srv.tarea && G.ui.route === 'actualizaciones') D.tarea = setTimeout(() => cargar(true), 3000);
  G.render();
}

function seccionApp() {
  const s = estadoApp(); const lista = s.lista;
  let estado;
  if (!s.soportado) estado = chip('No disponible en esta forma de abrir la aplicación', 'muted');
  else if (s.aplicando) estado = chip('Aplicando la versión nueva…', 'info');
  else if (lista) estado = chip('Versión ' + (lista.version || 'nueva') + ' lista para aplicar', 'warn');
  else if (s.comprobando) estado = chip('Comprobando…', 'info');
  else if (s.activa && s.activa.revertida) estado = chip('Usando la versión anterior (recuperación)', 'warn');
  else estado = chip('Al día', 'ok');
  const gestion = can('actualizaciones.gestionar');
  return `<section class="card pad" data-act="app"><h2>${icon('descargar')} Esta aplicación</h2>
    <dl class="kv">${fila('Versión en este dispositivo', esc(APP_VERSION) + (s.activa && s.activa.build ? ` <small class="muted">(compilación ${esc(s.activa.build)})</small>` : ''))}
    ${fila('Estado', estado)}
    ${fila('Última comprobación', s.ultima ? fecha(s.ultima) : '—')}</dl>
    ${s.error ? `<p class="note warn">${esc(s.error)}</p>` : ''}
    ${core().bloqueoSync ? `<p class="note bad" data-act="obsoleta">${esc(core().bloqueoSync)}</p>` : ''}
    <p class="muted small">La aplicación busca versiones nuevas sola, las descarga y comprueba su integridad. Se aplican solas si no hay ninguna sesión abierta; si estás trabajando, eliges el momento. Tus datos y los cambios pendientes de enviar se conservan siempre.</p>
    <div class="row wrap gap">
      ${s.soportado ? btn('Buscar actualizaciones', 'act.comprobar', { ic: 'sync', disabled: s.comprobando }) : ''}
      ${lista ? btn('Actualizar ahora', 'act.aplicar', { ic: 'descargar', cls: 'primary' }) : ''}
      ${s.activa && s.activa.revertida ? btn('Volver a la versión actual', 'act.actual', { ic: 'ok' }) : ''}
      ${gestion && s.activa && s.activa.anterior && !s.activa.revertida ? btn('Usar la versión anterior' + (s.activa.versionAnterior ? ' (' + s.activa.versionAnterior + ')' : ''), 'act.anterior', { ic: 'atras', cls: 'ghost' }) : ''}
    </div></section>`;
}

function seccionServidor() {
  const c = core(); const v = c.versionRemota; const srv = D.srv; const gestion = can('actualizaciones.gestionar');
  const servidor = c.servidorCentral();
  if (!servidor) return `<section class="card pad"><h2>${icon('sync')} Servidor central</h2><p class="muted">Este dispositivo no usa ningún servidor central.</p></section>`;
  if (!v) return `<section class="card pad"><h2>${icon('sync')} Servidor central</h2><p class="muted">${D.cargando ? 'Consultando…' : 'Sin conexión con el servidor central. Se vuelve a intentar al pulsar «Actualizar».'}</p>${btn('Actualizar', 'act.cargar', { ic: 'sync' })}</section>`;
  if (v.antiguo) return `<section class="card pad"><h2>${icon('sync')} Servidor central</h2><dl class="kv">${fila('Versión instalada', esc(v.version || '?'))}</dl><p class="note warn">Este servidor es anterior a la 1.2.0 y no se actualiza solo. Ejecuta una vez el instalador nuevo en el PC servidor (hace una copia de los datos y vuelve atrás si algo falla); desde entonces las actualizaciones se gestionan aquí.</p></section>`;
  const dep = (srv && srv.despliegue) || v.despliegue || {};
  const est = RESULTADO[dep.estado] || [dep.estado || '—', 'muted'];
  const ult = srv && srv.despliegue && srv.despliegue.ultimo;
  const disp = srv ? srv.disponible : v.disponible ? { version: v.disponible } : null;
  const actualizable = srv ? srv.actualizable : !!v.disponible;
  const prep = srv && srv.preparada; const prog = srv && srv.programada;
  const acciones = [];
  if (gestion && srv && !srv.antiguo) {
    if (actualizable && !prep && !srv.tarea) acciones.push(btn('Descargar y verificar ' + disp.version, 'act.srv', { ic: 'descargar', cls: 'primary', data: { accion: 'preparar' } }));
    if (prep && !prog) { acciones.push(btn('Instalar ahora', 'act.srv', { ic: 'play', cls: 'primary', data: { accion: 'ahora' } })); acciones.push(btn('Instalar en la ventana segura', 'act.srv', { ic: 'reloj', data: { accion: 'ventana' } })); }
    if (prog) acciones.push(btn('Posponer (cancelar la instalación programada)', 'act.srv', { ic: 'stop', data: { accion: 'cancelar' } }));
    if (srv.lanzador) acciones.push(btn('Volver a la versión anterior', 'act.srv', { ic: 'atras', cls: 'ghost', data: { accion: 'revertir' } }));
  }
  const historial = srv && srv.despliegue && srv.despliegue.historial || [];
  return `<section class="card pad" data-act="servidor"><h2>${icon('sync')} Servidor central</h2>
    <dl class="kv">${fila('Versión instalada', esc(v.version || '?'))}
    ${fila('Estado del servidor', v.mantenimiento ? chip('Reiniciándose para actualizarse', 'warn') : chip('En servicio', 'ok'))}
    ${fila('Último despliegue', chip(est[0], est[1]) + (dep.fecha ? ' · ' + fecha(dep.fecha) : ''))}
    ${ult ? fila('Resultado', esc((ult.version || '') + ': ' + ((RESULTADO[ult.resultado] || [ult.resultado])[0]) + (ult.motivo ? ' — ' + ult.motivo : ''))) : ''}
    ${fila('Versión disponible', actualizable && disp ? chip(disp.version + (disp.publicada ? ' · ' + fecha(Date.parse(disp.publicada)) : ''), 'info') : 'Ninguna más reciente')}
    ${fila('Versión mínima de la aplicación', esc(v.minCliente || '—'))}
    ${fila('Esquema de datos del servidor', esc(String(v.esquema || '—')))}
    ${srv && srv.comprobado ? fila('Última consulta de versiones', fecha(srv.comprobado)) : ''}</dl>
    ${srv && srv.tarea ? `<p class="note info">${srv.tarea === 'preparando' ? 'Descargando, verificando y probando la versión nueva con una copia de los datos…' : 'Consultando versiones…'}</p>` : ''}
    ${prep ? `<p class="note ok">Versión ${esc(prep.version)} descargada, verificada (SHA-256) y probada con una copia de los datos: lista para instalar.</p>` : ''}
    ${prog ? `<p class="note warn">Instalación programada ${prog.modo === 'ventana' ? 'para la próxima ventana segura (30 minutos sin cambios en ningún preventivo)' : 'ahora'}.</p>` : ''}
    ${srv && srv.error ? `<p class="note bad">${esc(srv.error)}</p>` : ''}
    ${srv && srv.actividad ? `<p class="muted small">Actividad: ${srv.actividad.ultimaEscritura ? 'último cambio hace ' + srv.actividad.inactivoMin + ' min · ' + srv.actividad.preventivosConActividad + ' preventivo(s) con cambios en los últimos 30 min' : 'sin cambios desde que arrancó el servidor'}.</p>` : ''}
    ${disp && disp.notas && actualizable ? `<details><summary>Novedades de la versión ${esc(disp.version)}</summary><pre class="notas">${esc(disp.notas)}</pre></details>` : ''}
    ${srv && srv.lanzador === false ? `<p class="note warn">El servidor no tiene todavía el sistema de actualizaciones: ejecuta una vez el instalador nuevo en el PC servidor.</p>` : ''}
    ${!c.centralMeta ? `<p class="muted small">Conecta este dispositivo al servidor central para ver el detalle de los despliegues y de los dispositivos.</p>` : ''}
    ${gestion && c.centralMeta ? `<p class="muted small">Las acciones piden el <b>código de administración del servidor</b> (en el PC servidor: MOSTRAR-CODIGO-ADMIN). Antes de instalar se hace una copia de seguridad de los datos; si la versión nueva falla, el servidor vuelve solo a la anterior.</p>` : ''}
    <div class="row wrap gap">${btn('Actualizar', 'act.cargar', { ic: 'sync', disabled: D.cargando })}${c.centralMeta ? btn('Comprobar versiones publicadas', 'act.srv', { ic: 'buscar', data: { accion: 'comprobar' } }) : ''}${acciones.join('')}</div>
    ${historial.length ? `<h3>Historial de despliegues</h3><ul class="plain small" data-act="historial">${historial.map(h => `<li>${fecha(h.t)} · <b>${esc(h.version || '?')}</b> · ${esc((RESULTADO[h.resultado] || [h.resultado])[0])}${h.motivo ? ' — ' + esc(h.motivo) : ''}</li>`).join('')}</ul>` : ''}
  </section>`;
}

function seccionDispositivos() {
  const c = core(); if (!c.centralMeta) return '';
  const v = c.versionRemota || {};
  const lista = Object.entries(D.disp || {}).sort((a, b) => (b[1].visto || 0) - (a[1].visto || 0));
  if (!lista.length) return `<section class="card pad"><h2>${icon('red')} Dispositivos</h2><p class="muted">${D.disp ? 'Aún no hay datos de los dispositivos.' : 'Consultando…'}</p></section>`;
  const est = d => {
    if (!d.version) return chip('Desconocida', 'muted');
    if (v.minCliente && posterior(v.minCliente, d.version)) return chip('Debe actualizarse', 'bad');
    if (v.version && compararVersiones(d.version, v.version) < 0) return chip('Pendiente de actualizar', 'warn');
    return chip('Al día', 'ok');
  };
  return `<section class="card pad" data-act="dispositivos"><h2>${icon('red')} Dispositivos del servidor central</h2>
    <p class="muted small">Versión de la aplicación con la que se conectó cada dispositivo por última vez. Se actualizan solos al abrir la aplicación.</p>
    <div class="table-wrap"><table class="tbl"><thead><tr><th>Dispositivo</th><th>Versión</th><th>Estado</th><th>Última conexión</th></tr></thead><tbody>
    ${lista.map(([id, d]) => `<tr${id === c.device.id ? ' class="sel"' : ''}><td>${esc(d.nombre || id)}${id === c.device.id ? ' <small class="muted">(este)</small>' : ''}</td><td>${esc(d.version || '—')}</td><td>${est(d)}</td><td>${fecha(d.visto)}</td></tr>`).join('')}
    </tbody></table></div></section>`;
}

function seccionDatos() {
  const m = core().migracion; if (!m || m.estado === 'al_dia') return '';
  const txt = m.estado === 'migrado' ? `Los datos de este dispositivo se actualizaron del esquema ${m.desde} al ${m.hasta}. Antes se hizo una copia de seguridad (Sistema → Copias de seguridad).`
    : m.estado === 'posterior' ? `Los datos de este dispositivo son de una versión más reciente de la aplicación (esquema ${m.actual}). Se pueden usar, pero conviene volver a la versión actual.`
      : 'No se pudieron actualizar los datos de este dispositivo: se sigue trabajando con ellos como estaban y se reintentará al volver a iniciar sesión. ' + (m.error || '');
  return `<section class="card pad"><h2>${icon('archivar')} Datos de este dispositivo</h2><p class="note ${m.estado === 'migrado' ? 'ok' : 'warn'}">${esc(txt)}</p></section>`;
}

export function renderActualizaciones() {
  cargar();
  return `<div data-vista="actualizaciones">${seccionApp()}${seccionDatos()}${seccionServidor()}${seccionDispositivos()}${D.error ? `<p class="note bad">${esc(D.error)}</p>` : ''}</div>`;
}

A['act.cargar'] = () => cargar(true);
A['act.comprobar'] = async () => { await comprobar(); const s = estadoApp(); toast(s.lista ? 'Versión ' + (s.lista.version || 'nueva') + ' lista para aplicar' : 'La aplicación está al día', s.lista ? 'info' : 'ok'); };
A['act.aplicar'] = async () => {
  const c = core(); const s = estadoApp();
  const pend = c.cur ? await c.repo.countPending(c.cur).catch(() => 0) : 0;
  const ok = await confirmDlg({
    title: 'Actualizar la aplicación', ok: 'Actualizar ahora',
    html: `<p>Se recargará la aplicación con la versión <b>${esc((s.lista && s.lista.version) || 'nueva')}</b>.</p><ul class="plain small">
      <li>${icon('ok')} Tus datos se conservan en este dispositivo.</li>
      <li>${icon('ok')} ${pend ? `Hay ${pend} cambio(s) pendiente(s) de enviar: se intentan enviar ahora y, si no hay conexión, se enviarán después.` : 'No hay cambios pendientes de enviar.'}</li>
      ${c.session ? `<li>${icon('candado')} Tendrás que volver a iniciar sesión; se abrirá el mismo preventivo y la misma pantalla.</li>` : ''}</ul>`,
  });
  if (ok) await aplicar();
};
A['act.anterior'] = async () => {
  const ok = await confirmDlg({ title: 'Usar la versión anterior', text: 'La aplicación se recargará con la versión anterior guardada en este dispositivo. Los datos se conservan. Úsalo solo si la versión actual da problemas.', ok: 'Usar la anterior', danger: true });
  if (!ok) return;
  try { await volverAnterior(); } catch (e) { toast(e.message, 'error'); }
};
A['act.actual'] = async () => { try { await usarActual(); } catch (e) { toast(e.message, 'error'); } };

const TEXTOS = {
  comprobar: ['Comprobar versiones publicadas', 'Consulta en GitHub (repositorio oficial) si hay una versión nueva del servidor.'],
  preparar: ['Descargar y verificar', 'El servidor descarga la versión nueva, comprueba su integridad (SHA-256) y la prueba con una copia de los datos. No se instala todavía y no interrumpe nada.'],
  ahora: ['Instalar ahora', 'El servidor hace una copia de los datos y se reinicia con la versión nueva (unos segundos sin sincronizar; los dispositivos guardan los cambios y los envían después). Si falla, vuelve solo a la anterior.'],
  ventana: ['Instalar en la ventana segura', 'Se instalará cuando no haya cambios en ningún preventivo durante 30 minutos. Se puede posponer.'],
  cancelar: ['Posponer la instalación', 'Se cancela la instalación programada. La versión sigue preparada.'],
  revertir: ['Volver a la versión anterior del servidor', 'El servidor hace una copia de los datos y vuelve a la versión anterior guardada. Los datos se conservan.'],
};
A['act.srv'] = async el => {
  const accion = el.dataset.accion; const [titulo, texto] = TEXTOS[accion] || [accion, ''];
  try {
    let codigo = '';
    if (accion !== 'comprobar') {
      const v = await confirmDlg({ title: titulo, text: texto, input: { label: 'Código de administración del servidor', attrs: 'autocomplete="off" autocapitalize="characters" spellcheck="false"' }, ok: titulo, danger: accion === 'revertir' });
      if (v == null) return; codigo = v;
    }
    let r;
    try { r = await core().accionActualizacionServidor(accion, { codigo }); }
    catch (e) {
      // Hay actividad ahora mismo: se ofrece la ventana segura o forzar
      if (e.status === 409 && e.body && e.body.code === 'actividad') {
        const f = await confirmDlg({ title: 'Hay preventivos en uso', text: 'Ha habido cambios en los últimos minutos. Lo recomendable es instalar en la ventana segura (cuando no haya actividad). ¿Instalar ahora de todos modos? Los dispositivos guardarán sus cambios y los enviarán al volver el servidor.', ok: 'Instalar ahora de todos modos', danger: true });
        if (!f) return;
        r = await core().accionActualizacionServidor(accion, { codigo, forzar: true });
      } else throw e;
    }
    D.srv = r && r.instalada ? r : D.srv;
    toast({ comprobar: r && r.actualizable ? 'Hay una versión nueva: ' + r.disponible.version : 'No hay versiones nuevas', preparar: 'Preparando la versión nueva…', ahora: 'El servidor se está reiniciando con la versión nueva', ventana: 'Instalación programada para la ventana segura', cancelar: 'Instalación pospuesta', revertir: 'El servidor vuelve a la versión anterior' }[accion], 'ok', 6000);
    setTimeout(() => cargar(true), accion === 'ahora' || accion === 'revertir' ? 6000 : 300);
  } catch (e) {
    toast(e instanceof AppError || e.message ? e.message : String(e), 'error', 7000);
    cargar(true);
  }
};
