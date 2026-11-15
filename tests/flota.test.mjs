/* Pruebas de la herramienta de instalación, sin tocar Google. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { copiarApp, archivosApp } from '../herramientas/flota.mjs';

test('copia todos los archivos de app/, borra los viejos y agrega el tipo de negocio', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elka-flota-'));
  fs.writeFileSync(path.join(dir, 'Code.gs'), 'function viejo() {}');
  copiarApp(dir, { giro: 'pasteleria' });
  const hay = fs.readdirSync(dir).filter(f => /\.(gs|html|json)$/.test(f)).sort();
  assert.ok(!hay.includes('Code.gs'), 'el Code.gs viejo debe borrarse');
  assert.deepEqual(hay, archivosApp().concat('Giro.gs').sort());
  assert.match(fs.readFileSync(path.join(dir, 'Giro.gs'), 'utf8'), /"Nombre del producto": "torta \(f\)"/);
  const ignorar = fs.readFileSync(path.join(dir, '.claspignore'), 'utf8');
  hay.forEach(f => assert.ok(ignorar.includes('!' + f), f + ' debe subirse'));
  fs.rmSync(dir, { recursive: true, force: true });
});

test('sin tipo de negocio no se crea Giro.gs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'elka-flota-'));
  copiarApp(dir, {});
  assert.ok(!fs.existsSync(path.join(dir, 'Giro.gs')));
  fs.rmSync(dir, { recursive: true, force: true });
});
