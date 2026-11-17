#!/usr/bin/env python3
"""Comprueba en vivo (con Internet) los mapas y la búsqueda de coordenadas dentro de la
aplicación publicada: búsqueda gratuita de OpenStreetMap (Nominatim), mapa de Google sin
clave, mapa de OpenStreetMap y vista «Mapa» del preventivo. Guarda capturas para revisarlas.
Uso: python3 tests/checks/mapas_en_vivo.py https://usuario.github.io/emergencias-uco/"""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'e2e'))
import run_e2e as E
from playwright.sync_api import sync_playwright

OUT = []; HERE = os.path.dirname(__file__); SHOTS = os.path.join(HERE, 'capturas-mapas')
def res(name, ok, detail=''):
    OUT.append({'comprobacion': name, 'resultado': 'CORRECTA' if ok else 'A REVISAR', 'detalle': detail})
    print(('  ✔ ' if ok else '  ⚠ ') + name + (' — ' + detail if detail else ''), flush=True)

def frame_with(pg, part, timeout=25):
    end = time.time() + timeout
    while time.time() < end:
        for f in pg.frames:
            if part in f.url: return f
        pg.wait_for_timeout(300)
    return None

def main():
    url = sys.argv[1] if len(sys.argv) > 1 else 'https://arco310.github.io/emergencias-uco/'
    if not url.endswith('/'): url += '/'
    px = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    px = {'proxy': {'server': px}} if px and not url.startswith(('http://127.0.0.1', 'http://localhost')) else {}
    os.makedirs(SHOTS, exist_ok=True)
    print('URL comprobada:', url)
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=E.CHROME, args=['--no-sandbox'], **px)
        E.URL = url
        A = E.App(b, 'mapas', E.TABLET)
        A.setup('Ana', 'ana', 'secreto1', 'Tablet', 'T1'); A.perms(False)
        A.new_prev('Prueba de mapas')
        A.nav('mas'); A.a('nav', v='mapa'); A.a('map.prevLoc')
        s = A.sheet()
        s.locator('#f_loctxt').fill('Mezquita-Catedral de Córdoba'); A.pg.wait_for_timeout(300)
        # 1. Búsqueda de coordenadas (Nominatim)
        A.a('loc.search', scope=s)
        try:
            s.locator('[data-a="loc.pick"]').first.wait_for(timeout=20000)
            nombre = s.locator('[data-a="loc.pick"]').first.inner_text().strip()
            res('Búsqueda de coordenadas (OpenStreetMap, gratuita)', True, nombre[:90])
            s.locator('[data-a="loc.pick"]').first.click(); A.pg.wait_for_timeout(500)
        except Exception as e:
            res('Búsqueda de coordenadas (OpenStreetMap, gratuita)', False, str(e).splitlines()[0][:150] + ' · ' + A.toast_text())
            s.locator('#f_lat').fill('37.879167'); s.locator('#f_lon').fill('-4.779444'); A.pg.wait_for_timeout(300)
        lat, lon = s.locator('#f_lat').input_value(), s.locator('#f_lon').input_value()
        # 2. Mapa de Google sin clave
        src = s.locator('.map-embed iframe').get_attribute('src') or ''
        g = frame_with(A.pg, 'google.com/maps')
        ok = False; det = src[:80]
        if g:
            try:
                g.wait_for_load_state('load', timeout=20000); A.pg.wait_for_timeout(6000)
                info = g.evaluate("() => ({ txt: document.body.innerText.slice(0, 200), imgs: document.images.length, canv: document.querySelectorAll('canvas').length, nodes: document.querySelectorAll('*').length })")
                bad = any(w in info['txt'] for w in ['rejected', 'error', 'Error', "can't load", 'no puede cargar'])
                ok = (info['imgs'] + info['canv']) > 0 and info['nodes'] > 50 and not bad
                det = f"{g.url[:70]}… · {info['nodes']} elementos, {info['imgs']} imágenes, {info['canv']} lienzos · texto: {info['txt'][:80]!r}"
            except Exception as e:
                det = 'marco de Google sin cargar: ' + str(e).splitlines()[0][:120]
        else:
            det = 'el marco no llegó a Google: ' + src[:80]
        s.screenshot(path=os.path.join(SHOTS, '1-google-editor.png'))
        res('Mapa de Google sin clave dentro de la aplicación', ok, det)
        # 3. Mapa de OpenStreetMap
        s.locator('input[name="mprov"][value="osm"]').check(force=True); A.pg.wait_for_timeout(500)
        s = A.sheet(); o = frame_with(A.pg, 'openstreetmap.org/export/embed')
        ok = False; det = ''
        if o:
            try:
                # OpenStreetMap usa hoy MapLibre (lienzo); versiones anteriores usaban Leaflet (teselas)
                o.wait_for_selector('.maplibregl-canvas, .leaflet-tile-loaded', timeout=25000); A.pg.wait_for_timeout(3000)
                info = o.evaluate("() => { const c = document.querySelector('.maplibregl-canvas'); return { lienzo: c ? c.width + 'x' + c.height : '', teselas: document.querySelectorAll('.leaflet-tile-loaded').length, marcador: document.querySelectorAll('.maplibregl-marker, .maplibre-gl-marker, .leaflet-marker-icon').length }; }")
                ok = (bool(info['lienzo']) and not info['lienzo'].startswith('0x')) or info['teselas'] > 0
                ok = ok and info['marcador'] > 0
                det = (f"mapa vectorial {info['lienzo']}" if info['lienzo'] else f"{info['teselas']} teselas") + ', marcador ' + ('visible' if info['marcador'] else 'ausente')
            except Exception as e:
                det = str(e).splitlines()[0][:150]
        else:
            det = 'el marco de OpenStreetMap no se cargó'
        s.screenshot(path=os.path.join(SHOTS, '2-osm-editor.png'))
        res('Mapa de OpenStreetMap dentro de la aplicación', ok, det)
        # 4. Guardar y vista «Mapa» del preventivo
        s.locator('form[data-f="loc.save"] button.primary').click(); A.pg.wait_for_timeout(800)
        lugar = A.state('return s.prev.lugar;') or {}
        A.pg.locator('input[name="mprov"][value="google"]').first.check(force=True); A.pg.wait_for_timeout(500)
        g2 = frame_with(A.pg, 'google.com/maps'); A.pg.wait_for_timeout(5000)
        A.pg.screenshot(path=os.path.join(SHOTS, '3-vista-mapa.png'))
        href = A.pg.locator('a:has-text("Abrir en Google Maps")').first.get_attribute('href') or ''
        res('Lugar del preventivo guardado y mostrado en «Mapa»', bool(lugar.get('lat')) and g2 is not None and 'google.com/maps/search/?api=1&query=' in href,
            f"{lugar.get('txt', '')[:40]} ({lugar.get('lat')}, {lugar.get('lon')}) · enlace {href[:70]}")
        res('Sin errores de JavaScript', not A.errors, '; '.join(A.errors)[:200])
        b.close()
    print(f"\n{sum(r['resultado'] == 'CORRECTA' for r in OUT)}/{len(OUT)} comprobaciones correctas")
    with open(os.path.join(HERE, 'resultados-mapas.json'), 'w', encoding='utf-8') as f:
        json.dump({'url': url, 'fecha': time.strftime('%Y-%m-%d %H:%M'), 'resultados': OUT}, f, ensure_ascii=False, indent=1)
    sys.exit(0 if all(r['resultado'] == 'CORRECTA' for r in OUT) else 1)

if __name__ == '__main__':
    main()
