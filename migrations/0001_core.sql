-- ===========================================================================
-- 0001_core.sql — Núcleo del catálogo, ajustes y administración
-- ===========================================================================

CREATE TABLE IF NOT EXISTS categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text,
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  short_description text,
  description text,
  category_id uuid REFERENCES categories (id) ON DELETE SET NULL,
  price integer NOT NULL CHECK (price >= 0),
  compare_at_price integer CHECK (compare_at_price IS NULL OR compare_at_price >= price),
  currency text NOT NULL DEFAULT 'UYU',
  images jsonb NOT NULL DEFAULT '[]'::jsonb,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  personalization_enabled boolean NOT NULL DEFAULT false,
  personalization_prompt text,
  min_quantity integer NOT NULL DEFAULT 1 CHECK (min_quantity >= 1),
  manage_stock boolean NOT NULL DEFAULT false,
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  lead_time_days integer NOT NULL DEFAULT 3 CHECK (lead_time_days >= 0),
  featured boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  seo_title text,
  seo_description text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS products_active_sort_idx ON products (active, sort_order, name);
CREATE INDEX IF NOT EXISTS products_category_idx ON products (category_id);
CREATE INDEX IF NOT EXISTS products_featured_idx ON products (featured) WHERE featured;

CREATE TABLE IF NOT EXISTS settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS admin_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text NOT NULL,
  password_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_login_at timestamptz
);

CREATE TABLE IF NOT EXISTS admin_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id uuid NOT NULL REFERENCES admin_users (id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  csrf_token text NOT NULL,
  user_agent text,
  ip text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS admin_sessions_token_idx ON admin_sessions (token_hash);
CREATE INDEX IF NOT EXISTS admin_sessions_admin_idx ON admin_sessions (admin_id);

CREATE TABLE IF NOT EXISTS admin_audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  admin_id uuid REFERENCES admin_users (id) ON DELETE SET NULL,
  action text NOT NULL,
  target_type text NOT NULL,
  target_id text,
  detail jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit_events (created_at DESC);
