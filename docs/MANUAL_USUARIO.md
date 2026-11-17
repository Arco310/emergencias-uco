# Manual de usuario

## 1. Primer uso
1. Abre la aplicación (dirección HTTPS o aplicación instalada).
2. **Configuración inicial**: nombre del administrador, usuario y contraseña (mínimo 6 caracteres), nombre del dispositivo y código corto (p. ej. `T1`).
3. Se muestra la **clave de recuperación**. Guárdala fuera del dispositivo: es la única forma de recuperar el acceso si se olvidan todas las contraseñas.
4. En *Sistema → Permisos del dispositivo* concede almacenamiento persistente, ubicación, notificaciones y pantalla encendida, e instala la aplicación. Con los botones **Probar** de Notificaciones y Vibración comprueba en cada móvil que el aviso de fin de descanso se ve y se nota.

¿Vienes de otro dispositivo? En la pantalla inicial pulsa **Restaurar copia de seguridad** y elige un archivo `.ucobak` con su contraseña.

## 2. Navegación
- **Teléfono**: barra inferior (Panel, Unidades, Avisos, Plano, Más). **Tablet**: barra lateral y panel de control en tres columnas.
- Arriba se ven el preventivo, su estado, el estado de sincronización y el aviso **Sin conexión** cuando no hay red (todo sigue funcionando).
- El botón Atrás de Android cierra el panel abierto.

## 3. Preventivos
- **Nuevo preventivo**: parte de la configuración general, de una **plantilla** o **duplicando** otro preventivo (con o sin unidades y plano). Elige la **modalidad**:
  - *Independiente*: un único dispositivo, sin Internet ni servidor.
  - *Compartida*: varios dispositivos; con servidor o por archivo.
- Si no marcas *Activar ahora*, queda **en preparación**: revisa unidades, plano y configuración y pulsa **Activar** en el panel.
- **Historial**: preventivos cerrados y archivados (consultables). Desde ahí se puede **recuperar** del archivo y **exportar** (JSON).
- Un preventivo **cerrado** no se puede modificar. La **reapertura** exige permiso, motivo y contraseña, y queda registrada.

## 4. Unidades
- **Nueva unidad**: identificador (obligatorio y único), nombre, denominación, tipo, subtipo, categoría, sector, descripción, observaciones, equipamiento, características y apariencia (icono, forma, tamaño, borde, etiqueta en el plano, diseño de tarjeta, campos visibles, mostrar u ocultar en el plano).
- Lo que dejes en **"heredar del tipo"** sigue al tipo de recurso; lo personalizado se conserva aunque cambie el tipo.
- Toca una unidad para abrir su **ficha**: cambiar clave, asignar a aviso o liberar, descanso, ubicación, color C0, observaciones e incidencias, cronología, ver en el plano, editar.
- **Desactivar** = fuera de servicio temporal. **Archivar** = retirarla conservando todo su historial (si tiene actividad). **Eliminar** solo es posible si no tiene actividad.

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
- Nombres, colores, transiciones y comportamiento se configuran en *Más → Configuración del preventivo → Claves*.

## 6. Color C0
- Cada unidad tiene su **color C0** propio. Solo se puede cambiar cuando la unidad está **en C0**.
- En C0 la unidad se muestra con su color; en otras claves, con el color de la clave. **El borde conserva siempre el color C0**. En descanso se ve en gris.

## 7. Avisos
- **Nuevo aviso**: tipo, descripción, hora (por defecto, la actual), ubicación, sector y observaciones. Al crearlo se abre con las **unidades sugeridas** (distancia, compatibilidad, sector, disponibilidad).
- La asignación resuelve los casos especiales preguntando: unidad en descanso, en clave especial, de tipo no compatible u ocupada en otro aviso.
- Estados: **Pendiente → Asignado → En curso → Finalizado**. Los finalizados están en la pestaña **Avisos finalizados** (se muestran de 100 en 100; pulsa **Mostrar más** o usa el buscador y los filtros).
- **Numeración**: correlativa y única. En modalidad compartida, un aviso creado sin conexión lleva una referencia provisional (p. ej. `M-2`) hasta recibir su número definitivo del servidor.
- Al **finalizar** con unidades todavía ocupadas, quedan liberadas y vuelven a C0 (se avisa antes).
- Tiempos: **asignación** (hora del aviso → primera asignación), **respuesta** (→ primera llegada al punto), **intervención** (llegada → última salida del punto), **resolución** (→ finalización).

## 8. Descansos
- Duración por defecto: 30 minutos (configurable con permiso). La unidad aparece en **gris** con la cuenta atrás.
- **No se puede iniciar un descanso con un aviso activo.** Una unidad en descanso no es asignable (salvo que se finalice el descanso).
- El tiempo usa marcas reales: sobrevive a recargas y reinicios. Al terminar, la unidad vuelve a su estado sin perder cambios.

## 9. Plano táctico y mapa real
- **Plano**: importa una imagen del recinto (funciona sin Internet). *Colocar y mover*: elige una unidad sin posición y toca el plano; arrastra para mover; mantén pulsado para quitar. Pellizca o usa los botones para ampliar/reducir.
- Desde un aviso: **Situar en plano**.
- **Mapa real** (*Más → Mapa real*): ubicaciones con dirección o coordenadas en Google Maps (necesita Internet) y botón **Abrir en Google Maps**.
- **Ubicación** de unidades y avisos: texto libre, coordenadas, **GPS**, **pegar un enlace de Google Maps** o **buscar coordenadas** (OpenStreetMap). Solo se registra un cambio si la ubicación cambia de verdad.

## 10. Bitácora, cronología y estadísticas
- **Bitácora y auditoría**: todo lo ocurrido con fecha, usuario, dispositivo, elemento, acción y valores anterior y nuevo. Filtros por categoría, usuario, texto y conflictos. Exportable a CSV.
- **Cronología de unidades**: actividad de cada unidad con duraciones; filtros por fecha y tipo; puede incluir otros preventivos (misma unidad por identificador).
- **Tiempos y estadísticas**: por preventivo (avisos por hora, evolución, tiempo por clave, distribución por tipo y sector), por unidad (servicio, tiempo por clave, avisos, descansos) y por aviso (tiempos con media y mediana). Sin datos suficientes se muestra "—".

## 11. Cierre e informes
- *Más → Cierre e informes*: genera en cualquier momento el **informe PDF**, los **datos JSON** y las **tablas CSV** (ZIP). En Android también se pueden **compartir**. En preventivos muy grandes el PDF tarda unos segundos (aparece «Generando el informe PDF…»).
- **Cerrar preventivo**: muestra las advertencias (avisos pendientes o activos, unidades ocupadas, descansos, conflictos, cambios sin sincronizar) con enlaces para resolverlas. Puedes cerrar igualmente; las advertencias quedan registradas. Se crea un punto de restauración, se genera el informe y se archiva.

## 12. Modalidad compartida
- Al crear un preventivo compartido se muestra el **código de incorporación** (*Más → Sincronización*). Compártelo solo con dispositivos autorizados.
- En otro dispositivo: **Unirse a un preventivo compartido** y pegar el código.
- Sin red, cada dispositivo sigue trabajando. Al volver la conexión se sincroniza solo. Sin servidor o sin Internet: **Exportar paquete** e **Importar paquete**.
- **Conflictos** (dos personas cambian lo mismo a la vez): no se sobrescribe nada en silencio. Aparecen en *Sincronización* para que un usuario autorizado elija.

## 13. Plantillas
- *Plantillas → Nueva* o *Más → Crear plantilla desde este preventivo*.
- Contienen catálogos (claves, sectores, tipos de aviso y de recurso, motivos), unidades de referencia con su apariencia y posición, plano, preferencias y usuarios y roles previstos.
- Favoritas (★), duplicar, renombrar, exportar/importar y consultar sus **usos**. Cambiar una plantilla **no** cambia los preventivos ya creados.

## 14. Usuarios, roles y permisos
- *Sistema → Usuarios y roles*. Perfiles iniciales: **Administrador**, **Operador** y **Consulta**; se pueden crear roles a medida con la **matriz de permisos**.
- Los usuarios no se borran (se desactivan) para conservar la autoría de los registros.
- La sesión se bloquea tras el tiempo de inactividad configurado.

## 15. Copias de seguridad y recuperación
- Copias automáticas cada pocos minutos si hay cambios, y puntos de restauración antes del cierre y de cada restauración.
- **Exportar copia completa (cifrada)**: archivo `.ucobak` para guardar fuera o pasar a otro dispositivo. Guarda su contraseña.
- **Restaurar**: *Fusionar* (añade lo que falte, sin borrar nada) o *Reemplazar* (restauración completa).
- **Verificar integridad** comprueba que todos los datos se pueden leer.
- Si se olvida la contraseña: *He olvidado la contraseña* en la pantalla de acceso, con la clave de recuperación.
