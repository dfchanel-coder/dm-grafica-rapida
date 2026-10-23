import { ValidationError } from "./validate.js";
// Se llama dentro de la transacción que bloquea el pedido. El pago se registra
// una sola vez y sus efectos (cupón, stock y auditoría) se confirman juntos.
export async function settleOrder(client, order, { provider, paymentId = null, adminId = null, reference = "" }) {
  if (order.paid_at) return false;
  if (order.coupon_code) {
    const consumed = await client.query(`UPDATE coupons SET used_count = used_count + 1, updated_at = NOW()
      WHERE upper(code) = upper($1) AND (max_uses IS NULL OR used_count < max_uses) RETURNING id`, [order.coupon_code]);
    if (!consumed.rowCount) throw new ValidationError("El cupón se agotó o fue eliminado. Revisá el pedido antes de confirmar el cobro.", "coupon");
  }
  const items = await client.query("SELECT product_id, SUM(quantity)::int AS quantity FROM order_items WHERE order_id = $1 AND NOT is_quote AND product_id IS NOT NULL GROUP BY product_id ORDER BY product_id", [order.id]);
  for (const item of items.rows) {
    const stock = await client.query("SELECT stock, manage_stock FROM products WHERE id = $1 FOR UPDATE", [item.product_id]);
    if (stock.rows[0]?.manage_stock && stock.rows[0].stock < item.quantity) throw new ValidationError("Stock insuficiente al confirmar el pago. Revisá el pedido.", "stock");
    await client.query("UPDATE products SET stock = stock - $2 WHERE id = $1 AND manage_stock", [item.product_id, item.quantity]);
  }
  await client.query(`UPDATE orders SET status = 'paid', payment_status = 'approved', payment_provider = $2,
    mp_payment_id = $3, paid_at = NOW(), payment_confirmed_by = $4, payment_reference = $5, updated_at = NOW() WHERE id = $1`,
    [order.id, provider, paymentId, adminId, reference]);
  if (adminId) await client.query(`INSERT INTO admin_audit_events (admin_id, action, target_type, target_id, detail)
    VALUES ($1, 'confirm_payment', 'order', $2, $3)`, [adminId, order.id, JSON.stringify({ provider, reference, total: order.total })]);
  return true;
}
