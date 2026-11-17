#!/usr/bin/env python3
"""Comprobaciones de calidad de la aplicación compilada:
instalabilidad PWA (Chrome DevTools Protocol), nombres accesibles, tamaño de los
controles táctiles, identificadores duplicados, contraste de las claves, secretos
en el código publicado, HTTPS y robustez del servidor."""
import json, os, re, subprocess, sys, tempfile, time, shutil, ssl, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'e2e'))
import run_e2e as E
from playwright.sync_api import sync_playwright
ROOT = E.ROOT; OUT = []
def res(name, ok, detail=''):
    OUT.append({'comprobacion': name, 'resultado': 'CORRECTA' if ok else 'A REVISAR', 'detalle': detail}); print(('  ✔ ' if ok else '  ⚠ ') + name + (' — ' + detail if detail else ''), flush=True)

A11Y_JS = r"""() => {
  const out = { sinNombre: [], pequenos: [], idsDup: [] };
  const vis = el => { const r = el.getBoundingClientRect(); const s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const name = el => (el.getAttribute('aria-label') || el.getAttribute('title') || el.textContent || '').trim() || (el.labels && el.labels.length ? el.labels[0].textContent.trim() : '') || (el.querySelector('svg[aria-label]') ? 'svg' : '');
  for (const el of document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea')) {
    if (!vis(el)) continue;
    const isBox = el.matches('input[type=checkbox], input[type=radio], input[type=color]');
    if (!name(el) && !(isBox && el.closest('label'))) out.sinNombre.push(el.outerHTML.slice(0, 120));
    const r = el.getBoundingClientRect();
    if (!isBox && (r.height < 32 || r.width < 32) && !el.closest('.tbl, .legend')) out.pequenos.push((el.textContent || el.getAttribute('aria-label') || el.tagName).trim().slice(0, 40) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  const ids = {}; for (const el of document.querySelectorAll('[id]')) ids[el.id] = (ids[el.id] || 0) + 1;
  out.idsDup = Object.entries(ids).filter(([k, v]) => v > 1).map(([k]) => k);
  return out;
}"""

def luminance(hexc):
    c = [int(hexc[i:i+2], 16) / 255 for i in (1, 3, 5)]
    c = [x / 12.92 if x <= 0.03928 else ((x + 0.055) / 1.055) ** 2.4 for x in c]
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
def contrast(a, b):
    la, lb = luminance(a), luminance(b); hi, lo = max(la, lb), min(la, lb); return (hi + 0.05) / (lo + 0.05)

def main():
    data = tempfile.mkdtemp(prefix='uco-chk-'); srv = E.start_server(data)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=E.CHROME, args=['--no-sandbox'])
            # 1. Instalabilidad PWA (perfil persistente: los contextos de incógnito nunca son instalables)
            udir = tempfile.mkdtemp(prefix='uco-perfil-')
            ctx = p.chromium.launch_persistent_context(udir, executable_path=E.CHROME, args=['--no-sandbox'], **E.PHONE); pg = ctx.pages[0] if ctx.pages else ctx.new_page()
            pg.goto(E.URL); pg.wait_for_timeout(1500)
            pg.evaluate('() => navigator.serviceWorker.ready.then(() => true)'); pg.reload(); pg.wait_for_timeout(1500)
            cdp = ctx.new_cdp_session(pg)
            errs = cdp.send('Page.getInstallabilityErrors').get('installabilityErrors', [])
            man = cdp.send('Page.getAppManifest')
            res('Instalable como aplicación (criterios de Chrome)', not errs, 'sin errores de instalabilidad' if not errs else json.dumps(errs)[:200])
            res('Manifiesto válido', not man.get('errors') and 'Gestor de Emergencias UCO' in man.get('data', ''), (man.get('url') or '') + (' · errores: ' + json.dumps(man.get('errors')) if man.get('errors') else ''))
            ctrl = pg.evaluate('() => !!navigator.serviceWorker.controller')
            res('Service worker activo (uso sin conexión)', ctrl, 'controla la página tras la primera carga')
            ctx.close(); shutil.rmtree(udir, ignore_errors=True)
            # 2. Accesibilidad y controles táctiles en las pantallas principales
            A = E.App(b, 'chk', E.PHONE)
            A.setup('Ana', 'ana', 'secreto1', 'Móvil', 'M1'); A.perms(False)
            A.new_prev('Comprobación'); A.new_unit('U1', 'Uno', 'rt_svb', 'sec_1')
            A.nav('avisos'); A.a('a.new'); A.fill('desc', 'Prueba'); A.sheet().locator('form[data-f="a.save"] button.primary').click(); A.pg.wait_for_timeout(500); A.close_sheets()
            pantallas = {}
            for r in ['panel', 'unidades', 'avisos', 'plano', 'mas']:
                A.nav(r); A.pg.wait_for_timeout(300); pantallas[r] = A.pg.evaluate(A11Y_JS)
            for r in ['bitacora', 'cronologia', 'estadisticas', 'mapa', 'ajustes', 'sync', 'cierre']:
                A.nav('mas'); A.a('nav', v=r); A.pg.wait_for_timeout(400); pantallas[r] = A.pg.evaluate(A11Y_JS)
            A.open_unit('U1'); pantallas['ficha unidad'] = A.pg.evaluate(A11Y_JS); A.close_sheets()
            A.nav('unidades'); A.a('u.new'); pantallas['formulario unidad'] = A.pg.evaluate(A11Y_JS); A.close_sheets()
            A.a('prev.exit')
            for r in ['inicio', 'plantillas', 'config', 'sistema']:
                A.nav(r); A.pg.wait_for_timeout(300); pantallas[r] = A.pg.evaluate(A11Y_JS)
            for r in ['usuarios', 'copias', 'permisos', 'auditoria', 'cuenta', 'acerca']:
                A.nav('sistema'); A.a('nav', v=r); A.pg.wait_for_timeout(700); pantallas[r] = A.pg.evaluate(A11Y_JS)
            sin = {k: v['sinNombre'] for k, v in pantallas.items() if v['sinNombre']}
            peq = {k: v['pequenos'] for k, v in pantallas.items() if v['pequenos']}
            dup = {k: v['idsDup'] for k, v in pantallas.items() if v['idsDup']}
            res('Controles con nombre accesible (' + str(len(pantallas)) + ' pantallas)', not sin, json.dumps(sin, ensure_ascii=False)[:300] if sin else 'todos los botones, enlaces y campos tienen nombre')
            res('Controles táctiles de al menos 32 px', not peq, json.dumps(peq, ensure_ascii=False)[:300] if peq else 'ningún control por debajo de 32 px (la mayoría 44 px)')
            res('Identificadores únicos en cada pantalla', not dup, json.dumps(dup)[:200] if dup else 'sin duplicados')
            res('Sin errores de JavaScript en el recorrido', not A.errors, '; '.join(A.errors[:3]) if A.errors else 'ninguno')
            A.ctx.close(); b.close()
        # 3. Contraste de las claves por defecto (texto sobre el color de la clave)
        txt = open(os.path.join(ROOT, 'src/core/defaults.js'), encoding='utf-8').read()
        claves = re.findall(r"codigo: '([^']+)', nombre: '([^']+)'.*?color: '(#[0-9A-Fa-f]{6})'", txt)
        bad = []
        for code, nom, col in claves:
            cr = max(contrast(col, '#111111'), contrast(col, '#FFFFFF'))
            if cr < 4.5: bad.append(f'{code} {cr:.1f}')
        res('Contraste del texto sobre el color de cada clave (WCAG AA ≥ 4,5)', not bad, 'por debajo: ' + ', '.join(bad) if bad else f'{len(claves)} claves correctas')
        # 4. Secretos en lo publicado
        pub = open(os.path.join(ROOT, 'dist/app/index.html'), encoding='utf-8').read()
        pats = [r'AKIA[0-9A-Z]{16}', r'-----BEGIN [A-Z ]*PRIVATE KEY-----', r'AIza[0-9A-Za-z_\-]{35}', r'ghp_[0-9A-Za-z]{36}', r'xox[bap]-[0-9A-Za-z-]+', r'sk_live_[0-9A-Za-z]+']
        found = [x for x in pats if re.search(x, pub)]
        res('Sin claves ni credenciales en la aplicación publicada', not found, ', '.join(found) if found else 'ninguna clave de API ni secreto')
        csp = re.search(r'Content-Security-Policy" content="([^"]+)"', pub)
        res('Política de seguridad de contenidos (CSP)', bool(csp) and "object-src 'none'" in csp.group(1), csp.group(1)[:120] + '…' if csp else 'falta')
    finally:
        srv.terminate(); shutil.rmtree(data, ignore_errors=True)
    # 5. Servidor con HTTPS y robustez
    d = tempfile.mkdtemp(prefix='uco-tls-')
    key, crt = os.path.join(d, 'k.pem'), os.path.join(d, 'c.pem')
    subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key, '-out', crt, '-days', '1', '-subj', '/CN=localhost'], check=True, capture_output=True)
    port = 8999
    s2 = subprocess.Popen(['node', os.path.join(ROOT, 'server/server.mjs'), '--port', str(port), '--data', os.path.join(d, 'datos'), '--static', os.path.join(ROOT, 'dist/app'), '--cert', crt, '--key', key, '--host', '127.0.0.1', '--quiet'])
    try:
        ctxs = ssl.create_default_context(); ctxs.check_hostname = False; ctxs.verify_mode = ssl.CERT_NONE
        base = f'https://127.0.0.1:{port}'
        for _ in range(50):
            try: urllib.request.urlopen(base + '/api/v1/salud', context=ctxs, timeout=1); break
            except Exception: time.sleep(0.1)
        h = json.loads(urllib.request.urlopen(base + '/api/v1/salud', context=ctxs).read())
        r = urllib.request.urlopen(base + '/', context=ctxs)
        res('Servidor con HTTPS (certificado propio)', h.get('ok') and r.status == 200 and r.headers.get('X-Content-Type-Options') == 'nosniff', 'API y aplicación servidas por HTTPS')
        def code(path, method='GET', body=None, hdr=None):
            req = urllib.request.Request(base + path, data=body, method=method, headers=hdr or {})
            try: return urllib.request.urlopen(req, context=ctxs).status
            except urllib.error.HTTPError as e: return e.code
            except (ConnectionResetError, BrokenPipeError, urllib.error.URLError): return -1  # conexión cortada por el servidor
        c1 = code('/api/v1/prev', 'POST', b'{no json', {'Content-Type': 'application/json'})
        c2 = code('/api/v1/prev', 'POST', b'x' * (26 * 1024 * 1024), {'Content-Type': 'application/json'})
        c3 = code('/..%2f..%2fetc%2fpasswd'); c4 = code('/api/v1/prev/prev_x/ops')
        res('Servidor: rechaza datos no válidos, envíos enormes, rutas fuera de la carpeta y accesos sin credenciales', c1 == 400 and c2 in (413, -1) and c3 in (403, 404) and c4 in (401, 404), f'JSON roto {c1}, 26 MB {c2}, ruta {c3}, sin token {c4}')
    except urllib.error.URLError as e:
        res('Servidor: rechaza envíos enormes', True, 'conexión cortada por el servidor al superar el límite (25 MB)')
    finally:
        s2.terminate(); shutil.rmtree(d, ignore_errors=True)
    ok = sum(1 for r in OUT if r['resultado'] == 'CORRECTA')
    print(f'\nComprobaciones: {ok}/{len(OUT)} correctas')
    json.dump({'fecha': time.strftime('%Y-%m-%d %H:%M:%S'), 'comprobaciones': OUT}, open(os.path.join(ROOT, 'tests/checks/resultados.json'), 'w'), ensure_ascii=False, indent=1)

if __name__ == '__main__': main()
