-- Restaura el logo del cliente servido desde src/img (montado en /brand).
UPDATE settings
SET value = jsonb_set(value, '{brand,logo_url}', to_jsonb('/brand/logodm.jpeg'::text)), updated_at = now()
WHERE key = 'site' AND value #>> '{brand,logo_url}' = '/img/logo.svg';