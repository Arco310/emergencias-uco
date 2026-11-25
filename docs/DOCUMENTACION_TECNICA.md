# Documentación técnica

Versión **1.5.0**. Diseños detallados por versión: [DISENO-1.4.0.md](DISENO-1.4.0.md) (servidor que valida, usuarios y permisos) y [DISENO-1.5.0.md](DISENO-1.5.0.md) (capas, avisos, incoherencias, plantillas, informes y monitorización). Cada parte de la 1.5.0 tiene su documento `UCO_*.md`.

## 1. Decisiones de arquitectura
| Decisión | Motivo |
|---|---|
| **PWA** (HTML + JavaScript, sin framework) | Funciona por URL e instalable en Android sin tienda ni APK. Un único código para móvil, tablet y ordenador. Se compila en un solo `index.html`. |
| **Offline-first con registro de operaciones** (*event sourcing*) | Cada cambio es una operación inmutable y el estado se reconstruye aplicándolas en orden. Da bitácora y auditoría completas, sincronización sin pérdidas ni duplicados y detección de conflictos. |
| **Reloj lógico híbrido (HLC)** | Orden total y determinista entre dispositivos aunque sus relojes difieran. |
| **IndexedDB cifrado (AES-256-GCM)** | Persistencia local fiable y protegida. |
| **Servidor central propio, sin dependencias** (Node.js) | Gratuito y autoalojable (PC con Windows y Tailscale Funnel). No es imprescindible para operar: los dispositivos siguen trabajando sin él. |
| **Espacio central** (1.1.0) | Configuración común, cuentas y registro de preventivos compartidos. Nunca se piden direcciones: el servidor va preconfigurado (`src/config/servidor.js`). |
| **Modo servidor opcional** (1.4.0) | El servidor custodia las claves del espacio y valida identidad, permisos y contenido de cada operación. Sin él (modo anterior) todo va cifrado de extremo a extremo y el servidor no puede leerlo. |
| **Leaflet 1.9.4** incluido en el paquete | Única dependencia en tiempo de ejecución: mapa táctil con capas, zonas y uso sin conexión. Licencia BSD-2. |
| **PDF y Excel propios** | Informes sin Internet ni librerías externas (`pdf.js`, `xlsx.js`). |

En la modalidad compartida no hay un dispositivo «maestro»: todos guardan el registro completo. El servidor intercambia las operaciones, asigna los números definitivos de aviso y, en el modo servidor, rechaza lo que no está permitido.

## 2. Estructura del código
```
src/core/          Lógica de negocio pura (se prueba en Node)
  engine.js        motor: aplica operaciones, reglas, invariantes y conflictos
  commands.js      comandos: permisos + reglas → operaciones
  perms.js         catálogo de permisos (59, en 8 módulos), perfiles y permisos efectivos
  defaults.js      catálogos por defecto (claves C0–C6/CESP, tipos, sectores, categorías de punto…)
  incidentes.js    códigos de incidente de SAMUR-PC (11 grupos, 123 códigos)
  recursos.js      tipos de recurso activos, retirados y eliminados; unidades plantilla
  mapas.js         tipo de mapa por preventivo y proveedores (OSM, IGN, Google)
  capas.js         capas, filtros, leyenda y agrupación del plano
  ubicacion.js     origen y validación de ubicaciones; validación del registro de informes
  validaciones.js  21 reglas de incoherencia en 4 niveles (solo detectan)
  templates.js     plantillas de preventivo: elementos, versiones y origen
  fiabilidad.js    horas declarada, recibida y sincronizada; huella del registro
  report.js + pdf.js  informe PDF · xlsx.js Excel · exporters.js JSON y CSV · zip.js ZIP
  stats.js · suggest.js · timeline.js · visual.js · geo.js · hlc.js · util.js · versiones.js
  crypto.js        WebCrypto (PBKDF2, AES-GCM, HKDF, SHA-256)
src/data/          idb.js (IndexedDB) · repo.js (repositorio cifrado, usuarios, copias, informes)
                   sync.js (sincronización por preventivo) · central.js (espacio central) · migraciones.js
src/app/core.js    Núcleo: une repositorio, motor, comandos y sincronización
src/ui/            app.js (navegación), dom.js, mapa.js, icons.js, styles.css, views/*
server/            server.mjs (API) · espacio-servidor.mjs (modo servidor) · nucleo.mjs (motor compartido)
                   actualizador.mjs + lanzador.mjs (actualizaciones) · monitor.mjs (estado del sistema)
servidor-windows/  instalador, estado y desinstalador para Windows
pwa/ · build.mjs   service worker, manifiesto e iconos · compilación (esbuild) → dist/
tools/             publicar-version.mjs (publicación) · gen-fontmetrics.cjs
tests/             unit/ y server/ (node:test) · e2e/ (Playwright, 17 escenarios) · checks/ (calidad y en vivo) · perf/
```
La interfaz nunca modifica datos directamente: llama a `AppCore.exec(comando)`, que valida en seco (`dryRun` sobre una copia perezosa del estado), guarda de forma atómica y aplica. Los permisos y las reglas se comprueban en `commands.js`; las invariantes, además, en `engine.js`, también para lo recibido de otros dispositivos. En el modo servidor el servidor repite la comprobación con el mismo motor (`server/nucleo.mjs`).

## 3. Esquema de datos

### 3.1 Operación (unidad de registro y de sincronización)
```js
{ id, p /*preventivo*/, d /*dispositivo*/, dn /*nombre dispositivo*/, h /*HLC*/, t /*hora declarada ms*/,
  u: { id, n } /*usuario*/, k /*tipo*/, e /*entidad*/, b /*lote*/, x /*datos*/ }
// Metadatos fuera del contenido cifrado: num (número definitivo), ref (referencia provisional),
// sq (secuencia del servidor), ps (pendiente), rx (recibida por el servidor), sy (sincronizada en este dispositivo)
```
**Tipos:**
- `prev.create|update|estado|archivo|cat|plano`;
- `unit.create|update|clave|color|sit|delete|loc|plan|rest|restEnd|nota`;
- `aviso.create|update|plan|asig|lib|estado|nota`;
- `conf.resolve`;
- 1.5.0: `revision.set` (revisión de una incoherencia) e `informe.reg` (generar, consultar o exportar un informe).

`informe.reg` y la consulta de datos están permitidos con el preventivo finalizado o archivado. Las modificaciones de campos guardan `{campo: {o: anterior, n: nuevo}}`: es lo que muestra la bitácora y lo que permite detectar ediciones simultáneas.

### 3.2 Estado derivado (por preventivo)
- `prev`:
  - datos, `estado` (preparacion/activo/cerrado) y `archivado`;
  - `origen`: plantilla, versión y lo no heredado;
  - `cfg`: configuración, con `vistaMapa` y `reglas` de incoherencia;
  - `cat`: copia propia de los catálogos, con `sectores[].zona`, `puntos`, `categoriasPunto` y `tiposAviso` con `codigo`/`grupo`/`padre`;
  - `plano`, reaperturas y participantes.
- `units[id]`:
  - identificación, clasificación, `vis` (solo personalizaciones) y `colorC0`;
  - `clave`, `sit` (activa/desactivada/archivada), `aviso`, `descanso`, `loc` y `plan`;
  - historiales: `hc` (claves), `hs` (situación), `hr` (descansos), `hl` (ubicaciones), `ha` (avisos) y `hn` (observaciones).
- `avisos[id]`:
  - `num`, `ref`, tipo, descripción, hora, ubicación (`loc.fuente` y `loc.t` desde la 1.5.0), sector, `zona`;
  - `part`: participaciones con asignación, llegada, salida y liberación;
  - `estado`, `hist`, tiempos, cierre, notas y reaperturas.
- `conflicts[opId]`: tipo, motivo, detalle, estado y quién lo resolvió.
- `revisiones[id]` (1.5.0): estado de cada incoherencia revisada, con su firma y su historial.
- `informes[]` (1.5.0): registro de versiones y accesos (acción, formato, n, huellas SHA-256, motivo, provisional).

### 3.3 IndexedDB (`uco-gestor`, versión 1)
| Almacén | Contenido |
|---|---|
| `meta` | dispositivo, envoltura de recuperación, contadores atómicos de numeración (`num:<pid>`, `ref:<pid>`), HLC |
| `users` | usuarios locales: nombre, rol, estado y la clave de datos envuelta con su contraseña (nunca la contraseña) |
| `docs` | cifrados: `cfg` (configuración general), `roles`, `central` (espacio central), `rechazos`, plantillas `tpl:`, resúmenes `sum:`, metadatos de sincronización `pmeta:`, versiones de informe `inf:`, PIN `pin:` |
| `ops` | operaciones cifradas + metadatos en claro (id, preventivo, HLC, número, referencia, pendiente, `rx`, `sy`) |
| `blobs` | planos e informes PDF cifrados (por su huella SHA-256) |
| `audit` | auditoría del sistema cifrada |
| `backups` | copias locales cifradas |

**Migraciones:**
- **Del esquema de IndexedDB:** `idb.js → upgrade`. Sigue en la v1: todo lo nuevo de la 1.4.0 y la 1.5.0 es aditivo.
- **De los datos:** `src/data/migraciones.js`. Copia cifrada previa (se guardan 5), pasos idempotentes y el esquema solo avanza si terminan bien.
- **Del registro de operaciones:** nunca se reescribe. Si cambiara el formato de una operación, se convertiría al leerla.

### 3.4 Servidor (`datos/`)
- `<pid>/meta.json`, `ops.jsonl` (una operación por línea, con `r` = hora de recepción) y `blobs/`.
- `_org/<org>/`: espacio central (configuración versionada, registro de preventivos, cuentas y dispositivos). En el modo servidor, además: `usuarios.json`, sesiones y `auditoria.jsonl`.
- `_servidor/`:
  - código de administración y código de pruebas;
  - `claves/` (solo en el modo servidor);
  - `actualizaciones.json` y `despliegues.log`;
  - `monitor.json` (historial de alertas).
- Copias previas a actualizar o a migrar: `C:\ProgramData\GestorUCO\copias` (se guardan 5).

## 4. Reglas de negocio críticas (dónde se aplican)
| Regla | Comandos | Motor y servidor |
|---|---|---|
| Color C0 solo en C0; borde siempre C0; gris en descanso | `unitColor` | `unit.color`, `visual.js` |
| Descanso imposible con aviso activo; en descanso no asignable | `unitRest`, `assignOps` | `unit.rest`, `aviso.asig` |
| Transiciones permitidas (forzar con permiso), motivo en CESP, claves que requieren o liberan aviso | `unitClave` | `unit.clave` |
| Numeración correlativa sin duplicados | — | transacción atómica en IndexedDB (independiente) o servidor (compartida) |
| Preventivo finalizado o archivado en solo lectura; reapertura con motivo | `prevReabrir` | comprobación general (salvo `informe.reg`) |
| No eliminar unidades con actividad | `unitDelete` | `unit.delete` |
| Tipos de recurso inactivos o retirados no se usan en unidades nuevas | `unitCreate` (`recursos.js`) | servidor en modo servidor |
| Coordenadas válidas y origen de la ubicación | `ubicacion.js` | servidor en modo servidor |
| Permisos de cada operación | `commands.js` | `permisosOp` en el servidor (modo servidor; lo desconocido se rechaza) |
| Incoherencias: detectar y proponer, nunca corregir | `validaciones.js` | se calculan en el dispositivo y en el servidor (`resumenControl`) |

La antigua discrepancia entre C0 y E4 no puede producirse: hay una única tabla de claves por preventivo y la clave base se identifica por su marca `base`, no por su posición.

## 5. Sincronización
1. Cada dispositivo guarda sus operaciones; las de modalidad compartida quedan **pendientes**.
2. **Envío** (`POST /api/v1/prev/{pid}/ops`): el servidor las guarda (idempotente por `id`), asigna secuencia, hora de recepción y, a las altas de aviso, el **número definitivo** por orden de llegada. En el modo servidor valida cada una y devuelve los rechazos con su motivo. El dispositivo los deshace y los guarda en `rechazos` para revisarlos.
3. **Recepción** (`GET …/ops?after=N`): se guardan cifradas con la clave local y se incorporan al motor (reordenación por HLC si llegan «del pasado»). Cada operación anota `rx` (servidor) y `sy` (sincronización).
4. **Espacio central** (`/api/v1/org/{org}/…`):
   - configuración común como elementos versionados (409 si otro dispositivo cambió el mismo elemento: nunca se sobrescribe en silencio);
   - registro de preventivos compartidos, que aparecen solos;
   - cuentas;
   - latido de cada dispositivo, que el panel de estado usa como señal de actividad.
5. Reintentos con espera exponencial (hasta 60 s). Estados: sincronizado, pendiente, sin conexión, error, conflicto.
6. **Por archivo** (`.ucosync`): el mismo registro cifrado; importar es idempotente.

**Conflictos** (no se usa la última escritura como regla universal):
- Ediciones simultáneas del mismo campo: se mantiene el valor aplicado primero y se registra el conflicto con ambos valores.
- Operaciones que violan una regla tras fusionar: no se aplican y se registran.
- Reglas seguras automáticas: ubicaciones y posiciones (serie temporal), operaciones idénticas.
- Resolución por un usuario con permiso (`conf.resolve`): aceptar o descartar, y queda registrada.

Todos los dispositivos con el mismo conjunto de operaciones obtienen exactamente el mismo estado y los mismos conflictos (verificado en las pruebas).

**Compatibilidad de versiones:** `/api/v1/version` publica la versión mínima de la app (`minCliente`). Una app anterior deja de sincronizar con ese servidor (sin perder nada) y lo avisa. El servidor 1.5.0 exige apps 1.5.0.

## 6. Seguridad
- **Contraseñas:** nunca se guardan.
  - Local: PBKDF2-SHA256 (150 000 iteraciones) envuelve la **clave de datos** (AES-256-GCM).
  - Cuentas del espacio central: PBKDF2-SHA256 (600 000). El servidor guarda solo el hash de la prueba de acceso.
  - Límite de intentos por cuenta y global.
- **Cuentas sin contraseña** (modo servidor): código de activación de un solo uso (72 h; el servidor guarda su hash) y PIN de 6–12 cifras que nunca sale del dispositivo. Tras 5 PIN erróneos se borra el acceso con PIN en ese dispositivo.
- **Sesiones** del modo servidor: token aleatorio (el servidor guarda su hash), revocables. En la app, bloqueo por inactividad. Las acciones sensibles vuelven a pedir la contraseña.
- **Autorización:** permisos por módulo, perfil + ajustes individuales y alcance por preventivo. Denegación por defecto y comprobación en el servidor en el modo servidor. Nadie se da permisos a sí mismo y siempre queda un administrador.
- **Cifrado:**
  - datos locales cifrados;
  - modo anterior: cifrado de extremo a extremo (el servidor no lee nada);
  - modo servidor: las claves las custodia el servidor en `_servidor/claves` (carpeta restringida) y los datos siguen cifrados en disco.
- **Administración del servidor** (actualizaciones, migración, estado en el modo anterior): código de administración del servidor, con límite de intentos. En el modo servidor, permisos de la cuenta.
- **Estado del sistema:** sin contraseñas, tokens, códigos, claves ni rutas. Los mensajes de error se limpian y cada consulta queda auditada.
- **Exportaciones e informes:** permisos separados para generar, exportar y consultar, todos registrados. Huella SHA-256 de cada versión.
- Sin credenciales ni claves de API en el cliente. Política de seguridad de contenidos (CSP) en la aplicación publicada. El texto se escapa siempre (`esc`/`attr`).
- Referencia de controles: OWASP ASVS 5.0.0 (tabla en `INFORME-1.5.0.md` §6).
- **Limitación conocida:** quien conozca una contraseña válida o controle el PC servidor accede a los datos. Hay que usar contraseñas robustas, el bloqueo de pantalla de Android y proteger el PC.

## 7. Copias de seguridad y recuperación ante fallos
- Cada operación se guarda en IndexedDB **antes** de aplicarse en pantalla: un cierre inesperado no pierde cambios confirmados.
- Copias automáticas locales y puntos de restauración antes de finalizar y de cada restauración.
- Copia completa exportable cifrada (`.ucobak`) o sin cifrar (JSON). Huella SHA-256 verificada al restaurar. *Verificar integridad* comprueba operaciones, documentos, planos y copias.
- Servidor: copia de los datos antes de instalar o revertir una versión y antes de pasar al modo servidor.

**Procedimiento de recuperación**
1. *Olvido de contraseña:* sin servidor central, *He olvidado la contraseña* con la clave de recuperación. Con servidor central, el administrador la restablece.
2. *Datos dañados o error tras una actualización:* *Sistema → Copias de seguridad* → restaurar el último punto de restauración (*Fusionar* primero).
3. *Pérdida o avería del dispositivo:*
   - con servidor central, basta con entrar con el usuario en otro dispositivo;
   - sin él, restaurar el último `.ucobak`.
4. *Servidor caído:* los dispositivos siguen operando. Al restablecerlo, la sincronización continúa. Si se pierde su carpeta, en un dispositivo con el preventivo: *Sincronización → Reenviar todo al servidor* (el servidor descarta duplicados y conserva los números ya asignados).
5. *Actualización del servidor fallida:* el lanzador vuelve solo a la versión anterior. También se puede hacer a mano en *Sistema → Actualizaciones*.

## 8. API del servidor
| Método y ruta | Descripción |
|---|---|
| `GET /api/v1/salud` · `GET /api/v1/version` | Estado; versión, versión mínima de la app y estado de los archivos protegidos |
| `GET /api/v1/central` | Espacio central principal |
| `POST /api/v1/prev` · `POST/GET /api/v1/prev/{pid}/ops` · `PUT/GET …/blobs/{id}` | Preventivos compartidos: registro, operaciones (con `rx`) y archivos cifrados |
| `/api/v1/org/{org}/acceso` (+ `/sal`, `/dispositivo`) · `/activacion` · `/registro` | Inicio de sesión, activación con código + PIN y registro (prueba de trabajo y límites) |
| `/api/v1/org/{org}/cambios` · `/config/{id}` · `/prevs/{pid}` · `/cuentas/{uid}` · `/latido` · `/dispositivos` | Espacio central: cambios, configuración versionada, registro de preventivos, cuentas y dispositivos |
| `/api/v1/org/{org}/admin/usuarios`, `perfiles`, `ajustes`, `auditoria`… | Modo servidor: usuarios, perfiles, permisos y auditoría (con sesión y permiso) |
| `POST /api/v1/org/{org}/admin/migrar` | Paso al modo servidor (código de administración del servidor) |
| `GET/POST /api/v1/org/{org}/admin/actualizaciones` | Comprobar, preparar, instalar ahora o en la ventana segura, cancelar y revertir |
| `POST /api/v1/org/{org}/admin/estado` | Estado del sistema (permiso `sistema.estado` o código de administración; caché de 10 s) |
Autenticación: token del preventivo o del espacio (`Authorization: Bearer`) en el modo anterior; sesión de usuario en el modo servidor.

## 9. Servicios externos y costes
| Servicio | Uso | Coste |
|---|---|---|
| GitHub Pages | Aplicación publicada | Gratis |
| GitHub Releases | Versiones del servidor (el servidor consulta al arrancar una versión nueva y cada 6 h) | Gratis |
| Tailscale Funnel | Dirección HTTPS fija del PC servidor | Gratis para uso no comercial |
| OpenStreetMap e IGN (PNOA, MTN) | Teselas del mapa sin clave | Gratis; requieren Internet (las vistas quedan guardadas) |
| OpenStreetMap Nominatim | Buscar coordenadas de una dirección | Gratis (máx. 1 consulta/segundo) |
| Google Maps Platform | Opcional: vistas y búsqueda de Google con clave | De pago a partir de la cuota gratuita; la clave se configura en la app |

## 10. Limitaciones conocidas
- Las notificaciones de fin de descanso solo se muestran con la aplicación abierta o en segundo plano reciente.
- En modalidad compartida sin servidor, los avisos conservan su referencia por dispositivo (`T1-3`); la numeración global requiere el servidor.
- **Modo anterior:** el servidor no puede validar permisos ni contenido, ni mostrar conflictos o incoherencias en el estado del sistema.
- **Plantillas de preventivo:** son de cada dispositivo (se exportan e importan). El PDF de cada versión del informe queda en el dispositivo que la generó; los demás ven su registro y su huella.
- La vista previa publicada en Claude no guarda datos de forma fiable ni permite modo sin conexión, sincronización, GPS ni descargas.

## 11. Rendimiento y escalabilidad
Medido con preventivos de hasta 300 unidades, 3.000 avisos y 22.928 operaciones (`tests/perf/`):
- **Validación de acciones** con copia perezosa del estado: 0,1 ms por acción con independencia del tamaño.
- **Índice de números de aviso** (`state.numAviso`): la detección de duplicados no recorre todos los avisos.
- **Apertura:** las operaciones se descifran por lotes de 512 en paralelo; los paquetes se importan por lotes de 256.
- **Interfaz:** avisos por tandas de 100 y bitácora por tandas de 200.
- **Plano:** agrupación de unidades cercanas (probada con 150 unidades).
- **Informe PDF:** contenido comprimido (FlateDecode). La tabla de registros diferidos se limita a 200 filas en el PDF y va completa en Excel y CSV.
- **Estado del sistema:** caché de 10 s en el servidor y actualización cada 30 s solo con la pantalla abierta.

## 12. Particularidades de Chrome para Android
- `new Notification()` no está permitido: los avisos se muestran con `ServiceWorkerRegistration.showNotification()` (`systemNotify` en `dom.js`).
- La pantalla encendida (Wake Lock) se vuelve a pedir en cada `visibilitychange`.
- El selector de archivos no reconoce extensiones propias (`.ucosync`, `.ucobak`): no se filtra y el contenido se valida al leerlo.
- El escenario 3 de `tests/e2e/run_e2e.py` reproduce estas restricciones en Chrome de escritorio.

## 13. Pruebas
```bash
node build.mjs                          # compila dist/ (las pruebas de navegador usan la compilación)
npm test                                # unidad y servidor (node:test): 201 pruebas
python3 tests/e2e/run_e2e.py            # navegador (Playwright + Chrome), 17 escenarios; uno solo: run_e2e.py 17
python3 tests/checks/comprobaciones.py  # calidad: PWA, nombres accesibles, controles, contraste, secretos, CSP, HTTPS
```
El escenario 17 recorre las pantallas en el móvil (320 y 390 px), la tablet, el escritorio y el tema oscuro con una auditoría automática (`tests/e2e/auditoria_a11y.js`). Comprueba que nada se sale del ancho, los objetivos táctiles, los nombres accesibles y el contraste. Resultados en [TESTING_REPORT.md](TESTING_REPORT.md).
