// Publicación de una versión del Gestor de Emergencias UCO (aplicación + servidor central).
//
//   node tools/publicar-version.mjs                prepara dist/release (no publica nada)
//   node tools/publicar-version.mjs --github       además crea la versión en GitHub Releases con el
//                                                  paquete del servidor y su lista de sumas SHA-256
//   node tools/publicar-version.mjs --pages        además publica la aplicación en GitHub Pages
//
// Los servidores instalados consultan las versiones publicadas del repositorio oficial, verifican el
// paquete (SHA-256 calculado por GitHub y lista SHA256SUMS.txt), lo prueban con una copia de los datos y
// solo se instalan cuando un administrador lo decide desde Sistema → Actualizaciones.
// Requisitos para --github/--pages: gh y git con permiso de escritura en el repositorio, y la rama main
// ya subida (la versión se crea sobre el commit publicado, nunca sobre cambios locales).
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = 'Arco310/emergencias-uco';
const args = new Set(process.argv.slice(2));
const sh = (cmd, a, opts = {}) => execFileSync(cmd, a, { cwd: ROOT, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], ...opts }).trim();
const sha256 = b => crypto.createHash('sha256').update(b).digest('hex');
const fallo = m => { console.error('✘ ' + m); process.exit(1); };
const ok = m => console.log('✔ ' + m);

// 1. Versión coherente en la aplicación y el servidor
const { APP_VERSION } = await import(path.join(ROOT, 'src/core/defaults.js'));
const VERSION = /const VERSION = '([^']+)'/.exec(fs.readFileSync(path.join(ROOT, 'server/server.mjs'), 'utf8'))[1];
if (APP_VERSION !== VERSION) fallo(`La versión de la aplicación (${APP_VERSION}) y la del servidor (${VERSION}) no coinciden`);
if (!/^\d+\.\d+\.\d+$/.test(VERSION)) fallo('Versión no válida: ' + VERSION);
const { nombrePaquete, leerZip } = await import(path.join(ROOT, 'server/actualizador.mjs'));

// 2. Compilación y comprobación del paquete
sh(process.execPath, ['build.mjs']);
const zip = fs.readFileSync(path.join(ROOT, 'dist/servidor-uco-windows.zip'));
const ent = leerZip(zip);
const srv = ent.get('servidor-uco-windows/servidor/server.mjs');
if (!srv || !ent.get('servidor-uco-windows/app/index.html') || !ent.get('servidor-uco-windows/servidor/lanzador.mjs') || !ent.get('servidor-uco-windows/servidor/actualizador.mjs')) fallo('El paquete no tiene la estructura esperada');
if (!srv.toString('utf8').includes(`const VERSION = '${VERSION}'`)) fallo('El paquete no contiene la versión ' + VERSION);
const appVer = JSON.parse(ent.get('servidor-uco-windows/app/version.json').toString('utf8'));
if (appVer.version !== VERSION) fallo('La aplicación del paquete no es la ' + VERSION);
const REL = path.join(ROOT, 'dist/release'); fs.rmSync(REL, { recursive: true, force: true }); fs.mkdirSync(REL, { recursive: true });
const nombre = nombrePaquete(VERSION);
fs.writeFileSync(path.join(REL, nombre), zip);
fs.writeFileSync(path.join(REL, 'SHA256SUMS.txt'), `${sha256(zip)}  ${nombre}\n`);
// Notas de la versión: sección de docs/CAMBIOS.md
const cambios = fs.existsSync(path.join(ROOT, 'docs/CAMBIOS.md')) ? fs.readFileSync(path.join(ROOT, 'docs/CAMBIOS.md'), 'utf8') : '';
const m = new RegExp(`^## ${VERSION.replace(/\./g, '\\.')}[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, 'm').exec(cambios);
const notas = (m ? m[1].trim() : 'Versión ' + VERSION) + `\n\nPaquete del servidor: ${nombre}\nSHA-256: ${sha256(zip)}`;
fs.writeFileSync(path.join(REL, 'NOTAS.md'), notas + '\n');
ok(`Versión ${VERSION} preparada en dist/release (${nombre}, ${(zip.length / 1024).toFixed(0)} KB, SHA-256 ${sha256(zip).slice(0, 16)}…)`);

if (!args.has('--github') && !args.has('--pages')) process.exit(0);

// 3. Solo se publica lo que ya está en la rama main del repositorio oficial
const head = sh('git', ['rev-parse', 'HEAD']);
if (sh('git', ['status', '--porcelain', '--', '.', ':!dist', ':!tests/e2e/resultados.json'])) fallo('Hay cambios sin confirmar: confirma y sube main antes de publicar');
sh('git', ['fetch', 'origin', 'main']);
if (sh('git', ['rev-parse', 'origin/main']) !== head) fallo('main no está subida (origin/main ≠ HEAD): haz git push antes de publicar');

if (args.has('--pages')) {
  // Aplicación web: rama gh-pages con el contenido de dist/app
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'uco-pages-'));
  try {
    sh('git', ['fetch', 'origin', 'gh-pages']);
    sh('git', ['worktree', 'add', '--detach', tmp, 'origin/gh-pages']);
    for (const f of fs.readdirSync(tmp)) if (f !== '.git') fs.rmSync(path.join(tmp, f), { recursive: true, force: true });
    fs.cpSync(path.join(ROOT, 'dist/app'), tmp, { recursive: true });
    sh('git', ['add', '-A'], { cwd: tmp });
    if (sh('git', ['status', '--porcelain'], { cwd: tmp })) {
      sh('git', ['commit', '-m', `Aplicación ${VERSION} (${head.slice(0, 7)})`], { cwd: tmp });
      sh('git', ['push', 'origin', 'HEAD:gh-pages'], { cwd: tmp });
      ok('Aplicación ' + VERSION + ' publicada en GitHub Pages');
    } else ok('GitHub Pages ya tenía esta compilación');
  } finally { try { sh('git', ['worktree', 'remove', '--force', tmp]); } catch { fs.rmSync(tmp, { recursive: true, force: true }); } }
}

if (args.has('--github')) {
  const tag = 'v' + VERSION;
  let existe = true; try { sh('gh', ['api', `repos/${REPO}/releases/tags/${tag}`]); } catch { existe = false; }
  if (existe) fallo('La versión ' + tag + ' ya está publicada: sube el número de versión');
  const body = path.join(REL, 'release.json');
  fs.writeFileSync(body, JSON.stringify({ tag_name: tag, target_commitish: head, name: 'Gestor de Emergencias UCO ' + VERSION, body: notas, draft: true, prerelease: false }));
  const rel = JSON.parse(sh('gh', ['api', '-X', 'POST', `repos/${REPO}/releases`, '--input', body]));
  ok('Borrador de la versión ' + tag + ' creado');
  for (const f of [nombre, 'SHA256SUMS.txt']) {
    const tipo = f.endsWith('.zip') ? 'application/zip' : 'text/plain';
    const a = JSON.parse(sh('gh', ['api', '-X', 'POST', `https://uploads.github.com/repos/${REPO}/releases/${rel.id}/assets?name=${encodeURIComponent(f)}`, '-H', 'Content-Type: ' + tipo, '--input', path.join(REL, f)]));
    const local = 'sha256:' + sha256(fs.readFileSync(path.join(REL, f)));
    if (a.digest && a.digest !== local) fallo(`GitHub calculó otra suma para ${f}: ${a.digest} ≠ ${local}`);
    ok(`${f} subido${a.digest ? ' (SHA-256 verificado por GitHub)' : ''}`);
  }
  sh('gh', ['api', '-X', 'PATCH', `repos/${REPO}/releases/${rel.id}`, '-F', 'draft=false']);
  ok('Versión ' + tag + ' publicada: los servidores la verán en Sistema → Actualizaciones');
}
