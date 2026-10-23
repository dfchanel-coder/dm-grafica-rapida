import { PAYMENT_LABELS } from "./payment-ui.js";
/**
 * Página del carrito: listado de productos, cantidades, cupón y resumen.
 */

import { api, formatMoney, escapeHtml } from "./api.js";
import { el, clear, toast } from "./ui.js";
import {
  readCart,
  toApiItems,
  updateQuantity,
  removeFromCart,
  estimateSubtotal,
  cartHasQuotes,
  getCouponCode,
  setCouponCode,
  onCartChange,
} from "./carrito.js";

const root = el("[data-cart-page]");

function lineTotal(item) {
  if (item.pricingMode === "quote") return null;
  return item.unitPrice * item.quantity;
}

function render() {
  if (!root) return;
  const items = readCart();

  if (!items.length) {
    clear(root).innerHTML = `
      <div class="empty-state">
        <h2>Tu carrito está vacío</h2>
        <p>Todavía no agregaste productos. Revisá el catálogo y encontrá lo que necesita tu marca.</p>
        <a class="btn btn--primary btn--lg" href="/catalogo">Ver el catálogo</a>
      </div>`;
    return;
  }

  const hasQuote = cartHasQuotes();
  const subtotal = estimateSubtotal();

  const rows = items.map((item,index) => {
    const total = lineTotal(item);
    const optionText = Object.entries(item.options || {})
      .map(([key, value]) => `${key}: ${value}`)
      .join(" · ");

    return `
      <tr>
        <td data-label="Producto">
          <div style="display:flex; gap:12px; align-items:flex-start;">
            ${item.image
              ? `<img src="${escapeHtml(item.image)}" alt="" width="56" height="56" style="width:56px;height:56px;object-fit:cover;border-radius:8px;background:var(--color-surface);">`
              : ""}
            <div>
              <p style="margin:0 0 2px; font-weight:600;">
                <a href="/producto/${encodeURIComponent(item.slug)}" style="color:var(--color-ink);text-decoration:none;">${escapeHtml(item.name)}</a>
              </p>
              ${optionText ? `<p style="margin:0;font-size:0.8125rem;color:var(--color-muted);">${escapeHtml(optionText)}</p>` : ""}
              ${item.customization ? `<p style="margin:0;font-size:0.8125rem;color:var(--color-muted);">${escapeHtml(item.customization)}</p>` : ""}
            </div>
          </div>
        </td>
        <td data-label="Cantidad">
          <span class="qty-control">
            <button type="button" data-minus data-product-id="${item.productId}" data-signature="${escapeHtml(item.signature)}" aria-label="Quitar una unidad de ${escapeHtml(item.name)}">−</button>
            <span>${item.quantity}</span>
            <button type="button" data-plus data-product-id="${item.productId}" data-signature="${escapeHtml(item.signature)}" aria-label="Agregar una unidad de ${escapeHtml(item.name)}">+</button>
          </span>
        </td>
        <td data-label="Total" data-cart-line="${index}" style="text-align:right; white-space:nowrap;">
          ${total === null
            ? '<span class="price--quote">A cotizar</span>'
            : `<strong>${formatMoney(total)}</strong>`}
        </td>
        <td data-label="Quitar" style="text-align:right;">
          <button type="button" class="link-button" data-remove data-product-id="${item.productId}" data-signature="${escapeHtml(item.signature)}">Quitar</button>
        </td>
      </tr>`;
  }).join("");

  const coupon = getCouponCode();

  clear(root).innerHTML = `
    <div class="cart-page">
      <div>
        <table class="cart-table">
          <caption class="sr-only">Productos en tu carrito</caption>
          <thead>
            <tr>
              <th scope="col">Producto</th>
              <th scope="col">Cantidad</th>
              <th scope="col" style="text-align:right;">Total</th>
              <th scope="col"><span class="sr-only">Acciones</span></th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>

        <p style="margin-top:24px;">
          <a class="btn btn--secondary" href="/catalogo">Seguir comprando</a>
        </p>
      </div>

      <aside class="summary-card" aria-labelledby="titulo-resumen">
        <h2 id="titulo-resumen" style="font-family:var(--font-body); font-size:1.0625rem;">Resumen</h2>

        <div class="summary-row"><span>Subtotal estimado</span><strong>${formatMoney(subtotal)}</strong></div>
        <div class="summary-row"><span>Envío</span><span style="color:var(--color-muted);">Se calcula al finalizar</span></div>
        ${hasQuote
          ? '<div class="summary-row"><span>Productos a cotizar</span><span style="color:var(--color-accent); font-weight:600;">Te cotizamos</span></div>'
          : ""}

        <div data-cart-payment-preview aria-live="polite">Verificando precios por medio de pago…</div>
        <div class="coupon-row">
          <label class="sr-only" for="cupon">Código de descuento</label>
          <input class="input" type="text" id="cupon" placeholder="Código de descuento" value="${escapeHtml(coupon)}" autocomplete="off">
          <button type="button" class="btn btn--secondary" data-apply-coupon>Aplicar</button>
        </div>

        <div class="summary-row summary-row--total">
          <span>Total estimado</span>
          <strong>${formatMoney(subtotal)}</strong>
        </div>

        <p style="font-size:0.8125rem; color:var(--color-muted);">
          ${hasQuote
            ? "El total final se confirma cuando respondemos tu cotización."
            : "El total final se calcula en el servidor al confirmar el pedido."}
        </p>

        <a class="btn btn--primary btn--block btn--lg" href="/checkout" style="margin-top:8px;">Ir al checkout</a>
      </aside>
    </div>`;
  previewMethods();
}

function bindEvents() {
  root?.addEventListener("click", (event) => {
    const plus = event.target.closest("[data-plus]");
    const minus = event.target.closest("[data-minus]");
    const remove = event.target.closest("[data-remove]");
    const coupon = event.target.closest("[data-apply-coupon]");

    if (plus || minus) {
      const button = plus || minus;
      const items = readCart();
      const item = items.find((entry) => entry.productId === button.dataset.productId && entry.signature === button.dataset.signature);
      if (!item) return;
      updateQuantity(item.productId, item.quantity + (plus ? 1 : -1), item.signature);
      return;
    }

    if (remove) {
      removeFromCart(remove.dataset.productId, remove.dataset.signature);
      toast("Producto quitado del carrito.");
      return;
    }

    if (coupon) {
      const input = el("#cupon");
      const code = (input?.value || "").trim().toUpperCase();
      if (!code) {
        setCouponCode("");
        toast("Código de descuento quitado.");
      } else {
        setCouponCode(code);
        toast("Código guardado. Lo validamos al confirmar el pedido.", "success");
      }
      render();
    }
  });
}



let previewSequence = 0;
async function previewMethods() {
  const sequence = ++previewSequence;
  try {
    const preview = await api.previewCart({ items: toApiItems(), coupon_code: getCouponCode(), delivery_method: "pickup" });
    if (sequence !== previewSequence) return;
    const node = el("[data-cart-payment-preview]");
    if (!node) return;
    preview.totals.mercadopago.lines.forEach((line,index) => { const cell = el(`[data-cart-line="${index}"]`); if (cell) cell.textContent = line.is_quote ? "A cotizar" : formatMoney(line.line_total); });
    node.innerHTML = '<p><strong>Productos por medio de pago, sin envío:</strong></p>' + Object.entries(preview.totals).map(([method, sum]) => `<div class="summary-row"><span>${PAYMENT_LABELS[method]}${preview.methods[method] ? "" : " (no disponible)"}</span><strong>${formatMoney(sum.total)}</strong></div>${sum.adjustment ? `<small>${sum.adjustment > 0 ? "Incluye recargo por Mercado Pago en productos seleccionados." : "Incluye descuento por medio de pago en productos seleccionados."}</small>` : ""}`).join("") + (preview.has_quote ? '<p>Importes parciales: faltan los productos a cotizar.</p>' : '');
  } catch (error) {
    if (sequence === previewSequence && el("[data-cart-payment-preview]")) el("[data-cart-payment-preview]").textContent = error.message;
  }
}

bindEvents();
onCartChange(render);
render();
