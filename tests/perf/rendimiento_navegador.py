#!/usr/bin/env python3
"""Rendimiento de la aplicación real en el navegador con un preventivo muy grande.
Datos cifrados en IndexedDB, interfaz completa y CPU ralentizada 4 veces (aproximación a un
móvil Android de gama media). Uso: python3 tests/perf/rendimiento_navegador.py [unidades avisos]"""
import json, os, subprocess, sys, tempfile, time
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'e2e'))
import run_e2e as E
from playwright.sync_api import sync_playwright

HERE = os.path.dirname(__file__)
NU, NA = (int(sys.argv[1]), int(sys.argv[2])) if len(sys.argv) > 2 else (300, 3000)
RALENT = 4
R = {}

def gen_ops():
    out = os.path.join(tempfile.mkdtemp(prefix='uco-perf-'), 'ops.json')
    js = ("import { generar } from './tests/perf/rendimiento.mjs'; import { writeFileSync } from 'node:fs';"
          f"const {{ dev }} = generar({NU}, {NA}); writeFileSync('{out}', JSON.stringify(dev.store));")
    subprocess.run(['node', '--input-type=module', '-e', js], cwd=E.ROOT, check=True)
    return json.load(open(out))

def medir(A, nombre, fn, sel, timeout=120000):
    t0 = time.perf_counter(); fn(); A.pg.wait_for_selector(sel, timeout=timeout)
    A.pg.evaluate('() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)))')
    R[nombre] = round((time.perf_counter() - t0) * 1000)
    print(f'  {nombre}: {R[nombre]} ms', flush=True)

def main():
    ops = gen_ops(); nmax = max([o.get('num') or 0 for o in ops])
    R.update({'unidades': NU, 'avisos': NA, 'operaciones': len(ops), 'cpu_ralentizada': f'{RALENT}x'})
    print(f'Preventivo de prueba: {NU} unidades, {NA} avisos, {len(ops)} operaciones')
    data = tempfile.mkdtemp(prefix='uco-perf-srv-'); srv = E.start_server(data)
    try:
        with sync_playwright() as p:
            b = p.chromium.launch(executable_path=E.CHROME, args=['--no-sandbox', '--enable-precise-memory-info'])
            A = E.App(b, 'perf', E.PHONE)
            A.setup('Ana', 'ana', 'secreto1', 'Móvil', 'M1'); A.perms(False)
            # Carga del registro cifrado (como si se hubiera ido acumulando durante el servicio)
            t0 = time.perf_counter()
            for i in range(0, len(ops), 2000):
                A.pg.evaluate("ops => window.__UCO.core.repo.appendOps('prev_1', ops)", ops[i:i + 2000])
            R['guardado_cifrado_ops_por_s'] = round(len(ops) / (time.perf_counter() - t0))
            A.pg.evaluate("async n => { const c = window.__UCO.core; await c.repo.maxCounter('prev_1', n); await c.openPrev('prev_1'); await c._summary('prev_1'); localStorage.setItem('uco:last', 'prev_1'); }", nmax)
            cdp = A.ctx.new_cdp_session(A.pg)
            cdp.send('Emulation.setCPUThrottlingRate', {'rate': RALENT})
            # Abrir el preventivo grande: recargar, iniciar sesión y ver el centro de control
            A.pg.reload(); A.pg.wait_for_selector('form[data-f="auth.login"]')
            A.pg.fill('#f_p', 'secreto1')
            medir(A, 'abrir_preventivo_ms', lambda: A.pg.click('form[data-f="auth.login"] button.primary'), '.kpis')
            R['apertura_interna_ms'] = A.pg.evaluate("async () => { const c = window.__UCO.core; const t = performance.now(); await c.loadEngine('prev_1'); return Math.round(performance.now() - t); }")
            print('  apertura_interna_ms (descifrar + reconstruir):', R['apertura_interna_ms'], flush=True)
            A.pg.evaluate("() => window.__UCO.core.openPrev('prev_1')")
            medir(A, 'pantalla_unidades_ms', lambda: A.nav('unidades'), f'.ucard >> nth={NU - 1}')
            medir(A, 'pantalla_avisos_ms', lambda: A.nav('avisos'), '#main')
            medir(A, 'avisos_finalizados_ms', lambda: A.a('av.tab', v='fin'), '.acard')
            R['avisos_finalizados_tarjetas'] = A.pg.locator('.acard').count()
            medir(A, 'avisos_mostrar_mas_ms', lambda: A.a('av.more'), '.acard >> nth=299')
            medir(A, 'pantalla_plano_ms', lambda: A.nav('plano'), '#main svg')
            # Acción: cambiar la clave de una unidad (validación + guardado cifrado + repintado)
            uid = A.state("return Object.values(s.units).find(u => u.clave === 'C0').id;")
            A.nav('unidades'); A.pg.locator(f'.ucard[data-id="{uid}"]').click(); A.pg.wait_for_selector('.uhead'); A.pg.wait_for_timeout(1500)
            t0 = time.perf_counter()
            A.pg.locator('.sheet-wrap [data-a="u.clave"][data-k="C6"]').first.click()
            A.pg.wait_for_function(f"() => window.__UCO.core.state.units['{uid}'].clave === 'C6'", timeout=30000)
            R['accion_cambiar_clave_ms'] = round((time.perf_counter() - t0) * 1000); print('  accion_cambiar_clave_ms:', R['accion_cambiar_clave_ms'], flush=True)
            A.close_sheets()
            # Acción: crear un aviso desde el formulario
            A.nav('avisos'); A.a('a.new'); A.fill('desc', 'Aviso de prueba de rendimiento'); A.pg.wait_for_timeout(1500)
            t0 = time.perf_counter(); A.dlg_ok()
            A.pg.wait_for_function(f"() => Object.keys(window.__UCO.core.state.avisos).length === {NA + 1}", timeout=30000)
            R['accion_crear_aviso_ms'] = round((time.perf_counter() - t0) * 1000); print('  accion_crear_aviso_ms:', R['accion_crear_aviso_ms'], flush=True)
            A.close_sheets()
            ir = lambda r: A.pg.evaluate(f"() => window.__UCO.go('{r}')")
            medir(A, 'estadisticas_ms', lambda: ir('estadisticas'), '#main .chart, #main svg, #main table')
            medir(A, 'bitacora_ms', lambda: ir('bitacora'), '.log-row')
            # Informe PDF completo
            ir('cierre'); A.pg.wait_for_timeout(500)
            t0 = time.perf_counter()
            with A.pg.expect_download(timeout=300000) as dl: A.a('rep.do', k='pdf')
            R['informe_pdf_ms'] = round((time.perf_counter() - t0) * 1000)
            R['informe_pdf_MB'] = round(os.path.getsize(dl.value.path()) / 1048576, 2); print('  informe_pdf:', R['informe_pdf_ms'], 'ms,', R['informe_pdf_MB'], 'MB', flush=True)
            cdp.send('HeapProfiler.collectGarbage'); A.pg.wait_for_timeout(500)
            R['memoria_js_MB'] = A.pg.evaluate('() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null')
            R['almacenamiento_MB'] = A.pg.evaluate('() => navigator.storage.estimate().then(e => Math.round(e.usage / 1048576))')
            R['errores_js'] = A.errors[:3]
            b.close()
    finally:
        srv.terminate()
    R['fecha'] = time.strftime('%Y-%m-%d %H:%M')
    print(json.dumps(R, ensure_ascii=False))
    json.dump(R, open(os.path.join(HERE, f'resultados-navegador-{NA}.json'), 'w'), ensure_ascii=False, indent=1)

if __name__ == '__main__':
    main()
