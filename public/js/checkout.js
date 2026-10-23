import { paymentAdjustmentNote } from "./payment-pricing.js";
import { totalsHtml, PAYMENT_LABELS } from "./payment-ui.js";
/**
 * Checkout de invitado: sin registro, con pago por Mercado Pago.
 *
 * El navegador solo manda identificadores, cantidades y opciones. Los
 * precios los recalcula el servidor a partir de la base de datos.
 */

import { api, formatMoney, escapeHtml } from "./api.js";
import { el, els, clear, toast, clearFormErrors } from "./ui.js";
import {
  readCart,
  toApiItems,
  estimateSubtotal,
  cartHasQuotes,
  getCouponCode,
} from "./carrito.js";

const root = el("[data-checkout-root]");

const state = {
  settings: null,
  delivery: "shipping",
  payment: { available: true, mode: "sandbox" },
  submitting: false,
  method: "mercadopago",
  preview: null,
  previewSequence: 0,
};

const DEPARTMENTS = [
  "Artigas", "Canelones", "Cerro Largo", "Colonia", "Durazno", "Florida",
  "Lavalleja", "Maldonado", "Melo", "Mercedes", "Montevideo", "Paysandú",
  "Río Negro", "Rocha", "Rivera", "Salto", "San José", "Soriano", "Tacuarembó",
  "Treinta y Tres",
];

function shippingEstimate() {
  const settings = state.settings;
  if (!settings) return 0;
  if (state.delivery === "pickup") return 0;
  const checkout = settings.checkout || {};
  const cost = Number(checkout.shipping_cost || 0);
  const threshold = Number(checkout.free_shipping_threshold || 0);
  const subtotal = estimateSubtotal(settings);
  if (threshold > 0 && subtotal >= threshold) return 0;
  return cost;
}

function totals() {
  return state.preview?.totals[state.method] || { subtotal: 0, shipping: 0, tax: 0, total: 0 };
}

function render() {
  if (!root) return;

  const items = readCart();
  if (!items.length) {
    clear(root).innerHTML = `
      <div class="empty-state">
        <h2>Tu carrito está vacío</h2>
        <p>Agregá productos antes de finalizar la compra.</p>
        <a class="btn btn--primary btn--lg" href="/catalogo">Ver el catálogo</a>
      </div>`;
    return;
  }

  const settings = state.settings || {};
  const checkout = settings.checkout || {};
  const allowPickup = checkout.allow_pickup !== false;
  const hasQuote = cartHasQuotes();
  const sum = totals();

  const lines = items.map((item, index) => {
    const optionText = Object.entries(item.options || {})
      .map(([key, value]) => `${key}: ${value}`)
      .join(" · ");
    return `
      <li style="display:flex; justify-content:space-between; gap:12px; padding-block:8px; border-bottom:1px solid var(--color-line);">
        <span>
          <strong style="font-weight:600;">${escapeHtml(item.name)}</strong> × ${item.quantity}
          ${optionText ? `<br><span style="font-size:0.8125rem;color:var(--color-muted);">${escapeHtml(optionText)}</span>` : ""}
          ${item.customization ? `<br><span style="font-size:0.8125rem;color:var(--color-muted);">${escapeHtml(item.customization)}</span>` : ""}
        </span>
        <span style="white-space:nowrap;" data-checkout-line="${index}">
          ${item.pricingMode === "quote"
            ? '<span class="price--quote">A cotizar</span>'
            : formatMoney(item.unitPrice * item.quantity)}
        </span>
      </li>`;
  }).join("");

  clear(root).innerHTML = `
    <div class="alert alert--warning" data-payment-unavailable hidden>No hay medios de pago habilitados en este momento. Podés <a href="/contacto">contactarnos</a> para consultar.</div>
    ${hasQuote
      ? `<div class="alert alert--info">
           <strong>Tu pedido incluye productos a cotizar.</strong>
           Al confirmar lo recibimos, te enviamos la propuesta y después el link de pago. No se cobra nada en este paso.
         </div>`
      : ""}

    <form data-checkout-form novalidate>
      <div class="checkout-layout">
        <div>
          <section class="checkout-block" aria-labelledby="bloque-datos">
            <div class="checkout-block__head">
              <span class="checkout-block__number" aria-hidden="true">1</span>
              <h2 id="bloque-datos">Tus datos</h2>
            </div>

            <div class="field">
              <label class="field__label" for="nombre">Nombre y apellido <span aria-hidden="true">*</span></label>
              <input class="input" type="text" id="nombre" name="nombre" autocomplete="name" required maxlength="120">
            </div>

            <div class="field-row">
              <div class="field">
                <label class="field__label" for="email">Correo electrónico <span aria-hidden="true">*</span></label>
                <input class="input" type="email" id="email" name="email" autocomplete="email" required maxlength="254"
                       aria-describedby="hint-email">
                <span class="field__hint" id="hint-email">Te enviamos la confirmación y el link de pago acá.</span>
              </div>
              <div class="field">
                <label class="field__label" for="telefono">Teléfono <span aria-hidden="true">*</span></label>
                <input class="input" type="tel" id="telefono" name="telefono" autocomplete="tel" required maxlength="25"
                       placeholder="09X XXX XXX">
              </div>
            </div>

            <div class="field">
              <label class="field__label" for="documento">RUT o cédula <span class="optional">(opcional)</span></label>
              <input class="input" type="text" id="documento" name="documento" maxlength="40">
            </div>
          </section>

          <section class="checkout-block" aria-labelledby="bloque-entrega">
            <div class="checkout-block__head">
              <span class="checkout-block__number" aria-hidden="true">2</span>
              <h2 id="bloque-entrega">Entrega</h2>
            </div>

            <div class="delivery-options">
              <label class="delivery-option">
                <input type="radio" name="entrega" value="shipping" data-delivery checked>
                <span>
                  <span class="delivery-option__title">Envío a domicilio</span>
                  <span class="delivery-option__note" data-shipping-note>${sum.shipping > 0 ? `Costo: ${formatMoney(sum.shipping)}` : "Envío sin costo"}</span>
                </span>
              </label>
              ${allowPickup
                ? `<label class="delivery-option">
                    <input type="radio" name="entrega" value="pickup" data-delivery>
                    <span>
                      <span class="delivery-option__title">Retiro en Rivera</span>
                      <span class="delivery-option__note">${escapeHtml(checkout.pickup_note || "Retiro sin costo en el local.")}</span>
                    </span>
                  </label>`
                : ""}
            </div>

            <div data-shipping-fields>
              <div class="field" style="margin-top:16px;">
                <label class="field__label" for="direccion">Dirección <span aria-hidden="true">*</span></label>
                <input class="input" type="text" id="direccion" name="direccion" autocomplete="street-address" maxlength="300">
              </div>
              <div class="field-row">
                <div class="field">
                  <label class="field__label" for="ciudad">Ciudad <span aria-hidden="true">*</span></label>
                  <input class="input" type="text" id="ciudad" name="ciudad" autocomplete="address-level2" maxlength="120">
                </div>
                <div class="field">
                  <label class="field__label" for="departamento">Departamento <span aria-hidden="true">*</span></label>
                  <select class="select" id="departamento" name="departamento" autocomplete="address-level1">
                    <option value="">Elegí el departamento</option>
                    ${DEPARTMENTS.map((department) => `<option value="${department}">${department}</option>`).join("")}
                  </select>
                </div>
              </div>
            </div>
          </section>

          <section class="checkout-block" aria-labelledby="bloque-pago">
            <h2 id="bloque-pago">Medio de pago</h2>
            <div data-payment-options></div>
            <p class="field__hint">Los descuentos y recargos corresponden a los productos indicados y se calculan después del cupón, sin incluir el envío. Los importes se redondean a pesos enteros.</p>
          </section>
          <section class="checkout-block" aria-labelledby="bloque-notas">
            <div class="checkout-block__head">
              <span class="checkout-block__number" aria-hidden="true">3</span>
              <h2 id="bloque-notas">Indicaciones</h2>
            </div>
            <div class="field" style="margin-bottom:0;">
              <label class="field__label" for="notas">¿Algo más que debamos saber? <span class="optional">(opcional)</span></label>
              <textarea class="textarea" id="notas" name="notas" maxlength="1500"
                placeholder="Colores, fecha en que lo necesitás, referencias…"></textarea>
            </div>
          </section>
        </div>

        <aside class="sticky-summary" aria-labelledby="titulo-pedido">
          <div class="summary-card">
            <h2 id="titulo-pedido" style="font-family:var(--font-body); font-size:1.0625rem;">Tu pedido</h2>
            <ul style="list-style:none; padding:0; margin:0 0 12px;">${lines}</ul>

            <div data-payment-summary aria-live="polite">Verificando importes…</div>

            ${getCouponCode()
              ? `<p style="font-size:0.8125rem;color:var(--color-muted); margin-bottom:8px;">Cupón aplicado: <strong>${escapeHtml(getCouponCode())}</strong></p>`
              : ""}

            <button class="btn btn--primary btn--block btn--lg" type="submit" data-submit>
              ${hasQuote ? "Enviar mi consulta" : "Confirmar pedido"}
            </button>
            <p style="font-size:0.8125rem; color:var(--color-muted); margin-top:12px;">
              Si elegís Mercado Pago te redirigimos para pagar. Para transferencia o contado recibirás las instrucciones y el pedido quedará pendiente de pago.
            </p>
            <p style="font-size:0.8125rem; color:var(--color-muted);">
              <a href="/condiciones">Ver condiciones de venta</a>
            </p>
          </div>
        </aside>
      </div>
    </form>`;
}

/**
 * Actualiza el resumen en el lugar, sin volver a dibujar el formulario:
 * así el cliente no pierde lo que ya escribió.
 */
async function updateSummary() {
  const sequence = ++state.previewSequence;
  state.preview = null;
  const button = el("[data-submit]");
  if (button) button.disabled = true;
  const summary = el("[data-payment-summary]");
  if (summary) summary.textContent = "Verificando importes…";
  try {
    const preview = await api.previewCart({ items: toApiItems(), coupon_code: getCouponCode(), delivery_method: state.delivery });
    if (sequence !== state.previewSequence) return;
    state.preview = preview;
    const warning = el("[data-payment-unavailable]");
    if (warning) warning.hidden = Object.values(preview.methods).some(Boolean);
    const enabled = Object.keys(preview.methods).filter(key => preview.methods[key]);
    if (!enabled.includes(state.method)) state.method = enabled[0] || "mercadopago";
    const options = el("[data-payment-options]");
    options.innerHTML = Object.entries(preview.totals).filter(([method]) => preview.methods[method]).map(([method, sum]) => `<label class="delivery-option"><input type="radio" name="payment-method" data-payment-method value="${method}" ${state.method === method ? "checked" : ""}><span>${PAYMENT_LABELS[method]}: <strong>${formatMoney(sum.total)}</strong>${sum.adjustment ? `<small style="display:block">${paymentAdjustmentNote(sum)}</small>` : ""}</span></label>`).join("") || "<p>No hay medios de pago habilitados. Podés solicitar una cotización si tu pedido la requiere.</p>";
    if (summary) summary.innerHTML = totalsHtml(totals(), { estimated: preview.has_quote });
    totals().lines.forEach((line, index) => {
      const node = el(`[data-checkout-line="${index}"]`);
      if (node) node.textContent = line.is_quote ? "A cotizar" : formatMoney(line.line_total);
    });
    const note = el("[data-shipping-note]");
    if (note) note.textContent = totals().shipping ? `Costo: ${formatMoney(totals().shipping)}` : "Envío sin costo";
    if (button) { button.disabled = !enabled.length && !preview.has_quote; button.textContent = preview.has_quote ? "Solicitar cotización" : state.method === "mercadopago" ? "Pagar con Mercado Pago" : "Confirmar pedido pendiente de pago"; }
  } catch (error) {
    if (sequence !== state.previewSequence) return;
    if (summary) summary.textContent = error.message || "No pudimos verificar el total. Volvé al carrito y revisá el cupón y los productos.";
  }
}

function updateDeliveryFields() {
  const fields = el("[data-shipping-fields]");
  if (!fields) return;
  const isShipping = state.delivery === "shipping";
  fields.hidden = !isShipping;
  els("input, select", fields).forEach((input) => {
    input.required = isShipping;
  });
}

function bindEvents() {
  root?.addEventListener("change", (event) => {
    const payment = event.target.closest("[data-payment-method]");
    if (payment) { state.method = payment.value; updateSummary(); return; }
    const radio = event.target.closest("[data-delivery]");
    if (!radio) return;
    state.delivery = radio.value;
    updateDeliveryFields();
    updateSummary();
  });

  root?.addEventListener("submit", (event) => {
    const form = event.target.closest("[data-checkout-form]");
    if (!form) return;
    event.preventDefault();
    submitOrder(form);
  });
}

function collect(form) {
  const value = (id) => (el(`#${id}`, form)?.value || "").trim();
  return {
    customer: {
      name: value("nombre"),
      email: value("email"),
      phone: value("telefono"),
      taxId: value("documento"),
    },
    delivery: {
      method: state.delivery,
      address: value("direccion"),
      city: value("ciudad"),
      department: value("departamento"),
    },
    notes: value("notas"),
    payment_method: state.method,
    expected_total: totals().total,
    coupon_code: getCouponCode(),
  };
}

async function submitOrder(form) {
  if (state.submitting || !state.preview) return;

  clearFormErrors(form);
  if (!form.checkValidity()) {
    form.reportValidity();
    return;
  }

  const button = el("[data-submit]");
  state.submitting = true;
  if (button) {
    button.disabled = true;
    button.textContent = "Enviando…";
  }

  try {
    const payload = await api.createOrder({
      ...collect(form),
      items: toApiItems(),
    });

    // Recordamos el correo para poder mostrar el estado del pedido al volver.
    const email = el("#email", form)?.value?.trim();
    if (email) localStorage.setItem("dmgrafica:lastEmail", email);

    if (payload.checkout_url) {
      window.location.href = payload.checkout_url;
      return;
    }

    if (payload.requires_quote) {
      window.location.href = `/gracias?code=${encodeURIComponent(payload.code)}&cotizacion=1`;
      return;
    }

    if (payload.checkout_disabled) {
      toast("El pago en línea está deshabilitado. Escribinos por WhatsApp.", "error");
      state.submitting = false;
      if (button) {
        button.disabled = false;
        button.textContent = "Confirmar pedido";
      }
      return;
    }

    window.location.href = `/gracias?code=${encodeURIComponent(payload.code)}`;
  } catch (error) {
    state.submitting = false;
    if (button) {
      button.disabled = false;
      button.textContent = "Confirmar pedido";
    }
    toast(error.message || "No pudimos completar tu pedido. Probá de nuevo.", "error");
    console.error(error);
    await updateSummary();
  }
}

async function load() {
  try {
    const [settingsPayload, paymentPayload] = await Promise.all([
      api.publicSettings(),
      api.paymentStatus().catch(() => ({ available: true, mode: "sandbox" })),
    ]);
    state.settings = settingsPayload.settings;
    state.payment = paymentPayload;
  } catch (error) {
    console.error(error);
  }

  render();
  updateDeliveryFields();
  bindEvents();
  if (readCart().length) await updateSummary();
}

load();
