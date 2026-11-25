// Los navegadores actuales compilan el atributo pattern de los <input> con la bandera «v» (unicodeSets),
// más estricta que la «u»: un guion sin escapar dentro de [...] invalida el patrón entero. El navegador
// entonces lo ignora (sin validar) y escribe un error en la consola. Esta prueba compila todos los
// pattern de la interfaz igual que el navegador.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const RAIZ = new URL('../../src/ui/', import.meta.url).pathname;
function archivos(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(e => e.isDirectory() ? archivos(join(dir, e.name)) : e.name.endsWith('.js') ? [join(dir, e.name)] : []);
}
// Los pattern están dentro de literales de cadena JS: «\\» en el código fuente llega al navegador como «\».
const patrones = archivos(RAIZ).flatMap(f => [...readFileSync(f, 'utf8').matchAll(/pattern="([^"]*)"/g)].map(m => ({ f: f.slice(RAIZ.length), p: m[1].replace(/\\\\/g, '\\') })));

test('hay atributos pattern que comprobar', () => { assert.ok(patrones.length >= 3, 'esperaba encontrar los pattern de la interfaz'); });

test('todos los pattern de la interfaz son válidos con la bandera v (como los compila el navegador)', () => {
  const malos = [];
  for (const { f, p } of patrones) { try { new RegExp('^(?:' + p + ')$', 'v'); } catch (e) { malos.push(f + ': ' + p + ' → ' + e.message); } }
  assert.deepEqual(malos, []);
});

test('el pattern del usuario admite lo que admite el servidor (los espacios pasan a puntos)', () => {
  const p = patrones.find(x => x.p.startsWith('[A-Za-z0-9]')); assert.ok(p, 'pattern del usuario');
  const re = new RegExp('^(?:' + p.p + ')$', 'v');
  for (const ok of ['luis', 'Luis.Garcia', 'ana-maria', 'samur@uco', 'juan perez', 'u2']) assert.ok(re.test(ok), ok);
  for (const no of ['-luis', 'l', 'josé', 'a'.repeat(51), 'luis!']) assert.ok(!re.test(no), no);
});
