import { promisify } from "node:util";
import crypto from "node:crypto";

import { pool } from "./db.js";

/**
 * Autenticación del panel de administración.
 *
 * El cliente final NO tiene cuenta: compra como invitado. Este módulo
 * existe únicamente para el personal de DM Comunicación Visual.
 *
 * - Contraseñas con scrypt y sal por usuario.
 * - Sesiones en base de datos: se pueden revocar y quedan registradas.
 * - Token CSRF por sesión para las operaciones de escritura.
 */

const SESSION_COOKIE = "dm_admin_session";
const SESSION_TTL_MS = 1000 * 60 * 60 * 12; // 12 horas
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1 };

export function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, 64, SCRYPT_PARAMS);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

const scryptAsync = promisify(crypto.scrypt);
export async function verifyPassword(password, stored) {
  try {
    const [scheme, saltHex, hashHex] = String(stored || "").split("$");
    if (scheme !== "scrypt" || !saltHex || !hashHex) return false;
    const expected = Buffer.from(hashHex, "hex");
    const actual = await scryptAsync(password, Buffer.from(saltHex, "hex"), expected.length, SCRYPT_PARAMS);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function parseCookies(header) {
  const cookies = {};
  if (!header) return cookies;
  for (const part of header.split(";")) {
    const index = part.indexOf("=");
    if (index < 0) continue;
    const key = part.slice(0, index).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(part.slice(index + 1).trim());
    } catch {
      cookies[key] = part.slice(index + 1).trim();
    }
  }
  return cookies;
}

function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createAdminSession(adminId, { userAgent = "", ip = "" } = {}) {
  const token = crypto.randomBytes(32).toString("base64url");
  const tokenHash = hashToken(token);
  const csrfToken = crypto.randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  await pool.query(
    `INSERT INTO admin_sessions
       (admin_id, token_hash, csrf_token, user_agent, ip, expires_at, reauthenticated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
    [adminId, tokenHash, csrfToken, String(userAgent).slice(0, 300), String(ip).slice(0, 80), expiresAt],
  );

  return { token, csrfToken, expiresAt };
}

export function setSessionCookie(res, token, expiresAt) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
  });
}

export async function destroyAdminSession(token) {
  if (!token) return;
  await pool.query("DELETE FROM admin_sessions WHERE token_hash = $1", [hashToken(token)]);
}

export async function destroyAdminSessionsFor(adminId) {
  await pool.query("DELETE FROM admin_sessions WHERE admin_id = $1", [adminId]);
}

/** Lee la sesión del administrador desde la cookie. Devuelve null si no hay. */
export async function readAdminSession(req) {
  const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
  if (!token) return null;

  const result = await pool.query(
    `SELECT s.id AS session_id, s.csrf_token, s.expires_at, s.reauthenticated_at,
            a.id AS admin_id, a.email, a.name, a.active, a.role
       FROM admin_sessions s
       JOIN admin_users a ON a.id = s.admin_id
      WHERE s.token_hash = $1`,
    [hashToken(token)],
  );

  const row = result.rows[0];
  if (!row) return null;
  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await destroyAdminSession(token);
    return null;
  }
  if (!row.active) return null;

  await pool.query("UPDATE admin_sessions SET last_used_at = NOW() WHERE id = $1", [row.session_id]);

  return {
    token,
    sessionId: row.session_id,
    csrfToken: row.csrf_token,
    reauthenticatedAt: row.reauthenticated_at,
    admin: { id: row.admin_id, email: row.email, name: row.name, role: row.role },
  };
}

/** Exige sesión de administrador válida. */
export async function requireAdmin(req, res, next) {
  try {
    const session = await readAdminSession(req);
    if (!session) {
      return res.status(401).json({ error: "Necesitás iniciar sesión en el panel." });
    }
    req.admin = session.admin;
    req.adminSession = session;
    return next();
  } catch (error) {
    console.error("Admin session lookup failed:", error?.name || "Error");
    return res.status(503).json({ error: "No pudimos validar la sesión." });
  }
}

/**
 * Exige el token CSRF de la sesión en las operaciones de escritura.
 * El token viaja en la cabecera X-CSRF-Token.
 */
export function requireCsrf(req, res, next) {
  const received = req.get("x-csrf-token");
  const expected = req.adminSession?.csrfToken;
  if (!received || !expected || received !== expected) {
    return res.status(403).json({ error: "Token de seguridad inválido. Recargá la página." });
  }
  return next();
}

/** Registra una acción del administrador en la bitácora. */
export async function audit(adminId, action, targetType, targetId = null, detail = null) {
  try {
    await pool.query(
      `INSERT INTO admin_audit_events (admin_id, action, target_type, target_id, detail)
       VALUES ($1, $2, $3, $4, $5)`,
      [adminId || null, action, targetType, targetId ? String(targetId) : null, detail ? JSON.stringify(detail) : null],
    );
  } catch (error) {
    // La bitácora nunca debe romper la operación principal.
    console.error("Audit log failed:", error?.name || "Error");
  }
}
