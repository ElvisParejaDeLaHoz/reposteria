/*
 * Seguimiento del pedido para el cliente.
 *
 * Cada pedido tiene un código al azar (columna "Seguimiento"). El negocio le manda al cliente el enlace
 * …/<negocio>/pedido/?c=<código> (página de GitHub; ver app/PaginaSeguimiento.html). Esa página le pide los datos
 * a esta app con doGet(?api=…), que responde JSON:
 *   ?api=seguimiento&c=…        estado del pedido (guardado en memoria 5 minutos)
 *   ?api=foto&c=…               foto de entrega, para la tarjeta de "recomiéndame"
 *   ?api=calificar&c=…&e=5&t=…  calificación del cliente
 *   ?api=logo&v=…               logo del negocio
 *
 * Nadie entra sin el código, y el cliente solo ve lo que arma vistaPublica_ (sin datos privados).
 * Si llegan demasiadas consultas a la vez, se responde { ocupado: true } y la página muestra un
 * mensaje amable y vuelve a intentar sola.
 */

function nuevoCodigoSeguimiento_() {
  const bytes = [];
  [Utilities.getUuid(), Utilities.getUuid(), Utilities.getUuid()].forEach(u => {
    const hex = u.replace(/-/g, '');
    for (let i = 0; i < 8; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16)); // los primeros bytes son al azar
  });
  return codigoSeguimientoDesdeBytes_(bytes);
}

/** Dirección de la página de seguimiento. La de GitHub si la instalación la conoce; si no, la de la propia app. */
function urlSeguimiento_(codigo) {
  let pagina = '';
  try { pagina = (typeof PAGINA_NEGOCIO === 'string') ? PAGINA_NEGOCIO : ''; } catch (e) { pagina = ''; }
  if (pagina) return pagina.replace(/\/?$/, '/') + 'pedido/?c=' + codigo;
  return ScriptApp.getService().getUrl() + '?seguimiento=' + codigo;
}

/** Para el equipo: el enlace de seguimiento de un pedido (lo crea si el pedido es de antes de esta función). */
function enlaceSeguimiento(token, id) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  if (['Vendedora', 'Entregador', 'Administrador'].every(r => u.roles.indexOf(r) < 0)) return fallo_('Tu usuario no puede compartir el seguimiento.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let codigo, p;
  try {
    const datos = leerPedidos_();
    p = datos.filas.find(x => x.id === String(id));
    if (!p) return fallo_('No se encontró el pedido. Actualiza la lista.', true);
    codigo = p.seguimiento;
    if (!esCodigoSeguimiento_(codigo)) {
      codigo = nuevoCodigoSeguimiento_();
      escribir_(datos.hoja, datos.m, p.fila, { 'Seguimiento': codigo });
    }
  } finally {
    lock.releaseLock();
  }
  const cfg = leerConfig_();
  const t = terminoProducto_(cfg.terminos.producto);
  const nombre = (p.cliente || '').split(' ')[0];
  return {
    ok: true,
    url: urlSeguimiento_(codigo),
    texto: '¡Hola' + (nombre ? ' ' + nombre : '') + '! 😊 Recibimos tu pedido en ' + cfg.nombre + '. Aquí puedes ver cómo va tu ' + t.singular +
      ' en todo momento: ' + urlSeguimiento_(codigo)
  };
}

/** Respuesta JSON para la página de seguimiento. */
function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

/** Lo llama doGet cuando viene ?api=…. Cualquier error se responde como JSON, nunca como página de Google. */
function apiPublica_(e) {
  const q = (e && e.parameter) || {};
  try {
    if (q.api === 'logo') return json_(getLogo(q.v || ''));
    // Ojo: Apps Script reserva los parámetros "c" y "sid" (responde 400 sin llegar aquí). Por eso es "codigo".
    const codigo = String(q.codigo || '');
    if (!esCodigoSeguimiento_(codigo)) return json_({ ok: false, error: 'Este enlace no es válido. Pídele uno nuevo al negocio.' });
    if (q.api === 'seguimiento') return json_(estadoPublico_(codigo));
    if (q.api === 'foto') return json_(fotoPublica_(codigo));
    if (q.api === 'calificar') return json_(calificar_(codigo, q.e, q.t));
    return json_({ ok: false, error: 'Consulta desconocida.' });
  } catch (err) {
    return json_({ ok: false, ocupado: true });
  }
}

/** Cuenta las consultas que llegan a la hoja en este minuto. Si la caché falla, no se bloquea a nadie. */
function muchoTrafico_() {
  try {
    const cache = CacheService.getScriptCache();
    const k = 'seg-min-' + Math.floor(Date.now() / 60000);
    const n = Number(cache.get(k) || 0) + 1;
    cache.put(k, String(n), 120);
    return n > LIMITE_SEGUIMIENTO_MIN;
  } catch (e) {
    return false;
  }
}

function pedidoPorCodigo_(codigo) {
  return leerPedidos_().filas.find(x => x.seguimiento === codigo) || null;
}

function estadoPublico_(codigo) {
  const cache = CacheService.getScriptCache();
  const guardado = cache.get('seg:' + codigo);
  if (guardado) return JSON.parse(guardado);
  if (muchoTrafico_()) return { ok: false, ocupado: true };

  const p = pedidoPorCodigo_(codigo);
  let r;
  if (!p) r = { ok: false, error: 'No encontramos este pedido. Revisa el enlace o escríbele al negocio.' };
  else if (seguimientoVencido_(p, Date.now())) r = { ok: false, error: 'Este enlace ya venció. ¡Gracias por tu compra!' };
  else r = Object.assign({ ok: true, consultado: Date.now() }, vistaPublica_(p, leerConfig_(), calificacionDe_(p.id)));
  try { cache.put('seg:' + codigo, JSON.stringify(r), SEG_MEMORIA); } catch (e) { /* muy grande o sin caché: se sirve igual */ }
  return r;
}

/** Al cambiar un pedido se borra su copia en memoria, para que el cliente vea el cambio de una vez. */
function olvidarSeguimiento_(codigo) {
  if (!esCodigoSeguimiento_(codigo)) return;
  try { CacheService.getScriptCache().remove('seg:' + codigo); } catch (e) { /* vence sola en 5 minutos */ }
}

function fotoPublica_(codigo) {
  if (excedeLimite_(codigo, 'seg-foto', 30)) return { ok: false, ocupado: true };
  const p = pedidoPorCodigo_(codigo);
  if (!p || p.estado !== 'Entregado' || seguimientoVencido_(p, Date.now())) return { ok: false, error: 'No hay foto para este pedido.' };
  const trozo = /\/d\/([^\/?#]+)/.exec(p.evidencia || '');
  if (!trozo) return { ok: false, error: 'No hay foto para este pedido.' };
  const blob = DriveApp.getFileById(trozo[1]).getBlob();
  return { ok: true, dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
}

function tablaCalif_() {
  return new Tabla(HOJA_CALIF, COLUMNAS_CALIF, { 'Fecha': 'dd/mm/yyyy hh:mm', 'Registrado': 'dd/mm/yyyy hh:mm' });
}

function leerCalificaciones_() {
  return tablaCalif_().filas().map(f => ({
    fila: f._fila,
    pedido: limpiar_(f['Pedido']),
    cliente: limpiar_(f['Cliente']),
    estrellas: Math.round(Number(f['Estrellas']) || 0),
    comentario: limpiar_(f['Comentario']),
    registradoMs: f['Registrado'] instanceof Date ? f['Registrado'].getTime() : 0
  })).filter(c => c.pedido && c.estrellas >= 1 && c.estrellas <= 5);
}

function calificacionDe_(id) {
  return leerCalificaciones_().find(c => c.pedido === id) || null;
}

/** El cliente califica su pedido entregado. Si vuelve a calificar, se reemplaza la anterior. */
function calificar_(codigo, estrellas, comentario) {
  if (excedeLimite_(codigo, 'seg-calif', 10)) return { ok: false, error: 'Ya recibimos tu calificación. ¡Gracias!' };
  const v = validarCalificacion_(estrellas, comentario);
  if (v.error) return { ok: false, error: v.error };
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const p = pedidoPorCodigo_(codigo);
    if (!p || p.estado !== 'Entregado' || seguimientoVencido_(p, Date.now())) return { ok: false, error: 'Este pedido todavía no se puede calificar.' };
    const t = tablaCalif_();
    const antes = leerCalificaciones_().find(c => c.pedido === p.id);
    const datos = {
      'Pedido': p.id, 'Cliente': seguro_(p.cliente, TOPES.cliente), 'Estrellas': v.estrellas,
      'Comentario': seguro_(v.comentario, 300), 'Fecha': new Date()
    };
    if (antes) t.escribir(antes.fila, datos);
    else t.agregar(Object.assign(datos, { 'Registrado': new Date() }));
    olvidarSeguimiento_(codigo);
    marcarCambio_();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, estrellas: v.estrellas };
}

/** Para Ventas: lo que dicen los clientes. */
function resumenCalificacionesAdmin_() {
  try { return resumirCalificaciones_(leerCalificaciones_()); } catch (e) { return resumirCalificaciones_([]); }
}

/**
 * Por si la página de GitHub no está: la misma página de seguimiento servida por la app (…/exec?seguimiento=código).
 * Se lee tal cual (getRawContent) y se le pone la dirección de esta app.
 */
function paginaSeguimiento_() {
  const html = HtmlService.createTemplateFromFile('PaginaSeguimiento').getRawContent()
    .split('__API__').join(ScriptApp.getService().getUrl());
  return HtmlService.createHtmlOutput(html)
    .setTitle(leerConfig_().nombre)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
