import { paymentRuleNote } from "./payment-pricing.js";
/**
 * Ficha de producto: galería, opciones, cantidad, personalización y carrito.
 */

import { api, formatMoney, escapeHtml } from "./api.js";
import { el, els, clear, toast, placeholderImage } from "./ui.js";
import { addToCart, openCart } from "./carrito.js";
import { productCard } from "./product-card.js";

const state = {
  product: null,
  selection: {},
  quantity: 1,
};

function slugFromPath() {
  const parts = window.location.pathname.split("/").filter(Boolean);
  const index = parts.indexOf("producto");
  return index >= 0 ? decodeURIComponent(parts[index + 1] || "") : "";
}

function isQuote(product) {
  return product.pricing_mode === "quote" || product.requires_quote;
}

function estimateUnitPrice() {
  const product = state.product;
  if (!product || isQuote(product)) return 0;

  let delta = 0;
  for (const definition of product.options || []) {
    const value = state.selection[definition.id];
    if (definition.type === "select") {
      const choice = (definition.options || []).find((option) => option.value === value);
      if (choice) delta += Number(choice.price_delta || 0);
    } else if (definition.type === "checkbox" && value) {
      delta += Number(definition.price_delta || 0);
    }
  }
  return Math.max(0, Number(product.price || 0) + delta);
}

/* -------------------------------------------------------------------------- */
/* Render                                                                      */
/* -------------------------------------------------------------------------- */

function renderGallery(product) {
  const images = (product.images || []).filter((image) => image?.url);
  const main = images[0] || { url: placeholderImage(product.name), alt: product.name };

  const thumbs = images.length > 1
    ? `<div class="product-gallery__thumbs">
        ${images.map((image, index) => `
          <button type="button" data-gallery-index="${index}" aria-current="${index === 0}" aria-label="Ver imagen ${index + 1}">
            <img src="${escapeHtml(image.url)}" alt="" width="76" height="60" loading="lazy">
          </button>`).join("")}
      </div>`
    : "";

  return `
    <div class="product-gallery">
      <div class="product-gallery__main">
        <img src="${escapeHtml(main.url)}" alt="${escapeHtml(main.alt || product.name)}" width="800" height="600" data-gallery-main>
      </div>
      ${thumbs}
    </div>`;
}

function renderOptions(product) {
  const definitions = product.options || [];
  if (!definitions.length) return "";

  return definitions.map((definition) => {
    const id = `option-${definition.id}`;
    const required = definition.required ? " <span aria-hidden=\"true\">*</span>" : "";
    const help = definition.help ? `<span class="field__hint">${escapeHtml(definition.help)}</span>` : "";

    if (definition.type === "select") {
      return `
        <div class="option-group">
          <span class="option-group__label" id="label-${escapeHtml(definition.id)}">
            ${escapeHtml(definition.label)}${required}
          </span>
          <div class="option-group__choices" role="radiogroup" aria-labelledby="label-${escapeHtml(definition.id)}">
            ${(definition.options || []).map((choice) => `
              <span class="option-choice">
                <input type="radio" id="${id}-${escapeHtml(choice.value)}" name="${id}"
                       value="${escapeHtml(choice.value)}" data-option="${escapeHtml(definition.id)}"
                       ${definition.required ? "required" : ""}>
                <label for="${id}-${escapeHtml(choice.value)}">
                  ${escapeHtml(choice.label)}
                  ${Number(choice.price_delta) ? `<span class="option-group__delta">+${formatMoney(choice.price_delta)}</span>` : ""}
                </label>
              </span>`).join("")}
          </div>
          ${help}
        </div>`;
    }

    if (definition.type === "checkbox") {
      return `
        <div class="option-group">
          <span class="option-choice">
            <input type="checkbox" id="${id}" data-option="${escapeHtml(definition.id)}" value="true"
                   ${definition.required ? "required" : ""}>
            <label for="${id}">
              ${escapeHtml(definition.label)}
              ${Number(definition.price_delta) ? `<span class="option-group__delta">+${formatMoney(definition.price_delta)}</span>` : ""}
            </label>
          </span>
          ${help}
        </div>`;
    }

    if (definition.type === "textarea") {
      return `
        <div class="option-group">
          <label class="option-group__label" for="${id}">${escapeHtml(definition.label)}${required}</label>
          <textarea class="textarea" id="${id}" data-option="${escapeHtml(definition.id)}"
                    ${definition.required ? "required" : ""}
                    maxlength="${definition.max_length || 500}"
                    aria-describedby="help-${escapeHtml(definition.id)}"></textarea>
          ${help ? `<span class="field__hint" id="help-${escapeHtml(definition.id)}">${escapeHtml(definition.help)}</span>` : ""}
        </div>`;
    }

    if (definition.type === "number") {
      return `
        <div class="option-group">
          <label class="option-group__label" for="${id}">${escapeHtml(definition.label)}${required}</label>
          <input class="input" type="number" id="${id}" data-option="${escapeHtml(definition.id)}"
                 value="${definition.min ?? 1}" min="${definition.min ?? 1}" max="${definition.max ?? 9999}"
                 ${definition.required ? "required" : ""}
                 style="max-width:180px;">
          ${help}
        </div>`;
    }

    return `
      <div class="option-group">
        <label class="option-group__label" for="${id}">${escapeHtml(definition.label)}${required}</label>
        <input class="input" type="text" id="${id}" data-option="${escapeHtml(definition.id)}"
               ${definition.required ? "required" : ""}
               maxlength="${definition.max_length || 120}"
               aria-describedby="help-${escapeHtml(definition.id)}">
        ${help ? `<span class="field__hint" id="help-${escapeHtml(definition.id)}">${escapeHtml(definition.help)}</span>` : ""}
      </div>`;
  }).join("");
}

function renderInfo(product) {
  const quote = isQuote(product);
  const unit = estimateUnitPrice();
  const minQuantity = Number(product.min_quantity || 1);
  const leadTime = Number(product.lead_time_days || 0);

  const priceBlock = quote
    ? `<p class="product-info__price" style="color:var(--color-accent); font-size:1.5rem;">A cotizar</p>
       <p class="lead" style="margin-bottom:16px;">Contanos qué necesitás y te respondemos con el precio y el tiempo de entrega.</p>`
    : `<p class="product-info__price" data-unit-price>${formatMoney(unit, product.currency || "UYU")}</p>`;

  const meta = [];
  if (leadTime) meta.push(`<span>Producción: ${leadTime} ${leadTime === 1 ? "día" : "días"} aprox.</span>`);
  if (minQuantity > 1) meta.push(`<span>Mínimo: ${minQuantity} unidades</span>`);
  meta.push("<span>Envíos a todo Uruguay</span>");
  if (product.category_name) meta.push(`<span>${escapeHtml(product.category_name)}</span>`);

  const personalization = product.personalization_enabled
    ? `
      <div class="option-group">
        <label class="option-group__label" for="personalizacion">Indicaciones para tu diseño</label>
        <textarea class="textarea" id="personalizacion" maxlength="800" data-customization
          placeholder="Por ejemplo: logo a una tinta,Measures 8 x 8 cm, 200 unidades, entrega en la semana 32…"></textarea>
        ${product.personalization_prompt
          ? `<span class="field__hint">${escapeHtml(product.personalization_prompt)}</span>`
          : ""}
      </div>`
    : "";

  const quantityBlock = `
    <div class="option-group">
      <label class="option-group__label" for="cantidad">Cantidad</label>
      <div class="quantity-field">
        <input class="input" type="number" id="cantidad" value="${state.quantity}"
               min="${minQuantity}" max="9999" inputmode="numeric" data-quantity>
        <span class="field__hint" style="margin:0;">Mínimo ${minQuantity} unidad${minQuantity === 1 ? "" : "es"}</span>
      </div>
    </div>`;

  const totalBlock = quote
    ? ""
    : `<div class="purchase-box__total">
         <span>Total estimado</span>
         <strong data-total-price>${formatMoney(unit * state.quantity, product.currency || "UYU")}</strong>
       </div>`;

  return `
    <div class="product-info">
      ${product.category_name ? `<span class="eyebrow">${escapeHtml(product.category_name)}</span>` : ""}
      <h1>${escapeHtml(product.name)}</h1>
      ${product.short_description ? `<p class="lead">${escapeHtml(product.short_description)}</p>` : ""}
      ${priceBlock}
      ${paymentRuleNote(product) ? `<p class="field__hint">${escapeHtml(paymentRuleNote(product))}</p>` : ""}
      <div class="product-info__meta">${meta.join("")}</div>

      ${product.description ? `<div style="margin-bottom:24px;">${formatDescription(product.description)}</div>` : ""}

      <form data-product-form novalidate>
        ${renderOptions(product)}
        ${personalization}
        ${quantityBlock}

        <div class="purchase-box">
          <p style="margin:0 0 12px; font-size:0.9375rem; color:var(--color-muted);">
            ${quote
              ? "Sumalo al carrito y te cotizamos sin compromiso. No se cobra nada hasta que confirmes."
              : "El precio final se calcula en el servidor al confirmar el pedido."}
          </p>
          <button class="btn btn--primary btn--block btn--lg" type="submit" data-add-to-cart>
            ${quote ? "Pedir cotización" : "Agregar al carrito"}
          </button>
          ${totalBlock}
        </div>
      </form>

      <ul class="contact-list" style="gap:12px;">
        <li>
          <span class="contact-list__icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"></path></svg>
          </span>
          <span>
            <span class="contact-list__label">¿Dudas?</span>
            <a data-business-whatsapp href="https://wa.me/59895010244"><span data-whatsapp-label>Escribinos por WhatsApp</span></a>
          </span>
        </li>
      </ul>
    </div>`;
}

function formatDescription(text) {
  return String(text || "")
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

/* -------------------------------------------------------------------------- */
/* Interacción                                                                 */
/* -------------------------------------------------------------------------- */

function updatePrices() {
  const product = state.product;
  if (!product || isQuote(product)) return;

  const unit = estimateUnitPrice();
  const unitNode = el("[data-unit-price]");
  const totalNode = el("[data-total-price]");
  if (unitNode) unitNode.textContent = formatMoney(unit, product.currency || "UYU");
  if (totalNode) totalNode.textContent = formatMoney(unit * state.quantity, product.currency || "UYU");
}

function readSelection(root) {
  const selection = {};
  els("[data-option]", root).forEach((input) => {
    const id = input.dataset.option;
    if (input.type === "radio") {
      if (input.checked) selection[id] = input.value;
    } else if (input.type === "checkbox") {
      selection[id] = input.checked ? "true" : "false";
    } else {
      selection[id] = input.value.trim();
    }
  });
  return selection;
}

function bindEvents(root) {
  root.addEventListener("input", (event) => {
    const input = event.target;
    if (input.matches("[data-option]")) {
      state.selection = readSelection(root);
      updatePrices();
    }
    if (input.matches("[data-quantity]")) {
      const min = Number(input.min || 1);
      const value = Math.max(min, Number.parseInt(input.value, 10) || min);
      state.quantity = value;
      updatePrices();
    }
  });

  root.addEventListener("change", (event) => {
    const input = event.target;
    if (input.matches("[data-option]")) {
      state.selection = readSelection(root);
      updatePrices();
    }
  });

  root.addEventListener("click", (event) => {
    const thumb = event.target.closest("[data-gallery-index]");
    if (!thumb) return;
    const index = Number(thumb.dataset.galleryIndex);
    const images = state.product.images || [];
    const image = images[index];
    if (!image) return;
    const main = el("[data-gallery-main]");
    if (main) {
      main.src = image.url;
      main.alt = image.alt || state.product.name;
    }
    els("[data-gallery-index]").forEach((button) => {
      button.setAttribute("aria-current", button === thumb ? "true" : "false");
    });
  });

  root.addEventListener("submit", (event) => {
    event.preventDefault();
    const form = event.target;
    const product = state.product;

    // Validación nativa: los campos obligatorios se reportan solos.
    if (!form.checkValidity()) {
      form.reportValidity();
      return;
    }

    const selection = readSelection(form);
    const customization = el("[data-customization]")?.value.trim() || "";
    const quantity = Math.max(
      Number(product.min_quantity || 1),
      Number.parseInt(el("[data-quantity]")?.value, 10) || 1,
    );

    addToCart(product, { quantity, options: selection, customization });
    toast(`${product.name} se agregó al carrito.`, "success");
    openCart();
  });
}

/* -------------------------------------------------------------------------- */
/* Carga                                                                       */
/* -------------------------------------------------------------------------- */

async function loadRelated(product) {
  try {
    const { products } = await api.catalog();
    const related = products
      .filter((item) => item.id !== product.id && item.category_slug === product.category_slug)
      .slice(0, 4);
    if (!related.length) return;

    const section = el("[data-related-section]");
    const grid = el("[data-related]");
    if (!section || !grid) return;
    section.hidden = false;
    clear(grid).innerHTML = related.map(productCard).join("");
  } catch {
    // Los relacionados son opcionales: si fallan, la página sigue funcionando.
  }
}

async function load() {
  const root = el("[data-product-root]");
  const slug = slugFromPath();

  if (!slug) {
    window.location.replace("/catalogo");
    return;
  }

  let product = null;
  try {
    const payload = await api.product(slug);
    product = payload.product;
  } catch {
    product = null;
  }

  if (!product) {
    if (root && !root.querySelector("h1")) {
      clear(root).innerHTML = `
        <div class="empty-state">
          <h1>No encontramos ese producto</h1>
          <p>Puede que haya cambiado de nombre o que ya no esté disponible.</p>
          <a class="btn btn--primary" href="/catalogo">Ver el catálogo</a>
        </div>`;
    }
    return;
  }

  state.product = product;
  state.quantity = Number(product.min_quantity || 1);

  const breadcrumb = el("[data-breadcrumb]");
  if (breadcrumb) breadcrumb.textContent = product.name;

  if (root) {
    clear(root).innerHTML = `
      <div class="product-detail">
        ${renderGallery(product)}
        ${renderInfo(product)}
      </div>`;
    bindEvents(root);
  }

  loadRelated(product);
}

load();
