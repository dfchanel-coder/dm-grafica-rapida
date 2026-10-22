import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.CHECKOUT_ENABLED = "false";
const { pool } = await import("../src/db.js");
const { prepareCart, createOrder, quoteOrder } = await import("../src/orders.js");
const { applyPayment } = await import("../src/payments.js");

test("SQL real: jerarquía controla compras, recargos y cotizaciones conservan totales", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  const migrations = new URL("../migrations/", import.meta.url);
  for (const filename of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(filename, migrations), "utf8"));
  }
  const query = async (sql, values = []) => {
    const result = await db.query(sql, values);
    return { ...result, rowCount: result.affectedRows ?? result.rows.length };
  };
  t.mock.method(pool, "query", query);
  t.mock.method(pool, "connect", async () => ({ query, release() {} }));

  const root = (await db.query("INSERT INTO categories (name,slug) VALUES ('Marca','marca') RETURNING id")).rows[0].id;
  const child = (await db.query("INSERT INTO categories (name,slug,parent_id) VALUES ('Tarjetas','tarjetas',$1) RETURNING id", [root])).rows[0].id;
  const product = (await db.query(
    "INSERT INTO products (name,slug,price,category_id,active,options) VALUES ('Tarjetas','tarjetas',1000,$1,true,$2) RETURNING id",
    [child, JSON.stringify([{ id: "laminado", label: "Laminado", type: "checkbox", price_delta: 250 }])],
  )).rows[0].id;
  const freeProduct = (await db.query("INSERT INTO products (name,slug,price,active) VALUES ('Sin categoría','sin-categoria',100,true) RETURNING id")).rows[0].id;
  const quoteProduct = (await db.query("INSERT INTO products (name,slug,price,active,pricing_mode,requires_quote) VALUES ('A medida','a-medida',0,true,'quote',true) RETURNING id")).rows[0].id;
  const items = [{ productId: product, quantity: 2, options: { laminado: true } }];
  assert.equal((await prepareCart(items)).subtotal, 2500);

  await db.query("UPDATE categories SET active=false WHERE id=$1", [root]);
  await assert.rejects(prepareCart(items), /ya no está disponible/);
  assert.equal((await prepareCart([{ productId: freeProduct, quantity: 1 }])).subtotal, 100);
  await db.query("UPDATE categories SET active=true WHERE id=$1", [root]);
  await db.query("UPDATE categories SET active=false WHERE id=$1", [child]);
  await assert.rejects(prepareCart(items), /ya no está disponible/);
  await db.query("UPDATE categories SET active=true WHERE id=$1", [child]);

  const customer = { name: "Cliente de prueba", email: "cliente@example.com", phone: "099123456" };
  const created = await createOrder({ customer, items, delivery: { method: "pickup" } });
  assert.equal(created.order.total, 2500);
  assert.equal(created.checkoutDisabled, true);
  const persisted = (await db.query("SELECT unit_price, quantity, line_total FROM order_items WHERE order_id=$1", [created.order.id])).rows[0];
  assert.deepEqual(persisted, { unit_price: 1250, quantity: 2, line_total: 2500 });

  const requested = await createOrder({ customer, items: [...items, { productId: quoteProduct, quantity: 1 }], delivery: { method: "pickup" } });
  assert.equal(requested.order.status, "quote");
  const quoted = await quoteOrder(requested.order.id, { quoteAmount: 3500, generatePaymentLink: false });
  assert.equal(quoted.order.total, 6000);
  assert.equal(quoted.order.status, "pending_payment");
  await db.query("UPDATE orders SET status='paid', paid_at=NOW() WHERE id=$1", [requested.order.id]);
  await assert.rejects(quoteOrder(requested.order.id, { quoteAmount: 100 }), /no admite una nueva cotización/);

  await db.query("INSERT INTO coupons(code,discount_type,discount_value,max_uses) VALUES ('UNICO','fixed',100,1)");
  const withCoupon = () => createOrder({ customer, items, delivery: { method: "pickup" }, couponCode: "UNICO" });
  const first = await withCoupon();
  const second = await withCoupon();
  const count = async () => (await db.query("SELECT used_count FROM coupons WHERE code='UNICO'")).rows[0].used_count;
  assert.equal(await count(), 0, "crear o abandonar pedidos no consume usos");
  const paymentFor = (order, id) => ({ id, external_reference: order.id, status: "approved", transaction_amount: order.total, currency_id: "UYU" });
  assert.equal(await applyPayment(paymentFor(first.order, 101)), "applied");
  assert.equal(await count(), 1);
  assert.equal(await applyPayment(paymentFor(first.order, 101)), "ignored");
  assert.equal(await count(), 1, "webhook repetido no consume otro uso");
  assert.equal(await applyPayment(paymentFor(second.order, 102)), "review");
  assert.equal(await count(), 1, "no excede el máximo entre pedidos que ya tenían descuento");
  assert.equal(await applyPayment(paymentFor(second.order, 102)), "ignored");
  await assert.rejects(withCoupon(), /límite de uso/);
});
