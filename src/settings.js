import { ValidationError, cleanText, cleanMultiline } from "./validate.js";
import { pool } from "./db.js";

/**
 * Ajustes del sitio. Un único documento JSON bajo la clave "site".
 * El administrador los edita desde el panel y se aplican en caliente.
 *
 * Los valores por defecto ya cargan los datos verificados de DM Comunicación
 * Visual (Rivera). Lo que no está verificado queda vacío a propósito:
 * no se inventa información comercial.
 */
export const DEFAULT_SETTINGS = {
  business: {
    name: "DM Comunicación Visual",
    tagline: "Hacemos que te vean.",
    legal_name: "",
    tax_id: "",
    whatsapp: "59895010244",
    email: "",
    phone: "095 010 244",
    address: "Artigas 1636, Piso 1",
    city: "Rivera",
    department: "Rivera",
    postal_code: "40000",
    country: "Uruguay",
    instagram: "https://www.instagram.com/dmcomunicacionvisual.uy/",
    facebook: "https://www.facebook.com/DMimpresos/",
    hours: "",
  },
  brand: {
    primary: "#0B3D91",
    accent: "#F97316",
    ink: "#0B0F14",
    logo_url: "/img/logo.svg",
    favicon_url: "",
  },
  home: {
    announcement: "",
    hero_title: "Hacemos que te vean.",
    hero_subtitle:
      "Tu identidad, en cada detalle.",
    hero_cta: "Explorar productos",
    hero_cta_link: "/catalogo",
    hero_image: "",
    about_title: "Tu identidad, en cada detalle.",
    about_text:
      "En DM Comunicación Visual hacemos que tu marca se vea. Trabajamos con materiales clásicos y ecológicos, diseños propios y entregas para todo el país.",
    how_title: "Cómo trabajamos",
    how_steps: [
      { title: "Elegís el producto", text: "Revisá el catálogo y pedí la cotización de lo que necesitás." },
      { title: "Lo personalizamos", text: "Pasás tu diseño o lo armamos juntos. Confirmamos todo antes de imprimir." },
      { title: "Lo recibís", text: "Envío a todo Uruguay o retiralo en Rivera." },
    ],
    show_how: true,
    show_quote_cta: true,
  },
  checkout: {
    shipping_cost: 0,
    free_shipping_threshold: 0,
    allow_pickup: true,
    pickup_note: "Retiro sin costo en Rivera, Artigas 1636 Piso 1.",
    min_order: 0,
    max_qty_per_item: 1000,
  },
  payments: {
    mercadopago_enabled: true,
    transfer: { enabled: false, bank: "", holder: "", account: "", currency: "UYU", instructions: "" },
    cash: { enabled: false, instructions: "" },
  },
  tax: {
    include_tax: true,
    rate: 22,
    label: "IVA incluido",
  },
  notifications: {
    admin_email: "",
    notify_on_paid: true,
    notify_on_inquiry: true,
    notify_customer: true,
  },
  footer: {
    note: "",
    copyright_name: "DM Comunicación Visual",
  },
};

const CACHE_TTL_MS = 30_000;
let cache = null;
let cacheExpiresAt = 0;

function deepMerge(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return patch ?? base;
  const result = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    const current = base?.[key];
    if (value && typeof value === "object" && !Array.isArray(value) && current && typeof current === "object" && !Array.isArray(current)) {
      result[key] = deepMerge(current, value);
    } else if (value !== undefined) {
      result[key] = value;
    }
  }
  return result;
}

export async function getSettings({ fresh = false } = {}) {
  if (!fresh && cache && Date.now() < cacheExpiresAt) return cache;
  const result = await pool.query("SELECT value FROM settings WHERE key = 'site'");
  const stored = result.rows[0]?.value;
  cache = deepMerge(structuredClone(DEFAULT_SETTINGS), stored || {});
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return cache;
}

export async function updateSettings(patch) {
  const current = await getSettings({ fresh: true });
  const merged = deepMerge(current, patch || {});
  const payments = merged.payments;
  if (!payments || !payments.transfer || !payments.cash) throw new ValidationError("Configuración de pagos inválida.");
  if (typeof payments.mercadopago_enabled !== "boolean" || typeof payments.transfer.enabled !== "boolean" || typeof payments.cash.enabled !== "boolean") throw new ValidationError("Indicá si cada medio de pago está habilitado.");
  for (const key of ["bank", "holder", "account"]) payments.transfer[key] = cleanText(payments.transfer[key], { max: 160, min: payments.transfer.enabled ? 1 : 0, label: key });
  if (payments.transfer.currency !== "UYU") throw new ValidationError("La cuenta para transferencias debe recibir pesos uruguayos (UYU).");
  for (const method of ["transfer", "cash"]) payments[method].instructions = cleanMultiline(payments[method].instructions, { max: 1500 });
  if (payments.cash.enabled && !payments.cash.instructions) throw new ValidationError("Indicá dónde y cuándo se paga en efectivo.");
  for (const key of ["legal_name", "tax_id"]) merged.business[key] = cleanText(merged.business[key], { max: 160 });
  await pool.query(
    `INSERT INTO settings (key, value, updated_at)
     VALUES ('site', $1, NOW())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
    [JSON.stringify(merged)],
  );
  cache = merged;
  cacheExpiresAt = Date.now() + CACHE_TTL_MS;
  return merged;
}

/**
 * Ajustes que el sitio público puede leer.
 * Excluye los datos de notificación: son internos del administrador.
 */
export function toPublicSettings(settings) {
  const { notifications, ...rest } = settings;
  void notifications;
  return {
    business: rest.business,
    brand: rest.brand,
    home: rest.home,
    checkout: rest.checkout,
    tax: rest.tax,
    payments: { mercadopago_enabled: rest.payments.mercadopago_enabled, transfer: { enabled: rest.payments.transfer.enabled }, cash: { enabled: rest.payments.cash.enabled } },
    footer: rest.footer,
  };
}

/** Dirección de correo a la que se avisan las órdenes y consultas. */
export async function getAdminEmail() {
  const settings = await getSettings();
  return (
    settings.notifications?.admin_email
    || process.env.ADMIN_NOTIFICATION_EMAIL
    || ""
  ).trim();
}

export function invalidateSettingsCache() {
  cache = null;
  cacheExpiresAt = 0;
}
