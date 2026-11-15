/* API de pedidos: tablero, turnos, guardar, editar y el flujo de estados (incluidos los abonos). */

/** Pedidos activos y los entregados en los últimos 7 días, con turnos, según el rol. */
function getTablero(token) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  return { ok: true, tablero: armarTablero_(u) };
}

/** Pedidos de una fecha (yyyy-MM-dd) para mostrar los turnos al tomar un pedido. */
function getDia(token, fecha) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  if (u.roles.indexOf('Vendedora') < 0) return fallo_('Tu usuario no puede hacer esto.');
  const lista = leerPedidos_().filas
    .filter(p => p.fecha === fecha && p.estado !== 'Cancelado')
    .sort(cmpCola_)
    .map(p => ({
      id: p.id, hora: p.hora, cliente: p.cliente, para: p.para,
      descripcion: p.descripcion, entrega: p.entrega, estado: p.estado
    }));
  return { ok: true, pedidos: lista };
}

function guardarPedido(token, p) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  if (u.roles.indexOf('Vendedora') < 0) return fallo_('Tu usuario no puede tomar pedidos.');
  const error = validar_(p);
  if (error) return fallo_(error);
  if (excedeLimite_(u.usuario, 'nuevo', LIMITE_PEDIDOS_HORA)) return fallo_('Registraste demasiados pedidos en poco tiempo. Espera un rato o avisa a la administradora.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let res;
  try {
    const { hoja, m } = abrirPedidos_();
    const sufijo = Math.random().toString(36).slice(2, 4).toUpperCase();
    const id = 'P-' + Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyMMdd-HHmmss') + '-' + sufijo;
    const datos = Object.assign(
      { 'ID': id, 'Registrado': new Date(), 'Vendedora': u.nombre, 'Estado': 'Pendiente' },
      camposPedido_(p));
    // "Ya pagado" sin abono escrito quiere decir que pagó todo.
    let abono = Math.round(Number(p.abono) || 0);
    if (!abono && p.pago === 'Ya pagado') abono = datos['Total'];
    datos['Abonado'] = abono;
    datos['Costo'] = esAdmin_(u) ? Math.round(Number(p.costo) || 0) : '';
    const fila = new Array(hoja.getLastColumn()).fill('');
    Object.keys(datos).forEach(k => { if (m[k]) fila[m[k] - 1] = datos[k]; });
    hoja.appendRow(fila);
    if (abono > 0) {
      agregarMov_({ tipo: 'Ingreso', categoria: abono >= datos['Total'] ? 'Pago de pedido' : 'Abono de pedido', valor: abono, metodo: p.pago, pedido: id, descripcion: limpiar_(p.cliente).slice(0, 80) }, u);
    }

    const turno = leerPedidos_().filas
      .filter(x => enCola_(x) && x.fecha === p.fecha && x.hora <= p.hora).length;
    res = { ok: true, id: id, total: datos['Total'], turno: turno };
    avisar_('nuevo', { id: id, fecha: p.fecha, hora: p.hora, descripcion: limpiar_(p.descripcion), entrega: p.entrega }, {});
    marcarCambio_();
  } finally {
    lock.releaseLock();
  }
  enviarAvisos_();
  if (res.ok) res.v = getCambio().v;
  return res;
}

/** Campos del formulario de pedido, tal como se guardan en la hoja. */
function camposPedido_(p) {
  const esDomicilio = p.entrega === 'Domicilio';
  const producto = Number(p.valorProducto) || 0;
  const domicilio = esDomicilio ? (Number(p.valorDomicilio) || 0) : 0;
  const conDedicatoria = p.dedicatoria === 'Sí';
  return {
    'Medio de venta': p.medio,
    'Cliente': seguro_(p.cliente, TOPES.cliente),
    'Para quién': seguro_(p.para, TOPES.para),
    'Descripción del arreglo': seguro_(p.descripcion, TOPES.descripcion),
    'Entrega': p.entrega,
    'Método de pago': p.pago,
    'Dirección': esDomicilio ? seguro_(p.direccion, TOPES.direccion) : '—',
    'Teléfono': seguro_(p.telefono, TOPES.telefono),
    'Fecha entrega': p.fecha,
    'Hora entrega': p.hora,
    'Valor producto': producto,
    'Valor domicilio': domicilio,
    'Total': producto + domicilio,
    'Dedicatoria': conDedicatoria ? 'Sí' : 'No',
    'Texto dedicatoria': conDedicatoria ? seguro_(p.textoDedicatoria, TOPES.dedicatoria) : ''
  };
}

/**
 * Edita un pedido. Solo se puede mientras está Pendiente: cuando el decorador lo empieza
 * ya no se edita, porque sería muy difícil revertir el trabajo hecho.
 */
function editarPedido(token, id, p) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  if (u.roles.indexOf('Vendedora') < 0) return fallo_('Tu usuario no puede editar pedidos.');
  p = p || {};
  if (excedeLimite_(u.usuario, 'edicion', LIMITE_EDICIONES_HORA)) return fallo_('Hiciste demasiadas ediciones en poco tiempo. Espera un rato.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let res;
  try {
    const { hoja, m, filas } = leerPedidos_();
    const actual = filas.find(x => x.id === String(id));
    if (!actual) {
      res = fallo_('No se encontró el pedido. Actualiza la lista.', true);
    } else if (actual.estado !== 'Pendiente') {
      res = fallo_(actual.estado === 'Cancelado'
        ? 'Este pedido fue cancelado.'
        : (actual.estado === 'Entregado'
          ? 'Este pedido ya fue entregado. No se puede editar.'
          : 'El decorador ya empezó este pedido. Ya no se puede editar.'), true);
    } else {
      const error = validar_(p, [actual.medio, actual.pago]);
      if (error) {
        res = fallo_(error);
      } else {
        const datos = camposPedido_(p);
        // El costo solo lo cambia quien administra; si edita una vendedora, se conserva el que había.
        if (esAdmin_(u) && p.costo != null) datos['Costo'] = Math.round(Number(p.costo) || 0);
        datos['Editado el'] = new Date();
        datos['Editó'] = u.nombre;
        escribir_(hoja, m, actual.fila, datos);
        res = { ok: true };
        avisar_('editado', { id: actual.id, fecha: p.fecha, hora: p.hora }, {});
        marcarCambio_();
      }
    }
  } finally {
    lock.releaseLock();
  }
  enviarAvisos_();
  if (res.ok) { res.v = getCambio().v; res.tablero = armarTablero_(u); }
  return res;
}

/**
 * Cambia el estado de un pedido. Acciones:
 *   empezar, terminar, soltar, deshacerListo  (Decorador)
 *   salir                                     (Entregador, domicilios)
 *   entregar                                  (Entregador en domicilios, Vendedora en pedidos del local)
 *   cancelar                                  (Vendedora mientras esté Pendiente; Administrador hasta antes de entregarse; pide motivo)
 * Una entrega confirmada no se deshace desde la app.
 */
function cambiarEstado(token, id, accion, datos) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  datos = datos || {};
  if (excedeLimite_(u.usuario, 'accion', LIMITE_ACCIONES_HORA)) return fallo_('Demasiadas acciones en poco tiempo. Espera un momento.');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let res;
  try {
    const { hoja, m, filas } = leerPedidos_();
    const p = filas.find(x => x.id === String(id));
    res = p ? aplicarAccion_(u, hoja, m, p, accion, datos)
            : fallo_('No se encontró el pedido. Actualiza la lista.', true);
    if (res.ok) { avisoAccion_(u, p, accion, datos); marcarCambio_(); }
  } finally {
    lock.releaseLock();
  }
  enviarAvisos_();
  if (res.ok) { res.v = getCambio().v; res.tablero = armarTablero_(u); }
  return res;
}

function aplicarAccion_(u, hoja, m, p, accion, datos) {
  const ahora = new Date();
  const tiene = r => u.roles.indexOf(r) >= 0;
  const sin = () => fallo_('Tu usuario no puede hacer esto.');
  const est = p.estado;
  if (est === 'Cancelado') return fallo_('Este pedido fue cancelado.', true);

  switch (accion) {
    case 'empezar':
      if (!tiene('Decorador')) return sin();
      if (est === 'En preparación') return fallo_('Ya lo está armando ' + (p.decorador || 'otra persona') + '.', true);
      if (est !== 'Pendiente') return fallo_('Este pedido ya no está pendiente.', true);
      escribir_(hoja, m, p.fila, { 'Estado': 'En preparación', 'Decorador': u.nombre, 'Inicio preparación': ahora });
      return { ok: true };

    case 'terminar':
      if (!tiene('Decorador')) return sin();
      if (est !== 'Pendiente' && est !== 'En preparación') return fallo_('Este pedido ya está listo o entregado.', true);
      escribir_(hoja, m, p.fila, { 'Estado': 'Listo', 'Listo el': ahora, 'Decorador': p.decorador || u.nombre });
      return { ok: true };

    case 'soltar':
      if (!tiene('Decorador')) return sin();
      if (est !== 'En preparación') return fallo_('Este pedido no está en preparación.', true);
      escribir_(hoja, m, p.fila, { 'Estado': 'Pendiente', 'Decorador': '', 'Inicio preparación': '' });
      return { ok: true };

    case 'deshacerListo':
      if (!tiene('Decorador')) return sin();
      if (est !== 'Listo') return fallo_('Este pedido ya salió a entrega o fue entregado. No se puede deshacer.', true);
      escribir_(hoja, m, p.fila, { 'Estado': 'En preparación', 'Listo el': '' });
      return { ok: true };

    case 'salir':
      if (!tiene('Entregador')) return sin();
      if (p.entrega !== 'Domicilio') return fallo_('Este pedido se entrega en el local.');
      if (est === 'En camino') return fallo_('Ya salió con ' + (p.entregador || 'otra persona') + '.', true);
      if (est === 'Entregado') return fallo_('Este pedido ya fue entregado.', true);
      if (est !== 'Listo') return fallo_('Todavía lo están armando.', true);
      escribir_(hoja, m, p.fila, { 'Estado': 'En camino', 'Entregó': u.nombre, 'Salió el': ahora });
      return { ok: true };

    case 'entregar': {
      const domicilio = p.entrega === 'Domicilio';
      if (!tiene(domicilio ? 'Entregador' : 'Vendedora')) return sin();
      if (est === 'Entregado') return fallo_('Este pedido ya fue entregado.', true);
      if (est !== 'Listo' && est !== 'En camino') return fallo_('Todavía lo están armando. No se puede entregar.', true);
      const hayFoto = !!(datos.foto && datos.foto.base64);
      if (domicilio && !hayFoto) return fallo_('Toma la foto de la entrega para poder confirmarla.');
      let url = '';
      if (hayFoto) {
        try { url = guardarEvidencia_(p.id, datos.foto); }
        catch (e) { return fallo_('No se pudo guardar la foto. Inténtalo de nuevo.'); }
      }
      escribir_(hoja, m, p.fila, {
        'Estado': 'Entregado',
        'Entregado el': ahora,
        'Entregó': p.entregador || u.nombre,
        'Recibió': seguro_(datos.recibio, TOPES.recibio),
        'Evidencia': url
      });
      // Al entregar se puede cobrar el saldo de una vez.
      const cobro = Math.round(Number(datos.cobro) || 0);
      if (cobro > 0 && p.controlPago && p.saldo > 0) {
        registrarAbono_(hoja, m, p, Math.min(cobro, p.saldo), datos.metodoCobro || p.pago, u);
      }
      return { ok: true };
    }

    case 'abonar': {
      if (!tiene('Vendedora') && !tiene('Entregador') && !tiene('Administrador')) return sin();
      const valor = Math.round(Number(datos.valor) || 0);
      if (!(valor > 0)) return fallo_('Escribe cuánto pagó el cliente.');
      const saldo = p.controlPago ? p.saldo : p.total;
      if (valor > saldo) return fallo_('El abono es mayor que lo que se debe (' + saldo.toLocaleString('es-CO') + ').', true);
      if (leerConfig_().pagos.indexOf(datos.metodo) < 0) return fallo_('Elige cómo pagó.');
      registrarAbono_(hoja, m, p, valor, datos.metodo, u);
      return { ok: true };
    }

    case 'cancelar': {
      const admin = tiene('Administrador');
      if (!tiene('Vendedora') && !admin) return sin();
      if (est === 'Entregado') return fallo_('Este pedido ya fue entregado. No se puede cancelar.', true);
      if (est !== 'Pendiente' && !admin) {
        return fallo_('El decorador ya empezó este pedido. Solo la administradora puede cancelarlo.', true);
      }
      const motivo = limpiar_(datos.motivo);
      if (motivo.length < 3) return fallo_('Escribe el motivo de la cancelación.');
      escribir_(hoja, m, p.fila, { 'Estado': 'Cancelado', 'Cancelación': seguro_(u.nombre + ': ' + motivo, TOPES.motivo + 40) });
      return { ok: true };
    }

    default:
      return fallo_('Acción desconocida.');
  }
}

/** Suma un pago al pedido y lo deja anotado en Movimientos. Se llama con el candado tomado. */
function registrarAbono_(hoja, m, p, valor, metodo, u) {
  const nuevo = (p.controlPago ? p.abonado : 0) + valor;
  escribir_(hoja, m, p.fila, { 'Abonado': nuevo });
  agregarMov_({
    tipo: 'Ingreso',
    categoria: nuevo >= p.total ? 'Pago de pedido' : 'Abono de pedido',
    valor: valor, metodo: metodo, pedido: p.id, descripcion: p.cliente
  }, u);
}

function armarTablero_(u) {
  const tz = Session.getScriptTimeZone();
  const hoy = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const limite = Utilities.formatDate(new Date(Date.now() - 7 * 86400000), tz, 'yyyy-MM-dd');
  const visibles = leerPedidos_().filas
    .filter(p => p.estado !== 'Cancelado' && (p.estado !== 'Entregado' || p.fecha >= limite))
    .sort(cmpCola_);
  asignarTurnos_(visibles);

  let campos = CAMPOS_BASE.slice();
  u.roles.forEach(r => { campos = campos.concat(CAMPOS_ROL[r] || []); });
  return {
    hoy: hoy,
    pedidos: visibles.map(p => {
      const o = {};
      campos.forEach(c => { o[c] = p[c]; });
      return o;
    })
  };
}

/** Revisa un pedido antes de guardarlo. Las reglas están en Calculos.gs (validarPedido_). */
function validar_(p, permitidos) {
  return validarPedido_(p, leerConfig_(), hoyTxt_(), permitidos);
}
