/* Libro de datos, hojas de Pedidos y Usuarios, y utilidades de fechas. */

function esAdmin_(u) { return u.roles.indexOf('Administrador') >= 0; }

function hoyTxt_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }

function diaDe_(ms) { return ms ? Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'yyyy-MM-dd') : ''; }


function mapa_(hoja) {
  const n = hoja.getLastColumn();
  const m = {};
  if (n < 1) return m;
  hoja.getRange(1, 1, 1, n).getValues()[0].forEach((h, i) => {
    const k = limpiar_(h);
    if (k && !(k in m)) m[k] = i + 1;
  });
  return m;
}

function escribir_(hoja, m, fila, datos) {
  Object.keys(datos).forEach(k => { if (m[k]) hoja.getRange(fila, m[k]).setValue(datos[k]); });
}

/* Zona horaria del libro. Una fecha u hora escrita en una celda (sin instante real) se lee en la zona
   del libro, no en la del proyecto: si son distintas, leerla con la del proyecto la corre varias horas. */
let ZONA_LIBRO_ = '';
function zonaLibro_() {
  if (!ZONA_LIBRO_) {
    try { ZONA_LIBRO_ = obtenerLibro_().getSpreadsheetTimeZone(); } catch (e) { ZONA_LIBRO_ = ''; }
    ZONA_LIBRO_ = ZONA_LIBRO_ || Session.getScriptTimeZone();
  }
  return ZONA_LIBRO_;
}

function aTextoFecha_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, zonaLibro_(), 'yyyy-MM-dd');
  return limpiar_(v).replace(/^'/, '');
}

function aTextoHora_(v) {
  if (v instanceof Date) return Utilities.formatDate(v, zonaLibro_(), 'HH:mm');
  return limpiar_(v).replace(/^'/, '');
}

function ms_(v) { return v instanceof Date ? v.getTime() : 0; }

/**
 * Momento guardado en la hoja (Registrado, Listo el…), leído desde lo que la hoja muestra y su zona horaria.
 * El valor que entrega getValues() salió corrido 8 horas en un libro creado por la flota (zona del Pacífico),
 * así que solo se usa si la celda no tiene el formato de siempre (dd/mm/aaaa hh:mm).
 */
function instante_(valor, texto) {
  if (valor === '' || valor == null) return 0;
  const t = textoFechaHora_(texto);
  if (t) { try { return Utilities.parseDate(t, zonaLibro_(), 'yyyy-MM-dd HH:mm:ss').getTime(); } catch (e) { /* abajo */ } }
  return ms_(valor);
}

function hmDe_(ms) { return ms ? Utilities.formatDate(new Date(ms), Session.getScriptTimeZone(), 'HH:mm') : ''; }


/**
 * El libro de datos. Si el proyecto está pegado a una hoja (así lo instala la herramienta
 * de la flota), se usa esa hoja; si es un proyecto suelto, se crea un libro nuevo.
 */
function obtenerLibro_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(PROP_LIBRO);
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* se busca o se recrea abajo */ } }
  let ss = null;
  try { ss = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { ss = null; }
  if (!ss) ss = SpreadsheetApp.create(NOMBRE_LIBRO);
  props.setProperty(PROP_LIBRO, ss.getId());
  prepararPedidos_(ss);
  prepararUsuarios_(ss);
  if (!ss.getSheetByName(HOJA_STATS)) prepararEstadisticas_(ss);
  if (!ss.getSheetByName(HOJA_CONTA)) prepararContabilidad_(ss);
  if (!ss.getSheetByName(HOJA_CONFIG)) prepararConfig_(ss);
  return ss;
}

/** Nombre del libro, para que las carpetas de Drive de cada negocio no se confundan entre sí. */
function nombreLibro_() {
  try { return obtenerLibro_().getName(); } catch (e) { return NOMBRE_LIBRO; }
}

function abrirPedidos_() {
  const ss = obtenerLibro_();
  let hoja = ss.getSheetByName(HOJA_PEDIDOS);
  if (!hoja) hoja = prepararPedidos_(ss);
  let m = mapa_(hoja);
  if (COLUMNAS.some(c => !m[c])) { prepararPedidos_(ss); m = mapa_(hoja); }
  return { ss: ss, hoja: hoja, m: m };
}

function abrirUsuarios_() {
  const ss = obtenerLibro_();
  const hoja = ss.getSheetByName(HOJA_USUARIOS) || prepararUsuarios_(ss);
  return { ss: ss, hoja: hoja, m: mapa_(hoja) };
}

function leerPedidos_() {
  const { hoja, m } = abrirPedidos_();
  const n = hoja.getLastRow() - 1;
  const filas = [];
  if (n >= 1) {
    const vals = hoja.getRange(2, 1, n, hoja.getLastColumn()).getValues();
    const g = (f, k) => f[m[k] - 1];
    // Fechas y horas: se lee también el texto tal como se ve en la hoja. Leer el valor de Sheets dependía de zonas
    // horarias y se corría (4:55 p. m. salía 11:58 a. m. del día anterior; 4:35 p. m. salía 8:35 a. m.).
    const ver = hoja.getRange(2, 1, n, hoja.getLastColumn()).getDisplayValues();
    vals.forEach((f, i) => {
      if (!g(f, 'ID')) return;
      const v = k => ver[i][m[k] - 1];
      const t = k => instante_(g(f, k), v(k));
      const prep = t('Inicio preparación'), listo = t('Listo el'), salio = t('Salió el'), entregado = t('Entregado el');
      const total = Number(g(f, 'Total')) || 0;
      // Los pedidos de antes de llevar abonos tienen la celda vacía: no se les cobra saldo.
      const ab = g(f, 'Abonado');
      const controlPago = ab !== '' && ab != null;
      const abonado = controlPago ? (Number(ab) || 0) : 0;
      filas.push({
        abonado: abonado,
        controlPago: controlPago,
        saldo: controlPago ? Math.max(0, total - abonado) : 0,
        costo: Number(g(f, 'Costo')) || 0,
        fila: i + 2,
        id: String(g(f, 'ID')),
        registradoMs: t('Registrado'),
        vendedora: limpiar_(g(f, 'Vendedora')),
        medio: limpiar_(g(f, 'Medio de venta')),
        cliente: limpiar_(g(f, 'Cliente')),
        para: limpiar_(g(f, 'Para quién')),
        descripcion: limpiar_(g(f, 'Descripción del pedido')),
        entrega: limpiar_(g(f, 'Entrega')),
        pago: limpiar_(g(f, 'Método de pago')),
        direccion: limpiar_(g(f, 'Dirección')),
        telefono: limpiar_(g(f, 'Teléfono')),
        fecha: fechaDeTexto_(v('Fecha entrega')),
        hora: horaDeTexto_(v('Hora entrega')),
        valorProducto: Number(g(f, 'Valor producto')) || 0,
        valorDomicilio: Number(g(f, 'Valor domicilio')) || 0,
        total: total,
        dedicatoria: limpiar_(g(f, 'Dedicatoria')),
        textoDedicatoria: limpiar_(g(f, 'Texto dedicatoria')),
        estado: normEstado_(g(f, 'Estado')),
        decorador: limpiar_(g(f, 'Decorador')),
        inicioPrep: hmDe_(prep),
        listoEl: hmDe_(listo),
        entregador: limpiar_(g(f, 'Entregó')),
        salioEl: hmDe_(salio),
        entregadoEl: hmDe_(entregado),
        recibio: limpiar_(g(f, 'Recibió')),
        evidencia: limpiar_(g(f, 'Evidencia')),
        conEvidencia: !!limpiar_(g(f, 'Evidencia')),
        cancelacion: limpiar_(g(f, 'Cancelación')),
        editadoMs: t('Editado el'),
        editadoPor: limpiar_(g(f, 'Editó')),
        inicioPrepMs: prep,
        listoMs: listo,
        salioMs: salio,
        entregadoMs: entregado,
        seguimiento: limpiar_(g(f, 'Seguimiento'))
      });
    });
  }
  return { hoja: hoja, m: m, filas: filas };
}

function prepararPedidos_(ss) {
  let hoja = ss.getSheetByName(HOJA_PEDIDOS);
  if (!hoja) {
    const hojas = ss.getSheets();
    if (hojas.length === 1 && hojas[0].getLastRow() === 0) {
      hoja = hojas[0];
      hoja.setName(HOJA_PEDIDOS);
    } else {
      hoja = ss.insertSheet(HOJA_PEDIDOS);
    }
  }

  // Las hojas de antes llamaban "Descripción del arreglo" a la descripción: se renombra en su sitio, sin mover datos.
  const viejas = mapa_(hoja);
  if (viejas['Descripción del arreglo'] && !viejas['Descripción del pedido']) hoja.getRange(1, viejas['Descripción del arreglo']).setValue('Descripción del pedido');

  // Cabeceras: las que falten se agregan al final, sin mover los datos existentes.
  const m = mapa_(hoja);
  let siguiente = hoja.getLastColumn() + 1;
  COLUMNAS.forEach(c => {
    if (!m[c]) { hoja.getRange(1, siguiente).setValue(c); m[c] = siguiente; siguiente++; }
  });

  hoja.getRange(1, 1, 1, hoja.getLastColumn())
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#be185d').setVerticalAlignment('middle');
  hoja.setFrozenRows(1);
  hoja.setRowHeight(1, 34);

  const filas = Math.max(hoja.getMaxRows() - 1, 1);
  const col = c => hoja.getRange(2, m[c], filas, 1);
  // Fecha y hora como texto para comparar sin problemas de formato regional.
  col('Fecha entrega').setNumberFormat('@');
  col('Hora entrega').setNumberFormat('@');
  col('Teléfono').setNumberFormat('@');
  ['Registrado', 'Inicio preparación', 'Listo el', 'Salió el', 'Entregado el', 'Editado el']
    .forEach(c => col(c).setNumberFormat('dd/mm/yyyy hh:mm'));
  ['Valor producto', 'Valor domicilio', 'Total', 'Abonado', 'Costo'].forEach(c => col(c).setNumberFormat('$#,##0'));
  col('Descripción del pedido').setWrap(true);
  col('Texto dedicatoria').setWrap(true);
  Object.keys(ANCHOS).forEach(c => { if (m[c]) hoja.setColumnWidth(m[c], ANCHOS[c]); });

  // Estado: lista desplegable; los pedidos anteriores sin estado quedan como pendientes.
  const n = hoja.getLastRow() - 1;
  if (n > 0) {
    const r = hoja.getRange(2, m['Estado'], n, 1);
    r.setValues(r.getValues().map(x => [normEstado_(x[0])]));
  }
  col('Estado').setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(ESTADOS, true).setAllowInvalid(false).build());
  hoja.setConditionalFormatRules(ESTADOS.map(e =>
    SpreadsheetApp.newConditionalFormatRule()
      .whenTextEqualTo(e).setBackground(COLOR_ESTADO[e][0]).setFontColor(COLOR_ESTADO[e][1])
      .setRanges([col('Estado')]).build()));
  return hoja;
}

function prepararUsuarios_(ss) {
  const hoja = ss.getSheetByName(HOJA_USUARIOS) || ss.insertSheet(HOJA_USUARIOS);
  hoja.getRange(1, 1, 1, COLUMNAS_USUARIOS.length).setValues([COLUMNAS_USUARIOS])
    .setFontWeight('bold').setFontColor('#ffffff').setBackground('#17382C').setVerticalAlignment('middle');
  hoja.setFrozenRows(1);
  hoja.setRowHeight(1, 34);

  if (hoja.getLastRow() < 2) {
    // Filas de ejemplo: sin clave y deshabilitadas, no sirven para entrar hasta que las completes.
    hoja.getRange(2, 1, 3, 5).setValues([
      ['ana', 'Ana (ejemplo)', 'Vendedora', '', 'No'],
      ['luis', 'Luis (ejemplo)', 'Decorador', '', 'No'],
      ['pedro', 'Pedro (ejemplo)', 'Entregador', '', 'No']
    ]);
    hoja.getRange(2, 7, 3, 1).setValues([['Mujer'], ['Hombre'], ['Hombre']]);
  }
  hoja.getRange('D2:D').setNumberFormat('@');
  hoja.getRange(2, 5, Math.max(hoja.getMaxRows() - 1, 1), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['Sí', 'No'], true).setAllowInvalid(false).build());
  hoja.getRange('F2:F').setNumberFormat('dd/mm/yyyy hh:mm');
  hoja.getRange(2, 7, Math.max(hoja.getMaxRows() - 1, 1), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(SEXOS, true).setAllowInvalid(true).build());
  [130, 180, 220, 300, 90, 150, 90].forEach((w, i) => hoja.setColumnWidth(i + 1, w));

  hoja.getRange('A1').setNote('Nombre para entrar. Sin espacios. No distingue mayúsculas.');
  hoja.getRange('C1').setNote('Vendedora, Decorador o Entregador. Para varios roles sepáralos con coma: Vendedora, Decorador.');
  hoja.getRange('D1').setNote('Escribe la clave de la persona (mínimo 4 caracteres). Cuando entre por primera vez se guarda cifrada. Para cambiarla, borra lo que hay y escribe una nueva.');
  hoja.getRange('G1').setNote('Mujer u Hombre. Sirve para escribir bien su cargo: Vendedora o Vendedor.');
  hoja.getRange('E1').setNote('Sí deja entrar. No bloquea el acceso al instante, aunque tenga la sesión abierta.');

  hoja.getRange('H1').setValue('Cómo manejar los usuarios').setFontWeight('bold');
  hoja.getRange('H2:H6').setValues([
    ['1. Llena una fila: usuario, nombre, rol y clave.'],
    ['2. Pon Activo en Sí. Para quitar el acceso, ponlo en No.'],
    ['3. Para cambiar una clave, bórrala y escribe la nueva.'],
    ['4. Un usuario puede tener varios roles: Vendedora, Decorador.'],
    ['5. Las filas de ejemplo no sirven hasta que les pongas clave y Activo en Sí.']
  ]);
  hoja.setColumnWidth(8, 480);
  return hoja;
}

function prepararEstadisticas_(ss) {
  const hoja = ss.getSheetByName(HOJA_STATS) || ss.insertSheet(HOJA_STATS);
  const pedidos = ss.getSheetByName(HOJA_PEDIDOS);
  const m = mapa_(pedidos);
  const L = c => letra_(m[c]);
  const ultima = letra_(Math.max.apply(null, Object.keys(m).map(k => m[k])));
  const rango = HOJA_PEDIDOS + '!A:' + ultima;
  const A = L('ID'), V = L('Vendedora'), M = L('Medio de venta'), T = L('Total'), E = L('Estado');
  const base = A + " is not null and " + E + " <> 'Cancelado'";

  hoja.getRange('A1').setValue('Estadísticas de ventas (se calculan solas desde la hoja Pedidos; no incluyen pedidos cancelados)')
    .setFontWeight('bold').setFontSize(13);
  hoja.getRange('A3').setValue('Ventas por vendedora').setFontWeight('bold');
  hoja.getRange('E3').setValue('Ventas por medio').setFontWeight('bold');
  hoja.getRange('I3').setValue('Pedidos por vendedora y medio').setFontWeight('bold');

  hoja.getRange('A4').setFormula('=QUERY(' + rango + ', "select ' + V + ', count(' + A + '), sum(' + T +
    ') where ' + base + ' and ' + V + ' is not null group by ' + V + ' order by sum(' + T +
    ") desc label count(" + A + ") 'Pedidos', sum(" + T + ") 'Total vendido'\", 1)");
  hoja.getRange('E4').setFormula('=QUERY(' + rango + ', "select ' + M + ', count(' + A + '), sum(' + T +
    ') where ' + base + ' and ' + M + ' is not null group by ' + M + ' order by count(' + A +
    ") desc label count(" + A + ") 'Pedidos', sum(" + T + ") 'Total vendido'\", 1)");
  hoja.getRange('I4').setFormula('=QUERY(' + rango + ', "select ' + V + ', count(' + A + ') where ' + base +
    ' and ' + V + ' is not null and ' + M + ' is not null group by ' + V + ' pivot ' + M + '", 1)');

  [180, 90, 130, 30, 160, 90, 130, 30, 180, 110, 110, 110, 110, 110, 110, 110]
    .forEach((w, i) => hoja.setColumnWidth(i + 1, w));
  return hoja;
}

function prepararContabilidad_(ss) {
  const hoja = ss.getSheetByName(HOJA_CONTA) || ss.insertSheet(HOJA_CONTA);
  const m = mapa_(ss.getSheetByName(HOJA_PEDIDOS));
  const L = c => letra_(m[c]);
  const ultima = letra_(Math.max.apply(null, Object.keys(m).map(k => m[k])));
  const rango = HOJA_PEDIDOS + '!A:' + ultima;
  const A = L('ID'), R = L('Registrado'), T = L('Total'), E = L('Estado'), P = L('Método de pago');
  const V = L('Valor producto'), D = L('Valor domicilio');
  const base = A + " is not null and " + E + " <> 'Cancelado'";

  hoja.getRange('A1').setValue('Contabilidad (se calcula sola desde la hoja Pedidos; no incluye pedidos cancelados)')
    .setFontWeight('bold').setFontSize(13);
  hoja.getRange('A3').setValue('Ventas por día de venta').setFontWeight('bold');
  hoja.getRange('G3').setValue('Ventas por método de pago').setFontWeight('bold');

  hoja.getRange('A4').setFormula('=QUERY(' + rango + ', "select toDate(' + R + '), count(' + A + '), sum(' + V + '), sum(' + D +
    '), sum(' + T + ') where ' + base + ' and ' + R + ' is not null group by toDate(' + R + ') order by toDate(' + R +
    ") desc label toDate(" + R + ") 'Día', count(" + A + ") 'Pedidos', sum(" + V + ") 'Productos', sum(" + D +
    ") 'Domicilios', sum(" + T + ") 'Total'\", 1)");
  hoja.getRange('G4').setFormula('=QUERY(' + rango + ', "select ' + P + ', count(' + A + '), sum(' + T + ') where ' + base +
    ' and ' + P + ' is not null group by ' + P + ' order by sum(' + T + ") desc label count(" + A + ") 'Pedidos', sum(" + T +
    ") 'Total vendido'\", 1)");

  hoja.getRange('A4:A').setNumberFormat('dd/mm/yyyy');
  hoja.getRange('C4:E').setNumberFormat('$#,##0');
  hoja.getRange('I4:I').setNumberFormat('$#,##0');
  [110, 90, 130, 130, 130, 30, 170, 90, 130].forEach((w, i) => hoja.setColumnWidth(i + 1, w));
  return hoja;
}
