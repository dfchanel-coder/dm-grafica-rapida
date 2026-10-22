/**
 * Catálogo: búsqueda, filtro por categoría y filtro por tipo de precio.
 * La búsqueda ocurre en el navegador sobre el catálogo ya descargado:
 * el catálogo completo cabe en una sola respuesta y así la navegación
 * es instantánea.
 */

import { api } from "./api.js";
import { el, els, clear } from "./ui.js";
import { productCard } from "./product-card.js";

const state = {
  products: [],
  categories: [],
  category: "all",
  pricing: "all",
  search: "",
};

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function matches(product) {
  if (state.category !== "all" && product.category_slug !== state.category && product.parent_category_slug !== state.category) return false;

  if (state.pricing !== "all") {
    const isQuote = product.pricing_mode === "quote" || product.requires_quote;
    if (state.pricing === "quote" && !isQuote) return false;
    if (state.pricing === "fixed" && isQuote) return false;
  }

  if (state.search) {
    const haystack = normalize([
      product.name,
      product.short_description,
      product.description,
      product.category_name,
    ].join(" "));
    if (!haystack.includes(normalize(state.search))) return false;
  }

  return true;
}

function render() {
  const grid = el("[data-catalog-grid]");
  const count = el("[data-result-count]");
  if (!grid) return;

  const results = state.products.filter(matches);

  if (count) {
    count.textContent = results.length === 1
      ? "1 producto"
      : `${results.length} productos`;
  }

  if (!results.length) {
    clear(grid).innerHTML = `
      <div class="empty-state" style="grid-column: 1 / -1;">
        <h3>No encontramos productos con esos filtros</h3>
        <p>Probá con otra búsqueda o contanos qué necesitás y te lo cotizamos.</p>
        <a class="btn btn--primary" href="/contacto">Pedir cotización</a>
      </div>`;
    return;
  }

  clear(grid).innerHTML = results.map(productCard).join("");
}

function renderCategoryFilters() {
  const list = el("[data-filter-categories]");
  if (!list) return;

  const items = [{ slug: "all", name: "Todos", product_count: state.products.length }];
  state.categories.filter((category) => !category.parent_id).forEach((root) => {
    items.push(root);
    state.categories.filter((category) => category.parent_id === root.id).forEach((child) => items.push({ ...child, name: `${root.name} / ${child.name}` }));
  });

  clear(list).innerHTML = items.map((category) => `
    <li>
      <button type="button"
              data-category="${escapeAttr(category.slug)}"
              aria-pressed="${state.category === category.slug}">
        <span>${escapeHtml(category.name)}</span>
        <span>${category.product_count}</span>
      </button>
    </li>`).join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/"/g, "&quot;");
}

function bindEvents() {
  const categories = el("[data-filter-categories]");
  categories?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-category]");
    if (!button) return;
    state.category = button.dataset.category || "all";
    syncPressed(categories, "[data-category]", "category", state.category);
    render();
  });

  const pricingList = el("[data-pricing]")?.parentElement;
  pricingList?.addEventListener("click", (event) => {
    const button = event.target.closest("[data-pricing]");
    if (!button) return;
    state.pricing = button.dataset.pricing || "all";
    syncPressed(pricingList, "[data-pricing]", "pricing", state.pricing);
    render();
  });

  const search = el("[data-search]");
  let timer = null;
  search?.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      state.search = search.value.trim();
      render();
    }, 180);
  });
}

function syncPressed(scope, selector, key, value) {
  els(selector, scope).forEach((button) => {
    button.setAttribute("aria-pressed", button.dataset[key] === value ? "true" : "false");
  });
}

async function load() {
  try {
    const payload = await api.catalog();
    state.products = payload.products || [];
    state.categories = payload.categories || [];
  } catch (error) {
    console.error(error);
    const grid = el("[data-catalog-grid]");
    if (grid) {
      clear(grid).innerHTML = `
        <div class="empty-state" style="grid-column: 1 / -1;">
          <h3>No pudimos cargar el catálogo</h3>
          <p>Revisá tu conexión o escribinos por WhatsApp.</p>
        </div>`;
    }
    return;
  }

  // Categoría inicial desde la URL: /catalogo?categoria=stickers-etiquetas
  const params = new URLSearchParams(window.location.search);
  const routeCategory = window.location.pathname.match(/^\/categoria\/([^/]+)\/?$/);
  const requested = params.get("categoria") || (routeCategory ? decodeURIComponent(routeCategory[1]) : null);
  if (requested) {
    const exists = state.categories.some((category) => category.slug === requested);
    if (exists) state.category = requested;
  }

  renderCategoryFilters();
  bindEvents();
  render();
}

load();
