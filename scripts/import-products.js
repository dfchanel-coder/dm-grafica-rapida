/**
 * Importa un catálogo en JSON a la base de datos.
 *
 * Uso:
 *   node scripts/import-products.js [ruta/al/catalogo.json]
 *
 * El archivo tiene esta forma:
 * {
 *   "categories": [
 *     { "slug": "stickers-etiquetas", "name": "Stickers y etiquetas",
 *       "description": "…", "sort_order": 10, "active": true }
 *   ],
 *   "products": [
 *     { "slug": "stickers-troquelados", "name": "Stickers troquelados",
 *       "category": "stickers-etiquetas", "price": 0, "currency": "UYU",
 *       "short_description": "…", "description": "…",
 *       "images": [{ "url": "https://…", "alt": "…" }],
 *       "options": [], "min_quantity": 50, "lead_time_days": 3,
 *       "featured": false, "active": false,
 *       "pricing_mode": "quote", "requires_quote": true,
 *       "manage_stock": false, "stock": 0 }
 *   ]
 * }
 *
 * Los productos se crean o se actualizan según su "slug". Los que ya existen
 * conservan su precio y su estado salvo que el archivo los sobrescriba.
 */

import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pool } from "../src/db.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, "..");

const DEFAULT_FILE = path.join(projectRoot, "data", "catalog.json");

async function readCatalog(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch {
    console.error(`No se encontró el archivo: ${filePath}`);
    console.error("");
    console.error("Copiá data/catalog.example.json a data/catalog.json, completalo y volvé a ejecutar.");
    console.error("Los productos se cargan sin publicar: el precio y la publicación los define el panel.");
    process.exitCode = 1;
    return null;
  }

  try {
    const data = JSON.parse(raw);
    if (!Array.isArray(data.products) && !Array.isArray(data.categories)) {
      throw new Error("El archivo debe tener las claves \"categories\" y/o \"products\".");
    }
    return data;
  } catch (error) {
    console.error(`El archivo no es un JSON válido: ${error.message}`);
    process.exitCode = 1;
    return null;
  }
}

async function upsertCategories(categories) {
  const idsBySlug = new Map();
  for (const category of categories) {
    const result = await pool.query(
      `INSERT INTO categories (slug, name, description, image_url, sort_order, active)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (slug) DO UPDATE
          SET name = EXCLUDED.name,
              description = COALESCE(EXCLUDED.description, categories.description),
              image_url = COALESCE(EXCLUDED.image_url, categories.image_url),
              sort_order = EXCLUDED.sort_order,
              active = EXCLUDED.active,
              updated_at = NOW()
       RETURNING id`,
      [
        category.slug,
        category.name,
        category.description ?? null,
        category.image_url ?? null,
        Number(category.sort_order ?? 0),
        category.active !== false,
      ],
    );
    idsBySlug.set(category.slug, result.rows[0].id);
  }
  return idsBySlug;
}

async function upsertProducts(products, categoryIds) {
  let created = 0;
  let updated = 0;

  for (const product of products) {
    const categoryId = product.category ? categoryIds.get(product.category) ?? null : null;
    const pricingMode = product.pricing_mode === "quote" ? "quote" : "fixed";
    const requiresQuote = product.requires_quote ?? pricingMode === "quote";

    const result = await pool.query(
      `INSERT INTO products (
         slug, name, short_description, description, category_id,
         price, compare_at_price, currency, images, options,
         personalization_enabled, personalization_prompt,
         min_quantity, manage_stock, stock, lead_time_days,
         featured, active, sort_order, seo_title, seo_description,
         pricing_mode, requires_quote
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb,
         $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23
       )
       ON CONFLICT (slug) DO UPDATE
          SET name = EXCLUDED.name,
              short_description = EXCLUDED.short_description,
              description = EXCLUDED.description,
              category_id = EXCLUDED.category_id,
              price = EXCLUDED.price,
              compare_at_price = EXCLUDED.compare_at_price,
              currency = EXCLUDED.currency,
              images = EXCLUDED.images,
              options = EXCLUDED.options,
              personalization_enabled = EXCLUDED.personalization_enabled,
              personalization_prompt = EXCLUDED.personalization_prompt,
              min_quantity = EXCLUDED.min_quantity,
              manage_stock = EXCLUDED.manage_stock,
              stock = EXCLUDED.stock,
              lead_time_days = EXCLUDED.lead_time_days,
              featured = EXCLUDED.featured,
              active = EXCLUDED.active,
              sort_order = EXCLUDED.sort_order,
              seo_title = EXCLUDED.seo_title,
              seo_description = EXCLUDED.seo_description,
              pricing_mode = EXCLUDED.pricing_mode,
              requires_quote = EXCLUDED.requires_quote,
              updated_at = NOW()
       RETURNING (xmax = 0) AS es_nuevo`,
      [
        product.slug,
        product.name,
        product.short_description ?? null,
        product.description ?? null,
        categoryId,
        Math.max(0, Number(product.price ?? 0)),
        product.compare_at_price ?? null,
        product.currency ?? "UYU",
        JSON.stringify(product.images ?? []),
        JSON.stringify(product.options ?? []),
        product.personalization_enabled === true,
        product.personalization_prompt ?? null,
        Math.max(1, Number(product.min_quantity ?? 1)),
        product.manage_stock === true,
        Math.max(0, Number(product.stock ?? 0)),
        Math.max(0, Number(product.lead_time_days ?? 3)),
        product.featured === true,
        product.active === true,
        Number(product.sort_order ?? 0),
        product.seo_title ?? null,
        product.seo_description ?? null,
        pricingMode,
        requiresQuote === true,
      ],
    );

    if (result.rows[0].es_nuevo) created += 1;
    else updated += 1;
  }

  return { created, updated };
}

async function main() {
  const filePath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_FILE;
  const catalog = await readCatalog(filePath);
  if (!catalog) return;

  const categories = Array.isArray(catalog.categories) ? catalog.categories : [];
  const products = Array.isArray(catalog.products) ? catalog.products : [];

  const categoryIds = await upsertCategories(categories);
  const result = await upsertProducts(products, categoryIds);

  console.log("");
  console.log("Importación terminada.");
  console.log(`  categorías: ${categories.length}`);
  console.log(`  productos nuevos: ${result.created}`);
  console.log(`  productos actualizados: ${result.updated}`);
  console.log("");
  console.log("Recordá: los productos con precio 0 o inactivos no se publican en el sitio.");
  console.log("Cargá los precios y activalos desde el panel de administración.");
  console.log("");
}

main()
  .catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
