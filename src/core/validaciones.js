// Detección de incoherencias operativas (1.5.0). Solo detecta, explica y propone: nunca cambia datos ni
// genera operaciones. El mismo módulo se usa en el dispositivo y en el servidor (modo servidor).
// Catálogo ampliable: cada regla dice qué ocurre, por qué es incoherente, qué consecuencias puede tener y
// qué se recomienda; su nivel, su umbral y si está activa se pueden ajustar por preventivo (cfg.reglas).
import { claveDef, isResting, unitLabel, avisoLabel, liveUnits, SECTOR_OTROS } from './engine.js';

export const NIVELES = {
  info: { nombre: 'Información', orden: 1, color: '#1565C0' },
  moderada: { nombre: 'Moderada', orden: 2, color: '#B26A00' },
  alta: { nombre: 'Alta', orden: 3, color: '#D84315' },
  critica: { nombre: 'Crítica', orden: 4, color: '#B71C1C' },
};
export const GRUPOS_REGLA = { unidades: 'Unidades', avisos: 'Avisos', descansos: 'Descansos', preventivo: 'Preventivo', sincronizacion: 'Sincronización' };
const MIN = 60000;
const uRef = u => ({ k: 'u', id: u.id, nombre: unitLabel(u) });
const aRef = a => ({ k: 'a', id: a.id, nombre: 'Aviso ' + avisoLabel(a) });
const pRef = s => ({ k: 'prev', id: s.prev.id, nombre: s.prev.nombre });
const activo = a => a.estado !== 'finalizado' && a.finalizadoEn == null;
const avisosActivos = s => Object.values(s.avisos).filter(activo);
const unidadesNoEliminadas = s => Object.values(s.units).filter(u => !u.eliminada);
/** Avisos activos en los que la unidad participa ahora (sin liberar) */
const avisosDe = (s, u) => avisosActivos(s).filter(a => a.part.some(p => p.u === u.id && p.lib == null) || u.aviso === a.id);
const asigDe = (a, u) => (a.part.find(p => p.u === u.id && p.lib == null) || {}).asig || a.creado;
const inicioAviso = a => a.t ?? a.creado;

export const REGLAS = [
  // ---------------- Unidades ----------------
  {
    id: 'unidad_disponible_con_aviso', grupo: 'unidades', nivel: 'alta',
    titulo: 'Unidad «disponible» con un aviso activo',
    porque: 'Su clave dice que está disponible, pero sigue asignada a un aviso que no ha terminado.',
    consecuencias: 'Puede asignarse a otro aviso o darse por libre mientras todavía está trabajando.',
    recomendacion: 'Confirma con la unidad si sigue en el aviso y cambia su clave o libérala del aviso.',
    detectar: ({ s }) => liveUnits(s).flatMap(u => {
      const def = claveDef(s.prev, u.clave); if (!def || def.categoria !== 'disponible') return [];
      return avisosDe(s, u).map(a => ({ entidad: uRef(u), desde: asigDe(a, u), detalle: `${unitLabel(u)} está en ${u.clave} (${def.nombre}) y asignada al aviso ${avisoLabel(a)}` })).slice(0, 1);
    }),
  },
  {
    id: 'unidad_inactiva_con_aviso', grupo: 'unidades', nivel: 'alta',
    titulo: 'Unidad desactivada o archivada asignada a un aviso',
    porque: 'Una unidad fuera de servicio no debería figurar trabajando en un aviso activo.',
    consecuencias: 'El aviso puede darse por atendido sin ningún recurso real.',
    recomendacion: 'Libera la unidad del aviso y asigna otra disponible, o reactívala si en realidad está operativa.',
    detectar: ({ s }) => unidadesNoEliminadas(s).filter(u => u.sit !== 'activa').flatMap(u => avisosDe(s, u).slice(0, 1).map(a => ({ entidad: uRef(u), desde: asigDe(a, u), detalle: `${unitLabel(u)} (${u.sit}) figura en el aviso ${avisoLabel(a)}` }))),
  },
  {
    id: 'unidad_sin_datos', grupo: 'unidades', nivel: 'info',
    titulo: 'Unidad sin datos mínimos',
    porque: 'Le falta el indicativo o el tipo de recurso.',
    consecuencias: 'No se puede filtrar, sugerir ni contar bien en las estadísticas.',
    recomendacion: 'Completa la ficha de la unidad.',
    detectar: ({ s }) => liveUnits(s).filter(u => !String(u.ind || '').trim() || !u.tipo).map(u => ({ entidad: uRef(u), desde: u.creado || null, detalle: [!String(u.ind || '').trim() && 'sin indicativo', !u.tipo && 'sin tipo de recurso'].filter(Boolean).join(' y ') })),
  },
  {
    id: 'referencia_inexistente', grupo: 'unidades', nivel: 'alta',
    titulo: 'Sector o tipo que ya no existe',
    porque: 'La unidad o el aviso apunta a un sector o tipo que no está en los catálogos del preventivo.',
    consecuencias: 'Puede no aparecer en los filtros, el plano o los informes por sector.',
    recomendacion: 'Asígnale un sector o tipo válido desde su ficha.',
    detectar: ({ s }) => {
      const sec = new Set((s.prev.cat.sectores || []).map(x => x.id)); const tr = new Set((s.prev.cat.tiposRecurso || []).map(x => x.id)); const ta = new Set((s.prev.cat.tiposAviso || []).map(x => x.id));
      const malo = (x, tipos) => [x.sector && x.sector !== SECTOR_OTROS && !sec.has(x.sector) && 'sector «' + x.sector + '»', x.tipo && !tipos.has(x.tipo) && 'tipo «' + x.tipo + '»'].filter(Boolean);
      return [...liveUnits(s).map(u => [uRef(u), malo(u, tr)]), ...avisosActivos(s).map(a => [aRef(a), malo(a, ta)])].filter(([, m]) => m.length).map(([e, m]) => ({ entidad: e, desde: null, detalle: e.nombre + ': ' + m.join(' y ') + ' no existe' }));
    },
  },
  {
    id: 'unidad_sin_cambios', grupo: 'unidades', nivel: 'info', umbral: 180,
    titulo: 'Unidad ocupada sin cambios desde hace mucho',
    porque: 'Lleva mucho tiempo en una clave de trabajo sin ninguna actualización.',
    consecuencias: 'Su información puede estar desactualizada.',
    recomendacion: 'Contacta con la unidad y actualiza su clave.',
    detectar: ({ s, t, umbral }) => s.prev.estado !== 'activo' ? [] : liveUnits(s).filter(u => { const d = claveDef(s.prev, u.clave); return d && d.categoria === 'ocupada' && u.claveDesde && t - u.claveDesde >= umbral; })
      .map(u => ({ entidad: uRef(u), desde: u.claveDesde, detalle: `${unitLabel(u)} en ${u.clave} desde hace ${Math.round((t - u.claveDesde) / MIN)} min` })),
  },
  // ---------------- Avisos ----------------
  {
    id: 'unidad_en_dos_avisos', grupo: 'avisos', nivel: 'critica',
    titulo: 'La misma unidad en dos avisos activos',
    porque: 'Una unidad solo puede estar trabajando en un aviso a la vez.',
    consecuencias: 'Uno de los avisos puede quedar sin atender mientras parece cubierto.',
    recomendacion: 'Decide en qué aviso está realmente y libérala del otro; asigna otra unidad si hace falta.',
    detectar: ({ s }) => liveUnits(s).flatMap(u => { const l = avisosDe(s, u); return l.length < 2 ? [] : [{ entidad: uRef(u), desde: Math.max(...l.map(a => asigDe(a, u))), detalle: `${unitLabel(u)} figura a la vez en los avisos ${l.map(avisoLabel).join(' y ')}` }]; }),
  },
  {
    id: 'aviso_sin_unidad', grupo: 'avisos', nivel: 'moderada', umbral: 15,
    titulo: 'Aviso sin unidad asignada',
    porque: 'El aviso sigue pendiente y nadie lo atiende.',
    consecuencias: 'Retraso en la atención.',
    recomendacion: 'Asigna una unidad (verás las sugeridas en el aviso) o finalízalo si ya no procede.',
    detectar: ({ s, t, umbral }) => avisosActivos(s).filter(a => a.estado === 'pendiente' && !a.part.some(p => p.lib == null) && t - inicioAviso(a) >= umbral)
      .map(a => ({ entidad: aRef(a), desde: inicioAviso(a), detalle: `Aviso ${avisoLabel(a)} pendiente desde hace ${Math.round((t - inicioAviso(a)) / MIN)} min` })),
  },
  {
    id: 'aviso_abierto_demasiado', grupo: 'avisos', nivel: 'moderada', umbral: 120,
    titulo: 'Aviso abierto demasiado tiempo',
    porque: 'Supera la duración máxima establecida para un aviso.',
    consecuencias: 'Puede que se olvidara finalizarlo y las unidades sigan figurando ocupadas.',
    recomendacion: 'Comprueba si sigue en curso; si terminó, finalízalo y libera sus unidades.',
    detectar: ({ s, t, umbral }) => avisosActivos(s).filter(a => t - inicioAviso(a) >= umbral).map(a => ({ entidad: aRef(a), desde: inicioAviso(a), detalle: `Aviso ${avisoLabel(a)} abierto desde hace ${Math.round((t - inicioAviso(a)) / MIN)} min` })),
  },
  {
    id: 'aviso_sin_unidades_en_curso', grupo: 'avisos', nivel: 'alta',
    titulo: 'Aviso asignado o en curso sin unidades',
    porque: 'Su estado indica que alguien lo atiende, pero no tiene ninguna unidad asignada.',
    consecuencias: 'Parece cubierto cuando no lo está.',
    recomendacion: 'Asigna una unidad o devuelve el aviso a pendiente.',
    detectar: ({ s }) => avisosActivos(s).filter(a => ['asignado', 'en_curso'].includes(a.estado) && !a.part.some(p => p.lib == null)).map(a => ({ entidad: aRef(a), desde: a.enCursoEn || a.asignadoEn || inicioAviso(a), detalle: `Aviso ${avisoLabel(a)} en estado «${a.estado}» sin unidades` })),
  },
  {
    id: 'aviso_posible_duplicado', grupo: 'avisos', nivel: 'info', umbral: 5,
    titulo: 'Posible aviso duplicado',
    porque: 'Hay dos avisos activos del mismo tipo, creados casi a la vez y en el mismo sitio o sector.',
    consecuencias: 'Se pueden enviar recursos dos veces al mismo incidente.',
    recomendacion: 'Revisa ambos; si son el mismo, finaliza uno indicando que está duplicado.',
    detectar: ({ s, umbral }) => {
      const l = avisosActivos(s).filter(a => a.tipo).sort((a, b) => a.creado - b.creado); const out = [];
      for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
        const a = l[i]; const b = l[j]; if (a.tipo !== b.tipo || b.creado - a.creado > umbral) continue;
        const cerca = (a.sector && a.sector === b.sector) || (a.plan && b.plan && Math.hypot(a.plan.x - b.plan.x, a.plan.y - b.plan.y) < 0.03);
        if (cerca) out.push({ entidad: aRef(b), desde: b.creado, detalle: `Aviso ${avisoLabel(b)} parecido al ${avisoLabel(a)} (mismo tipo, mismo lugar, ${Math.round((b.creado - a.creado) / 1000)} s después)` });
      }
      return out;
    },
  },
  {
    id: 'aviso_incompleto', grupo: 'avisos', nivel: 'info', umbral: 10,
    titulo: 'Aviso sin ubicación',
    porque: 'No tiene ubicación, posición en el plano ni sector.',
    consecuencias: 'Las unidades pueden no saber adónde ir y no se puede sugerir la más cercana.',
    recomendacion: 'Añade la ubicación, el sector o sitúalo en el plano.',
    detectar: ({ s, t, umbral }) => avisosActivos(s).filter(a => !a.plan && !a.zona && !a.sector && !(a.loc && (a.loc.txt || a.loc.lat != null)) && t - inicioAviso(a) >= umbral)
      .map(a => ({ entidad: aRef(a), desde: inicioAviso(a), detalle: `Aviso ${avisoLabel(a)} sin ubicación ni sector` })),
  },
  // ---------------- Descansos ----------------
  {
    id: 'descanso_con_aviso', grupo: 'descansos', nivel: 'critica',
    titulo: 'Unidad en descanso con un aviso activo',
    porque: 'Una unidad con un aviso activo no puede estar descansando.',
    consecuencias: 'El aviso puede quedar sin atender o la unidad trabajar sin descanso real.',
    recomendacion: 'Decide si la unidad sigue en el aviso (finaliza el descanso) o descansa (libérala y asigna otra).',
    detectar: ({ s, t }) => liveUnits(s).filter(u => isResting(u, t)).flatMap(u => avisosDe(s, u).slice(0, 1).map(a => ({ entidad: uRef(u), desde: Math.max(u.descanso.ini, asigDe(a, u)), detalle: `${unitLabel(u)} descansa desde las ${hora(u.descanso.ini)} y está en el aviso ${avisoLabel(a)}` }))),
  },
  {
    id: 'descanso_duracion', grupo: 'descansos', nivel: 'info',
    titulo: 'Descanso con una duración incoherente',
    porque: 'La duración no es razonable (nula, negativa o muy superior a lo habitual).',
    consecuencias: 'La unidad puede quedar fuera de servicio sin que nadie lo note, y las estadísticas salen mal.',
    recomendacion: 'Revisa el descanso y finalízalo si ya terminó.',
    detectar: ({ s, t }) => liveUnits(s).filter(u => { const d = u.descanso; if (!d) return false; const max = Math.max(180, 3 * ((s.prev.cfg && s.prev.cfg.descansoMin) || 30)); return (isResting(u, t) && !(d.dur > 0 && d.dur <= max)) || (d.fin != null && d.fin < d.ini); })
      .map(u => ({ entidad: uRef(u), desde: u.descanso.ini, detalle: `${unitLabel(u)}: descanso de ${u.descanso.dur} min` })),
  },
  {
    id: 'descanso_y_clave', grupo: 'descansos', nivel: 'moderada',
    titulo: 'Cambio de clave durante el descanso',
    porque: 'La unidad cambió de clave mientras figuraba descansando.',
    consecuencias: 'No queda claro si estaba descansando o trabajando.',
    recomendacion: 'Comprueba qué pasó y finaliza el descanso si la unidad volvió al servicio.',
    detectar: ({ s, t }) => liveUnits(s).filter(u => isResting(u, t) && (u.hc || []).some(h => h.t > u.descanso.ini && !h.auto)).map(u => ({ entidad: uRef(u), desde: u.descanso.ini, detalle: `${unitLabel(u)} pasó a ${u.clave} durante el descanso` })),
  },
  // ---------------- Preventivo ----------------
  {
    id: 'finalizado_con_pendientes', grupo: 'preventivo', nivel: 'alta',
    titulo: 'Preventivo finalizado con asuntos abiertos',
    porque: 'Está finalizado, pero quedan avisos activos, unidades ocupadas o en descanso, o cambios sin enviar.',
    consecuencias: 'El informe final y las estadísticas pueden no reflejar lo que realmente pasó.',
    recomendacion: 'Reábrelo para cerrar lo pendiente o anota en las observaciones por qué se finalizó así.',
    detectar: ({ s, t, sync }) => {
      if (s.prev.estado !== 'cerrado') return [];
      const av = avisosActivos(s).length; const des = liveUnits(s).filter(u => isResting(u, t)).length; const pend = (sync.pendientes && sync.pendientes.n) || 0;
      return av || des || pend ? [{ entidad: pRef(s), desde: s.prev.cerradoEn || null, detalle: [av && av + ' aviso(s) activo(s)', des && des + ' unidad(es) en descanso', pend && pend + ' cambio(s) sin enviar'].filter(Boolean).join(', ') }] : [];
    },
  },
  {
    id: 'sector_no_valido', grupo: 'preventivo', nivel: 'moderada',
    titulo: 'Sectores mal configurados',
    porque: 'Hay sectores con el mismo nombre o con una delimitación de menos de 3 puntos.',
    consecuencias: 'Las unidades y avisos pueden asignarse al sector equivocado.',
    recomendacion: 'Revisa los sectores del preventivo.',
    detectar: ({ s }) => {
      const l = s.prev.cat.sectores || []; const nombres = l.map(x => String(x.nombre || '').trim().toLowerCase());
      const mal = l.filter((x, i) => !nombres[i] || nombres.indexOf(nombres[i]) !== i || (x.zona && !(x.zona.pts && x.zona.pts.length >= 3)));
      return mal.length ? [{ entidad: pRef(s), desde: null, detalle: mal.map(x => x.nombre || x.id).join(', ') }] : [];
    },
  },
  {
    id: 'ubicaciones_duplicadas', grupo: 'preventivo', nivel: 'info',
    titulo: 'Puntos del plano repetidos',
    porque: 'Hay puntos con el mismo nombre o en el mismo sitio.',
    consecuencias: 'Puede elegirse el punto equivocado al ubicar un aviso.',
    recomendacion: 'Quita o renombra los repetidos.',
    detectar: ({ s }) => {
      const l = s.prev.cat.puntos || []; const rep = new Set();
      for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
        const a = l[i]; const b = l[j];
        if (String(a.nombre).trim().toLowerCase() === String(b.nombre).trim().toLowerCase() || (a.pos && b.pos && Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < 0.002)) { rep.add(a.nombre); rep.add(b.nombre); }
      }
      return rep.size ? [{ entidad: pRef(s), desde: null, detalle: [...rep].join(', ') }] : [];
    },
  },
  // ---------------- Sincronización (datos del dispositivo) ----------------
  {
    id: 'rechazos_sin_revisar', grupo: 'sincronizacion', nivel: 'alta',
    titulo: 'Cambios rechazados por el servidor sin revisar',
    porque: 'El servidor no aceptó cambios hechos en este dispositivo (p. ej. sin conexión con permisos o datos ya caducados).',
    consecuencias: 'Lo que se hizo no consta para los demás.',
    recomendacion: 'Revísalos en Sistema → Servidor central y vuelve a hacer lo que siga haciendo falta.',
    detectar: ({ s, sync }) => { const l = (sync.rechazos || []).filter(r => !r.revisado); return l.length ? [{ entidad: pRef(s), desde: Math.min(...l.map(r => r.t || 0)) || null, detalle: l.length + ' cambio(s): ' + l.slice(0, 3).map(r => (r.que || r.k) + ' — ' + r.error).join('; ') }] : []; },
  },
  {
    id: 'conflicto_pendiente', grupo: 'sincronizacion', nivel: 'alta',
    titulo: 'Cambios simultáneos por resolver',
    porque: 'Dos dispositivos cambiaron lo mismo a la vez y hay que elegir qué versión se conserva.',
    consecuencias: 'Mientras tanto, cada dispositivo puede estar viendo un dato distinto.',
    recomendacion: 'Resuélvelos en el aviso de conflictos del preventivo.',
    detectar: ({ s }) => { const l = Object.values(s.conflicts || {}).filter(c => c.estado === 'pendiente'); return l.length ? [{ entidad: pRef(s), desde: Math.min(...l.map(c => c.t || 0)) || null, detalle: l.length + ' conflicto(s) pendiente(s)' }] : []; },
  },
  {
    id: 'cambios_sin_enviar', grupo: 'sincronizacion', nivel: 'moderada', umbral: 10,
    titulo: 'Cambios de este dispositivo sin enviar',
    porque: 'Hay cambios guardados aquí que todavía no han llegado al servidor.',
    consecuencias: 'Los demás dispositivos no los ven; el estado local y el confirmado son distintos.',
    recomendacion: 'Comprueba la conexión; se enviarán solos al volver.',
    detectar: ({ s, t, sync, umbral }) => { const p = sync.pendientes; return p && p.n > 0 && p.desde && t - p.desde >= umbral ? [{ entidad: pRef(s), desde: p.desde, detalle: p.n + ' cambio(s) pendientes desde hace ' + Math.round((t - p.desde) / MIN) + ' min' }] : []; },
  },
  {
    id: 'sin_sincronizar', grupo: 'sincronizacion', nivel: 'moderada', umbral: 15,
    titulo: 'Datos sin sincronizar desde hace tiempo',
    porque: 'Este dispositivo no se comunica con el servidor desde hace un rato.',
    consecuencias: 'Lo que ves puede estar desactualizado respecto a los demás.',
    recomendacion: 'Comprueba la conexión y el estado del servidor central.',
    detectar: ({ s, t, sync, umbral }) => sync.compartido && sync.ultimoSync && t - sync.ultimoSync >= umbral ? [{ entidad: pRef(s), desde: sync.ultimoSync, detalle: 'Última sincronización hace ' + Math.round((t - sync.ultimoSync) / MIN) + ' min' }] : [],
  },
];
function hora(t) { const d = new Date(t); return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0'); }

/** Incoherencias del preventivo: una por regla y elemento, ordenadas por nivel y antigüedad */
export function detectarIncoherencias(s, { t = Date.now(), sync = {} } = {}) {
  if (!s || !s.prev) return [];
  const cfg = (s.prev.cfg && s.prev.cfg.reglas) || {}; const out = []; const vistos = new Set();
  for (const r of REGLAS) {
    const c = cfg[r.id] || {};
    if (c.activa === false) continue;
    const umbral = c.umbral != null ? c.umbral : r.umbral;
    let hs;
    try { hs = r.detectar({ s, t, sync: sync || {}, umbral: umbral != null ? umbral * MIN : null }) || []; } catch { hs = []; } // una regla con un fallo no impide las demás
    for (const h of hs) {
      const id = r.id + ':' + h.entidad.k + ':' + h.entidad.id; if (vistos.has(id)) continue; vistos.add(id);
      const firma = id + '|' + (h.desde || 0); const rev = s.revisiones && s.revisiones[id];
      out.push({ id, regla: r.id, grupo: r.grupo, nivel: NIVELES[c.nivel] ? c.nivel : r.nivel, titulo: r.titulo, porque: r.porque, consecuencias: r.consecuencias, recomendacion: r.recomendacion, entidad: h.entidad, desde: h.desde || null, detalle: h.detalle, firma, revision: rev && rev.firma === firma ? rev : null });
    }
  }
  return out.sort((a, b) => NIVELES[b.nivel].orden - NIVELES[a.nivel].orden || (a.desde || 0) - (b.desde || 0));
}
/** Resumen para un distintivo: cuántas sin revisar y el nivel más alto */
export function resumenIncoherencias(lista) {
  const abiertas = lista.filter(h => !h.revision || h.revision.estado === 'abierta' || h.revision.estado === 'asignada');
  const max = abiertas.reduce((m, h) => (!m || NIVELES[h.nivel].orden > NIVELES[m].orden ? h.nivel : m), null);
  return { n: abiertas.length, nivel: max };
}
