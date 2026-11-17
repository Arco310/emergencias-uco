// Optimizaciones del motor: deben dar exactamente el mismo resultado que el método completo.
import test from 'node:test';
import assert from 'node:assert/strict';
import { Device, createPrev, makeClock, mkUser, unitByInd, C, MIN } from './helpers.mjs';
import { Engine, applyOp } from '../../src/core/engine.js';
import { clone } from '../../src/core/util.js';
import { generar } from '../perf/rendimiento.mjs';

/** Validación de referencia: copia completa del estado (método anterior) */
function dryRunCompleto(engine, ops) {
  const s = clone(engine.state);
  for (const op of ops) {
    const r = applyOp(s, op, { strict: true, lookup: id => engine.byId.get(id) });
    if (r.status === 'conflict') return { ok: false, reason: r.reason, s };
  }
  return { ok: true, s };
}

test('validación perezosa: mismo resultado que con copia completa y sin modificar el estado', () => {
  const { dev } = generar(12, 40, 7);
  const s = dev.s; const antes = JSON.stringify(s);
  const [u1, u2] = Object.keys(s.units); const av = Object.keys(s.avisos)[0];
  const lotes = [
    C.unitNota(dev.ctx, u1, 'nota'),
    C.unitClave(dev.ctx, u1, 'C6'),
    C.unitColor(dev.ctx, u2, '#123456'),
    C.unitUpdate(dev.ctx, u2, { nombre: 'Nuevo nombre' }),
    C.unitCreate(dev.ctx, { ind: 'NUEVA-1', tipo: 'rt_svb' }),
    C.avisoCreate(dev.ctx, { tipo: 'ta_san', desc: 'Nuevo' }),
    C.avisoNota(dev.ctx, av, 'otra nota'),
  ];
  // Lotes que fallan al validar: datos cambiados mientras se editaban (valor anterior distinto)
  const viejo = clone(C.unitUpdate(dev.ctx, u1, { nombre: 'Otro' })); viejo[0].x.f.nombre.o = 'Nombre que ya no existe';
  lotes.push(viejo);
  const color = clone(C.unitColor(dev.ctx, u1, '#00FF00')); color[0].x.o = '#ABCDEF'; lotes.push(color);
  let rechazados = 0;
  for (const ops of lotes) {
    const a = dev.engine.dryRun(ops); const b = dryRunCompleto(dev.engine, ops); if (!a.ok) rechazados++;
    assert.equal(a.ok, b.ok, 'mismo veredicto para ' + ops[0].k);
    assert.equal(a.reason, b.reason ?? undefined);
    if (a.ok) assert.equal(JSON.stringify(a.state), JSON.stringify(b.s), 'mismo estado resultante para ' + ops[0].k);
    assert.equal(JSON.stringify(s), antes, 'el estado real no se modifica al validar ' + ops[0].k);
  }
  assert.equal(rechazados, 2, 'los dos lotes con datos cambiados se rechazan');
});

test('número asignado por el servidor: actualización directa igual que reconstruir el registro', () => {
  const clock = makeClock();
  const A = new Device({ id: 'devA', code: 'A', mode: 'compartida', clock, user: mkUser('rol_admin', 'Ana') });
  createPrev(A, { unidades: [{ ind: 'AMB-01', tipo: 'rt_svb' }] });
  const creados = [];
  for (let i = 0; i < 6; i++) { clock.advance(MIN); creados.push(A.run(C.avisoCreate, { tipo: 'ta_san', desc: 'Aviso ' + i })[0]); }
  assert.ok(creados.every(o => o.num == null), 'en modo compartido los avisos esperan el número del servidor');
  // Números libres: camino rápido
  creados.slice(0, 4).forEach((o, i) => assert.ok(A.engine.setNumber(o.id, 10 + i)));
  const ref = new Engine(A.engine.ops.map(o => clone(o)));
  assert.equal(JSON.stringify(A.s), JSON.stringify(ref.state));
  assert.equal(A.s.maxNum, 13);
  // Número repetido: se reconstruye y queda el conflicto de número duplicado, igual que antes
  A.engine.setNumber(creados[4].id, 11);
  const ref2 = new Engine(A.engine.ops.map(o => clone(o)));
  assert.equal(JSON.stringify(A.s), JSON.stringify(ref2.state));
  assert.ok(Object.values(A.s.conflicts).some(c => /duplicado: 11/.test(c.motivo)));
  // El índice de números se reconstruye igual al abrir el preventivo
  assert.deepEqual(A.s.numAviso, ref2.state.numAviso);
  assert.equal(unitByInd(A, 'AMB-01').clave, 'C0');
});
