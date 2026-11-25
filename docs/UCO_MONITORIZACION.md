# Estado del sistema: monitorización del servidor (1.5.0)

Código:
- `server/monitor.mjs`: estado, alertas e historial.
- Ruta en `server/server.mjs`.
- `server/espacio-servidor.mjs`: `resumenControl` y `auditarAcceso`.
- `src/ui/views/sistema.js`: Sistema → Estado del sistema.

## Acceso
- Ruta: `POST /api/v1/org/<espacio>/admin/estado`.
- **Modo servidor:** sesión de un usuario con el permiso `sistema.estado` («Consultar el estado técnico del servidor y del sistema»).
  - Lo tiene el perfil Administrador.
  - Lo incluye «Gestionar las actualizaciones».
  - Ningún otro perfil lo tiene por defecto.
- **Modo anterior** (sin cuentas en el servidor): además del token del espacio, el código de administración del servidor.
  - La aplicación lo pide y lo guarda solo en memoria mientras está abierta.
  - Se aplican los mismos límites de intentos fallidos que en el resto de acciones de administración.
- Cada consulta queda registrada:
  - modo servidor: auditoría del espacio;
  - modo anterior: registro de actualizaciones del servidor.
- La respuesta se guarda 10 s en caché, así que consultar el panel no carga el servidor. La pantalla se actualiza sola cada 30 s mientras está abierta.
- **Nunca devuelve** contraseñas, tokens, claves, códigos ni rutas. Los mensajes de error se limpian de tokens, claves largas y nombres de usuario de las rutas.

## Qué muestra
| Apartado | Datos |
|---|---|
| Servidor | Estado, versión, último reinicio, tiempo de actividad, API y errores recientes (ruta sin identificadores, hora y mensaje limpio) |
| Datos y almacenamiento | Prueba real de escritura, lectura y borrado de un archivo, con su tiempo; errores de acceso; tamaño de los datos; disco libre y total |
| Recursos | Memoria del proceso y del equipo, CPU del proceso (medida cada 15 s), núcleos y carga media (no existe en Windows) |
| Sincronización | Ver los puntos siguientes |
| Copias | Ver los puntos siguientes |
| Este dispositivo | Versión, conexión, servidor central, cambios sin enviar y almacenamiento del navegador |
| Servicios externos | Ver los puntos siguientes |

**Sincronización:**
- Dispositivos **por latido** (activo si dio señal en los últimos 3 min; no basta con tener la sesión abierta).
- Operaciones recibidas y rechazadas desde el arranque (por motivo) y últimos rechazos.
- En modo servidor, los conflictos sin resolver y las incoherencias abiertas de cada preventivo cargado.

**Copias:**
- Copias del servidor (las del actualizador antes de cada actualización o reinstalación; se conservan 5): fecha, motivo, tamaño y resultado.
- Destino (sin rutas) y programación.
- Errores.
- La última copia local de este dispositivo.

**Servicios externos:**
- Comprobación **manual** (como mucho una por minuto) desde el dispositivo, con una sola tesela de OpenStreetMap y otra del IGN.
- **Google no se comprueba**, para no generar consumo en su clave.

## Alertas
- Cada alerta tiene nivel, origen, mensaje y hora de inicio. Al resolverse quedan en un historial con su fin (las 100 últimas), que se conserva al reiniciar en `datos/_servidor/monitor.json`.
- Situaciones que generan alerta:

| Situación | Nivel |
|---|---|
| Almacenamiento no disponible | crítica |
| Menos de 1 GB o del 5 % de disco | alta |
| Menos de 5 GB o del 10 % de disco | moderada |
| Memoria libre por debajo del 5 % | moderada |
| Copia fallida | alta |
| 20 o más rechazos en una hora | moderada |
| 5 o más errores en una hora | moderada |
| Servidor sin poder leer sus códigos | alta |
| Error de actualización | moderada |
| Conflictos sin resolver durante más de 30 min (modo servidor) | moderada |
| El servidor no responde (lo detecta la aplicación, con la hora del primer fallo) | crítica |

- No se instala ningún agente ni servicio nuevo.

## Correcciones relacionadas
- En modo servidor (1.4.0), las peticiones ya atendidas seguían por las demás rutas del servidor e intentaban responder dos veces. El error «Cannot write headers after they are sent» quedaba en el registro.
- Se ha corregido. Ahora se comprueba que no queda ningún error tras toda la batería de pruebas.

## Pruebas
- Servidor:
  - `monitor.test.mjs`: secretos, apartados, alertas e historial, almacenamiento caído, copia fallida, acceso por HTTP con código y caché;
  - `modo_servidor.test.mjs`: permiso, auditoría, conflictos por preventivo y ningún error registrado.
- E2E:
  - escenario 2: modo anterior con código, dispositivos activos y «el servidor no responde» con el servidor detenido;
  - escenario 10: modo servidor; un operador no ve la opción.
