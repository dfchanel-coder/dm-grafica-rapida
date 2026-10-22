-- ===========================================================================
-- 0003_pricing_modes.sql — Precios fijos y productos "a cotizar"
--
-- Rivera no publica precios: casi todo se cotiza por WhatsApp. Por eso el
-- catálogo admite dos modos:
--   fixed  → precio base en el producto, se compra directo.
--   quote  → sin precio; el cliente deja la consulta y el admin la cotiza.
-- ===========================================================================

ALTER TABLE products ADD COLUMN IF NOT EXISTS pricing_mode text NOT NULL DEFAULT 'fixed';
ALTER TABLE products ADD COLUMN IF NOT EXISTS requires_quote boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'products_pricing_mode_check'
  ) THEN
    ALTER TABLE products ADD CONSTRAINT products_pricing_mode_check
      CHECK (pricing_mode IN ('fixed', 'quote'));
  END IF;
END
$$;

-- ===========================================================================
-- Categorías iniciales — productos verificados de DM Gráfica Rápida (Rivera).
-- El administrador las renombra, reordena o desactiva desde el panel.
-- ===========================================================================

INSERT INTO categories (slug, name, description, sort_order) VALUES
  ('stickers-etiquetas', 'Stickers y etiquetas', 'Troquelados, en papel fotográfico y resistentes al agua.', 10),
  ('sellos', 'Sellos', 'Sellos mecánicos personalizados para tu negocio.', 20),
  ('vinilos', 'Vinilos adhesivos', 'Vinilos para packaging, vidrieras y decoración.', 30),
  ('vasos', 'Vasos y packaging', 'Vasos eco y envoltorios personalizados.', 40),
  ('papeleria-corporativa', 'Papelería corporativa', 'Folletería, cartelería y papelería de empresa.', 50),
  ('merchandising', 'Merchandising y uniformes', 'Equipamiento con tu marca, para tu equipo o tu evento.', 60),
  ('banderas', 'Banderas y señalética', 'Banderas de vela y señalética para negocios.', 70),
  ('grabado', 'Grabado y productos', 'Grabado láser sobre termos y otros productos.', 80),
  ('identidad-marca', 'Identidad de marca', 'Packaging, identidad visual y proyectos a medida.', 90)
ON CONFLICT (slug) DO NOTHING;

-- ===========================================================================
-- Productos iniciales.
--
-- IMPORTANTE: price = 0 y active = false a propósito. Rivera no publica
-- precios y este catálogo no publica nada hasta que el administrador
-- cargue los importes reales y active cada producto desde el panel.
-- Los nombres y tipos de producto sí están verificados con el negocio.
-- ===========================================================================

INSERT INTO products (
  slug, name, short_description, description, category_id, price,
  pricing_mode, active, featured, sort_order, min_quantity, lead_time_days,
  options, personalization_enabled, personalization_prompt
) VALUES
  ('stickers-troquelados-personalizados',
   'Stickers troquelados personalizados',
   'Tu diseño recortado a la forma, resistente al agua.',
   'Stickers troquelados con la forma de tu diseño. Ideales para packaging, potes, cajas y vidrieras. Resistentes al agua y fáciles de aplicar. Indicá la forma, el tamaño y los colores.',
   (SELECT id FROM categories WHERE slug = 'stickers-etiquetas'),
   0, 'fixed', false, true, 10, 1, 3,
   '[{"id":"medida","label":"Medida","type":"select","required":true,"options":[{"value":"5x5","label":"5 x 5 cm","price_delta":0},{"value":"8x8","label":"8 x 8 cm","price_delta":0},{"value":"10x10","label":"10 x 10 cm","price_delta":0}]}]'::jsonb,
   false, NULL),

  ('stickers-papel-fotografico',
   'Stickers en papel fotográfico',
   'Calidad fotográfica para etiquetas y packaging.',
   'Impresión en papel fotográfico para stickers de labeling, vitrines y packaging. Se entregan con corte recto o troquelado. Indicá el ancho y la cantidad.',
   (SELECT id FROM categories WHERE slug = 'stickers-etiquetas'),
   0, 'fixed', false, false, 20, 1, 4,
   '[]'::jsonb,
   false, NULL),

  ('sellos-mecanicos-personalizados',
   'Sellos mecánicos personalizados',
   'Tu logo, con la tinta que elijas.',
   'Sellos mecánicos con tu logo o diseño. Ideales para marcar cajas, bolsas y documentación de forma rápida. Hay modelos automáticos y de tinta. Indicá el modelo y la cantidad.',
   (SELECT id FROM categories WHERE slug = 'sellos'),
   0, 'fixed', false, true, 10, 1, 3,
   '[]'::jsonb,
   false, NULL),

  ('viniles-adhesivos-personalizados',
   'Vinilos adhesivos personalizados',
   'Recortados a medida para vidrieras y decoración.',
   'Vinilos adhesivos para vidrieras, packaging, paredes y decoración. Se entregan recortados al diseño o en bobina. Indicá la superficie y la medida.',
   (SELECT id FROM categories WHERE slug = 'vinilos'),
   0, 'quote', false, false, 10, 1, 5,
   '[]'::jsonb,
   true, 'Contanos la superficie donde se va a aplicar y las medidas aproximadas.'),

  ('vasos-eco-personalizados',
   'Vasos eco personalizados',
   'Materiales clásicos y ecológicos, con tu diseño.',
   'Vasos personalizados para eventos y negocios, en materiales ecológicos y clásicos. Ideales para reutilizar y dejar marca. Indicá el modelo y la cantidad.',
   (SELECT id FROM categories WHERE slug = 'vasos'),
   0, 'fixed', false, true, 10, 12, 7,
   '[]'::jsonb,
   false, NULL),

  ('folleteria-carteleria',
   'Folletería y cartelería',
   'Piezas de papelería para tu negocio o evento.',
   'Folletería, cartelería y piezas de papelería para promociones, eventos y negocios. Se diseña a medida con tu identidad. Contanos qué necesitás y te lo cotizamos.',
   (SELECT id FROM categories WHERE slug = 'papeleria-corporativa'),
   0, 'quote', false, false, 10, 1, 7,
   '[]'::jsonb,
   true, 'Contanos qué piezas necesitás, para qué evento o uso y con qué cantidad.'),

  ('papeleria-corporativa',
   'Papelería corporativa',
   'Tarjetas, membretadas y carpetas con tu marca.',
   'Papelería corporativa con tu identidad: tarjetas de presentación, hojas membretadas, sobres, carpetas y sellos. Armá el set que necesita tu empresa. Contanos qué piezas necesitás.',
   (SELECT id FROM categories WHERE slug = 'papeleria-corporativa'),
   0, 'quote', false, false, 20, 1, 10,
   '[]'::jsonb,
   true, 'Indicá qué piezas forman parte del set y si ya tenés diseño o querés que lo armemos.'),

  ('merchandising-uniformes',
   'Merchandising y uniformes',
   'Equipamiento con tu marca, para tu equipo o tu evento.',
   'Merchandising y uniformes personalizados: camisetas, remeras, hoodies, delantales y ropa de equipo. Necesitamos tu diseño o lo creamos juntos. Contanos el tipo de prenda y la cantidad.',
   (SELECT id FROM categories WHERE slug = 'merchandising'),
   0, 'quote', false, true, 10, 10, 15,
   '[]'::jsonb,
   true, 'Indicá qué prendas necesitás, la cantidad y si tenés diseño cargado.'),

  ('banderas-vela',
   'Banderas de vela full color',
   'Impresión full color, resistentes al viento.',
   'Banderas de vela con impresión full color, resistentes al viento. Ideales para el frente de casa, la entrada de un evento o el local de tu negocio. Contanos la cantidad y los colores.',
   (SELECT id FROM categories WHERE slug = 'banderas'),
   0, 'quote', false, false, 10, 1, 7,
   '[]'::jsonb,
   true, 'Contanos la cantidad de banderas y los colores o el diseño que querés usar.'),

  ('termos-grabado-laser',
   'Termos con grabado láser',
   'Tu marca, grabada en el metal o en la madera.',
   'Termos y otros productos con grabado láser para tu negocio, tu equipo o un regalo con mensaje. Indicá el modelo y la cantidad.',
   (SELECT id FROM categories WHERE slug = 'grabado'),
   0, 'quote', false, false, 10, 6, 10,
   '[]'::jsonb,
   true, 'Contanos el material, el modelo y el texto o logo que querés grabar.'),

  ('identidad-marca-packaging',
   'Identidad de marca y packaging',
   'Si tenés una idea dando vueltas, la hacemos posible.',
   'Identidad de marca, packaging y proyectos de merchandising a medida. Contanos la idea y te armamos una propuesta con los pasos y los tiempos.',
   (SELECT id FROM categories WHERE slug = 'identidad-marca'),
   0, 'quote', false, true, 10, 1, 20,
   '[]'::jsonb,
   true, 'Contanos la idea, para qué es, para cuándo lo necesitás y qué piezas tenés en mente.')
ON CONFLICT (slug) DO NOTHING;
