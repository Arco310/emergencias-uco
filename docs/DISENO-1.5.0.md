# UCO 1.5.0 — Ampliación: mapas, avisos, incoherencias, plantillas, informes y monitorización

Auditoría (fase 1) y diseño (fase 2) del encargo «Ampliación de funcionalidades, mapas, avisos, informes y control operativo».
Parte de la 1.4.0 (rama `mejora-1.4.0`, sin publicar). Rama de trabajo: `mejora-1.5.0`.
Decisiones tuyas: no desplegar; subir solo las ramas; **sin campo de prioridad** en los avisos.

## 1. Auditoría: qué hay y qué falta

| Área | Ya existe (se reutiliza) | Falta |
|---|---|---|
| Mapa | Leaflet; plano cartográfico o de imagen; unidades arrastrables, doble clic para la clave; avisos activos en punto o zona; interruptores «Avisos» y «Etiquetas»; leyenda de claves; tipo de mapa (1.4.0); actualización incremental de marcadores | Capas y filtros (tipo, clave, disponibilidad, sector), sectores dibujados, puntos de interés y de apoyo, avisos finalizados bajo petición, agrupación, ficha sin salir del mapa, preferencias por preventivo, restablecer |
| Avisos | Tipo (códigos SAMUR), descripción, sector, observaciones, posición en el plano, zona, ubicación (dirección, coordenadas, GPS, enlace de Google Maps, búsqueda), unidades con reglas de compatibilidad y descanso; referencia provisional sin conexión (SA-n) y número definitivo del servidor | Flujo «marcar → ajustar → confirmar → formulario», ajuste sin arrastre, origen y hora de la ubicación (no confundir mapa con GPS), punto de interés o sector como ubicación, unidades con su situación y sugerencias, distintivo visible de «pendiente de confirmar» |
| Accesibilidad | Formularios con etiquetas, botones ≥ 44 px, avisos del sistema | Alternativa al mapa por lista, marcador movible con teclado o botones, foco al abrir y cerrar paneles, leyenda que no depende solo del color, revisión WCAG 2.2 AA documentada |
| Incoherencias | Comprobaciones al finalizar (avisos pendientes o activos, unidades ocupadas o en descanso, conflictos), conflictos de sincronización, cambios rechazados (1.4.0) | Catálogo ampliable de reglas con niveles ajustables, detección continua, detalle (qué, a quién, desde cuándo, por qué, consecuencias, recomendación), revisión, asignación y resolución con historial |
| Plantillas | Plantillas independientes desde la configuración o un preventivo (unidades, plano, roles); importar y exportar; nunca copian identificadores, números de aviso ni historiales | Elegir qué incluir (tipos, unidades, sectores, puntos, plano, capas, avisos, parámetros), versiones, desactivar y duplicar, asistente de creación del preventivo, permisos de crear, modificar y usar |
| Informes | PDF propio sin Internet (general, unidades, claves, avisos, descansos, ubicaciones, estadísticas, cronología, bitácora, auditoría), JSON y CSV (ZIP), PDF al finalizar opcional | Versiones conservadas, XLSX, hora del dispositivo, del servidor y de sincronización, limitaciones (sin conexión, pendiente), registro de quién genera o exporta, representación del plano, marca de provisional |
| Monitorización | `/salud`, versión, panel de actualizaciones con estado del servidor y de los dispositivos (versión, última conexión), copias del actualizador y de la migración | Panel de estado (servidor, almacenamiento, recursos, sincronización, copias, servicios externos), alertas con origen y hora, acceso solo administradores, sin secretos |

Limitaciones técnicas comprobadas:
- **Sin instalación de paquetes** en este entorno: la agrupación de marcadores, el XLSX y la imagen del plano en el PDF se hacen con código propio (ya hay generador de PDF y de ZIP propios).
- En un espacio **sin pasar al modo servidor** el servidor no puede leer los preventivos: allí las incoherencias se calculan en los dispositivos y la monitorización no puede contar conflictos ni operaciones por preventivo.
- Los mapas de Google, las direcciones y la búsqueda necesitan Internet. Sin conexión se usan las teselas ya guardadas y los planos de imagen.

## 2. Diseño

### 2.1 Capas y filtros (`src/core/capas.js` + plano)
- **Datos del preventivo:** cada sector puede tener una delimitación (`zona`, polígono). Hay puntos de interés (`cat.puntos`: nombre, categoría, posición o zona, descripción) y sus categorías (`cat.categoriasPunto`, configurables, en dos grupos: *interés* y *apoyo*). Las categorías de partida son accesos y salidas, punto de encuentro, puesto sanitario, punto de coordinación, zona restringida, zona de riesgo, hospital, centro sanitario, puesto de asistencia, punto de abastecimiento, recurso de apoyo y otros. Se guardan con el mecanismo de catálogos de siempre (`prev.cat`), así que se sincronizan, quedan en la bitácora y los cubren las plantillas.
- **Filtros = preferencias de visualización** de cada persona en su dispositivo, por preventivo (`vista:<pid>` local). No cambian datos ni la vista de otros, y ocultar no es desactivar.
  - Capas: unidades, avisos activos, avisos finalizados, sectores (cada uno), puntos de interés, apoyo y etiquetas.
  - Filtros combinables: tipo de recurso, clave, disponibilidad (disponible, ocupada, descanso, fuera de servicio, pendiente) y sector.
  - «Restablecer».
- **Leyenda** generada a partir de lo visible: claves (color y código), disponibilidad (símbolo además del color), tipos de aviso y categorías de punto (icono y nombre).
- **Agrupación propia por rejilla** cuando hay muchos elementos y poco zoom; al tocar un grupo se acerca. Las unidades no se agrupan mientras se arrastran.
- **Ficha contextual** dentro del mapa (tarjeta inferior que no tapa el plano), con «Abrir ficha completa».

### 2.2 Avisos desde el mapa
- **Flujo:** «Nuevo aviso en el mapa» → tocar el lugar → marcador provisional → ajustar (arrastre, flechas en pantalla o del teclado, pasos de 1–25 m) → «Usar esta ubicación» → formulario con la posición, la ubicación y el sector propuestos → crear.
- Tocar un punto libre sigue abriendo el mismo flujo; la zona dibujada sigue igual.
- **Alternativas sin mapa en el mismo formulario:** dirección escrita (y búsqueda si hay Internet), sector, punto de interés, coordenadas con validación (rango y, si el plano es cartográfico, aviso si quedan fuera de él) y GPS.
- **Ubicación con su origen y su hora:** `loc.fuente` (mapa, GPS, dirección, coordenadas, punto o sector) y `loc.t`. Se muestra «marcada en el mapa (no es GPS) · 03:12». Corregirla requiere el permiso de editar avisos y queda en la bitácora.
- **Unidades en el formulario:** tipo, clave, sector, avisos activos, descanso y disponibilidad. Las sugerencias marcan las unidades disponibles y compatibles, de su sector y más cercanas con coordenadas, explicando el motivo. Nunca se asignan solas, y las asignaciones incompatibles siguen rechazándose (también en el servidor).
- **Sin conexión:** el aviso se guarda en el dispositivo con su referencia provisional y un distintivo «pendiente de confirmar» en lista, ficha y mapa (borde discontinuo). Desaparece cuando el servidor lo confirma y le da número.

### 2.3 Accesibilidad (WCAG 2.2 AA como referencia)
- Lista de elementos del mapa (alternativa equivalente): unidades, avisos y puntos con su posición y las mismas acciones.
- Marcadores con nombre accesible. Las capas y filtros son controles nativos. Los avisos se anuncian (`aria-live`). Al abrir y cerrar paneles el foco se mueve y vuelve donde estaba. Los controles miden al menos 44 px.
- Comprobaciones automáticas en las pruebas: nombre accesible de cada control nuevo y crear un aviso solo con teclado. No se declara conformidad completa sin auditoría manual.

### 2.4 Incoherencias (`src/core/validaciones.js`, mismo módulo en dispositivo y servidor)
- **Catálogo de reglas:** cada una con identificador, nivel por defecto (información, moderada, alta, crítica), qué ocurre, por qué es incoherente, consecuencias, recomendación y su función de detección. Las reglas iniciales cubren lo pedido:
  - Unidades: disponible con aviso activo; en descanso con aviso; fuera de servicio o archivada con aviso; sin datos mínimos; tipo eliminado o inactivo; sin cambios desde hace mucho en una clave ocupada.
  - Avisos: unidad activa en dos avisos; activo demasiado tiempo; pendiente sin unidad demasiado tiempo; en curso sin unidades; posibles duplicados.
  - Descansos: con aviso activo; vencido sin finalizar; duración incoherente.
  - Preventivo: finalizado con avisos o descansos abiertos; sectores no válidos; ubicaciones duplicadas o incompletas; unidades con sector o tipo inexistente.
  - Sincronización: cambios rechazados sin revisar, conflictos pendientes, cambios locales sin enviar y datos sin sincronizar desde hace tiempo.
- **Niveles y umbrales ajustables** por preventivo (`cfg.reglas`), con un permiso propio.
- **Agrupación:** una advertencia por regla y elemento, con «desde cuándo» y número de repeticiones.
- **Revisión:** marcar como revisada, asignar a un usuario y registrar la resolución. Es una operación del preventivo (`revision.set`), así que se sincroniza, queda en la bitácora y la valida el servidor con su permiso. Si la situación cambia después de revisada, vuelve a aparecer.
- **Sin automatismos:** solo detecta, informa y propone, con botones que abren la unidad o el aviso. En modo servidor el servidor calcula las mismas reglas para el panel de estado.

### 2.5 Plantillas
- **Crear** desde un preventivo (también finalizado), desde la configuración o desde cero, eligiendo qué incluir: tipos de recurso, unidades previstas, sectores con su delimitación, puntos de interés, plano, capas, tipos de aviso y parámetros operativos. Se mantienen las garantías actuales: sin identificadores repetidos, avisos, historiales, sesiones ni usuarios.
- **Versiones:** cada edición crea la versión n+1 y conserva las anteriores (consultables). El preventivo guarda `origen = { plantilla, nombre, versión }`. Cambiar o borrar una plantilla no toca los preventivos ya creados.
- **Gestión:** desactivar, duplicar y eliminar.
- **Asistente de creación:** plantilla → nombre → fechas y horas → revisar sectores y recursos → ajustar opciones heredadas → confirmar.
- **Permisos:** «Gestionar plantillas» (crear, modificar, desactivar, eliminar) y «Usar plantillas» (crear preventivos con ellas).

### 2.6 Informes
- **Al finalizar** se genera la versión 1 del informe (PDF), sin cerrar ni bloquear nada por generarlo.
  - Regenerarlo crea una versión nueva, con su motivo, y las anteriores se conservan.
  - Cada versión guarda fecha, autor, dispositivo, huella SHA-256, si es provisional y cuántos cambios había pendientes.
  - La generación y las exportaciones quedan registradas en la bitácora del preventivo.
  - Generarlo no modifica ningún registro operativo.
- **Contenido nuevo:**
  - Un apartado de verificabilidad: número de registros y huella del registro de operaciones.
  - Las limitaciones: trabajo sin conexión, operaciones pendientes y tiempos sin confirmar.
  - La hora declarada por el dispositivo, la hora a la que la recibió el servidor (dato nuevo que el servidor anota) y la de sincronización.
  - La distribución de avisos por sector.
  - Un plano esquemático: sectores, puntos, avisos y unidades dibujados sin necesidad de Internet.
- **Formatos:** PDF, XLSX (escrito con código propio), CSV y JSON (el de siempre, compatible).

### 2.7 Monitorización (Sistema → Estado del sistema)
- **Ruta del servidor:**
  - `GET …/admin/estado`. En modo servidor exige un usuario con «Ver el estado del sistema»; sin modo servidor, el código de administración del servidor.
  - Cada consulta queda en la auditoría. La respuesta se reutiliza durante 10 s para no cargar el servidor.
- **Datos:**
  - Servidor: estado, versión, arranque y tiempo activo, errores recientes (ruta y hora, sin datos sensibles).
  - Almacenamiento: prueba de escritura y lectura con su tiempo, espacio libre y ocupado.
  - Recursos: memoria del sistema y del proceso, CPU.
  - Sincronización: dispositivos según su última señal de actividad (no por tener la sesión abierta), operaciones recibidas y rechazadas, y conflictos (en modo servidor).
  - Copias: fecha, resultado, tamaño y carpeta (sin rutas de credenciales).
  - Servicios externos: proveedores configurados y comprobación manual de IGN u OpenStreetMap. Google no se prueba, para no generar gastos.
- **Alertas:**
  - Disparadores: servidor que no responde, almacenamiento no disponible, poco espacio, copia fallida, rechazos acumulados, conflictos antiguos, servicio externo caído.
  - Cada alerta muestra su origen y hora, y se guarda en un historial corto.
- **Seguridad:** nunca se muestran secretos, códigos ni tokens. No se instalan agentes ni servicios nuevos.

## 3. Datos y compatibilidad
Todo es aditivo y opcional:
- Campos nuevos en los catálogos: `zona` de los sectores, `puntos` y `categoriasPunto`.
- `cfg.reglas`, `loc.fuente` y `loc.t`.
- Las operaciones `revision.set` e `informe.version`.
- Metadato `rx` del servidor.

Los preventivos y plantillas anteriores se abren sin cambios. La migración de la configuración añade las categorías de punto con copia previa.

## 4. Orden de trabajo y pruebas
Orden: 1 capas y filtros → 2 avisos desde el mapa → 3 accesibilidad → 4 incoherencias → 5 plantillas → 6 informes → 7 monitorización.

Cada fase lleva:
- Sus pruebas unitarias (filtros, reglas, plantillas, informes, XLSX) y del servidor (estado, `rx`, rechazos).
- Un escenario E2E propio.
- La regresión completa de `npm test` y de los escenarios 1–11.

Los 47 criterios de aceptación se verificarán uno a uno en el informe de entrega.

## 5. Cambios respecto al diseño (al implementarlo)
- **Plantillas: tres permisos.**
  - «Crear plantillas» (`plantillas.crear`).
  - «Modificar, desactivar y eliminar» (`plantillas.gestionar`), que incluye crear.
  - «Usar plantillas» (`plantillas.usar`), incluido en «Crear preventivos».
- **Plantillas: sin referencias rotas.** Al excluir sectores o el plano, las unidades quedan sin sector o sin posición, y los puntos y las delimitaciones se quitan.
- **Informes: la operación se llama `informe.reg`.** Registra generar, exportar y consultar.
- **Informes: dos huellas.** Cada versión guarda la huella del PDF y la del registro de operaciones, que también va en el PDF y en la exportación JSON.
- **Informes: permiso de consulta** «Consultar los informes guardados» (`informes.ver`).
- **Horas: también `sy`.** Además de `rx` (servidor), cada dispositivo guarda `sy` (sincronización). Las dos van fuera del contenido cifrado de la operación.
- **Monitorización: la ruta es `POST …/admin/estado`.** Así el código de administración del modo anterior viaja en el cuerpo y nunca en la dirección.
- **Monitorización: cartografía desde el dispositivo.** La comprobación se hace desde el dispositivo, que es quien carga las teselas, y solo al pulsar.
- **Monitorización: permiso** «Consultar el estado técnico del servidor y del sistema» (`sistema.estado`).
- **Compatibilidad: el servidor 1.5.0 exige aplicaciones 1.5.0 para sincronizar** (`minCliente`). Las anteriores mostrarían las operaciones nuevas como conflictos.
- **Datos: sin migración.** Cuando faltan las categorías de punto (en la configuración general o en preventivos anteriores) se usan las de partida, así que el esquema de datos sigue en el 3.
- **Correcciones encontradas al probar:**
  - los diálogos con un campo de texto guardaban «[object Object]» (desde la 1.0.0);
  - en el modo servidor, las peticiones atendidas intentaban responder dos veces (1.4.0);
  - los permisos incluidos no se aplicaban en cadena.

Documentación de cada parte: `UCO_MAPAS_CAPAS.md`, `UCO_AVISOS.md`, `UCO_VALIDACIONES_OPERATIVAS.md`, `UCO_PLANTILLAS_PREVENTIVOS.md`, `UCO_INFORMES.md`, `UCO_MONITORIZACION.md` y `UCO_ACCESIBILIDAD.md`.
