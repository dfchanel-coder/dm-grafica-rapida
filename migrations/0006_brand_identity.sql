-- Replace only exact former defaults. Preserve all custom administrator content.
UPDATE settings
SET value = jsonb_set(value, '{business,name}', to_jsonb('DM Comunicación Visual'::text)), updated_at = now()
WHERE key = 'site' AND value #>> '{business,name}' = 'DM Gráfica Rápida';

UPDATE settings
SET value = jsonb_set(value, '{business,tagline}', to_jsonb('Hacemos que te vean.'::text)), updated_at = now()
WHERE key = 'site' AND value #>> '{business,tagline}' = 'Gráfica & Merchandising';

UPDATE settings
SET value = jsonb_set(value, '{footer,copyright_name}', to_jsonb('DM Comunicación Visual'::text)), updated_at = now()
WHERE key = 'site' AND value #>> '{footer,copyright_name}' = 'DM Gráfica Rápida';

UPDATE settings
SET value = jsonb_set(value, '{home,hero_title}', to_jsonb('Hacemos que te vean.'::text)), updated_at = now()
WHERE key = 'site' AND value #>> '{home,hero_title}' = 'Tu marca, hecha posible';

UPDATE settings
SET value = jsonb_set(value, '{home,hero_cta}', to_jsonb('Explorar productos'::text)), updated_at = now()
WHERE key = 'site' AND value #>> '{home,hero_cta}' = 'Ver el catálogo';

UPDATE settings
SET value = jsonb_set(value, '{home,about_title}', to_jsonb('Tu identidad, en cada detalle.'::text)), updated_at = now()
WHERE key = 'site' AND value #>> '{home,about_title}' = 'Personalización para negocios';

UPDATE settings
SET value = jsonb_set(value, '{home,about_text}', to_jsonb('En DM Comunicación Visual hacemos que tu marca se vea. Trabajamos con materiales clásicos y ecológicos, diseños propios y entregas para todo el país.'::text)), updated_at = now()
WHERE key = 'site' AND value #>> '{home,about_text}' = 'En DM Gráfica Rápida hacemos que tu marca lo merece, nosotros lo hacemos posible. Trabajamos con materiales clásicos y ecológicos, diseños propios y entregas para todo el país.';

UPDATE settings
SET value = jsonb_set(value, '{home,hero_subtitle}', '"Tu identidad, en cada detalle."'::jsonb), updated_at = now()
WHERE key = 'site' AND value #>> '{home,hero_subtitle}' = 'Personalización para negocios: stickers, sellos, vinilos, vasos, papelería y merchandising. Materiales clásicos y ecológicos, con diseño propio.';
