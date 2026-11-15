/* Marca de cambios (para que las pantallas se actualicen solas) y avisos opcionales por Telegram. */

/** Cada vez que algo cambia se actualiza una marca; la app la consulta (es muy liviana) y solo recarga si cambió. */
function marcarCambio_() {
  try { CacheService.getScriptCache().put('cambio', Date.now() + '-' + Math.random().toString(36).slice(2, 6), 21600); } catch (e) { /* sin caché */ }
}

function getCambio() {
  const cache = CacheService.getScriptCache();
  let v = cache.get('cambio');
  if (!v) { v = 'i' + Date.now(); cache.put('cambio', v, 21600); }
  return { ok: true, v: v };
}

function sinTildes_(t) { return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, ''); }

function esc_(t) { return String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function recorte_(t, n) { t = String(t == null ? '' : t); return t.length > n ? t.slice(0, n - 1) + '…' : t; }

/** Lee la parte de Telegram de la hoja Configuración. Nunca se manda a las pantallas: lleva el token. */
function leerTelegram_() {
  const vacio = { activo: false, token: '', chats: { vende: [], prepara: [], entrega: [], admin: [] }, eventos: EVENTOS_AVISO.slice() };
  const hoja = obtenerLibro_().getSheetByName(HOJA_CONFIG);
  if (!hoja || hoja.getLastRow() < 2) return vacio;
  const por = {};
  hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues().forEach(r => { por[norm_(r[0])] = r[1]; });
  const chats = v => String(v == null ? '' : v).split(/[,;\s]+/).filter(x => /^-?\d+$/.test(x) || /^@\w+$/.test(x));
  const t = {
    activo: /^(s[ií]|true|1|x|activo)$/i.test(limpiar_(por['telegram: activo'])),
    token: limpiar_(por['telegram: token del bot']),
    chats: {
      vende: chats(por['telegram: chats de quien vende']),
      prepara: chats(por['telegram: chats de quien prepara']),
      entrega: chats(por['telegram: chats de quien entrega']),
      admin: chats(por['telegram: chats de quien administra'])
    },
    eventos: []
  };
  const lista = sinTildes_(por['telegram: avisos']).toLowerCase().split(/[,;\s]+/).filter(Boolean);
  t.eventos = lista.length ? EVENTOS_AVISO.filter(e => lista.indexOf(e) >= 0) : EVENTOS_AVISO.slice();
  return t;
}

/** Texto y destinatarios de cada aviso. */
function armarAviso_(evento, p, x, T) {
  const rol = r => String(T[r]).split(',')[0].replace(/\s*\((f|m)\)\s*$/i, '');
  const id = '<b>' + esc_(p.id) + '</b>';
  const cuando = esc_(p.fecha) + ' a las ' + esc_(p.hora);
  switch (evento) {
    case 'nuevo':
      return { destinos: ['prepara', 'admin'], texto: '🌸 <b>¡Nuevo pedido!</b>\n<b>ID:</b> ' + id + '\n<b>Entrega:</b> ' + cuando + ' (' + esc_(p.entrega) + ')\n<b>Detalle:</b> ' + esc_(recorte_(p.descripcion, 600)) };
    case 'editado':
      return { destinos: ['prepara', 'admin'], texto: '✏️ <b>Pedido modificado</b>\n<b>ID:</b> ' + id + '\n<b>Entrega:</b> ' + cuando + '\nRevisa los datos nuevos en la app.' };
    case 'empezo':
      return { destinos: ['prepara', 'admin'], texto: '👩‍🎨 <b>Pedido en preparación</b>\n' + esc_(rol('prepara')) + ' <b>' + esc_(x.nombre) + '</b> empezó a armar el pedido ' + id + '.' };
    case 'listo':
      return p.entrega === 'Domicilio'
        ? { destinos: ['entrega', 'admin'], texto: '📦 <b>¡Pedido listo para entrega!</b>\n<b>ID:</b> ' + id + '\n<b>Destino:</b> ' + esc_(p.direccion) + '\n<b>Hora pactada:</b> ' + esc_(p.hora) + '\n<i>Entra a la app para tomarlo y salir a ruta.</i>' }
        : { destinos: ['vende', 'admin'], texto: '📦 <b>Pedido listo</b> para entregar en el local\n<b>ID:</b> ' + id + '\n<b>Para:</b> ' + esc_(p.para) + '\n<b>Hora pactada:</b> ' + esc_(p.hora) };
    case 'salio':
      return { destinos: ['vende', 'entrega', 'admin'], texto: '🚀 <b>Pedido en camino</b>\n' + esc_(rol('entrega')) + ' <b>' + esc_(x.nombre) + '</b> tomó el pedido ' + id + ' y va hacia la dirección de entrega.' };
    case 'entregado':
      return { destinos: ['vende', 'entrega', 'admin'], texto: '🎉 <b>¡Pedido entregado!</b>\nEl pedido ' + id + ' fue entregado por <b>' + esc_(x.nombre) + '</b>.' + (x.recibio ? ' Recibió: ' + esc_(x.recibio) + '.' : '') };
    case 'cancelado': {
      const enCola = p.estado === 'Pendiente' || p.estado === 'En preparación';
      return { destinos: enCola ? ['prepara', 'vende', 'admin'] : ['entrega', 'vende', 'admin'], texto: '⚠️ <b>ATENCIÓN:</b> el pedido ' + id + ' de ' + esc_(p.cliente) + ' fue <b>CANCELADO</b>.\nMotivo: ' + esc_(x.motivo) };
    }
  }
  return null;
}

/** Deja el aviso en cola; se manda cuando se suelta el candado (enviarAvisos_). */
function avisar_(evento, p, x) {
  try { COLA_AVISOS_.push({ evento: evento, p: p, x: x || {} }); } catch (e) { /* nunca debe romper el pedido */ }
}

/** Manda los avisos pendientes. Cualquier falla se registra y se ignora: un aviso nunca debe impedir guardar un pedido. */
function enviarAvisos_() {
  const cola = COLA_AVISOS_;
  COLA_AVISOS_ = [];
  if (!cola.length) return;
  try {
    const tg = leerTelegram_();
    if (!tg.activo || !tg.token) return;
    const T = leerConfig_().terminos;
    const pedidos = [];
    cola.forEach(a => {
      if (tg.eventos.indexOf(a.evento) < 0) return;
      const aviso = armarAviso_(a.evento, a.p, a.x, T);
      if (!aviso) return;
      const vistos = {};
      aviso.destinos.forEach(d => (tg.chats[d] || []).forEach(chat => {
        if (vistos[chat]) return;
        vistos[chat] = true;
        pedidos.push({
          url: 'https://api.telegram.org/bot' + tg.token + '/sendMessage',
          method: 'post', contentType: 'application/json', muteHttpExceptions: true,
          payload: JSON.stringify({ chat_id: chat, text: aviso.texto, parse_mode: 'HTML', disable_web_page_preview: true })
        });
      }));
    });
    if (!pedidos.length) return;
    UrlFetchApp.fetchAll(pedidos).forEach(r => {
      if (r.getResponseCode() >= 300) console.warn('Telegram respondió ' + r.getResponseCode() + ': ' + r.getContentText().slice(0, 200));
    });
  } catch (e) {
    console.warn('No se pudo enviar el aviso de Telegram: ' + e);
  }
}

function avisoAccion_(u, p, accion, datos) {
  if (accion === 'empezar') avisar_('empezo', p, { nombre: u.nombre });
  else if (accion === 'terminar') avisar_('listo', p, {});
  else if (accion === 'salir') avisar_('salio', p, { nombre: u.nombre });
  else if (accion === 'entregar') avisar_('entregado', p, { nombre: p.entregador || u.nombre, recibio: limpiar_(datos.recibio).slice(0, 80) });
  else if (accion === 'cancelar') avisar_('cancelado', p, { motivo: limpiar_(datos.motivo).slice(0, 200) });
}

/** Para ejecutar desde el editor: muestra los chats (grupos y personas) que le han escrito al bot. */
function buscarChatsTelegram() {
  soloDueno_();
  const tg = leerTelegram_();
  if (!tg.token) throw new Error('Pega primero el token del bot en la hoja Configuración (fila "Telegram: token del bot").');
  const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + tg.token + '/getUpdates', { muteHttpExceptions: true });
  const datos = JSON.parse(r.getContentText());
  if (!datos.ok) throw new Error('Telegram dijo: ' + datos.description);
  const vistos = {};
  datos.result.forEach(u => {
    const m = u.message || u.channel_post || u.my_chat_member || u.edited_message;
    const c = m && m.chat;
    if (c && !vistos[c.id]) { vistos[c.id] = true; Logger.log((c.title || [c.first_name, c.last_name].filter(Boolean).join(' ') || c.username) + '  →  ' + c.id + '  (' + c.type + ')'); }
  });
  if (!Object.keys(vistos).length) Logger.log('No hay chats todavía. Agrega el bot al grupo (o escríbele al bot) y manda un mensaje; luego ejecuta esto otra vez.');
}

/** Para ejecutar desde el editor: manda un mensaje de prueba a todos los chats configurados. */
function probarTelegram() {
  soloDueno_();
  const tg = leerTelegram_();
  if (!tg.token) throw new Error('Pega primero el token del bot en la hoja Configuración.');
  const todos = {};
  ['vende', 'prepara', 'entrega', 'admin'].forEach(d => tg.chats[d].forEach(c => { todos[c] = true; }));
  if (!Object.keys(todos).length) throw new Error('No hay chats en la hoja Configuración.');
  Object.keys(todos).forEach(chat => {
    const r = UrlFetchApp.fetch('https://api.telegram.org/bot' + tg.token + '/sendMessage', {
      method: 'post', contentType: 'application/json', muteHttpExceptions: true,
      payload: JSON.stringify({ chat_id: chat, text: '✅ Prueba de avisos de ' + leerConfig_().nombre })
    });
    Logger.log(chat + ': ' + (r.getResponseCode() < 300 ? 'enviado' : 'ERROR ' + r.getContentText().slice(0, 150)));
  });
  Logger.log('Recuerda poner "Telegram: activo" en Sí para que los avisos salgan solos.');
}
