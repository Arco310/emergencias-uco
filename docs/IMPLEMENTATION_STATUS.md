# Estado de la implementación — Evolución integral (pliego «Prompt maestro» + apartado 18)

Documento vivo: se actualiza al cerrar cada tarea. Permite retomar el trabajo desde otra sesión.
Última actualización: 18/11/2026.

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
| D6 | Cartografía con **proveedores intercambiables**: OpenStreetMap (sin clave) por defecto y Google Maps Platform oficial cuando se configure una clave. Leaflet 1.9.4 incluido en el proyecto (BSD-2). | Requisito de georreferencia real y de poder cambiar de proveedor; Google exige clave y facturación. |
| D7 | Actualizador del servidor basado en **GitHub Releases** con verificación SHA-256, copia previa de datos, comprobación de salud y vuelta atrás automática. | Requisito 15 sin ZIP manuales. |

## 3. Fases

| Fase | Estado | Notas |
|---|---|---|
| 1. Servidor central automático | Código y pruebas terminados; despliegue pendiente | Servidor 1.1.0 (cuentas, espacio principal, código de pruebas), app 1.1.0 (acceso con usuario y contraseña, alta sin direcciones, preventivos que aparecen solos), instalador (protección de códigos, `MOSTRAR-CODIGO-ADMIN.bat`). 62 pruebas automáticas y 39 de navegador superadas. |
| 2. Tipos de recurso, OTROS y unidades plantilla | Pendiente | |
| 3. Cartografía y biblioteca de planos | Pendiente | |
| 4. Plano interactivo de coordinación | Pendiente | |
| 5. Web, PWA y actualizaciones | Pendiente | |
| 6. Validación integral | Pendiente | |

## 4. Bloqueos que requieren intervención humana

| Bloqueo | Estado |
|---|---|
| Clave de Google Maps Platform (requiere facturación) | Preguntado; mientras tanto se usa OpenStreetMap |
| Confirmar que se mantiene el acceso por Internet (Tailscale Funnel) | **Resuelto**: se mantiene (18/11) |
| Activar el espacio central real (una vez, con el código de administración) | Lo hace el usuario: exige elegir su propia contraseña de administrador; las pruebas usan solo el espacio CLAUDE_TEST |

## 5. Errores detectados y corregidos (esta evolución)

| Error | Causa | Corrección |
|---|---|---|
| La configuración compartida no llegaba al servidor («Elemento no válido») | Los identificadores con «:» viajan codificados en la URL y el servidor no los decodificaba | El servidor decodifica el identificador antes de validarlo |
| Copia automática fallida en dispositivos dados de alta con cuenta | Esos dispositivos no tienen clave de recuperación local y la copia la daba por supuesta | Las copias admiten su ausencia; al restaurar se rehace la vinculación con el servidor central |
| El nombre del dispositivo no se actualizaba en pantalla tras cambiarlo | El núcleo guardaba una copia antigua de los datos del dispositivo | El núcleo lee siempre los datos actuales del repositorio |

## 6. Cuestión estructural detectada (para decidir)

Las instrucciones del proyecto piden que **los permisos y reglas (p. ej. «sin descanso con aviso activo») se comprueben también en el servidor**. Hoy el servidor recibe las operaciones **cifradas de extremo a extremo** y no puede leerlas: las reglas y permisos se comprueban en la capa de negocio de cada dispositivo (no solo ocultando botones) y cada dispositivo vuelve a validar lo que recibe.

Alternativas:
1. **Mantener el cifrado de extremo a extremo** (actual): máxima confidencialidad; un dispositivo comprometido con el secreto del espacio podría enviar operaciones que el servidor no puede rechazar.
2. **Servidor como réplica de confianza**: el PC servidor (propiedad de la organización) conoce la clave del espacio, valida permisos y reglas antes de aceptar cada operación y guarda los datos cifrados en disco. Cumple literalmente el requisito; el servidor pasa a poder leer los datos.
3. **Operaciones firmadas por usuario**: el servidor verifica quién firma y su rol sin leer el contenido; no permite validar reglas que dependen del contenido.

Recomendación: la 2 cuando se quiera la validación en servidor estricta (el servidor es un equipo propio). Requiere autorización por cambiar la arquitectura de seguridad; no se ha aplicado.
