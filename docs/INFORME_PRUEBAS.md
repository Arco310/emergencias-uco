# Informe de pruebas

Fecha de generación: 17/11/2026 21:31 (hora peninsular) · Versión 1.0.2 · compilación final

| Bloque | Pruebas | Superadas | Fallidas |
|---|---:|---:|---:|
| Reglas de negocio, datos y rendimiento del motor (unidad, `node:test`) | 28 | 28 | 0 |
| Servidor de sincronización e integración completa (`node:test`, servidor real) | 14 | 14 | 0 |
| Aceptación en navegador (Chrome + Playwright, móvil y tablet) | 31 | 31 | 0 |
| Particularidades de Chrome para Android (simuladas en el navegador) | 5 | 5 | 0 |
| Comprobaciones de calidad (instalabilidad, accesibilidad, seguridad, HTTPS) | 12 | 12 | 0 |
| Publicación en subcarpeta como en GitHub Pages (local) | 7 | 7 | 0 |
| Plataforma publicada en GitHub Pages (en vivo, por Internet) | 7 | 7 | 0 |
| Mapas y búsqueda de coordenadas en vivo (Google y OpenStreetMap) | 5 | 5 | 0 |
| **Total** | **109** | **109** | **0** |

Todas las pruebas listadas se han **ejecutado realmente** y este informe se genera a partir de sus archivos de resultados (`tests/generar_informe.py`): `tests/resultados-node.tap`, `tests/e2e/resultados.json`, `tests/checks/resultados*.json` y `tests/perf/resultados-*.json`. Capturas en `tests/e2e/capturas/` y `tests/checks/capturas-mapas/`. Además se han medido los tiempos de respuesta (apartado 6).

## 1. Pruebas de unidad (reglas críticas, datos y motor)
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
- ✔ validación perezosa: mismo resultado que con copia completa y sin modificar el estado
- ✔ número asignado por el servidor: actualización directa igual que reconstruir el registro
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
Entorno: Google Chrome (sin interfaz) controlado con Playwright, con la aplicación compilada servida por el servidor de sincronización. Perfiles: **teléfono** 390×844 táctil y **tablet** 1280×800 táctil. En el escenario 2 trabajan a la vez una tablet y un teléfono con almacenamiento independiente.

| Prueba | Resultado | Detalle |
|---|---|---|
| Alta inicial del administrador y clave de recuperación | SUPERADA | clave XGNKV… |
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
| Informes: PDF, JSON y CSV con contenido real | SUPERADA | PDF 7 KB, JSON con 18 operaciones, ZIP con 8 CSV |
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

## 3 bis. Particularidades de Chrome para Android (escenario 3)
Tablet con agente de usuario de Android. Se reproducen en el navegador de pruebas las restricciones de Chrome para Android: `new Notification()` prohibido («Illegal constructor»), la pantalla encendida la libera el sistema al salir de la aplicación y el selector de archivos no reconoce extensiones propias. Las cinco pruebas **fallaban con la versión 1.0.1** (comprobado) y pasan con la actual.

| Prueba | Resultado | Detalle |
|---|---|---|
| Android: «Probar» notificaciones muestra un aviso real | SUPERADA | aviso mostrado por el service worker; el constructor prohibido en Android no se usa |
| Android: botón «Probar» de vibración visible | SUPERADA | botón «Probar» visible con la vibración disponible |
| Android: pantalla encendida se recupera al volver a la aplicación | SUPERADA | tras salir y volver 3 veces la pantalla sigue encendida (3 de 3 recuperaciones) |
| Android: importar copias y paquetes sin archivos en gris | SUPERADA | el selector muestra todos los archivos (sin filtro) y uno erróneo se rechaza: «El archivo no es una copia válida» |
| Android: aviso de fin de descanso | SUPERADA | aviso «Fin del descanso: AND-1 Android uno» mostrado por el service worker |

## 3 ter. Comprobaciones de calidad (`tests/checks/comprobaciones.py`)
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

## 3 quater. Publicación en subcarpeta (`tests/checks/subruta_pages.py`, local)
URL: http://127.0.0.1:8660/emergencias-uco/ · 2026-11-17 21:27

| Comprobación | Resultado | Detalle |
|---|---|---|
| Service worker registrado en la subcarpeta | CORRECTA | ámbito http://127.0.0.1:8660/emergencias-uco/ |
| Service worker controla la página | CORRECTA |  |
| Instalable como aplicación desde la subcarpeta | CORRECTA | sin errores de instalabilidad |
| Manifiesto encontrado y válido | CORRECTA | http://127.0.0.1:8660/emergencias-uco/manifest.webmanifest |
| Abre sin conexión (modo avión) | CORRECTA | pantalla de alta visible sin red |
| Sin errores de JavaScript | CORRECTA |  |
| Alta, preventivo y unidad se guardan y siguen tras recargar | CORRECTA | datos cifrados en el dispositivo; vuelve a la pantalla en uso (Unidades) |

## 3 quinquies. Plataforma publicada (`tests/checks/subruta_pages.py URL`, en vivo)
URL: https://arco310.github.io/emergencias-uco/ · 2026-11-17 21:30 · Chrome a través de Internet; los archivos publicados coinciden byte a byte con `dist/app/`

| Comprobación | Resultado | Detalle |
|---|---|---|
| Service worker registrado en la subcarpeta | CORRECTA | ámbito https://arco310.github.io/emergencias-uco/ |
| Service worker controla la página | CORRECTA |  |
| Instalable como aplicación desde la subcarpeta | CORRECTA | sin errores de instalabilidad |
| Manifiesto encontrado y válido | CORRECTA | https://arco310.github.io/emergencias-uco/manifest.webmanifest |
| Abre sin conexión (modo avión) | CORRECTA | pantalla de alta visible sin red |
| Sin errores de JavaScript | CORRECTA |  |
| Alta, preventivo y unidad se guardan y siguen tras recargar | CORRECTA | datos cifrados en el dispositivo; vuelve a la pantalla en uso (Unidades) |

## 3 sexies. Mapas en vivo (`tests/checks/mapas_en_vivo.py`)
URL: https://arco310.github.io/emergencias-uco/ · 2026-11-17 21:31 · capturas en `tests/checks/capturas-mapas/`

| Comprobación | Resultado | Detalle |
|---|---|---|
| Búsqueda de coordenadas (OpenStreetMap, gratuita) | CORRECTA | Mezquita-Catedral de Córdoba, 1, Calle del Cardenal Herrero, Catedral, Distrito Centro, Có |
| Mapa de Google sin clave dentro de la aplicación | CORRECTA | https://www.google.com/maps/embed?origin=mfe&pb=!1m3!2m1!1s37.879026,-… · 279 elementos, 38 imágenes, 0 lienzos · texto: 'Combinaciones de teclas\nDatos del mapa ©2026 Inst. Geogr. Nacional\nTérminos' |
| Mapa de OpenStreetMap dentro de la aplicación | CORRECTA | mapa vectorial 606x378, marcador visible |
| Lugar del preventivo guardado y mostrado en «Mapa» | CORRECTA | Mezquita-Catedral de Córdoba (37.879026, -4.779453) · enlace https://www.google.com/maps/search/?api=1&query=37.879026%2C-4.779453 |
| Sin errores de JavaScript | CORRECTA |  |

## 4. Correspondencia con las pruebas de aceptación del pliego (sección 25)
| Pliego | Cubierto por |
|---|---|
| Unidades: crear, editar, eliminar/archivar, desactivar, recuperar, cambiar tipo, personalizar | Unidad: «unidades: indicativo único, eliminación…», «personalización…»; navegador: «Unidades: crear», «editar y personalizar» |
| Colores C0: personalizar, cambiar de clave, color principal, borde, regresar, persistencia, bloqueo | Unidad: «color C0…» (2); navegador: «Color C0» (3 pruebas) |
| Avisos: crear, numerar, asignar, finalizar, historial, creación simultánea en varios dispositivos | Unidad: «avisos: flujo completo», «numeración…»; integración y servidor: numeración concurrente; navegador: avisos y «avisos simultáneos sin duplicados» |
| Descansos: iniciar, temporizador, recargar, bloqueo con aviso activo, recuperar estado | Unidad: «descansos…» (2); navegador: 3 pruebas (incluye fin automático real tras 60 s) y aviso de fin de descanso en Android |
| Plantillas: crear, duplicar, modificar, aplicar, preventivos anteriores sin cambios | Unidad: «plantillas…»; navegador: «Plantillas: crear, aplicar y aislamiento» |
| Offline (modo avión) | Navegador: «Funcionamiento sin conexión (modo avión)»; plataforma publicada: «Abre sin conexión (modo avión)» |
| Multidispositivo: compartir, desconectar, continuar, reconectar, sincronizar, conflictos, sin duplicados ni pérdidas | Integración (8 pruebas con servidor real) y navegador (escenario 2) |
| Estadísticas con datos conocidos | Unidad: «estadísticas: tiempos verificados con datos conocidos» (valores exactos minuto a minuto) |
| Informes PDF, JSON y CSV | Unidad: estructura del PDF (comprimido), CSV y reconstrucción desde el JSON; navegador: descarga y contenido de los tres formatos |
| Usuarios: roles, permisos y restricciones | Unidad: «permisos…»; navegador: «Usuarios, roles y permisos» |
| Dispositivos: móvil y tablet Android | Emulación de teléfono y tablet en Chrome y restricciones de Chrome para Android simuladas (escenario 3); ver limitaciones |
| Aplicación fiable y escalable | Apartado 6: preventivos de hasta 300 unidades, 3.000 avisos y 22.928 operaciones |

## 5. No verificado en este entorno (pendiente de prueba en campo)
- **Dispositivos Android físicos**: las pruebas usan Chrome con emulación táctil de teléfono y tablet y con las restricciones de Android simuladas, no terminales reales. Se recomienda una prueba en campo con los modelos que se vayan a usar (instalación como aplicación, modo avión, rotación de pantalla).
- **Avisos, vibración y pantalla encendida en un terminal**: comprobados en Chrome simulando las restricciones de Android. Para confirmarlos en cada terminal: *Sistema → Permisos del dispositivo → «Probar»* en Notificaciones y en Vibración.
- **Mapas en terminales Android reales**: el mapa de Google sin clave, el de OpenStreetMap y la búsqueda de coordenadas se han comprobado en vivo por Internet con Chrome (emulación de tablet), no en un terminal físico. El formato de Google sin clave no es oficial y podría dejar de funcionar; por eso la aplicación ofrece también el mapa de OpenStreetMap y el botón «Abrir en Google Maps». El GPS se ha probado con posición simulada.
- **Servidor de sincronización publicado con HTTPS real** (Cloudflare Tunnel, VPS…): probado en local por HTTP y HTTPS con certificado propio; no hay ningún servidor de sincronización publicado. La aplicación sí está publicada con HTTPS real (GitHub Pages).
- **Rendimiento en terminales reales**: medido con la CPU ralentizada 4 veces como aproximación; un terminal concreto puede ser más rápido o más lento.

## 6. Rendimiento con preventivos grandes (`tests/perf/`)
Preventivos generados con los mismos comandos que usa la aplicación (reglas, validación y numeración incluidas): cada aviso recorre C1 → C2 → C3 (a veces C4 → C5) → C0, con notas, ubicaciones y finalización. Doce horas de servicio.

### 6.1 Motor (Node.js, procesador de servidor)

| Medida | 50 unidades / 300 avisos (2309 operaciones) | 150 unidades / 1500 avisos (11477 operaciones) | 300 unidades / 3000 avisos (22928 operaciones) |
|---|---:|---:|---:|
| Validar una acción (cada pulsación) | 0.1 ms | 0.1 ms | 0.1 ms |
| Reconstruir el preventivo completo (al abrirlo) | 9.4 ms | 21.6 ms | 54.3 ms |
| Recibir el número definitivo del servidor | 0.1 ms | 0.01 ms | 0.02 ms |
| Recibir una operación atrasada de otro dispositivo | 15.2 ms | 8.8 ms | 45.2 ms |
| Estadísticas del preventivo | 9.5 ms | 26.8 ms | 19.5 ms |
| Bitácora completa | 8.6 ms | 9.9 ms | 14.6 ms |
| Informe PDF | 318.1 ms | 1119.4 ms | 1761.7 ms |
| Tamaño del informe PDF | 0.24 MB | 1.14 MB | 2.27 MB |
| Páginas del informe PDF | 88 | 426 | 853 |
| Exportación JSON | 1.15 MB | 5.62 MB | 11.23 MB |
| Exportación CSV (ZIP) | 0.45 MB | 2.24 MB | 4.48 MB |
| Tamaño del registro de operaciones | 0.69 MB | 3.39 MB | 6.76 MB |

### 6.2 Aplicación completa en el navegador, con la CPU ralentizada 4 veces (aproximación a un móvil Android de gama media)
Datos cifrados en IndexedDB e interfaz real; tiempo desde la pulsación hasta que la pantalla está dibujada.

| Medida | 50 unidades / 300 avisos | 300 unidades / 3000 avisos |
|---|---:|---:|
| Abrir el preventivo (iniciar sesión → centro de control) | 504 ms | 2394 ms |
| Pantalla Unidades (todas las tarjetas) | 506 ms | 762 ms |
| Pantalla Avisos | 417 ms | 451 ms |
| Avisos finalizados (primeras 100) | 334 ms | 984 ms |
| «Mostrar más» avisos (+200) | 558 ms | 750 ms |
| Plano táctico | 415 ms | 483 ms |
| Cambiar la clave de una unidad | 106 ms | 82 ms |
| Crear un aviso | 479 ms | 505 ms |
| Estadísticas | 180 ms | 304 ms |
| Bitácora | 250 ms | 285 ms |
| Informe PDF completo | 1050 ms | 8422 ms |
| Tamaño del informe PDF | 0.24 MB | 2.27 MB |
| Memoria JavaScript en uso | 5 MB | 15 MB |
| Espacio ocupado en el dispositivo | 3 MB | 20 MB |

### 6.3 Mejoras aplicadas tras la primera medición (300 unidades, 3.000 avisos, 22.928 operaciones)
| Medida | Antes (1.0.1) | Ahora (1.0.2) | Causa y corrección |
|---|---:|---:|---|
| Validar cada acción (motor) | 48 ms | 0,1 ms | Se copiaba el estado completo en cada pulsación; ahora solo se copian los elementos que toca la acción |
| Abrir el preventivo (reconstrucción, motor) | 1.060 ms | 54 ms | La detección de números de aviso duplicados recorría todos los avisos por cada aviso; ahora usa un índice |
| Número definitivo del servidor (modo compartido) | 864 ms | 0,02 ms | Cada número reconstruía el preventivo completo; ahora se actualiza el aviso directamente (mismo resultado, comprobado por prueba) |
| Operación atrasada de otro dispositivo | 944 ms | 45 ms | Gracias a la reconstrucción más rápida |
| Abrir el preventivo en el navegador (CPU ×4) | 4,6 s | 2,4 s | Además, el descifrado de las operaciones se hace por lotes en paralelo |
| Avisos finalizados en el navegador (CPU ×4) | 2,6 s | 0,4–1,0 s | Se muestran por tandas de 100 con «Mostrar más» |
| Tamaño del informe PDF (853 páginas) | 21 MB | 2,3 MB | El contenido de las páginas se comprime (FlateDecode); validado con qpdf y pdftotext |

## 7. Correcciones derivadas de las comprobaciones
### Versión 1.0.2
- **Avisos de fin de descanso en Android:** Chrome para Android no permite `new Notification()` y el aviso no se mostraba nunca. Ahora lo muestra el service worker; al tocarlo se abre la aplicación. Nuevo botón «Probar» en Notificaciones.
- **Pantalla siempre encendida:** tras salir y volver a la aplicación dos veces, la pantalla dejaba de mantenerse encendida. Ahora se recupera cada vez.
- **Botón «Probar» de vibración:** no aparecía nunca con la vibración disponible. Corregido.
- **Importar copias y paquetes en Android:** el selector podía dejar en gris los archivos `.ucobak` y `.ucosync`. En Android se muestran todos los archivos y se valida el contenido al abrirlo.
- **Errores de validación:** los avisos al usuario (por ejemplo, «El archivo no es una copia válida») ya no se registran como fallos del programa.
- **Rendimiento:** ver apartado 6.3.

### Versión 1.0.1
- **Pantalla tras recargar:** al recargar e iniciar sesión, la aplicación volvía unas veces a la pantalla en uso y otras al Centro de control (dependía de la velocidad del dispositivo). Ahora vuelve siempre a la pantalla en uso.
- **Selector de mapa:** los botones Google Maps / OpenStreetMap se veían enormes y el texto se partía en tres líneas. Corregido el estilo de los botones de opción.
- **OpenStreetMap:** su mapa incrustado usa ahora MapLibre (mapa vectorial) en lugar de teselas; la comprobación admite ambos formatos.

