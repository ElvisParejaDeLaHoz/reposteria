/* Pruebas de estructura: que la pantalla se arme bien y que todo lo que llama exista. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { APP, archivosGs, cargarServidor, armarPantalla } from './entorno.mjs';

const { html, faltan } = armarPantalla();
const js = html.slice(html.indexOf('<script>') + 8, html.lastIndexOf('</script>'));

test('el servidor carga sin errores (constantes en orden, sin nombres repetidos)', () => {
  assert.doesNotThrow(() => cargarServidor());
});

test('no hay dos funciones con el mismo nombre en archivos distintos', () => {
  const vistos = {};
  const repetidas = [];
  archivosGs().forEach(f => {
    const txt = fs.readFileSync(path.join(APP, f), 'utf8');
    for (const m of txt.matchAll(/^function ([A-Za-z0-9_]+)/gm)) {
      if (vistos[m[1]]) repetidas.push(m[1] + ' (' + vistos[m[1]] + ' y ' + f + ')');
      vistos[m[1]] = f;
    }
  });
  assert.deepEqual(repetidas, []);
});

test('todos los pedazos de la pantalla existen', () => {
  assert.deepEqual(faltan, []);
});

test('el JavaScript de la pantalla no tiene errores de sintaxis', () => {
  assert.doesNotThrow(() => new vm.Script(js, { filename: 'Index.html (armado)' }));
});

test('los pedazos no traen marcas de plantilla que Apps Script intentaría ejecutar', () => {
  fs.readdirSync(APP).filter(f => f.endsWith('.html') && f !== 'Index.html').forEach(f => {
    assert.ok(!fs.readFileSync(path.join(APP, f), 'utf8').includes('<?'), f);
  });
});

test('cada elemento que busca el JavaScript existe en la pantalla', () => {
  const ids = new Set([...html.matchAll(/id="([\w-]+)"/g)].map(m => m[1]));
  const creadosEnJs = new Set([
    ...[...js.matchAll(/\.id = '([\w-]+)'/g)].map(m => m[1]),
    ...[...js.matchAll(/campoDinero\('([\w-]+)'/g)].map(m => m[1])
  ]);
  const usados = [...js.matchAll(/\$\('#([\w-]+)'\)/g)].map(m => m[1]);
  const prefijosDinamicos = /^(tab-|cuenta-|punto-|mod-|lista-)/;
  const faltantes = [...new Set(usados)].filter(id => !ids.has(id) && !creadosEnJs.has(id) && !prefijosDinamicos.test(id));
  assert.deepEqual(faltantes, []);
});

test('cada función que la pantalla le pide al servidor existe y es pública', () => {
  const g = cargarServidor();
  const pedidas = new Set([
    ...[...js.matchAll(/\bapi\('(\w+)'/g)].map(m => m[1]),
    ...[...js.matchAll(/\bllamar\('(\w+)'/g)].map(m => m[1])
  ]);
  const faltantes = [...pedidas].filter(n => typeof g[n] !== 'function' || n.endsWith('_'));
  assert.deepEqual(faltantes, []);
  assert.ok(pedidas.size >= 15, 'se encontraron ' + pedidas.size + ' llamadas');
});

test('incluir_ mete los pedazos tal cual (sin que Google los interprete como HTML)', () => {
  // Con createHtmlOutputFromFile(...).getContent() Google convertía "<" en "&lt;" dentro del JavaScript
  // y la app se quedaba en "Cargando…" (pasó en la primera instalación de prueba).
  const inicio = fs.readFileSync(path.join(APP, 'Inicio.gs'), 'utf8');
  const cuerpo = inicio.slice(inicio.indexOf('function incluir_('), inicio.indexOf('\n}', inicio.indexOf('function incluir_(')));
  assert.match(cuerpo, /getRawContent\(\)/);
  assert.doesNotMatch(cuerpo, /createHtmlOutputFromFile/);
});

test('la plantilla solo usa incluir_ (y existe en el servidor)', () => {
  const g = cargarServidor();
  assert.equal(typeof g.incluir_, 'function');
  const idx = fs.readFileSync(path.join(APP, 'Index.html'), 'utf8');
  const marcas = [...idx.matchAll(/<\?[\s\S]*?\?>/g)].map(m => m[0]);
  assert.ok(marcas.every(m => /^<\?!= incluir_\('\w+'\) \?>$/.test(m)), marcas.join(' | '));
});

test('lo que se lee o escribe en la hoja Pedidos usa nombres de columna que existen', () => {
  const s = cargarServidor();
  const columnas = new Set(s.COLUMNAS || vm.runInContext('COLUMNAS', s));
  const pedidos = fs.readFileSync(path.join(APP, 'Pedidos.gs'), 'utf8');
  const hojas = fs.readFileSync(path.join(APP, 'Hojas.gs'), 'utf8');
  const usados = new Set([
    ...[...pedidos.matchAll(/'([A-ZÁÉÍÓÚ][^']{1,40})': /g)].map(m => m[1]),
    ...[...hojas.slice(hojas.indexOf('function leerPedidos_')).slice(0, 6000).matchAll(/g\(f, '([^']+)'\)/g)].map(m => m[1])
  ]);
  assert.ok(usados.size > 20, 'la búsqueda encontró las columnas');
  [...usados].forEach(c => assert.ok(columnas.has(c), 'columna que no existe en COLUMNAS: ' + c));
});

test('la versión que muestra la app es la misma del archivo VERSION y de package.json', () => {
  const raiz = path.dirname(APP);
  const v = fs.readFileSync(path.join(raiz, 'VERSION'), 'utf8').trim();
  assert.match(fs.readFileSync(path.join(APP, '00_Config.gs'), 'utf8'), new RegExp("const VERSION_APP = '" + v.replace(/\./g, '\.') + "';"));
  assert.equal(JSON.parse(fs.readFileSync(path.join(raiz, 'package.json'), 'utf8')).version, v);
});

test('ningún .gs y .html se llaman igual (Apps Script no deja subirlos)', () => {
  const nombres = fs.readdirSync(APP).filter(f => /\.(gs|html)$/.test(f)).map(f => f.replace(/\.(gs|html)$/, '').toLowerCase());
  const repetidos = nombres.filter((n, i) => nombres.indexOf(n) !== i);
  assert.deepEqual(repetidos, [], 'nombres repetidos: ' + repetidos.join(', '));
});

test('fecha y hora de entrega se guardan como texto y se leen en la zona del libro (no se corren)', () => {
  const todo = archivosGs().map(f => fs.readFileSync(path.join(APP, f), 'utf8')).join('\n');
  assert.match(todo, /'Fecha entrega': "'" \+ p\.fecha/);
  assert.match(todo, /'Hora entrega': "'" \+ p\.hora/);
  const cuerpo = n => { const i = todo.indexOf('function ' + n + '('); return todo.slice(i, todo.indexOf('\n}', i)); };
  assert.match(cuerpo('leerPedidos_'), /getDisplayValues\(\)/, 'fecha y hora se leen como se ven');
  assert.match(cuerpo('leerPedidos_'), /fechaDeTexto_\(v\('Fecha entrega'\)\)/);
  assert.match(cuerpo('leerPedidos_'), /horaDeTexto_\(v\('Hora entrega'\)\)/);
  assert.match(cuerpo('leerPedidos_'), /registradoMs: t\('Registrado'\)/, 'los momentos se leen con instante_');
  assert.doesNotMatch(cuerpo('leerPedidos_'), /hm_\(|ms_\(/, 'nada lee el valor crudo de Sheets');
  assert.match(cuerpo('configuracionInicial'), /setSpreadsheetTimeZone\(Session\.getScriptTimeZone\(\)\)/);
});
