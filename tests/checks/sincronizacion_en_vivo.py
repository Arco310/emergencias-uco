#!/usr/bin/env python3
"""Prueba de funcionamiento real de la modalidad compartida por Internet: la aplicación publicada
y el servidor de sincronización instalado, con dos dispositivos (tablet y móvil) con
almacenamiento independiente. Crea en el servidor un preventivo llamado «PRUEBA DE FUNCIONAMIENTO».
Uso: python3 tests/checks/sincronizacion_en_vivo.py URL_APP URL_SERVIDOR"""
import json, os, sys, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'e2e'))
import run_e2e as E
from playwright.sync_api import sync_playwright

OUT = []
def res(name, ok, detail=''):
    OUT.append({'comprobacion': name, 'resultado': 'CORRECTA' if ok else 'A REVISAR', 'detalle': detail})
    print(('  ✔ ' if ok else '  ⚠ ') + name + (' — ' + detail if detail else ''), flush=True)

def paso(nombre, fn):
    try: d = fn(); res(nombre, True, d or '')
    except Exception as e: res(nombre, False, str(e).splitlines()[0][:220]); raise

def esperar(fn, seg=40):
    fin = time.time() + seg; v = None
    while time.time() < fin:
        v = fn()
        if v: return v
        time.sleep(1.5)
    return v

def main():
    app = sys.argv[1] if len(sys.argv) > 1 else 'https://arco310.github.io/emergencias-uco/'
    srv = (sys.argv[2] if len(sys.argv) > 2 else '').rstrip('/')
    if not app.endswith('/'): app += '/'
    px = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    px = {'proxy': {'server': px}} if px else {}
    print('Aplicación:', app, '· Servidor:', srv)
    E.URL = app
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=E.CHROME, args=['--no-sandbox'], **px)
        T = E.App(b, 'vivo-tablet', E.TABLET); M = E.App(b, 'vivo-movil', E.PHONE)
        T.setup('Prueba Tablet', 'tablet', 'secreto1', 'Tablet de prueba', 'PT'); T.perms(False)
        M.setup('Prueba Móvil', 'movil', 'secreto1', 'Móvil de prueba', 'PM'); M.perms(False)
        code = {}
        try:
            def crear():
                T.new_prev('PRUEBA DE FUNCIONAMIENTO', 'compartida', True, srv)
                T.pg.wait_for_selector('#joincode', timeout=30000); code['c'] = T.pg.input_value('#joincode')
                assert code['c'].startswith('UCO1.'), code['c'][:10]
                T.nav('panel'); T.new_unit('PRUEBA-1', '', 'rt_svb', 'sec_1'); T.new_unit('PRUEBA-2', '', 'rt_svb', 'sec_1')
                return 'preventivo registrado en el servidor y código de incorporación generado'
            paso('Crear preventivo compartido con el servidor', crear)
            def unir():
                M.a('home.join'); M.fill('code', code['c']); M.dlg_ok(); M.pg.wait_for_selector('.kpis', timeout=60000)
                n = esperar(lambda: M.state('return Object.keys(s.units).length') == 2 and 2)
                assert n == 2, n
                return 'el móvil recibe el preventivo y sus 2 unidades por Internet'
            paso('Incorporar el segundo dispositivo', unir)
            def simult():
                for a, d in [(T, 'Aviso desde la tablet'), (M, 'Aviso desde el móvil')]:
                    a.nav('avisos'); a.a('a.new'); a.fill('desc', d); a.sheet().locator('form[data-f="a.save"] button.primary').click(); a.pg.wait_for_timeout(300); a.close_sheets()
                q = 'return JSON.stringify(Object.values(s.avisos).map(a => a.num).sort())'
                ok = esperar(lambda: T.state(q) == M.state(q) == '[1,2]')
                assert ok, (T.state(q), M.state(q))
                return 'números definitivos 1 y 2, únicos en ambos dispositivos'
            paso('Avisos simultáneos numerados por el servidor', simult)
            def sin_red():
                M.ctx.set_offline(True); M.pg.wait_for_timeout(300)
                M.nav('avisos'); M.a('a.new'); M.fill('desc', 'Creado sin red'); M.sheet().locator('form[data-f="a.save"] button.primary').click(); M.pg.wait_for_timeout(400); M.close_sheets()
                M.open_unit('PRUEBA-2'); M.sheet().locator('[data-a="u.clave"][data-k="C6"]').click(); M.pg.wait_for_timeout(400); M.close_sheets()
                T.nav('avisos'); T.a('a.new'); T.fill('desc', 'Tablet con el móvil sin red'); T.sheet().locator('form[data-f="a.save"] button.primary').click(); T.pg.wait_for_timeout(400); T.close_sheets()
                M.ctx.set_offline(False); M.pg.evaluate('() => window.dispatchEvent(new Event("online"))')
                q = "return JSON.stringify([Object.values(s.avisos).map(a => a.desc + ':' + a.num).sort(), Object.values(s.units).map(u => u.ind + ':' + u.clave).sort()])"
                ok = esperar(lambda: (lambda a, m: a == m and ':null' not in a and 'PRUEBA-2:C6' in a and 'Creado sin red' in a)(T.state(q), M.state(q)), 60)
                assert ok, (T.state(q), M.state(q))
                return 'trabajo sin red, reconexión y convergencia sin pérdidas ni duplicados'
            paso('Desconexión y reconexión', sin_red)
            res('Sin errores de JavaScript', not (T.errors + M.errors), '; '.join((T.errors + M.errors)[:3]))
        except Exception:
            pass
        b.close()
    ok = all(r['resultado'] == 'CORRECTA' for r in OUT)
    print(f"\n{sum(r['resultado'] == 'CORRECTA' for r in OUT)}/{len(OUT)} comprobaciones correctas")
    json.dump({'app': app, 'servidor': srv, 'fecha': time.strftime('%Y-%m-%d %H:%M'), 'resultados': OUT},
              open(os.path.join(os.path.dirname(__file__), 'resultados-sincronizacion-en-vivo.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()
