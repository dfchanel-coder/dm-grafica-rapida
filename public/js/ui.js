/**
 * Utilidades de interfaz compartidas por todas las páginas.
 */

import { escapeHtml } from "./api.js";

export { escapeHtml };

/* --- DOM ----------------------------------------------------------------- */

export function el(selector, scope = document) {
  return scope.querySelector(selector);
}

export function els(selector, scope = document) {
  return Array.from(scope.querySelectorAll(selector));
}

export function clear(node) {
  while (node && node.firstChild) node.removeChild(node.firstChild);
  return node;
}

/* --- Avisos flotantes ----------------------------------------------------- */

let toastRegion = null;

export function toast(message, type = "info") {
  if (!toastRegion) {
    toastRegion = document.createElement("div");
    toastRegion.className = "toast-region";
    toastRegion.setAttribute("role", "status");
    toastRegion.setAttribute("aria-live", "polite");
    document.body.appendChild(toastRegion);
  }
  const node = document.createElement("div");
  node.className = `toast${type === "error" ? " toast--error" : type === "success" ? " toast--success" : ""}`;
  node.textContent = message;
  toastRegion.appendChild(node);
  setTimeout(() => node.remove(), 4200);
}

/* --- Errores de campo ----------------------------------------------------- */

export function setFieldError(field, message) {
  if (!field) return;
  const errorNode = field.parentElement?.querySelector(".field__error");
  if (message) {
    field.setAttribute("aria-invalid", "true");
    if (errorNode) errorNode.textContent = message;
  } else {
    field.removeAttribute("aria-invalid");
    if (errorNode) errorNode.textContent = "";
  }
}

export function clearFormErrors(form) {
  els(".field__error", form).forEach((node) => { node.textContent = ""; });
  els("[aria-invalid]", form).forEach((node) => node.removeAttribute("aria-invalid"));
}

/* --- Formatos -------------------------------------------------------------- */

export function initials(text) {
  return String(text || "")
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((word) => word[0] || "")
    .join("")
    .toUpperCase();
}

/** URL con query string, sin perder los parámetros existentes. */
export function withQuery(path, params) {
  const url = new URL(path, window.location.origin);
  Object.entries(params || {}).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  return `${url.pathname}${url.search}`;
}

/* --- Imagen de respaldo ---------------------------------------------------- */

export function placeholderImage(label = "DM") {
  const initialsText = initials(label);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 300" role="img" aria-label="Imagen no disponible">
    <rect width="400" height="300" fill="#E4E1DC"/>
    <text x="200" y="158" text-anchor="middle" font-family="Georgia, serif" font-size="44" fill="#8B98A5">${escapeHtml(initialsText)}</text>
  </svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}
