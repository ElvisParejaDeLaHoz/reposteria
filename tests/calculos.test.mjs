/* Pruebas de las cuentas y reglas de Calculos.gs. Un error aquí afectaría a todos los negocios a la vez. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarServidor, pedidoValido, CONFIG } from './entorno.mjs';

const servidor = cargarServidor();
/* Lo que viene del entorno aislado se pasa por JSON para compararlo como datos normales de Node. */
const g = new Proxy(servidor, {
  get: (o, k) => typeof o[k] === 'function'
    ? (...a) => { const r = o[k](...a); return r && typeof r === 'object' ? JSON.parse(JSON.stringify(r)) : r; }
    : o[k]
});
const HOY = '2026-11-12';

const ped = (diaVenta, total, costo) => ({ diaVenta, total, costo });
const PEDIDOS = [ped('2026-11-02', 100000, 40000), ped('2026-11-05', 200000, 80000), ped('2026-10-10', 150000, 0)];
const MOVS = [
  { fecha: '2026-11-03', tipo: 'Gasto', clase: 'Variable', categoria: 'Insumos', valor: 20000, metodo: 'Efectivo' },
  { fecha: '2026-11-01', tipo: 'Gasto', clase: 'Fijo', categoria: 'Arriendo', valor: 50000, metodo: 'Transferencia' },
  { fecha: '2026-11-04', tipo: 'Ingreso', pedido: '', valor: 30000, metodo: 'Efectivo' },
  { fecha: '2026-11-04', tipo: 'Ingreso', pedido: 'P-1', valor: 100000, metodo: 'Nequi' },
  { fecha: '2026-11-06', tipo: 'Retiro', valor: 60000, metodo: 'Efectivo' },
  { fecha: '2026-11-06', tipo: 'Gasto', clase: 'Variable', categoria: 'Insumos', valor: 5000, metodo: 'Efectivo' }
];

test('cuentas del mes: ventas, costos, ganancia y plata recibida', () => {
  const c = g.cuentasMes_('2026-11', PEDIDOS, MOVS);
  assert.equal(c.pedidos, 2);
  assert.equal(c.ventas, 330000, 'pedidos (300.000) + venta directa (30.000)');
  assert.equal(c.costosVariables, 145000, 'costo de pedidos (120.000) + gastos variables (25.000)');
  assert.equal(c.gastosFijos, 50000);
  assert.equal(c.ganancia, 135000, '330.000 − 145.000 − 50.000');
  assert.equal(c.recibido, 130000);
  assert.equal(c.retiros, 60000);
  assert.equal(c.flujo, 130000 - 25000 - 50000 - 60000);
});

test('un mes sin movimientos da todo en cero', () => {
  const c = g.cuentasMes_('2025-01', PEDIDOS, MOVS);
  assert.equal(c.ventas, 0);
  assert.equal(c.ganancia, 0);
});

test('mes anterior, incluido el cambio de año', () => {
  assert.equal(g.mesAnterior_('2026-11'), '2026-10');
  assert.equal(g.mesAnterior_('2026-01'), '2025-12');
});

test('punto de equilibrio con gastos fijos y sueldo', () => {
  const mes = { ventas: 1000000, costosVariables: 400000, gastosFijos: 0 };
  const cero = { ventas: 0, costosVariables: 0, gastosFijos: 0 };
  const e = g.equilibrio_([mes, cero, cero], [{ concepto: 'Arriendo', valor: 600000 }], 300000, '2026-11', HOY);
  assert.equal(e.margen, 0.6);
  assert.equal(e.pe, 1000000, '600.000 / 0,6');
  assert.equal(e.meta, 1500000, '(600.000 + 300.000) / 0,6');
  assert.equal(e.diasRestantes, 19, 'del 12 al 30 de noviembre');
  assert.equal(e.esActual, true);
});

test('punto de equilibrio: el margen se mide con 3 meses', () => {
  const a = { ventas: 100, costosVariables: 90, gastosFijos: 0 };
  const b = { ventas: 300, costosVariables: 30, gastosFijos: 0 };
  const e = g.equilibrio_([a, b, b], [], 0, '2026-10', HOY);
  assert.equal(Math.round(e.margen * 1000), Math.round((700 - 150) / 700 * 1000));
  assert.equal(e.diasRestantes, 0, 'un mes pasado no tiene días restantes');
});

test('punto de equilibrio: sin lista de fijos usa los fijos registrados en el mes', () => {
  const mes = { ventas: 500000, costosVariables: 250000, gastosFijos: 100000 };
  const e = g.equilibrio_([mes, mes, mes], [], 0, '2026-11', HOY);
  assert.equal(e.fijos, 100000);
  assert.equal(e.pe, 200000);
});

test('punto de equilibrio: sin ventas o perdiendo en cada venta no hay número', () => {
  const cero = { ventas: 0, costosVariables: 0, gastosFijos: 0 };
  assert.equal(g.equilibrio_([cero, cero, cero], [{ concepto: 'x', valor: 1 }], 0, '2026-11', HOY).margen, null);
  const pierde = { ventas: 100, costosVariables: 150, gastosFijos: 0 };
  const e = g.equilibrio_([pierde, pierde, pierde], [{ concepto: 'x', valor: 1000 }], 0, '2026-11', HOY);
  assert.ok(e.margen < 0);
  assert.equal(e.pe, null);
});

test('caja del día: solo cuenta efectivo, y el cuadre dice cuánto sobra o falta', () => {
  const k = g.cajaDelDia_('2026-11-06', MOVS);
  assert.deepEqual({ ...k }, { entradas: 0, salidas: 65000 });
  const k4 = g.cajaDelDia_('2026-11-04', MOVS);
  assert.equal(k4.entradas, 30000, 'el pago por Nequi no entra a la caja');
  assert.deepEqual({ ...g.cuadreCaja_(100000, 30000, 5000, 120000) }, { esperado: 125000, diferencia: -5000 });
});

test('gastos por categoría, de mayor a menor', () => {
  const r = g.gastosPorCategoria_(MOVS, '2026-11');
  assert.deepEqual(r.map(x => [x.k, x.n, x.total]), [['Arriendo', 1, 50000], ['Insumos', 2, 25000]]);
});

test('por cobrar: solo pedidos con control de pago y saldo, los más viejos primero', () => {
  const r = g.porCobrar_([
    { id: 'A', fecha: '2026-11-10', controlPago: true, saldo: 5000, estado: 'Listo' },
    { id: 'B', fecha: '2026-11-01', controlPago: true, saldo: 1000, estado: 'Entregado' },
    { id: 'C', fecha: '2026-11-01', controlPago: false, saldo: 0, estado: 'Pendiente' },
    { id: 'D', fecha: '2026-11-01', controlPago: true, saldo: 0, estado: 'Entregado' },
    { id: 'E', fecha: '2026-11-01', controlPago: true, saldo: 9000, estado: 'Cancelado' }
  ]);
  assert.deepEqual(r.map(x => x.id), ['B', 'A']);
});

test('validar pedido: uno bien hecho pasa', () => {
  assert.equal(g.validarPedido_(pedidoValido(), CONFIG, HOY), null);
});

test('validar pedido: errores comunes', () => {
  const casos = [
    [{ medio: 'Fax' }, /medio/],
    [{ cliente: '  ' }, /cliente/],
    [{ descripcion: 'corto' }, /mínimo 20/],
    [{ entrega: 'Domicilio', direccion: '' }, /dirección/],
    [{ telefono: '123' }, /teléfono/],
    [{ fecha: '2026-02-30x' }, /Fecha/],
    [{ fecha: '2020-01-01' }, /razonable/],
    [{ hora: '25:00' }, /Hora/],
    [{ valorProducto: 0 }, /valor del producto/],
    [{ dedicatoria: 'Sí', textoDedicatoria: '' }, /dedicatoria/],
    [{ abono: 130001 }, /abono no puede ser mayor/],
    [{ abono: -1 }, /abono no es válido/],
    [{ costo: -5 }, /costo/]
  ];
  casos.forEach(([cambio, error]) => {
    assert.match(String(g.validarPedido_(pedidoValido(cambio), CONFIG, HOY)), error, JSON.stringify(cambio));
  });
});

test('validar pedido: el abono puede ser igual al total y el mínimo de letras se configura', () => {
  assert.equal(g.validarPedido_(pedidoValido({ abono: 130000 }), CONFIG, HOY), null);
  const restaurante = Object.assign({}, CONFIG, { minDesc: 3 });
  assert.equal(g.validarPedido_(pedidoValido({ descripcion: '1 corriente' }), restaurante, HOY), null);
});

test('validar pedido: al editar se acepta un medio de pago que ya no está en la lista', () => {
  const p = pedidoValido({ pago: 'Daviplata' });
  assert.match(String(g.validarPedido_(p, CONFIG, HOY)), /pago/);
  assert.equal(g.validarPedido_(p, CONFIG, HOY, ['WhatsApp', 'Daviplata']), null);
});

test('validar movimiento', () => {
  const ok = { tipo: 'Gasto', valor: 20000, fecha: HOY, metodo: 'Efectivo', categoria: 'Insumos' };
  assert.equal(g.validarMovimiento_(ok, CONFIG, HOY), null);
  assert.match(g.validarMovimiento_({ ...ok, tipo: 'Robo' }, CONFIG, HOY), /gasto, un retiro/);
  assert.match(g.validarMovimiento_({ ...ok, valor: 0 }, CONFIG, HOY), /valor/);
  assert.match(g.validarMovimiento_({ ...ok, fecha: '2026-11-20' }, CONFIG, HOY), /razonable/);
  assert.match(g.validarMovimiento_({ ...ok, metodo: 'Trueque' }, CONFIG, HOY), /pagó/);
  assert.match(g.validarMovimiento_({ ...ok, categoria: '' }, CONFIG, HOY), /categoría/);
  assert.equal(g.validarMovimiento_({ ...ok, tipo: 'Retiro', categoria: '' }, CONFIG, HOY), null);
});

test('validar gastos fijos: limpia filas vacías y rechaza valores malos', () => {
  const r = g.validarFijos_([{ concepto: ' Arriendo ', valor: 800000 }, { concepto: '', valor: 0 }], 1200000);
  assert.deepEqual(JSON.parse(JSON.stringify(r)), { fijos: [{ concepto: 'Arriendo', valor: 800000 }], sueldo: 1200000 });
  assert.match(g.validarFijos_([{ concepto: '', valor: 5 }], 0).error, /nombre/);
  assert.match(g.validarFijos_([{ concepto: 'Luz', valor: -5 }], 0).error, /Luz/);
  assert.match(g.validarFijos_('nada', 0).error, /lista/);
});

test('seguro_: un texto nunca se convierte en fórmula de Sheets', () => {
  assert.equal(g.seguro_('=IMPORTXML("x")'), "'=IMPORTXML(\"x\")");
  assert.equal(g.seguro_('+57 300'), "'+57 300");
  assert.equal(g.seguro_('  Hola  '), 'Hola');
  assert.equal(g.seguro_('abcdef', 3), 'abc');
});

test('turnos: por fecha, hora y orden de llegada; los listos no tienen turno', () => {
  const l = [
    { id: 'b', fecha: '2026-11-12', hora: '10:00', registradoMs: 2, estado: 'Pendiente' },
    { id: 'a', fecha: '2026-11-12', hora: '10:00', registradoMs: 1, estado: 'En preparación' },
    { id: 'c', fecha: '2026-11-12', hora: '09:00', registradoMs: 3, estado: 'Pendiente' },
    { id: 'x', fecha: '2026-11-12', hora: '08:00', registradoMs: 0, estado: 'Listo' },
    { id: 'd', fecha: '2026-11-13', hora: '08:00', registradoMs: 4, estado: 'Pendiente' }
  ];
  servidor.asignarTurnos_(l); // cambia la lista en su lugar
  const t = Object.fromEntries(l.map(p => [p.id, p.turno]));
  assert.deepEqual(t, { c: 1, a: 2, b: 3, x: 0, d: 1 });
  assert.equal(l.find(p => p.id === 'a').turnosDia, 3);
});

test('firma de imágenes: no basta con decir que es JPG', () => {
  assert.equal(g.firmaImagen_([0xFF, 0xD8, 0xFF, 0xE0], 'image/jpeg'), true);
  assert.equal(g.firmaImagen_([0x3C, 0x68, 0x74, 0x6D], 'image/jpeg'), false);
  assert.equal(g.firmaImagen_([0x89, 0x50, 0x4E, 0x47], 'image/png'), true);
});
