// Tipos de recurso y unidades plantilla comunes a todos los dispositivos a través del servidor central.
// Modo anterior (espacio cifrado de extremo a extremo, sin migrar): sigue funcionando en la 1.4.0.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { MemoryAdapter } from '../../src/data/idb.js';
import { AppCore } from '../../src/app/core.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'uco-cfgc-'));
const PORT = 20000 + Math.floor(Math.random() * 300);
const SERVER = `http://127.0.0.1:${PORT}`;
const ADMIN = 'CFGAD-MINPR-UEBAL-OCAL1';
let proc; const cores = [];

async function dispositivo() {
  const c = new AppCore(new MemoryAdapter(), { servidor: SERVER });
  await c.boot(); c.central.cuentaIter = 100000; c.sync.intervalMs = 999999; c.central.intervalMs = 999999;
  cores.push(c); return c;
}
async function arrancarServidor() {
  proc = spawn(process.execPath, [path.join(ROOT, 'server/server.mjs'), '--port', String(PORT), '--data', DATA, '--host', '127.0.0.1', '--quiet'], { stdio: 'ignore', env: { ...process.env, UCO_CODIGO_ADMIN: ADMIN } });
  for (let i = 0; i < 50; i++) { try { if ((await fetch(SERVER + '/api/v1/salud')).ok) return; } catch { } await new Promise(r => setTimeout(r, 100)); }
  throw new Error('servidor no disponible');
}
test.before(arrancarServidor);
test.after(async () => { for (const c of cores) { c.sync.stopAll(); c.central.stop(); clearInterval(c._bk); } proc.kill('SIGTERM'); await new Promise(r => proc.on('exit', r)); fs.rmSync(DATA, { recursive: true, force: true }); });

let A, B, dron, plt;
test('los tipos y plantillas de un dispositivo llegan a un dispositivo nuevo', async () => {
  A = await dispositivo();
  await A.consultarCentral();
  await A.setup({ usuario: 'jefe', nombre: 'Jefa', password: 'clave-jefa-1' });
  dron = await A.crearTipoRecurso({ nombre: 'Dron', categoria: 'Apoyo', color: '#455A64', vis: { icono: 'antena', forma: 'rombo' } });
  await A.centralActivar({ codigo: ADMIN, password: 'clave-jefa-1', modo: 'cifrado' });
  plt = await A.guardarPlantillaUnidad({ nombre: 'DRON', tipo: dron.id, prefijo: 'DRN', color: '#455A64' });
  await A.saveUser({ usuario: 'coord', nombre: 'Coordinador', rol: 'rol_admin', activo: true }, 'clave-coord-1');
  await A.central.syncNow();
  B = await dispositivo();
  await B.accederCentral('coord', 'clave-coord-1');
  assert.ok(B.tiposRecursoGenerales().some(t => t.id === dron.id && t.nombre === 'Dron'), 'tipo creado en A');
  assert.ok(B.plantillasUnidad().some(p => p.id === plt.id && p.prefijo === 'DRN'), 'plantilla creada en A');
  assert.deepEqual(B.plantillasUnidad().map(p => p.nombre), A.plantillasUnidad().map(p => p.nombre), 'mismo orden');
});

test('cambios y bajas se propagan en ambos sentidos', async () => {
  await B.guardarPlantillaUnidad({ ...B.plantillasUnidad().find(p => p.id === plt.id), color: '#000000' });
  await B.guardarTiposRecurso(B.tiposRecursoGenerales().map(t => (t.id === dron.id ? { ...t, nombre: 'Dron de vigilancia' } : t)));
  await B.central.syncNow(); await A.central.syncNow();
  assert.equal(A.plantillasUnidad().find(p => p.id === plt.id).color, '#000000');
  assert.equal(A.tiposRecursoGenerales().find(t => t.id === dron.id).nombre, 'Dron de vigilancia');
  await A.borrarPlantillaUnidad(plt.id);
  await A.central.syncNow(); await B.central.syncNow();
  assert.ok(!B.plantillasUnidad().some(p => p.id === plt.id), 'la plantilla eliminada desaparece también en B');
});

test('dos dispositivos cambian la misma plantilla a la vez: conflicto, sin sobrescribir en silencio', async () => {
  const id = A.plantillasUnidad().find(p => p.nombre === 'UPR').id;
  A.central.stop(); B.central.stop();
  await A.guardarPlantillaUnidad({ ...A.plantillasUnidad().find(p => p.id === id), prefijo: 'UPA' });
  await B.guardarPlantillaUnidad({ ...B.plantillasUnidad().find(p => p.id === id), prefijo: 'UPB' });
  await A.central.syncNow(); await B.central.syncNow();
  const d = await B.central.datos();
  assert.ok(d.conflictos['plt:' + id], 'B ve el conflicto');
  assert.equal(B.plantillasUnidad().find(p => p.id === id).prefijo, 'UPA', 'mientras, B muestra la versión del servidor');
  await B.central.resolverConfig('plt:' + id, 'mio');
  await B.central.syncNow(); await A.central.syncNow();
  assert.equal(A.plantillasUnidad().find(p => p.id === id).prefijo, 'UPB', 'la decisión de B llega a A');
  assert.equal(B.plantillasUnidad().find(p => p.id === id).prefijo, 'UPB');
});

test('los cambios hechos mientras se sincroniza no se pierden (regresión)', async () => {
  A.central.intervalMs = 20; A.central.start();
  const nombres = [];
  for (let i = 0; i < 15; i++) { const n = 'Prueba concurrente ' + i; nombres.push(n); await A.guardarPlantillaUnidad({ nombre: n, prefijo: 'PC' + i }); await new Promise(r => setTimeout(r, 7)); }
  A.central.stop(); await A.central.syncNow();
  const d = await A.central.datos();
  assert.equal(Object.keys(d.pendCfg).length, 0, 'nada queda pendiente');
  await B.central.syncNow();
  for (const n of nombres) assert.ok(B.plantillasUnidad().some(p => p.nombre === n), 'llega ' + n);
});

test('1.4.0: una configuración inicial eliminada desaparece en todos los dispositivos y no vuelve', async () => {
  await A.eliminarTipoRecurso('rt_sp_papa', { modo: 'conPlantillas' });
  await A.central.syncNow(); await B.central.syncNow();
  assert.ok(!B.tiposRecursoGenerales().some(t => t.id === 'rt_sp_papa'), 'el tipo desaparece en B');
  assert.ok(!B.plantillasUnidad().some(p => p.id === 'plt_sp_papa'), 'y su plantilla');
  assert.ok(B.cfg.eliminados.tiposRecurso.includes('rt_sp_papa') && B.cfg.eliminados.plantillasUnidad.includes('plt_sp_papa'), 'B lo anota como eliminado');
  // Un dispositivo nuevo (con los valores iniciales) no lo recupera ni lo vuelve a publicar
  const N = await dispositivo();
  await N.accederCentral('coord', 'clave-coord-1');
  assert.ok(!N.tiposRecursoGenerales().some(t => t.id === 'rt_sp_papa'), 'tampoco en un dispositivo nuevo');
  assert.ok(N.cfg.eliminados.tiposRecurso.includes('rt_sp_papa'));
  // Si algo local lo reintroduce (p. ej. una migración de una versión antigua), al iniciar sesión se vuelve a quitar
  const cfg = structuredClone(B.cfg); cfg.catalogos.tiposRecurso.push({ id: 'rt_sp_papa', nombre: 'PAPA · Unidad de psiquiatría' }); cfg.eliminados.tiposRecurso = [];
  await B.repo.saveCfg(cfg, 'prueba'); B.cfg = await B.repo.getCfg();
  await B._afterLogin();
  assert.ok(!B.tiposRecursoGenerales().some(t => t.id === 'rt_sp_papa'), 'la baja del espacio se aplica de nuevo');
  await B.central.syncNow(); await A.central.syncNow();
  assert.ok(!A.tiposRecursoGenerales().some(t => t.id === 'rt_sp_papa'), 'nadie lo republica');
  // El servidor se reinicia (p. ej. se apaga el PC): la baja sigue guardada en su disco
  proc.kill('SIGTERM'); await new Promise(r => proc.on('exit', r)); await arrancarServidor();
  const R2 = await dispositivo(); await R2.accederCentral('coord', 'clave-coord-1');
  assert.ok(!R2.tiposRecursoGenerales().some(t => t.id === 'rt_sp_papa'), 'tras reiniciar el servidor sigue eliminado');
  await A.central.syncNow();
  assert.ok(!A.tiposRecursoGenerales().some(t => t.id === 'rt_sp_papa'), 'y no reaparece en quien ya lo tenía');
  // Restaurarlo es una decisión explícita que también llega a todos
  await A.restaurarIniciales({ tiposRecurso: ['rt_sp_papa'], plantillasUnidad: ['plt_sp_papa'] });
  await A.central.syncNow(); await B.central.syncNow();
  assert.ok(B.tiposRecursoGenerales().some(t => t.id === 'rt_sp_papa') && B.plantillasUnidad().some(p => p.id === 'plt_sp_papa'));
  assert.ok(!B.cfg.eliminados.tiposRecurso.includes('rt_sp_papa'));
});
