# Informe de entrega — Mejora funcional y técnica 1.4.0

Fecha: 25/11/2026. Rama `mejora-1.4.0` (subida a GitHub, **sin publicar**: `main`, la web y el servidor del PC siguen en la 1.3.0).
Diseño detallado: `docs/DISENO-1.4.0.md`. Novedades para los usuarios: `docs/CAMBIOS.md`.

## 1. Resumen

| Apartado del encargo | Estado |
|---|---|
| §2 Eliminar configuraciones de recursos (también las iniciales) | Hecho: referencias, reasignar / retirar / eliminar, sin cascada, auditoría; no reaparecen al reiniciar ni al actualizar |
| §3 Tipos inactivos fuera de los selectores y rechazados en el servidor | Hecho (el rechazo en el servidor, en modo servidor; ver §6) |
| §4 Tipo de mapa por preventivo | Hecho: estándar, satélite, híbrido, relieve (IGN sin clave / Google con clave) |
| §5 Registro desde el inicio de sesión | Hecho (modo servidor) |
| §6 Usuarios creados en el servidor, con o sin contraseña | Hecho: contraseña o código de un solo uso + PIN por dispositivo |
| §7 Permisos granulares por usuario | Hecho: módulos, perfiles, ajustes individuales, alcance por preventivo, comprobados en el servidor |
| §8 A–F Extras | Hecho: vista previa, duplicar, estados de cuenta, perfiles, auditoría por usuario, datos sin conexión |
| §9 Diseño | Línea visual UCO; permisos agrupados por módulo; controles táctiles ≥ 40–44 px |

## 2. Problemas encontrados y solución

| Problema (auditoría del código 1.3.0) | Solución |
|---|---|
| Los tipos de recurso iniciales no se podían eliminar y, si se quitaban, la inicialización los volvía a añadir al arrancar o actualizar (`anadirQueFaltan`). | Lista de eliminados en la configuración (`eliminados`) que la inicialización respeta; restaurar es una acción explícita. La baja se publica en el espacio central y se vuelve a aplicar al iniciar sesión. |
| Los tipos desactivados seguían apareciendo al crear unidades y unidades plantilla. | `src/core/recursos.js`: un único criterio (`tiposParaNuevaUnidad`, `plantillasDisponibles`) en todos los selectores; el comando rechaza el tipo aunque se manipule la petición. |
| El servidor 1.3.0 no puede validar nada: los datos van cifrados de extremo a extremo y los permisos solo se comprobaban en cada dispositivo. | **Modo servidor** (decisión: «que el servidor lea los datos»): el servidor custodia la clave del espacio, tiene el directorio de usuarios y sesiones, y valida identidad, acceso al preventivo, permiso y reglas (tipo inactivo) de cada operación. Lo rechazado no se guarda y el dispositivo lo deshace. |
| Roles fijos con unos pocos permisos. | Catálogo agrupado por módulos (consulta y modificación), perfiles reutilizables, ajustes por usuario y alcance por preventivo; protecciones (nadie se da permisos, siempre queda un administrador). |
| Errores hallados al probar esta versión | El repintado desmarcaba las casillas de los formularios; el `pattern` del usuario era inválido para los navegadores actuales; el editor de perfiles borraba el nombre al marcar un permiso; sincronización que volvía antes de terminar (`syncNow` ahora espera y repite). Todos corregidos con su prueba. |

## 3. Decisiones tomadas contigo
- Mapas: IGN gratuito sin clave (ortofoto PNOA y MTN) además de OpenStreetMap; Google con clave.
- Cuentas sin contraseña: código de un solo uso + PIN del dispositivo.
- El servidor lee los datos (modo servidor). Los espacios existentes siguen como están hasta que un administrador los pasa al modo servidor desde la app.
- No desplegar sin tu autorización; subir solo las ramas.

## 4. Archivos
**Nuevos:** `src/core/recursos.js`, `src/core/mapas.js`, `server/espacio-servidor.mjs`, `server/nucleo.mjs`, `src/ui/views/usuarios-servidor.js`, `docs/DISENO-1.4.0.md`, este informe; pruebas `tests/unit/{recursos_activos,recursos_eliminar,vista_mapa,permisos,formularios_html}.test.mjs`, `tests/server/{modo_servidor,modo_servidor_app}.test.mjs`.
**Modificados:** `src/core/{perms,commands,defaults}.js`, `src/data/{central,sync,repo,migraciones}.js`, `src/app/core.js`, `server/server.mjs`, `build.mjs`, `pwa/sw.js`, `src/ui/{app,mapa,icons,styles}.*`, `src/ui/views/{admin,auth,catalogs,home,ops,plano}.js`, `tests/e2e/run_e2e.py` (escenarios 8–11 y escenario 2 adaptado), `tests/server/{central_config,central_cuentas}.test.mjs`, `tests/unit/{helpers.mjs,recursos_plantillas.test.mjs}`, `docs/CAMBIOS.md`.

## 5. Migraciones y datos
- **Dispositivo:** la configuración general gana `eliminados: { tiposRecurso, plantillasUnidad }` (migración v3 con copia previa; no cambia nada de lo existente).
- **Preventivos:** `cfg.vistaMapa` opcional (sin él, el mapa de siempre).
- **Servidor (solo al pasar un espacio al modo servidor):** copia de los datos del espacio en `_servidor/copias/`; claves custodiadas en `_servidor/claves/`; directorio `usuarios.json`, sesiones y `auditoria.jsonl`. Las contraseñas no cambian. A partir de ese momento `minCliente` = 1.4.0 (las apps 1.3.0 piden actualizar).
- Sin migraciones destructivas. Un espacio que no se migra funciona exactamente como en la 1.3.0.

## 6. Pruebas
Ver `docs/TESTING_REPORT.md` (apartado 1.4.0). Resumen:
- Código y servidor (`npm test`): **149/149**.
- Navegador (`tests/e2e/run_e2e.py`, 11 escenarios, ejecución completa única): **104/104** (escenarios 1–11).

**Criterios de aceptación (§10):**

| # | Criterio | Prueba |
|---|---|---|
| 1–2 | Eliminar una configuración base sin referencias; no protegida por ser inicial | `recursos_eliminar` 1; E2E 8 |
| 3 | Referencias identificadas y forma segura de resolverlas | `recursos_eliminar` 2, 3, 5; E2E 8 |
| 4 | No desaparecen unidades ni registros | `recursos_eliminar` 4, 9; E2E 8 |
| 5 | No reaparece tras reiniciar el servidor | `central_config` 1.4.0 (reinicio real del proceso) y `recursos_eliminar` 1 |
| 6 | Crear y duplicar | `recursos_eliminar` 8; E2E 4 |
| 7–8 | Tipo activo aparece / inactivo no | `recursos_activos` 1–2; E2E 8 |
| 9 | El servidor rechaza un tipo inactivo aunque se manipule | `modo_servidor` 6; `recursos_activos` 3 (comando) |
| 10 | Las unidades existentes conservan sus datos | `recursos_activos` 4 |
| 11 | Datos antiguos en caché no saltan la regla | `modo_servidor_app` 4; `modo_servidor` 6 |
| 12–16 | Tipo de mapa: cambiar, se conserva, posiciones intactas, solo ese preventivo, planos de imagen | `vista_mapa` 1–5; E2E 9 |
| 17 | Registro desde el inicio de sesión | E2E 10 |
| 18 | Validación y sin duplicados | `modo_servidor` 2; `formularios_html` |
| 19 | Un registrado no obtiene permisos de administración | `modo_servidor` 2–3; E2E 10 |
| 20 | Aprobar, suspender y desactivar | `modo_servidor` 3, 7; `modo_servidor_app` 7; E2E 10 (aprobar) |
| 21 | Usuarios con contraseña desde el servidor | E2E 10; `modo_servidor_app` 1 |
| 22 | Cuenta sin contraseña con un mecanismo seguro | `modo_servidor` 4; `modo_servidor_app` 6; E2E 10 |
| 23 | Sin autenticación completa no se entra | `modo_servidor` 4; E2E 10 (PIN erróneo, cuenta pendiente) |
| 24 | Permisos individuales desde el servidor | E2E 10; `permisos` 3 |
| 25 | Perfiles de permisos | `permisos` 2; E2E 10 (crear, duplicar, eliminar, asignar) |
| 26 | Los cambios se reflejan en la aplicación | E2E 10 (el dispositivo de Luis pierde «crear avisos») |
| 27 | Sin permiso no se puede ni llamando a la API | `modo_servidor` 5; `modo_servidor_app` 3 (app manipulada) |
| 28 | Nadie modifica sus propios permisos | `permisos` 6; `modo_servidor` 3 |
| 29 | Cambios de permisos en la auditoría | `modo_servidor` 8; E2E 10 |
| 30 | Permisos en distintos preventivos y dispositivos | `permisos` 4; `modo_servidor` 7; E2E 10–11 |
| 31 | Unidades, avisos, descansos, planos, bitácora y auditoría siguen funcionando | E2E 1–7 (regresión) + `npm test` |
| 32 | No se pierde información de preventivos existentes | `modo_servidor` 9; `modo_servidor_app` 8; E2E 11 |
| 33 | Sin duplicados por sincronización | `integracion`/`servidor` (avisos simultáneos, reenvío completo); E2E 2 |
| 34 | Sigue funcionando sin conexión | E2E 1 y 2 (desconexión), E2E 11 (trabajo sin conexión y rechazo posterior); `modo_servidor_app` 6 (PIN sin conexión) |

## 7. Pendiente y riesgos
- **La validación en el servidor exige el modo servidor.** Mientras el espacio real siga en el modo de la 1.3.0, el servidor no puede leer las operaciones: los permisos y los tipos inactivos se comprueban solo en los dispositivos (como hasta ahora). Pasar al modo servidor lo hace un administrador con el código de administración del servidor.
- **Permisos de consulta dentro de un preventivo:** quien tiene acceso a un preventivo recibe sus datos completos; los permisos de «consultar» ocultan apartados en la interfaz, pero no filtran los datos que llegan al dispositivo.
- **PIN sin conexión:** quien extrajera los archivos del navegador podría probar PIN fuera de la app (5 fallos borran el PIN en la app). Lo mitigan el cifrado del almacenamiento de Android y la revocación desde el servidor.
- **Clave del espacio en el servidor:** se guarda en la misma carpeta de datos del PC. Protege la carpeta del sistema operativo y las copias (quien copie la carpeta completa podría leer los preventivos del espacio).
- Una prueba del instalador falló una vez de forma intermitente y pasó al repetirla (sin relación con esta versión).
- No probado aquí: Android real, el PC servidor real con la 1.4.0 y las capas de Google con una clave real (sí con IGN/OSM).

## 8. Instrucciones de despliegue (cuando lo autorices)
1. Revisar y fusionar `mejora-1.4.0` en `main` → GitHub Pages publica la app 1.4.0 (se actualiza sola en los dispositivos).
2. Ejecutar el flujo «Publicar versión» (GitHub Actions) para la 1.4.0 → el servidor del PC la ve en Sistema → Actualizaciones y la instala con copia previa, prueba y vuelta atrás automática.
3. Comprobar en Sistema → Actualizaciones que el servidor y los dispositivos están en 1.4.0. Hasta aquí todo sigue funcionando como en la 1.3.0.
4. (Opcional, cuando todos los dispositivos tengan la 1.4.0) Sistema → Servidor central → «Pasar al modo servidor», con el código de administración del servidor y tu contraseña. Se hace una copia previa; las contraseñas no cambian.
5. Después: revisar Sistema → Usuarios y roles (perfiles y permisos de cada persona) y decidir si el registro de cuentas queda abierto.
