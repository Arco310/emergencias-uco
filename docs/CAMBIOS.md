# Novedades del Gestor de Emergencias UCO

Cada versión publica a la vez la aplicación y el servidor central. Los servidores ven la versión nueva en
Sistema → Actualizaciones y solo se instala cuando un administrador lo decide.

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
