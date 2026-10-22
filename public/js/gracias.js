/**
 * Página de agradecimiento.
 *
 * Muestra el código del pedido y, si el navegador recuerda el correo con el
 * que se hizo la compra, consulta el estado sin pedir datos de nuevo.
 */

import { api, formatMoney, escapeHtml } from "./api.js";
import { el, clear } from "./ui.js";
import { clearCart } from "./carrito.js";

const root = el("[data-thanks-root]");
const LAST_EMAIL_KEY = "dmgrafica:lastEmail";

const params = new URLSearchParams(window.location.search);
const code = (params.get("code") || "").trim();
const isQuote = params.get("cotizacion") === "1";

function renderBase() {
  if (!root) return;

  const title = isQuote ? "Recibimos tu consulta" : "¡Gracias por tu compra!";
  const lead = isQuote
    ? "Revisamos tu pedido y te enviamos la cotización con el link de pago. No se cobró nada."
    : "Te enviamos la confirmación por correo con el detalle de tu pedido.";

  clear(root).innerHTML = `
    <div class="result-card">
      <div class="result-card__icon${isQuote ? " result-card__icon--pending" : ""}" aria-hidden="true">${isQuote ? "✎" : "✓"}</div>
      <h1 style="font-size:2rem; margin-bottom:12px;">${escapeHtml(title)}</h1>
      <p class="lead">${escapeHtml(lead)}</p>

      ${code ? `<p class="order-code">${escapeHtml(code)}</p>` : ""}

      <p style="color:var(--color-muted); font-size:0.9375rem;">
        Guardá este código: con él y tu correo podés consultar el estado de tu pedido
        cuando quieras desde <a href="/seguimiento">Seguir mi pedido</a>.
      </p>

      <div style="display:flex; flex-wrap:wrap; gap:12px; justify-content:center; margin-top:28px;">
        <a class="btn btn--primary" href="/catalogo">Seguir comprando</a>
        <a class="btn btn--secondary" href="/seguimiento">Ver el estado del pedido</a>
        <a class="btn btn--secondary" data-business-whatsapp href="https://wa.me/59895010244"><span data-whatsapp-label>Escribinos por WhatsApp</span></a>
      </div>
    </div>

    <div data-order-status style="margin-top:32px;"></div>`;
}

function renderStatus(order) {
  const container = el("[data-order-status]");
  if (!container || !order) return;

  const rows = (order.items || []).map((item) => `
    <li style="display:flex; justify-content:space-between; gap:12px; padding-block:8px; border-bottom:1px solid var(--color-line);">
      <span>
        <strong style="font-weight:600;">${escapeHtml(item.product_name)}</strong> × ${item.quantity}
        ${item.customization ? `<br><span style="font-size:0.8125rem;color:var(--color-muted);">${escapeHtml(item.customization)}</span>` : ""}
      </span>
      <span style="white-space:nowrap;">${item.is_quote ? '<span class="price--quote">A cotizar</span>' : formatMoney(item.line_total)}</span>
    </li>`).join("");

  clear(container).innerHTML = `
    <section class="summary-card" style="max-width:640px; margin-inline:auto;" aria-labelledby="titulo-estado">
      <h2 id="titulo-estado" style="font-family:var(--font-body); font-size:1.0625rem;">Estado de tu pedido</h2>
      <p style="margin:8px 0 16px;"><strong>${escapeHtml(order.statusLabel || order.status)}</strong></p>

      <ul style="list-style:none; padding:0; margin:0 0 12px;">${rows}</ul>

      <div class="summary-row"><span>Subtotal</span><strong>${formatMoney(order.subtotal)}</strong></div>
      ${Number(order.discount) ? `<div class="summary-row"><span>Descuento</span><strong>− ${formatMoney(order.discount)}</strong></div>` : ""}
      <div class="summary-row"><span>Envío</span><strong>${Number(order.shipping_cost) ? formatMoney(order.shipping_cost) : "Sin costo"}</strong></div>
      ${Number(order.tax) ? `<div class="summary-row"><span>IVA</span><strong>${formatMoney(order.tax)}</strong></div>` : ""}
      <div class="summary-row summary-row--total"><span>Total</span><strong>${formatMoney(order.total)}</strong></div>

      ${order.estimated_delivery
        ? `<p style="margin:12px 0 0; font-size:0.9375rem;">Entrega estimada: <strong>${escapeHtml(order.estimated_delivery)}</strong></p>`
        : ""}
    </section>`;
}

async function tryAutoTrack() {
  const email = localStorage.getItem(LAST_EMAIL_KEY);
  if (!code || !email) return;

  const container = el("[data-order-status]");
  if (container) {
    container.innerHTML = '<p class="loading" role="status">Consultando el estado de tu pedido…</p>';
  }

  try {
    const payload = await api.trackOrder(code, email);
    renderStatus(payload.order);
  } catch {
    if (container) {
      container.innerHTML = `
        <div class="alert alert--info">
          Para ver el detalle de tu pedido entrá a <a href="/seguimiento">Seguir mi pedido</a> con tu código y tu correo.
        </div>`;
    }
  }
}

async function load() {
  renderBase();

  // El pedido ya está confirmado: el carrito se vacía para no volver a pagarlo.
  if (code) clearCart();

  if (isQuote) {
    const container = el("[data-order-status]");
    if (container) {
      container.innerHTML = `
        <div class="alert alert--info">
          Te vamos a responder con la cotización a la brevedad. Si es urgente, escribinos por WhatsApp.
        </div>`;
    }
    return;
  }

  await tryAutoTrack();
}

load();
