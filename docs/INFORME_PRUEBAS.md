# Informe de pruebas

Fecha de ejecución: 17/11/2026 17:43 (UTC) · Versión 1.0.0 · compilación final

| Bloque | Pruebas | Superadas | Fallidas |
|---|---:|---:|---:|
| Reglas de negocio y datos (unidad, `node:test`) | 26 | 26 | 0 |
| Servidor de sincronización e integración completa (`node:test`, servidor real) | 14 | 14 | 0 |
| Aceptación en navegador (Chrome 153 + Playwright) | 31 | 31 | 0 |
| Comprobaciones de calidad (instalabilidad, accesibilidad, seguridad, HTTPS) | 12 | 12 | 0 |
| **Total** | **83** | **83** | **0** |

Todas las pruebas listadas se han **ejecutado realmente**; las salidas completas están en `tests/resultados-node.tap`, `tests/e2e/resultados.json` y `tests/checks/resultados.json`, y las capturas en `tests/e2e/capturas/`.

## 1. Pruebas de unidad (reglas críticas)
- ✔ preventivo: creación, activación y unidades desde la creación
- ✔ color C0: solo editable en C0, borde siempre C0, recuperación al volver a C0
- ✔ color C0: el motor rechaza un cambio de color fuera de C0 aunque llegue de otro dispositivo
- ✔ claves: transiciones permitidas, motivo obligatorio en CESP y requisito de aviso
- ✔ avisos: flujo completo C1→C5, liberación al volver a C0 y finalización
- ✔ avisos: numeración correlativa que no depende de los avisos visibles
- ✔ descansos: bloqueo con aviso activo, temporizador real, recuperación tras recargar y fin automático
- ✔ descansos: duración distinta de la predeterminada requiere permiso; fin manual; asignación terminando descanso
- ✔ unidades: indicativo único, eliminación solo sin actividad, archivado conserva historial
- ✔ personalización: la unidad hereda del tipo y sus personalizaciones no se sobrescriben
- ✔ catálogos: no se puede eliminar una clave en uso ni dejar sin clave base
- ✔ cierre: advertencias, solo lectura y reapertura con autorización registrada
- ✔ permisos: perfil Consulta no puede operar; Operador no puede configurar
- ✔ multidispositivo: el mismo conjunto de operaciones produce el mismo estado en cualquier orden
- ✔ multidispositivo: modificaciones simultáneas generan conflicto (no gana la última escritura)
- ✔ multidispositivo: asignación y descanso simultáneos sobre la misma unidad
- ✔ numeración del servidor: números definitivos únicos aunque se creen a la vez
- ✔ HLC: orden total y monotonía con relojes desfasados
- ✔ plantillas: copia independiente, sin identificadores ni datos operativos
- ✔ estadísticas: tiempos verificados con datos conocidos
- ✔ exportación: CSV, JSON, ZIP y PDF con contenido real
- ✔ cifrado: claves envueltas, contraseña incorrecta, sellado y claves de preventivo
- ✔ sugerencias: prioriza cercanía, compatibilidad y sector; excluye descanso y ocupadas
- ✔ geo: coordenadas desde enlaces de Google Maps y distancias
- ✔ bitácora: registra usuario, elemento, acción, valor anterior y nuevo
- ✔ geo: mapas incrustables sin clave (Google y OpenStreetMap)

## 2. Servidor e integración (repositorio cifrado + motor + sincronización real)
- ✔ A crea un preventivo compartido y B se incorpora con el código
- ✔ avisos creados a la vez en dos dispositivos: sin duplicados y numeración única
- ✔ desconexión: B sigue trabajando sin red y al reconectar se sincroniza sin pérdidas
- ✔ conflicto: misma unidad editada sin conexión en ambos dispositivos
- ✔ sincronización por archivo sin servidor
- ✔ copias: exportación cifrada y restauración completa en otro dispositivo
- ✔ seguridad: bloqueo tras intentos fallidos y recuperación con clave
- ✔ recuperación del servidor: reenvío completo sin duplicados y conservando la numeración
- ✔ salud y registro del preventivo
- ✔ autenticación obligatoria
- ✔ envío idempotente, numeración concurrente única y lectura incremental
- ✔ archivos (planos) cifrados
- ✔ persistencia tras reinicio y continuidad de la numeración
- ✔ CORS para la aplicación alojada en otro dominio

## 3. Aceptación en navegador
Entorno: Google Chrome 153 (sin interfaz) controlado con Playwright, con la aplicación compilada servida por el servidor de sincronización. Perfiles: **teléfono** 390×844 táctil y **tablet** 1280×800 táctil. En el escenario 2 trabajan a la vez una tablet y un teléfono con almacenamiento independiente.

| Prueba | Resultado | Detalle |
|---|---|---|
| Alta inicial del administrador y clave de recuperación | SUPERADA | clave 98GQY… |
| Permisos del dispositivo: solicitar todos | SUPERADA | aviso al primer acceso; ubicación y notificaciones concedidas; queda en la auditoría |
| Crear preventivo independiente y activarlo | SUPERADA |  |
| Unidades: crear desde el formulario | SUPERADA | 3 unidades |
| Unidades: editar y personalizar apariencia | SUPERADA | nombre, forma, icono y tamaño personalizados |
| Color C0: personalizar en C0 | SUPERADA | color principal y borde = #AA00AA en C0 |
| Avisos: crear, numerar, sugerir y asignar; claves C1-C3 | SUPERADA | Nº 1 · AMB-01 C1 → C2 → C3 · aviso en curso |
| Color C0: bloqueo fuera de C0, color de clave y borde C0 | SUPERADA | fuera de C0: principal = color de clave C3, borde = C0, edición bloqueada |
| Descansos: bloqueo con aviso activo | SUPERADA | botón de descanso deshabilitado con aviso activo |
| Descansos: temporizador real que se recupera tras recargar | SUPERADA | cuenta atrás 0:59 → tras recargar 0:56; unidad en gris |
| Avisos: finalizar y apartado de finalizados | SUPERADA | aparece en Avisos finalizados; AMB-01 liberada a C0 |
| Color C0: recuperación al volver a C0 y persistencia | SUPERADA | al regresar a C0 recupera #AA00AA |
| Descansos: fin automático y recuperación del estado | SUPERADA | fin automático: vuelve a C0 con su color, sin sobrescribir la clave |
| Claves especiales: CESP con motivo | SUPERADA | CESP con motivo del desplegable |
| Plano táctico: importar, colocar unidades y persistencia | SUPERADA | imagen importada; 2 unidades colocadas; posiciones persistentes tras recargar |
| Estadísticas: vistas con datos reales | SUPERADA | vistas por preventivo, unidad y aviso |
| Bitácora: registro cronológico | SUPERADA | 18 registros con usuario y valores anterior/nuevo |
| Cronología individual de unidad | SUPERADA | 10 acontecimientos con duraciones |
| Informes: PDF, JSON y CSV con contenido real | SUPERADA | PDF 40 KB, JSON con 18 operaciones, ZIP con 8 CSV |
| Funcionamiento sin conexión (modo avión) | SUPERADA | modo avión: recarga, sesión, aviso nº 2, descanso, plano e informe PDF sin red |
| Plantillas: crear, aplicar y aislamiento | SUPERADA | preventivo desde plantilla: 3 unidades, plano y colores; 0 avisos; cambios posteriores en la plantilla no le afectan |
| Usuarios, roles y permisos | SUPERADA | Consulta sin acciones operativas; Operador crea avisos pero no edita configuración |
| Cierre del preventivo | SUPERADA | cerrado con advertencias registradas, archivado y en solo lectura |
| Sin errores de JavaScript (móvil) | SUPERADA | ninguno |
| Compartido: crear preventivo con servidor | SUPERADA | código de incorporación generado |
| Compartido: incorporar otro dispositivo | SUPERADA | el móvil recibe el preventivo y sus 3 unidades |
| Compartido: avisos simultáneos sin duplicados | SUPERADA | números definitivos únicos 1 y 2 en ambos dispositivos |
| Compartido: desconexión, trabajo local y reconexión | SUPERADA | trabajo sin red (ref. provisional M-2), reconexión y convergencia sin pérdidas |
| Compartido: resolución de conflictos | SUPERADA | conflicto detectado (sin última escritura silenciosa) y resuelto por el administrador |
| Tablet: panel operativo multicolumna | SUPERADA | panel de 3 columnas y navegación lateral |
| Sin errores de JavaScript (multidispositivo) | SUPERADA | ninguno |

## 3 bis. Comprobaciones de calidad (`tests/checks/comprobaciones.py`)
| Comprobación | Resultado | Detalle |
|---|---|---|
| Instalable como aplicación (criterios de Chrome) | CORRECTA | sin errores de instalabilidad |
| Manifiesto válido | CORRECTA | http://127.0.0.1:8650/manifest.webmanifest |
| Service worker activo (uso sin conexión) | CORRECTA | controla la página tras la primera carga |
| Controles con nombre accesible (24 pantallas) | CORRECTA | todos los botones, enlaces y campos tienen nombre |
| Controles táctiles de al menos 32 px | CORRECTA | ningún control por debajo de 32 px (la mayoría 44 px) |
| Identificadores únicos en cada pantalla | CORRECTA | sin duplicados |
| Sin errores de JavaScript en el recorrido | CORRECTA | ninguno |
| Contraste del texto sobre el color de cada clave (WCAG AA ≥ 4,5) | CORRECTA | 8 claves correctas |
| Sin claves ni credenciales en la aplicación publicada | CORRECTA | ninguna clave de API ni secreto |
| Política de seguridad de contenidos (CSP) | CORRECTA | default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; fon… |
| Servidor con HTTPS (certificado propio) | CORRECTA | API y aplicación servidas por HTTPS |
| Servidor: rechaza datos no válidos, envíos enormes, rutas fuera de la carpeta y accesos sin credenciales | CORRECTA | JSON roto 400, 26 MB -1, ruta 403, sin token 404 |

## 4. Correspondencia con las pruebas de aceptación del pliego (sección 25)
| Pliego | Cubierto por |
|---|---|
| Unidades: crear, editar, eliminar/archivar, desactivar, recuperar, cambiar tipo, personalizar | Unidad: «unidades: indicativo único, eliminación…», «personalización…»; navegador: «Unidades: crear», «editar y personalizar» |
| Colores C0: personalizar, cambiar de clave, color principal, borde, regresar, persistencia, bloqueo | Unidad: «color C0…» (2); navegador: «Color C0» (3 pruebas) |
| Avisos: crear, numerar, asignar, finalizar, historial, creación simultánea en varios dispositivos | Unidad: «avisos: flujo completo», «numeración…»; integración y servidor: numeración concurrente; navegador: avisos y «avisos simultáneos sin duplicados» |
| Descansos: iniciar, temporizador, recargar, bloqueo con aviso activo, recuperar estado | Unidad: «descansos…» (2); navegador: 3 pruebas (incluye fin automático real tras 60 s) |
| Plantillas: crear, duplicar, modificar, aplicar, preventivos anteriores sin cambios | Unidad: «plantillas…»; navegador: «Plantillas: crear, aplicar y aislamiento» |
| Offline (modo avión) | Navegador: «Funcionamiento sin conexión (modo avión)» (recarga sin red, sesión, aviso, descanso, plano e informe) |
| Multidispositivo: compartir, desconectar, continuar, reconectar, sincronizar, conflictos, sin duplicados ni pérdidas | Integración (8 pruebas con servidor real) y navegador (escenario 2) |
| Estadísticas con datos conocidos | Unidad: «estadísticas: tiempos verificados con datos conocidos» (valores exactos minuto a minuto) |
| Informes PDF, JSON y CSV | Unidad: estructura del PDF, CSV y reconstrucción desde el JSON; navegador: descarga y contenido de los tres formatos |
| Usuarios: roles, permisos y restricciones | Unidad: «permisos…»; navegador: «Usuarios, roles y permisos» |
| Dispositivos: móvil y tablet Android | Emulación de teléfono y tablet en Chrome (ver limitaciones) |

## 5. No verificado en este entorno (pendiente de prueba en campo)
- **Dispositivos Android físicos**: las pruebas usan Chrome con emulación táctil de teléfono y tablet, no terminales reales. Se recomienda una prueba en campo con los modelos que se vayan a usar (instalación como aplicación, modo avión, rotación de pantalla).
- **Google Maps y OpenStreetMap en vivo**: el entorno de pruebas no tiene acceso a Internet y ambos servicios bloquean la descarga automática, así que el mapa incrustado y la búsqueda de coordenadas no se han podido abrir en vivo. Los formatos de enlace están cubiertos por pruebas de unidad; el formato de Google sin clave no es oficial y podría dejar de funcionar, por eso la aplicación ofrece también el mapa de OpenStreetMap y el botón «Abrir en Google Maps». El GPS sí se ha probado, con posición simulada.
- **Servidor publicado con HTTPS real** (Cloudflare Tunnel, VPS): probado en local por HTTP.
- **Notificaciones del sistema, vibración y pantalla siempre encendida**: dependen del dispositivo; no se han verificado.
- **Rendimiento con volúmenes grandes** (cientos de unidades y miles de avisos): no medido.
