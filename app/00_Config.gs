/**
 * ELKA · PEDIDOS Y FINANZAS PARA EMPRENDEDORAS
 *
 * Web app de Google Apps Script para negocios que toman pedidos, los preparan y los entregan.
 * Módulos según el rol: quien vende, quien prepara, quien entrega y quien administra (con Finanzas).
 * Todo se guarda en el libro de Google Sheets donde vive este proyecto.
 *
 * PRIMERA VEZ: ejecuta `configuracionInicial` desde el editor y acepta los permisos.
 * Las instalaciones y actualizaciones se hacen con herramientas/flota.mjs.
 *
 * Este archivo tiene TODAS las constantes. Va primero (00_) porque Apps Script carga los archivos
 * en orden y una constante no puede usar otra que todavía no existe.
 */

const NOMBRE_LIBRO = 'Pedidos de arreglos';

const HOJA_PEDIDOS = 'Pedidos';

const HOJA_USUARIOS = 'Usuarios';

const HOJA_STATS = 'Estadísticas';

const HOJA_CONTA = 'Contabilidad';

const PROP_LIBRO = 'ID_LIBRO_PEDIDOS';

const PROP_SECRETO = 'SECRETO_SESIONES';

const PROP_CARPETA = 'ID_CARPETA_EVIDENCIAS';

const PROP_CARPETA_LOGO = 'ID_CARPETA_LOGO';

const MAX_LOGO = 1.5 * 1024 * 1024;

const DIAS_SESION = 14;

const MAX_INTENTOS = 5;

const HOJA_CONFIG = 'Configuración';

/* Valores de fábrica; se cambian desde la hoja "Configuración". */
const CONFIG_DEF = {
  nombre: 'Pedidos de arreglos',
  lema: 'Registra, arma y entrega cada pedido a tiempo.',
  principal: '#C0245E',
  secundario: '#17382C',
  modo: 'auto',
  terminos: {
    producto: 'arreglo', dedicatoria: 'dedicatoria',
    vende: 'Vendedora', prepara: 'Decorador', entrega: 'Entregador', admin: 'Administrador',
    ejemplo: 'Ej. Ramo de 12 rosas rojas con eucalipto, papel kraft y lazo guinda. Tamaño mediano, con 3 girasoles.',
    pista: 'Incluye flores y colores, tamaño, base o florero, adicionales y lo que pidió el cliente.'
  },
  medios: ['WhatsApp', 'Instagram', 'Facebook', 'Llamada', 'En el local', 'Página web', 'Otro'],
  pagos: ['Efectivo', 'Transferencia', 'Nequi', 'Daviplata', 'Datáfono', 'Ya pagado'],
  minDesc: 20,
  categorias: ['Insumos y materiales', 'Empaques', 'Transporte', 'Publicidad', 'Arriendo', 'Servicios públicos',
    'Internet y teléfono', 'Nómina', 'Mantenimiento', 'Impuestos', 'Otros'],
  sueldo: 0
};

const ESTADOS = ['Pendiente', 'En preparación', 'Listo', 'En camino', 'Entregado', 'Cancelado'];

const COLUMNAS = [
  'ID', 'Registrado', 'Vendedora', 'Medio de venta', 'Cliente', 'Para quién',
  'Descripción del arreglo', 'Entrega', 'Método de pago', 'Dirección', 'Teléfono',
  'Fecha entrega', 'Hora entrega', 'Valor producto', 'Valor domicilio', 'Total',
  'Dedicatoria', 'Texto dedicatoria', 'Estado', 'Decorador', 'Inicio preparación',
  'Listo el', 'Entregó', 'Salió el', 'Entregado el', 'Recibió', 'Evidencia',
  'Cancelación', 'Editado el', 'Editó', 'Abonado', 'Costo'
];

const COLUMNAS_USUARIOS = ['Usuario', 'Nombre', 'Rol', 'Clave', 'Activo', 'Último ingreso'];

const ROLES_APP = ['Vendedora', 'Decorador', 'Entregador', 'Administrador'];

/* Activación: código de un solo uso que deja a la dueña configurar su app sin tocar la hoja. */
const PROP_ACTIVACION = 'CODIGO_ACTIVACION';

const ALFABETO_CODIGO = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O, 1/I/L para que no se confundan al dictarlo

const MAX_FALLOS_ACTIVACION = 10; // por hora, para todo el proyecto: impide adivinar el código a la fuerza

const MIN_CLAVE = 6;

/* Qué fila de la hoja Configuración cambia cada dato del negocio que se edita desde la app. */
const ETIQUETAS_NEGOCIO = {
  nombre: 'Nombre del negocio', lema: 'Frase de bienvenida', principal: 'Color principal', secundario: 'Color secundario',
  producto: 'Nombre del producto', medios: 'Medios de venta', pagos: 'Métodos de pago',
  categorias: 'Categorías de gastos', minDesc: 'Mínimo de letras en la descripción'
};

const FILAS_CONFIG = [
  ['Nombre del negocio', CONFIG_DEF.nombre, 'Sale en la pantalla de entrada y en la pestaña del navegador.'],
  ['Frase de bienvenida', CONFIG_DEF.lema, 'Texto corto bajo el nombre, en la pantalla de entrada.'],
  ['Color principal', CONFIG_DEF.principal, 'Botones, resaltados y avisos. Formato #RRGGBB. Usa un color oscuro o medio: el texto de los botones es blanco.'],
  ['Color secundario', CONFIG_DEF.secundario, 'Barras de título, tarjetas oscuras y gráficas. Formato #RRGGBB. Usa un color oscuro.'],
  ['Modo de pantalla', 'Automático', 'Claro, Oscuro o Automático (sigue el modo del celular o computador). Cada persona puede cambiarlo en su pantalla.'],
  ['Medios de venta', CONFIG_DEF.medios.join(', '), 'Por dónde llega el pedido. Sepáralos con comas (máximo 30). Los pedidos ya guardados no cambian.'],
  ['Métodos de pago', CONFIG_DEF.pagos.join(', '), 'Cómo paga el cliente. Sepáralos con comas (máximo 30). Los pedidos ya guardados no cambian.'],
  ['Nombre del producto', CONFIG_DEF.terminos.producto, 'Qué vendes: arreglo, torta, ramo… En singular. Si el plural no es con "s", escríbelo después de una coma. Para femenino pon (f) al final: "torta (f)".'],
  ['Nombre de la dedicatoria', CONFIG_DEF.terminos.dedicatoria, 'Cómo le dices al mensaje de la tarjeta: dedicatoria, nota, mensaje…'],
  ['Rol: quien vende', CONFIG_DEF.terminos.vende, 'Nombre de quien toma los pedidos. En la hoja Usuarios puedes escribir este nombre o el original, ambos funcionan.'],
  ['Rol: quien prepara', CONFIG_DEF.terminos.prepara, 'Nombre de quien arma o produce el pedido (decorador, costurera, cocinero…).'],
  ['Rol: quien entrega', CONFIG_DEF.terminos.entrega, 'Nombre de quien lleva el pedido (entregador, domiciliario, repartidor…).'],
  ['Rol: quien administra', CONFIG_DEF.terminos.admin, 'Nombre de quien ve las ventas y la contabilidad (administrador, dueña, gerente…).'],
  ['Ejemplo de descripción', CONFIG_DEF.terminos.ejemplo, 'Texto gris de ejemplo en el formulario de pedido.'],
  ['Qué incluir en la descripción', CONFIG_DEF.terminos.pista, 'Recordatorio bajo la descripción del pedido.'],
  ['Mínimo de letras en la descripción', String(CONFIG_DEF.minDesc), 'Cuántas letras pide como mínimo la descripción del pedido. En un restaurante, 3 basta ("1 corriente").'],
  ['Categorías de gastos', CONFIG_DEF.categorias.join(', '), 'En qué se va la plata. Sepáralas con comas (máximo 30). Sirven para ver en Finanzas dónde se gasta más.'],
  ['Sueldo que quiero ganarme', String(CONFIG_DEF.sueldo), 'Cuánto quieres ganarte al mes como dueña. Con esto, Finanzas te dice cuánto vender para pagar todo y además tu sueldo. También se cambia desde la app.'],
  ['Telegram: activo', 'No', 'Escribe Sí para mandar avisos por Telegram. Pasos: 1) En Telegram abre @BotFather, escribe /newbot y copia el token. 2) Crea un grupo, agrega el bot y a tu equipo (o usa chats personales). 3) Pega el token y los números de chat aquí abajo. 4) En el editor de Apps Script ejecuta buscarChatsTelegram para ver los números y probarTelegram para probar.'],
  ['Telegram: token del bot', '', 'El token que te da @BotFather. No compartas esta hoja con nadie más.'],
  ['Telegram: chats de quien vende', '', 'Números de chat (separados por comas) que reciben avisos de pedidos listos, en camino, entregados y cancelados. Un grupo tiene número negativo, como -1001234567890.'],
  ['Telegram: chats de quien prepara', '', 'Reciben los pedidos nuevos, modificados, en preparación y cancelados antes de estar listos.'],
  ['Telegram: chats de quien entrega', '', 'Reciben los pedidos listos para entrega, en camino, entregados y cancelados.'],
  ['Telegram: chats de quien administra', '', 'Reciben todos los avisos.'],
  ['Telegram: avisos', 'nuevo, editado, empezó, listo, salió, entregado, cancelado', 'Qué avisos se mandan. Borra de la lista los que no quieras.']
];

/* Dentro de una misma llamada la configuración se lee una sola vez (antes se leía varias veces por petición). */
let CONFIG_MEMO_ = null;

const EVENTOS_AVISO = ['nuevo', 'editado', 'empezo', 'listo', 'salio', 'entregado', 'cancelado'];

let COLA_AVISOS_ = [];

const DIAS_COPIAS = 14;

const MAX_DETALLE = 400;

const HOJA_MOVS = 'Movimientos';

const HOJA_FIJOS = 'Gastos fijos';

const HOJA_CIERRES = 'Cierres de caja';

const COLUMNAS_MOVS = ['ID', 'Fecha', 'Tipo', 'Clase', 'Categoría', 'Descripción', 'Valor', 'Método', 'Pedido', 'Registró', 'Registrado', 'Anulado'];

const COLUMNAS_FIJOS = ['Concepto', 'Valor mensual'];

const COLUMNAS_CIERRES = ['Fecha', 'Base', 'Entradas en efectivo', 'Salidas en efectivo', 'Esperado', 'Contado', 'Diferencia', 'Nota', 'Registró', 'Registrado'];

const TIPOS_MOV = ['Ingreso', 'Gasto', 'Retiro'];

const MAX_MOVS_LISTA = 300;

const CAMPOS_BASE = ['id', 'fecha', 'hora', 'cliente', 'para', 'descripcion', 'entrega', 'estado', 'orden', 'turno', 'turnosDia', 'editadoMs'];

const CAMPOS_ROL = {
  Vendedora: ['vendedora', 'medio', 'pago', 'direccion', 'telefono', 'valorProducto', 'valorDomicilio', 'total',
    'dedicatoria', 'textoDedicatoria', 'decorador', 'inicioPrep', 'listoEl', 'entregador',
    'salioEl', 'entregadoEl', 'recibio', 'conEvidencia', 'abonado', 'saldo', 'controlPago'],
  Decorador: ['dedicatoria', 'textoDedicatoria', 'decorador', 'inicioPrep', 'listoEl'],
  Entregador: ['direccion', 'telefono', 'pago', 'total', 'listoEl', 'entregador', 'salioEl', 'entregadoEl', 'recibio', 'conEvidencia',
    'abonado', 'saldo', 'controlPago'],
  // El costo solo lo ve quien administra: a los empleados no les corresponde ver los márgenes.
  Administrador: ['costo']
};

/* Topes de seguridad: lo que no cabe en una celda o no tiene sentido se rechaza. */
const TOPES = { cliente: 80, para: 80, descripcion: 1000, direccion: 200, telefono: 20, dedicatoria: 300, motivo: 200, recibio: 80 };

const MAX_VALOR_PRODUCTO = 50000000;

const MAX_VALOR_DOMICILIO = 5000000;

const DIAS_ATRAS = 31;

const DIAS_ADELANTE = 366;

const LIMITE_PEDIDOS_HORA = 150; // un restaurante en hora pico puede tomar muchos pedidos seguidos

const LIMITE_EDICIONES_HORA = 60;

const LIMITE_ACCIONES_HORA = 300;

let ETIQUETAS_ROLES_ = null;

const COLOR_ESTADO = {
  'Pendiente': ['#FBE6EE', '#6E0F32'],
  'En preparación': ['#F6F1DE', '#5B4A0E'],
  'Listo': ['#E3F0EA', '#17382C'],
  'En camino': ['#DDE8F3', '#1F3F5F'],
  'Entregado': ['#17382C', '#FFFFFF'],
  'Cancelado': ['#EEEEEE', '#777777']
};

const ANCHOS = {
  'ID': 150, 'Registrado': 140, 'Vendedora': 130, 'Medio de venta': 120, 'Cliente': 150,
  'Para quién': 150, 'Descripción del arreglo': 380, 'Entrega': 100, 'Método de pago': 120,
  'Dirección': 240, 'Fecha entrega': 110, 'Hora entrega': 90, 'Valor producto': 120,
  'Valor domicilio': 120, 'Total': 110, 'Dedicatoria': 100, 'Texto dedicatoria': 280,
  'Estado': 130, 'Decorador': 120, 'Inicio preparación': 140, 'Listo el': 140, 'Entregó': 120,
  'Salió el': 140, 'Entregado el': 140, 'Recibió': 140, 'Evidencia': 260,
  'Teléfono': 120, 'Cancelación': 260, 'Editado el': 140, 'Editó': 120, 'Abonado': 110, 'Costo': 110
};
