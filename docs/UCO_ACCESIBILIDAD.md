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

## Comprobado automáticamente
- **Escenario E2E 13:**
  - crear un aviso solo con teclado;
  - nombre accesible de los controles nuevos;
  - foco al abrir y cerrar;
  - alternativa en lista.
- **Escenario E2E 15:** asistente en el móvil sin desplazamiento horizontal y filas de al menos 44 px.

## Pendiente (recomendado antes de declarar conformidad)
- Auditoría manual con lectores de pantalla en Android (TalkBack) y escritorio (NVDA).
- Revisión de contraste de todos los colores de clave personalizables (dependen de la configuración de cada servicio).
- Comprobar la ampliación al 200 % y la reorganización a 320 px en todas las pantallas.
