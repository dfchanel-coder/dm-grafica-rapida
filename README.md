# DM Comunicación Visual — Tienda online

Tienda con catálogo, carrito, checkout de invitado (sin registro), pago con **Mercado Pago**,
cotización de trabajos a medida, correos transaccionales y **panel de administración completo**.

- **Negocio:** DM Comunicación Visual / DM Comunicación Visual / DM Impresos — Rivera, Uruguay
- **Compras:** sin cuenta de cliente. Cada pedido tiene un código (DMR-XXXXXX) y se sigue con
  código + correo.
- **Stack:** Node.js 22+ · Express 5 · PostgreSQL · HTML + CSS + JS nativo (sin build, sin framework)

---

## 1. Puesta en marcha local

```bash
npm install
cp .env.example .env      # Windows: copy .env.example .env
```

Completá `.env` como mínimo con:

```env
DATABASE_URL=postgresql://usuario:clave@localhost:5432/dm_grafica
PUBLIC_BASE_URL=http://localhost:3000
```

Luego:

```bash
npm run migrate     # crea el esquema y carga el catálogo inicial
npm run admin:create   # crea el usuario del panel
npm run dev         # http://localhost:3000
```

El panel queda en **http://localhost:3000/admin**.

### Comandos disponibles

| Comando | Qué hace |
| --- | --- |
| `npm start` | Ejecuta las migraciones pendientes y levanta el servidor. |
| `npm run dev` | Servidor con recarga automática (no corre migraciones). |
| `npm run migrate` | Aplica las migraciones que faltan. |
| `npm run admin:create` | Crea o restablece un administrador. |
| `npm run catalog:import` | Importa un catálogo JSON a la base de datos. |
| `npm run check:text` | Revisa que los textos estén en UTF-8 y sin caracteres corruptos. |
| `npm test` | Pruebas unitarias y de integración SQL con PostgreSQL en memoria (PGlite). |

---

## 2. Variables de entorno

| Variable | Para qué | Obligatoria |
| --- | --- | --- |
| `NODE_ENV` | `development` / `production` | No |
| `PORT` | Puerto del servidor (3000 por defecto) | No |
| `DATABASE_URL` | Conexión a PostgreSQL | **Sí** |
| `DATABASE_SSL` | `true` cuando el proveedor requiere TLS; se verifica su certificado | No |
| `DATABASE_SSL_CA` | Certificado PEM del proveedor si usa una CA propia (saltos como `\n`) | No |
| `PG_POOL_MAX` | Conexiones máximas del pool | No |
| `PUBLIC_BASE_URL` | URL pública del sitio, sin barra final. Define URLs canónicas, sitemap y los links del correo al panel | **Sí** |
| `MERCADOPAGO_MODE` | `sandbox` o `production` | **Sí** |
| `MERCADOPAGO_ACCESS_TOKEN` | Token de la app de Mercado Pago | **Sí** |
| `MERCADOPAGO_WEBHOOK_SECRET` | Secreto de firma del webhook | **Sí** |
| `CHECKOUT_ENABLED` | `false` apaga el pago (deja navegar y cotizar) | No |
| `RESEND_API_KEY` | API key de Resend | Para enviar correos |
| `EMAIL_FROM` | Remitente verificado en Resend | Para enviar correos |
| `ADMIN_NOTIFICATION_EMAIL` | A quién se avisa de cada pedido nuevo | Recomendada |
| `SUPABASE_URL` | URL del proyecto de Supabase | Para subir imágenes |
| `SUPABASE_SERVICE_ROLE_KEY` | Service role key (**solo servidor**) | Para subir imágenes |
| `SUPABASE_BUCKET` | Bucket público de imágenes | Para subir imágenes |

> La service role key de Supabase nunca se envía al navegador: las subidas pasan por el servidor.

---

## 3. Base de datos

Las migraciones viven en `migrations/` y se aplican en orden con `npm run migrate`.

| Archivo | Qué crea |
| --- | --- |
| `0001_core.sql` | Categorías, productos, ajustes, administradores, sesiones, auditoría |
| `0002_orders.sql` | Pedidos, ítems, cupones, consultas, bitácora de correos |
| `0003_pricing_modes.sql` | Modos de precio (`fixed` / `quote`) y catálogo inicial |
| `0004_quote_flow.sql` | Campos de cotización del pedido y del ítem |
| `0005_category_hierarchy.sql` | Categorías y subcategorías, máximo dos niveles y protección contra borrado de categorías usadas |

El comando registra las migraciones aplicadas y omite las ya ejecutadas. No ejecutar los archivos SQL manualmente por segunda vez.

### Cargar un catálogo propio

```bash
npm run catalog:import data/catalog.json
```

El formato está documentado en `scripts/import-products.js` y hay un ejemplo en
`data/catalog.example.json`. Los productos importados quedan **sin publicar**: el precio y la
publicación los define el administrador desde el panel.

---

## 4. Panel de administración

Entrá en `/admin` con el usuario creado por `npm run admin:create`.

Desde el panel se controla todo el sitio:

- **Panel:** indicadores, pedidos recientes, productos más vendidos, checklist de puesta en marcha.
- **Pedidos:** filtros, detalle, cambio de estado, **cotización** con link de pago, notas internas.
- **Productos:** alta y edición completa, imágenes, opciones, precios, SEO, publicación.
- **Categorías:** alta y edición de categorías y subcategorías reutilizables. Se pueden crear desde la ficha del producto sin perder los datos cargados. Desactivar una categoría principal oculta también sus subcategorías y productos. No se pueden borrar categorías con productos o subcategorías.
- **Consultas:** formulario de contacto del sitio, respuesta por correo.
- **Cupones:** porcentajes o montos, mínimos, límites de uso y vigencia.
- **Ajustes:** datos del negocio, contacto, redes, envíos, impuestos, textos de la home y
  **colores de marca** (se aplican en vivo al sitio vía variables CSS).
- **Correos:** bitácora de emails enviados y errores.
- **Auditoría:** registro de acciones de los administradores.
- **Administradores:** altas, bajas y cambio de contraseñas.

El correo de "pedido nuevo" incluye un enlace directo al pedido:
`{PUBLIC_BASE_URL}/admin#pedido/{id}`.

---

## 5. Mercado Pago

### Sandbox (empezar acá)

1. Creá una aplicación en <https://www.mercadopago.com.uy/developers/panel/app>.
2. Copiá el **Access Token** de prueba en `MERCADOPAGO_ACCESS_TOKEN`.
3. Dejá `MERCADOPAGO_MODE=sandbox` y `CHECKOUT_ENABLED=true`.
4. En el panel de Mercado Pago, configurá las **notificaciones** apuntando a:

   ```
   https://TU-DOMINIO/api/payments/mercadopago/webhook
   ```

   y copiá el *secret signature* en `MERCADOPAGO_WEBHOOK_SECRET`.

> **Importante:** configurá la URL del webhook **en el panel de Mercado Pago**. El sitio no
> manda `notification_url` en la preferencia porque, al hacerlo, Mercado Pago ignora la URL
> configurada en el panel y el webhook llega sin la firma `x-signature`, que el backend valida.

5. Probá con tarjetas de prueba de Mercado Pago.

### Producción

1. Verificá la aplicación y las credenciales de producción.
2. Cambiá `MERCADOPAGO_MODE=production` y reemplazá el access token por el de producción.
3. Actualizá la URL del webhook en el panel (misma ruta, HTTPS).
4. **Publicá `/condiciones` y `/privacidad`**: Mercado Pago exige que existan y sean accesibles
   antes de aprobar el sitio.

### Cómo está implementado

- El total **nunca** se confía en el navegador: el servidor recalcula precios, descuentos, envío e
  impuestos con `src/pricing.js` al crear el pedido.
- El webhook valida la firma `x-signature` (`x-signature: ts=...,v1=...`) contra
  `MERCADOPAGO_WEBHOOK_SECRET` y consulta el pago en la API de Mercado Pago antes de marcarlo como
  pagado.
- Si el webhook se pierde, el cliente puede re-sincronizar su pedido desde `/seguimiento`.

---

## 6. Correos con Resend

1. Creá la cuenta en <https://resend.com> y agregá el dominio del negocio.
2. Resend muestra los registros **SPF** y **DKIM** que hay que crear en el DNS del dominio.
3. Copiá el API key en `RESEND_API_KEY`.
4. `EMAIL_FROM` debe usar un remitente del dominio verificado, por ejemplo
   `DM Comunicación Visual <notificaciones@dmgraficarapida.com.uy>`.
5. `ADMIN_NOTIFICATION_EMAIL` es la dirección que recibe el aviso de cada pedido nuevo.

Los correos que envía el sitio: confirmación de pedido (al cliente), estado del pedido (al cliente),
pedido nuevo (al administrador), cotización con link de pago y aviso de consulta nueva.

Si falta la configuración de Resend, el pedido **no falla**: el envío queda registrado como error
en la bitácora de correos del panel.

---

## 7. Imágenes con Supabase

1. Creá un proyecto en <https://supabase.com>.
2. Creá un bucket **público** (por ejemplo `productos`) para las imágenes del catálogo.
3. Copiá la **URL** del proyecto en `SUPABASE_URL`, la **service role key** en
   `SUPABASE_SERVICE_ROLE_KEY` y el nombre del bucket en `SUPABASE_BUCKET`.
4. Desde el panel, en Productos, subí las imágenes. El servidor las sube al bucket y guarda la URL
   pública.

Las imágenes quedan servidas desde el dominio de Supabase (`<project>.supabase.co/storage/...`),
que es rápido y con CDN.

---

## 8. Despliegue en Render

El repositorio incluye `render.yaml` (Blueprint): crea la base PostgreSQL y el servicio web juntos.

1. Subí el proyecto a un repositorio Git.
2. En Render: **New → Blueprint** y apuntá al repositorio.
3. Render crea la base `dm-grafica-rapida-db` y el servicio `dm-grafica-rapida`.
4. Completá las variables `sync: false` (se piden en la pantalla de Blueprint):
   `PUBLIC_BASE_URL`, `MERCADOPAGO_ACCESS_TOKEN`, `MERCADOPAGO_WEBHOOK_SECRET`,
   `RESEND_API_KEY`, `EMAIL_FROM`, `ADMIN_NOTIFICATION_EMAIL`, `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY`. El bucket predeterminado es `productos`.
5. `preDeployCommand` corre `npm run migrate` antes de cada despliegue.
6. `healthCheckPath` apunta a `/healthz`. El inicio del servicio ejecuta `node src/server.js`; las migraciones ya se aplicaron en el paso previo.

Las sesiones usan tokens aleatorios guardados como hash en PostgreSQL; no requieren `SESSION_SECRET`. El Blueprint instala solo dependencias de producción. PGlite se usa únicamente en las pruebas locales.

### Deploy manual (sin Blueprint)

- Creá una base PostgreSQL en Render y una **Web Service** con:
  - `Build Command`: `npm ci --omit=dev`
  - `Start Command`: `npm start`
  - El Blueprint propone el plan **Starter** y una base PostgreSQL independiente.
- Agregá las variables de entorno.
- Con `npm start`, las migraciones se ejecutan antes de iniciar el servidor. Si configurás `preDeployCommand: npm run migrate`, usá `node src/server.js` como inicio para evitar repetir ese paso.

### Dominio propio

- En Render: **Settings → Custom Domain**, y apuntá el DNS.
- Actualizá `PUBLIC_BASE_URL` con la URL final (sin barra final).
- El certificado TLS lo emite Render automáticamente.

---

## 9. Estructura del proyecto

```
dm-grafica-rapida/
├── migrations/          Migraciones SQL (se aplican en orden)
├── public/              Sitio estático y panel
│   ├── css/             base.css (tokens y componentes) · tienda.css · admin.css
│   ├── js/              Módulos ES nativos (api, ui, carrito, catálogo, checkout, admin…)
│   └── *.html           Páginas del sitio
├── scripts/             create-admin · import-products · check-text
├── src/
│   ├── server.js        App Express, helmet, rate limits, SEO, rutas
│   ├── db.js            Pool de PostgreSQL
│   ├── auth.js          Sesiones, scrypt, CSRF, auditoría
│   ├── admin.js         Handlers del panel
│   ├── catalog.js       Lectura pública del catálogo
│   ├── orders.js        Pedidos, cotizaciones, seguimiento
│   ├── pricing.js       Cálculo de totales en el servidor
│   ├── payments.js      Mercado Pago (preferencias y webhook)
│   ├── mercadopago-signature.js  Validación de la firma del webhook
│   ├── email.js         Envío con Resend + bitácora
│   ├── storage.js       Subida de imágenes a Supabase
│   ├── settings.js      Ajustes del sitio (datos, envío, impuestos, colores)
│   └── validate.js      Sanitización y validación de entradas
└── .env.example         Variables de entorno documentadas
```

---

## 10. Decisiones de diseño relevantes

- **Sin build step.** El sitio es HTML + CSS + módulos ES nativos. No hay bundler, ni framework, ni
  CDN: menos dependencias, menos superficie de ataque, despliegue directo.
- **Sin dependencias innecesarias.** Mercado Pago y Supabase se consumes con `fetch` nativo y
  Resend con su API REST. Las únicas dependencias son Express, `pg`, `helmet`, `multer`,
  `express-rate-limit` y `dotenv`.
- **El navegador no decide el precio.** Todos los importes se recalculan en el servidor.
- **Sin registro de clientes.** Menos fricción para comprar, menos datos que guardar. El código
  del pedido + el correo permiten seguir la compra.
- **El sitio se puede navegar sin JavaScript.** Los enlaces del menú y el pie son HTML real.
- **Colores configurables.** El administrador puede cambiar el azul de marca y el verde acento
  desde Ajustes; se aplican al momento, sin recompilar nada.

---

## 11. Antes de abrir al público

- [ ] Cargar precios reales y activar los productos en el panel.
- [ ] Completar el RUT del negocio en `/condiciones` y `/privacidad`.
- [ ] Verificar el pago real de punta a punta (alta, webhook, correo, panel).
- [ ] Configurar el dominio propio y `PUBLIC_BASE_URL`.
- [ ] Publicar `/condiciones` y `/privacidad` (requisito de Mercado Pago).
- [ ] Crear el usuario administrador **definitivo** y desactivar los de prueba.
- [ ] Revisar que `CHECKOUT_ENABLED=true` recién cuando todo lo anterior esté listo.

## Recursos estáticos y cupones

El servidor calcula una versión del contenido de `public/` y `src/img/` al arrancar. Las páginas enlazan CSS, JavaScript e imágenes locales bajo `/assets/<versión>/`; los imports relativos comparten esa versión. Estas URLs usan caché inmutable y las URLs sin versión revalidan con el servidor. Reiniciá el servidor después de editar recursos para generar su nueva versión. El despliegue de Render ya lo reinicia.

Los cupones consumen un uso al confirmar el pago, dentro de la misma transacción. Los pedidos abandonados no consumen usos y los webhooks repetidos no duplican el conteo. Si un pago llega después de agotarse o eliminarse su cupón, el pedido queda en revisión manual: comprobar el cobro en Mercado Pago y resolver con el cliente antes de producir. Los reembolsos no liberan usos. La migración `0008` recalcula el contador histórico según pedidos con pago confirmado; ejecutar las migraciones antes de arrancar esta versión.

El administrador puede editar opciones de producto con formularios, conservando los identificadores de opciones y valores existentes. Los precios actuales quedan a cargo del administrador.

## Precios por medio de pago

En cada producto se elige una sola regla: precio único (predeterminada), recargo para Mercado Pago o descuento para transferencia/contado. El porcentaje es editable y empieza en 12%. No se modifican los precios existentes ni se activa una promoción general. Un descuento del 12% sobre $1.120 da $986: no revierte exactamente un recargo del 12% sobre $1.000.

En Ajustes se habilitan los medios de pago y se cargan la cuenta bancaria y las instrucciones. Transferencia y contado empiezan desactivados; Mercado Pago también requiere su configuración de entorno. Los cupones se reparten primero entre las líneas; después se aplica la regla de cada producto, sin ajustar el envío. Se redondea a pesos enteros. Carrito y checkout muestran el importe por medio de pago antes de confirmar.

Cada pedido conserva precios, reglas, impuestos e instrucciones bancarias. Cambiar luego un producto o una cuenta no altera pedidos anteriores. Las transferencias y el contado quedan pendientes hasta que el administrador verifica el ingreso y registra su referencia. Stock, cupón y auditoría se actualizan una sola vez. Los cambios de medio de pago requieren revisar el nuevo total; un cobro recibido desde una revisión anterior de Mercado Pago pasa a revisión manual.

Ejecutar las migraciones 0009 y 0010 con el despliegue. Las pruebas automatizadas usan PostgreSQL embebido y respuestas simuladas de Mercado Pago y correo; no sustituyen la prueba integral con credenciales reales antes de habilitar cobros. Los datos legales se completan en Ajustes del negocio.
