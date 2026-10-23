import { formatMoney, escapeHtml } from "./api.js";
import { PAYMENT_LABELS } from "./payment-pricing.js";
export { PAYMENT_LABELS };
export function totalsHtml(sum, { estimated = false } = {}) {
  return `<div class="summary-row"><span>Productos</span><strong>${formatMoney(sum.subtotal)}</strong></div>
    ${sum.discount ? `<div class="summary-row"><span>Cupón</span><strong>− ${formatMoney(sum.discount)}</strong></div>` : ""}
    ${sum.adjustment ? `<div class="summary-row"><span>${sum.adjustment > 0 ? "Recargo por Mercado Pago" : "Descuento por medio de pago"}</span><strong>${sum.adjustment > 0 ? "+" : "−"} ${formatMoney(Math.abs(sum.adjustment))}</strong></div>` : ""}
    <div class="summary-row"><span>Envío</span><strong>${formatMoney(sum.shipping)}</strong></div>
    ${sum.tax ? `<div class="summary-row"><span>IVA</span><strong>${formatMoney(sum.tax)}</strong></div>` : ""}
    <div class="summary-row summary-row--total"><span>${estimated ? "Total parcial, falta cotización" : "Total"}</span><strong>${formatMoney(sum.total)}</strong></div>`;
}
export function instructionsHtml(order) {
  const p = order.payment_snapshot || {};
  if (order.payment_provider === "mercadopago" || order.status !== "pending_payment") return "";
  return `<div class="alert alert--info"><strong>${order.payment_provider === "transfer" ? "Pendiente de transferencia" : "Pendiente de pago en efectivo"}</strong>
    ${order.payment_provider === "transfer" ? `<dl><dt>Banco</dt><dd>${escapeHtml(p.bank)}</dd><dt>Titular</dt><dd>${escapeHtml(p.holder)}</dd><dt>Cuenta</dt><dd>${escapeHtml(p.account)}</dd><dt>Moneda</dt><dd>${escapeHtml(p.currency)}</dd></dl><p>Referencia: <strong>${escapeHtml(order.code)}</strong></p>` : ""}
    <p style="white-space:pre-line">${escapeHtml(p.instructions || "")}</p><p>Importe: <strong>${formatMoney(order.total)}</strong>. El pedido se confirma como pagado cuando verificamos el ingreso.</p></div>`;
}
