import sharp from "sharp";
import { randomUUID } from "node:crypto";

/**
 * Almacenamiento de imágenes en Supabase Storage.
 *
 * Se usa la API REST directamente: no hace falta el SDK de Supabase y así
 * el proyecto no suma dependencias. La service role key vive solo en el
 * servidor; el navegador nunca la ve.
 */

const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // 4 MB

const ALLOWED_TYPES = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
};

export function storageConfigured() {
  return Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY && process.env.SUPABASE_BUCKET);
}

function config() {
  const url = (process.env.SUPABASE_URL || "").replace(/\/$/, "");
  const bucket = process.env.SUPABASE_BUCKET || "productos";
  return { url, bucket, key: process.env.SUPABASE_SERVICE_ROLE_KEY || "" };
}

function headers(extra = {}) {
  const { key } = config();
  return {
    apikey: key,
    Authorization: `Bearer ${key}`,
    ...extra,
  };
}

/** Construye la URL pública de un objeto del bucket. */
export function publicUrlFor(objectPath) {
  const { url, bucket } = config();
  if (!url || !objectPath) return "";
  return `${url}/storage/v1/object/public/${bucket}/${objectPath}`;
}

/** Convierte una URL pública de Supabase de vuelta a su ruta interna. */
export function objectPathFromUrl(value) {
  const { url, bucket } = config();
  if (!url || !value) return "";
  const prefix = `${url}/storage/v1/object/public/${bucket}/`;
  if (!value.startsWith(prefix)) return "";
  return value.slice(prefix.length);
}

// Decodifica el contenido completo y genera una imagen nueva sin metadatos.
export async function sanitizeImage(buffer, contentType) {
  if (!buffer?.length || buffer.length > MAX_IMAGE_BYTES || !ALLOWED_TYPES[contentType]) {
    throw new Error("Usá una imagen JPG, PNG, WEBP, AVIF o GIF de hasta 4 MB.");
  }
  try {
    const image = sharp(buffer, { failOn: "warning", limitInputPixels: 25_000_000 });
    const metadata = await image.metadata();
    const formats = { jpeg: "image/jpeg", png: "image/png", webp: "image/webp", heif: "image/avif", gif: "image/gif" };
    if (formats[metadata.format] !== contentType || !metadata.width || !metadata.height || (metadata.pages || 1) > 1) throw new Error("format");
    const clean = await image.rotate().resize({ width: 3000, height: 3000, fit: "inside", withoutEnlargement: true }).webp({ quality: 90 }).toBuffer();
    if (clean.length > MAX_IMAGE_BYTES) throw new Error("size");
    return clean;
  } catch {
    throw new Error("La imagen no es válida, supera 25 megapíxeles o es animada. Exportala como JPG, PNG o WEBP estático e intentá de nuevo.");
  }
}

/**
 * Sube una imagen al bucket y devuelve su URL pública.
 * @returns {Promise<{ url: string, path: string }>}
 */
export async function uploadImage({ buffer, filename, contentType }) {
  if (!storageConfigured()) {
    throw new Error("El almacenamiento de imágenes no está configurado (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_BUCKET).");
  }
  if (!buffer?.length) {
    throw new Error("El archivo está vacío.");
  }
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new Error("La imagen supera los 4 MB.");
  }
  const extension = ALLOWED_TYPES[contentType];
  if (!extension) {
    throw new Error("Formato no admitido. Usá JPG, PNG, WEBP, AVIF o GIF.");
  }

  const cleanBuffer = await sanitizeImage(buffer, contentType);
  const { url, bucket } = config();
  const objectPath = `catalogo/${randomUUID()}.webp`;

  const response = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
    method: "POST",
    headers: headers({
      "Content-Type": "image/webp",
      "x-upsert": "false",
      "cache-control": "31536000",
    }),
    body: cleanBuffer,
    signal: AbortSignal.timeout(30_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase rechazó la imagen (HTTP ${response.status}): ${detail.slice(0, 200)}`);
  }

  return { url: publicUrlFor(objectPath), path: objectPath };
}

/** Borra una imagen del bucket. No falla si el objeto ya no existe. */
export async function deleteImage(imageUrl) {
  const objectPath = objectPathFromUrl(imageUrl);
  if (!objectPath || !storageConfigured()) return { deleted: false };

  const { url, bucket } = config();
  const response = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
    method: "DELETE",
    headers: headers(),
    signal: AbortSignal.timeout(15_000),
  });

  return { deleted: response.ok || response.status === 404 };
}
