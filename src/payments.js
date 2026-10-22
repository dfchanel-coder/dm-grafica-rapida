import { pool } from "./db.js";
import { validateMercadoPagoSignature } from "./mercadopago-signature.js";

/**
 * Pasarela de pagos: Mercado Pago (Checkout Pro).
 *
 * Diseño preparado para sumar otra pasarela más adelante (el usuario dijo
 * "por ahora Mercado Pago"): el resto del sistema nunca habla con la API
 * de Mercado Pago directamente, siempre pasa por este módulo.
 */

const MP_API = "https://api.mercadopago.com";
const ALLOWED_MP_HOSTS = [
  "mercadopago.com.uy",
  "mercadopago.com",
  "mercadopago.com.br",
  "mercadopago.com.ar",
  "mercadopago.com.mx",
  "mercadopago.com.co",
  "mercadopago.cl",
  "mercadopago.com.pe",
];

export function paymentMode() {
  return process.env.MERCADOPAGO_MODE || "sandbox";
}

export function checkoutEnabled() {
  return (
    process.env.CHECKOUT_ENABLED === "true"
    && Boolean(process.env.MERCADOPAGO_ACCESS_TOKEN)
    && ["sandbox", "production"].includes(paymentMode())
  );
}

function isMercadoPagoUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return false;
    return ALLOWED_MP_HOSTS.some((host) => url.hostname === host || url.hostname.endsWith(`.${host}`));
  } catch {
    return false;
  }
}

function checkoutUrlFromPreference(preference) {
  const mode = paymentMode();
  const url = mode === "production" ? preference?.init_point : preference?.sandbox_init_point;
  return isMercadoPagoUrl(url) ? url : null;
}

async function mpFetch(path, options = {}) {
  const response = await fetch(`${MP_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${process.env.MERCADOPAGO_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
    signal: AbortSignal.timeout(12_000),
  });
  return response;
}

/**
 * Crea la preferencia de Checkout Pro para un pedido ya guardado.
 * La preferencia es la fuente de verdad del importe: el total se calcula
 * en el servidor, nunca se recibe del navegador.
 */
export async function createPreference({ order, customer }) {
  const baseUrl = (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
  if (!baseUrl) throw new Error("Falta configurar PUBLIC_BASE_URL.");

  const total = Number(order.total);
  if (!Number.isSafeInteger(total) || total <= 0) {
    throw new Error("El total a pagar debe ser un importe positivo en pesos.");
  }
  // El detalle queda en el pedido. Un único ítem evita perder descuentos,
  // envío, impuestos o el importe de una cotización al crear el checkout.
  const mpItems = [{
    id: order.id,
    title: `Pedido ${order.code} — DM Comunicación Visual`,
    quantity: 1,
    currency_id: order.currency || "UYU",
    unit_price: total,
  }];

  const response = await mpFetch("/checkout/preferences", {
    method: "POST",
    headers: { "X-Idempotency-Key": order.id },
    body: JSON.stringify({
      items: mpItems,
      external_reference: order.id,
      back_urls: {
        success: `${baseUrl}/gracias?code=${encodeURIComponent(order.code)}`,
        pending: `${baseUrl}/gracias?code=${encodeURIComponent(order.code)}&estado=pendiente`,
        failure: `${baseUrl}/gracias?code=${encodeURIComponent(order.code)}&estado=fallido`,
      },
      auto_return: "approved",
      payer: {
        name: customer.name.slice(0, 120),
        email: customer.email,
      },
      statement_descriptor: "DM COMUNICACION VISUAL",
      metadata: { order_id: order.id, order_code: order.code },
    }),
  });

  const preference = await response.json().catch(() => ({}));
  if (!response.ok || !preference.id) {
    console.error("Mercado Pago rechazó la preferencia:", response.status, JSON.stringify(preference).slice(0, 300));
    throw new Error("No pudimos iniciar el pago.");
  }

  const checkoutUrl = checkoutUrlFromPreference(preference);
  if (!checkoutUrl) {
    throw new Error("Mercado Pago no devolvió un enlace de pago válido.");
  }

  return { preferenceId: String(preference.id), checkoutUrl };
}

/**
 * Aplica un pago de Mercado Pago sobre su pedido, dentro de una transacción.
 * Es idempotente: el webhook puede llegar repetido.
 *
 * @returns {"applied" | "ignored" | "review" | "unknown_order"}
 */
export async function applyPayment(payment, { onPaid, onStatusChange } = {}) {
  const orderId = payment?.external_reference;
  if (!orderId || !/^[0-9a-f-]{36}$/i.test(orderId)) return "ignored";

  const client = await pool.connect();
  let result = "ignored";
  try {
    await client.query("BEGIN");

    const lock = await client.query("SELECT * FROM orders WHERE id = $1 FOR UPDATE", [orderId]);
    const order = lock.rows[0];
    if (!order) {
      await client.query("ROLLBACK");
      return "unknown_order";
    }

    const paymentStatus = String(payment.status || "");
    const paymentId = payment.id ? String(payment.id) : null;
    if (!paymentId) {
      await client.query("COMMIT");
      return "ignored";
    }

    // Reembolsos y contracargos: se anota el estado, no se toca el stock.
    if (["refunded", "charged_back"].includes(paymentStatus)) {
      if (!order.paid_at || String(order.mp_payment_id) !== paymentId
          || (order.status === "refunded" && order.payment_status === paymentStatus)) {
        await client.query("COMMIT");
        return "ignored";
      }
      await client.query(
        `UPDATE orders SET status = $2, payment_status = $3, mp_payment_id = COALESCE($4, mp_payment_id), updated_at = NOW()
         WHERE id = $1`,
        [orderId, "refunded", paymentStatus, paymentId],
      );
      await client.query("COMMIT");
      result = "applied";
      if (onStatusChange) await onStatusChange(orderId, paymentStatus);
      return result;
    }

    // Un pago ya registrado no debe retroceder el trabajo ni descontar stock
    // o enviar confirmaciones nuevamente. Tampoco se reviven reembolsos.
    if (order.paid_at || order.status === "refunded") {
      await client.query("COMMIT");
      return "ignored";
    }
    if (order.status === "review" && order.payment_status === paymentStatus && String(order.mp_payment_id) === paymentId) {
      await client.query("COMMIT");
      return "ignored";
    }

    const amountMatches = Number(payment.transaction_amount) === Number(order.total);
    const currencyMatches = (payment.currency_id || "UYU") === (order.currency || "UYU");
    const preferenceMatches = !payment.preference_id
      || String(payment.preference_id) === String(order.mp_preference_id);
    const metadataMatches = !payment.metadata?.order_id
      || String(payment.metadata.order_id) === String(order.id);

    if (!amountMatches || !currencyMatches || !preferenceMatches || !metadataMatches
        || (paymentStatus === "approved" && !["pending_payment", "failed", "review"].includes(order.status))) {
      await client.query(
        `UPDATE orders SET status = 'review', payment_status = $2, mp_payment_id = COALESCE($3, mp_payment_id), updated_at = NOW()
         WHERE id = $1`,
        [orderId, paymentStatus, paymentId],
      );
      await client.query("COMMIT");
      result = "review";
      if (onStatusChange) await onStatusChange(orderId, "review");
      return result;
    }

    if (paymentStatus === "approved") {
      await client.query(
        `UPDATE orders
            SET status = 'paid', payment_status = 'approved', mp_payment_id = $2,
                paid_at = COALESCE(paid_at, NOW()), updated_at = NOW()
          WHERE id = $1`,
        [orderId, paymentId],
      );

      // El stock se descuenta recién con el pago confirmado, no al crear el pedido.
      {
        const items = await client.query(
          "SELECT product_id, quantity, is_quote FROM order_items WHERE order_id = $1",
          [orderId],
        );
        for (const item of items.rows) {
          if (!item.product_id || item.is_quote) continue;
          await client.query(
            "UPDATE products SET stock = GREATEST(0, stock - $2) WHERE id = $1 AND manage_stock",
            [item.product_id, item.quantity],
          );
        }
      }

      await client.query("COMMIT");
      result = "applied";
      if (onPaid) await onPaid(orderId);
      return result;
    }

    const mapped = {
      in_process: "pending_payment",
      in_mediation: "pending_payment",
      authorized: "pending_payment",
      pending: "pending_payment",
      rejected: "failed",
      cancelled: "failed",
    }[paymentStatus];

    if (mapped && order.status === "pending_payment"
        && (order.payment_status !== paymentStatus || String(order.mp_payment_id) !== paymentId)) {
      await client.query(
        `UPDATE orders SET status = $2, payment_status = $3, mp_payment_id = COALESCE($4, mp_payment_id), updated_at = NOW()
         WHERE id = $1 AND status = 'pending_payment'`,
        [orderId, mapped, paymentStatus, paymentId],
      );
      result = "applied";
    }

    await client.query("COMMIT");
    if (result === "applied" && onStatusChange) await onStatusChange(orderId, paymentStatus);
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Consulta a Mercado Pago los pagos asociados a un pedido.
 * Se usa cuando el cliente vuelve del checkout y el webhook todavía no llegó.
 */
export async function fetchPaymentsForOrder(orderId) {
  const response = await mpFetch(`/v1/payments/search?external_reference=${encodeURIComponent(orderId)}`);
  if (!response.ok) return [];
  const search = await response.json().catch(() => ({}));
  const payments = Array.isArray(search.results) ? [...search.results] : [];
  // Del más antiguo al más reciente: el estado final debe ser el último.
  payments.sort((a, b) => String(a?.date_created || "").localeCompare(String(b?.date_created || "")));
  return payments;
}

export async function fetchPayment(paymentId) {
  const response = await mpFetch(`/v1/payments/${encodeURIComponent(paymentId)}`);
  if (!response.ok) return null;
  return response.json().catch(() => null);
}

/**
 * Handler del webhook. Valida la firma, re-consulta el pago a la API de
 * Mercado Pago y recién entonces lo aplica al pedido.
 */
export function createWebhookHandler({ onPaid, onStatusChange }) {
  return async function webhook(req, res) {
    if (!process.env.MERCADOPAGO_ACCESS_TOKEN || !process.env.MERCADOPAGO_WEBHOOK_SECRET) {
      return res.sendStatus(503);
    }

    const dataId = req.query["data.id"] || req.body?.data?.id;
    const validSignature = validateMercadoPagoSignature({
      signature: req.get("x-signature"),
      requestId: req.get("x-request-id"),
      dataId,
      secret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
    });
    if (!validSignature) return res.sendStatus(401);

    const eventType = req.body?.type || req.query.topic;
    if (eventType !== "payment" || !/^\d+$/.test(String(dataId))) return res.sendStatus(200);

    try {
      const payment = await fetchPayment(dataId);
      if (!payment) return res.sendStatus(503);
      await applyPayment(payment, { onPaid, onStatusChange });
      return res.sendStatus(200);
    } catch (error) {
      console.error("Webhook de Mercado Pago falló:", error?.name || "Error");
      return res.sendStatus(503);
    }
  };
}
