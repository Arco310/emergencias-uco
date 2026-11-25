# Plantillas de preventivo (1.5.0)

Código:
- `src/core/templates.js`: `ELEMENTOS_PLANTILLA`, `recortarContenido`, `contentFromPrev`, `seedFromTemplate`, `versionarPlantilla`, `describirOrigen`.
- `src/data/repo.js`: guardado con versiones.
- `src/ui/views/home.js`: lista, editor y asistente.

## Crear una plantilla
- **Desde un preventivo**, también finalizado: Más → «Crear plantilla desde este preventivo».
- **Desde la configuración general:** «Nueva plantilla».
- **Duplicando o importando** otra plantilla.
- Al crearla desde un preventivo se elige qué incluir:
  - tipos de recurso;
  - unidades previstas;
  - sectores (con su delimitación);
  - puntos de interés y de apoyo;
  - plano y posiciones;
  - tipo de mapa;
  - configuración de avisos;
  - parámetros operativos (claves, motivos, descanso);
  - reglas de incoherencias;
  - usuarios y roles previstos.
- Los usuarios y roles previstos son datos personales: van **desmarcados**.
- **Nunca se copian** avisos, números de aviso, estados, descansos, sesiones ni historiales.
- **Sin referencias rotas:**
  - Si se quitan los sectores, las unidades que estaban en un sector que ya no existe quedan sin sector.
  - Sin el plano no se conservan posiciones, puntos ni delimitaciones, porque se sitúan sobre él.
  - Se conservan los tipos de recurso que usan las unidades o la compatibilidad de los tipos de aviso.

## Versiones
- Cada cambio en lo que crea la plantilla (nombre, descripción o contenido) genera la versión siguiente y conserva la anterior tal cual, hasta 20.
- Marcarla como favorita, desactivarla o registrar un uso **no** cuenta como versión.
- Pestaña «Versiones» del editor: autor, fecha y resumen de cada versión, y «Restaurar», que crea una versión nueva con aquel contenido.
- **Cada preventivo recuerda con qué versión se creó** (`origen.revision`) y qué no heredó. Se ve en la configuración del preventivo, en el informe y en la bitácora, por ejemplo: «Plantilla «Concierto tipo», versión 2 (sin heredar: plano y posiciones; 1 unidad prevista sin incluir)». Los usos de la plantilla también guardan la versión.

## Crear un preventivo con el asistente
- Los pasos se numeran según el origen:
  1. Origen.
  2. Nombre.
  3. Fecha y horario.
  4. Sectores y recursos previstos (listas plegables para desmarcar unidades y sectores).
  5. Opciones heredadas (lo que se desmarca se toma de la configuración general).
  6. Modalidad.
  7. Confirmación, con un resumen de lo que se va a crear.
- La plantilla y el preventivo son independientes. Cambiar, desactivar o eliminar la plantilla no afecta a los preventivos ya creados.
- **Desactivar:** la plantilla deja de ofrecerse al crear preventivos, pero no se borra.

## Permisos
| Permiso | Qué permite |
|---|---|
| `plantillas.crear` | Crear (desde la configuración, un preventivo, duplicando o importando) |
| `plantillas.gestionar` | Modificar, desactivar y eliminar. Incluye crear |
| `plantillas.usar` | Crear preventivos a partir de plantillas. Incluido en «Crear preventivos» |

- Los perfiles anteriores conservan lo que podían hacer.
- Usar una plantilla también se comprueba en el servidor (operación `prev.create` con origen plantilla).
- Las plantillas se guardan en cada dispositivo, cifradas, y viajan en sus copias de seguridad. Las acciones comprueban el permiso aunque el botón no se muestre.

## Pruebas
- Unitarias: `plantillas_versiones.test.mjs` y la prueba de plantillas de `sync_y_datos.test.mjs`.
- E2E: escenario 15 (elementos, versiones, asistente en tablet y móvil, desactivar, restaurar, duplicar y eliminar) y escenario 1.
