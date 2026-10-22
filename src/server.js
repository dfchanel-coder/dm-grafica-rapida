import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import multer from "multer";

import { pool } from "./db.js";
import { getSettings, toPublicSettings } from "./settings.js";
import { requireAdmin, requireCsrf, readAdminSession } from "./auth.js";
import { createAdminHandlers } from "./admin.js";
import { listCategories, listProducts, getProductBySlug, getSeoProduct, getSeoCategory } from "./catalog.js";
import { createOrder, trackOrder, reconcileOrder, notifyOrderStatus } from "./orders.js";
import { createWebhookHandler, checkoutEnabled, paymentMode } from "./payments.js";
import { sendEmail } from "./email.js";
import { newInquiryAdmin } from "./email-templates.js";
import { ValidationError, cleanEmail, cleanMultiline, cleanPhone, cleanText } from "./validate.js";

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);
const publicDir = path.resolve(dirname, "../public");
const brandDir = path.resolve(dirname, "img");

const app = express();
const port = Number(process.env.PORT || 3000);

app.disable("x-powered-by");
app.set("trust proxy", 1); // Render termina TLS en su proxy de confianza.

/* -------------------------------------------------------------------------- */
/* Seguridad                                                                  */
/* -------------------------------------------------------------------------- */

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      imgSrc: ["'self'", "data:", "https://*.supabase.co", "https://*.supabase.in", "https://images.unsplash.com"],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// Redirección del dominio de Render al dominio propio, si está configurado.
const publicOrigin = (() => {
  const base = process.env.PUBLIC_BASE_URL;
  if (!base) return null;
  try {
    return new URL(base).origin;
  } catch {
    return null;
  }
})();

if (publicOrigin) {
  app.use((req, res, next) => {
    const host = req.get("host");
    if (!host || req.get("x-forwarded-proto") === undefined) {
      if (host && host.includes("onrender.com") && req.get("x-forwarded-host") !== host) {
        return res.redirect(308, `${publicOrigin}${req.originalUrl}`);
      }
    }
    return next();
  });
}

app.use(express.json({ limit: "64kb", type: "application/json" }));
app.use(express.urlencoded({ extended: false, limit: "64kb" }));

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 },
});

/* -------------------------------------------------------------------------- */
/* Límites de peticiones                                                     */
/* -------------------------------------------------------------------------- */

const limiter = (windowMs, limit, message) => rateLimit({
  windowMs,
  limit,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: message },
});

const checkoutLimiter = limiter(10 * 60 * 1000, 10, "Hiciste varios intentos de compra. Esperá unos minutos y probá de nuevo.");
const trackLimiter = limiter(10 * 60 * 1000, 40, "Consultaste el estado demasiadas veces. Esperá unos minutos.");
const inquiryLimiter = limiter(60 * 60 * 1000, 5, "Ya enviaste varias consultas. Esperá antes de volver a intentarlo.");
const loginLimiter = limiter(15 * 60 * 1000, 8, "Demasiados intentos de acceso. Probá en 15 minutos.");
const adminWriteLimiter = limiter(10 * 60 * 1000, 400, "Hiciste demasiadas operaciones seguidas. Esperá un momento.");

/* -------------------------------------------------------------------------- */
/* API pública                                                                */
/* -------------------------------------------------------------------------- */

app.get("/healthz", async (_req, res) => {
  try {
    await pool.query("SELECT 1");
    return res.json({ status: "ok" });
  } catch {
    return res.status(503).json({ status: "database_unavailable" });
  }
});

app.get("/api/settings/public", async (_req, res) => {
  res.set("Cache-Control", "public, max-age=60");
  const settings = await getSettings();
  return res.json({ settings: toPublicSettings(settings) });
});

app.get("/api/catalog", async (_req, res) => {
  res.set("Cache-Control", "public, max-age=60");
  const [categories, products] = await Promise.all([listCategories(), listProducts()]);
  return res.json({ categories, products });
});

app.get("/api/products/:slug", async (req, res) => {
  const product = await getProductBySlug(String(req.params.slug));
  if (!product) return res.status(404).json({ error: "Producto no encontrado." });
  return res.json({ product });
});

app.post("/api/orders", checkoutLimiter, async (req, res) => {
  try {
    const result = await createOrder({
      customer: req.body?.customer || {},
      items: req.body?.items || [],
      delivery: req.body?.delivery || {},
      notes: req.body?.notes || "",
      couponCode: req.body?.coupon_code || "",
    });
    return res.status(201).json({
      code: result.order.code,
      status: result.order.status,
      total: result.order.total,
      currency: result.order.currency,
      requires_quote: result.requiresQuote,
      checkout_url: result.checkoutUrl,
      checkout_disabled: Boolean(result.checkoutDisabled),
      message: result.requiresQuote
        ? "Recibimos tu pedido. Te vamos a cotizar y te enviamos el link de pago."
        : undefined,
    });
  } catch (error) {
    if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
    console.error("No se pudo crear el pedido:", error?.message || "Error");
    return res.status(500).json({ error: "Ocurrió un error al crear tu pedido. Probá de nuevo." });
  }
});

app.get("/api/orders/track", trackLimiter, async (req, res) => {
  try {
    const order = await trackOrder(req.query.code || "", req.query.email || "");
    if (!order) {
      return res.status(404).json({ error: "No encontramos un pedido con ese código y correo." });
    }
    return res.json({ order });
  } catch (error) {
    if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: "No pudimos consultar tu pedido." });
  }
});

app.post("/api/orders/reconcile", trackLimiter, async (req, res) => {
  try {
    const result = await reconcileOrder(req.body?.code || "", req.body?.email || "");
    if (!result?.order) {
      return res.status(404).json({ error: "No encontramos un pedido con ese código y correo." });
    }
    return res.json({ order: result.order, reconciled: result.reconciled });
  } catch (error) {
    if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: "No pudimos consultar tu pedido." });
  }
});

app.post("/api/inquiries", inquiryLimiter, async (req, res) => {
  try {
    const name = cleanText(req.body?.name, { max: 120, min: 2, field: "name", label: "el nombre" });
    const email = cleanEmail(req.body?.email);
    const phone = cleanPhone(req.body?.phone);
    const subject = cleanText(req.body?.subject, { max: 160, field: "subject", label: "el asunto" });
    const message = cleanMultiline(req.body?.message, { max: 3000, min: 5, field: "message", label: "el mensaje" });

    const inserted = await pool.query(
      `INSERT INTO inquiries (name, email, phone, subject, message) VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, email, phone, subject, message],
    );

    const settings = await getSettings();
    const adminEmail = settings.notifications?.admin_email || process.env.ADMIN_NOTIFICATION_EMAIL;
    if (adminEmail && settings.notifications?.notify_on_inquiry !== false) {
      const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
      const mail = newInquiryAdmin({ inquiry: inserted.rows[0], product: null, adminUrl: base });
      await sendEmail({
        to: adminEmail,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        template: "inquiry_admin",
      });
    }

    return res.status(201).json({ ok: true, message: "Gracias por escribirnos. Te respondemos a la brevedad." });
  } catch (error) {
    if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
    console.error("No se pudo guardar la consulta:", error?.message || "Error");
    return res.status(500).json({ error: "No pudimos enviar tu consulta. Probá de nuevo." });
  }
});

app.get("/api/payments/status", (_req, res) => {
  res.set("Cache-Control", "no-store");
  return res.json({
    available: checkoutEnabled(),
    mode: paymentMode(),
    provider: "mercadopago",
  });
});

// Mercado Pago puede consultar la URL del webhook con GET/HEAD desde su panel.
// Las notificaciones reales son POST firmados y se procesan más abajo.
app.get("/api/payments/mercadopago/webhook", (_req, res) => res.sendStatus(200));

app.post(
  "/api/payments/mercadopago/webhook",
  createWebhookHandler({
    onPaid: async (orderId) => {
      const { notifyOrderPaid } = await import("./orders.js");
      await notifyOrderPaid(orderId);
    },
    onStatusChange: async (orderId, status) => {
      if (status === "review") await notifyOrderStatus(orderId, "Revisión manual");
    },
  }),
);

/* -------------------------------------------------------------------------- */
/* API de administración                                                       */
/* -------------------------------------------------------------------------- */

const admin = createAdminHandlers();

app.post("/api/admin/login", loginLimiter, async (req, res) => {
  const { createAdminSession, setSessionCookie } = await import("./auth.js");
  try {
    const adminUser = await admin.login(req, res);
    const { token, csrfToken, expiresAt } = await createAdminSession(adminUser.id, {
      userAgent: req.get("user-agent"),
      ip: req.ip,
    });
    setSessionCookie(res, token, expiresAt);
    return res.json({ ok: true, admin: adminUser, csrfToken });
  } catch (error) {
    if (error instanceof ValidationError) {
      const status = error.field === "credentials" ? 401 : 400;
      return res.status(status).json({ error: error.message });
    }
    console.error("Error en el acceso al panel:", error?.name || "Error");
    return res.status(500).json({ error: "Ocurrió un error al iniciar sesión." });
  }
});

app.get("/api/admin/session", async (req, res) => {
  const session = await readAdminSession(req);
  if (!session) return res.status(401).json({ error: "Sin sesión." });
  return res.json({ admin: session.admin, csrfToken: session.csrfToken });
});

app.post("/api/admin/logout", requireAdmin, requireCsrf, admin.logout);

const adminRead = [requireAdmin];
const adminWrite = [requireAdmin, requireCsrf, adminWriteLimiter];

app.get("/api/admin/overview", adminRead, admin.overview);
app.get("/api/admin/products", adminRead, admin.listProducts);
app.post("/api/admin/products", adminWrite, admin.createProduct);
app.put("/api/admin/products/:id", adminWrite, admin.updateProduct);
app.delete("/api/admin/products/:id", adminWrite, admin.deleteProduct);
app.post("/api/admin/products/:id/images", adminWrite, upload.single("image"), admin.uploadProductImage);
app.delete("/api/admin/products/:id/images", adminWrite, admin.deleteProductImage);
app.get("/api/admin/categories", adminRead, admin.listCategories);
app.post("/api/admin/categories", adminWrite, admin.createCategory);
app.put("/api/admin/categories/:id", adminWrite, admin.updateCategory);
app.delete("/api/admin/categories/:id", adminWrite, admin.deleteCategory);
app.get("/api/admin/orders", adminRead, admin.listOrders);
app.get("/api/admin/orders/:id", adminRead, admin.getOrder);
app.patch("/api/admin/orders/:id", adminWrite, admin.updateOrder);
app.post("/api/admin/orders/:id/quote", adminWrite, admin.quoteOrderHandler);
app.get("/api/admin/inquiries", adminRead, admin.listInquiries);
app.patch("/api/admin/inquiries/:id", adminWrite, admin.updateInquiry);
app.get("/api/admin/coupons", adminRead, admin.listCoupons);
app.post("/api/admin/coupons", adminWrite, admin.createCoupon);
app.put("/api/admin/coupons/:id", adminWrite, admin.updateCoupon);
app.delete("/api/admin/coupons/:id", adminWrite, admin.deleteCoupon);
app.get("/api/admin/settings", adminRead, admin.getSettingsHandler);
app.put("/api/admin/settings", adminWrite, admin.updateSettingsHandler);
app.get("/api/admin/emails", adminRead, admin.listEmails);
app.get("/api/admin/audit", adminRead, admin.listAudit);
app.get("/api/admin/admins", adminRead, admin.listAdmins);
app.post("/api/admin/admins", adminWrite, admin.createAdmin);
app.put("/api/admin/admins/:id", adminWrite, admin.updateAdmin);

/* -------------------------------------------------------------------------- */
/* Páginas públicas                                                            */
/* -------------------------------------------------------------------------- */

async function renderPage(res, file, seo = {}) {
  const filePath = path.join(publicDir, file);
  let html;
  try {
    html = await fs.readFile(filePath, "utf8");
  } catch {
    return res.status(404).send("Página no encontrada.");
  }

  // La URL canónica se deriva de la ruta real salvo que la ruta ya defina una
  // (por ejemplo /producto/:slug, que tiene su propia versión indexable).
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const requestPath = String(res.req?.originalUrl || "/").split("?")[0];
  const canonical = seo.canonical || (base ? `${base}${requestPath}` : requestPath);

  html = html
    .replace(/<link rel="canonical" href="[^"]*"/, `<link rel="canonical" href="${escapeHtml(canonical)}"`)
    .replace(/(<meta property="og:url" content=")[^"]*(")/, `$1${escapeHtml(canonical)}$2`);

  if (seo.title) {
    html = html.replace(/<title>[\s\S]*?<\/title>/, `<title>${escapeHtml(seo.title)}</title>`);
  }

  if (seo.description) {
    html = html.replace(
      /(<meta name="description" content=")[^"]*(")/,
      `$1${escapeHtml(seo.description)}$2`,
    );
  }

  if (seo.jsonLd) {
    html = html.replace(
      /<script type="application\/ld\+json" id="seo-jsonld">[\s\S]*?<\/script>/,
      `<script type="application/ld+json" id="seo-jsonld">${JSON.stringify(seo.jsonLd)}</script>`,
    );
  } else {
    // Las rutas relativas del JSON-LD de la página se vuelven absolutas.
    html = html.replace(
      /(<script type="application\/ld\+json" id="seo-jsonld">)([\s\S]*?)(<\/script>)/,
      (match, open, json, close) => {
        try {
          const data = JSON.parse(json);
          for (const key of ["url", "image", "logo"]) {
            if (typeof data[key] === "string" && data[key].startsWith("/")) {
              data[key] = `${base}${data[key]}`;
            }
          }
          return `${open}${JSON.stringify(data)}${close}`;
        } catch {
          return match;
        }
      },
    );
  }

  res.set("Cache-Control", "no-store");
  return res.send(html);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

app.get("/", async (_req, res) => renderPage(res, "index.html"));
app.get("/pt", async (_req, res) => renderPage(res, "pt/index.html"));
app.get("/pt/", async (_req, res) => renderPage(res, "pt/index.html"));

app.get("/catalogo", async (_req, res) => renderPage(res, "catalogo.html"));

app.get("/categoria/:slug", async (req, res) => {
  const category = await getSeoCategory(String(req.params.slug));
  if (!category || !category.active) return renderPage(res, "catalogo.html");
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  return renderPage(res, "catalogo.html", {
    title: `${category.name} | DM Gráfica Rápida`,
    description: category.description || `${category.name} personalizados en Rivera. Pedí tu cotización desde el sitio.`,
    canonical: `${base}/categoria/${category.slug}`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "CollectionPage",
      name: category.name,
      description: category.description || undefined,
      url: `${base}/categoria/${category.slug}`,
    },
  });
});

app.get("/producto/:slug", async (req, res) => {
  const product = await getSeoProduct(String(req.params.slug));
  if (!product || !product.active) return res.status(404).send("Producto no encontrado.");
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const image = Array.isArray(product.images) ? product.images[0]?.url : null;
  const title = product.seo_title || `${product.name} | DM Gráfica Rápida`;
  const description = product.seo_description
    || product.short_description
    || `${product.name} personalizados en Rivera, Uruguay. Pedí tu cotización online.`;

  return renderPage(res, "producto.html", {
    title,
    description,
    canonical: `${base}/producto/${product.slug}`,
    jsonLd: {
      "@context": "https://schema.org",
      "@type": "Product",
      name: product.name,
      description,
      image: image ? [image] : undefined,
      category: product.category_name || undefined,
      brand: { "@type": "Brand", name: "DM Gráfica Rápida" },
      offers: {
        "@type": "Offer",
        availability: "https://schema.org/InStock",
        priceCurrency: product.currency || "UYU",
        price: product.pricing_mode === "quote" ? undefined : Number(product.price || 0),
        url: `${base}/producto/${product.slug}`,
        seller: { "@type": "Organization", name: "DM Gráfica Rápida" },
      },
    },
  });
});

app.get("/carrito", async (_req, res) => renderPage(res, "carrito.html"));
app.get("/checkout", async (_req, res) => renderPage(res, "checkout.html"));
app.get("/gracias", async (_req, res) => renderPage(res, "gracias.html"));
app.get("/seguimiento", async (_req, res) => renderPage(res, "seguimiento.html"));
app.get("/contacto", async (_req, res) => renderPage(res, "contacto.html"));
app.get("/condiciones", async (_req, res) => renderPage(res, "condiciones.html"));
app.get("/privacidad", async (_req, res) => renderPage(res, "privacidad.html"));
app.get("/admin", async (_req, res) => renderPage(res, "admin.html"));

/* -------------------------------------------------------------------------- */
/* Robots y sitemap                                                            */
/* -------------------------------------------------------------------------- */

app.get("/robots.txt", (_req, res) => {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const lines = [
    "User-agent: *",
    "Allow: /",
    "Disallow: /admin",
    "Disallow: /checkout",
    "Disallow: /carrito",
    "Disallow: /gracias",
    "Disallow: /api/",
    "",
  ];
  if (base) lines.push(`Sitemap: ${base}/sitemap.xml`);
  res.set("Content-Type", "text/plain; charset=utf-8");
  res.set("Cache-Control", "public, max-age=3600");
  return res.send(lines.join("\n"));
});

app.get("/sitemap.xml", async (_req, res) => {
  const base = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  const [categories, products] = await Promise.all([
    listCategories({ includeEmpty: true }),
    listProducts(),
  ]);

  const staticPaths = [
    { loc: "/", priority: "1.0", changefreq: "weekly" },
    { loc: "/pt/", priority: "0.9", changefreq: "weekly" },
    { loc: "/catalogo", priority: "0.9", changefreq: "weekly" },
    { loc: "/contacto", priority: "0.6", changefreq: "monthly" },
    { loc: "/seguimiento", priority: "0.4", changefreq: "monthly" },
    { loc: "/condiciones", priority: "0.3", changefreq: "yearly" },
    { loc: "/privacidad", priority: "0.3", changefreq: "yearly" },
  ];

  const entries = [
    ...staticPaths,
    ...categories.map((category) => ({
      loc: `/categoria/${category.slug}`,
      priority: "0.7",
      changefreq: "weekly",
    })),
    ...products.map((product) => ({
      loc: `/producto/${product.slug}`,
      priority: product.featured ? "0.8" : "0.6",
      changefreq: "weekly",
    })),
  ];

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map((entry) => `  <url>
    <loc>${escapeXml(`${base}${entry.loc}`)}</loc>
    <changefreq>${entry.changefreq}</changefreq>
    <priority>${entry.priority}</priority>
  </url>`).join("\n")}
</urlset>`;

  res.set("Content-Type", "application/xml; charset=utf-8");
  res.set("Cache-Control", "public, max-age=3600");
  return res.send(xml);
});

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

app.use("/api", (_req, res) => res.status(404).json({ error: "Ruta de API no encontrada." }));

app.use(express.static(publicDir, {
  dotfiles: "deny",
  index: false,
  setHeaders(res, filePath) {
    if (filePath.endsWith(".html")) res.setHeader("Cache-Control", "no-cache");
    else if (/\.(css|js|svg|woff2?|webp|jpg|jpeg|png)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=86400");
    }
  },
}));

// Logo y assets de marca que el cliente deja en src/img.
app.use("/brand", express.static(brandDir, {
  dotfiles: "deny",
  index: false,
  setHeaders(res, filePath) {
    if (/\.(svg|webp|jpg|jpeg|png|ico)$/i.test(filePath)) {
      res.setHeader("Cache-Control", "public, max-age=86400");
    }
  },
}));

app.use((_req, res) => res.status(404).send("Página no encontrada."));

app.use((error, _req, res, _next) => {
  console.error("Error no controlado:", error?.code || error?.name || "Error", "-", error?.message || "(sin mensaje)");
  if (res.headersSent) return;
  if (error?.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({ error: "La imagen supera los 4 MB." });
  }
  return res.status(500).json({ error: "Ocurrió un error. Probá de nuevo." });
});

const server = app.listen(port, "0.0.0.0", () => {
  console.log(`DM Gráfica Rápida escuchando en el puerto ${port}.`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
