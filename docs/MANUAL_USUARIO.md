# Manual de usuario

Versión de la aplicación: **1.5.0**. Las novedades de cada versión están en [CAMBIOS.md](CAMBIOS.md).
Lo que ve cada persona depende de sus permisos: si falta un botón o una pantalla, es que su perfil no lo permite.

## 1. Primer uso

**Con el servidor central (lo habitual).** La aplicación ya conoce el servidor: nunca pide direcciones.
1. Abre la aplicación (la dirección HTTPS o la aplicación instalada).
2. Entra con el **usuario y la contraseña** que te ha dado el administrador. La primera vez se descargan los datos del servidor; después también funciona sin conexión.
3. **Cuenta sin contraseña:** el administrador te da un **código de activación** de un solo uso (caduca a las 72 h). En «Tengo un código de activación» escribe tu usuario y el código, y elige un **PIN** nuevo de 6 a 12 cifras. El PIN solo sirve en ese dispositivo.
4. **Crear una cuenta** (solo con el modo servidor): si el registro está abierto, la solicitud queda pendiente y sin permisos hasta que un administrador la aprueba.

**Sin servidor central** («Usar este dispositivo sin servidor central»):
1. Crea el administrador del dispositivo: nombre, usuario y contraseña, nombre del dispositivo y un código corto (p. ej. `T1`).
2. Guarda la **clave de recuperación** fuera del dispositivo: es la única forma de recuperar el acceso si se olvidan todas las contraseñas.
3. Más tarde se puede conectar desde *Sistema → Servidor central*.

Después, en *Sistema → Permisos del dispositivo*, concede almacenamiento persistente, ubicación, notificaciones y pantalla encendida, e instala la aplicación. Con **Probar** comprueba que el aviso de fin de descanso se ve y se nota.

¿Vienes de otro dispositivo sin servidor central? En la pantalla inicial: **Restaurar copia de seguridad** con un archivo `.ucobak` y su contraseña.

## 2. Navegación
- **Teléfono:** barra inferior (Panel, Unidades, Avisos, Plano, Más). **Tablet y ordenador:** barra lateral y centro de control en columnas.
- **Barra superior:**
  - el preventivo y su estado;
  - el estado de la sincronización;
  - las **incoherencias** sin revisar, con su nivel más grave;
  - **Sin conexión** cuando no hay red (todo sigue funcionando).
- El botón Atrás de Android y la tecla Escape cierran el panel abierto. Al cerrarlo, el foco vuelve al botón que lo abrió.
- **Tema:** *Configuración general → Apariencia y dispositivo*: según el sistema, claro u oscuro (operaciones nocturnas).

## 3. Preventivos
- **Nuevo preventivo** abre un asistente en 7 pasos:
  1. Origen: configuración general, una **plantilla** o **duplicar** otro preventivo.
  2. Nombre.
  3. Fecha y horario.
  4. Sectores y recursos previstos: se pueden quitar los que no hagan falta.
  5. Opciones heredadas que se quieren cambiar.
  6. Modalidad.
  7. Confirmación con el resumen.
- **Modalidad:**
  - *Independiente*: un único dispositivo, sin Internet ni servidor.
  - *Compartida*: varios dispositivos a través del servidor central. El preventivo aparece solo en los demás dispositivos autorizados.
- Si no marcas *Activar ahora*, queda **en preparación** para revisar unidades, plano y configuración; después se activa desde el panel.
- **Historial:** preventivos finalizados y archivados, consultables. Desde ahí se pueden **recuperar** y **exportar**.
- Un preventivo **finalizado** no se puede modificar. La **reapertura** exige permiso, motivo y contraseña, y queda registrada.

## 4. Unidades
- **Añadir unidad:**
  - **Unidades plantilla** (UPR, SVB, VIRES, ALFA, PAPA… y las que se configuren): basta con escribir el número. Por ejemplo, 8025 crea «UPR 8025» con su tipo, icono y color, en C0 y **pendiente de asignación** en el plano.
  - **Unidad personalizada:** identificador (obligatorio y único), nombre, denominación, tipo, subtipo, categoría, sector, descripción, observaciones, equipamiento, características y apariencia.
- Solo se ofrecen los **tipos de recurso activos**. Las unidades de un tipo que se desactiva después conservan sus datos.
- **Sector «OTROS»:** permite escribir un sector o ubicación solo para esa unidad, sin crearlo en la configuración.
- Toca una unidad para abrir su **ficha**: clave, aviso, descanso, ubicación, color C0, observaciones e incidencias, cronología, ver en el plano y editar.
- **Desactivar** = fuera de servicio temporal. **Archivar** = retirarla conservando su historial. **Eliminar** solo si no tiene actividad.

## 5. Claves operativas
| Clave | Significado (editable) |
|---|---|
| C0 | Disponible |
| C1 | Alertado (se aplica automáticamente al asignar un aviso) |
| C2 | En ruta (el aviso pasa a *En curso*) |
| C3 | En el punto (marca la llegada: tiempo de respuesta) |
| C4 | Traslado hospitalario |
| C5 | En hospital |
| C6 | Inoperativo (clave especial) |
| CESP | Clave especial con **motivo** elegido en un desplegable |

- Solo se muestran las transiciones permitidas. Un administrador puede **forzar** otras (queda registrado como forzado).
- Pasar a C0, C6 o CESP **libera** la unidad de su aviso (se pide confirmación).
- Nombres, colores, transiciones y comportamiento: *Más → Configuración del preventivo → Claves*.

## 6. Color C0
- Cada unidad tiene su **color C0**. Solo se puede cambiar cuando la unidad está **en C0**.
- En C0 la unidad se muestra con su color; en otras claves, con el de la clave. **El borde conserva siempre el color C0.** En descanso se ve en gris.
- El texto sobre cualquier color se elige automáticamente en negro o blanco para que se lea bien.

## 7. Avisos
- **Nuevo aviso** abre las carpetas de **códigos de incidente** (1. Accidente de Tráfico, 3. Enfermedad…). Al tocar el código se crea el aviso y se abre para asignar unidades.
  - Buscador por número o texto («1.2», «atropello»).
  - «Más datos antes de crear…» abre el formulario completo: tipo, descripción, hora, ubicación, sector, observaciones y unidades.
  - Los tipos de aviso propios siguen en la carpeta «Otros tipos».
- **Unidades en el formulario**, con su tipo, clave, sector, avisos, descanso y disponibilidad:
  - las compatibles y libres más adecuadas aparecen como **sugeridas** (no se marcan solas: decide el coordinador);
  - las que no se pueden asignar están deshabilitadas, con el motivo.
- **Estados:** Pendiente → Asignado → En curso → Finalizado. Los finalizados están en **Avisos finalizados**.
- **Numeración** correlativa y única. Un aviso creado sin conexión lleva una referencia provisional (p. ej. `M-2`) y la marca **«Pendiente de confirmar»** hasta que el servidor lo confirma y le da su número.
- Al **finalizar** con unidades todavía ocupadas, quedan liberadas y vuelven a C0 (se avisa antes).
- **Tiempos:** asignación (hora del aviso → primera asignación), respuesta (→ primera llegada), intervención (llegada → última salida del punto) y resolución (→ finalización).
- **Ubicación:** dirección escrita, coordenadas, GPS, enlace de Google Maps, un **sector**, un **punto de interés** o un punto del plano. Se guarda su **origen** y su hora: una posición marcada en el mapa no se presenta como GPS.

## 8. Descansos
- 30 minutos por defecto (configurable con permiso). La unidad aparece en **gris** con la cuenta atrás.
- **No se puede iniciar un descanso con un aviso activo.** Una unidad en descanso no es asignable mientras dure.
- El tiempo usa marcas reales: sobrevive a recargas y reinicios. Al terminar, la unidad vuelve a su estado.

## 9. Plano de coordinación y mapa
- **Planos:**
  - de **imagen** (foto o archivo): funciona sin Internet;
  - **cartográfico**: «Importar desde Google Maps» busca una calle o un lugar y se elige la zona. Las posiciones son coordenadas reales;
  - **biblioteca:** Santiago Bernabéu, Estadio Metropolitano, Puerta del Sol y los planos guardados.
- **Tipo de mapa** (botón de capas): estándar, satélite, híbrido o relieve. Sin clave se usan OpenStreetMap e IGN; con clave de Google, también sus vistas. Se guarda en el preventivo y no mueve nada.
- **Unidades:**
  - arrastrar para moverlas (se guarda al soltar y llega a los demás);
  - **doble clic o pulsación larga** para cambiar la clave;
  - **pendientes de asignación:** arrastrarlas al plano; desde el plano se pueden devolver.
- **Capas y filtros:**
  - capas: unidades, avisos activos y finalizados, sectores, puntos de interés, infraestructura y apoyo, y etiquetas;
  - filtros combinables: tipo, clave, disponibilidad, sector y tipo de aviso; **Restablecer** los quita;
  - son preferencias de este dispositivo y de este preventivo: **ocultar no desactiva ni cambia nada**.
- **Avisos en el mapa:** su número y su código de incidente (por ejemplo, «Nº 1 · 1.1»). El color indica el estado; los finalizados llevan «✓».
- **Leyenda** con los colores y los símbolos de disponibilidad (✓ ● ‖ ◆ ✕). Con muchas unidades se **agrupan**; al tocar un grupo, el mapa se acerca.
- **Ficha contextual:** al tocar una unidad, un aviso, un sector o un punto se abre una tarjeta dentro del mapa.
  - En los avisos muestra su historial reciente y, según los permisos, **Asignar unidad**, **Finalizar** y **Editar**.
  - «Abrir aviso» da la ficha completa con todo el historial.
- **Lista:** los mismos elementos del plano en una lista, con las mismas capas y filtros. Es la alternativa al mapa.
- **Puntos de interés y sectores delimitados:** se colocan tocando el plano. Las categorías de punto (accesos, puesto sanitario, hospital, abastecimiento…) se pueden ampliar.
- **Nuevo aviso en el mapa:**
  1. Pulsa el botón y toca el lugar: aparece un **marcador provisional**.
  2. Ajústalo arrastrándolo, con las **flechas en pantalla** o con las del teclado.
  3. Confirma (o pulsa Intro) y completa el formulario. Si el punto está dentro de un sector delimitado, se propone ese sector.
- **Aviso por zona:** se marcan los puntos de la zona; el aviso queda en su centro y con la zona dibujada.

## 10. Incoherencias
- *Más → Incoherencias* avisa de situaciones contradictorias. Por ejemplo:
  - una unidad «disponible» con un aviso activo;
  - la misma unidad en dos avisos;
  - un descanso con un aviso activo;
  - un aviso sin unidad;
  - cambios sin enviar o rechazados por el servidor.
- Hay cuatro niveles: información, moderada, alta y crítica. Cada advertencia dice qué ocurre, desde cuándo, por qué, sus consecuencias y qué hacer.
- Se puede **marcar como revisada**, **asignar** a alguien, **resolver** con una nota, **reabrir** y ver su **historial**.
- **La aplicación nunca corrige nada sola:** decide el usuario autorizado.
- Niveles, umbrales y reglas activas se ajustan por preventivo (pestaña Reglas).

## 11. Bitácora, cronología y estadísticas
- **Bitácora y auditoría:** todo lo ocurrido con fecha, usuario, dispositivo, elemento, acción y valores anterior y nuevo. Filtros por categoría, usuario, texto y conflictos. Exportable.
- **Cronología de unidades:** la actividad de cada unidad con duraciones, o de **todas las unidades** a la vez. Filtros por fecha y tipo.
- **Tiempos y estadísticas:** por preventivo, por unidad y por aviso. Sin datos suficientes se muestra «—».

## 12. Finalizar preventivo e informes
- *Más → Finalizar preventivo e informes*.
- **Finalizar preventivo:**
  - muestra las advertencias (avisos abiertos, unidades ocupadas, descansos, conflictos, cambios sin enviar) con enlaces para resolverlas;
  - se puede finalizar igualmente: las advertencias quedan registradas;
  - se crea un punto de restauración, se guarda la **versión 1 del informe** y se archiva.
- **Versiones del informe:**
  - cada versión guarda su fecha, autor, dispositivo y **huella SHA-256**;
  - **Nueva versión…** exige un motivo y conserva las anteriores;
  - **Comprobar un PDF…** dice si un archivo es una versión registrada y sin modificar.
- **Antes de finalizar**, el informe PDF sale marcado como **provisional**. También lo está si hay cambios sin enviar o conflictos.
- **Exportar:** Excel (XLSX), datos JSON y tablas CSV (ZIP). En Android también se pueden **compartir**.
- Generar, consultar y exportar queda registrado en la bitácora. **No cambia ningún dato operativo.**

## 13. Trabajo compartido y servidor central
- Los preventivos compartidos usan el servidor central: no hay que configurar nada.
- Sin red, cada dispositivo sigue trabajando y se sincroniza solo al volver.
- **Conflictos** (dos personas cambian lo mismo a la vez): no se sobrescribe nada en silencio. Aparecen en *Más → Sincronización* para que un usuario autorizado elija.
- **Modo servidor** (si el administrador lo ha activado): el servidor comprueba los permisos de cada cambio. Lo rechazado se deshace en el dispositivo y se puede revisar en *Sistema → Servidor central → Cambios rechazados*.
- **Fuera del servidor central:** «Unirse con código» o *Más → Sincronización → Exportar paquete* e *Importar paquete* (Bluetooth, USB, mensajería).

## 14. Plantillas de preventivo
- **Crear una plantilla:**
  - *Plantillas → Nueva plantilla*, desde la configuración general;
  - *Más → Crear plantilla desde este preventivo*, también de uno finalizado. Se elige qué incluir;
  - **duplicar** otra plantilla.
- **Qué incluye:** tipos de recurso, unidades previstas, sectores, puntos, plano, capas, tipos de aviso, parámetros y reglas. Los **usuarios y roles previstos** solo se incluyen si se marcan, porque son datos personales.
- **Nunca se copian** avisos, números, estados en curso ni historiales.
- **Versiones:** cada cambio crea una versión y se conservan las anteriores. Se puede restaurar una. Cada preventivo sabe con qué versión se creó.
- **Gestión:**
  - favoritas (★);
  - desactivar (deja de ofrecerse) y eliminar;
  - exportar e importar;
  - consultar sus usos.
- Cambiar o eliminar una plantilla **no** cambia los preventivos ya creados.
- **Permisos** separados para crear, para modificar y eliminar, y para usar plantillas.

## 15. Usuarios, perfiles y permisos
- **Sin modo servidor:** *Sistema → Usuarios y roles*, con perfiles (Administrador, Operador, Consulta y los que se creen) y su matriz de permisos.
- **Con modo servidor:** *Sistema → Usuarios y roles* gestiona las cuentas del servidor.
  - Alta con contraseña o sin contraseña (código + PIN).
  - Aprobar o rechazar registros.
  - Estados: pendiente, activa, suspendida, desactivada, invitación pendiente y activación caducada.
  - Permisos por módulos: un **perfil** más ajustes individuales, para todos los preventivos o solo para algunos.
  - Cerrar sesiones y retirar el PIN de un dispositivo.
  - Auditoría por usuario.
- Nadie puede darse permisos a sí mismo y siempre queda un administrador.
- Los usuarios no se borran (se desactivan) para conservar la autoría de los registros. La sesión se bloquea tras el tiempo de inactividad configurado.

## 16. Configuración general
- **Tipos de recurso:**
  - crear, editar, duplicar, activar o desactivar;
  - eliminar, también los iniciales. Antes se ve dónde se usan y se elige **reasignar**, **retirar del uso** (se conserva para el historial) o **eliminar**;
  - nunca se borran unidades ni registros.
- **Unidades plantilla:** crear, editar, duplicar, desactivar y eliminar (por ejemplo, UPR: tipo, icono, color, prefijo y campos que se piden).
- **Cartografía:** clave de Google Maps Platform (opcional; tiene coste a partir de su cuota gratuita).
- **Restaurar configuraciones iniciales:** recupera las eliminadas cuando se decida (no vuelven solas).

## 17. Sistema
- **Actualizaciones:**
  - la aplicación se actualiza sola al abrirla y sin interrumpir a quien trabaja;
  - el servidor se actualiza desde *Sistema → Actualizaciones*: descarga verificada, prueba con una copia de los datos, instalación ahora o en una ventana sin actividad, y vuelta atrás automática si falla;
  - lo decide un administrador con el código de administración del servidor.
- **Estado del sistema** (administradores):
  - servidor, datos y disco, memoria y CPU;
  - dispositivos activos y sincronización;
  - copias, cartografía;
  - **alertas** con su origen y hora.
- **Copias de seguridad y recuperación:**
  - copias automáticas y puntos de restauración antes de finalizar y de restaurar;
  - **Exportar copia completa (cifrada)** (`.ucobak`, con su propia contraseña);
  - **Restaurar:** *Fusionar* (añade lo que falte, sin borrar) o *Reemplazar*;
  - **Verificar integridad**;
  - contraseña olvidada: *He olvidado la contraseña* con la clave de recuperación (dispositivos sin servidor central); con el servidor central, pide al administrador que la restablezca.
