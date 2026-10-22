/**
 * Arranque común de todas las páginas públicas.
 *
 * - Carga los ajustes del sitio y los aplica (colores de marca, datos de
 *   contacto, textos del hero).
 * - Monta el drawer del carrito y mantiene el contador al día.
 * - Gestiona el menú en pantallas pequeñas.
 *
 * El encabezado y el pie están escritos en el HTML de cada página: son
 * contenido real para los buscadores y no dependen de JavaScript.
 */

import { api } from "./api.js";
import { el, els, toast } from "./ui.js";
import {
  buildCartDrawer,
  cartCount,
  onCartChange,
  openCart,
  closeCart,
  renderCartDrawer,
} from "./carrito.js";

const settings = { current: null };

/* -------------------------------------------------------------------------- */
/* Ajustes                                                                    */
/* -------------------------------------------------------------------------- */

async function loadSettings() {
  try {
    const payload = await api.publicSettings();
    settings.current = payload.settings;
  } catch {
    settings.current = null;
  }
  applyBrandColors(settings.current);
  applyBusinessData(settings.current);
  applyHomeCopy(settings.current);
  return settings.current;
}

function applyBrandColors(data) {
  const brand = data?.brand;
  if (!brand) return;
  const root = document.documentElement;
  if (brand.primary) {
    root.style.setProperty("--color-primary", brand.primary);
    root.style.setProperty("--color-primary-dark", shade(brand.primary, -18));
    root.style.setProperty("--color-primary-soft", mix(brand.primary, "#FFFFFF", 0.88));
  }
  if (brand.accent) {
    root.style.setProperty("--color-accent", brand.accent);
    root.style.setProperty("--color-accent-soft", mix(brand.accent, "#FFFFFF", 0.88));
  }
  if (brand.ink) root.style.setProperty("--color-ink", brand.ink);
  if (brand.logo_url) {
    els(".brand__mark").forEach((node) => {
      node.innerHTML = `<img src="${escapeText(brand.logo_url)}" alt="" width="40" height="40">`;
    });
  }
}

function hexToRgb(hex) {
  const clean = String(hex || "").replace("#", "");
  if (clean.length === 3) {
    return clean.split("").map((char) => parseInt(char + char, 16));
  }
  if (clean.length !== 6) return [19, 78, 157];
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

function shade(hex, percent) {
  const [r, g, b] = hexToRgb(hex);
  const factor = 1 + percent / 100;
  const clamp = (value) => Math.max(0, Math.min(255, Math.round(value * factor)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}

function mix(hex, target, weight) {
  const a = hexToRgb(hex);
  const b = hexToRgb(target);
  const mixChannel = (index) => Math.round(a[index] * (1 - weight) + b[index] * weight);
  return `rgb(${mixChannel(0)}, ${mixChannel(1)}, ${mixChannel(2)})`;
}

function applyBusinessData(data) {
  const business = data?.business;
  if (!business) return;

  els("[data-business-name]").forEach((node) => { node.textContent = business.name; });
  els("[data-business-tagline]").forEach((node) => { node.textContent = business.tagline || ""; });
  els("[data-business-address]").forEach((node) => {
    node.innerHTML = [
      escapeText(business.address),
      [business.city, business.postal_code].filter(Boolean).join(", "),
      business.country,
    ].filter(Boolean).join("<br>");
  });
  els("[data-business-phone]").forEach((node) => { node.textContent = business.phone || ""; });

  const whatsapp = String(business.whatsapp || "").replace(/[^0-9]/g, "");
  els("[data-business-whatsapp]").forEach((node) => {
    if (!whatsapp) {
      node.setAttribute("aria-hidden", "true");
      node.hidden = true;
      return;
    }
    node.href = `https://wa.me/${whatsapp}`;
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
    const label = node.querySelector("[data-whatsapp-label]");
    if (label) label.textContent = business.phone || "Escribinos";
  });

  els("[data-business-instagram]").forEach((node) => {
    if (!business.instagram) { node.hidden = true; return; }
    node.href = business.instagram;
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  });

  els("[data-business-facebook]").forEach((node) => {
    if (!business.facebook) { node.hidden = true; return; }
    node.href = business.facebook;
    node.setAttribute("target", "_blank");
    node.setAttribute("rel", "noopener noreferrer");
  });
}

function escapeText(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function applyHomeCopy(data) {
  const home = data?.home;
  if (!home) return;

  els("[data-hero-title]").forEach((node) => { node.textContent = home.hero_title || ""; });
  els("[data-hero-subtitle]").forEach((node) => { node.textContent = home.hero_subtitle || ""; });

  const cta = el("[data-hero-cta]");
  if (cta && home.hero_cta) {
    cta.textContent = home.hero_cta;
    if (home.hero_cta_link) cta.href = home.hero_cta_link;
  }

  const announcement = el("[data-announcement]");
  if (announcement) announcement.textContent = home.announcement || "";

  els("[data-about-title]").forEach((node) => { node.textContent = home.about_title || ""; });
  els("[data-about-text]").forEach((node) => { node.textContent = home.about_text || ""; });

  const stepsContainer = el("[data-how-steps]");
  if (stepsContainer && Array.isArray(home.how_steps)) {
    stepsContainer.innerHTML = home.how_steps.map((step) => `
      <div class="step">
        <h3>${escapeText(step.title)}</h3>
        <p>${escapeText(step.text)}</p>
      </div>`).join("");
  }
}

/* -------------------------------------------------------------------------- */
/* Carrito                                                                     */
/* -------------------------------------------------------------------------- */

function refreshCartBadges() {
  const count = cartCount();
  els("[data-cart-count]").forEach((node) => {
    node.textContent = String(count);
    node.dataset.count = String(count);
  });
  els("[data-cart-label]").forEach((node) => {
    node.setAttribute("aria-label", count === 1 ? "Ver el carrito (1 producto)" : `Ver el carrito (${count} productos)`);
  });
}

function initCart() {
  buildCartDrawer();
  renderCartDrawer(settings.current);
  refreshCartBadges();
  onCartChange(() => {
    refreshCartBadges();
    renderCartDrawer(settings.current);
  });

  els("[data-cart-open]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      openCart();
    });
  });

  els("[data-cart-close]").forEach((node) => {
    node.addEventListener("click", (event) => {
      event.preventDefault();
      closeCart();
    });
  });
}

/* -------------------------------------------------------------------------- */
/* Menú móvil                                                                  */
/* -------------------------------------------------------------------------- */

function initMenu() {
  const toggle = el("[data-menu-toggle]");
  const nav = el("#site-nav");
  if (!toggle || !nav) return;

  toggle.addEventListener("click", () => {
    const open = nav.dataset.open === "true";
    nav.dataset.open = open ? "false" : "true";
    toggle.setAttribute("aria-expanded", open ? "false" : "true");
  });

  nav.addEventListener("click", (event) => {
    if (event.target.closest("a")) {
      nav.dataset.open = "false";
      toggle.setAttribute("aria-expanded", "false");
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Enlace activo en la navegación                                             */
/* -------------------------------------------------------------------------- */

function markCurrentLink() {
  const path = window.location.pathname.replace(/\/$/, "") || "/";
  els(".site-nav__link").forEach((link) => {
    const href = link.getAttribute("href") || "";
    const target = href.split("#")[0];
    if (!target || target === "#") return;
    const cleanTarget = target.replace(/\/$/, "") || "/";
    if (cleanTarget === path && target !== "/") {
      link.setAttribute("aria-current", "page");
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Año del copyright y botón de WhatsApp flotante                             */
/* -------------------------------------------------------------------------- */

function initMisc() {
  els("[data-year]").forEach((node) => { node.textContent = String(new Date().getFullYear()); });
}

/* -------------------------------------------------------------------------- */
/* Arranque                                                                    */
/* -------------------------------------------------------------------------- */

async function boot() {
  initMenu();
  initMisc();
  initCart();
  markCurrentLink();
  await loadSettings();
  renderCartDrawer(settings.current);
  refreshCartBadges();
  document.dispatchEvent(new CustomEvent("tienda:ready", { detail: settings.current }));
}

export const Tienda = {
  get settings() { return settings.current; },
  ready: boot(),
  toast,
};

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
