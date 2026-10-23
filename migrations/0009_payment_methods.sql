ALTER TABLE products ADD COLUMN payment_rule text NOT NULL DEFAULT 'none' CHECK (payment_rule IN ('none','mp_surcharge','cash_discount'));
ALTER TABLE products ADD COLUMN payment_percent integer NOT NULL DEFAULT 12 CHECK (payment_percent BETWEEN 0 AND 100);
ALTER TABLE order_items ADD COLUMN payment_rule text NOT NULL DEFAULT 'none' CHECK (payment_rule IN ('none','mp_surcharge','cash_discount'));
ALTER TABLE order_items ADD COLUMN payment_percent integer NOT NULL DEFAULT 0 CHECK (payment_percent BETWEEN 0 AND 100);
ALTER TABLE order_items ADD COLUMN quoted_amount integer CHECK (quoted_amount >= 0);
ALTER TABLE orders ADD COLUMN payment_adjustment integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN payment_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE orders ADD COLUMN tax_snapshot jsonb;
ALTER TABLE orders ADD COLUMN payment_revision integer NOT NULL DEFAULT 0;
ALTER TABLE orders ADD COLUMN payment_confirmed_by uuid REFERENCES admin_users(id);
ALTER TABLE orders ADD COLUMN payment_reference text;

-- Preserva el importe de cotizaciones históricas. Antes de esta versión no
-- tenían reglas por producto: distribuimos el importe sin modificar su total.
WITH allocations AS (
  SELECT i.id, o.quoted_total,
    count(*) OVER (PARTITION BY i.order_id)::integer AS n,
    row_number() OVER (PARTITION BY i.order_id ORDER BY i.id)::integer AS position
  FROM order_items i JOIN orders o ON o.id = i.order_id
  WHERE i.is_quote AND o.quoted_total IS NOT NULL AND o.status <> 'quote'
)
UPDATE order_items i SET quoted_amount = a.quoted_total / a.n + CASE WHEN a.position <= a.quoted_total % a.n THEN 1 ELSE 0 END
FROM allocations a WHERE i.id = a.id;
UPDATE orders SET tax_snapshot = jsonb_build_object('include_tax', tax = 0,
  'rate', CASE WHEN subtotal - discount + COALESCE(quoted_total,0) > 0
  THEN tax::numeric * 100 / (subtotal - discount + COALESCE(quoted_total,0)) ELSE 0 END);
