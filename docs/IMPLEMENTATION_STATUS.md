# Estado de la implementación y seguimiento

Documento vivo (apartado 18.10): se actualiza al cerrar cada tarea y permite retomar el trabajo desde otra sesión.
Cubre los textos del proyecto:
- «Prompt maestro» (1.0);
- «Evolución integral» y apartado 18 (1.1.0–1.3.0);
- códigos de incidente de SAMUR-PC (1.3.0);
- «Mejora funcional y técnica» (1.4.0);
- «Ampliación de funcionalidades» (1.5.0).

**Última actualización:** 25/11/2026.
- Versión en desarrollo: **1.5.0**, en la rama `mejora-1.5.0`. Incluye la 1.4.0. Está subida a GitHub y **sin publicar**.
- En producción (GitHub Pages y PC servidor): **1.3.0**.
- Informes de entrega: `INFORME_FINAL.md` (1.0.3 → 1.3.0), `INFORME-1.4.0.md` e `INFORME-1.5.0.md`. Pruebas: `TESTING_REPORT.md`.

## 1. Auditoría técnica del proyecto de partida (versión 1.0.3)

Es el punto de partida de la evolución. La situación actual está en la documentación técnica y en los apartados siguientes.

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
| D12 | **Códigos de incidente como tipos de aviso** (1.3.0, petición del 19/11): cada código de SAMUR-PC es un elemento del catálogo «Tipos de aviso» con `codigo`, `grupo` (carpeta) y, en los códigos de cierre, `padre`; identificadores estables (`inc_1_2`). Se elige por carpetas y al tocar el código se crea el aviso. Los preventivos ya creados reciben los códigos con un botón explícito («Añadir los códigos de incidente»), no con una migración automática ni código a código al usarlos: cambiar el catálogo de un preventivo compartido desde varios dispositivos a la vez generaría conflictos. Los nombres se muestran con el código en todas partes y, si un catálogo no tuviera un código, se resuelve con el catálogo por defecto. Tipos de unidad y unidades plantilla de SAMUR-PC añadidos a los valores por defecto; la migración de datos 3 los añade (solo lo que falta) a los dispositivos en uso. | Los avisos siguen guardando un identificador de tipo (motor, estadísticas, compatibilidades e informes no cambian) y la versión anterior sigue pudiendo leer los datos. |
| D13 | **Modo servidor opcional** (1.4.0, decisión del 24/11: «que el servidor lea los datos»). El servidor custodia las claves del espacio y valida identidad, acceso al preventivo, permisos y reglas de cada operación; lo rechazado no se guarda y el dispositivo lo deshace. Un espacio que no se migra funciona como en la 1.3.0. | Resuelve la cuestión estructural del §6 (validación en el servidor). |
| D14 | **Cuentas sin contraseña: código de un solo uso (72 h) + PIN del dispositivo** (1.4.0, decisión del 24/11). Registro desde el inicio de sesión con prueba de trabajo y aprobación. | Sin correo electrónico disponible; seguro y verificable en el servidor. |
| D15 | **Permisos por módulos** (consulta y modificación), perfiles reutilizables, ajustes individuales y alcance por preventivo; implicaciones en cadena (1.5.0). | Requisito de permisos granulares sin roles rígidos. |
| D16 | **Mapas IGN sin clave** (ortofoto PNOA y topográfico) además de OpenStreetMap; Google solo con clave (1.4.0, decisión del 24/11). | Satélite y relieve gratis; sin gastos externos. |
| D17 | **Avisos sin campo de prioridad** (1.5.0, decisión del 25/11). Los tipos siguen siendo los códigos de incidente. | Decisión del usuario. |
| D18 | **Horas verificables:** el servidor devuelve la hora de recepción (`rx`) y cada dispositivo guarda la de sincronización (`sy`), fuera del contenido cifrado (1.5.0). | El informe distingue la hora declarada, la recibida y la sincronizada. |
| D19 | **Informes con versiones y huella SHA-256**, registro de quién genera, consulta o exporta (`informe.reg`), y Excel propio sin librerías (1.5.0). | Informe verificable y conservación de versiones. |
| D20 | **Incoherencias que solo detectan y proponen** (21 reglas, 4 niveles ajustables); nunca cambian datos (1.5.0). | Requisito: las decisiones operativas son del usuario autorizado. |
| D21 | **Accesibilidad y seguridad con referencias verificables** (WCAG 2.2 AA y OWASP ASVS 5.0.0). No se declara conformidad completa sin la revisión con lectores de pantalla. | Requisito del encargo 1.5.0. |
| D22 | **Sin despliegue sin autorización:** las versiones 1.4.0 y 1.5.0 quedan preparadas en sus ramas, subidas y sin publicar (decisión del 25/11). | Decisión del usuario. |
| D11 | Publicación con `tools/publicar-version.mjs`: comprueba que app y servidor tienen la misma versión, compila, verifica el paquete y publica la versión en GitHub (sobre el commit ya subido) y la app en GitHub Pages. Notas en `docs/CAMBIOS.md`. La versión en GitHub Releases la lanza una persona desde GitHub (Actions → «Publicar versión»), que ejecuta las pruebas y la misma herramienta. | Proceso repetible y verificable; esta sesión no puede crear versiones en GitHub (restricción de la plataforma), y es razonable que publicar quede en manos de una persona. |

## 3. Fases

| Fase | Estado | Notas |
|---|---|---|
| 1. Servidor central automático | Terminada e **instalada en el PC servidor** (1.2.1 con el lanzador, 18/11 17:52) | Cuentas comunes, espacio principal, código de pruebas, servidor preconfigurado, preventivos que aparecen solos, instalador con copia y vuelta atrás. |
| 2. Tipos de recurso, OTROS y unidades plantilla | Terminada | Tipos generales compartidos y persistentes, sector OTROS con nombre libre, unidades plantilla UPR/SVB/VIRES configurables (solo piden el número). |
| 3. Cartografía y biblioteca de planos | Terminada (Google sin probar con clave real) | Buscador, selección de zona, plano georreferenciado, biblioteca Bernabéu/Metropolitano/Sol + guardados, clave de Google en Configuración general. |
| 4. Plano interactivo de coordinación | Terminada | Arrastre (también desde pendientes), doble clic/pulsación larga para la clave, avisos por punto o zona, sincronización y bitácora. |
| 5. Web, PWA y actualizaciones | Terminada | App (D8–D10) y servidor (D7, D7b, D11); panel Sistema → Actualizaciones. Versión 1.2.1 en GitHub Pages y en el servidor. |
| 1.3.0. Códigos de incidente, unidades SAMUR-PC, cronología conjunta y finalizar | Terminada (D12) | Nuevo aviso por carpetas → código; 16 tipos y plantillas SAMUR-PC; cronología «Todas las unidades»; «Finalizar preventivo e informes». Pruebas en `tests/unit/incidentes_samur.test.mjs` y escenario 7 de navegador. |
| 6. Validación integral | Terminada | Los 25 escenarios de aceptación con pruebas automáticas y la prueba en vivo con el servidor real en el entorno CLAUDE_TEST: 10/10 (ver `docs/TESTING_REPORT.md`). |
| 1.4.0. Recursos, tipo de mapa, cuentas y permisos | Terminada, **sin publicar** | Eliminar configuraciones base con referencias, tipos inactivos rechazados también en el servidor, tipo de mapa por preventivo, registro, cuentas sin contraseña, permisos granulares y modo servidor. 149/149 y 104/104 (`INFORME-1.4.0.md`). |
| 1.5.0. Mapas, avisos, incoherencias, plantillas, informes y monitorización | Terminada, **sin publicar** | Las 7 partes del encargo y los 47 criterios de aceptación (`INFORME-1.5.0.md`). |
| Revisión final contra los 6 textos (25/11) | Terminada | Se completó lo que faltaba (§7 de `INFORME-1.5.0.md`): documentación general, pruebas en móvil, tablet, escritorio y tema oscuro con auditoría automática de accesibilidad, ficha del aviso en el mapa con historial y acciones, consulta de versiones al arrancar el servidor y la comprobación de calidad que dejó de funcionar en la 1.3.0. |

## 4. Bloqueos que requieren intervención humana

| Bloqueo | Estado |
|---|---|
| Clave de Google Maps Platform (requiere facturación) | Pendiente del usuario; mientras tanto, OpenStreetMap. Se configura en Configuración general → Cartografía (restringirla por dominio en Google Cloud). |
| Confirmar que se mantiene el acceso por Internet (Tailscale Funnel) | **Resuelto**: se mantiene (18/11) |
| **Publicar la versión 1.2.1 en GitHub Releases** | Esta sesión no tiene permiso para crear versiones en GitHub (respuesta 403 de la plataforma). Se lanza desde GitHub → Actions → «Publicar versión» → Run workflow → `1.2.1`. La aplicación 1.2.1 ya está publicada en GitHub Pages. |
| Instalar el servidor con el lanzador en el PC servidor (una sola vez) | **Resuelto** (18/11 17:52): 1.2.1 instalada con el instalador; el aviso de permisos de Windows (UAC) se aprobó en el PC. Las siguientes versiones se instalan desde la app. |
| Activar el espacio central real (una vez, con el código de administración) | **Resuelto**: activado por el usuario (comprobado el 19/11 en `/api/v1/central`). |
| Instalar la 1.3.0 en el PC servidor | **Resuelto** (19/11 11:49): instalador ejecutado en el PC (el 19/11 de madrugada la pantalla estaba bloqueada). `/api/v1/version`: 1.3.0, `archivos: ok`; prueba en vivo 10/10. |
| **Publicar la 1.4.0 y la 1.5.0** (fusionar en `main`, «Publicar versión», instalar en el servidor) | **Pendiente de tu autorización** (decisión del 25/11: no desplegar). Pasos en `INFORME-1.5.0.md` §10. |
| **Primera versión en GitHub Releases** | Ninguna publicada todavía: el workflow «Publicar versión» no se ha ejecutado nunca. Hasta entonces, la actualización del servidor desde GitHub real no se ha podido probar (sí con una API local con el mismo formato). |
| Pasar el espacio real al modo servidor | Decisión del administrador después de publicar la 1.4.0 o posterior (*Sistema → Servidor central*). |
| Revisión con lectores de pantalla (TalkBack, NVDA) y prueba en un Android físico | Requieren una persona y el dispositivo: no se pueden automatizar aquí. |

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
| **En el PC real, el servidor no podía leer su código de administración** («Error interno» al activar el espacio central) y la 1.2.0 se habría detenido en el siguiente reinicio | El instalador aplicaba los permisos con herencia archivo por archivo (`icacls … /T`): los archivos que ya existían quedaron sin permisos para nadie | Reparado en el PC (propiedad para Administradores, permisos en la carpeta y herencia restablecida; comprobado con `icacls`). En la 1.2.1 el instalador lo hace así y repara instalaciones afectadas antes de nada; el servidor ya no se detiene si no puede leerlos y lo indica en `/api/v1/version` (`archivos`) |
| «No se pudo descargar …/releases/latest (404)» en el panel | Sin versiones publicadas GitHub responde 404 | Se muestra «Aún no hay versiones publicadas» |
| La lista de dispositivos mostraba «Dispositivo» para un dispositivo recién dado de alta | El primer latido salía antes de guardar el nombre y no se repetía hasta pasado un minuto | El latido se repite en cuanto cambian el nombre o la versión |
| La prueba en vivo daba por fallido el servidor 1.2.1 | Comprobaba versiones escritas a mano (1.2.0) | Lee las versiones esperadas del código del repositorio; comprueba también `archivos` y la consulta a GitHub |
| Fallo intermitente de las pruebas de navegador al dar de alta un dispositivo (escenario 6 en una ejecución completa; antes, una vez el 3) | La pantalla de acceso se repinta por un evento poco después de cargar (registrado: hasta ~2 s); la aplicación conserva lo escrito, pero el valor que Playwright escribe de golpe puede caer en el campo que se está sustituyendo. No afecta a quien teclea | Las pruebas comprueban que cada campo conserva su valor y lo vuelven a escribir si hace falta (`rellenar` en `tests/e2e/run_e2e.py`) |
| 1.4.0: los tipos iniciales eliminados reaparecían al arrancar y los inactivos se seguían ofreciendo | `anadirQueFaltan` y selectores sin criterio común | Lista de eliminados respetada por la inicialización y criterio único en `recursos.js`; el servidor rechaza tipos inactivos |
| 1.4.0: el repintado desmarcaba casillas, el `pattern` del usuario era inválido, el editor de perfiles borraba el nombre y `syncNow` volvía antes de terminar | Repintados y validaciones del navegador | Corregidos con su prueba (`INFORME-1.4.0.md` §2) |
| 1.5.0: notas y motivos de los diálogos guardados como «[object Object]» (desde la 1.0.0, **también en producción**) | El campo del diálogo contaba como formulario con varios campos | Corregido; prueba de regresión en el escenario 14. Los textos ya guardados así no se pueden recuperar |
| 1.5.0: respuestas dobles en el modo servidor; permisos incluidos de un solo nivel; aviso de «cambios» por archivar; módulo de monitorización ausente del paquete de Windows | Ver `INFORME-1.5.0.md` §2 | Corregidos con su prueba |
| Revisión final: etiquetas de colores con poco contraste (2,2:1 en la barra superior; hasta 2,4:1 en el tema oscuro), botones principales y cifras del panel ilegibles en el tema oscuro, y texto sobre colores intermedios en 4,35:1 | El texto de las etiquetas llevaba el 75 % del color; el tema oscuro no tenía colores de estado propios; el texto oscuro era #111 en lugar de negro | Mezcla al 50 %, colores de estado y del panel para el tema oscuro, y texto negro puro (siempre ≥ 4,58:1). Pruebas `accesibilidad.test.mjs` y escenario 17 |
| Revisión final: a 320 px, el estado del sistema mostraba sus valores letra a letra (y partía palabras a 390 px) | Listas de datos (`dl.kv`) con la etiqueta a su ancho máximo y el valor en el resto | Etiqueta encima del valor por debajo de 480 px. Se vio en las capturas y la auditoría comprueba ahora las palabras partidas |
| Revisión final: `tests/checks/comprobaciones.py` fallaba desde la 1.3.0 | El aviso empieza por el código de incidente y el script no abría el formulario completo | Corregido: 12/12 comprobaciones |
| Revisión final: tras instalar una versión nueva, el servidor mostraba la consulta de versiones de la anterior hasta 6 h después | La comprobación periódica partía de la hora de la última consulta | Consulta una vez al arrancar una versión distinta de la que hizo la última consulta (`actualizador_arranque.test.mjs`) |

## 6. Cuestión estructural detectada (resuelta en la 1.4.0)

Las instrucciones del proyecto piden que **los permisos y reglas (p. ej. «sin descanso con aviso activo») se comprueben también en el servidor**. Hoy el servidor recibe las operaciones **cifradas de extremo a extremo** y no puede leerlas: las reglas y permisos se comprueban en la capa de negocio de cada dispositivo (no solo ocultando botones) y cada dispositivo vuelve a validar lo que recibe.

Alternativas:
1. **Mantener el cifrado de extremo a extremo** (actual): máxima confidencialidad; un dispositivo comprometido con el secreto del espacio podría enviar operaciones que el servidor no puede rechazar.
2. **Servidor como réplica de confianza**: el PC servidor (propiedad de la organización) conoce la clave del espacio, valida permisos y reglas antes de aceptar cada operación y guarda los datos cifrados en disco. Cumple literalmente el requisito; el servidor pasa a poder leer los datos.
3. **Operaciones firmadas por usuario**: el servidor verifica quién firma y su rol sin leer el contenido; no permite validar reglas que dependen del contenido.

Recomendación: la 2 cuando se quiera la validación en servidor estricta (el servidor es un equipo propio). Requiere autorización por cambiar la arquitectura de seguridad; no se ha aplicado.

**Resuelta en la 1.4.0** (decisión del 24/11): alternativa 2 como **modo servidor opcional** (D13). El espacio real sigue en el modo anterior hasta que un administrador lo pase al modo servidor después de publicar.

## 7. Pendiente y limitaciones conocidas
**Necesita tu autorización o una persona:**
- Publicar la 1.4.0 y la 1.5.0 (§4). El servidor 1.5.0 exige apps 1.5.0 para sincronizar; las apps se actualizan solas al abrirse.
- Primera versión en GitHub Releases. Con ella se probará de verdad la actualización del servidor desde GitHub.
- Clave de Google Maps Platform (opcional, con facturación).
- Revisión con lectores de pantalla y prueba en un Android físico.

**Limitaciones conocidas** (detalle en `INFORME-1.5.0.md` §9):
- En el modo anterior, el estado del sistema no puede mostrar conflictos ni incoherencias de los preventivos.
- Plantillas de preventivo por dispositivo (se exportan e importan).
- El PDF de cada versión del informe queda en el dispositivo que la generó; los demás ven su registro y su huella.
- Dos versiones del informe generadas a la vez sin conexión pueden llevar el mismo número; se distinguen por hora, autor, dispositivo y huella.

**Mejoras opcionales propuestas:**
- Firma de las versiones con clave propia (además de HTTPS, repositorio oficial y SHA-256). Exige custodiar una clave privada.
- Plantillas de preventivo compartidas a través del servidor central.
