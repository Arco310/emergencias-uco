# Detección de incoherencias operativas (1.5.0)

Código:
- `src/core/validaciones.js`: catálogo de reglas y `detectarIncoherencias`. Es el mismo módulo en el dispositivo y en el servidor.
- `src/core/commands.js`: `incoherenciaRevisar` y `reglasSet`.
- `src/ui/views/incoherencias.js`: pantalla y distintivo de la barra.

## Principio
**Detectar, informar y proponer.**
- Ninguna regla cambia estados, finaliza avisos, inicia descansos ni reasigna unidades.
- Los botones solo abren la unidad o el aviso afectados. Las decisiones son de quien coordina.
- Revisar una incoherencia no toca los datos operativos (comprobado en pruebas unitarias y en el escenario 14).

## Catálogo de reglas (ampliable)
Cada regla tiene:
- identificador, grupo y nivel por defecto;
- qué ocurre, por qué es incoherente, qué consecuencias puede tener y qué se recomienda;
- umbral en minutos, cuando lo necesita.

| Regla | Grupo | Nivel | Umbral |
|---|---|---|---|
| Unidad «disponible» con un aviso activo | Unidades | Alta | — |
| Unidad desactivada o archivada asignada a un aviso | Unidades | Alta | — |
| Unidad sin datos mínimos | Unidades | Información | — |
| Sector o tipo que ya no existe | Unidades | Alta | — |
| Unidad ocupada sin cambios desde hace mucho | Unidades | Información | 180 min |
| La misma unidad en dos avisos activos | Avisos | Crítica | — |
| Aviso sin unidad asignada | Avisos | Moderada | 15 min |
| Aviso abierto demasiado tiempo | Avisos | Moderada | 120 min |
| Aviso asignado o en curso sin unidades | Avisos | Alta | — |
| Posible aviso duplicado | Avisos | Información | 5 min |
| Aviso sin ubicación | Avisos | Información | 10 min |
| Unidad en descanso con un aviso activo | Descansos | Crítica | — |
| Descanso con una duración incoherente | Descansos | Información | — |
| Cambio de clave durante el descanso | Descansos | Moderada | — |
| Preventivo finalizado con asuntos abiertos | Preventivo | Alta | — |
| Sectores mal configurados | Preventivo | Moderada | — |
| Puntos del plano repetidos | Preventivo | Información | — |
| Cambios rechazados por el servidor sin revisar | Sincronización | Alta | — |
| Cambios simultáneos por resolver | Sincronización | Alta | — |
| Cambios de este dispositivo sin enviar | Sincronización | Moderada | 10 min |
| Datos sin sincronizar desde hace tiempo | Sincronización | Moderada | 15 min |

Hay situaciones que el motor no permite crear, como un descanso con un aviso activo. Aun así se detectan si llegan con datos antiguos, importaciones o fallos.

## Funcionamiento
- **Niveles:** información, moderada, alta y crítica.
- **Una advertencia por regla y elemento**, agrupadas por regla y ordenadas de más a menos grave. Cada una indica:
  - qué ocurre y el elemento afectado;
  - desde cuándo;
  - por qué es incoherente, sus consecuencias y la recomendación.
- **Distintivo en la barra superior** con el número y el nivel más grave.
- **Revisar** (operación del preventivo `revision.set`, que se sincroniza y aparece en la bitácora):
  - marcar como revisada;
  - asignar a un usuario;
  - resolver con una nota;
  - reabrir;
  - consultar el historial.
  - Si la situación cambia, la advertencia vuelve a aparecer como nueva.
- **Reglas aprobadas** (`cfg.reglas` del preventivo): nivel, umbral y activación de cada regla.
- **Permisos:**

| Permiso | Qué permite | Incluido en |
|---|---|---|
| `incoherencias.ver` | Ver las incoherencias | — |
| `incoherencias.revisar` | Revisar, asignar y resolver | «Editar avisos» |
| `incoherencias.reglas` | Ajustar las reglas | «Editar preventivos» |

Los permisos incluidos se aplican en cadena. Así, quien revisa también ve (corregido en la 1.5.0).

- **En el servidor (modo servidor):**
  - las revisiones y los cambios de reglas exigen su permiso;
  - el panel de estado muestra las incoherencias abiertas de los preventivos cargados.
- En el modo anterior, el servidor no puede leer los preventivos y solo se calculan en los dispositivos.

## Pruebas
- Unitarias: `validaciones.test.mjs` (cada grupo de reglas, agrupación, revisión con historial, reglas ajustables, permisos y bitácora legible).
- E2E: escenario 14.
