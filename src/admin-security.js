import { verifySecondFactor } from "./admin-mfa.js";
import { createHash } from "node:crypto";
import { pool } from "./db.js";
import { verifyPassword, audit } from "./auth.js";

// Persistente y compartido entre instancias. No almacena contraseñas ni correos.
export async function consumeLoginLimit(scope, value, limit = 12) {
  const bucket = `${scope}:${createHash("sha256").update(String(value)).digest("hex")}`;
  const result = await pool.query(`INSERT INTO admin_login_limits(bucket, attempts, expires_at)
    VALUES ($1, 1, NOW() + INTERVAL '15 minutes') ON CONFLICT (bucket) DO UPDATE
    SET attempts = CASE WHEN admin_login_limits.expires_at <= NOW() THEN 1 ELSE admin_login_limits.attempts + 1 END,
        expires_at = CASE WHEN admin_login_limits.expires_at <= NOW() THEN NOW() + INTERVAL '15 minutes' ELSE admin_login_limits.expires_at END
    RETURNING attempts`, [bucket]);
  // El índice permite limpiar contadores caducados sin acumular datos indefinidamente.
  await pool.query("DELETE FROM admin_login_limits WHERE expires_at < NOW() - INTERVAL '1 day'");
  return result.rows[0].attempts <= limit;
}
export async function persistentLoginLimit(req, res, next) {
  if (!await consumeLoginLimit("ip", req.ip, 20)) {
    res.set("Retry-After", "900");
    return res.status(429).json({ error: "Demasiados intentos. Esperá 15 minutos antes de intentar de nuevo." });
  }
  return next();
}
export function requireOwner(req, res, next) {
  if (req.admin.role !== "owner") return res.status(403).json({ error: "Esta operación requiere un administrador con acceso completo." });
  return next();
}
export function requireRecentAuth(req, res, next) {
  const at = new Date(req.adminSession.reauthenticatedAt || 0).getTime();
  if (!Number.isFinite(at) || Date.now() - at > 5 * 60_000) {
    return res.status(403).json({ code: "reauth_required", error: "Confirmá tu contraseña para autorizar esta operación sensible." });
  }
  return next();
}
export async function reauthenticate(req, res) {
  if (!await consumeLoginLimit("reauth", req.admin.id, 8)) return res.status(429).json({ error: "Esperá 15 minutos antes de volver a confirmar tu contraseña." });
  const password = req.body?.password;
  const admin = (await pool.query("SELECT password_hash FROM admin_users WHERE id = $1 AND active", [req.admin.id])).rows[0];
  if (typeof password !== "string" || password.length > 1024 || !admin || !await verifyPassword(password, admin.password_hash) || !await verifySecondFactor(req.admin.id, req.body?.code)) {
    await audit(req.admin.id, "reauth_failed", "admin", req.admin.id);
    return res.status(403).json({ error: "Contraseña incorrecta." });
  }
  await pool.query("UPDATE admin_sessions SET reauthenticated_at = NOW() WHERE id = $1", [req.adminSession.sessionId]);
  await audit(req.admin.id, "reauth", "admin", req.admin.id);
  return res.json({ ok: true });
}
