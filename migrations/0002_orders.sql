-- ===========================================================================
-- 0002_orders.sql — Órdenes, ítems, cupones, consultas y bitácora de correos
-- ===========================================================================

CREATE TABLE IF NOT EXISTS orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN (
    'quote', 'pending_payment', 'paid', 'in_production', 'ready', 'delivered',
    'cancelled', 'refunded', 'failed', 'review'
  )),
  customer_name text NOT NULL,
  customer_email text NOT NULL,
  customer_phone text,
  customer_tax_id text,
  delivery_method text NOT NULL DEFAULT 'shipping' CHECK (delivery_method IN ('shipping', 'pickup')),
  shipping_address text,
  shipping_city text,
  shipping_department text,
  notes text,
  internal_notes text,
  subtotal integer NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  discount integer NOT NULL DEFAULT 0 CHECK (discount >= 0),
  shipping_cost integer NOT NULL DEFAULT 0 CHECK (shipping_cost >= 0),
  tax integer NOT NULL DEFAULT 0 CHECK (tax >= 0),
  total integer NOT NULL DEFAULT 0 CHECK (total >= 0),
  currency text NOT NULL DEFAULT 'UYU',
  coupon_code text,
  mp_preference_id text UNIQUE,
  mp_payment_id text UNIQUE,
  payment_provider text NOT NULL DEFAULT 'mercadopago',
  payment_status text,
  estimated_delivery text,
  admin_notified_at timestamptz,
  customer_notified_at timestamptz,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS orders_status_created_idx ON orders (status, created_at DESC);
CREATE INDEX IF NOT EXISTS orders_created_idx ON orders (created_at DESC);
CREATE INDEX IF NOT EXISTS orders_email_idx ON orders (lower(customer_email));
CREATE INDEX IF NOT EXISTS orders_mp_pref_idx ON orders (mp_preference_id);

CREATE TABLE IF NOT EXISTS order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  product_id uuid REFERENCES products (id) ON DELETE SET NULL,
  product_name text NOT NULL,
  product_slug text,
  unit_price integer NOT NULL CHECK (unit_price >= 0),
  quantity integer NOT NULL CHECK (quantity > 0),
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  customization text,
  image_url text,
  line_total integer NOT NULL CHECK (line_total >= 0)
);

CREATE INDEX IF NOT EXISTS order_items_order_idx ON order_items (order_id);

CREATE TABLE IF NOT EXISTS coupons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  description text,
  discount_type text NOT NULL CHECK (discount_type IN ('percent', 'fixed')),
  discount_value integer NOT NULL CHECK (discount_value > 0),
  min_subtotal integer NOT NULL DEFAULT 0 CHECK (min_subtotal >= 0),
  max_uses integer CHECK (max_uses IS NULL OR max_uses > 0),
  used_count integer NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  valid_from timestamptz,
  valid_until timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  email text NOT NULL,
  phone text,
  subject text,
  message text NOT NULL,
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'read', 'answered', 'archived')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS inquiries_status_created_idx ON inquiries (status, created_at DESC);

CREATE TABLE IF NOT EXISTS email_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  to_email text NOT NULL,
  subject text NOT NULL,
  template text NOT NULL,
  order_id uuid REFERENCES orders (id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS email_log_created_idx ON email_log (created_at DESC);
