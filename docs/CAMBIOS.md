# Novedades del Gestor de Emergencias UCO

Cada versión publica a la vez la aplicación y el servidor central. Los servidores ven la versión nueva en
Sistema → Actualizaciones y solo se instala cuando un administrador lo decide.

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
