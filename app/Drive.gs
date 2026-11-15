/* Archivos en Drive: copias de seguridad, logo y fotos de entrega. */

/** La ejecuta un disparador cada noche: copia el libro completo a la carpeta "Copias de seguridad" y borra las de hace más de 14 días. */
function copiaDiaria() {
  const ss = obtenerLibro_();
  const props = PropertiesService.getScriptProperties();
  let carpeta = null;
  const id = props.getProperty('ID_CARPETA_COPIAS');
  if (id) { try { carpeta = DriveApp.getFolderById(id); } catch (e) { carpeta = null; } }
  if (!carpeta) { carpeta = DriveApp.createFolder('Copias de seguridad - ' + ss.getName()); props.setProperty('ID_CARPETA_COPIAS', carpeta.getId()); }
  const dia = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const prefijo = ss.getName() + ' - copia ';
  const nombre = prefijo + dia;
  const ya = carpeta.getFilesByName(nombre);
  if (!ya.hasNext()) DriveApp.getFileById(ss.getId()).makeCopy(nombre, carpeta);
  const limite = Date.now() - DIAS_COPIAS * 86400000;
  const archivos = carpeta.getFiles();
  while (archivos.hasNext()) {
    const a = archivos.next();
    if (a.getName().indexOf(prefijo) === 0 && a.getDateCreated().getTime() < limite) a.setTrashed(true);
  }
}

/** Ejecútala UNA vez desde el editor: programa la copia diaria (entre 2 y 3 de la mañana) y hace la primera copia ahora. */
function activarCopiaDiaria() {
  soloDueno_();
  programarCopiaDiaria_();
  copiaDiaria();
  Logger.log('Listo: se hará una copia cada noche en la carpeta "Copias de seguridad" de tu Drive (se guardan las últimas ' + DIAS_COPIAS + ').');
}

/** Deja un solo disparador de la copia diaria (entre 2 y 3 de la mañana). configuracionInicial lo llama al instalar. */
function programarCopiaDiaria_() {
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'copiaDiaria') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('copiaDiaria').timeBased().everyDays(1).atHour(2).create();
}

function carpetaLogo_(crear) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(PROP_CARPETA_LOGO);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* se recrea abajo */ } }
  if (!crear) return null;
  const carpeta = DriveApp.createFolder('Logo de la app - ' + nombreLibro_());
  props.setProperty(PROP_CARPETA_LOGO, carpeta.getId());
  return carpeta;
}

/** El logo es la imagen más reciente de la carpeta "Logo de la app". */
function archivoLogo_() {
  const carpeta = carpetaLogo_(false);
  if (!carpeta) return null;
  const archivos = carpeta.getFiles();
  let mejor = null;
  while (archivos.hasNext()) {
    const a = archivos.next();
    if (!/^image\/(png|jpeg|webp|gif|svg\+xml)$/.test(a.getMimeType())) continue;
    if (!mejor || a.getLastUpdated().getTime() > mejor.getLastUpdated().getTime()) mejor = a;
  }
  return mejor;
}

/**
 * Se llama sin sesión, porque el logo también sale en la pantalla de entrada.
 * `version` es la que la página ya tiene guardada: si no cambió, no se vuelve a enviar la imagen.
 */
function getLogo(version) {
  try {
    const a = archivoLogo_();
    if (!a) return { ok: true, sin: true };
    const ver = a.getId() + ':' + a.getLastUpdated().getTime();
    if (version === ver) return { ok: true, ver: ver, igual: true };
    if (a.getSize() > MAX_LOGO) return { ok: false, error: 'El logo pesa más de 1,5 MB. Sube una versión más liviana.' };
    const blob = a.getBlob();
    return { ok: true, ver: ver, dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
  } catch (e) {
    return { ok: false, error: 'No se pudo leer el logo.' };
  }
}

/** Guarda el logo que sube la administradora (desde la bienvenida o Ajustes). Lanza un error legible si no sirve. */
function guardarLogo_(foto) {
  if (!foto || !foto.base64 || !/^image\/(jpeg|png|webp)$/.test(foto.mime || '')) throw new Error('El logo debe ser una imagen JPG, PNG o WEBP.');
  const bytes = Utilities.base64Decode(foto.base64);
  if (bytes.length > MAX_LOGO) throw new Error('El logo pesa más de 1,5 MB. Prueba con una imagen más pequeña.');
  if (!firmaImagen_(bytes, foto.mime)) throw new Error('El archivo no es una imagen válida.');
  const carpeta = carpetaLogo_(true);
  const ext = foto.mime === 'image/png' ? 'png' : (foto.mime === 'image/webp' ? 'webp' : 'jpg');
  const nuevo = carpeta.createFile(Utilities.newBlob(bytes, foto.mime, 'logo.' + ext));
  // Los anteriores van a la papelera de Drive (se pueden recuperar durante 30 días).
  const viejos = carpeta.getFiles();
  while (viejos.hasNext()) {
    const a = viejos.next();
    if (a.getId() !== nuevo.getId()) { try { a.setTrashed(true); } catch (e) { /* no es de esta cuenta: se deja */ } }
  }
}

/** Foto de entrega de un pedido, como data URL, para mostrarla en la app. */
function getEvidencia(token, id) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  if (['Vendedora', 'Entregador', 'Administrador'].every(r => u.roles.indexOf(r) < 0)) {
    return fallo_('Tu usuario no puede ver las fotos de entrega.');
  }
  const p = leerPedidos_().filas.find(x => x.id === String(id));
  const trozo = p && /\/d\/([^\/?#]+)/.exec(p.evidencia || '');
  if (!trozo) return fallo_('Este pedido no tiene foto de entrega.');
  try {
    const blob = DriveApp.getFileById(trozo[1]).getBlob();
    return { ok: true, dataUrl: 'data:' + blob.getContentType() + ';base64,' + Utilities.base64Encode(blob.getBytes()) };
  } catch (e) {
    return fallo_('No se pudo abrir la foto.');
  }
}

function guardarEvidencia_(id, foto) {
  if (!foto || !foto.base64 || !/^image\/(jpeg|png|webp)$/.test(foto.mime || '')) throw new Error('Foto inválida.');
  const bytes = Utilities.base64Decode(foto.base64);
  if (bytes.length > 8 * 1024 * 1024) throw new Error('La foto es muy pesada.');
  if (!firmaImagen_(bytes, foto.mime)) throw new Error('El archivo no es una imagen válida.');
  const ext = foto.mime === 'image/png' ? 'png' : (foto.mime === 'image/webp' ? 'webp' : 'jpg');
  const blob = Utilities.newBlob(bytes, foto.mime, id + '-evidencia.' + ext);
  return carpetaEvidencias_().createFile(blob).getUrl();
}

function carpetaEvidencias_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(PROP_CARPETA);
  if (id) { try { return DriveApp.getFolderById(id); } catch (e) { /* se recrea abajo */ } }
  const carpeta = DriveApp.createFolder('Evidencias de entrega - ' + nombreLibro_());
  props.setProperty(PROP_CARPETA, carpeta.getId());
  return carpeta;
}
