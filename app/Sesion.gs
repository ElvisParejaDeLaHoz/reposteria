/* Usuarios, claves cifradas, sesión firmada y límite de acciones por persona. */

function iniciarSesion(usuario, clave) {
  usuario = norm_(usuario);
  clave = String(clave == null ? '' : clave);
  if (!usuario || !clave) return { ok: false, error: 'Escribe tu usuario y tu clave.' };

  const cache = CacheService.getScriptCache();
  const llave = 'intentos:' + usuario;
  const intentos = Number(cache.get(llave) || 0);
  if (intentos >= MAX_INTENTOS) {
    return { ok: false, error: 'Demasiados intentos fallidos. Espera 15 minutos e inténtalo otra vez.' };
  }

  const u = leerUsuarios_().lista.find(x => x.usuario === usuario);
  if (!u || !verificarClave_(u, clave)) {
    cache.put(llave, String(intentos + 1), 900);
    return { ok: false, error: 'Usuario o clave incorrectos.' };
  }
  if (!u.activo) return { ok: false, error: 'Tu usuario está deshabilitado. Habla con la administradora.' };
  if (!u.roles.length) return { ok: false, error: 'Tu usuario no tiene un rol asignado. Habla con la administradora.' };

  cache.remove(llave);
  const { hoja, m } = abrirUsuarios_();
  hoja.getRange(u.fila, m['Último ingreso']).setValue(new Date());
  return { ok: true, token: crearToken_(u), usuario: u.usuario, nombre: u.nombre, roles: u.roles, sexo: u.sexo, config: configPara_(u) };
}

function getSesion(token) {
  const u = sesion_(token);
  if (!u) return { ok: false, sesion: false };
  return { ok: true, usuario: u.usuario, nombre: u.nombre, roles: u.roles, sexo: u.sexo, config: configPara_(u) };
}

/** Máximo de acciones por persona y hora. Si la caché falla, no se bloquea a nadie. */
function excedeLimite_(usuario, tipo, max) {
  try {
    const cache = CacheService.getScriptCache();
    const k = 'rl-' + tipo + '-' + usuario;
    const ahora = Date.now();
    let d = null;
    try { d = JSON.parse(cache.get(k) || 'null'); } catch (e) { d = null; }
    if (!d || ahora - d.t > 3600000) d = { n: 0, t: ahora };
    d.n++;
    cache.put(k, JSON.stringify(d), 3600);
    return d.n > max;
  } catch (e) {
    return false;
  }
}

/** Los nombres que el negocio le puso a cada rol (hoja Configuración), para aceptarlos en la hoja Usuarios. */
function etiquetasRoles_() {
  if (ETIQUETAS_ROLES_) return ETIQUETAS_ROLES_;
  const out = [];
  try {
    const T = leerConfig_().terminos;
    [['Vendedora', T.vende], ['Decorador', T.prepara], ['Entregador', T.entrega], ['Administrador', T.admin]].forEach(par => {
      const formas = formasCargo_(par[1]);
      String(par[1]).split(',').concat([formas.m, formas.f]).forEach(x => {
        const n = norm_(x.replace(/\((f|m)\)\s*$/i, ''));
        if (n.length >= 3) out.push([n, par[0]]);
      });
    });
  } catch (e) { /* sin configuración: solo los nombres de fábrica */ }
  ETIQUETAS_ROLES_ = out;
  return out;
}

function parseRoles_(v) {
  const roles = [];
  String(v || '').toLowerCase().split(/[,;\/+\n]|\sy\s/).forEach(t => {
    t = t.trim();
    if (!t) return;
    let r = null;
    const propio = etiquetasRoles_().find(e => norm_(t) === e[0] || norm_(t).indexOf(e[0]) === 0);
    if (propio) r = propio[1];
    else if (/^vend|^venta/.test(t)) r = 'Vendedora';
    else if (/^deco/.test(t)) r = 'Decorador';
    else if (/^entreg|^domic|^repart|^mensaj/.test(t)) r = 'Entregador';
    else if (/^admin|^due[ñn]|^propiet|^gerent/.test(t)) r = 'Administrador';
    if (r && roles.indexOf(r) < 0) roles.push(r);
  });
  return roles;
}

function esSi_(v) { return /^(s[ií]|true|1|x|activo)$/i.test(limpiar_(v)); }

function leerUsuarios_() {
  const { hoja, m } = abrirUsuarios_();
  const n = hoja.getLastRow() - 1;
  const lista = [];
  if (n >= 1) {
    const vals = hoja.getRange(2, 1, n, hoja.getLastColumn()).getValues();
    const g = (f, k) => f[(m[k] || COLUMNAS_USUARIOS.indexOf(k) + 1) - 1];
    vals.forEach((f, i) => {
      const usuario = norm_(g(f, 'Usuario'));
      if (!usuario) return;
      lista.push({
        fila: i + 2,
        usuario: usuario,
        nombre: limpiar_(g(f, 'Nombre')) || usuario,
        roles: parseRoles_(g(f, 'Rol')),
        clave: limpiar_(g(f, 'Clave')),
        activo: esSi_(g(f, 'Activo')),
        ingreso: g(f, 'Último ingreso') instanceof Date ? g(f, 'Último ingreso').getTime() : 0,
        sexo: m['Sexo'] ? sexoDe_(g(f, 'Sexo')) : ''
      });
    });
  }
  return { hoja: hoja, m: m, lista: lista };
}

function secreto_() {
  const props = PropertiesService.getScriptProperties();
  let s = props.getProperty(PROP_SECRETO);
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty(PROP_SECRETO, s);
  }
  return s;
}

function hex_(bytes) { return bytes.map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join(''); }

function hash_(usuario, clave) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256, secreto_() + '|' + usuario + '|' + clave, Utilities.Charset.UTF_8);
  return 'h1:' + hex_(bytes);
}

function igual_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

/**
 * La administradora escribe la clave en la hoja Usuarios. En el primer ingreso
 * se reemplaza por su versión cifrada, así la clave deja de verse en la hoja.
 */
function verificarClave_(u, clave) {
  if (!u.clave) return false;
  if (u.clave.indexOf('h1:') === 0) return igual_(u.clave, hash_(u.usuario, clave));
  if (!igual_(u.clave, clave)) return false;
  const cifrada = hash_(u.usuario, clave);
  const { hoja, m } = abrirUsuarios_();
  hoja.getRange(u.fila, m['Clave']).setValue(cifrada);
  u.clave = cifrada;
  return true;
}

function firmar_(cuerpo, claveGuardada) {
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(cuerpo + '|' + claveGuardada, secreto_()));
}

/** El token se invalida solo si vence, si deshabilitan al usuario o si le cambian la clave. */
function crearToken_(u) {
  const cuerpo = u.usuario + '|' + (Date.now() + DIAS_SESION * 86400000);
  return Utilities.base64EncodeWebSafe(cuerpo) + '.' + firmar_(cuerpo, u.clave);
}

function sesion_(token) {
  if (!token || typeof token !== 'string') return null;
  const partes = token.split('.');
  if (partes.length !== 2) return null;
  let cuerpo;
  try { cuerpo = Utilities.newBlob(Utilities.base64DecodeWebSafe(partes[0])).getDataAsString(); }
  catch (e) { return null; }
  const i = cuerpo.lastIndexOf('|');
  if (i < 1) return null;
  const usuario = cuerpo.slice(0, i);
  const vence = Number(cuerpo.slice(i + 1));
  if (!(vence > Date.now())) return null;
  const u = leerUsuarios_().lista.find(x => x.usuario === usuario);
  if (!u || !u.activo || !u.roles.length) return null;
  if (!igual_(partes[1], firmar_(cuerpo, u.clave))) return null;
  return u;
}
