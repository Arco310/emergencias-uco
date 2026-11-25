// Gestor de Emergencias UCO · modo servidor (generado por build.mjs a partir de server/espacio-servidor.mjs y src/core)

// server/espacio-servidor.mjs
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

// src/core/util.js
function randomBytes(n) {
  const a = new Uint8Array(n);
  globalThis.crypto.getRandomValues(a);
  return a;
}
function clone(v) {
  if (v === void 0) return void 0;
  if (typeof structuredClone === "function") return structuredClone(v);
  return JSON.parse(JSON.stringify(v));
}
function stableStringify(v) {
  if (v === void 0) return "null";
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return "[" + v.map(stableStringify).join(",") + "]";
  const keys = Object.keys(v).filter((k) => v[k] !== void 0).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + stableStringify(v[k])).join(",") + "}";
}
function same(a, b) {
  return stableStringify(a ?? null) === stableStringify(b ?? null);
}
function getPath(obj, path2) {
  return path2.split(".").reduce((o, k) => o == null ? void 0 : o[k], obj);
}
function setPath(obj, path2, val) {
  const ks = path2.split(".");
  let o = obj;
  for (let i = 0; i < ks.length - 1; i++) {
    if (o[ks[i]] == null || typeof o[ks[i]] !== "object") o[ks[i]] = {};
    o = o[ks[i]];
  }
  if (val === void 0) delete o[ks[ks.length - 1]];
  else o[ks[ks.length - 1]] = val;
}
function b64(bytes) {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  const CH = 32768;
  for (let i = 0; i < u.length; i += CH) s += String.fromCharCode.apply(null, u.subarray(i, i + CH));
  return btoa(s);
}
function unb64(str) {
  const s = atob(str);
  const u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u;
}
var enc = new TextEncoder();
var dec = new TextDecoder();
function hex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
var AppError = class extends Error {
  constructor(msg, code = "error", extra) {
    super(msg);
    this.code = code;
    this.extra = extra;
  }
};

// src/core/incidentes.js
var G = (codigo, nombre, color, items) => ({ codigo, nombre, color, items });
var GRUPOS_INCIDENTE = [
  G("1", "Accidente de Tr\xE1fico", "#EF6C00", [
    ["1.1", "Accidente sin especificar"],
    ["1.2", "Accidente con menos de 3 v\xEDctimas"],
    ["1.3", "Accidente con tres o m\xE1s v\xEDctimas confirmadas"],
    ["1.4", "Atropello"],
    ["1.5", "Accidente de motocicleta"],
    ["1.6", "Accidente de bicicleta"],
    ["1.6.1", "Accidente de patinete"],
    ["1.7", "Accidente de autob\xFAs"],
    ["1.8", "Accidente con veh\xEDculo pesado"]
  ]),
  G("2", "Accidente no de tr\xE1fico", "#D84315", [
    ["2.1", "Heridas"],
    ["2.2", "Atrapamientos / enterramientos"],
    ["2.3", "Casual: ca\xEDda, etc."],
    ["2.4", "Agresi\xF3n sin especificar"],
    ["2.4.1", "Agresi\xF3n por spray de autodefensa"],
    ["2.5", "Arma blanca"],
    ["2.6", "Arma de fuego"],
    ["2.7", "Precipitado"],
    ["2.8", "Autolisis traum\xE1tica"],
    ["2.9", "Arrollamiento por metro o tren"],
    ["2.10", "Quemado"],
    ["2.11", "Electrocuci\xF3n"],
    ["2.12", "Ahogamiento"],
    ["2.12.1", "OVACE"],
    ["2.13", "Agresi\xF3n sexual"],
    ["2.13.1", "Agresi\xF3n sexual facilitada por drogas"],
    ["2.14", "Dispositivos el\xE9ctricos de control policial"]
  ]),
  G("3", "Enfermedad", "#C62828", [
    ["3.1", "Parada cardiorrespiratoria"],
    ["3.2", "Inconsciente sin filiar causa"],
    ["3.3", "Infarto o Patolog\xEDa coronaria"],
    ["3.4", "Convulsi\xF3n"],
    ["3.5", "Intoxicaci\xF3n por drogas de abuso"],
    ["3.6", "Intoxicaci\xF3n por f\xE1rmacos y/o productos t\xF3xicos"],
    ["3.7", "Autolisis no traum\xE1tica"],
    ["3.8", "Urgencias endocrino-metab\xF3licas"],
    ["3.9", "Intoxicaci\xF3n et\xEDlica"],
    ["3.10", "Otros"],
    ["3.11", "Patolog\xEDa respiratoria"],
    ["3.12", "Patolog\xEDa cardiovascular"],
    ["3.13", "Patolog\xEDa neurol\xF3gica"],
    ["3.14", "Patolog\xEDa digestiva"],
    ["3.15", "Patolog\xEDa obst\xE9trica"],
    ["3.16", "Patolog\xEDa ginecol\xF3gica"],
    ["3.17", "Patolog\xEDa urol\xF3gica"],
    ["3.18", "Patolog\xEDa infecciosa"],
    ["3.19", "Patolog\xEDa psicosom\xE1tica"],
    ["3.20", "Patolog\xEDa anafil\xE1ctica"],
    ["3.21", "Patolog\xEDas por agentes f\xEDsicos (Fr\xEDo/Calor)"]
  ]),
  G("4", "Espec\xEDfica de bomberos o colectivos", "#795548", [
    ["4.1", "Incendio"],
    ["4.2", "Explosi\xF3n"],
    ["4.3", "Apertura de puerta"],
    ["4.4", "Derrumbamientos"],
    ["4.5", "Servicios especiales"],
    ["4.6", "Preventivos"],
    ["4.7", "Riesgo qu\xEDmico"],
    ["4.8", "Riesgo nuclear"],
    ["4.9", "Riesgo biol\xF3gico"],
    ["4.10", "Incendio con v\xEDctimas confirmadas"],
    ["4.11", "Petici\xF3n de apoyo por parte de bomberos"]
  ]),
  G("5", "Psiqui\xE1trico y sociosanitario", "#6A1B9A", [
    ["5.1", "Orden judicial"],
    ["5.2", "Orden m\xE9dica"],
    ["5.3", "Orden m\xE9dica urgente / orden m\xE9dica en paciente muy agresivo"],
    ["5.4", "Certificaci\xF3n psiqui\xE1trica"],
    ["5.5", "Problema social"],
    ["5.6", "Huelga de hambre"],
    ["5.7", "Violencia de g\xE9nero"],
    ["5.8", "Maltrato a menores"],
    ["5.9", "Atenci\xF3n sociosanitaria a personas mayores en riesgo social o con sospecha de maltrato"],
    ["5.10", "Desamparo sobrevenido en persona dependiente"]
  ]),
  G("6", "Cad\xE1ver", "#37474F", [
    ["6.1", "Domicilio"],
    ["6.2", "V\xEDa p\xFAblica"],
    ["6.3", "Local p\xFAblico (incluye centro sanitario)"],
    ["6.4", "Fallecimiento personas sin hogar con independencia lugar del suceso"]
  ]),
  G("7", "Especiales", "#263238", [
    ["7.1", "Amenaza de bomba"],
    ["7.2", "Atentado explosivo"],
    ["7.3", "Otro tipo de atentado"],
    ["7.4", "Accidente de tren"],
    ["7.5", "Accidente de avi\xF3n"],
    ["7.6", "Accidente de transporte de mercanc\xEDas peligrosas"]
  ]),
  G("8", "Servicios programados", "#1565C0", [
    ["8.1", "Presencia de una unidad, sin SVA ni PSA"],
    ["8.2", "Presencia de 2 o 3 unidades, sin SVA ni PSA"],
    ["8.3", "Presencia de m\xE1s de 3 unidades, sin SVA ni PSA"],
    ["8.4", "Presencia de una o m\xE1s unidades SVA, sin PSA, sin sobrepasar 3 recursos en total"],
    ["8.4.1", "Presencia de una o m\xE1s unidades SVA, sin PSA, sumando m\xE1s de 3 recursos en total"],
    ["8.5", "Despliegue de PSA, con o sin otras unidades (m\xE1ximo 3 recursos en total)"],
    ["8.5.1", "Despliegue de PSA, con otros recursos (m\xE1s de 3 recursos en total)"],
    ["8.6", "Presencia de todos los medios y recursos de SAMUR-Protecci\xF3n Civil"],
    ["8.7", "Servicio preventivo desde el operativo ordinario"],
    ["8.8", "Emergencia en la ciudad de Madrid con necesidad de refuerzo de medios (orden de Directivo de Guardia)"],
    ["8.9", "Emergencia con refuerzo de medios (orden de Directivo de Guardia) fuera de la ciudad de Madrid"],
    ["8.10", "CECOR externo en dispositivo de riesgo previsible"],
    ["8.11", "CECOR interno en dispositivo de riesgo previsible"],
    ["8.12", "Servicio de an\xE1lisis de riesgos"],
    ["AS-1.1", "Identificaci\xF3n y registro de riesgos espec\xEDficos para planes de distrito (zonas inundables, heladas, etc.)", "8.12"],
    ["AS-1.2", "Identificaci\xF3n de riesgos en zona/local ante futura celebraci\xF3n de evento de riesgo previsible", "8.12"],
    ["8.13", "Servicio de seguimiento de riesgos"],
    ["AS-2.1", "Riesgos meteorol\xF3gicos: nevadas", "8.13"],
    ["AS-2.2", "Riesgos meteorol\xF3gicos: lluvias torrenciales", "8.13"],
    ["AS-2.3", "Riesgos meteorol\xF3gicos: otras, a indicar", "8.13"],
    ["AS-3.1", "Riesgos antr\xF3picos: manifestaciones", "8.13"],
    ["AS-3.2", "Riesgos antr\xF3picos: concentraciones", "8.13"],
    ["AS-3.3", "Riesgos antr\xF3picos: fiestas", "8.13"],
    ["AS-3.4", "Riesgos antr\xF3picos: otros", "8.13"],
    ["AS-4.1", "Simulacros de evacuaci\xF3n: verificaci\xF3n de instalaciones", "8.13"],
    ["AS-4.2", "Simulacros de evacuaci\xF3n: activaci\xF3n en tiempo real", "8.13"],
    ["AS-4.3", "Simulacros de evacuaci\xF3n: mixto, verificaci\xF3n y activaci\xF3n", "8.13"],
    ["8.14", "Servicio de formaci\xF3n/divulgaci\xF3n externa"],
    ["8.15", "Servicio de log\xEDstica y otros"]
  ]),
  G("9", "Donaci\xF3n de \xF3rganos", "#00838F", [["9", "Donante en asistolia"]]),
  G("10", "Componentes heridos", "#283593", [
    ["10.1", "SAMUR - Protecci\xF3n Civil"],
    ["10.2", "Polic\xEDa Municipal"],
    ["10.3", "Bombero de Madrid"],
    ["10.4", "Polic\xEDa Nacional"],
    ["10.5", "Otras instituciones"]
  ]),
  G("15", "Psicol\xF3gicos", "#AD1457", [
    ["15.1", "Atenci\xF3n psicol\xF3gica a la v\xEDctima primaria"],
    ["15.2", "Atenci\xF3n psicol\xF3gica a familiares y allegados"],
    ["15.3", "Atenci\xF3n psicol\xF3gica a implicados"],
    ["15.4", "Atenci\xF3n psicol\xF3gica a testigos"],
    ["15.5", "Atenci\xF3n psicol\xF3gica a intervinientes de SAMUR-Protecci\xF3n Civil"],
    ["15.6", "Atenci\xF3n psicol\xF3gica a intervinientes de Cuerpos y Fuerzas de Seguridad"],
    ["15.7", "Atenci\xF3n psicol\xF3gica a intervinientes de Bomberos"],
    ["15.8", "Programa de Sensibilizaci\xF3n y Reeducaci\xF3n vial"],
    ["15.9", "Colaboraci\xF3n del Romeo en el suceso sin paciente \xABin situ\xBB"],
    ["15.10", "Activaci\xF3n/Presencia del Romeo en situaci\xF3n de preventivo"]
  ])
];
var idIncidente = (codigo) => "inc_" + String(codigo).toLowerCase().replace(/[^a-z0-9]+/g, "_");
var nombreGrupo = (g) => g.codigo + ". " + g.nombre;
function tiposAvisoIncidentes() {
  const out = [];
  for (const g of GRUPOS_INCIDENTE) for (const [codigo, nombre, padre] of g.items) {
    const it = { id: idIncidente(codigo), codigo, nombre, grupo: nombreGrupo(g), color: g.color, compatibles: [] };
    if (padre) {
      it.padre = padre;
      it.cierre = true;
    }
    out.push(it);
  }
  return out;
}
var POR_ID = new Map(tiposAvisoIncidentes().map((t) => [t.id, t]));

// src/core/defaults.js
var DEFAULT_VIS = {
  icono: "ambulancia",
  forma: "circulo",
  tam: "m",
  borde: "normal",
  etiqueta: "indicativo",
  tarjeta: "compacta",
  campos: ["tipo", "sector", "clave", "aviso", "ubicacion", "descanso"],
  enPlano: true
};
var DEFAULT_TIPOS_RECURSO = [
  { id: "rt_svb", nombre: "Ambulancia SVB", categoria: "Sanitario", subtipos: ["SVB", "Colectiva"], caracteristicas: ["Camilla", "DEA", "Ox\xEDgeno"], color: "#2E7D32", vis: { icono: "ambulancia", forma: "circulo", tam: "m" } },
  { id: "rt_sva", nombre: "Ambulancia SVA", categoria: "Sanitario", subtipos: ["SVA", "SVAE"], caracteristicas: ["M\xE9dico", "Enfermer\xEDa", "DEA", "Ox\xEDgeno"], color: "#1B5E20", vis: { icono: "ambulancia", forma: "hexagono", tam: "m" } },
  { id: "rt_vir", nombre: "Veh\xEDculo de intervenci\xF3n r\xE1pida", categoria: "Sanitario", subtipos: [], caracteristicas: ["DEA"], color: "#00897B", vis: { icono: "coche", forma: "circulo", tam: "m" } },
  { id: "rt_coord", nombre: "Veh\xEDculo de coordinaci\xF3n", categoria: "Mando", subtipos: [], caracteristicas: ["Radio"], color: "#283593", vis: { icono: "mando", forma: "rombo", tam: "m" } },
  { id: "rt_log", nombre: "Veh\xEDculo log\xEDstico", categoria: "Log\xEDstica", subtipos: [], caracteristicas: [], color: "#5D4037", vis: { icono: "camion", forma: "cuadrado", tam: "m" } },
  { id: "rt_transp", nombre: "Unidad de transporte", categoria: "Log\xEDstica", subtipos: [], caracteristicas: [], color: "#6D4C41", vis: { icono: "furgoneta", forma: "cuadrado", tam: "m" } },
  { id: "rt_eqsan", nombre: "Equipo sanitario", categoria: "Sanitario", subtipos: ["A pie", "En bicicleta"], caracteristicas: ["Mochila SVB", "DEA"], color: "#43A047", vis: { icono: "cruz", forma: "circulo", tam: "s" } },
  { id: "rt_eqint", nombre: "Equipo de intervenci\xF3n", categoria: "Intervenci\xF3n", subtipos: [], caracteristicas: [], color: "#E65100", vis: { icono: "equipo", forma: "triangulo", tam: "m" } },
  { id: "rt_com", nombre: "Unidad de comunicaciones", categoria: "Comunicaciones", subtipos: [], caracteristicas: ["Repetidor"], color: "#455A64", vis: { icono: "antena", forma: "escudo", tam: "m" } },
  { id: "rt_psa", nombre: "Puesto sanitario (PSA)", categoria: "Sanitario", subtipos: [], caracteristicas: ["Camillas"], color: "#AD1457", vis: { icono: "tienda", forma: "cuadrado", tam: "l" } },
  { id: "rt_vl", nombre: "Veh\xEDculo ligero", categoria: "Apoyo", subtipos: [], caracteristicas: [], color: "#1565C0", vis: { icono: "coche", forma: "triangulo", tam: "m" } }
];
var SAMUR = [
  // [prefijo, nombre, categoría, color, icono, forma, tamaño, subtipos]
  ["BASE", "Base de unidades", "Base", "#546E7A", "bandera", "cuadrado", "l"],
  ["SAMUR", "USVA / Directivo de Guardia", "Sanitario", "#1B5E20", "ambulancia", "hexagono", "m", ["USVA", "Directivo de Guardia"]],
  ["VIR", "Veh\xEDculo de intervenci\xF3n r\xE1pida", "Sanitario", "#004D40", "coche", "circulo", "m"],
  ["ALFA", "USVB", "Sanitario", "#2E7D32", "ambulancia", "circulo", "m", ["USVB"]],
  ["PAPA", "Unidad de psiquiatr\xEDa", "Sanitario", "#880E4F", "ambulancia", "rombo", "m"],
  ["TANGO", "Veh\xEDculo de transporte", "Log\xEDstica", "#6D4C41", "furgoneta", "cuadrado", "m"],
  ["MIKE", "Coche de mando", "Mando", "#283593", "mando", "rombo", "m"],
  ["ECO", "Equipo sanitario a pie", "Sanitario", "#43A047", "pie", "circulo", "s"],
  ["LINCE", "Equipo sanitario en bicicleta", "Sanitario", "#7CB342", "bici", "circulo", "s"],
  ["HALC\xD3N", "Equipo sanitario en moto", "Sanitario", "#558B2F", "moto", "triangulo", "s"],
  ["URO", "Personal y veh\xEDculo de mantenimiento", "Log\xEDstica", "#8D6E63", "furgoneta", "cuadrado", "m"],
  ["ZUL\xDA", "Personal conductor de veh\xEDculos pesados de la columna sanitaria", "Log\xEDstica", "#4E342E", "camion", "cuadrado", "m"],
  ["VRALA", "Veh\xEDculo r\xE1pido de apoyo log\xEDstico y avituallamiento", "Log\xEDstica", "#827717", "furgoneta", "triangulo", "m"],
  ["PM", "Puesto de Mando", "Mando", "#1A237E", "mando", "escudo", "l"],
  ["PMA", "Puesto M\xE9dico Avanzado", "Sanitario", "#AD1457", "tienda", "cuadrado", "l"],
  ["VAIS", "Veh\xEDculo de Apoyo Intervenci\xF3n Sanitaria", "Sanitario", "#00695C", "camion", "cuadrado", "m"]
];
var idSamur = (pref) => pref.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
var TIPOS_RECURSO_SAMUR = SAMUR.map(([pref, nombre, categoria, color, icono, forma, tam, subtipos = []]) => ({ id: "rt_sp_" + idSamur(pref), nombre: pref + " \xB7 " + nombre, categoria, subtipos, caracteristicas: [], color, vis: { icono, forma, tam } }));
var PLANTILLAS_SAMUR = SAMUR.map(([pref, nombre, , color, icono, forma, tam]) => ({ id: "plt_sp_" + idSamur(pref), nombre: pref + " \xB7 " + nombre, activo: true, tipo: "rt_sp_" + idSamur(pref), prefijo: pref, color, vis: { forma, icono, tam }, campos: [], obligatorios: [], valores: { subtipo: "", caract: [] } }));
DEFAULT_TIPOS_RECURSO.push(...TIPOS_RECURSO_SAMUR);
var DEFAULT_PLANTILLAS_UNIDAD = [
  { id: "plt_upr", nombre: "UPR", activo: true, tipo: "rt_vl", prefijo: "UPR", color: "#1565C0", vis: { forma: "triangulo", icono: "coche" }, campos: [], obligatorios: [], valores: { subtipo: "", caract: [] } },
  { id: "plt_svb", nombre: "Soporte Vital B\xE1sico (SVB)", activo: true, tipo: "rt_svb", prefijo: "SVB", color: "#2E7D32", vis: { forma: "circulo", icono: "ambulancia" }, campos: [], obligatorios: [], valores: { subtipo: "SVB", caract: ["Camilla", "DEA", "Ox\xEDgeno"] } },
  { id: "plt_vires", nombre: "VIRES", activo: true, tipo: "rt_vir", prefijo: "VIRES", color: "#00897B", vis: { forma: "circulo", icono: "coche" }, campos: [], obligatorios: [], valores: { subtipo: "", caract: ["DEA"] } },
  ...PLANTILLAS_SAMUR
];
var DEFAULT_TIPOS_AVISO = [
  ...tiposAvisoIncidentes(),
  { id: "ta_san", nombre: "Asistencia sanitaria", color: "#C62828", compatibles: [] },
  { id: "ta_tras", nombre: "Traslado", color: "#6A1B9A", compatibles: ["rt_svb", "rt_sva", "rt_transp"] },
  { id: "ta_acc", nombre: "Accidente", color: "#EF6C00", compatibles: [] },
  { id: "ta_inc", nombre: "Incendio", color: "#D84315", compatibles: [] },
  { id: "ta_desap", nombre: "Persona desaparecida", color: "#00838F", compatibles: [] },
  { id: "ta_seg", nombre: "Seguridad", color: "#283593", compatibles: [] },
  { id: "ta_log", nombre: "Log\xEDstica", color: "#5D4037", compatibles: [] },
  { id: "ta_otro", nombre: "Otro", color: "#546E7A", compatibles: [] }
];
var DEFAULT_PREV_CFG = {
  descansoMin: 30,
  autoFinalizarAviso: false,
  camposTarjeta: [...DEFAULT_VIS.campos],
  kpis: ["total", "disponibles", "ocupadas", "descanso", "especial", "fuera", "pendientes", "activos", "finalizados", "sectores"],
  avisoCompatibilidadEstricta: false
};
var DEFAULT_CATEGORIAS_PUNTO = [
  { id: "cp_acceso", nombre: "Accesos y salidas", grupo: "interes", color: "#2E7D32", icono: "salir" },
  { id: "cp_encuentro", nombre: "Punto de encuentro", grupo: "interes", color: "#00838F", icono: "equipo" },
  { id: "cp_puesto", nombre: "Puesto sanitario", grupo: "interes", color: "#C62828", icono: "cruz" },
  { id: "cp_coordinacion", nombre: "Punto de coordinaci\xF3n", grupo: "interes", color: "#283593", icono: "antena" },
  { id: "cp_restringida", nombre: "Zona restringida", grupo: "interes", color: "#6A1B9A", icono: "candado", zona: true },
  { id: "cp_riesgo", nombre: "Zona de riesgo", grupo: "interes", color: "#E65100", icono: "alerta", zona: true },
  { id: "cp_otro_interes", nombre: "Otros puntos de inter\xE9s", grupo: "interes", color: "#546E7A", icono: "pin" },
  { id: "cp_hospital", nombre: "Hospital", grupo: "apoyo", color: "#B71C1C", icono: "cruz" },
  { id: "cp_centro", nombre: "Centro sanitario", grupo: "apoyo", color: "#AD1457", icono: "cruz" },
  { id: "cp_asistencia", nombre: "Puesto de asistencia", grupo: "apoyo", color: "#D84315", icono: "tienda" },
  { id: "cp_abastecimiento", nombre: "Punto de abastecimiento", grupo: "apoyo", color: "#4E342E", icono: "camion" },
  { id: "cp_apoyo", nombre: "Recurso de apoyo", grupo: "apoyo", color: "#1565C0", icono: "escudo" },
  { id: "cp_otro_apoyo", nombre: "Otras ubicaciones de apoyo", grupo: "apoyo", color: "#455A64", icono: "pin" }
];

// src/core/engine.js
var Reject = class extends Error {
  constructor(msg, detail) {
    super(msg);
    this.detail = detail;
  }
};
var CLOSED_OK = /* @__PURE__ */ new Set(["prev.estado", "prev.archivo"]);
var SIEMPRE_OK = /* @__PURE__ */ new Set(["informe.reg"]);
var PREV_FIELDS = /^(nombre|descripcion|fecha|horaInicio|horaFin|lugar|participantes|modalidad|cfg\.[A-Za-z0-9_.]+)$/;
var UNIT_FIELDS = /^(ind|nombre|denom|tipo|subtipo|categoria|sector|sectorOtro|desc|obs|equip|caract|vis(\.[A-Za-z0-9_]+)?)$/;
var SECTOR_OTROS = "otros";
var AVISO_FIELDS = /^(tipo|desc|t|loc|sector|obs|zona|cierre\.[a-z]+)$/;
var CATALOGOS = ["claves", "motivosEsp", "sectores", "tiposAviso", "tiposRecurso", "categoriasPunto", "puntos"];
function emptyState() {
  return { prev: null, units: {}, avisos: {}, conflicts: {}, maxNum: 0, lastT: 0, numAviso: {}, revisiones: {}, informes: [] };
}
function claveDef(prev, code) {
  return (prev && prev.cat && prev.cat.claves || []).find((c) => c.codigo === code) || null;
}
function baseClave(prev) {
  return (prev && prev.cat && prev.cat.claves || []).find((c) => c.base) || { codigo: "C0", nombre: "Disponible", categoria: "disponible", base: true };
}
function alAsignarClave(prev) {
  return (prev && prev.cat && prev.cat.claves || []).find((c) => c.alAsignar) || null;
}
function isResting(u, t) {
  const d = u && u.descanso;
  return !!(d && d.fin == null && t < d.finPrev);
}
function activePart(a, uid) {
  return a.part.find((p) => p.u === uid && p.lib == null) || null;
}
function activeParts(a) {
  return a.part.filter((p) => p.lib == null);
}
function unitLabel(u) {
  return u ? u.ind || u.nombre || u.id : "?";
}
function avisoLabel(a) {
  return a ? a.num != null ? "N\xBA " + a.num : a.ref ? a.ref + " (prov.)" : "sin n\xFAmero" : "?";
}
function liveUnits(s) {
  return Object.values(s.units).filter((u) => !u.eliminada && u.sit !== "archivada");
}
function getUnit(s, id) {
  const u = s.units[id];
  if (!u) throw new Reject("Unidad inexistente");
  if (u.eliminada) throw new Reject("La unidad " + unitLabel(u) + " fue eliminada");
  return u;
}
function getAviso(s, id) {
  const a = s.avisos[id];
  if (!a) throw new Reject("Aviso inexistente");
  return a;
}
function applyFields(target, f, allowed) {
  for (const path2 of Object.keys(f || {})) if (!allowed.test(path2)) throw new Reject("Campo no modificable: " + path2);
  const conflicts = [];
  let changed = 0;
  for (const [path2, ch] of Object.entries(f || {})) {
    const cur = getPath(target, path2);
    if (same(cur, ch.o)) {
      setPath(target, path2, clone(ch.n));
      changed++;
    } else if (same(cur, ch.n)) {
    } else conflicts.push({ campo: path2, actual: clone(cur ?? null), propuesto: clone(ch.n ?? null), anterior: clone(ch.o ?? null) });
  }
  return { conflicts, changed };
}
function setClave(s, u, code, t, motivo, op, auto) {
  const old = claveDef(s.prev, u.clave);
  const def = claveDef(s.prev, code);
  u.clave = code;
  u.claveDesde = t;
  u.motivoEsp = def && def.requiereMotivo ? motivo || null : null;
  u.hc.push({ t, c: code, m: motivo || null, op: op.id, auto: auto || null });
  if (u.aviso) {
    const a = s.avisos[u.aviso];
    const p = a && activePart(a, u.id);
    if (a && p) {
      if (old && old.llegada && !(def && def.llegada)) {
        p.salida = t;
        a.salidaPuntoEn = Math.max(a.salidaPuntoEn || 0, t);
      }
      if (def && def.llegada && p.llegada == null) {
        p.llegada = t;
        if (a.llegadaEn == null) a.llegadaEn = t;
      }
      if (def && def.avisoEnCurso && a.enCursoEn == null) a.enCursoEn = t;
      if (def && def.liberaAviso) releasePart(s, a, u, t, "Clave " + code);
      avisoEstado(s, a, t);
    }
  }
}
function releasePart(s, a, u, t, motivo) {
  const p = activePart(a, u.id);
  if (!p) return;
  const cur = claveDef(s.prev, u.clave);
  if (cur && cur.llegada && p.salida == null) {
    p.salida = t;
    a.salidaPuntoEn = Math.max(a.salidaPuntoEn || 0, t);
  }
  p.lib = t;
  p.motivoLib = motivo || null;
  if (u.aviso === a.id) u.aviso = null;
  if (!activeParts(a).length && s.prev.cfg && s.prev.cfg.autoFinalizarAviso && a.enCursoEn != null && a.finalizadoEn == null) {
    a.finalizadoEn = t;
    a.finAuto = true;
  }
}
function avisoEstado(s, a, t) {
  let e;
  if (a.finalizadoEn != null) e = "finalizado";
  else if (a.enCursoEn != null) e = "en_curso";
  else if (activeParts(a).length) e = "asignado";
  else e = "pendiente";
  if (e !== a.estado) {
    a.hist.push({ t, o: a.estado, n: e });
    a.estado = e;
  }
}
function registerConflict(s, op, tipo, motivo, detalle) {
  s.conflicts[op.id] = {
    id: op.id,
    k: op.k,
    e: op.e,
    t: op.t,
    h: op.h,
    dev: op.dn || op.d,
    usuario: op.u ? op.u.n : "",
    tipo,
    motivo,
    detalle: detalle == null ? null : clone(detalle),
    estado: "pendiente"
  };
}
var H = {};
H["prev.create"] = (s, op) => {
  if (s.prev) throw new Reject("El preventivo ya existe");
  const p = clone(op.x.prev);
  p.id = op.p;
  p.creado = op.t;
  p.creadoPor = op.u ? op.u.n : "";
  p.estado = "preparacion";
  p.archivado = false;
  p.reaperturas = [];
  p.cfg = p.cfg || {};
  p.cat = p.cat || {};
  if (!Array.isArray(p.cat.categoriasPunto)) p.cat.categoriasPunto = clone(DEFAULT_CATEGORIAS_PUNTO);
  for (const c of CATALOGOS) if (!Array.isArray(p.cat[c])) p.cat[c] = [];
  if (!p.cat.claves.some((c) => c.base)) throw new Reject("El cat\xE1logo de claves no tiene clave base (C0)");
  s.prev = p;
};
H["informe.reg"] = (s, op) => {
  const x = op.x || {};
  const r = { id: op.id, accion: x.accion, formato: x.formato || null, t: op.t, por: op.u ? op.u.n : "", dev: op.dn || op.d || "" };
  for (const k of ["n", "hash", "motivo", "provisional", "pendientes", "conflictos", "nOps"]) if (x[k] != null) r[k] = x[k];
  s.informes = [...s.informes || [], r];
};
H["revision.set"] = (s, op) => {
  const x = op.x || {};
  if (!x.id || !x.firma) throw new Reject("Revisi\xF3n no v\xE1lida");
  s.revisiones = s.revisiones || {};
  const cur = s.revisiones[x.id];
  const base = cur && cur.firma === x.firma ? cur : { id: x.id, firma: x.firma, regla: x.regla || "", entidad: x.entidad || null, hist: [] };
  const e = { t: op.t, por: op.u ? op.u.n : "", estado: x.estado, nota: x.nota || "", asignadoA: x.asignadoA || null };
  s.revisiones[x.id] = { ...base, estado: x.estado, nota: x.nota || "", asignadoA: x.asignadoA || (x.estado === "asignada" ? null : base.asignadoA || null), t: op.t, por: e.por, hist: [...base.hist, e] };
};
H["prev.update"] = (s, op) => {
  const r = applyFields(s.prev, op.x.f, PREV_FIELDS);
  return { fieldConflicts: r.conflicts, noop: !r.changed && !r.conflicts.length };
};
var PREV_TRANS = { preparacion: ["activo", "cerrado"], activo: ["cerrado"], cerrado: ["activo"] };
H["prev.estado"] = (s, op) => {
  const p = s.prev;
  const { o, n, motivo } = op.x;
  if (p.estado !== o) {
    if (p.estado === n) return { noop: true };
    throw new Reject("Cambio de estado simult\xE1neo del preventivo (actual: " + p.estado + ")");
  }
  if (!(PREV_TRANS[o] || []).includes(n)) throw new Reject("Transici\xF3n de preventivo no permitida: " + o + " \u2192 " + n);
  if (p.archivado) throw new Reject("El preventivo est\xE1 archivado");
  if (o === "cerrado" && n === "activo") {
    if (!motivo) throw new Reject("La reapertura requiere motivo");
    p.reaperturas.push({ t: op.t, por: op.u ? op.u.n : "", motivo });
  }
  p.estado = n;
  if (n === "activo" && p.activadoEn == null) p.activadoEn = op.t;
  if (n === "cerrado") {
    p.cerradoEn = op.t;
    p.cerradoPor = op.u ? op.u.n : "";
    p.cierreAvisos = op.x.advertencias || null;
  }
};
H["prev.archivo"] = (s, op) => {
  const p = s.prev;
  const n = !!op.x.n;
  if (p.archivado === n) return { noop: true };
  if (n && p.estado === "activo") throw new Reject("Cierra el preventivo antes de archivarlo");
  p.archivado = n;
  p.archivadoEn = n ? op.t : null;
};
H["prev.cat"] = (s, op) => {
  const { cat, o, n } = op.x;
  if (!CATALOGOS.includes(cat)) throw new Reject("Cat\xE1logo desconocido");
  const cur = s.prev.cat[cat];
  if (!same(cur, o)) {
    if (same(cur, n)) return { noop: true };
    return { fieldConflicts: [{ campo: "cat." + cat, actual: clone(cur), propuesto: clone(n), anterior: clone(o) }] };
  }
  if (cat === "claves") {
    if (!n.some((c) => c.base)) throw new Reject("Debe existir la clave base (C0)");
    const codes = new Set(n.map((c) => c.codigo));
    if (codes.size !== n.length) throw new Reject("C\xF3digos de clave duplicados");
    for (const u of Object.values(s.units)) if (!u.eliminada && !codes.has(u.clave)) throw new Reject("La clave " + u.clave + " est\xE1 en uso por " + unitLabel(u));
  }
  s.prev.cat[cat] = clone(n);
};
H["prev.plano"] = (s, op) => {
  const cur = s.prev.plano || null;
  if (!same(cur, op.x.o)) {
    if (same(cur, op.x.n)) return { noop: true };
    return { fieldConflicts: [{ campo: "plano", actual: clone(cur), propuesto: clone(op.x.n), anterior: clone(op.x.o) }] };
  }
  s.prev.plano = clone(op.x.n);
};
H["unit.create"] = (s, op) => {
  const d = op.x.u;
  if (s.units[op.e]) throw new Reject("La unidad ya existe");
  const base = baseClave(s.prev).codigo;
  const u = {
    id: op.e,
    ind: d.ind || "",
    nombre: d.nombre || "",
    denom: d.denom || "",
    tipo: d.tipo || null,
    subtipo: d.subtipo || "",
    categoria: d.categoria || "",
    sector: d.sector || null,
    sectorOtro: d.sector === SECTOR_OTROS ? String(d.sectorOtro || "") : "",
    desc: d.desc || "",
    obs: d.obs || "",
    equip: clone(d.equip || []),
    caract: clone(d.caract || []),
    vis: clone(d.vis || {}),
    plantilla: d.plantilla ? clone(d.plantilla) : null,
    colorC0: d.colorC0 || "#2E7D32",
    clave: base,
    claveDesde: op.t,
    motivoEsp: null,
    sit: "activa",
    aviso: null,
    descanso: null,
    loc: d.loc ? { ...clone(d.loc), t: op.t } : null,
    plan: d.plan ? clone(d.plan) : null,
    creada: op.t,
    eliminada: false,
    hc: [{ t: op.t, c: base, m: null, op: op.id }],
    hs: [{ t: op.t, s: "activa" }],
    hr: [],
    hl: d.loc ? [{ t: op.t, ...clone(d.loc), op: op.id }] : [],
    ha: [],
    hn: []
  };
  s.units[u.id] = u;
  const dup = u.ind && Object.values(s.units).find((x) => x !== u && !x.eliminada && x.sit !== "archivada" && x.ind && x.ind.toLowerCase() === u.ind.toLowerCase());
  if (dup) return { warning: "Indicativo duplicado: " + u.ind };
};
H["unit.update"] = (s, op) => {
  const u = getUnit(s, op.e);
  const r = applyFields(u, op.x.f, UNIT_FIELDS);
  return { fieldConflicts: r.conflicts, noop: !r.changed && !r.conflicts.length };
};
H["unit.clave"] = (s, op) => {
  const u = getUnit(s, op.e);
  const { o, n, motivo } = op.x;
  if (u.sit !== "activa") throw new Reject("La unidad no est\xE1 activa");
  if (u.clave !== o) {
    if (u.clave === n) return { noop: true };
    throw new Reject("Cambio de clave simult\xE1neo: " + unitLabel(u) + " est\xE1 en " + u.clave, { actual: u.clave, propuesto: n });
  }
  const def = claveDef(s.prev, n);
  if (!def) throw new Reject("Clave inexistente: " + n);
  if (def.requiereMotivo && !motivo) throw new Reject("La clave " + n + " requiere indicar el motivo");
  if (def.requiereAviso && !u.aviso) throw new Reject("La clave " + n + " requiere un aviso activo");
  if (def.requiereAviso && isResting(u, op.t)) throw new Reject("La unidad est\xE1 en descanso");
  setClave(s, u, n, op.t, motivo, op);
};
H["unit.color"] = (s, op) => {
  const u = getUnit(s, op.e);
  const base = baseClave(s.prev).codigo;
  if (u.clave !== base) throw new Reject("El color " + base + " solo puede modificarse con la unidad en " + base, { clave: u.clave });
  if (u.colorC0 !== op.x.o) {
    if (u.colorC0 === op.x.n) return { noop: true };
    return { fieldConflicts: [{ campo: "colorC0", actual: u.colorC0, propuesto: op.x.n, anterior: op.x.o }] };
  }
  u.colorC0 = op.x.n;
};
H["unit.sit"] = (s, op) => {
  const u = getUnit(s, op.e);
  const { o, n } = op.x;
  if (!["activa", "desactivada", "archivada"].includes(n)) throw new Reject("Situaci\xF3n no v\xE1lida");
  if (u.sit !== o) {
    if (u.sit === n) return { noop: true };
    throw new Reject("Cambio simult\xE1neo de situaci\xF3n de " + unitLabel(u));
  }
  if (n !== "activa" && u.aviso) throw new Reject(unitLabel(u) + " tiene un aviso activo");
  if (n !== "activa" && isResting(u, op.t)) {
    u.descanso.fin = op.t;
    u.descanso.finMotivo = "Desactivaci\xF3n";
  }
  u.sit = n;
  u.hs.push({ t: op.t, s: n });
};
H["unit.delete"] = (s, op) => {
  const u = getUnit(s, op.e);
  if (u.aviso) throw new Reject(unitLabel(u) + " tiene un aviso activo");
  if (u.hc.length > 1 || u.ha.length || u.hr.length || u.hn.length || u.hl.length > 1) throw new Reject(unitLabel(u) + " tiene actividad registrada: arch\xEDvala en lugar de eliminarla");
  u.eliminada = true;
  u.eliminadaEn = op.t;
};
H["unit.loc"] = (s, op) => {
  const u = getUnit(s, op.e);
  const n = op.x.n || null;
  const cur = u.loc ? { txt: u.loc.txt || "", lat: u.loc.lat ?? null, lon: u.loc.lon ?? null } : null;
  const nn = n ? { txt: n.txt || "", lat: n.lat ?? null, lon: n.lon ?? null } : null;
  const extra = n ? Object.fromEntries(["fuente", "prec", "ref"].filter((k) => n[k] != null).map((k) => [k, n[k]])) : {};
  const curX = u.loc ? Object.fromEntries(["fuente", "prec", "ref"].filter((k) => u.loc[k] != null).map((k) => [k, u.loc[k]])) : {};
  if (same(cur, nn) && same(curX, extra)) return { noop: true };
  u.loc = nn ? { ...nn, ...extra, t: op.t } : null;
  u.hl.push({ t: op.t, ...nn || { txt: "", lat: null, lon: null }, ant: cur, op: op.id });
};
H["unit.plan"] = (s, op) => {
  const u = getUnit(s, op.e);
  const n = op.x.n || null;
  if (same(u.plan, n)) return { noop: true };
  u.plan = n ? { x: n.x, y: n.y, ...n.lat != null ? { lat: n.lat, lon: n.lon } : {} } : null;
};
H["unit.rest"] = (s, op) => {
  const u = getUnit(s, op.e);
  const dur = Number(op.x.dur);
  if (!(dur > 0 && dur <= 24 * 60)) throw new Reject("Duraci\xF3n de descanso no v\xE1lida");
  if (u.sit !== "activa") throw new Reject("La unidad no est\xE1 activa");
  if (u.aviso) throw new Reject(unitLabel(u) + " tiene un aviso activo: no puede iniciar descanso", { aviso: u.aviso });
  if (isResting(u, op.t)) throw new Reject(unitLabel(u) + " ya est\xE1 en descanso");
  const def = claveDef(s.prev, u.clave);
  if (def && (def.categoria === "ocupada" || def.categoria === "fuera_servicio")) throw new Reject("No puede iniciar descanso en clave " + u.clave);
  u.descanso = { id: op.x.rid || op.id, ini: op.t, dur, finPrev: op.t + dur * 6e4, fin: null, por: op.u ? op.u.n : "" };
  u.hr.push(u.descanso);
};
H["unit.restEnd"] = (s, op) => {
  const u = getUnit(s, op.e);
  const d = u.descanso;
  if (!d || op.x.rid && d.id !== op.x.rid || d.fin != null || op.t >= d.finPrev) return { noop: true };
  d.fin = op.t;
  d.finMotivo = op.x.motivo || "Manual";
};
H["unit.nota"] = (s, op) => {
  const u = getUnit(s, op.e);
  u.hn.push({ t: op.t, txt: String(op.x.txt || ""), tipo: op.x.tipo || "observacion", por: op.u ? op.u.n : "" });
};
H["aviso.create"] = (s, op) => {
  if (s.avisos[op.e]) throw new Reject("El aviso ya existe");
  const d = op.x.a || {};
  const a = {
    id: op.e,
    num: op.num != null ? op.num : null,
    ref: op.ref || null,
    tipo: d.tipo || null,
    desc: d.desc || "",
    t: d.t || op.t,
    loc: d.loc ? clone(d.loc) : null,
    sector: d.sector || null,
    obs: d.obs || "",
    plan: d.plan ? clone(d.plan) : null,
    zona: d.zona ? clone(d.zona) : null,
    part: [],
    estado: "pendiente",
    hist: [{ t: op.t, o: null, n: "pendiente" }],
    creado: op.t,
    creadoPor: op.u ? op.u.n : "",
    asignadoEn: null,
    enCursoEn: null,
    llegadaEn: null,
    salidaPuntoEn: null,
    finalizadoEn: null,
    cierre: null,
    notas: [],
    reaperturas: []
  };
  s.avisos[a.id] = a;
  if (a.num != null) {
    const otro = s.numAviso[a.num];
    s.maxNum = Math.max(s.maxNum, a.num);
    if (otro && otro !== a.id) return { warning: "N\xFAmero de aviso duplicado: " + a.num };
    s.numAviso[a.num] = a.id;
  }
};
H["aviso.update"] = (s, op) => {
  const a = getAviso(s, op.e);
  const r = applyFields(a, op.x.f, AVISO_FIELDS);
  return { fieldConflicts: r.conflicts, noop: !r.changed && !r.conflicts.length };
};
H["aviso.plan"] = (s, op) => {
  const a = getAviso(s, op.e);
  const n = op.x.n || null;
  if (same(a.plan, n)) return { noop: true };
  a.plan = n ? { x: n.x, y: n.y, ...n.lat != null ? { lat: n.lat, lon: n.lon } : {} } : null;
};
H["aviso.asig"] = (s, op) => {
  const a = getAviso(s, op.e);
  const u = getUnit(s, op.x.u);
  if (a.finalizadoEn != null) throw new Reject("El aviso " + avisoLabel(a) + " est\xE1 finalizado");
  if (u.aviso === a.id) return { noop: true };
  if (u.sit !== "activa") throw new Reject(unitLabel(u) + " no est\xE1 activa");
  if (u.aviso) throw new Reject(unitLabel(u) + " ya est\xE1 asignada a otro aviso", { aviso: u.aviso });
  if (isResting(u, op.t)) throw new Reject(unitLabel(u) + " est\xE1 en descanso", { descanso: true });
  const def = claveDef(s.prev, u.clave);
  if (def && def.categoria !== "disponible") throw new Reject(unitLabel(u) + " no est\xE1 disponible (clave " + u.clave + ")", { clave: u.clave });
  a.part.push({ u: u.id, asig: op.t, lib: null, llegada: null, salida: null, motivoLib: null });
  u.aviso = a.id;
  if (!u.ha.includes(a.id)) u.ha.push(a.id);
  if (a.asignadoEn == null) a.asignadoEn = op.t;
  const al = alAsignarClave(s.prev);
  if (al && def && def.categoria === "disponible" && u.clave !== al.codigo) setClave(s, u, al.codigo, op.t, null, op, "asignacion");
  avisoEstado(s, a, op.t);
};
H["aviso.lib"] = (s, op) => {
  const a = getAviso(s, op.e);
  const u = getUnit(s, op.x.u);
  if (!activePart(a, u.id)) return { noop: true };
  releasePart(s, a, u, op.t, op.x.motivo || "Liberada");
  const def = claveDef(s.prev, u.clave);
  if (def && def.requiereAviso) setClave(s, u, baseClave(s.prev).codigo, op.t, "Liberada del aviso", op, "liberacion");
  avisoEstado(s, a, op.t);
};
H["aviso.estado"] = (s, op) => {
  const a = getAviso(s, op.e);
  const { n } = op.x;
  if (n === "finalizado") {
    if (a.finalizadoEn != null) return { noop: true };
    for (const p of activeParts(a)) {
      const u = s.units[p.u];
      releasePart(s, a, u, op.t, "Aviso finalizado");
      const def = claveDef(s.prev, u.clave);
      if (def && def.requiereAviso) setClave(s, u, baseClave(s.prev).codigo, op.t, "Aviso finalizado", op, "finalizacion");
    }
    a.finalizadoEn = op.t;
    a.finAuto = false;
    a.cierre = { nota: op.x.nota || "", por: op.u ? op.u.n : "" };
  } else if (n === "en_curso") {
    if (a.finalizadoEn != null) {
      if (op.x.o !== "finalizado") throw new Reject("El aviso est\xE1 finalizado");
      if (!op.x.motivo) throw new Reject("La reapertura requiere motivo");
      a.finalizadoEn = null;
      a.reaperturas.push({ t: op.t, motivo: op.x.motivo, por: op.u ? op.u.n : "" });
    }
    if (a.enCursoEn == null) a.enCursoEn = op.t;
  } else if (n === "pendiente") {
    if (a.finalizadoEn == null) return { noop: true };
    if (!op.x.motivo) throw new Reject("La reapertura requiere motivo");
    a.finalizadoEn = null;
    a.reaperturas.push({ t: op.t, motivo: op.x.motivo, por: op.u ? op.u.n : "" });
  } else throw new Reject("Estado de aviso no v\xE1lido");
  avisoEstado(s, a, op.t);
};
H["aviso.nota"] = (s, op) => {
  const a = getAviso(s, op.e);
  a.notas.push({ t: op.t, txt: String(op.x.txt || ""), por: op.u ? op.u.n : "" });
};
H["conf.resolve"] = (s, op, ctx) => {
  const c = s.conflicts[op.x.op];
  if (!c || c.estado !== "pendiente") return { noop: true };
  if (op.x.d === "descartar") {
    c.estado = "descartado";
  } else if (op.x.d === "aceptar") {
    if (c.tipo === "campos") {
      const target = c.k.startsWith("unit.") ? getUnit(s, c.e) : c.k.startsWith("aviso.") ? getAviso(s, c.e) : s.prev;
      for (const f of c.detalle || []) {
        const val = op.x.valores && Object.prototype.hasOwnProperty.call(op.x.valores, f.campo) ? op.x.valores[f.campo] : f.propuesto;
        if (f.campo.startsWith("cat.")) s.prev.cat[f.campo.slice(4)] = clone(val);
        else setPath(target, f.campo, clone(val));
      }
    } else if (c.tipo === "op") {
      const orig = ctx.lookup && ctx.lookup(c.id);
      if (!orig) throw new Reject("Operaci\xF3n original no disponible");
      const again = { ...orig, t: op.t, h: op.h };
      const fn = H[orig.k];
      const r = fn(s, again, ctx) || {};
      if (r.fieldConflicts && r.fieldConflicts.length) throw new Reject("Sigue habiendo diferencias; elige valores");
    }
    c.estado = "aceptado";
  } else throw new Reject("Decisi\xF3n no v\xE1lida");
  c.resueltoPor = op.u ? op.u.n : "";
  c.resueltoEn = op.t;
};
var OP_KINDS = Object.keys(H);
function applyOp(s, op, ctx = {}) {
  try {
    if (op.k !== "prev.create") {
      if (!s.prev) throw new Reject("Preventivo no creado");
      if (s.prev.archivado && op.k !== "prev.archivo" && !SIEMPRE_OK.has(op.k)) throw new Reject("El preventivo est\xE1 archivado");
      if (s.prev.estado === "cerrado" && !CLOSED_OK.has(op.k) && !SIEMPRE_OK.has(op.k)) throw new Reject("El preventivo est\xE1 cerrado");
    }
    const fn = H[op.k];
    if (!fn) throw new Reject("Operaci\xF3n desconocida: " + op.k);
    const r = fn(s, op, ctx) || {};
    if (op.t > s.lastT) s.lastT = op.t;
    if (r.fieldConflicts && r.fieldConflicts.length) {
      if (!ctx.strict) registerConflict(s, op, "campos", "Modificaci\xF3n simult\xE1nea de " + r.fieldConflicts.map((f) => f.campo).join(", "), r.fieldConflicts);
      return { status: "conflict", reason: "Los datos han cambiado mientras se editaban (" + r.fieldConflicts.map((f) => f.campo).join(", ") + ")", partial: true };
    }
    if (r.warning) {
      if (ctx.strict) return { status: "conflict", reason: r.warning };
      registerConflict(s, op, "aviso", r.warning, null);
      return { status: "ok", warning: r.warning };
    }
    return { status: r.noop ? "noop" : "ok" };
  } catch (e) {
    const internal = !(e instanceof Reject);
    if (internal && ctx.strict) throw e;
    const reason = internal ? "Error interno al aplicar la operaci\xF3n: " + e.message : e.message;
    if (!ctx.strict) registerConflict(s, op, "op", reason, e.detail);
    return { status: "conflict", reason };
  }
}
var cmpOps = (a, b) => a.h < b.h ? -1 : a.h > b.h ? 1 : 0;
function lazyMap(src) {
  const cache = /* @__PURE__ */ Object.create(null);
  const has = (k) => typeof k === "string" && (k in cache || Object.prototype.hasOwnProperty.call(src, k));
  const get = (k) => typeof k !== "string" ? void 0 : k in cache ? cache[k] : Object.prototype.hasOwnProperty.call(src, k) ? cache[k] = clone(src[k]) : void 0;
  return new Proxy({}, {
    get: (_, k) => get(k),
    set: (_, k, v) => {
      cache[k] = v;
      return true;
    },
    has: (_, k) => has(k),
    deleteProperty: () => {
      throw new Error("No se admite borrar durante la validaci\xF3n");
    },
    ownKeys: () => [.../* @__PURE__ */ new Set([...Object.keys(src), ...Object.keys(cache)])],
    getOwnPropertyDescriptor: (_, k) => has(k) ? { value: get(k), writable: true, enumerable: true, configurable: true } : void 0
  });
}
function lazyCopy(s) {
  return { ...s, prev: clone(s.prev), units: lazyMap(s.units), avisos: lazyMap(s.avisos), conflicts: lazyMap(s.conflicts), numAviso: { ...s.numAviso }, revisiones: { ...s.revisiones || {} }, informes: s.informes || [] };
}
var Engine = class {
  constructor(ops = []) {
    this.ops = [];
    this.byId = /* @__PURE__ */ new Map();
    this.status = /* @__PURE__ */ new Map();
    this.state = emptyState();
    this.version = 0;
    if (ops.length) this.load(ops);
  }
  load(ops) {
    this.ops = [];
    this.byId = /* @__PURE__ */ new Map();
    for (const op of ops) if (!this.byId.has(op.id)) {
      this.byId.set(op.id, op);
      this.ops.push(op);
    }
    this.ops.sort(cmpOps);
    this.replay();
  }
  replay() {
    this.state = emptyState();
    this.status = /* @__PURE__ */ new Map();
    for (const op of this.ops) this._apply(op);
    this.version++;
  }
  _apply(op) {
    const r = applyOp(this.state, op, { lookup: (id) => this.byId.get(id) });
    this.status.set(op.id, r);
    return r;
  }
  /** Incorpora operaciones nuevas (locales o remotas). Devuelve cuántas eran nuevas. */
  add(ops) {
    const nuevos = ops.filter((o) => !this.byId.has(o.id));
    if (!nuevos.length) return 0;
    for (const o of nuevos) this.byId.set(o.id, o);
    nuevos.sort(cmpOps);
    const last = this.ops.length ? this.ops[this.ops.length - 1].h : "";
    if (nuevos[0].h > last) {
      for (const o of nuevos) {
        this.ops.push(o);
        this._apply(o);
      }
      this.version++;
    } else {
      this.ops.push(...nuevos);
      this.ops.sort(cmpOps);
      this.replay();
    }
    return nuevos.length;
  }
  /** Valida un lote sobre una copia del estado, sin modificar nada */
  dryRun(ops) {
    const s = lazyCopy(this.state);
    for (const op of ops) {
      const r = applyOp(s, op, { strict: true, lookup: (id) => this.byId.get(id) });
      if (r.status === "conflict") return { ok: false, reason: r.reason, op };
    }
    return { ok: true, state: s };
  }
  /** Número definitivo asignado por el servidor (o localmente) */
  setNumber(opId, num2) {
    const op = this.byId.get(opId);
    if (!op || op.num === num2) return false;
    const antes = op.num;
    op.num = num2;
    const s = this.state;
    const a = op.k === "aviso.create" ? s.avisos[op.e] : null;
    if (antes == null && a && a.num == null && !s.numAviso[num2] && !s.conflicts[opId]) {
      a.num = num2;
      s.numAviso[num2] = a.id;
      s.maxNum = Math.max(s.maxNum, num2);
      this.version++;
      return true;
    }
    this.replay();
    return true;
  }
  applied() {
    return this.ops.filter((o) => {
      const r = this.status.get(o.id);
      return r && r.status === "ok";
    });
  }
  pendingConflicts() {
    return Object.values(this.state.conflicts).filter((c) => c.estado === "pendiente");
  }
};

// src/core/perms.js
var PERMISOS = [
  ["preventivos.ver", "Consultar preventivos", "Preventivos", "ver"],
  ["preventivos.historico", "Consultar preventivos finalizados y archivados", "Preventivos", "ver"],
  ["preventivos.crear", "Crear y duplicar preventivos", "Preventivos"],
  ["preventivos.editar", "Modificar la configuraci\xF3n de los preventivos", "Preventivos"],
  ["preventivos.iniciar", "Iniciar (activar) preventivos", "Preventivos"],
  ["preventivos.cerrar", "Finalizar preventivos", "Preventivos"],
  ["preventivos.archivar", "Archivar y recuperar preventivos", "Preventivos"],
  ["preventivos.reabrir", "Reabrir preventivos finalizados", "Preventivos"],
  ["plantillas.crear", "Crear plantillas de preventivo (desde la configuraci\xF3n, un preventivo, duplicando o importando)", "Preventivos"],
  ["plantillas.gestionar", "Modificar, desactivar y eliminar plantillas de preventivo", "Preventivos"],
  ["plantillas.usar", "Crear preventivos a partir de plantillas", "Preventivos"],
  ["unidades.ver", "Consultar unidades", "Unidades y recursos", "ver"],
  ["unidades.crear", "Crear unidades", "Unidades y recursos"],
  ["unidades.editar", "Modificar unidades y ponerlas fuera de servicio", "Unidades y recursos"],
  ["unidades.archivar", "Eliminar o archivar unidades", "Unidades y recursos"],
  ["unidades.tipos", "Cambiar el tipo de una unidad", "Unidades y recursos"],
  ["unidades.colores", "Modificar colores C0", "Unidades y recursos"],
  ["ubicaciones.editar", "Gestionar ubicaciones de las unidades", "Unidades y recursos"],
  ["estados.cambiar", "Cambiar claves", "Unidades y recursos"],
  ["estados.forzar", "Forzar transiciones de clave no permitidas", "Unidades y recursos"],
  ["recursos.gestionar", "Gestionar tipos de recurso, materiales y unidades plantilla", "Unidades y recursos"],
  ["sectores.gestionar", "Gestionar sectores", "Unidades y recursos"],
  ["avisos.ver", "Consultar avisos", "Avisos", "ver"],
  ["avisos.historico", "Consultar avisos finalizados", "Avisos", "ver"],
  ["avisos.crear", "Crear avisos", "Avisos"],
  ["avisos.editar", "Modificar avisos", "Avisos"],
  ["avisos.asignar", "Asignar y liberar unidades", "Avisos"],
  ["avisos.finalizar", "Finalizar y reabrir avisos", "Avisos"],
  ["descansos.ver", "Consultar descansos y su historial", "Descansos", "ver"],
  ["descansos.iniciar", "Iniciar descansos", "Descansos"],
  ["descansos.finalizar", "Finalizar descansos", "Descansos"],
  ["descansos.gestionar", "Gestionar descansos (iniciar y finalizar)", "Descansos"],
  ["descansos.duracion", "Cambiar la duraci\xF3n del descanso", "Descansos"],
  ["planos.ver", "Consultar planos", "Planos y mapas", "ver"],
  ["planos.editar", "Importar y modificar planos; colocar unidades y avisos", "Planos y mapas"],
  ["planos.vista", "Cambiar la visualizaci\xF3n del mapa (sat\xE9lite, h\xEDbrido, relieve)", "Planos y mapas"],
  ["estadisticas.ver", "Consultar estad\xEDsticas", "Informes y datos", "ver"],
  ["bitacora.ver", "Consultar la bit\xE1cora", "Informes y datos", "ver"],
  ["informes.ver", "Consultar los informes guardados y su registro", "Informes y datos", "ver"],
  ["informes.generar", "Generar informes", "Informes y datos"],
  ["exportar", "Exportar informaci\xF3n", "Informes y datos"],
  ["importar", "Importar informaci\xF3n", "Informes y datos"],
  ["notas.crear", "A\xF1adir observaciones e incidencias", "Informes y datos"],
  ["auditoria.ver", "Consultar la auditor\xEDa", "Informes y datos", "ver"],
  ["incoherencias.ver", "Consultar las incoherencias detectadas", "Control operativo", "ver"],
  ["incoherencias.revisar", "Revisar, asignar y resolver incoherencias", "Control operativo"],
  ["incoherencias.reglas", "Ajustar las reglas de incoherencias (niveles y umbrales)", "Control operativo"],
  ["usuarios.admin", "Administraci\xF3n completa de usuarios y perfiles", "Administraci\xF3n"],
  ["usuarios.crear", "Crear usuarios", "Administraci\xF3n"],
  ["usuarios.editar", "Modificar, suspender y desactivar usuarios", "Administraci\xF3n"],
  ["usuarios.aprobar", "Aprobar o rechazar registros", "Administraci\xF3n"],
  ["usuarios.permisos", "Asignar permisos y perfiles", "Administraci\xF3n"],
  ["config.editar", "Gestionar configuraciones generales y cat\xE1logos", "Administraci\xF3n"],
  ["copias.gestionar", "Copias de seguridad y restauraci\xF3n", "Administraci\xF3n"],
  ["conflictos.resolver", "Resolver conflictos de sincronizaci\xF3n", "Administraci\xF3n"],
  ["sync.gestionar", "Gestionar la sincronizaci\xF3n", "Administraci\xF3n"],
  ["central.gestionar", "Configurar el servidor central y dar de alta dispositivos", "Administraci\xF3n"],
  ["actualizaciones.gestionar", "Gestionar las actualizaciones del servidor central y de la aplicaci\xF3n", "Administraci\xF3n"],
  ["sistema.estado", "Consultar el estado t\xE9cnico del servidor y del sistema (monitorizaci\xF3n)", "Administraci\xF3n"]
];
var PERM_KEYS = PERMISOS.map((p) => p[0]);
var PERM_LABEL = Object.fromEntries(PERMISOS.map((p) => [p[0], p[1]]));
var PERMISOS_VER = PERMISOS.filter((p) => p[3] === "ver").map((p) => p[0]);
var IMPLICA = {
  "preventivos.editar": ["preventivos.iniciar", "incoherencias.reglas"],
  "avisos.editar": ["incoherencias.revisar"],
  "preventivos.crear": ["plantillas.usar"],
  "plantillas.gestionar": ["plantillas.crear"],
  "incoherencias.revisar": ["incoherencias.ver"],
  "incoherencias.reglas": ["incoherencias.ver"],
  "preventivos.cerrar": ["preventivos.archivar"],
  "descansos.gestionar": ["descansos.iniciar", "descansos.finalizar"],
  "planos.editar": ["planos.vista"],
  "config.editar": ["sectores.gestionar"],
  "exportar": ["informes.generar"],
  "informes.generar": ["informes.ver"],
  "actualizaciones.gestionar": ["sistema.estado"],
  "usuarios.admin": ["usuarios.crear", "usuarios.editar", "usuarios.aprobar", "usuarios.permisos", "auditoria.ver"]
};
var VER = PERMISOS_VER.filter((k) => k !== "auditoria.ver");
var OPERADOR = [
  ...VER,
  "unidades.crear",
  "unidades.editar",
  "ubicaciones.editar",
  "estados.cambiar",
  "avisos.crear",
  "avisos.editar",
  "avisos.asignar",
  "avisos.finalizar",
  "descansos.gestionar",
  "planos.editar",
  "notas.crear",
  "exportar",
  "sync.gestionar"
];
var ADMIN_PREVENTIVO = [...OPERADOR, "preventivos.editar", "preventivos.cerrar", "unidades.archivar", "unidades.tipos", "unidades.colores", "sectores.gestionar", "descansos.duracion", "estados.forzar", "conflictos.resolver"];
var COORDINADOR = [...ADMIN_PREVENTIVO, "preventivos.crear", "preventivos.reabrir", "plantillas.gestionar", "recursos.gestionar", "config.editar", "importar"];
function defaultRoles() {
  return [
    { id: "rol_admin", nombre: "Administrador", sistema: true, v: 2, permisos: [...PERM_KEYS] },
    { id: "rol_coordinador", nombre: "Coordinador", v: 2, permisos: [...new Set(COORDINADOR)] },
    { id: "rol_adminprev", nombre: "Administrador de preventivo", v: 2, permisos: [...new Set(ADMIN_PREVENTIVO)] },
    { id: "rol_operador", nombre: "Operador", sistema: true, v: 2, permisos: [...new Set(OPERADOR)] },
    { id: "rol_consulta", nombre: "Consulta", sistema: true, v: 2, permisos: [...VER] }
  ];
}
function normalizarPerfil(p) {
  if (!p) return p;
  if (p.id === "rol_admin" && p.sistema) return { ...p, permisos: [.../* @__PURE__ */ new Set([...p.permisos || [], ...PERM_KEYS])] };
  if ((p.v || 1) >= 2) return p;
  return { ...p, permisos: [.../* @__PURE__ */ new Set([...p.permisos || [], ...VER])] };
}
function expandir(set) {
  const out = new Set(set);
  const pend = [...out];
  while (pend.length) for (const x of IMPLICA[pend.pop()] || []) if (!out.has(x)) {
    out.add(x);
    pend.push(x);
  }
  return out;
}
var estadoUsuario = (u) => u ? u.estado || (u.activo === false ? "desactivado" : "activo") : "desactivado";
function accesoPreventivo(u, pid) {
  const a = u && u.alcance;
  if (!a || a.tipo !== "seleccion") return true;
  return Object.prototype.hasOwnProperty.call(a.preventivos || {}, pid);
}
function permisosEfectivos(u, perfiles, pid = null) {
  if (!u || estadoUsuario(u) !== "activo") return /* @__PURE__ */ new Set();
  let perfilId = u.perfil !== void 0 ? u.perfil : u.rol;
  if (pid != null && u.alcance && u.alcance.tipo === "seleccion") {
    if (!accesoPreventivo(u, pid)) return /* @__PURE__ */ new Set();
    perfilId = u.alcance.preventivos[pid] || perfilId;
  }
  const p = (perfiles || []).find((x) => x.id === perfilId);
  if (!p) return /* @__PURE__ */ new Set();
  const out = expandir(/* @__PURE__ */ new Set([...normalizarPerfil(p).permisos, ...u.ajustes && u.ajustes.mas || []]));
  for (const k of u.ajustes && u.ajustes.menos || []) out.delete(k);
  for (const k of [...out]) if (!PERM_KEYS.includes(k)) out.delete(k);
  return out;
}
var claveDe = (s, c) => (s.prev && s.prev.cat && s.prev.cat.claves || []).find((x) => x.codigo === c);
function permisosOp(op, s, lote = []) {
  const x = op.x || {};
  const f = x.f || {};
  switch (op.k) {
    case "prev.create":
      return x.prev && x.prev.origen && x.prev.origen.tipo === "plantilla" ? ["preventivos.crear", "plantillas.usar"] : ["preventivos.crear"];
    case "prev.update": {
      const campos = Object.keys(f);
      if (campos.length && campos.every((c) => c === "cfg.vistaMapa")) return ["planos.vista"];
      if (campos.length && campos.every((c) => c === "cfg.reglas")) return ["incoherencias.reglas"];
      return campos.some((c) => c.startsWith("cfg.descanso")) ? ["preventivos.editar", "descansos.duracion"] : ["preventivos.editar"];
    }
    case "prev.estado":
      if (x.o === "cerrado" && x.n === "activo") return ["preventivos.reabrir"];
      if (x.n === "cerrado") return ["preventivos.cerrar"];
      return ["preventivos.iniciar"];
    case "prev.archivo":
      return ["preventivos.archivar"];
    case "revision.set":
      return ["incoherencias.revisar"];
    case "informe.reg":
      return [x.accion === "generar" ? "informes.generar" : x.accion === "exportar" ? "exportar" : "informes.ver"];
    case "prev.cat": {
      if (x.cat === "tiposRecurso" && Array.isArray(x.o) && Array.isArray(x.n) && x.n.length === x.o.length + 1 && x.o.every((t, i) => JSON.stringify(t) === JSON.stringify(x.n[i]))) {
        const nuevo = x.n[x.n.length - 1].id;
        const uso = lote.find((o) => o.b === op.b && (o.k === "unit.create" && o.x && o.x.u && o.x.u.tipo === nuevo || o.k === "unit.update" && o.x && o.x.f && o.x.f.tipo && o.x.f.tipo.n === nuevo));
        if (uso) return [uso.k === "unit.create" ? "unidades.crear" : "unidades.tipos"];
      }
      return [x.cat === "sectores" ? "sectores.gestionar" : x.cat === "puntos" || x.cat === "categoriasPunto" ? "planos.editar" : "config.editar"];
    }
    case "prev.plano":
      return ["planos.editar"];
    case "unit.create":
      return lote.some((o) => o.k === "prev.create" && o.b === op.b) ? ["preventivos.crear"] : ["unidades.crear"];
    case "unit.update":
      return "tipo" in f ? ["unidades.editar", "unidades.tipos"] : ["unidades.editar"];
    case "unit.clave": {
      const u = s && s.units && s.units[op.e];
      const def = u && claveDe(s, u.clave);
      const permitido = def && (def.transiciones || []).includes(x.n);
      const base = (claveDe(s, x.n) || {}).base;
      const asignacion = base && lote.some((o) => o.k === "aviso.asig" && o.b === op.b && o.x && o.x.u === op.e);
      return permitido || asignacion || u && u.clave === x.n ? ["estados.cambiar"] : ["estados.cambiar", "estados.forzar"];
    }
    case "unit.color":
      return ["unidades.colores"];
    case "unit.sit": {
      const u = s && s.units && s.units[op.e];
      return x.n === "archivada" || x.o === "archivada" || u && u.sit === "archivada" ? ["unidades.archivar"] : ["unidades.editar"];
    }
    case "unit.delete":
      return ["unidades.archivar"];
    case "unit.loc":
      return ["ubicaciones.editar"];
    case "unit.plan":
      return ["planos.editar"];
    case "unit.rest": {
      const def = s && s.prev && s.prev.cfg && s.prev.cfg.descansoMin || 30;
      return Number(x.dur) !== def ? ["descansos.iniciar", "descansos.duracion"] : ["descansos.iniciar"];
    }
    case "unit.restEnd":
      return ["descansos.finalizar"];
    case "unit.nota":
    case "aviso.nota":
      return ["notas.crear"];
    case "aviso.create":
      return ["avisos.crear"];
    case "aviso.update":
      return ["avisos.editar"];
    case "aviso.plan":
      return ["planos.editar"];
    case "aviso.asig":
    case "aviso.lib":
      return ["avisos.asignar"];
    case "aviso.estado":
      return x.n === "finalizado" || x.o === "finalizado" ? ["avisos.finalizar"] : ["avisos.asignar"];
    case "conf.resolve":
      return ["conflictos.resolver"];
    default:
      return null;
  }
}
var esAdmin = (u, perfiles) => permisosEfectivos(u, perfiles).has("usuarios.admin");
var igual = (a, b) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
function comprobarCambioUsuario({ actor, antes, despues, perfiles, usuarios }) {
  const pa = permisosEfectivos(actor, perfiles);
  const cambiaPermisos = !antes || ["perfil", "ajustes", "alcance", "rol"].some((k) => !igual(antes[k], despues[k]));
  const cambiaEstado = !!antes && estadoUsuario(antes) !== estadoUsuario(despues);
  if (antes && actor.id === antes.id && (cambiaPermisos || cambiaEstado)) throw new AppError("No puedes cambiar tus propios permisos ni el estado de tu cuenta: p\xEDdeselo a otro administrador", "permiso");
  if (!antes && !pa.has("usuarios.crear")) throw new AppError("No tienes permiso para crear usuarios", "permiso");
  if (cambiaEstado && !(pa.has("usuarios.editar") || estadoUsuario(antes) === "pendiente" && pa.has("usuarios.aprobar"))) throw new AppError("No tienes permiso para cambiar el estado de las cuentas", "permiso");
  if (cambiaPermisos && (antes || despues.perfil) && !pa.has("usuarios.permisos")) throw new AppError("No tienes permiso para asignar permisos", "permiso");
  if ((antes && esAdmin(antes, perfiles) || esAdmin({ ...despues, estado: "activo" }, perfiles)) && !pa.has("usuarios.admin"))
    throw new AppError("Solo un administrador puede modificar o crear cuentas de administrador", "permiso");
  const ambitos = [null, ...Object.keys(despues.alcance && despues.alcance.preventivos || {})];
  for (const pid of ambitos) {
    const nuevo = permisosEfectivos({ ...despues, estado: "activo" }, perfiles, pid);
    const previo = antes ? permisosEfectivos({ ...antes, estado: "activo" }, perfiles, pid) : /* @__PURE__ */ new Set();
    const extra = [...nuevo].filter((k) => !previo.has(k) && !pa.has(k));
    if (extra.length) throw new AppError("No tienes los permisos que intentas conceder: " + extra.map((k) => PERM_LABEL[k] || k).join(", "), "permiso");
  }
  const quedan = (usuarios || []).map((u) => antes && u.id === antes.id ? despues : u).filter((u) => esAdmin(u, perfiles));
  if (antes && esAdmin(antes, perfiles) && !quedan.length) throw new AppError("Debe quedar al menos un administrador activo", "permiso");
}

// src/core/recursos.js
function motivoTipoNoDisponible(t, noDisponibles) {
  if (!t) return null;
  if (t.retirado) return "retirado";
  if (t.activo === false || noDisponibles && noDisponibles.has(t.id)) return "desactivado";
  return null;
}

// src/core/ubicacion.js
var FUENTES_LOC = {
  mapa: "Marcada en el mapa (no es una posici\xF3n GPS)",
  gps: "Posici\xF3n GPS del dispositivo",
  direccion: "Direcci\xF3n escrita",
  coordenadas: "Coordenadas introducidas a mano",
  punto: "Punto del plano",
  sector: "Centro del sector"
};
var num = (v) => v === null || v === void 0 || v === "" ? null : typeof v === "number" ? v : Number.NaN;
function motivoLocNoValida(l) {
  if (!l) return null;
  if (typeof l !== "object") return "Ubicaci\xF3n no v\xE1lida";
  if (String(l.txt || "").length > 300) return "La descripci\xF3n de la ubicaci\xF3n es demasiado larga (m\xE1ximo 300 caracteres)";
  const lat = num(l.lat);
  const lon = num(l.lon);
  if (lat == null !== (lon == null)) return "Indica latitud y longitud";
  if (lat != null && !(Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180)) return "Coordenadas no v\xE1lidas: la latitud va de -90 a 90 y la longitud de -180 a 180";
  if (l.fuente && !FUENTES_LOC[l.fuente]) return "Origen de la ubicaci\xF3n desconocido";
  return null;
}
function motivoContenidoNoValido(op) {
  const x = op && op.x || {};
  if (op.k === "aviso.create") return motivoLocNoValida(x.a && x.a.loc);
  if (op.k === "aviso.update") return x.f && x.f.loc ? motivoLocNoValida(x.f.loc.n) : null;
  if (op.k === "unit.loc") return motivoLocNoValida(x.n);
  if (op.k === "informe.reg") return motivoInformeNoValido(x);
  return null;
}
var ACCIONES_INFORME = { generar: "Informe generado", exportar: "Informe exportado", consultar: "Informe consultado" };
var FORMATOS_INFORME = { pdf: "PDF", xlsx: "Excel (XLSX)", csv: "CSV", json: "JSON" };
function motivoInformeNoValido(x = {}) {
  if (!ACCIONES_INFORME[x.accion]) return "Acci\xF3n de informe no v\xE1lida";
  if (x.formato != null && !FORMATOS_INFORME[x.formato]) return "Formato de informe no v\xE1lido";
  if (x.accion === "generar" && !(Number.isInteger(x.n) && x.n >= 1)) return "N\xFAmero de versi\xF3n del informe no v\xE1lido";
  if (x.n != null && !(Number.isInteger(x.n) && x.n >= 1 && x.n < 1e5)) return "N\xFAmero de versi\xF3n del informe no v\xE1lido";
  if (x.accion === "generar" && x.hash == null) return "Falta la huella del informe";
  if (x.hash != null && !/^[0-9a-f]{64}$/.test(x.hash)) return "Huella SHA-256 del informe no v\xE1lida";
  if (x.motivo != null && (typeof x.motivo !== "string" || x.motivo.length > 500)) return "Motivo del informe demasiado largo";
  for (const k of ["pendientes", "nOps", "conflictos"]) if (x[k] != null && !(Number.isInteger(x[k]) && x[k] >= 0)) return "Dato del informe no v\xE1lido: " + k;
  return null;
}

// src/core/validaciones.js
var NIVELES = {
  info: { nombre: "Informaci\xF3n", orden: 1, color: "#1565C0" },
  moderada: { nombre: "Moderada", orden: 2, color: "#B26A00" },
  alta: { nombre: "Alta", orden: 3, color: "#D84315" },
  critica: { nombre: "Cr\xEDtica", orden: 4, color: "#B71C1C" }
};
var MIN = 6e4;
var uRef = (u) => ({ k: "u", id: u.id, nombre: unitLabel(u) });
var aRef = (a) => ({ k: "a", id: a.id, nombre: "Aviso " + avisoLabel(a) });
var pRef = (s) => ({ k: "prev", id: s.prev.id, nombre: s.prev.nombre });
var activo = (a) => a.estado !== "finalizado" && a.finalizadoEn == null;
var avisosActivos = (s) => Object.values(s.avisos).filter(activo);
var unidadesNoEliminadas = (s) => Object.values(s.units).filter((u) => !u.eliminada);
var avisosDe = (s, u) => avisosActivos(s).filter((a) => a.part.some((p) => p.u === u.id && p.lib == null) || u.aviso === a.id);
var asigDe = (a, u) => (a.part.find((p) => p.u === u.id && p.lib == null) || {}).asig || a.creado;
var inicioAviso = (a) => a.t ?? a.creado;
var REGLAS = [
  // ---------------- Unidades ----------------
  {
    id: "unidad_disponible_con_aviso",
    grupo: "unidades",
    nivel: "alta",
    titulo: "Unidad \xABdisponible\xBB con un aviso activo",
    porque: "Su clave dice que est\xE1 disponible, pero sigue asignada a un aviso que no ha terminado.",
    consecuencias: "Puede asignarse a otro aviso o darse por libre mientras todav\xEDa est\xE1 trabajando.",
    recomendacion: "Confirma con la unidad si sigue en el aviso y cambia su clave o lib\xE9rala del aviso.",
    detectar: ({ s }) => liveUnits(s).flatMap((u) => {
      const def = claveDef(s.prev, u.clave);
      if (!def || def.categoria !== "disponible") return [];
      return avisosDe(s, u).map((a) => ({ entidad: uRef(u), desde: asigDe(a, u), detalle: `${unitLabel(u)} est\xE1 en ${u.clave} (${def.nombre}) y asignada al aviso ${avisoLabel(a)}` })).slice(0, 1);
    })
  },
  {
    id: "unidad_inactiva_con_aviso",
    grupo: "unidades",
    nivel: "alta",
    titulo: "Unidad desactivada o archivada asignada a un aviso",
    porque: "Una unidad fuera de servicio no deber\xEDa figurar trabajando en un aviso activo.",
    consecuencias: "El aviso puede darse por atendido sin ning\xFAn recurso real.",
    recomendacion: "Libera la unidad del aviso y asigna otra disponible, o react\xEDvala si en realidad est\xE1 operativa.",
    detectar: ({ s }) => unidadesNoEliminadas(s).filter((u) => u.sit !== "activa").flatMap((u) => avisosDe(s, u).slice(0, 1).map((a) => ({ entidad: uRef(u), desde: asigDe(a, u), detalle: `${unitLabel(u)} (${u.sit}) figura en el aviso ${avisoLabel(a)}` })))
  },
  {
    id: "unidad_sin_datos",
    grupo: "unidades",
    nivel: "info",
    titulo: "Unidad sin datos m\xEDnimos",
    porque: "Le falta el indicativo o el tipo de recurso.",
    consecuencias: "No se puede filtrar, sugerir ni contar bien en las estad\xEDsticas.",
    recomendacion: "Completa la ficha de la unidad.",
    detectar: ({ s }) => liveUnits(s).filter((u) => !String(u.ind || "").trim() || !u.tipo).map((u) => ({ entidad: uRef(u), desde: u.creado || null, detalle: [!String(u.ind || "").trim() && "sin indicativo", !u.tipo && "sin tipo de recurso"].filter(Boolean).join(" y ") }))
  },
  {
    id: "referencia_inexistente",
    grupo: "unidades",
    nivel: "alta",
    titulo: "Sector o tipo que ya no existe",
    porque: "La unidad o el aviso apunta a un sector o tipo que no est\xE1 en los cat\xE1logos del preventivo.",
    consecuencias: "Puede no aparecer en los filtros, el plano o los informes por sector.",
    recomendacion: "As\xEDgnale un sector o tipo v\xE1lido desde su ficha.",
    detectar: ({ s }) => {
      const sec = new Set((s.prev.cat.sectores || []).map((x) => x.id));
      const tr = new Set((s.prev.cat.tiposRecurso || []).map((x) => x.id));
      const ta = new Set((s.prev.cat.tiposAviso || []).map((x) => x.id));
      const malo = (x, tipos) => [x.sector && x.sector !== SECTOR_OTROS && !sec.has(x.sector) && "sector \xAB" + x.sector + "\xBB", x.tipo && !tipos.has(x.tipo) && "tipo \xAB" + x.tipo + "\xBB"].filter(Boolean);
      return [...liveUnits(s).map((u) => [uRef(u), malo(u, tr)]), ...avisosActivos(s).map((a) => [aRef(a), malo(a, ta)])].filter(([, m]) => m.length).map(([e, m]) => ({ entidad: e, desde: null, detalle: e.nombre + ": " + m.join(" y ") + " no existe" }));
    }
  },
  {
    id: "unidad_sin_cambios",
    grupo: "unidades",
    nivel: "info",
    umbral: 180,
    titulo: "Unidad ocupada sin cambios desde hace mucho",
    porque: "Lleva mucho tiempo en una clave de trabajo sin ninguna actualizaci\xF3n.",
    consecuencias: "Su informaci\xF3n puede estar desactualizada.",
    recomendacion: "Contacta con la unidad y actualiza su clave.",
    detectar: ({ s, t, umbral }) => s.prev.estado !== "activo" ? [] : liveUnits(s).filter((u) => {
      const d = claveDef(s.prev, u.clave);
      return d && d.categoria === "ocupada" && u.claveDesde && t - u.claveDesde >= umbral;
    }).map((u) => ({ entidad: uRef(u), desde: u.claveDesde, detalle: `${unitLabel(u)} en ${u.clave} desde hace ${Math.round((t - u.claveDesde) / MIN)} min` }))
  },
  // ---------------- Avisos ----------------
  {
    id: "unidad_en_dos_avisos",
    grupo: "avisos",
    nivel: "critica",
    titulo: "La misma unidad en dos avisos activos",
    porque: "Una unidad solo puede estar trabajando en un aviso a la vez.",
    consecuencias: "Uno de los avisos puede quedar sin atender mientras parece cubierto.",
    recomendacion: "Decide en qu\xE9 aviso est\xE1 realmente y lib\xE9rala del otro; asigna otra unidad si hace falta.",
    detectar: ({ s }) => liveUnits(s).flatMap((u) => {
      const l = avisosDe(s, u);
      return l.length < 2 ? [] : [{ entidad: uRef(u), desde: Math.max(...l.map((a) => asigDe(a, u))), detalle: `${unitLabel(u)} figura a la vez en los avisos ${l.map(avisoLabel).join(" y ")}` }];
    })
  },
  {
    id: "aviso_sin_unidad",
    grupo: "avisos",
    nivel: "moderada",
    umbral: 15,
    titulo: "Aviso sin unidad asignada",
    porque: "El aviso sigue pendiente y nadie lo atiende.",
    consecuencias: "Retraso en la atenci\xF3n.",
    recomendacion: "Asigna una unidad (ver\xE1s las sugeridas en el aviso) o final\xEDzalo si ya no procede.",
    detectar: ({ s, t, umbral }) => avisosActivos(s).filter((a) => a.estado === "pendiente" && !a.part.some((p) => p.lib == null) && t - inicioAviso(a) >= umbral).map((a) => ({ entidad: aRef(a), desde: inicioAviso(a), detalle: `Aviso ${avisoLabel(a)} pendiente desde hace ${Math.round((t - inicioAviso(a)) / MIN)} min` }))
  },
  {
    id: "aviso_abierto_demasiado",
    grupo: "avisos",
    nivel: "moderada",
    umbral: 120,
    titulo: "Aviso abierto demasiado tiempo",
    porque: "Supera la duraci\xF3n m\xE1xima establecida para un aviso.",
    consecuencias: "Puede que se olvidara finalizarlo y las unidades sigan figurando ocupadas.",
    recomendacion: "Comprueba si sigue en curso; si termin\xF3, final\xEDzalo y libera sus unidades.",
    detectar: ({ s, t, umbral }) => avisosActivos(s).filter((a) => t - inicioAviso(a) >= umbral).map((a) => ({ entidad: aRef(a), desde: inicioAviso(a), detalle: `Aviso ${avisoLabel(a)} abierto desde hace ${Math.round((t - inicioAviso(a)) / MIN)} min` }))
  },
  {
    id: "aviso_sin_unidades_en_curso",
    grupo: "avisos",
    nivel: "alta",
    titulo: "Aviso asignado o en curso sin unidades",
    porque: "Su estado indica que alguien lo atiende, pero no tiene ninguna unidad asignada.",
    consecuencias: "Parece cubierto cuando no lo est\xE1.",
    recomendacion: "Asigna una unidad o devuelve el aviso a pendiente.",
    detectar: ({ s }) => avisosActivos(s).filter((a) => ["asignado", "en_curso"].includes(a.estado) && !a.part.some((p) => p.lib == null)).map((a) => ({ entidad: aRef(a), desde: a.enCursoEn || a.asignadoEn || inicioAviso(a), detalle: `Aviso ${avisoLabel(a)} en estado \xAB${a.estado}\xBB sin unidades` }))
  },
  {
    id: "aviso_posible_duplicado",
    grupo: "avisos",
    nivel: "info",
    umbral: 5,
    titulo: "Posible aviso duplicado",
    porque: "Hay dos avisos activos del mismo tipo, creados casi a la vez y en el mismo sitio o sector.",
    consecuencias: "Se pueden enviar recursos dos veces al mismo incidente.",
    recomendacion: "Revisa ambos; si son el mismo, finaliza uno indicando que est\xE1 duplicado.",
    detectar: ({ s, umbral }) => {
      const l = avisosActivos(s).filter((a) => a.tipo).sort((a, b) => a.creado - b.creado);
      const out = [];
      for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
        const a = l[i];
        const b = l[j];
        if (a.tipo !== b.tipo || b.creado - a.creado > umbral) continue;
        const cerca = a.sector && a.sector === b.sector || a.plan && b.plan && Math.hypot(a.plan.x - b.plan.x, a.plan.y - b.plan.y) < 0.03;
        if (cerca) out.push({ entidad: aRef(b), desde: b.creado, detalle: `Aviso ${avisoLabel(b)} parecido al ${avisoLabel(a)} (mismo tipo, mismo lugar, ${Math.round((b.creado - a.creado) / 1e3)} s despu\xE9s)` });
      }
      return out;
    }
  },
  {
    id: "aviso_incompleto",
    grupo: "avisos",
    nivel: "info",
    umbral: 10,
    titulo: "Aviso sin ubicaci\xF3n",
    porque: "No tiene ubicaci\xF3n, posici\xF3n en el plano ni sector.",
    consecuencias: "Las unidades pueden no saber ad\xF3nde ir y no se puede sugerir la m\xE1s cercana.",
    recomendacion: "A\xF1ade la ubicaci\xF3n, el sector o sit\xFAalo en el plano.",
    detectar: ({ s, t, umbral }) => avisosActivos(s).filter((a) => !a.plan && !a.zona && !a.sector && !(a.loc && (a.loc.txt || a.loc.lat != null)) && t - inicioAviso(a) >= umbral).map((a) => ({ entidad: aRef(a), desde: inicioAviso(a), detalle: `Aviso ${avisoLabel(a)} sin ubicaci\xF3n ni sector` }))
  },
  // ---------------- Descansos ----------------
  {
    id: "descanso_con_aviso",
    grupo: "descansos",
    nivel: "critica",
    titulo: "Unidad en descanso con un aviso activo",
    porque: "Una unidad con un aviso activo no puede estar descansando.",
    consecuencias: "El aviso puede quedar sin atender o la unidad trabajar sin descanso real.",
    recomendacion: "Decide si la unidad sigue en el aviso (finaliza el descanso) o descansa (lib\xE9rala y asigna otra).",
    detectar: ({ s, t }) => liveUnits(s).filter((u) => isResting(u, t)).flatMap((u) => avisosDe(s, u).slice(0, 1).map((a) => ({ entidad: uRef(u), desde: Math.max(u.descanso.ini, asigDe(a, u)), detalle: `${unitLabel(u)} descansa desde las ${hora(u.descanso.ini)} y est\xE1 en el aviso ${avisoLabel(a)}` })))
  },
  {
    id: "descanso_duracion",
    grupo: "descansos",
    nivel: "info",
    titulo: "Descanso con una duraci\xF3n incoherente",
    porque: "La duraci\xF3n no es razonable (nula, negativa o muy superior a lo habitual).",
    consecuencias: "La unidad puede quedar fuera de servicio sin que nadie lo note, y las estad\xEDsticas salen mal.",
    recomendacion: "Revisa el descanso y final\xEDzalo si ya termin\xF3.",
    detectar: ({ s, t }) => liveUnits(s).filter((u) => {
      const d = u.descanso;
      if (!d) return false;
      const max = Math.max(180, 3 * (s.prev.cfg && s.prev.cfg.descansoMin || 30));
      return isResting(u, t) && !(d.dur > 0 && d.dur <= max) || d.fin != null && d.fin < d.ini;
    }).map((u) => ({ entidad: uRef(u), desde: u.descanso.ini, detalle: `${unitLabel(u)}: descanso de ${u.descanso.dur} min` }))
  },
  {
    id: "descanso_y_clave",
    grupo: "descansos",
    nivel: "moderada",
    titulo: "Cambio de clave durante el descanso",
    porque: "La unidad cambi\xF3 de clave mientras figuraba descansando.",
    consecuencias: "No queda claro si estaba descansando o trabajando.",
    recomendacion: "Comprueba qu\xE9 pas\xF3 y finaliza el descanso si la unidad volvi\xF3 al servicio.",
    detectar: ({ s, t }) => liveUnits(s).filter((u) => isResting(u, t) && (u.hc || []).some((h) => h.t > u.descanso.ini && !h.auto)).map((u) => ({ entidad: uRef(u), desde: u.descanso.ini, detalle: `${unitLabel(u)} pas\xF3 a ${u.clave} durante el descanso` }))
  },
  // ---------------- Preventivo ----------------
  {
    id: "finalizado_con_pendientes",
    grupo: "preventivo",
    nivel: "alta",
    titulo: "Preventivo finalizado con asuntos abiertos",
    porque: "Est\xE1 finalizado, pero quedan avisos activos, unidades ocupadas o en descanso, o cambios sin enviar.",
    consecuencias: "El informe final y las estad\xEDsticas pueden no reflejar lo que realmente pas\xF3.",
    recomendacion: "Re\xE1brelo para cerrar lo pendiente o anota en las observaciones por qu\xE9 se finaliz\xF3 as\xED.",
    detectar: ({ s, t, sync }) => {
      if (s.prev.estado !== "cerrado") return [];
      const av = avisosActivos(s).length;
      const des = liveUnits(s).filter((u) => isResting(u, t)).length;
      const pend = sync.pendientes && sync.pendientes.n || 0;
      return av || des || pend ? [{ entidad: pRef(s), desde: s.prev.cerradoEn || null, detalle: [av && av + " aviso(s) activo(s)", des && des + " unidad(es) en descanso", pend && pend + " cambio(s) sin enviar"].filter(Boolean).join(", ") }] : [];
    }
  },
  {
    id: "sector_no_valido",
    grupo: "preventivo",
    nivel: "moderada",
    titulo: "Sectores mal configurados",
    porque: "Hay sectores con el mismo nombre o con una delimitaci\xF3n de menos de 3 puntos.",
    consecuencias: "Las unidades y avisos pueden asignarse al sector equivocado.",
    recomendacion: "Revisa los sectores del preventivo.",
    detectar: ({ s }) => {
      const l = s.prev.cat.sectores || [];
      const nombres = l.map((x) => String(x.nombre || "").trim().toLowerCase());
      const mal = l.filter((x, i) => !nombres[i] || nombres.indexOf(nombres[i]) !== i || x.zona && !(x.zona.pts && x.zona.pts.length >= 3));
      return mal.length ? [{ entidad: pRef(s), desde: null, detalle: mal.map((x) => x.nombre || x.id).join(", ") }] : [];
    }
  },
  {
    id: "ubicaciones_duplicadas",
    grupo: "preventivo",
    nivel: "info",
    titulo: "Puntos del plano repetidos",
    porque: "Hay puntos con el mismo nombre o en el mismo sitio.",
    consecuencias: "Puede elegirse el punto equivocado al ubicar un aviso.",
    recomendacion: "Quita o renombra los repetidos.",
    detectar: ({ s }) => {
      const l = s.prev.cat.puntos || [];
      const rep = /* @__PURE__ */ new Set();
      for (let i = 0; i < l.length; i++) for (let j = i + 1; j < l.length; j++) {
        const a = l[i];
        const b = l[j];
        if (String(a.nombre).trim().toLowerCase() === String(b.nombre).trim().toLowerCase() || a.pos && b.pos && Math.hypot(a.pos.x - b.pos.x, a.pos.y - b.pos.y) < 2e-3) {
          rep.add(a.nombre);
          rep.add(b.nombre);
        }
      }
      return rep.size ? [{ entidad: pRef(s), desde: null, detalle: [...rep].join(", ") }] : [];
    }
  },
  // ---------------- Sincronización (datos del dispositivo) ----------------
  {
    id: "rechazos_sin_revisar",
    grupo: "sincronizacion",
    nivel: "alta",
    titulo: "Cambios rechazados por el servidor sin revisar",
    porque: "El servidor no acept\xF3 cambios hechos en este dispositivo (p. ej. sin conexi\xF3n con permisos o datos ya caducados).",
    consecuencias: "Lo que se hizo no consta para los dem\xE1s.",
    recomendacion: "Rev\xEDsalos en Sistema \u2192 Servidor central y vuelve a hacer lo que siga haciendo falta.",
    detectar: ({ s, sync }) => {
      const l = (sync.rechazos || []).filter((r) => !r.revisado);
      return l.length ? [{ entidad: pRef(s), desde: Math.min(...l.map((r) => r.t || 0)) || null, detalle: l.length + " cambio(s): " + l.slice(0, 3).map((r) => (r.que || r.k) + " \u2014 " + r.error).join("; ") }] : [];
    }
  },
  {
    id: "conflicto_pendiente",
    grupo: "sincronizacion",
    nivel: "alta",
    titulo: "Cambios simult\xE1neos por resolver",
    porque: "Dos dispositivos cambiaron lo mismo a la vez y hay que elegir qu\xE9 versi\xF3n se conserva.",
    consecuencias: "Mientras tanto, cada dispositivo puede estar viendo un dato distinto.",
    recomendacion: "Resu\xE9lvelos en el aviso de conflictos del preventivo.",
    detectar: ({ s }) => {
      const l = Object.values(s.conflicts || {}).filter((c) => c.estado === "pendiente");
      return l.length ? [{ entidad: pRef(s), desde: Math.min(...l.map((c) => c.t || 0)) || null, detalle: l.length + " conflicto(s) pendiente(s)" }] : [];
    }
  },
  {
    id: "cambios_sin_enviar",
    grupo: "sincronizacion",
    nivel: "moderada",
    umbral: 10,
    titulo: "Cambios de este dispositivo sin enviar",
    porque: "Hay cambios guardados aqu\xED que todav\xEDa no han llegado al servidor.",
    consecuencias: "Los dem\xE1s dispositivos no los ven; el estado local y el confirmado son distintos.",
    recomendacion: "Comprueba la conexi\xF3n; se enviar\xE1n solos al volver.",
    detectar: ({ s, t, sync, umbral }) => {
      const p = sync.pendientes;
      return p && p.n > 0 && p.desde && t - p.desde >= umbral ? [{ entidad: pRef(s), desde: p.desde, detalle: p.n + " cambio(s) pendientes desde hace " + Math.round((t - p.desde) / MIN) + " min" }] : [];
    }
  },
  {
    id: "sin_sincronizar",
    grupo: "sincronizacion",
    nivel: "moderada",
    umbral: 15,
    titulo: "Datos sin sincronizar desde hace tiempo",
    porque: "Este dispositivo no se comunica con el servidor desde hace un rato.",
    consecuencias: "Lo que ves puede estar desactualizado respecto a los dem\xE1s.",
    recomendacion: "Comprueba la conexi\xF3n y el estado del servidor central.",
    detectar: ({ s, t, sync, umbral }) => sync.compartido && sync.ultimoSync && t - sync.ultimoSync >= umbral ? [{ entidad: pRef(s), desde: sync.ultimoSync, detalle: "\xDAltima sincronizaci\xF3n hace " + Math.round((t - sync.ultimoSync) / MIN) + " min" }] : []
  }
];
function hora(t) {
  const d = new Date(t);
  return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
}
function detectarIncoherencias(s, { t = Date.now(), sync = {} } = {}) {
  if (!s || !s.prev) return [];
  const cfg = s.prev.cfg && s.prev.cfg.reglas || {};
  const out = [];
  const vistos = /* @__PURE__ */ new Set();
  for (const r of REGLAS) {
    const c = cfg[r.id] || {};
    if (c.activa === false) continue;
    const umbral = c.umbral != null ? c.umbral : r.umbral;
    let hs;
    try {
      hs = r.detectar({ s, t, sync: sync || {}, umbral: umbral != null ? umbral * MIN : null }) || [];
    } catch {
      hs = [];
    }
    for (const h of hs) {
      const id = r.id + ":" + h.entidad.k + ":" + h.entidad.id;
      if (vistos.has(id)) continue;
      vistos.add(id);
      const firma = id + "|" + (h.desde || 0);
      const rev = s.revisiones && s.revisiones[id];
      out.push({ id, regla: r.id, grupo: r.grupo, nivel: NIVELES[c.nivel] ? c.nivel : r.nivel, titulo: r.titulo, porque: r.porque, consecuencias: r.consecuencias, recomendacion: r.recomendacion, entidad: h.entidad, desde: h.desde || null, detalle: h.detalle, firma, revision: rev && rev.firma === firma ? rev : null });
    }
  }
  return out.sort((a, b) => NIVELES[b.nivel].orden - NIVELES[a.nivel].orden || (a.desde || 0) - (b.desde || 0));
}

// src/core/crypto.js
var subtle = () => globalThis.crypto.subtle;
async function importAes(raw, extractable = true) {
  return subtle().importKey("raw", raw, { name: "AES-GCM" }, extractable, ["encrypt", "decrypt"]);
}
async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, bytes));
  return { iv, ct };
}
async function decryptBytes(key, rec) {
  return new Uint8Array(await subtle().decrypt({ name: "AES-GCM", iv: rec.iv }, key, rec.ct));
}
async function encryptJSON(key, obj) {
  return encryptBytes(key, enc.encode(JSON.stringify(obj)));
}
async function decryptJSON(key, rec) {
  return JSON.parse(dec.decode(await decryptBytes(key, rec)));
}
async function sha256(data) {
  const bytes = typeof data === "string" ? enc.encode(data) : data;
  return new Uint8Array(await subtle().digest("SHA-256", bytes));
}
async function sha256hex(data) {
  return hex(await sha256(data));
}
async function hkdfBits(secret, info, bits = 256) {
  const k = await subtle().importKey("raw", secret, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await subtle().deriveBits({ name: "HKDF", hash: "SHA-256", salt: enc.encode("uco-gestor-v1"), info: enc.encode(info) }, k, bits));
}
async function prevKeys(secret) {
  const keyRaw = await hkdfBits(secret, "datos");
  const token = hex(await hkdfBits(secret, "acceso"));
  return { key: await importAes(keyRaw, false), token, tokenHash: await sha256hex(token) };
}
async function orgKeys(secret) {
  const keyRaw = await hkdfBits(secret, "org-datos");
  const token = hex(await hkdfBits(secret, "org-acceso"));
  return { key: await importAes(keyRaw, false), token, tokenHash: await sha256hex(token) };
}
async function seal(key, obj) {
  const r = await encryptJSON(key, obj);
  const out = new Uint8Array(r.iv.length + r.ct.length);
  out.set(r.iv, 0);
  out.set(r.ct, r.iv.length);
  return b64(out);
}
async function open(key, str) {
  const u = unb64(str);
  return decryptJSON(key, { iv: u.subarray(0, 12), ct: u.subarray(12) });
}

// server/espacio-servidor.mjs
var SESION_MS = 90 * 24 * 36e5;
var CODIGO_MS = Number(process.env.UCO_CODIGO_MS) || 72 * 36e5;
var RETO_BITS = 16;
var REGISTROS_HORA = 10;
var MAX_PENDIENTES = 25;
var ABC = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
var USUARIO_RE = /^[a-z0-9][a-z0-9._@-]{1,49}$/;
var ESTADOS = ["pendiente", "activo", "suspendido", "desactivado", "rechazado", "invitado"];
var TRANSICIONES = {
  pendiente: ["activo", "rechazado"],
  invitado: ["desactivado", "activo"],
  activo: ["suspendido", "desactivado"],
  suspendido: ["activo", "desactivado"],
  desactivado: ["activo"],
  rechazado: ["activo"]
};
var normUsuario = (u) => String(u || "").trim().toLowerCase().replace(/\s+/g, ".");
var sha256hex2 = (s) => crypto.createHash("sha256").update(s).digest("hex");
var cuentaUid = (org, usuario) => sha256hex2("uco-cuenta:" + org + ":" + normUsuario(usuario));
var normCodigo = (s) => String(s || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
var err = (status, msg, codigo) => Object.assign(new Error(msg), { status, codigo });
var safeEq = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
var ceros = (buf) => {
  let n = 0;
  for (const b of buf) {
    if (b === 0) {
      n += 8;
      continue;
    }
    n += Math.clz32(b) - 24;
    break;
  }
  return n;
};
var nuevoCodigo = () => {
  const b = crypto.randomBytes(10);
  const c = Array.from(b, (x) => ABC[x % ABC.length]).join("");
  return c.slice(0, 4) + "-" + c.slice(4, 8) + "-" + c.slice(8);
};
var tipoActivo = (t) => !!t && t.activo !== false && !t.retirado;
function comprobar(args) {
  try {
    comprobarCambioUsuario(args);
  } catch (e) {
    throw err(e.code === "permiso" ? 403 : 400, e.message, e.code || "regla");
  }
}
var MENSAJE_ESTADO = {
  pendiente: "Tu cuenta est\xE1 pendiente de aprobaci\xF3n por un administrador.",
  suspendido: "Tu cuenta est\xE1 suspendida. Habla con un administrador.",
  desactivado: "Tu cuenta est\xE1 desactivada. Habla con un administrador.",
  rechazado: "Tu solicitud de cuenta fue rechazada.",
  invitado: "Tu cuenta a\xFAn no est\xE1 activada: usa el c\xF3digo de activaci\xF3n que te dio el administrador."
};
function crearModoServidor(deps) {
  const { DATA, log, writeAtomic, appendDurable, secretoServidor, comprobarCodigo, limiteAcceso, falloAcceso, limpiarFallos, orgSave } = deps;
  const CLAVES_DIR = path.join(DATA, "_servidor", "claves");
  const pidOrg = /* @__PURE__ */ new Map();
  const claveFile = (org) => path.join(CLAVES_DIR, org + ".json");
  const leerClaves = (org) => {
    try {
      return JSON.parse(fs.readFileSync(claveFile(org), "utf8"));
    } catch {
      return null;
    }
  };
  function guardarClaves(org, c) {
    fs.mkdirSync(CLAVES_DIR, { recursive: true });
    writeAtomic(claveFile(org), JSON.stringify(c));
    try {
      fs.chmodSync(claveFile(org), 384);
    } catch {
    }
  }
  const activo2 = (o) => !!(o && o.meta && o.meta.modo === "servidor");
  const rd = (o, n, def) => {
    try {
      return JSON.parse(fs.readFileSync(path.join(o.dir, n), "utf8"));
    } catch {
      return def;
    }
  };
  function guardar(o, ...nombres) {
    const ms = o.ms;
    const datos = { usuarios: ms.usuarios, sesiones: ms.sesiones, perfiles: ms.perfiles, ajustes: ms.ajustes };
    for (const n of nombres) writeAtomic(path.join(o.dir, n + ".json"), JSON.stringify(datos[n]));
  }
  async function _preparar(o) {
    const claves = leerClaves(o.meta.org);
    if (!claves || !claves.org) throw err(500, "Faltan las claves del espacio central en el servidor (datos\\_servidor\\claves)");
    const ms = {
      claves,
      k: await orgKeys(unb64(claves.org)),
      pk: /* @__PURE__ */ new Map(),
      motores: /* @__PURE__ */ new Map(),
      cfg: /* @__PURE__ */ new Map(),
      retos: /* @__PURE__ */ new Map(),
      regs: [],
      usuarios: rd(o, "usuarios.json", {}),
      sesiones: rd(o, "sesiones.json", {}),
      perfiles: rd(o, "perfiles.json", null) || defaultRoles(),
      ajustes: { registroAbierto: true, ...rd(o, "ajustes.json", {}) },
      porUid: /* @__PURE__ */ new Map(),
      guardadoSes: 0
    };
    for (const u of Object.values(ms.usuarios)) ms.porUid.set(cuentaUid(o.meta.org, u.usuario), u.id);
    for (const [id, v] of Object.entries(o.config)) {
      if (v.borrado) {
        ms.cfg.set(id, null);
        continue;
      }
      try {
        ms.cfg.set(id, (await open(ms.k.key, v.c)).data);
      } catch {
      }
    }
    for (const pid of Object.keys(claves.prevs || {})) pidOrg.set(pid, o.meta.org);
    o.ms = ms;
    return ms;
  }
  const preparar = (o) => o.ms ? Promise.resolve(o.ms) : o._msP ||= _preparar(o).catch((e) => {
    o._msP = null;
    throw e;
  });
  const estadoVisible = (u) => u.estado === "invitado" && u.codigo && Date.now() > u.codigo.exp ? "caducado" : estadoUsuario(u);
  const perfilPublico = (u) => ({
    id: u.id,
    usuario: u.usuario,
    nombre: u.nombre,
    rol: u.perfil || null,
    perfil: u.perfil || null,
    activo: estadoUsuario(u) === "activo",
    estado: estadoUsuario(u),
    metodo: u.metodo || "password",
    ajustes: u.ajustes || { mas: [], menos: [] },
    alcance: u.alcance || { tipo: "todos" },
    creado: u.creado || 0,
    cred: { v: u.credV || "v0", central: true }
  });
  const listado = (o, u) => ({
    ...perfilPublico(u),
    estadoVisible: estadoVisible(u),
    ultimoAcceso: u.ultimoAcceso || 0,
    creadoPor: u.creadoPor || "",
    origen: u.origen || "",
    aprobado: u.aprobado || null,
    codigo: u.codigo ? { tipo: u.codigo.tipo, exp: u.codigo.exp } : null,
    dispositivos: Object.entries(u.dispositivos || {}).map(([dev, d]) => ({ dev, nombre: d.nombre || "", creado: d.creado, ultimo: d.ultimo || 0 })),
    sesiones: Object.values(o.ms.sesiones).filter((s) => s.uid === u.id && s.sver === (u.sver || 0)).length,
    conContrasena: !!(u.pw || o.cuentas[cuentaUid(o.meta.org, u.usuario)])
  });
  async function publicar(o, id, data, borrado = false) {
    const cur = o.config[id];
    const v = cur ? cur.v : 0;
    o.config[id] = { v: v + 1, c: await seal(o.ms.k.key, { id, data }), borrado, sq: ++o.meta.seq, t: Date.now() };
    o.ms.cfg.set(id, borrado ? null : data);
    orgSave(o, "config", "meta");
  }
  const publicarUsuario = (o, u) => publicar(o, "usr:" + u.id, perfilPublico(u));
  const publicarPerfiles = (o) => publicar(o, "roles", o.ms.perfiles);
  function auditar(o, quien, accion, objetivo = "", antes = "", despues = "") {
    const e = { t: Date.now(), actor: quien && quien.u ? { id: quien.u.id, usuario: quien.u.usuario, nombre: quien.u.nombre } : null, dev: quien && quien.dev || "", accion, objetivo, antes: String(antes || "").slice(0, 4e3), despues: String(despues || "").slice(0, 4e3) };
    try {
      appendDurable(path.join(o.dir, "auditoria.jsonl"), JSON.stringify(e) + "\n");
    } catch (x) {
      log("Auditor\xEDa no guardada", x.message);
    }
  }
  const resumen = (u) => JSON.stringify({ usuario: u.usuario, nombre: u.nombre, estado: estadoUsuario(u), metodo: u.metodo || "password", perfil: u.perfil || null, ajustes: u.ajustes || null, alcance: u.alcance || null });
  function nuevaSesion(o, u, dev) {
    const tok = crypto.randomBytes(32).toString("hex");
    const t = Date.now();
    o.ms.sesiones[sha256hex2(tok)] = { uid: u.id, dev: String(dev || "").slice(0, 80), creado: t, ultimo: t, sver: u.sver || 0 };
    u.ultimoAcceso = t;
    for (const [h, s] of Object.entries(o.ms.sesiones)) if (t - s.ultimo > SESION_MS) delete o.ms.sesiones[h];
    guardar(o, "sesiones", "usuarios");
    return tok;
  }
  async function autenticar(req, o) {
    const hdr = req.headers.authorization || "";
    const tok = hdr.startsWith("Bearer ") ? hdr.slice(7) : "";
    if (!/^[0-9a-f]{64}$/.test(tok)) return null;
    const ms = await preparar(o);
    const h = sha256hex2(tok);
    const s = ms.sesiones[h];
    if (!s) return null;
    const u = ms.usuarios[s.uid];
    if (u && estadoUsuario(u) !== "activo") throw err(403, MENSAJE_ESTADO[estadoUsuario(u)] || "Tu cuenta no est\xE1 activa", "cuenta_" + estadoUsuario(u));
    if (!u || (u.sver || 0) !== s.sver || Date.now() - s.ultimo > SESION_MS) {
      delete ms.sesiones[h];
      guardar(o, "sesiones");
      return null;
    }
    s.ultimo = Date.now();
    if (Date.now() - ms.guardadoSes > 6e5) {
      ms.guardadoSes = Date.now();
      guardar(o, "sesiones");
    }
    return { u, dev: s.dev, h, ms };
  }
  const efectivos = (o, u, pid = null) => permisosEfectivos(u, o.ms.perfiles, pid);
  function exige(o, quien, perms, pid = null) {
    const ef = efectivos(o, quien.u, pid);
    const falta = perms.filter((k) => !ef.has(k));
    if (falta.length) throw err(403, "No tienes permiso para: " + falta.map((k) => (PERM_LABEL[k] || k).toLowerCase()).join(", ") + ".", "permiso");
  }
  const exigeAlguno = (o, quien, perms) => {
    const ef = efectivos(o, quien.u);
    if (!perms.some((k) => ef.has(k))) throw err(403, "No tienes permiso para administrar usuarios", "permiso");
  };
  const respuestaAcceso = (o, u, sesion) => ({ ok: true, modo: "servidor", sesion, secret: o.ms.claves.org, usuario: perfilPublico(u), nombre: o.meta.nombre, pruebas: o.meta.pruebas });
  function comprobarEstado(u) {
    const e = estadoUsuario(u);
    if (e !== "activo") throw err(403, MENSAJE_ESTADO[e] || "Tu cuenta no est\xE1 activa", "cuenta_" + e);
  }
  async function publico(req, res, url, parts, o, { send, readJson }) {
    const ms = await preparar(o);
    const org = o.meta.org;
    const r = parts[4];
    const r2 = parts[5];
    if (r === "acceso" && r2 === "sal" && req.method === "POST") {
      const b = await readJson(req);
      if (!/^[0-9a-f]{64}$/.test(b.uid || "")) return send(res, 400, { error: "Datos no v\xE1lidos" });
      const id = ms.porUid.get(b.uid);
      const u = id && ms.usuarios[id];
      const pw = u && (u.pw || o.cuentas[b.uid]);
      if (pw) return send(res, 200, { salt: pw.salt, iter: pw.iter });
      return send(res, 200, { salt: crypto.createHmac("sha256", secretoServidor()).update(org + ":" + b.uid).digest().subarray(0, 16).toString("base64"), iter: 6e5 });
    }
    if (r === "acceso" && !r2 && req.method === "POST") {
      const b = await readJson(req);
      if (!/^[0-9a-f]{64}$/.test(b.uid || "") || typeof b.prueba !== "string" || b.prueba.length > 100) return send(res, 400, { error: "Datos no v\xE1lidos" });
      limiteAcceso(b.uid);
      const id = ms.porUid.get(b.uid);
      const u = id && ms.usuarios[id];
      const pw = u && (u.pw || o.cuentas[b.uid]);
      const h = sha256hex2(Buffer.from(b.prueba, "base64"));
      if (!u || !pw || !safeEq(h, pw.verif)) {
        falloAcceso(b.uid);
        return send(res, 403, { error: "Usuario o contrase\xF1a incorrectos" });
      }
      limpiarFallos(b.uid);
      comprobarEstado(u);
      const sesion = nuevaSesion(o, u, b.dev);
      return send(res, 200, { ...respuestaAcceso(o, u, sesion), wrap: o.cuentas[b.uid] ? o.cuentas[b.uid].wrap : null });
    }
    if (r === "acceso" && r2 === "dispositivo" && req.method === "POST") {
      const b = await readJson(req);
      if (!/^[0-9a-f]{64}$/.test(b.uid || "") || !/^[0-9a-f]{64}$/.test(b.cred || "") || !/^[A-Za-z0-9_-]{4,80}$/.test(b.dev || "")) return send(res, 400, { error: "Datos no v\xE1lidos" });
      limiteAcceso("dev:" + b.uid);
      const id = ms.porUid.get(b.uid);
      const u = id && ms.usuarios[id];
      const d = u && (u.dispositivos || {})[b.dev];
      if (!d || !safeEq(sha256hex2(b.cred), d.credHash)) {
        falloAcceso("dev:" + b.uid);
        return send(res, 403, { error: "Este dispositivo ya no puede entrar con PIN: pide un c\xF3digo de activaci\xF3n nuevo", codigo: "dispositivo" });
      }
      limpiarFallos("dev:" + b.uid);
      comprobarEstado(u);
      d.ultimo = Date.now();
      return send(res, 200, respuestaAcceso(o, u, nuevaSesion(o, u, b.dev)));
    }
    if (r === "activacion" && r2 === "consultar" && req.method === "POST") {
      const b = await readJson(req);
      const uid = cuentaUid(org, b.usuario);
      limiteAcceso("act:" + uid);
      const id = ms.porUid.get(uid);
      const u = id && ms.usuarios[id];
      const c = u && u.codigo;
      if (!c || Date.now() > c.exp || !safeEq(sha256hex2(normCodigo(b.codigo)), c.hash)) {
        falloAcceso("act:" + uid);
        return send(res, 403, { error: "C\xF3digo no v\xE1lido o caducado. Pide uno nuevo a un administrador.", codigo: "codigo" });
      }
      return send(res, 200, { metodo: u.metodo || "password", tipo: c.tipo, nombre: u.nombre });
    }
    if (r === "activacion" && !r2 && req.method === "POST") {
      const b = await readJson(req);
      const uid = cuentaUid(org, b.usuario);
      if (!/^[A-Za-z0-9_-]{4,80}$/.test(b.dev || "")) return send(res, 400, { error: "Datos no v\xE1lidos" });
      limiteAcceso("act:" + uid);
      const id = ms.porUid.get(uid);
      const u = id && ms.usuarios[id];
      const c = u && u.codigo;
      if (!c || Date.now() > c.exp || !safeEq(sha256hex2(normCodigo(b.codigo)), c.hash)) {
        falloAcceso("act:" + uid);
        return send(res, 403, { error: "C\xF3digo no v\xE1lido o caducado. Pide uno nuevo a un administrador.", codigo: "codigo" });
      }
      if (!["invitado", "activo"].includes(estadoUsuario(u))) comprobarEstado(u);
      const antes = resumen(u);
      if ((u.metodo || "password") === "pin") {
        if (!/^[0-9a-f]{64}$/.test(b.cred || "")) return send(res, 400, { error: "Falta la credencial del dispositivo" });
        u.dispositivos = { ...u.dispositivos || {}, [b.dev]: { credHash: sha256hex2(b.cred), nombre: String(b.devNombre || "").slice(0, 80), creado: Date.now() } };
      } else {
        const pw = b.pw || {};
        if (typeof pw.salt !== "string" || pw.salt.length > 64 || !Number.isInteger(pw.iter) || pw.iter < 1e5 || pw.iter > 5e6 || !/^[0-9a-f]{64}$/.test(pw.verif || "")) return send(res, 400, { error: "Falta la contrase\xF1a nueva" });
        u.pw = { salt: pw.salt, iter: pw.iter, verif: pw.verif };
        u.credV = "v" + crypto.randomBytes(6).toString("hex");
      }
      delete u.codigo;
      limpiarFallos("act:" + uid);
      if (u.estado === "invitado") u.estado = "activo";
      const sesion = nuevaSesion(o, u, b.dev);
      await publicarUsuario(o, u);
      auditar(o, { u, dev: b.dev }, c.tipo === "restablecer" ? "Contrase\xF1a restablecida con c\xF3digo" : "Cuenta activada en un dispositivo", u.usuario, antes, resumen(u) + (b.devNombre ? " \xB7 dispositivo " + String(b.devNombre).slice(0, 80) : ""));
      return send(res, 200, respuestaAcceso(o, u, sesion));
    }
    if (r === "registro") {
      if (!ms.ajustes.registroAbierto) return send(res, 403, { error: "El registro de cuentas est\xE1 desactivado. Pide a un administrador que te d\xE9 de alta.", codigo: "registro_cerrado" });
      const firmar = (reto, exp, dif) => crypto.createHmac("sha256", secretoServidor()).update(org + ":" + reto + ":" + exp + ":" + dif).digest("hex");
      if (r2 === "reto" && req.method === "GET") {
        const reto = crypto.randomBytes(16).toString("hex");
        const exp = Date.now() + 10 * 6e4;
        return send(res, 200, { reto, exp, dificultad: RETO_BITS, firma: firmar(reto, exp, RETO_BITS) });
      }
      if (!r2 && req.method === "POST") {
        const b = await readJson(req);
        const t = Date.now();
        if (!/^[0-9a-f]{32}$/.test(b.reto || "") || !Number.isInteger(b.exp) || b.exp < t || b.dificultad !== RETO_BITS || !safeEq(firmar(b.reto, b.exp, b.dificultad), String(b.firma || "")) || ms.retos.has(b.reto)) return send(res, 400, { error: "La comprobaci\xF3n ha caducado: vuelve a intentarlo", codigo: "reto" });
        if (ceros(crypto.createHash("sha256").update(b.reto + ":" + String(b.nonce)).digest()) < RETO_BITS) return send(res, 400, { error: "Comprobaci\xF3n anti-abuso no superada", codigo: "reto" });
        for (const [k, e] of ms.retos) if (e < t) ms.retos.delete(k);
        ms.retos.set(b.reto, b.exp);
        ms.regs = ms.regs.filter((x) => t - x < 36e5);
        if (ms.regs.length >= REGISTROS_HORA) return send(res, 429, { error: "Demasiadas solicitudes de cuenta: int\xE9ntalo dentro de un rato", codigo: "limite" });
        if (Object.values(ms.usuarios).filter((u2) => u2.estado === "pendiente").length >= MAX_PENDIENTES) return send(res, 429, { error: "Hay demasiadas solicitudes pendientes de revisar: int\xE9ntalo m\xE1s tarde", codigo: "limite" });
        const usuario = normUsuario(b.usuario);
        const nombre = String(b.nombre || "").trim().slice(0, 80);
        if (!USUARIO_RE.test(usuario)) return send(res, 400, { error: "El nombre de usuario debe tener entre 2 y 50 caracteres: letras sin acentos, n\xFAmeros, punto, guion o @" });
        if (!nombre) return send(res, 400, { error: "Indica tu nombre" });
        if (typeof b.salt !== "string" || b.salt.length > 64 || !Number.isInteger(b.iter) || b.iter < 1e5 || b.iter > 5e6 || !/^[0-9a-f]{64}$/.test(b.verif || "")) return send(res, 400, { error: "Datos no v\xE1lidos" });
        if (ms.porUid.has(cuentaUid(org, usuario)) || o.cuentas[cuentaUid(org, usuario)]) return send(res, 409, { error: "Ese nombre de usuario ya existe: elige otro", codigo: "duplicado" });
        ms.regs.push(t);
        const u = { id: "usr_" + crypto.randomBytes(9).toString("base64url"), usuario, nombre, estado: "pendiente", metodo: "password", perfil: null, pw: { salt: b.salt, iter: b.iter, verif: b.verif }, origen: "registro", creado: t };
        ms.usuarios[u.id] = u;
        ms.porUid.set(cuentaUid(org, usuario), u.id);
        guardar(o, "usuarios");
        await publicarUsuario(o, u);
        auditar(o, null, "Solicitud de cuenta (registro desde el inicio de sesi\xF3n)", usuario, "", resumen(u));
        return send(res, 201, { ok: true, estado: "pendiente", mensaje: MENSAJE_ESTADO.pendiente });
      }
    }
    return void 0;
  }
  async function privado(req, res, url, parts, o, quien, { send, readJson }) {
    const ms = o.ms;
    const r = parts[4];
    if (r === "yo" && req.method === "GET") return send(res, 200, { usuario: perfilPublico(quien.u), permisos: [...efectivos(o, quien.u)], perfiles: ms.perfiles });
    if (r === "sesion" && parts[5] === "cerrar" && req.method === "POST") {
      delete ms.sesiones[quien.h];
      guardar(o, "sesiones");
      return send(res, 200, { ok: true });
    }
    if (r !== "admin") return void 0;
    const a = parts[5];
    if (a === "usuarios") {
      exigeAlguno(o, quien, ["usuarios.crear", "usuarios.editar", "usuarios.aprobar", "usuarios.permisos"]);
      const lista = () => Object.values(ms.usuarios);
      if (!parts[6] && req.method === "GET") return send(res, 200, { usuarios: lista().map((u2) => listado(o, u2)), perfiles: ms.perfiles, ajustes: ms.ajustes });
      if (!parts[6] && req.method === "POST") {
        const b = await readJson(req);
        const usuario = normUsuario(b.usuario);
        const nombre = String(b.nombre || usuario).trim().slice(0, 80);
        if (!USUARIO_RE.test(usuario)) throw err(400, "Nombre de usuario no v\xE1lido (2\u201350 caracteres: letras sin acentos, n\xFAmeros, punto, guion o @)");
        if (ms.porUid.has(cuentaUid(o.meta.org, usuario))) throw err(409, "Ese nombre de usuario ya existe", "duplicado");
        const metodo = b.metodo === "pin" ? "pin" : "password";
        const pw = metodo === "password" && b.pw && /^[0-9a-f]{64}$/.test(b.pw.verif || "") && Number.isInteger(b.pw.iter) && b.pw.iter >= 1e5 && b.pw.iter <= 5e6 && typeof b.pw.salt === "string" && b.pw.salt.length <= 64 ? { salt: b.pw.salt, iter: b.pw.iter, verif: b.pw.verif } : null;
        const u2 = { id: "usr_" + crypto.randomBytes(9).toString("base64url"), usuario, nombre, metodo, estado: pw ? "activo" : "invitado", perfil: limpiarPerfil(ms, b.perfil), ajustes: limpiarAjustes(b.ajustes), alcance: limpiarAlcance(b.alcance), creado: Date.now(), creadoPor: quien.u.usuario, origen: "administrador" };
        if (pw) {
          u2.pw = pw;
          u2.credV = "v" + crypto.randomBytes(6).toString("hex");
        }
        comprobar({ actor: quien.u, antes: null, despues: u2, perfiles: ms.perfiles, usuarios: lista() });
        let codigo = null;
        if (!pw) {
          codigo = nuevoCodigo();
          u2.codigo = { hash: sha256hex2(normCodigo(codigo)), tipo: "activacion", exp: Date.now() + CODIGO_MS, creadoPor: quien.u.usuario };
        }
        ms.usuarios[u2.id] = u2;
        ms.porUid.set(cuentaUid(o.meta.org, usuario), u2.id);
        guardar(o, "usuarios");
        await publicarUsuario(o, u2);
        auditar(o, quien, "Alta de usuario", usuario, "", resumen(u2) + (codigo ? " \xB7 c\xF3digo de activaci\xF3n emitido" : ""));
        return send(res, 201, { usuario: listado(o, u2), codigo });
      }
      const u = parts[6] && ms.usuarios[parts[6]];
      if (!u) throw err(404, "Usuario no encontrado");
      if (!parts[7] && req.method === "PATCH") {
        const b = await readJson(req);
        const antes = JSON.parse(JSON.stringify(u));
        const despues = { ...u };
        if ("nombre" in b) despues.nombre = String(b.nombre || u.usuario).trim().slice(0, 80);
        if ("perfil" in b) despues.perfil = limpiarPerfil(ms, b.perfil);
        if ("ajustes" in b) despues.ajustes = limpiarAjustes(b.ajustes);
        if ("alcance" in b) despues.alcance = limpiarAlcance(b.alcance);
        if ("estado" in b) {
          if (!ESTADOS.includes(b.estado)) throw err(400, "Estado no v\xE1lido");
          if (b.estado !== estadoUsuario(u) && !(TRANSICIONES[estadoUsuario(u)] || []).includes(b.estado)) throw err(400, "No se puede pasar de \xAB" + estadoUsuario(u) + "\xBB a \xAB" + b.estado + "\xBB");
          despues.estado = b.estado;
          if (b.estado === "activo" && estadoUsuario(u) === "pendiente") despues.aprobado = { por: quien.u.usuario, t: Date.now() };
          if (b.estado === "activo" && !despues.pw && !o.cuentas[cuentaUid(o.meta.org, u.usuario)] && !Object.keys(u.dispositivos || {}).length) throw err(400, "La cuenta no tiene ninguna forma de entrar todav\xEDa: genera un c\xF3digo de activaci\xF3n");
        }
        let codigo = null;
        if ("metodo" in b && (b.metodo === "pin" ? "pin" : "password") !== (u.metodo || "password")) {
          despues.metodo = b.metodo === "pin" ? "pin" : "password";
          delete despues.pw;
          despues.dispositivos = {};
          despues.sver = (u.sver || 0) + 1;
          if (estadoUsuario(u) === "activo") despues.estado = "invitado";
          codigo = nuevoCodigo();
          despues.codigo = { hash: sha256hex2(normCodigo(codigo)), tipo: "activacion", exp: Date.now() + CODIGO_MS, creadoPor: quien.u.usuario };
        }
        comprobar({ actor: quien.u, antes: u, despues, perfiles: ms.perfiles, usuarios: Object.values(ms.usuarios) });
        if (estadoUsuario(despues) !== "activo" && estadoUsuario(u) === "activo") despues.sver = (despues.sver || 0) + 1;
        if ("metodo" in b && despues.metodo !== (u.metodo || "password")) delete o.cuentas[cuentaUid(o.meta.org, u.usuario)];
        ms.usuarios[u.id] = despues;
        guardar(o, "usuarios");
        if ("metodo" in b) orgSave(o, "cuentas");
        await publicarUsuario(o, despues);
        auditar(o, quien, accionCambio(antes, despues), u.usuario, resumen(antes), resumen(despues) + (codigo ? " \xB7 c\xF3digo de activaci\xF3n emitido" : ""));
        return send(res, 200, { usuario: listado(o, despues), codigo });
      }
      if (parts[7] === "codigo" && req.method === "POST") {
        exige(o, quien, ["usuarios.editar"]);
        if (quien.u.id === u.id) throw err(403, "No puedes generarte un c\xF3digo a ti mismo: p\xEDdeselo a otro administrador", "permiso");
        comprobar({ actor: quien.u, antes: u, despues: u, perfiles: ms.perfiles, usuarios: Object.values(ms.usuarios) });
        if (["rechazado", "desactivado", "pendiente"].includes(estadoUsuario(u))) throw err(400, "Activa antes la cuenta");
        const codigo = nuevoCodigo();
        const tipo = (u.metodo || "password") === "pin" || u.estado === "invitado" ? "activacion" : "restablecer";
        u.codigo = { hash: sha256hex2(normCodigo(codigo)), tipo, exp: Date.now() + CODIGO_MS, creadoPor: quien.u.usuario };
        guardar(o, "usuarios");
        auditar(o, quien, tipo === "activacion" ? "C\xF3digo de activaci\xF3n emitido" : "C\xF3digo para restablecer la contrase\xF1a emitido", u.usuario, "", "Caduca " + new Date(u.codigo.exp).toISOString());
        return send(res, 200, { usuario: listado(o, u), codigo });
      }
      if (parts[7] === "revocar" && req.method === "POST") {
        exige(o, quien, ["usuarios.editar"]);
        comprobar({ actor: quien.u, antes: u, despues: u, perfiles: ms.perfiles, usuarios: Object.values(ms.usuarios) });
        const b = await readJson(req);
        let det;
        if (b.dev) {
          const d = (u.dispositivos || {})[b.dev];
          if (d) delete u.dispositivos[b.dev];
          for (const [h, s] of Object.entries(ms.sesiones)) if (s.uid === u.id && s.dev === b.dev) delete ms.sesiones[h];
          det = "Dispositivo " + (d && d.nombre || b.dev) + ": acceso con PIN y sesiones retirados";
        } else {
          u.sver = (u.sver || 0) + 1;
          if (b.dispositivos) u.dispositivos = {};
          det = "Todas las sesiones cerradas" + (b.dispositivos ? " y accesos con PIN retirados" : "");
        }
        guardar(o, "usuarios", "sesiones");
        auditar(o, quien, "Accesos revocados", u.usuario, "", det);
        return send(res, 200, { usuario: listado(o, u) });
      }
    }
    if (a === "perfiles") {
      if (req.method === "GET") {
        exigeAlguno(o, quien, ["usuarios.crear", "usuarios.editar", "usuarios.aprobar", "usuarios.permisos"]);
        return send(res, 200, { perfiles: ms.perfiles });
      }
      if (req.method === "PUT") {
        exige(o, quien, ["usuarios.permisos"]);
        const b = await readJson(req);
        const nuevos = b.perfiles;
        if (!Array.isArray(nuevos) || nuevos.length > 100) throw err(400, "Perfiles no v\xE1lidos");
        const ef = efectivos(o, quien.u);
        const ids = /* @__PURE__ */ new Set();
        const lista = nuevos.map((p) => {
          if (!/^[A-Za-z0-9_-]{3,60}$/.test(p.id || "") || ids.has(p.id)) throw err(400, "Identificador de perfil no v\xE1lido o repetido");
          ids.add(p.id);
          const nombre = String(p.nombre || "").trim().slice(0, 60);
          if (!nombre) throw err(400, "Todos los perfiles necesitan nombre");
          const permisos = [...new Set((p.permisos || []).filter((k) => PERM_KEYS.includes(k)))];
          const previo = ms.perfiles.find((x) => x.id === p.id);
          const antes = new Set(previo ? normalizarPerfil(previo).permisos : []);
          const extra = permisos.filter((k) => !antes.has(k) && !ef.has(k));
          if (extra.length) throw err(403, "No tienes los permisos que intentas a\xF1adir al perfil \xAB" + nombre + "\xBB: " + extra.map((k) => PERM_LABEL[k]).join(", "), "permiso");
          return { id: p.id, nombre, permisos, v: 2, ...previo && previo.sistema ? { sistema: true } : {} };
        });
        const admin = lista.find((p) => p.id === "rol_admin");
        if (!admin) throw err(400, "El perfil Administrador no se puede eliminar");
        admin.permisos = [...PERM_KEYS];
        for (const p of ms.perfiles) if (!ids.has(p.id) && Object.values(ms.usuarios).some((u) => u.perfil === p.id || Object.values(u.alcance && u.alcance.preventivos || {}).includes(p.id)))
          throw err(400, "El perfil \xAB" + p.nombre + "\xBB lo usa alg\xFAn usuario: c\xE1mbiaselo antes de eliminarlo");
        const antesTxt = JSON.stringify(ms.perfiles.map((p) => [p.nombre, normalizarPerfil(p).permisos.length]));
        ms.perfiles = lista;
        guardar(o, "perfiles");
        await publicarPerfiles(o);
        auditar(o, quien, "Perfiles de permisos modificados", "Perfiles", antesTxt, JSON.stringify(lista.map((p) => [p.nombre, p.permisos.length])));
        return send(res, 200, { perfiles: ms.perfiles });
      }
    }
    if (a === "ajustes") {
      if (req.method === "GET") return send(res, 200, { ajustes: ms.ajustes });
      if (req.method === "PUT") {
        exige(o, quien, ["usuarios.admin"]);
        const b = await readJson(req);
        const antes = JSON.stringify(ms.ajustes);
        if ("registroAbierto" in b) ms.ajustes.registroAbierto = !!b.registroAbierto;
        guardar(o, "ajustes");
        auditar(o, quien, "Ajustes de cuentas", "Registro desde el inicio de sesi\xF3n", antes, JSON.stringify(ms.ajustes));
        return send(res, 200, { ajustes: ms.ajustes });
      }
    }
    if (a === "auditoria" && req.method === "GET") {
      exige(o, quien, ["auditoria.ver"]);
      const filtro = url.searchParams.get("usuario") || "";
      const lim = Math.min(2e3, Math.max(1, Number(url.searchParams.get("limite") || 500)));
      let out = [];
      try {
        out = fs.readFileSync(path.join(o.dir, "auditoria.jsonl"), "utf8").split("\n").filter(Boolean).map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        }).filter(Boolean);
      } catch {
      }
      if (filtro) out = out.filter((e) => e.actor && (e.actor.id === filtro || e.actor.usuario === filtro) || e.objetivo === filtro);
      return send(res, 200, { registros: out.slice(-lim).reverse() });
    }
    return void 0;
  }
  const limpiarPerfil = (ms, p) => p && ms.perfiles.some((x) => x.id === p) ? p : null;
  const limpiarAjustes = (a) => ({ mas: [...new Set((a && a.mas || []).filter((k) => PERM_KEYS.includes(k)))], menos: [...new Set((a && a.menos || []).filter((k) => PERM_KEYS.includes(k)))] });
  function limpiarAlcance(a) {
    if (!a || a.tipo !== "seleccion") return { tipo: "todos" };
    const p = {};
    for (const [pid, perf] of Object.entries(a.preventivos || {}).slice(0, 500)) if (/^[A-Za-z0-9][A-Za-z0-9_-]{3,79}$/.test(pid)) p[pid] = typeof perf === "string" ? perf : null;
    return { tipo: "seleccion", preventivos: p };
  }
  function accionCambio(a, d) {
    const ea = estadoUsuario(a), ed = estadoUsuario(d);
    if (ea !== ed) return { activo: ea === "pendiente" ? "Registro aprobado" : "Cuenta reactivada", rechazado: "Registro rechazado", suspendido: "Cuenta suspendida", desactivado: "Cuenta desactivada", invitado: "M\xE9todo de acceso cambiado" }[ed] || "Estado de cuenta cambiado";
    if ((a.metodo || "password") !== (d.metodo || "password")) return "M\xE9todo de acceso cambiado";
    return JSON.stringify([a.perfil, a.ajustes, a.alcance]) !== JSON.stringify([d.perfil, d.ajustes, d.alcance]) ? "Permisos modificados" : "Usuario modificado";
  }
  function permisoConfig(id) {
    if (id.startsWith("usr:") || id === "roles") return null;
    if (id.startsWith("tipo:") || id.startsWith("plt:")) return "recursos.gestionar";
    if (id.startsWith("mapa:")) return "planos.editar";
    return "config.editar";
  }
  async function validarConfig(o, quien, id, b) {
    const perm = permisoConfig(id);
    if (!perm) throw err(403, "Los usuarios y perfiles se gestionan desde la administraci\xF3n del servidor", "permiso");
    exige(o, quien, [perm]);
    let data = null;
    if (!b.borrado) {
      try {
        const x = await open(o.ms.k.key, b.c);
        if (x.id !== id) throw new Error();
        data = x.data;
      } catch {
        throw err(400, "Elemento cifrado con otra clave");
      }
    }
    return data;
  }
  const configGuardada = (o, id, data, borrado) => o.ms.cfg.set(id, borrado ? null : data);
  async function validarRegistro(o, quien, pid, w) {
    let info;
    try {
      info = await open(o.ms.k.key, w);
    } catch {
      throw err(400, "Registro cifrado con otra clave");
    }
    if (info.pid && info.pid !== pid) throw err(400, "Registro de otro preventivo");
    const nuevo = !o.prevs[pid];
    if (nuevo) exige(o, quien, ["preventivos.crear"]);
    else if (!accesoPreventivo(quien.u, pid)) throw err(403, "No tienes acceso a este preventivo", "permiso");
    const cl = o.ms.claves.prevs || (o.ms.claves.prevs = {});
    if (info.secret) {
      if (cl[pid] && cl[pid] !== info.secret) throw err(409, "El preventivo ya existe con otra clave");
      if (!cl[pid]) {
        cl[pid] = info.secret;
        guardarClaves(o.meta.org, o.ms.claves);
        pidOrg.set(pid, o.meta.org);
      }
    }
  }
  const puedeVerPrev = (o, u, pid) => accesoPreventivo(u, pid) && efectivos(o, u, pid).has("preventivos.ver");
  async function clavesPrev(o, pid) {
    if (o.ms.pk.has(pid)) return o.ms.pk.get(pid);
    const s = (o.ms.claves.prevs || {})[pid];
    if (!s) return null;
    const k = await prevKeys(unb64(s));
    o.ms.pk.set(pid, k);
    return k;
  }
  async function motorPrev(o, pid, p) {
    if (o.ms.motores.has(pid)) return o.ms.motores.get(pid);
    const k = await clavesPrev(o, pid);
    if (!k) throw err(409, "El servidor a\xFAn no tiene la clave de este preventivo: vuelve a intentarlo en un momento", "sin_clave");
    const ops = [];
    for (const r of p.ops) {
      try {
        const op = await open(k.key, r.c);
        op.sq = r.sq;
        op.num = r.num ?? null;
        ops.push(op);
      } catch {
      }
    }
    const e = new Engine(ops);
    o.ms.motores.set(pid, e);
    return e;
  }
  function tipoNoDisponible(o, s, tipoId, lote, op) {
    if (!tipoId) return null;
    const noDisp = /* @__PURE__ */ new Set();
    if (o.ms.cfg.has("tipo:" + tipoId)) {
      const g = o.ms.cfg.get("tipo:" + tipoId);
      if (!tipoActivo(g)) noDisp.add(tipoId);
    }
    let t = s.prev && s.prev.cat.tiposRecurso.find((x) => x.id === tipoId);
    if (!t) {
      const inc = lote.find((x) => x.k === "prev.cat" && x.b === op.b && x.x && x.x.cat === "tiposRecurso");
      t = inc && inc.x.n.find((x) => x.id === tipoId);
    }
    return t ? motivoTipoNoDisponible(t, noDisp) : null;
  }
  async function validarOps(o, pid, quien, recs, p) {
    const k = await clavesPrev(o, pid);
    if (!k) throw err(409, "El servidor a\xFAn no tiene la clave de este preventivo: vuelve a intentarlo en un momento", "sin_clave");
    const motor = await motorPrev(o, pid, p);
    const ops = [];
    for (const r of recs) {
      try {
        ops.push(await open(k.key, r.c));
      } catch {
        ops.push(null);
      }
    }
    const ef = efectivos(o, quien.u, pid);
    const out = [];
    const st = lazyCopy(motor.state);
    const lookup = (id) => motor.byId.get(id);
    for (const [i, op] of ops.entries()) {
      const rechazo = (error, codigo = "permiso") => {
        out.push({ error, codigo });
        auditar(o, quien, "Operaci\xF3n rechazada", pid, op ? op.k + " " + op.e : "", error);
      };
      if (!op) {
        rechazo("Operaci\xF3n cifrada con otra clave", "clave");
        continue;
      }
      if (op.id !== recs[i].id || op.p !== pid) {
        rechazo("Operaci\xF3n de otro preventivo", "datos");
        continue;
      }
      if (!op.u || op.u.id !== quien.u.id) {
        rechazo("La operaci\xF3n no la ha hecho el usuario de esta sesi\xF3n", "identidad");
        continue;
      }
      if (op.d !== quien.dev) {
        rechazo("La operaci\xF3n no procede de este dispositivo", "identidad");
        continue;
      }
      if (!puedeVerPrev(o, quien.u, pid)) {
        rechazo("No tienes acceso a este preventivo");
        continue;
      }
      const req = permisosOp(op, st, ops.filter(Boolean));
      if (!req) {
        rechazo("Operaci\xF3n no reconocida por el servidor (\xBFaplicaci\xF3n sin actualizar?)", "datos");
        continue;
      }
      const falta = req.filter((x) => !ef.has(x));
      if (falta.length) {
        rechazo("No tienes permiso para: " + falta.map((x) => (PERM_LABEL[x] || x).toLowerCase()).join(", "));
        continue;
      }
      const contenido = motivoContenidoNoValido(op);
      if (contenido) {
        rechazo(contenido, "datos");
        continue;
      }
      const enAlta = ops.some((x) => x && x.k === "prev.create" && x.b === op.b);
      const tipo = op.k === "unit.create" && !enAlta ? op.x && op.x.u && op.x.u.tipo : op.k === "unit.update" ? op.x && op.x.f && op.x.f.tipo && op.x.f.tipo.n : null;
      const motivo = tipoNoDisponible(o, st, tipo, ops.filter(Boolean), op);
      if (motivo) {
        const t = (st.prev && st.prev.cat.tiposRecurso.find((x) => x.id === tipo) || {}).nombre || tipo;
        rechazo("El tipo de recurso \xAB" + t + "\xBB est\xE1 " + motivo + ": no se puede usar en unidades nuevas. Actualiza los datos de la aplicaci\xF3n y elige otro tipo.", "tipo_inactivo");
        continue;
      }
      out.push({ ok: true, op });
      applyOp(st, op, { lookup });
    }
    return out;
  }
  function aplicar(o, pid, ops) {
    const m = o.ms && o.ms.motores.get(pid);
    if (m && ops.length) m.add(ops);
  }
  async function iniciarEspacio(o, secret, admin, dev) {
    guardarClaves(o.meta.org, { org: secret, prevs: {} });
    o.meta.modo = "servidor";
    o.meta.minCliente = "1.4.0";
    o.meta.modoDesde = Date.now();
    await preparar(o);
    const u = { id: admin.id || "usr_" + crypto.randomBytes(9).toString("base64url"), usuario: normUsuario(admin.usuario), nombre: String(admin.nombre || admin.usuario).trim().slice(0, 80), estado: "activo", metodo: "password", perfil: "rol_admin", pw: admin.pw, credV: "v" + crypto.randomBytes(6).toString("hex"), creado: Date.now(), origen: "creador" };
    if (!USUARIO_RE.test(u.usuario) || !u.pw || !/^[0-9a-f]{64}$/.test(u.pw.verif || "")) throw err(400, "Datos del administrador no v\xE1lidos");
    o.ms.usuarios[u.id] = u;
    o.ms.porUid.set(cuentaUid(o.meta.org, u.usuario), u.id);
    orgSave(o, "meta");
    guardar(o, "usuarios", "perfiles", "ajustes");
    await publicarPerfiles(o);
    await publicarUsuario(o, u);
    auditar(o, { u, dev }, "Espacio central creado en modo servidor", o.meta.nombre || o.meta.org, "", "Administrador " + u.usuario);
    return nuevaSesion(o, u, dev);
  }
  async function migrar(o, secretB64, { usuario = "", dev = "" } = {}) {
    if (activo2(o)) throw err(409, "El espacio central ya est\xE1 en modo servidor");
    const k = await orgKeys(unb64(secretB64));
    if (k.tokenHash !== o.meta.tokenHash) throw err(403, "La clave no corresponde a este espacio central");
    const copia = path.join(DATA, "_servidor", "copias", o.meta.org + "-" + (/* @__PURE__ */ new Date()).toISOString().replace(/[:.]/g, "-"));
    fs.mkdirSync(copia, { recursive: true });
    for (const f of fs.readdirSync(o.dir)) {
      const src = path.join(o.dir, f);
      if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(copia, f));
    }
    const prevs = {};
    for (const [pid, v] of Object.entries(o.prevs)) {
      try {
        const info = await open(k.key, v.w);
        if (info.secret) prevs[pid] = info.secret;
      } catch {
      }
    }
    const usuarios = {};
    let perfiles = null;
    for (const [id, v] of Object.entries(o.config)) {
      if (v.borrado) continue;
      let data;
      try {
        data = (await open(k.key, v.c)).data;
      } catch {
        continue;
      }
      if (id === "roles" && Array.isArray(data)) perfiles = data;
      if (id.startsWith("usr:") && data && data.usuario) {
        const c = o.cuentas[cuentaUid(o.meta.org, data.usuario)];
        usuarios[data.id] = { id: data.id, usuario: normUsuario(data.usuario), nombre: data.nombre || data.usuario, estado: data.activo === false ? "desactivado" : "activo", metodo: "password", perfil: data.rol || null, creado: data.creado || Date.now(), credV: data.cred && data.cred.v || "v0", origen: "migracion", ...c ? { pw: { salt: c.salt, iter: c.iter, verif: c.verif } } : {} };
      }
    }
    if (!Object.values(usuarios).some((u) => u.estado === "activo" && u.perfil === "rol_admin")) throw err(400, "No se ha encontrado ning\xFAn administrador activo en el espacio: no se migra");
    guardarClaves(o.meta.org, { org: secretB64, prevs });
    writeAtomic(path.join(o.dir, "usuarios.json"), JSON.stringify(usuarios));
    writeAtomic(path.join(o.dir, "perfiles.json"), JSON.stringify(perfiles || defaultRoles()));
    o.meta.modo = "servidor";
    o.meta.minCliente = "1.4.0";
    o.meta.modoDesde = Date.now();
    orgSave(o, "meta");
    o.ms = null;
    o._msP = null;
    await preparar(o);
    for (const u of Object.values(o.ms.usuarios)) await publicarUsuario(o, u);
    await publicarPerfiles(o);
    const actor = Object.values(o.ms.usuarios).find((u) => u.usuario === normUsuario(usuario)) || null;
    auditar(o, actor ? { u: actor, dev } : null, "Espacio central migrado al modo servidor (1.4.0)", o.meta.nombre || o.meta.org, "", Object.keys(usuarios).length + " usuarios, " + Object.keys(prevs).length + " preventivos \xB7 copia: " + path.basename(copia));
    log("Espacio central migrado al modo servidor", o.meta.org, Object.keys(usuarios).length, "usuarios", Object.keys(prevs).length, "preventivos");
    return { usuarios: Object.keys(usuarios).length, preventivos: Object.keys(prevs).length, copia: path.basename(copia) };
  }
  function indexar() {
    let n = 0;
    try {
      for (const f of fs.readdirSync(CLAVES_DIR)) if (f.endsWith(".json")) {
        const c = leerClaves(f.slice(0, -5));
        for (const pid of Object.keys(c && c.prevs || {})) {
          pidOrg.set(pid, f.slice(0, -5));
          n++;
        }
      }
    } catch {
    }
    return n;
  }
  async function custodiarPrev(o, quien, pid, secretB64, tokenHash) {
    exige(o, quien, ["preventivos.crear"]);
    const k = await prevKeys(unb64(secretB64));
    if (k.tokenHash !== tokenHash) throw err(400, "La clave del preventivo no coincide");
    const cl = o.ms.claves.prevs || (o.ms.claves.prevs = {});
    if (cl[pid] && cl[pid] !== secretB64) throw err(409, "Ese preventivo ya existe con otra clave");
    cl[pid] = secretB64;
    guardarClaves(o.meta.org, o.ms.claves);
    pidOrg.set(pid, o.meta.org);
  }
  async function cambiarContrasena(o, quien, uid, b) {
    if (uid !== cuentaUid(o.meta.org, quien.u.usuario)) throw err(403, "Solo puedes cambiar tu propia contrase\xF1a", "permiso");
    if (typeof b.salt !== "string" || b.salt.length > 64 || !Number.isInteger(b.iter) || b.iter < 1e5 || b.iter > 5e6 || !/^[0-9a-f]{64}$/.test(b.verif || "")) throw err(400, "Datos no v\xE1lidos");
    if ((quien.u.metodo || "password") !== "password") throw err(400, "Tu cuenta entra con PIN: no tiene contrase\xF1a");
    quien.u.pw = { salt: b.salt, iter: b.iter, verif: b.verif };
    quien.u.credV = "v" + crypto.randomBytes(6).toString("hex");
    guardar(o, "usuarios");
    await publicarUsuario(o, quien.u);
    auditar(o, quien, "Cambio de contrase\xF1a", quien.u.usuario, "", "Las dem\xE1s sesiones siguen abiertas; los otros dispositivos piden la nueva contrase\xF1a");
  }
  const registroAbierto = (o) => o.ms ? !!o.ms.ajustes.registroAbierto : rd(o, "ajustes.json", {}).registroAbierto !== false;
  function resumenControl(o) {
    const t = Date.now();
    const out = [];
    for (const [pid, e] of o.ms && o.ms.motores || []) {
      const s = e.state;
      if (!s || !s.prev) continue;
      const pend = Object.values(s.conflicts || {}).filter((c) => c.estado === "pendiente");
      let inc = [];
      try {
        inc = detectarIncoherencias(s, { t });
      } catch {
      }
      const porNivel = {};
      for (const h of inc) if (!h.revision || h.revision.estado === "abierta") porNivel[h.nivel] = (porNivel[h.nivel] || 0) + 1;
      out.push({ pid, nombre: s.prev.nombre, estado: s.prev.estado, conflictos: pend.length, conflictoMasAntiguo: pend.length ? Math.min(...pend.map((c) => c.t || t)) : null, incoherencias: porNivel });
    }
    return out;
  }
  const auditarAcceso = (o, quien, accion) => auditar(o, quien, accion);
  return { resumenControl, auditarAcceso, registroAbierto, activo: activo2, preparar, autenticar, publico, privado, exige, validarConfig, configGuardada, validarRegistro, puedeVerPrev, validarOps, aplicar, iniciarEspacio, migrar, indexar, custodiarPrev, cambiarContrasena, orgDePrev: (pid) => pidOrg.get(pid) || null };
}
export {
  crearModoServidor,
  cuentaUid,
  normUsuario
};
