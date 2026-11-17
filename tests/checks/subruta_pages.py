#!/usr/bin/env python3
"""Comprueba la aplicación publicada en una subcarpeta, como en GitHub Pages
(https://usuario.github.io/emergencias-uco/): instalación, service worker con el
ámbito correcto, arranque sin conexión y flujo básico con datos persistentes.
Uso: python3 tests/checks/subruta_pages.py [URL]
Sin URL, sirve dist/app en http://127.0.0.1:8660/emergencias-uco/ con un servidor estático."""
import json, os, shutil, subprocess, sys, tempfile, time, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'e2e'))
import run_e2e as E
from playwright.sync_api import sync_playwright

OUT = []
def res(name, ok, detail=''):
    OUT.append({'comprobacion': name, 'resultado': 'CORRECTA' if ok else 'A REVISAR', 'detalle': detail})
    print(('  ✔ ' if ok else '  ⚠ ') + name + (' — ' + detail if detail else ''), flush=True)

def main():
    url = sys.argv[1] if len(sys.argv) > 1 else ''
    tmp = srv = None
    if not url:
        port = 8660
        tmp = tempfile.mkdtemp(prefix='uco-pages-')
        shutil.copytree(os.path.join(E.ROOT, 'dist', 'app'), os.path.join(tmp, 'emergencias-uco'))
        srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(port), '--bind', '127.0.0.1', '--directory', tmp], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        url = f'http://127.0.0.1:{port}/emergencias-uco/'
        for _ in range(50):
            try: urllib.request.urlopen(url, timeout=1); break
            except Exception: time.sleep(0.2)
    if not url.endswith('/'): url += '/'
    print('URL comprobada:', url)
    try:
        with sync_playwright() as p:
            udir = tempfile.mkdtemp(prefix='uco-perfil-')
            ctx = p.chromium.launch_persistent_context(udir, executable_path=E.CHROME, args=['--no-sandbox'], locale='es-ES', **E.PHONE)
            pg = ctx.pages[0] if ctx.pages else ctx.new_page()
            errores = []
            pg.on('pageerror', lambda e: errores.append(str(e)))
            pg.goto(url); pg.wait_for_selector('#app :is(.auth-box, .top, .splash)', timeout=20000)
            scope = pg.evaluate('() => navigator.serviceWorker.ready.then(r => r.scope)')
            pg.reload(); pg.wait_for_timeout(1500)
            res('Service worker registrado en la subcarpeta', scope == url, 'ámbito ' + scope)
            res('Service worker controla la página', pg.evaluate('() => !!navigator.serviceWorker.controller'))
            cdp = ctx.new_cdp_session(pg)
            errs = cdp.send('Page.getInstallabilityErrors').get('installabilityErrors', [])
            res('Instalable como aplicación desde la subcarpeta', not errs, 'sin errores de instalabilidad' if not errs else json.dumps(errs)[:200])
            man = cdp.send('Page.getAppManifest')
            res('Manifiesto encontrado y válido', not man.get('errors') and 'Gestor de Emergencias UCO' in man.get('data', ''), man.get('url') or '')
            # Sin conexión: la aplicación debe abrir igualmente (modo avión)
            ctx.set_offline(True)
            pg.reload(); pg.wait_for_selector('#app :is(.auth-box, .top, .splash)', timeout=15000)
            res('Abre sin conexión (modo avión)', pg.locator('#app .auth-box').count() > 0, 'pantalla de alta visible sin red')
            ctx.set_offline(False)
            res('Sin errores de JavaScript', not errores, '; '.join(errores)[:200])
            ctx.close(); shutil.rmtree(udir, ignore_errors=True)
            # Flujo básico en la subcarpeta: alta, preventivo, unidad y persistencia tras recargar
            E.URL = url
            b = p.chromium.launch(executable_path=E.CHROME, args=['--no-sandbox'])
            A = E.App(b, 'pages', E.PHONE)
            A.setup('Ana', 'ana', 'secreto1', 'Móvil', 'M1'); A.perms(False)
            A.new_prev('Prueba Pages'); A.new_unit('U1', 'Uno', 'rt_svb', 'sec_1')
            A.pg.reload(); A.login('ana', 'secreto1'); A.pg.wait_for_selector('.kpis', timeout=20000)
            n = A.state("return s.prev.nombre === 'Prueba Pages' && Object.values(s.units).some(u => u.ind === 'U1');")
            res('Alta, preventivo y unidad se guardan y siguen tras recargar', bool(n) and not A.errors, 'datos cifrados en el dispositivo' + ('; ' + '; '.join(A.errors)[:150] if A.errors else ''))
            b.close()
    finally:
        if srv: srv.terminate()
        if tmp: shutil.rmtree(tmp, ignore_errors=True)
    ok = all(r['resultado'] == 'CORRECTA' for r in OUT)
    print(f"\n{sum(r['resultado'] == 'CORRECTA' for r in OUT)}/{len(OUT)} comprobaciones correctas")
    with open(os.path.join(os.path.dirname(__file__), 'resultados-subcarpeta.json'), 'w', encoding='utf-8') as f:
        json.dump({'url': url, 'fecha': time.strftime('%Y-%m-%d %H:%M'), 'resultados': OUT}, f, ensure_ascii=False, indent=1)
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()
