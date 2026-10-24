import { pool } from "./db.js";
import { sendEmail } from "./email.js";
// Destinatario fuera de los ajustes editables del panel: no se puede desviar desde una sesión robada.
export async function securityAlert(event) {
  const to = process.env.SECURITY_NOTIFICATION_EMAIL || process.env.ADMIN_NOTIFICATION_EMAIL;
  if (!to) return;
  try {
    const result = await pool.query(`INSERT INTO admin_login_limits(bucket, attempts, expires_at)
      VALUES ($1, 1, NOW() + INTERVAL '15 minutes') ON CONFLICT (bucket) DO UPDATE
      SET attempts = 1, expires_at = EXCLUDED.expires_at WHERE admin_login_limits.expires_at <= NOW() RETURNING bucket`, [`alert:${event}`]);
    if (!result.rows.length) return;
    const labels = { login_attack: "Múltiples intentos fallidos de acceso", payment_settings: "Cambios en la configuración de pagos", admin_changed: "Cambios en las cuentas de administración", mfa_disabled: "Segundo factor desactivado" };
    const label = labels[event] || "Evento de seguridad";
    const text = `${label}. Revisá la auditoría del panel de DM Comunicación Visual. Si no reconocés la actividad, revisá los accesos y restablecé las credenciales desde una sesión confiable. Fecha UTC: ${new Date().toISOString()}`;
    await sendEmail({ to, subject: `Seguridad DM: ${label}`, text, html: `<p>${text}</p>`, template: "security_alert" });
  } catch { console.error("No se pudo emitir la alerta de seguridad."); }
}
