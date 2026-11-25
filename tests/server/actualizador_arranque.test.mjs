// Pendiente de la 1.3.0: tras instalar una versión nueva del servidor, el panel de actualizaciones seguía
// mostrando la consulta que hizo la versión anterior hasta la siguiente comprobación (cada 6 h).
// Una versión recién instalada debe volver a consultar las versiones publicadas al arrancar; un reinicio
// de la misma versión no hace consultas de más al servicio externo.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { crearActualizador } from '../../server/actualizador.mjs';

const esperar = ms => new Promise(r => setTimeout(r, ms));
/** GitHub simulado: cuenta las consultas y publica la versión indicada */
function github(publicada) {
  const f = async url => {
    f.llamadas.push(url);
    const v = publicada; const nombre = `servidor-uco-windows-v${v}.zip`;
    const j = { tag_name: 'v' + v, published_at: '2026-11-25T10:00:00Z', body: 'Notas', html_url: 'https://example.invalid',
      assets: [{ name: nombre, size: 10, browser_download_url: 'https://example.invalid/' + nombre }, { name: 'SHA256SUMS.txt', size: 10, browser_download_url: 'https://example.invalid/SHA256SUMS.txt' }] };
    return { ok: true, status: 200, json: async () => j };
  };
  f.llamadas = [];
  return f;
}
function datos(estado) {
  const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uco-act-arranque-'));
  fs.mkdirSync(path.join(DATA, '_servidor'), { recursive: true });
  if (estado) fs.writeFileSync(path.join(DATA, '_servidor', 'actualizaciones.json'), JSON.stringify(estado));
  return DATA;
}
const opciones = (DATA, version, fetchImpl) => ({ DATA, BASE: null, version, fetchImpl, api: 'https://api.example.invalid', esperaInicial: 20, salir: () => { } });

test('una versión recién instalada consulta las versiones publicadas al arrancar', async () => {
  // Estado que dejó la versión anterior (1.4.0) con una consulta reciente: anunciaba la 1.5.0
  const DATA = datos({ disponible: { version: '1.5.0', url: 'x', sumas: 'y' }, comprobado: Date.now() - 60000 });
  const gh = github('1.5.1');
  const act = crearActualizador(opciones(DATA, '1.5.0', gh));
  try {
    await esperar(300);
    assert.equal(gh.llamadas.length, 1, 'consulta una vez al arrancar la versión nueva');
    const e = act.estado();
    assert.equal(e.disponible.version, '1.5.1', 'el panel muestra lo publicado ahora, no lo que vio la versión anterior');
    assert.equal(e.actualizable, true);
    assert.equal(JSON.parse(fs.readFileSync(path.join(DATA, '_servidor', 'actualizaciones.json'), 'utf8')).versionComprobada, '1.5.0', 'queda anotada la versión que hizo la consulta');
  } finally { act.detener(); fs.rmSync(DATA, { recursive: true, force: true }); }
});

test('reiniciar la misma versión no repite la consulta (sin consumo innecesario del servicio externo)', async () => {
  const DATA = datos({ disponible: null, comprobado: Date.now() - 60000, versionComprobada: '1.5.0' });
  const gh = github('1.5.0');
  const act = crearActualizador(opciones(DATA, '1.5.0', gh));
  try {
    await esperar(300);
    assert.equal(gh.llamadas.length, 0);
  } finally { act.detener(); fs.rmSync(DATA, { recursive: true, force: true }); }
});

test('sin comprobaciones periódicas (instancia de prueba de una versión) no consulta al arrancar', async () => {
  const DATA = datos({ disponible: null, comprobado: Date.now() - 60000 });
  const gh = github('1.5.1');
  const act = crearActualizador({ ...opciones(DATA, '1.5.0', gh), periodico: false });
  try {
    await esperar(300);
    assert.equal(gh.llamadas.length, 0);
  } finally { act.detener(); fs.rmSync(DATA, { recursive: true, force: true }); }
});
