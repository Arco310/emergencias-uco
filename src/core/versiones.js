// Comparación de números de versión «mayor.menor.revisión». La aplicación y el servidor central
// publican el mismo número en cada versión.
export const semver = s => { const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(s || '').trim()); return m ? m.slice(1).map(Number) : null; };
/** -1 si a < b, 0 si son iguales (o alguna no es válida), 1 si a > b */
export function compararVersiones(a, b) {
  const x = semver(a), y = semver(b); if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] < y[i] ? -1 : 1;
  return 0;
}
/** ¿a es una versión posterior a b? */
export const posterior = (a, b) => !!semver(a) && !!semver(b) && compararVersiones(a, b) > 0;
