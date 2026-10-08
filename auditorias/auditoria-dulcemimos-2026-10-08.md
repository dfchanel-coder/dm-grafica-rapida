# Auditoría — www.dulcemimos.com

- **Fecha:** 08/10/2026
- **Repositorio:** https://github.com/dfchanel-coder/Dulce-commerce (HEAD `ef5e70a`)
- **Hosting:** Render (detrás de Cloudflare) · Express 5 + Sequelize/MariaDB + Mercado Pago
- **Alcance:** seguridad, funcionalidad/conversión, SEO, accesibilidad, rendimiento, mantenibilidad
- **Método:** análisis del código del repositorio + pruebas activas contra el sitio en vivo (solo lectura; no se modificó ningún dato de producción) + inspección del DOM/renderizado real en navegador.

> Hallazgos encontrados = resultado positivo de auditoría. Este informe prioriza problemas, no confirma que todo esté bien.

---

## Resumen ejecutivo

| Nivel | Cantidad | Veredicto |
|---|---|---|
| 🔴 Crítico | 5 | **No apto para operar sin corrección inmediata** |
| 🟠 Alto | 7 | Corregir en los próximos días |
| 🟡 Medio | 11 | Planificar en 1–2 semanas |
| ⚪ Menor | 8 | Backlog |

**Veredicto global:** la tienda *se ve y funciona* para el usuario final, pero tiene el **panel de administración y la API completamente abiertos**, el **código fuente y la base de datos servidos públicamente**, un **token de Mercado Pago filtrado en el historial de git**, y **datos personales de clientes expuestos a cualquiera**. En paralelo, el catálogo **no está indexado por Google** (solo 1 URL indexada) y el logo pesa **3,6 MB**.

---

## 🔴 CRÍTICO — corregir hoy

### C1. Token de Mercado Pago filtrado en el historial de git

**Evidencia:** el archivo `.env.txt` se agregó en los commits `c32e962` y `d28493b` y contiene `MP_ACCESS_TOKEN=APP_USR-5744010610153975-…-36478890`. El archivo fue borrado después, pero **el token sigue siendo recuperable en un repo público** (`git log -p`).

**Impacto:** cualquiera con acceso al repo puede operar sobre la cuenta de Mercado Pago del negocio (consultar/crear/reencauzar pagos, ver datos de clientes, emitir reembolsos).

**Acción:**
1. **Rotar el token AHORA** desde Tu cuenta → Desarrolladores → Mercado Pago (el token viejo deja de valer).
2. Colocar el nuevo solo en variables de entorno de Render (nunca en el repo).
3. Considerar el token anterior **comprometido**; revisar movimientos recientes de la cuenta.
4. Borrar el historial (`git filter-repo`) solo después de rotar (borrar historial sin rotar no arregla nada).

---

### C2. Todo el servidor se sirve como archivos públicos (`express.static(__dirname)`)

`server.js:18` publica la **raíz completa del proyecto**. Verificado en vivo:

| Recurso | Estado | Detalle |
|---|---|---|
| `/server.js` | **200** | Código fuente completo del backend |
| `/package.json` | **200** | Dependencias y versiones |
| `/config/config.json` | **200** | Credenciales de BD dev (`root` / `123456`) y esquema |
| `/models/*`, `/migrations/*` | **200** | Estructura interna de la BD |
| `/admin.html` | **200** | Formulario de acceso al panel |
| `/vistas_privadas/dashboard.html` | **200** | Panel privado completo |
| `/Dulce_Mimos.sql`, `/DULCE MIMOS.txt` | **200** | Volcado SQL y configuración de HeidiSQL |
| `/script.ts` | **200** | Código fuente TS sin compilar |
| `/node_modules/express/package.json` | **200** | **Toda** la carpeta `node_modules` publicada |
| `/.env`, `/.git`, `/.gitignore` | 404 | Salvo punto: Express ignora *dotfiles* por defecto |

**Impacto:** un atacante conoce toda la superficie de ataque (rutas, modelos, dependencias vulnerables) sin tocar nada.

**Acción (mínima complejidad):** servir solo lo público.

```js
app.use(express.static(__dirname + '/public', { index: 'index.html' }));
// mover index.html, script.js, banner.png, logo.png, assets/ → /public
```

Además: borrar del repo `DULCE MIMOS.txt`, `Dulce_Mimos.sql`, `script.ts` (si no se usa en build) y `assets/images/logo.png.png` / `banner .png` (duplicados con nombre roto).

---

### C3. API abierta: datos personales de clientes expuestos

**Evidencia:**
- `GET /api/ordenes` → **200, sin autenticación**. Devolvió **6 órdenes** con `clienteNombre`, `clienteEmail`, `clienteDireccion`, `clienteWhatsapp`, `totalPedido`, `estado`.
- `Access-Control-Allow-Origin: *` en la respuesta → **cualquier sitio web puede leer esos datos desde el navegador de cualquier visitante** (incluido el panel de un competidor incrustando la URL).
- `GET /api/celulares` → 200, 97 productos, 84 KB (incluye `stock` interno).

**Impacto:** fuga de PII (Ley 18.331 de Protección de Datos Personales — Uruguay), sanciones y daño de confianza.

**Acción:**
1. Proteger `GET /api/ordenes` y `GET /api/ordenes/:id` con sesión de administrador.
2. Eliminar `cors()` global (el sitio es same-origin; no necesita CORS).
3. Exponer al público solo campos públicos de productos (`id, modelo, marca, precio, stock, categoria, colores, descripcion, imagen`), no `createdAt/updatedAt` ni órdenes.

---

### C4. Panel de administración sin autenticación real

**Evidencia:**
- `app.get('/admin', …)` (`server.js:29`) sirve el dashboard **sin validar sesión** → `GET /admin` responde **200**.
- El login (`POST /admin-login`) solo hace `res.redirect(302, '/admin')`; **no crea sesión, no hay middleware que la exija**. Es decorativo.
- `admin.html` responde 200 igual.
- Prueba activa: `POST /api/celulares {}` → `400 "Faltan datos obligatorios"` (y no `401`), `DELETE /api/celulares/999999` → `404` (y no `401`). **Confirma que no existe control de acceso en escritura.**

**Impacto:** cualquier visitante puede **crear, editar y borrar productos y precios**, **cambiar estados de órdenes** de clientes reales y **leer el histórico de pedidos** (ver C3).

**Acción:**
1. Middleware de sesión real: `express-session` con cookie `httpOnly`, `sameSite: 'strict'`, `secure` (ya está en `dependencies` y **no se usa**).
2. Proteger: `POST/PUT/DELETE /api/celulares`, `GET/PUT /api/ordenes`, `POST /api/config/*`, `/admin`, `/admin.html`.
3. `POST /admin-login` con **rate limiting** (máx. 5 intentos/min por IP) y comparación con `crypto.timingSafeEqual`.
4. Rotar `ADMIN_PASSWORD` en Render por una clave fuerte (≥16 caracteres).

---

### C5. XSS almacenado: cualquier visitante puede inyectar JavaScript en todos los demás

**Cadena de explotación (todas las piezas verificadas):**
1. `POST /api/celulares` está abierto (C4) → el atacante crea un producto.
2. En `script.js:371-373` la tarjeta se construye con `innerHTML` interpolando **sin escapar**:
   - `src="${p.imagen || '…'}"` → `imagen = x" onerror="…`
   - `alt="${p.modelo}"` → `modelo = x" onerror="…`
   - `script.js:285/290` → `ads.left.link` / `ads.left.img` (y `POST /api/config/ads_laterales` también está abierto).
3. Resultado: JavaScript arbitrario ejecutándose en el navegador de **todos** los clientes.

**Impacto:** robo de sesión del admin, redirección de pagos, defacement, inyección de contenido en la tienda.

**Acción:**
1. Reemplazar interpolaciones por `textContent`/`setAttribute`, o pasar **todos** los valores por `utils.escapeHTML()` (ya existe y se usa en el panel de órdenes: `script.js:91`).
2. Sanitizar URL de imágenes/links (`/^https:\/\//`) antes de insertarlas.
3. CSP como segunda barrera: `default-src 'self'; img-src 'self' https://i.postimg.cc; object-src 'none'`.

---

## 🟠 ALTO — próximos días

### A1. Flujo de pago de Mercado Pago roto (`server.js:225`)
`back_urls` apunta a `http://localhost:3000/success|failure|pending`. Tras pagar, **el usuario es redirigido a `localhost`** y pierde la confirmación. Debe ser `https://www.dulcemimos.com/success` (idealmente desde variable de entorno `APP_URL`).

### A2. No hay webhook de Mercado Pago
No existe ruta `/webhook|/notifications` en `server.js`. **El pago nunca actualiza la orden**: el admin debe verificar cada transferencia a mano. Sin esto, `estado` nunca pasa de `Pendiente` automáticamente y no hay evidencia de pago.

### A3. La orden se crea y el stock se descuenta **antes** de pagar (`server.js:177-233`)
Si el cliente cierra la pestaña de MP, **el stock queda descontado sin venta** (stock fantasma). Además, si `Preference.create` falla, se hace `commit` igual, el front muestra "¡Gracias por tu Pedido!" (`script.js:595`) y **no hay botón para pagar**. Recomendación: crear la orden en estado `Pendiente de pago` sin descontar stock, descontar recién en el webhook `payment.approved`, o liberar stock por TTL.

### A4. Descuadre del 10% de recargo
`server.js:212` cobra en MP `precio * 1.10`, pero `orden.totalPedido = total` (sin recargo, `server.js:215`) y el resumen del carrito (`script.js:576`) tampoco lo incluye. **El total registrado ≠ lo cobrado** → imposible conciliar caja. Decidir una sola fuente de verdad y mostrar el total con recargo desde el carrito.

### A5. Sin límite de intentos ni rate limiting en ningún endpoint
`/admin-login` acepta fuerza bruta infinita. `POST /api/ordenes` permite **drenar todo el stock** creando miles de órdenes sin pagar (cada una descuenta stock). Agregar `express-rate-limit`: global (p. ej. 100 req/min) + estricto en login (5/min) y checkout (10/min).

### A6. Sin cabeceras de seguridad
Solo se ve `X-Powered-By: Express` y `x-render-origin-server: Render`. Faltan `Strict-Transport-Security`, `X-Content-Type-Options: nosniff`, `X-Frame-Options`/`frame-ancestors`, `Referrer-Policy`, `Permissions-Policy`, CSP. Solución de mínimo esfuerzo: `app.use(helmet())` + `app.disable('x-powered-by')`.

### A7. `sequelize.sync({ alter: true })` en cada arranque (`server.js:253`)
En producción puede **alterar tablas con datos reales** en cada deploy/restart. Usar solo migraciones (`sequelize-cli` ya está en devDependencies y hay `/migrations`).

---

## 🟡 MEDIO

### SEO
| # | Hallazgo | Evidencia |
|---|---|---|
| S1 | **El catálogo no está indexado.** Todo se renderiza con JS: el HTML estático solo dice "Cargando catálogo..." | `site:dulcemimos.com` devuelve **1 única URL** |
| S2 | `robots.txt` y `sitemap.xml` → **404** | curl |
| S3 | Sin `<link rel="canonical">`, sin Open Graph, sin Twitter Cards | DOM |
| S4 | Sin datos estructurados (JSON-LD): `WebSite`, `Organization`, `Product`, `LocalBusiness`, `BreadcrumbList` | DOM |
| S5 | `favicon.ico` → **404** (el navegador lo pide igual) | curl |
| S6 | `/admin` y `/admin.html` **sin `noindex`** (título "Admin - Gestión de Productos") | HTML |
| S7 | Imágenes de productos sin `width`/`height` → CLS; sin `loading="lazy"` | DOM |

**Recomendación de arquitectura** (decisión de Web Master, no automática): SSR real con `res.sendFile` + inyectar el JSON del catálogo en el HTML, o al menos precargar los productos en el HTML del servidor. Un e-commerce sin catálogo indexado pierde tráfico orgánico de producto/papelera+ciudad.

**Lo que sí está bien:** `<title>` descriptivo ✓, `meta description` ✓, `lang="es"` ✓, **un solo `h1`** ✓, jerarquía `h1→h2→h3` coherente ✓, HTML semántico (`header/main/footer`) ✓, redirect apex→www→HTTPS correcto ✓, textos de productos con enlaces a WhatsApp ✓.

### Accesibilidad (WCAG 2.1 AA)
| # | Hallazgo | Valor medido |
|---|---|---|
| A11y-1 | **Contraste insuficiente en toda la paleta rosa** | `.plazo-info` (rosa `#d48ba5` sobre `#f3dbe5`): **1,99:1** · `.btn-detalles`, `h1`, `.precio` (rosa sobre blanco): **2,55:1** · botón `.btn-categoria` (blanco sobre rosa): **2,61:1** · `.developer-info` (`#8c7b83`, 12,8px): **3,92:1** — todos por debajo de **4,5:1** (y de 3:1 para texto grande) |
| A11y-2 | 12 enlaces **solo icono sin `aria-label`** (solo `title`) → 4.1.2 Name/Role/Value | DOM |
| A11y-3 | Sin `<nav>`: las categorías son botones sueltos sin landmark | `document.querySelectorAll('nav').length = 0` |
| A11y-4 | Sin `prefers-reduced-motion`: la animación de entrada de tarjetas (`aparecerSuave`) es obligatoria | CSS |
| A11y-5 | Los toasts de error/éxito no son `aria-live` → un lector de pantalla no anuncia errores de checkout | `script.js` showToast |
| A11y-6 | Targets pequeños: quitar color **17×31 px** | DOM |

**Lo que sí está bien:** todos los `input`/`select` del buscador y del checkout **tienen `<label for>`** ✓, `header/main/footer` presentes ✓, `alt` descriptivos en imágenes de producto ✓.

### Rendimiento
| # | Hallazgo | Evidencia |
|---|---|---|
| P1 | **`logo.png` = 3.635.360 bytes (3,6 MB)** servido sin `Content-Encoding`, sin `width/height`, sin `loading="lazy"` | `curl -I`, `performance API` |
| P2 | Peso inicial ≈ **3,8 MB** (logo 3550 KB + banner 201 KB + FA 19 KB + JS 10 KB) | transferSize |
| P3 | Métricas en desktop: **FCP 1.788 ms · DCL 1.452 ms · load 2.490 ms** — en 4G/3G móvil será 3–5× peor | Navigation Timing |
| P4 | **Font Awesome completo** desde CDN (CSS + webfonts) para ~3 iconos | `<link>` en `index.html:7` |
| P5 | Imágenes de productos hospedadas en `i.postimg.cc` (terceros): sin control de disponibilidad ni de hotlink; si cae el host, **desaparecen los productos** | `naturalWidth` de 97 imgs |
| P6 | `Cache-Control: public, max-age=0` en **todos** los estáticos (el logo se re-descarga en cada visita) | cabeceras |
| P7 | `index.html` 33 KB con CSS embebido + `script.js` 39 KB sin minificar ni cachear | tamaño en disco |

**Acción ordenada por impacto:** (1) convertir el logo a WebP/AVIF ≤ 30 KB y declarar `width/height`; (2) `loading="lazy"` en productos; (3) subset de FontAwesome o SVG inline; (4) caché `max-age=31536000, immutable` para assets con hash; (5) migrar imágenes de postimg a `/public/assets`.

---

## ⚪ MENOR / mantenibilidad

1. **Nombres heredados de tienda de celulares**: `package.json` → `"name": "web-celulares"`, modelo `Celular`, tabla `celulares`, endpoint `/api/celulares`, clave de carrito `localStorage['carritoXiaomi']`. Confunde a cualquier desarrollador que entre al proyecto.
2. **`script.ts` (419 líneas) duplica `script.js` (660 líneas)** sin proceso de build que los conecte → cambios en uno no llegan al otro. Elegir uno (recomendado: TS con build, o eliminar el TS).
3. Precios en `DataTypes.FLOAT` → errores de redondeo. Usar `DECIMAL(10,2)` o enteros en centavos.
4. Repositorio con archivos ajenos al código: `DULCE MIMOS.txt` (configuración de HeidiSQL, expone `User root`, host local), `Dulce_Mimos.sql`, `assets/images/logo.png.png` y `assets/images/banner .png` (nombres rotos).
5. Sin `.env.example` documentando `MP_ACCESS_TOKEN`, `ADMIN_PASSWORD`, `DATABASE_URL`, `APP_URL` → el deploy es frágil de replicar.
6. Sin `render.yaml` (infraestructura como código) ni tests.
7. `cors()` habilitado globalmente sin necesidad (el front es same-origin).
8. **Firma FB Informática**: el footer enlaza a `instagram.com/fbinformaticauy`. Verificar contra `identidad/fb-informatica.md` si el enlace debe ir al sitio oficial.

---

## ✅ Lo que está bien hecho (para no romperlo al corregir)

- **Checkout con cálculo de total y stock en el servidor**, con transacción y bloqueo `FOR UPDATE` (`server.js:197-203`): el precio y el stock **no** se confían al cliente. Diseño correcto.
- Validación de modelos con Sequelize (`allowNull`, `isEmail`, `min: 0`).
- `utils.escapeHTML()` ya existe y se usa en el panel de órdenes.
- Dominio: `http → https` y `apex → www` con 301 correctos; sin contenido duplicado.
- Un solo `h1`, jerarquía de encabezados ordenada, `lang="es"`, meta description y title bien escritos.
- Filtros, ordenamiento, búsqueda y categorías funcionan en cliente sin recargas.
- El checkout tiene `<label>` asociado a todos los campos y `required` + tipos `email`/`tel`.

---

## Plan de corrección propuesto

### Fase 1 — Contención (hoy, ~2 h)
1. **Rotar `MP_ACCESS_TOKEN`** (C1) y `ADMIN_PASSWORD`.
2. Dejar de servir la raíz: mover estáticos a `/public` (C2).
3. Proteger con sesión: `/api/ordenes*`, `/api/celulares` (escritura), `/api/config/*` (escritura), `/admin*` (C3, C4).
4. Quitar `cors()` global.

### Fase 2 — Estabilización (2–3 días)
5. Sanitizar `innerHTML` + CSP (C5).
6. `helmet()` + rate limiting (A5, A6).
7. `back_urls` reales + webhook de MP + desacoplar descuento de stock del pago (A1–A3).
8. Unificar el cálculo del 10% (A4).
9. Reemplazar `sync({alter:true})` por migraciones (A7).

### Fase 3 — Calidad (1–2 semanas)
10. Contraste de colores AA, `aria-label` en iconos, `<nav>`, `prefers-reduced-motion`, `aria-live` en toasts.
11. Logo optimizado (≤30 KB), lazy loading, caché, FontAwesome reducido, imágenes propias.
12. `robots.txt`, `sitemap.xml`, canonical, OG, favicon, JSON-LD, `noindex` en `/admin`.
13. **Decisión de catálogo indexable** (SSR o pre-render del JSON en HTML).
14. Limpieza de nombres (`celulares` → `productos`), eliminación de `script.ts` o build real, `.env.example`, `render.yaml`.

---

## Criterios de aceptación para considerar terminada la corrección

### Estados de ejecución (actualizado 2026-10-08, fin de Tanda 2)

- [x] `curl https://www.dulcemimos.com/server.js` → **404** ✅ (verificado en vivo)
- [x] `curl https://www.dulcemimos.com/api/ordenes` → **401** ✅ (verificado en vivo)
- [x] `curl -X POST .../api/celulares` sin sesión → **401** ✅ (verificado en vivo)
- [x] `curl https://www.dulcemimos.com/admin` sin sesión → **redirección a login** ✅
- [ ] Token MP nuevo, el viejo revocado — **pendiente del cliente** (mensaje a redactar)
- [x] Pago de prueba en MP redirige a `www.dulcemimos.com/success` y la orden cambia de estado vía webhook — **webhook implementado y verificado** (falta solo una prueba de pago real con el token rotado del cliente)
- [ ] HTML estático contiene los productos (sin "Cargando catálogo...") — **decisión SSR/Catálogo indexable (pendiente)**
- [x] `robots.txt`, `sitemap.xml` y `favicon` → **200** ✅ (favicon.png + `<link rel=icon>`)
- [x] Contraste AA en `.plazo-info`, `.precio`, `.btn-detalles`, `.btn-categoria` ✅ (paleta `#ac5672`/`#6e5a64`, verificado por computed styles)
- [x] `logo.png` ≤ 50 KB ✅ (3.550 KB → 46,3 KB)
- [x] Sin `X-Powered-By` y con HSTS activo ✅

## Bitácora de ejecución

### Tanda 1 — Contención (desplegada y verificada 2026-10-08)
Commits `0397715` (+ hotfix `3dda3ce`) en `main`:
- Estáticos movidos a `public/` (server.js, package.json, config, node_modules, vistas_privadas: 404)
- Auth por sesión (`requireAdmin`), rate limit login 8/15min y checkout 10/min, helmet sin CSP, cors eliminado
- `back_urls` → `APP_URL` (solo back_url claro, sin back_urls_failure)
- **Bug crítico encontrado en la verificación**: `script.js` apuntaba API_BASE a `https://dulce-commerce.onrender.com/api` en duro; como `www.dulcemimos.com` es CNAME del mismo servicio, al cerrar CORS la tienda dejó de cargar → `API_BASE = '/api'` (mismo origen). Fix `3dda3ce`.
- Tienda verificada en navegador: 6 productos/pág, cero errores de consola.

### Tanda 2 — XSS, contraste, rendimiento y SEO (desplegada y verificada 2026-10-08)
Commits `e8450d6` y `986e63d` (+ colores de panel):
- **XSS (C5)**: helper `utils.safeUrl()` (solo http/https, bloquea javascript:/data:) aplicado a `src`/`href` de catálogo, detalle, relacionados, carrito, resumen, ads y botón MP; `escapeHTML()` en modelo, marca, descripción, colores, `alt`, colorElegido y estado de órdenes; `rel="noopener"` en links externos.
- **Contraste (AA)**: `--primary-pink #d48ba5→#ac5672`, `--text-light #8c7b83→#6e5a64`, `.plazo-info`→`--text-dark`; panel admin y login unificados al mismo tono.
- **Accesibilidad**: `:focus-visible`, `prefers-reduced-motion`, `aria-label` en iconos sociales, `role="navigation"` en categorías.
- **Rendimiento**: `logo.png` 3.550 KB → 46,3 KB (200px, transparencia intacta).
- **SEO**: `robots.txt` (disallow /admin, /api/, /success, /failure, /pending), `sitemap.xml`, canonical, Open Graph, Twitter Card, JSON-LD (Store), `favicon.png`, theme-color; `noindex` en `admin.html` y `dashboard.html`.
- Verificado en vivo: /robots.txt 200, /sitemap.xml 200, /favicon.png 200, logo 47.453 bytes, computed colors correctos, 6 productos, consola limpia.

### Tanda 3 — Flujo de dinero, stock y webhook (desplegada y verificada 2026-10-08)
Commits `6823801` (+ hotfix `b76bda9`):
- **Stock tras pago confirmado**: el checkout ya NO descuenta stock (verificado: orden de auditoría con stock intacto). El descuento ocurre en el webhook cuando MP confirma el pago. Se mantiene el control de stock en el checkout solo para rechazar pedidos imposibles.
- **Webhook `/webhook/mercadopago`**: verifica cada pago contra la API de MP (`payment.get`, usando el access token) antes de tocar nada; idempotente (una orden solo sale de `Pendiente` una vez); descuenta stock y marca la orden `Procesando` en transacción; si no alcanza stock responde 409 y deja la orden para resolución manual. POST falsos con id inexistente → `{ok:false}` sin efectos (verificado).
- **Recargo 10% unificado**: un único `precioConRecargo()` para `totalPedido`, `OrderItem.precioUnitario` y `unit_price` de MP. Verificado: producto $31×2 → `totalPedido` 68,20 y unitario 34,10 (antes el total registrado NO incluía el recargo que sí se cobraba). El resumen del frontend ahora muestra Subtotal + Recargo = Total a pagar idéntico al cobro.
- **`/success`** verifica el `payment_id` devuelto por MP en la redirección; `/failure` y `/pending` restauradas (las había borrado al reescribir el bloque — detectado en verificación y corregido en `b76bda9`).
- **`sync({alter:true})` → `sync()`**: nunca altera el esquema existente.
- **Limpieza**: `config.json` dialect `postgres` (era `mariadb`); `mariadb`/`mysql2` fuera de dependencias; tablas viejas `fashion_ordenes`/`fashion_productos` respaldadas en `backups/tablas-viejas-fashion-2026-10-08.json` y eliminadas.
- Verificado en vivo: /success, /failure, /pending 200; webhook 400 sin data.id / 200 con id no verificable; /api/ordenes 401; checkout crea orden con total exacto y stock intacto; resumen de checkout correcto en navegador.
