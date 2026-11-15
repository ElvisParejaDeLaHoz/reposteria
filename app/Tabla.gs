/**
 * Una hoja del libro vista como tabla: la primera fila son los nombres de las columnas.
 *
 *   const t = new Tabla('Movimientos', ['ID', 'Fecha', 'Valor'], { 'Valor': '$#,##0' });
 *   t.agregar({ 'ID': 'M-1', 'Valor': 5000 });   // las columnas se buscan por nombre
 *   t.filas().forEach(f => f['Valor'] ...);      // cada fila trae también f._fila (número de fila)
 *   t.escribir(f._fila, { 'Valor': 6000 });
 *
 * Si la hoja no existe se crea con sus cabeceras y formatos. Si le faltan columnas (porque una
 * versión nueva agregó alguna), se agregan al final sin mover los datos que ya había.
 */
class Tabla {
  constructor(nombre, columnas, formatos) {
    const ss = obtenerLibro_();
    let hoja = ss.getSheetByName(nombre);
    if (!hoja) {
      hoja = ss.insertSheet(nombre);
      hoja.getRange(1, 1, 1, columnas.length).setValues([columnas])
        .setFontWeight('bold').setFontColor('#ffffff').setBackground('#17382C').setVerticalAlignment('middle');
      hoja.setFrozenRows(1);
      hoja.setRowHeight(1, 30);
      const filas = Math.max(hoja.getMaxRows() - 1, 1);
      Object.keys(formatos || {}).forEach(c => {
        const i = columnas.indexOf(c);
        if (i >= 0) hoja.getRange(2, i + 1, filas, 1).setNumberFormat(formatos[c]);
      });
    }
    const m = mapa_(hoja);
    let sig = hoja.getLastColumn() + 1;
    columnas.forEach(c => { if (!m[c]) { hoja.getRange(1, sig).setValue(c).setFontWeight('bold'); m[c] = sig++; } });
    this.hoja = hoja;
    this.m = m;
  }

  /** Filas de datos como objetos { 'Columna': valor, _fila: n }. `ultimas` limita a las N del final. */
  filas(ultimas) {
    const total = this.hoja.getLastRow() - 1;
    if (total < 1) return [];
    const desde = ultimas ? Math.max(2, this.hoja.getLastRow() - ultimas + 1) : 2;
    const vals = this.hoja.getRange(desde, 1, this.hoja.getLastRow() - desde + 1, this.hoja.getLastColumn()).getValues();
    const cols = Object.keys(this.m);
    return vals.map((f, i) => {
      const o = { _fila: desde + i };
      cols.forEach(c => { o[c] = f[this.m[c] - 1]; });
      return o;
    });
  }

  /** Agrega una fila al final con los valores de las columnas que vengan en `datos`. */
  agregar(datos) {
    const fila = new Array(this.hoja.getLastColumn()).fill('');
    Object.keys(datos).forEach(k => { if (this.m[k]) fila[this.m[k] - 1] = datos[k]; });
    this.hoja.appendRow(fila);
  }

  /** Cambia algunas columnas de una fila. */
  escribir(fila, datos) {
    escribir_(this.hoja, this.m, fila, datos);
  }

  /** Reemplaza todos los datos (no las cabeceras) por `filas`, cada una como objeto por columna. */
  reemplazar(filas) {
    const n = this.hoja.getLastRow();
    if (n > 1) this.hoja.getRange(2, 1, n - 1, this.hoja.getLastColumn()).clearContent();
    if (!filas.length) return;
    const ancho = this.hoja.getLastColumn();
    this.hoja.getRange(2, 1, filas.length, ancho).setValues(filas.map(d => {
      const f = new Array(ancho).fill('');
      Object.keys(d).forEach(k => { if (this.m[k]) f[this.m[k] - 1] = d[k]; });
      return f;
    }));
  }
}
