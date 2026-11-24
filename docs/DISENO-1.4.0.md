# Diseño 1.4.0 — Servidor que valida, usuarios y permisos

Decisiones del usuario (24/11/2026): mapas IGN gratuitos; cuentas sin contraseña con **código de un solo uso + PIN del dispositivo**; **el servidor lee los datos** para validar (se pierde el cifrado de extremo a extremo del espacio central).

## 1. Custodia de claves (cómo el servidor «lee los datos»)

- Hasta la 1.3.0 el servidor no conoce la clave del espacio (`org secret`) ni la de cada preventivo compartido: guarda todo cifrado.
- 1.4.0: el servidor **custodia** esas claves en `datos/_servidor/claves/<org>.json` (carpeta restringida por el instalador a administradores y SYSTEM). Con ellas descifra en memoria para validar y servir.
- Los datos **siguen cifrados en disco** (operaciones con la clave del preventivo, configuración con la del espacio). Protege copias de la carpeta de datos que no incluyan `_servidor`; no protege si alguien controla el PC.
- **Migración sin re-subir datos**: un administrador (app 1.4.0) entrega la clave del espacio al servidor con el código de administración del servidor. El servidor descifra el registro de preventivos (obtiene sus claves), los perfiles `usr:*` y `roles`, y enlaza las cuentas existentes (mismas contraseñas). El espacio pasa a `modo: 'servidor'`. Copia de seguridad previa obligatoria.
- Preventivos independientes y preventivos compartidos por código fuera del espacio central: **sin cambios** (siguen cifrados de extremo a extremo).

## 2. Identidad y sesiones

- Directorio de usuarios en el servidor (`usuarios.json` del espacio): `id, usuario, nombre, estado, metodo ('password'|'pin'), perfil, ajustes {mas, menos}, alcance {todos | preventivos {pid: perfil|null}}, pw {salt, iter, verif}, dispositivos {dev: {credHash, nombre, ...}}, codigo {hash, tipo, exp}, sver`.
- Estados: `pendiente` (registro propio), `activo`, `suspendido`, `desactivado`, `rechazado`, `invitado` (código pendiente) y «activación caducada» (invitado con código vencido; se calcula).
- Sesiones por usuario y dispositivo: token aleatorio (el servidor guarda su hash), 90 días desde el último uso, revocables. Toda petición de un espacio en modo servidor exige sesión salvo: salud, versión, central, `acceso/sal`, `acceso`, `registro`, `activacion`, `acceso/dispositivo`.
- El servidor sigue escribiendo los elementos `usr:*` y `roles` del espacio (cifrados con la clave del espacio): los dispositivos los reciben por el mismo camino que antes (caché para entrar sin conexión). Los dispositivos ya no pueden escribirlos.

### Contraseña
- Igual que hasta ahora: el dispositivo deriva una prueba (PBKDF2 600.000) y el servidor compara su hash. Nunca recibe la contraseña. Límite de intentos por cuenta y global.
- Restablecer: el administrador genera un código de un solo uso (caduca); el usuario fija una contraseña nueva con él.

### Sin contraseña: código + PIN
- Alta por el administrador → código de activación de un solo uso (10 caracteres, caduca en 72 h, el servidor guarda su hash).
- Activación en un dispositivo: usuario + código + PIN nuevo (6–12 cifras). El dispositivo crea una credencial aleatoria; el servidor guarda su hash ligado a ese dispositivo y entrega una sesión. El PIN no sale del dispositivo: protege localmente la credencial y la clave de datos (PBKDF2 600.000). 5 PIN erróneos seguidos borran el acceso con PIN en ese dispositivo (los datos se conservan; hace falta un código nuevo).
- El PIN solo vale en ese dispositivo. El administrador puede revocar dispositivos o todas las sesiones.
- Limitación conocida: quien extraiga los archivos del navegador podría probar PIN sin límite fuera de la app; lo mitigan el cifrado del almacenamiento de Android y la revocación.

### Registro desde el inicio de sesión
- `GET registro/reto` (prueba de trabajo firmada por el servidor, ~1–2 s en un móvil) + `POST registro`. Cuenta `pendiente`, sin permisos, nunca administradora.
- Límites globales (detrás de Tailscale todas las peticiones llegan de 127.0.0.1): 10 registros por hora y como máximo 25 pendientes. Opción del administrador para abrir o cerrar el registro (abierto por defecto: las cuentas no hacen nada hasta su aprobación).

## 3. Permisos

- Catálogo ampliado y agrupado por módulos (consulta y modificación). Perfiles = plantillas reutilizables (los roles actuales pasan a ser perfiles). Por usuario: perfil + ajustes individuales (`mas`/`menos`) + alcance por preventivo (todos, o una selección con perfil propio en cada uno).
- Permisos efectivos: `(perfil ∪ mas) − menos` en el ámbito del preventivo. Función compartida `src/core/permisos.js` (servidor y app usan la misma).
- Denegación por defecto. Protección: nadie cambia sus propios permisos; solo un administrador modifica a otro administrador; no se pueden conceder permisos que uno no tiene; siempre queda al menos un administrador activo.
- Consulta dentro de un preventivo: el dispositivo recibe el registro completo del preventivo (necesario sin conexión); los permisos de consulta ocultan apartados en la app. El acceso a cada preventivo sí lo controla el servidor.

## 4. Validación de operaciones en el servidor

- `POST /prev/<pid>/ops` de un preventivo del espacio en modo servidor: sesión obligatoria, acceso al preventivo, `op.u.id` = usuario de la sesión, `op.d` = dispositivo de la sesión, permiso según el tipo de operación (y sus datos), y reglas de política (tipo de recurso inactivo o retirado en unidades nuevas).
- Rechazo por operación con mensaje comprensible. El dispositivo quita la operación rechazada, rehace su estado y avisa al usuario. Los conflictos de concurrencia siguen como hasta ahora (no se rechazan: el motor los marca igual en todos los dispositivos).
- Cada dispositivo envía las operaciones pendientes de cada autor con la sesión de ese autor.
- Configuración (`tipo:*`, `plt:*`, `mapa:*`, `cartografia`): permiso según el elemento. `usr:*` y `roles`: solo los escribe el servidor.

## 5. Auditoría
- Servidor: `auditoria.jsonl` por espacio (quién, qué, a quién, antes/después, cuándo): altas, aprobaciones, estados, permisos, perfiles, códigos, revocaciones, migración, rechazos de operaciones.
- Actividad por usuario: auditoría del servidor + operaciones de los preventivos (el autor de cada operación lo fija el servidor).

## 6. Compatibilidad
- `MIN_CLIENTE` pasa a 1.4.0 cuando el espacio está en modo servidor: las apps 1.3.0 reciben el aviso de actualizar (no pueden escribir con el token del espacio).
- Mientras el espacio no se migre, la 1.4.0 funciona como la 1.3.0.
