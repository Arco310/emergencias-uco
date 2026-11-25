# Informes al finalizar, versiones, horas verificables y exportaciones (1.5.0)

Código:
- `src/core/report.js`: PDF.
- `src/core/pdf.js`: generador propio.
- `src/core/exporters.js`: tablas, CSV, JSON y Excel.
- `src/core/xlsx.js`: Excel propio.
- `src/core/fiabilidad.js`: horas, limitaciones y huella.
- `src/app/core.js`: `generarInforme`, `registrarInforme`, `horasOps`.
- `src/ui/views/admin.js`: Más → Finalizar preventivo e informes.

## Al finalizar
- Al pulsar «Finalizar preventivo» se genera y se guarda la **versión 1** del informe en PDF. Generarla no cierra ni bloquea nada más.
- Si falla, el preventivo se finaliza igualmente y se avisa.
- Si quien finaliza no tiene «Generar informes», se indica que la generará quien lo tenga.
- Cada versión registra:
  - número, fecha, autor y dispositivo;
  - motivo (obligatorio desde la segunda versión);
  - si es provisional y por qué (cambios sin sincronizar, conflictos sin resolver, preventivo sin finalizar);
  - **huella SHA-256 del PDF**;
  - huella del registro de operaciones que cubre.
- **Nueva versión…** pide el motivo (por ejemplo, correcciones autorizadas tras una reapertura o datos sincronizados después). Las anteriores se conservan tal cual.
  - Si hay cambios registrados después de la última versión, se avisa.
  - El archivado y el propio registro del informe no cuentan como cambios.
- **Comprobar un PDF…:** calcula la huella de un archivo y dice si es una versión registrada y no modificada.

## Registro de accesos
- Operación del preventivo `informe.reg`, que guarda quién generó, consultó o exportó, qué versión, en qué formato y con qué huella.
- Se sincroniza y aparece en la bitácora (categoría «Informes»).
- Se admite con el preventivo finalizado o archivado: no cambia unidades, avisos, el preventivo ni los conflictos (comprobado en `informes.test.mjs`).
- **El servidor también lo valida.** Comprueba el permiso según la acción y el contenido: acción, formato, número de versión y huellas en hexadecimal.

## Permisos
| Acción | Permiso |
|---|---|
| Generar una versión | `informes.generar` («Generar informes»), incluido en «Exportar» |
| Descargar, compartir o exportar | `exportar` |
| Consultar las versiones guardadas | `informes.ver` (nuevo, de consulta), incluido en «Generar informes» |

## Contenido del PDF
1. Cabecera con la identidad UCO, versión del informe y recuadro **PROVISIONAL** si procede.
2. Información general:
   - fechas, duración, origen (plantilla y versión);
   - responsables (participantes con rol de responsable o coordinación);
   - advertencias del cierre.
3. **Configuración y sectores utilizados:**
   - plano y tipo de mapa;
   - claves, tipos de aviso, tipos de recurso usados, descanso y reglas;
   - tabla de sectores con su delimitación, unidades y avisos.
4. **Plano del preventivo**, esquemático y dibujado sin Internet:
   - sectores delimitados y puntos;
   - avisos (rombo, gris si finalizado);
   - unidades en su última posición, con el color de su clave y el borde de su color C0.
5. Resumen y estadísticas:
   - tiempos de los avisos;
   - avisos por tipo, por sector y por hora;
   - tiempo por clave.
6. **Utilización de los recursos:**
   - intervenciones y tiempo en avisos y en descanso;
   - ocupación media y por unidad.
7. Unidades y **actividad por unidad**:
   - periodos de actividad, claves usadas, ubicaciones y descansos;
   - avisos atendidos e incidencias.
8. Tiempo por clave y unidad.
9. Avisos y **avisos al cierre** (los que quedaban sin finalizar).
10. Descansos e historial de ubicaciones.
11. **Cronología** de lo relevante:
    - inicio y finalización;
    - incorporación de unidades y cambios de clave;
    - avisos y asignaciones, descansos y ubicaciones;
    - incidencias, conflictos y revisiones.
12. **Incidencias detectadas:** incoherencias con los datos al cierre, con su revisión, y las anotadas en las unidades.
13. **Fiabilidad de los datos y limitaciones:** ver el apartado «Horas verificables».
14. Bitácora completa y auditoría.
15. **Registro del informe:** versiones, exportaciones y consultas.

## Horas verificables
- Cada operación conserva tres horas, que nunca se mezclan:
  - **declarada** por el dispositivo (`t`): es la que usan todos los tiempos;
  - **recibida por el servidor** (`rx`): el servidor ya la anotaba y ahora la devuelve al enviar y al leer;
  - **sincronizada** en este dispositivo (`sy`).
- `rx` y `sy` se guardan fuera del contenido cifrado de la operación y nunca se envían dentro de ella.
- **Limitaciones que se indican**, sin corregir ni estimar nada:
  - preventivo independiente (solo hora declarada);
  - cambios sin enviar;
  - operaciones sin hora del servidor (anteriores a la 1.5.0 o importadas por archivo);
  - registros diferidos (más de 2 min entre la hora declarada y la recepción);
  - reloj de un dispositivo adelantado más de 1 min;
  - indicadores sin datos suficientes;
  - conflictos sin resolver.

## Formatos
- **PDF:** propio, sin Internet.
- **Excel (XLSX):** escrito sin librerías (Office Open XML con texto en línea, cabecera fija y con filtro). Incluye:
  - un resumen y las mismas tablas que el CSV (los minutos, como números);
  - «Horas de registro» y «Registro del informe».
  - Comprobado con un lector independiente (openpyxl).
- **CSV (ZIP):** las tablas de siempre, más `horas_de_registro.csv` y `registro_del_informe.csv`.
- **JSON:** el formato de siempre (`uco-preventivo`, compatible), más:
  - `horas`;
  - `informes`;
  - `rx` y `sy` en las operaciones;
  - `huellaRegistro`, con la que se comprueba que un informe corresponde a esos registros.

## Dónde se guardan
- El PDF de cada versión se guarda cifrado en el dispositivo que lo generó, entre los archivos internos de la aplicación.
- El registro de versiones (con su huella) llega a todos los dispositivos del preventivo. Los demás dispositivos ven «PDF guardado en el dispositivo X».
- Cualquiera puede generar otra versión con su motivo.

## Pruebas
- Unitarias: `informes.test.mjs` y `xlsx.test.mjs`.
- Servidor: `rx` en `servidor.test.mjs`; validación en `modo_servidor.test.mjs`.
- E2E:
  - escenario 16: Excel abierto con openpyxl, versión 1 al finalizar, huella del archivo descargado, comprobación de un PDF original y otro modificado, versión 2 con motivo, JSON con la huella del registro;
  - escenario 2: horas `rx` y `sy` entre dos dispositivos.
