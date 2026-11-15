/* Pruebas de la activación (bienvenida) y de los ajustes del negocio y del equipo. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cargarServidor } from './entorno.mjs';

const servidor = cargarServidor();
/* Lo que viene del entorno aislado se pasa por JSON para compararlo como datos normales de Node. */
const g = new Proxy(servidor, {
  get: (o, k) => typeof o[k] === 'function'
    ? (...a) => { const r = o[k](...a); return r && typeof r === 'object' ? JSON.parse(JSON.stringify(r)) : r; }
    : o[k]
});

test('código de activación: 8 letras sin caracteres que se confunden, y se acepta como lo escriban', () => {
  const c = g.codigoDesdeBytes_([0, 1, 2, 3, 250, 251, 252, 253]);
  assert.match(c, /^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.doesNotMatch(c, /[01OIL]/);
  assert.equal(g.normCodigo_(' ' + c.toLowerCase().replace('-', ' ') + ' '), c);
  assert.equal(g.normCodigo_('ABC-123'), '');
  assert.equal(g.normCodigo_(''), '');
  assert.notEqual(g.codigoDesdeBytes_([9, 8, 7, 6, 5, 4, 3, 2]), c);
});

const EQUIPO = [
  { usuario: 'keila', roles: ['Administrador', 'Vendedora'], activo: true },
  { usuario: 'ana', roles: ['Vendedora'], activo: true },
  { usuario: 'luis', roles: ['Decorador'], activo: false }
];

test('agregar persona: usuario válido y libre, clave mínima, al menos una tarea', () => {
  const ok = g.validarUsuario_({ nuevo: true, usuario: ' Pedro ', nombre: 'Pedro Gómez', roles: ['Entregador', 'Inventado'], clave: 'secreta1' }, EQUIPO, 'keila');
  assert.equal(ok.usuario, 'pedro');
  assert.deepEqual(ok.roles, ['Entregador']);
  assert.equal(ok.activo, true);
  assert.match(g.validarUsuario_({ nuevo: true, usuario: 'ana', nombre: 'Otra Ana', roles: ['Vendedora'], clave: 'secreta1' }, EQUIPO, 'keila').error, /Ya existe/);
  assert.match(g.validarUsuario_({ nuevo: true, usuario: 'josé m', nombre: 'José', roles: ['Vendedora'], clave: 'secreta1' }, EQUIPO, 'keila').error, /sin espacios/);
  assert.match(g.validarUsuario_({ nuevo: true, usuario: 'pedro', nombre: 'Pedro', roles: ['Vendedora'], clave: '123' }, EQUIPO, 'keila').error, /al menos 6/);
  assert.match(g.validarUsuario_({ nuevo: true, usuario: 'pedro', nombre: 'Pedro', roles: [], clave: 'secreta1' }, EQUIPO, 'keila').error, /tarea/);
});

test('cambiar persona: la clave es opcional y no se puede editar a alguien que no existe', () => {
  const r = g.validarUsuario_({ usuario: 'ana', nombre: 'Ana Rojas', roles: ['Vendedora', 'Entregador'], clave: '', activo: false }, EQUIPO, 'keila');
  assert.equal(r.clave, '');
  assert.equal(r.activo, false);
  assert.match(g.validarUsuario_({ usuario: 'nadie', nombre: 'Nadie', roles: ['Vendedora'] }, EQUIPO, 'keila').error, /ya no está/);
});

test('la administradora no se puede dejar por fuera ni dejar el negocio sin administración', () => {
  assert.match(g.validarUsuario_({ usuario: 'keila', nombre: 'Keila', roles: ['Administrador'], activo: false }, EQUIPO, 'keila').error, /desactivarte/);
  assert.match(g.validarUsuario_({ usuario: 'keila', nombre: 'Keila', roles: ['Vendedora'], activo: true }, EQUIPO, 'keila').error, /administradora/);
  // Otra administradora sí la puede cambiar, siempre que quede al menos una activa.
  const dos = EQUIPO.concat([{ usuario: 'elvis', roles: ['Administrador'], activo: true }]);
  assert.equal(g.validarUsuario_({ usuario: 'keila', nombre: 'Keila', roles: ['Vendedora'] }, dos, 'elvis').error, undefined);
  assert.match(g.validarUsuario_({ usuario: 'keila', nombre: 'Keila', roles: ['Vendedora'] }, EQUIPO, 'elvis').error, /al menos una persona activa/);
});

test('datos del negocio: solo se revisan los que vienen, y las listas quedan limpias', () => {
  assert.deepEqual(g.validarNegocio_({ nombre: '  Dulce Tentación ' }), { nombre: 'Dulce Tentación' });
  const r = g.validarNegocio_({ principal: 'c0245e', medios: 'WhatsApp, , Instagram,whatsapp', minDesc: '3' });
  assert.equal(r.principal, '#C0245E');
  assert.equal(r.medios, 'WhatsApp, Instagram');
  assert.equal(r.minDesc, 3);
  assert.match(g.validarNegocio_({ nombre: 'A' }).error, /nombre/);
  assert.match(g.validarNegocio_({ principal: 'rojo' }).error, /color/);
  assert.match(g.validarNegocio_({ pagos: ' , ' }).error, /método de pago/);
  assert.match(g.validarNegocio_({ minDesc: 0 }).error, /entre 1 y 200/);
});

test('activación: negocio, usuario y clave obligatorios; gastos opcionales; "lo hago todo yo" da todas las tareas', () => {
  const base = { negocio: 'Dulce Tentación', producto: 'torta (f)', principal: '#2F7D4F', nombre: 'Keila Cabarcas', usuario: 'keila', clave: 'secreta1' };
  const sola = g.validarActivacion_(Object.assign({ todoYo: true }, base), []);
  assert.deepEqual(sola.admin.roles, ['Vendedora', 'Decorador', 'Entregador', 'Administrador']);
  assert.deepEqual(sola.fijos, []);
  assert.equal(sola.sueldo, 0);
  const conEquipo = g.validarActivacion_(Object.assign({ todoYo: false, fijos: [{ concepto: 'Arriendo', valor: 800000 }], sueldo: 1500000 }, base), []);
  assert.deepEqual(conEquipo.admin.roles, ['Administrador']);
  assert.equal(conEquipo.fijos.length, 1);
  assert.equal(conEquipo.sueldo, 1500000);
  // Las filas de ejemplo de la hoja Usuarios no estorban, pero un usuario repetido sí.
  assert.match(g.validarActivacion_(Object.assign({}, base, { usuario: 'ana' }), [{ usuario: 'ana', roles: ['Vendedora'], activo: false }]).error, /Ya existe/);
  assert.match(g.validarActivacion_(Object.assign({}, base, { negocio: '' }), []).error, /nombre de tu negocio/);
  assert.match(g.validarActivacion_(Object.assign({}, base, { principal: undefined }), []).error, /color/);
});
