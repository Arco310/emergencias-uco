# Accesibilidad (referencia: WCAG 2.2 nivel AA)

**No se declara conformidad completa con WCAG 2.2 AA.**
- No se ha hecho una auditoría manual completa con lectores de pantalla reales (NVDA, TalkBack, VoiceOver), ni con ampliación de pantalla en todos los dispositivos.
- Lo que sigue es lo que se ha implementado y lo que se ha comprobado de forma automática.

## Implementado (1.5.0)
- **Crear avisos sin depender del mapa ni del arrastre.** Se puede:
  - tocar el lugar;
  - mover el marcador provisional con flechas en pantalla o con las flechas del teclado;
  - escribir una dirección;
  - elegir un sector o un punto de interés;
  - introducir coordenadas a mano.
- **Alternativa equivalente al mapa:** «Lista» del plano, con las unidades, los avisos y los puntos, y las mismas acciones.
- **No solo color:**
  - la disponibilidad lleva símbolo (✓ ● ‖ ◆ ✕);
  - los avisos finalizados se ven en gris y con su forma;
  - la leyenda describe cada color;
  - las alertas llevan el nivel escrito;
  - el informe PDF dibuja las unidades con su clave y su texto.
- **Foco:**
  - al abrir un panel o diálogo, el foco va a él;
  - al cerrarlo, vuelve al control que lo abrió, aunque se haya repintado la pantalla;
  - Escape cierra el panel superior;
  - el foco es visible en los paneles.
- **Formularios:**
  - campos con etiqueta asociada;
  - grupos de casillas en `fieldset`/`legend` (también en el asistente de creación de preventivos);
  - las listas plegables usan `details`/`summary`, que se manejan con teclado.
- **Mensajes de estado anunciables:**
  - avisos emergentes con `role="status"` (y `alert` para los errores);
  - resumen de confirmación del asistente con `aria-live="polite"`.
- **Tamaño táctil:**
  - botones de al menos 44 px;
  - filas de unidades del asistente comprobadas en el móvil (78 px de alto);
  - sin desplazamiento horizontal a 390 px de ancho.
- **Móvil:**
  - la barra del plano cabe en una fila desplazable (antes ocupaba la pantalla);
  - formularios compactos y sin controles superpuestos al mapa;
  - el mapa se puede ampliar.
- **Contraste del texto (revisión final):**
  - etiquetas de colores con el texto al 50 % entre su color y el del texto normal: todos los colores de partida alcanzan 4,5:1 en los temas claro y oscuro;
  - en la barra superior, el texto de las etiquetas se mezcla con el de la barra;
  - tema oscuro con colores de estado propios (aviso, correcto, información), texto oscuro sobre el rojo de los botones principales y cifras del panel legibles;
  - texto negro o blanco sobre cualquier color configurable (claves, tipos, unidades): siempre al menos 4,58:1;
  - atribución del mapa legible sobre cualquier tesela.
- **Reorganización en el móvil (revisión final):** en las listas de datos del estado del sistema, de las actualizaciones y del servidor central, la etiqueta va encima del valor por debajo de 480 px. Antes, a 320 px, el valor quedaba en una columna de una letra («v/e/r/s/i/ó/n»).

## Comprobado automáticamente
- **Escenario E2E 13:**
  - crear un aviso solo con teclado;
  - nombre accesible de los controles nuevos;
  - foco al abrir y cerrar;
  - alternativa en lista.
- **Escenario E2E 15:** asistente en el móvil sin desplazamiento horizontal y filas de al menos 44 px.
- **Escenario E2E 17 (revisión final).** Recorre 14 pantallas en 6 configuraciones: móvil a 320 px y a 390 px, tablet a 1280 px, escritorio a 1920 px con ratón, y tema oscuro en el móvil y en la tablet.
  - Pantallas: inicio, plantillas, asistente, panel, unidades, avisos, bitácora, plano, capas, lista, ficha del aviso, incoherencias, informes y estado del sistema.
  - En cada una, una auditoría automática (`tests/e2e/auditoria_a11y.js`) comprueba:
    - que nada se sale del ancho y que ninguna palabra queda partida entre dos líneas por falta de espacio (1.4.10 Reorganización: 320 px equivale a ampliar al 400 % una pantalla de 1280 px);
    - objetivos de al menos 24 × 24 px (2.5.8);
    - contraste del texto (1.4.3), con el fondo real compuesto;
    - nombre accesible de todos los controles, según el árbol de accesibilidad del navegador (4.1.2).
  - En el móvil y en el escritorio, además: crear un aviso desde el mapa de principio a fin, revisar una incoherencia y descargar el informe.
- **Pruebas unitarias `accesibilidad.test.mjs`:** texto legible sobre cualquier color configurable, etiquetas en los dos temas y colores del tema oscuro.
- **`tests/checks/comprobaciones.py`:** nombres accesibles y tamaño de los controles en 24 pantallas, identificadores únicos y contraste de las claves.

## Pendiente (recomendado antes de declarar conformidad)
- Auditoría manual con lectores de pantalla en Android (TalkBack) y escritorio (NVDA): orden de lectura, anuncios y gestos.
- Contraste de los elementos gráficos (1.4.11) y de los colores que cada servicio configure para sus sectores y categorías: no se mide automáticamente.
  - El texto sobre los colores configurables ya está garantizado (al menos 4,58:1).
- Reorganización a 320 px en las pantallas de administración que no recorre el escenario 17 (usuarios, copias, configuración). Las del recorrido se comprueban siempre.
