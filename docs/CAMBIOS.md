# Novedades del Gestor de Emergencias UCO

Cada versión publica a la vez la aplicación y el servidor central. Los servidores ven la versión nueva en
Sistema → Actualizaciones y solo se instala cuando un administrador lo decide.

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
