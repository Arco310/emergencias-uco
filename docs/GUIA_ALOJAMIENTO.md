# Guía de alojamiento e instalación

La aplicación es una web instalable (PWA). Para que funcione **sin conexión**, **guarde los datos de forma fiable** y se pueda **instalar en Android**, debe abrirse desde una dirección **HTTPS**. Tiene dos piezas:

1. **La aplicación** (`dist/app/`): archivos estáticos. Obligatoria.
2. **El servidor central** (`server/server.mjs`): preventivos compartidos, usuarios y configuración comunes. Sin él, la aplicación funciona en cada dispositivo por separado y los preventivos compartidos se intercambian con paquetes por archivo.

## 1. Publicar la aplicación (gratis)

> **Ya publicada:** https://arco310.github.io/emergencias-uco/ (repositorio `Arco310/emergencias-uco`).
> **Publicar una versión nueva:**
> 1. Subir el número de versión (app y servidor) y `docs/CAMBIOS.md`.
> 2. Fusionar en `main`.
> 3. En GitHub → *Actions* → «Publicar versión» → *Run workflow* con la versión. Ejecuta las pruebas y publica el paquete del servidor con sus sumas SHA-256 en GitHub Releases; la aplicación se publica en GitHub Pages (`node tools/publicar-version.mjs --pages`).
>
> Los dispositivos ven la versión nueva al abrir la aplicación (o en 30 minutos como mucho) y la aplican sin interrumpir a quien está trabajando.

### Otras opciones
- **GitHub Pages en otro repositorio:** sube el contenido de `dist/app/` (incluidos `sw.js`, `manifest.webmanifest`, `icons/` y `.nojekyll`) y activa *Settings → Pages*.
- **Netlify:** arrastra la carpeta `dist/app/` en *Add new site → Deploy manually*.
- **Tu propio servidor:** el servidor central también sirve la aplicación (`--static`), así todo queda en una sola dirección.

> La aplicación no contiene datos ni claves. Los datos de los preventivos solo salen del dispositivo hacia tu propio servidor central.

## 2. Servidor central

### Opción recomendada: un PC con Windows, gratis (instalador incluido)
`dist/servidor-uco-windows.zip` deja un PC con Windows 10 u 11 como servidor central. Tiene una **dirección HTTPS fija y gratuita** (Tailscale Funnel) y **arranca solo** al encender el equipo, sin iniciar sesión en Windows. Instrucciones completas en `LEEME.txt` dentro del ZIP.
1. Descomprime el ZIP en ese PC y haz doble clic en `instalar-servidor.bat` (pide permisos de administrador).
2. El instalador:
   - instala Node.js y Tailscale si faltan;
   - copia el servidor a `C:\ProgramData\GestorUCO`, con una copia previa de los datos si ya existía;
   - crea la tarea programada y lo arranca;
   - si la versión nueva no responde, vuelve sola a la anterior.
3. Inicia sesión en Tailscale (cuenta gratuita) y, la primera vez, activa Funnel con el enlace que aparece.
4. La dirección (`https://nombre-del-pc.xxxx.ts.net/`) queda en `C:\ProgramData\GestorUCO\DIRECCION.txt`.
5. **La aplicación ya conoce la dirección del servidor oficial** (`src/config/servidor.js`). Una sola vez, un administrador: *Sistema → Servidor central → Activar el servidor central* con el código de administración (`MOSTRAR-CODIGO-ADMIN.bat`).
6. Opcional: *Sistema → Servidor central → Pasar al modo servidor*. Así el servidor valida usuarios, permisos y contenido de cada cambio. Hace falta que todos los dispositivos tengan la versión actual.

`estado-servidor.bat` comprueba si funciona en el PC y desde Internet. `desinstalar-servidor.bat` lo detiene y quita el arranque automático (conserva los datos).

**Condiciones de Tailscale:** el plan Personal es gratuito y solo para uso **no comercial**. Los móviles no instalan nada; solo hace falta la cuenta del PC servidor. Para uso comercial hay planes de pago. Alternativa: Cloudflare Tunnel con un dominio propio (tabla de abajo).

### Instalación manual (Linux u otro equipo)
Requisitos: Node.js 18+ accesible por **HTTPS** desde los dispositivos.

```bash
node server/server.mjs --port 8443 --data /ruta/datos --static dist/app
```

Parámetros: `--port`, `--data` (carpeta de datos), `--static` (opcional: sirve la aplicación), `--cert`/`--key` (HTTPS directo), `--origins` (dominios permitidos), `--host`.
Si la aplicación se abre desde el propio servidor, usa ese origen como servidor central. Para otro servidor distinto del oficial hay que compilar la aplicación con su dirección en `src/config/servidor.js`.

| Forma de exponerlo con HTTPS | Coste | Notas |
|---|---|---|
| PC con Windows + **Tailscale Funnel** (instalador incluido) | Gratis (uso no comercial) | Dirección fija `*.ts.net`. El PC debe estar encendido y con Internet. |
| **Cloudflare Tunnel** | Gratis (dominio ~10 €/año para dirección fija) | Sin dominio, la dirección cambia en cada arranque. |
| **VPS** + **Caddy** | ~4–6 €/mes + dominio | Caddy obtiene el certificado automáticamente. |
| Certificado propio | — | `--cert cert.pem --key key.pem`. |

Ejecución permanente en Linux (systemd), ejemplo `/etc/systemd/system/uco-sync.service`:
```ini
[Unit]
Description=Gestor UCO - servidor central
After=network.target
[Service]
ExecStart=/usr/bin/node /opt/uco/server/server.mjs --port 8443 --data /var/lib/uco --static /opt/uco/dist/app --host 127.0.0.1
Restart=always
User=uco
[Install]
WantedBy=multi-user.target
```

**Importante**
- **Cifrado de los datos:**
  - modo de siempre: el servidor guarda los datos **cifrados de extremo a extremo** y no puede leerlos;
  - **modo servidor:** custodia las claves en `datos/_servidor/claves` para validar los permisos. Hay que proteger el PC y sus copias;
  - en los dos casos, haz copia de la carpeta de datos.
- Si el servidor cae, los dispositivos **siguen trabajando** y se sincronizan al volver.
- Sin Internet en el lugar del preventivo: **Más → Sincronización → Exportar/Importar paquete** (Bluetooth, USB, mensajería).
- Una aplicación publicada en HTTPS no puede conectar con un servidor `http://192.168.x.x` de la red local (lo bloquea el navegador).
- No se abren puertos en el router: Tailscale Funnel publica solo el servidor, por HTTPS.

## 3. Instalar en los teléfonos y tablets Android
1. Abre la dirección HTTPS en **Chrome**.
2. Menú ⋮ → **Instalar aplicación**. También desde la app: *Sistema → Permisos del dispositivo → Instalar*.
3. Abre la aplicación instalada **una vez con conexión** para que quede guardada para el uso sin conexión.
4. En *Sistema → Permisos del dispositivo* concede almacenamiento persistente, ubicación, notificaciones y pantalla encendida.

## 4. Actualizar a una nueva versión
- **Aplicación:**
  - se actualiza sola al publicarse;
  - comprueba la integridad de cada versión y conserva los datos y los cambios pendientes;
  - las migraciones de datos hacen antes una copia cifrada;
  - si una versión no arranca, una pantalla permite volver a la anterior.
- **Servidor:** *Sistema → Actualizaciones* (permiso «Gestionar las actualizaciones» y código de administración del servidor).
  1. El servidor consulta GitHub Releases al arrancar una versión nueva y cada 6 horas.
  2. **Descargar y verificar:** SHA-256 de GitHub y lista de sumas, y prueba con una copia de los datos.
  3. **Instalar ahora** o **en la ventana segura** (30 minutos sin cambios en ningún preventivo). Antes se copian los datos.
  4. Si la versión nueva no responde durante el periodo de prueba, se vuelve sola a la anterior. También se puede volver a mano.
- **Compatibilidad:** el servidor indica la versión mínima de la app. Una app anterior deja de sincronizar con él (sin perder nada) hasta actualizarse.
- Recomendado antes de un preventivo: comprobar *Sistema → Estado del sistema* (sin alertas, última copia, dispositivos activos).

## 5. Costes y servicios externos

| Servicio | Uso | Coste |
|---|---|---|
| GitHub Pages y GitHub Releases | Aplicación publicada y versiones del servidor | Gratis |
| Tailscale Funnel | Dirección HTTPS del PC servidor | Gratis (uso no comercial) |
| OpenStreetMap e IGN (PNOA, mapa topográfico) | Mapas del plano sin clave | Gratis; requieren Internet (lo visto queda guardado) |
| OpenStreetMap Nominatim | Buscar coordenadas de una dirección | Gratis (máx. 1 consulta/segundo) |
| Google Maps (enlaces y mapa incrustado sin clave) | Ver una dirección en Google Maps | Gratis; requiere Internet |
| Google Maps Platform (opcional, con clave) | Vistas y búsqueda de Google en el plano | De pago a partir de la cuota gratuita (requiere facturación en Google Cloud) |
| Servidor central propio | Preventivos compartidos, usuarios y configuración | Gratis en un PC propio; VPS ~4–6 €/mes |

No se envían datos de los preventivos a terceros.
