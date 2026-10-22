/**
 * Plantillas de correo.
 *
 * HTML con estilos en línea: es lo único que los clientes de correo
 * interpretan de forma consistente. Sin JavaScript, sin CSS externo.
 */

const BRAND = {
  primary: "#134E9D",
  ink: "#1F2933",
  muted: "#5B6B7A",
  line: "#E3E6EA",
  background: "#F5F6F8",
};

function layout({ title, preheader = "", body }) {
  return `<!DOCTYPE html>
<html lang="es-UY">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
</head>
<body style="margin:0;padding:0;background:${BRAND.background};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND.ink};">
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND.background};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid ${BRAND.line};">
<tr><td style="padding:22px 28px;border-bottom:3px solid ${BRAND.primary};">
  <span style="font-size:18px;font-weight:700;letter-spacing:-0.2px;color:${BRAND.primary};">DM Comunicación Visual</span>
  <span style="font-size:12px;color:${BRAND.muted};margin-left:8px;">Gráfica &amp; Merchandising</span>
</td></tr>
<tr><td style="padding:28px;font-size:15px;line-height:1.6;">
${body}
</td></tr>
<tr><td style="padding:18px 28px;background:${BRAND.background};border-top:1px solid ${BRAND.line};font-size:12px;color:${BRAND.muted};line-height:1.6;">
  DM Comunicación Visual · Artigas 1636 Piso 1, Rivera, Uruguay<br>
  <a href="https://www.instagram.com/dmcomunicacionvisual.uy/" style="color:${BRAND.muted};">Instagram</a>
  · <a href="https://www.facebook.com/DMimpresos/" style="color:${BRAND.muted};">Facebook</a>
  · <a href="https://wa.me/59895010244" style="color:${BRAND.muted};">WhatsApp 095 010 244</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function money(amount, currency = "UYU") {
  const value = Number(amount || 0);
  const formatted = new Intl.NumberFormat("es-UY", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
  return `${currency} $ ${formatted}`;
}

function button(href, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">
<tr><td style="border-radius:8px;background:${BRAND.primary};">
<a href="${href}" style="display:inline-block;padding:13px 26px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
</td></tr></table>`;
}

function detailsBlock(rows) {
  const cells = rows
    .filter(Boolean)
    .map(([label, value]) => `<tr>
      <td style="padding:6px 0;font-size:14px;color:${BRAND.muted};width:38%;">${escapeHtml(label)}</td>
      <td style="padding:6px 0;font-size:14px;color:${BRAND.ink};">${value}</td>
    </tr>`)
    .join("");
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:18px 0;">${cells}</table>`;
}

function itemsTable(items, { total, currency }) {
  const rows = items.map((item) => `<tr>
    <td style="padding:10px 0;border-bottom:1px solid ${BRAND.line};font-size:14px;">
      <strong>${escapeHtml(item.product_name)}</strong>
      <span style="color:${BRAND.muted};"> × ${item.quantity}</span>
      ${item.customization ? `<div style="color:${BRAND.muted};font-size:13px;margin-top:4px;">${escapeHtml(item.customization)}</div>` : ""}
      ${Array.isArray(item.options) && item.options.length
        ? `<div style="color:${BRAND.muted};font-size:13px;margin-top:4px;">${escapeHtml(item.options.map((option) => `${option.label}: ${option.value}`).join(" · "))}</div>`
        : ""}
    </td>
    <td style="padding:10px 0;border-bottom:1px solid ${BRAND.line};font-size:14px;text-align:right;white-space:nowrap;">${money(item.line_total, currency)}</td>
  </tr>`).join("");

  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;">
    ${rows}
    <tr><td style="padding:14px 0 0;font-size:15px;font-weight:700;">Total</td>
    <td style="padding:14px 0 0;font-size:15px;font-weight:700;text-align:right;">${money(total, currency)}</td></tr>
  </table>`;
}

/* ------------------------------------------------------------------------ */
/* Cliente: confirmación de orden                                           */
/* ------------------------------------------------------------------------ */

export function orderConfirmationCustomer({ order, items, business = {} }) {
  const delivery = order.delivery_method === "pickup"
    ? `Retiro en el local · ${business.address || "Rivera"}, ${business.city || "Rivera"}`
    : `Envío a domicilio · ${[order.shipping_address, order.shipping_city, order.shipping_department].filter(Boolean).join(", ")}`;

  const body = `
    <h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;">¡Gracias por tu compra, ${escapeHtml(order.customer_name.split(" ")[0])}!</h1>
    <p style="margin:0 0 18px;color:${BRAND.muted};">Recibimos tu pedido y ya estamos trabajando en él.</p>

    ${detailsBlock([
      ["Código de pedido", `<strong>${escapeHtml(order.code)}</strong>`],
      ["Entrega", escapeHtml(delivery)],
      ["Fecha", escapeHtml(new Date(order.created_at).toLocaleDateString("es-UY", { dateStyle: "long" }))],
    ])}

    ${itemsTable(items, { total: order.total, currency: order.currency })}

    ${order.notes ? `<p style="margin:18px 0 0;"><strong>Tu consulta:</strong><br><span style="color:${BRAND.muted};">${escapeHtml(order.notes)}</span></p>` : ""}

    <p style="margin:22px 0 0;color:${BRAND.muted};">
      Guardá el código <strong style="color:${BRAND.ink};">${escapeHtml(order.code)}</strong>:
      con él y tu correo podés consultar el estado de tu pedido en cualquier momento.
    </p>

    ${button(`${publicUrl()}/seguimiento?code=${encodeURIComponent(order.code)}`, "Consultar mi pedido")}
  `;

  return {
    subject: `Pedido ${order.code} recibido — DM Comunicación Visual`,
    html: layout({ title: `Pedido ${order.code}`, preheader: "Recibimos tu pedido y ya estamos trabajando en él.", body }),
    text: `Recibimos tu pedido ${order.code}. Total: ${money(order.total, order.currency)}. Seguimiento: ${publicUrl()}/seguimiento?code=${order.code}`,
  };
}

/* ------------------------------------------------------------------------ */
/* Cliente: cambio de estado                                                */
/* ------------------------------------------------------------------------ */

const STATUS_LABELS = {
  paid: "Pago confirmado",
  in_production: "En producción",
  ready: "Listo para retirar o enviar",
  delivered: "Pedido entregado",
  cancelled: "Pedido cancelado",
  refunded: "Pedido reembolsado",
};

export function orderStatusCustomer({ order, statusLabel }) {
  const label = statusLabel || STATUS_LABELS[order.status] || order.status;
  const body = `
    <h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;">${escapeHtml(label)}</h1>
    <p style="margin:0 0 18px;color:${BRAND.muted};">Actualización de tu pedido <strong>${escapeHtml(order.code)}</strong>.</p>
    ${detailsBlock([
      ["Código de pedido", `<strong>${escapeHtml(order.code)}</strong>`],
      ["Estado", escapeHtml(label)],
      ["Total", money(order.total, order.currency)],
    ])}
    ${order.estimated_delivery ? detailsBlock([["Entrega estimada", escapeHtml(order.estimated_delivery)]]) : ""}
    ${button(`${publicUrl()}/seguimiento?code=${encodeURIComponent(order.code)}`, "Ver el detalle")}
  `;
  return {
    subject: `${label} — pedido ${order.code}`,
    html: layout({ title: label, preheader: `Tu pedido ${order.code} está en estado: ${label}.`, body }),
    text: `Tu pedido ${order.code} está en estado: ${label}.`,
  };
}

/* ------------------------------------------------------------------------ */
/* Administrador: nueva orden pagada                                        */
/* ------------------------------------------------------------------------ */

export function newOrderAdmin({ order, items, business = {} }) {
  const delivery = order.delivery_method === "pickup"
    ? `Retiro en el local`
    : `Envío · ${[order.shipping_address, order.shipping_city, order.shipping_department].filter(Boolean).join(", ")}`;

  const body = `
    <h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;">Nueva orden pagada</h1>
    <p style="margin:0 0 18px;color:${BRAND.muted};">
      El pedido <strong>${escapeHtml(order.code)}</strong> fue pagado y ya está listo para revisar.
    </p>

    ${detailsBlock([
      ["Código", `<strong>${escapeHtml(order.code)}</strong>`],
      ["Cliente", escapeHtml(order.customer_name)],
      ["Correo", `<a href="mailto:${escapeHtml(order.customer_email)}" style="color:${BRAND.primary};">${escapeHtml(order.customer_email)}</a>`],
      ["Teléfono", order.customer_phone ? `<a href="https://wa.me/${escapeHtml(String(order.customer_phone).replace(/[^0-9]/g, ""))}" style="color:${BRAND.primary};">${escapeHtml(order.customer_phone)}</a>` : "—"],
      ["Entrega", escapeHtml(delivery)],
      ["Total", `<strong>${money(order.total, order.currency)}</strong>`],
    ])}

    ${itemsTable(items, { total: order.total, currency: order.currency })}

    ${order.notes ? `<p style="margin:18px 0 0;"><strong>Nota del cliente:</strong><br><span style="color:${BRAND.muted};">${escapeHtml(order.notes)}</span></p>` : ""}

    ${button(`${publicUrl()}/admin#pedido/${order.id}`, "Revisar la orden en el panel")}
    <p style="margin:0;color:${BRAND.muted};font-size:13px;">
      O enterá directamente al panel: <span style="color:${BRAND.ink};">${escapeHtml(publicUrl())}/admin</span>
    </p>
  `;

  return {
    subject: `Nueva orden ${order.code} — ${money(order.total, order.currency)}`,
    html: layout({ title: `Nueva orden ${order.code}`, preheader: "Hay una nueva orden pagada para revisar.", body }),
    text: `Nueva orden pagada ${order.code} por ${money(order.total, order.currency)}. Revisala: ${publicUrl()}/admin#pedido/${order.id}`,
  };
}

/* ------------------------------------------------------------------------ */
/* Administrador: consulta o cotización                                    */
/* ------------------------------------------------------------------------ */

export function newInquiryAdmin({ inquiry, product, adminUrl }) {
  const body = `
    <h1 style="margin:0 0 6px;font-size:22px;line-height:1.3;">${escapeHtml(inquiry.subject || "Nueva consulta")}</h1>
    <p style="margin:0 0 18px;color:${BRAND.muted};">Llegó una consulta desde el sitio web.</p>

    ${detailsBlock([
      ["Nombre", escapeHtml(inquiry.name)],
      ["Correo", `<a href="mailto:${escapeHtml(inquiry.email)}" style="color:${BRAND.primary};">${escapeHtml(inquiry.email)}</a>`],
      ["Teléfono", inquiry.phone ? escapeHtml(inquiry.phone) : "—"],
      ["Producto", product ? escapeHtml(product) : "—"],
    ])}

    <p style="margin:18px 0 0;padding:16px;background:${BRAND.background};border-radius:8px;">${escapeHtml(inquiry.message)}</p>

    ${button(`${adminUrl}/admin#consultas/${inquiry.id}`, "Abrir en el panel")}
  `;

  return {
    subject: `Nueva consulta: ${inquiry.subject || "sitio web"}`,
    html: layout({ title: "Nueva consulta", preheader: "Hay una consulta nueva para responder.", body }),
    text: `Nueva consulta de ${inquiry.name} (${inquiry.email}). ${adminUrl}/admin#consultas/${inquiry.id}`,
  };
}

function publicUrl() {
  return (process.env.PUBLIC_BASE_URL || "").replace(/\/$/, "");
}
