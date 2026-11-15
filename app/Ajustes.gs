/* Ajustes que la administradora cambia desde la app, sin abrir la hoja: datos del negocio, logo y equipo. */

function getAjustes(token) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  if (!esAdmin_(u)) return fallo_('Tu usuario no puede ver los ajustes.');
  const c = leerConfig_();
  return {
    ok: true,
    yo: u.usuario,
    negocio: {
      nombre: c.nombre, lema: c.lema, principal: c.principal, secundario: c.secundario,
      producto: c.terminos.producto, medios: c.medios.join(', '), pagos: c.pagos.join(', '),
      categorias: c.categorias.join(', '), minDesc: c.minDesc
    },
    usuarios: listaEquipo_()
  };
}

function listaEquipo_() {
  return leerUsuarios_().lista
    .map(x => ({ usuario: x.usuario, nombre: x.nombre, roles: x.roles, activo: x.activo, sinClave: !x.clave, ingreso: x.ingreso }))
    .sort((a, b) => (b.activo - a.activo) || a.nombre.localeCompare(b.nombre));
}

function guardarNegocio(token, datos) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  if (!esAdmin_(u)) return fallo_('Tu usuario no puede cambiar esto.');
  const r = validarNegocio_(datos);
  if (r.error) return fallo_(r.error);
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    Object.keys(r).forEach(k => escribirConfig_(ETIQUETAS_NEGOCIO[k], typeof r[k] === 'string' ? seguro_(r[k], 400) : r[k]));
    ETIQUETAS_ROLES_ = null;
    marcarCambio_();
  } finally {
    lock.releaseLock();
  }
  return { ok: true, config: configPara_(u) };
}

function subirLogo(token, foto) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  if (!esAdmin_(u)) return fallo_('Tu usuario no puede cambiar el logo.');
  try { guardarLogo_(foto); } catch (e) { return fallo_(e.message); }
  return { ok: true };
}

/** Crea una persona (datos.nuevo) o cambia su nombre, tareas, si está activa o su clave. */
function guardarUsuario(token, datos) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  if (!esAdmin_(u)) return fallo_('Tu usuario no puede cambiar el equipo.');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  let r;
  try {
    const usuarios = leerUsuarios_();
    r = validarUsuario_(datos, usuarios.lista, u.usuario);
    if (r.error) return fallo_(r.error);
    if (r.nuevo) agregarUsuario_(r);
    else cambiarUsuario_(usuarios.lista.find(x => x.usuario === r.usuario).fila, r);
  } finally {
    lock.releaseLock();
  }
  const out = { ok: true, usuarios: listaEquipo_() };
  // Cambiar la propia clave invalida la sesión: se entrega una nueva para no sacarla de la app.
  if (r.usuario === u.usuario && r.clave) out.token = crearToken_({ usuario: u.usuario, clave: hash_(u.usuario, r.clave) });
  return out;
}

function tablaUsuarios_() {
  abrirUsuarios_(); // crea la hoja con sus notas y validaciones si no existe
  return new Tabla(HOJA_USUARIOS, COLUMNAS_USUARIOS);
}

/** La clave se guarda cifrada de una vez: nunca queda visible en la hoja. */
function agregarUsuario_(r) {
  tablaUsuarios_().agregar({
    'Usuario': r.usuario, 'Nombre': seguro_(r.nombre, 60), 'Rol': r.roles.join(', '),
    'Clave': hash_(r.usuario, r.clave), 'Activo': r.activo ? 'Sí' : 'No'
  });
}

function cambiarUsuario_(fila, r) {
  const datos = { 'Nombre': seguro_(r.nombre, 60), 'Rol': r.roles.join(', '), 'Activo': r.activo ? 'Sí' : 'No' };
  if (r.clave) datos['Clave'] = hash_(r.usuario, r.clave);
  tablaUsuarios_().escribir(fila, datos);
}
