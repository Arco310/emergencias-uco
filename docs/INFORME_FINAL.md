# Informe final — Evolución integral del Gestor de Emergencias UCO (1.0.3 → 1.3.0)

Fecha: 19/11/2026. Detalle técnico en `docs/IMPLEMENTATION_STATUS.md`; pruebas en `docs/TESTING_REPORT.md`.

## 1. Resumen de las modificaciones

| Fase | Qué se ha hecho |
|---|---|
| 1. Servidor central automático | Servidor preconfigurado en la app (nunca se piden direcciones); espacio central con cuentas comunes (en un dispositivo nuevo basta usuario y contraseña); preventivos compartidos que aparecen solos en los demás dispositivos; instalador con copia previa y vuelta atrás. |
| 2. Recursos | Tipos de recurso generales, persistentes y compartidos; sector «OTROS» con nombre libre; unidades plantilla UPR/SVB/VIRES configurables (se escribe 8025 → «UPR 8025», en C0 y pendiente de asignación). |
| 3. Cartografía | Plano georreferenciado real (OpenStreetMap por defecto, Google Maps Platform con clave); buscador; encuadre de la zona; biblioteca con Bernabéu, Metropolitano y Sol más los planos guardados. |
| 4. Plano de coordinación | Arrastrar unidades (también desde «pendientes de asignación»), doble clic o pulsación larga para cambiar la clave, avisos en un punto o en una zona dibujada; todo sincronizado y en la bitácora. |
| 5. Actualizaciones | App: se actualiza sola con verificación de integridad, sin interrumpir a quien trabaja, con recuperación si una versión no arranca y migración de datos con copia previa. Servidor: actualizador desde GitHub con verificación, prueba con copia de datos, ventana segura, periodo de prueba y vuelta atrás automática; panel Sistema → Actualizaciones. |
| 6. Validación | Los 25 escenarios de aceptación con pruebas automáticas: 103/103 pruebas de código y 78/78 de navegador; prueba en vivo con el servidor real (entorno CLAUDE_TEST): 10/10. |
| 1.3.0 | Avisos por código de incidente (SAMUR-PC, 11 carpetas, 123 códigos: carpeta → código → aviso creado), 16 tipos de unidad y unidades plantilla de SAMUR-PC, cronología de todas las unidades a la vez y «Finalizar preventivo». |
| 1.2.1 | Correcciones halladas al instalar en el PC real: permisos de los códigos del servidor, el servidor ya no se detiene si no puede leerlos, «sin versiones publicadas» no es un error, nombres de los dispositivos en el panel. |

## 2. Archivos creados y modificados

**Creados:** `server/actualizador.mjs`, `server/lanzador.mjs`, `src/config/servidor.js`, `src/data/central.js`, `src/data/migraciones.js`, `src/core/versiones.js`, `src/ui/actualizacion.js`, `src/ui/mapa.js`, `src/ui/views/actualizaciones.js`, `src/ui/views/cartografia.js`, `src/core/incidentes.js` y `src/ui/views/incidente.js` (1.3.0), `servidor-windows/MOSTRAR-CODIGO-ADMIN.bat`, `tools/publicar-version.mjs`, `.github/workflows/publicar-version.yml`, 10 archivos de pruebas (`tests/server/actualizaciones|archivos_protegidos|central|central_config|central_cuentas`, `tests/unit/cartografia|incidentes_samur|migraciones_versiones|recursos_plantillas`, `tests/checks/central_en_vivo.py`), `docs/CAMBIOS.md`, `docs/IMPLEMENTATION_STATUS.md`, `docs/TESTING_REPORT.md`, este informe y `docs/evidencias/`.

**Modificados:** `server/server.mjs`, `pwa/sw.js`, `build.mjs`, `package.json`; núcleo `src/app/core.js`, `src/core/{commands,crypto,defaults,engine,exporters,geo,perms,report,timeline}.js`, datos `src/data/{idb,repo,sync}.js`; interfaz `src/ui/{app,dom,icons}.js`, `src/ui/styles.css`, vistas `admin, analysis, auth, catalogs, home, ops, plano`; instalador `servidor-windows/{comun,estado,instalar}.mjs` y `LEEME.txt`; pruebas `tests/e2e/run_e2e.py`, `tests/server/instalador_windows.test.mjs`.

## 3. Arquitectura final

```
 Móviles / tablets (PWA)                         PC servidor DESKTOP-G5S6CH9 (Windows 10)
 ┌───────────────────────────────┐   HTTPS     ┌──────────────────────────────────────────┐
 │ App 1.3.0 (un index.html)      │  Tailscale  │ Tarea programada (SISTEMA) → arrancar.cmd │
 │ · IndexedDB cifrada (AES-GCM)  │◀──Funnel───▶│  → lanzador.mjs (periodo de prueba,       │
 │ · registro de operaciones (HLC)│             │     vuelta atrás)                         │
 │ · sync por preventivo + espacio│             │     → server.mjs (API + app)              │
 │   central cifrados E2E         │             │        · actualizador.mjs ──▶ GitHub      │
 │ · service worker: caché por    │             │          Releases (SHA-256, prueba con    │
 │   versión, integridad, recup.  │             │          copia, ventana segura)           │
 │ · Leaflet: OSM / Google Maps   │             │ datos\ (ops cifradas), copias\ (5 copias) │
 └───────────────────────────────┘             └──────────────────────────────────────────┘
 GitHub Pages: app 1.3.0            GitHub Actions «Publicar versión»: pruebas + versión + sumas
```

El servidor nunca puede leer los datos (cifrado de extremo a extremo). Las reglas y permisos se comprueban en la capa de negocio de cada dispositivo y al recibir; las acciones sobre el servidor exigen su código de administración.

## 4. Configuraciones necesarias

| Configuración | Dónde | Estado |
|---|---|---|
| Servidor central | `src/config/servidor.js` (`https://desktop-g5s6ch9.tailb6d0d2.ts.net`) | Hecha |
| Activar el espacio central real | Primer dispositivo, con el código de `MOSTRAR-CODIGO-ADMIN.bat` y una contraseña propia | Hecha por el usuario (comprobado el 19/11) |
| Clave de Google Maps Platform (opcional) | Configuración general → Cartografía (restringirla por dominio en Google Cloud; Map Tiles API y Places API (New)) | Sin clave: OpenStreetMap |
| Permiso «Gestionar las actualizaciones» | Roles (el administrador lo tiene) | Hecha |

## 5. Dependencias nuevas

Solo **Leaflet 1.9.4** (licencia BSD-2, ~40 KB, incluido en el paquete, sin CDN): mapa táctil interactivo y sin conexión. Servidor: sigue sin dependencias.

## 6. Pruebas realizadas y resultados

103/103 (unidad, servidor, integración, instalador) y 78/78 de navegador (móvil, tablet, Chrome para Android, servidor central, recursos, cartografía, actualizaciones, códigos de incidente). En vivo contra el servidor real, con la app 1.3.0 desde GitHub Pages (y antes con la 1.2.1), en su entorno de pruebas aislado: 10/10 (activación, alta de usuario, dispositivo nuevo con usuario y contraseña, preventivo que aparece solo, avisos simultáneos, desconexión y reconexión, panel de actualizaciones y consulta a GitHub real; el espacio de pruebas se borra al terminar). Tabla de los 25 escenarios en `docs/TESTING_REPORT.md` §3.

## 7. Problemas detectados y pendientes

Corregidos (detalle en `IMPLEMENTATION_STATUS.md` §5): pérdida de plantillas durante la sincronización central; el mapa tapaba las hojas; los repintados borraban lo escrito; la prueba de versiones del servidor heredaba el entorno; faltaba la copia de datos en el actualizador; versión mostrada tras revertir; capturas antiguas borradas del repositorio (restauradas en `docs/evidencias/1.0.3/`). En el PC real (1.2.1): códigos del servidor ilegibles por los permisos que aplicaba el instalador (reparado y corregido), el servidor se detenía al no poder leerlos, «sin versiones publicadas» como error, dispositivos sin nombre en el panel.

Pendientes:
- **Servidor en la 1.2.1**: el paquete 1.3.0 está copiado en el PC servidor, pero la pantalla del PC está bloqueada y no se ha podido ejecutar el instalador. La app 1.3.0 funciona con él (prueba en vivo 10/10).
- Versión sin publicar en GitHub Releases: esta sesión no puede crear versiones (403 de la plataforma). Hasta entonces no se ha probado la descarga desde GitHub real.
- Tras actualizar el servidor, el panel muestra la última consulta de la versión anterior hasta la siguiente (cada 6 h) o hasta pulsar «Comprobar versiones publicadas» (propuesta para la próxima versión).
- Sin pruebas con clave real de Google ni en un Android físico.
- Decisión pendiente: validación en el servidor de operaciones cifradas (`IMPLEMENTATION_STATUS.md` §6).

## 8. Despliegue del servidor central (una sola vez) — hecho

**Instalado el 18/11/2026 a las 17:52: servidor 1.2.1 con el lanzador.** Para pasar a la 1.3.0 basta con repetir el instalador (el paquete ya está en Descargas → servidor-uco-windows). Comprobado en https://desktop-g5s6ch9.tailb6d0d2.ts.net/api/v1/version: 1.2.1, lanzador activo, despliegue activo y `archivos: ok` (el servidor lee sus códigos protegidos).

Procedimiento (por si hubiera que repetirlo; no borra datos):
1. En el PC servidor: **Descargas → servidor-uco-windows → doble clic en `instalar-servidor.bat`** y aceptar el aviso de Windows.
2. El instalador repara los permisos de las carpetas protegidas, detiene el servidor, copia los datos en `C:\ProgramData\GestorUCO\copias`, instala la versión con el lanzador y comprueba que responde y que lee sus códigos; si no responde, vuelve solo a la versión anterior. Los datos y los preventivos se conservan.
3. Comprobación: `estado-servidor.bat` o la dirección anterior.

Las versiones siguientes ya no requieren el instalador (punto 9).

## 9. Actualización automática

**Publicar una versión:** subir el número de versión, `docs/CAMBIOS.md`, y en GitHub → Actions → «Publicar versión» → Run workflow con la versión (ejecuta las pruebas y publica el paquete con sus sumas SHA-256). La app web se publica con `node tools/publicar-version.mjs --pages`.

**Servidor:** lo consulta cada 6 h. En Sistema → Actualizaciones, un administrador pulsa «Descargar y verificar» y después «Instalar ahora» o «en la ventana segura» (con el código de administración del servidor).

**Dispositivos:** al abrir la app, cada 30 min y al volver a ella buscan versión nueva y la verifican. Sin sesión abierta se aplica sola; con sesión aparece «Versión X lista · Actualizar»: se envían los cambios pendientes, se recarga y se vuelve al mismo preventivo y pantalla tras iniciar sesión. Si la app es anterior a la mínima del servidor, deja de sincronizar (sin perder nada) y lo avisa.

## 10. Recuperación si una actualización falla

- **Servidor:** si la versión nueva no responde con la versión esperada durante el periodo de prueba, el lanzador vuelve solo a la anterior. A mano: Sistema → Actualizaciones → «Volver a la versión anterior». Copias de datos en `C:\ProgramData\GestorUCO\copias\datos-*` (5) y registro en `datos\_servidor\despliegues.log`.
- **App:** si una versión no arranca aparece la pantalla de recuperación: «Reintentar», «Usar la versión anterior» o «Buscar una versión corregida». Los datos no se tocan. Antes de migrar datos se crea una copia de seguridad (Sistema → Copias de seguridad).

## 11. Ejecutar y acceder

- App: https://arco310.github.io/emergencias-uco/ o https://desktop-g5s6ch9.tailb6d0d2.ts.net/ (también como app instalada desde el navegador).
- Entorno de pruebas aislado: añadir `?entorno=pruebas` (banda roja CLAUDE_TEST).
- Desarrollo: `npm ci && node build.mjs`; pruebas `npm test` y `python3 tests/e2e/run_e2e.py`.

## 12. Funcionalidades anteriores verificadas

Alta y clave de recuperación, permisos del dispositivo, preventivos independientes y compartidos, unidades (crear, editar, apariencia, color C0 y su borde), avisos (numeración, sugerencias, asignación, finalizados), claves C0–C6 y CESP con sus reglas, descansos (bloqueo con aviso activo, temporizador, fin automático), plano táctico de imagen, estadísticas, bitácora, cronología por unidad, informes PDF/JSON/CSV, modo sin conexión, plantillas, usuarios y roles, cierre del preventivo, sincronización con conflictos, funciones de Android (notificaciones, vibración, pantalla encendida, importación) — todo en las pruebas de navegador 1–3 y en `reglas`, `sync_y_datos`, `servidor` e `integracion`.

---

## Informe del testeo autónomo (apartado 18.12)

| Punto | Resultado |
|---|---|
| 1–2. Funcionalidades probadas y pruebas | Las de los puntos 6 y 12: 103 + 78 pruebas automáticas y 10 comprobaciones en vivo ejecutadas |
| 3–4. Errores encontrados y corregidos | Punto 7: todos corregidos; los de código quedan cubiertos por las pruebas |
| 5. Errores pendientes | Ninguno conocido en el código; pendientes de entorno en el punto 7 |
| 6. Capturas | `docs/evidencias/1.2.0/` (teselas sustituidas por cuadrícula en el entorno de pruebas), `docs/evidencias/1.2.1/` (en vivo) y `docs/evidencias/1.3.0/` (códigos de incidente) |
| 7. Sincronización | Superada: dos dispositivos, avisos simultáneos sin duplicados, conflictos, caída del servidor; también en vivo con el servidor real |
| 8. Sin conexión | Superada: modo avión, trabajo local y reconexión sin pérdidas; también en vivo |
| 9. Actualización | Superada con servidor y API de versiones locales; en vivo, el servidor real consulta GitHub sin error. Descarga desde GitHub real pendiente de publicar la versión |
| 10. Servidor central | En servicio con la 1.2.1 y el lanzador (instalada el 18/11 a las 17:52); lee sus códigos protegidos. Espacio central real activado por el usuario. Paquete 1.3.0 copiado, pendiente de instalar |
| 11. Perfil CLAUDE_TEST | Usado contra el servidor real en su entorno de pruebas aislado: 10/10; el espacio de pruebas se borra al terminar |
| 12. No verificado | Descarga e instalación desde GitHub Releases real, Google Maps con clave, Android físico; servidor con la 1.3.0 |
| 13. Intervención humana | Desbloquear el PC servidor y aceptar el aviso de Windows para instalar la 1.3.0; lanzar «Publicar versión» en GitHub; (opcional) clave de Google |
