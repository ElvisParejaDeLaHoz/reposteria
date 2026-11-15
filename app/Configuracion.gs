/* Hoja "Configuración": nombre, colores, términos del negocio, listas y plantillas por tipo de negocio. */

function prepararConfig_(ss) {
  let hoja = ss.getSheetByName(HOJA_CONFIG);
  if (!hoja) hoja = ss.insertSheet(HOJA_CONFIG);
  hoja.clear();
  // Si el libro ya tiene el nombre del negocio (lo pone la herramienta de instalación), se usa de una vez.
  const nombre = ss.getName() !== NOMBRE_LIBRO ? ss.getName().slice(0, 60) : '';
  const giro = giroInicial_();
  const filas = [['Ajuste', 'Valor', 'Ayuda']].concat(FILAS_CONFIG.map(f => {
    if (f[0] === 'Nombre del negocio' && nombre) return [f[0], nombre, f[2]];
    if (giro[f[0]] != null) return [f[0], String(giro[f[0]]), f[2]];
    return f;
  }));
  hoja.getRange(1, 1, filas.length, 3).setValues(filas);
  hoja.getRange(1, 1, 1, 3).setFontWeight('bold').setBackground('#17382C').setFontColor('#FFFFFF');
  hoja.getRange(2, 1, filas.length - 1, 1).setFontWeight('bold');
  hoja.getRange(2, 3, filas.length - 1, 1).setFontColor('#6F636B');
  hoja.setColumnWidth(1, 190); hoja.setColumnWidth(2, 460); hoja.setColumnWidth(3, 520);
  hoja.getRange(2, 2, filas.length - 1, 1).setWrap(true);
  hoja.setFrozenRows(1);
  return hoja;
}

/** Si la hoja ya existía de una versión anterior, agrega los ajustes nuevos sin tocar los que ya tenía. */
function completarConfig_(ss) {
  const hoja = ss.getSheetByName(HOJA_CONFIG);
  const hay = {};
  if (hoja.getLastRow() >= 1) hoja.getRange(1, 1, hoja.getLastRow(), 1).getValues().forEach(r => { hay[norm_(r[0])] = true; });
  const giro = giroInicial_();
  FILAS_CONFIG.forEach(f => { if (!hay[norm_(f[0])]) hoja.appendRow(giro[f[0]] != null ? [f[0], String(giro[f[0]]), f[2]] : f); });
}

/**
 * Valores de arranque según el tipo de negocio (floristería, pastelería, óptica…).
 * La herramienta de instalación agrega el archivo Giro.gs con la constante GIRO_INICIAL;
 * solo se usa al crear la hoja Configuración, después manda lo que escriba la dueña.
 */
function giroInicial_() {
  try { return (typeof GIRO_INICIAL === 'object' && GIRO_INICIAL) ? GIRO_INICIAL : {}; } catch (e) { return {}; }
}

/** Escribe un ajuste en la hoja Configuración (o lo agrega si no está). */
function escribirConfig_(etiqueta, valor) {
  const ss = obtenerLibro_();
  const hoja = ss.getSheetByName(HOJA_CONFIG) || prepararConfig_(ss);
  const n = hoja.getLastRow();
  const etiquetas = n >= 1 ? hoja.getRange(1, 1, n, 1).getValues() : [];
  for (let i = 0; i < etiquetas.length; i++) {
    if (norm_(etiquetas[i][0]) === norm_(etiqueta)) { hoja.getRange(i + 1, 2).setValue(valor); CONFIG_MEMO_ = null; return; }
  }
  const def = FILAS_CONFIG.find(f => f[0] === etiqueta);
  hoja.appendRow([etiqueta, valor, def ? def[2] : '']);
  CONFIG_MEMO_ = null;
}

function lista_(texto, def) {
  const vistos = {};
  const out = [];
  String(texto == null ? '' : texto).split(/[,;\n]/).forEach(x => {
    const v = limpiar_(x).slice(0, 40);
    if (v && !vistos[v.toLowerCase()] && out.length < 30) { vistos[v.toLowerCase()] = true; out.push(v); }
  });
  return out.length ? out : def.slice();
}

function color_(texto, def) {
  let c = limpiar_(texto).replace(/^#?/, '#');
  if (/^#[0-9a-f]{3}$/i.test(c)) c = '#' + c.slice(1).split('').map(x => x + x).join('');
  return /^#[0-9a-f]{6}$/i.test(c) ? c.toUpperCase() : def;
}

/** Lee la hoja "Configuración". Lo que falte o esté mal escrito se reemplaza por el valor de fábrica. */
function leerConfig_() {
  if (CONFIG_MEMO_) return JSON.parse(CONFIG_MEMO_);
  const cfg = leerConfigHoja_();
  CONFIG_MEMO_ = JSON.stringify(cfg);
  return cfg;
}

function leerConfigHoja_() {
  const cfg = {
    nombre: CONFIG_DEF.nombre, lema: CONFIG_DEF.lema, principal: CONFIG_DEF.principal,
    secundario: CONFIG_DEF.secundario, modo: CONFIG_DEF.modo, terminos: Object.assign({}, CONFIG_DEF.terminos), medios: CONFIG_DEF.medios.slice(), pagos: CONFIG_DEF.pagos.slice(),
    minDesc: CONFIG_DEF.minDesc, categorias: CONFIG_DEF.categorias.slice(), sueldo: CONFIG_DEF.sueldo
  };
  const hoja = obtenerLibro_().getSheetByName(HOJA_CONFIG);
  if (!hoja || hoja.getLastRow() < 2) return cfg;
  const valores = hoja.getRange(2, 1, hoja.getLastRow() - 1, 2).getValues();
  const por = {};
  valores.forEach(r => { por[norm_(r[0])] = r[1]; });
  const n = limpiar_(por['nombre del negocio']).slice(0, 60);
  if (n) cfg.nombre = n;
  const l = limpiar_(por['frase de bienvenida']).slice(0, 120);
  if (l || 'frase de bienvenida' in por) cfg.lema = l;
  cfg.principal = color_(por['color principal'], cfg.principal);
  cfg.secundario = color_(por['color secundario'], cfg.secundario);
  const mo = norm_(por['modo de pantalla']);
  cfg.modo = /^osc/.test(mo) ? 'oscuro' : (/^cla/.test(mo) ? 'claro' : 'auto');
  const T = cfg.terminos;
  const termino = (clave, def, max) => { const v = limpiar_(por[clave]).slice(0, max || 60); return v || def; };
  T.producto = termino('nombre del producto', T.producto);
  T.dedicatoria = termino('nombre de la dedicatoria', T.dedicatoria);
  T.vende = termino('rol: quien vende', T.vende);
  T.prepara = termino('rol: quien prepara', T.prepara);
  T.entrega = termino('rol: quien entrega', T.entrega);
  T.admin = termino('rol: quien administra', T.admin);
  T.ejemplo = termino('ejemplo de descripción', T.ejemplo, 160);
  T.pista = termino('qué incluir en la descripción', T.pista, 160);
  cfg.medios = lista_(por['medios de venta'], cfg.medios);
  cfg.pagos = lista_(por['métodos de pago'], cfg.pagos);
  const md = parseInt(limpiar_(por['mínimo de letras en la descripción']), 10);
  if (md >= 1 && md <= 200) cfg.minDesc = md;
  cfg.categorias = lista_(por['categorías de gastos'], cfg.categorias);
  const su = Number(String(por['sueldo que quiero ganarme'] == null ? '' : por['sueldo que quiero ganarme']).replace(/[^\d]/g, ''));
  if (su >= 0 && su <= MAX_VALOR_PRODUCTO) cfg.sueldo = su;
  return cfg;
}

/** Se llama sin sesión: nombre, frase y colores para la pantalla de entrada. */
function getConfig() {
  const c = leerConfig_();
  let porActivar = false;
  try { porActivar = !!codigoActivacion_(); } catch (e) { /* sin propiedades: como si ya estuviera activada */ }
  // porActivar solo dice que la pantalla de entrada muestre "Activar mi app"; el código nunca sale de aquí.
  return { ok: true, nombre: c.nombre, lema: c.lema, principal: c.principal, secundario: c.secundario, modo: c.modo, terminos: c.terminos, minDesc: c.minDesc, porActivar: porActivar };
}

/** La configuración que recibe cada persona: el sueldo de la dueña solo lo ve quien administra. */
function configPara_(u) {
  const c = leerConfig_();
  if (u.roles.indexOf('Administrador') < 0) delete c.sueldo;
  return c;
}
