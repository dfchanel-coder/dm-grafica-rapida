-- ===========================================================================
-- 0004_quote_flow.sql — Pedidos que requieren cotización
--
-- La mayoría del catálogo de Rivera se cotiza a medida. Cuando el cliente
-- suma un producto sin precio fijo, el pedido queda como "cotización":
-- el administrador fija el precio y genera el enlace de pago.
-- ===========================================================================

ALTER TABLE orders ADD COLUMN IF NOT EXISTS requires_quote boolean NOT NULL DEFAULT false;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quoted_total integer;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quote_notes text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS quote_sent_at timestamptz;

ALTER TABLE order_items ADD COLUMN IF NOT EXISTS is_quote boolean NOT NULL DEFAULT false;

ALTER TABLE inquiries ADD COLUMN IF NOT EXISTS order_id uuid REFERENCES orders (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS inquiries_order_idx ON inquiries (order_id);
CREATE INDEX IF NOT EXISTS orders_requires_quote_idx ON orders (requires_quote, created_at DESC);
