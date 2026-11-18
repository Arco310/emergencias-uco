// Alta inicial, inicio de sesión, recuperación de acceso y restauración en un dispositivo nuevo.
import { G, A, F } from '../state.js';
import { esc, toast, openSheet, closeSheet, pickFile, readText, copyText, fieldsHtml, readForm } from '../dom.js';
import { icon } from '../icons.js';
import { APP_NAME, APP_VERSION } from '../../core/defaults.js';

const logo = () => `<svg viewBox="0 0 48 48" width="56" height="56" aria-hidden="true"><rect width="48" height="48" rx="11" fill="#B71C1C"/><path d="M20 9h8v11h11v8H28v11h-8V28H9v-8h11z" fill="#fff"/></svg>`;
let users = null; let setupDone = null; let recoveryShown = null; let modoLocal = false; let consultando = false;
const splash = t => `<div class="splash">${logo()}<p>${esc(t)}</p></div>`;

/** La clave de recuperación debe mostrarse aunque ya exista sesión */
export function blocking() { return !!recoveryShown; }
export function renderAuth() {
  const core = G.core;
  if (setupDone === null) { core.repo.isSetup().then(v => { setupDone = v; G.render(); }); return `<div class="splash">${logo()}<p>Cargando…</p></div>`; }
  if (recoveryShown) return recoveryView();
  if (!setupDone) {
    // Dispositivo nuevo: si el servidor central (preconfigurado) está activo, basta con iniciar sesión
    if (!core.centralConsultado && !modoLocal) {
      if (!consultando) { consultando = true; core.consultarCentral().finally(() => { consultando = false; G.render(); }); }
      return splash('Conectando con el servidor central…');
    }
    const r = core.centralRemoto;
    if (r && r.org && !modoLocal) return centralLoginView(r);
    return setupView(r);
  }
  if (users === null) { core.repo.listUsersPublic().then(u => { users = u.filter(x => x.activo); G.render(); }); return `<div class="splash">${logo()}<p>Cargando…</p></div>`; }
  return `<div class="auth-box">
    <div class="auth-head">${logo()}<h1>${APP_NAME}</h1><p class="muted">${esc(core.device.nombre)} · v${APP_VERSION}</p></div>
    ${G.preview ? `<p class="note warn">${icon('info')} Vista previa: los datos se guardan solo mientras la página esté abierta.</p>` : ''}
    <form data-f="auth.login" class="card pad">
      <div class="fld"><label for="f_u">Usuario</label>
        ${users && users.length <= 12 ? `<select id="f_u" name="u" required>${users.map(u => `<option value="${esc(u.usuario)}">${esc(u.nombre)} (${esc(u.usuario)})</option>`).join('')}</select>` : `<input id="f_u" name="u" autocomplete="username" required autocapitalize="none">`}
      </div>
      <div class="fld"><label for="f_p">Contraseña</label><input id="f_p" name="p" type="password" autocomplete="current-password" required></div>
      <button class="btn primary block">${icon('llave')}<span>Entrar</span></button>
    </form>
    <div class="row center gap wrap"><button class="btn ghost sm" data-a="auth.recover">He olvidado la contraseña</button></div>
    <p class="muted center small">Funciona sin conexión. Los datos se guardan cifrados en este dispositivo.</p>
  </div>`;
}

/** Dispositivo nuevo con el servidor central activo: solo usuario y contraseña */
function centralLoginView(r) {
  return `<div class="auth-box">
    <div class="auth-head">${logo()}<h1>${APP_NAME}</h1><p class="muted">${esc(r.nombre || 'Servidor central')} · v${APP_VERSION}</p></div>
    ${G.preview ? `<p class="note warn">${icon('info')} Vista previa: los datos se guardan solo mientras la página esté abierta.</p>` : ''}
    <form data-f="auth.central" class="card pad">
      ${fieldsHtml([
        { name: 'u', label: 'Usuario', required: true, autocomplete: 'username', attrs: 'autocapitalize="none" spellcheck="false"' },
        { name: 'p', label: 'Contraseña', type: 'password', required: true, autocomplete: 'current-password' },
      ])}
      <details class="small"><summary>Nombre de este dispositivo (opcional)</summary>${fieldsHtml([{ name: 'dev', label: 'Nombre del dispositivo', placeholder: 'p. ej. Tablet puesto de mando' }])}</details>
      <button class="btn primary block">${icon('llave')}<span>Entrar</span></button>
    </form>
    <p class="muted center small">Usa el usuario y la contraseña que te ha dado el administrador. La primera vez se descargan los datos del servidor central; después también funciona sin conexión.</p>
    <div class="row center gap wrap"><button class="btn ghost sm" data-a="auth.local">Usar este dispositivo sin servidor central</button></div>
  </div>`;
}

function setupView(r) {
  const min = G.core.minPassword();
  return `<div class="auth-box wide">
    <div class="auth-head">${logo()}<h1>${APP_NAME}</h1><p class="muted">Configuración inicial de este dispositivo</p></div>
    ${G.preview ? `<p class="note warn">${icon('info')} Vista previa: los datos no se conservan al cerrar la página.</p>` : ''}
    ${r === null && !modoLocal ? `<p class="note">${icon('info')} Sin conexión con el servidor central: el dispositivo se configura en local y podrás conectarlo más tarde (Sistema → Servidor central). <button type="button" class="btn sm ghost" data-a="auth.retryCentral">Reintentar</button></p>` : ''}
    ${r && r.org && modoLocal ? `<p class="note">${icon('info')} Hay un servidor central activo. <button type="button" class="btn sm ghost" data-a="auth.usarCentral">Entrar con mi usuario del servidor central</button></p>` : ''}
    <form data-f="auth.setup" class="card pad">
      <h2>Administrador</h2>
      ${fieldsHtml([
        { name: 'nombre', label: 'Nombre y apellidos', required: true, autocomplete: 'name' },
        { name: 'usuario', label: 'Usuario', required: true, placeholder: 'p. ej. coordinador', autocomplete: 'username' },
        { name: 'p1', label: 'Contraseña (mínimo ' + min + ' caracteres)', type: 'password', required: true, autocomplete: 'new-password' },
        { name: 'p2', label: 'Repite la contraseña', type: 'password', required: true, autocomplete: 'new-password' },
      ])}
      ${r && !r.org && !r.antiguo ? `<h2>Servidor central</h2>${fieldsHtml([{ name: 'codigo', label: 'Código de administración del servidor (opcional)', placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX', attrs: 'autocomplete="off" autocapitalize="characters"', help: 'Actívalo aquí una sola vez para toda la organización: después, en los demás dispositivos bastará con iniciar sesión. También puede hacerse más tarde.' }])}` : ''}
      <h2>Dispositivo</h2>
      ${fieldsHtml([
        { name: 'dev', label: 'Nombre del dispositivo', value: 'Tablet 1', required: true },
        { name: 'code', label: 'Código corto (prefijo de avisos provisionales)', value: G.core.device.code, required: true, maxlength: 4, help: 'Por ejemplo T1. En modalidad compartida los avisos creados sin conexión se numeran T1-1, T1-2… hasta recibir su número definitivo.' },
      ])}
      <button class="btn primary block">${icon('ok')}<span>Crear y entrar</span></button>
    </form>
    <div class="card pad">
      <h2>¿Vienes de otro dispositivo?</h2>
      <p class="muted">Restaura una copia completa cifrada (archivo .ucobak) para recuperar usuarios, preventivos y plantillas.</p>
      <button class="btn" data-a="auth.restoreFile">${icon('subir')}<span>Restaurar copia de seguridad</span></button>
    </div>
  </div>`;
}

function recoveryView() {
  return `<div class="auth-box wide"><div class="card pad">
    <h1>${icon('llave')} Clave de recuperación</h1>
    <p>Guárdala en un lugar seguro (por ejemplo, impresa en el sobre del dispositivo). Es la única forma de recuperar el acceso si se olvidan todas las contraseñas.</p>
    <p class="recovery" id="rec">${esc(recoveryShown)}</p>
    <div class="row gap wrap"><button class="btn" data-a="auth.copyRec">${icon('copiar')}<span>Copiar</span></button></div>
    <label class="switch"><input type="checkbox" id="recok"><span>He guardado la clave de recuperación</span></label>
    <button class="btn primary block" data-a="auth.recDone">${icon('ok')}<span>Continuar</span></button>
  </div></div>`;
}

F['auth.login'] = async form => {
  await G.core.login(form.u.value, form.p.value);
  users = null; await G.afterLogin();
};
F['auth.setup'] = async form => {
  const v = readForm(form);
  if (v.p1 !== v.p2) { toast('Las contraseñas no coinciden', 'error'); return; }
  const r = await G.core.setup({ usuario: v.usuario, nombre: v.nombre, password: v.p1 });
  await G.core.repo.saveDevice({ nombre: v.dev, code: v.code });
  if (v.codigo && v.codigo.trim()) {
    try { await G.core.centralActivar({ codigo: v.codigo, password: v.p1 }); toast('Servidor central activado: en los demás dispositivos basta con iniciar sesión', 'ok', 8000); }
    catch (e) { toast('Dispositivo configurado, pero no se pudo activar el servidor central: ' + e.message + '. Puedes hacerlo después en Sistema → Servidor central.', 'error', 10000); }
  }
  setupDone = true; recoveryShown = r.recovery; G.render();
};
F['auth.central'] = async form => {
  const v = readForm(form);
  toast('Comprobando la cuenta y descargando los datos…', 'info', 5000);
  await G.core.accederCentral(v.u, v.p, { dispositivo: (v.dev || '').trim() });
  setupDone = true; users = null; await G.afterLogin();
};
A['auth.local'] = () => { modoLocal = true; G.render(); };
A['auth.usarCentral'] = () => { modoLocal = false; G.render(); };
A['auth.retryCentral'] = async () => { await G.core.consultarCentral(); G.render(); };
A['auth.copyRec'] = () => copyText(recoveryShown);
A['auth.recDone'] = async () => {
  if (!document.getElementById('recok').checked) { toast('Confirma que has guardado la clave de recuperación', 'error'); return; }
  recoveryShown = null; await G.afterLogin();
};
A['auth.recover'] = () => openSheet({
  title: 'Recuperar acceso', size: 's',
  render: () => `<form data-f="auth.recoverSubmit">
    <p class="muted">Introduce la clave de recuperación que se mostró al configurar el dispositivo.</p>
    ${fieldsHtml([
      { name: 'code', label: 'Clave de recuperación', required: true, placeholder: 'XXXXX-XXXXX-…' },
      { name: 'u', label: 'Usuario', required: true },
      { name: 'p1', label: 'Nueva contraseña', type: 'password', required: true },
      { name: 'p2', label: 'Repite la contraseña', type: 'password', required: true },
    ])}<button class="btn primary block">Restablecer y entrar</button></form>`,
});
F['auth.recoverSubmit'] = async form => {
  const v = readForm(form);
  if (v.p1 !== v.p2) { toast('Las contraseñas no coinciden', 'error'); return; }
  await G.core.recover(v.code, v.u, v.p1);
  closeSheet(); toast('Acceso recuperado', 'ok'); await G.afterLogin();
};
A['auth.restoreFile'] = async () => {
  const file = await pickFile('.ucobak,.json,application/json');
  if (!file) return;
  const text = await readText(file);
  openSheet({
    title: 'Restaurar copia completa', size: 's',
    render: () => `<form data-f="auth.restoreSubmit"><p class="muted">${esc(file.name)}</p>
      ${fieldsHtml([{ name: 'pw', label: 'Contraseña de la copia', type: 'password', required: true }])}
      <button class="btn primary block">${icon('subir')}<span>Restaurar</span></button></form>`,
    onMount: el => { el.querySelector('form')._text = text; },
  });
};
F['auth.restoreSubmit'] = async form => {
  const p = await G.core.repo.parseBackupFile(form._text, form.pw.value);
  await G.core.repo.restore(p, 'reemplazar');
  G.core.repo.dek = null; setupDone = true; users = null;
  closeSheet(); toast('Copia restaurada: inicia sesión con tus credenciales habituales', 'ok', 7000); G.render();
};
