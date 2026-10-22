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
  const settings = state.settings || {};
  const subtotal = estimateSubtotal(settings);
  const shipping = shippingEstimate();
  const taxRate = Number(settings.tax?.rate || 0);
  const includeTax = settings.tax?.include_tax !== false;
  const tax = includeTax ? 0 : Math.round(subtotal * (taxRate / 100));
  return { subtotal, shipping, tax, taxRate, total: subtotal + shipping + tax };
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

  const lines = items.map((item) => {
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
        <span style="white-space:nowrap;">
          ${item.pricingMode === "quote"
            ? '<span class="price--quote">A cotizar</span>'
            : formatMoney(item.unitPrice * item.quantity)}
        </span>
      </li>`;
  }).join("");

  clear(root).innerHTML = `
    ${!state.payment.available
      ? `<div class="alert alert--warning">
           <strong>El pago en línea está temporalmente deshabilitado.</strong>
           Podés enviar tu consulta y te cotizamos por WhatsApp: <a data-business-whatsapp href="https://wa.me/59895010244">escribinos</a>.
         </div>`
      : ""}
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

            <div class="summary-row"><span>Subtotal</span><strong data-sum-subtotal>${formatMoney(sum.subtotal)}</strong></div>
            <div class="summary-row"><span>Envío</span><strong data-sum-shipping>${sum.shipping > 0 ? formatMoney(sum.shipping) : "Sin costo"}</strong></div>
            ${sum.tax > 0 ? `<div class="summary-row"><span>IVA (${sum.taxRate}%)</span><strong>${formatMoney(sum.tax)}</strong></div>` : ""}
            <div class="summary-row summary-row--total"><span>Total</span><strong data-sum-total>${formatMoney(sum.total)}</strong></div>

            ${getCouponCode()
              ? `<p style="font-size:0.8125rem;color:var(--color-muted); margin-bottom:8px;">Cupón aplicado: <strong>${escapeHtml(getCouponCode())}</strong></p>`
              : ""}

            <button class="btn btn--primary btn--block btn--lg" type="submit" data-submit>
              ${hasQuote ? "Enviar mi consulta" : "Pagar con Mercado Pago"}
            </button>
            <p style="font-size:0.8125rem; color:var(--color-muted); margin-top:12px;">
              Al confirmar te redirigimos a Mercado Pago para completar la compra de forma segura.
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
function updateSummary() {
  const sum = totals();
  const subtotalNode = el("[data-sum-subtotal]");
  const shippingNode = el("[data-sum-shipping]");
  const totalNode = el("[data-sum-total]");
  const note = el("[data-shipping-note]");

  if (subtotalNode) subtotalNode.textContent = formatMoney(sum.subtotal);
  if (shippingNode) shippingNode.textContent = sum.shipping > 0 ? formatMoney(sum.shipping) : "Sin costo";
  if (totalNode) totalNode.textContent = formatMoney(sum.total);
  if (note) note.textContent = sum.shipping > 0 ? `Costo: ${formatMoney(sum.shipping)}` : "Envío sin costo";
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
    coupon_code: getCouponCode(),
  };
}

async function submitOrder(form) {
  if (state.submitting) return;

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
        button.textContent = "Pagar con Mercado Pago";
      }
      return;
    }

    window.location.href = `/gracias?code=${encodeURIComponent(payload.code)}`;
  } catch (error) {
    state.submitting = false;
    if (button) {
      button.disabled = false;
      button.textContent = "Pagar con Mercado Pago";
    }
    toast(error.message || "No pudimos completar tu pedido. Probá de nuevo.", "error");
    console.error(error);
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
}

load();
