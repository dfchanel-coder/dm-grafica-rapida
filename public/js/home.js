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
        <p>Estamos cargando los productos. Volvé en un rato o escribinos y te lo cotizamos al instante.</p>
        <a class="btn btn--primary" href="/contacto">Escribinos</a>
      </div>`;
    return;
  }

  clear(grid).innerHTML = categories.map((category) => `
    <a class="category-tile" href="/catalogo?categoria=${encodeURIComponent(category.slug)}">
      <img src="${escapeHtml(category.image_url || "https://images.unsplash.com/photo-1586953208448-b95a79798f07?auto=format&fit=crop&w=640&q=80")}" alt="" width="640" height="480" loading="lazy">
      <span class="category-tile__body">
        <span>${escapeHtml(category.name)}</span>
        <span class="category-tile__arrow" aria-hidden="true">→</span>
      </span>
    </a>`).join("");
}

function renderFeatured(products) {
  const grid = el("[data-featured]");
  const section = el("[data-featured-section]");
  if (!grid) return;

  if (!products.length) {
    if (section) section.hidden = true;
    return;
  }
  if (section) section.hidden = false;
  clear(grid).innerHTML = products.map(productCard).join("");
}

async function load() {
  try {
    const { categories, products } = await api.catalog();
    renderCategories(categories);
    renderFeatured(products.filter((product) => product.featured).slice(0, 8));
  } catch (error) {
    const grid = el("[data-categories]");
    if (grid && !grid.querySelector("a")) {
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