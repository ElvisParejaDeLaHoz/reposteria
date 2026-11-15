/* Arranque de la app, preparación inicial del libro y funciones solo para la dueña. */

function doGet(e) {
  const q = (e && e.parameter) || {};
  // La página de seguimiento del cliente pide sus datos aquí (ver Seguimiento.gs).
  if (q.api) return apiPublica_(e);
  if (q.seguimiento) return paginaSeguimiento_();
  let titulo = CONFIG_DEF.nombre;
  try { titulo = leerConfig_().nombre; } catch (e) { /* se usa el nombre de fábrica */ }
  // Index.html es una plantilla: arma la pantalla con los pedazos Estilos y Js* (ver incluir_).
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(titulo)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover')
    // Necesario: cada negocio abre la app desde su página de GitHub Pages, que la muestra dentro de un iframe.
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/**
 * Mete el contenido de otro archivo HTML del proyecto, tal cual, dentro de Index.html.
 * Se usa desde la plantilla así: <?!= incluir_('JsFinanzas') ?>
 * Termina en _ para que nadie la pueda llamar desde el navegador.
 *
 * OJO: se lee con getRawContent (el texto exacto del archivo). createHtmlOutputFromFile(...).getContent()
 * lo interpreta como HTML, y como los pedazos Js*.html son JavaScript sin etiqueta <script>, Google
 * cambiaba cada "<" por "&lt;": el código quedaba roto y la app se quedaba en "Cargando…".
 */
function incluir_(nombre) {
  return HtmlService.createTemplateFromFile(nombre).getRawContent();
}

/** Ejecutar desde el editor: pide permisos, crea el libro, las hojas y la carpeta de fotos. */
function configuracionInicial() {
  soloDueno_();
  secreto_();
  const ss = obtenerLibro_();
  // El libro en la misma zona horaria del proyecto (Colombia): así las horas de la hoja y de la app coinciden.
  if (ss.getSpreadsheetTimeZone() !== Session.getScriptTimeZone()) ss.setSpreadsheetTimeZone(Session.getScriptTimeZone());
  abrirPedidos_();
  abrirUsuarios_();
  if (!ss.getSheetByName(HOJA_STATS)) prepararEstadisticas_(ss);
  if (!ss.getSheetByName(HOJA_CONTA)) prepararContabilidad_(ss);
  if (!ss.getSheetByName(HOJA_CONFIG)) prepararConfig_(ss); else completarConfig_(ss);
  tablaMovs_();
  tablaFijos_();
  tablaCierres_();
  carpetaEvidencias_();
  const logo = carpetaLogo_(true);
  programarCopiaDiaria_();
  Logger.log('Listo. Tu libro de pedidos y usuarios está aquí: ' + ss.getUrl());
  Logger.log('Copia de seguridad: cada noche se guarda una copia del libro en la carpeta "Copias de seguridad" de Drive (las últimas ' + DIAS_COPIAS + ').');
  Logger.log('Para poner el logo, sube la imagen a esta carpeta de Drive: ' + logo.getUrl());
  try { const url = ScriptApp.getService().getUrl(); if (url) Logger.log('Dirección de la app: ' + url); } catch (e) { /* aún sin publicar */ }
  const codigo = prepararActivacion_();
  if (codigo) {
    Logger.log('CÓDIGO DE ACTIVACIÓN: ' + codigo);
    Logger.log('Mándale al dueño o la dueña el enlace de su app terminado en ?activar=' + codigo +
      ' . Desde el celular configura su negocio, su usuario y sus gastos; no hace falta compartirle la hoja.');
  }
}

/** Las funciones públicas también las puede llamar cualquiera que abra la página: estas solo las puede ejecutar la dueña desde el editor. */
function soloDueno_() {
  let activo = '';
  try { activo = Session.getActiveUser().getEmail(); } catch (e) { activo = ''; }
  if (!activo || activo !== Session.getEffectiveUser().getEmail()) {
    throw new Error('Esta función solo se ejecuta desde el editor de Apps Script.');
  }
}
