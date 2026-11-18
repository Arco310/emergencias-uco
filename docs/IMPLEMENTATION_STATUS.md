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
| D2 | Alta del **primer dispositivo** con el **código de administración del servidor** (generado al instalar, guardado en el PC servidor con acceso restringido). Resto de dispositivos: **enlace o código de alta** una sola vez. | El servidor es accesible por Internet: crear el espacio central no puede quedar abierto a cualquiera. |
| D3 | **Detección automática**: si la app se abre desde la dirección del servidor, usa su propio origen; si no, la dirección guardada en el alta. Sin mDNS. | Los navegadores no permiten mDNS; el nombre `*.ts.net` es estable y con HTTPS válido (imprescindible para la PWA). |
| D4 | Configuración general (tipos de recurso, unidades plantilla) como **elementos versionados** con control optimista (409 si otro dispositivo cambió el mismo elemento). | Nunca se sobrescribe en silencio; no exige descifrar en el servidor. |
| D5 | Entorno **CLAUDE_TEST**: base de datos local distinta (`?entorno=pruebas`, banda roja) y espacio central de pruebas aislado en el servidor, borrable solo con el código de administración. | Separación total de datos reales y de pruebas. |
| D6 | Cartografía con **proveedores intercambiables**: OpenStreetMap (sin clave) por defecto y Google Maps Platform oficial cuando se configure una clave. Leaflet 1.9.4 incluido en el proyecto (BSD-2). | Requisito de georreferencia real y de poder cambiar de proveedor; Google exige clave y facturación. |
| D7 | Actualizador del servidor basado en **GitHub Releases** con verificación SHA-256, copia previa de datos, comprobación de salud y vuelta atrás automática. | Requisito 15 sin ZIP manuales. |

## 3. Fases

| Fase | Estado | Notas |
|---|---|---|
| 1. Servidor central automático | En curso | |
| 2. Tipos de recurso, OTROS y unidades plantilla | Pendiente | |
| 3. Cartografía y biblioteca de planos | Pendiente | |
| 4. Plano interactivo de coordinación | Pendiente | |
| 5. Web, PWA y actualizaciones | Pendiente | |
| 6. Validación integral | Pendiente | |

## 4. Bloqueos que requieren intervención humana

| Bloqueo | Estado |
|---|---|
| Clave de Google Maps Platform (requiere facturación) | Preguntado; mientras tanto se usa OpenStreetMap |
| Confirmar que se mantiene el acceso por Internet (Tailscale Funnel) | Preguntado; se mantiene mientras tanto |

## 5. Errores detectados y corregidos (esta evolución)

(Se completa durante el trabajo.)
