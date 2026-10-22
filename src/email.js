import { pool } from "./db.js";

/**
 * Envío de correos transaccionales con Resend.
 *
 * Se usa un remitente del dominio propio del negocio (dominio de email).
 * Un fallo de correo nunca debe tumbar la orden: se registra y se sigue.
 */

const RESEND_ENDPOINT = "https://api.resend.com/emails";

export function emailConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

export async function sendEmail({ to, subject, html, text, template = "generic", orderId = null }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.EMAIL_FROM;

  if (!apiKey || !from) {
    console.error(`Email omitido ("${template}"): falta RESEND_API_KEY o EMAIL_FROM.`);
    await logEmail({ to, subject, template, orderId, status: "failed", error: "Sin configuración de correo" });
    return { sent: false, reason: "not_configured" };
  }

  const recipient = String(to || "").trim();
  if (!recipient) {
    await logEmail({ to: "", subject, template, orderId, status: "failed", error: "Sin destinatario" });
    return { sent: false, reason: "missing_recipient" };
  }

  try {
    const response = await fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to: [recipient], subject, html, text }),
      signal: AbortSignal.timeout(12_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.error(`Resend respondió ${response.status} para "${template}".`);
      await logEmail({ to: recipient, subject, template, orderId, status: "failed", error: `HTTP ${response.status} ${detail.slice(0, 300)}` });
      return { sent: false, reason: `http_${response.status}` };
    }

    await logEmail({ to: recipient, subject, template, orderId, status: "sent" });
    return { sent: true };
  } catch (error) {
    console.error(`Fallo al enviar "${template}":`, error?.name || "Error");
    await logEmail({ to: recipient, subject, template, orderId, status: "failed", error: error?.name || "Error" });
    return { sent: false, reason: "network" };
  }
}

async function logEmail({ to, subject, template, orderId, status, error = null }) {
  try {
    await pool.query(
      `INSERT INTO email_log (to_email, subject, template, order_id, status, error)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [String(to || "").slice(0, 254), String(subject || "").slice(0, 300), template, orderId, status, error],
    );
  } catch (dbError) {
    console.error("No se pudo registrar el correo en email_log:", dbError?.name || "Error");
  }
}
