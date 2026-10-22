/**
 * Página de inicio: carga las categorías y los productos destacados.
 */

import { api } from "./api.js";
import { el, clear } from "./ui.js";
import { productCard } from "./product-card.js";

function renderCategories(categories) {
  const grid = el("[data-categories]");
  if (!grid) return;

  if (!categories.length) {
    clear(grid).innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <h3>El catálogo se está preparando</h3>
        <p>Estamos cargando los productos. Vuelvé en un rato o escribinos y te lo cotizamos al instante.</p>
        <a class="btn btn--primary" href="/contacto">Escribinos</a>
      </div>`;
    return;
  }

  clear(grid).innerHTML = categories.map((category) => `
    <article class="product-card">
      <div class="product-card__media" style="display:flex; align-items:center; justify-content:center; padding:24px; text-align:center;">
        <span style="font-family: var(--font-display); font-size:1.125rem; font-weight:700; color: var(--color-primary);">${escapeHtml(category.name)}</span>
      </div>
      <div class="product-card__body">
        ${category.description ? `<p class="product-card__desc">${escapeHtml(category.description)}</p>` : ""}
        <div class="product-card__footer">
          <span class="product-card__category">${category.product_count} producto${category.product_count === 1 ? "" : "s"}</span>
          <a class="btn btn--secondary btn--sm" href="/catalogo?categoria=${encodeURIComponent(category.slug)}">Ver</a>
        </div>
      </div>
    </article>`).join("");
}

function renderFeatured(products) {
  const grid = el("[data-featured]");
  if (!grid) return;

  if (!products.length) {
    clear(grid).innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <h3>Todavía no hay productos publicados</h3>
        <p>Mientras tanto, contanos qué necesitás y te cotizamos por WhatsApp.</p>
        <a class="btn btn--primary" href="/contacto">Pedir cotización</a>
      </div>`;
    return;
  }

  clear(grid).innerHTML = products.map(productCard).join("");
}

async function load() {
  try {
    const { categories, products } = await api.catalog();
    renderCategories(categories);
    renderFeatured(products.filter((product) => product.featured).slice(0, 8));
  } catch (error) {
    const grid = el("[data-featured]");
    if (grid) {
      clear(grid).innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <h3>No pudimos cargar el catálogo</h3>
          <p>Revisá tu conexión o escribinos por WhatsApp.</p>
        </div>`;
    }
    console.error(error);
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

load();
