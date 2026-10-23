import { paymentTotals, allocateAmount } from "../public/js/payment-pricing.js";
import { paymentMethods, paymentSnapshot, requirePaymentMethod } from "./payment-methods.js";
import { settleOrder } from "./settlement.js";
import { pool } from "./db.js";
import { getSettings, getAdminEmail } from "./settings.js";
import { resolveSelection, shippingCostFor } from "./pricing.js";
import { createPreference, fetchPaymentsForOrder, applyPayment, checkoutEnabled, paymentMode } from "./payments.js";
import { sendEmail } from "./email.js";
import {
  orderConfirmationCustomer,
  orderStatusCustomer,
  newOrderAdmin,
  newInquiryAdmin,
} from "./email-templates.js";
import {
  ValidationError,
  cleanEmail,
  cleanInteger,
  cleanMultiline,
  cleanPhone,
  cleanText,
  generateOrderCode,
  normalizeOrderCode,
} from "./validate.js";

/**
 * Pedidos sin registro (invitado).
 *
 * El cliente no crea cuenta: completa el checkout, paga con Mercado Pago y
 * recibe un código de pedido (DMR-XXXXXX) con el que puede seguir su compra
 * usando su correo.
 */

const STATUS_LABELS = {
  quote: "Esperando cotización",
  pending_payment: "Pago pendiente",
  paid: "Pago confirmado",
  in_production: "En producción",
  ready: "Listo para retirar o enviar",
  delivered: "Entregado",
  cancelled: "Cancelado",
  refunded: "Reembolsado",
  failed: "Pago no aprobado",
  review: "Revisión manual",
};

export { STATUS_LABELS };

function publicUrl() {
  return (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
}

/* -------------------------------------------------------------------------- */
/* Carrito                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Valida el carrito y calcula los precios con datos de la base.
 * Devuelve los ítems listos para persistir.
 */
export async function prepareCart(rawItems) {
  if (!Array.isArray(rawItems) || !rawItems.length) {
    throw new ValidationError("El carrito está vacío.", "items");
  }
  if (rawItems.length > 30) {
    throw new ValidationError("El carrito tiene demasiados productos.", "items");
  }

  const ids = [...new Set(rawItems.map((item) => item?.productId).filter(Boolean))];
  const result = await pool.query(
    `SELECT p.id, p.slug, p.name, p.price, p.options, p.min_quantity, p.manage_stock, p.stock,
            p.active, p.pricing_mode, p.requires_quote, p.images, p.lead_time_days, p.payment_rule, p.payment_percent
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN categories parent ON parent.id = c.parent_id
      WHERE p.id = ANY($1::uuid[])
        AND p.active AND (c.id IS NULL OR c.active) AND (parent.id IS NULL OR parent.active)`,
    [ids],
  );
  const byId = new Map(result.rows.map((row) => [row.id, row]));

  const settings = await getSettings();
  const maxPerItem = Number(settings.checkout?.max_qty_per_item || 1000);

  const lines = [];
  for (const raw of rawItems) {
    const product = byId.get(raw?.productId);
    if (!product || !product.active) {
      throw new ValidationError("Uno de los productos ya no está disponible.", "items");
    }

    const quantity = cleanInteger(raw?.quantity ?? 1, {
      min: 1,
      max: maxPerItem,
      field: "quantity",
      label: "la cantidad",
    });
    if (quantity < product.min_quantity) {
      throw new ValidationError(`“${product.name}” tiene un mínimo de ${product.min_quantity} unidades.`, "quantity");
    }
    if (product.manage_stock && product.stock < quantity) {
      throw new ValidationError(`Quedan ${product.stock} unidades de “${product.name}”.`, "quantity");
    }

    const { snapshot, delta } = resolveSelection(product.options || [], raw?.options || {});
    const customization = cleanMultiline(raw?.customization, {
      max: 800,
      field: "customization",
      label: "la personalización",
    });

    const isQuote = product.pricing_mode === "quote" || product.requires_quote;
    const unitPrice = isQuote ? 0 : Math.max(0, Number(product.price || 0) + delta);

    lines.push({
      payment_rule: product.payment_rule || "none",
      payment_percent: product.payment_percent || 0,
      product_id: product.id,
      product_name: product.name,
      product_slug: product.slug,
      image_url: Array.isArray(product.images) ? product.images[0]?.url || null : null,
      quantity,
      unit_price: unitPrice,
      line_total: unitPrice * quantity,
      options: snapshot,
      customization,
      is_quote: isQuote,
      lead_time_days: product.lead_time_days,
    });
  }

  const subtotal = lines.reduce((sum, line) => sum + line.line_total, 0);
  const hasQuote = lines.some((line) => line.is_quote);

  return { lines, subtotal, hasQuote, settings };
}

/* -------------------------------------------------------------------------- */
/* Cupones                                                                    */
/* -------------------------------------------------------------------------- */

async function resolveCoupon(code, subtotal) {
  const cleanCode = cleanText(code, { max: 30, field: "coupon", label: "el código" }).toUpperCase();
  if (!cleanCode) return null;

  const result = await pool.query(
    `SELECT * FROM coupons
      WHERE upper(code) = $1 AND active = true
        AND (valid_from IS NULL OR valid_from <= NOW())
        AND (valid_until IS NULL OR valid_until >= NOW())`,
    [cleanCode],
  );
  const coupon = result.rows[0];
  if (!coupon) throw new ValidationError("Ese código de descuento no es válido.", "coupon");
  if (coupon.max_uses !== null && coupon.used_count >= coupon.max_uses) {
    throw new ValidationError("Ese código ya alcanzó su límite de uso.", "coupon");
  }
  if (subtotal < coupon.min_subtotal) {
    throw new ValidationError(`Ese código se aplica a pedidos de $ ${coupon.min_subtotal} o más.`, "coupon");
  }

  const discount = coupon.discount_type === "percent"
    ? Math.round((subtotal * coupon.discount_value) / 100)
    : Math.min(coupon.discount_value, subtotal);

  return { coupon, discount };
}

/* -------------------------------------------------------------------------- */
/* Creación del pedido                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Crea el pedido a partir del carrito y los datos del cliente.
 *
 * Si el carrito tiene productos a cotizar, el pedido queda como cotización
 * y el administrador es el que fija el precio y genera el link de pago.
 * Si todos tienen precio, se genera el link de Mercado Pago al instante.
 */
export async function createOrder({ customer, items, delivery, notes = "", couponCode = "", paymentMethod = "mercadopago", expectedTotal }) {
  const settings = await getSettings();

  const name = cleanText(customer?.name, { max: 120, min: 2, field: "name", label: "el nombre" });
  const email = cleanEmail(customer?.email);
  const phone = cleanPhone(customer?.phone);
  const taxId = cleanText(customer?.taxId, { max: 40, field: "taxId", label: "el RUT o cédula" });

  const deliveryMethod = delivery?.method === "pickup" ? "pickup" : "shipping";
  if (deliveryMethod === "pickup" && settings.checkout?.allow_pickup === false) {
    throw new ValidationError("El retiro en el local no está disponible.", "delivery");
  }

  const address = cleanText(delivery?.address, { max: 300, field: "address", label: "la dirección" });
  const city = cleanText(delivery?.city, { max: 120, field: "city", label: "la ciudad" });
  const department = cleanText(delivery?.department, { max: 120, field: "department", label: "el departamento" });

  if (deliveryMethod === "shipping") {
    if (!address) throw new ValidationError("Falta la dirección de envío.", "address");
    if (!city) throw new ValidationError("Falta la ciudad de envío.", "city");
    if (!department) throw new ValidationError("Falta el departamento de envío.", "department");
  }

  const customerNotes = cleanMultiline(notes, { max: 1500, field: "notes", label: "las notas" });

  const { lines, subtotal, hasQuote } = await prepareCart(items);

  const couponInfo = await resolveCoupon(couponCode, subtotal);
  const discount = couponInfo?.discount || 0;

  const shippingCost = shippingCostFor({ settings, subtotal: subtotal - discount, deliveryMethod });
  requirePaymentMethod(settings, paymentMethod, { quote: hasQuote });
  const totals = paymentTotals(lines, { method: paymentMethod, discount, shipping: shippingCost, tax: settings.tax || {} });
  validateTotal(totals.total, expectedTotal);


  const minOrder = Number(settings.checkout?.min_order || 0);
  if (!hasQuote && minOrder > 0 && totals.total < minOrder) {
    throw new ValidationError(`El pedido mínimo es de $ ${minOrder}.`, "total");
  }

  const code = await generateUniqueOrderCode();
  const client = await pool.connect();
  let order;
  try {
    await client.query("BEGIN");
    const insert = await client.query(
      `INSERT INTO orders (
         code, status, customer_name, customer_email, customer_phone, customer_tax_id,
         delivery_method, shipping_address, shipping_city, shipping_department,
         notes, subtotal, discount, shipping_cost, tax, total, currency,
         coupon_code, requires_quote, estimated_delivery, payment_provider, payment_adjustment, payment_snapshot, tax_snapshot, payment_revision
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
         $11, $12, $13, $14, $15, $16, 'UYU', $17, $18, $19, $20, $21, $22, $23, 1
       ) RETURNING *`,
      [
        code,
        hasQuote ? "quote" : "pending_payment",
        name, email, phone, taxId,
        deliveryMethod, address, city, department,
        customerNotes,
        totals.subtotal, totals.discount, totals.shipping, totals.tax, totals.total,
        couponInfo?.coupon.code || null,
        hasQuote,
        estimateDelivery(lines), paymentMethod, totals.adjustment, JSON.stringify(paymentSnapshot(settings, paymentMethod)), JSON.stringify(settings.tax || {}),
      ],
    );
    order = insert.rows[0];

    for (const [position, line] of lines.entries()) {
      await client.query(
        `INSERT INTO order_items (
           order_id, product_id, product_name, product_slug, unit_price, quantity,
           options, customization, image_url, line_total, is_quote, payment_rule, payment_percent, position
         ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          order.id, line.product_id, line.product_name, line.product_slug,
          line.unit_price, line.quantity,
          JSON.stringify(line.options), line.customization, line.image_url,
          line.line_total, line.is_quote, line.payment_rule, line.payment_percent, position,
        ],
      );
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }

  // Un pedido a cotizar no genera link de pago: primero cotiza el administrador.
  if (hasQuote) {
    await notifyQuoteRequest(order, lines);
    return { order, checkoutUrl: null, requiresQuote: true };
  }

  if (paymentMethod !== "mercadopago") {
    await notifyPaymentInstructions(order);
    await notifyNewOrder(order.id);
    return { order, checkoutUrl: null, requiresQuote: false };
  }

  try {
    const checkoutUrl = await issuePaymentLink(order);
    return { order, checkoutUrl, requiresQuote: false };
  } catch (error) {
    console.error("No se pudo crear la preferencia de Mercado Pago:", error?.message || "Error");
    await pool.query(
      "UPDATE orders SET status = 'failed', updated_at = NOW() WHERE id = $1 AND payment_revision = $2 AND paid_at IS NULL AND status = 'pending_payment'",
      [order.id, order.payment_revision],
    );
    return { order, checkoutUrl: null, requiresQuote: false };
  }
}

function estimateDelivery(lines) {
  const days = Math.max(0, ...lines.map((line) => Number(line.lead_time_days || 0)));
  if (!days) return "";
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toLocaleDateString("es-UY", { day: "numeric", month: "long" });
}

async function generateUniqueOrderCode() {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const code = generateOrderCode();
    const exists = await pool.query("SELECT 1 FROM orders WHERE code = $1", [code]);
    if (!exists.rowCount) return code;
  }
  throw new Error("No se pudo generar un código de pedido único.");
}

/* -------------------------------------------------------------------------- */
/* Notificaciones                                                              */
/* -------------------------------------------------------------------------- */

/** Aviso al administrador: entró un pedido (pagado o a cotizar). */
export async function notifyNewOrder(orderId) {
  try {
    const order = await getOrderById(orderId);
    if (!order) return;
    const items = await getOrderItems(orderId);
    const settings = await getSettings();
    const adminEmail = await getAdminEmail();

    if (!adminEmail) {
      console.error(`No hay correo de administrador configurado: no se pudo avisar la orden ${order.code}.`);
      return;
    }

    const mail = newOrderAdmin({ order, items, business: settings.business });
    await sendEmail({
      to: adminEmail,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      template: "new_order_admin",
      orderId: order.id,
    });

    await pool.query("UPDATE orders SET admin_notified_at = NOW() WHERE id = $1", [order.id]);
  } catch (error) {
    console.error("No se pudo notificar la nueva orden:", error?.name || "Error");
  }
}

/** Aviso al administrador: el cliente pidió una cotización. */
export async function notifyQuoteRequest(order, lines) {
  try {
    const settings = await getSettings();
    const adminEmail = await getAdminEmail();
    if (!adminEmail) return;

    const inquiry = await pool.query(
      `INSERT INTO inquiries (name, email, phone, subject, message, order_id)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        order.customer_name,
        order.customer_email,
        order.customer_phone,
        `Cotización ${order.code}`,
        [
          lines.filter((line) => line.is_quote).map((line) => `• ${line.product_name} × ${line.quantity}${line.customization ? ` — ${line.customization}` : ""}`).join("\n"),
          order.notes ? `\n\nNota del cliente: ${order.notes}` : "",
        ].join("\n"),
        order.id,
      ],
    );

    const mail = newInquiryAdmin({
      inquiry: inquiry.rows[0],
      product: lines.filter((line) => line.is_quote).map((line) => line.product_name).join(", "),
      adminUrl: publicUrl(),
    });

    await sendEmail({
      to: adminEmail,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      template: "quote_request_admin",
      orderId: order.id,
    });
  } catch (error) {
    console.error("No se pudo notificar la cotización:", error?.name || "Error");
  }
}

/** Confirmación al cliente: el pago fue aprobado. */
export async function notifyOrderPaid(orderId) {
  try {
    const order = await getOrderById(orderId);
    if (!order) return;
    const settings = await getSettings();
    const items = await getOrderItems(orderId);

    if (settings.notifications?.notify_customer !== false) {
      const mail = orderConfirmationCustomer({ order, items, business: settings.business });
      await sendEmail({
        to: order.customer_email,
        subject: mail.subject,
        html: mail.html,
        text: mail.text,
        template: "order_confirmation_customer",
        orderId: order.id,
      });
      await pool.query("UPDATE orders SET customer_notified_at = NOW() WHERE id = $1", [order.id]);
    }

    if (settings.notifications?.notify_on_paid !== false) {
      await notifyNewOrder(orderId);
    }
  } catch (error) {
    console.error("No se pudo enviar la confirmación del pedido:", error?.name || "Error");
  }
}

/** Aviso al cliente: el pedido cambió de estado. */
export async function notifyOrderStatus(orderId, statusLabel) {
  try {
    const order = await getOrderById(orderId);
    if (!order) return;
    const settings = await getSettings();
    if (settings.notifications?.notify_customer === false) return;

    const mail = orderStatusCustomer({ order, statusLabel });
    await sendEmail({
      to: order.customer_email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
      template: "order_status_customer",
      orderId: order.id,
    });
  } catch (error) {
    console.error("No se pudo avisar el cambio de estado:", error?.name || "Error");
  }
}

/* -------------------------------------------------------------------------- */
/* Consultas y seguimiento                                                    */
/* -------------------------------------------------------------------------- */

export async function getOrderById(id) {
  const result = await pool.query("SELECT * FROM orders WHERE id = $1", [id]);
  return result.rows[0] || null;
}

export async function getOrderItems(orderId) {
  const result = await pool.query(
    "SELECT * FROM order_items WHERE order_id = $1 ORDER BY position, id",
    [orderId],
  );
  return result.rows;
}

/** Seguimiento del pedido: requiere código y correo coincidentes. */
export async function trackOrder(code, email) {
  const cleanCode = normalizeOrderCode(code);
  const cleanMail = cleanEmail(email);

  const result = await pool.query(
    `SELECT * FROM orders WHERE code = $1 AND lower(customer_email) = $2`,
    [cleanCode, cleanMail],
  );
  const order = result.rows[0];
  if (!order) return null;

  const items = await getOrderItems(order.id);
  return {
    code: order.code,
    status: order.status,
    statusLabel: order.status === "pending_payment" && order.payment_provider === "transfer" ? "Pendiente de transferencia"
      : order.status === "pending_payment" && order.payment_provider === "cash" ? "Pendiente de pago en efectivo" : STATUS_LABELS[order.status] || order.status,
    payment_provider: order.payment_provider,
    payment_adjustment: order.payment_adjustment,
    payment_snapshot: order.payment_snapshot,
    payment_revision: order.payment_revision,
    quote_notes: order.quote_notes,
    customer_name: order.customer_name,
    delivery_method: order.delivery_method,
    shipping_address: order.shipping_address,
    shipping_city: order.shipping_city,
    shipping_department: order.shipping_department,
    notes: order.notes,
    subtotal: order.subtotal,
    discount: order.discount,
    shipping_cost: order.shipping_cost,
    tax: order.tax,
    total: order.total,
    currency: order.currency,
    requires_quote: order.requires_quote,
    quoted_total: order.quoted_total,
    estimated_delivery: order.estimated_delivery,
    created_at: order.created_at,
    paid_at: order.paid_at,
    items: items.map((item) => ({
      product_name: item.product_name,
      product_slug: item.product_slug,
      quantity: item.quantity,
      unit_price: item.unit_price,
      line_total: item.line_total,
      options: item.options,
      customization: item.customization,
      image_url: item.image_url,
      is_quote: item.is_quote,
      quoted_amount: item.quoted_amount,
      payment_rule: item.payment_rule,
      payment_percent: item.payment_percent,
    })),
  };
}

/**
 * Reconsulta el pago en Mercado Pago. Se usa cuando el cliente vuelve del
 * checkout y el webhook todavía no llegó: evita el callejón sin salida.
 */
export async function reconcileOrder(code, email) {
  const order = await trackOrder(code, email);
  if (!order) return null;
  if (!checkoutEnabled()) return { order, reconciled: false };

  const full = await getOrderById((await pool.query("SELECT id FROM orders WHERE code = $1", [order.code])).rows[0]?.id);
  if (!full || !full.mp_preference_id) return { order, reconciled: false };

  try {
    const payments = await fetchPaymentsForOrder(full.id);
    let reconciled = false;
    for (const payment of payments) {
      const outcome = await applyPayment(payment, {
        onPaid: notifyOrderPaid,
        onStatusChange: notifyOrderStatus,
      });
      if (outcome === "applied" || outcome === "review") reconciled = true;
    }
    const refreshed = await trackOrder(code, email);
    return { order: refreshed, reconciled };
  } catch (error) {
    console.error("No se pudo reconciliar el pedido:", error?.name || "Error");
    return { order, reconciled: false };
  }
}

/**
 * El administrador fija la cotización de los productos a medida y genera el
 * link de pago del pedido.
 */
export async function quoteOrder(orderId, { quoteAmount, quoteItems, quoteNotes = "", generatePaymentLink = true }) {
  const client = await pool.connect();
  let updated;
  try {
    await client.query("BEGIN");
    const order = (await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId])).rows[0];
    if (!order || !order.requires_quote || order.paid_at || !["quote", "pending_payment", "failed"].includes(order.status)) throw new ValidationError("Este pedido no admite una nueva cotización.");
    const lines = (await client.query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY position, id", [orderId])).rows;
    const quotes = lines.filter(l => l.is_quote);
    let amounts;
    if (quoteItems && typeof quoteItems === "object" && !Array.isArray(quoteItems)) {
      amounts = quotes.map(l => cleanInteger(quoteItems[l.id], { min: 0, max: 10_000_000, label: "el importe de cada producto a cotizar" }));
    } else {
      if (quotes.some(l => l.payment_rule !== "none") && quotes.length > 1) throw new ValidationError("Indicá el importe de cada producto para aplicar su regla de pago.");
      amounts = allocateAmount(cleanInteger(quoteAmount ?? 0, { min: 0, max: 10_000_000 }), quotes.map(l => l.quantity));
    }
    for (let i = 0; i < quotes.length; i++) {
      quotes[i].quoted_amount = amounts[i];
      await client.query("UPDATE order_items SET quoted_amount = $2 WHERE id = $1", [quotes[i].id, amounts[i]]);
    }
    const totals = paymentTotals(lines, { method: order.payment_provider, discount: order.discount, shipping: order.shipping_cost, tax: order.tax_snapshot || {} });
    validateTotal(totals.total);
    updated = (await client.query(`UPDATE orders SET quoted_total = $2, quote_notes = $3, total = $4, tax = $5,
      payment_adjustment = $6, status = 'pending_payment', payment_revision = payment_revision + 1,
      mp_preference_id = NULL, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [orderId, amounts.reduce((a,b) => a+b,0), cleanMultiline(quoteNotes, { max: 1500 }), totals.total, totals.tax, totals.adjustment])).rows[0];
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  // El cliente ve la propuesta en seguimiento y elige el medio antes de pagar.
  let checkoutUrl = null;
  if (generatePaymentLink && updated.payment_provider === "mercadopago" && paymentMethods(await getSettings({ fresh: true })).mercadopago) checkoutUrl = await issuePaymentLink(updated);
  await notifyPaymentInstructions(updated, { quote: true });
  return { order: await getOrderById(orderId), checkoutUrl };
}

export { paymentMode };

function validateTotal(total, expected) {
  if (!Number.isSafeInteger(total) || total < 0 || total > 2_000_000_000) throw new ValidationError("El importe del pedido supera el máximo permitido.");
  if (expected !== undefined && Number(expected) !== total) throw new ValidationError("El total cambió. Revisá el resumen actualizado antes de confirmar.", "total");
}

export async function previewCart({ items, couponCode = "", deliveryMethod = "shipping" }) {
  const { lines, subtotal, hasQuote, settings } = await prepareCart(items);
  const coupon = await resolveCoupon(couponCode, subtotal);
  const discount = coupon?.discount || 0;
  const shipping = shippingCostFor({ settings, subtotal: subtotal - discount, deliveryMethod });
  const methods = paymentMethods(settings);
  const totals = Object.fromEntries(Object.keys(methods).map(method => [method, paymentTotals(lines, { method, discount, shipping, tax: settings.tax })]));
  return { methods, totals, has_quote: hasQuote };
}

export async function issuePaymentLink(order) {
  requirePaymentMethod(await getSettings({ fresh: true }), "mercadopago");
  const { preferenceId, checkoutUrl } = await createPreference({ order, customer: { name: order.customer_name, email: order.customer_email } });
  const saved = await pool.query(`UPDATE orders SET mp_preference_id = $2, updated_at = NOW()
    WHERE id = $1 AND payment_revision = $3 AND paid_at IS NULL AND status IN ('pending_payment','failed') AND payment_provider = 'mercadopago' RETURNING id`, [order.id, preferenceId, order.payment_revision]);
  if (!saved.rowCount) throw new ValidationError("El pedido cambió mientras se preparaba el pago. Consultá su estado.");
  return checkoutUrl;
}

export async function orderPaymentOptions(code, email) {
  const tracked = await trackOrder(code, email);
  if (!tracked) throw new ValidationError("Pedido no encontrado.");
  const order = (await pool.query("SELECT * FROM orders WHERE code = $1", [tracked.code])).rows[0];
  if (order.paid_at || !["pending_payment", "failed"].includes(order.status)) throw new ValidationError("Este pedido no admite cambios de pago.");
  const lines = await getOrderItems(order.id);
  const settings = await getSettings();
  return { revision: order.payment_revision, methods: paymentMethods(settings), totals: Object.fromEntries(["mercadopago", "transfer", "cash"].map(method => [method, paymentTotals(lines, { method, discount: order.discount, shipping: order.shipping_cost, tax: order.tax_snapshot || {} })])) };
}

export async function changeOrderPayment({ code, email, method, expectedTotal, revision }) {
  const cleanCode = normalizeOrderCode(code), cleanMail = cleanEmail(email);
  const settings = await getSettings({ fresh: true });
  requirePaymentMethod(settings, method);
  const client = await pool.connect();
  let updated;
  try {
    await client.query("BEGIN");
    const order = (await client.query("SELECT * FROM orders WHERE code = $1 AND lower(customer_email) = $2 FOR UPDATE", [cleanCode, cleanMail])).rows[0];
    if (!order || order.paid_at || !["pending_payment", "failed"].includes(order.status) || Number(revision) !== order.payment_revision) throw new ValidationError("El pedido cambió o ya no admite cambios. Actualizá su estado.");
    if (expectedTotal === undefined) throw new ValidationError("Revisá primero el total del medio de pago.");
    const lines = (await client.query("SELECT * FROM order_items WHERE order_id = $1 ORDER BY position, id", [order.id])).rows;
    const totals = paymentTotals(lines, { method, discount: order.discount, shipping: order.shipping_cost, tax: order.tax_snapshot || {} });
    validateTotal(totals.total, expectedTotal);
    const snapshot = method === order.payment_provider ? order.payment_snapshot : paymentSnapshot(settings, method);
    updated = (await client.query(`UPDATE orders SET payment_provider = $2, payment_adjustment = $3, total = $4, tax = $5,
      payment_snapshot = $6, payment_revision = payment_revision + 1, mp_preference_id = NULL, status = 'pending_payment', updated_at = NOW() WHERE id = $1 RETURNING *`,
      [order.id, method, totals.adjustment, totals.total, totals.tax, JSON.stringify(snapshot)])).rows[0];
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  const checkoutUrl = method === "mercadopago" ? await issuePaymentLink(updated) : null;
  if (method !== "mercadopago") await notifyPaymentInstructions(updated);
  return { order: await trackOrder(code, email), checkout_url: checkoutUrl };
}

export async function confirmManualPayment(orderId, adminId, { reference, revision, expectedTotal }) {
  const cleanReference = cleanText(reference, { min: 1, max: 200, label: "la referencia del cobro" });
  const client = await pool.connect();
  let changed = false;
  try {
    await client.query("BEGIN");
    const order = (await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId])).rows[0];
    if (!order || !["transfer", "cash"].includes(order.payment_provider)) throw new ValidationError("Este pedido no es de pago manual.");
    if (order.paid_at) { await client.query("COMMIT"); return { changed: false }; }
    if (order.status !== "pending_payment" || Number(revision) !== order.payment_revision || Number(expectedTotal) !== order.total) throw new ValidationError("El pedido cambió. Revisá el importe y el medio de pago antes de confirmar.");
    changed = await settleOrder(client, order, { provider: order.payment_provider, adminId, reference: cleanReference });
    await client.query("COMMIT");
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  if (changed) await notifyOrderPaid(orderId);
  return { changed };
}

async function notifyPaymentInstructions(order, { quote = false } = {}) {
  try {
    const settings = await getSettings();
    if (settings.notifications?.notify_customer === false) return;
    const p = order.payment_snapshot || {};
    const text = [quote ? "Tu cotización está lista." : "Recibimos tu pedido; el pago todavía está pendiente.",
      `Pedido ${order.code}. Total: ${order.total} UYU.`,
      order.payment_provider === "transfer" ? `Transferencia a ${p.bank}. Titular: ${p.holder}. Cuenta: ${p.account}. Moneda: ${p.currency}. Referencia: ${order.code}.` : "",
      p.instructions || "", `Revisá el detalle y las opciones de pago en ${publicUrl()}/seguimiento?code=${encodeURIComponent(order.code)} usando tu correo.`].filter(Boolean).join("\n\n");
    const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
    await sendEmail({ to: order.customer_email, subject: `${quote ? "Cotización lista" : "Pedido recibido"} — ${order.code}`, html: `<p style="white-space:pre-line">${escaped}</p>`, text, template: quote ? "quote_ready_customer" : "payment_instructions", orderId: order.id });
  } catch (error) { console.error("No se pudieron enviar las instrucciones:", error?.name || "Error"); }
}
