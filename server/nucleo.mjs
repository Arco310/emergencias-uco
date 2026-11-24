// Lógica compartida con la aplicación que usa el servidor en «modo servidor» (1.4.0).
// En el repositorio reexporta los módulos de src/core; el paquete para Windows lo empaqueta en un solo archivo.
export { Engine, applyOp, lazyCopy } from '../src/core/engine.js';
export { permisosEfectivos, permisosOp, comprobarCambioUsuario, defaultRoles, normalizarPerfil, estadoUsuario, accesoPreventivo, PERM_KEYS, PERM_LABEL } from '../src/core/perms.js';
export { motivoTipoNoDisponible } from '../src/core/recursos.js';
export { orgKeys, prevKeys, open, seal } from '../src/core/crypto.js';
export { unb64, b64 } from '../src/core/util.js';
