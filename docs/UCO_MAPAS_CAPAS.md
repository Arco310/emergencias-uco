# Mapas: capas, filtros, sectores y puntos (1.5.0)

Código: `src/core/capas.js` (funciones puras, sin interfaz), `src/ui/views/plano.js` (Leaflet), `src/core/commands.js` (validación de sectores y puntos).

## Capas y filtros
- **Capas:** unidades, avisos activos, avisos finalizados (apagada por defecto), sectores, puntos de interés, infraestructura y apoyo, y etiquetas. Cada sector y cada categoría de punto se puede ocultar por separado.
- **Filtros combinables:** tipo de recurso, clave, disponibilidad (disponible, ocupada, descanso, clave especial, fuera de servicio), sector y tipo de aviso. «Restablecer» vuelve a mostrarlo todo.
- **Son preferencias de visualización.** Se guardan en cada dispositivo y para cada preventivo (documento local `vista:<pid>`). No cambian datos, no se sincronizan y no afectan a lo que ven los demás. Ocultar una unidad no la desactiva ni cambia su estado.
- **Leyenda** generada con lo visible: claves (color y código), disponibilidad con símbolo (✓ ● ‖ ◆ ✕, no solo color), tipos de aviso y categorías de punto.
- **Agrupación propia por rejilla** (`agrupar`, celdas de 60 px): actúa a partir de 60 elementos. Al tocar un grupo, el mapa se acerca. Se ha comprobado con 150 unidades (escenario E2E 12).
- **Avisos distinguibles por su tipo sin depender del color:** la etiqueta del marcador lleva el número y el código de incidente (por ejemplo, «Nº 1 · 1.1»); el nombre completo del tipo va en su descripción. El color indica el estado y el «✓», que está finalizado.

## Sectores delimitados
- Cada sector puede tener una zona (`cat.sectores[].zona.pts`, polígono en coordenadas del plano) dibujada desde el plano.
- El polígono no intercepta los toques, así que se pueden crear avisos dentro. El nombre del sector va en una etiqueta que sí se puede pulsar.
- **Permiso:** «Gestionar sectores» (`sectores.gestionar`).

## Puntos de interés y de apoyo
- Catálogo `cat.puntos`: nombre, categoría, posición o zona, y descripción. Las categorías están en `cat.categoriasPunto`. Hay 13 de partida en dos grupos:
  - **Interés:** accesos y salidas, punto de encuentro, puesto sanitario, punto de coordinación, zona restringida, zona de riesgo y otros.
  - **Infraestructura y apoyo:** hospital, centro sanitario, puesto de asistencia, punto de abastecimiento, recurso de apoyo y otros.
- **Permiso:** «Editar planos» (`planos.editar`). Se valida al guardar: la categoría debe existir y la posición o la zona debe estar dentro del plano.
- Los preventivos anteriores a la 1.5.0 usan las categorías de partida.

## Ficha contextual y alternativa en lista
- Al tocar una unidad, un aviso, un punto o un sector se abre una tarjeta dentro del mapa con sus datos y acciones, y «Abrir ficha completa».
- En los avisos, la tarjeta muestra además su historial reciente y, según los permisos, «Asignar unidad», «Finalizar» y «Editar» (detalle en `UCO_AVISOS.md`).
- «Lista» muestra los mismos elementos en forma de lista, con las mismas acciones: es la alternativa equivalente al mapa.

## Sin conexión
- Los filtros, sectores, puntos y planos de imagen funcionan sin conexión.
- Los mapas cartográficos solo muestran las teselas ya guardadas; no se obtienen teselas nuevas sin Internet.

## Pruebas
- Unitarias: `tests/unit/capas.test.mjs`.
- E2E:
  - escenario 12: capas, código de incidente en el marcador, filtros combinados, ocultar sin cambiar el estado, ficha del aviso con historial y acciones, 150 unidades y preferencias por preventivo;
  - escenario 17: plano, capas, lista y ficha en el móvil (320 y 390 px), la tablet, el escritorio y el tema oscuro.
