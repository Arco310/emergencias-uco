# Novedades del Gestor de Emergencias UCO

Cada versión publica a la vez la aplicación y el servidor central. Los servidores ven la versión nueva en
Sistema → Actualizaciones y solo se instala cuando un administrador lo decide.

## 1.5.0 (preparada, sin publicar · rama `mejora-1.5.0`)

**Mapa: capas, filtros, sectores y puntos**
- **Capas y filtros:**
  - Capas: unidades, avisos activos, avisos finalizados, sectores, puntos de interés, infraestructura y apoyo, y etiquetas.
  - Filtros combinables: tipo, clave, disponibilidad, sector y tipo de aviso.
  - Son preferencias de cada dispositivo y de cada preventivo: no cambian datos ni lo que ven los demás.
- **Leyenda automática.** La disponibilidad se marca con símbolo (✓ ● ‖ ◆ ✕), no solo con color.
- **Agrupación de unidades cercanas.** Probada con 150 unidades.
- **Sectores delimitados** en el plano y **puntos de interés y de apoyo**. Hay 13 categorías de partida (accesos, puesto sanitario, hospital, abastecimiento…).
- **Ficha contextual** al tocar cualquier elemento, y **lista** como alternativa al mapa.

**Avisos desde el mapa**
- «Nuevo aviso en el mapa» coloca un marcador provisional que se ajusta así:
  - arrastrándolo;
  - con las flechas en pantalla o del teclado.
  - Después se confirma y se abre el formulario.
- **Ubicación sin mapa:** dirección, sector, punto de interés, coordenadas o GPS.
- **Origen y hora de cada ubicación.** Se distingue «marcada en el mapa» de una posición GPS real.
- **Coordenadas validadas** también en el servidor.
- **Unidades en el formulario** con su tipo, clave, sector, avisos, descanso y disponibilidad:
  - las tres primeras compatibles y libres aparecen como sugeridas, sin marcarse;
  - las no asignables, deshabilitadas;
  - se pueden asignar varias a la vez.
- **Sin conexión,** el aviso se ve como «Pendiente de confirmar» hasta que el servidor lo confirma.

**Accesibilidad** (WCAG 2.2 AA como referencia; no se declara conformidad completa)
- El aviso se crea sin depender del arrastre ni del mapa.
- El foco va al panel que se abre y vuelve al cerrarlo. Escape cierra.
- Símbolos además de colores, y alternativa en lista.
- Barra del plano en una fila en el móvil.

**Detección de incoherencias**
- **21 reglas** en cinco grupos: unidades, avisos, descansos, preventivo y sincronización.
- **Niveles:** información, moderada, alta y crítica.
- Cada advertencia explica qué ocurre, desde cuándo, por qué es incoherente, sus consecuencias y qué hacer.
- Se agrupan para no repetirse.
- Se pueden marcar como revisadas, asignar, resolver con nota, reabrir y consultar con su historial.
- Niveles, umbrales y reglas activas se ajustan por preventivo.
- Nunca se cambia nada automáticamente.

**Plantillas de preventivo**
- Al crear una plantilla se elige qué incluir. Los usuarios y roles previstos van desmarcados porque son datos personales.
- **Versiones:**
  - cada cambio crea una versión y conserva la anterior;
  - se puede restaurar una versión anterior;
  - cada preventivo sabe con qué versión se creó y qué no heredó.
- **Desactivar** plantillas.
- **Asistente de creación** en 7 pasos, con revisión de unidades y sectores, opciones heredadas y resumen final.
- **Permisos** para crear, para modificar o eliminar y para usar plantillas.

**Informes**
- **Al finalizar se guarda la versión 1** del informe en PDF, con su huella SHA-256.
- **Nuevas versiones** solo con motivo. Las anteriores se conservan.
- **«Comprobar un PDF…»** indica si un archivo es una versión registrada y no modificada.
- **Registro** de quién genera, consulta o exporta, en la bitácora. No toca nada operativo y el servidor lo valida.
- **PDF ampliado:**
  - identidad UCO y aviso de provisional;
  - configuración y sectores, y plano esquemático;
  - utilización de recursos y actividad por unidad;
  - avisos al cierre, cronología ampliada e incidencias;
  - fiabilidad de los datos y limitaciones;
  - huella del registro de operaciones y registro del informe.
- **Horas verificables:**
  - el servidor devuelve la hora a la que recibió cada operación y cada dispositivo guarda la de sincronización;
  - el informe distingue la hora declarada, la recibida y la sincronizada;
  - se indican los registros diferidos, pendientes o con el reloj adelantado.
- **Excel (XLSX)** sin librerías, con las mismas tablas que el CSV, las horas de registro y el registro del informe. CSV y JSON añaden esos datos sin dejar de ser compatibles.
- Permiso nuevo «Consultar los informes guardados».

**Estado del sistema** (Sistema → Estado del sistema, solo administradores)
- **Servidor:** versión, último reinicio, actividad, API y errores recientes.
- **Datos:** prueba real de escritura y lectura, y disco.
- **Memoria y CPU.**
- **Dispositivos activos** según su señal de actividad.
- **Operaciones** recibidas y rechazadas, y conflictos.
- **Copias:** realizadas y fallidas.
- **Cartografía:** comprobación manual (Google no se comprueba).
- **Alertas** con origen, hora e historial.
- En el modo anterior pide el código de administración del servidor. Sin secretos y cada consulta queda auditada.

**Correcciones**
- **Notas y motivos escritos en los diálogos** (fallo presente desde la 1.0.0). Las notas de los avisos, los motivos de reapertura (preventivo y aviso), las notas de las incoherencias y otros textos se guardaban como «[object Object]». Los textos ya guardados así no se pueden recuperar.
- **Peticiones atendidas dos veces en el modo servidor** (1.4.0). El servidor seguía procesando las peticiones ya atendidas e intentaba responder dos veces (errores en el registro).
- **Permisos incluidos en cadena.** Ahora se aplican en cadena: quien puede revisar incoherencias también puede verlas.
- **Texto escrito en los paneles abiertos** (Chrome). Al repintar un panel abierto se podía guardar el valor anterior de un campo con el foco.

**Datos y compatibilidad**
- **Todo es aditivo:**
  - catálogos `puntos` y `categoriasPunto` y zona de los sectores;
  - `cfg.reglas`, `loc.fuente` y `loc.t`;
  - operaciones `revision.set` e `informe.reg`;
  - horas `rx` y `sy` fuera del contenido cifrado.
- **La 1.5.0 exige aplicaciones 1.5.0 para sincronizar.** Las apps anteriores verían las operaciones nuevas como conflictos. Las apps se actualizan solas al abrirse y, mientras tanto, siguen trabajando en local.

## 1.4.0 (preparada, sin publicar · rama `mejora-1.4.0`)

**Configuración de recursos**
- Se puede eliminar cualquier tipo de recurso o unidad plantilla, también los iniciales. Antes se ve dónde se usa (unidades plantilla, tipos de aviso, preventivos y unidades) y se elige: reasignar a otro tipo, retirarlo del uso (se conserva para el historial y se puede restaurar) o eliminarlo. Nunca se borran unidades ni registros.
- Lo eliminado no reaparece al reiniciar el servidor ni al actualizar. «Restaurar configuraciones iniciales» lo recupera cuando se decida.
- Duplicar tipos de recurso.
- Los tipos desactivados o retirados ya no se ofrecen al crear unidades ni unidades plantilla. Las unidades que ya existían no cambian.

**Tipo de mapa en cada preventivo**
- Estándar, satélite, híbrido y relieve, desde el plano. Sin clave: OpenStreetMap e IGN (ortofoto PNOA y mapa topográfico). Con clave de Google Maps Platform: las vistas de Google.
- Se guarda en el preventivo y llega a los demás dispositivos. No mueve unidades ni avisos. Los planos de imagen no ofrecen satélite.

**Servidor que valida (modo servidor, opcional)**
- Usuarios y permisos administrados en el servidor central, que comprueba cada operación: lo que alguien no tiene permitido se rechaza aunque manipule la aplicación o llame directamente al servidor.
- «Crear una cuenta» en el inicio de sesión (se puede cerrar). Las solicitudes quedan pendientes y sin permisos hasta que un administrador las aprueba con un perfil.
- Cuentas sin contraseña: código de un solo uso (72 h) y PIN propio de cada dispositivo.
- Estados de cuenta: pendiente, activa, suspendida, desactivada, rechazada, invitación pendiente y activación caducada. Se pueden cerrar todas las sesiones de alguien o retirar el PIN de un dispositivo.
- Permisos por usuario agrupados por módulo, con perfiles reutilizables (crear, duplicar, eliminar) y ajustes individuales; acceso a todos los preventivos o solo a algunos, con un perfil distinto en cada uno. Nadie puede darse permisos a sí mismo y siempre queda un administrador.
- Auditoría del servidor (altas, aprobaciones, estados, permisos, códigos, sesiones, migración y operaciones rechazadas), filtrable por usuario.
- Sistema → Servidor central: modo del espacio, paso al modo servidor explicando sus consecuencias (pide el código de administración del servidor), renovar la sesión caducada y lista de **cambios rechazados** (no desaparecen en silencio; se marcan como revisados).

**Correcciones**
- Un repintado de la pantalla (por la sincronización) desmarcaba las casillas de los formularios que se estaban rellenando.
- El campo «Usuario» del registro tenía un patrón de validación que los navegadores actuales consideran inválido.

**Datos y compatibilidad:** la configuración guarda la lista de lo eliminado (migración con copia previa). Mientras el espacio central no pase al modo servidor, la 1.4.0 funciona como la 1.3.0 y convive con dispositivos 1.3.0. Después del paso, todos los dispositivos deben tener la 1.4.0.

## 1.3.0 (19/11/2026)

**Avisos por código de incidente**
- Los códigos de incidentes de SAMUR-Protección Civil (11 grupos, 123 códigos) son tipos de aviso con su número.
- «Nuevo aviso» abre las carpetas (1. Accidente de Tráfico, 3. Enfermedad…) y dentro los códigos con su descripción; los subcódigos (1.6.1) y los códigos de cierre (AS-…) aparecen debajo de su código. Al tocar el código se crea el aviso con ese tipo y se abre para asignar unidades. Funciona igual desde una unidad («Nuevo aviso con esta unidad») y desde el plano.
- Buscador por número o texto («1.2», «atropello») y «Más datos antes de crear…» para rellenar el formulario completo. El campo «Tipo de incidente» de los formularios usa el mismo selector.
- El código se ve en las tarjetas, en las estadísticas, en los informes PDF y CSV y en la bitácora; los filtros por tipo se agrupan por carpetas.
- Los tipos de aviso de antes siguen disponibles en la carpeta «Otros tipos». Los códigos se pueden editar o ampliar en Tipos de aviso (código y carpeta).
- En los preventivos creados antes de esta versión, «Nuevo aviso» ofrece «Añadir los códigos de incidente».

**Tipos de unidad y unidades plantilla de SAMUR-Protección Civil**
- BASE, SAMUR, VIR, ALFA, PAPA, TANGO, MIKE, ECO, LINCE, HALCÓN, URO, ZULÚ, VRALA, PM, PMA y VAIS: cada uno como tipo de unidad y como unidad plantilla (se escribe el número y se crea, por ejemplo, «ALFA 31» en C0 y pendiente de asignación).

**Cronología y finalización**
- Cronología de unidades: opción «Todas las unidades» con el registro de todas a la vez, lo más reciente primero.
- «Finalizar preventivo e informes» en el menú Más (antes «Cierre e informes»), con el botón «Finalizar preventivo».

**Datos:** al actualizar se añaden a la configuración del dispositivo y a las plantillas de preventivo los tipos, plantillas y códigos que falten, con una copia de seguridad previa; no se cambia ni se borra nada de lo que ya había.

## 1.2.1 (18/11/2026)

**Correcciones del servidor central en Windows**
- El instalador dejaba los códigos del servidor sin poder leerse (ni siquiera por el propio servidor), lo que impedía activar el servidor central y podía impedir que el servidor volviera a arrancar. Ahora los permisos se aplican a la carpeta y su contenido los hereda; al instalar se reparan las instalaciones afectadas y se comprueba que el servidor puede leer sus códigos.
- Si aun así no pudiera leerlos, el servidor sigue funcionando y lo explica con claridad (antes se detenía).
- «Aún no hay versiones publicadas» ya no aparece como un error en Sistema → Actualizaciones.
- La lista de dispositivos muestra enseguida el nombre de cada dispositivo (antes podía aparecer «Dispositivo» al darlo de alta).

## 1.2.0 (18/11/2026)

**Configuración común**
- Tipos de recurso generales que se conservan y se comparten con todos los dispositivos del servidor central.
- Sector «OTROS» con nombre libre al crear o editar una unidad.
- Unidades plantilla configurables (UPR, SVB y VIRES de ejemplo): basta con escribir el número (p. ej. 8025) para crear «UPR 8025» con todas sus características, en C0 y pendiente de asignación.

**Cartografía y plano de coordinación**
- Plano cartográfico real (OpenStreetMap por defecto; Google Maps Platform si se configura una clave en Configuración general → Cartografía).
- Búsqueda de calles y lugares y selección de la zona del preventivo.
- Biblioteca de planos: Santiago Bernabéu, Estadio Metropolitano y Puerta del Sol, y los que se guarden.
- Plano interactivo: arrastrar unidades (también desde «pendientes de asignación»), doble clic o pulsación larga para cambiar la clave, avisos en un punto o en una zona dibujada.

**Actualizaciones**
- La aplicación se actualiza sola: comprueba la integridad de cada versión, no interrumpe a quien está trabajando y conserva los datos y los cambios pendientes de enviar.
- Si una versión no arranca, una pantalla de recuperación permite volver a la anterior sin perder datos.
- El servidor central se actualiza desde Sistema → Actualizaciones: descarga verificada, prueba con una copia de los datos, copia de seguridad, reinicio controlado (o en la ventana segura, sin actividad) y vuelta automática a la versión anterior si algo falla.
- Panel con la versión del servidor, el resultado de los despliegues y la versión de cada dispositivo.
- Los datos de cada dispositivo se migran con una copia de seguridad previa.

## 1.1.0 (18/11/2026)

- Servidor central preconfigurado: crear un preventivo nunca pide direcciones ni servidores.
- Cuentas comunes: en un dispositivo nuevo basta con el usuario y la contraseña.
- Preventivos compartidos que aparecen solos en los demás dispositivos.
- Instalador del servidor con copia de seguridad previa y vuelta atrás automática.
