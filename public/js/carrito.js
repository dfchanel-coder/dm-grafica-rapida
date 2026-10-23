import { paymentAdjustmentNote } from "./payment-pricing.js";
import { PAYMENT_LABELS } from "./payment-pricing.js";
/**
 * Carrito de compras.
 *
 * Vive en localStorage: el cliente no necesita cuenta ni registrarse.
 * El precio real SIEMPRE lo recalcula el servidor al crear el pedido;
 * acá solo se muestra una estimación para que el usuario vea el total.
 */

import { api, formatMoney, escapeHtml } from "./api.js";
import { clear, toast } from "./ui.js";

const CART_KEY = "dmgrafica:carrito";
const COUPON_KEY = "dmgrafica:cupon";

const listeners = new Set();

export function onCartChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function emit() {
  listeners.forEach((listener) => {
    try {
      listener(readCart());
    } catch (error) {
      console.error("Error en el listener del carrito:", error);
    }
  });
}

export function readCart() {
  try {
    const raw = localStorage.getItem(CART_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item) => item && item.productId) : [];
  } catch {
    return [];
  }
}

function writeCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  emit();
}

export function clearCart() {
  localStorage.removeItem(CART_KEY);
  localStorage.removeItem(COUPON_KEY);
  emit();
}

export function cartCount() {
  return readCart().reduce((sum, item) => sum + (Number(item.quantity) || 0), 0);
}

export function cartHasQuotes() {
  return readCart().some((item) => item.pricingMode === "quote");
}

/**
 * Agrega un producto al carrito. Si ya está con las mismas opciones y
 * personalización, se acumula la cantidad en lugar de duplicar la línea.
 */
export function addToCart(product, { quantity = 1, options = {}, customization = "" } = {}) {
  const items = readCart();
  const signature = JSON.stringify({ options, customization: String(customization || "").trim() });

  const existing = items.find((item) => item.productId === product.id && item.signature === signature);

  if (existing) {
    existing.quantity = Math.min(
      Number(existing.maxQuantity || 999),
      (Number(existing.quantity) || 0) + Number(quantity),
    );
    writeCart(items);
    return existing;
  }

  const entry = {
    productId: product.id,
    slug: product.slug,
    name: product.name,
    image: Array.isArray(product.images) ? product.images[0]?.url || "" : "",
    pricingMode: product.pricing_mode || "fixed",
    unitPrice: Number(product.price || 0),
    minQuantity: Number(product.min_quantity || 1),
    maxQuantity: Number(product.maxQuantity || 9999),
    quantity: Math.max(Number(product.min_quantity || 1), Number(quantity)),
    options,
    optionDefinitions: Array.isArray(product.options) ? product.options : [],
    customization: String(customization || "").trim(),
    signature,
  };

  items.push(entry);
  writeCart(items);
  return entry;
}

export function updateQuantity(productId, quantity, signature = "") {
  const items = readCart();
  const item = items.find((entry) => entry.productId === productId && (!signature || entry.signature === signature));
  if (!item) return;
  const next = Number(quantity);
  if (!Number.isFinite(next) || next < 1) {
    removeFromCart(productId, signature);
    return;
  }
  item.quantity = Math.min(item.maxQuantity || 999, Math.max(item.minQuantity || 1, next));
  writeCart(items);
}

export function removeFromCart(productId, signature = "") {
  const items = readCart().filter((entry) => !(entry.productId === productId && (!signature || entry.signature === signature)));
  writeCart(items);
}

export function getCouponCode() {
  return localStorage.getItem(COUPON_KEY) || "";
}

export function setCouponCode(code) {
  if (code) localStorage.setItem(COUPON_KEY, code.trim().toUpperCase());
  else localStorage.removeItem(COUPON_KEY);
}

/** Payload que espera el servidor. Solo ids, cantidades y opciones. */
export function toApiItems() {
  return readCart().map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    options: item.options || {},
    customization: item.customization || "",
  }));
}

/** Estimación del subtotal (el servidor es la fuente de verdad). */
export function estimateSubtotal(settings) {
  return readCart().reduce((sum, item) => {
    if (item.pricingMode === "quote") return sum;
    const delta = estimateOptionDelta(item, settings);
    return sum + (item.unitPrice + delta) * item.quantity;
  }, 0);
}

function estimateOptionDelta(item) {
  const options = item.options || {};
  let delta = 0;
  const definitions = item.optionDefinitions || [];
  for (const definition of definitions) {
    const value = options[definition.id];
    if (definition.type === "select") {
      const choice = (definition.options || []).find((option) => option.value === value);
      if (choice) delta += Number(choice.price_delta || 0);
    } else if (definition.type === "checkbox" && value) {
      delta += Number(definition.price_delta || 0);
    }
  }
  return delta;
}

/* -------------------------------------------------------------------------- */
/* Drawer del carrito                                                          */
/* -------------------------------------------------------------------------- */

export function buildCartDrawer() {
  if (document.getElementById("cart-drawer")) return;

  const drawer = document.createElement("div");
  drawer.className = "cart-drawer";
  drawer.id = "cart-drawer";
  drawer.dataset.open = "false";
  drawer.setAttribute("aria-hidden", "true");
  drawer.innerHTML = `
    <div class="cart-drawer__overlay" data-cart-close></div>
    <aside class="cart-drawer__panel" role="dialog" aria-modal="true" aria-labelledby="cart-drawer-title">
      <div class="cart-drawer__head">
        <h2 id="cart-drawer-title">Tu carrito</h2>
        <button type="button" class="icon-btn" data-cart-close aria-label="Cerrar el carrito">
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round">
            <path d="M4 4l10 10M14 4L4 14"/>
          </svg>
        </button>
      </div>
      <div class="cart-drawer__body" data-cart-body></div>
      <div class="cart-drawer__foot" data-cart-foot></div>
    </aside>`;

  document.body.appendChild(drawer);

  drawer.addEventListener("click", (event) => {
    const close = event.target.closest("[data-cart-close]");
    if (close) {
      closeCart();
      return;
    }
    const remove = event.target.closest("[data-cart-remove]");
    if (remove) {
      removeFromCart(remove.dataset.cartRemove, remove.dataset.cartSignature || "");
      toast("Producto quitado del carrito.");
      return;
    }
    const plus = event.target.closest("[data-cart-plus]");
    const minus = event.target.closest("[data-cart-minus]");
    if (plus || minus) {
      const button = plus || minus;
      const items = readCart();
      const item = items.find((entry) => entry.productId === button.dataset.cartId && entry.signature === (button.dataset.cartSignature || ""));
      if (!item) return;
      updateQuantity(
        item.productId,
        item.quantity + (plus ? 1 : -1),
        item.signature,
      );
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && drawer.dataset.open === "true") closeCart();
  });
}

export function openCart() {
  const drawer = document.getElementById("cart-drawer");
  if (!drawer) return;
  drawer.dataset.open = "true";
  drawer.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  drawer.querySelector("[data-cart-close]")?.focus();
}

export function closeCart() {
  const drawer = document.getElementById("cart-drawer");
  if (!drawer) return;
  drawer.dataset.open = "false";
  drawer.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

export function renderCartDrawer(settings) {
  const drawer = document.getElementById("cart-drawer");
  if (!drawer) return;

  const body = drawer.querySelector("[data-cart-body]");
  const foot = drawer.querySelector("[data-cart-foot]");
  const items = readCart();

  if (!items.length) {
    clear(body).innerHTML = `
      <div class="empty-state">
        <h3>Tu carrito está vacío</h3>
        <p>Revisá el catálogo y encontrá lo que necesitás para tu marca.</p>
        <a class="btn btn--primary" href="/catalogo">Ver el catálogo</a>
      </div>`;
    clear(foot);
    return;
  }

  const lines = items.map((item) => {
    const optionText = Object.entries(item.options || {})
      .map(([key, value]) => `${key}: ${value}`)
      .join(" · ");
    const isQuote = item.pricingMode === "quote";
    return `
      <div class="cart-line">
        <div class="cart-line__media">
          ${item.image
            ? `<img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}" loading="lazy">`
            : ""}
        </div>
        <div>
          <p class="cart-line__name"><a href="/producto/${encodeURIComponent(item.slug)}">${escapeHtml(item.name)}</a></p>
          ${optionText ? `<p class="cart-line__meta">${escapeHtml(optionText)}</p>` : ""}
          ${item.customization ? `<p class="cart-line__meta">${escapeHtml(item.customization)}</p>` : ""}
          <div class="cart-line__actions">
            <span class="qty-control">
              <button type="button" data-cart-minus data-cart-id="${item.productId}" data-cart-signature="${escapeHtml(item.signature)}" aria-label="Quitar una unidad">−</button>
              <span>${item.quantity}</span>
              <button type="button" data-cart-plus data-cart-id="${item.productId}" data-cart-signature="${escapeHtml(item.signature)}" aria-label="Agregar una unidad">+</button>
            </span>
            <button type="button" class="link-button" data-cart-remove data-cart-id="${item.productId}" data-cart-signature="${escapeHtml(item.signature)}">Quitar</button>
          </div>
        </div>
        <div>
          ${isQuote
            ? '<span class="price--quote">A cotizar</span>'
            : `<strong>${formatMoney((item.unitPrice + estimateOptionDelta(item)) * item.quantity)}</strong>`}
        </div>
      </div>`;
  }).join("");

  body.innerHTML = lines;

  const hasQuote = cartHasQuotes();
  const subtotal = estimateSubtotal(settings);

  foot.innerHTML = `
    ${hasQuote
      ? '<p class="cart-line__meta" style="margin-bottom:12px;">Hay productos a cotizar: te respondemos con una propuesta antes de cobrar.</p>'
      : ""}
    <div class="summary-row"><span>Subtotal estimado</span><strong>${formatMoney(subtotal)}</strong></div>
    <div data-drawer-payments aria-live="polite">Verificando medios de pago…</div>
    <a class="btn btn--primary btn--block btn--lg" href="/checkout" style="margin-top:12px;">Ir al checkout</a>
    <a class="btn btn--secondary btn--block" href="/catalogo" style="margin-top:8px;">Seguir comprando</a>`;
  const paymentNode = foot.querySelector("[data-drawer-payments]");
  api.previewCart({ items: toApiItems(), coupon_code: getCouponCode(), delivery_method: "pickup" }).then(preview => {
    if (!paymentNode.isConnected) return;
    paymentNode.innerHTML = Object.entries(preview.totals).map(([method, sum]) => `<div class="summary-row"><span>${PAYMENT_LABELS[method]}${preview.methods[method] ? "" : " (no disponible)"}</span><strong>${formatMoney(sum.total)}</strong></div>${sum.adjustment ? `<small>${paymentAdjustmentNote(sum)}</small>` : ""}`).join("") + '<small>Sin envío. Los productos a cotizar se confirman después.</small>';
  }).catch(error => { if (paymentNode.isConnected) paymentNode.textContent = error.message; });
}
