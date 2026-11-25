#!/usr/bin/env python3
"""Pruebas de aceptación en navegador real (Chrome) con Playwright.

Arranca el servidor de sincronización sirviendo la aplicación compilada (dist/app) y
ejecuta los escenarios de la sección 25 del pliego: unidades, colores C0, avisos,
descansos, plantillas, modo sin conexión, multidispositivo, estadísticas, informes,
usuarios y permisos, en tamaño móvil y tablet.

Uso: python3 tests/e2e/run_e2e.py   (requiere: pip install playwright; node build.mjs)
"""
import json, os, re, shutil, subprocess, sys, tempfile, time, traceback, zipfile, io
from playwright.sync_api import sync_playwright, expect

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
PORT = int(os.environ.get('E2E_PORT', '8650'))
URL = f'http://127.0.0.1:{PORT}/'
SHOTS = os.path.join(ROOT, 'tests', 'e2e', 'capturas')
CHROME = os.environ.get('CHROME', '/usr/bin/google-chrome')
PLANO = os.path.join(ROOT, 'tests', 'e2e', 'plano-prueba.png')
RESULTS = []
SRV = {}  # servidor de las pruebas (para simular su caída)
PHONE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
TABLET = dict(viewport={'width': 1280, 'height': 800}, is_mobile=True, has_touch=True, device_scale_factor=1.5)
# Código de administración FICTICIO, solo para el servidor local que arrancan estas pruebas
ADMIN_CODE = 'E2EAD-MINCO-DIGOL-OCAL1'

def record(name, ok, detail=''):
    RESULTS.append({'prueba': name, 'resultado': 'SUPERADA' if ok else 'FALLIDA', 'detalle': detail})
    print(('  ✔ ' if ok else '  ✘ ') + name + (' — ' + detail if detail else ''), flush=True)

APPS = []  # aplicaciones abiertas: en un fallo se guarda una captura de cada una
def check(name, fn):
    try:
        d = fn()
        record(name, True, d or '')
    except Exception as e:
        record(name, False, (str(e).splitlines() or ['error'])[0][:300])
        traceback.print_exc()
        for app in APPS:
            try: app.pg.screenshot(path=os.path.join(SHOTS, f'FALLO-{len(RESULTS):02d}-{app.name}.png'))
            except Exception: pass

class App:
    def __init__(self, browser, name, opts, base=None):
        self.base = base or URL
        self.ctx = browser.new_context(locale='es-ES', timezone_id='Europe/Madrid', accept_downloads=True, **opts)
        self.ctx.grant_permissions(['geolocation', 'notifications'], origin=self.base[:-1])
        self.ctx.set_geolocation({'latitude': 37.8847, 'longitude': -4.7792})
        self.name = name
        self.errors = []
        self.pg = self.ctx.new_page(); APPS.append(self)
        self.pg.on('pageerror', lambda e: self.errors.append(str(e)))
        self.pg.on('console', lambda m: self.errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text and 'net::' not in m.text else None)
        self.pg.set_default_timeout(15000)
    def shot(self, name, full=False):
        os.makedirs(SHOTS, exist_ok=True)
        self.pg.screenshot(path=os.path.join(SHOTS, f'{self.name}-{name}.png'), full_page=full)
    def goto(self, hash_=''):
        self.pg.goto(self.base + hash_); self.pg.wait_for_selector('#app :is(.auth-box, .top, .splash)')
    def sheet(self):
        return self.pg.locator('.sheet-wrap').last
    def a(self, action, scope=None, **data):
        sel = f'[data-a="{action}"]' + ''.join(f'[data-{k}="{v}"]' for k, v in data.items())
        loc = (scope or self.pg).locator(sel).locator('visible=true').first
        loc.click(); self.pg.wait_for_timeout(250)
    def nav(self, route):
        self.pg.locator(f'nav [data-a="nav"][data-v="{route}"]').locator('visible=true').first.click(); self.pg.wait_for_timeout(300)
    def dlg_ok(self):
        self.sheet().locator('button[type=submit], form button.primary').last.click(); self.pg.wait_for_timeout(400)
    def fill(self, name, value, scope=None):
        loc = (scope or self.sheet()).locator(f'[name="{name}"]').first
        tag = loc.evaluate('e => e.tagName')
        if tag == 'SELECT': loc.select_option(value)
        else: loc.fill(str(value))
    def state(self, js):
        return self.pg.evaluate('() => { const G = window.__UCO; const s = G.core.state; ' + js + ' }')
    def toast_text(self):
        return ' | '.join(self.pg.locator('#toasts .toast').all_inner_texts())
    # ---- flujos ----
    def rellenar(self, pares):
        """Rellena campos de la pantalla de acceso y comprueba que conservan su valor. Al arrancar, la pantalla
        puede repintarse por un evento (service worker, versión, servidor central): la aplicación conserva lo
        escrito, pero el valor que Playwright escribe de golpe puede caer en el campo que se está sustituyendo."""
        for _ in range(4):
            for sel, val in pares:
                if self.pg.input_value(sel) != val: self.pg.fill(sel, val)
            self.pg.wait_for_timeout(150)
            if all(self.pg.input_value(sel) == val for sel, val in pares): return
        raise AssertionError('los campos no conservan lo escrito: ' + ', '.join(sel for sel, val in pares if self.pg.input_value(sel) != val))
    def setup(self, nombre, usuario, pw, dev, code, codigo=None):
        self.goto(); self.pg.wait_for_selector('form[data-f="auth.setup"], form[data-f="auth.central"]', timeout=20000)
        if self.pg.locator('form[data-f="auth.central"]').count():
            # el servidor central ya está activo: este dispositivo se configura sin él
            self.pg.click('[data-a="auth.local"]'); self.pg.wait_for_selector('form[data-f="auth.setup"]')
        self.rellenar([('#f_nombre', nombre), ('#f_usuario', usuario), ('#f_p1', pw), ('#f_p2', pw), ('#f_dev', dev), ('#f_code', code)] + ([('#f_codigo', codigo)] if codigo else []))
        # El alta deriva claves (PBKDF2): con el equipo cargado puede tardar más de lo normal
        self.pg.click('form[data-f="auth.setup"] button.primary'); self.pg.wait_for_selector('#recok', timeout=45000)
        self.recovery = self.pg.inner_text('#rec')
        self.pg.check('#recok'); self.pg.click('[data-a="auth.recDone"]'); self.pg.wait_for_selector('.top')
        self.pg.wait_for_selector('[data-perm-onboard]', timeout=5000)
        self.perm_sheet = True
    def perms(self, all_=False):
        """Responde al aviso de permisos que aparece la primera vez"""
        self.pg.locator('[data-perm-onboard] [data-a="%s"]' % ('perm.all' if all_ else 'perm.later')).click(); self.pg.wait_for_timeout(1500 if all_ else 300)
    def central_login(self, usuario, pw, dev=''):
        """Dispositivo nuevo con el servidor central activo: solo usuario y contraseña"""
        self.pg.wait_for_selector('form[data-f="auth.central"]', timeout=20000)
        self.rellenar([('#f_u', usuario), ('#f_p', pw)])
        if dev: self.pg.click('form[data-f="auth.central"] summary'); self.rellenar([('#f_u', usuario), ('#f_p', pw), ('#f_dev', dev)])
        self.pg.click('form[data-f="auth.central"] button.primary')
    def login(self, usuario, pw):
        self.pg.wait_for_selector('form[data-f="auth.login"]')
        u = self.pg.locator('#f_u')
        if u.evaluate('e => e.tagName') == 'SELECT': u.select_option(usuario); self.rellenar([('#f_p', pw)])
        else: self.rellenar([('#f_u', usuario), ('#f_p', pw)])
        self.pg.click('form[data-f="auth.login"] button.primary'); self.pg.wait_for_selector('.top', timeout=20000); self.pg.wait_for_timeout(500)
    def logout(self):
        self.pg.click('[data-a="user.menu"]'); self.a('session.logout'); self.pg.wait_for_selector('form[data-f="auth.login"]')
    def new_prev(self, nombre, modalidad='independiente', activar=True, server='', origen=None):
        if not self.pg.locator('[data-a="home.new"]').locator('visible=true').count():
            if self.pg.locator('[data-a="prev.exit"]').count(): self.a('prev.exit')
            self.nav('inicio')
        self.a('home.new'); s = self.sheet()
        if origen: self.fill('origen', origen)
        assert not s.locator('[name=server]').count(), 'el formulario no debe pedir servidor'
        self.fill('nombre', nombre); self.fill('modalidad', modalidad)
        if activar: s.locator('[name=activar]').check()
        s.locator('form[data-f="home.create"] button.primary').click(); self.pg.wait_for_selector('.kpis', timeout=20000); self.pg.wait_for_timeout(500)
    def new_unit(self, ind, nombre='', tipo='rt_svb', sector='sec_1', color=None):
        self.nav('unidades'); self.a('u.new')
        # Con unidades plantilla, «Añadir unidad» las ofrece primero: se elige la unidad personalizada
        self.pg.wait_for_selector('.sheet-wrap :is([data-a="u.newBlank"], form[data-f="u.save"])')
        if self.pg.locator('.sheet-wrap [data-a="u.newBlank"]').count(): self.a('u.newBlank')
        s = self.sheet()
        self.fill('ind', ind); self.fill('nombre', nombre); self.fill('tipo', tipo); self.fill('sector', sector)
        if color: s.locator('[name=colorC0]').fill(color)
        s.locator('form[data-f="u.save"] button.primary').click(); self.pg.wait_for_timeout(500)
    def unit_id(self, ind):
        return self.state(f"return Object.values(s.units).find(u => u.ind === '{ind}').id;")
    def open_unit(self, ind):
        self.nav('unidades'); self.pg.locator(f'.ucard[data-id="{self.unit_id(ind)}"]').click(); self.pg.wait_for_selector('.uhead')
    def close_sheets(self):
        while self.pg.locator('.sheet-wrap').count():
            self.sheet().locator('.sheet-head [data-a="sheet.close"]').click(); self.pg.wait_for_timeout(200)

def start_server(data, port=None, static=None):
    port = port or PORT
    env = dict(os.environ, UCO_CODIGO_ADMIN=ADMIN_CODE)
    p = subprocess.Popen(['node', os.path.join(ROOT, 'server/server.mjs'), '--port', str(port), '--static', static or os.path.join(ROOT, 'dist/app'), '--data', data, '--host', '127.0.0.1', '--quiet'], env=env)
    for _ in range(60):
        try:
            import urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{port}/api/v1/salud', timeout=1); return p
        except Exception: time.sleep(0.2)
    raise RuntimeError('servidor no disponible')

def scenario_standalone(browser):
    print('\n== Escenario 1: móvil, preventivo independiente ==')
    A = App(browser, 'movil', PHONE)
    check('Alta inicial del administrador y clave de recuperación', lambda: (A.setup('Ana Coordinadora', 'ana', 'secreto1', 'Móvil PMA', 'M1'), A.shot('01-inicio'), 'clave ' + A.recovery[:5] + '…')[2])
    def perms_all():
        A.shot('01b-permisos'); A.perms(True)
        A.nav('sistema'); A.a('nav', v='permisos'); A.pg.wait_for_selector('.perm-row'); A.pg.wait_for_timeout(800)
        txt = A.pg.inner_text('#main'); A.shot('01c-permisos-estado', True)
        geo = A.pg.locator('.perm-row', has_text='Ubicación').locator('.chip').inner_text()
        notif = A.pg.locator('.perm-row', has_text='Notificaciones').locator('.chip').inner_text()
        aud = A.pg.evaluate("async () => (await window.__UCO.core.repo.listAudit()).some(a => a.accion === 'Solicitud de permisos del dispositivo')")
        assert geo == 'Concedido' and notif == 'Concedido' and aud, (geo, notif, aud)
        A.nav('inicio'); return 'aviso al primer acceso; ubicación y notificaciones concedidas; queda en la auditoría'
    check('Permisos del dispositivo: solicitar todos', perms_all)
    check('Crear preventivo independiente y activarlo', lambda: (A.new_prev('Concierto Plaza Mayor'), A.shot('02-panel'), A.state('return s.prev.estado') == 'activo' or (_ for _ in ()).throw(Exception('no activo')))[0])
    def units():
        A.new_unit('AMB-01', 'Ambulancia 1', 'rt_svb', 'sec_1', '#123456'); A.new_unit('AMB-02', 'Ambulancia 2', 'rt_svb', 'sec_2'); A.new_unit('VIR-01', 'Rápida', 'rt_vir', 'sec_1')
        n = A.state('return Object.keys(s.units).length')
        assert n == 3, n
        A.shot('03-unidades', True); return '3 unidades'
    check('Unidades: crear desde el formulario', units)
    def edit_unit():
        A.open_unit('VIR-01'); A.a('u.edit'); s = A.sheet()
        A.fill('nombre', 'Vehículo rápido'); A.fill('v_forma', 'rombo'); A.fill('v_icono', 'moto'); A.fill('v_tam', 'l')
        s.locator('form[data-f="u.save"] button.primary').click(); A.pg.wait_for_timeout(400); A.close_sheets()
        v = A.state("const u = Object.values(s.units).find(u => u.ind === 'VIR-01'); return [u.nombre, u.vis.forma, u.vis.icono, u.vis.tam].join(',');")
        assert v == 'Vehículo rápido,rombo,moto,l', v
        return 'nombre, forma, icono y tamaño personalizados'
    check('Unidades: editar y personalizar apariencia', edit_unit)
    def color_c0():
        A.open_unit('AMB-01'); A.a('u.color'); A.sheet().locator('input[name=c]').fill('#aa00aa'); A.dlg_ok(); A.pg.wait_for_timeout(300)
        col = A.state("return Object.values(s.units).find(u => u.ind === 'AMB-01').colorC0;")
        assert col == '#AA00AA', col
        fill = A.pg.locator('.sheet-wrap .usym-big svg g').first.get_attribute('fill')
        assert fill.upper() == '#AA00AA', fill
        A.close_sheets(); return 'color principal y borde = #AA00AA en C0'
    check('Color C0: personalizar en C0', color_c0)
    def aviso_flow():
        A.nav('avisos'); A.a('a.new'); A.a('inc.mas'); s = A.sheet()
        s.locator('[data-a="inc.campo"]').click(); A.pg.wait_for_timeout(200)
        A.sheet().locator('[data-c="inc.q"]').fill('asistencia'); A.pg.wait_for_timeout(150); A.sheet().locator('[data-inc-res] [data-id="ta_san"]').click(); A.pg.wait_for_timeout(200)
        s = A.sheet(); A.fill('desc', 'Lipotimia en primera fila'); A.fill('sector', 'sec_1')
        s.locator('form[data-f="a.save"] button.primary').click(); A.pg.wait_for_selector('.sug'); A.shot('04-aviso-sugerencias')
        num = A.state("return Object.values(s.avisos)[0].num;")
        assert num == 1, num
        amb = A.unit_id('AMB-01')
        A.sheet().locator(f'.sug [data-a="assign.do"][data-u="{amb}"]').click(); A.pg.wait_for_timeout(600)
        st = A.state("const u = s.units['%s']; return u.clave + '/' + s.avisos[u.aviso].estado;" % amb)
        assert st == 'C1/asignado', st
        A.sheet().locator(f'[data-a="u.clave"][data-id="{amb}"][data-k="C2"]').click(); A.pg.wait_for_timeout(400)
        A.sheet().locator(f'[data-a="u.clave"][data-id="{amb}"][data-k="C3"]').click(); A.pg.wait_for_timeout(400)
        st = A.state("const u = s.units['%s']; return u.clave + '/' + s.avisos[u.aviso].estado;" % amb)
        assert st == 'C3/en_curso', st
        A.shot('05-aviso-en-curso'); A.close_sheets()
        return 'Nº 1 · AMB-01 C1 → C2 → C3 · aviso en curso'
    check('Avisos: crear, numerar, sugerir y asignar; claves C1-C3', aviso_flow)
    def color_lock():
        amb = A.unit_id('AMB-01'); A.open_unit('AMB-01')
        dis = A.sheet().locator('[data-a="u.color"]').is_disabled()
        assert dis, 'el botón de color debería estar bloqueado fuera de C0'
        v = A.pg.locator('.sheet-wrap .usym-big svg g').first
        fill, stroke = v.get_attribute('fill'), v.get_attribute('stroke')
        assert fill.upper() == '#C62828' and stroke.upper() == '#AA00AA', (fill, stroke)
        A.close_sheets(); return 'fuera de C0: principal = color de clave C3, borde = C0, edición bloqueada'
    check('Color C0: bloqueo fuera de C0, color de clave y borde C0', color_lock)
    def rest_block():
        A.open_unit('AMB-01'); dis = A.sheet().locator('[data-a="u.rest"]').is_disabled(); A.close_sheets()
        assert dis, 'el descanso debería estar bloqueado con aviso activo'
        return 'botón de descanso deshabilitado con aviso activo'
    check('Descansos: bloqueo con aviso activo', rest_block)
    def rest_timer():
        A.open_unit('AMB-02'); A.a('u.rest'); A.sheet().locator('input[name=d]').fill('1'); A.dlg_ok(); A.pg.wait_for_timeout(1500)
        txt = A.pg.locator('.sheet-wrap .rest-box [data-cd]').inner_text()
        assert re.match(r'^0:5\d$|^1:00$', txt), txt
        A.shot('06-descanso'); A.close_sheets()
        A.pg.reload(); A.login('ana', 'secreto1'); A.nav('unidades'); A.pg.wait_for_timeout(1200)
        txt2 = A.pg.locator(f'.ucard[data-id="{A.unit_id("AMB-02")}"] [data-cd]').inner_text()
        assert re.match(r'^0:[0-5]\d$', txt2), txt2
        fill = A.pg.locator(f'.ucard[data-id="{A.unit_id("AMB-02")}"] svg g').first.get_attribute('fill')
        assert fill.upper() == '#9E9E9E', fill
        return f'cuenta atrás {txt} → tras recargar {txt2}; unidad en gris'
    check('Descansos: temporizador real que se recupera tras recargar', rest_timer)
    def finish():
        A.nav('avisos'); A.pg.locator('.acard').first.click(); A.pg.wait_for_selector('[data-a="a.finish"]')
        A.a('a.finish'); A.fill('nota', 'Atendido en el lugar'); A.dlg_ok(); A.pg.wait_for_timeout(500); A.close_sheets()
        A.a('av.tab', v='fin'); n = A.pg.locator('.acard').count()
        st = A.state("return [Object.values(s.avisos)[0].estado, Object.values(s.units).find(u => u.ind === 'AMB-01').clave].join('/')")
        assert n == 1 and st == 'finalizado/C0', (n, st)
        A.shot('07-finalizados'); return 'aparece en Avisos finalizados; AMB-01 liberada a C0'
    check('Avisos: finalizar y apartado de finalizados', finish)
    def color_back():
        fill = A.state("const u = Object.values(s.units).find(u => u.ind === 'AMB-01'); return u.colorC0;")
        A.open_unit('AMB-01'); f = A.pg.locator('.sheet-wrap .usym-big svg g').first.get_attribute('fill'); A.close_sheets()
        assert f.upper() == fill == '#AA00AA', (f, fill)
        return 'al regresar a C0 recupera #AA00AA'
    check('Color C0: recuperación al volver a C0 y persistencia', color_back)
    def rest_end():
        A.pg.wait_for_timeout(62000)
        A.nav('unidades'); A.pg.wait_for_timeout(500)
        resting = A.state("const u = Object.values(s.units).find(u => u.ind === 'AMB-02'); return u.descanso.finPrev > Date.now();")
        fill = A.pg.locator(f'.ucard[data-id="{A.unit_id("AMB-02")}"] svg g').first.get_attribute('fill')
        clave = A.state("return Object.values(s.units).find(u => u.ind === 'AMB-02').clave;")
        assert not resting and fill.upper() != '#9E9E9E' and clave == 'C0', (resting, fill, clave)
        return 'fin automático: vuelve a C0 con su color, sin sobrescribir la clave'
    check('Descansos: fin automático y recuperación del estado', rest_end)
    def cesp():
        A.open_unit('VIR-01'); A.sheet().locator('[data-a="u.clave"][data-k="CESP"]').click(); A.pg.wait_for_timeout(300)
        A.sheet().locator('select[name=m]').select_option('Repostaje'); A.dlg_ok(); A.pg.wait_for_timeout(300)
        st = A.state("const u = Object.values(s.units).find(u => u.ind === 'VIR-01'); return u.clave + ':' + u.motivoEsp;")
        A.sheet().locator('[data-a="u.clave"][data-k="C0"]').click(); A.pg.wait_for_timeout(300); A.close_sheets()
        assert st == 'CESP:Repostaje', st
        return 'CESP con motivo del desplegable'
    check('Claves especiales: CESP con motivo', cesp)
    def plano():
        A.nav('plano')
        with A.pg.expect_file_chooser() as fc: A.a('plan.import')
        fc.value.set_files(PLANO); A.pg.wait_for_selector('.plano-img', timeout=20000); A.pg.wait_for_timeout(600)
        # Se elige una unidad pendiente y se toca el plano; la siguiente pendiente queda elegida sola
        A.pg.locator('[data-a="plan.pick"]').first.click(); A.pg.wait_for_timeout(200)
        for fx, fy in [(0.3, 0.4), (0.6, 0.5)]:
            box = A.pg.locator('.plano-img').bounding_box()
            A.pg.mouse.click(box['x'] + box['width'] * fx, box['y'] + box['height'] * fy); A.pg.wait_for_timeout(500)
        n = A.state('return Object.values(s.units).filter(u => u.plan).length')
        assert n >= 2, n
        A.shot('08-plano')
        A.pg.reload(); A.login('ana', 'secreto1'); A.nav('plano'); A.pg.wait_for_selector('.plano-img'); A.pg.wait_for_timeout(600)
        mk = A.pg.locator('.mk[data-mk="u"]').count()
        assert mk >= 2, mk
        return f'imagen importada; {n} unidades colocadas (coordenadas normalizadas); posiciones persistentes tras recargar'
    check('Plano táctico: importar, colocar unidades y persistencia', plano)
    def stats():
        A.nav('mas'); A.a('nav', v='estadisticas'); A.pg.wait_for_selector('.cols'); A.shot('09-estadisticas', True)
        A.a('st.tab', v='unid'); A.pg.wait_for_selector('.stack-bar'); A.a('st.tab', v='avis'); A.pg.wait_for_selector('.times')
        return 'vistas por preventivo, unidad y aviso'
    check('Estadísticas: vistas con datos reales', stats)
    def bitacora():
        A.nav('mas'); A.a('nav', v='bitacora'); n = A.pg.locator('.log-row').count()
        A.shot('10-bitacora'); assert n > 10, n; return f'{n} registros con usuario y valores anterior/nuevo'
    check('Bitácora: registro cronológico', bitacora)
    def chrono():
        A.nav('mas'); A.a('nav', v='cronologia'); A.pg.locator('select[data-c="cr.unit"]').select_option(A.unit_id('AMB-01')); A.pg.wait_for_timeout(300)
        n = A.pg.locator('.tl.big li').count(); txt = A.pg.locator('.tl.big').inner_text()
        assert n >= 6 and 'C3' in txt and 'Asignada al aviso' in txt, (n, txt[:200])
        return f'{n} acontecimientos con duraciones'
    check('Cronología individual de unidad', chrono)
    def reports():
        A.nav('mas'); A.a('nav', v='cierre')
        out = {}
        for k in ['pdf', 'json', 'csv']:
            with A.pg.expect_download() as dl: A.a('rep.do', k=k)
            path = dl.value.path(); out[k] = open(path, 'rb').read()
        assert out['pdf'][:8] == b'%PDF-1.4' and b'%%EOF' in out['pdf'][-10:], 'pdf'
        j = json.loads(out['json']); assert j['formato'] == 'uco-preventivo' and len(j['avisos']) == 1 and len(j['operaciones']) > 10
        z = zipfile.ZipFile(io.BytesIO(out['csv'])); names = z.namelist(); assert 'avisos.csv' in names and 'bitacora.csv' in names
        av = z.read('avisos.csv').decode('utf-8-sig'); assert 'Lipotimia en primera fila' in av
        open(os.path.join(SHOTS, 'informe-prueba.pdf'), 'wb').write(out['pdf'])
        return f'PDF {len(out["pdf"])//1024} KB, JSON con {len(j["operaciones"])} operaciones, ZIP con {len(names)} CSV'
    check('Informes: PDF, JSON y CSV con contenido real', reports)
    def offline():
        A.ctx.set_offline(True)
        A.pg.reload(); A.login('ana', 'secreto1'); A.pg.wait_for_selector('.net-off')
        A.nav('avisos'); A.a('a.new'); A.a('inc.mas'); A.fill('desc', 'Aviso sin conexión'); A.sheet().locator('form[data-f="a.save"] button.primary').click(); A.pg.wait_for_timeout(600); A.close_sheets()
        A.open_unit('AMB-02'); A.a('u.rest'); A.dlg_ok(); A.pg.wait_for_timeout(300); A.close_sheets()
        A.nav('plano'); A.pg.wait_for_selector('.plano-img')
        A.nav('mas'); A.a('nav', v='cierre')
        with A.pg.expect_download() as dl: A.a('rep.do', k='pdf')
        ok = open(dl.value.path(), 'rb').read()[:4] == b'%PDF'
        n = A.state("return Object.values(s.avisos).length")
        A.shot('11-sin-conexion'); A.ctx.set_offline(False)
        assert n == 2 and ok, (n, ok)
        return 'modo avión: recarga, sesión, aviso nº 2, descanso, plano e informe PDF sin red'
    check('Funcionamiento sin conexión (modo avión)', offline)
    def tpl():
        A.nav('mas'); A.a('tpl.fromPrev'); A.sheet().locator('input[name=nombre]').fill('Concierto tipo'); A.dlg_ok(); A.pg.wait_for_timeout(500)
        A.a('prev.exit'); A.nav('plantillas'); A.pg.wait_for_selector('.pcard'); A.shot('12-plantillas')
        A.pg.locator('.pcard [data-a="home.new"]').first.click(); A.pg.wait_for_timeout(300)
        A.fill('nombre', 'Concierto 2'); A.sheet().locator('[name=activar]').check(); A.sheet().locator('form[data-f="home.create"] button.primary').click(); A.pg.wait_for_selector('.kpis'); A.pg.wait_for_timeout(400)
        st = A.state("return [Object.keys(s.units).length, Object.keys(s.avisos).length, Object.values(s.units).filter(u=>u.plan).length, s.prev.origen.tipo, s.prev.plano ? 1 : 0].join(',')")
        u = A.state("return Object.values(s.units).find(u => u.ind === 'AMB-01').colorC0")
        assert st.startswith('3,0,') and st.endswith('plantilla,1') and u == '#AA00AA', (st, u)
        # modificar la plantilla no cambia el preventivo creado
        A.a('prev.exit'); A.nav('plantillas'); A.pg.locator('.pcard-main').first.click(); A.pg.wait_for_timeout(300)
        A.a('tp.tab', v='uni'); A.sheet().locator('[data-a="tp.unitDel"]').first.click(); A.pg.wait_for_timeout(400); A.close_sheets()
        A.nav('inicio'); A.pg.locator('.pcard-main', has_text='Concierto 2').click(); A.pg.wait_for_selector('.kpis')
        n = A.state('return Object.keys(s.units).length')
        assert n == 3, n
        return 'preventivo desde plantilla: 3 unidades, plano y colores; 0 avisos; cambios posteriores en la plantilla no le afectan'
    check('Plantillas: crear, aplicar y aislamiento', tpl)
    def users():
        A.a('prev.exit'); A.nav('sistema'); A.a('nav', v='usuarios'); A.pg.wait_for_selector('.tbl')
        for (u, n, r) in [('olga', 'Olga Operadora', 'rol_operador'), ('carlos', 'Carlos Consulta', 'rol_consulta')]:
            A.a('users.edit'); A.fill('nombre', n); A.fill('usuario', u); A.fill('rol', r); A.sheet().locator('[name=activo]').check(); A.fill('pw', 'clave-' + u); A.dlg_ok(); A.pg.wait_for_timeout(600)
        A.a('users.tab', v='r'); A.shot('13-roles', True)
        A.logout(); A.login('carlos', 'clave-carlos')
        A.pg.locator('.pcard-main', has_text='Concierto Plaza Mayor').click(); A.pg.wait_for_selector('.kpis')
        nb = A.pg.locator('[data-a="a.new"]').count(); A.nav('unidades'); nu = A.pg.locator('[data-a="u.new"]').count()
        A.pg.locator('.ucard').first.click(); kb = A.sheet().locator('.kbtn:not([disabled])').count(); A.close_sheets()
        A.logout(); A.login('olga', 'clave-olga'); A.nav('avisos'); na = A.pg.locator('[data-a="a.new"]').locator('visible=true').count()
        A.nav('mas'); A.a('nav', v='ajustes'); ro = A.pg.locator('.note', has_text='permiso').count()
        assert nb == 0 and nu == 0 and kb == 0 and na >= 1 and ro >= 1, (nb, nu, kb, na, ro)
        return 'Consulta sin acciones operativas; Operador crea avisos pero no edita configuración'
    check('Usuarios, roles y permisos', users)
    def close_prev():
        A.logout(); A.login('ana', 'secreto1'); A.nav('mas'); A.a('nav', v='cierre')
        A.a('prev.close'); A.pg.wait_for_timeout(200)
        A.sheet().locator('[name=pdf]').uncheck(); A.dlg_ok()
        A.pg.wait_for_function("() => { const p = window.__UCO.core.state.prev; return p.estado === 'cerrado' && p.archivado }", timeout=20000); A.pg.wait_for_timeout(300)
        st = A.state('return s.prev.estado + "/" + s.prev.archivado')
        A.nav('avisos'); nb = A.pg.locator('[data-a="a.new"]').count()
        assert st == 'cerrado/true' and nb == 0, (st, nb)
        A.shot('14-cerrado')
        return 'cerrado con advertencias registradas, archivado y en solo lectura'
    check('Cierre del preventivo', close_prev)
    check('Sin errores de JavaScript (móvil)', lambda: (_ for _ in ()).throw(Exception('; '.join(A.errors[:5]))) if A.errors else 'ninguno')
    A.ctx.close()

def scenario_shared(browser):
    print('\n== Escenario 2: tablet + móvil con el servidor central ==')
    T = App(browser, 'tablet', TABLET); M = App(browser, 'movil2', PHONE)
    def activar():
        # Espacio como el de producción: creado con la 1.3.0 (cifrado de extremo a extremo) y sin pasar al
        # modo servidor. Comprueba que la 1.4.0 sigue funcionando igual con él. Los espacios nuevos se crean
        # en modo servidor (escenarios 10 y 11).
        T.setup('Tomás Jefe', 'tomas', 'secreto2', 'Tablet mando', 'T'); T.perms(False)
        T.pg.evaluate(f"async () => {{ await window.__UCO.core.centralActivar({{ codigo: '{ADMIN_CODE}', password: 'secreto2', modo: 'cifrado' }}); window.__UCO.render(); }}")
        T.pg.wait_for_selector('.central-bar[data-central-estado]', timeout=20000)
        T.pg.wait_for_function("() => window.__UCO.core.central.status().estado === 'conectado'", timeout=20000)
        assert T.pg.evaluate('() => window.__UCO.core.modoServidor()') is False
        T.shot('00-central-activado')
        return 'espacio central como el de la 1.3.0 (sin migrar), activado con el código del servidor; estado conectado'
    check('Servidor central (espacio 1.3.0 sin migrar): activación con el código del servidor', activar)
    def alta_usuario():
        T.nav('sistema'); T.a('nav', v='usuarios'); T.pg.wait_for_selector('[data-a="users.edit"]'); T.a('users.edit')
        T.fill('nombre', 'María Operadora'); T.fill('usuario', 'maria'); T.fill('rol', 'rol_operador'); T.fill('pw', 'secreto3')
        T.sheet().locator('form[data-f="users.save"] button.primary').click(); T.pg.wait_for_timeout(800)
        T.pg.evaluate('() => window.__UCO.core.central.syncNow()')
        pend = T.pg.evaluate('async () => { const d = await window.__UCO.core.central.datos(); return Object.keys(d.pendCuentas).length + Object.keys(d.pendCfg).length }')
        assert pend == 0, pend
        return 'usuario creado en la tablet; su cuenta queda publicada en el servidor central'
    check('Servidor central: alta de usuario', alta_usuario)
    def nuevo_dispositivo():
        M.goto(); M.pg.wait_for_selector('form[data-f="auth.central"]', timeout=20000); M.shot('00-acceso-central')
        assert not M.pg.locator('[name=server], [name=code], [name=codigo]').count(), 'no se piden direcciones ni códigos'
        M.central_login('maria', 'contraseña-mala'); M.pg.wait_for_timeout(3000)
        err = M.toast_text(); assert 'incorrectos' in err, err
        M.central_login('maria', 'secreto3', 'Móvil sector 2'); M.pg.wait_for_selector('.top', timeout=40000)
        M.pg.wait_for_selector('[data-perm-onboard]', timeout=8000); M.perms(False)
        quien = M.pg.evaluate('() => [window.__UCO.core.user.usuario, window.__UCO.core.user.rol, window.__UCO.core.device.nombre]')
        assert quien == ['maria', 'rol_operador', 'Móvil sector 2'], quien
        return 'el móvil nuevo entra solo con usuario y contraseña, con su rol; una contraseña errónea se rechaza'
    check('Servidor central: dispositivo nuevo con usuario y contraseña', nuevo_dispositivo)
    def create():
        T.new_prev('Maratón ciudad', 'compartida', True)
        assert T.pg.evaluate('() => !!window.__UCO.core.meta(window.__UCO.core.cur).central'), 'no vinculado al servidor central'
        T.nav('panel'); [T.new_unit(i, '', 'rt_svb', 'sec_1') for i in ['A1', 'A2', 'A3']]
        T.pg.wait_for_timeout(1500); T.shot('01-panel-tablet')
        return 'creado sin pedir servidor ni códigos: queda compartido y vinculado al servidor central'
    check('Compartido: crear preventivo sin pedir servidor', create)
    def join():
        M.nav('inicio')
        for _ in range(30):
            M.pg.evaluate('() => window.__UCO.core.central.syncNow()'); M.pg.wait_for_timeout(700)
            if M.pg.locator('[data-a="home.openCentral"]').count(): break
        M.shot('01-movil-disponible')
        M.pg.locator('[data-a="home.openCentral"]').first.click(); M.pg.wait_for_selector('.kpis', timeout=30000); M.pg.wait_for_timeout(800)
        n = M.state('return Object.keys(s.units).length'); assert n == 3, n
        return 'aparece solo en el móvil y se abre con un toque, con sus 3 unidades'
    check('Compartido: el preventivo aparece solo en el otro dispositivo', join)
    def simult():
        for app, d in [(T, 'Aviso tablet'), (M, 'Aviso móvil')]:
            app.nav('avisos'); app.a('a.new'); app.a('inc.mas'); app.fill('desc', d); app.sheet().locator('form[data-f="a.save"] button.primary').click(); app.pg.wait_for_timeout(300); app.close_sheets()
        time.sleep(8)
        nums = sorted(T.state('return Object.values(s.avisos).map(a => a.num)'))
        nums2 = sorted(M.state('return Object.values(s.avisos).map(a => a.num)'))
        assert nums == nums2 == [1, 2], (nums, nums2)
        return 'números definitivos únicos 1 y 2 en ambos dispositivos'
    check('Compartido: avisos simultáneos sin duplicados', simult)
    def offline():
        M.ctx.set_offline(True); M.pg.wait_for_timeout(300)
        M.nav('avisos'); M.a('a.new'); M.a('inc.mas'); M.fill('desc', 'Creado sin red'); M.sheet().locator('form[data-f="a.save"] button.primary').click(); M.pg.wait_for_timeout(400); M.close_sheets()
        ref = M.state("return Object.values(s.avisos).find(a => a.desc === 'Creado sin red').ref")
        # 1.5.0: hasta que el servidor lo confirma se ve como pendiente, no como un aviso confirmado
        assert M.pg.locator('.acard', has_text='Creado sin red').locator('.warn-chip', has_text='Pendiente de confirmar').count() == 1, 'distintivo de pendiente'
        a2 = M.unit_id('A2'); M.open_unit('A2'); M.sheet().locator('[data-a="u.clave"][data-k="C6"]').click(); M.pg.wait_for_timeout(400); M.close_sheets()
        T.nav('avisos'); T.a('a.new'); T.a('inc.mas'); T.fill('desc', 'Tablet mientras móvil sin red'); T.sheet().locator('form[data-f="a.save"] button.primary').click(); T.pg.wait_for_timeout(400); T.close_sheets()
        M.shot('02-movil-sin-red'); time.sleep(3)
        M.ctx.set_offline(False); M.pg.evaluate('() => window.dispatchEvent(new Event("online"))'); time.sleep(9)
        sa = T.state("return JSON.stringify([Object.values(s.avisos).map(a => a.desc + ':' + a.num).sort(), Object.values(s.units).map(u => u.ind + ':' + u.clave).sort()])")
        sb = M.state("return JSON.stringify([Object.values(s.avisos).map(a => a.desc + ':' + a.num).sort(), Object.values(s.units).map(u => u.ind + ':' + u.clave).sort()])")
        assert sa == sb and 'Creado sin red:null' not in sa and 'A2:C6' in sa, (sa, sb)
        M.nav('avisos'); M.pg.wait_for_timeout(300)
        assert M.pg.locator('.acard', has_text='Creado sin red').locator('.warn-chip').count() == 0, 'confirmado: sin distintivo'
        # 1.5.0: cada dispositivo guarda la hora declarada, la de recepción en el servidor y la de sincronización
        horas = lambda X: X.pg.evaluate("async () => { const c = window.__UCO.core; const op = c.engine().ops.find(o => o.k === 'aviso.create' && o.x.a.desc === 'Creado sin red'); const m = (await c.repo.metaOps(c.cur)).find(x => x.id === op.id); return [op.t, m.rx, m.sy] }")
        tm, rxm, sym = horas(M); tt, rxt, syt = horas(T)
        assert rxm and rxm == rxt and tm == tt and rxm - tm >= 3000 and sym and syt and syt >= rxm - 2000, (tm, rxm, sym, tt, rxt, syt)
        return f'trabajo sin red (ref. provisional {ref}, «Pendiente de confirmar»), reconexión, número definitivo y convergencia sin pérdidas; recibido por el servidor {round((rxm - tm) / 1000)} s después de registrarse'
    check('Compartido: desconexión, trabajo local y reconexión', offline)
    def conflict():
        M.ctx.set_offline(True); a3 = T.unit_id('A3')
        for app, n in [(T, 'Nombre tablet'), (M, 'Nombre móvil')]:
            app.open_unit('A3'); app.a('u.edit'); app.fill('nombre', n); app.sheet().locator('form[data-f="u.save"] button.primary').click(); app.pg.wait_for_timeout(400); app.close_sheets()
        time.sleep(6); M.ctx.set_offline(False); M.pg.evaluate('() => window.dispatchEvent(new Event("online"))'); time.sleep(9)
        T.nav('mas'); T.a('nav', v='sync'); T.pg.wait_for_selector('.conf', timeout=20000); T.shot('03-conflicto')
        T.pg.locator('.conf [data-a="conf.res"][data-d="aceptar"]').first.click(); T.pg.wait_for_timeout(500); time.sleep(8)
        na = T.state(f"return s.units['{a3}'].nombre"); nb = M.state(f"return s.units['{a3}'].nombre")
        pend = M.state('return G.core.engine().pendingConflicts().length')
        assert na == nb == 'Nombre móvil' and pend == 0, (na, nb, pend)
        return 'conflicto detectado (sin última escritura silenciosa) y resuelto por el administrador'
    check('Compartido: resolución de conflictos', conflict)
    def varios():
        T.new_prev('Concierto estadio', 'compartida', True)
        r = T.pg.evaluate("() => { const c = window.__UCO.core; return c.summaries.filter(s => c.meta(s.id).modalidad === 'compartida').map(s => [c.meta(s.id).server, !!c.meta(s.id).central]); }")
        srv = T.pg.evaluate('() => window.__UCO.core.servidorCentral()')
        assert len(r) >= 2 and all(x[0] == srv and x[1] for x in r), (r, srv)
        T.a('prev.exit'); T.pg.locator('[data-a="home.open"]', has_text='Maratón ciudad').first.click(); T.pg.wait_for_selector('.kpis'); T.pg.wait_for_timeout(500)
        return f'{len(r)} preventivos compartidos, todos con el servidor central {srv} sin haberlo pedido'
    check('Servidor central: varios preventivos usan el mismo servidor', varios)
    def tipo_compartido():
        # Tipo de recurso nuevo creado en la tablet desde el formulario de una unidad
        T.nav('unidades'); T.a('u.new'); T.pg.wait_for_selector('.sheet-wrap :is([data-a="u.newBlank"], form[data-f="u.save"])')
        if T.pg.locator('.sheet-wrap [data-a="u.newBlank"]').count(): T.a('u.newBlank')
        f = T.sheet().locator('form[data-f="u.save"]'); f.locator('[name=ind]').fill('BICI-1')
        f.locator('[data-a="u.nuevoTipo"]').click(); T.pg.wait_for_timeout(300)
        t = T.sheet().locator('form[data-f="cat.nuevoTipo"]'); t.locator('[name=nombre]').fill('Bicicleta sanitaria'); t.locator('button.primary').click(); T.pg.wait_for_timeout(600)
        T.sheet().locator('form[data-f="u.save"] button.primary').click(); T.pg.wait_for_timeout(600); T.close_sheets()
        # En el móvil aparece solo, también en el formulario de unidades
        for _ in range(30):
            M.pg.evaluate('() => window.__UCO.core.central.syncNow()'); M.pg.wait_for_timeout(600)
            if M.pg.evaluate("() => window.__UCO.core.tiposRecursoGenerales().some(t => t.nombre === 'Bicicleta sanitaria')"): break
        M.nav('unidades'); M.a('u.new'); M.pg.wait_for_selector('.sheet-wrap :is([data-a="u.newBlank"], form[data-f="u.save"])')
        if M.pg.locator('.sheet-wrap [data-a="u.newBlank"]').count(): M.a('u.newBlank')
        ops = M.sheet().locator('form[data-f="u.save"] [name=tipo]').inner_text(); M.close_sheets()
        assert 'Bicicleta sanitaria' in ops, ops
        return 'tipo «Bicicleta sanitaria» creado en la tablet → disponible en el móvil sin hacer nada'
    check('Tipos de recurso: el tipo nuevo aparece en el otro dispositivo', tipo_compartido)
    def dispositivos_panel():
        T.pg.evaluate('() => window.__UCO.go("actualizaciones")'); T.pg.wait_for_selector('[data-act="servidor"]', timeout=20000)
        txt = ''
        for _ in range(15):
            if T.pg.locator('[data-act="dispositivos"]').count():
                txt = T.pg.inner_text('[data-act="dispositivos"]')
                if 'Tablet mando' in txt and 'Móvil sector 2' in txt: break
            T.pg.wait_for_timeout(2000); T.a('act.cargar')
        assert 'Tablet mando' in txt and 'Móvil sector 2' in txt and not re.search(r'\nDispositivo\t\d', txt), repr(txt)
        T.shot('05-actualizaciones')
        return 'Sistema → Actualizaciones muestra el servidor y los 2 dispositivos con su nombre y versión'
    check('Actualizaciones: estado del servidor y de los dispositivos', dispositivos_panel)
    def estado_anterior():
        # 1.5.0: en el modo anterior el estado técnico exige además el código de administración del servidor
        T.pg.evaluate('() => window.__UCO.go("estado")'); T.pg.wait_for_selector('form[data-f="est.codigo"]', timeout=20000)
        T.pg.locator('form[data-f="est.codigo"] [name=codigo]').fill('AAAAA-BBBBB-CCCCC-DDDDD'); T.pg.locator('form[data-f="est.codigo"] button.primary').click(); T.pg.wait_for_timeout(1500)
        assert T.pg.locator('form[data-f="est.codigo"]').count() == 1 and 'incorrecto' in T.pg.inner_text('main'), 'código erróneo: se sigue pidiendo'
        T.pg.locator('form[data-f="est.codigo"] [name=codigo]').fill(ADMIN_CODE); T.pg.locator('form[data-f="est.codigo"] button.primary').click()
        T.pg.wait_for_selector('section.card h2:has-text("Datos y almacenamiento")', timeout=20000)
        txt = T.pg.inner_text('main')
        for t in ['Alertas', 'Servidor', 'Datos y almacenamiento', 'Recursos del equipo', 'Sincronización', 'Copias de seguridad', 'Este dispositivo', 'Servicios externos']: assert t in txt, t
        assert 'modo anterior' in txt and 'Tablet mando' in txt and 'Móvil sector 2' in txt, txt[:800]
        assert ADMIN_CODE not in txt, 'el código no se muestra'
        T.shot('05-estado-sistema', True)
        return 'pide el código de administración (uno erróneo no sirve); servidor, datos, recursos, sincronización con los dos dispositivos activos, copias y alertas; sin secretos'
    check('Estado del sistema en el modo anterior (con el código del servidor)', estado_anterior)
    def caida_servidor():
        SRV['p'].terminate(); SRV['p'].wait(10)
        # 1.5.0: el panel de estado avisa de que el servidor no responde
        T.pg.evaluate('() => window.__UCO.go("estado")'); T.a('est.cargar')
        T.pg.wait_for_function("() => document.querySelector('main').innerText.includes('El servidor central no responde')", timeout=40000)
        T.nav('avisos'); T.a('a.new'); T.a('inc.mas'); T.fill('desc', 'Con el servidor caído'); T.sheet().locator('form[data-f="a.save"] button.primary').click(); T.pg.wait_for_timeout(500); T.close_sheets()
        a1 = T.unit_id('A1'); T.open_unit('A1'); T.sheet().locator('[data-a="u.clave"][data-k="C6"]').click(); T.pg.wait_for_timeout(400); T.close_sheets()
        T.pg.evaluate('() => window.__UCO.core.sync.syncNow(window.__UCO.core.cur)'); T.pg.wait_for_timeout(800)
        est = T.pg.evaluate('() => window.__UCO.core.sync.status(window.__UCO.core.cur)')
        assert est['estado'] in ('sin_conexion', 'error') and est.get('pendientes', 0) >= 1, est
        assert T.state("return s.units['%s'].clave" % a1) == 'C6', 'sigue funcionando en local'
        SRV['p'] = start_server(SRV['data']); time.sleep(10)
        for app in (T, M): app.pg.evaluate('() => window.__UCO.core.sync.syncNow(window.__UCO.core.cur)')
        time.sleep(4)
        ok_m = M.state("return Object.values(s.avisos).some(a => a.desc === 'Con el servidor caído' && a.num) && s.units['%s'].clave === 'C6'" % a1)
        pend = T.pg.evaluate('() => window.__UCO.core.sync.status(window.__UCO.core.cur).pendientes || 0')
        assert ok_m and pend == 0, (ok_m, pend)
        return f"servidor detenido: se sigue trabajando en local ({est['estado']}, {est.get('pendientes')} pendiente(s)); al volver se envía todo y el otro dispositivo lo recibe"
    check('Servidor central: caída temporal del servidor sin interrumpir el trabajo', caida_servidor)
    def tablet_layout():
        T.nav('panel'); T.pg.wait_for_timeout(500); T.shot('04-panel-tablet')
        cols = T.pg.evaluate("() => getComputedStyle(document.querySelector('.panel-grid')).gridTemplateColumns.split(' ').length")
        rail = T.pg.locator('nav.rail').is_visible()
        assert cols == 3 and rail, (cols, rail)
        return 'panel de 3 columnas y navegación lateral'
    check('Tablet: panel operativo multicolumna', tablet_layout)
    check('Sin errores de JavaScript (multidispositivo)', lambda: (_ for _ in ()).throw(Exception('; '.join((T.errors + M.errors)[:5]))) if (T.errors + M.errors) else 'ninguno')
    T.ctx.close(); M.ctx.close()

# ---------------- Escenario 3: comportamiento propio de Chrome para Android ----------------
ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'
# Reproduce en el navegador de pruebas tres particularidades de Chrome para Android:
#  1) new Notification() está prohibido («Illegal constructor»): los avisos deben mostrarse con el service worker;
#  2) la pantalla encendida (Wake Lock) la libera el sistema cada vez que se sale de la aplicación;
#  3) el agente de usuario es de Android (el selector de archivos se adapta).
ANDROID_INIT = r"""(() => {
  const N = window.Notification;
  if (N) window.Notification = new Proxy(N, { construct() { window.__illegal = (window.__illegal || 0) + 1; throw new TypeError("Failed to construct 'Notification': Illegal constructor. Use ServiceWorkerRegistration.showNotification() instead."); } });
  let n = 0; const locks = [];
  Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async t => { n++; const l = new EventTarget(); l.type = t; l.released = false;
    l.release = async () => { if (!l.released) { l.released = true; l.dispatchEvent(new Event('release')); } }; locks.push(l); return l; } } });
  let hidden = false;
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => hidden ? 'hidden' : 'visible' });
  window.__wake = { count: () => n, activos: () => locks.filter(l => !l.released).length };
  window.__salirYVolver = () => { hidden = true; locks.forEach(l => l.release()); document.dispatchEvent(new Event('visibilitychange')); hidden = false; document.dispatchEvent(new Event('visibilitychange')); };
})();"""

def scenario_android(b):
    print('\nEscenario 3: particularidades de Chrome para Android (avisos, selector de archivos, pantalla encendida)')
    A = App(b, 'android', dict(TABLET, user_agent=ANDROID_UA))
    A.ctx.add_init_script(ANDROID_INIT)
    A.setup('Eva', 'eva', 'secreto1', 'Tablet Android', 'TA'); A.perms(True)
    notifs = "() => navigator.serviceWorker.ready.then(r => r.getNotifications()).then(ns => ns.map(n => n.title + (n.body ? ': ' + n.body : '')))"
    def notif_test():
        A.nav('sistema'); A.a('nav', v='permisos'); A.pg.wait_for_selector('.perm-row'); A.pg.wait_for_timeout(500)
        A.pg.locator('.perm-row', has_text='Notificaciones').locator('[data-a="perm.notifTest"]').click(); A.pg.wait_for_timeout(1200)
        tit = A.pg.evaluate(notifs); ill = A.pg.evaluate('() => window.__illegal || 0'); t = A.toast_text()
        assert any(x.startswith('Prueba de aviso') for x in tit) and ill == 0 and 'enviado' in t, (tit, ill, t)
        A.shot('01-permisos-android')
        return 'aviso mostrado por el service worker; el constructor prohibido en Android no se usa'
    check('Android: «Probar» notificaciones muestra un aviso real', notif_test)
    def vib_button():
        n = A.pg.locator('.perm-row', has_text='Vibración').locator('[data-a="perm.vibrate"]').count()
        assert n == 1, n
        return 'botón «Probar» visible con la vibración disponible'
    check('Android: botón «Probar» de vibración visible', vib_button)
    def wake():
        n0 = A.pg.evaluate('() => window.__wake.count()')
        for _ in range(3): A.pg.evaluate('() => window.__salirYVolver()'); A.pg.wait_for_timeout(300)
        n1, act = A.pg.evaluate('() => [window.__wake.count(), window.__wake.activos()]')
        assert n0 >= 1 and n1 == n0 + 3 and act == 1, (n0, n1, act)
        return 'tras salir y volver 3 veces la pantalla sigue encendida (3 de 3 recuperaciones)'
    check('Android: pantalla encendida se recupera al volver a la aplicación', wake)
    def picker():
        A.nav('sistema'); A.a('nav', v='copias'); A.pg.wait_for_timeout(400)
        with A.pg.expect_file_chooser() as fc: A.a('bk.import')
        acc = fc.value.element.get_attribute('accept')
        bad = os.path.join(tempfile.mkdtemp(prefix='uco-and-'), 'no-es-una-copia.ucobak'); open(bad, 'w').write('hola')
        fc.value.set_files(bad); A.pg.wait_for_timeout(800); t = ' | '.join(x for x in A.pg.locator('#toasts .toast').all_inner_texts() if 'copia' in x)
        assert acc in ('', None) and 'no es una copia válida' in t, (acc, t)
        return 'el selector muestra todos los archivos (sin filtro) y uno erróneo se rechaza: «' + t + '»'
    check('Android: importar copias y paquetes sin archivos en gris', picker)
    def rest_notif():
        A.new_prev('Prueba Android'); A.new_unit('AND-1', 'Android uno')
        A.open_unit('AND-1'); A.a('u.rest'); A.sheet().locator('input[name=d]').fill('1'); A.dlg_ok(); A.close_sheets()
        A.pg.wait_for_timeout(64000)
        tit = A.pg.evaluate(notifs); ill = A.pg.evaluate('() => window.__illegal || 0')
        fin = [x for x in tit if x.startswith('Fin del descanso')]
        assert fin and ill == 0 and not A.errors, (tit, ill, A.errors)
        return 'aviso «' + fin[0] + '» mostrado por el service worker'
    check('Android: aviso de fin de descanso', rest_notif)
    A.ctx.close()

def scenario_recursos(b):
    print('\n== Escenario 4: tipos de recurso, sector OTROS y unidades plantilla ==')
    A = App(b, 'fase2', PHONE)
    A.setup('Lucía Jefa', 'lucia', 'secreto4', 'Móvil PMA', 'L'); A.perms(False)
    A.new_prev('Partido de fútbol', 'independiente', True)
    def upr():
        A.nav('unidades'); A.a('u.new'); s = A.sheet(); s.locator('.tpl-grid').wait_for(); A.shot('01-anadir-unidad')
        tiles = s.locator('[data-a="u.fromTpl"]').all_inner_texts()
        assert any('UPR' in t for t in tiles) and any('VIRES' in t for t in tiles), tiles
        s.locator('[data-a="u.fromTpl"]', has_text='UPR').first.click(); A.pg.wait_for_timeout(300)
        f = A.sheet().locator('form[data-f="u.tplSave"]')
        assert f.locator('input[name], select[name], textarea[name]').count() == 1, 'solo se pide el número'
        f.locator('[name=numero]').fill('8025'); A.pg.wait_for_timeout(150)
        hint = f.locator('.help').first.inner_text(); assert 'UPR 8025' in hint, hint
        f.locator('button.primary').click(); A.pg.wait_for_timeout(600)
        u = A.pg.evaluate("() => { const u = Object.values(window.__UCO.core.state.units).find(x => x.ind === 'UPR 8025'); return u && [u.tipo, u.clave, u.sector, u.colorC0, u.vis.forma] }")
        assert u == ['rt_vl', 'C0', None, '#1565C0', 'triangulo'], u
        card = A.pg.locator('.ucard', has_text='UPR 8025').inner_text(); assert 'Pendiente de asignación' in card, card
        A.shot('02-upr-creada')
        return 'AÑADIR UNIDAD → UPR → «8025»: UPR 8025, vehículo ligero, triángulo azul, C0, pendiente de asignación'
    check('Unidades plantilla: UPR solo pide el número', upr)
    def otros():
        A.a('u.new'); A.a('u.newBlank'); f = A.sheet().locator('form[data-f="u.save"]')
        f.locator('[name=ind]').fill('MOTO-1')
        assert not f.locator('[data-otros]').is_visible()
        f.locator('[name=sector]').select_option('otros'); A.pg.wait_for_timeout(150)
        assert f.locator('[data-otros]').is_visible(), 'aparece el campo personalizado'
        f.locator('[name=sectorOtro]').fill('Puerta 7'); A.shot('03-sector-otros')
        f.locator('button.primary').click(); A.pg.wait_for_timeout(600)
        u = A.pg.evaluate("() => { const u = Object.values(window.__UCO.core.state.units).find(x => x.ind === 'MOTO-1'); return [u.sector, u.sectorOtro] }")
        assert u == ['otros', 'Puerta 7'], u
        n = A.pg.evaluate('() => window.__UCO.core.state.prev.cat.sectores.length'); assert n == 4, n
        card = A.pg.locator('.ucard', has_text='MOTO-1').inner_text(); assert 'Otros: Puerta 7' in card, card
        return 'OTROS → «Puerta 7» asignado a la unidad, sin crear sectores nuevos'
    check('Sectores: opción OTROS con ubicación personalizada', otros)
    def nuevo_tipo():
        A.a('u.new'); A.a('u.newBlank'); f = A.sheet().locator('form[data-f="u.save"]')
        f.locator('[name=ind]').fill('DRON-1')
        f.locator('[data-a="u.nuevoTipo"]').click(); A.pg.wait_for_timeout(300)
        t = A.sheet().locator('form[data-f="cat.nuevoTipo"]'); t.locator('[name=nombre]').fill('Dron'); t.locator('[name=forma]').select_option('rombo')
        t.locator('button.primary').click(); A.pg.wait_for_timeout(600)
        f = A.sheet().locator('form[data-f="u.save"]')
        assert f.locator('[name=ind]').input_value() == 'DRON-1', 'no se pierde lo escrito'
        sel = f.locator('[name=tipo] option:checked').inner_text(); assert 'Dron' in sel, sel
        f.locator('button.primary').click(); A.pg.wait_for_timeout(600)
        r = A.pg.evaluate("() => { const c = window.__UCO.core; const u = Object.values(c.state.units).find(x => x.ind === 'DRON-1'); const t = c.tiposRecursoGenerales().find(x => x.nombre === 'Dron'); return [!!t, u.tipo === (t && t.id), c.state.prev.cat.tiposRecurso.some(x => x.nombre === 'Dron')] }")
        assert r == [True, True, True], r
        return 'tipo «Dron» creado desde el formulario de la unidad: guardado en la configuración general y usado por la unidad'
    check('Tipos de recurso: crear uno nuevo al crear una unidad', nuevo_tipo)
    def admin_plantillas():
        A.pg.locator('[data-a="prev.exit"]').first.click() if A.pg.locator('[data-a="prev.exit"]').count() else None
        A.nav('config'); A.pg.locator('[data-a="nav"][data-v="uplantillas"]').first.click(); A.pg.wait_for_selector('[data-plantilla]')
        A.a('upl.edit'); f = A.sheet().locator('form[data-f="upl.save"]')
        f.locator('[name=nombre]').fill('Moto sanitaria'); f.locator('[name=prefijo]').fill('msa'); f.locator('[name=tipo]').select_option(label='Equipo sanitario')
        f.locator('[data-group="campos"][value="sector"]').check(); f.locator('button.primary').click(); A.pg.wait_for_timeout(600)
        row = A.pg.locator('[data-plantilla]', has_text='Moto sanitaria'); assert row.count() == 1
        assert 'MSA nº' in row.inner_text(), row.inner_text()
        row.locator('[data-a="upl.dup"]').click(); A.pg.wait_for_timeout(500)
        assert A.pg.locator('[data-plantilla]', has_text='Moto sanitaria (copia)').count() == 1
        A.pg.locator('[data-plantilla]', has_text='Moto sanitaria (copia)').locator('[data-a="upl.toggle"]').click(); A.pg.wait_for_timeout(500)
        assert 'Desactivada' in A.pg.locator('[data-plantilla]', has_text='Moto sanitaria (copia)').inner_text()
        A.shot('04-unidades-plantilla', True)
        return 'crear, duplicar y desactivar plantillas desde Configuración → Unidades plantilla'
    check('Configuración → Unidades plantilla', admin_plantillas)
    def persistencia():
        A.goto(); A.login('lucia', 'secreto4')
        r = A.pg.evaluate("() => { const c = window.__UCO.core; return [c.tiposRecursoGenerales().some(t => t.nombre === 'Dron'), c.plantillasUnidad().some(p => p.nombre === 'Moto sanitaria')] }")
        assert r == [True, True], r
        return 'tipo y plantilla siguen disponibles tras recargar la aplicación'
    check('Persistencia de tipos y plantillas', persistencia)
    check('Sin errores de JavaScript (fase 2)', lambda: (_ for _ in ()).throw(Exception('; '.join(A.errors[:5]))) if A.errors else 'ninguno')
    A.ctx.close()

# ---------------- Escenario 5: cartografía y plano de coordinación ----------------
def tesela_png():
    """Tesela ficticia (gris claro con retícula) para no depender de servidores externos en las pruebas"""
    from PIL import Image, ImageDraw
    im = Image.new('RGB', (256, 256), (233, 237, 241)); d = ImageDraw.Draw(im)
    for i in range(0, 256, 64): d.line([(i, 0), (i, 255)], fill=(205, 212, 220)); d.line([(0, i), (255, i)], fill=(205, 212, 220))
    b = io.BytesIO(); im.save(b, 'PNG'); return b.getvalue()

def rutas_cartografia(ctx):
    tile = tesela_png(); fecha = time.strftime('%a, %d %b %Y %H:%M:%S GMT', time.gmtime())
    ctx.route('https://tile.openstreetmap.org/**', lambda r: r.fulfill(status=200, body=tile, headers={'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*', 'Date': fecha}))
    sol = [{'name': 'Puerta del Sol', 'display_name': 'Puerta del Sol, Centro, Madrid, España', 'lat': '40.4168630', 'lon': '-3.7038762', 'boundingbox': ['40.4164803', '40.4172442', '-3.7047263', '-3.7022633']}]
    ctx.route('https://nominatim.openstreetmap.org/**', lambda r: r.fulfill(status=200, json=sol, headers={'Access-Control-Allow-Origin': '*'}))

def scenario_coordinacion(b):
    print('\n== Escenario 5: cartografía georreferenciada y plano de coordinación ==')
    A = App(b, 'coord', dict(TABLET, service_workers='block'))
    rutas_cartografia(A.ctx)
    A.setup('Raúl Coordinador', 'raul', 'secreto5', 'Tablet PMA', 'R'); A.perms(False)
    A.new_prev('San Isidro', 'independiente', True)
    for n in ['101', '102']:
        A.nav('unidades'); A.a('u.new'); A.sheet().locator('[data-a="u.fromTpl"]', has_text='UPR').first.click(); A.pg.wait_for_timeout(250)
        f = A.sheet().locator('form[data-f="u.tplSave"]'); f.locator('[name=numero]').fill(n); f.locator('button.primary').click(); A.pg.wait_for_timeout(500)
    uid = lambda ind: A.pg.evaluate(f"() => Object.values(window.__UCO.core.state.units).find(u => u.ind === '{ind}').id")
    plan = lambda ind: A.pg.evaluate(f"() => Object.values(window.__UCO.core.state.units).find(u => u.ind === '{ind}').plan")
    def importar():
        A.nav('plano'); A.a('plan.google'); s = A.sheet(); s.locator('#carto-map .leaflet-tile').first.wait_for(timeout=15000)
        assert 'OpenStreetMap' in s.inner_text(), 'aviso de proveedor sin clave'
        s.locator('form[data-f="carto.buscar"] [name=q]').fill('Puerta del Sol Madrid'); s.locator('form[data-f="carto.buscar"] button').click(); A.pg.wait_for_timeout(1800)
        assert s.locator('[name=nombre]').input_value() == 'Puerta del Sol', s.locator('[name=nombre]').input_value()
        A.shot('01-selector-mapa')
        s.locator('form[data-f="carto.ok"] button.primary').click(); A.pg.wait_for_selector('.coord-map .leaflet-tile', timeout=15000); A.pg.wait_for_timeout(600)
        pl = A.pg.evaluate('() => window.__UCO.core.state.prev.plano')
        assert pl['tipo'] == 'mapa' and pl['crs'] == 'EPSG:3857' and pl['bounds']['s'] < 40.41686 < pl['bounds']['n'] and pl['bounds']['w'] < -3.70388 < pl['bounds']['e'], pl
        assert A.pg.locator('[data-pendientes] [data-arrastre]').count() == 2
        return 'búsqueda «Puerta del Sol» → encuadre → plano cartográfico con su extensión geográfica (EPSG:3857, coordenadas WGS84)'
    check('Cartografía: importar zona desde el buscador de mapas', importar)
    def arrastrar_pendiente():
        chip = A.pg.locator('[data-arrastre]', has_text='UPR 101'); cb = chip.bounding_box(); mb = A.pg.locator('.coord-map').bounding_box()
        A.pg.mouse.move(cb['x'] + cb['width'] / 2, cb['y'] + cb['height'] / 2); A.pg.mouse.down()
        for i in range(1, 11): A.pg.mouse.move(cb['x'] + (mb['x'] + mb['width'] * 0.4 - cb['x']) * i / 10, cb['y'] + (mb['y'] + mb['height'] * 0.45 - cb['y']) * i / 10)
        A.pg.mouse.up(); A.pg.wait_for_timeout(700)
        p = plan('UPR 101'); assert p and p.get('lat') and 40.40 < p['lat'] < 40.43 and -3.72 < p['lon'] < -3.69, p
        assert A.pg.locator('.coord-map .mk[data-mk="u"]').count() == 1
        return f"arrastrada desde «pendientes» al plano: lat {p['lat']}, lon {p['lon']}"
    check('Plano: arrastrar una unidad pendiente al mapa (coordenadas reales)', arrastrar_pendiente)
    def tocar_colocar():
        A.pg.locator('[data-a="plan.pick"]', has_text='UPR 102').click(); A.pg.wait_for_timeout(200)
        mb = A.pg.locator('.coord-map').bounding_box(); A.pg.mouse.click(mb['x'] + mb['width'] * 0.7, mb['y'] + mb['height'] * 0.6); A.pg.wait_for_timeout(600)
        p = plan('UPR 102'); assert p and p.get('lat'), p
        return 'tocar la unidad pendiente y luego el plano también la coloca'
    check('Plano: colocar tocando (alternativa táctil)', tocar_colocar)
    def mover():
        antes = plan('UPR 101'); mk = A.pg.locator(f'.mk[data-id="{uid("UPR 101")}"]'); bb = mk.bounding_box()
        A.pg.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); A.pg.mouse.down()
        for i in range(1, 9): A.pg.mouse.move(bb['x'] + bb['width'] / 2 + 12 * i, bb['y'] + bb['height'] / 2 + 6 * i)
        clase = A.pg.locator('.mk-wrap.arrastrando').count()
        A.pg.mouse.up(); A.pg.wait_for_timeout(700)
        despues = plan('UPR 101'); assert despues['lon'] > antes['lon'] and despues['lat'] < antes['lat'], (antes, despues)
        assert clase == 1, 'respuesta visual durante el arrastre'
        log = A.pg.evaluate("() => window.__UCO.core.engine().state.log ? 0 : 0")
        return 'arrastrar mueve la unidad, con respuesta visual; se guarda al soltar'
    check('Plano: mover una unidad arrastrándola', mover)
    def doble_clic():
        mk = A.pg.locator(f'.mk[data-id="{uid("UPR 101")}"]'); mk.dblclick(); A.pg.wait_for_selector('.claves-grid')
        A.shot('02-selector-claves')
        A.sheet().locator('[data-a="u.clave"][data-k="C6"]').click(); A.pg.wait_for_timeout(600)
        c = A.pg.evaluate(f"() => window.__UCO.core.state.units['{uid('UPR 101')}'].clave"); assert c == 'C6', c
        A.close_sheets()
        # El listado general de unidades refleja el cambio hecho en el plano
        A.nav('unidades'); card = A.pg.locator(f'.ucard[data-id="{uid("UPR 101")}"]'); card.wait_for()
        assert 'C6' in card.inner_text(), card.inner_text()
        A.nav('plano'); A.pg.wait_for_selector('.coord-map .leaflet-tile', timeout=15000); A.pg.wait_for_timeout(400)
        return 'doble clic → selector de claves → C6 aplicada con las reglas de siempre y visible en el listado de unidades'
    check('Plano: cambiar la clave con doble clic', doble_clic)
    def devolver():
        mk = A.pg.locator(f'.mk[data-id="{uid("UPR 102")}"]'); bb = mk.bounding_box(); pb = A.pg.locator('[data-pendientes]').bounding_box()
        A.pg.mouse.move(bb['x'] + bb['width'] / 2, bb['y'] + bb['height'] / 2); A.pg.mouse.down()
        for i in range(1, 13): A.pg.mouse.move(bb['x'] + (pb['x'] + pb['width'] / 2 - bb['x']) * i / 12, bb['y'] + (pb['y'] + pb['height'] / 2 - bb['y']) * i / 12)
        A.pg.mouse.up(); A.pg.wait_for_timeout(700)
        assert plan('UPR 102') is None
        assert A.pg.locator('[data-pendientes] [data-arrastre]', has_text='UPR 102').count() == 1
        return 'arrastrada del plano a «pendientes»: vuelve a quedar pendiente de asignación sin eliminarse'
    check('Plano: devolver una unidad a pendientes de asignación', devolver)
    def aviso_punto():
        mb = A.pg.locator('.coord-map').bounding_box(); A.pg.mouse.click(mb['x'] + mb['width'] * 0.25, mb['y'] + mb['height'] * 0.3); A.pg.wait_for_timeout(400)
        # 1.5.0: marcador provisional que se ajusta y se confirma antes del formulario
        A.pg.wait_for_selector('[data-ajuste]'); A.a('plan.avisoUsar'); A.pg.wait_for_timeout(300); A.a('inc.mas')
        f = A.sheet().locator('form[data-f="a.save"]'); loc = f.locator('[data-locsum]').inner_text(); assert '40.4' in loc and '-3.7' in loc and 'no es una posición GPS' in loc, loc
        f.locator('[name=desc]').fill('Desvanecimiento en la plaza'); f.locator('button.primary').click(); A.pg.wait_for_timeout(700); A.close_sheets()
        a = A.pg.evaluate("() => Object.values(window.__UCO.core.state.avisos).find(a => a.desc === 'Desvanecimiento en la plaza')")
        assert a['plan'] and a['loc']['lat'] and a['loc']['fuente'] == 'mapa' and a['num'] == 1, a
        assert A.pg.locator(f'.mk[data-mk="a"][data-id="{a["id"]}"]').count() == 1
        return 'clic en el mapa → marcador provisional → «Usar esta ubicación» → «Más datos» → formulario con la ubicación (marcada en el mapa, no GPS) → aviso nº 1 con marcador en el plano'
    check('Avisos: crear un aviso haciendo clic en el mapa', aviso_punto)
    def aviso_zona():
        A.a('plan.zona'); mb = A.pg.locator('.coord-map').bounding_box()
        for fx, fy in [(0.55, 0.2), (0.75, 0.22), (0.78, 0.4), (0.57, 0.42)]: A.pg.mouse.click(mb['x'] + mb['width'] * fx, mb['y'] + mb['height'] * fy); A.pg.wait_for_timeout(250)
        A.shot('03-zona-dibujada')
                # Directamente con el código: se crea el aviso con la zona sin pasar por el formulario
        A.a('plan.zonaOk'); s = A.sheet(); s.locator('[data-c="inc.q"]').fill('3.2'); A.pg.wait_for_timeout(200); s.locator('[data-inc-res] [data-id="inc_3_2"]').click(); A.pg.wait_for_timeout(700); A.close_sheets()
        a = A.pg.evaluate("() => Object.values(window.__UCO.core.state.avisos).find(a => a.tipo === 'inc_3_2')")
        assert a['zona'] and len(a['zona']['pts']) == 4 and a['zona']['pts'][0]['lat'] and a['loc']['lat'], a
        assert A.pg.locator('.coord-map path.leaflet-interactive').count() >= 1
        A.shot('04-plano-coordinacion')
        # Ambos avisos aparecen en el apartado general de avisos
        A.nav('avisos'); A.pg.wait_for_timeout(400); lista = A.pg.inner_text('main')
        assert 'Desvanecimiento en la plaza' in lista and '3.2 · Inconsciente sin filiar causa' in lista, lista[:400]
        A.nav('plano'); A.pg.wait_for_selector('.coord-map .leaflet-tile', timeout=15000); A.pg.wait_for_timeout(400)
        return 'zona de 4 puntos dibujada → código 3.2 → aviso con zona (coordenadas reales) y ubicación en su centro; área visible en el plano; ambos avisos en el listado general'
    check('Avisos: crear un aviso por zona', aviso_zona)
    def biblioteca():
        A.a('plan.biblio'); s = A.sheet(); t = s.inner_text()
        assert 'Santiago Bernabéu' in t and 'Metropolitano' in t and 'Puerta del Sol' in t, t
        A.close_sheets()
        # La hoja queda por encima del mapa en todos sus puntos (el mapa no la tapa)
        encima = lambda: A.pg.evaluate("() => { const r = [...document.querySelectorAll('.sheet')].pop().getBoundingClientRect(); return [[r.left + 15, r.top + 40], [r.right - 15, r.top + 40], [r.left + r.width / 2, r.top + r.height / 2], [r.right - 30, r.bottom - 30]].every(([x, y]) => { const e = document.elementFromPoint(x, y); return e && e.closest('.sheet'); }) }")
        # Los tres planos predefinidos se incorporan y se usan (el último, el Bernabéu, se queda)
        for lib, nombre, lat in [('lib_metropolitano', 'Estadio Metropolitano (Wanda)', 40.43601), ('lib_sol', 'Puerta del Sol y alrededores', 40.41686), ('lib_bernabeu', 'Estadio Santiago Bernabéu', 40.45304)]:
            A.a('plan.biblio'); s = A.sheet(); A.pg.wait_for_timeout(400)
            assert encima(), 'el mapa tapa la hoja de la biblioteca'
            s.locator(f'[data-biblio="{lib}"] [data-a="biblio.abrir"]').click(); A.pg.wait_for_timeout(600)
            s = A.sheet(); s.locator('#carto-map .leaflet-tile').first.wait_for(timeout=15000)
            s.locator('form[data-f="carto.ok"] button.primary').click(); A.pg.wait_for_timeout(400)
            A.pg.locator('.sheet-wrap button.primary', has_text='Cambiar').click(); A.pg.wait_for_timeout(1000)
            pl = A.pg.evaluate('() => window.__UCO.core.state.prev.plano')
            assert pl['nombre'] == nombre and pl['bounds']['s'] < lat < pl['bounds']['n'], pl
            A.pg.wait_for_selector('.coord-map .leaflet-tile', timeout=15000)
            assert A.pg.locator('.coord-map .mk[data-mk="u"]').count() == 1, 'las unidades conservan su posición relativa'
        return 'Metropolitano, Sol y Bernabéu incorporados uno tras otro con su encuadre y referencia geográfica; las unidades se conservan'
    check('Biblioteca de planos predefinidos', biblioteca)
    def persiste():
        A.goto(); A.login('raul', 'secreto5'); A.nav('plano'); A.pg.wait_for_selector('.coord-map .leaflet-tile', timeout=15000); A.pg.wait_for_timeout(600)
        n = A.pg.locator('.coord-map .mk[data-mk="u"]').count(); assert n == 1, n
        return 'plano cartográfico y posiciones conservados tras cerrar y abrir'
    check('Plano: persistencia tras recargar', persiste)
    def clave_google():
        if A.pg.locator('[data-a="prev.exit"]').count(): A.a('prev.exit')
        A.nav('config'); f = A.pg.locator('form[data-f="carto.clave"]'); f.wait_for()
        sec = A.pg.locator('section', has=f)
        assert 'OpenStreetMap' in sec.inner_text(), 'sin clave se usa OpenStreetMap'
        f.locator('[name=googleKey]').fill('clave no valida!'); f.locator('button.primary').click(); A.pg.wait_for_timeout(500)
        assert 'formato' in A.toast_text(), A.toast_text()
        f.locator('[name=googleKey]').fill('AIzaPRUEBA_clave_ficticia_0123456789'); f.locator('button.primary').click(); A.pg.wait_for_timeout(600)
        sec = A.pg.locator('section', has=A.pg.locator('form[data-f="carto.clave"]'))
        assert 'Google Maps' in sec.inner_text(), sec.inner_text()[:200]
        aud = A.pg.evaluate("() => window.__UCO.core.repo.listAudit().then(l => l.filter(a => (a.elemento || '').startsWith('Cartografía')).length)")
        assert aud >= 1, 'cambio registrado en la auditoría'
        A.pg.locator('[data-a="carto.quitarClave"]').click(); A.pg.wait_for_timeout(500)
        assert 'OpenStreetMap' in A.pg.locator('section', has=A.pg.locator('form[data-f="carto.clave"]')).inner_text()
        return 'clave validada, guardada cifrada (proveedor Google Maps), auditada y retirada (vuelve OpenStreetMap)'
    check('Cartografía: clave de Google Maps Platform en la configuración general', clave_google)
    check('Sin errores de JavaScript (plano de coordinación)', lambda: (_ for _ in ()).throw(Exception('; '.join(A.errors[:5]))) if A.errors else 'ninguno')
    A.ctx.close()

# ---------------- Fase 5: actualizaciones de la aplicación (service worker) ----------------
PORT_ACT = PORT + 10
URL_ACT = f'http://127.0.0.1:{PORT_ACT}/'

def publicar(dest, version, rompe=False, sha_mal=False):
    """Publica en dest una «versión» de la aplicación a partir de dist/app: otro número de versión,
    opcionalmente con un fallo de arranque o con una suma de integridad incorrecta en el service worker."""
    import hashlib
    src = os.path.join(ROOT, 'dist', 'app')
    html = open(os.path.join(src, 'index.html'), encoding='utf-8').read()
    base = re.search(r'="(\d+\.\d+\.\d+)",', html).group(1)
    assert html.count(f'="{base}",') == 1
    html = html.replace(f'="{base}",', f'="{version}",')
    if rompe:
        i = html.index('<script>', html.index('<script>') + 1) + len('<script>')
        html = html[:i] + 'throw new Error("Fallo de arranque simulado");' + html[i:]
    data = html.encode('utf-8'); sha = hashlib.sha256(data).hexdigest()
    sw = open(os.path.join(src, 'sw.js'), encoding='utf-8').read()
    sw = re.sub(r"const VERSION = '[0-9a-f]+';", f"const VERSION = '{sha[:12]}';", sw)
    sw = re.sub(r"const SHA256 = '[0-9a-f]+';", "const SHA256 = '%s';" % ('0' * 64 if sha_mal else sha), sw)
    sw = re.sub(r"const APP_VERSION = '[^']+';", f"const APP_VERSION = '{version}';", sw)
    for f in os.listdir(src):
        p = os.path.join(src, f)
        if os.path.isdir(p): shutil.copytree(p, os.path.join(dest, f), dirs_exist_ok=True)
        elif f not in ('index.html', 'sw.js'): shutil.copy(p, os.path.join(dest, f))
    # Primero index.html y después sw.js (como al desplegar): el service worker nuevo encuentra ya su app
    open(os.path.join(dest, 'index.html'), 'wb').write(data)
    open(os.path.join(dest, 'sw.js'), 'w', encoding='utf-8').write(sw)
    json.dump({'version': version, 'build': sha[:12], 'sha256': sha}, open(os.path.join(dest, 'version.json'), 'w'))

def scenario_actualizaciones(b):
    print('\n[6] Actualizaciones automáticas de la aplicación (service worker)')
    static = tempfile.mkdtemp(prefix='uco-act-app-'); data = tempfile.mkdtemp(prefix='uco-act-datos-')
    publicar(static, '1.2.0')
    srv = start_server(data, PORT_ACT, static)
    A = App(b, 'act', PHONE, base=URL_ACT)
    ver = lambda: A.pg.evaluate('() => window.__UCO && window.__UCO.version')
    sw_listo = lambda: A.pg.wait_for_function('() => navigator.serviceWorker && navigator.serviceWorker.controller', timeout=20000)
    def buscar():
        A.pg.evaluate('() => window.__UCO.go("actualizaciones")'); A.pg.wait_for_selector('[data-act="app"]')
        A.pg.click('[data-act="app"] [data-a="act.comprobar"]')
    def aplicar_y_entrar():
        A.pg.wait_for_selector('[data-act-bar="lista"]', timeout=30000)
        A.pg.click('[data-act-bar="lista"] [data-a="act.aplicar"]')
        A.sheet().locator('button[type=submit]').click()
        A.pg.wait_for_selector('form[data-f="auth.login"]', timeout=30000)
        A.login('coord', 'clave-coordinador')
    try:
        def instalar():
            A.setup('Coordinadora', 'coord', 'clave-coordinador', 'Móvil actualizaciones', 'AC'); A.perms()
            sw_listo()
            A.new_prev('Preventivo actualizaciones'); A.new_unit('ACT 1')
            return 'versión ' + ver() + ' con funcionamiento sin conexión activo'
        check('Actualización: aplicación instalada (1.2.0) y controlada por el service worker', instalar)

        def nueva_con_sesion():
            publicar(static, '1.2.1')
            buscar()
            A.pg.wait_for_selector('[data-act-bar="lista"]', timeout=30000)
            assert 'Versión 1.2.1' in A.pg.inner_text('[data-act-bar="lista"]')
            A.pg.wait_for_timeout(1500)
            assert ver() == '1.2.0', 'con la sesión abierta no se recarga sola'
            assert A.pg.evaluate('() => !!window.__UCO.core.session'), 'la sesión sigue abierta'
            A.shot('01-version-lista')
            return 'aviso «Versión 1.2.1 lista» sin interrumpir el trabajo'
        check('Actualización: versión nueva detectada, descargada y verificada sin interrumpir la sesión', nueva_con_sesion)

        def aplicar_controlado():
            aplicar_y_entrar()
            assert ver() == '1.2.1', 'versión aplicada: ' + str(ver())
            assert A.pg.evaluate("() => window.__UCO.core.state && window.__UCO.core.state.prev.nombre") == 'Preventivo actualizaciones', 'vuelve al mismo preventivo'
            assert A.unit_id('ACT 1'), 'la unidad sigue ahí'
            aud = A.pg.evaluate("() => window.__UCO.core.repo.listAudit().then(l => l.filter(a => a.accion === 'Actualización de la aplicación').map(a => a.anterior + '>' + a.nuevo))")
            assert '1.2.0>1.2.1' in aud, aud
            return 'recarga controlada → 1.2.1, mismo preventivo y datos; anotado en la auditoría'
        check('Actualización: aplicación controlada, datos conservados y auditoría', aplicar_controlado)

        def integridad():
            publicar(static, '1.2.9', sha_mal=True)
            buscar(); A.pg.wait_for_timeout(5000)
            assert not A.pg.locator('[data-act-bar="lista"]').count(), 'no debe ofrecer una versión que no supera la verificación'
            esperando = A.pg.evaluate('() => navigator.serviceWorker.getRegistration().then(r => !!(r.waiting || r.installing))')
            assert not esperando, 'la versión manipulada no queda instalada'
            assert ver() == '1.2.1'
            return 'la versión con suma SHA-256 incorrecta se rechaza; sigue la 1.2.1'
        check('Actualización: comprobación de integridad (SHA-256) de la versión descargada', integridad)

        def recuperacion():
            publicar(static, '1.2.2', rompe=True)
            buscar(); aplicar = A.pg.wait_for_selector('[data-act-bar="lista"]', timeout=30000)
            A.pg.click('[data-act-bar="lista"] [data-a="act.aplicar"]'); A.sheet().locator('button[type=submit]').click()
            A.pg.wait_for_selector('#uco-recuperacion', timeout=40000)
            A.shot('02-recuperacion')
            txt = A.pg.inner_text('#uco-recuperacion')
            assert 'Tus datos están a salvo' in txt and 'Fallo de arranque simulado' in txt, txt
            A.pg.locator('#uco-recuperacion button', has_text='Usar la versión anterior').click()
            A.pg.wait_for_selector('form[data-f="auth.login"]', timeout=30000)
            assert ver() == '1.2.1', 'vuelve a la versión anterior: ' + str(ver())
            A.login('coord', 'clave-coordinador')
            assert A.unit_id('ACT 1'), 'datos intactos'
            A.pg.evaluate('() => window.__UCO.go("actualizaciones")'); A.pg.wait_for_selector('[data-act="app"]')
            assert 'versión anterior' in A.pg.inner_text('[data-act="app"]')
            return 'pantalla de recuperación → versión anterior (1.2.1) con los datos intactos'
        check('Actualización: recuperación ante una versión que no arranca', recuperacion)

        def corregida():
            publicar(static, '1.2.3')
            buscar(); aplicar_y_entrar()
            assert ver() == '1.2.3', str(ver())
            assert A.unit_id('ACT 1')
            return 'versión corregida 1.2.3 aplicada tras la recuperación'
        check('Actualización: versión corregida tras la recuperación', corregida)

        def sin_sesion():
            A.logout()
            publicar(static, '1.2.4')
            A.pg.evaluate('() => navigator.serviceWorker.getRegistration().then(r => r.update())')
            A.pg.wait_for_function('() => window.__UCO && window.__UCO.version === "1.2.4"', timeout=40000)
            A.pg.wait_for_selector('form[data-f="auth.login"]')
            assert 'v1.2.4' in A.pg.inner_text('.auth-head')
            A.login('coord', 'clave-coordinador')
            assert A.unit_id('ACT 1')
            return 'en la pantalla de acceso se aplica sola (1.2.4)'
        check('Actualización: sin sesión abierta se aplica sola', sin_sesion)
        errores = [e for e in A.errors if 'Fallo de arranque simulado' not in e]
        check('Actualización: sin errores de JavaScript', lambda: (_ for _ in ()).throw(Exception('; '.join(errores[:5]))) if errores else 'ninguno')
    finally:
        A.ctx.close(); srv.terminate(); shutil.rmtree(static, ignore_errors=True); shutil.rmtree(data, ignore_errors=True)

def scenario_incidentes(b):
    print('\n== Escenario 7: códigos de incidente, unidades SAMUR-PC, cronología conjunta y finalizar ==')
    A = App(b, 'incidentes', PHONE)
    A.setup('Marta Jefa', 'marta', 'secreto7', 'Móvil CECOR', 'MC'); A.perms(False)
    A.new_prev('Media maratón', 'independiente', True)
    st = lambda js: A.pg.evaluate('() => { const s = window.__UCO.core.state; ' + js + ' }')
    def plantillas_samur():
        A.nav('unidades'); A.a('u.new'); s = A.sheet(); s.locator('.tpl-grid').wait_for()
        tiles = ' '.join(s.locator('[data-a="u.fromTpl"]').all_inner_texts())
        faltan = [p for p in ['BASE', 'SAMUR', 'VIR ·', 'ALFA', 'PAPA', 'TANGO', 'MIKE', 'ECO', 'LINCE', 'HALCÓN', 'URO', 'ZULÚ', 'VRALA', 'PM ·', 'PMA', 'VAIS'] if p not in tiles]
        assert not faltan, faltan
        A.shot('01-plantillas-samur')
        for pid, num in [('plt_sp_alfa', '31'), ('plt_sp_halcon', '2')]:
            if not A.pg.locator('.tpl-grid').count(): A.a('u.new'); A.sheet().locator('.tpl-grid').wait_for()
            A.sheet().locator(f'[data-a="u.fromTpl"][data-id="{pid}"]').click(); A.pg.wait_for_timeout(300)
            f = A.sheet().locator('form[data-f="u.tplSave"]'); f.locator('[name=numero]').fill(num); f.locator('button.primary').click(); A.pg.wait_for_timeout(500)
        u = st("const u = Object.values(s.units).find(x => x.ind === 'ALFA 31'); const h = Object.values(s.units).find(x => x.ind === 'HALCÓN 2'); return u && h && [u.tipo, u.clave, h.tipo, h.vis.icono]")
        assert u == ['rt_sp_alfa', 'C0', 'rt_sp_halcon', 'moto'], u
        A.close_sheets(); return '16 plantillas (BASE … VAIS); «31» → ALFA 31 (USVB) y «2» → HALCÓN 2 (moto), en C0'
    check('Unidades plantilla de SAMUR-PC', plantillas_samur)
    def aviso_codigo():
        A.nav('avisos'); A.a('a.new'); s = A.sheet(); s.locator('[data-a="inc.dir"]').first.wait_for()
        carpetas = s.locator('[data-a="inc.dir"]').all_inner_texts()
        assert len(carpetas) == 12 and carpetas[0].startswith('1. Accidente de Tráfico') and carpetas[-2].startswith('15. Psicológicos') and carpetas[-1].startswith('Otros tipos'), carpetas
        A.shot('02-carpetas')
        s.locator('[data-a="inc.dir"]', has_text='Accidente de Tráfico').click(); A.pg.wait_for_timeout(200)
        cods = s.locator('[data-inc-list="0"] [data-a="inc.pick"]').all_inner_texts()
        assert cods[0].startswith('1.1') and any(c.startswith('1.6.1') for c in cods), cods
        A.shot('03-codigos')
        s.locator('[data-a="inc.pick"][data-id="inc_1_2"]').click(); A.pg.wait_for_timeout(600)
        a = st("const a = Object.values(s.avisos)[0]; return [a.tipo, a.num, a.estado]")
        assert a == ['inc_1_2', 1, 'pendiente'], a
        chip = A.sheet().inner_text(); assert '1.2 · Accidente con menos de 3 víctimas' in chip, chip[:300]
        A.shot('04-aviso-creado'); A.close_sheets()
        return 'Nuevo aviso → carpeta «1. Accidente de Tráfico» → 1.2: aviso Nº 1 creado con ese tipo y abierto para asignar'
    check('Avisos por código de incidente (carpetas)', aviso_codigo)
    def aviso_buscar():
        A.a('a.new'); s = A.sheet(); s.locator('[data-c="inc.q"]').fill('atropello'); A.pg.wait_for_timeout(200)
        res = s.locator('[data-inc-res] [data-a="inc.pick"]').all_inner_texts(); assert res and res[0].startswith('1.4'), res
        s.locator('[data-inc-res] [data-id="inc_1_4"]').click(); A.pg.wait_for_timeout(500); A.close_sheets()
        assert st("return Object.values(s.avisos).some(a => a.tipo === 'inc_1_4')")
        return 'buscar «atropello» → 1.4 → aviso creado'
    check('Avisos: buscar el código', aviso_buscar)
    def aviso_unidad():
        A.open_unit('ALFA 31'); A.sheet().locator('[data-a="a.new"]').first.click(); A.pg.wait_for_timeout(300)
        s = A.sheet(); s.locator('[data-a="inc.dir"]', has_text='Enfermedad').click(); s.locator('[data-a="inc.pick"][data-id="inc_3_1"]').click(); A.pg.wait_for_timeout(700)
        r = st("const u = Object.values(s.units).find(x => x.ind === 'ALFA 31'); const a = s.avisos[u.aviso]; return a && [a.tipo, a.estado, u.clave]")
        assert r == ['inc_3_1', 'asignado', 'C1'], r
        A.close_sheets(); return 'ALFA 31 → Nuevo aviso con esta unidad → Enfermedad → 3.1: aviso asignado y la unidad en C1'
    check('Avisos: nuevo aviso con una unidad por código', aviso_unidad)
    def aviso_mas_datos():
        A.nav('avisos'); A.a('a.new'); A.a('inc.mas'); f = A.sheet().locator('form[data-f="a.save"]')
        f.locator('[data-a="inc.campo"]').click(); A.pg.wait_for_timeout(200)
        s = A.sheet(); s.locator('[data-c="inc.q"]').fill('2.12.1'); A.pg.wait_for_timeout(200); s.locator('[data-inc-res] [data-id="inc_2_12_1"]').click(); A.pg.wait_for_timeout(200)
        f = A.sheet().locator('form[data-f="a.save"]'); lbl = f.locator('[data-tipo-lbl]').inner_text(); assert lbl.startswith('2.12.1'), lbl
        f.locator('[name=desc]').fill('Bañista rescatado'); f.locator('button.primary').click(); A.pg.wait_for_timeout(600); A.close_sheets()
        a = st("return (Object.values(s.avisos).find(a => a.desc === 'Bañista rescatado') || {}).tipo"); assert a == 'inc_2_12_1', a
        opts = A.pg.locator('select[data-c="av.tipo"] optgroup').count(); assert opts == 12, opts
        return 'Más datos → campo «Tipo de incidente» → 2.12.1 OVACE con descripción; filtro de avisos agrupado por carpetas'
    check('Avisos: formulario completo con el selector de código', aviso_mas_datos)
    def cronologia_todas():
        A.nav('mas'); A.a('nav', v='cronologia'); A.pg.locator('select[data-c="cr.unit"]').select_option('__todas'); A.pg.wait_for_timeout(300)
        ch = A.pg.locator('[data-crono="todas"] .uchip').all_inner_texts()
        assert 'ALFA 31' in ch and 'HALCÓN 2' in ch, ch
        ts = A.pg.evaluate("() => [...document.querySelectorAll('[data-crono=\"todas\"] time')].map(t => t.textContent)")
        assert len(ts) >= 4, ts
        A.shot('05-cronologia-todas'); return f'{len(ts)} acontecimientos de {len(set(ch))} unidades en un único registro, lo más reciente primero'
    check('Cronología: todas las unidades a la vez', cronologia_todas)
    def preventivo_anterior():
        A.pg.evaluate("async () => { const c = window.__UCO.core; const seed = c.seedFromConfig(); seed.cat.tiposAviso = seed.cat.tiposAviso.filter(t => !t.codigo); await c.createPrev({ datos: { nombre: 'Preventivo de antes', modalidad: 'independiente', activar: true }, seed }); }")
        A.pg.wait_for_timeout(400); A.nav('avisos'); A.a('a.new'); s = A.sheet()
        assert s.locator('[data-a="inc.dir"]').count() == 1, 'solo «Otros tipos»'
        s.locator('[data-a="inc.anadir"]').click(); A.pg.wait_for_timeout(600)
        n = s.locator('[data-a="inc.dir"]').count(); assert n == 12, n
        s.locator('[data-a="inc.dir"]', has_text='Accidente de Tráfico').click(); s.locator('[data-a="inc.pick"][data-id="inc_1_1"]').click(); A.pg.wait_for_timeout(500); A.close_sheets()
        r = st("return [s.prev.nombre, s.prev.cat.tiposAviso.filter(t => t.codigo).length, Object.values(s.avisos).map(a => a.tipo).join()]")
        assert r == ['Preventivo de antes', 123, 'inc_1_1'], r
        return 'preventivo creado sin códigos → «Añadir los códigos de incidente» → 123 códigos y aviso 1.1'
    check('Preventivos anteriores: añadir los códigos', preventivo_anterior)
    def finalizar():
        A.nav('mas'); tile = A.pg.locator('[data-a="nav"][data-v="cierre"]').inner_text(); assert 'Finalizar preventivo' in tile, tile
        A.a('nav', v='cierre'); assert 'Finalizar el preventivo' in A.pg.inner_text('main')
        A.a('prev.close'); A.pg.wait_for_timeout(200); assert 'Finalizar preventivo' in A.sheet().inner_text()
        A.sheet().locator('[name=pdf]').uncheck(); A.dlg_ok()
        A.pg.wait_for_function("() => { const p = window.__UCO.core.state.prev; return p.estado === 'cerrado' && p.archivado }", timeout=20000); A.pg.wait_for_timeout(300)
        r = st("return s.prev.estado + '/' + s.prev.archivado"); assert r == 'cerrado/true', r
        A.shot('06-finalizado'); return 'Más → «Finalizar preventivo e informes» → Finalizar preventivo: queda en solo lectura y archivado'
    check('Finalizar el preventivo', finalizar)
    check('Sin errores de JavaScript (incidentes)', lambda: (_ for _ in ()).throw(Exception('; '.join(A.errors[:5]))) if A.errors else 'ninguno')
    A.ctx.close()

# ---------------- Escenario 8 (1.4.0): activo/inactivo y eliminación segura de configuraciones ----------------
def scenario_recursos_140(b):
    print('\n== Escenario 8: recursos activos/inactivos y eliminación segura (1.4.0) ==')
    A = App(b, 'rec140', PHONE)
    A.setup('Marta Jefa', 'marta', 'secreto8', 'Móvil PC', 'M'); A.perms(False)
    A.new_prev('Carrera popular', 'independiente', True)
    A.new_unit('SVB-1', 'Ambulancia 1', 'rt_svb', 'sec_1')
    ev = lambda js: A.pg.evaluate('() => { const c = window.__UCO.core; ' + js + ' }')
    def tipos_global():
        if A.pg.locator('[data-a="prev.exit"]').count(): A.a('prev.exit')
        A.nav('config'); A.pg.locator('[data-a="gcat.open"][data-cat="tiposRecurso"]').first.click(); A.pg.wait_for_selector('.sheet-wrap .cat-list')
    def fila(nombre):
        return A.sheet().locator('.cat-row', has=A.pg.locator('b', has_text=re.compile('^' + re.escape(nombre) + '$'))).first
    def volver_prev():
        A.nav('inicio'); A.pg.locator('[data-a="home.open"]', has_text='Carrera popular').first.click(); A.pg.wait_for_selector('.kpis'); A.pg.wait_for_timeout(300)
    def inactivo():
        A.close_sheets()
        tipos_global()
        fila('Ambulancia SVB').locator('[data-a="cat.edit"]').click(); A.pg.wait_for_selector('form[data-f="cat.item"]')
        A.sheet().locator('[name=activo]').uncheck(); A.sheet().locator('form[data-f="cat.item"] button.primary').click(); A.pg.wait_for_timeout(300)
        A.a('cat.save'); A.pg.wait_for_timeout(600)
        assert ev("return c.tiposRecursoGenerales().find(t => t.id === 'rt_svb').activo") is False
        volver_prev(); A.nav('unidades'); A.a('u.new'); s = A.sheet(); s.locator('.tpl-grid').wait_for()
        tiles = s.locator('[data-a="u.fromTpl"]').all_inner_texts()
        assert not any('Soporte Vital Básico' in t for t in tiles), tiles
        A.a('u.newBlank'); opts = A.sheet().locator('form[data-f="u.save"] [name=tipo] option').evaluate_all('os => os.map(o => o.value)')
        assert 'rt_svb' not in opts and 'rt_sva' in opts, opts
        A.pg.wait_for_timeout(500); A.shot('01-selector-sin-inactivos'); A.close_sheets()
        # La unidad existente conserva su tipo; al editarla se ve como «desactivado» y sigue seleccionado
        u = ev("return Object.values(c.state.units).find(x => x.ind === 'SVB-1').tipo"); assert u == 'rt_svb', u
        A.open_unit('SVB-1'); A.a('u.edit'); sel = A.sheet().locator('[name=tipo] option:checked').inner_text()
        assert 'Ambulancia SVB (desactivado)' in sel, sel
        A.close_sheets()
        return 'SVB desactivado: no aparece ni su plantilla ni el tipo al crear; SVB-1 lo conserva («desactivado» al editar)'
    check('Activo/inactivo: los tipos desactivados no se ofrecen al crear unidades', inactivo)
    def reasignar():
        A.close_sheets()
        tipos_global()
        fila('Vehículo de intervención rápida').locator('[data-a="cat.del"]').click(); A.pg.wait_for_selector('.sheet-wrap [data-a="ctr.retirar"]')
        txt = A.sheet().inner_text(); assert 'VIRES' in txt and 'No se puede eliminar' in txt, txt[:400]
        A.pg.wait_for_timeout(500); A.shot('02-vista-previa-eliminar')
        A.sheet().locator('#ctr_dest').select_option('rt_sva'); A.a('ctr.reasignar', A.sheet()); A.pg.wait_for_timeout(600)
        r = ev("return [c.tiposRecursoGenerales().some(t => t.id === 'rt_vir'), c.plantillasUnidad().find(p => p.id === 'plt_vires').tipo, c.cfg.eliminados.tiposRecurso.includes('rt_vir')]")
        assert r == [False, 'rt_sva', True], r
        assert not fila('Vehículo de intervención rápida').count(), 'desaparece de la lista del editor'
        A.close_sheets()
        return 'vista previa con la plantilla VIRES → reasignada a SVA y tipo eliminado'
    check('Eliminar con referencias: vista previa y reasignación', reasignar)
    def sin_refs():
        A.close_sheets()
        tipos_global()
        fila('Unidad de comunicaciones').locator('[data-a="cat.del"]').click(); A.pg.wait_for_selector('.sheet-wrap [data-a="ctr.eliminar"]')
        txt = A.sheet().inner_text(); assert 'Conservan su propia copia' in txt and 'Unidades plantilla' not in txt, txt[:300]
        A.a('ctr.eliminar', A.sheet()); A.pg.wait_for_timeout(600); A.close_sheets()
        A.goto(); A.login('marta', 'secreto8')
        assert not ev("return c.tiposRecursoGenerales().some(t => t.id === 'rt_com')"), 'no reaparece tras recargar'
        A.nav('config'); A.a('ini.abrir'); s = A.sheet(); s.locator('[data-group="tipos"][value="rt_com"]').check(); A.pg.wait_for_timeout(500); A.shot('03-restaurar-iniciales')
        s.locator('form[data-f="ini.restaurar"] button.primary').click(); A.pg.wait_for_timeout(600)
        assert ev("return c.tiposRecursoGenerales().some(t => t.id === 'rt_com') && !c.cfg.eliminados.tiposRecurso.includes('rt_com')")
        return 'configuración inicial sin referencias eliminada; no vuelve al recargar; se restaura a petición'
    check('Eliminar una configuración inicial sin referencias y restaurarla', sin_refs)
    def retirar():
        A.close_sheets()
        tipos_global()
        fila('Vehículo de coordinación').locator('[data-a="cat.del"]').click(); A.pg.wait_for_selector('.sheet-wrap [data-a="ctr.retirar"]')
        A.a('ctr.retirar', A.sheet()); A.pg.wait_for_timeout(600)
        assert ev("return c.tiposRecursoGenerales().find(t => t.id === 'rt_coord').retirado") is True
        det = A.sheet().locator('details.retirados'); det.locator('summary').click(); assert 'Vehículo de coordinación' in det.inner_text()
        A.pg.wait_for_timeout(500); A.shot('04-retirados')
        det.locator('[data-a="cat.restaurar"]').click(); A.pg.wait_for_timeout(600)
        assert ev("return c.tiposRecursoGenerales().find(t => t.id === 'rt_coord').retirado") is None
        A.close_sheets()
        return 'retirado del uso (lista aparte) y restaurado'
    check('Retirar del uso y restaurar', retirar)
    def preventivo():
        A.close_sheets()
        volver_prev(); A.pg.evaluate("() => window.__UCO.go('ajustes')"); A.pg.wait_for_timeout(400)
        A.pg.locator('[data-a="pcat.open"][data-cat="tiposRecurso"]').first.click(); A.pg.wait_for_selector('.sheet-wrap .cat-list')
        fila('Ambulancia SVB').locator('[data-a="cat.del"]').click(); A.pg.wait_for_selector('.sheet-wrap [data-a="ctp.retirar"]')
        txt = A.sheet().inner_text(); assert 'SVB-1' in txt and 'historial' in txt, txt[:300]
        A.a('ctp.retirar', A.sheet()); A.pg.wait_for_timeout(600)
        r = ev("return [c.state.prev.cat.tiposRecurso.find(t => t.id === 'rt_svb').retirado, Object.values(c.state.units).find(x => x.ind === 'SVB-1').tipo]")
        assert r == [True, 'rt_svb'], r
        A.a('cat.save'); A.pg.wait_for_timeout(500)
        assert ev("return c.state.prev.cat.tiposRecurso.find(t => t.id === 'rt_svb').retirado") is True, 'guardar el editor no deshace la retirada'
        return 'en el preventivo: el tipo usado se retira (no se borra del historial) y la unidad lo conserva'
    check('Preventivo: un tipo usado se retira conservando el historial', preventivo)
    def plantilla_usada():
        A.close_sheets()
        A.nav('unidades'); A.a('u.new'); s = A.sheet(); s.locator('[data-a="u.fromTpl"]', has_text='UPR').first.click(); A.pg.wait_for_timeout(300)
        f = A.sheet().locator('form[data-f="u.tplSave"]'); f.locator('[name=numero]').fill('77'); f.locator('button.primary').click(); A.pg.wait_for_timeout(600)
        A.a('prev.exit'); A.nav('config'); A.pg.locator('[data-a="nav"][data-v="uplantillas"]').first.click(); A.pg.wait_for_selector('[data-plantilla]')
        A.pg.locator('[data-plantilla="plt_upr"] [data-a="upl.del"]').click(); A.pg.wait_for_timeout(400)
        assert 'Se creó 1 unidad' in A.sheet().inner_text(), A.sheet().inner_text()[:300]
        A.dlg_ok(); A.pg.wait_for_timeout(400)
        assert not A.pg.locator('[data-plantilla="plt_upr"]').count()
        assert ev("return Object.values(c.engine(c.summaries.find(s => s.nombre === 'Carrera popular').id).state.units).some(u => u.ind === 'UPR 77')")
        return 'plantilla usada eliminada tras ver sus unidades; UPR 77 sigue en el preventivo'
    check('Eliminar una unidad plantilla ya usada', plantilla_usada)
    check('Sin errores de JavaScript (escenario 8)', lambda: (_ for _ in ()).throw(Exception('; '.join(A.errors[:5]))) if A.errors else 'ninguno')
    A.ctx.close()

# ---------------- Escenario 9 (1.4.0): tipo de mapa por preventivo ----------------
def tesela_color(rgb, alpha=255):
    from PIL import Image, ImageDraw
    im = Image.new('RGBA', (256, 256), rgb + (alpha,)); d = ImageDraw.Draw(im); d.line([(0, 128), (255, 128)], fill=(255, 255, 255, 255), width=6)
    b = io.BytesIO(); im.save(b, 'PNG'); return b.getvalue()
def rutas_ign(ctx):
    fecha = time.strftime('%a, %d %b %Y %H:%M:%S GMT', time.gmtime())
    teselas = {'pnoa-ma': tesela_color((62, 96, 52)), 'ign-base': tesela_color((0, 0, 0), 0), 'mapa-raster': tesela_color((243, 232, 200))}
    def servir(r):
        svc = r.request.url.split('/wmts/')[1].split('?')[0]
        r.fulfill(status=200, body=teselas.get(svc, teselas['mapa-raster']), headers={'Content-Type': 'image/png', 'Access-Control-Allow-Origin': '*', 'Date': fecha})
    ctx.route('https://www.ign.es/wmts/**', servir)

def scenario_vista_mapa(b):
    print('\n== Escenario 9: tipo de mapa en cada preventivo (1.4.0) ==')
    A = App(b, 'vista', PHONE); rutas_cartografia(A.ctx); rutas_ign(A.ctx)
    A.setup('Pablo Jefe', 'pablo', 'secreto9', 'Tablet PMA', 'P'); A.perms(False)
    ev = lambda js: A.pg.evaluate('() => { const c = window.__UCO.core; ' + js + ' }')
    teselas = lambda: A.pg.locator('.coord-map img.leaflet-tile').evaluate_all('ts => [...new Set(ts.map(t => (t.src.match(/wmts\/([a-z-]+)/) || [null, new URL(t.src).hostname])[1]))].sort()')
    def importar_zona():
        A.nav('plano'); A.a('plan.google'); s = A.sheet(); s.locator('#carto-map .leaflet-tile').first.wait_for(timeout=15000)
        s.locator('form[data-f="carto.buscar"] [name=q]').fill('Puerta del Sol Madrid'); s.locator('form[data-f="carto.buscar"] button').click(); A.pg.wait_for_timeout(1800)
        s.locator('form[data-f="carto.ok"] button.primary').click(); A.pg.wait_for_selector('.coord-map .leaflet-tile', timeout=15000); A.pg.wait_for_timeout(600)
    def elegir(nombre):
        A.pg.locator('[data-a="plan.vista"]').first.click(); A.pg.wait_for_selector('.sheet-wrap .vistas')
        if nombre == 'Satélite': A.pg.wait_for_timeout(400); A.shot('00-selector-vistas')
        A.sheet().locator('[data-a="plan.vistaSel"]', has_text=nombre).first.click(); A.pg.wait_for_timeout(1200)
    def cambiar():
        A.new_prev('Nochevieja en Sol', 'independiente', True)
        A.new_unit('SVA-1', 'Avanzada', 'rt_sva', 'sec_1')
        importar_zona()
        A.a('plan.pick', id=A.unit_id('SVA-1')); box = A.pg.locator('.coord-map').bounding_box(); A.pg.mouse.click(box['x'] + box['width'] * 0.5, box['y'] + box['height'] * 0.5); A.pg.wait_for_timeout(600)
        antes = ev("const u = Object.values(c.state.units)[0]; return JSON.stringify([u.plan, c.state.prev.plano])")
        assert teselas() == ['tile.openstreetmap.org'], teselas()
        assert A.pg.locator('[data-a="plan.vista"]').first.inner_text().strip() == 'Mapa'
        elegir('Satélite'); A.shot('01-satelite')
        assert teselas() == ['pnoa-ma'], teselas()
        assert A.pg.locator('.coord-map .leaflet-control-attribution').inner_text().find('Instituto Geográfico Nacional') >= 0
        elegir('Híbrido'); assert teselas() == ['ign-base', 'pnoa-ma'], teselas()
        A.shot('02-hibrido')
        assert A.pg.locator('.coord-map .mk[data-mk="u"]').count() == 1, 'el marcador de la unidad sigue en el plano'
        despues = ev("const u = Object.values(c.state.units)[0]; return JSON.stringify([u.plan, c.state.prev.plano])")
        assert antes == despues, 'posiciones y plano intactos'
        elegir('Relieve'); assert teselas() == ['mapa-raster'], teselas()
        elegir('Híbrido')
        return 'Mapa → Satélite (PNOA) → Híbrido (PNOA + callejero) → Relieve (MTN) → Híbrido; marcador y posiciones intactos'
    check('Tipo de mapa: cambiar la vista desde el plano del preventivo', cambiar)
    def persiste():
        A.goto(); A.login('pablo', 'secreto9')
        # La aplicación vuelve a abrir el último preventivo; si no, se abre desde la lista
        if 'Nochevieja en Sol' not in A.pg.locator('.top').inner_text():
            A.pg.locator('[data-a="home.open"]', has_text='Nochevieja en Sol').first.click(); A.pg.wait_for_selector('.kpis')
        A.nav('plano'); A.pg.wait_for_selector('.coord-map .leaflet-tile', timeout=15000); A.pg.wait_for_timeout(800)
        assert A.pg.locator('[data-a="plan.vista"]').first.inner_text().strip() == 'Híbrido'
        assert teselas() == ['ign-base', 'pnoa-ma'], teselas()
        return 'tras salir y volver a entrar sigue en «Híbrido»'
    check('Tipo de mapa: la elección se conserva', persiste)
    def otro():
        A.new_prev('Cabalgata', 'independiente', True); importar_zona()
        assert A.pg.locator('[data-a="plan.vista"]').first.inner_text().strip() == 'Mapa'
        assert teselas() == ['tile.openstreetmap.org'], teselas()
        return 'otro preventivo conserva el mapa estándar'
    check('Tipo de mapa: no afecta a otros preventivos', otro)
    def imagen():
        A.new_prev('Feria en recinto', 'independiente', True); A.nav('plano')
        with A.pg.expect_file_chooser() as fc: A.a('plan.import')
        fc.value.set_files(PLANO); A.pg.wait_for_selector('.coord-map .plano-img', timeout=15000); A.pg.wait_for_timeout(500)
        assert not A.pg.locator('[data-a="plan.vista"]').count(), 'sin selector en un plano de imagen'
        assert 'Plano de imagen' in A.pg.locator('.coord-ayuda').inner_text()
        return 'plano de imagen: funciona igual y no ofrece vistas de mapa'
    check('Tipo de mapa: los planos de imagen siguen funcionando', imagen)
    check('Sin errores de JavaScript (escenario 9)', lambda: (_ for _ in ()).throw(Exception('; '.join(A.errors[:5]))) if A.errors else 'ninguno')
    A.ctx.close()

# ---------------- Escenario 10 (1.4.0): servidor que valida — usuarios, registro, código + PIN y permisos ----------------
def scenario_modo_servidor(b):
    print('\n== Escenario 10: usuarios y permisos en el servidor (1.4.0) ==')
    port = PORT + 7; url = f'http://127.0.0.1:{port}/'; data = tempfile.mkdtemp(prefix='uco-e2e-ms-')
    srv = start_server(data, port)
    try:
        A = App(b, 'ms-admin', TABLET, base=url)
        ev = lambda app, js: app.pg.evaluate('async () => { const c = window.__UCO.core; ' + js + ' }')
        estado = {}
        def alta():
            A.setup('Rosa Admin', 'rosa', 'clave-rosa-1', 'Tablet PC', 'R', codigo=ADMIN_CODE); A.perms(False)
            assert ev(A, 'return c.modoServidor()') is True, 'espacio en modo servidor'
            A.nav('sistema'); A.pg.locator('[data-a="nav"][data-v="usuarios"]').first.click(); A.pg.wait_for_selector('[data-a="us.nuevo"]', timeout=15000)
            A.a('us.nuevo'); f = A.sheet().locator('form[data-f="us.crear"]')
            f.locator('[name=nombre]').fill('Luis Conductor'); f.locator('[name=usuario]').fill('luis'); f.locator('[name=metodo]').select_option('pin')
            f.locator('[name=perfil]').select_option('rol_operador'); f.locator('button.primary').click()
            A.pg.wait_for_selector('.sheet-wrap [data-codigo]', timeout=15000); A.pg.wait_for_timeout(400); A.shot('01-codigo-activacion')
            estado['codigo'] = A.sheet().locator('[data-codigo]').inner_text().strip()
            assert re.match(r'^[2-9A-Z]{4}-[2-9A-Z]{4}-[2-9A-Z]{2}$', estado['codigo']), estado['codigo']
            A.close_sheets()
            A.a('us.nuevo'); f = A.sheet().locator('form[data-f="us.crear"]')
            f.locator('[name=nombre]').fill('Pepe Consulta'); f.locator('[name=usuario]').fill('pepe'); f.locator('[name=pw]').fill('clave-pepe-1'); f.locator('[name=perfil]').select_option('rol_consulta')
            f.locator('button.primary').click(); A.pg.wait_for_timeout(800)
            assert A.pg.locator('.us-row', has_text='Pepe Consulta').count() == 1
            assert 'Invitación pendiente' in A.pg.locator('.us-row', has_text='Luis Conductor').inner_text()
            A.shot('02-usuarios-servidor')
            return 'servidor central activado en modo servidor; alta de Luis (código + PIN, código ' + estado['codigo'] + ') y de Pepe (contraseña)'
        check('Modo servidor: alta de usuarios con y sin contraseña desde la administración', alta)
        B = App(b, 'ms-luis', PHONE, base=url)
        def activar():
            B.goto(); B.pg.wait_for_selector('form[data-f="auth.central"]', timeout=20000)
            assert B.pg.locator('[data-a="auth.registro"]').count() and B.pg.locator('[data-a="auth.activar"]').count(), 'enlaces en el inicio de sesión'
            B.shot('03-login-servidor')
            B.a('auth.activar'); s = B.sheet()
            s.locator('[name=usuario]').fill('luis'); s.locator('[name=codigo]').fill(estado['codigo'].lower()); s.locator('form[data-f="auth.activar1"] button.primary').click()
            B.pg.wait_for_selector('.sheet-wrap form[data-f="auth.activar2"]', timeout=15000)
            s = B.sheet(); assert 'Solo valdrá en este dispositivo' in s.inner_text() or 'solo valdrá en este dispositivo' in s.inner_text().lower()
            s.locator('[name=p1]').fill('482913'); s.locator('[name=p2]').fill('482913'); s.locator('[name=dev]').fill('Móvil de Luis'); B.shot('04-activar-pin')
            s.locator('form[data-f="auth.activar2"] button.primary').click(); B.pg.wait_for_selector('.top', timeout=45000)
            B.pg.wait_for_selector('[data-perm-onboard]', timeout=8000); B.perms(False)  # se abre 700 ms después de entrar
            assert ev(B, 'return c.user.usuario') == 'luis'
            B.logout()
            B.pg.locator('#f_u').select_option('luis') if B.pg.locator('select#f_u').count() else B.pg.fill('#f_u', 'luis')
            assert 'PIN' in B.pg.locator('label[for=f_p]').inner_text()
            B.pg.fill('#f_p', '000000'); B.pg.click('form[data-f="auth.login"] button.primary'); B.pg.wait_for_timeout(1500)
            assert 'PIN incorrecto' in B.toast_text(), B.toast_text()
            B.pg.fill('#f_p', '482913'); B.pg.click('form[data-f="auth.login"] button.primary'); B.pg.wait_for_selector('.top', timeout=20000)
            return 'código de un solo uso → PIN propio del dispositivo; entra con el PIN y rechaza uno erróneo'
        check('Cuenta sin contraseña: activación con código y entrada con PIN', activar)
        C = App(b, 'ms-registro', PHONE, base=url)
        def registro():
            C.goto(); C.pg.wait_for_selector('form[data-f="auth.central"]', timeout=20000)
            C.a('auth.registro'); s = C.sheet()
            s.locator('[name=nombre]').fill('Marta Voluntaria'); s.locator('[name=usuario]').fill('marta'); s.locator('[name=p1]').fill('clave-marta-1'); s.locator('[name=p2]').fill('clave-marta-1')
            s.locator('form[data-f="auth.registro"] button.primary').click(); C.pg.wait_for_selector('.sheet-wrap [data-registro-ok]', timeout=30000)
            assert 'pendiente de aprobación' in C.sheet().inner_text(); C.shot('05-solicitud-enviada'); C.close_sheets()
            C.rellenar([('#f_u', 'marta'), ('#f_p', 'clave-marta-1')]); C.pg.click('form[data-f="auth.central"] button.primary'); C.pg.wait_for_timeout(2500)
            assert 'pendiente de aprobación' in C.toast_text(), C.toast_text()
            return 'solicitud desde el inicio de sesión; mientras está pendiente no entra'
        check('Registro desde el inicio de sesión: pendiente de aprobación', registro)
        def aprobar():
            A.a('us.recargar'); A.pg.wait_for_selector('.us-pend .us-row', timeout=15000)
            A.pg.locator('.us-pend .us-row', has_text='Marta Voluntaria').click(); A.pg.wait_for_selector('#us_perfil_ap')
            A.pg.locator('#us_perfil_ap').select_option('rol_consulta'); A.pg.wait_for_timeout(300); A.shot('06-aprobar')
            A.a('us.aprobar', A.sheet()); A.pg.wait_for_timeout(1000)
            assert 'Activo' in A.sheet().inner_text()
            A.close_sheets()
            C.rellenar([('#f_u', 'marta'), ('#f_p', 'clave-marta-1')]); C.pg.click('form[data-f="auth.central"] button.primary'); C.pg.wait_for_selector('.top', timeout=45000)
            C.pg.wait_for_selector('[data-perm-onboard]', timeout=8000); C.perms(False)  # se abre 700 ms después de entrar
            r = ev(C, "return [c.user.usuario, c.can('unidades.ver'), c.can('avisos.crear'), c.can('usuarios.admin')]")
            assert r == ['marta', True, False, False], r
            return 'aprobada con perfil Consulta: entra y solo puede consultar'
        check('Aprobación por el administrador con perfil', aprobar)
        def permisos():
            A.pg.locator('.us-row', has_text='Luis Conductor').click(); A.pg.wait_for_selector('.sheet-wrap .perm-mod')
            caja = A.sheet().locator('input[data-c="us.perm"][data-k="avisos.crear"]'); assert caja.is_checked()
            caja.uncheck(); A.pg.wait_for_timeout(400)
            assert 'quitado' in A.sheet().locator('label.perm', has=A.pg.locator('input[data-k="avisos.crear"]')).inner_text()
            A.pg.wait_for_timeout(300); A.shot('07-permisos-usuario')
            A.a('us.guardarPermisos', A.sheet()); A.pg.wait_for_timeout(1000)
            assert not A.sheet().locator('input[data-c="us.perm"][data-k="avisos.crear"]').is_checked()
            A.close_sheets()
            r = ev(B, "await c.central.syncNow(); return [c.can('avisos.crear'), c.can('unidades.crear')]")
            assert r == [False, True], r
            # La auditoría del servidor recoge quién cambió qué
            A.nav('sistema'); A.pg.locator('[data-a="nav"][data-v="auditoria"]').first.click(); A.pg.wait_for_selector('table.tbl', timeout=15000)
            txt = A.pg.locator('table.tbl').inner_text()
            for t in ['Permisos modificados', 'Registro aprobado', 'Alta de usuario', 'Cuenta activada en un dispositivo']: assert t in txt, t
            A.shot('08-auditoria-servidor', True)
            return 'permiso individual quitado (avisos) → llega al dispositivo de Luis; auditoría con autor y detalle'
        check('Permisos individuales por usuario y auditoría del servidor', permisos)
        def perfiles():
            A.nav('sistema'); A.pg.locator('[data-a="nav"][data-v="usuarios"]').first.click(); A.pg.wait_for_selector('[data-a="us.tab"]', timeout=15000)
            A.a('us.tab', v='p'); A.pg.locator('[data-a="pf.editar"].primary').click(); A.pg.wait_for_selector('.sheet-wrap form[data-f="pf.guardar"]')
            s = A.sheet(); s.locator('[name=nombre]').fill('Logística')
            s.locator('input[data-c="pf.perm"][data-k="unidades.editar"]').check(); A.pg.wait_for_timeout(300)
            assert A.sheet().locator('input[data-c="pf.perm"][data-k="unidades.editar"]').is_checked()
            A.sheet().locator('form[data-f="pf.guardar"] button.primary').click(); A.pg.wait_for_timeout(1000)
            fila = A.pg.locator('li.cat-row', has_text='Logística'); assert fila.count() == 1, 'perfil creado'
            fila.locator('[data-a="pf.duplicar"]').click(); A.pg.wait_for_timeout(1000)
            assert A.pg.locator('li.cat-row', has_text='Logística (copia)').count() == 1, 'perfil duplicado'
            A.pg.locator('li.cat-row', has_text='Logística (copia)').locator('[data-a="pf.borrar"]').click(); A.dlg_ok(); A.pg.wait_for_timeout(1000)
            assert A.pg.locator('li.cat-row', has_text='Logística (copia)').count() == 0, 'perfil sin uso eliminado'
            A.shot('09-perfiles')
            # Se asigna a Pepe y sus permisos efectivos son los del perfil
            A.a('us.tab', v='u'); A.pg.locator('.us-row', has_text='Pepe Consulta').click(); A.pg.wait_for_selector('.sheet-wrap .perm-mod')
            A.sheet().locator('select[data-c="us.perfil"]').select_option(label='Logística'); A.pg.wait_for_timeout(400)
            A.a('us.guardarPermisos', A.sheet()); A.pg.wait_for_timeout(1000); A.close_sheets()
            r = ev(A, "const d = await c.usuariosServidor(); const p = d.perfiles.find(x => x.nombre === 'Logística'); const u = d.usuarios.find(x => x.usuario === 'pepe'); return [u.perfil === p.id, p.permisos.includes('unidades.editar')]")
            assert r == [True, True], r
            return 'perfil nuevo desde la interfaz, duplicado, borrado el que no se usa y asignado a un usuario'
        check('Perfiles de permisos: crear, duplicar, eliminar y asignar', perfiles)
        def estado_servidor():
            A.nav('sistema'); A.pg.locator('[data-a="nav"][data-v="estado"]').first.click()
            A.pg.wait_for_selector('section.card h2:has-text("Datos y almacenamiento")', timeout=20000)
            txt = A.pg.inner_text('main')
            for t in ['Alertas', 'Servidor', 'Datos y almacenamiento', 'Recursos del equipo', 'Sincronización', 'Copias de seguridad', 'Este dispositivo', 'Servicios externos']: assert t in txt, t
            assert 'modo servidor' in txt and 'Tablet PC' in txt and 'Preventivos cargados en el servidor' in txt, txt[:800]
            B.nav('sistema'); B.pg.wait_for_timeout(400)
            assert B.pg.locator('[data-a="nav"][data-v="estado"]').count() == 0, 'un operador no ve el estado del sistema'
            A.shot('03-estado-sistema', True)
            return 'la administradora ve el estado (modo servidor, sin pedir código); un operador no tiene la opción'
        check('Estado del sistema (solo administradores)', estado_servidor)
        for app, n in ((A, 'admin'), (B, 'Luis'), (C, 'registro')):
            check('Sin errores de JavaScript (escenario 10, ' + n + ')', lambda app=app: (_ for _ in ()).throw(Exception('; '.join(app.errors[:5]))) if app.errors else 'ninguno')
        for app in (A, B, C): app.ctx.close()
    finally:
        srv.terminate(); shutil.rmtree(data, ignore_errors=True)

# ---------------- Escenario 11 (1.4.0): migración desde la app, sesión caducada y cambios rechazados ----------------
def scenario_migracion_sesion(b):
    print('\n== Escenario 11: paso al modo servidor desde la app, renovar la sesión y cambios rechazados (1.4.0) ==')
    port = PORT + 11; url = f'http://127.0.0.1:{port}/'; data = tempfile.mkdtemp(prefix='uco-e2e-mig-')
    srv = start_server(data, port)
    try:
        A = App(b, 'mig-admin', TABLET, base=url)
        ev = lambda app, js: app.pg.evaluate('async () => { const c = window.__UCO.core; ' + js + ' }')
        estado = {}
        def a_central(app):
            if app.pg.locator('[data-a="prev.exit"]').count(): app.a('prev.exit')
            app.nav('inicio'); app.pg.locator('.central-bar [data-a="nav"][data-v="central"]').first.click(); app.pg.wait_for_timeout(500)
        def migrar():
            # Espacio creado como en la 1.3.0 (cifrado de extremo a extremo; el servidor no valida)
            A.setup('Rosa Admin', 'rosa', 'clave-rosa-1', 'Tablet PC', 'R'); A.perms(False)
            ev(A, f"await c.centralActivar({{ codigo: '{ADMIN_CODE}', password: 'clave-rosa-1', modo: 'cifrado' }}); return 1")
            assert ev(A, 'return c.modoServidor()') is False
            estado['pid'] = ev(A, "const pid = await c.createPrev({ datos: { nombre: 'Carrera popular', modalidad: 'compartida', activar: true }, seed: c.seedFromConfig() }); await c.sync.syncNow(pid); await c.central.syncNow(); return pid")
            a_central(A); A.pg.wait_for_selector('[data-migracion]', timeout=15000)
            assert 'Cifrado de extremo a extremo' in A.pg.locator('main').inner_text()
            f = A.pg.locator('form[data-f="central.migrar"]')
            f.locator('[name=codigo]').fill(ADMIN_CODE); f.locator('[name=p]').fill('clave-rosa-1'); f.locator('[name=ok]').check()
            # Un repintado por sincronización no debe desmarcar la casilla (ni borrar lo escrito)
            A.pg.evaluate('() => window.__UCO.render()'); A.pg.wait_for_timeout(400)
            f = A.pg.locator('form[data-f="central.migrar"]')
            assert f.locator('[name=ok]').is_checked(), 'la casilla marcada se pierde al repintar'
            assert f.locator('[name=codigo]').input_value() == ADMIN_CODE
            A.pg.wait_for_timeout(300); A.shot('01-migracion')
            f.locator('button.primary').click()
            avisos = []
            for _ in range(60):
                A.pg.wait_for_timeout(500); t = A.toast_text()
                if t and t not in avisos: avisos.append(t)
                if A.pg.evaluate('() => window.__UCO.core.modoServidor()'): break
            assert A.pg.evaluate('() => window.__UCO.core.modoServidor()'), 'no pasa al modo servidor. Avisos: ' + ' || '.join(avisos)
            A.pg.wait_for_timeout(1000)
            assert 'Servidor que valida' in A.pg.locator('main').inner_text()
            assert A.pg.locator('[data-migracion]').count() == 0, 'la tarjeta de migración desaparece'
            assert ev(A, f"await c.sync.syncNow('{estado['pid']}'); return c.engine('{estado['pid']}').state.prev.nombre") == 'Carrera popular'
            A.shot('02-modo-servidor')
            return 'espacio 1.3.0 → modo servidor con el código del servidor y la contraseña; el preventivo compartido sigue'
        check('Migración del espacio al modo servidor desde la aplicación', migrar)
        B = App(b, 'mig-eva', PHONE, base=url)
        def sesion():
            estado['eva'] = ev(A, "const r = await c.crearUsuarioServidor({ usuario: 'eva', nombre: 'Eva Operadora', metodo: 'password', password: 'clave-eva-12', perfil: 'rol_operador' }); return r.usuario.id")
            B.goto(); B.central_login('eva', 'clave-eva-12', 'Móvil de Eva'); B.pg.wait_for_selector('.top', timeout=45000)
            B.pg.wait_for_selector('[data-perm-onboard]', timeout=8000); B.perms(False)
            if B.pg.locator('[data-a="prev.exit"]').count(): B.a('prev.exit')
            B.nav('inicio')
            for _ in range(30):
                ev(B, 'await c.central.syncNow(); return 1'); B.pg.wait_for_timeout(500)
                if B.pg.locator('[data-a="home.openCentral"], [data-a="home.open"]').count(): break
            B.pg.locator('[data-a="home.openCentral"], [data-a="home.open"]').first.click(); B.pg.wait_for_selector('.kpis', timeout=30000); B.pg.wait_for_timeout(500)
            ev(A, f"await c.revocarUsuarioServidor('{estado['eva']}'); return 1")  # el administrador cierra sus sesiones
            ev(B, 'await c.central.syncNow(); return 1'); B.pg.wait_for_timeout(500)
            assert ev(B, 'return c.centralEstado().st.estado') == 'sesion', ev(B, 'return c.centralEstado().st')
            if B.pg.locator('[data-a="prev.exit"]').count(): B.a('prev.exit')
            B.nav('inicio'); assert 'Inicia sesión para sincronizar' in B.pg.locator('.central-bar').inner_text()
            a_central(B); B.pg.wait_for_selector('form[data-f="central.sesion"]', timeout=15000); B.pg.wait_for_timeout(300); B.shot('03-renovar-sesion')
            B.pg.locator('form[data-f="central.sesion"] [name=p]').fill('clave-eva-12'); B.pg.locator('form[data-f="central.sesion"] button.primary').click(); B.pg.wait_for_timeout(1500)
            st = ev(B, 'await c.central.syncNow(); return c.centralEstado().st.estado'); assert st == 'conectado', st
            return 'sesiones de Eva cerradas por el administrador → «Inicia sesión para sincronizar» → contraseña → vuelve a sincronizar'
        check('Sesión revocada o caducada: se renueva con la contraseña', sesion)
        def rechazo():
            # Eva trabaja sin conexión con permisos antiguos; mientras, el administrador le quita «crear unidades»
            if B.pg.locator('[data-a="prev.exit"]').count(): B.a('prev.exit')
            B.nav('inicio'); B.pg.locator('[data-a="home.open"]', has_text='Carrera popular').first.click(); B.pg.wait_for_selector('.kpis'); B.pg.wait_for_timeout(300)
            B.ctx.set_offline(True); B.pg.wait_for_timeout(300)
            ev(A, f"await c.cambiarUsuarioServidor('{estado['eva']}', {{ ajustes: {{ mas: [], menos: ['unidades.crear'] }} }}); return 1")
            B.new_unit('SVB-77', 'Creada sin conexión')
            assert B.state("return Object.values(s.units).some(u => u.ind === 'SVB-77')"), 'sin conexión se crea en local'
            B.ctx.set_offline(False); B.pg.wait_for_timeout(300)
            for _ in range(20):
                ev(B, f"await c.sync.syncNow('{estado['pid']}'); await c.central.syncNow(); return 1"); B.pg.wait_for_timeout(400)
                if not B.state("return Object.values(s.units).some(u => u.ind === 'SVB-77')"): break
            assert not B.state("return Object.values(s.units).some(u => u.ind === 'SVB-77')"), 'el servidor la rechaza y se deshace'
            a_central(B); B.pg.wait_for_selector('[data-rechazos]', timeout=15000)
            txt = B.pg.locator('[data-rechazos]').inner_text(); assert 'SVB-77' in txt and 'Carrera popular' in txt, txt
            B.pg.locator('[data-rechazos]').scroll_into_view_if_needed(); B.pg.wait_for_timeout(300); B.shot('04-cambios-rechazados')
            B.a('central.rechazosRevisados'); B.pg.wait_for_timeout(1000)
            assert 'Revisados (1)' in B.pg.locator('[data-rechazos]').inner_text()
            vista = ev(A, f"await c.sync.syncNow('{estado['pid']}'); return Object.values(c.engine('{estado['pid']}').state.units).some(u => u.ind === 'SVB-77')")
            assert vista is False, 'a los demás no les llega'
            return 'unidad creada sin conexión con un permiso ya retirado: el servidor la rechaza, se deshace, queda en «Cambios rechazados» y se marca como revisada'
        check('Cambios rechazados por el servidor: visibles y revisables', rechazo)
        for app, n in ((A, 'admin'), (B, 'Eva')):
            check('Sin errores de JavaScript (escenario 11, ' + n + ')', lambda app=app: (_ for _ in ()).throw(Exception('; '.join(app.errors[:5]))) if app.errors else 'ninguno')
        for app in (A, B): app.ctx.close()
    finally:
        srv.terminate(); shutil.rmtree(data, ignore_errors=True)

# ---------------- Escenario 12 (1.5.0): capas y filtros del plano ----------------
def scenario_capas(b):
    print('\n== Escenario 12: capas y filtros del plano, sectores, puntos, ficha contextual y agrupación (1.5.0) ==')
    port = PORT + 12; url = f'http://127.0.0.1:{port}/'; data = tempfile.mkdtemp(prefix='uco-e2e-capas-')
    salida = os.path.join(data, 'capas.json')
    subprocess.run(['node', 'tests/e2e/generar_capas.mjs', salida], cwd=ROOT, check=True)
    datos = json.load(open(salida))
    srv = start_server(data, port)
    try:
        A = App(b, 'capas', TABLET, base=url)
        estado = {}
        def mk(sel): return A.pg.locator('.coord-map ' + sel).count()
        def tocar(fx, fy):
            bb = A.pg.locator('.coord-map').bounding_box(); A.pg.mouse.click(bb['x'] + bb['width'] * fx, bb['y'] + bb['height'] * fy); A.pg.wait_for_timeout(500)
        def abrir(pid):
            A.pg.evaluate(f"async () => {{ await window.__UCO.core.openPrev('{pid}'); window.__UCO.render(); }}"); A.pg.wait_for_timeout(500)
            A.nav('plano'); A.pg.wait_for_selector('.coord-map .leaflet-marker-icon', timeout=20000); A.pg.wait_for_timeout(1200)
        def capas():
            A.setup('Carla Coordinadora', 'carla', 'clave-carla-1', 'Tablet', 'K'); A.perms(False)
            for pid, ops in datos.items():
                nmax = max([o.get('num') or 0 for o in ops])
                A.pg.evaluate("async ([pid, ops, n]) => { const c = window.__UCO.core; await c.repo.appendOps(pid, ops); await c.repo.maxCounter(pid, n); await c.openPrev(pid); await c._summary(pid); }", [pid, ops, nmax])
            abrir('prev_capas')
            assert mk('.mk[data-mk="u"]') == 3, mk('.mk[data-mk="u"]')
            assert mk('.mk[data-mk="a"]') == 1, 'solo el aviso activo; el finalizado no se pide'
            assert mk('.mk.poi') == 2 and mk('.mk[data-sit="descanso"] .mk-disp') == 1
            assert 'Sector 1' in ' '.join(A.pg.locator('.sec-label').all_inner_texts())
            ley = A.pg.locator('.legend').inner_text()
            for t in ['En descanso', 'Fuera de servicio', 'Aviso activo', 'Accesos y salidas', 'Hospital']: assert t in ley, t
            A.shot('01-capas')
            return '3 unidades (una con el símbolo de descanso), aviso activo, sector delimitado con su nombre, 2 puntos y leyenda con símbolos'
        check('Capas: unidades, avisos, sectores y puntos con su leyenda', capas)
        def filtros():
            A.a('plan.capas'); A.pg.wait_for_selector('.sheet-wrap .chips-f')
            A.sheet().locator('[data-a="plan.filtro"][data-campo="tipos"][data-v="rt_svb"]').click(); A.pg.wait_for_timeout(500)
            assert mk('.mk[data-mk="u"]') == 2, mk('.mk[data-mk="u"]')
            A.sheet().locator('[data-a="plan.filtro"][data-campo="disponibilidad"][data-v="descanso"]').click(); A.pg.wait_for_timeout(500)
            assert mk('.mk[data-mk="u"]') == 1 and mk('.mk[data-sit="descanso"]') == 1, 'tipo + disponibilidad combinados'
            assert A.sheet().locator('[data-a="plan.filtro"][data-v="rt_svb"]').get_attribute('aria-pressed') == 'true'
            A.pg.wait_for_timeout(300); A.shot('02-filtros', True)
            r = A.state("const u = Object.values(s.units).find(x => x.ind === 'SVB-1'); return [u.sit, u.clave, !!u.plan]")
            assert r == ['activa', 'C0', True], 'ocultar no desactiva ni mueve: ' + str(r)
            A.close_sheets(); assert 'Capas y filtros · 2' in A.pg.locator('.plan-tools').inner_text()
            A.a('plan.restablecer'); A.pg.wait_for_timeout(500)
            assert mk('.mk[data-mk="u"]') == 3
            return 'tipo SVB → 2; + descanso → 1 (SVB-2); los datos no cambian; «Restablecer» vuelve a mostrar las 3'
        check('Filtros combinados y restablecer (ocultar no es desactivar)', filtros)
        def finalizados_y_ocultar():
            A.a('plan.capas'); A.pg.wait_for_selector('.sheet-wrap [data-c="plan.capa"][data-v="finalizados"]')
            A.sheet().locator('[data-c="plan.capa"][data-v="finalizados"]').check(); A.pg.wait_for_timeout(500)
            assert mk('.mk.av.fin') == 1, 'el finalizado aparece al pedirlo, en gris'
            A.sheet().locator('[data-c="plan.secVer"]').first.uncheck(); A.pg.wait_for_timeout(500)
            assert A.pg.locator('.sec-label').count() == 0, 'sector oculto'
            A.sheet().locator('[data-c="plan.catVer"][data-id="cp_hospital"]').uncheck(); A.pg.wait_for_timeout(500)
            assert mk('.mk.poi') == 1, 'categoría Hospital oculta'
            A.a('plan.restablecer', A.sheet()); A.pg.wait_for_timeout(500); A.close_sheets()
            assert mk('.mk.av.fin') == 0 and mk('.mk.poi') == 2 and A.pg.locator('.sec-label').count() == 1
            return 'avisos finalizados bajo petición; sectores y categorías se ocultan uno a uno; restablecer'
        check('Avisos finalizados, sectores y categorías: mostrar u ocultar', finalizados_y_ocultar)
        def editar():
            # Nuevo punto tocando el plano
            A.a('plan.capas'); A.a('plan.puntoNuevo', A.sheet()); A.pg.wait_for_selector('.sheet-wrap form[data-f="plan.puntoForm"]')
            f = A.sheet().locator('form[data-f="plan.puntoForm"]'); f.locator('[name=nombre]').fill('Punto de encuentro norte'); f.locator('[name=categoria]').select_option('cp_encuentro')
            f.locator('button.primary').click(); A.pg.wait_for_selector('[data-a="plan.puntoCancelar"]')
            tocar(0.6, 0.15); A.pg.wait_for_timeout(500)
            assert mk('.mk.poi') == 3 and 'Punto de encuentro norte' in A.pg.locator('.map-card').inner_text()
            # Delimitar el sector 2 con tres toques
            A.a('plan.capas'); A.sheet().locator('[data-a="plan.secDelimitar"][data-id="sec_2"]').click(); A.pg.wait_for_timeout(400)
            for x, y in ((0.55, 0.35), (0.78, 0.35), (0.7, 0.85)): tocar(x, y)  # dentro del plano (el rectángulo rojo)
            A.a('plan.zonaOk'); A.pg.wait_for_timeout(800)
            assert 'Sector 2' in ' '.join(A.pg.locator('.sec-label').all_inner_texts())
            z = A.state("return s.prev.cat.sectores.find(x => x.id === 'sec_2').zona.pts.length"); assert z == 3, z
            A.shot('03-punto-y-sector')
            return 'punto nuevo tocando el plano y sector 2 delimitado con 3 toques; se guardan en el preventivo (bitácora)'
        check('Puntos y delimitación de sectores desde el plano', editar)
        def ficha():
            A.a('plan.selCerrar'); uid = A.state("return Object.values(s.units).find(x => x.ind === 'SVB-1').id")
            A.pg.locator(f'.coord-map .mk[data-mk="u"][data-id="{uid}"]').click(); A.pg.wait_for_selector('.map-card[data-map-card="u"]', timeout=5000)
            t = A.pg.locator('.map-card').inner_text(); assert 'SVB-1' in t and 'Disponible' in t and 'Sector 1' in t, t
            A.pg.wait_for_timeout(300); A.shot('04-ficha-contextual')
            A.a('plan.selAbrir'); A.pg.wait_for_selector('.sheet-wrap'); A.close_sheets()
            aid = A.state("return Object.values(s.avisos).find(a => a.estado !== 'finalizado').id")
            A.pg.locator(f'.coord-map .mk[data-mk="a"][data-id="{aid}"]').click(); A.pg.wait_for_selector('.map-card[data-map-card="a"]', timeout=5000)
            assert 'SVA-1' in A.pg.locator('.map-card').inner_text()
            tocar(0.5, 0.06); assert A.pg.locator('.map-card').count() == 0, 'tocar fuera la cierra'  # la ficha ocupa la esquina inferior derecha
            return 'unidad y aviso: ficha dentro del mapa (situación, clave, unidades) con acceso a la ficha completa'
        check('Ficha contextual sin salir del mapa', ficha)
        def preferencias():
            A.a('plan.capas'); A.sheet().locator('[data-a="plan.filtro"][data-campo="tipos"][data-v="rt_sva"]').click(); A.pg.wait_for_timeout(400); A.close_sheets()
            assert mk('.mk[data-mk="u"]') == 1
            A.pg.reload(); A.login('carla', 'clave-carla-1'); abrir('prev_capas')
            assert mk('.mk[data-mk="u"]') == 1 and 'Capas y filtros · 1' in A.pg.locator('.plan-tools').inner_text(), 'se conserva en este preventivo'
            abrir('prev_grande')
            assert 'Capas y filtros ·' not in A.pg.locator('.plan-tools').inner_text(), 'otro preventivo: sin filtros'
            return 'filtro guardado tras recargar en ese preventivo; el otro preventivo no se ve afectado'
        check('Preferencias de visualización por preventivo', preferencias)
        def muchos():
            t0 = time.time(); abrir('prev_grande'); ms = int((time.time() - t0) * 1000)
            g = mk('.mk.grupo'); assert g >= 1, 'agrupados con poco zoom'
            antes = A.pg.evaluate('() => document.querySelectorAll(".coord-map .mk[data-mk=u]").length')
            A.pg.locator('.coord-map .mk.grupo').first.click(); A.pg.wait_for_timeout(1200)
            despues = A.pg.evaluate('() => document.querySelectorAll(".coord-map .mk[data-mk=u]").length')
            assert despues > antes, (antes, despues)
            A.shot('05-agrupacion')
            return f'150 unidades: {g} grupos al abrir ({ms} ms hasta ver el plano); al tocar un grupo se acerca y aparecen {despues} unidades sueltas'
        check('Muchos elementos: agrupación y fluidez', muchos)
        check('Sin errores de JavaScript (escenario 12)', lambda: (_ for _ in ()).throw(Exception('; '.join(A.errors[:5]))) if A.errors else 'ninguno')
        A.ctx.close()
    finally:
        srv.terminate(); shutil.rmtree(data, ignore_errors=True)

# ---------------- Escenario 13 (1.5.0): avisos desde el mapa y alternativas accesibles ----------------
def scenario_avisos_mapa(b):
    print('\n== Escenario 13: avisos desde el mapa, ubicación sin mapa y accesibilidad (1.5.0) ==')
    port = PORT + 13; url = f'http://127.0.0.1:{port}/'; data = tempfile.mkdtemp(prefix='uco-e2e-avm-')
    salida = os.path.join(data, 'capas.json')
    subprocess.run(['node', 'tests/e2e/generar_capas.mjs', salida], cwd=ROOT, check=True)
    datos = json.load(open(salida))
    srv = start_server(data, port)
    try:
        A = App(b, 'avisos-mapa', TABLET, base=url)
        estado = {}
        def mk(sel): return A.pg.locator('.coord-map ' + sel).count()
        def tocar(fx, fy):
            bb = A.pg.locator('.coord-map').bounding_box(); A.pg.mouse.click(bb['x'] + bb['width'] * fx, bb['y'] + bb['height'] * fy); A.pg.wait_for_timeout(500)
        def nombres_vacios(scope):
            # Controles visibles sin nombre accesible (etiqueta, aria-label, title o texto)
            return A.pg.evaluate("""sel => [...document.querySelectorAll(sel + ' button, ' + sel + ' input, ' + sel + ' select, ' + sel + ' textarea')].filter(e => e.offsetParent && e.type !== 'hidden').filter(e => {
                const t = (e.getAttribute('aria-label') || e.title || (e.labels && [...e.labels].map(l => l.textContent).join(' ')) || e.textContent || '').trim();
                return !t; }).map(e => e.outerHTML.slice(0, 80))""", scope)
        def desde_mapa():
            A.setup('Marta Coordinadora', 'marta', 'clave-marta-1', 'Tablet', 'T'); A.perms(False)
            ops = datos['prev_capas']; nmax = max([o.get('num') or 0 for o in ops])
            A.pg.evaluate("async ([pid, ops, n]) => { const c = window.__UCO.core; await c.repo.appendOps(pid, ops); await c.repo.maxCounter(pid, n); await c.openPrev(pid); await c._summary(pid); window.__UCO.render(); }", ['prev_capas', ops, nmax])
            A.nav('plano'); A.pg.wait_for_selector('.coord-map .leaflet-marker-icon', timeout=20000); A.pg.wait_for_timeout(1000)
            A.a('plan.avisoMapa'); A.pg.wait_for_selector('[data-a="plan.avisoSinMapa"]')
            tocar(0.3, 0.45)  # dentro del sector 1
            A.pg.wait_for_selector('[data-ajuste]'); assert mk('.mk.av.nuevo') == 1, 'marcador provisional'
            ini = A.pg.locator('[data-prov-pos]').inner_text(); assert 'sector Sector 1' in ini, ini
            A.a('plan.mover', d='e'); A.a('plan.mover', d='e')
            tras_botones = A.pg.locator('[data-prov-pos]').inner_text(); assert tras_botones != ini, 'los botones lo mueven'
            A.pg.locator('[data-ajuste]').focus(); A.pg.keyboard.press('ArrowUp'); A.pg.wait_for_timeout(400)
            tras_teclado = A.pg.locator('[data-prov-pos]').inner_text(); assert tras_teclado != tras_botones, 'las teclas de dirección también'
            assert A.pg.evaluate('() => !!document.activeElement.closest("[data-ajuste]")'), 'el foco sigue en el ajuste'
            assert not nombres_vacios('.aviso-prov'), nombres_vacios('.aviso-prov')
            A.shot('01-marcador-provisional')
            A.pg.keyboard.press('Enter'); A.pg.wait_for_selector('.sheet-wrap [data-a="inc.mas"]'); A.a('inc.mas')
            f = A.sheet().locator('form[data-f="a.save"]'); loc = f.locator('[data-locsum]').inner_text()
            assert 'no es una posición GPS' in loc, loc
            assert f.locator('[name=sector]').input_value() == 'sec_1', 'sector propuesto por la delimitación'
            A.pg.wait_for_selector('.sheet-wrap [data-unidades-aviso] .u-asig')
            u = {r['ind']: r for r in A.pg.evaluate("""() => [...document.querySelectorAll('.sheet-wrap .u-asig')].map(l => ({ ind: l.querySelector('b').textContent, dis: l.querySelector('input').disabled, sug: !!l.querySelector('.ok-chip'), txt: l.textContent }))""")}
            assert u['SVB-1']['sug'] and not u['SVB-1']['dis'], u['SVB-1']
            assert u['SVB-2']['dis'] and 'descanso' in u['SVB-2']['txt'].lower(), u['SVB-2']
            assert u['SVA-1']['dis'] and 'Ocupada' in u['SVA-1']['txt'], u['SVA-1']
            assert not any(x['sug'] for x in u.values() if x['dis']), 'nunca se sugiere una unidad que no puede'
            assert not A.pg.locator('.sheet-wrap input[name=u_asig]:checked').count(), 'ninguna se marca sola'
            assert not nombres_vacios('.sheet-wrap form[data-f="a.save"]'), nombres_vacios('.sheet-wrap form[data-f="a.save"]')
            A.pg.wait_for_timeout(300); A.shot('02-formulario-unidades', True)
            A.sheet().locator('.u-asig', has_text='SVB-1').locator('input').check()
            f.locator('[name=desc]').fill('Mareo junto a la fuente'); f.locator('button.primary').click(); A.pg.wait_for_timeout(900); A.close_sheets()
            a = A.pg.evaluate("() => Object.values(window.__UCO.core.state.avisos).find(a => a.desc === 'Mareo junto a la fuente')")
            assert a['loc']['fuente'] == 'mapa' and a['sector'] == 'sec_1' and a['plan'], a
            svb = A.state("return Object.values(s.units).find(x => x.ind === 'SVB-1').id")
            assert any(p['u'] == svb and p['lib'] is None for p in a['part']), 'SVB-1 asignada'
            estado['aviso'] = a['id']
            return 'botón → toque → marcador provisional (sector 1) ajustado con botones y con el teclado → formulario con ubicación «marcada en el mapa», sector y unidades con su situación; SVB-1 sugerida y elegida, las ocupadas o en descanso no se pueden marcar'
        check('Aviso desde el mapa: marcar, ajustar sin arrastrar, confirmar y elegir unidades', desde_mapa)
        def sin_mapa():
            A.nav('avisos'); A.a('a.new'); A.pg.wait_for_selector('.sheet-wrap [data-a="inc.mas"]'); A.a('inc.mas')
            f = A.sheet().locator('form[data-f="a.save"]'); f.locator('[data-a="a.formLoc"]').click(); A.pg.wait_for_selector('.sheet-wrap #f_locpt')
            # Coordenadas imposibles: se avisa y no se guardan
            A.sheet().locator('#f_lat').fill('95'); A.sheet().locator('#f_lon').fill('-3.7'); A.sheet().locator('form[data-f="loc.save"] button.primary').click(); A.pg.wait_for_timeout(500)
            assert 'Coordenadas no válidas' in A.toast_text(), A.toast_text()
            A.sheet().locator('#f_lat').fill(''); A.sheet().locator('#f_lon').fill('')
            A.sheet().locator('#f_locpt').select_option('pt_puerta'); A.pg.wait_for_timeout(400)
            assert 'Punto del plano' in A.sheet().locator('[data-loc-fuente]').inner_text()
            A.sheet().locator('form[data-f="loc.save"] button.primary').click(); A.pg.wait_for_timeout(800)
            assert not A.pg.locator('.sheet-wrap form[data-f="loc.save"]').count(), 'la hoja de ubicación no se cierra. Avisos: ' + A.toast_text()
            f = A.sheet().locator('form[data-f="a.save"]'); assert 'Puerta 3' in f.locator('[data-locsum]').inner_text()
            f.locator('[name=desc]').fill('Persona desorientada en la puerta'); f.locator('button.primary').click(); A.pg.wait_for_timeout(900); A.close_sheets()
            a = A.pg.evaluate("() => Object.values(window.__UCO.core.state.avisos).find(a => a.desc === 'Persona desorientada en la puerta')")
            assert a['loc']['fuente'] == 'punto' and a['loc']['ref'] == 'pt_puerta' and a['plan'], a
            A.nav('plano'); A.pg.wait_for_timeout(1200); assert mk(f'.mk[data-mk="a"][data-id="{a["id"]}"]') == 1, 'aparece en el plano'
            return 'sin tocar el mapa: coordenadas imposibles rechazadas; punto del plano «Puerta 3» como ubicación (origen «punto»), y el aviso aparece en el plano'
        check('Ubicación sin el mapa: punto del plano y coordenadas validadas', sin_mapa)
        def teclado():
            # Crear un aviso solo con el teclado desde el plano (sin ratón ni arrastre)
            A.pg.locator('[data-a="plan.avisoMapa"]').focus(); A.pg.keyboard.press('Enter'); A.pg.wait_for_selector('[data-a="plan.avisoSinMapa"]')
            A.pg.locator('[data-a="plan.avisoSinMapa"]').focus(); A.pg.keyboard.press('Enter'); A.pg.wait_for_selector('.sheet-wrap [data-a="inc.mas"]')
            A.pg.locator('.sheet-wrap [data-a="inc.mas"]').focus(); A.pg.keyboard.press('Enter'); A.pg.wait_for_selector('.sheet-wrap form[data-f="a.save"] [name=desc]')
            A.pg.locator('.sheet-wrap [name=desc]').focus(); A.pg.keyboard.type('Aviso creado con el teclado')
            A.pg.locator('.sheet-wrap form[data-f="a.save"] button.primary').focus(); A.pg.keyboard.press('Enter'); A.pg.wait_for_timeout(900)
            assert A.pg.evaluate("() => Object.values(window.__UCO.core.state.avisos).some(a => a.desc === 'Aviso creado con el teclado')")
            A.close_sheets()
            return 'desde el plano solo con Tab/Intro: «Nuevo aviso en el mapa» → «Sin el mapa» → «Más datos» → descripción → crear'
        check('Accesibilidad: crear un aviso solo con el teclado', teclado)
        def lista():
            A.nav('plano'); A.pg.wait_for_timeout(800); A.a('plan.lista'); A.pg.wait_for_selector('.sheet-wrap .lista-plano')
            t = A.sheet().inner_text()
            for x in ['SVB-1', 'En descanso', 'Puerta 3', 'Hospital de referencia', 'Sector 1', 'Mareo junto a la fuente']: assert x in t, x
            assert not nombres_vacios('.sheet-wrap'), nombres_vacios('.sheet-wrap')
            boton = A.sheet().locator('li', has_text='SVB-1').locator('[data-a="plan.verEn"]'); boton.focus(); A.pg.keyboard.press('Enter'); A.pg.wait_for_selector('.map-card[data-map-card="u"]', timeout=5000)
            assert 'SVB-1' in A.pg.locator('.map-card').inner_text()
            assert A.pg.evaluate('() => !!document.activeElement.closest("[data-map-card]")'), 'el foco pasa a la ficha del mapa'
            A.shot('03-lista-alternativa')
            return 'lista con unidades (situación), avisos, puntos y sectores; «Ver en el plano» con el teclado centra y abre la ficha (con el foco en ella)'
        check('Accesibilidad: lista alternativa al mapa', lista)
        def foco():
            A.pg.locator('[data-a="plan.capas"]').focus(); A.pg.keyboard.press('Enter'); A.pg.wait_for_selector('.sheet-wrap .chips-f')
            dentro = A.pg.evaluate('() => !!document.activeElement.closest(".sheet-wrap")')
            A.pg.keyboard.press('Escape'); A.pg.wait_for_timeout(500)
            vuelve = A.pg.evaluate('() => document.activeElement && document.activeElement.dataset.a')
            assert dentro and vuelve == 'plan.capas', (dentro, vuelve)
            return 'al abrir un panel el foco entra en él; al cerrarlo vuelve al botón que lo abrió'
        check('Accesibilidad: el foco entra en los paneles y vuelve al cerrarlos', foco)
        check('Sin errores de JavaScript (escenario 13)', lambda: (_ for _ in ()).throw(Exception('; '.join(A.errors[:5]))) if A.errors else 'ninguno')
        A.ctx.close()
    finally:
        srv.terminate(); shutil.rmtree(data, ignore_errors=True)

# ---------------- Escenario 14 (1.5.0): incoherencias operativas ----------------
def scenario_incoherencias(b):
    print('\n== Escenario 14: detección de incoherencias, revisión y reglas (1.5.0) ==')
    port = PORT + 14; url = f'http://127.0.0.1:{port}/'; data = tempfile.mkdtemp(prefix='uco-e2e-inc-')
    salida = os.path.join(data, 'inc.json')
    subprocess.run(['node', 'tests/e2e/generar_incoherencias.mjs', salida], cwd=ROOT, check=True)
    datos = json.load(open(salida))
    srv = start_server(data, port)
    try:
        A = App(b, 'incoherencias', TABLET, base=url)
        def grupos(): return {g.locator('summary b').inner_text(): g.locator('.inc-row').count() for g in A.pg.locator('.inc-grupo').all()}
        def deteccion():
            A.setup('Lola Coordinadora', 'lola', 'clave-lola-1', 'Tablet', 'L'); A.perms(False)
            ops = datos['prev_inc']; nmax = max([o.get('num') or 0 for o in ops])
            A.pg.evaluate("async ([pid, ops, n]) => { const c = window.__UCO.core; await c.repo.appendOps(pid, ops); await c.repo.maxCounter(pid, n); await c.openPrev(pid); await c._summary(pid); window.__UCO.render(); }", ['prev_inc', ops, nmax])
            A.pg.wait_for_selector('.inc-b', timeout=15000)
            insignia = A.pg.locator('.inc-b').inner_text(); assert 'Alta' in insignia, insignia
            A.antes = A.state("return JSON.stringify([s.units, s.avisos])")
            A.pg.locator('.inc-b').click(); A.pg.wait_for_selector('.inc-grupo', timeout=10000)
            g = grupos()
            assert g.get('Cambios simultáneos por resolver') == 1, g
            assert g.get('Aviso sin unidad asignada') == 2 and g.get('Aviso abierto demasiado tiempo') == 2, g
            assert g.get('Descanso con una duración incoherente') == 1, g
            primero = A.pg.locator('.inc-grupo').first
            assert 'nivel-alta' in primero.get_attribute('class'), 'lo más grave, primero'
            for t in ['Por qué:', 'Consecuencias:', 'Qué hacer:']: assert t in primero.inner_text(), t
            A.pg.wait_for_timeout(300); A.shot('01-incoherencias', True)
            return 'distintivo «Alta» en la barra; agrupadas por regla (2 avisos sin unidad, 2 abiertos demasiado, 1 descanso de 10 h, 1 conflicto) con por qué, consecuencias y qué hacer'
        check('Incoherencias: detectadas, clasificadas y agrupadas', deteccion)
        def revisar():
            fila = A.pg.locator('.inc-grupo', has_text='Aviso sin unidad asignada').locator('.inc-row').first
            fila.locator('[data-a="inc.asignar"]').click(); A.pg.wait_for_selector('.sheet-wrap form[data-f="inc.asignar"]')
            A.sheet().locator('[name=nota]').fill('Lola busca una unidad libre'); A.sheet().locator('button.primary').click(); A.pg.wait_for_timeout(1200)
            assert 'Asignada a Lola Coordinadora' in A.pg.locator('.inc-grupo', has_text='Aviso sin unidad asignada').inner_text()
            fila = A.pg.locator('.inc-grupo', has_text='Aviso sin unidad asignada').locator('.inc-row').first
            fila.locator('[data-a="inc.marcar"][data-v="resuelta"]').click(); A.pg.wait_for_selector('.sheet-wrap form[data-f="dlg.submit"]')
            A.sheet().locator('input, textarea').first.fill('Se asignó la SVB-2 al terminar su descanso'); A.dlg_ok(); A.pg.wait_for_timeout(1200)
            assert A.pg.locator('.inc-grupo', has_text='Aviso sin unidad asignada').locator('.inc-row').count() == 1, 'una menos en abiertas'
            A.a('inc.tab', v='revisadas'); A.pg.wait_for_selector('.inc-grupo')
            r = A.pg.locator('.inc-grupo').first; assert 'Resuelta por Lola Coordinadora' in r.inner_text(), r.inner_text()
            r.locator('[data-a="inc.historial"]').click(); A.pg.wait_for_selector('.sheet-wrap .ref-list li')
            h = A.sheet().inner_text(); assert 'Asignada' in h and 'Resuelta' in h, h
            assert 'Se asignó la SVB-2 al terminar su descanso' in h, 'la nota escrita en el diálogo se guarda tal cual: ' + h
            A.close_sheets()
            despues = A.state("return JSON.stringify([s.units, s.avisos])")
            assert despues == A.antes, 'revisar no cambia unidades ni avisos'
            b2 = A.state("return Object.keys(s.revisiones).length"); assert b2 == 1, b2
            return 'asignada a Lola y resuelta con nota; pasa a «Revisadas», historial con los dos pasos; unidades y avisos sin cambios'
        check('Revisar, asignar y resolver (con historial, sin tocar datos operativos)', revisar)
        def reglas():
            A.a('inc.tab', v='reglas'); A.pg.wait_for_selector('form[data-f="inc.reglas"]')
            A.pg.locator('[name="nivel_aviso_abierto_demasiado"]').select_option('critica')
            A.pg.locator('[name="activa_descanso_duracion"]').uncheck()
            A.pg.locator('form[data-f="inc.reglas"] button.primary').click(); A.pg.wait_for_timeout(1500)
            A.a('inc.tab', v='abiertas'); A.pg.wait_for_selector('.inc-grupo')
            primero = A.pg.locator('.inc-grupo').first
            assert 'Aviso abierto demasiado tiempo' in primero.inner_text() and 'nivel-critica' in primero.get_attribute('class'), primero.inner_text()[:80]
            assert 'Descanso con una duración incoherente' not in grupos(), 'regla desactivada'
            assert 'Crítica' in A.pg.locator('.inc-b').inner_text()
            n = A.state("return JSON.stringify(s.prev.cfg.reglas)"); assert 'critica' in n, n
            return 'nivel cambiado a «Crítica» (sube arriba y en la barra) y una regla desactivada; guardado en el preventivo'
        check('Reglas aprobadas: niveles y reglas activas', reglas)
        check('Sin errores de JavaScript (escenario 14)', lambda: (_ for _ in ()).throw(Exception('; '.join(A.errors[:5]))) if A.errors else 'ninguno')
        A.ctx.close()
    finally:
        srv.terminate(); shutil.rmtree(data, ignore_errors=True)

def scenario_plantillas(b):
    print('\n== Escenario 15: plantillas de preventivo con versiones y asistente de creación (1.5.0) ==')
    port = PORT + 15; url = f'http://127.0.0.1:{port}/'; data = tempfile.mkdtemp(prefix='uco-e2e-tpl-')
    salida = os.path.join(data, 'tpl.json')
    subprocess.run(['node', 'tests/e2e/generar_plantillas.mjs', salida], cwd=ROOT, check=True)
    datos = json.load(open(salida))
    srv = start_server(data, port)
    try:
        A = App(b, 'plantillas', TABLET, base=url)
        def tpls(): return A.pg.evaluate("async () => (await window.__UCO.core.repo.listTemplates()).map(t => ({ nombre: t.nombre, revision: t.revision, activa: t.activa, versiones: (t.revisiones || []).length, puntos: t.contenido.cat.puntos.length, unidades: t.contenido.unidades.length, reglas: !!(t.contenido.cfg.reglas), avisos: JSON.stringify(t).includes('Aviso que no se copia'), usos: t.usos.map(u => u.revision) }))")
        def crear():
            A.setup('Rosa Coordinadora', 'rosa', 'clave-rosa-1', 'Tablet', 'R'); A.perms(False)
            ops = datos['prev_origen']; nmax = max([o.get('num') or 0 for o in ops])
            A.pg.evaluate("async ([pid, ops, n]) => { const c = window.__UCO.core; await c.repo.appendOps(pid, ops); await c.repo.maxCounter(pid, n); await c.openPrev(pid); await c._summary(pid); window.__UCO.go('panel'); }", ['prev_origen', ops, nmax])
            A.pg.wait_for_selector('.kpis', timeout=15000)
            A.nav('mas'); A.a('tpl.fromPrev'); A.pg.wait_for_selector('.sheet-wrap form[data-f="dlg.submit"]')
            n = A.sheet().locator('input[type=checkbox]').count(); assert n == 10, n
            assert not A.sheet().locator('[name=participantes]').is_checked(), 'los datos personales solo si se piden'
            A.sheet().locator('input[name=nombre]').fill('Concierto tipo'); A.sheet().locator('[name=puntos]').uncheck(force=True)
            A.shot('01-plantilla-elementos', True); A.dlg_ok(); A.pg.wait_for_timeout(800)
            t = tpls(); assert len(t) == 1 and t[0]['revision'] == 1 and t[0]['puntos'] == 0 and t[0]['unidades'] == 3 and t[0]['reglas'] and not t[0]['avisos'], t
            return 'desde el preventivo: 10 elementos a elegir (personas previstas desmarcadas); sin puntos por elección; 3 unidades y reglas; ningún aviso'
        check('Plantilla desde un preventivo, eligiendo qué incluir', crear)
        def versiones():
            A.a('prev.exit'); A.nav('plantillas'); A.pg.wait_for_selector('.pcard')
            assert 'versión 1' in A.pg.locator('.pcard').first.inner_text()
            A.pg.locator('.pcard-main').first.click(); A.pg.wait_for_selector('form[data-f="tp.gen"]')
            A.sheet().locator('[name=descripcion]').fill('Escenario en la Puerta del Sol'); A.sheet().locator('form[data-f="tp.gen"] button.primary').click(); A.pg.wait_for_timeout(800)
            A.a('tp.tab', v='vers'); A.pg.wait_for_selector('.sheet-wrap .ref-list li')
            txt = A.sheet().inner_text(); assert 'Versión 2 (actual)' in txt and 'Versión 1' in txt, txt[:300]
            A.shot('02-versiones', True); A.close_sheets(); A.pg.wait_for_timeout(300)
            assert 'versión 2' in A.pg.locator('.pcard').first.inner_text()
            A.pg.locator('.pcard [data-a="tpl.fav"]').first.click(); A.pg.wait_for_timeout(500)
            t = tpls(); assert t[0]['revision'] == 2 and t[0]['versiones'] == 1, t
            return 'cambiar la descripción crea la versión 2 y conserva la 1; marcarla como favorita no es otra versión'
        check('Versiones de plantilla', versiones)
        def asistente():
            A.pg.locator('.pcard [data-a="home.new"]').first.click(); A.pg.wait_for_selector('.sheet-wrap form[data-f="home.create"] [data-revision-origen] details')
            pasos = A.sheet().locator('h3.paso').all_inner_texts()
            for t in ['Origen', 'Nombre', 'Fecha y horario', 'Sectores y recursos previstos', 'Opciones heredadas', 'Modalidad', 'Confirmación']: assert t in pasos, (t, pasos)
            A.fill('nombre', 'Concierto 2')
            d = A.sheet().locator('details.rev-lista')
            d.nth(0).locator('summary').click(); d.nth(0).locator('input[data-group=t_u][value="SVB-2"]').uncheck()
            d.nth(1).locator('summary').click(); d.nth(1).locator('input[data-group=t_s][value="sec_grada"]').uncheck()
            A.sheet().locator('input[data-group=t_e][value="plano"]').uncheck(force=True)
            A.sheet().locator('[name=activar]').check(force=True)
            res = A.sheet().locator('[data-resumen-origen]').inner_text()
            for t in ['«Concierto 2»', 'versión 2', '2 unidades', 'sin plano', 'activo desde el principio']: assert t in res, (t, res)
            assert A.sheet().locator('[data-n="t_u"]').inner_text() == '2'
            A.shot('03-asistente', True)
            A.sheet().locator('form[data-f="home.create"] button.primary').click(); A.pg.wait_for_selector('.kpis', timeout=15000); A.pg.wait_for_timeout(500)
            st = A.pg.evaluate("() => { const s = window.__UCO.core.state; const u = Object.values(s.units); return { inds: u.map(x => x.ind).sort(), sva: (u.find(x => x.ind === 'SVA-1') || {}).sector || null, plan: u.filter(x => x.plan).length, plano: !!s.prev.plano, grada: s.prev.cat.sectores.some(x => x.id === 'sec_grada'), avisos: Object.keys(s.avisos).length, origen: s.prev.origen, estado: s.prev.estado } }")
            assert st['inds'] == ['SVA-1', 'SVB-1'] and st['sva'] is None and st['plan'] == 0 and not st['plano'] and not st['grada'], st
            assert st['avisos'] == 0 and st['estado'] == 'activo' and st['origen']['revision'] == 2 and st['origen']['excluidos'] == ['plano'] and st['origen']['unidadesOmitidas'] == 1, st
            A.nav('mas'); A.a('nav', v='ajustes'); A.pg.wait_for_timeout(500)
            txt = A.pg.locator('main').inner_text(); assert 'Plantilla «Concierto tipo», versión 2 (sin heredar: plano y posiciones; 1 unidad prevista sin incluir)' in txt, txt[:600]
            return 'asistente en 7 pasos; sin SVB-2, sin la grada (SVA-1 queda sin sector) y sin plano; resumen previo; el preventivo dice «versión 2» y qué no se heredó'
        check('Crear un preventivo con el asistente, revisando lo heredado', asistente)
        def gestionar():
            A.a('prev.exit'); A.nav('plantillas'); A.pg.wait_for_selector('.pcard')
            A.pg.locator('.pcard [data-a="tpl.activa"]').first.click(); A.pg.wait_for_timeout(600)
            assert 'Desactivada' in A.pg.locator('.pcard').first.inner_text()
            assert A.pg.locator('.pcard [data-a="home.new"]').count() == 0, 'no se puede usar desactivada'
            A.nav('inicio'); A.a('home.new'); A.pg.wait_for_selector('.sheet-wrap form[data-f="home.create"]')
            ops = A.sheet().locator('select[name=origen] option').all_inner_texts(); assert not any('Concierto tipo' in o for o in ops), ops
            A.close_sheets(); A.nav('plantillas'); A.pg.wait_for_selector('.pcard')
            A.pg.locator('.pcard [data-a="tpl.activa"]').first.click(); A.pg.wait_for_timeout(600)
            A.pg.locator('.pcard-main').first.click(); A.a('tp.tab', v='vers'); A.pg.wait_for_selector('[data-a="tp.restaurar"]')
            A.pg.locator('[data-a="tp.restaurar"]').first.click(); A.dlg_ok(); A.pg.wait_for_timeout(800)
            A.a('tp.tab', v='usos'); txt = A.sheet().inner_text(); assert 'Concierto 2 · versión 2' in txt, txt[:300]
            A.close_sheets()
            t = tpls(); assert t[0]['revision'] == 3 and t[0]['versiones'] == 2 and t[0]['activa'] and t[0]['usos'] == [2], t
            A.pg.locator('.pcard [data-a="tpl.dup"]').first.click(); A.pg.wait_for_timeout(600)
            t = tpls(); assert len(t) == 2 and any(x['nombre'] == 'Concierto tipo (copia)' and x['revision'] == 1 for x in t), t
            A.pg.locator('.pcard', has_text='Concierto tipo (copia)').locator('[data-a="tpl.del"]').click(); A.dlg_ok(); A.pg.wait_for_timeout(600)
            assert len(tpls()) == 1
            return 'desactivada: no se ofrece al crear; reactivada; versión 1 restaurada como versión 3; usos con su versión; duplicar y eliminar'
        check('Desactivar, restaurar, duplicar y eliminar plantillas', gestionar)
        def movil():
            A.pg.set_viewport_size({'width': 390, 'height': 844}); A.pg.wait_for_timeout(400)
            A.pg.locator('.pcard [data-a="home.new"]').first.click(); A.pg.wait_for_selector('.sheet-wrap form[data-f="home.create"] [data-revision-origen] details')
            A.sheet().locator('details.rev-lista').nth(0).locator('summary').click(); A.pg.wait_for_timeout(300)
            anchos = A.pg.evaluate("() => { const f = document.querySelector('.sheet-wrap form[data-f=\"home.create\"]'); return [f.scrollWidth, f.clientWidth, document.documentElement.scrollWidth, innerWidth] }")
            assert anchos[0] <= anchos[1] + 1 and anchos[2] <= anchos[3] + 1, anchos
            alto = A.pg.locator('details.rev-lista').nth(0).locator('label.u-asig').first.bounding_box()['height']; assert alto >= 44, alto
            A.shot('04-asistente-movil', True); A.close_sheets(); A.pg.set_viewport_size(TABLET['viewport']); A.pg.wait_for_timeout(300)
            return f'sin desplazamiento horizontal ({anchos[0]} px en {anchos[1]} px); filas de unidades de {alto:.0f} px'
        check('Asistente en el móvil', movil)
        check('Sin errores de JavaScript (escenario 15)', lambda: (_ for _ in ()).throw(Exception('; '.join(A.errors[:5]))) if A.errors else 'ninguno')
        A.ctx.close()
    finally:
        srv.terminate(); shutil.rmtree(data, ignore_errors=True)

def scenario_informes(b):
    print('\n== Escenario 16: informe al finalizar, versiones con huella, Excel y registro de accesos (1.5.0) ==')
    import hashlib
    port = PORT + 16; url = f'http://127.0.0.1:{port}/'; data = tempfile.mkdtemp(prefix='uco-e2e-inf-')
    salida = os.path.join(data, 'inf.json')
    subprocess.run(['node', 'tests/e2e/generar_informes.mjs', salida], cwd=ROOT, check=True)
    datos = json.load(open(salida))
    srv = start_server(data, port)
    try:
        A = App(b, 'informes', TABLET, base=url)
        def reg(): return A.state("return JSON.stringify(s.informes || [])")
        def preparar():
            A.setup('Ana Coordinadora', 'ana', 'clave-ana-1', 'Tablet', 'A'); A.perms(False)
            ops = datos['prev_inf']; nmax = max([o.get('num') or 0 for o in ops])
            A.pg.evaluate("async ([pid, ops, n]) => { const c = window.__UCO.core; await c.repo.appendOps(pid, ops); await c.repo.maxCounter(pid, n); await c.openPrev(pid); await c._summary(pid); window.__UCO.go('panel'); }", ['prev_inf', ops, nmax])
            A.pg.wait_for_selector('.kpis', timeout=15000)
            A.nav('mas'); A.a('nav', v='cierre'); txt = A.pg.inner_text('main')
            assert 'versión 1' in txt and 'Excel (XLSX)' in txt, txt[:400]
            with A.pg.expect_download() as dl: A.a('rep.do', k='xlsx')
            ruta = os.path.join(data, 'datos.xlsx'); dl.value.save_as(ruta)
            import openpyxl
            wb = openpyxl.load_workbook(ruta); hojas = wb.sheetnames
            assert hojas[:2] == ['Resumen', 'Unidades'] and 'Horas de registro' in hojas and 'Bitácora' in hojas, hojas
            filas = [[c.value for c in r] for r in wb['Unidades'].iter_rows()]; assert any(f[0] == 'SVB-1' for f in filas), filas[:3]
            r = json.loads(reg()); assert len(r) == 1 and r[0]['accion'] == 'exportar' and r[0]['formato'] == 'xlsx', r
            A.antes = A.state("return JSON.stringify([s.units, s.avisos])")
            return f'Excel válido ({len(hojas)} hojas: {", ".join(hojas[:4])}…); exportación registrada'
        check('Exportación a Excel (XLSX) abierta con un lector independiente', preparar)
        def finalizar():
            A.a('prev.close'); A.pg.wait_for_timeout(300)
            t = A.sheet().inner_text(); assert 'versión 1 del informe' in t, t[:300]
            A.dlg_ok()
            A.pg.wait_for_function("() => { const p = window.__UCO.core.state.prev; return p.estado === 'cerrado' && p.archivado && (window.__UCO.core.state.informes || []).some(x => x.accion === 'generar') }", timeout=30000)
            A.pg.wait_for_selector('.inf-v [data-a="inf.ver"]', timeout=15000)
            r = [x for x in json.loads(reg()) if x['accion'] == 'generar']
            assert len(r) == 1 and r[0]['n'] == 1 and len(r[0]['hash']) == 64 and not r[0].get('provisional'), r
            txt = A.pg.inner_text('main'); assert 'Versión 1' in txt and 'SHA-256 ' + r[0]['hash'][:24] in txt, txt[:600]
            assert 'registrados después de la versión' not in txt, 'archivar no es un cambio del informe'
            A.hash1 = r[0]['hash']; A.shot('01-version-1', True)
            return 'al finalizar: versión 1 guardada y registrada (SHA-256 ' + A.hash1[:12] + '…), preventivo cerrado y archivado'
        check('Informe generado automáticamente al finalizar', finalizar)
        def descargar():
            with A.pg.expect_download() as dl: A.a('inf.bajar', n='1')
            ruta = os.path.join(data, 'v1.pdf'); dl.value.save_as(ruta); pdf = open(ruta, 'rb').read()
            assert hashlib.sha256(pdf).hexdigest() == A.hash1, 'la huella registrada es la del archivo'
            import pypdf
            texto = '\n'.join(p.extract_text() for p in pypdf.PdfReader(ruta).pages)
            for t in ['Versión 1 del informe', 'Configuración y sectores utilizados', 'Actividad por unidad', 'Avisos al cierre', 'Fiabilidad de los datos y limitaciones', 'Lola Pérez (Responsable sanitaria)', 'Mareo en meta']:
                assert t in texto, t
            exp = [x for x in json.loads(reg()) if x['accion'] == 'exportar' and x.get('n') == 1]; assert len(exp) == 1 and exp[0]['hash'] == A.hash1, exp
            # Comprobar: el archivo original coincide; uno modificado, no
            with A.pg.expect_file_chooser() as fc: A.a('inf.comprobar')
            fc.value.set_files(ruta); A.pg.wait_for_timeout(800)
            assert 'es la versión 1' in A.toast_text(), A.toast_text()
            mod = os.path.join(data, 'v1-mod.pdf'); open(mod, 'wb').write(pdf + b'\n%modificado')
            with A.pg.expect_file_chooser() as fc: A.a('inf.comprobar')
            fc.value.set_files(mod); A.pg.wait_for_timeout(800)
            assert 'no coincide' in A.toast_text(), A.toast_text()
            return f'PDF de {len(pdf)//1024} KB con la huella registrada; contenido verificado; comprobación de archivos original y modificado'
        check('Descarga de la versión, contenido y comprobación de la huella', descargar)
        def nueva():
            A.a('inf.nueva'); A.pg.wait_for_selector('.sheet-wrap form[data-f="dlg.submit"]')
            A.sheet().locator('input, textarea').first.fill('Corrección autorizada de la hora de un aviso'); A.dlg_ok()
            A.pg.wait_for_function("() => (window.__UCO.core.state.informes || []).filter(x => x.accion === 'generar').length === 2", timeout=30000)
            A.pg.wait_for_selector('.inf-v [data-a="inf.ver"][data-n="2"]', timeout=15000)
            g = [x for x in json.loads(reg()) if x['accion'] == 'generar']
            assert [x['n'] for x in g] == [1, 2] and g[0]['hash'] == A.hash1 and g[1]['motivo'].startswith('Corrección autorizada'), g
            assert A.pg.locator('.inf-v').count() == 2
            assert A.state("return JSON.stringify([s.units, s.avisos])") == A.antes, 'generar o exportar no cambia unidades ni avisos'
            A.nav('mas'); A.a('nav', v='bitacora'); A.pg.wait_for_timeout(500)
            txt = A.pg.inner_text('main'); assert 'Informe generado (versión 2)' in txt and 'Informe exportado' in txt, txt[:500]
            A.shot('02-bitacora', True)
            return 'versión 2 con motivo; la 1 se conserva con su huella; unidades y avisos intactos; todo en la bitácora'
        check('Nueva versión con motivo, conservando la anterior', nueva)
        check('Sin errores de JavaScript (escenario 16)', lambda: (_ for _ in ()).throw(Exception('; '.join(A.errors[:5]))) if A.errors else 'ninguno')
        A.ctx.close()
    finally:
        srv.terminate(); shutil.rmtree(data, ignore_errors=True)

def main():
    if os.path.isdir(SHOTS): shutil.rmtree(SHOTS)
    os.makedirs(SHOTS)
    data = tempfile.mkdtemp(prefix='uco-e2e-')
    srv = start_server(data); SRV.update(p=srv, data=data)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
            only = sys.argv[1] if len(sys.argv) > 1 else ''
            if only in ('', '1'): scenario_standalone(b)
            if only in ('', '2'): scenario_shared(b)
            if only in ('', '3'): scenario_android(b)
            if only in ('', '4'): scenario_recursos(b)
            if only in ('', '5'): scenario_coordinacion(b)
            if only in ('', '6'): scenario_actualizaciones(b)
            if only in ('', '7'): scenario_incidentes(b)
            if only in ('', '8'): scenario_recursos_140(b)
            if only in ('', '9'): scenario_vista_mapa(b)
            if only in ('', '10'): scenario_modo_servidor(b)
            if only in ('', '11'): scenario_migracion_sesion(b)
            if only in ('', '12'): scenario_capas(b)
            if only in ('', '13'): scenario_avisos_mapa(b)
            if only in ('', '14'): scenario_incoherencias(b)
            if only in ('', '15'): scenario_plantillas(b)
            if only in ('', '16'): scenario_informes(b)
            b.close()
    finally:
        SRV['p'].terminate(); shutil.rmtree(data, ignore_errors=True)
    ok = sum(1 for r in RESULTS if r['resultado'] == 'SUPERADA')
    print(f'\nResultado: {ok}/{len(RESULTS)} pruebas superadas')
    json.dump({'fecha': time.strftime('%Y-%m-%d %H:%M:%S'), 'navegador': 'Google Chrome (Playwright)', 'resultados': RESULTS}, open(os.path.join(ROOT, 'tests', 'e2e', 'resultados.json'), 'w'), ensure_ascii=False, indent=1)
    sys.exit(0 if ok == len(RESULTS) else 1)

if __name__ == '__main__':
    main()
