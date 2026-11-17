// Utilidades de prueba: reloj controlado, contexto de comandos y "persistencia" simulada.
import { setClock } from '../../src/core/util.js';
import { HLC } from '../../src/core/hlc.js';
import { Engine } from '../../src/core/engine.js';
import * as C from '../../src/core/commands.js';
import { defaultCatalogs, DEFAULT_PREV_CFG } from '../../src/core/defaults.js';
import { defaultRoles, permsOf } from '../../src/core/perms.js';
import { clone } from '../../src/core/util.js';

export const T0 = Date.UTC(2026, 5, 13, 8, 0, 0);
export const MIN = 60000;

export function makeClock(start = T0) {
  let t = start; setClock(() => t);
  return { now: () => t, advance: ms => { t += ms; return t; }, set: v => { t = v; } };
}
export function mkUser(rol = 'rol_admin', nombre = 'Admin') { return { id: 'usr_' + nombre, nombre, perms: permsOf(defaultRoles(), rol) }; }

/** Dispositivo simulado con su propio motor, reloj HLC y contadores de numeración */
export class Device {
  constructor({ id = 'devA', code = 'A', pid = 'prev_1', mode = 'independiente', user = mkUser(), clock } = {}) {
    this.device = { id, code }; this.pid = pid; this.mode = mode; this.user = user;
    this.hlc = new HLC(id, clock ? clock.now : undefined);
    this.engine = new Engine(); this.localNum = 0; this.ref = 0; this.store = [];
  }
  get ctx() { return { engine: this.engine, user: this.user, device: this.device, hlc: this.hlc, pid: this.pid, mode: this.mode }; }
  get s() { return this.engine.state; }
  /** Ejecuta un comando: valida (dry-run), "persiste" asignando números y aplica */
  run(fn, ...args) {
    const ops = fn(this.ctx, ...args);
    const r = this.engine.dryRun(ops);
    if (!r.ok) throw new Error('dryRun: ' + r.reason);
    for (const op of ops) {
      if (op.nl) op.num = ++this.localNum;
      if (op.nr) op.ref = this.device.code + '-' + (++this.ref);
    }
    this.store.push(...ops);
    this.engine.add(ops);
    return ops;
  }
  /** Ejecuta con otro usuario en el mismo dispositivo */
  as(user, fn) { const prev = this.user; this.user = user; try { return fn(this); } finally { this.user = prev; } }
  receive(ops) { for (const o of ops) this.hlc.recv(o.h); return this.engine.add(ops.map(o => clone(o))); }
}

export function createPrev(dev, { activar = true, unidades = [], cfg = {}, nombre = 'Preventivo de prueba' } = {}) {
  return dev.run(C.prevCreate, {
    datos: { nombre, modalidad: dev.mode, activar, fecha: '2026-06-13', horaInicio: '08:00', horaFin: '20:00' },
    cat: defaultCatalogs(), cfg: { ...clone(DEFAULT_PREV_CFG), ...cfg }, unidades,
  });
}
export function unitByInd(dev, ind) { return Object.values(dev.s.units).find(u => u.ind === ind); }
export { C };
