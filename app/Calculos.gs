/**
 * Funciones puras: no tocan hojas, Drive ni nada de Google.
 * Por eso se pueden probar en el computador con `npm test` antes de publicar a todos los negocios.
 */

/** Cuentas de un mes (yyyy-MM). Las ventas se cuentan el día en que se registró el pedido. */
function cuentasMes_(mes, pedidos, movs) {
  const enMes = s => !!s && s.slice(0, 7) === mes;
  const delMes = pedidos.filter(p => enMes(p.diaVenta));
  const mm = movs.filter(x => enMes(x.fecha));
  const suma = (l, f) => l.reduce((a, x) => a + f(x), 0);
  const directas = mm.filter(x => x.tipo === 'Ingreso' && !x.pedido);
  const gastos = mm.filter(x => x.tipo === 'Gasto');
  const c = {
    pedidos: delMes.length,
    ventasPedidos: suma(delMes, p => p.total),
    ventasDirectas: suma(directas, x => x.valor),
    costoPedidos: suma(delMes, p => p.costo),
    recibido: suma(mm.filter(x => x.tipo === 'Ingreso'), x => x.valor),
    gastosVariables: suma(gastos.filter(x => x.clase !== 'Fijo'), x => x.valor),
    gastosFijos: suma(gastos.filter(x => x.clase === 'Fijo'), x => x.valor),
    retiros: suma(mm.filter(x => x.tipo === 'Retiro'), x => x.valor)
  };
  c.ventas = c.ventasPedidos + c.ventasDirectas;
  c.costosVariables = c.costoPedidos + c.gastosVariables;
  c.ganancia = c.ventas - c.costosVariables - c.gastosFijos;
  c.flujo = c.recibido - c.gastosVariables - c.gastosFijos - c.retiros;
  c.conCosto = delMes.filter(p => p.costo > 0).length;
  return c;
}

function mesAnterior_(mes) {
  const p = mes.split('-').map(Number);
  const d = new Date(p[0], p[1] - 2, 1);
  return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2);
}

/** Comprueba los primeros bytes del archivo: que diga ser JPG no basta, tiene que serlo. */
function firmaImagen_(bytes, mime) {
  const b = i => (bytes[i] || 0) & 255;
  if (mime === 'image/jpeg') return b(0) === 0xFF && b(1) === 0xD8 && b(2) === 0xFF;
  if (mime === 'image/png') return b(0) === 0x89 && b(1) === 0x50 && b(2) === 0x4E && b(3) === 0x47;
  if (mime === 'image/webp') return b(0) === 0x52 && b(1) === 0x49 && b(2) === 0x46 && b(3) === 0x46 && b(8) === 0x57 && b(9) === 0x45 && b(10) === 0x42 && b(11) === 0x50;
  return false;
}

/** Turno = posición en la cola del día, por hora de entrega y luego por orden de llegada. */
function asignarTurnos_(lista) {
  const cola = lista.filter(enCola_).sort(cmpCola_);
  const totales = {};
  cola.forEach(p => { totales[p.fecha] = (totales[p.fecha] || 0) + 1; });
  const contador = {};
  cola.forEach((p, i) => {
    contador[p.fecha] = (contador[p.fecha] || 0) + 1;
    p.orden = i + 1;
    p.turno = contador[p.fecha];
    p.turnosDia = totales[p.fecha];
  });
  lista.forEach(p => { if (!enCola_(p)) { p.orden = 0; p.turno = 0; p.turnosDia = 0; } });
}

function enCola_(p) { return p.estado === 'Pendiente' || p.estado === 'En preparación'; }

function cmpCola_(a, b) {
  if (a.fecha !== b.fecha) return a.fecha < b.fecha ? -1 : 1;
  if (a.hora !== b.hora) return a.hora < b.hora ? -1 : 1;
  return a.registradoMs - b.registradoMs;
}

function fallo_(error, actualizar) {
  return { ok: false, error: error, actualizar: !!actualizar };
}

function limpiar_(v) { return String(v == null ? '' : v).trim(); }

/**
 * Texto que escribe una persona, listo para guardar en la hoja: sin espacios sobrantes, con tope de largo
 * y sin que pueda convertirse en una fórmula (en Sheets, un texto que empieza con = + - @ se ejecuta).
 * El apóstrofo inicial le dice a Sheets "esto es texto"; al leerlo no aparece.
 */
function seguro_(v, max) {
  let t = limpiar_(v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  if (max) t = t.slice(0, max);
  return /^[=+\-@\t\r]/.test(t) ? "'" + t : t;
}

function norm_(v) { return limpiar_(v).toLowerCase(); }

function normEstado_(v) {
  const s = limpiar_(v);
  if (s === 'Realizado') return 'Listo';
  return ESTADOS.indexOf(s) >= 0 ? s : 'Pendiente';
}

function letra_(n) {
  let s = '';
  while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
  return s;
}

/**
 * Reglas de un pedido. Devuelve el primer error en palabras sencillas, o null si está bien.
 * `permitidos`: medio y pago viejos que se aceptan al editar aunque ya no estén en la lista.
 */
function validarPedido_(p, cfg, hoyTxt, permitidos) {
  if (!p) return 'Datos vacíos.';
  const ok = (lista, v) => lista.indexOf(v) >= 0 || (permitidos || []).indexOf(v) >= 0;
  if (!ok(cfg.medios, p.medio)) return 'Elige por qué medio llegó el pedido.';
  if (!limpiar_(p.cliente)) return 'Falta el nombre del cliente.';
  if (limpiar_(p.cliente).length > TOPES.cliente || limpiar_(p.para).length > TOPES.para) return 'Los nombres son demasiado largos.';
  if (!limpiar_(p.para)) return 'Falta para quién va dirigido.';
  if (limpiar_(p.descripcion).length < cfg.minDesc) return 'Describe el pedido con más detalle (mínimo ' + cfg.minDesc + ' caracteres).';
  if (limpiar_(p.descripcion).length > TOPES.descripcion) return 'La descripción es demasiado larga (máximo ' + TOPES.descripcion + ' caracteres).';
  if (['Domicilio', 'Local'].indexOf(p.entrega) < 0) return 'Elige el método de entrega.';
  if (!ok(cfg.pagos, p.pago)) return 'Elige el método de pago.';
  if (p.entrega === 'Domicilio' && !limpiar_(p.direccion)) return 'Falta la dirección de entrega.';
  if (limpiar_(p.direccion).length > TOPES.direccion) return 'La dirección es demasiado larga.';
  const tel = limpiar_(p.telefono);
  const digitosTel = tel.replace(/\D/g, '');
  if (p.entrega === 'Domicilio' && !tel) return 'Falta el teléfono de quien recibe.';
  if (tel && (digitosTel.length < 7 || digitosTel.length > 15)) return 'El teléfono no es válido.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(p.fecha || '') || isNaN(new Date(p.fecha + 'T12:00:00Z').getTime())) return 'Fecha inválida.';
  const dias = (new Date(p.fecha + 'T12:00:00Z').getTime() - new Date(hoyTxt + 'T12:00:00Z').getTime()) / 86400000;
  if (dias < -DIAS_ATRAS || dias > DIAS_ADELANTE) return 'La fecha de entrega no es razonable. Revísala.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(p.hora || '')) return 'Hora inválida.';
  const vp = Number(p.valorProducto), vd = Number(p.valorDomicilio) || 0;
  if (!(vp > 0) || !isFinite(vp)) return 'Falta el valor del producto.';
  if (vp > MAX_VALOR_PRODUCTO) return 'El valor del producto es demasiado alto. Revísalo.';
  if (p.entrega === 'Domicilio' && (!(vd >= 0) || !isFinite(vd))) return 'Valor de domicilio inválido.';
  if (p.entrega === 'Domicilio' && vd > MAX_VALOR_DOMICILIO) return 'El valor del domicilio es demasiado alto. Revísalo.';
  if (['Sí', 'No'].indexOf(p.dedicatoria) < 0) return 'Indica si lleva dedicatoria.';
  if (p.dedicatoria === 'Sí' && !limpiar_(p.textoDedicatoria)) return 'Escribe el texto de la dedicatoria.';
  if (limpiar_(p.textoDedicatoria).length > TOPES.dedicatoria) return 'La dedicatoria es demasiado larga (máximo ' + TOPES.dedicatoria + ' caracteres).';
  const ab = Number(p.abono) || 0, co = Number(p.costo) || 0;
  if (ab < 0 || !isFinite(ab)) return 'El abono no es válido.';
  if (ab > vp + (p.entrega === 'Domicilio' ? vd : 0)) return 'El abono no puede ser mayor que el total del pedido.';
  if (co < 0 || !isFinite(co) || co > MAX_VALOR_PRODUCTO) return 'El costo no es válido.';
  return null;
}

/**
 * Punto de equilibrio. `meses`: cuentas del mes actual y de los 2 anteriores (de cuentasMes_).
 * Margen de contribución = de cada $100 vendidos, cuánto queda después de los costos variables.
 * Se mide con 3 meses para que un mes raro no lo distorsione.
 * Gastos fijos: los de la lista "Gastos fijos"; si está vacía, los fijos registrados en el mes.
 */
function equilibrio_(meses, fijos, sueldo, mes, hoy) {
  const v3 = meses.reduce((a, c) => a + c.ventas, 0);
  const cv3 = meses.reduce((a, c) => a + c.costosVariables, 0);
  const margen = v3 > 0 ? (v3 - cv3) / v3 : null;
  const fijosPresupuesto = fijos.reduce((a, x) => a + x.valor, 0);
  const fijosBase = fijosPresupuesto || meses[0].gastosFijos;
  sueldo = sueldo || 0;
  const pe = (margen && margen > 0 && fijosBase > 0) ? Math.round(fijosBase / margen) : null;
  const meta = (margen && margen > 0 && (fijosBase + sueldo) > 0) ? Math.round((fijosBase + sueldo) / margen) : null;
  const p = mes.split('-').map(Number);
  const diasMes = new Date(p[0], p[1], 0).getDate();
  const esActual = hoy.slice(0, 7) === mes;
  return {
    margen: margen, fijos: fijosBase, fijosPresupuesto: fijosPresupuesto, sueldo: sueldo, pe: pe, meta: meta,
    diasRestantes: esActual ? diasMes - Number(hoy.slice(8, 10)) + 1 : 0, esActual: esActual
  };
}

/** Gastos del mes agrupados por categoría, de mayor a menor. */
function gastosPorCategoria_(movs, mes) {
  const grupos = {};
  movs.filter(x => x.tipo === 'Gasto' && x.fecha.slice(0, 7) === mes).forEach(x => {
    const k = x.categoria || 'Sin categoría';
    const o = grupos[k] = grupos[k] || { k: k, n: 0, total: 0 };
    o.n++; o.total += x.valor;
  });
  return Object.keys(grupos).map(k => grupos[k]).sort((a, b) => b.total - a.total);
}

/** Pedidos con saldo pendiente, los más viejos primero. */
function porCobrar_(pedidos) {
  return pedidos.filter(x => x.estado !== 'Cancelado' && x.controlPago && x.saldo > 0)
    .sort((a, b) => a.fecha < b.fecha ? -1 : (a.fecha > b.fecha ? 1 : 0))
    .map(x => ({ id: x.id, cliente: x.cliente, para: x.para, fecha: x.fecha, hora: x.hora, total: x.total, abonado: x.abonado,
      saldo: x.saldo, estado: x.estado, telefono: x.telefono, pago: x.pago }));
}

function esEfectivo_(metodo) { return /efectivo/i.test(metodo || ''); }

/** Efectivo que entró (ingresos) y salió (gastos y retiros) en un día. */
function cajaDelDia_(dia, movs) {
  const delDia = movs.filter(x => x.fecha === dia && esEfectivo_(x.metodo));
  return {
    entradas: delDia.filter(x => x.tipo === 'Ingreso').reduce((a, x) => a + x.valor, 0),
    salidas: delDia.filter(x => x.tipo !== 'Ingreso').reduce((a, x) => a + x.valor, 0)
  };
}

/** Lo que debería haber en caja y la diferencia con lo contado (positiva = sobra). */
function cuadreCaja_(base, entradas, salidas, contado) {
  const esperado = base + entradas - salidas;
  return { esperado: esperado, diferencia: contado - esperado };
}

/** Reglas de un gasto, retiro o venta sin pedido. Devuelve el error o null. */
function validarMovimiento_(d, cfg, hoyTxt) {
  if (TIPOS_MOV.indexOf(d.tipo) < 0) return 'Elige si es un gasto, un retiro o una venta.';
  const valor = Math.round(Number(d.valor) || 0);
  if (!(valor > 0) || valor > MAX_VALOR_PRODUCTO) return 'Escribe un valor válido.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.fecha || '')) return 'Elige la fecha.';
  const dias = (new Date(d.fecha + 'T12:00:00Z') - new Date(hoyTxt + 'T12:00:00Z')) / 86400000;
  if (isNaN(dias) || dias > 1 || dias < -400) return 'La fecha no es razonable. Revísala.';
  if (cfg.pagos.indexOf(d.metodo) < 0) return 'Elige con qué se pagó.';
  if (d.tipo === 'Gasto' && !limpiar_(d.categoria)) return 'Elige la categoría del gasto.';
  if (limpiar_(d.descripcion).length > 200) return 'La descripción es demasiado larga.';
  return null;
}

/** Revisa la lista de gastos fijos y el sueldo. Devuelve { error } o { fijos, sueldo } limpios. */
function validarFijos_(lista, sueldo) {
  if (!Array.isArray(lista) || lista.length > 40) return { error: 'La lista de gastos fijos no es válida (máximo 40).' };
  const fijos = [];
  for (let i = 0; i < lista.length; i++) {
    const c = limpiar_(lista[i] && lista[i].concepto).slice(0, 60);
    const v = Math.round(Number(lista[i] && lista[i].valor) || 0);
    if (!c && !v) continue;
    if (!c) return { error: 'A un gasto fijo le falta el nombre.' };
    if (!(v > 0) || v > MAX_VALOR_PRODUCTO) return { error: 'El valor de "' + c + '" no es válido.' };
    fijos.push({ concepto: c, valor: v });
  }
  const s = Math.round(Number(sueldo) || 0);
  if (s < 0 || s > MAX_VALOR_PRODUCTO) return { error: 'El sueldo no es válido.' };
  return { fijos: fijos, sueldo: s };
}

/* ---------- Activación, equipo y datos del negocio ---------- */

/** Convierte bytes al azar en un código como "K7QM-3XPA" (8 letras de ALFABETO_CODIGO). */
function codigoDesdeBytes_(bytes) {
  let s = '';
  for (let i = 0; i < 8; i++) s += ALFABETO_CODIGO.charAt(((bytes[i] || 0) & 255) % ALFABETO_CODIGO.length);
  return s.slice(0, 4) + '-' + s.slice(4);
}

/** Como lo escriba la persona (minúsculas, sin guion, con espacios) → la forma guardada, o '' si no sirve. */
function normCodigo_(v) {
  const s = String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return s.length === 8 ? s.slice(0, 4) + '-' + s.slice(4) : '';
}

/**
 * Crear o cambiar una persona del equipo.
 * `lista` son los usuarios que ya existen ({usuario, roles, activo}); `yo` es quien hace el cambio.
 * Reglas: nadie se quita a sí mismo el acceso de administradora y siempre queda al menos una activa.
 */
/** Fecha como se ve en la hoja → 'yyyy-MM-dd'. Acepta "2026-11-15", "15/11/2026" y "'2026-11-15". */
function fechaDeTexto_(v) {
  const t = limpiar_(v).replace(/^'/, '');
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return m[1] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[3]).slice(-2);
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(t);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  return t;
}

/** Hora como se ve en la hoja → 'HH:mm'. Acepta "16:55", "16:55:00", "4:55 p. m.", "4:55 PM" y "'16:55". */
function horaDeTexto_(v) {
  const t = limpiar_(v).replace(/^'/, '').toLowerCase();
  const m = /^(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?\s*m?\.?/.exec(t);
  if (!m) return t;
  let h = Number(m[1]);
  if (m[3] === 'p' && h < 12) h += 12;
  if (m[3] === 'a' && h === 12) h = 0;
  return ('0' + h).slice(-2) + ':' + m[2];
}

/** Fecha y hora como se ven en la hoja ("15/11/2026 13:35:20" o "15/11/2026 13:36") → 'yyyy-MM-dd HH:mm:ss', o '' si no se entiende. */
function textoFechaHora_(v) {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(limpiar_(v));
  if (!m) return '';
  const d = x => ('0' + x).slice(-2);
  return m[3] + '-' + d(m[2]) + '-' + d(m[1]) + ' ' + d(m[4]) + ':' + m[5] + ':' + (m[6] || '00');
}

/** "Mujer", "m", "hombre", "H"… → 'Mujer' | 'Hombre' | '' (sin indicar). */
function sexoDe_(v) {
  const t = norm_(v);
  if (/^(mujer|f|fem)/.test(t)) return 'Mujer';
  if (/^(hombre|h|m$|masc|var)/.test(t)) return 'Hombre';
  return '';
}

/** La primera palabra de un cargo en masculino y en femenino: Vendedora → Vendedor/Vendedora, Cocinero → Cocinero/Cocinera. */
function formasCargo_(etiqueta) {
  const txt = limpiar_(String(etiqueta || '').split(',')[0]).replace(/\s*\((f|m)\)\s*$/i, '');
  const i = txt.search(/\s/);
  const pal = i < 0 ? txt : txt.slice(0, i), resto = i < 0 ? '' : txt.slice(i);
  let m = pal;
  if (/ora$/i.test(pal)) m = pal.slice(0, -1);
  else if (/ona$/i.test(pal)) m = pal.slice(0, -3) + 'ón';
  else if (/ista$/i.test(pal)) m = pal;
  else if (/a$/i.test(pal) && pal.length > 3) m = pal.slice(0, -1) + 'o';
  let f = m;
  if (/or$/i.test(m)) f = m + 'a';
  else if (/ón$/i.test(m)) f = m.slice(0, -2) + 'ona';
  else if (/o$/i.test(m)) f = m.slice(0, -1) + 'a';
  return { m: m + resto, f: f + resto };
}

/** Cargo de cada rol según el sexo, con los nombres que el negocio les puso. */
function cargosRoles_(T) {
  const out = {};
  [['Vendedora', T.vende], ['Decorador', T.prepara], ['Entregador', T.entrega], ['Administrador', T.admin]]
    .forEach(par => { out[par[0]] = formasCargo_(par[1] || par[0]); });
  return out;
}

function validarUsuario_(d, lista, yo) {
  d = d || {};
  const nuevo = !!d.nuevo;
  const usuario = norm_(d.usuario);
  const existe = lista.find(x => x.usuario === usuario);
  if (nuevo) {
    if (!/^[a-z0-9._-]{3,30}$/.test(usuario)) return { error: 'El usuario debe tener de 3 a 30 letras o números, sin espacios ni tildes.' };
    if (existe) return { error: 'Ya existe una persona con el usuario "' + usuario + '". Elige otro.' };
  } else if (!existe) {
    return { error: 'Esa persona ya no está en la lista. Actualiza la pantalla.' };
  }
  const nombre = limpiar_(d.nombre).slice(0, 60);
  if (nombre.length < 2) return { error: 'Escribe el nombre de la persona.' };
  const roles = ROLES_APP.filter(r => Array.isArray(d.roles) && d.roles.indexOf(r) >= 0);
  if (!roles.length) return { error: 'Elige al menos una tarea para la persona.' };
  const clave = String(d.clave == null ? '' : d.clave);
  if ((nuevo || clave) && (clave.length < MIN_CLAVE || clave.length > 64)) return { error: 'La clave debe tener al menos ' + MIN_CLAVE + ' caracteres.' };
  const activo = nuevo ? true : d.activo !== false;
  // El sexo se pide al crear; al editar, si no viene, se deja el que tenía.
  let sexo = sexoDe_(d.sexo);
  if (!sexo && !nuevo) sexo = existe.sexo || '';
  if (!sexo) return { error: 'Indica si es mujer u hombre: así la app escribe bien su cargo.' };

  if (yo && usuario === yo) {
    if (!activo) return { error: 'No puedes quitarte la entrada a la app.' };
    if (roles.indexOf('Administrador') < 0) return { error: 'No puedes quitarte el acceso de administración.' };
  }
  const admins = lista.filter(x => x.usuario !== usuario && x.activo && x.roles.indexOf('Administrador') >= 0).length +
    (activo && roles.indexOf('Administrador') >= 0 ? 1 : 0);
  if (!admins) return { error: 'Debe quedar al menos una persona activa que administre el negocio.' };

  return { usuario: usuario, nombre: nombre, roles: roles, clave: clave, activo: activo, nuevo: nuevo, sexo: sexo };
}

/**
 * Datos del negocio que se cambian desde la app. Solo se revisan (y se devuelven) los que vengan.
 * Los textos de listas aceptan comas o una lista; quedan como "a, b, c" para la hoja Configuración.
 */
function validarNegocio_(d) {
  d = d || {};
  const out = {};
  const hay = k => d[k] !== undefined && d[k] !== null;
  if (hay('nombre')) {
    out.nombre = limpiar_(d.nombre).slice(0, 60);
    if (out.nombre.length < 2) return { error: 'Escribe el nombre de tu negocio.' };
  }
  if (hay('lema')) out.lema = limpiar_(d.lema).slice(0, 120);
  if (hay('producto')) {
    out.producto = limpiar_(d.producto).slice(0, 40);
    if (out.producto.length < 2) return { error: 'Escribe qué vendes (por ejemplo: torta, ramo, almuerzo).' };
  }
  const colores = { principal: 'principal', secundario: 'secundario' };
  for (const k in colores) {
    if (!hay(k)) continue;
    out[k] = color_(d[k], '');
    if (!out[k]) return { error: 'El color ' + colores[k] + ' no es válido.' };
  }
  const listas = { medios: 'un medio de venta', pagos: 'un método de pago', categorias: 'una categoría de gastos' };
  for (const k in listas) {
    if (!hay(k)) continue;
    const l = lista_(Array.isArray(d[k]) ? d[k].join(',') : d[k], []);
    if (!l.length) return { error: 'Escribe al menos ' + listas[k] + '.' };
    out[k] = l.join(', ');
  }
  if (hay('whatsapp')) {
    out.whatsapp = String(d.whatsapp).replace(/\D/g, '');
    if (out.whatsapp && !/^\d{7,15}$/.test(out.whatsapp)) return { error: 'El WhatsApp del negocio debe tener de 7 a 15 números.' };
  }
  if (hay('minDesc')) {
    out.minDesc = Math.round(Number(d.minDesc));
    if (!(out.minDesc >= 1 && out.minDesc <= 200)) return { error: 'El mínimo de letras debe estar entre 1 y 200.' };
  }
  return out;
}

/** Todo lo que llena la dueña en la pantalla de bienvenida. `lista` son los usuarios que ya hay en la hoja. */
function validarActivacion_(d, lista) {
  d = d || {};
  const negocio = validarNegocio_({ nombre: d.negocio == null ? '' : d.negocio, producto: d.producto == null ? '' : d.producto, principal: d.principal == null ? '' : d.principal });
  if (negocio.error) return negocio;
  const admin = validarUsuario_({
    nuevo: true, usuario: d.usuario, nombre: d.nombre, clave: d.clave, sexo: d.sexo,
    roles: d.todoYo ? ROLES_APP.slice() : ['Administrador']
  }, lista, '');
  if (admin.error) return admin;
  const numeros = validarFijos_(d.fijos || [], d.sueldo || 0);
  if (numeros.error) return numeros;
  return { negocio: negocio, admin: admin, fijos: numeros.fijos, sueldo: numeros.sueldo };
}

/* ---------- Seguimiento del pedido para el cliente ---------- */

const ALFABETO_SEGUIMIENTO = 'abcdefghjkmnpqrstuvwxyz23456789';

/** Código del enlace de seguimiento: 12 letras al azar (no se puede adivinar el de otro pedido). */
function codigoSeguimientoDesdeBytes_(bytes) {
  let s = '';
  for (let i = 0; i < 12; i++) s += ALFABETO_SEGUIMIENTO.charAt(((bytes[i] || 0) & 255) % ALFABETO_SEGUIMIENTO.length);
  return s;
}

function esCodigoSeguimiento_(c) { return typeof c === 'string' && /^[a-z2-9]{12}$/.test(c); }

/** "torta (f)" → {singular:'torta', plural:'tortas', femenino:true}; "pan, panes" → plural irregular. */
function terminoProducto_(t) {
  let txt = limpiar_(t) || 'pedido';
  const marca = /\((f|m)\)\s*$/i.exec(txt);
  txt = txt.replace(/\((f|m)\)\s*$/i, '').trim();
  // Sin marca se adivina igual que en la app (JsTema → leerTermino): "torta" es femenino, "postre" no.
  const femenino = marca ? marca[1].toLowerCase() === 'f' : /(a|ción|sión|dad|tad|tud|umbre)$/i.test((txt.split(',')[0] || '').trim().split(/\s+/)[0]);
  const partes = txt.split(',').map(x => x.trim()).filter(Boolean);
  const singular = (partes[0] || 'pedido').toLowerCase();
  const plural = (partes[1] || (/[aeiou]$/i.test(singular) ? singular + 's' : singular + 'es')).toLowerCase();
  return { singular: singular, plural: plural, femenino: femenino };
}

/** El enlace deja de funcionar DIAS_SEGUIMIENTO días después de entregado o cancelado. */
function seguimientoVencido_(p, ahoraMs) {
  if (p.estado !== 'Entregado' && p.estado !== 'Cancelado') return false;
  const fin = p.entregadoMs || p.editadoMs || p.registradoMs || 0;
  return !!fin && ahoraMs - fin > DIAS_SEGUIMIENTO * 86400000;
}

/**
 * Lo único que ve el cliente en la página de seguimiento. Lista cerrada a propósito:
 * nada de teléfonos, direcciones, valores, descripción, nombres del equipo ni notas internas.
 */
function vistaPublica_(p, cfg, calif) {
  const estado = p.estado;
  return {
    negocio: {
      nombre: cfg.nombre, principal: cfg.principal, secundario: cfg.secundario,
      whatsapp: cfg.whatsapp || '', producto: terminoProducto_(cfg.terminos && cfg.terminos.producto)
    },
    pedido: {
      ref: String(p.id).slice(-6),
      estado: estado,
      fecha: p.fecha,
      hora: p.hora,
      entrega: p.entrega === 'Domicilio' ? 'Domicilio' : 'Local',
      pasos: {
        recibido: p.registradoMs || 0,
        preparando: estado === 'Cancelado' ? 0 : (p.inicioPrepMs || 0),
        listo: estado === 'Cancelado' ? 0 : (p.listoMs || 0),
        camino: estado === 'Cancelado' ? 0 : (p.salioMs || 0),
        entregado: p.entregadoMs || 0
      },
      conFoto: estado === 'Entregado' && !!p.conEvidencia
    },
    calificacion: calif ? { estrellas: calif.estrellas, comentario: calif.comentario } : null
  };
}

function validarCalificacion_(estrellas, comentario) {
  const e = Math.round(Number(estrellas));
  if (!(e >= 1 && e <= 5)) return { error: 'Elige de 1 a 5 estrellas.' };
  return { estrellas: e, comentario: limpiar_(comentario).replace(/\s+/g, ' ').slice(0, 300) };
}

/** Para la administradora: promedio, cuántas de cada estrella y los últimos comentarios. */
function resumirCalificaciones_(lista) {
  const total = lista.length;
  const dist = [0, 0, 0, 0, 0];
  let suma = 0;
  lista.forEach(c => { suma += c.estrellas; dist[c.estrellas - 1]++; });
  return {
    total: total,
    promedio: total ? Math.round(suma / total * 10) / 10 : 0,
    distribucion: dist.reverse(), // [5★, 4★, 3★, 2★, 1★]
    ultimas: lista.slice().sort((a, b) => b.registradoMs - a.registradoMs).slice(0, 8)
  };
}
