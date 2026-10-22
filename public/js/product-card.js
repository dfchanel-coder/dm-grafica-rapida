/**
 * Tarjeta de producto reutilizable.
 * Se usa en la home, el catálogo y los resultados de búsqueda.
 */

import { formatMoney, escapeHtml } from "./api.js";
import { placeholderImage } from "./ui.js";

/**
 * @param {object} product Producto del catálogo público
 * @returns {string} HTML de la tarjeta
 */
export function productCard(product) {
  const image = Array.isArray(product.images) ? product.images[0] : null;
  const isQuote = product.pricing_mode === "quote" || product.requires_quote;
  const slug = encodeURIComponent(product.slug || "");

  const price = isQuote
    ? '<span class="price--quote">A cotizar</span>'
    : `<span class="price">${formatMoney(product.price, product.currency || "UYU")}</span>`;

  const compareAt = product.compare_at_price && product.compare_at_price > product.price
    ? `<span class="price price--muted">${formatMoney(product.compare_at_price, product.currency || "UYU")}</span>`
    : "";

  return `
    <article class="product-card">
      <div class="product-card__media">
        <img src="${escapeHtml(image?.url || placeholderImage(product.name))}"
             alt="${escapeHtml(image?.alt || product.name)}"
             width="400" height="300" loading="lazy" decoding="async">
        ${product.featured ? '<span class="product-card__badge">Destacado</span>' : ""}
      </div>
      <div class="product-card__body">
        ${product.category_name ? `<span class="product-card__category">${escapeHtml(product.category_name)}</span>` : ""}
        <h3 class="product-card__title">
          <a href="/producto/${slug}">${escapeHtml(product.name)}</a>
        </h3>
        ${product.short_description ? `<p class="product-card__desc">${escapeHtml(product.short_description)}</p>` : ""}
        <div class="product-card__footer">
          ${compareAt ? compareAt : price}
          <a class="btn btn--secondary btn--sm" href="/producto/${slug}">Ver detalle</a>
        </div>
      </div>
    </article>`;
}
