#!/usr/bin/env node
/**
 * FLOTA: instala y actualiza la app en el proyecto de cada negocio.
 *
 *   node herramientas/flota.mjs instalar <id> --nombre "Floristería Rosa" [--giro floristeria] [--cuenta soporte] [--correo negocio@gmail.com] [--color #C0245E]
 *   node herramientas/flota.mjs giros
 *   node herramientas/flota.mjs actualizar --todos [--nota "Gastos y cierre de caja"]
 *   node herramientas/flota.mjs actualizar <id> [<id> ...]
 *   node herramientas/flota.mjs listar
 *   node herramientas/flota.mjs paginas
 *
 * Cada negocio tiene su propio proyecto de Apps Script pegado a su propia hoja de cálculo.
 * Al actualizar se reutiliza la misma implementación, así la dirección de la app nunca cambia.
 * Antes de instalar o actualizar se corren las pruebas (npm test): si fallan, no se publica nada.
 *
 * Requisitos: Node 18+ y clasp 3 con sesión iniciada (`clasp login`, o `clasp login --user <cuenta>`).
 * La API de Apps Script debe estar activada en https://script.google.com/home/usersettings
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// realpath da la ruta con la letra de la unidad bien escrita (C:\ y no c:\). Si no, clasp 3 compara
// rutas, cree que la carpeta es un acceso directo y se niega a subir ("Content directory is a symlink").
const RAIZ = fs.realpathSync.native(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'));
const APP = path.join(RAIZ, 'app');
/** Todo lo que se sube a cada proyecto: los .gs, los .html y el manifiesto. */
function archivosApp() {
  const lista = fs.readdirSync(APP).filter(f => /\.(gs|html)$/.test(f) || f === 'appsscript.json').sort();
  ['00_Config.gs', 'Index.html', 'appsscript.json'].forEach(f => { if (lista.indexOf(f) < 0) salir('Falta app/' + f); });
  return lista;
}
const TRABAJO = path.join(RAIZ, '.flota');
const REGISTRO = path.join(RAIZ, 'flota', 'clientes.json');
const CONFIG = path.join(RAIZ, 'flota', 'config.json');
const PAGINAS = path.join(RAIZ, 'docs');
const VERSION = path.join(RAIZ, 'VERSION');
const GIROS = path.join(RAIZ, 'herramientas', 'giros.json');

function giros() { const g = leerJSON(GIROS, {}); delete g._ayuda; return g; }

/* ---------------- utilidades ---------------- */

function salir(msg) { console.error('\n✖ ' + msg + '\n'); process.exit(1); }
function leerJSON(f, def) { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { return def; } }
function escribirJSON(f, v) { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + '\n'); }
function version() { try { return fs.readFileSync(VERSION, 'utf8').trim(); } catch (e) { return '0.0.0'; } }
function hoy() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }

function opciones(args) {
  const o = { _: [] };
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a.startsWith('--')) {
      const k = a.slice(2);
      const sig = args[i + 1];
      if (sig === undefined || sig.startsWith('--')) o[k] = true; else { o[k] = sig; i++; }
    } else o._.push(a);
  }
  return o;
}

/** Comillas para la consola de Windows/Unix. Los nombres no pueden traer comillas dobles. */
function q(a) {
  a = String(a);
  if (a.includes('"')) salir('Los textos no pueden llevar comillas dobles: ' + a);
  return /^[\w@.:\/=#+-]+$/.test(a) ? a : '"' + a + '"';
}

function clasp(args, { cwd, cuenta } = {}) {
  const todos = (cuenta && cuenta !== 'default' ? ['--user', cuenta] : []).concat(args);
  const r = spawnSync('clasp', todos.map(q), { cwd, shell: true, encoding: 'utf8' });
  const salida = ((r.stdout || '') + '\n' + (r.stderr || '')).trim();
  if (r.status !== 0) throw new Error('clasp ' + args.join(' ') + ' falló:\n' + salida);
  return salida;
}

function registro() { return leerJSON(REGISTRO, { clientes: {} }); }
function config() { return leerJSON(CONFIG, { paginaBase: '' }); }

/** Copia la app a la carpeta de trabajo del negocio, lista para `clasp push`. */
function prepararCarpeta(id, c) {
  const dir = path.join(TRABAJO, id);
  fs.mkdirSync(dir, { recursive: true });
  // El registro es la fuente de verdad: .flota/ se puede borrar y se reconstruye solo.
  // 00_Config.gs va primero: tiene las constantes que usan los demás archivos.
  escribirJSON(path.join(dir, '.clasp.json'), { scriptId: c.scriptId, rootDir: '', filePushOrder: ['00_Config.gs'] });
  copiarApp(dir, Object.assign({}, c, { pagina: paginaDe(id) }));
  return dir;
}

/** Dirección pública de la página del negocio (con / al final), o '' si todavía no hay paginaBase. */
function paginaDe(id) {
  const base = config().paginaBase || '';
  return /^https:\/\//.test(base) && !/TU-USUARIO/.test(base) ? base.replace(/\/$/, '') + '/' + id + '/' : '';
}

function copiarApp(dir, c) {
  // Se borran las copias anteriores: un archivo que ya no existe en app/ (como el viejo Code.gs)
  // se subiría otra vez y duplicaría funciones.
  fs.readdirSync(dir).filter(f => /\.(gs|html)$/.test(f)).forEach(f => fs.unlinkSync(path.join(dir, f)));
  const archivos = archivosApp();
  archivos.forEach(f => fs.copyFileSync(path.join(APP, f), path.join(dir, f)));
  // Giro.gs: datos de esta instalación. GIRO_INICIAL son los valores de arranque del tipo de negocio (solo se
  // usan al crear la hoja Configuración) y PAGINA_NEGOCIO la dirección de su página, para los enlaces de seguimiento.
  const g = c && c.giro ? giros()[c.giro] : null;
  const pagina = c && typeof c.pagina === 'string' && /^https:\/\//.test(c.pagina) ? c.pagina : '';
  if (g || pagina) {
    // El color del tipo de negocio (o el de --color) también es el color de arranque de la app, no solo del ícono.
    const inicial = Object.assign({}, (g && g.config) || {});
    const color = /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : (g && g.color);
    if (color && !inicial['Color principal']) inicial['Color principal'] = color;
    fs.writeFileSync(path.join(dir, 'Giro.gs'), '/* Generado por herramientas/flota.mjs' + (g ? ': tipo de negocio "' + c.giro + '"' : '') + '. No lo edites aquí. */\n' +
      'const GIRO_INICIAL = ' + JSON.stringify(inicial, null, 2) + ';\n' +
      'const PAGINA_NEGOCIO = ' + JSON.stringify(pagina) + ';\n');
    archivos.push('Giro.gs');
  }
  fs.writeFileSync(path.join(dir, '.claspignore'), '**/**\n' + archivos.map(f => '!' + f).join('\n') + '\n');
}

function listarGiros() {
  const g = giros();
  console.log('Tipos de negocio disponibles (usa --giro <id> al instalar):\n');
  Object.keys(g).forEach(k => console.log('  ' + k.padEnd(14) + g[k].nombre));
}

/**
 * Antes de tocar cualquier negocio se corren las pruebas: si algo falla, no se publica nada.
 * Solo se salta con --sin-pruebas (para una emergencia, y sabiendo lo que se hace).
 */
function probarAntes(o) {
  if (o && o['sin-pruebas']) { console.log('⚠ Publicando SIN correr las pruebas.'); return; }
  console.log('→ Corriendo las pruebas…');
  const r = spawnSync(process.execPath, ['--test', ...fs.readdirSync(path.join(RAIZ, 'tests')).filter(f => f.endsWith('.test.mjs')).map(f => path.join('tests', f))],
    { cwd: RAIZ, encoding: 'utf8' });
  if (r.status !== 0) {
    console.error(((r.stdout || '') + (r.stderr || '')).split('\n').filter(l => /✖|Error|actual|expected/.test(l)).slice(0, 30).join('\n'));
    salir('Las pruebas fallaron. No se publicó nada. Corrige y vuelve a intentar (npm test para ver el detalle).');
  }
  console.log('  ✔ pruebas en verde');
}

/* ---------------- comandos ---------------- */

/** Crea la hoja y su proyecto de Apps Script, y los anota de una vez en el registro. */
function crearProyecto(id, dir, reg, d) {
  console.log('→ Creando la hoja y el proyecto de "' + d.nombre + '"…');
  const salidaCrear = clasp(['create-script', '--type', 'sheets', '--title', d.nombre], { cwd: dir, cuenta: d.cuenta });
  const proyecto = leerJSON(path.join(dir, '.clasp.json'), {});
  const scriptId = proyecto.scriptId || ((/script\.google\.com\/d\/([\w-]+)/.exec(salidaCrear) || [])[1]);
  if (!scriptId) salir('No se pudo leer el id del proyecto. Salida de clasp:\n' + salidaCrear);
  const padre = Array.isArray(proyecto.parentId) ? proyecto.parentId[0] : proyecto.parentId;
  const sheetId = padre || ((/spreadsheets\/d\/([\w-]+)/.exec(salidaCrear) || [])[1]) || '';

  // Se guarda de una vez: si algo falla después, el proyecto no queda huérfano.
  reg.clientes[id] = { nombre: d.nombre, giro: d.giro, cuenta: d.cuenta, scriptId, sheetId, deploymentId: '', url: '', correo: d.correo, color: d.color, instalado: hoy(), version: '', actualizado: '' };
  escribirJSON(REGISTRO, reg);

}

function instalar(o) {
  const id = o._[1];
  const nombre = typeof o.nombre === 'string' ? o.nombre.trim() : '';
  if (!id || !/^[a-z0-9][a-z0-9-]{2,39}$/.test(id)) salir('Escribe un id corto en minúsculas, sin espacios ni tildes. Ej: floristeria-rosa');
  if (!nombre) salir('Falta --nombre "Nombre del negocio"');
  // docs/ también tiene la página de Elka y su manual de marca: esos nombres no se pueden usar.
  if (['marca', 'archivos', 'recursos', 'elka', 'index'].includes(id)) salir('El id "' + id + '" está reservado para la página de Elka. Usa otro.');
  const reg = registro();
  // Si una instalación quedó a medias (proyecto creado pero sin publicar), se retoma en vez de crear otro proyecto.
  const retomar = reg.clientes[id] && reg.clientes[id].scriptId && !reg.clientes[id].deploymentId;
  if (reg.clientes[id] && !retomar) salir('Ya existe un negocio con el id "' + id + '". Usa otro id o "actualizar".');
  const cuenta = typeof o.cuenta === 'string' ? o.cuenta : 'default';
  const giro = typeof o.giro === 'string' ? o.giro : '';
  if (giro && !giros()[giro]) salir('No existe el tipo de negocio "' + giro + '". Mira la lista con: node herramientas/flota.mjs giros');
  const color = typeof o.color === 'string' ? o.color : (giro ? giros()[giro].color : '');

  const dir = path.join(TRABAJO, id);
  if (!retomar && fs.existsSync(path.join(dir, '.clasp.json'))) salir('Hay una instalación a medias en .flota/' + id + '. Revísala y bórrala antes de seguir.');
  probarAntes();
  fs.mkdirSync(dir, { recursive: true });

  if (retomar) console.log('→ Retomando la instalación a medias de "' + reg.clientes[id].nombre + '" (mismo proyecto y misma hoja)…');
  else crearProyecto(id, dir, reg, { nombre, giro, cuenta, color, correo: typeof o.correo === 'string' ? o.correo : '' });
  const c = reg.clientes[id];
  const scriptId = c.scriptId, sheetId = c.sheetId;

  console.log('→ Subiendo el código…');
  prepararCarpeta(id, c);
  clasp(['push', '--force'], { cwd: dir, cuenta: c.cuenta });

  console.log('→ Publicando la app…');
  const salidaDeploy = clasp(['create-deployment', '--description', 'v' + version()], { cwd: dir, cuenta: c.cuenta });
  const deploymentId = (/AKfyc[\w-]+/.exec(salidaDeploy) || [])[0];
  if (!deploymentId) salir('No se pudo leer el id de la publicación. Salida de clasp:\n' + salidaDeploy);

  Object.assign(reg.clientes[id], {
    deploymentId,
    url: 'https://script.google.com/macros/s/' + deploymentId + '/exec',
    version: version(),
    actualizado: hoy()
  });
  escribirJSON(REGISTRO, reg);
  generarPagina(id, reg.clientes[id]);

  const base = config().paginaBase;
  console.log('\n✔ "' + nombre + '" instalado.\n');
  const pagina = base ? base.replace(/\/$/, '') + '/' + id + '/' : 'docs/' + id + '/  (pon "paginaBase" en flota/config.json)';
  console.log('Faltan 3 pasos a mano (una sola vez):');
  console.log('  1. Autoriza la app: abre el editor, elige la función configuracionInicial, pulsa Ejecutar y acepta los permisos.');
  console.log('     Al terminar, el registro de ejecución muestra el CÓDIGO DE ACTIVACIÓN (ej. K7QM-3XPA).');
  console.log('       https://script.google.com/d/' + scriptId + '/edit');
  console.log('  2. Sube a GitHub la carpeta docs/. Su dirección será:');
  console.log('       ' + pagina);
  console.log('  3. Mándale al dueño o la dueña' + (o.correo ? ' (' + o.correo + ')' : '') + ' el enlace con el código:');
  console.log('       ' + (base ? pagina + '?activar=CODIGO' : 'https://…/' + id + '/?activar=CODIGO'));
  console.log('     Desde el celular pone el nombre, el color, su usuario y clave y sus gastos. No hace falta compartirle la hoja.');
  if (sheetId) console.log('\n  La hoja (solo para ti, soporte): https://docs.google.com/spreadsheets/d/' + sheetId + '/edit');
}

function actualizar(o) {
  const reg = registro();
  const ids = o.todos ? Object.keys(reg.clientes) : o._.slice(1);
  if (!ids.length) salir('Di a quién actualizar: un id, varios, o --todos');
  probarAntes(o);
  const desc = 'v' + version() + (typeof o.nota === 'string' ? ' · ' + o.nota : '') + ' · ' + hoy();
  const bien = [], mal = [];

  ids.forEach(id => {
    const c = reg.clientes[id];
    if (!c) { mal.push([id, 'no está en el registro']); return; }
    if (!c.deploymentId) { mal.push([id, 'no tiene publicación (instalación incompleta)']); return; }
    process.stdout.write('→ ' + c.nombre + ' (' + id + ')… ');
    try {
      const dir = prepararCarpeta(id, c);
      clasp(['push', '--force'], { cwd: dir, cuenta: c.cuenta });
      clasp(['update-deployment', c.deploymentId, '--description', desc], { cwd: dir, cuenta: c.cuenta });
      c.version = version();
      c.actualizado = hoy();
      escribirJSON(REGISTRO, reg);
      bien.push(id);
      console.log('listo');
    } catch (e) {
      mal.push([id, e.message.split('\n').slice(0, 4).join(' ')]);
      console.log('FALLÓ');
    }
  });

  console.log('\nActualizados: ' + bien.length + ' de ' + ids.length + ' (versión ' + version() + ')');
  mal.forEach(([id, err]) => console.log('  ✖ ' + id + ': ' + err));
  if (mal.length) process.exitCode = 1;
}

function listar() {
  const reg = registro();
  const ids = Object.keys(reg.clientes);
  if (!ids.length) { console.log('Todavía no hay negocios instalados.'); return; }
  const v = version();
  console.log('Versión actual del código: ' + v + '\n');
  ids.forEach(id => {
    const c = reg.clientes[id];
    const marca = c.version === v ? '✔' : '↑';
    console.log(marca + ' ' + id.padEnd(24) + ' ' + c.nombre.padEnd(30) + ' v' + (c.version || '—').padEnd(8) + ' ' + (c.actualizado || 'sin publicar') + '  [' + c.cuenta + ']');
  });
  console.log('\n↑ = tiene una versión anterior. Usa: node herramientas/flota.mjs actualizar --todos');
}

function paginas() {
  const reg = registro();
  Object.keys(reg.clientes).forEach(id => { if (reg.clientes[id].url) generarPagina(id, reg.clientes[id]); });
  console.log('Páginas generadas en docs/. Súbelas a GitHub.');
}

/* ---------------- página de cada negocio (GitHub Pages) ---------------- */

function generarPagina(id, c) {
  const dir = path.join(PAGINAS, id);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(PAGINAS, '.nojekyll'), '');
  const color = /^#[0-9a-f]{6}$/i.test(c.color || '') ? c.color : '#C0245E';
  const inicial = esc((c.nombre.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ0-9]/) || ['P'])[0].toUpperCase());

  fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <title>${esc(c.nombre)}</title>
  <meta name="robots" content="noindex, nofollow">
  <meta name="theme-color" content="${color}">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="${esc(c.nombre)}">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" href="icono.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="icono.svg">
  <style>
    html, body { margin: 0; height: 100%; background: #F4EEF2; }
    iframe { position: fixed; inset: 0; width: 100%; height: 100%; border: 0; }
    .respaldo { position: fixed; inset: auto 0 0 0; padding: 10px; text-align: center; font: 14px system-ui, sans-serif; }
  </style>
</head>
<body>
  <iframe id="app" src="${esc(c.url)}" title="${esc(c.nombre)}" allow="camera; clipboard-write; autoplay"></iframe>
  <noscript><p class="respaldo"><a href="${esc(c.url)}">Abrir la app</a></p></noscript>
  <script>
    // El enlace de activación (…/?activar=ABCD-2345) se le pasa a la app, que muestra la pantalla de bienvenida.
    (function () {
      var m = /[?&]activar=([A-Za-z0-9-]{8,12})(?:&|$)/.exec(location.search);
      if (!m) return;
      document.getElementById('app').src = ${JSON.stringify(c.url)} + '?activar=' + encodeURIComponent(m[1]);
      // Se quita de la barra de direcciones: si la agrega a la pantalla de inicio, no queda guardado el código.
      try { history.replaceState(null, '', location.pathname); } catch (e) { /* sin historial */ }
    })();
  </script>
</body>
</html>
`);

  escribirJSON(path.join(dir, 'manifest.webmanifest'), {
    name: c.nombre,
    short_name: c.nombre.length > 12 ? c.nombre.slice(0, 12) : c.nombre,
    start_url: '.',
    scope: '.',
    display: 'standalone',
    background_color: '#F4EEF2',
    theme_color: color,
    icons: [{ src: 'icono.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }]
  });

  // Página de seguimiento para los clientes: la misma de app/PaginaSeguimiento.html, apuntando a la app de este negocio.
  fs.mkdirSync(path.join(dir, 'pedido'), { recursive: true });
  const seg = fs.readFileSync(path.join(APP, 'PaginaSeguimiento.html'), 'utf8').split('__API__').join(c.url)
    .replace('<title>Sigue tu pedido</title>', '<title>Tu pedido · ' + esc(c.nombre) + '</title>');
  fs.writeFileSync(path.join(dir, 'pedido', 'index.html'), seg);

  fs.writeFileSync(path.join(dir, 'icono.svg'), `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="${color}"/><text x="50%" y="54%" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI, Arial, sans-serif" font-size="280" font-weight="700" fill="#fff">${inicial}</text></svg>\n`);
}

/* ---------------- arranque ---------------- */

// Las pruebas importan este archivo para revisar copiarApp sin tocar Google: solo arranca si se llama directo.
export { copiarApp, archivosApp, generarPagina };

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const o = opciones(process.argv.slice(2));
  const comandos = { instalar, actualizar, listar, paginas, giros: listarGiros };
  const cmd = comandos[o._[0]];
  if (!cmd) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^#!.*\n\/\*\*\n/, '').replace(/^ \* ?/gm, ''));
    process.exit(o._[0] ? 1 : 0);
  }
  try { cmd(o); } catch (e) { salir(e.message); }
}
