<img src="docs/marca/archivos/elka-logo.svg" alt="Elka" height="56">

# Elka · Pedidos y finanzas para emprendedoras y emprendedores

*Ordenamos tu negocio, acompañamos tu crecimiento.*

App gratuita para negocios pequeños que toman pedidos, los preparan y los entregan (en el local o a domicilio), y que quieren ordenar sus finanzas. Funciona sobre Google Sheets y Google Apps Script: no hay servidores que pagar. El código es libre; Elka ofrece la instalación, el mantenimiento y el acompañamiento.

**Qué incluye:** pedidos por turnos, preparación y entrega con foto · abonos y saldo por pedido · costo de materiales · gastos fijos y variables · lo que se paga quien es dueño del negocio · **punto de equilibrio** y meta de sueldo · cuentas por cobrar con recordatorio por WhatsApp · cierre de caja diario · ventas por medio, pago y por quién vendió.

**Tipos de negocio con plantilla:** floristería, pastelería, óptica, restaurante, detalles y desayunos sorpresa, y uno genérico (`node herramientas/flota.mjs giros`).

## Estructura

| Carpeta | Qué hay |
|---|---|
| `app/*.gs` | Servidor, un archivo por tema. `00_Config.gs` tiene todas las constantes y carga primero. `Calculos.gs` tiene las cuentas y reglas puras (sin Google), que son las que prueban los tests. `Tabla.gs` es la clase para leer y escribir hojas |
| `app/Index.html` | Estructura de la pantalla. Es una plantilla que mete `Estilos.html` y los pedazos `Js*.html` (Base, Equipo, Pedido, Ventas, Finanzas, Tema) con `incluir_()` |
| `tests/` | Pruebas automáticas (`npm test`). `flota.mjs` las corre antes de instalar o actualizar y no publica nada si fallan |
| `herramientas/flota.mjs` | Instala y actualiza la app en el proyecto de cada negocio |
| `docs/` | Lo que se publica en GitHub Pages: la página de Elka (`docs/index.html`; contacto y precios se llenan al inicio del archivo), el manual de marca con logos y mensajes listos (`docs/marca/`) y una página por negocio (`docs/<id>/`) que muestra su app |
| `flota/config.json` | Dirección base de GitHub Pages |
| `flota/clientes.json` | Registro de negocios instalados. **Privado, no se sube a GitHub** |
| `VERSION` | Versión del código que se publica |

## Preparar el equipo (una vez)

1. Instalar Node 18 o más reciente y clasp: `npm install -g @google/clasp`
2. Activar la API de Apps Script en https://script.google.com/home/usersettings
3. Iniciar sesión con la cuenta de soporte: `clasp login` (o `clasp login --user soporte` para tener varias cuentas)
4. Poner en `flota/config.json` la dirección de GitHub Pages del repositorio.
5. En GitHub: Settings → Pages → Deploy from a branch → carpeta `/docs`.

## Instalar un negocio nuevo

```bash
node herramientas/flota.mjs instalar floristeria-rosa --nombre "Floristería Rosa" --giro floristeria --correo negocio@gmail.com
```

La herramienta crea la hoja y el proyecto, sube el código, publica la app, guarda los ids en el registro y genera `docs/floristeria-rosa/`. Después quedan 3 pasos a mano, que la misma herramienta muestra:

1. Abrir el editor, ejecutar `configuracionInicial` y aceptar los permisos. Google mostrará *"Google no ha verificado esta app"*: se sigue por *Configuración avanzada → Ir a…*. Al terminar, el registro muestra el **código de activación** (por ejemplo `K7QM-3XPA`). Ahí mismo queda programada la **copia de seguridad diaria** (carpeta "Copias de seguridad" en Drive, últimas 14).
2. Subir `docs/` a GitHub.
3. Mandarle al dueño o la dueña el enlace con el código: `https://<usuario>.github.io/<repo>/floristeria-rosa/?activar=K7QM-3XPA`.

La persona dueña abre el enlace y en 3 pasos pone el nombre del negocio, qué vende (con un ejemplo en vivo de cómo se verá), su color y logo, su nombre, sexo, usuario y clave, y sus gastos fijos. Con el sexo de cada persona la app escribe bien su cargo (Vendedora o Vendedor). El código sirve una sola vez. **No hace falta compartirle la hoja**: el equipo, los datos del negocio y el logo los cambia desde la app en **Ajustes** (enlace en la cabecera). La hoja queda para soporte. Después puede agregar la app a la pantalla de inicio del celular.

**Seguimiento para el cliente.** Al guardar un pedido, la app ofrece mandarle al cliente su enlace (`…/<id>/pedido/?c=<código>`). Ahí ve cómo va su pedido. Cuando lo recibe, puede calificarlo y compartir una tarjeta con la foto en su estado de WhatsApp. La página solo muestra el estado y las horas: nada de teléfonos, direcciones ni valores. El estado se guarda en memoria 5 minutos; si hay mucho tráfico, el cliente ve un mensaje amable y la página reintenta sola. Las calificaciones quedan en la hoja **Calificaciones** y en **Ventas**. Para que el cliente pueda volver a pedir, el negocio pone el WhatsApp del negocio en **Ajustes**.

- Si se pierde el código: en el editor, ejecutar `verCodigoActivacion`.
- Si alguien olvida su clave: escribir una clave nueva, sin cifrar, en su fila de la hoja **Usuarios**. Al entrar con ella se cifra sola.
- Los avisos por Telegram siguen en la hoja **Configuración** (son de soporte).

## Publicar una mejora para todos

1. Cambiar el código en `app/` y subir el número en `VERSION`.
2. Correr `npm test`. Si cambiaste una cuenta o una regla, agrega su prueba en `tests/calculos.test.mjs`.
3. Ejecutar:

```bash
node herramientas/flota.mjs actualizar --todos --nota "Gastos y cierre de caja"
```

Cada proyecto recibe el código nuevo y se actualiza **la misma** publicación, así que la dirección de la app no cambia. Si un negocio falla, los demás siguen y al final sale el resumen.

La versión publicada se ve al pie de **Ajustes** en la app de cada negocio. `VERSION`, `package.json` y `VERSION_APP` (en `00_Config.gs`) deben coincidir: las pruebas lo revisan.

Otros comandos: `listar` (quién está en qué versión), `actualizar <id>` (uno solo) y `paginas` (regenerar `docs/`).

## Importante

- **Haz copia de `flota/clientes.json`** en un lugar privado (Drive, por ejemplo). Ahí están los ids de todos los proyectos.
- Si una actualización agrega permisos nuevos en `appsscript.json` (por ejemplo, Gmail), hay que volver a autorizar cada proyecto desde su editor.
- Límites de Google por cuenta: unas 30 ejecuciones al mismo tiempo, 90 minutos al día de disparadores y 15 GB de Drive en una cuenta gratuita. Cuando haya muchos negocios, repártelos entre varias cuentas de soporte con `--cuenta`.
