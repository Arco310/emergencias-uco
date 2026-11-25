# Gestor de Emergencias UCO

Aplicación para coordinar preventivos y operaciones de emergencia desde teléfonos, tablets y ordenadores.
- **Operativa:** unidades configurables, claves C0–C6 y CESP con color C0 individual, avisos por código de incidente con numeración correlativa y descansos.
- **Mapa:** plano de coordinación con capas, filtros y avisos desde el mapa.
- **Control:** detección de incoherencias, bitácora, cronologías, estadísticas e informes verificables (PDF, Excel, CSV y JSON).
- **Configuración y equipo:** plantillas con versiones, usuarios y permisos por módulo, copias de seguridad, y sincronización entre dispositivos a través de un servidor central propio.

Las características:
- **Funciona sin conexión** (modo avión): los datos se guardan cifrados en el propio dispositivo y se sincronizan al volver la red.
- **Se usa desde el navegador** (URL) y **se instala como aplicación** (PWA) en Android, sin tienda ni APK. Se actualiza sola.
- **Sin servicios de pago obligatorios:** OpenStreetMap e IGN sin clave, y servidor central propio en un PC con Windows. Google Maps Platform es opcional, con clave.

**Aplicación publicada:** https://arco310.github.io/emergencias-uco/ (ábrela en Chrome para Android y elige *Instalar aplicación*).
**Versión en desarrollo:** 1.5.0 en la rama `mejora-1.5.0`, sin publicar. Las novedades están en [docs/CAMBIOS.md](docs/CAMBIOS.md).

## Contenido

| Carpeta | Contenido |
|---|---|
| `src/` | Código fuente: `core/` (lógica de negocio), `data/` (almacenamiento cifrado, sincronización y espacio central), `app/` (núcleo), `ui/` (interfaz). |
| `server/` | Servidor central (Node.js 18+, sin dependencias): sincronización, espacio central, modo servidor, actualizador y estado del sistema. |
| `servidor-windows/` | Instalador para Windows (dirección HTTPS fija con Tailscale Funnel y arranque automático). |
| `dist/` | Compilado: `app/` (aplicación), `servidor-uco-windows.zip` (servidor para Windows) y `preview.html`. |
| `tests/` | Pruebas: `unit/` y `server/` (node:test), `e2e/` (navegador, 17 escenarios), `checks/` (calidad y pruebas en vivo) y `perf/` (rendimiento). |
| `tools/` | `publicar-version.mjs`: publica una versión (app y servidor). |
| `docs/` | Manual, documentación técnica, guía de alojamiento, informes de entrega y de pruebas. |

## Puesta en marcha

1. **Probar en local** (Node.js 18 o superior):
   ```bash
   node build.mjs
   node server/server.mjs --static dist/app --data ./datos-servidor --port 8443
   ```
   Abre `http://localhost:8443` en Chrome. Para usarlo desde un móvil hace falta HTTPS: ver la guía.
2. **Servidor central en un PC con Windows:** `dist/servidor-uco-windows.zip` → `instalar-servidor.bat`. Instrucciones en [docs/GUIA_ALOJAMIENTO.md](docs/GUIA_ALOJAMIENTO.md).
3. **Primer uso:** consulta [docs/MANUAL_USUARIO.md](docs/MANUAL_USUARIO.md).

## Desarrollo y pruebas

```bash
npm install                              # esbuild (solo para compilar)
node build.mjs                           # genera dist/
npm test                                 # unidad y servidor (node:test)
python3 tests/e2e/run_e2e.py             # navegador (requiere Playwright y Chrome); un escenario: run_e2e.py 17
python3 tests/checks/comprobaciones.py   # calidad: PWA, accesibilidad, contraste, secretos, CSP, HTTPS
```

## Documentación
- [Manual de usuario](docs/MANUAL_USUARIO.md)
- [Documentación técnica](docs/DOCUMENTACION_TECNICA.md): arquitectura, datos, sincronización, seguridad, copias y API.
- [Guía de alojamiento e instalación](docs/GUIA_ALOJAMIENTO.md)
- [Novedades por versión](docs/CAMBIOS.md)
- Informes de entrega: [1.4.0](docs/INFORME-1.4.0.md), [1.5.0](docs/INFORME-1.5.0.md) e [informe final 1.0.3 → 1.3.0](docs/INFORME_FINAL.md).
- [Informe de pruebas](docs/TESTING_REPORT.md)
- [Estado de la implementación y seguimiento](docs/IMPLEMENTATION_STATUS.md)
- Partes de la 1.5.0:
  - [mapas y capas](docs/UCO_MAPAS_CAPAS.md);
  - [avisos](docs/UCO_AVISOS.md);
  - [informes](docs/UCO_INFORMES.md);
  - [plantillas](docs/UCO_PLANTILLAS_PREVENTIVOS.md);
  - [monitorización](docs/UCO_MONITORIZACION.md);
  - [validaciones operativas](docs/UCO_VALIDACIONES_OPERATIVAS.md);
  - [accesibilidad](docs/UCO_ACCESIBILIDAD.md).
