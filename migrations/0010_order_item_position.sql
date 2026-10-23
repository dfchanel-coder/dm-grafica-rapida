-- Mantiene estable el reparto de cupones y el redondeo al recalcular un pedido.
ALTER TABLE order_items ADD COLUMN position integer NOT NULL DEFAULT 0;
WITH positions AS (
  SELECT id, (row_number() OVER (PARTITION BY order_id ORDER BY id) - 1)::integer AS position
  FROM order_items
)
UPDATE order_items i SET position = p.position FROM positions p WHERE i.id = p.id;
