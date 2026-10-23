import { productCard } from "../public/js/product-card.js";
import { paymentRuleNote } from "../public/js/payment-pricing.js";
import { escapeHtml, formatMoney } from "../public/js/api.js";
import { placeholderImage } from "../public/js/ui.js";
export function fillBusiness(html, business) {
  const values = {
    address: [business.address, business.city, business.country].filter(Boolean).join(", ") || "Consultá nuestra dirección por el formulario de contacto",
    phone: business.phone || "Disponible por el formulario de contacto",
    name: business.name,
    "legal-name": business.legal_name || business.name,
    "tax-id": business.tax_id ? `RUT: ${business.tax_id}` : "",
  };
  for (const [key, value] of Object.entries(values)) html = html.replace(new RegExp(`(<span\\b[^>]*data-business-${key}[^>]*>)[\\s\\S]*?(</span>)`, "g"), (_m, open, close) => open + escapeHtml(value || "") + close);
  return html;
}
export function categoryTiles(categories) {
  return categories.map(c => `<a class="category-tile" href="/categoria/${encodeURIComponent(c.slug)}"><img src="${escapeHtml(c.image_url || "https://images.unsplash.com/photo-1586953208448-b95a79798f07?auto=format&fit=crop&w=640&q=80")}" alt="" width="640" height="480" loading="lazy"><span class="category-tile__body"><span>${escapeHtml(c.name)}</span><span class="category-tile__arrow" aria-hidden="true">→</span></span></a>`).join("") || '<p>Estamos preparando el catálogo. <a href="/contacto">Consultanos por tu proyecto.</a></p>';
}
export function fillCatalog(html, { products, categories, category = "", search = "", home = false }) {
  if (home) {
    html = html.replace(/(<div[^>]*data-categories[^>]*>)[\s\S]*?(<\/div>)/, (_m, open, close) => open + categoryTiles(categories) + close);
    const featured = products.filter(p => p.featured).slice(0, 8);
    html = html.replace(/(<div[^>]*data-featured>)[\s\S]*?(<\/div>)/, (_m, open, close) => open + featured.map(productCard).join("") + close);
    if (featured.length) html = html.replace('data-featured-section hidden', 'data-featured-section');
    return html;
  }
  const filtered = products.filter(p => (!category || p.category_slug === category || p.parent_category_slug === category) && (!search || `${p.name} ${p.description || ""}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())));
  html = html.replace(/(<div[^>]*data-catalog-grid[^>]*>)[\s\S]*?(<\/div>)/, (_m, open, close) => open + (filtered.map(productCard).join("") || '<p>No hay productos disponibles para esta selección.</p>') + close);
  html = html.replace(/(<ul[^>]*data-filter-categories[^>]*>)[\s\S]*?(<\/ul>)/, (_m, open, close) => open + '<li><a href="/catalogo">Todos</a></li>' + categories.map(c => `<li><a href="/categoria/${encodeURIComponent(c.slug)}">${escapeHtml(c.name)}</a></li>`).join("") + close);
  html = html.replace(/(<p[^>]*data-result-count[^>]*>)[\s\S]*?(<\/p>)/, (_m, open, close) => `${open}${filtered.length} productos${close}`);
  return html;
}
export function productFallback(product) {
  const quote = product.pricing_mode === "quote" || product.requires_quote;
  const img = product.images?.[0];
  return `<div class="product-detail"><div class="product-gallery"><img src="${escapeHtml(img?.url || placeholderImage(product.name))}" alt="${escapeHtml(img?.alt || product.name)}" width="640" height="480"></div><section class="product-info"><h1>${escapeHtml(product.name)}</h1><p class="product-info__price">${quote ? "A cotizar" : formatMoney(product.price)}</p><p class="field__hint">${escapeHtml(paymentRuleNote(product))}</p><p>${escapeHtml(product.description || product.short_description || "")}</p><noscript><p>Para personalizar y comprar activá JavaScript, o <a href="/contacto">contactanos</a>.</p></noscript></section></div>`;
}
