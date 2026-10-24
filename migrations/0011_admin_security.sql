-- Conserva todos los permisos y sesiones de administradores existentes.
ALTER TABLE admin_users ADD COLUMN role text NOT NULL DEFAULT 'owner' CHECK (role IN ('owner','operator'));
ALTER TABLE admin_users ALTER COLUMN role SET DEFAULT 'operator';
ALTER TABLE admin_sessions ADD COLUMN reauthenticated_at timestamptz;
CREATE TABLE admin_login_limits (
  bucket text PRIMARY KEY,
  attempts integer NOT NULL,
  expires_at timestamptz NOT NULL
);
CREATE INDEX admin_login_limits_expiry_idx ON admin_login_limits(expires_at);
-- Cubre también cambios hechos con el script de recuperación o SQL.
CREATE FUNCTION revoke_changed_admin_sessions() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.password_hash IS DISTINCT FROM OLD.password_hash
     OR NEW.active IS DISTINCT FROM OLD.active OR NEW.role IS DISTINCT FROM OLD.role THEN
    DELETE FROM admin_sessions WHERE admin_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER admin_credentials_changed AFTER UPDATE ON admin_users
FOR EACH ROW EXECUTE FUNCTION revoke_changed_admin_sessions();
CREATE FUNCTION protect_last_admin_owner() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.active AND OLD.role = 'owner' AND (NOT NEW.active OR NEW.role <> 'owner') THEN
    PERFORM pg_advisory_xact_lock(7382941);
    IF NOT EXISTS (SELECT 1 FROM admin_users WHERE active AND role = 'owner' AND id <> OLD.id) THEN
      RAISE EXCEPTION 'Debe permanecer al menos un administrador con acceso completo.' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER keep_admin_owner BEFORE UPDATE ON admin_users
FOR EACH ROW EXECUTE FUNCTION protect_last_admin_owner();

ALTER TABLE admin_users ADD COLUMN mfa_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE admin_users ADD COLUMN mfa_secret text;
ALTER TABLE admin_users ADD COLUMN mfa_recovery text[] NOT NULL DEFAULT '{}';
ALTER TABLE admin_users ADD COLUMN mfa_last_counter bigint NOT NULL DEFAULT -1;
ALTER TABLE admin_sessions ADD COLUMN mfa_pending text;
ALTER TABLE admin_sessions ADD COLUMN mfa_pending_until timestamptz;
