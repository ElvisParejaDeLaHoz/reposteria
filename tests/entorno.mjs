/**
 * Carga el código de app/ en Node para probarlo sin Google.
 * Los servicios de Apps Script (SpreadsheetApp, DriveApp…) no existen aquí: solo se prueban
 * las funciones que no los usan (las de Calculos.gs) y la estructura de los archivos.
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

export const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'app');

/** Archivos .gs en el orden en que los carga Apps Script (00_Config primero). */
export function archivosGs() {
  return fs.readdirSync(APP).filter(f => f.endsWith('.gs')).sort();
}

/** Ejecuta todos los .gs juntos y devuelve el contexto con sus funciones globales. */
export function cargarServidor() {
  const codigo = archivosGs().map(f => '// ---- ' + f + '\n' + fs.readFileSync(path.join(APP, f), 'utf8')).join('\n');
  const ctx = vm.createContext({ console });
  vm.runInContext(codigo, ctx, { filename: 'app/*.gs' });
  return ctx;
}

/** Index.html con los pedazos metidos, como lo arma Apps Script con incluir_(). */
export function armarPantalla() {
  const idx = fs.readFileSync(path.join(APP, 'Index.html'), 'utf8');
  const faltan = [];
  const html = idx.replace(/[ \t]*<\?!= incluir_\('(\w+)'\) \?>/g, (_, nombre) => {
    const f = path.join(APP, nombre + '.html');
    if (!fs.existsSync(f)) { faltan.push(nombre); return ''; }
    return fs.readFileSync(f, 'utf8');
  });
  return { html, faltan };
}

/** Un pedido válido para usar de base en las pruebas. */
export function pedidoValido(cambios) {
  return Object.assign({
    medio: 'WhatsApp', cliente: 'Camila Rojas', para: 'Laura Pérez',
    descripcion: 'Ramo de 12 rosas rojas con eucalipto y papel kraft',
    entrega: 'Domicilio', pago: 'Efectivo', direccion: 'Calle 10 # 5-20', telefono: '3001234567',
    fecha: '2026-11-20', hora: '15:00', valorProducto: 120000, valorDomicilio: 10000,
    dedicatoria: 'No', textoDedicatoria: '', abono: 50000, costo: 40000
  }, cambios || {});
}

export const CONFIG = {
  medios: ['WhatsApp', 'Instagram', 'En el local'],
  pagos: ['Efectivo', 'Transferencia', 'Nequi', 'Ya pagado'],
  minDesc: 20
};
