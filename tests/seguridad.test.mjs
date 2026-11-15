/* Pruebas de seguridad: qué se puede llamar sin haber entrado. La app está publicada para cualquiera con el enlace. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { APP, archivosGs } from './entorno.mjs';

const TODO = archivosGs().map(f => fs.readFileSync(path.join(APP, f), 'utf8')).join('\n');

function cuerpo(nombre) {
  const i = TODO.indexOf('function ' + nombre + '(');
  assert.ok(i >= 0, 'no existe ' + nombre);
  return TODO.slice(i, TODO.indexOf('\n}', i));
}

test('solo unas pocas funciones públicas se pueden llamar sin sesión', () => {
  // Si agregas una función pública sin token, revisa que no muestre ni cambie nada privado y agrégala aquí a propósito.
  const sinSesion = new Set([
    'doGet', 'getConfig', 'getLogo', 'getCambio', 'iniciarSesion', // pantalla de entrada
    'revisarActivacion', 'activarApp', // bienvenida: revisan el código de activación
    'configuracionInicial', 'verCodigoActivacion', 'activarCopiaDiaria', 'copiaDiaria', 'buscarChatsTelegram', 'probarTelegram' // editor o disparador
  ]);
  const encontradas = [...TODO.matchAll(/^function ([A-Za-z0-9]*[A-Za-z0-9])\(([^)]*)\)/gm)]
    .filter(m => !/^\s*token\b/.test(m[2]))
    .map(m => m[1]);
  assert.deepEqual(encontradas.filter(n => !sinSesion.has(n)), []);
});

test('la bienvenida no hace nada sin revisar el código de activación', () => {
  ['revisarActivacion', 'activarApp'].forEach(n => assert.match(cuerpo(n), /revisarCodigo_\(/, n));
  // activarApp también se niega si ya hay una administradora, aunque alguien tenga un código viejo.
  assert.match(cuerpo('activarApp'), /hayAdmin_\(\)/);
});

test('las funciones del editor no se pueden correr desde la página', () => {
  ['configuracionInicial', 'verCodigoActivacion', 'activarCopiaDiaria'].forEach(n => assert.match(cuerpo(n), /soloDueno_\(\)/, n));
});

test('getConfig no entrega el código de activación', () => {
  assert.doesNotMatch(cuerpo('getConfig'), /codigo:|PROP_ACTIVACION/);
});

test('las funciones con sesión revisan el token antes de todo', () => {
  const conToken = [...TODO.matchAll(/^function ([A-Za-z0-9]*[A-Za-z0-9])\(token\b/gm)].map(m => m[1]);
  assert.ok(conToken.length >= 15);
  conToken.forEach(n => {
    const primeras = cuerpo(n).split('\n').slice(1, 3).join('\n');
    assert.match(primeras, /sesion_\(token\)/, n + ' debe empezar con sesion_(token)');
  });
});

test('"cerrar sesión en todos los equipos": la sesión revisa el corte y solo quien administra cierra las de otros', () => {
  const sesion = cuerpo('sesion_');
  assert.match(sesion, /sesionesDesde_\(\)\[usuario\]/);
  const cerrar = cuerpo('cerrarSesiones');
  assert.match(cerrar, /usuario !== u\.usuario && !esAdmin_\(u\)/);
  assert.match(cerrar, /crearToken_\(u\)/, 'a quien cierra las suyas se le da una sesión nueva');
});
