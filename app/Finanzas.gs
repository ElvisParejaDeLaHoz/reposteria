/**
 * Finanzas: ingresos, gastos, retiros, punto de equilibrio y caja.
 *
 * Todo pago o gasto queda como una fila en la hoja "Movimientos":
 *   Ingreso  → abonos y pagos de pedidos, o ventas sin pedido (venta directa).
 *   Gasto    → Fijo (arriendo, servicios, nómina…) o Variable (insumos, empaques…).
 *   Retiro   → plata que la dueña saca para ella. No es gasto del negocio, pero sí sale de la caja.
 * Un movimiento nunca se borra: se anula, para que siempre quede rastro.
 * Las cuentas en sí están en Calculos.gs, para poder probarlas sin Google.
 */

function tablaMovs_() {
  return new Tabla(HOJA_MOVS, COLUMNAS_MOVS, { 'Fecha': '@', 'Valor': '$#,##0', 'Registrado': 'dd/mm/yyyy hh:mm' });
}

function tablaFijos_() {
  return new Tabla(HOJA_FIJOS, COLUMNAS_FIJOS, { 'Valor mensual': '$#,##0' });
}

function tablaCierres_() {
  return new Tabla(HOJA_CIERRES, COLUMNAS_CIERRES, {
    'Fecha': '@', 'Base': '$#,##0', 'Entradas en efectivo': '$#,##0', 'Salidas en efectivo': '$#,##0',
    'Esperado': '$#,##0', 'Contado': '$#,##0', 'Diferencia': '$#,##0', 'Registrado': 'dd/mm/yyyy hh:mm'
  });
}

/** Anota un movimiento. `d`: tipo, clase, categoria, descripcion, valor, metodo, pedido, fecha. */
function agregarMov_(d, u) {
  const id = 'M-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd-HHmmss') + '-' +
    Math.random().toString(36).slice(2, 5).toUpperCase();
  tablaMovs_().agregar({
    'ID': id,
    'Fecha': d.fecha || hoyTxt_(),
    'Tipo': d.tipo,
    'Clase': d.tipo === 'Gasto' ? (d.clase === 'Fijo' ? 'Fijo' : 'Variable') : '',
    'Categoría': seguro_(d.categoria, 40),
    'Descripción': seguro_(d.descripcion, 200),
    'Valor': Math.round(Number(d.valor) || 0),
    'Método': seguro_(d.metodo, 40),
    'Pedido': d.pedido || '',
    'Registró': u.nombre,
    'Registrado': new Date()
  });
  return id;
}

function leerMovs_() {
  const t = tablaMovs_();
  const lista = t.filas().filter(f => f['ID']).map(f => ({
    fila: f._fila,
    id: String(f['ID']),
    fecha: aTextoFecha_(f['Fecha']),
    tipo: limpiar_(f['Tipo']),
    clase: limpiar_(f['Clase']),
    categoria: limpiar_(f['Categoría']),
    descripcion: limpiar_(f['Descripción']),
    valor: Number(f['Valor']) || 0,
    metodo: limpiar_(f['Método']),
    pedido: limpiar_(f['Pedido']),
    registro: limpiar_(f['Registró']),
    anulado: limpiar_(f['Anulado'])
  }));
  return { tabla: t, lista: lista };
}

function leerFijos_() {
  return tablaFijos_().filas()
    .map(f => ({ concepto: limpiar_(f['Concepto']), valor: Number(f['Valor mensual']) || 0 }))
    .filter(x => x.concepto && x.valor > 0);
}

function ultimoCierre_() {
  const cierres = tablaCierres_().filas(30).map(f => ({
    fecha: aTextoFecha_(f['Fecha']),
    esperado: Number(f['Esperado']) || 0,
    contado: Number(f['Contado']) || 0,
    diferencia: Number(f['Diferencia']) || 0,
    registro: limpiar_(f['Registró'])
  })).filter(c => c.fecha);
  return cierres.length ? cierres[cierres.length - 1] : null;
}

/** Efectivo que entró y salió en un día, y el último cierre de caja. */
function resumenCaja_(dia, movs) {
  const k = cajaDelDia_(dia, movs);
  const ultimo = ultimoCierre_();
  return { dia: dia, entradas: k.entradas, salidas: k.salidas, ultimo: ultimo, cerradoHoy: !!(ultimo && ultimo.fecha === dia) };
}

function getFinanzas(token, mes) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  if (!esAdmin_(u)) return fallo_('Tu usuario no puede ver las finanzas.');
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(mes || '')) return fallo_('El mes no es válido.');

  const cfg = leerConfig_();
  const hoy = hoyTxt_();
  const pedidos = leerPedidos_().filas.filter(p => p.estado !== 'Cancelado');
  pedidos.forEach(p => { p.diaVenta = diaDe_(p.registradoMs) || p.fecha; });
  const todos = leerMovs_().lista;
  const movs = todos.filter(x => !x.anulado);
  const actual = cuentasMes_(mes, pedidos, movs);
  const anterior = cuentasMes_(mesAnterior_(mes), pedidos, movs);
  const hace2 = cuentasMes_(mesAnterior_(mesAnterior_(mes)), pedidos, movs);
  const fijos = leerFijos_();

  return {
    ok: true,
    mes: mes,
    hoy: hoy,
    actual: actual,
    anterior: anterior,
    equilibrio: equilibrio_([actual, anterior, hace2], fijos, cfg.sueldo || 0, mes, hoy),
    fijos: fijos,
    porCategoria: gastosPorCategoria_(movs, mes),
    porCobrar: porCobrar_(pedidos),
    movimientos: todos.filter(x => x.fecha.slice(0, 7) === mes)
      .sort((a, b) => a.fecha < b.fecha ? 1 : (a.fecha > b.fecha ? -1 : b.fila - a.fila))
      .slice(0, MAX_MOVS_LISTA)
      .map(x => ({ id: x.id, fecha: x.fecha, tipo: x.tipo, clase: x.clase, categoria: x.categoria, descripcion: x.descripcion,
        valor: x.valor, metodo: x.metodo, pedido: x.pedido, registro: x.registro, anulado: x.anulado })),
    caja: resumenCaja_(hoy, movs),
    categorias: cfg.categorias,
    pagos: cfg.pagos.filter(x => x !== 'Ya pagado')
  };
}

/** Gasto, retiro o venta directa (ingreso sin pedido). */
function registrarMovimiento(token, d) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  if (!esAdmin_(u)) return fallo_('Tu usuario no puede registrar movimientos.');
  d = d || {};
  if (excedeLimite_(u.usuario, 'mov', LIMITE_ACCIONES_HORA)) return fallo_('Demasiados registros en poco tiempo. Espera un momento.');
  const error = validarMovimiento_(d, leerConfig_(), hoyTxt_());
  if (error) return fallo_(error);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    agregarMov_({
      tipo: d.tipo,
      clase: d.clase,
      categoria: d.tipo === 'Gasto' ? d.categoria : (d.tipo === 'Retiro' ? 'Retiro para mí' : (limpiar_(d.categoria) || 'Venta directa')),
      descripcion: d.descripcion,
      valor: Math.round(Number(d.valor)), metodo: d.metodo, fecha: d.fecha
    }, u);
    marcarCambio_();
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

/** Anula un movimiento (no se borra). Si era un abono de un pedido, se le resta al pedido. */
function anularMovimiento(token, id, motivo) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  if (!esAdmin_(u)) return fallo_('Tu usuario no puede anular movimientos.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const { tabla, lista } = leerMovs_();
    const x = lista.find(y => y.id === String(id));
    if (!x) return fallo_('No se encontró el movimiento.');
    if (x.anulado) return fallo_('Ese movimiento ya estaba anulado.');
    tabla.escribir(x.fila, {
      'Anulado': seguro_(u.nombre + ' · ' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm') +
        (limpiar_(motivo) ? ' · ' + limpiar_(motivo) : ''), 200)
    });
    if (x.tipo === 'Ingreso' && x.pedido) {
      const ped = leerPedidos_();
      const p = ped.filas.find(y => y.id === x.pedido);
      if (p && p.controlPago) escribir_(ped.hoja, ped.m, p.fila, { 'Abonado': Math.max(0, p.abonado - x.valor) });
    }
    marcarCambio_();
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

/** Guarda la lista de gastos fijos del mes y el sueldo que quiere ganarse la dueña. */
function guardarFijos(token, lista, sueldo) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  if (!esAdmin_(u)) return fallo_('Tu usuario no puede cambiar esto.');
  const r = validarFijos_(lista, sueldo);
  if (r.error) return fallo_(r.error);

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    tablaFijos_().reemplazar(r.fijos.map(x => ({ 'Concepto': seguro_(x.concepto, 60), 'Valor mensual': x.valor })));
    escribirConfig_('Sueldo que quiero ganarme', r.sueldo);
    marcarCambio_();
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

/** Cierre de caja del día: compara el efectivo que debería haber con el que se contó. */
function guardarCierre(token, base, contado, nota) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  if (!esAdmin_(u)) return fallo_('Tu usuario no puede cerrar la caja.');
  const b = Math.round(Number(base) || 0), c = Math.round(Number(contado));
  if (b < 0 || b > MAX_VALOR_PRODUCTO) return fallo_('La base de caja no es válida.');
  if (!(c >= 0) || c > MAX_VALOR_PRODUCTO) return fallo_('Escribe cuánto efectivo contaste.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let res;
  try {
    const hoy = hoyTxt_();
    const k = cajaDelDia_(hoy, leerMovs_().lista.filter(x => !x.anulado));
    const cuadre = cuadreCaja_(b, k.entradas, k.salidas, c);
    tablaCierres_().agregar({
      'Fecha': hoy, 'Base': b, 'Entradas en efectivo': k.entradas, 'Salidas en efectivo': k.salidas,
      'Esperado': cuadre.esperado, 'Contado': c, 'Diferencia': cuadre.diferencia, 'Nota': seguro_(nota, 200),
      'Registró': u.nombre, 'Registrado': new Date()
    });
    marcarCambio_();
    res = { ok: true, esperado: cuadre.esperado, contado: c, diferencia: cuadre.diferencia };
  } finally {
    lock.releaseLock();
  }
  return res;
}
