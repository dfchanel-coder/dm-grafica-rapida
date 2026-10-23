// Importable por el servidor y el navegador. Todos los importes son pesos enteros.
export const PAYMENT_LABELS = { mercadopago: "Mercado Pago", transfer: "Transferencia", cash: "Contado" };
export function allocateAmount(amount, weights) {
  const total = weights.reduce((a, b) => a + b, 0);
  if (!total) return weights.map(() => 0);
  const parts = weights.map((w, i) => ({ i, value: Math.floor(amount * w / total), remainder: (amount * w) % total }));
  let left = amount - parts.reduce((sum, p) => sum + p.value, 0);
  for (const part of [...parts].sort((a, b) => b.remainder - a.remainder || a.i - b.i)) {
    if (left-- > 0) part.value++;
  }
  return parts.map(p => p.value);
}
export function paymentTotals(lines, { method = "mercadopago", discount = 0, shipping = 0, tax = {} } = {}) {
  const amounts = lines.map(line => Math.max(0, Number(line.is_quote ? line.quoted_amount || 0 : line.line_total || 0)));
  const subtotal = amounts.reduce((sum, n) => sum + n, 0);
  const coupon = Math.min(subtotal, Math.max(0, Math.round(discount)));
  const shares = allocateAmount(coupon, amounts);
  const detail = lines.map((line, i) => {
    const base = amounts[i] - shares[i];
    const percent = Number(line.payment_percent || 0);
    const adjustment = line.payment_rule === "mp_surcharge" && method === "mercadopago"
      ? Math.round(base * percent / 100)
      : line.payment_rule === "cash_discount" && ["transfer", "cash"].includes(method)
        ? -Math.round(base * percent / 100) : 0;
    return { ...line, coupon_share: shares[i], payment_adjustment: adjustment, payable: base + adjustment };
  });
  const adjustment = detail.reduce((sum, line) => sum + line.payment_adjustment, 0);
  const base = subtotal - coupon + adjustment;
  const taxAmount = tax.include_tax === false ? Math.round(base * Number(tax.rate || 0) / 100) : 0;
  return { subtotal, discount: coupon, adjustment, shipping, tax: taxAmount, total: base + shipping + taxAmount, lines: detail };
}
export function paymentRuleNote(product) {
  const percent = Number(product.payment_percent || 0);
  if (!percent || product.payment_rule === "none") return "";
  return product.payment_rule === "cash_discount"
    ? `${percent}% de descuento pagando por transferencia o contado, si están habilitados.`
    : product.payment_rule === "mp_surcharge" ? `Mercado Pago: recargo del ${percent}% sobre este producto.` : "";
}

export function paymentAdjustmentNote(sum) {
  if (!sum.adjustment) return "";
  const percentages = [...new Set(sum.lines.filter(line => line.payment_adjustment).map(line => Number(line.payment_percent)))].sort((a,b) => a-b).map(n => `${n}%`).join(" / ");
  return sum.adjustment > 0
    ? `Incluye recargo de ${percentages} por pago mediante Mercado Pago en los productos indicados.`
    : `Incluye descuento de ${percentages} por transferencia o contado en los productos indicados.`;
}
