/*
 * Activación: la dueña configura su app desde el celular, sin abrir la hoja de cálculo.
 *
 * 1. configuracionInicial (o verCodigoActivacion) crea un código de un solo uso, como "K7QM-3XPA",
 *    mientras no haya nadie que administre el negocio.
 * 2. Elka le manda a la dueña el enlace de su app con ?activar=K7QM-3XPA (o le dicta el código).
 * 3. Ella llena la pantalla de bienvenida: su negocio, su usuario y clave, y sus gastos fijos.
 * 4. Al terminar, el código se borra y la pantalla de bienvenida no vuelve a aparecer.
 *
 * Sin el código nadie puede activarla: la app está publicada para cualquiera con el enlace.
 */

/** Hay alguien activo, con clave, que administra el negocio. */
function hayAdmin_() {
  return leerUsuarios_().lista.some(u => u.activo && u.clave && u.roles.indexOf('Administrador') >= 0);
}

function codigoActivacion_() {
  return PropertiesService.getScriptProperties().getProperty(PROP_ACTIVACION) || '';
}

/** Crea el código si todavía no hay quien administre. Devuelve el código vigente, o '' si ya está activada. */
function prepararActivacion_() {
  const props = PropertiesService.getScriptProperties();
  if (hayAdmin_()) { props.deleteProperty(PROP_ACTIVACION); return ''; }
  let c = props.getProperty(PROP_ACTIVACION);
  if (!c) {
    // getUuid usa un generador seguro. Se toman los 4 primeros bytes de dos UUID (los demás tienen partes fijas).
    const bytes = [];
    [Utilities.getUuid(), Utilities.getUuid()].forEach(u => {
      const hex = u.replace(/-/g, '');
      for (let i = 0; i < 8; i += 2) bytes.push(parseInt(hex.substr(i, 2), 16));
    });
    c = codigoDesdeBytes_(bytes);
    props.setProperty(PROP_ACTIVACION, c);
  }
  return c;
}

/** Ejecutar desde el editor: muestra el código para mandarle a la dueña (lo crea si hace falta). */
function verCodigoActivacion() {
  soloDueno_();
  const c = prepararActivacion_();
  Logger.log(c
    ? 'Código de activación: ' + c + '\nMándale a la dueña el enlace de su app terminado en ?activar=' + c + ' (o dale el código: en la pantalla de entrada toca "Activar mi app").'
    : 'Esta app ya está activada: hay una persona activa que la administra.');
}

/** Devuelve '' si el código sirve, o el motivo por el que no. Cuenta los fallos para que no se pueda adivinar. */
function revisarCodigo_(codigo) {
  const cache = CacheService.getScriptCache();
  const fallos = Number(cache.get('fallos-activacion') || 0);
  if (fallos >= MAX_FALLOS_ACTIVACION) return 'Demasiados intentos con códigos equivocados. Espera una hora e inténtalo otra vez.';
  const vigente = codigoActivacion_();
  if (!vigente) return 'Esta app ya fue activada. Entra con tu usuario y tu clave.';
  if (!igual_(normCodigo_(codigo), vigente)) {
    cache.put('fallos-activacion', String(fallos + 1), 3600);
    return 'Ese código no es correcto. Revísalo o pídeselo de nuevo a Elka.';
  }
  return '';
}

/** Se llama sin sesión, con el código. Devuelve lo que ya trae la app para llenar la pantalla de bienvenida. */
function revisarActivacion(codigo) {
  const error = revisarCodigo_(codigo);
  if (error) return fallo_(error);
  const c = leerConfig_();
  return {
    ok: true,
    negocio: NOMBRES_DE_FABRICA.indexOf(c.nombre) >= 0 ? '' : c.nombre,
    producto: c.terminos.producto,
    principal: c.principal,
    terminos: c.terminos,
    fijos: leerFijos_(),
    sueldo: c.sueldo
  };
}

/** Se llama sin sesión. Guarda todo lo de la bienvenida, borra el código y deja a la dueña adentro. */
function activarApp(codigo, datos) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let admin;
  try {
    const error = revisarCodigo_(codigo);
    if (error) return fallo_(error);
    if (hayAdmin_()) {
      PropertiesService.getScriptProperties().deleteProperty(PROP_ACTIVACION);
      return fallo_('Esta app ya fue activada. Entra con tu usuario y tu clave.');
    }
    const r = validarActivacion_(datos, leerUsuarios_().lista);
    if (r.error) return fallo_(r.error);
    // El logo va primero: si la imagen no sirve, no se guarda nada y ella puede intentar de nuevo.
    if (datos && datos.logo) {
      try { guardarLogo_(datos.logo); } catch (e) { return fallo_(e.message); }
    }
    Object.keys(r.negocio).forEach(k => escribirConfig_(ETIQUETAS_NEGOCIO[k], seguro_(r.negocio[k], 60)));
    agregarUsuario_(r.admin);
    if (r.fijos.length) tablaFijos_().reemplazar(r.fijos.map(x => ({ 'Concepto': seguro_(x.concepto, 60), 'Valor mensual': x.valor })));
    escribirConfig_('Sueldo que quiero ganarme', r.sueldo);
    PropertiesService.getScriptProperties().deleteProperty(PROP_ACTIVACION);
    marcarCambio_();
    admin = r.admin;
  } finally {
    lock.releaseLock();
  }
  return iniciarSesion(admin.usuario, admin.clave);
}
