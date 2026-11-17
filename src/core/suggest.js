// Sugerencia de unidades para un aviso. Es informativa: la decisión final es del operador.
import { claveDef, isResting, unitLabel, avisoLabel, liveUnits, restEnd } from './engine.js';
import { isCompatible } from './commands.js';
import { haversineKm, hasCoords, fmtKm } from './geo.js';
import { fmtTime } from './util.js';

export function suggestUnits(s, aviso, t) {
  const out = [];
  for (const u of liveUnits(s)) {
    const r = { u, score: 0, reasons: [], blocked: null, distKm: null, distPlan: null, compatible: true };
    if (aviso.part.some(p => p.u === u.id && p.lib == null)) continue;
    const def = claveDef(s.prev, u.clave);
    if (u.sit !== 'activa') r.blocked = 'Desactivada';
    else if (u.aviso) r.blocked = 'Ocupada en el aviso ' + avisoLabel(s.avisos[u.aviso]);
    else if (isResting(u, t)) r.blocked = 'En descanso hasta ' + fmtTime(restEnd(u.descanso));
    else if (def && def.categoria !== 'disponible') r.blocked = u.clave + ' ' + def.nombre + (u.motivoEsp ? ' (' + u.motivoEsp + ')' : '');
    r.compatible = isCompatible(s, aviso.tipo, u);
    let score = 100;
    if (r.compatible) { score += 40; if (aviso.tipo && (s.prev.cat.tiposAviso.find(x => x.id === aviso.tipo) || {}).compatibles?.length) r.reasons.push('Tipo compatible'); }
    else { score -= 80; r.reasons.push('Tipo no compatible'); }
    if (hasCoords(aviso.loc) && hasCoords(u.loc)) {
      r.distKm = haversineKm(aviso.loc.lat, aviso.loc.lon, u.loc.lat, u.loc.lon);
      score -= Math.min(70, r.distKm * 12); r.reasons.unshift('A ' + fmtKm(r.distKm));
    } else if (aviso.plan && u.plan) {
      r.distPlan = Math.hypot(aviso.plan.x - u.plan.x, aviso.plan.y - u.plan.y);
      score -= Math.min(70, r.distPlan * 140); r.reasons.unshift('En plano a ' + Math.round(r.distPlan * 100) + '%');
    } else score -= 20;
    if (aviso.sector && u.sector === aviso.sector) { score += 25; r.reasons.push('Mismo sector'); }
    r.score = Math.round(score);
    out.push(r);
  }
  return out.sort((a, b) => (!!a.blocked - !!b.blocked) || (b.score - a.score) || unitLabel(a.u).localeCompare(unitLabel(b.u)));
}
