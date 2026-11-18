# Informe de pruebas — Evolución integral (versión 1.2.0)

Fecha: 18/11/2026. Solo se recogen pruebas ejecutadas de verdad, con su resultado real.

## 1. Entorno

| Elemento | Detalle |
|---|---|
| Sistema | Linux (entorno de desarrollo aislado), Node.js 22.23.4 |
| Navegador | Google Chrome for Testing 153 con Playwright 1.63, sin interfaz |
| Dispositivos emulados | Móvil 390×844 táctil; tablet 1280×800 táctil; Chrome para Android 14 (agente de usuario, vibración, notificaciones, bloqueo de pantalla y selector de archivos simulados) |
| Servidor | `server/server.mjs` local con datos temporales y código de administración de pruebas. Para las actualizaciones del servidor, una instalación temporal con la misma estructura que en Windows y una API de versiones local con el formato de GitHub. |
| Datos | Ficticios, creados y borrados por cada prueba. **No se ha tocado el servidor real ni ningún dato real.** |

Ejecución: `npm test` (unidad, servidor, integración, instalador) y `python3 tests/e2e/run_e2e.py [1-6]` (navegador; capturas en `tests/e2e/capturas/`, resultados en `tests/e2e/resultados.json`).

## 2. Resultados

| Conjunto | Pruebas | Superadas |
|---|---|---|
| Unidad, servidor, integración e instalador (`npm test`, 13 archivos) | 94 | **94** |
| Navegador (6 escenarios) | 68 | **68** |
| — 1. Móvil, preventivo independiente (funciones anteriores) | 24 | 24 |
| — 2. Tablet + móvil con el servidor central, y 3. Chrome para Android | 18 | 18 |
| — 4. Tipos de recurso, OTROS y unidades plantilla | 6 | 6 |
| — 5. Cartografía y plano de coordinación | 12 | 12 |
| — 6. Actualizaciones de la aplicación | 8 | 8 |

Pruebas nuevas de esta evolución: `central_cuentas` (13), `central_config` (4), `actualizaciones` (7), `instalador_windows` (3), `recursos_plantillas` (7), `cartografia` (4), `migraciones_versiones` (8) y los escenarios de navegador 2 (parte central), 4, 5 y 6.

## 3. Escenarios de aceptación (apartado de validación del pliego)

| Nº | Escenario | Prueba | Resultado |
|---|---|---|---|
| 1 | Crear un preventivo sin pedir dirección del servidor | Navegador 2: «crear preventivo sin pedir servidor» | Superada |
| 2 | Varios preventivos usan el mismo servidor central | Navegador 2: «varios preventivos usan el mismo servidor» | Superada |
| 3 | Diferentes dispositivos comparten la información | Navegador 2: «aparece solo en el otro dispositivo», «avisos simultáneos sin duplicados» | Superada |
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
| 19 | Mismo preventivo en dos dispositivos | Navegador 2 | Superada |
| 20 | Un dispositivo sin conexión sincroniza al volver | Navegador 2: «desconexión, trabajo local y reconexión», «resolución de conflictos» | Superada |
| 21 | Publicar una versión y que el servidor se actualice solo | `actualizaciones`: descarga, verificación, prueba con copia, reinicio controlado, periodo de prueba | Superada (API simulada; ver §4) |
| 22 | Los dispositivos reciben la versión nueva | Navegador 6: detección, aviso con sesión, aplicación sola sin sesión | Superada |
| 23 | La actualización no borra datos | `actualizaciones` (datos y copia previa), navegador 6 (mismo preventivo y unidades), `migraciones_versiones` | Superada |
| 24 | Fallo durante la actualización → versión anterior | `actualizaciones`: versión que falla en el periodo de prueba → vuelve sola; navegador 6: versión que no arranca → recuperación | Superada |
| 25 | Las funciones anteriores siguen funcionando | Navegador 1 y 3 completos, `reglas`, `sync_y_datos`, `servidor`, `integracion` | Superada |

## 4. Lo que no se ha podido probar aquí

- **Servidor real**: sigue en la 1.0.3 porque instalar la 1.2.0 exige aprobar el aviso de permisos de Windows (UAC) en el propio PC. La prueba en vivo con CLAUDE_TEST queda para después de esa instalación.
- **Google Maps Platform con clave real** (no hay clave). Se ha probado la configuración de la clave (validación, guardado cifrado, auditoría y retirada) y el funcionamiento completo con OpenStreetMap.
- **Dispositivos físicos** (Android real). Las pruebas emulan móvil, tablet y Chrome para Android.
- La actualización del servidor contra **GitHub real** se comprueba al publicar la 1.2.0 (ver §6).

## 5. Fallos encontrados por las pruebas y corregidos

Ver `docs/IMPLEMENTATION_STATUS.md` §5. Los más relevantes de esta fase: el mapa tapaba las hojas abiertas encima (la prueba falla sin la corrección y pasa con ella); los repintados por eventos borraban lo que se estaba escribiendo; la instancia de prueba de una versión del servidor heredaba el entorno del lanzador; faltaba la copia de datos previa en el actualizador.

## 6. Publicación de la 1.2.0

- **Aplicación 1.2.0 publicada en GitHub Pages** (compilación `83698b53b0b2`, comprobada en la rama `gh-pages`).
- **Versión en GitHub Releases: no publicada.** La plataforma deniega a esta sesión crear versiones en GitHub (HTTP 403, «Creating, editing, or deleting releases is not permitted for this session type»). No se ha intentado eludir: se ha añadido el flujo `.github/workflows/publicar-version.yml`, que lanza una persona desde GitHub (Actions → «Publicar versión»), ejecuta las pruebas y publica con la misma herramienta.
- Por lo mismo, la comprobación del actualizador contra GitHub real queda pendiente de esa publicación; la cadena completa está probada con una API local con el mismo formato (`tests/server/actualizaciones.test.mjs`, 7/7).
