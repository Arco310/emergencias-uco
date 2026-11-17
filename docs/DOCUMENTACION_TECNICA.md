# Documentación técnica

## 1. Decisiones de arquitectura
| Decisión | Motivo |
|---|---|
| **PWA** (HTML + JavaScript, sin framework) | Funciona por URL e instalable en Android sin tienda ni APK; un único código para móvil y tablet; sin dependencias en tiempo de ejecución (310 KB en un archivo). |
| **Offline-first con registro de operaciones** (*event sourcing*) | Cada cambio es una operación inmutable; el estado se reconstruye aplicándolas en orden. Da bitácora y auditoría completas, sincronización sin pérdidas ni duplicados y detección de conflictos. |
| **Reloj lógico híbrido (HLC)** | Orden total y determinista entre dispositivos aunque sus relojes difieran. |
| **IndexedDB cifrado (AES-256-GCM)** | Persistencia local fiable y protegida. |
| **Servidor de sincronización propio, sin dependencias** | Gratuito, autoalojable, no ve los datos (cifrado de extremo a extremo) y no es imprescindible para operar. |
| **PDF propio** | Informes sin Internet ni librerías externas. |

En la modalidad compartida no existe un dispositivo "maestro": todos guardan el registro completo. El servidor solo intercambia operaciones cifradas y asigna los números definitivos de aviso.

## 2. Estructura del código
```
src/core/        Lógica de negocio pura (se prueba en Node)
  util.js        utilidades, formatos de fecha y duración
  hlc.js         reloj lógico híbrido
  defaults.js    catálogos por defecto (claves C0–C6/CESP, tipos, sectores…)
  perms.js       permisos y roles
  engine.js      motor: aplica operaciones, reglas e invariantes, conflictos
  commands.js    comandos de negocio: permisos + reglas → operaciones
  visual.js      apariencia de unidades (reglas del color C0)
  stats.js       tiempos y estadísticas
  suggest.js     sugerencia de unidades
  timeline.js    bitácora, cronologías e historial de avisos
  templates.js   plantillas
  geo.js         coordenadas, distancias y enlaces de mapas
  exporters.js   JSON y CSV · report.js + pdf.js informe PDF · zip.js ZIP
  crypto.js      WebCrypto (PBKDF2, AES-GCM, HKDF, SHA-256)
src/data/        idb.js (IndexedDB y reserva en memoria) · repo.js (repositorio cifrado, usuarios, copias) · sync.js (sincronización)
src/app/core.js  Núcleo: une repositorio, motor, comandos y sincronización
src/ui/          Interfaz: app.js (navegación, eventos), dom.js, icons.js, views/*
server/server.mjs Servidor de sincronización
pwa/             service worker, manifiesto e iconos
build.mjs        compilación (esbuild) → dist/app y dist/preview.html
```
Separación de capas: la interfaz nunca modifica datos directamente; llama a `AppCore.exec(comando)`, que valida en seco (`dryRun`), guarda de forma atómica y aplica. Los permisos y las reglas críticas se comprueban en `commands.js` y las invariantes, además, en `engine.js` (también para operaciones recibidas de otros dispositivos).

## 3. Esquema de datos

### 3.1 Operación (unidad de registro y de sincronización)
```js
{ id, p /*preventivo*/, d /*dispositivo*/, dn /*nombre dispositivo*/, h /*HLC*/, t /*hora real ms*/,
  u: { id, n } /*usuario*/, k /*tipo*/, e /*entidad*/, b /*lote*/, x /*datos*/,
  // metadatos: num (número definitivo), ref (referencia provisional), sq (secuencia del servidor),
  // nn/nl/nr (necesita número del servidor / local / referencia)
}
```
Tipos: `prev.create|update|estado|archivo|cat|plano`, `unit.create|update|clave|color|sit|delete|loc|plan|rest|restEnd|nota`, `aviso.create|update|plan|asig|lib|estado|nota`, `conf.resolve`.
Las modificaciones de campos guardan `{campo: {o: anterior, n: nuevo}}`: es lo que muestra la bitácora y lo que permite detectar ediciones simultáneas.

### 3.2 Estado derivado (por preventivo)
- `prev`: datos, `estado` (preparacion/activo/cerrado), `archivado`, `cfg` (configuración del preventivo), `cat` (copia propia de catálogos), `plano`, reaperturas.
- `units[id]`: identificación, clasificación, `vis` (solo personalizaciones), `colorC0`, `clave`, `sit` (activa/desactivada/archivada), `aviso`, `descanso`, `loc`, `plan` e historiales `hc` (claves), `hs` (situación), `hr` (descansos), `hl` (ubicaciones), `ha` (avisos), `hn` (observaciones).
- `avisos[id]`: `num`, `ref`, tipo, descripción, hora, ubicación, sector, `part` (participaciones de unidades con asignación, llegada, salida y liberación), `estado`, `hist`, tiempos clave, cierre, notas, reaperturas.
- `conflicts[opId]`: tipo (`campos`, `op`, `aviso`), motivo, detalle, estado y quién lo resolvió.

### 3.3 IndexedDB (`uco-gestor`, versión 1)
| Almacén | Contenido |
|---|---|
| `meta` | dispositivo, envoltura de recuperación, contadores atómicos de numeración (`num:<pid>`, `ref:<pid>`), HLC |
| `users` | usuarios: nombre, rol, estado y la clave de datos envuelta con su contraseña (nunca la contraseña) |
| `docs` | cifrados: configuración global, roles, plantillas (`tpl:`), resúmenes (`sum:`), metadatos de sincronización (`pmeta:`) |
| `ops` | operaciones cifradas + metadatos en claro (id, preventivo, HLC, número, referencia, pendiente) |
| `blobs` | imágenes de planos cifradas (identificadas por su huella SHA-256) |
| `audit` | auditoría del sistema cifrada |
| `backups` | copias locales cifradas |

**Migraciones**: `idb.js → upgrade(db, versiónAnterior)`. v1 = esquema inicial. Cada operación lleva el formato implícito de su tipo; las futuras versiones deben añadir pasos `if (oldV < N)` sin borrar almacenes y, si cambia el formato de una operación, convertirla al leerla (nunca reescribir el registro).

## 4. Reglas de negocio críticas (dónde se aplican)
| Regla | Comandos | Motor |
|---|---|---|
| Color C0 solo en C0; borde siempre C0; gris en descanso | `unitColor` | `unit.color`, `visual.js` |
| Descanso imposible con aviso activo; en descanso no asignable | `unitRest`, `assignOps` | `unit.rest`, `aviso.asig` |
| Transiciones permitidas (forzar con permiso), motivo en CESP, claves que requieren o liberan aviso | `unitClave` | `unit.clave` |
| Numeración correlativa sin duplicados | — | transacción atómica en IndexedDB (independiente) o servidor (compartida) |
| Preventivo cerrado/archivado en solo lectura; reapertura con motivo | `prevReabrir` | comprobación general |
| No eliminar unidades con actividad | `unitDelete` | `unit.delete` |
| Catálogos coherentes (clave base, claves en uso) | `validateCatalog` | `prev.cat` |

La antigua discrepancia entre C0 y E4 no puede producirse: existe una única tabla de claves por preventivo y la clave base se identifica por su marca `base`, no por su posición.

## 5. Sincronización
1. Cada dispositivo guarda sus operaciones; las de modalidad compartida quedan marcadas como **pendientes**.
2. **Envío** (`POST /api/v1/prev/{pid}/ops`): operaciones cifradas con la clave del preventivo. El servidor las guarda (idempotente por `id`), asigna una secuencia y, a las altas de aviso, el **número definitivo** por orden de llegada.
3. **Recepción** (`GET …/ops?after=N`): se descifran, se guardan cifradas con la clave local y se incorporan al motor (reordenación por HLC si llegan "del pasado").
4. Archivos de plano: `PUT/GET …/blobs/{id}`, cifrados.
5. Reintentos con espera exponencial (hasta 60 s). Estados: sincronizado, pendiente, sin conexión, error, conflicto.
6. **Por archivo** (`.ucosync`): el mismo registro cifrado; importar es idempotente.

**Conflictos** (no se usa la última escritura como regla universal):
- Ediciones simultáneas del mismo campo → se mantiene el valor aplicado primero y se registra el conflicto con ambos valores.
- Operaciones que violan una regla tras fusionar (p. ej. descanso de una unidad asignada en otro dispositivo) → no se aplican y se registran.
- Reglas seguras automáticas: ubicaciones y posiciones en el plano (serie temporal, se conserva todo el historial), operaciones idénticas (sin efecto).
- Resolución por un usuario con permiso (`conf.resolve`): aceptar (aplicar el valor propuesto o reaplicar la operación) o descartar. Queda registrada.

Todos los dispositivos con el mismo conjunto de operaciones obtienen exactamente el mismo estado y los mismos conflictos (verificado en las pruebas).

**Código de incorporación**: `UCO1.` + base64url de `{servidor, preventivo, secreto}`. Del secreto (128 bits) se derivan con HKDF la clave de cifrado del preventivo y el token de acceso; el servidor solo guarda el SHA-256 del token.

## 6. Seguridad
- Contraseñas: no se almacenan. PBKDF2-SHA256 (150 000 iteraciones) deriva una clave que envuelve la **clave de datos** (AES-256-GCM). Bloqueo progresivo tras 5 intentos fallidos.
- **Clave de recuperación** (30 caracteres) que también envuelve la clave de datos.
- Sesiones: bloqueo por inactividad configurable; las acciones sensibles (reabrir, restaurar, exportar sin cifrar, cambiar modalidad, sobrescribir personalizaciones) piden de nuevo la contraseña.
- Datos locales cifrados; sincronización cifrada de extremo a extremo; servidor con autenticación por token, límites de tamaño, escritura atómica y `fsync`.
- Sin credenciales ni claves de API en el cliente. Política de seguridad de contenidos (CSP) en la aplicación publicada.
- Limitación conocida: el cifrado local protege frente a la lectura directa de los datos, pero quien conozca una contraseña válida accede a todo; usa contraseñas robustas y el bloqueo de pantalla de Android.

## 7. Copias de seguridad y recuperación ante fallos
- Cada operación se guarda en IndexedDB **antes** de aplicarse en pantalla: un cierre inesperado no pierde cambios confirmados.
- Copias automáticas locales periódicas (configurable) y puntos de restauración antes del cierre y de cada restauración.
- Copia completa exportable cifrada (`.ucobak`, contraseña propia, incluye usuarios, planos y clave de datos) o sin cifrar (JSON).
- Integridad: huella SHA-256 de cada copia, verificada al restaurar; *Verificar integridad* comprueba operaciones, documentos, planos y copias.

**Procedimiento de recuperación**
1. *Olvido de contraseña*: pantalla de acceso → *He olvidado la contraseña* → clave de recuperación.
2. *Datos dañados o error tras una actualización*: *Sistema → Copias de seguridad* → restaurar el último punto de restauración (*Fusionar* primero; *Reemplazar* si es necesario).
3. *Pérdida o avería del dispositivo*: en el nuevo, pantalla inicial → *Restaurar copia de seguridad* con el último `.ucobak`. En modalidad compartida basta con volver a unirse con el código: el registro completo está en los demás dispositivos y en el servidor.
4. *Servidor caído*: los dispositivos siguen operando; al restablecerlo (o en otro equipo con la carpeta `--data` copiada) la sincronización continúa. Si se pierde su carpeta, en un dispositivo con el preventivo: *Sincronización → Reenviar todo al servidor*. Se reenvía el registro completo (el servidor descarta duplicados y conserva los números de aviso ya asignados).

## 8. API del servidor
| Método y ruta | Descripción |
|---|---|
| `GET /api/v1/salud` | Estado y versión |
| `POST /api/v1/prev` `{pid, tokenHash, startNum}` | Registrar preventivo (idempotente; 409 si existe con otro token) |
| `POST /api/v1/prev/{pid}/ops` `{ops:[{id,d,h,nn,c}]}` | Enviar operaciones → `{res:[{id,sq,num}], last}` |
| `GET /api/v1/prev/{pid}/ops?after=N&limit=500` | Recibir operaciones posteriores a N |
| `PUT/GET /api/v1/prev/{pid}/blobs/{id}` | Archivos cifrados |
Autenticación: `Authorization: Bearer <token>`. Almacenamiento: `datos/<pid>/meta.json`, `ops.jsonl` (una operación por línea) y `blobs/`.

## 9. Servicios externos y costes
Ver la tabla de la guía de alojamiento. Sin servicios de pago. Google Maps se usa sin clave (mapa incrustado y enlaces); si en el futuro se quisiera geocodificación oficial de Google, haría falta una clave de API con facturación (con coste a partir de la cuota gratuita).

## 10. Limitaciones conocidas
- Las notificaciones de fin de descanso solo se muestran con la aplicación abierta (o en segundo plano reciente): una web no puede programar notificaciones con la aplicación cerrada.
- La pantalla siempre encendida depende del soporte del navegador (Chrome para Android lo admite).
- En modalidad compartida sin servidor, los avisos conservan su referencia por dispositivo (`T1-3`); la numeración global correlativa requiere el servidor.
- La vista previa publicada en Claude no guarda datos de forma fiable ni permite modo sin conexión, sincronización, GPS ni descargas.
