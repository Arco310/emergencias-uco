// Reloj lógico híbrido (HLC): ordena operaciones de varios dispositivos de forma
// total y determinista, respetando la causalidad aunque los relojes difieran.
import { now } from './util.js';

const W = 15, C = 5;
export function fmtHlc(wall, c, dev) {
  return String(wall).padStart(W, '0') + ':' + String(c).padStart(C, '0') + ':' + dev;
}
export function parseHlc(h) {
  const [w, c, ...d] = String(h).split(':');
  return { wall: Number(w), c: Number(c), dev: d.join(':') };
}

export class HLC {
  constructor(dev, nowFn = now) { this.dev = dev; this.wall = 0; this.c = 0; this.nowFn = nowFn; }
  /** Nueva marca para un evento local */
  tick() {
    const n = this.nowFn();
    if (n > this.wall) { this.wall = n; this.c = 0; } else { this.c++; }
    return fmtHlc(this.wall, this.c, this.dev);
  }
  /** Incorpora una marca recibida (o leída del almacenamiento) */
  recv(h) {
    if (!h) return;
    const r = parseHlc(h); const n = this.nowFn();
    const w = Math.max(this.wall, r.wall, n);
    if (w === this.wall && w === r.wall) this.c = Math.max(this.c, r.c) + 1;
    else if (w === this.wall) this.c = this.c + 1;
    else if (w === r.wall) this.c = r.c + 1;
    else this.c = 0;
    this.wall = w;
  }
}
