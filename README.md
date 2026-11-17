# Gestor de Emergencias UCO

Aplicación para gestionar preventivos y operaciones de emergencia desde teléfonos y tablets Android: unidades totalmente configurables, claves operativas C0–C6 y CESP, color C0 individual, avisos con numeración correlativa, descansos, plano táctico, mapa real, ubicaciones, bitácora, cronologías, estadísticas, informes PDF/JSON/CSV, plantillas, usuarios y permisos, copias de seguridad y sincronización entre varios dispositivos.

- **Funciona sin conexión** (modo avión): todos los datos se guardan cifrados en el propio dispositivo.
- **Se usa desde el navegador** (URL) y **se instala como aplicación** (PWA) en Android, sin tienda ni APK.
- **Sin servicios de pago**: mapas de Google sin clave de API, búsqueda de coordenadas de OpenStreetMap y servidor de sincronización propio incluido.

**Aplicación publicada:** https://arco310.github.io/emergencias-uco/ (ábrela en Chrome para Android y elige *Instalar aplicación*).

## Contenido del paquete

| Carpeta | Contenido |
|---|---|
| `dist/app/` | **Aplicación lista para publicar** (subir tal cual a un alojamiento HTTPS). |
| `dist/preview.html` | Vista previa de un solo archivo (sin modo sin conexión ni guardado fiable). |
| `server/server.mjs` | Servidor de sincronización (Node.js 18+, sin dependencias). También puede servir la aplicación. |
| `src/` | Código fuente: `core/` (lógica de negocio), `data/` (almacenamiento cifrado y sincronización), `app/` (núcleo), `ui/` (interfaz). |
| `tests/` | Pruebas automáticas: unidad, servidor e integración, y aceptación en navegador (Playwright). |
| `docs/` | Guía de alojamiento, manual de usuario, documentación técnica e informe de pruebas. |

## Puesta en marcha rápida

1. **Probar en local** (necesita Node.js 18 o superior):
   ```bash
   node server/server.mjs --static dist/app --data ./datos-servidor --port 8443
   ```
   Abre `http://localhost:8443` en Chrome. (Para usarlo desde un móvil hace falta HTTPS: ver la guía.)
2. **Publicar para uso real**: sigue [docs/GUIA_ALOJAMIENTO.md](docs/GUIA_ALOJAMIENTO.md) (GitHub Pages o Netlify gratis, o tu propio servidor).
3. **Primer uso**: crea el administrador y guarda la clave de recuperación. Consulta [docs/MANUAL_USUARIO.md](docs/MANUAL_USUARIO.md).

## Desarrollo

```bash
npm install            # instala esbuild (solo para compilar)
node build.mjs         # genera dist/app y dist/preview.html
npm test               # pruebas de unidad, servidor e integración (node:test)
pip install playwright && python3 tests/e2e/run_e2e.py   # pruebas en navegador
```

Documentación técnica (arquitectura, esquema de datos, sincronización, seguridad, copias y recuperación): [docs/DOCUMENTACION_TECNICA.md](docs/DOCUMENTACION_TECNICA.md).
Resultados de las pruebas: [docs/INFORME_PRUEBAS.md](docs/INFORME_PRUEBAS.md).
