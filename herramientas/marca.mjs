#!/usr/bin/env node
/**
 * Genera los logos de Elka en docs/marca/archivos/.
 *   node herramientas/marca.mjs
 *
 * El símbolo es un brote: un tallo curvo que sale de la tierra, con una hoja verde
 * (la tecnología) y una coral más arriba (el acompañamiento). Si cambias el dibujo,
 * cámbialo aquí y vuelve a correr el comando; no edites los .svg a mano.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SALIDA = path.join(RAIZ, 'docs', 'marca', 'archivos');

export const C = { verde: '#1F5E4A', coral: '#E9785A', coralClaro: '#F3A189', tinta: '#1E2A28', arena: '#FBF6EF', blanco: '#FFFFFF' };

/* Trazos del símbolo, en una caja de 64 × 64. */
export const TRAZOS = {
  tierra: 'M16 58.5Q32 52.5 48 58.5',
  tallo: 'M32 56C32 46.5 29.8 40.5 31.4 33.5C32.6 28.3 34.4 25.2 34.9 23.6',
  hojaA: 'M31 40.5C22 46.5 8.5 41.5 5 25C18 21.5 29 27.5 31 40.5Z',
  venaA: 'M29.6 39C24.5 35.2 18.5 31.2 12.5 28.2',
  hojaB: 'M35 22.5C33.5 9.5 44.5 1.5 60 2.5C60.5 16.5 50 26 35 22.5Z',
  venaB: 'M36.6 21C41.5 17 46.5 12.6 52.5 8.2'
};

/** El símbolo con sus colores: tallo y tierra, hoja A (abajo), hoja B (arriba) y venas. */
export function simbolo({ tallo, hojaA, hojaB, vena }) {
  const T = TRAZOS;
  return `<path d="${T.tierra}" fill="none" stroke="${tallo}" stroke-width="5" stroke-linecap="round"/>
  <path d="${T.tallo}" fill="none" stroke="${tallo}" stroke-width="5" stroke-linecap="round"/>
  <path d="${T.hojaA}" fill="${hojaA}"/>
  <path d="${T.hojaB}" fill="${hojaB}"/>
  <path d="${T.venaA}" fill="none" stroke="${vena}" stroke-width="1.3" stroke-linecap="round" opacity=".5"/>
  <path d="${T.venaB}" fill="none" stroke="${vena}" stroke-width="1.3" stroke-linecap="round" opacity=".5"/>`;
}

/** La palabra "elka" dibujada con trazos (no depende de ninguna fuente). Caja de 120 × 54. */
export function palabra(color) {
  return `<g fill="none" stroke="${color}" stroke-width="7" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3.5 35H31.5A14 14 0 1 0 27.4 44.9"/>
    <path d="M45 4V50"/>
    <path d="M58 4V50M74 20L58.5 37M65 30L75 50"/>
    <circle cx="101" cy="35" r="14"/>
    <path d="M115 21V50"/>
  </g>`;
}

const COLOR = { tallo: C.verde, hojaA: C.verde, hojaB: C.coral, vena: C.arena };
const BLANCO = { tallo: C.blanco, hojaA: C.blanco, hojaB: C.coralClaro, vena: C.verde };
const NEGRO = { tallo: C.tinta, hojaA: C.tinta, hojaB: C.tinta, vena: C.blanco };

const svg = (vb, cuerpo) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" role="img" aria-label="Elka">\n  <title>Elka</title>\n  ${cuerpo}\n</svg>\n`;
const horizontal = (s, p) => `${simbolo(s)}\n  <g transform="translate(72 6.5)">${palabra(p)}</g>`;
const vertical = (s, p) => `<g transform="translate(20 0) scale(1.25)">${simbolo(s)}</g>\n  <g transform="translate(0 86)">${palabra(p)}</g>`;

export function archivos() {
  return {
    'elka-simbolo.svg': svg('0 0 64 64', simbolo(COLOR)),
    'elka-simbolo-blanco.svg': svg('0 0 64 64', simbolo(BLANCO)),
    'elka-logo.svg': svg('0 0 194 64', horizontal(COLOR, C.tinta)),
    'elka-logo-blanco.svg': svg('0 0 194 64', horizontal(BLANCO, C.blanco)),
    'elka-logo-negro.svg': svg('0 0 194 64', horizontal(NEGRO, C.tinta)),
    'elka-logo-vertical.svg': svg('0 0 120 140', vertical(COLOR, C.tinta)),
    'elka-icono.svg': svg('0 0 512 512', `<rect width="512" height="512" rx="112" fill="${C.verde}"/>\n  <g transform="translate(64 50) scale(6)">${simbolo(BLANCO)}</g>`),
    'elka-perfil.svg': svg('0 0 1080 1080', `<rect width="1080" height="1080" fill="${C.arena}"/>\n  <g transform="translate(252 240) scale(9)">${simbolo(COLOR)}</g>`)
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  fs.mkdirSync(SALIDA, { recursive: true });
  const a = archivos();
  Object.entries(a).forEach(([n, s]) => fs.writeFileSync(path.join(SALIDA, n), s));
  console.log('Logos generados en docs/marca/archivos/: ' + Object.keys(a).join(', '));
}
