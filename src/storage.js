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

function safeFilename(originalName = "imagen") {
  const extension = String(originalName).split(".").pop().toLowerCase().replace(/[^a-z0-9]/g, "");
  const base = String(originalName)
    .replace(/\.[^.]+$/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "imagen";
  return `${base}.${extension || "jpg"}`;
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

  const { url, bucket } = config();
  const objectPath = `catalogo/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeFilename(filename)}.${extension}`;

  const response = await fetch(`${url}/storage/v1/object/${bucket}/${objectPath}`, {
    method: "POST",
    headers: headers({
      "Content-Type": contentType,
      "x-upsert": "false",
      "cache-control": "31536000",
    }),
    body: buffer,
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
