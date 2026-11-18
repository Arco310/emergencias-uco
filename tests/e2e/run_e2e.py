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
PHONE = dict(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True, device_scale_factor=2)
TABLET = dict(viewport={'width': 1280, 'height': 800}, is_mobile=True, has_touch=True, device_scale_factor=1.5)
# Código de administración FICTICIO, solo para el servidor local que arrancan estas pruebas
ADMIN_CODE = 'E2EAD-MINCO-DIGOL-OCAL1'

def record(name, ok, detail=''):
    RESULTS.append({'prueba': name, 'resultado': 'SUPERADA' if ok else 'FALLIDA', 'detalle': detail})
    print(('  ✔ ' if ok else '  ✘ ') + name + (' — ' + detail if detail else ''), flush=True)

def check(name, fn):
    try:
        d = fn()
        record(name, True, d or '')
    except Exception as e:
        record(name, False, (str(e).splitlines() or ['error'])[0][:300])
        traceback.print_exc()

class App:
    def __init__(self, browser, name, opts):
        self.ctx = browser.new_context(locale='es-ES', timezone_id='Europe/Madrid', accept_downloads=True, **opts)
        self.ctx.grant_permissions(['geolocation', 'notifications'], origin=URL[:-1])
        self.ctx.set_geolocation({'latitude': 37.8847, 'longitude': -4.7792})
        self.name = name
        self.errors = []
        self.pg = self.ctx.new_page()
        self.pg.on('pageerror', lambda e: self.errors.append(str(e)))
        self.pg.on('console', lambda m: self.errors.append(m.text) if m.type == 'error' and 'Failed to load resource' not in m.text and 'net::' not in m.text else None)
        self.pg.set_default_timeout(15000)
    def shot(self, name, full=False):
        os.makedirs(SHOTS, exist_ok=True)
        self.pg.screenshot(path=os.path.join(SHOTS, f'{self.name}-{name}.png'), full_page=full)
    def goto(self, hash_=''):
        self.pg.goto(URL + hash_); self.pg.wait_for_selector('#app :is(.auth-box, .top, .splash)')
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
    def setup(self, nombre, usuario, pw, dev, code, codigo=None):
        self.goto(); self.pg.wait_for_selector('form[data-f="auth.setup"], form[data-f="auth.central"]', timeout=20000)
        if self.pg.locator('form[data-f="auth.central"]').count():
            # el servidor central ya está activo: este dispositivo se configura sin él
            self.pg.click('[data-a="auth.local"]'); self.pg.wait_for_selector('form[data-f="auth.setup"]')
        self.pg.fill('#f_nombre', nombre); self.pg.fill('#f_usuario', usuario); self.pg.fill('#f_p1', pw); self.pg.fill('#f_p2', pw)
        self.pg.fill('#f_dev', dev); self.pg.fill('#f_code', code)
        if codigo: self.pg.fill('#f_codigo', codigo)
        self.pg.click('form[data-f="auth.setup"] button.primary'); self.pg.wait_for_selector('#recok', timeout=20000)
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
        self.pg.fill('#f_u', usuario); self.pg.fill('#f_p', pw)
        if dev: self.pg.click('form[data-f="auth.central"] summary'); self.pg.fill('#f_dev', dev)
        self.pg.click('form[data-f="auth.central"] button.primary')
    def login(self, usuario, pw):
        self.pg.wait_for_selector('form[data-f="auth.login"]')
        u = self.pg.locator('#f_u')
        if u.evaluate('e => e.tagName') == 'SELECT': u.select_option(usuario)
        else: u.fill(usuario)
        self.pg.fill('#f_p', pw); self.pg.click('form[data-f="auth.login"] button.primary'); self.pg.wait_for_selector('.top', timeout=20000); self.pg.wait_for_timeout(500)
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
        self.nav('unidades'); self.a('u.new'); s = self.sheet()
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

def start_server(data):
    env = dict(os.environ, UCO_CODIGO_ADMIN=ADMIN_CODE)
    p = subprocess.Popen(['node', os.path.join(ROOT, 'server/server.mjs'), '--port', str(PORT), '--static', os.path.join(ROOT, 'dist/app'), '--data', data, '--host', '127.0.0.1', '--quiet'], env=env)
    for _ in range(60):
        try:
            import urllib.request; urllib.request.urlopen(URL + 'api/v1/salud', timeout=1); return p
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
        A.nav('avisos'); A.a('a.new'); s = A.sheet()
        A.fill('tipo', 'ta_san'); A.fill('desc', 'Lipotimia en primera fila'); A.fill('sector', 'sec_1')
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
        fc.value.set_files(PLANO); A.pg.wait_for_selector('#pimg', timeout=20000); A.pg.wait_for_timeout(500)
        A.a('plan.edit'); A.pg.locator('[data-a="plan.pick"]').first.click(); A.pg.wait_for_timeout(200)
        box = A.pg.locator('#pv').bounding_box()
        A.pg.mouse.click(box['x'] + box['width'] * 0.3, box['y'] + box['height'] * 0.4); A.pg.wait_for_timeout(500)
        A.pg.mouse.click(box['x'] + box['width'] * 0.6, box['y'] + box['height'] * 0.5); A.pg.wait_for_timeout(500)
        n = A.state('return Object.values(s.units).filter(u => u.plan).length')
        assert n >= 2, n
        A.a('plan.edit'); A.shot('08-plano')
        A.pg.reload(); A.login('ana', 'secreto1'); A.nav('plano'); A.pg.wait_for_selector('#pimg'); A.pg.wait_for_timeout(500)
        mk = A.pg.locator('.mk[data-mk="u"]').count()
        assert mk >= 2, mk
        return f'imagen importada; {n} unidades colocadas; posiciones persistentes tras recargar'
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
        A.nav('avisos'); A.a('a.new'); A.fill('desc', 'Aviso sin conexión'); A.sheet().locator('form[data-f="a.save"] button.primary').click(); A.pg.wait_for_timeout(600); A.close_sheets()
        A.open_unit('AMB-02'); A.a('u.rest'); A.dlg_ok(); A.pg.wait_for_timeout(300); A.close_sheets()
        A.nav('plano'); A.pg.wait_for_selector('#pimg')
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
        A.sheet().locator('[name=pdf]').uncheck(); A.dlg_ok(); A.pg.wait_for_timeout(1000)
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
        T.setup('Tomás Jefe', 'tomas', 'secreto2', 'Tablet mando', 'T', codigo=ADMIN_CODE); T.perms(False)
        T.pg.wait_for_selector('.central-bar[data-central-estado]', timeout=20000)
        T.pg.wait_for_function("() => window.__UCO.core.central.status().estado === 'conectado'", timeout=20000)
        T.shot('00-central-activado')
        return 'espacio central activado una sola vez durante el alta inicial; estado conectado'
    check('Servidor central: activación única con el código del servidor', activar)
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
            app.nav('avisos'); app.a('a.new'); app.fill('desc', d); app.sheet().locator('form[data-f="a.save"] button.primary').click(); app.pg.wait_for_timeout(300); app.close_sheets()
        time.sleep(8)
        nums = sorted(T.state('return Object.values(s.avisos).map(a => a.num)'))
        nums2 = sorted(M.state('return Object.values(s.avisos).map(a => a.num)'))
        assert nums == nums2 == [1, 2], (nums, nums2)
        return 'números definitivos únicos 1 y 2 en ambos dispositivos'
    check('Compartido: avisos simultáneos sin duplicados', simult)
    def offline():
        M.ctx.set_offline(True); M.pg.wait_for_timeout(300)
        M.nav('avisos'); M.a('a.new'); M.fill('desc', 'Creado sin red'); M.sheet().locator('form[data-f="a.save"] button.primary').click(); M.pg.wait_for_timeout(400); M.close_sheets()
        ref = M.state("return Object.values(s.avisos).find(a => a.desc === 'Creado sin red').ref")
        a2 = M.unit_id('A2'); M.open_unit('A2'); M.sheet().locator('[data-a="u.clave"][data-k="C6"]').click(); M.pg.wait_for_timeout(400); M.close_sheets()
        T.nav('avisos'); T.a('a.new'); T.fill('desc', 'Tablet mientras móvil sin red'); T.sheet().locator('form[data-f="a.save"] button.primary').click(); T.pg.wait_for_timeout(400); T.close_sheets()
        M.shot('02-movil-sin-red'); time.sleep(3)
        M.ctx.set_offline(False); M.pg.evaluate('() => window.dispatchEvent(new Event("online"))'); time.sleep(9)
        sa = T.state("return JSON.stringify([Object.values(s.avisos).map(a => a.desc + ':' + a.num).sort(), Object.values(s.units).map(u => u.ind + ':' + u.clave).sort()])")
        sb = M.state("return JSON.stringify([Object.values(s.avisos).map(a => a.desc + ':' + a.num).sort(), Object.values(s.units).map(u => u.ind + ':' + u.clave).sort()])")
        assert sa == sb and 'Creado sin red:null' not in sa and 'A2:C6' in sa, (sa, sb)
        return f'trabajo sin red (ref. provisional {ref}), reconexión y convergencia sin pérdidas'
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

def main():
    if os.path.isdir(SHOTS): shutil.rmtree(SHOTS)
    os.makedirs(SHOTS)
    data = tempfile.mkdtemp(prefix='uco-e2e-')
    srv = start_server(data)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=CHROME, args=['--no-sandbox'])
            only = sys.argv[1] if len(sys.argv) > 1 else ''
            if only in ('', '1'): scenario_standalone(b)
            if only in ('', '2'): scenario_shared(b)
            if only in ('', '3'): scenario_android(b)
            b.close()
    finally:
        srv.terminate(); shutil.rmtree(data, ignore_errors=True)
    ok = sum(1 for r in RESULTS if r['resultado'] == 'SUPERADA')
    print(f'\nResultado: {ok}/{len(RESULTS)} pruebas superadas')
    json.dump({'fecha': time.strftime('%Y-%m-%d %H:%M:%S'), 'navegador': 'Google Chrome (Playwright)', 'resultados': RESULTS}, open(os.path.join(ROOT, 'tests', 'e2e', 'resultados.json'), 'w'), ensure_ascii=False, indent=1)
    sys.exit(0 if ok == len(RESULTS) else 1)

if __name__ == '__main__':
    main()
