# Informe de pruebas — Evolución integral (versión 1.3.0)

Fecha: 19/11/2026. Solo se recogen pruebas ejecutadas de verdad, con su resultado real.

## 1. Entorno

| Elemento | Detalle |
|---|---|
| Sistema | Linux (entorno de desarrollo aislado), Node.js 22.23.4 |
| Navegador | Google Chrome for Testing 153 con Playwright 1.63, sin interfaz |
| Dispositivos emulados | Móvil 390×844 táctil; tablet 1280×800 táctil; Chrome para Android 14 (agente de usuario, vibración, notificaciones, bloqueo de pantalla y selector de archivos simulados) |
| Servidor | `server/server.mjs` local con datos temporales y código de administración de pruebas. Para las actualizaciones del servidor, una instalación temporal con la misma estructura que en Windows y una API de versiones local con el formato de GitHub. |
| Servidor real | DESKTOP-G5S6CH9 (Windows 10) con la 1.2.1 y el lanzador, por HTTPS (Tailscale Funnel). Solo se usa su **entorno de pruebas aislado** (`?entorno=pruebas`, perfil CLAUDE_TEST, código de pruebas que no puede tocar el espacio real). |
| Datos | Ficticios, creados y borrados por cada prueba. En el servidor real, el espacio de pruebas y sus preventivos se borran al terminar. **No se ha tocado ningún dato real.** |

Ejecución: `npm test` (unidad, servidor, integración, instalador), `python3 tests/e2e/run_e2e.py [1-6]` (navegador; capturas en `tests/e2e/capturas/`, resultados en `tests/e2e/resultados.json`) y `python3 tests/checks/central_en_vivo.py` (en vivo contra el servidor real; resultados en `tests/checks/resultados-central-en-vivo.json`).

## 2. Resultados

| Conjunto | Pruebas | Superadas |
|---|---|---|
| Unidad, servidor, integración e instalador (`npm test`, 15 archivos) | 103 | **103** |
| Navegador (7 escenarios) | 78 | **78** |
| — 1. Móvil, preventivo independiente (funciones anteriores) | 24 | 24 |
| — 2. Tablet + móvil con el servidor central | 14 | 14 |
| — 3. Chrome para Android | 5 | 5 |
| — 4. Tipos de recurso, OTROS y unidades plantilla | 6 | 6 |
| — 5. Cartografía y plano de coordinación | 12 | 12 |
| — 6. Actualizaciones de la aplicación | 8 | 8 |
| — 7. Códigos de incidente, unidades SAMUR-PC, cronología conjunta y finalizar (1.3.0) | 9 | 9 |
| En vivo con el servidor real, entorno CLAUDE_TEST (§4) | 10 | **10** |

Ejecución final: 19/11/2026, con el código de la 1.3.0: `npm test` 103/103 y navegador 78/78 (terminada a las 03:53). En vivo: 10/10 con el servidor real en la 1.3.0 (19/11, 11:51) y con la app 1.3.0 desde GitHub Pages contra el servidor aún en la 1.2.1 (19/11, 11:44); antes, 10/10 con la 1.2.1 (18/11, 18:00 y 21:55).

Pruebas nuevas de la 1.3.0: `incidentes_samur` (6: catálogo de 123 códigos en 11 grupos, carpetas y orden, aviso con código en estadísticas y CSV, añadir los códigos a un preventivo anterior y rechazo de códigos repetidos, plantillas ALFA y HALCÓN, migración de datos 3 sin tocar lo existente) y el escenario de navegador 7 (plantillas SAMUR-PC, Nuevo aviso por carpetas → 1.2, buscar «atropello», nuevo aviso con una unidad por código, formulario completo con el selector, cronología de todas las unidades, añadir los códigos a un preventivo anterior y finalizar). La prueba encontró que, al tocar un resultado del buscador, el aviso de cambio del propio buscador repintaba la lista y el toque se perdía: corregido.

Pruebas nuevas de la evolución anterior: `central_cuentas` (13), `central_config` (4), `actualizaciones` (7), `instalador_windows` (4), `archivos_protegidos` (2), `recursos_plantillas` (7), `cartografia` (4), `migraciones_versiones` (8), los escenarios de navegador 2 (parte central), 4, 5 y 6, y la prueba en vivo `tests/checks/central_en_vivo.py` (10).

## 3. Escenarios de aceptación (apartado de validación del pliego)

| Nº | Escenario | Prueba | Resultado |
|---|---|---|---|
| 1 | Crear un preventivo sin pedir dirección del servidor | Navegador 2: «crear preventivo sin pedir servidor»; en vivo: «preventivo compartido que aparece solo» | Superada (también en vivo) |
| 2 | Varios preventivos usan el mismo servidor central | Navegador 2: «varios preventivos usan el mismo servidor» | Superada |
| 3 | Diferentes dispositivos comparten la información | Navegador 2: «aparece solo en el otro dispositivo», «avisos simultáneos sin duplicados»; en vivo: las mismas por Internet | Superada (también en vivo) |
| 4 | El servidor se desconecta y la app sigue trabajando | Navegador 2: «caída temporal del servidor» (se detiene el proceso, se trabaja, vuelve y converge) | Superada |
| 5 | Tipo de recurso personalizado tras reiniciar | Navegador 4: «persistencia de tipos y plantillas» | Superada |
| 6 | El tipo nuevo aparece en otro dispositivo | Navegador 2: «el tipo nuevo aparece en el otro dispositivo»; `central_config` | Superada |
| 7 | Unidad con sector OTROS y ubicación propia | Navegador 4: «opción OTROS» | Superada |
| 8 | Buscar una calle y seleccionar la zona del preventivo | Navegador 5: «importar zona desde el buscador» (OpenStreetMap; Google sin clave real) | Superada con OSM |
| 9 | Planos Bernabéu, Metropolitano y Sol | Navegador 5: «biblioteca de planos» (los tres se incorporan) | Superada |
| 10 | Unidad plantilla UPR | Navegador 4: «UPR solo pide el número»; `recursos_plantillas` | Superada |
| 11 | Escribir 8025 → «UPR 8025» con sus características | Ídem | Superada |
| 12 | La unidad queda en «pendientes de asignación» | Navegador 5: «arrastrar una unidad pendiente al mapa» | Superada |
| 13 | Arrastrarla al plano y que conserve la posición | Navegador 5: «arrastrar», «mover», «persistencia tras recargar» | Superada |
| 14 | Doble clic para cambiar la clave | Navegador 5: «cambiar la clave con doble clic» | Superada |
| 15 | La clave cambia también en el listado general | Ídem (comprueba la tarjeta del listado de unidades) | Superada |
| 16 | Aviso haciendo clic en el plano | Navegador 5: «aviso haciendo clic en el mapa» | Superada |
| 17 | Aviso dibujando una zona | Navegador 5: «aviso por zona» | Superada |
| 18 | Ambos avisos en el sistema general | Ídem (comprueba el listado de avisos) | Superada |
| 19 | Mismo preventivo en dos dispositivos | Navegador 2; en vivo (tablet y móvil contra el servidor real) | Superada (también en vivo) |
| 20 | Un dispositivo sin conexión sincroniza al volver | Navegador 2: «desconexión, trabajo local y reconexión», «resolución de conflictos»; en vivo: «desconexión y reconexión» | Superada (también en vivo) |
| 21 | Publicar una versión y que el servidor se actualice solo | `actualizaciones`: descarga, verificación, prueba con copia, reinicio controlado, periodo de prueba. En vivo: el servidor real consulta GitHub real sin error | Superada (descarga con API simulada; ver §4) |
| 22 | Los dispositivos reciben la versión nueva | Navegador 6: detección, aviso con sesión, aplicación sola sin sesión | Superada |
| 23 | La actualización no borra datos | `actualizaciones` (datos y copia previa), navegador 6 (mismo preventivo y unidades), `migraciones_versiones` | Superada |
| 24 | Fallo durante la actualización → versión anterior | `actualizaciones`: versión que falla en el periodo de prueba → vuelve sola; navegador 6: versión que no arranca → recuperación | Superada |
| 25 | Las funciones anteriores siguen funcionando | Navegador 1 y 3 completos, `reglas`, `sync_y_datos`, `servidor`, `integracion` | Superada |

## 4. Prueba en vivo con el servidor real (perfil CLAUDE_TEST)

18/11/2026 a las 18:00, con la 1.2.1 instalada en el PC servidor, y repetida a las 21:55 tras 4 horas en servicio. Tablet y móvil emulados entran por Internet en `https://desktop-g5s6ch9.tailb6d0d2.ts.net/?entorno=pruebas`. Resultado: **10/10** las dos veces.

**Con la 1.3.0 (19/11/2026, 11:44):** la aplicación nueva desde el enlace principal (`https://arco310.github.io/emergencias-uco/?entorno=pruebas`) contra el servidor real, que sigue en la 1.2.1: **10/10** (`UCO_SERVIDOR_VERSION=1.2.1 python3 tests/checks/central_en_vivo.py https://arco310.github.io/emergencias-uco/`). Comprueba también que la app servida desde GitHub Pages trabaja con el servidor central por Internet.

**Con el servidor ya en la 1.3.0 (19/11/2026, 11:51):** la app desde la dirección del servidor: **10/10** (`python3 tests/checks/central_en_vivo.py`).

| Comprobación | Resultado |
|---|---|
| Servidor real: versión y estado | 1.2.1 con lanzador, esquema 2, versión mínima de la app 1.1.0, códigos protegidos legibles; sin espacio de pruebas previo |
| Activación del espacio de pruebas | Con el código de pruebas; el espacio real no se ve ni se toca |
| Alta de usuario | Creado en la tablet; su cuenta queda publicada en el servidor real |
| Dispositivo nuevo con usuario y contraseña | El móvil entra solo con usuario y contraseña, con su rol |
| Preventivo compartido que aparece solo | Creado en la tablet sin pedir servidor; aparece solo en el móvil con sus 2 unidades |
| Avisos simultáneos | Números 1 y 2 asignados por el servidor real, sin duplicados |
| Desconexión y reconexión | El móvil trabaja sin red, se reconecta y converge sin pérdidas |
| Panel Sistema → Actualizaciones | Servidor 1.2.1 con despliegue activo; los 2 dispositivos con su nombre y su versión (1.2.1); «Comprobar versiones publicadas» hace una consulta nueva a GitHub real (cambia «Última consulta») y muestra «Aún no hay versiones publicadas», sin error |
| Sin errores de JavaScript | Ninguno en los dos dispositivos |
| Limpieza | Espacio de pruebas y su preventivo borrados del servidor |

Con la 1.2.0 en el servidor, la misma prueba dio 8/9: la lista de dispositivos mostraba «Dispositivo» en lugar del nombre (corregido en la 1.2.1).

## 5. Lo que no se ha podido probar aquí

- **Actualización del servidor desde una versión publicada de verdad en GitHub**: aún no hay ninguna (ver §8). Se ha comprobado en vivo que el servidor consulta GitHub real y trata bien la ausencia de versiones; la descarga, la verificación y la instalación están probadas con una API local con el mismo formato.
- **Google Maps Platform con clave real** (no hay clave). Se ha probado la configuración de la clave (validación, guardado cifrado, auditoría y retirada) y el funcionamiento completo con OpenStreetMap.
- **Dispositivos físicos** (Android real). Las pruebas emulan móvil, tablet y Chrome para Android.
- El **espacio central real** no se ha usado: lo activa el usuario con su código y su contraseña.

## 6. Fallos encontrados por las pruebas y corregidos

Ver `docs/IMPLEMENTATION_STATUS.md` §5. Los más relevantes: el mapa tapaba las hojas abiertas encima (la prueba falla sin la corrección y pasa con ella); los repintados por eventos borraban lo que se estaba escribiendo; la instancia de prueba de una versión del servidor heredaba el entorno del lanzador; faltaba la copia de datos previa en el actualizador. En el PC real (1.2.1): el instalador dejaba los códigos del servidor sin poder leerse; «sin versiones publicadas» aparecía como error; los dispositivos aparecían sin nombre.

**Fallo de las propias pruebas:** en una ejecución completa, el escenario 6 falló al dar de alta el dispositivo (62/69) y por separado pasó 8/8. Causa comprobada registrando los repintados de la pantalla: poco después de cargar (hasta ~2 s) se repinta por un evento y el valor que Playwright escribe de golpe en un campo puede caer en el que se está sustituyendo (la contraseña quedaba vacía). Quien teclea no se ve afectado: la aplicación conserva lo escrito. Las pruebas ahora comprueban cada campo y lo vuelven a escribir si hace falta.

**Limitación detectada en vivo, sin corregir:** tras instalar una versión nueva del servidor, el panel muestra el resultado de la última consulta hecha por la versión anterior (aquí, el error 404 que mostraba la 1.2.0) hasta la siguiente consulta automática (cada 6 h) o hasta pulsar «Comprobar versiones publicadas». No afecta al funcionamiento; queda propuesta para la próxima versión (consultar al arrancar una versión nueva).

## 7. Capturas (`docs/evidencias/1.2.0/`, `1.2.1/` y `1.3.0/`)

En el entorno de pruebas no hay acceso a los servidores de mapas: las teselas se sustituyen por una cuadrícula gris; la geometría, las coordenadas y la interacción son las reales.

| Captura | Qué muestra |
|---|---|
| `act-01-version-lista.png` | Aviso «Versión 1.2.1 lista» con la sesión abierta, sin interrumpir |
| `act-02-recuperacion.png` | Pantalla de recuperación ante una versión que no arranca |
| `coord-01-selector-mapa.png` | Buscador de lugares y encuadre de la zona del preventivo |
| `coord-02-selector-claves.png` | Selector de claves abierto con doble clic sobre una unidad del plano |
| `coord-03-zona-dibujada.png` | Zona dibujada para un aviso |
| `coord-04-plano-coordinacion.png` | Plano de coordinación: pendientes de asignación, unidad, aviso por punto y por zona |
| `fase2-02-upr-creada.png`, `fase2-03-sector-otros.png`, `fase2-04-unidades-plantilla.png` | Unidad plantilla UPR, sector OTROS y configuración de plantillas |
| `tablet-00-central-activado.png`, `movil2-00-acceso-central.png`, `movil2-01-movil-disponible.png` | Servidor central: activación, acceso con usuario y contraseña, preventivo que aparece solo |
| `tablet-03-conflicto.png` | Conflicto detectado y pendiente de resolver |
| `1.2.1/vivo-01-activado.png` | En vivo: espacio de pruebas activado en el servidor real (banda roja CLAUDE_TEST) |
| `1.2.1/vivo-02-actualizaciones.png` | En vivo: Sistema → Actualizaciones con el servidor real 1.2.1 y «Aún no hay versiones publicadas» |
| `1.3.0/01-plantillas-samur.png` | Añadir unidad: las 16 unidades plantilla de SAMUR-PC |
| `1.3.0/02-carpetas.png` | Nuevo aviso: carpetas de códigos de incidente |
| `1.3.0/03-codigos.png` | Carpeta «1. Accidente de Tráfico» con sus códigos (1.6.1 debajo de 1.6) |
| `1.3.0/04-aviso-creado.png` | Aviso creado con el código 1.2 y abierto para asignar unidades |
| `1.3.0/05-cronologia-todas.png` | Cronología de todas las unidades a la vez |
| `1.3.0/06-finalizado.png` | Preventivo finalizado desde «Finalizar preventivo e informes» |

Las capturas de la 1.0.3 están en `docs/evidencias/1.0.3/`.

## 8. Publicación y despliegue

**1.3.0 (19/11/2026)**
- **Aplicación 1.3.0 en GitHub Pages** (compilación `7e3db4563007`), comprobado en `version.json`. Es el enlace principal: los dispositivos se actualizan solos al abrirla.
- **Servidor 1.3.0 instalado en el PC servidor** el 19/11 a las 11:49 con el instalador (copia previa de los datos `datos-2026-11-19T10-49-42`). `/api/v1/version`: 1.3.0, lanzador activo, despliegue activo, `archivos: ok`; sirve la misma compilación que GitHub Pages (`7e3db4563007`). Antes de instalarlo (con el PC bloqueado) se comprobó que la app 1.3.0 funcionaba con el servidor 1.2.1.
- El espacio central real está activado (lo ha activado el usuario) y sigue activo tras la actualización.

**1.2.1 (18/11/2026)**

- **Aplicación 1.2.1 en GitHub Pages y en el servidor** (compilación `e8469f3a85a8`): comprobado que ambos sirven el mismo `version.json`.
- **Servidor 1.2.1 instalado en el PC servidor** el 18/11 a las 17:52 con el instalador (aviso de permisos de Windows aprobado en el PC). `/api/v1/version`: 1.2.1, lanzador activo, despliegue activo, `archivos: ok`.
- **Versión en GitHub Releases: no publicada.** La plataforma deniega a esta sesión crear versiones en GitHub (HTTP 403, «Creating, editing, or deleting releases is not permitted for this session type»). No se ha intentado eludir: el flujo `.github/workflows/publicar-version.yml` lo lanza una persona desde GitHub (Actions → «Publicar versión» → `1.2.1`), ejecuta las pruebas y publica con la misma herramienta.
