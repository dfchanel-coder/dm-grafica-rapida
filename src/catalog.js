import { pool } from "./db.js";

/**
 * Lectura pública del catálogo. Solo devuelve productos activos.
 */

const PRODUCT_FIELDS = `
  p.id, p.slug, p.name, p.short_description, p.description, p.category_id,
  p.price, p.compare_at_price, p.currency, p.images, p.options,
  p.personalization_enabled, p.personalization_prompt,
  p.min_quantity, p.manage_stock, p.stock, p.lead_time_days,
  p.featured, p.sort_order, p.pricing_mode, p.requires_quote,
  c.slug AS category_slug, c.name AS category_name,
  parent.slug AS parent_category_slug, parent.name AS parent_category_name
`;
const VISIBLE_PRODUCT = "p.active AND (c.id IS NULL OR c.active) AND (parent.id IS NULL OR parent.active)";

export async function listCategories({ includeEmpty = false } = {}) {
  const result = await pool.query(
    `SELECT c.id, c.slug, c.name, c.description, c.image_url, c.sort_order,
            c.parent_id, parent.slug AS parent_slug,
            (SELECT COUNT(*)::int FROM products p WHERE p.active AND
               (p.category_id = c.id OR p.category_id IN
                  (SELECT id FROM categories WHERE parent_id = c.id AND active))) AS product_count
       FROM categories c
       LEFT JOIN categories parent ON parent.id = c.parent_id
      WHERE c.active AND (parent.id IS NULL OR parent.active)
      ORDER BY c.sort_order, c.name`,
  );
  const categories = result.rows;
  if (includeEmpty) return categories;
  return categories.filter((category) => category.product_count > 0);
}

export async function listProducts({ includeInactive = false } = {}) {
  const result = await pool.query(
    `SELECT ${PRODUCT_FIELDS}
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN categories parent ON parent.id = c.parent_id
      ${includeInactive ? "" : `WHERE ${VISIBLE_PRODUCT}`}
      ORDER BY p.sort_order, p.name`,
  );
  return result.rows;
}

export async function getProductBySlug(slug, { includeInactive = false } = {}) {
  const result = await pool.query(
    `SELECT ${PRODUCT_FIELDS}
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN categories parent ON parent.id = c.parent_id
      WHERE p.slug = $1 ${includeInactive ? "" : `AND ${VISIBLE_PRODUCT}`}`,
    [slug],
  );
  return result.rows[0] || null;
}

export async function getProductsByIds(ids) {
  if (!ids.length) return [];
  const result = await pool.query(
    `SELECT ${PRODUCT_FIELDS}
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN categories parent ON parent.id = c.parent_id
      WHERE p.id = ANY($1::uuid[]) AND ${VISIBLE_PRODUCT}`,
    [ids],
  );
  return result.rows;
}

/** Datos para las páginas públicas de producto y categoría (SEO). */
export async function getSeoProduct(slug) {
  const result = await pool.query(
    `SELECT p.slug, p.name, p.short_description, p.description, p.price, p.currency,
            p.images, (${VISIBLE_PRODUCT}) AS active, p.pricing_mode, p.requires_quote,
            c.name AS category_name, c.slug AS category_slug
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
       LEFT JOIN categories parent ON parent.id = c.parent_id
      WHERE p.slug = $1`,
    [slug],
  );
  return result.rows[0] || null;
}

export async function getSeoCategory(slug) {
  const result = await pool.query(
    `SELECT c.slug, c.name, c.description, c.image_url, c.parent_id, parent.slug AS parent_slug,
            (c.active AND (parent.id IS NULL OR parent.active)) AS active
       FROM categories c LEFT JOIN categories parent ON parent.id = c.parent_id WHERE c.slug = $1`,
    [slug],
  );
  return result.rows[0] || null;
}
