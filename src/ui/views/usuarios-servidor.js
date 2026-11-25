// Usuarios y permisos del servidor central (modo servidor, 1.4.0). Todo se guarda en el servidor, que es
// quien comprueba los permisos; esta pantalla solo los muestra y los pide.
import { G, A, F, CH, filt } from '../state.js';
import { esc, attr, openSheet, closeSheet, refreshSheets, toast, confirmDlg, fieldsHtml, readForm, chip, empty, btn, tabs, copyText } from '../dom.js';
import { icon } from '../icons.js';
import { fmtDateTime } from '../../core/util.js';
import { PERMISOS, PERM_LABEL, normalizarPerfil, expandir, permisosEfectivos } from '../../core/perms.js';

const core = () => G.core; const can = p => core().can(p);
let D = null; let CARGANDO = false; let ERROR = null; let REG = null;
export const ESTADOS_USUARIO = {
  pendiente: ['Pendiente de aprobación', '#E65100'], activo: ['Activo', '#2E7D32'], suspendido: ['Suspendido', '#C62828'],
  desactivado: ['Desactivado', '#616161'], rechazado: ['Rechazado', '#616161'], invitado: ['Invitación pendiente', '#1565C0'], caducado: ['Activación caducada', '#6D4C41'],
};
const ACCION = { activo: 'Activar', suspendido: 'Suspender', desactivado: 'Desactivar', rechazado: 'Rechazar' };
const TRANS = { pendiente: ['activo', 'rechazado'], invitado: ['desactivado'], caducado: ['desactivado'], activo: ['suspendido', 'desactivado'], suspendido: ['activo', 'desactivado'], desactivado: ['activo'], rechazado: ['activo'] };
const MODULOS = [...new Set(PERMISOS.map(p => p[2]))];
const chipEstado = e => chip(...(ESTADOS_USUARIO[e] || [e, '#757575']));
const nombrePerfil = id => (D && D.perfiles.find(p => p.id === id) || {}).nombre || (id ? id : 'Sin perfil');
async function cargar() {
  CARGANDO = true;
  try { D = await core().usuariosServidor(); ERROR = null; } catch (e) { ERROR = e.message; }
  finally { CARGANDO = false; G.render(); refreshSheets(); }
}
const recargar = () => { D = null; ERROR = null; return cargar(); };
async function registroPrev() { if (!REG) { const d = await core().central.datos(); REG = Object.values(d.registro || {}).map(r => ({ pid: r.pid, nombre: r.nombre || r.pid })).sort((a, b) => a.nombre.localeCompare(b.nombre)); } return REG; }

export function renderUsuariosServidor() {
  if (!['usuarios.crear', 'usuarios.editar', 'usuarios.aprobar', 'usuarios.permisos'].some(can)) return empty('No tienes permiso para administrar usuarios');
  if (!D && !CARGANDO && !ERROR) cargar();
  if (ERROR) return `<p class="note bad">${icon('alerta')} ${esc(ERROR)}</p>${btn('Reintentar', 'us.recargar', { ic: 'sync' })}`;
  if (!D) return `<p class="muted">Cargando los usuarios del servidor…</p>`;
  const f = filt('us'); const tab = f.tab || 'u';
  return `<p class="note">${icon('escudo')} Los permisos los comprueba el servidor central: lo que un usuario no tiene permitido se rechaza aunque lo intente con otra aplicación o llamando directamente al servidor.</p>
    ${tabs([['u', 'Usuarios', D.usuarios.length], ['p', 'Perfiles de permisos', D.perfiles.length], ['a', 'Registro de cuentas']], tab, 'us.tab')}
    ${tab === 'u' ? listaUsuarios() : tab === 'p' ? listaPerfiles() : ajustesRegistro()}`;
}
A['us.tab'] = el => { filt('us').tab = el.dataset.v; G.render(); };
A['us.recargar'] = () => recargar();

// ---------- lista ----------
function filaUsuario(u) {
  return `<li class="cat-row us-row" data-a="us.abrir" data-id="${attr(u.id)}" role="button" tabindex="0">
    <span class="avatar">${esc((u.nombre || u.usuario).slice(0, 1).toUpperCase())}</span>
    <div class="grow"><b>${esc(u.nombre)}</b> ${chipEstado(u.estadoVisible)}<small class="muted">${esc([u.usuario, u.metodo === 'pin' ? 'Código + PIN' : 'Contraseña', nombrePerfil(u.perfil), u.alcance && u.alcance.tipo === 'seleccion' ? 'Solo ' + Object.keys(u.alcance.preventivos || {}).length + ' preventivo(s)' : '', u.ultimoAcceso ? 'último acceso ' + fmtDateTime(u.ultimoAcceso) : 'sin accesos'].filter(Boolean).join(' · '))}</small></div>
    ${icon('derecha')}</li>`;
}
function listaUsuarios() {
  const f = filt('us'); const q = (f.q || '').toLowerCase(); const est = f.estado || '';
  const pend = D.usuarios.filter(u => u.estadoVisible === 'pendiente');
  const lista = D.usuarios.filter(u => u.estadoVisible !== 'pendiente' && (!est || u.estadoVisible === est) && (!q || (u.nombre + ' ' + u.usuario).toLowerCase().includes(q)));
  const cuenta = e => D.usuarios.filter(u => u.estadoVisible === e).length;
  return `<div class="row gap wrap end">${can('usuarios.crear') ? btn('Nuevo usuario', 'us.nuevo', { cls: 'primary', ic: 'mas_add' }) : ''}${btn('', 'us.recargar', { cls: 'icon ghost', ic: 'sync', title: 'Actualizar' })}</div>
    ${pend.length ? `<section class="card pad us-pend"><h2>${icon('alerta')} Solicitudes pendientes <b class="count">${pend.length}</b></h2><p class="muted small">Revisa cada solicitud: al aprobarla eliges su perfil de permisos. Hasta entonces no tiene ningún permiso.</p><ul class="cat-list">${pend.map(filaUsuario).join('')}</ul></section>` : ''}
    <div class="row gap wrap"><input type="search" placeholder="Buscar por nombre o usuario" value="${attr(f.q || '')}" data-c="us.q" data-live="1" aria-label="Buscar usuario" class="grow">
      <select data-c="us.estado" aria-label="Estado"><option value="">Todos los estados</option>${Object.entries(ESTADOS_USUARIO).filter(([k]) => k !== 'pendiente').map(([k, [l]]) => `<option value="${k}"${est === k ? ' selected' : ''}>${esc(l)} (${cuenta(k)})</option>`).join('')}</select></div>
    <ul class="cat-list">${lista.map(filaUsuario).join('') || '<li class="muted">Ningún usuario con ese filtro</li>'}</ul>
    <p class="muted small">Los usuarios no se borran: se desactivan, para conservar la autoría de los registros.</p>`;
}
CH['us.q'] = el => { filt('us').q = el.value; G.render(); };
CH['us.estado'] = el => { filt('us').estado = el.value; G.render(); };

// ---------- ficha de un usuario ----------
let SEL = null; // { id, permisos editados: Set, perfil, alcance }
const usuarioSel = () => D && SEL && D.usuarios.find(u => u.id === SEL.id);
A['us.abrir'] = async el => {
  const u = D.usuarios.find(x => x.id === el.dataset.id); if (!u) return;
  SEL = { id: u.id, perfil: u.perfil || '', ajustes: JSON.parse(JSON.stringify(u.ajustes || { mas: [], menos: [] })), alcance: JSON.parse(JSON.stringify(u.alcance || { tipo: 'todos' })), cambiado: false };
  await registroPrev().catch(() => { REG = []; });
  openSheet({ title: u.nombre, size: 'l', live: true, render: renderFicha, onClose: () => { SEL = null; } });
};
function renderFicha() {
  const u = usuarioSel(); if (!u) return '<p class="muted">Usuario no encontrado</p>';
  const yo = core().user && core().user.id === u.id;
  const ev = u.estadoVisible;
  const acciones = (TRANS[ev] || []).filter(e => (e === 'activo' && ev === 'pendiente') ? can('usuarios.aprobar') || can('usuarios.editar') : e === 'rechazado' ? can('usuarios.aprobar') || can('usuarios.editar') : can('usuarios.editar'));
  return `<div class="us-ficha">
    <p>${chipEstado(ev)} <code>${esc(u.usuario)}</code> · ${u.metodo === 'pin' ? 'Sin contraseña (código + PIN)' : 'Con contraseña'} · alta ${u.creado ? fmtDateTime(u.creado) : '—'}${u.creadoPor ? ' por ' + esc(u.creadoPor) : u.origen === 'registro' ? ' (solicitud desde el inicio de sesión)' : ''}${u.aprobado ? ' · aprobada por ' + esc(u.aprobado.por) + ' el ' + fmtDateTime(u.aprobado.t) : ''}</p>
    ${yo ? `<p class="note">${icon('info')} Es tu propia cuenta: tus permisos y tu estado los tiene que cambiar otro administrador.</p>` : ''}
    ${ev === 'pendiente' && !yo ? `<section class="card pad"><h3>Solicitud de cuenta</h3><p class="muted small">Elige el perfil con el que empezará. Podrás ajustar después cada permiso.</p>
      <div class="row gap wrap"><select id="us_perfil_ap" aria-label="Perfil">${D.perfiles.map(p => `<option value="${attr(p.id)}"${p.id === 'rol_consulta' ? ' selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select>${btn('Aprobar', 'us.aprobar', { cls: 'primary', ic: 'ok' })}${btn('Rechazar', 'us.estado', { cls: 'danger-ghost', data: { v: 'rechazado' } })}</div></section>` : ''}
    ${ev !== 'pendiente' && acciones.length && !yo ? `<div class="row gap wrap">${acciones.map(e => btn(ACCION[e], 'us.estado', { cls: e === 'activo' ? 'primary' : e === 'desactivado' || e === 'rechazado' ? 'danger-ghost' : '', data: { v: e } })).join('')}</div>` : ''}
    <h3>Acceso</h3>
    <ul class="ref-list">
      <li>${u.metodo === 'pin' ? 'Entra con un PIN en cada dispositivo activado con un código.' : u.conContrasena ? 'Entra con su contraseña.' : 'Todavía no tiene contraseña: necesita un código de activación.'}</li>
      ${u.codigo ? `<li>Código ${u.codigo.tipo === 'restablecer' ? 'para restablecer la contraseña' : 'de activación'} pendiente: caduca el ${fmtDateTime(u.codigo.exp)}${Date.now() > u.codigo.exp ? ' (<b>caducado</b>)' : ''}.</li>` : ''}
      <li>${u.sesiones} sesión(es) abierta(s).</li>
      ${(u.dispositivos || []).map(d => `<li>PIN en <b>${esc(d.nombre || d.dev)}</b> (desde ${fmtDateTime(d.creado)}${d.ultimo ? ', último uso ' + fmtDateTime(d.ultimo) : ''}) ${can('usuarios.editar') && !yo ? btn('Retirar', 'us.revocarDev', { cls: 'sm danger-ghost', data: { dev: d.dev } }) : ''}</li>`).join('')}
    </ul>
    ${can('usuarios.editar') && !yo ? `<div class="row gap wrap">
      ${['activo', 'invitado', 'caducado', 'suspendido'].includes(ev) ? btn(u.metodo === 'pin' || ev !== 'activo' ? 'Generar código de activación' : 'Generar código para restablecer la contraseña', 'us.codigo', { ic: 'llave' }) : ''}
      ${u.sesiones ? btn('Cerrar todas sus sesiones', 'us.revocar', { ic: 'salir' }) : ''}
      ${btn(u.metodo === 'pin' ? 'Cambiar a contraseña' : 'Cambiar a código + PIN', 'us.metodo', { cls: 'ghost' })}</div>` : ''}
    ${seccionPermisos(u, yo)}
    ${can('auditoria.ver') ? `<h3>Actividad</h3><div class="row">${btn('Ver lo que ha hecho y los cambios en su cuenta', 'us.actividad', { ic: 'bitacora', data: { u: u.usuario } })}</div>` : ''}
  </div>`;
}
/** Permisos agrupados por módulo: perfil + ajustes individuales; muestra de dónde sale cada uno */
function seccionPermisos(u, yo) {
  const editable = can('usuarios.permisos') && !yo && !['rechazado'].includes(u.estadoVisible);
  const perfil = D.perfiles.find(p => p.id === SEL.perfil);
  const base = expandir(new Set(perfil ? normalizarPerfil(perfil).permisos : []));
  const ef = permisosEfectivos({ estado: 'activo', perfil: SEL.perfil || null, ajustes: SEL.ajustes }, D.perfiles);
  const mios = core().permisos(null);
  const fila = ([k, l, , ver]) => {
    const on = ef.has(k); const de = base.has(k);
    const origen = on && !de ? chip('añadido', '#1565C0') : !on && de ? chip('quitado', '#C62828') : '';
    const bloq = !editable || (!on && !mios.has(k));
    return `<label class="chk perm"><input type="checkbox" data-c="us.perm" data-k="${k}"${on ? ' checked' : ''}${bloq ? ' disabled' : ''}${!mios.has(k) && !on ? ' title="No tienes este permiso: no puedes concederlo"' : ''}><span>${esc(l)}${ver ? ' <small class="muted">(consulta)</small>' : ''} ${origen}</span></label>`;
  };
  const alc = SEL.alcance || { tipo: 'todos' };
  return `<h3>Permisos ${SEL.cambiado ? chip('sin guardar', '#E65100') : ''}</h3>
    ${fieldsHtml([{ name: 'perfil', label: 'Perfil (plantilla)', type: 'select', options: [['', 'Sin perfil (ningún permiso)'], ...D.perfiles.map(p => [p.id, p.nombre])], disabled: !editable, attrs: 'data-c="us.perfil"' }], { perfil: SEL.perfil || '' })}
    <p class="muted small">Marca o desmarca para ajustar solo a esta persona. «Añadido» y «quitado» indican lo que cambia respecto a su perfil.</p>
    ${MODULOS.map(m => { const ps = PERMISOS.filter(p => p[2] === m); const n = ps.filter(p => ef.has(p[0])).length;
      return `<details class="perm-mod"${n ? ' open' : ''}><summary><b>${esc(m)}</b> <span class="muted">${n}/${ps.length}</span></summary><div class="perm-grid">${ps.map(fila).join('')}</div></details>`; }).join('')}
    <h4>Preventivos a los que tiene acceso</h4>
    <div class="row gap wrap"><label class="chk"><input type="radio" name="us_alc" value="todos" data-c="us.alcance"${alc.tipo !== 'seleccion' ? ' checked' : ''}${editable ? '' : ' disabled'}><span>Todos</span></label>
      <label class="chk"><input type="radio" name="us_alc" value="seleccion" data-c="us.alcance"${alc.tipo === 'seleccion' ? ' checked' : ''}${editable ? '' : ' disabled'}><span>Solo los elegidos (con su propio perfil en cada uno)</span></label></div>
    ${alc.tipo === 'seleccion' ? `<ul class="ref-list us-alc">${(REG || []).map(r => { const dentro = Object.prototype.hasOwnProperty.call(alc.preventivos || {}, r.pid); return `<li class="row gap wrap"><label class="chk"><input type="checkbox" data-c="us.prev" data-pid="${attr(r.pid)}"${dentro ? ' checked' : ''}${editable ? '' : ' disabled'}><span>${esc(r.nombre)}</span></label>${dentro ? `<select data-c="us.prevPerfil" data-pid="${attr(r.pid)}" aria-label="Perfil en ${attr(r.nombre)}"${editable ? '' : ' disabled'}><option value="">Su perfil general</option>${D.perfiles.map(p => `<option value="${attr(p.id)}"${alc.preventivos[r.pid] === p.id ? ' selected' : ''}>${esc(p.nombre)}</option>`).join('')}</select>` : ''}</li>`; }).join('') || '<li class="muted">No hay preventivos del espacio central en este dispositivo</li>'}</ul>` : ''}
    ${editable ? `<div class="row end gap">${SEL.cambiado ? btn('Descartar', 'us.descartar', { cls: 'ghost' }) : ''}${btn('Guardar permisos', 'us.guardarPermisos', { cls: 'primary', ic: 'ok', disabled: !SEL.cambiado })}</div>` : ''}`;
}
CH['us.perfil'] = el => { SEL.perfil = el.value; SEL.cambiado = true; refreshSheets(); };
CH['us.perm'] = el => {
  const k = el.dataset.k; const perfil = D.perfiles.find(p => p.id === SEL.perfil);
  const base = expandir(new Set(perfil ? normalizarPerfil(perfil).permisos : []));
  const mas = new Set(SEL.ajustes.mas || []); const menos = new Set(SEL.ajustes.menos || []);
  if (el.checked) { menos.delete(k); if (!base.has(k)) mas.add(k); } else { mas.delete(k); if (base.has(k)) menos.add(k); }
  SEL.ajustes = { mas: [...mas], menos: [...menos] }; SEL.cambiado = true; refreshSheets();
};
CH['us.alcance'] = el => { SEL.alcance = el.value === 'seleccion' ? { tipo: 'seleccion', preventivos: (SEL.alcance && SEL.alcance.preventivos) || {} } : { tipo: 'todos' }; SEL.cambiado = true; refreshSheets(); };
CH['us.prev'] = el => { const p = { ...(SEL.alcance.preventivos || {}) }; if (el.checked) p[el.dataset.pid] = null; else delete p[el.dataset.pid]; SEL.alcance = { tipo: 'seleccion', preventivos: p }; SEL.cambiado = true; refreshSheets(); };
CH['us.prevPerfil'] = el => { SEL.alcance.preventivos[el.dataset.pid] = el.value || null; SEL.cambiado = true; refreshSheets(); };
A['us.descartar'] = () => { const u = usuarioSel(); SEL = { id: u.id, perfil: u.perfil || '', ajustes: JSON.parse(JSON.stringify(u.ajustes || { mas: [], menos: [] })), alcance: JSON.parse(JSON.stringify(u.alcance || { tipo: 'todos' })), cambiado: false }; refreshSheets(); };
async function aplicar(promesa, mensaje) { const r = await promesa; const i = D.usuarios.findIndex(x => x.id === r.usuario.id); if (i >= 0) D.usuarios[i] = r.usuario; else D.usuarios.push(r.usuario); if (SEL) SEL.cambiado = false; toast(mensaje, 'ok'); G.render(); refreshSheets(); if (r.codigo) mostrarCodigo(r.usuario, r.codigo); return r; }
A['us.guardarPermisos'] = () => aplicar(core().cambiarUsuarioServidor(SEL.id, { perfil: SEL.perfil || null, ajustes: SEL.ajustes, alcance: SEL.alcance }), 'Permisos guardados en el servidor');
A['us.aprobar'] = () => { const perfil = document.getElementById('us_perfil_ap').value; SEL.perfil = perfil; return aplicar(core().cambiarUsuarioServidor(SEL.id, { estado: 'activo', perfil }), 'Cuenta aprobada'); };
A['us.estado'] = async el => {
  const v = el.dataset.v; const u = usuarioSel();
  const txt = { suspendido: 'No podrá entrar ni sincronizar hasta que se reactive. Sus sesiones se cierran ahora.', desactivado: 'La cuenta deja de funcionar y se cierran sus sesiones. Sus registros se conservan.', rechazado: 'La solicitud se rechaza: no podrá entrar.', activo: 'La cuenta vuelve a funcionar con sus permisos.' }[v];
  if (!(await confirmDlg({ title: ACCION[v] + ' · ' + u.nombre, text: txt, ok: ACCION[v], danger: v !== 'activo' }))) return;
  await aplicar(core().cambiarUsuarioServidor(u.id, { estado: v }), { activo: 'Cuenta activada', suspendido: 'Cuenta suspendida', desactivado: 'Cuenta desactivada', rechazado: 'Solicitud rechazada' }[v]);
};
A['us.codigo'] = async () => { const u = usuarioSel(); await aplicar(core().codigoUsuarioServidor(u.id), 'Código generado'); };
A['us.revocar'] = async () => { const u = usuarioSel(); if (!(await confirmDlg({ title: 'Cerrar sesiones', text: 'Se cerrarán todas las sesiones de ' + u.nombre + ' en todos sus dispositivos. Tendrá que volver a entrar.', ok: 'Cerrar sesiones', danger: true }))) return; await aplicar(core().revocarUsuarioServidor(u.id), 'Sesiones cerradas'); };
A['us.revocarDev'] = async el => { const u = usuarioSel(); if (!(await confirmDlg({ title: 'Retirar el PIN de un dispositivo', text: 'Ese dispositivo dejará de poder entrar con PIN; para volver a usarlo hará falta un código nuevo.', ok: 'Retirar', danger: true }))) return; await aplicar(core().revocarUsuarioServidor(u.id, { dev: el.dataset.dev }), 'Acceso con PIN retirado'); };
A['us.metodo'] = async () => {
  const u = usuarioSel(); const nuevo = u.metodo === 'pin' ? 'password' : 'pin';
  if (!(await confirmDlg({ title: 'Cambiar el método de acceso', text: (nuevo === 'pin' ? 'Pasará a entrar sin contraseña, con un PIN en cada dispositivo.' : 'Pasará a entrar con contraseña.') + ' Se retiran sus credenciales actuales, se cierran sus sesiones y se genera un código para que vuelva a activar su cuenta.', ok: 'Cambiar' }))) return;
  await aplicar(core().cambiarUsuarioServidor(u.id, { metodo: nuevo }), 'Método de acceso cambiado');
};
function mostrarCodigo(u, codigo) {
  openSheet({
    title: 'Código para ' + u.nombre, size: 's',
    render: () => `<div class="codigo-act"><p class="muted">Dáselo en persona o por un canal seguro. <b>Solo sirve una vez</b> y caduca${u.codigo ? ' el ' + fmtDateTime(u.codigo.exp) : ''}. No se volverá a mostrar.</p>
      <p class="recovery" data-codigo>${esc(codigo)}</p>
      <ol class="small"><li>En la pantalla de inicio de sesión, «Tengo un código de activación».</li><li>Usuario <b>${esc(u.usuario)}</b> y este código.</li><li>${u.metodo === 'pin' ? 'Elige un PIN (solo valdrá en ese dispositivo).' : 'Elige la contraseña.'}</li></ol>
      <div class="row gap">${btn('Copiar', 'us.copiarCodigo', { ic: 'copiar', data: { c: codigo } })}<button type="button" class="btn primary" data-a="sheet.close">Hecho</button></div></div>`,
  });
}
A['us.copiarCodigo'] = el => copyText(el.dataset.c);

// ---------- alta ----------
A['us.nuevo'] = () => openSheet({
  title: 'Nuevo usuario', size: 'm',
  render: () => `<form data-f="us.crear">${fieldsHtml([
    { name: 'nombre', label: 'Nombre y apellidos', required: true, maxlength: 80 },
    { name: 'usuario', label: 'Usuario', required: true, attrs: 'autocapitalize="none" spellcheck="false"', help: 'Letras sin acentos, números, punto, guion o @.' },
    { name: 'metodo', label: 'Forma de entrar', type: 'select', options: [['password', 'Con contraseña'], ['pin', 'Sin contraseña: código de un solo uso + PIN en su dispositivo']], attrs: 'data-c="us.metodoAlta"' },
    `<div data-pw>${fieldsHtml([{ name: 'pw', label: 'Contraseña inicial (mínimo 8; vacío = se le dará un código para que la elija)', type: 'password', autocomplete: 'new-password' }])}</div>`,
    { name: 'perfil', label: 'Perfil de permisos', type: 'select', options: [['', 'Sin perfil (ningún permiso)'], ...D.perfiles.map(p => [p.id, p.nombre])], value: 'rol_operador' },
  ], { metodo: 'password', perfil: 'rol_operador' })}
  <div class="row end gap"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">Crear</button></div></form>`,
});
CH['us.metodoAlta'] = el => { const b = el.closest('form').querySelector('[data-pw]'); if (b) b.hidden = el.value === 'pin'; };
F['us.crear'] = async form => {
  const v = readForm(form);
  const r = await core().crearUsuarioServidor({ usuario: v.usuario, nombre: v.nombre, metodo: v.metodo, password: v.metodo === 'password' ? v.pw || null : null, perfil: v.perfil || null });
  closeSheet(); D.usuarios.push(r.usuario); G.render();
  toast('Usuario creado', 'ok');
  if (r.codigo) mostrarCodigo(r.usuario, r.codigo);
};

// ---------- perfiles ----------
let PF = null; // perfiles en edición
function listaPerfiles() {
  const usados = id => D.usuarios.filter(u => u.perfil === id).length;
  return `<p class="muted">Plantillas para asignar permisos de una vez. Cambiar un perfil cambia los permisos de quienes lo usan (salvo sus ajustes individuales).</p>
    ${can('usuarios.permisos') ? `<div class="row end">${btn('Nuevo perfil', 'pf.editar', { cls: 'primary', ic: 'mas_add' })}</div>` : ''}
    <ul class="cat-list">${D.perfiles.map(p => `<li class="cat-row"><div class="grow"><b>${esc(p.nombre)}</b>${p.sistema ? ' ' + chip('del sistema', '#607D8B') : ''}<small class="muted">${expandir(new Set(normalizarPerfil(p).permisos)).size} permisos · ${usados(p.id)} usuario(s)</small></div>
      ${can('usuarios.permisos') ? `<div class="row gap-s">${btn('', 'pf.editar', { cls: 'icon ghost', ic: 'editar', data: { id: p.id }, title: 'Editar' })}${btn('', 'pf.duplicar', { cls: 'icon ghost', ic: 'copiar', data: { id: p.id }, title: 'Duplicar' })}${p.id !== 'rol_admin' && !usados(p.id) ? btn('', 'pf.borrar', { cls: 'icon ghost', ic: 'papelera', data: { id: p.id }, title: 'Eliminar' }) : ''}</div>` : ''}</li>`).join('')}</ul>`;
}
A['pf.editar'] = el => {
  const p = el.dataset.id ? D.perfiles.find(x => x.id === el.dataset.id) : { id: 'perfil_' + Date.now().toString(36), nombre: '', permisos: ['preventivos.ver', 'unidades.ver', 'avisos.ver', 'descansos.ver', 'planos.ver'] };
  PF = { ...JSON.parse(JSON.stringify(normalizarPerfil(p))), nuevo: !el.dataset.id };
  openSheet({ title: PF.nuevo ? 'Nuevo perfil' : 'Perfil · ' + p.nombre, size: 'l', live: true, onClose: () => { PF = null; }, render: () => {
    if (!PF) return '';
    const set = new Set(PF.permisos); const admin = PF.id === 'rol_admin'; const mios = core().permisos(null);
    return `<form data-f="pf.guardar">${fieldsHtml([{ name: 'nombre', label: 'Nombre del perfil', required: true, value: PF.nombre, disabled: admin }])}
      ${admin ? `<p class="note">${icon('candado')} El perfil Administrador siempre tiene todos los permisos.</p>` : ''}
      ${MODULOS.map(m => { const ps = PERMISOS.filter(x => x[2] === m); return `<details class="perm-mod" open><summary><b>${esc(m)}</b> <span class="muted">${ps.filter(x => set.has(x[0])).length}/${ps.length}</span></summary><div class="perm-grid">${ps.map(([k, l, , ver]) => `<label class="chk perm"><input type="checkbox" data-c="pf.perm" data-k="${k}"${set.has(k) ? ' checked' : ''}${admin || (!set.has(k) && !mios.has(k)) ? ' disabled' : ''}><span>${esc(l)}${ver ? ' <small class="muted">(consulta)</small>' : ''}</span></label>`).join('')}</div></details>`; }).join('')}
      <div class="row end gap"><button type="button" class="btn ghost" data-a="sheet.close">Cancelar</button><button class="btn primary">Guardar perfil</button></div></form>`;
  } });
};
CH['pf.perm'] = el => { const s = new Set(PF.permisos); if (el.checked) s.add(el.dataset.k); else s.delete(el.dataset.k); PF.permisos = [...s]; refreshSheets(); };
async function guardarPerfiles(lista, msg) { D.perfiles = await core().guardarPerfilesServidor(lista); closeSheet(); toast(msg, 'ok'); G.render(); }
F['pf.guardar'] = async form => {
  const nombre = (readForm(form).nombre || PF.nombre || '').trim(); if (!nombre) { toast('Pon un nombre al perfil', 'error'); return; }
  const it = { id: PF.id, nombre, permisos: PF.permisos };
  const lista = PF.nuevo ? [...D.perfiles, it] : D.perfiles.map(p => (p.id === PF.id ? { ...p, ...it } : p));
  await guardarPerfiles(lista, 'Perfil guardado');
};
A['pf.duplicar'] = async el => { const p = D.perfiles.find(x => x.id === el.dataset.id); await guardarPerfiles([...D.perfiles, { id: 'perfil_' + Date.now().toString(36), nombre: p.nombre + ' (copia)', permisos: normalizarPerfil(p).permisos.filter(k => core().permisos(null).has(k)) }], 'Perfil duplicado'); };
A['pf.borrar'] = async el => { const p = D.perfiles.find(x => x.id === el.dataset.id); if (!(await confirmDlg({ title: 'Eliminar perfil', text: '¿Eliminar el perfil «' + p.nombre + '»? Ningún usuario lo usa.', ok: 'Eliminar', danger: true }))) return; await guardarPerfiles(D.perfiles.filter(x => x.id !== p.id), 'Perfil eliminado'); };

// ---------- registro de cuentas ----------
function ajustesRegistro() {
  const a = D.ajustes || {};
  return `<section class="card pad"><h2>Solicitudes de cuenta desde el inicio de sesión</h2>
    <p class="muted">Con el registro abierto, cualquiera puede pedir una cuenta desde la pantalla de inicio de sesión. Las solicitudes quedan <b>pendientes y sin permisos</b> hasta que un administrador las aprueba. Hay una comprobación anti-abuso y un límite de solicitudes por hora.</p>
    <label class="switch"><input type="checkbox" data-c="us.registro"${a.registroAbierto ? ' checked' : ''}${can('usuarios.admin') ? '' : ' disabled'}><span>Permitir solicitar una cuenta</span></label>
    ${can('usuarios.admin') ? '' : '<p class="muted small">Solo un administrador puede cambiarlo.</p>'}</section>`;
}
CH['us.registro'] = async el => { D.ajustes = await core().ajustesServidor({ registroAbierto: el.checked }); toast(el.checked ? 'Registro de cuentas abierto' : 'Registro de cuentas cerrado', 'ok'); G.render(); };

// ---------- actividad (auditoría del servidor) ----------
A['us.actividad'] = async el => {
  const regs = await core().auditoriaServidor({ usuario: el.dataset.u });
  openSheet({ title: 'Actividad · ' + el.dataset.u, size: 'l', render: () => tablaAuditoria(regs) });
};
export function tablaAuditoria(regs) {
  return regs.length ? `<div class="scroll"><table class="tbl"><thead><tr><th>Fecha</th><th>Quién</th><th>Acción</th><th>Sobre</th><th>Detalle</th></tr></thead><tbody>${regs.map(r => `<tr><td>${fmtDateTime(r.t)}</td><td>${esc(r.actor ? r.actor.nombre + ' (' + r.actor.usuario + ')' : '—')}</td><td>${esc(r.accion)}</td><td>${esc(r.objetivo || '')}</td><td class="small">${esc([r.antes && 'Antes: ' + r.antes, r.despues && 'Después: ' + r.despues].filter(Boolean).join(' · '))}</td></tr>`).join('')}</tbody></table></div>` : empty('Sin registros');
}
export function invalidarUsuariosServidor() { D = null; REG = null; }
