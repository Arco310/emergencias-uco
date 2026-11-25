# Informe de entrega — 1.5.0: mapas, avisos, incoherencias, plantillas, informes y monitorización

**Fecha:** 25/11/2026.
**Rama:** `mejora-1.5.0`. Sale de `mejora-1.4.0` y por eso incluye la 1.4.0. Está subida a GitHub y **sin publicar**: `main`, la web y el servidor del PC siguen en la 1.3.0.
**Documentación:**
- diseño y cambios respecto a él: `docs/DISENO-1.5.0.md`;
- novedades: `docs/CAMBIOS.md`;
- detalle de cada parte: `docs/UCO_*.md`.

## Revisión final contra los 6 textos (25/11/2026, tarde)
Se comprobó, punto por punto y contra el código, todo lo pedido en los seis textos:
- el «Prompt maestro»;
- el apartado 18;
- la «Evolución integral»;
- los códigos de SAMUR-PC (los 11 grupos y 123 códigos coinciden con el texto);
- la «Mejora funcional y técnica» (1.4.0);
- esta «Ampliación» (1.5.0).

Faltaba esto, y se ha completado:

| Faltaba | Hecho |
|---|---|
| Documentación general sin actualizar desde la 1.0–1.3 (manual, documentación técnica, README, guía de alojamiento, seguimiento). Contradecía el código: por ejemplo, el manual decía que había que pegar la dirección del servidor | Actualizada a la 1.5.0, comprobando cada nombre de pantalla y botón en el código |
| Pantallas de la 1.5.0 sin probar en el móvil ni en el escritorio (FASE 4), salvo el asistente | Escenario E2E 17: 14 pantallas en el móvil (320 y 390 px), la tablet, el escritorio y el tema oscuro, con auditoría automática y recorridos completos en el móvil y el escritorio |
| Ficha del aviso en el mapa sin historial ni acciones (§6) | Historial reciente y «Asignar unidad», «Finalizar» y «Editar» según los permisos |
| Distinguir avisos por tipo en el mapa (§1) sin depender del color | Código de incidente en la etiqueta del marcador |
| Plantilla desde un preventivo finalizado sin prueba desde la pantalla (§3) | Escenario 16 |
| Pendiente desde la 1.3.0: el servidor recién actualizado no volvía a consultar las versiones publicadas hasta 6 h después | Consulta al arrancar una versión nueva (sin consultas de más al reiniciar la misma) |
| Contraste y reorganización (§7) | Etiquetas, tema oscuro y texto sobre colores configurables corregidos. A 320 px, el estado del sistema ya no parte los valores letra a letra |
| La comprobación de calidad (`tests/checks/comprobaciones.py`) no funcionaba desde la 1.3.0 | Corregida: 12/12 |

**Sigue dependiendo de ti:**
- publicar (no se ha desplegado nada);
- la primera versión en GitHub Releases;
- la clave de Google;
- la prueba en un Android físico y con un lector de pantalla.

## 1. Resumen

| Apartado del encargo | Estado |
|---|---|
| §1 Capas y filtros del mapa | **Hecho.** Capas, filtros combinables, leyenda, agrupación, sectores delimitados, puntos de interés y apoyo, ficha contextual, lista alternativa y código de incidente en el marcador |
| §2 Informes al finalizar | **Hecho.** Versión 1 al finalizar, versiones con motivo y huella SHA-256, registro de accesos, horas verificables, PDF ampliado, Excel, CSV y JSON |
| §3 Plantillas de preventivo | **Hecho.** Elementos a incluir, versiones, restaurar, desactivar, asistente en 7 pasos, permisos de crear, modificar y usar |
| §4 Monitorización del servidor | **Hecho.** Panel para administradores con alertas e historial, sin secretos, y auditoría de cada consulta |
| §5 Incoherencias operativas | **Hecho.** 21 reglas, 4 niveles ajustables, revisión, asignación y resolución con historial; nunca cambia datos |
| §6 Avisos desde el mapa | **Hecho.** Marcador provisional ajustable, ubicación con origen y hora validada en el servidor, unidades con su situación y sugerencias, y ficha en el mapa con historial y acciones. **Sin prioridad** (decisión tuya) |
| §7 Accesibilidad (WCAG 2.2 AA como referencia) | **Parcial y declarado.** Lo implementado y comprobado está en `UCO_ACCESIBILIDAD.md`. Incluye la auditoría automática en móvil, tablet, escritorio y tema oscuro (escenario 17). **No se declara conformidad completa:** falta la revisión manual con lectores de pantalla |
| §8 Técnica, seguridad, rendimiento, sin conexión, documentación | **Hecho.** Ver §5 a §8 de este informe |

## 2. Problemas encontrados al probar y corregidos

| Problema | Desde | Corrección |
|---|---|---|
| Las notas y motivos escritos en los diálogos se guardaban como «[object Object]»: notas de aviso, motivos de reapertura del preventivo y de avisos, notas de incoherencias… | 1.0.0 (**también en producción**) | El campo de texto del diálogo ya no cuenta como «formulario con varios campos». Prueba de regresión en el escenario E2E 14. **Los textos ya guardados así no se pueden recuperar** |
| En el modo servidor, las peticiones ya atendidas seguían por las demás rutas e intentaban responder dos veces («Cannot write headers after they are sent», 19 veces en un escenario) | 1.4.0 | `send()` indica que la petición está atendida. La prueba exige que no quede ningún error registrado |
| Los permisos incluidos solo se aplicaban un nivel (quien revisaba incoherencias no tenía «verlas») | 1.5.0 (fase anterior) | Se aplican en cadena |
| Al repintar un panel abierto, Chrome enviaba el valor anterior del campo con el foco | Anterior a la 1.5.0 | Se ignoran los cambios durante el repintado |
| El aviso «hay cambios después de la versión 1» aparecía solo por archivar | 1.5.0 | El archivado y el registro del informe no cuentan como cambios |
| Faltaba el módulo de monitorización en el paquete del servidor para Windows (lo detectaron las pruebas del instalador) | 1.5.0 | Incluido en `build.mjs` |

## 3. Decisiones tomadas contigo
- No desplegar; solo subir las ramas.
- Avisos sin campo de prioridad.
- Permisos antes de empezar: acceso al ordenador (16 aplicaciones), carpetas Downloads y ProgramData\GestorUCO y repositorio con escritura.

**Decisión que conviene revisar antes de publicar:**
- El servidor 1.5.0 exige aplicaciones 1.5.0 para sincronizar (`minCliente`).
- Las apps anteriores verían las operaciones nuevas (informes, revisiones de incoherencias, puntos del plano) como conflictos.
- Las apps se actualizan solas al abrirse y, mientras tanto, siguen trabajando en local.

## 4. Archivos
**Nuevos:**
- `server/monitor.mjs`;
- `src/core/{capas,fiabilidad,ubicacion,validaciones,xlsx}.js`;
- `src/ui/views/{incoherencias,sistema}.js`;
- pruebas `tests/unit/{capas,informes,plantillas_versiones,ubicacion,validaciones,xlsx}.test.mjs` y `tests/server/monitor.test.mjs`;
- generadores E2E `tests/e2e/generar_{capas,incoherencias,plantillas,informes}.mjs`;
- documentos `docs/UCO_{MAPAS_CAPAS,AVISOS,VALIDACIONES_OPERATIVAS,PLANTILLAS_PREVENTIVOS,INFORMES,MONITORIZACION,ACCESIBILIDAD}.md` y este informe.
- revisión final: `tests/unit/accesibilidad.test.mjs`, `tests/server/actualizador_arranque.test.mjs` y `tests/e2e/auditoria_a11y.js`.

**Modificados:**
- `server/{server,espacio-servidor,nucleo}.mjs`;
- `src/core/{commands,defaults,engine,exporters,pdf,perms,report,templates,timeline}.js`;
- `src/data/{central,repo,sync}.js`;
- `src/app/core.js`;
- `src/ui/{app,dom,styles.css}` y `src/ui/views/{admin,home,ops,plano}.js`;
- `build.mjs`;
- pruebas `tests/e2e/run_e2e.py`, `tests/server/{modo_servidor,servidor}.test.mjs` y `tests/unit/permisos.test.mjs`;
- `docs/{CAMBIOS,DISENO-1.5.0}.md`.
- Revisión final:
  - `server/actualizador.mjs`, `src/core/util.js` (`contrastText`), `src/ui/styles.css` y `src/ui/views/plano.js`;
  - `servidor-windows/LEEME.txt`, `tests/e2e/run_e2e.py` y `tests/checks/comprobaciones.py`;
  - `README.md` y `docs/{MANUAL_USUARIO,DOCUMENTACION_TECNICA,GUIA_ALOJAMIENTO,IMPLEMENTATION_STATUS,INFORME_FINAL,TESTING_REPORT,CAMBIOS,UCO_ACCESIBILIDAD,UCO_AVISOS,UCO_MAPAS_CAPAS}.md`.

## 5. Datos y compatibilidad (sin migraciones destructivas)
- **Preventivos.** Todo lo nuevo es opcional, y los preventivos anteriores se abren igual:
  - catálogos `puntos` y `categoriasPunto` (si faltan, se usan las de partida);
  - `zona` en los sectores;
  - `cfg.reglas`;
  - `loc.fuente` y `loc.t`;
  - `origen.revision`, `excluidos` y `unidadesOmitidas`.
- **Operaciones nuevas:** `revision.set` (revisión de incoherencias) e `informe.reg` (registro del informe). Las dos se validan en el servidor (permiso y contenido).
- **Estado derivado:** `revisiones` e `informes`, que solo se añaden.
- **Registro de cada operación en el dispositivo:** `rx` (recepción en el servidor) y `sy` (sincronización), fuera del contenido cifrado.
- **Servidor:**
  - devuelve `rx`, que ya guardaba como `r`;
  - `datos/_servidor/monitor.json` guarda el historial de alertas;
  - archivo temporal de prueba del almacenamiento, que se borra al momento.
- **Plantillas:** `revision`, `revisiones` (hasta 20), `activa` y `modificadaPor`. Las plantillas anteriores son la versión 1.
- **Informes:** documento local `inf:<pid>` con las versiones, y el PDF cifrado como archivo interno.

## 6. Seguridad (OWASP ASVS 5.0.0 como guía de requisitos verificables)

| Control | Cómo | Prueba |
|---|---|---|
| Autorización en el servidor (V8) | `informe.reg`, `revision.set`, puntos y categorías, cambios de reglas y uso de plantillas pasan por `permisosOp`. Una operación que el servidor no reconoce se rechaza | `informes.test` 2, `validaciones.test` 8–9, `plantillas_versiones.test` 4 y 7, `modo_servidor.test` 5 |
| Validación de entradas (V1/V2) | Coordenadas, origen de la ubicación, huellas, versiones y formatos del informe se validan en el servidor (código `datos`) | `ubicacion.test` 3, `informes.test` 3, `modo_servidor.test` 5 |
| Acceso a la monitorización (V8, V14) | Modo servidor: permiso `sistema.estado`. Modo anterior: además, el código de administración, con límite de intentos | `monitor.test` 3, `modo_servidor.test` 7 |
| Secretos y registros (V14, V16) | El panel no devuelve contraseñas, tokens, códigos, claves ni rutas. Los mensajes se limpian. Cada consulta queda auditada | `monitor.test` 1, 3; `modo_servidor.test` 7 |
| Exportaciones e informes (V8) | Generar (`informes.generar`), exportar (`exportar`) y consultar (`informes.ver`) por separado, y quedan registrados. Comprobación de la integridad por huella | `informes.test` 1–2; E2E 16 |
| XSS | Todo el texto nuevo de la interfaz pasa por `esc()`/`attr()`. El Excel escapa el XML y quita los caracteres de control | `xlsx.test` 1 |
| Sobrecarga (V13) | Caché de 10 s del estado. Tamaño de carpetas con un límite de entradas. Comprobaciones externas solo manuales (una por minuto; Google nunca) | `monitor.test` 3 |

## 7. Rendimiento y sin conexión
- **Mapa con 150 unidades:** agrupación y fluidez comprobadas (E2E 12).
- **Informes:** PDF de unas 6 páginas en el escenario de prueba. Las tablas de registros diferidos se limitan a 200 filas en el PDF y van completas en Excel y CSV.
- **Panel de monitorización:** caché de 10 s en el servidor y actualización cada 30 s solo con la pantalla abierta.
- **Funciona sin conexión:**
  - filtros, capas, sectores, puntos y planos de imagen;
  - crear avisos («Pendiente de confirmar» hasta que el servidor los confirma);
  - incoherencias calculadas en el dispositivo;
  - plantillas, que se guardan en el dispositivo;
  - informes, marcados como **provisionales** si hay cambios sin enviar o conflictos.
- **Necesitan Internet:** mapas cartográficos que no se hayan cargado antes (solo se ven las teselas guardadas), buscar direcciones y la comprobación de cartografía.

## 8. Pruebas
**Resultado final, tras la revisión (misma compilación):**
- `npm test`: **201/201**.
- Navegador, escenarios 1–17 en una sola ejecución: **155/155**.
- `tests/checks/comprobaciones.py`: **12/12**.

**Entrega del mediodía:** `npm test` 195/195, con 46 pruebas nuevas respecto a la 1.4.0, que tenía 149.

**Navegador (`tests/e2e/run_e2e.py`, 16 escenarios):**
- Regresión completa sobre la compilación final: **135/135** (escenarios 1–16, en una sola ejecución).
- Escenarios nuevos de la 1.5.0:

| Escenario | Qué cubre |
|---|---|
| 12 | Capas |
| 13 | Avisos desde el mapa y accesibilidad (7 comprobaciones, con la dirección escrita) |
| 14 | Incoherencias |
| 15 | Plantillas (7, con eliminar la plantilla usada) |
| 16 | Informes |
| 2 y 10 | Estado del sistema (comprobaciones añadidas) |
| 17 | Móvil (320 y 390 px), tablet, escritorio y tema oscuro: 14 pantallas con auditoría automática y recorridos completos (revisión final) |

- Las comprobaciones añadidas al final (dirección escrita y eliminar la plantilla usada) se ejecutaron aparte sobre la misma compilación: **13: 7/7** y **15: 7/7**.
- Validadores independientes: Excel abierto con openpyxl y PDF leído con pypdf.
- Capturas: `docs/evidencias/1.5.0/`. Resultados detallados: `tests/e2e/resultados.json` y `docs/TESTING_REPORT.md`.

**Criterios de aceptación (§9):**

| # | Criterio | Prueba |
|---|---|---|
| 1 | Capas que se activan y desactivan | `capas` 5–6; E2E 12 (capas; finalizados, sectores y categorías) |
| 2 | Filtros combinados | `capas` 5, 7; E2E 12 (filtros combinados y restablecer) |
| 3 | Ocultar una unidad no cambia su estado | `capas` 5; E2E 12 («ocultar no es desactivar») |
| 4 | Avisos bien representados | `capas` 6; E2E 12–13 |
| 5 | Al seleccionar un marcador se ve su información | E2E 12 (ficha contextual sin salir del mapa; ficha del aviso con historial y acciones según permisos) |
| 6 | Mapa con muchos elementos | `capas` 8; E2E 12 (150 unidades) |
| 7 | Preferencias por preventivo | E2E 12 |
| 8 | Informe generado al finalizar | E2E 16 (versión 1 al finalizar); E2E 1 y 7 (finalizar) |
| 9 | Solo datos existentes y verificables | `informes` 4–5 (limitaciones, sin estimar); E2E 16 (contenido leído con pypdf) |
| 10 | Los cálculos respetan los tiempos registrados | `sync_y_datos` (estadísticas con datos conocidos); `informes` 4 (hora declarada, recibida y sincronizada) |
| 11 | Formatos correctos | `xlsx` 1–3; `sync_y_datos` (CSV, JSON, ZIP, PDF); E2E 16 (openpyxl, pypdf, JSON) |
| 12 | Generar no modifica los datos | `informes` 1; E2E 16 (unidades y avisos idénticos) |
| 13 | Permisos de consulta y exportación | `informes` 2; `modo_servidor` 5 (el servidor valida el registro) |
| 14 | Correcciones versionadas | E2E 16 (versión 2 con motivo, la 1 se conserva); `informes` 1, 6–7 |
| 15 | Plantilla desde un preventivo | E2E 15; E2E 1; E2E 16 (desde un preventivo finalizado) |
| 16 | Preventivo a partir de ella | E2E 15 (asistente); `plantillas_versiones` 6, 8 |
| 17 | No comparten estados operativos | `sync_y_datos` (plantillas: copia independiente); `plantillas_versiones` 2; E2E 1 |
| 18 | No se copian avisos ni historiales | E2E 15 (ningún aviso en la plantilla ni en el nuevo preventivo); `sync_y_datos` |
| 19 | Modificar la plantilla no cambia preventivos anteriores | `sync_y_datos` (modificar después); E2E 15 (versiones) |
| 20 | Eliminarla no perjudica a los preventivos | E2E 15 (se elimina la usada y «Concierto 2» se abre igual, con su origen) |
| 21 | Estado real de los servicios | `monitor` 2 (prueba real de escritura y lectura, memoria, disco); E2E 2 y 10 |
| 22 | Fallos de conexión identificados | E2E 2 («el servidor central no responde» con el servidor detenido); `monitor` 2 (almacenamiento caído) |
| 23 | Copias realizadas y fallidas | `monitor` 2 (realizada) y 4 (fallida, con alerta) |
| 24 | Datos administrativos protegidos | `monitor` 3; `modo_servidor` 7; E2E 10 (un operador no tiene la opción) |
| 25 | Sin secretos ni credenciales | `monitor` 1, 3; `modo_servidor` 7 |
| 26 | Unidad disponible con aviso activo | `validaciones` 2 |
| 27 | Asignación incompatible | `validaciones` 3 (la misma unidad en dos avisos) y 2 (inactiva con aviso) |
| 28 | Descanso incompatible | `validaciones` 2 (descanso con aviso) y 4 |
| 29 | Operaciones offline pendientes o fallidas | `validaciones` 5; E2E 14 |
| 30 | Sin duplicar advertencias | `validaciones` 6 |
| 31 | Resolver actualiza el estado | `validaciones` 8; E2E 14 |
| 32 | Ninguna alerta cambia estados | `validaciones` 7; E2E 14 (unidades y avisos sin cambios) |
| 33 | Aviso desde el mapa | E2E 13; E2E 5 |
| 34 | Ubicación asociada | E2E 13 (origen «mapa», sector y posición); `ubicacion` 1 |
| 35 | Ubicación por texto | E2E 13 (dirección escrita: origen «dirección», sin coordenadas inventadas); `ubicacion` 1 |
| 36 | Sector o punto de interés | E2E 13 (sector propuesto por la delimitación; punto «Puerta 3») |
| 37 | Pendientes offline no confirmados | E2E 2 («Pendiente de confirmar» hasta la confirmación) |
| 38 | Sin depender del ratón ni del arrastre | E2E 13 (solo teclado; flechas en pantalla y del teclado) |
| 39 | Formularios con teclado y lector de pantalla | E2E 13 (teclado, nombres accesibles, foco); E2E 17 (nombres accesibles de todos los controles en 14 pantallas, según el árbol de accesibilidad del navegador). **Sin probar con lectores reales** |
| 40 | Alternativas que no dependen solo del color | `capas` 9 (símbolos en la leyenda); E2E 12–13 (lista alternativa; código de incidente en el marcador); `accesibilidad` 1–3 y E2E 17 (contraste) |
| 41–47 | Regresión: unidades, avisos, descansos, planos, bitácora, permisos y sincronización sin pérdidas ni duplicados | Regresión E2E 1–16 y `npm test` (convergencia, numeración, conflictos y reenvío) |

## 9. Pendiente y riesgos
- **Accesibilidad.** Falta la auditoría manual con TalkBack o NVDA para poder declarar conformidad con WCAG 2.2 AA. Lo automatizable se comprueba en cada ejecución (escenario 17).
- **Monitorización en el modo anterior.** El servidor no puede leer los preventivos: no muestra sus conflictos ni sus incoherencias, que sí se ven dentro de cada preventivo. En el modo servidor solo se resumen los preventivos cargados desde el último arranque.
- **PDF de cada versión del informe.** Solo está en el dispositivo que la generó y en sus copias. Los demás ven el registro con su huella y pueden generar otra versión.
- **Plantillas.** Siguen siendo de cada dispositivo, como en la 1.4.0. No se sincronizan con el servidor central.
- **Versiones simultáneas sin conexión.** Si dos dispositivos generan una versión del informe a la vez sin conexión, ambas pueden llevar el mismo número. Se distinguen por la hora, el autor, el dispositivo y la huella.
- **No probado aquí:**
  - Android real y lectores de pantalla;
  - el PC servidor real con la 1.5.0 (sí el paquete para Windows en simulación);
  - la descarga desde GitHub Releases real: todavía no hay ninguna versión publicada;
  - la cartografía real desde el panel, que en las pruebas no tiene Internet;
  - Google con una clave real.

## 10. Despliegue (cuando lo autorices)
1. Revisar `mejora-1.5.0`, que incluye la 1.4.0, y fusionarla en `main`. GitHub Pages publica la app 1.5.0 y los dispositivos se actualizan solos al abrirla.
2. Ejecutar «Publicar versión» (GitHub Actions) para la 1.5.0. El servidor del PC la verá en Sistema → Actualizaciones y la instalará con copia previa, prueba y vuelta atrás automática.
3. Desde ese momento el servidor solo sincroniza con apps 1.5.0. Conviene que los dispositivos abran la app antes del siguiente preventivo.
4. Comprobar en Sistema → Estado del sistema (pide el código de administración del servidor mientras el espacio siga en el modo anterior):
   - que no hay alertas;
   - la última copia;
   - los dispositivos activos.
5. Opcional, como en la 1.4.0: pasar el espacio al modo servidor para que el servidor valide permisos y contenido, y muestre conflictos e incoherencias en el panel.
