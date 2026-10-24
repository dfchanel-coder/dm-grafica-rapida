/** Recuperación manual: solo desde la consola privada del servidor. */
import "dotenv/config";
import { pool } from "../src/db.js";
const email = String(process.env.ADMIN_EMAIL || process.argv[2] || "").trim().toLowerCase();
const client = await pool.connect();
try {
  if (!email) throw new Error("Indicá ADMIN_EMAIL o el correo como argumento.");
  await client.query("BEGIN");
  const admin = (await client.query("UPDATE admin_users SET mfa_enabled = false, mfa_secret = NULL, mfa_recovery = '{}', mfa_last_counter = -1 WHERE lower(email) = $1 RETURNING id", [email])).rows[0];
  if (!admin) throw new Error("Administrador no encontrado.");
  await client.query("DELETE FROM admin_sessions WHERE admin_id = $1", [admin.id]);
  await client.query("INSERT INTO admin_audit_events(admin_id, action, target_type, target_id) VALUES ($1::uuid, 'mfa_reset_console', 'admin', $1::text)", [admin.id]);
  await client.query("COMMIT");
  console.log("Segundo factor restablecido. La contraseña y los permisos se conservaron; las sesiones anteriores se cerraron.");
} catch (error) { await client.query("ROLLBACK"); console.error(error.message); process.exitCode = 1; }
finally { client.release(); await pool.end(); }
