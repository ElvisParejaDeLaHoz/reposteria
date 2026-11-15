/* Panel de ventas y equipo (quien administra). */

function getAdmin(token, desde, hasta, base) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  if (u.roles.indexOf('Administrador') < 0) return fallo_('Tu usuario no puede ver esta sección.');
  const esFecha = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '');
  if (!esFecha(desde) || !esFecha(hasta) || desde > hasta) return fallo_('El rango de fechas no es válido.');
  if ((new Date(hasta) - new Date(desde)) / 86400000 > 366) return fallo_('Elige un periodo de máximo un año.');
  base = base === 'entrega' ? 'entrega' : 'venta';

  // "venta" cuenta por el día en que se registró el pedido; "entrega" por el día en que se entrega.
  const tz = Session.getScriptTimeZone();
  const enRango = leerPedidos_().filas.filter(p => {
    p.dia = base === 'entrega' ? p.fecha
      : (p.registradoMs ? Utilities.formatDate(new Date(p.registradoMs), tz, 'yyyy-MM-dd') : '');
    return p.dia >= desde && p.dia <= hasta;
  });
  const validos = enRango.filter(p => p.estado !== 'Cancelado');
  const cancelados = enRango.filter(p => p.estado === 'Cancelado');
  const suma = (lista, f) => lista.reduce((a, p) => a + f(p), 0);
  const entregados = validos.filter(p => p.estado === 'Entregado');
  const enCurso = validos.filter(p => p.estado !== 'Entregado');
  const ventas = suma(validos, p => p.total);

  const agrupar = (lista, clave) => {
    const m = {};
    lista.forEach(p => {
      const k = clave(p) || 'Sin dato';
      const o = m[k] = m[k] || { k: k, n: 0, total: 0 };
      o.n++;
      o.total += p.total;
    });
    return Object.keys(m).map(k => m[k]).sort((a, b) => b.total - a.total || b.n - a.n);
  };
  const minutos = (a, b) => (a && b && b > a) ? (b - a) / 60000 : null;
  const promedio = arr => arr.length ? Math.round(arr.reduce((x, y) => x + y, 0) / arr.length) : null;
  const equipo = (lista, nombre, dur) => {
    const m = {};
    lista.forEach(p => {
      const k = nombre(p);
      if (!k) return;
      const o = m[k] = m[k] || { nombre: k, n: 0, mins: [] };
      o.n++;
      const d = dur(p);
      if (d !== null) o.mins.push(d);
    });
    return Object.keys(m).map(k => ({ nombre: m[k].nombre, n: m[k].n, minProm: promedio(m[k].mins) }))
      .sort((a, b) => b.n - a.n);
  };

  const porVendedora = agrupar(validos, p => p.vendedora);
  porVendedora.forEach(v => { v.cancelados = cancelados.filter(p => (p.vendedora || 'Sin dato') === v.k).length; });

  return {
    ok: true,
    desde: desde,
    hasta: hasta,
    base: base,
    totales: {
      pedidos: validos.length,
      ventas: ventas,
      productos: suma(validos, p => p.valorProducto),
      domicilios: suma(validos, p => p.valorDomicilio),
      ticket: validos.length ? Math.round(ventas / validos.length) : 0,
      entregados: { n: entregados.length, total: suma(entregados, p => p.total) },
      enCurso: { n: enCurso.length, total: suma(enCurso, p => p.total) },
      cancelados: { n: cancelados.length, total: suma(cancelados, p => p.total) }
    },
    porPago: agrupar(validos, p => p.pago),
    porMedio: agrupar(validos, p => p.medio),
    porVendedora: porVendedora,
    porEntrega: agrupar(validos, p => p.entrega),
    porDia: agrupar(validos, p => p.dia).sort((a, b) => a.k < b.k ? -1 : 1),
    top: validos.slice().sort((a, b) => b.total - a.total).slice(0, 5)
      .map(p => ({ id: p.id, cliente: p.cliente, para: p.para, total: p.total, vendedora: p.vendedora, dia: p.dia })),
    equipo: {
      decoradores: equipo(validos.filter(p => p.listoMs), p => p.decorador, p => minutos(p.inicioPrepMs, p.listoMs)),
      entregadores: equipo(entregados.filter(p => p.entrega === 'Domicilio'), p => p.entregador, p => minutos(p.salioMs, p.entregadoMs))
    },
    pedidos: enRango.sort((a, b) => b.registradoMs - a.registradoMs).slice(0, MAX_DETALLE).map(proyectarAdmin_),
    recortado: enRango.length > MAX_DETALLE
  };
}

function proyectarAdmin_(p) {
  const o = {};
  ['id', 'fecha', 'hora', 'cliente', 'para', 'descripcion', 'entrega', 'pago', 'direccion', 'telefono',
    'valorProducto', 'valorDomicilio', 'total', 'dedicatoria', 'textoDedicatoria', 'estado', 'vendedora',
    'medio', 'decorador', 'entregador', 'recibio', 'cancelacion', 'editadoPor', 'conEvidencia',
    'abonado', 'saldo', 'controlPago', 'costo',
    'registradoMs', 'inicioPrepMs', 'listoMs', 'salioMs', 'entregadoMs', 'editadoMs']
    .forEach(k => { o[k] = p[k]; });
  return o;
}
