# Guía de alojamiento e instalación

La aplicación es una web instalable (PWA). Para que funcione **sin conexión**, **guarde los datos de forma fiable** y se pueda **instalar en Android**, debe abrirse desde una dirección **HTTPS**. Hay dos piezas independientes:

1. **La aplicación** (`dist/app/`): archivos estáticos. Obligatoria.
2. **El servidor de sincronización** (`server/server.mjs`): solo para la modalidad **compartida** con sincronización por red. Sin él, la modalidad compartida funciona con paquetes por archivo.

## 1. Publicar la aplicación (gratis)

> **Ya publicada:** https://arco310.github.io/emergencias-uco/ (repositorio `Arco310/emergencias-uco`: código en la rama `main`, aplicación compilada en la rama `gh-pages`).
> **Para publicar una versión nueva:** ejecuta `node build.mjs` y sustituye el contenido de la rama `gh-pages` por el de `dist/app/`. GitHub Pages la sirve en 1–2 minutos; los móviles pueden tardar hasta 10 minutos en verla (caché) y avisan con «Nueva versión disponible», que se aplica al volver a abrir la aplicación.

### Opción A — GitHub Pages (recomendada)
1. Crea una cuenta en github.com y un repositorio nuevo (por ejemplo `emergencias-uco`).
2. Sube **el contenido** de la carpeta `dist/app/` a la raíz del repositorio (botón *Add file → Upload files*; incluye `index.html`, `sw.js`, `manifest.webmanifest`, la carpeta `icons/` y el archivo `.nojekyll`).
3. En el repositorio: *Settings → Pages → Build and deployment → Deploy from a branch*, rama `main`, carpeta `/ (root)` → *Save*.
4. En 1–2 minutos estará en `https://TU_USUARIO.github.io/emergencias-uco/`.

> El repositorio puede ser público: la aplicación no contiene datos ni claves. Los datos de los preventivos nunca salen del dispositivo salvo cifrados hacia tu propio servidor de sincronización.

### Opción B — Netlify
1. Entra en app.netlify.com → *Add new site → Deploy manually*.
2. Arrastra la carpeta `dist/app/` (desde un ordenador). Obtendrás una dirección `https://nombre.netlify.app`.

### Opción C — Tu propio servidor
El servidor de sincronización también sirve la aplicación (`--static`), así todo queda en una sola dirección (ver apartado 2).

## 2. Servidor de sincronización (modalidad compartida)

Requisitos: un equipo con Node.js 18+ accesible por **HTTPS** desde los dispositivos.

```bash
node server/server.mjs --port 8443 --data /ruta/datos --static dist/app
```

Parámetros: `--port` (puerto), `--data` (carpeta donde se guardan las operaciones cifradas), `--static` (opcional: sirve la aplicación), `--cert`/`--key` (HTTPS directo con certificado), `--origins` (dominios permitidos, por defecto todos; p. ej. `https://usuario.github.io`), `--host`.

Formas de exponerlo con HTTPS:

| Opción | Coste | Notas |
|---|---|---|
| PC u ordenador de la base + **Cloudflare Tunnel** | Gratis | `cloudflared tunnel --url http://localhost:8443` crea una dirección HTTPS. El PC debe estar encendido y con Internet. |
| **VPS** (Hetzner, OVH, Contabo…) + **Caddy** | ~4–6 €/mes | Caddy obtiene el certificado automáticamente: `sync.tudominio.es { reverse_proxy localhost:8443 }`. Necesitas un dominio (~10 €/año). |
| Certificado propio | — | `--cert cert.pem --key key.pem`. |

Ejecución permanente en Linux (systemd), ejemplo `/etc/systemd/system/uco-sync.service`:
```ini
[Unit]
Description=Gestor UCO - sincronización
After=network.target
[Service]
ExecStart=/usr/bin/node /opt/uco/server/server.mjs --port 8443 --data /var/lib/uco --static /opt/uco/dist/app --host 127.0.0.1
Restart=always
User=uco
[Install]
WantedBy=multi-user.target
```

**Importante**
- El servidor solo guarda datos **cifrados de extremo a extremo**: no puede leerlos. Haz copia de la carpeta `--data` igualmente.
- Si el servidor cae, los dispositivos **siguen trabajando** y se sincronizan al volver. No es un punto único de fallo para la operativa.
- Sin Internet en el lugar del preventivo, usa **Sincronización → Exportar/Importar paquete** (Bluetooth, USB, mensajería).
- Una aplicación publicada en HTTPS no puede conectar con un servidor `http://192.168.x.x` de la red local (lo bloquea el navegador). Usa una dirección HTTPS.

## 3. Instalar en los teléfonos y tablets Android

1. Abre la dirección HTTPS en **Chrome**.
2. Menú ⋮ → **Instalar aplicación** (o *Añadir a pantalla de inicio*). También desde la app: *Sistema → Permisos del dispositivo → Instalar*.
3. Abre la aplicación instalada **una vez con conexión** para que quede guardada para el uso sin conexión.
4. En *Sistema → Permisos del dispositivo* concede: **almacenamiento persistente** (evita borrados por falta de espacio), **ubicación**, **notificaciones** y **pantalla encendida**.

## 4. Actualizar a una nueva versión

1. Haz una **copia completa cifrada** en cada dispositivo (*Sistema → Copias de seguridad → Exportar*), por precaución.
2. Sustituye los archivos publicados por los nuevos de `dist/app/`.
3. Los dispositivos descargan la nueva versión en segundo plano y la aplican al volver a abrir la aplicación (aparece un aviso). Los datos se conservan: las migraciones del almacenamiento son automáticas y están documentadas en la documentación técnica.
4. Para el servidor: detén el proceso, sustituye `server/server.mjs` y vuelve a arrancarlo. Los datos de `--data` se conservan.

## 5. Costes y servicios externos

| Servicio | Uso | Coste |
|---|---|---|
| GitHub Pages / Netlify | Alojamiento de la aplicación | Gratis |
| Google Maps (mapa incrustado y enlaces, **sin clave de API**) | Ver una dirección en un mapa real | Gratis; requiere Internet |
| OpenStreetMap (mapa incrustado alternativo, con coordenadas) | Alternativa si el mapa de Google no se muestra | Gratis; requiere Internet |
| OpenStreetMap Nominatim | Buscar coordenadas de una dirección | Gratis (máx. 1 consulta/segundo) |
| Servidor de sincronización propio | Modalidad compartida | Gratis en un PC propio; VPS ~4–6 €/mes si se desea 24 h |

No se usa ningún servicio de pago ni se envían datos a terceros.
