# Avisos desde el mapa, ubicación y selección de unidades (1.5.0)

Código: `src/ui/views/plano.js` (flujo en el mapa), `src/ui/views/ops.js` (formulario del aviso), `src/core/ubicacion.js` (origen y validación de la ubicación), `src/core/suggest.js` (sugerencias).

## Crear un aviso en el mapa
1. «Nuevo aviso en el mapa».
2. Tocar el lugar. Aparece un marcador provisional, que aún no es un aviso.
3. Ajustar la posición:
   - arrastrando el marcador;
   - con las flechas en pantalla;
   - con las flechas del teclado.
   Los pasos son de 1 a 25 m.
4. «Usar esta ubicación».
5. Se abre el formulario con la ubicación y el sector ya puestos.
6. Completar los datos y confirmar. «Cancelar» o Escape descartan el marcador sin crear nada.

«Aviso por zona» sigue permitiendo dibujar una zona.

**Sin usar el mapa**, desde el propio formulario («Ubicación» del aviso) se puede indicar:
- una dirección escrita (y buscarla, si hay Internet);
- un sector;
- un punto de interés;
- coordenadas a mano;
- la posición GPS del dispositivo.

## La ubicación guarda su origen y su hora
- Campo `loc.fuente`, que vale `mapa`, `gps`, `direccion`, `coordenadas`, `punto` o `sector`. Campo `loc.t`.
- Se muestra «Marcada en el mapa (no es una posición GPS) · 03:12». Una ubicación elegida a mano nunca se presenta como GPS.
- Se valida en el dispositivo y también en el servidor, que rechaza con el código `datos`:
  - latitud y longitud deben ir juntas (latitud de −90 a 90, longitud de −180 a 180);
  - el texto tiene como máximo 300 caracteres;
  - el origen debe ser uno de los conocidos.
- Corregir la ubicación queda en la bitácora con el valor anterior y el nuevo.

## Unidades en el formulario
- Cada unidad muestra:
  - tipo, clave, sector y última ubicación conocida;
  - sus avisos activos;
  - si está en descanso;
  - su disponibilidad.
- Las tres primeras unidades disponibles y compatibles aparecen como «Sugerida». La sugerencia no se marca sola: decide el coordinador.
- Las unidades en descanso, ocupadas o incompatibles salen deshabilitadas, con el motivo.
  - Una unidad con aviso activo no puede descansar ni estar en dos avisos: lo impide el motor.
  - Una unidad de tipo incompatible solo se puede forzar si el preventivo no exige compatibilidad estricta.
  - Si dos dispositivos, sin conexión, hacen cambios que se contradicen, el servidor no pierde ninguno. Al aplicarlos aparecen como conflicto o como incoherencia para revisar.
- Se pueden asignar varias unidades a la vez.

## Sin conexión
- El aviso se guarda en el dispositivo con su referencia provisional.
- Lleva el distintivo «Pendiente de confirmar» hasta que el servidor lo confirma y le da su número definitivo. No se presenta como aviso confirmado.

## Ficha contextual
- Al tocar un aviso en el mapa se abre su ficha, con:
  - datos principales, ubicación, unidades y estado;
  - acciones según los permisos.
- El historial completo está en la ficha del aviso y en la bitácora.

## Decisiones
- **Sin campo de prioridad:** lo decidiste así. Los tipos de aviso siguen siendo los códigos de incidente.

## Pruebas
- Unitarias: `ubicacion.test.mjs` y el resto de la suite.
- Servidor: coordenadas manipuladas rechazadas (`modo_servidor.test.mjs`).
- E2E: escenario 13 (desde el mapa, sin mapa, con teclado) y escenario 2 (pendiente de confirmar sin conexión).
