import { instructionsHtml, PAYMENT_LABELS } from "./payment-ui.js";
import { mountPaymentActions } from "./order-payment-actions.js";
/**
 * Seguimiento del pedido.
 *
 * El cliente se identifica con el código del pedido y el correo con el que
 * compró. No hay registro ni contraseña: la información es pública para
 * quien tenga ambos datos.
 */

import { api, formatMoney, escapeHtml } from "./api.js";
import { el, clear } from "./ui.js";

const form = el("[data-track-form]");
const result = el("[data-track-result]");

const LAST_EMAIL_KEY = "dmgrafica:lastEmail";

/* --- Línea de tiempo del pedido ------------------------------------------- */

const STEPS = [
  { key: "received", title: "Pedido recibido", note: "Recibimos tu pedido y lo estamos revisando." },
  { key: "quote", title: "Cotización", note: "Preparamos la propuesta con el detalle de tu pedido." },
  { key: "payment", title: "Pago", note: "Elegís el medio de pago y confirmamos el ingreso." },
  { key: "production", title: "Producción", note: "Imprimimos, armamos y revisamos el resultado." },
  { key: "ready", title: "Listo", note: "Podés retirarlo en Rivera o lo enviamos a tu dirección." },
  { key: "delivered", title: "Entregado", note: "Tu pedido llegó a destino." },
];

/** Índice del último paso completado según el estado del pedido. */
function progressIndex(order) {
  switch (order.status) {
    case "quote": return 0;
    case "pending_payment": return order.requires_quote ? 1 : 1;
    case "paid": return 2;
    case "in_production": return 3;
    case "ready": return 4;
    case "delivered": return 5;
    default: return 0;
  }
}

function buildTimeline(order) {
  const steps = STEPS.filter((step) => step.key !== "quote" || order.requires_quote);
  const current = progressIndex(order);

  return `
    <ol class="timeline">
      ${steps.map((step, index) => {
        const done = index < current || (order.status === "delivered");
        const active = index === current && order.status !== "delivered";
        return `
          <li class="timeline__item"${done ? ' data-state="done"' : ""}>
            <span>
              <span class="timeline__title">${escapeHtml(step.title)}${active ? " — en curso" : ""}</span>
              <span class="timeline__note" style="display:block;">${escapeHtml(step.note)}</span>
            </span>
          </li>`;
      }).join("")}
    </ol>`;
}

const CLOSED_STATES = {
  cancelled: "Tu pedido fue cancelado. Si fue un error, escribinos y lo revisamos.",
  refunded: "Tu pedido fue reembolsado. Si necesitás el comprobante, pedinoslo por correo.",
  failed: "El pago no fue aprobado. Podés reintentar el pago o escribirnos.",
  review: "Tu pago está en revisión manual. Te contactamos en breve.",
};

/* --- Render ---------------------------------------------------------------- */

function renderOrder(order) {
  if (!result) return;

  const items = (order.items || []).map((item) => {
    const options = Array.isArray(item.options)
      ? item.options.map((option) => `${option.label}: ${option.value}`).join(" · ")
      : "";
    return `
      <li style="display:flex; justify-content:space-between; gap:12px; padding-block:8px; border-bottom:1px solid var(--color-line);">
        <span>
          <strong style="font-weight:600;">${escapeHtml(item.product_name)}</strong> × ${item.quantity}
          ${options ? `<br><span style="font-size:0.8125rem;color:var(--color-muted);">${escapeHtml(options)}</span>` : ""}
          ${item.customization ? `<br><span style="font-size:0.8125rem;color:var(--color-muted);">${escapeHtml(item.customization)}</span>` : ""}
        </span>
        <span style="white-space:nowrap;">${item.is_quote && item.quoted_amount === null ? '<span class="price--quote">A cotizar</span>' : formatMoney(item.is_quote ? item.quoted_amount : item.line_total)}</span>
      </li>`;
  }).join("");

  const delivery = order.delivery_method === "pickup"
    ? "Retiro en Rivera"
    : `Envío a ${[order.shipping_city, order.shipping_department].filter(Boolean).join(", ")}${order.shipping_address ? ` — ${order.shipping_address}` : ""}`;

  const closed = CLOSED_STATES[order.status];

  clear(result).innerHTML = `
    <section class="summary-card" aria-labelledby="titulo-pedido">
      <div style="display:flex; flex-wrap:wrap; justify-content:space-between; gap:12px; align-items:center;">
        <div>
          <h2 id="titulo-pedido" style="font-family:var(--font-body); font-size:1.0625rem;">Pedido ${escapeHtml(order.code)}</h2>
          <p style="margin:4px 0 0; color:var(--color-muted); font-size:0.875rem;">${escapeHtml(delivery)}</p>
        </div>
        <p style="margin:0;"><strong>${escapeHtml(order.statusLabel || order.status)}</strong></p>
      </div>

      ${closed ? `<div class="alert alert--warning" style="margin-top:16px;">${escapeHtml(closed)}</div>` : buildTimeline(order)}

      <h3 style="font-family:var(--font-body); font-size:1rem; margin-top:24px;">Detalle</h3>
      <ul style="list-style:none; padding:0; margin:0 0 12px;">${items}</ul>

      <div class="summary-row"><span>Subtotal</span><strong>${formatMoney(order.subtotal)}</strong></div>
      ${Number(order.discount) ? `<div class="summary-row"><span>Descuento</span><strong>− ${formatMoney(order.discount)}</strong></div>` : ""}
      ${Number(order.quoted_total) ? `<div class="summary-row"><span>Importe cotizado</span><strong>${formatMoney(order.quoted_total)}</strong></div>` : ""}
      ${Number(order.payment_adjustment) ? `<div class="summary-row"><span>Ajuste por medio de pago</span><strong>${formatMoney(order.payment_adjustment)}</strong></div>` : ""}
      <p>Medio: ${escapeHtml(PAYMENT_LABELS[order.payment_provider] || "Mercado Pago")}</p>
      ${instructionsHtml(order)}
      <div class="summary-row"><span>Envío</span><strong>${Number(order.shipping_cost) ? formatMoney(order.shipping_cost) : "Sin costo"}</strong></div>
      ${Number(order.tax) ? `<div class="summary-row"><span>IVA</span><strong>${formatMoney(order.tax)}</strong></div>` : ""}
      <div class="summary-row summary-row--total"><span>Total</span><strong>${formatMoney(order.total)}</strong></div>

      ${order.estimated_delivery ? `<p style="margin:12px 0 0;">Entrega estimada: <strong>${escapeHtml(order.estimated_delivery)}</strong></p>` : ""}
      ${order.notes ? `<p style="margin:8px 0 0; color:var(--color-muted); font-size:0.9375rem;">Nota: ${escapeHtml(order.notes)}</p>` : ""}

      <div style="display:flex; flex-wrap:wrap; gap:12px; margin-top:24px;">
        <button class="btn btn--secondary btn--sm" type="button" data-refresh>Actualizar estado</button>
        <a class="btn btn--secondary btn--sm" data-business-whatsapp href="https://wa.me/59895010244"><span data-whatsapp-label>Consultar por WhatsApp</span></a>
      </div>
    </section>`;
  mountPaymentActions(result, order, el("#email", form)?.value?.trim(), renderOrder);
}

function renderError(message) {
  if (!result) return;
  clear(result).innerHTML = `
    <div class="alert alert--error" role="alert">${escapeHtml(message)}</div>`;
}

/* --- Consulta -------------------------------------------------------------- */

async function lookup(code, email, { reconcile = false } = {}) {
  if (!result) return;

  const submit = el("[data-track-submit]");
  if (submit) {
    submit.disabled = true;
    submit.textContent = "Buscando…";
  }

  result.innerHTML = '<p class="loading" role="status">Buscando tu pedido…</p>';

  try {
    const payload = reconcile
      ? await api.reconcileOrder(code, email)
      : await api.trackOrder(code, email);

    if (!payload?.order) {
      renderError("No encontramos un pedido con ese código y correo. Revisá los datos o escribinos.");
      return;
    }

    renderOrder(payload.order);
  } catch (error) {
    renderError(error?.message || "No pudimos consultar tu pedido. Probá de nuevo en un momento.");
  } finally {
    if (submit) {
      submit.disabled = false;
      submit.textContent = "Ver el estado de mi pedido";
    }
  }
}

/* --- Eventos --------------------------------------------------------------- */

form?.addEventListener("submit", (event) => {
  event.preventDefault();
  const code = el("#codigo", form)?.value?.trim() || "";
  const email = el("#email", form)?.value?.trim() || "";

  if (!code || !email) {
    renderError("Completá el código y el correo para consultar tu pedido.");
    return;
  }

  lookup(code, email);
});

result?.addEventListener("click", (event) => {
  if (!event.target.closest("[data-refresh]")) return;
  const code = el("#codigo", form)?.value?.trim() || "";
  const email = el("#email", form)?.value?.trim() || "";
  if (code && email) lookup(code, email, { reconcile: true });
});

/* --- Carga inicial --------------------------------------------------------- */

(function init() {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("codigo") || params.get("code") || "";
  const email = params.get("email") || localStorage.getItem(LAST_EMAIL_KEY) || "";

  const codeInput = el("#codigo");
  const emailInput = el("#email");
  if (codeInput && code) codeInput.value = code.toUpperCase();
  if (emailInput && email) emailInput.value = email;

  if (code && email) lookup(code, email);
})();
