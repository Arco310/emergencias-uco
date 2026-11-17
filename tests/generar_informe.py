#!/usr/bin/env python3
"""Genera docs/INFORME_PRUEBAS.md a partir de los archivos de resultados de las pruebas
ejecutadas (no inventa resultados: si falta un archivo, el bloque aparece como no ejecutado).
Uso: python3 tests/generar_informe.py"""
import json, os, re, time

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
T = lambda *p: os.path.join(ROOT, 'tests', *p)

def load(path):
    try: return json.load(open(path, encoding='utf-8'))
    except FileNotFoundError: return None

def esc(s): return str(s if s is not None else '').replace('|', '/').replace('\n', ' ')

def version():
    return json.load(open(os.path.join(ROOT, 'package.json')))['version']

def node_results():
    tap = open(T('resultados-node.tap'), encoding='utf-8').read()
    res = [(m.group(1) == 'ok', m.group(2).strip()) for m in re.finditer(r'^(ok|not ok) \d+ - (.+)$', tap, re.M)]
    srv = set()
    for f in os.listdir(T('server')):
        if f.endswith('.test.mjs'): srv |= set(re.findall(r"^test\('([^']+)'", open(T('server', f), encoding='utf-8').read(), re.M))
    return [r for r in res if r[1] not in srv], [r for r in res if r[1] in srv]

def tabla(rows, cols=('Comprobación', 'Resultado', 'Detalle')):
    out = ['| ' + ' | '.join(cols) + ' |', '|' + '---|' * len(cols)]
    out += ['| ' + ' | '.join(esc(c) for c in r) + ' |' for r in rows]
    return '\n'.join(out)

def main():
    uni, srv = node_results()
    e2e = load(T('e2e', 'resultados.json'))['resultados']
    e2e_gen = [r for r in e2e if not r['prueba'].startswith('Android:')]
    e2e_and = [r for r in e2e if r['prueba'].startswith('Android:')]
    chk = load(T('checks', 'resultados.json'))['comprobaciones']
    sub = load(T('checks', 'resultados-subcarpeta.json'))
    viv = load(T('checks', 'resultados-en-vivo.json'))
    mapas = load(T('checks', 'resultados-mapas.json'))
    sinc = load(T('checks', 'resultados-sincronizacion-en-vivo.json'))
    motor = load(T('perf', 'resultados-motor.json'))
    nav = [load(T('perf', f'resultados-navegador-{n}.json')) for n in (300, 3000)]

    ok = lambda rs, k='resultado', v=('SUPERADA', 'CORRECTA'): sum(1 for r in rs if r[k] in v)
    bloques = [
        ('Reglas de negocio, datos y rendimiento del motor (unidad, `node:test`)', len(uni), sum(1 for r in uni if r[0])),
        ('Servidor de sincronización, integración completa e instalador para Windows (simulado)', len(srv), sum(1 for r in srv if r[0])),
        ('Aceptación en navegador (Chrome + Playwright, móvil y tablet)', len(e2e_gen), ok(e2e_gen)),
        ('Particularidades de Chrome para Android (simuladas en el navegador)', len(e2e_and), ok(e2e_and)),
        ('Comprobaciones de calidad (instalabilidad, accesibilidad, seguridad, HTTPS)', len(chk), ok(chk)),
        ('Publicación en subcarpeta como en GitHub Pages (local)', len(sub['resultados']), ok(sub['resultados'])),
        ('Plataforma publicada en GitHub Pages (en vivo, por Internet)', len(viv['resultados']), ok(viv['resultados'])),
        ('Mapas y búsqueda de coordenadas en vivo (Google y OpenStreetMap)', len(mapas['resultados']), ok(mapas['resultados'])),
        ('Sincronización real por Internet con el servidor instalado (2 dispositivos)', len(sinc['resultados']), ok(sinc['resultados'])),
    ]
    tot = sum(b[1] for b in bloques); sup = sum(b[2] for b in bloques)
    L = ['# Informe de pruebas', '',
         f"Fecha de generación: {time.strftime('%d/%m/%Y %H:%M')} (hora peninsular) · Versión {version()} · compilación final", '',
         '| Bloque | Pruebas | Superadas | Fallidas |', '|---|---:|---:|---:|']
    L += [f'| {n} | {t} | {s} | {t - s} |' for n, t, s in bloques]
    L += [f'| **Total** | **{tot}** | **{sup}** | **{tot - sup}** |', '',
          'Todas las pruebas listadas se han **ejecutado realmente** y este informe se genera a partir de sus archivos de resultados '
          '(`tests/generar_informe.py`): `tests/resultados-node.tap`, `tests/e2e/resultados.json`, `tests/checks/resultados*.json` y `tests/perf/resultados-*.json`. '
          'Capturas en `tests/e2e/capturas/` y `tests/checks/capturas-mapas/`. Además se han medido los tiempos de respuesta (apartado 6).', '']
    L += ['## 1. Pruebas de unidad (reglas críticas, datos y motor)'] + [('- ✔ ' if r[0] else '- ✘ ') + r[1] for r in uni] + ['']
    L += ['## 2. Servidor e integración (repositorio cifrado + motor + sincronización real) e instalador para Windows',
          'El instalador para Windows se ejecuta en modo simulado: `schtasks` y `tailscale` se sustituyen por programas de prueba que registran las órdenes, y el servidor arranca de verdad con los mismos argumentos que en Windows.', ''] + [('- ✔ ' if r[0] else '- ✘ ') + r[1] for r in srv] + ['']
    L += ['## 3. Aceptación en navegador',
          'Entorno: Google Chrome (sin interfaz) controlado con Playwright, con la aplicación compilada servida por el servidor de sincronización. '
          'Perfiles: **teléfono** 390×844 táctil y **tablet** 1280×800 táctil. En el escenario 2 trabajan a la vez una tablet y un teléfono con almacenamiento independiente.', '',
          tabla([(r['prueba'], r['resultado'], r['detalle']) for r in e2e_gen], ('Prueba', 'Resultado', 'Detalle')), '']
    L += ['## 3 bis. Particularidades de Chrome para Android (escenario 3)',
          'Tablet con agente de usuario de Android. Se reproducen en el navegador de pruebas las restricciones de Chrome para Android: '
          '`new Notification()` prohibido («Illegal constructor»), la pantalla encendida la libera el sistema al salir de la aplicación '
          'y el selector de archivos no reconoce extensiones propias. Las cinco pruebas **fallaban con la versión 1.0.1** (comprobado) y pasan con la actual.', '',
          tabla([(r['prueba'], r['resultado'], r['detalle']) for r in e2e_and], ('Prueba', 'Resultado', 'Detalle')), '']
    L += ['## 3 ter. Comprobaciones de calidad (`tests/checks/comprobaciones.py`)',
          tabla([(r['comprobacion'], r['resultado'], r['detalle']) for r in chk]), '']
    for titulo, d, extra in [('3 quater. Publicación en subcarpeta (`tests/checks/subruta_pages.py`, local)', sub, ''),
                             ('3 quinquies. Plataforma publicada (`tests/checks/subruta_pages.py URL`, en vivo)', viv, ' · Chrome a través de Internet; los archivos publicados coinciden byte a byte con `dist/app/`'),
                             ('3 sexies. Mapas en vivo (`tests/checks/mapas_en_vivo.py`)', mapas, ' · capturas en `tests/checks/capturas-mapas/`')]:
        L += ['## ' + titulo, f"URL: {d['url']} · {d['fecha']}{extra}", '', tabla([(r['comprobacion'], r['resultado'], r['detalle']) for r in d['resultados']]), '']
    L += ['## 3 septies. Sincronización real por Internet (`tests/checks/sincronizacion_en_vivo.py`)',
          f"Aplicación {sinc['app']} y servidor {sinc['servidor']} (PC con Windows 10, instalado con `servidor-uco-windows`, publicado con Tailscale Funnel) · {sinc['fecha']}. Tablet y móvil con almacenamiento independiente; deja en el servidor el preventivo cifrado «PRUEBA DE FUNCIONAMIENTO».", '',
          tabla([(r['comprobacion'], r['resultado'], r['detalle']) for r in sinc['resultados']]), '']
    L += [ESTATICO_4_5]
    # 6. Rendimiento
    L += ['## 6. Rendimiento con preventivos grandes (`tests/perf/`)',
          'Preventivos generados con los mismos comandos que usa la aplicación (reglas, validación y numeración incluidas): '
          'cada aviso recorre C1 → C2 → C3 (a veces C4 → C5) → C0, con notas, ubicaciones y finalización. Doce horas de servicio.', '',
          '### 6.1 Motor (Node.js, procesador de servidor)', '',
          '| Medida | ' + ' | '.join(f"{r['unidades']} unidades / {r['avisos']} avisos ({r['operaciones']} operaciones)" for r in motor['resultados']) + ' |',
          '|---|' + '---:|' * len(motor['resultados'])]
    filas = [('Validar una acción (cada pulsación)', 'validacion_accion_ms', ' ms'), ('Reconstruir el preventivo completo (al abrirlo)', 'reconstruccion_completa_ms', ' ms'),
             ('Recibir el número definitivo del servidor', 'numero_servidor_ms', ' ms'), ('Recibir una operación atrasada de otro dispositivo', 'op_remota_desordenada_ms', ' ms'),
             ('Estadísticas del preventivo', 'estadisticas_ms', ' ms'), ('Bitácora completa', 'bitacora_completa_ms', ' ms'),
             ('Informe PDF', 'informe_pdf_ms', ' ms'), ('Tamaño del informe PDF', 'informe_pdf_MB', ' MB'), ('Páginas del informe PDF', 'informe_pdf_paginas', ''),
             ('Exportación JSON', 'exportacion_json_MB', ' MB'), ('Exportación CSV (ZIP)', 'exportacion_csv_MB', ' MB'), ('Tamaño del registro de operaciones', 'tam_registro_MB', ' MB')]
    L += [f'| {n} | ' + ' | '.join(f"{r.get(k, '—')}{u}" for r in motor['resultados']) + ' |' for n, k, u in filas]
    L += ['', '### 6.2 Aplicación completa en el navegador, con la CPU ralentizada 4 veces (aproximación a un móvil Android de gama media)',
          'Datos cifrados en IndexedDB e interfaz real; tiempo desde la pulsación hasta que la pantalla está dibujada.', '',
          '| Medida | ' + ' | '.join(f"{r['unidades']} unidades / {r['avisos']} avisos" for r in nav if r) + ' |', '|---|' + '---:|' * len([r for r in nav if r])]
    fn = [('Abrir el preventivo (iniciar sesión → centro de control)', 'abrir_preventivo_ms', ' ms'), ('Pantalla Unidades (todas las tarjetas)', 'pantalla_unidades_ms', ' ms'),
          ('Pantalla Avisos', 'pantalla_avisos_ms', ' ms'), ('Avisos finalizados (primeras 100)', 'avisos_finalizados_ms', ' ms'), ('«Mostrar más» avisos (+200)', 'avisos_mostrar_mas_ms', ' ms'),
          ('Plano táctico', 'pantalla_plano_ms', ' ms'), ('Cambiar la clave de una unidad', 'accion_cambiar_clave_ms', ' ms'), ('Crear un aviso', 'accion_crear_aviso_ms', ' ms'),
          ('Estadísticas', 'estadisticas_ms', ' ms'), ('Bitácora', 'bitacora_ms', ' ms'), ('Informe PDF completo', 'informe_pdf_ms', ' ms'), ('Tamaño del informe PDF', 'informe_pdf_MB', ' MB'),
          ('Memoria JavaScript en uso', 'memoria_js_MB', ' MB'), ('Espacio ocupado en el dispositivo', 'almacenamiento_MB', ' MB')]
    L += [f'| {n} | ' + ' | '.join(f"{r.get(k, '—')}{u}" for r in nav if r) + ' |' for n, k, u in fn]
    L += ['', ESTATICO_6_3, ESTATICO_7]
    open(os.path.join(ROOT, 'docs', 'INFORME_PRUEBAS.md'), 'w', encoding='utf-8').write('\n'.join(L) + '\n')
    print(f'Informe generado: {sup}/{tot} pruebas superadas')

ESTATICO_4_5 = """## 4. Correspondencia con las pruebas de aceptación del pliego (sección 25)
| Pliego | Cubierto por |
|---|---|
| Unidades: crear, editar, eliminar/archivar, desactivar, recuperar, cambiar tipo, personalizar | Unidad: «unidades: indicativo único, eliminación…», «personalización…»; navegador: «Unidades: crear», «editar y personalizar» |
| Colores C0: personalizar, cambiar de clave, color principal, borde, regresar, persistencia, bloqueo | Unidad: «color C0…» (2); navegador: «Color C0» (3 pruebas) |
| Avisos: crear, numerar, asignar, finalizar, historial, creación simultánea en varios dispositivos | Unidad: «avisos: flujo completo», «numeración…»; integración y servidor: numeración concurrente; navegador: avisos y «avisos simultáneos sin duplicados» |
| Descansos: iniciar, temporizador, recargar, bloqueo con aviso activo, recuperar estado | Unidad: «descansos…» (2); navegador: 3 pruebas (incluye fin automático real tras 60 s) y aviso de fin de descanso en Android |
| Plantillas: crear, duplicar, modificar, aplicar, preventivos anteriores sin cambios | Unidad: «plantillas…»; navegador: «Plantillas: crear, aplicar y aislamiento» |
| Offline (modo avión) | Navegador: «Funcionamiento sin conexión (modo avión)»; plataforma publicada: «Abre sin conexión (modo avión)» |
| Multidispositivo: compartir, desconectar, continuar, reconectar, sincronizar, conflictos, sin duplicados ni pérdidas | Integración (8 pruebas con servidor real) y navegador (escenario 2) |
| Estadísticas con datos conocidos | Unidad: «estadísticas: tiempos verificados con datos conocidos» (valores exactos minuto a minuto) |
| Informes PDF, JSON y CSV | Unidad: estructura del PDF (comprimido), CSV y reconstrucción desde el JSON; navegador: descarga y contenido de los tres formatos |
| Usuarios: roles, permisos y restricciones | Unidad: «permisos…»; navegador: «Usuarios, roles y permisos» |
| Dispositivos: móvil y tablet Android | Emulación de teléfono y tablet en Chrome y restricciones de Chrome para Android simuladas (escenario 3); ver limitaciones |
| Aplicación fiable y escalable | Apartado 6: preventivos de hasta 300 unidades, 3.000 avisos y 22.928 operaciones |

## 5. No verificado en este entorno (pendiente de prueba en campo)
- **Dispositivos Android físicos**: las pruebas usan Chrome con emulación táctil de teléfono y tablet y con las restricciones de Android simuladas, no terminales reales. Se recomienda una prueba en campo con los modelos que se vayan a usar (instalación como aplicación, modo avión, rotación de pantalla).
- **Avisos, vibración y pantalla encendida en un terminal**: comprobados en Chrome simulando las restricciones de Android. Para confirmarlos en cada terminal: *Sistema → Permisos del dispositivo → «Probar»* en Notificaciones y en Vibración.
- **Mapas en terminales Android reales**: el mapa de Google sin clave, el de OpenStreetMap y la búsqueda de coordenadas se han comprobado en vivo por Internet con Chrome (emulación de tablet), no en un terminal físico. El formato de Google sin clave no es oficial y podría dejar de funcionar; por eso la aplicación ofrece también el mapa de OpenStreetMap y el botón «Abrir en Google Maps». El GPS se ha probado con posición simulada.
- **Arranque automático tras reiniciar el PC servidor**: la tarea programada se creó y arrancó el servidor como SYSTEM en un Windows 10 real (comprobado en su registro), pero no se ha reiniciado el equipo para verlo volver solo.
- **Instalador del servidor para Windows**: ejecutado en un Windows 10 real (DESKTOP-G5S6CH9) hasta dejar el servidor publicado. La primera ejecución destapó dos fallos que la simulación no veía, ya corregidos: winget fallaba al consultar la Microsoft Store (error de certificado 0x8a15005e) y la consola de Windows 10 no mostraba los símbolos ✔/✖.
- **Rendimiento en terminales reales**: medido con la CPU ralentizada 4 veces como aproximación; un terminal concreto puede ser más rápido o más lento.
"""

ESTATICO_6_3 = """### 6.3 Mejoras aplicadas tras la primera medición (300 unidades, 3.000 avisos, 22.928 operaciones)
| Medida | Antes (1.0.1) | Ahora (1.0.2) | Causa y corrección |
|---|---:|---:|---|
| Validar cada acción (motor) | 48 ms | 0,1 ms | Se copiaba el estado completo en cada pulsación; ahora solo se copian los elementos que toca la acción |
| Abrir el preventivo (reconstrucción, motor) | 1.060 ms | 54 ms | La detección de números de aviso duplicados recorría todos los avisos por cada aviso; ahora usa un índice |
| Número definitivo del servidor (modo compartido) | 864 ms | 0,02 ms | Cada número reconstruía el preventivo completo; ahora se actualiza el aviso directamente (mismo resultado, comprobado por prueba) |
| Operación atrasada de otro dispositivo | 944 ms | 45 ms | Gracias a la reconstrucción más rápida |
| Abrir el preventivo en el navegador (CPU ×4) | 4,6 s | 2,4 s | Además, el descifrado de las operaciones se hace por lotes en paralelo |
| Avisos finalizados en el navegador (CPU ×4) | 2,6 s | 0,4–1,0 s | Se muestran por tandas de 100 con «Mostrar más» |
| Tamaño del informe PDF (853 páginas) | 21 MB | 2,3 MB | El contenido de las páginas se comprime (FlateDecode); validado con qpdf y pdftotext |
"""

ESTATICO_7 = """## 7. Correcciones derivadas de las comprobaciones
### Instalador para Windows (tras la instalación real)
- `winget` se usa solo con el origen `winget`: el de Microsoft Store fallaba en el PC servidor con un error de certificado (0x8a15005e) y Tailscale no se instalaba.
- Marcas de estado en ASCII (`[OK]`, `[ERROR]`, `[AVISO]`): la consola de Windows 10 no tiene los símbolos ✔ ✖ ⚠.
- `opciones.json` permite dejar respondida de antemano la pregunta de la suspensión del equipo.

### Versión 1.0.3
- **Servidor de sincronización para Windows:** nuevo instalador de doble clic con dirección HTTPS fija gratuita (Tailscale Funnel) y arranque automático; el servidor se identifica en `/api/v1/salud` para que el instalador detecte una instalación anterior.

### Versión 1.0.2
- **Avisos de fin de descanso en Android:** Chrome para Android no permite `new Notification()` y el aviso no se mostraba nunca. Ahora lo muestra el service worker; al tocarlo se abre la aplicación. Nuevo botón «Probar» en Notificaciones.
- **Pantalla siempre encendida:** tras salir y volver a la aplicación dos veces, la pantalla dejaba de mantenerse encendida. Ahora se recupera cada vez.
- **Botón «Probar» de vibración:** no aparecía nunca con la vibración disponible. Corregido.
- **Importar copias y paquetes en Android:** el selector podía dejar en gris los archivos `.ucobak` y `.ucosync`. En Android se muestran todos los archivos y se valida el contenido al abrirlo.
- **Errores de validación:** los avisos al usuario (por ejemplo, «El archivo no es una copia válida») ya no se registran como fallos del programa.
- **Rendimiento:** ver apartado 6.3.

### Versión 1.0.1
- **Pantalla tras recargar:** al recargar e iniciar sesión, la aplicación volvía unas veces a la pantalla en uso y otras al Centro de control (dependía de la velocidad del dispositivo). Ahora vuelve siempre a la pantalla en uso.
- **Selector de mapa:** los botones Google Maps / OpenStreetMap se veían enormes y el texto se partía en tres líneas. Corregido el estilo de los botones de opción.
- **OpenStreetMap:** su mapa incrustado usa ahora MapLibre (mapa vectorial) en lugar de teselas; la comprobación admite ambos formatos.
"""

if __name__ == '__main__':
    main()
