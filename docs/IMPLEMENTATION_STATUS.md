# Estado de la implementación — Evolución integral (pliego «Prompt maestro» + apartado 18)

Documento vivo: se actualiza al cerrar cada tarea. Permite retomar el trabajo desde otra sesión.
Última actualización: 18/11/2026 (versión 1.2.0).

## 1. Auditoría técnica del proyecto existente (versión 1.0.3)

| Área | Situación real comprobada |
|---|---|
| Tecnología | PWA en JavaScript sin framework, empaquetada con esbuild en un único `index.html`. Servidor Node.js 18+ sin dependencias (`server/server.mjs`). |
| Arquitectura | *Offline-first* con **registro de operaciones** (event sourcing) reproducido por `src/core/engine.js`, ordenado por reloj híbrido (HLC). Comandos con permisos en `src/core/commands.js`. |
| Almacenamiento | IndexedDB cifrado (AES-256-GCM; clave de datos envuelta por usuario con PBKDF2). Servidor: `ops.jsonl` por preventivo, con operaciones **cifradas de extremo a extremo** (el servidor no puede leerlas). |
| Autenticación | Usuarios y roles **locales de cada dispositivo** (administrador, operador, consulta + roles propios); 28 permisos comprobados en la capa de comandos. |
| Sincronización | Por preventivo: secreto propio → clave AES y token (HKDF). Código de incorporación `UCO1.` con el servidor dentro. El servidor numera los avisos. Conflictos por campo, sin «última escritura gana». Alternativa por archivo `.ucosync`. |
| Preventivos | Crear/duplicar/plantilla, modalidad independiente o compartida. **Al crear uno compartido se pide el servidor** (limitación nº 1). |
| Unidades | Catálogo de tipos de recurso **dentro de cada preventivo** (copiado al crearlo). No hay tipos globales compartidos ni unidades plantilla (limitaciones nº 2 y 3). |
| Avisos | Numeración correlativa, asignación, estados, historial, ubicación (texto + coordenadas). Sin zonas (limitación nº 4). |
| Claves | C0–C6 y CESP con transiciones y colores; regla de color C0 personalizado probada. |
| Planos | Plano táctico de **imagen** con posiciones normalizadas y arrastre; mapa por enlace/incrustado de Google sin clave y OpenStreetMap. Sin plano georreferenciado interactivo (limitación nº 5). |
| Bitácora/auditoría | Bitácora por preventivo (de las operaciones) y auditoría local por dispositivo. |
| Offline | Service worker con caché de la aplicación; datos locales; reintentos de sincronización. |
| Despliegue | App en GitHub Pages; servidor en DESKTOP-G5S6CH9 (Windows 10) como tarea programada, publicado con HTTPS por Tailscale Funnel en `https://desktop-g5s6ch9.tailb6d0d2.ts.net/`. **Sin actualizador del servidor** (limitación nº 6). |
| Pruebas | 116 comprobaciones automáticas (unidad, servidor, integración, navegador, Android simulado, calidad, en vivo, rendimiento). |

## 2. Decisiones técnicas

| Nº | Decisión | Motivo |
|---|---|---|
| D1 | **Espacio central** (organización) en el servidor: un secreto de organización (HKDF → clave AES + token) que conocen solo los dispositivos dados de alta. El registro de preventivos y la configuración general viajan cifrados con esa clave. | Cumple «configurar una vez» y «comparten información» sin renunciar al cifrado de extremo a extremo ni sustituir la sincronización existente. |
| D2 | **Activación única** del espacio central con el **código de administración del servidor** (generado al instalar, en `datos\_servidor`, con acceso solo para el sistema y los administradores; se consulta con `MOSTRAR-CODIGO-ADMIN.bat`). El espacio real queda fijado como principal: cambiarlo exige intervenir en el propio servidor. | El servidor es accesible por Internet: nadie puede apropiarse del espacio. |
| D2b | **Cuentas comunes** (petición del 18/11): un dispositivo nuevo solo necesita **usuario y contraseña**. De la contraseña (PBKDF2-SHA256, 600.000 iteraciones) salen una prueba de acceso, de la que el servidor guarda solo el hash, y una clave que envuelve el secreto del espacio. El servidor nunca ve la contraseña ni los datos. Límite de 8 fallos por cuenta y 200 globales cada 15 min; sal señuelo estable para cuentas inexistentes. Contraseñas de 8 caracteres como mínimo. Usuarios y roles se comparten como elementos de configuración versionados; cambiar la contraseña invalida la clave local de los demás dispositivos; desactivar un usuario retira su cuenta del servidor y cierra su sesión. | El usuario abre la app, inicia sesión, crea un preventivo y trabaja, sin direcciones ni códigos, manteniendo HTTPS, autenticación y cifrado de extremo a extremo. |
| D3 | **Servidor preconfigurado** en la app (`src/config/servidor.js`: `https://desktop-g5s6ch9.tailb6d0d2.ts.net`, no es un secreto). Si la app se abre desde el propio servidor, se usa ese origen. Fuera del navegador no hay servidor por defecto (las pruebas nunca tocan el real). | Petición expresa del 18/11: nunca preguntar direcciones. Los navegadores no permiten mDNS; el nombre `*.ts.net` es estable y con HTTPS válido. |
| D3b | **Tailscale Funnel se mantiene** (confirmado por el usuario el 18/11): acceso por HTTPS desde cualquier red, incluidos datos móviles, sin instalar nada en los dispositivos. | Decisión del usuario. |
| D4 | Configuración general (tipos de recurso, unidades plantilla) como **elementos versionados** con control optimista (409 si otro dispositivo cambió el mismo elemento). | Nunca se sobrescribe en silencio; no exige descifrar en el servidor. |
| D5 | Entorno **CLAUDE_TEST**: base de datos local distinta (`?entorno=pruebas`, banda roja permanente), espacio central de pruebas aislado (el entorno de pruebas no ve el espacio real ni al revés) y **código propio de pruebas** (`codigo-pruebas.txt`) que solo crea y borra espacios de pruebas; nunca el real. | Separación total de identidades, credenciales y datos reales y de pruebas (§18). |
| D6 | Cartografía con **proveedores intercambiables**: OpenStreetMap (sin clave) por defecto y Google Maps Platform oficial (Map Tiles API con sesión y atribución, Places API (New) para buscar) cuando se configura una clave en Configuración general → Cartografía. La clave se guarda cifrada como elemento de la configuración común. Teselas OSM vistas guardadas para uso sin conexión (máx. 3000, sin descargas masivas). | Requisito de georreferencia real y de poder cambiar de proveedor; Google exige clave y facturación. |
| D6b | **Leaflet 1.9.4** (BSD-2, 40 KB) incluido en el paquete, sin CDN. Coordenadas: posiciones WGS84 en planos cartográficos (EPSG:3857) y relativas en planos de imagen. | Única dependencia nueva: un mapa interactivo táctil (arrastrar, zonas, capas) sin escribirlo desde cero; licencia permisiva; funciona sin conexión. |
| D7 | **Actualizador del servidor** (`server/actualizador.mjs` + `server/lanzador.mjs`): consulta las versiones publicadas del repositorio oficial (GitHub Releases); verifica el paquete con el SHA-256 calculado por GitHub y con `SHA256SUMS.txt`, comprueba su estructura y su versión, y lo **prueba arrancándolo con una copia de los datos**. Solo se instala cuando un administrador lo decide (ahora o en la **ventana segura**: 30 min sin escrituras en ningún preventivo). Antes: copia de los datos (se guardan 5) y del código anterior. El lanzador reinicia con la versión nueva y la vigila durante un **periodo de prueba**; si no responde con la versión esperada vuelve sola a la anterior. Durante el reinicio las escrituras reciben 503 y los dispositivos reintentan. | Requisito 15 sin ZIP manuales ni intervención en el PC. |
| D7b | Acciones de actualización: consultar el estado es para cualquier dispositivo del espacio; **actuar exige el permiso «Gestionar las actualizaciones» en la app y el código de administración del servidor** (el servidor no puede leer los roles, que van cifrados de extremo a extremo). Cada acción queda en la auditoría local y en `despliegues.log` del servidor (acción, usuario, dispositivo). | Mínimo privilegio y comprobación en el servidor. |
| D8 | **Ciclo de actualización de la app** (service worker): una caché por versión, sin mezclar archivos; integridad SHA-256 de `index.html` fijada al compilar (si no coincide, la versión no se instala); la versión nueva espera y se aplica sola solo sin sesión abierta o al arrancar; con sesión, aviso y el usuario elige el momento (antes se envían los cambios pendientes; la pantalla y el preventivo se recuperan). Se guarda la versión anterior; **pantalla de recuperación** si una versión no arranca. | Requisitos 8.2, 8.3 y 15.3: nunca interrumpir una operación ni perder cambios. |
| D9 | **Migraciones de datos locales** (`src/data/migraciones.js`): copia de seguridad cifrada previa (se guardan 5), migraciones idempotentes y compatibles hacia atrás, el esquema solo avanza si terminan bien. | Requisito 8.3 (migraciones) y 15.6 (copias previas). |
| D10 | **Versión mínima de la app** que admite el servidor (`/api/v1/version`): si la app es anterior, deja de sincronizar con ese servidor (los cambios se guardan y se envían al actualizar) y lo avisa. | Compatibilidad entre versiones sin corromper datos. |
| D11 | Publicación con `tools/publicar-version.mjs`: comprueba que app y servidor tienen la misma versión, compila, verifica el paquete y publica la versión en GitHub (sobre el commit ya subido) y la app en GitHub Pages. Notas en `docs/CAMBIOS.md`. | Proceso repetible y verificable. |

## 3. Fases

| Fase | Estado | Notas |
|---|---|---|
| 1. Servidor central automático | Terminada; **instalación en el PC servidor pendiente de la aprobación UAC** | Cuentas comunes, espacio principal, código de pruebas, servidor preconfigurado, preventivos que aparecen solos, instalador con copia y vuelta atrás. |
| 2. Tipos de recurso, OTROS y unidades plantilla | Terminada | Tipos generales compartidos y persistentes, sector OTROS con nombre libre, unidades plantilla UPR/SVB/VIRES configurables (solo piden el número). |
| 3. Cartografía y biblioteca de planos | Terminada (Google sin probar con clave real) | Buscador, selección de zona, plano georreferenciado, biblioteca Bernabéu/Metropolitano/Sol + guardados, clave de Google en Configuración general. |
| 4. Plano interactivo de coordinación | Terminada | Arrastre (también desde pendientes), doble clic/pulsación larga para la clave, avisos por punto o zona, sincronización y bitácora. |
| 5. Web, PWA y actualizaciones | Terminada | App (D8–D10) y servidor (D7, D7b, D11); panel Sistema → Actualizaciones. Versión 1.2.0. |
| 6. Validación integral | Terminada en el entorno de pruebas | Los 25 escenarios de aceptación con pruebas automáticas (ver `docs/TESTING_REPORT.md`). Pendiente la prueba en vivo con el servidor real cuando esté instalada la 1.2.0. |

## 4. Bloqueos que requieren intervención humana

| Bloqueo | Estado |
|---|---|
| Clave de Google Maps Platform (requiere facturación) | Pendiente del usuario; mientras tanto, OpenStreetMap. Se configura en Configuración general → Cartografía (restringirla por dominio en Google Cloud). |
| Confirmar que se mantiene el acceso por Internet (Tailscale Funnel) | **Resuelto**: se mantiene (18/11) |
| **Instalar la 1.2.0 en el PC servidor** (una sola vez) | El instalador necesita permisos de administrador (UAC). La pantalla segura de UAC no se puede manejar a distancia: el usuario debe aprobarla en el PC. Desde esa instalación, las siguientes versiones se instalan desde la app. El servidor sigue en la 1.0.3 y funcionando. |
| Activar el espacio central real (una vez, con el código de administración) | Lo hace el usuario: exige elegir su propia contraseña de administrador; las pruebas usan solo el espacio CLAUDE_TEST |

## 5. Errores detectados y corregidos (esta evolución)

| Error | Causa | Corrección |
|---|---|---|
| La configuración compartida no llegaba al servidor («Elemento no válido») | Los identificadores con «:» viajan codificados en la URL y el servidor no los decodificaba | El servidor decodifica el identificador antes de validarlo |
| Copia automática fallida en dispositivos dados de alta con cuenta | Esos dispositivos no tienen clave de recuperación local y la copia la daba por supuesta | Las copias admiten su ausencia; al restaurar se rehace la vinculación con el servidor central |
| El nombre del dispositivo no se actualizaba en pantalla tras cambiarlo | El núcleo guardaba una copia antigua de los datos del dispositivo | El núcleo lee siempre los datos actuales del repositorio |
| Plantillas creadas durante una sincronización central desaparecían | Carrera: la sincronización guardaba una copia de los datos leída antes del cambio | Mutex `_conDatos` para todas las escrituras centrales y fusión paso a paso; prueba de regresión |
| Campos ocultos visibles en formularios | El estilo `.fld` anulaba el atributo `hidden` | `[hidden]{display:none!important}` |
| El formulario de unidad no mostraba el tipo recién creado | Solo se repintaban las hojas «vivas» | Se reabre el formulario con lo ya escrito |
| Posiciones fuera del plano tras cambiar de plano | Se usaban coordenadas geográficas fuera de los límites | Se usan solo si caen dentro; si no, la posición relativa |
| **El mapa tapaba las hojas abiertas encima** (p. ej. la biblioteca de planos): no se podía pulsar «Abrir» | Las capas de Leaflet (z-index 400–1000) competían con las hojas | El contenedor del mapa crea su propio contexto de apilamiento; prueba de navegador que lo comprueba |
| **Repintados por eventos borraban lo escrito** (p. ej. el alta inicial mientras llegaba el estado del servidor) | Se reconstruía la pantalla sin conservar los campos | Los repintados por eventos conservan lo que el usuario ha escrito; el gestor de actualizaciones solo repinta si cambia algo visible |
| La prueba de una versión del servidor heredaba el entorno del lanzador | `spawn` sin entorno propio: la instancia de prueba se creía la real | Entorno aislado (sin `UCO_LANZADOR` ni la ruta de la instalación) y sin comprobaciones periódicas |
| Tras volver a la versión anterior del servidor, el panel mostraba la versión retirada | El lanzador no actualizaba la versión instalada | Se lee la versión de la copia restaurada y se anota en el historial |
| No había copia de los datos antes de activar una versión desde el actualizador | Solo el instalador la hacía | Copia de datos antes de activar o revertir (se guardan 5); si falla, no se activa |

## 6. Cuestión estructural detectada (para decidir)

Las instrucciones del proyecto piden que **los permisos y reglas (p. ej. «sin descanso con aviso activo») se comprueben también en el servidor**. Hoy el servidor recibe las operaciones **cifradas de extremo a extremo** y no puede leerlas: las reglas y permisos se comprueban en la capa de negocio de cada dispositivo (no solo ocultando botones) y cada dispositivo vuelve a validar lo que recibe.

Alternativas:
1. **Mantener el cifrado de extremo a extremo** (actual): máxima confidencialidad; un dispositivo comprometido con el secreto del espacio podría enviar operaciones que el servidor no puede rechazar.
2. **Servidor como réplica de confianza**: el PC servidor (propiedad de la organización) conoce la clave del espacio, valida permisos y reglas antes de aceptar cada operación y guarda los datos cifrados en disco. Cumple literalmente el requisito; el servidor pasa a poder leer los datos.
3. **Operaciones firmadas por usuario**: el servidor verifica quién firma y su rol sin leer el contenido; no permite validar reglas que dependen del contenido.

Recomendación: la 2 cuando se quiera la validación en servidor estricta (el servidor es un equipo propio). Requiere autorización por cambiar la arquitectura de seguridad; no se ha aplicado.

## 7. Pendiente y limitaciones conocidas

- **Instalar la 1.2.0 en el PC servidor** (UAC, ver §4) y, después, la prueba en vivo con el entorno CLAUDE_TEST contra el servidor real.
- Google Maps Platform no se ha probado con una clave real (no hay clave); el código sigue la documentación oficial (sesión de Map Tiles API, atribución, Places API (New)).
- Pruebas en dispositivos físicos: las de navegador emulan móvil, tablet y Chrome para Android; falta probar en un Android real.
- Firma de las versiones con clave propia (además de HTTPS, repositorio oficial y SHA-256): mejora opcional; exige custodiar una clave privada.
- Cuestión estructural del §6 (validación en el servidor de operaciones cifradas): pendiente de decisión.

