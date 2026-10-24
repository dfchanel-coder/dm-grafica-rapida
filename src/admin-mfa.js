import { securityAlert } from "./security-alerts.js";
import { randomBytes, createCipheriv, createDecipheriv, createHash } from "node:crypto";
import { TOTP, Secret } from "otpauth";
import { pool } from "./db.js";
import { audit } from "./auth.js";

export const mfaConfigured = () => /^[a-f0-9]{64}$/i.test(process.env.ADMIN_MFA_KEY || "");
const digest = code => createHash("sha256").update(String(code).replace(/[\s-]/g, "").toUpperCase()).digest("hex");
function encrypt(secret) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", Buffer.from(process.env.ADMIN_MFA_KEY, "hex"), iv);
  const data = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString("base64")).join(".");
}
function decrypt(value) {
  const [iv, tag, data] = value.split(".").map(s => Buffer.from(s, "base64"));
  const cipher = createDecipheriv("aes-256-gcm", Buffer.from(process.env.ADMIN_MFA_KEY, "hex"), iv);
  cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString("utf8");
}
const otp = (secret, label = "Administrador") => new TOTP({ issuer: "DM Comunicación Visual", label, algorithm: "SHA1", digits: 6, period: 30, secret: Secret.fromBase32(secret) });
export async function verifySecondFactor(adminId, code) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const row = (await client.query("SELECT * FROM admin_users WHERE id = $1 FOR UPDATE", [adminId])).rows[0];
    let valid = !!row && !row.mfa_enabled;
    if (row?.mfa_enabled && typeof code === "string" && code.length <= 80) {
      const recoveryHash = digest(code);
      if (row.mfa_recovery.includes(recoveryHash)) {
        await client.query("UPDATE admin_users SET mfa_recovery = array_remove(mfa_recovery, $2) WHERE id = $1", [adminId, recoveryHash]);
        valid = true;
      } else if (mfaConfigured() && /^\d{6}$/.test(code.trim())) {
        const timestamp = Date.now();
        const delta = otp(decrypt(row.mfa_secret)).validate({ token: code.trim(), window: 1, timestamp });
        const counter = Math.floor(timestamp / 30000) + (delta || 0);
        if (delta !== null && counter > Number(row.mfa_last_counter)) {
          await client.query("UPDATE admin_users SET mfa_last_counter = $2 WHERE id = $1", [adminId, counter]);
          valid = true;
        }
      }
    }
    await client.query("COMMIT");
    return valid;
  } catch {
    await client.query("ROLLBACK");
    return false;
  } finally { client.release(); }
}
export async function mfaStatus(req, res) {
  const row = (await pool.query("SELECT mfa_enabled, cardinality(mfa_recovery) AS remaining FROM admin_users WHERE id = $1", [req.admin.id])).rows[0];
  res.json({ configured: mfaConfigured(), enabled: row.mfa_enabled, remaining: row.remaining, email: req.admin.email });
}
export async function beginMfa(req, res) {
  if (!mfaConfigured()) return res.status(400).json({ error: "Primero configurá ADMIN_MFA_KEY en Render." });
  const row = (await pool.query("SELECT mfa_enabled FROM admin_users WHERE id = $1", [req.admin.id])).rows[0];
  if (row.mfa_enabled) return res.status(400).json({ error: "El segundo factor ya está activo." });
  const secret = new Secret({ size: 20 }).base32;
  await pool.query("UPDATE admin_sessions SET mfa_pending = $2, mfa_pending_until = NOW() + INTERVAL '10 minutes' WHERE id = $1", [req.adminSession.sessionId, encrypt(secret)]);
  res.json({ secret });
}
export async function enableMfa(req, res) {
  const token = String(req.body?.code || "").trim();
  if (!/^\d{6}$/.test(token) || !mfaConfigured()) return res.status(400).json({ error: "Ingresá un código válido de seis dígitos." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const user = (await client.query("SELECT mfa_enabled FROM admin_users WHERE id = $1 FOR UPDATE", [req.admin.id])).rows[0];
    const session = (await client.query("SELECT mfa_pending FROM admin_sessions WHERE id = $1 AND mfa_pending_until > NOW()", [req.adminSession.sessionId])).rows[0];
    const timestamp = Date.now();
    const delta = session?.mfa_pending ? otp(decrypt(session.mfa_pending)).validate({ token, window: 1, timestamp }) : null;
    if (user.mfa_enabled || delta === null) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Código incorrecto o configuración vencida. Reiniciá la configuración si pasaron diez minutos." });
    }
    const recovery = Array.from({ length: 10 }, () => randomBytes(12).toString("hex").toUpperCase());
    await client.query("UPDATE admin_users SET mfa_enabled = true, mfa_secret = $2, mfa_recovery = $3, mfa_last_counter = $4 WHERE id = $1", [req.admin.id, session.mfa_pending, recovery.map(digest), Math.floor(timestamp / 30000) + delta]);
    await client.query("DELETE FROM admin_sessions WHERE admin_id = $1 AND id <> $2", [req.admin.id, req.adminSession.sessionId]);
    await client.query("UPDATE admin_sessions SET mfa_pending = NULL, mfa_pending_until = NULL, reauthenticated_at = NULL WHERE id = $1", [req.adminSession.sessionId]);
    await client.query("COMMIT");
    await audit(req.admin.id, "mfa_enabled", "admin", req.admin.id);
    return res.json({ recovery });
  } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}
export async function disableMfa(req, res) {
  await pool.query("UPDATE admin_users SET mfa_enabled = false, mfa_secret = NULL, mfa_recovery = '{}', mfa_last_counter = -1 WHERE id = $1", [req.admin.id]);
  await pool.query("UPDATE admin_sessions SET mfa_pending = NULL, mfa_pending_until = NULL WHERE admin_id = $1", [req.admin.id]);
  await pool.query("DELETE FROM admin_sessions WHERE admin_id = $1 AND id <> $2", [req.admin.id, req.adminSession.sessionId]);
  await audit(req.admin.id, "mfa_disabled", "admin", req.admin.id);
  await securityAlert("mfa_disabled");
  return res.json({ ok: true });
}
