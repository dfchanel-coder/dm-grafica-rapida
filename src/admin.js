import { securityAlert } from "./security-alerts.js";
import { verifySecondFactor } from "./admin-mfa.js";
import { consumeLoginLimit } from "./admin-security.js";
import { pool } from "./db.js";
import crypto from "node:crypto";
import { getSettings, updateSettings, getAdminEmail } from "./settings.js";
import { audit, destroyAdminSession, destroyAdminSessionsFor, hashPassword, verifyPassword } from "./auth.js";
import { uploadImage, deleteImage, storageConfigured } from "./storage.js";
import { notifyOrderStatus, quoteOrder, STATUS_LABELS, getOrderItems } from "./orders.js";
import {
  ValidationError,
  cleanBoolean,
  cleanImages,
  cleanInteger,
  cleanMultiline,
  cleanProductOptions,
  cleanSlug,
  cleanText,
  oneOf,
} from "./validate.js";

const DUMMY_PASSWORD_HASH = hashPassword(crypto.randomBytes(32).toString("hex"));

function categoryId(value, field = "category_id") {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) {
    throw new ValidationError("Seleccioná una categoría válida.", field);
  }
  return value.toLowerCase();
}

async function requireCategory(id) {
  if (id && !(await pool.query("SELECT id FROM categories WHERE id = $1", [id])).rows.length) {
    throw new ValidationError("La categoría seleccionada ya no existe.", "category_id");
  }
}

async function validateParent(parentId, id = null) {
  if (!parentId) return;
  if (parentId === id?.toLowerCase()) throw new ValidationError("Una categoría no puede ser su propia superior.", "parent_id");
  const parent = (await pool.query("SELECT id, parent_id FROM categories WHERE id = $1", [parentId])).rows[0];
  if (!parent) throw new ValidationError("La categoría superior ya no existe.", "parent_id");
  if (parent.parent_id) throw new ValidationError("Solo se permiten categorías y un nivel de subcategorías.", "parent_id");
  if (id && (await pool.query("SELECT id FROM categories WHERE parent_id = $1 LIMIT 1", [id])).rows.length) {
    throw new ValidationError("Esta categoría tiene subcategorías. Movelas antes de convertirla en subcategoría.", "parent_id");
  }
}

/**
 * API del panel de administración.
 *
 * Todas las rutas de escritura exigen sesión válida y token CSRF.
 * Cada cambio relevante queda en la bitácora admin_audit_events.
 */

export function createAdminHandlers() {
  /* ---------------------------------------------------------------- */
  /* Sesión                                                            */
  /* ---------------------------------------------------------------- */

  /**
   * Valida las credenciales. Devuelve el administrador o lanza ValidationError.
   * No envía la respuesta: la sesión la crea el servidor.
   */
  async function login(req, res) {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");
    if (!email || !password || email.length > 254 || password.length > 1024) {
      throw new ValidationError("Ingresá tu correo y tu contraseña.", "credentials");
    }

    const result = await pool.query(
      "SELECT id, email, name, password_hash, active, role FROM admin_users WHERE lower(email) = $1",
      [email],
    );
    const admin = result.rows[0];

    // Se compara siempre, exista el usuario o no, para no filtrar por tiempo.
    const stored = admin?.password_hash || DUMMY_PASSWORD_HASH;
    const passwordValid = await verifyPassword(password, stored) && Boolean(admin) && admin.active;
    const valid = passwordValid && await verifySecondFactor(admin.id, req.body?.code);

    if (!valid) {
      const underLimit = await consumeLoginLimit("account-failure", email, 15);
      await audit(admin?.id || null, underLimit ? "login_failed" : "login_attack", "admin", admin?.id || null);
      if (!underLimit && admin) await securityAlert("login_attack");
      if (!underLimit) await new Promise(resolve => setTimeout(resolve, 750));
      if (!underLimit) throw new ValidationError("Correo, contraseña o código de seguridad incorrectos. Demasiados intentos fallidos.", "credentials");
      throw new ValidationError("Correo, contraseña o código de seguridad incorrectos.", "credentials");
    }

    await pool.query("UPDATE admin_users SET last_login_at = NOW() WHERE id = $1", [admin.id]);
    await audit(admin.id, "login", "admin", admin.id);

    return { id: admin.id, email: admin.email, name: admin.name, role: admin.role };
  }

  async function session(req, res) {
    return res.json({
      admin: req.admin,
      csrfToken: req.adminSession.csrfToken,
    });
  }

  async function logout(req, res) {
    await destroyAdminSession(req.adminSession.token);
    res.clearCookie("dm_admin_session");
    return res.json({ ok: true });
  }

  /* ---------------------------------------------------------------- */
  /* Tablero                                                          */
  /* ---------------------------------------------------------------- */

  async function overview(req, res) {
    const [counts, revenue, statuses, recent, topProducts, lowStock] = await Promise.all([
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM orders) AS orders,
           (SELECT COUNT(*)::int FROM orders WHERE status = 'quote') AS quotes,
           (SELECT COUNT(*)::int FROM orders WHERE status = 'paid') AS paid,
           (SELECT COUNT(*)::int FROM products WHERE active) AS products,
           (SELECT COUNT(*)::int FROM products WHERE active AND manage_stock AND stock <= 3) AS low_stock,
           (SELECT COUNT(*)::int FROM inquiries WHERE status = 'new') AS new_inquiries`,
      ),
      pool.query(
        `SELECT
           COALESCE(SUM(total) FILTER (WHERE status IN ('paid','in_production','ready','delivered')), 0)::int AS paid_total,
           COALESCE(SUM(total) FILTER (WHERE created_at >= date_trunc('month', NOW())), 0)::int AS month_total,
           COUNT(*) FILTER (WHERE created_at >= date_trunc('month', NOW()))::int AS month_orders
         FROM orders`,
      ),
      pool.query("SELECT status, COUNT(*)::int AS count FROM orders GROUP BY status"),
      pool.query(
        `SELECT id, code, customer_name, customer_email, status, total, currency, created_at, requires_quote
           FROM orders ORDER BY created_at DESC LIMIT 8`,
      ),
      pool.query(
        `SELECT oi.product_name, SUM(oi.quantity)::int AS units, SUM(oi.line_total)::int AS revenue
           FROM order_items oi
           JOIN orders o ON o.id = oi.order_id
          WHERE o.status IN ('paid','in_production','ready','delivered') AND oi.is_quote = false
          GROUP BY oi.product_name
          ORDER BY units DESC LIMIT 8`,
      ),
      pool.query(
        `SELECT id, name, slug, stock, manage_stock FROM products
          WHERE active AND manage_stock ORDER BY stock ASC LIMIT 8`,
      ),
    ]);

    const settings = await getSettings();
    const setup = {
      productsWithoutPrice: counts.rows[0].products > 0
        ? (await pool.query(
          "SELECT COUNT(*)::int AS count FROM products WHERE active AND pricing_mode = 'fixed' AND price = 0",
        )).rows[0].count
        : 0,
      inactiveProducts: (await pool.query("SELECT COUNT(*)::int AS count FROM products WHERE NOT active")).rows[0].count,
      hasAdminEmail: Boolean((await getAdminEmail())),
      checkoutEnabled: process.env.CHECKOUT_ENABLED === "true",
      storageReady: storageConfigured(),
      hasWhatsapp: Boolean(settings.business?.whatsapp),
    };

    return res.json({
      counts: counts.rows[0],
      revenue: revenue.rows[0],
      ordersByStatus: Object.fromEntries(statuses.rows.map((row) => [row.status, row.count])),
      recentOrders: recent.rows,
      topProducts: topProducts.rows,
      lowStock: lowStock.rows,
      setup,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Productos                                                         */
  /* ---------------------------------------------------------------- */

  async function listProducts(req, res) {
    const result = await pool.query(
      `SELECT p.*, c.name AS category_name,
              (SELECT COUNT(*)::int FROM order_items oi WHERE oi.product_id = p.id) AS orders_count
         FROM products p
         LEFT JOIN categories c ON c.id = p.category_id
        ORDER BY p.active DESC, p.sort_order, p.name`,
    );
    return res.json({ products: result.rows });
  }

  function productPayload(body, { partial = false } = {}) {
    const payload = {};

    if (body.name !== undefined || !partial) {
      payload.name = cleanText(body.name, { max: 160, min: 2, field: "name", label: "el nombre" });
    }
    if (body.slug !== undefined || !partial) {
      payload.slug = cleanSlug(body.slug || body.name, { field: "slug", label: "el identificador" });
    }
    if (body.short_description !== undefined || !partial) {
      payload.short_description = cleanText(body.short_description, { max: 300, field: "short_description", label: "la descripción corta" });
    }
    if (body.description !== undefined || !partial) {
      payload.description = cleanMultiline(body.description, { max: 6000, field: "description", label: "la descripción" });
    }
    if (body.price !== undefined || !partial) {
      payload.price = cleanInteger(body.price ?? 0, { min: 0, max: 10_000_000, field: "price", label: "el precio" });
    }
    if (body.payment_rule !== undefined || !partial) payload.payment_rule = oneOf(body.payment_rule || "none", ["none", "mp_surcharge", "cash_discount"], { field: "payment_rule", label: "la regla de pago" });
    if (body.payment_percent !== undefined || !partial) payload.payment_percent = cleanInteger(body.payment_percent ?? 12, { min: 0, max: 100, field: "payment_percent", label: "el porcentaje" });
    if (body.compare_at_price !== undefined) {
      payload.compare_at_price = body.compare_at_price === null || body.compare_at_price === ""
        ? null
        : cleanInteger(body.compare_at_price, { min: 0, max: 10_000_000, field: "compare_at_price", label: "el precio tachado" });
    }
    if (body.pricing_mode !== undefined || !partial) {
      payload.pricing_mode = oneOf(body.pricing_mode || "fixed", ["fixed", "quote"], { field: "pricing_mode", label: "el modo de precio" });
      payload.requires_quote = payload.pricing_mode === "quote";
    }
    if (body.images !== undefined || !partial) {
      payload.images = JSON.stringify(cleanImages(body.images));
    }
    if (body.options !== undefined || !partial) {
      payload.options = JSON.stringify(cleanProductOptions(body.options));
    }
    if (body.category_id !== undefined || !partial) {
      payload.category_id = categoryId(body.category_id);
    }
    if (body.personalization_enabled !== undefined || !partial) {
      payload.personalization_enabled = cleanBoolean(body.personalization_enabled, false);
    }
    if (body.personalization_prompt !== undefined || !partial) {
      payload.personalization_prompt = cleanMultiline(body.personalization_prompt, { max: 1000, field: "personalization_prompt", label: "la indicación" });
    }
    if (body.min_quantity !== undefined || !partial) {
      payload.min_quantity = cleanInteger(body.min_quantity ?? 1, { min: 1, max: 10_000, field: "min_quantity", label: "el mínimo" });
    }
    if (body.manage_stock !== undefined || !partial) {
      payload.manage_stock = cleanBoolean(body.manage_stock, false);
    }
    if (body.stock !== undefined || !partial) {
      payload.stock = cleanInteger(body.stock ?? 0, { min: 0, max: 1_000_000, field: "stock", label: "el stock" });
    }
    if (body.lead_time_days !== undefined || !partial) {
      payload.lead_time_days = cleanInteger(body.lead_time_days ?? 3, { min: 0, max: 365, field: "lead_time_days", label: "los días de producción" });
    }
    if (body.featured !== undefined || !partial) {
      payload.featured = cleanBoolean(body.featured, false);
    }
    if (body.active !== undefined || !partial) {
      payload.active = cleanBoolean(body.active, false);
    }
    if (body.sort_order !== undefined || !partial) {
      payload.sort_order = cleanInteger(body.sort_order ?? 0, { min: 0, max: 100_000, field: "sort_order", label: "el orden" });
    }
    if (body.seo_title !== undefined) {
      payload.seo_title = cleanText(body.seo_title, { max: 70, field: "seo_title", label: "el título SEO" });
    }
    if (body.seo_description !== undefined) {
      payload.seo_description = cleanText(body.seo_description, { max: 165, field: "seo_description", label: "la descripción SEO" });
    }

    return payload;
  }

  async function createProduct(req, res) {
    const payload = productPayload(req.body || {});
    await requireCategory(payload.category_id);
    const columns = Object.keys(payload);
    const values = columns.map((column) => payload[column]);
    const placeholders = columns.map((_, index) => `$${index + 1}`);

    try {
      const result = await pool.query(
        `INSERT INTO products (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) RETURNING *`,
        values,
      );
      await audit(req.admin.id, "create", "product", result.rows[0].id, { name: result.rows[0].name });
      return res.status(201).json({ product: result.rows[0] });
    } catch (error) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "Ya existe un producto con ese identificador." });
      }
      if (error?.code === "23503") throw new ValidationError("La categoría seleccionada ya no existe.", "category_id");
      throw error;
    }
  }

  async function updateProduct(req, res) {
    const payload = productPayload(req.body || {}, { partial: true });
    await requireCategory(payload.category_id);
    const columns = Object.keys(payload);
    if (!columns.length) return res.status(400).json({ error: "No hay nada que actualizar." });

    const sets = columns.map((column, index) => `${column} = $${index + 1}`);
    const values = columns.map((column) => payload[column]);

    try {
      const result = await pool.query(
        `UPDATE products SET ${sets.join(", ")}, updated_at = NOW() WHERE id = $${columns.length + 1} RETURNING *`,
        [...values, req.params.id],
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Producto no encontrado." });
      await audit(req.admin.id, "update", "product", req.params.id, { fields: columns });
      return res.json({ product: result.rows[0] });
    } catch (error) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "Ya existe un producto con ese identificador." });
      }
      if (error?.code === "23503") throw new ValidationError("La categoría seleccionada ya no existe.", "category_id");
      throw error;
    }
  }

  async function deleteProduct(req, res) {
    const result = await pool.query("DELETE FROM products WHERE id = $1 RETURNING id, name", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Producto no encontrado." });
    await audit(req.admin.id, "delete", "product", req.params.id, { name: result.rows[0].name });
    return res.json({ ok: true });
  }

  async function uploadProductImage(req, res) {
    if (!storageConfigured()) {
      return res.status(503).json({ error: "El almacenamiento de imágenes no está configurado." });
    }
    const file = req.file;
    if (!file) return res.status(400).json({ error: "No se recibió ninguna imagen." });

    try {
      const uploaded = await uploadImage({
        buffer: file.buffer,
        filename: file.originalname,
        contentType: file.mimetype,
      });
      await audit(req.admin.id, "upload_image", "product", req.params.id, { url: uploaded.url });
      return res.status(201).json({ url: uploaded.url });
    } catch (error) {
      return res.status(400).json({ error: error?.message || "No pudimos subir la imagen." });
    }
  }

  async function deleteProductImage(req, res) {
    const url = String(req.body?.url || req.query?.url || "");
    if (!url) throw new ValidationError("Indicá la imagen que querés eliminar.", "url");
    const removed = await deleteImage(url);
    await audit(req.admin.id, "delete_image", "product", req.params.id, { url, removed: removed.deleted });
    return res.json({ ok: true, removed: removed.deleted });
  }

  /* ---------------------------------------------------------------- */
  /* Categorías                                                        */
  /* ---------------------------------------------------------------- */

  async function listCategories(req, res) {
    const result = await pool.query(
      `SELECT c.*, parent.slug AS parent_slug, parent.name AS parent_name,
              (SELECT COUNT(*)::int FROM products p WHERE p.category_id = c.id
                 OR p.category_id IN (SELECT id FROM categories WHERE parent_id = c.id)) AS product_count
         FROM categories c LEFT JOIN categories parent ON parent.id = c.parent_id
        ORDER BY c.sort_order, c.name`,
    );
    return res.json({ categories: result.rows });
  }

  async function createCategory(req, res) {
    const name = cleanText(req.body?.name, { max: 100, min: 2, field: "name", label: "el nombre" });
    const slug = cleanSlug(req.body?.slug || name, { field: "slug", label: "el identificador" });
    const description = cleanText(req.body?.description, { max: 400, field: "description", label: "la descripción" });
    const sortOrder = cleanInteger(req.body?.sort_order ?? 0, { min: 0, max: 10_000, field: "sort_order", label: "el orden" });
    const active = cleanBoolean(req.body?.active, true);
    const parentId = categoryId(req.body?.parent_id, "parent_id");
    await validateParent(parentId);

    try {
      const result = await pool.query(
        `INSERT INTO categories (name, slug, description, sort_order, active, parent_id)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [name, slug, description, sortOrder, active, parentId],
      );
      await audit(req.admin.id, "create", "category", result.rows[0].id, { name });
      return res.status(201).json({ category: result.rows[0] });
    } catch (error) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "Ya existe una categoría con ese identificador." });
      }
      if (error?.code === "23503") throw new ValidationError("La categoría superior ya no existe.", "parent_id");
      if (error?.code === "23514") throw new ValidationError("Solo se permiten categorías y un nivel de subcategorías.", "parent_id");
      throw error;
    }
  }

  async function updateCategory(req, res) {
    categoryId(req.params.id);
    const fields = [];
    const values = [];
    if (req.body?.parent_id !== undefined) {
      const parentId = categoryId(req.body.parent_id, "parent_id");
      await validateParent(parentId, req.params.id);
      fields.push(`parent_id = $${values.length + 1}`);
      values.push(parentId);
    }
    if (req.body?.role !== undefined) {
      fields.push(`role = $${values.length + 1}`);
      values.push(oneOf(req.body.role, ["owner", "operator"], { field: "role", label: "el permiso" }));
    }
    if (req.body?.name !== undefined) {
      fields.push(`name = $${values.length + 1}`);
      values.push(cleanText(req.body.name, { max: 100, min: 2, field: "name", label: "el nombre" }));
    }
    if (req.body?.slug !== undefined) {
      fields.push(`slug = $${values.length + 1}`);
      values.push(cleanSlug(req.body.slug, { field: "slug", label: "el identificador" }));
    }
    if (req.body?.description !== undefined) {
      fields.push(`description = $${values.length + 1}`);
      values.push(cleanText(req.body.description, { max: 400, field: "description", label: "la descripción" }));
    }
    if (req.body?.sort_order !== undefined) {
      fields.push(`sort_order = $${values.length + 1}`);
      values.push(cleanInteger(req.body.sort_order, { min: 0, max: 10_000, field: "sort_order", label: "el orden" }));
    }
    if (req.body?.active !== undefined) {
      fields.push(`active = $${values.length + 1}`);
      values.push(cleanBoolean(req.body.active, true));
    }
    if (!fields.length) return res.status(400).json({ error: "No hay nada que actualizar." });

    try {
      const result = await pool.query(
        `UPDATE categories SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $${values.length + 1} RETURNING *`,
        [...values, req.params.id],
      );
      if (!result.rows[0]) return res.status(404).json({ error: "Categoría no encontrada." });
      await audit(req.admin.id, "update", "category", req.params.id);
      return res.json({ category: result.rows[0] });
    } catch (error) {
      if (error?.code === "23505") {
        return res.status(409).json({ error: "Ya existe una categoría con ese identificador." });
      }
      if (error?.code === "23503") throw new ValidationError("La categoría superior ya no existe.", "parent_id");
      if (error?.code === "23514") throw new ValidationError("Solo se permiten categorías y un nivel de subcategorías.", "parent_id");
      throw error;
    }
  }

  async function deleteCategory(req, res) {
    categoryId(req.params.id);
    let result;
    try {
      result = await pool.query("DELETE FROM categories WHERE id = $1 RETURNING id, name", [req.params.id]);
    } catch (error) {
      if (error?.code === "23503") return res.status(409).json({ error: "Esta categoría tiene productos o subcategorías. Reasignalos antes de eliminarla, o desactivala." });
      throw error;
    }
    if (!result.rows[0]) return res.status(404).json({ error: "Categoría no encontrada." });
    await audit(req.admin.id, "delete", "category", req.params.id, { name: result.rows[0].name });
    return res.json({ ok: true });
  }

  /* ---------------------------------------------------------------- */
  /* Pedidos                                                           */
  /* ---------------------------------------------------------------- */

  async function listOrders(req, res) {
    const status = req.query.status ? String(req.query.status) : "";
    const search = String(req.query.q || "").trim();
    const limit = Math.min(Number(req.query.limit || 100), 300);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const conditions = [];
    const values = [];

    if (status && status !== "all") {
      values.push(status);
      conditions.push(`o.status = $${values.length}`);
    }
    if (search) {
      values.push(`%${search}%`);
      conditions.push(`(o.code ILIKE $${values.length} OR o.customer_name ILIKE $${values.length} OR o.customer_email ILIKE $${values.length})`);
    }
    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

    const [orders, total] = await Promise.all([
      pool.query(
        `SELECT o.id, o.code, o.status, o.customer_name, o.customer_email, o.customer_phone,
                o.delivery_method, o.total, o.currency, o.created_at, o.paid_at,
                o.requires_quote, o.quoted_total, o.payment_status,
                (SELECT COUNT(*)::int FROM order_items oi WHERE oi.order_id = o.id) AS item_count
           FROM orders o ${where}
          ORDER BY o.created_at DESC LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      ),
      pool.query(`SELECT COUNT(*)::int AS count FROM orders o ${where}`, values),
    ]);

    return res.json({
      orders: orders.rows,
      total: total.rows[0].count,
      statusLabels: STATUS_LABELS,
    });
  }

  async function getOrder(req, res) {
    const result = await pool.query("SELECT * FROM orders WHERE id = $1 OR code = $2", [req.params.id, req.params.id]);
    const order = result.rows[0];
    if (!order) return res.status(404).json({ error: "Pedido no encontrado." });
    if (order.payment_confirmed_by) {
      order.payment_confirmed_by_name = (await pool.query("SELECT name FROM admin_users WHERE id = $1", [order.payment_confirmed_by])).rows[0]?.name;
    }
    const items = await getOrderItems(order.id);
    return res.json({ order, items, statusLabels: STATUS_LABELS });
  }

  async function updateOrder(req, res) {
    const client = await pool.connect();
    let updated, statusChanged = false;
    try {
      await client.query("BEGIN");
      const order = (await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [req.params.id])).rows[0];
      if (!order) throw new ValidationError("Pedido no encontrado.");
      const status = req.body?.status === undefined ? order.status : oneOf(req.body.status, Object.keys(STATUS_LABELS), { label: "el estado" });
      if (status !== order.status) {
        const allowed = order.paid_at ? ["in_production", "ready", "delivered", "cancelled"] : ["cancelled"];
        if (!allowed.includes(status) || order.status === "refunded") throw new ValidationError("Usá la confirmación de pago para registrar un cobro. No se puede asignar ese estado manualmente.");
      }
      updated = (await client.query(`UPDATE orders SET status = $2, internal_notes = $3, estimated_delivery = $4, customer_phone = $5, updated_at = NOW() WHERE id = $1 RETURNING *`,
        [order.id, status, cleanMultiline(req.body?.internal_notes ?? order.internal_notes, { max: 4000 }), cleanText(req.body?.estimated_delivery ?? order.estimated_delivery, { max: 120 }), cleanText(req.body?.customer_phone ?? order.customer_phone, { max: 40 })])).rows[0];
      statusChanged = status !== order.status;
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    await audit(req.admin.id, "update", "order", req.params.id, { status: updated.status });
    if (statusChanged) await notifyOrderStatus(updated.id, STATUS_LABELS[updated.status]);
    return res.json({ order: updated });
  }

  async function quoteOrderHandler(req, res) {
    try {
      const result = await quoteOrder(req.params.id, {
        quoteAmount: req.body?.quote_amount,
        quoteItems: req.body?.quote_items,
        quoteNotes: req.body?.quote_notes,
        generatePaymentLink: req.body?.generate_payment_link !== false,
      });
      await audit(req.admin.id, "quote", "order", req.params.id, { quote_amount: req.body?.quote_amount });
      return res.json(result);
    } catch (error) {
      if (error instanceof ValidationError) return res.status(400).json({ error: error.message });
      throw error;
    }
  }

  /* ---------------------------------------------------------------- */
  /* Consultas                                                         */
  /* ---------------------------------------------------------------- */

  async function listInquiries(req, res) {
    const result = await pool.query(
      `SELECT * FROM inquiries ORDER BY (status = 'new') DESC, created_at DESC LIMIT 200`,
    );
    return res.json({ inquiries: result.rows });
  }

  async function updateInquiry(req, res) {
    const status = oneOf(req.body?.status, ["new", "read", "answered", "archived"], { field: "status", label: "el estado" });
    const result = await pool.query(
      "UPDATE inquiries SET status = $2 WHERE id = $1 RETURNING *",
      [req.params.id, status],
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Consulta no encontrada." });
    await audit(req.admin.id, "update", "inquiry", req.params.id, { status });
    return res.json({ inquiry: result.rows[0] });
  }

  /* ---------------------------------------------------------------- */
  /* Cupones                                                           */
  /* ---------------------------------------------------------------- */

  async function listCoupons(req, res) {
    const result = await pool.query("SELECT * FROM coupons ORDER BY created_at DESC");
    return res.json({ coupons: result.rows });
  }

  async function createCoupon(req, res) {
    const code = cleanText(req.body?.code, { max: 30, min: 2, field: "code", label: "el código" }).toUpperCase();
    const discountType = oneOf(req.body?.discount_type, ["percent", "fixed"], { field: "discount_type", label: "el tipo de descuento" });
    const discountValue = cleanInteger(req.body?.discount_value, { min: 1, max: 10_000_000, field: "discount_value", label: "el valor" });
    const minSubtotal = cleanInteger(req.body?.min_subtotal ?? 0, { min: 0, max: 10_000_000, field: "min_subtotal", label: "el mínimo" });
    const maxUses = req.body?.max_uses === null || req.body?.max_uses === ""
      ? null
      : cleanInteger(req.body.max_uses, { min: 1, max: 1_000_000, field: "max_uses", label: "el límite de usos" });
    const description = cleanText(req.body?.description, { max: 300, field: "description", label: "la descripción" });

    try {
      const result = await pool.query(
        `INSERT INTO coupons (code, description, discount_type, discount_value, min_subtotal, max_uses, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [code, description, discountType, discountValue, minSubtotal, maxUses, cleanBoolean(req.body?.active, true)],
      );
      await audit(req.admin.id, "create", "coupon", result.rows[0].id, { code });
      return res.status(201).json({ coupon: result.rows[0] });
    } catch (error) {
      if (error?.code === "23505") return res.status(409).json({ error: "Ya existe un cupón con ese código." });
      throw error;
    }
  }

  async function updateCoupon(req, res) {
    const fields = [];
    const values = [];
    if (req.body?.active !== undefined) {
      fields.push(`active = $${values.length + 1}`);
      values.push(cleanBoolean(req.body.active, true));
    }
    if (req.body?.description !== undefined) {
      fields.push(`description = $${values.length + 1}`);
      values.push(cleanText(req.body.description, { max: 300, field: "description", label: "la descripción" }));
    }
    if (req.body?.discount_value !== undefined) {
      fields.push(`discount_value = $${values.length + 1}`);
      values.push(cleanInteger(req.body.discount_value, { min: 1, max: 10_000_000, field: "discount_value", label: "el valor" }));
    }
    if (req.body?.max_uses !== undefined) {
      fields.push(`max_uses = $${values.length + 1}`);
      values.push(req.body.max_uses === null ? null : cleanInteger(req.body.max_uses, { min: 1, max: 1_000_000, field: "max_uses", label: "el límite de usos" }));
    }
    if (!fields.length) return res.status(400).json({ error: "No hay nada que actualizar." });

    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE coupons SET ${fields.join(", ")}, updated_at = NOW() WHERE id = $${values.length} RETURNING *`,
      values,
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Cupón no encontrado." });
    await audit(req.admin.id, "update", "coupon", req.params.id);
    return res.json({ coupon: result.rows[0] });
  }

  async function deleteCoupon(req, res) {
    const result = await pool.query("DELETE FROM coupons WHERE id = $1 RETURNING id", [req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: "Cupón no encontrado." });
    await audit(req.admin.id, "delete", "coupon", req.params.id);
    return res.json({ ok: true });
  }

  /* ---------------------------------------------------------------- */
  /* Ajustes                                                           */
  /* ---------------------------------------------------------------- */

  async function getSettingsHandler(req, res) {
    const settings = await getSettings({ fresh: true });
    return res.json({ settings });
  }

  async function updateSettingsHandler(req, res) {
    const previous = await getSettings({ fresh: true });
    const settings = await updateSettings(req.body || {});
    const paymentsChanged = JSON.stringify(previous.payments) !== JSON.stringify(settings.payments);
    await audit(req.admin.id, "update", "settings", null, { paymentsChanged });
    if (paymentsChanged) await securityAlert("payment_settings");
    return res.json({ settings });
  }

  /* ---------------------------------------------------------------- */
  /* Correos y bitácora                                                */
  /* ---------------------------------------------------------------- */

  async function listEmails(req, res) {
    const result = await pool.query(
      `SELECT id, to_email, subject, template, order_id, status, error, created_at
         FROM email_log ORDER BY created_at DESC LIMIT 200`,
    );
    return res.json({ emails: result.rows });
  }

  async function listAudit(req, res) {
    const result = await pool.query(
      `SELECT a.id, a.action, a.target_type, a.target_id, a.detail, a.created_at,
              u.name AS admin_name, u.email AS admin_email
         FROM admin_audit_events a
         LEFT JOIN admin_users u ON u.id = a.admin_id
        ORDER BY a.created_at DESC LIMIT 200`,
    );
    return res.json({ events: result.rows });
  }

  /* ---------------------------------------------------------------- */
  /* Administradores                                                   */
  /* ---------------------------------------------------------------- */

  async function listAdmins(req, res) {
    const result = await pool.query(
      `SELECT id, email, name, active, role, created_at, last_login_at FROM admin_users ORDER BY created_at`,
    );
    return res.json({ admins: result.rows });
  }

  async function createAdmin(req, res) {
    const email = String(req.body?.email || "").trim().toLowerCase();
    const name = cleanText(req.body?.name, { max: 100, min: 2, field: "name", label: "el nombre" });
    const password = String(req.body?.password || "");
    if (!email || !email.includes("@")) return res.status(400).json({ error: "El correo no es válido." });
    if (password.length < 10 || password.length > 1024) {
      return res.status(400).json({ error: "La contraseña debe tener al menos 10 caracteres." });
    }

    const role = oneOf(req.body?.role || "operator", ["owner", "operator"], { field: "role", label: "el permiso" });
    try {
      const result = await pool.query(
        `INSERT INTO admin_users (email, name, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING id, email, name, active, created_at`,
        [email, name, hashPassword(password), role],
      );
      await audit(req.admin.id, "create", "admin_user", result.rows[0].id, { email, role });
      await securityAlert("admin_changed");
      return res.status(201).json({ admin: result.rows[0] });
    } catch (error) {
      if (error?.code === "23505") return res.status(409).json({ error: "Ya existe un administrador con ese correo." });
      throw error;
    }
  }

  async function updateAdmin(req, res) {
    if (req.params.id === req.admin.id && (req.body?.active !== undefined && !cleanBoolean(req.body.active, true) || req.body?.role && req.body.role !== "owner")) {
      return res.status(400).json({ error: "No podés desactivar tu propia cuenta ni reducir tus propios permisos." });
    }
    const fields = [];
    const values = [];
    if (req.body?.role !== undefined) {
      fields.push(`role = $${values.length + 1}`);
      values.push(oneOf(req.body.role, ["owner", "operator"], { field: "role", label: "el permiso" }));
    }
    if (req.body?.name !== undefined) {
      fields.push(`name = $${values.length + 1}`);
      values.push(cleanText(req.body.name, { max: 100, min: 2, field: "name", label: "el nombre" }));
    }
    if (req.body?.active !== undefined) {
      fields.push(`active = $${values.length + 1}`);
      values.push(cleanBoolean(req.body.active, true));
    }
    if (req.body?.password) {
      const password = String(req.body.password);
      if (password.length < 10 || password.length > 1024) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 10 caracteres." });
      }
      fields.push(`password_hash = $${values.length + 1}`);
      values.push(hashPassword(password));
    }
    if (!fields.length) return res.status(400).json({ error: "No hay nada que actualizar." });

    values.push(req.params.id);
    const result = await pool.query(
      `UPDATE admin_users SET ${fields.join(", ")} WHERE id = $${values.length} RETURNING id, email, name, active`,
      values,
    );
    if (!result.rows[0]) return res.status(404).json({ error: "Administrador no encontrado." });

    // Un cambio de contraseña cierra las sesiones abiertas de ese usuario.
    if (req.body?.password) {
      await destroyAdminSessionsFor(req.params.id);
    }
    await audit(req.admin.id, "update", "admin_user", req.params.id, { role: req.body?.role, active: req.body?.active, passwordChanged: Boolean(req.body?.password) });
    await securityAlert("admin_changed");
    return res.json({ admin: result.rows[0] });
  }

  return {
    login,
    session,
    logout,
    overview,
    listProducts,
    createProduct,
    updateProduct,
    deleteProduct,
    uploadProductImage,
    deleteProductImage,
    listCategories,
    createCategory,
    updateCategory,
    deleteCategory,
    listOrders,
    getOrder,
    updateOrder,
    quoteOrderHandler,
    listInquiries,
    updateInquiry,
    listCoupons,
    createCoupon,
    updateCoupon,
    deleteCoupon,
    getSettingsHandler,
    updateSettingsHandler,
    listEmails,
    listAudit,
    listAdmins,
    createAdmin,
    updateAdmin,
  };
}
