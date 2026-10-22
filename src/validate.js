/**
 * Validación y normalización de entradas.
 *
 * Regla del proyecto: todo lo que viene del navegador se valida y se acota acá.
 * Los precios nunca se aceptan desde el cliente: se leen de la base.
 */

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i;
const PHONE_PATTERN = /^[0-9+()\s.-]{6,25}$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class ValidationError extends Error {
  constructor(message, field) {
    super(message);
    this.name = "ValidationError";
    this.field = field;
    this.status = 400;
  }
}

/** Texto simple: recorta, colapsa espacios y corta a un largo máximo. */
export function cleanText(value, { max = 500, min = 0, field, label } = {}) {
  if (value === null || value === undefined) {
    if (min > 0) throw new ValidationError(`Falta ${label || field}.`, field);
    return "";
  }
  if (typeof value !== "string") {
    throw new ValidationError(`Valor inválido en ${label || field}.`, field);
  }
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (cleaned.length < min) {
    throw new ValidationError(`${label || field} es obligatorio.`, field);
  }
  if (cleaned.length > max) {
    throw new ValidationError(`${label || field} supera los ${max} caracteres.`, field);
  }
  return cleaned;
}

/** Texto multilínea: conserva los saltos de línea, quita espacios sobrantes. */
export function cleanMultiline(value, { max = 4000, field, label } = {}) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "string") {
    throw new ValidationError(`Valor inválido en ${label || field}.`, field);
  }
  const cleaned = value
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (cleaned.length > max) {
    throw new ValidationError(`${label || field} supera los ${max} caracteres.`, field);
  }
  return cleaned;
}

export function cleanEmail(value, { field = "email", label = "el correo" } = {}) {
  const email = cleanText(value, { max: 254, field, label }).toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw new ValidationError(`${label[0].toUpperCase()}${label.slice(1)} no es válido.`, field);
  }
  return email;
}

export function cleanPhone(value, { field = "phone", label = "el teléfono" } = {}) {
  const phone = cleanText(value, { max: 25, field, label });
  if (!phone) return "";
  if (!PHONE_PATTERN.test(phone)) {
    throw new ValidationError(`${label[0].toUpperCase()}${label.slice(1)} no es válido.`, field);
  }
  return phone;
}

export function cleanSlug(value, { field = "slug", label = "el identificador" } = {}) {
  const slug = cleanText(value, { max: 120, field, label })
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!slug) throw new ValidationError(`${label} no puede quedar vacío.`, field);
  if (!SLUG_PATTERN.test(slug)) {
    throw new ValidationError(`${label} solo admite letras, números y guiones.`, field);
  }
  return slug;
}

export function cleanInteger(value, { min = 0, max = 10_000_000, field, label } = {}) {
  const number = typeof value === "number" ? value : Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(number) || !Number.isInteger(number)) {
    throw new ValidationError(`${label || field} debe ser un número entero.`, field);
  }
  if (number < min || number > max) {
    throw new ValidationError(`${label || field} debe estar entre ${min} y ${max}.`, field);
  }
  return number;
}

export function cleanBoolean(value, fallback = false) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  return fallback;
}

export function oneOf(value, allowed, { field, label } = {}) {
  if (!allowed.includes(value)) {
    throw new ValidationError(`${label || field} no es una opción válida.`, field);
  }
  return value;
}

/**
 * Código de orden legible por el cliente, sin caracteres ambiguos (0/O, 1/I).
 * Formato: DMR-XXXXXX
 */
export function generateOrderCode() {
  let code = "";
  const bytes = new Uint8Array(6);
  globalThis.crypto.getRandomValues(bytes);
  for (const byte of bytes) {
    code += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return `DMR-${code}`;
}

/** Normaliza un código de orden que el cliente escribe a mano. */
export function normalizeOrderCode(value) {
  return cleanText(value, { max: 20, field: "code", label: "el código" })
    .toUpperCase()
    .replace(/[^A-Z0-9-]/g, "")
    .replace(/^DMR-?/, "DMR-");
}

/** Devuelve solo las direcciones http(s) permitidas para imágenes externas. */
export function cleanImageUrl(value, { field = "image", label = "la imagen" } = {}) {
  const raw = cleanText(value, { max: 1000, field, label });
  if (!raw) return "";
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new ValidationError(`${label} no tiene una dirección válida.`, field);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ValidationError(`${label} debe usar una dirección web.`, field);
  }
  return url.toString();
}

/** Limita y depura el arreglo de imágenes de un producto. */
export function cleanImages(value, { max = 8 } = {}) {
  if (!Array.isArray(value)) return [];
  const result = [];
  for (const entry of value) {
    if (result.length >= max) break;
    const source = typeof entry === "string" ? { url: entry } : entry || {};
    const raw = cleanText(source.url, { max: 1000, field: "image", label: "la imagen" });
    if (!raw) continue;
    let url;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      continue;
    }
    result.push({
      url: url.toString(),
      alt: cleanText(source.alt, { max: 160 }),
    });
  }
  return result;
}

/**
 * Valida las opciones de personalización de un producto.
 * Formato por opción: { id, label, type, required, options, price_delta, max_length, ... }
 */
export function cleanProductOptions(value, { max = 10 } = {}) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  return value.slice(0, max).map((entry) => {
    const option = entry || {};
    const id = cleanText(option.id, { max: 40, field: "optionId", label: "el identificador de la opción" })
      .toLowerCase()
      .replace(/[^a-z0-9_]+/g, "_");
    if (!id) throw new ValidationError("Cada opción necesita un identificador.", "options");
    if (seen.has(id)) throw new ValidationError(`La opción "${id}" está repetida.`, "options");
    seen.add(id);

    const type = oneOf(option.type, ["text", "textarea", "number", "select", "checkbox"], {
      field: "options",
      label: "el tipo de opción",
    });

    const base = {
      id,
      label: cleanText(option.label, { max: 80, min: 1, field: "options", label: "el nombre de la opción" }),
      type,
      required: cleanBoolean(option.required, false),
      help: cleanText(option.help, { max: 200 }),
      price_delta: cleanInteger(option.price_delta ?? 0, { min: -100_000, max: 100_000, field: "options", label: "el recargo" }),
    };

    if (type === "select") {
      const choices = Array.isArray(option.options) ? option.options : [];
      if (!choices.length) {
        throw new ValidationError(`La opción "${base.label}" necesita al menos un valor.`, "options");
      }
      base.options = choices.slice(0, 30).map((choice) => {
        const item = typeof choice === "string" ? { value: choice } : choice || {};
        return {
          value: cleanText(item.value, { max: 60, min: 1, field: "options", label: "un valor de opción" }),
          label: cleanText(item.label ?? item.value, { max: 60, min: 1, field: "options", label: "una etiqueta de opción" }),
          price_delta: cleanInteger(item.price_delta ?? 0, { min: -100_000, max: 100_000, field: "options", label: "el recargo" }),
        };
      });
    }

    if (type === "number") {
      base.min = cleanInteger(option.min ?? 1, { min: 0, max: 100_000, field: "options", label: "el mínimo" });
      base.max = cleanInteger(option.max ?? 9999, { min: 1, max: 100_000, field: "options", label: "el máximo" });
    }

    if (type === "text" || type === "textarea") {
      base.max_length = cleanInteger(option.max_length ?? (type === "textarea" ? 500 : 120), {
        min: 1,
        max: 4000,
        field: "options",
        label: "la longitud máxima",
      });
    }

    return base;
  });
}
