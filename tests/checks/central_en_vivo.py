#!/usr/bin/env python3
"""Prueba en vivo con el perfil CLAUDE_TEST contra el servidor central real, en su entorno de pruebas
aislado (?entorno=pruebas): base de datos local propia en cada dispositivo y espacio central de pruebas
creado con el código de pruebas (que no puede tocar el espacio real). Comprueba la aplicación servida por el
propio servidor y por Internet: activación, alta de usuario, dispositivo nuevo con usuario y contraseña,
preventivo compartido que aparece solo, avisos simultáneos, desconexión y reconexión, y el panel de
actualizaciones con el servidor real. Al terminar BORRA el espacio de pruebas y sus preventivos.
Uso: python3 tests/checks/central_en_vivo.py [URL_APP]"""
import json, os, re, sys, time, urllib.request
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'e2e'))
# Versiones esperadas del servidor y de la aplicación: las del código del repositorio (no se fijan a mano)
RAIZ = os.path.join(os.path.dirname(__file__), '..', '..')
def _version(ruta, patron): return re.search(patron, open(os.path.join(RAIZ, ruta), encoding='utf-8').read()).group(1)
VERSION = _version('server/server.mjs', r"const VERSION = '([^']+)'")
APP_VERSION = _version('src/core/defaults.js', r"export const APP_VERSION = '([^']+)'")
import run_e2e as E
from playwright.sync_api import sync_playwright

APP = (sys.argv[1] if len(sys.argv) > 1 else 'https://desktop-g5s6ch9.tailb6d0d2.ts.net/').rstrip('/') + '/'
BASE = APP + '?entorno=pruebas'
# Credenciales de pruebas fuera del repositorio (nunca se suben)
CRED = next(f for f in [os.environ.get('UCO_CLAUDE_TEST', ''), os.path.expanduser('~/.uco-claude-test/credenciales.json'), '/home/claude/.uco-claude-test/credenciales.json'] if f and os.path.exists(f))
CODIGO = json.load(open(CRED))['codigoPruebas']
OUT = []

def res(name, ok, detail=''):
    OUT.append({'comprobacion': name, 'resultado': 'CORRECTA' if ok else 'A REVISAR', 'detalle': detail})
    print(('  ✔ ' if ok else '  ⚠ ') + name + (' — ' + detail if detail else ''), flush=True)

def paso(nombre, fn):
    try: d = fn(); res(nombre, True, d or '')
    except Exception as e:
        res(nombre, False, (str(e).splitlines() or ['error'])[0][:240])
        for app in E.APPS:
            try: app.pg.screenshot(path=os.path.join(E.SHOTS, f'VIVO-FALLO-{len(OUT):02d}-{app.name}.png'))
            except Exception: pass
        raise

def esperar(fn, seg=45):
    fin = time.time() + seg; v = None
    while time.time() < fin:
        v = fn()
        if v: return v
        time.sleep(1.5)
    return v

def api(metodo, ruta, body=None):
    req = urllib.request.Request(APP.rstrip('/') + '/api/v1' + ruta, method=metodo, data=json.dumps(body).encode() if body is not None else None, headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=30) as r: return json.loads(r.read() or b'null')

def main():
    print('Aplicación:', BASE)
    os.makedirs(E.SHOTS, exist_ok=True)
    px = os.environ.get('HTTPS_PROXY') or os.environ.get('https_proxy')
    px = {'proxy': {'server': px}} if px else {}
    org = {}
    with sync_playwright() as p:
        b = p.chromium.launch(executable_path=E.CHROME, args=['--no-sandbox'], **px)
        T = E.App(b, 'vivo-tablet', E.TABLET, base=BASE); M = E.App(b, 'vivo-movil', E.PHONE, base=BASE)
        try:
            def servidor():
                v = api('GET', '/version')
                assert v['version'] == VERSION and v['lanzador'] is True and v['mantenimiento'] is False and v.get('archivos') == 'ok', v
                c = api('GET', '/central?entorno=pruebas')
                assert c.get('org') is None, 'ya hay un espacio de pruebas: ' + str(c.get('org'))
                return f"servidor {v['version']} con lanzador, esquema {v['esquema']}, versión mínima de la app {v['minCliente']}, códigos protegidos legibles; sin espacio de pruebas previo"
            paso('Servidor real: versión y estado', servidor)
            def activar():
                T.setup('Prueba Coordinación', 'coord', 'clave-de-prueba-1', 'Tablet CLAUDE_TEST', 'CT', codigo=CODIGO); T.perms(False)
                assert T.pg.locator('.pruebas-bar').count(), 'falta la banda del entorno de pruebas'
                esperar(lambda: T.pg.evaluate("() => window.__UCO.core.central.status().estado === 'conectado'"), 40)
                org['id'] = T.pg.evaluate('() => window.__UCO.core.centralMeta.org')
                c = api('GET', '/central?entorno=pruebas'); assert c['org'] == org['id'] and c['pruebas'] is True, c
                assert api('GET', '/central?entorno=produccion').get('org') != org['id'], 'el espacio de pruebas no puede ser el real'
                T.shot('vivo-01-activado')
                return 'espacio central de pruebas activado con el código de pruebas; separado del espacio real'
            paso('CLAUDE_TEST: activación del espacio de pruebas', activar)
            def alta():
                T.nav('sistema'); T.a('nav', v='usuarios'); T.pg.wait_for_selector('[data-a="users.edit"]'); T.a('users.edit')
                T.fill('nombre', 'Operadora de prueba'); T.fill('usuario', 'operadora'); T.fill('rol', 'rol_operador'); T.fill('pw', 'clave-de-prueba-2')
                T.sheet().locator('form[data-f="users.save"] button.primary').click(); T.pg.wait_for_timeout(800)
                ok = esperar(lambda: T.pg.evaluate('async () => { await window.__UCO.core.central.syncNow(); const d = await window.__UCO.core.central.datos(); return Object.keys(d.pendCuentas).length + Object.keys(d.pendCfg).length === 0 }'))
                assert ok, 'cuenta pendiente de publicar'
                return 'usuario creado y su cuenta publicada en el servidor real'
            paso('CLAUDE_TEST: alta de usuario', alta)
            def nuevo():
                M.goto(); M.central_login('operadora', 'clave-de-prueba-2', 'Móvil CLAUDE_TEST'); M.pg.wait_for_selector('.top', timeout=60000)
                M.pg.wait_for_selector('[data-perm-onboard]', timeout=10000); M.perms(False)
                quien = M.pg.evaluate('() => [window.__UCO.core.user.usuario, window.__UCO.core.user.rol]')
                assert quien == ['operadora', 'rol_operador'], quien
                return 'el móvil entra solo con usuario y contraseña a través de Internet'
            paso('CLAUDE_TEST: dispositivo nuevo con usuario y contraseña', nuevo)
            def compartido():
                T.nav('inicio'); T.new_prev('PRUEBA CLAUDE_TEST', 'compartida', True)
                T.nav('panel'); [T.new_unit(i, '', 'rt_svb', 'sec_1') for i in ['CT-1', 'CT-2']]
                M.nav('inicio')
                ok = esperar(lambda: (M.pg.evaluate('() => window.__UCO.core.central.syncNow()') or True) and M.pg.locator('[data-a="home.openCentral"]').count(), 60)
                assert ok, 'el preventivo no aparece en el móvil'
                M.pg.locator('[data-a="home.openCentral"]').first.click(); M.pg.wait_for_selector('.kpis', timeout=60000)
                n = esperar(lambda: M.state('return Object.keys(s.units).length') == 2 and 2, 60); assert n == 2, n
                return 'creado en la tablet sin pedir servidor; aparece solo en el móvil con sus 2 unidades'
            paso('CLAUDE_TEST: preventivo compartido que aparece solo', compartido)
            def simult():
                for a, d in [(T, 'Aviso desde la tablet'), (M, 'Aviso desde el móvil')]:
                    a.nav('avisos'); a.a('a.new'); a.a('inc.mas'); a.fill('desc', d); a.sheet().locator('form[data-f="a.save"] button.primary').click(); a.pg.wait_for_timeout(300); a.close_sheets()
                q = 'return JSON.stringify(Object.values(s.avisos).map(a => a.num).sort())'
                ok = esperar(lambda: T.state(q) == M.state(q) == '[1,2]', 60)
                assert ok, (T.state(q), M.state(q))
                return 'números 1 y 2 asignados por el servidor real, sin duplicados'
            paso('CLAUDE_TEST: avisos simultáneos', simult)
            def sin_red():
                M.ctx.set_offline(True); M.pg.wait_for_timeout(300)
                M.nav('avisos'); M.a('a.new'); M.a('inc.mas'); M.fill('desc', 'Creado sin red'); M.sheet().locator('form[data-f="a.save"] button.primary').click(); M.pg.wait_for_timeout(400); M.close_sheets()
                M.open_unit('CT-2'); M.sheet().locator('[data-a="u.clave"][data-k="C6"]').click(); M.pg.wait_for_timeout(400); M.close_sheets()
                M.ctx.set_offline(False); M.pg.evaluate('() => window.dispatchEvent(new Event("online"))')
                q = "return JSON.stringify([Object.values(s.avisos).map(a => a.desc + ':' + a.num).sort(), Object.values(s.units).map(u => u.ind + ':' + u.clave).sort()])"
                ok = esperar(lambda: (lambda a, m: a == m and ':null' not in a and 'CT-2:C6' in a and 'Creado sin red' in a)(T.state(q), M.state(q)), 90)
                assert ok, (T.state(q), M.state(q))
                return 'trabajo sin red en el móvil, reconexión y convergencia sin pérdidas'
            paso('CLAUDE_TEST: desconexión y reconexión', sin_red)
            def panel():
                T.pg.evaluate('() => window.__UCO.go("actualizaciones")'); T.pg.wait_for_selector('[data-act="servidor"]', timeout=20000)
                ok = esperar(lambda: T.pg.locator('[data-act="dispositivos"]').count() and VERSION in T.pg.inner_text('[data-act="servidor"]'), 30)
                assert ok, repr(T.pg.inner_text('main')[:300])
                txt = T.pg.inner_text('[data-act="dispositivos"]')
                assert 'Tablet CLAUDE_TEST' in txt and 'Móvil CLAUDE_TEST' in txt and txt.count(APP_VERSION) >= 2, repr(txt)
                # «Comprobar versiones publicadas» (sin código): el servidor real consulta GitHub y no muestra error
                # aunque el repositorio aún no tenga versiones publicadas (404). Se espera a que cambie «Última
                # consulta» para no dar por buena la consulta anterior (el servidor admite una consulta por minuto).
                def ultima():
                    m = re.search(r'Última consulta\s+(.+)', T.pg.inner_text('[data-act="servidor"]'))
                    return m.group(1).strip() if m else ''
                antes = ultima()
                T.pg.locator('[data-act="servidor"] [data-a="act.srv"][data-accion="comprobar"]').click()
                def comprobado():
                    s = T.pg.inner_text('[data-act="servidor"]')
                    sin_error = T.pg.locator('[data-act="servidor"] .note.bad').count() == 0
                    return s if ultima() != antes and sin_error and any(t in s for t in ('Aún no hay versiones publicadas', 'Ninguna más reciente', 'Descargar y verificar')) else None
                s = esperar(comprobado, 40)
                assert s, repr(T.pg.inner_text('[data-act="servidor"]')[:400])
                estado = 'aún no hay versiones publicadas' if 'Aún no hay versiones publicadas' in s else 'consulta correcta'
                T.shot('vivo-02-actualizaciones')
                return f'panel con el servidor real ({VERSION}, despliegue activo), los 2 dispositivos con su nombre en la {APP_VERSION} y la consulta a GitHub sin error ({estado})'
            paso('CLAUDE_TEST: panel Sistema → Actualizaciones', panel)
            res('CLAUDE_TEST: sin errores de JavaScript', not (T.errors + M.errors), '; '.join((T.errors + M.errors)[:3]))
        except Exception:
            pass
        finally:
            # Limpieza: el espacio de pruebas y sus preventivos se borran del servidor
            if org.get('id'):
                try:
                    r = api('DELETE', '/org/' + org['id'], {'codigo': CODIGO})
                    gone = api('GET', '/central?entorno=pruebas').get('org') is None
                    res('Limpieza: espacio de pruebas borrado', bool(r.get('ok') and gone), f"{r.get('preventivosBorrados')} preventivo(s) de prueba borrado(s)")
                except Exception as e: res('Limpieza: espacio de pruebas borrado', False, str(e)[:200])
            b.close()
    ok = all(r['resultado'] == 'CORRECTA' for r in OUT)
    json.dump({'fecha': time.strftime('%Y-%m-%d %H:%M:%S'), 'app': BASE, 'resultados': OUT}, open(os.path.join(os.path.dirname(__file__), 'resultados-central-en-vivo.json'), 'w'), ensure_ascii=False, indent=1)
    print(f"\n{sum(r['resultado'] == 'CORRECTA' for r in OUT)}/{len(OUT)} comprobaciones correctas")
    sys.exit(0 if ok else 1)

if __name__ == '__main__':
    main()
