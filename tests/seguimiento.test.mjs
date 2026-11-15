/* Pruebas del seguimiento del pedido para el cliente: qué ve, cuándo vence, calificaciones y la página pública. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { APP, archivosGs, cargarServidor } from './entorno.mjs';
import { copiarApp, generarPagina } from '../herramientas/flota.mjs';

const servidor = cargarServidor();
const g = new Proxy(servidor, {
  get: (o, k) => typeof o[k] === 'function'
    ? (...a) => { const r = o[k](...a); return r && typeof r === 'object' ? JSON.parse(JSON.stringify(r)) : r; }
    : o[k]
});

const DIA = 86400000;
const AHORA = Date.UTC(2026, 10, 15, 15, 0);
const PEDIDO = {
  id: 'P-261115-101500-AB', estado: 'En camino', fecha: '2026-11-15', hora: '15:00', entrega: 'Domicilio',
  registradoMs: AHORA - 5 * 3600000, inicioPrepMs: AHORA - 4 * 3600000, listoMs: AHORA - 3600000, salioMs: AHORA - 600000, entregadoMs: 0,
  conEvidencia: false,
  // Datos privados: NUNCA deben llegar al cliente.
  cliente: 'Camila Rojas', para: 'Laura Pérez', telefono: '3001234567', direccion: 'Calle 10 # 5-20', total: 131313,
  descripcion: 'Torta de chocolate', vendedora: 'Ana', entregador: 'Pedro', costo: 41357, saldo: 87979, textoDedicatoria: 'Te quiero', evidencia: 'https://drive.google.com/file/d/xyz'
};
const CFG = { nombre: 'Angiie Repostería', principal: '#E46A9A', secundario: '#17382C', whatsapp: '573001112233', fotoCliente: true, terminos: { producto: 'postre' } };

test('el cliente solo recibe estado, horas y datos del negocio (nada privado)', () => {
  const v = g.vistaPublica_(PEDIDO, CFG, null);
  const texto = JSON.stringify(v);
  ['Camila', 'Laura', '3001234567', 'Calle 10', '131313', '87979', 'chocolate', 'Ana', 'Pedro', '41357', 'Te quiero', 'drive.google.com'].forEach(dato => {
    assert.ok(!texto.includes(dato), 'se filtró: ' + dato);
  });
  assert.deepEqual(Object.keys(v).sort(), ['calificacion', 'negocio', 'pedido']);
  assert.deepEqual(Object.keys(v.pedido).sort(), ['conFoto', 'entrega', 'estado', 'fecha', 'hora', 'pasos', 'ref']);
  assert.equal(v.pedido.ref, '101500-AB'.slice(-6));
  assert.equal(v.pedido.pasos.camino, PEDIDO.salioMs);
  assert.equal(v.negocio.whatsapp, '573001112233');
});

test('la foto solo se ofrece cuando el pedido ya se entregó', () => {
  assert.equal(g.vistaPublica_(Object.assign({}, PEDIDO, { conEvidencia: true }), CFG, null).pedido.conFoto, false);
  assert.equal(g.vistaPublica_(Object.assign({}, PEDIDO, { estado: 'Entregado', conEvidencia: true }), CFG, null).pedido.conFoto, true);
});

test('el nombre del producto se entiende: femenino y plural irregular', () => {
  assert.deepEqual(g.terminoProducto_('torta (f)'), { singular: 'torta', plural: 'tortas', femenino: true });
  assert.deepEqual(g.terminoProducto_('pan, panes'), { singular: 'pan', plural: 'panes', femenino: false });
  assert.deepEqual(g.terminoProducto_('postre'), { singular: 'postre', plural: 'postres', femenino: false });
  assert.deepEqual(g.terminoProducto_(''), { singular: 'pedido', plural: 'pedidos', femenino: false });
});

test('el enlace vence 5 días después de entregado o cancelado, nunca antes', () => {
  assert.equal(g.seguimientoVencido_(PEDIDO, AHORA + 400 * DIA), false, 'un pedido en curso no vence');
  const entregado = Object.assign({}, PEDIDO, { estado: 'Entregado', entregadoMs: AHORA });
  assert.equal(g.seguimientoVencido_(entregado, AHORA + 4.9 * DIA), false);
  assert.equal(g.seguimientoVencido_(entregado, AHORA + 5.1 * DIA), true);
});

test('código de seguimiento: 12 letras, válido solo con ese formato', () => {
  const c = g.codigoSeguimientoDesdeBytes_([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 250]);
  assert.match(c, /^[a-z2-9]{12}$/);
  assert.equal(g.esCodigoSeguimiento_(c), true);
  ['', 'abc', c.toUpperCase(), c + 'x', '../../etc', 'abcdefghijk0'].forEach(m => assert.equal(g.esCodigoSeguimiento_(m), false, m));
});

test('calificación: de 1 a 5 estrellas y comentario corto', () => {
  assert.deepEqual(g.validarCalificacion_('5', '  ¡Deliciosa!   llegó a tiempo '), { estrellas: 5, comentario: '¡Deliciosa! llegó a tiempo' });
  assert.match(g.validarCalificacion_(0, '').error, /1 a 5/);
  assert.match(g.validarCalificacion_(6, '').error, /1 a 5/);
  assert.equal(g.validarCalificacion_(4, 'x'.repeat(500)).comentario.length, 300);
});

test('resumen de calificaciones para la dueña', () => {
  const r = g.resumirCalificaciones_([
    { estrellas: 5, comentario: 'Excelente', registradoMs: 3 },
    { estrellas: 4, comentario: '', registradoMs: 2 },
    { estrellas: 5, comentario: 'Muy rica', registradoMs: 1 }
  ]);
  assert.equal(r.total, 3);
  assert.equal(r.promedio, 4.7);
  assert.deepEqual(r.distribucion, [2, 1, 0, 0, 0]);
  assert.equal(r.ultimas[0].comentario, 'Excelente');
  assert.deepEqual(g.resumirCalificaciones_([]).promedio, 0);
});

test('WhatsApp del negocio: solo números, opcional', () => {
  assert.equal(g.validarNegocio_({ whatsapp: '300 123 4567' }).whatsapp, '3001234567');
  assert.equal(g.validarNegocio_({ whatsapp: '' }).whatsapp, '');
  assert.match(g.validarNegocio_({ whatsapp: '123' }).error, /WhatsApp/);
});

const TODO = archivosGs().map(f => fs.readFileSync(path.join(APP, f), 'utf8')).join('\n');
const cuerpo = n => { const i = TODO.indexOf('function ' + n + '('); return TODO.slice(i, TODO.indexOf('\n}', i)); };

test('la API pública revisa el código, usa la memoria de 5 minutos y se protege del tráfico alto', () => {
  assert.match(cuerpo('apiPublica_'), /esCodigoSeguimiento_\(codigo\)/);
  const estado = cuerpo('estadoPublico_');
  assert.match(estado, /cache\.get\('seg:'/);
  assert.match(estado, /muchoTrafico_\(\)/);
  assert.match(estado, /vistaPublica_\(/, 'lo que se entrega pasa por vistaPublica_');
  assert.match(estado, /SEG_MEMORIA/);
  ['fotoPublica_', 'calificar_'].forEach(n => {
    assert.match(cuerpo(n), /p\.estado !== 'Entregado'/, n + ' solo con pedidos entregados');
    assert.match(cuerpo(n), /excedeLimite_\(codigo/, n + ' tiene límite por pedido');
  });
  // Cualquier error se responde como JSON "ocupado" (la página muestra el mensaje amable), nunca la página de error de Google.
  assert.match(cuerpo('apiPublica_'), /catch \(err\)[\s\S]*ocupado: true/);
});

const PAGINA = fs.readFileSync(path.join(APP, 'PaginaSeguimiento.html'), 'utf8');

test('la página de seguimiento no tiene errores y trae el mensaje de tráfico alto', () => {
  const js = PAGINA.slice(PAGINA.indexOf('<script>') + 8, PAGINA.lastIndexOf('</script>'));
  assert.doesNotThrow(() => new vm.Script(js, { filename: 'PaginaSeguimiento.html' }));
  assert.ok(PAGINA.includes("var API = '__API__'"));
  assert.ok(PAGINA.includes('¡Estamos a toda máquina!'));
  assert.ok(PAGINA.includes('lo más importante eres tú'));
  assert.ok(!PAGINA.includes('<?'), 'Apps Script intentaría ejecutar marcas <? ?>');
});

test('flota genera la página pedido/ de cada negocio, apuntando a su app', () => {
  const docs = path.join(path.dirname(APP), 'docs', 'zz-prueba-seg');
  try {
    generarPagina('zz-prueba-seg', { nombre: 'Angiie Repostería', url: 'https://script.google.com/macros/s/ABC/exec', color: '#E46A9A' });
    const html = fs.readFileSync(path.join(docs, 'pedido', 'index.html'), 'utf8');
    assert.ok(html.includes("var API = 'https://script.google.com/macros/s/ABC/exec'"));
    assert.ok(!html.includes('__API__'));
    assert.ok(html.includes('<title>Tu pedido · Angiie Repostería</title>'));
  } finally {
    fs.rmSync(docs, { recursive: true, force: true });
  }
});

test('flota le dice a la app la dirección de su página, para los enlaces de seguimiento', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elka-seg-'));
  try {
    copiarApp(dir, { pagina: 'https://elka.github.io/negocios/angiie/' });
    assert.match(fs.readFileSync(path.join(dir, 'Giro.gs'), 'utf8'), /const PAGINA_NEGOCIO = "https:\/\/elka\.github\.io\/negocios\/angiie\/";/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('sin marca, el femenino se adivina igual que en la app; la marca (m) o (f) manda', () => {
  assert.equal(g.terminoProducto_('torta').femenino, true);
  assert.equal(g.terminoProducto_('dona').femenino, true);
  assert.equal(g.terminoProducto_('postre').femenino, false);
  assert.deepEqual(g.terminoProducto_('día (m)'), { singular: 'día', plural: 'días', femenino: false });
  assert.equal(g.terminoProducto_('ramo (f)').femenino, true);
});

test('la página no usa los parámetros que Apps Script reserva (c, sid): Google respondería 400', () => {
  const llamadas = [...PAGINA.matchAll(/pedir\('([^']+)'/g)].map(m => m[1]);
  assert.ok(llamadas.length >= 4);
  llamadas.forEach(q => assert.doesNotMatch(q, /(^|&)(c|sid)=/, q));
  assert.match(cuerpo('apiPublica_'), /q\.codigo/);
  assert.doesNotMatch(cuerpo('apiPublica_'), /q\.(c|sid)\b/);
});

test('la foto de la entrega no se muestra al cliente si el negocio no la activó (viene apagada)', () => {
  const entregado = Object.assign({}, PEDIDO, { estado: 'Entregado', conEvidencia: true });
  assert.equal(g.vistaPublica_(entregado, Object.assign({}, CFG, { fotoCliente: false }), null).pedido.conFoto, false);
  assert.equal(g.vistaPublica_(entregado, Object.assign({}, CFG, { fotoCliente: undefined }), null).pedido.conFoto, false);
  assert.equal(g.CONFIG_DEF ? g.CONFIG_DEF.fotoCliente : vm.runInContext('CONFIG_DEF.fotoCliente', servidor), false);
  assert.match(cuerpo('fotoPublica_'), /leerConfig_\(\)\.fotoCliente/, 'la foto tampoco se entrega por la API');
  assert.equal(g.validarNegocio_({ fotoCliente: true }).fotoCliente, 'Sí');
  assert.equal(g.validarNegocio_({ fotoCliente: false }).fotoCliente, 'No');
});
