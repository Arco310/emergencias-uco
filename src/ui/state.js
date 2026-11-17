// Estado compartido de la interfaz y registros de acciones/formularios.
export const G = {
  core: null,          // AppCore
  ui: { route: 'inicio', params: {}, f: {} },   // f: filtros por pantalla
  render: () => { },
  preview: false,      // vista previa (sin almacenamiento fiable ni funciones del dispositivo)
};
/** Acciones de clic: data-a="nombre" */
export const A = {};
/** Envío de formularios: data-f="nombre" */
export const F = {};
/** Cambios en controles: data-c="nombre" */
export const CH = {};
export function filt(screen) { return G.ui.f[screen] || (G.ui.f[screen] = {}); }
