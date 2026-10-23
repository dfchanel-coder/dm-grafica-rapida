import assert from "node:assert/strict";
import { test } from "node:test";

// Nunca abre una conexión: cada prueba sustituye los métodos del pool.
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { pool } = await import("../src/db.js");
const { applyPayment, createPreference } = await import("../src/payments.js");
const { prepareCart, quoteOrder } = await import("../src/orders.js");

const id = "12345678-1234-1234-1234-123456789abc";
const payment = { id: 123, external_reference: id, status: "approved", transaction_amount: 1500, currency_id: "UYU" };

function fakeTransaction(t, overrides = {}) {
  const order = { id, code: "DMR-ABC234", status: "pending_payment", total: 1500, currency: "UYU", paid_at: null, ...overrides };
  const writes = [];
  const client = {
    async query(sql, values = []) {
      if (sql.startsWith("SELECT * FROM orders")) return { rows: [{ ...order }] };
      if (sql.startsWith("SELECT product_id")) return { rows: [{ product_id: "product", quantity: 2, is_quote: false }] };
      if (sql.includes("UPDATE")) writes.push({ sql, values });
      if (sql.includes("SET status = 'paid'")) Object.assign(order, { status: "paid", payment_status: "approved", mp_payment_id: values[1], paid_at: new Date() });
      if (sql.includes("SET status = $2")) Object.assign(order, { status: values[1], payment_status: values[2], mp_payment_id: values[3] });
      if (sql.includes("SET status = 'review'")) Object.assign(order, { status: "review", payment_status: values[1], mp_payment_id: values[2] });
      return { rows: [], rowCount: 1 };
    },
    release() {},
  };
  t.mock.method(pool, "connect", async () => client);
  return { order, writes };
}

test("prepareCart cobra recargos del catálogo aunque el cliente mande otro precio", async (t) => {
  const product = { id, name: "Tarjetas", price: 1000, active: true, min_quantity: 1, options: [{ id: "extra", label: "Laminado", type: "checkbox", price_delta: 250 }] };
  t.mock.method(pool, "query", async (sql) => ({ rows: sql.includes("FROM products") ? [product] : [] }));
  const cart = await prepareCart([{ productId: id, quantity: 2, options: { extra: true }, unit_price: 1 }]);
  assert.equal(cart.lines[0].unit_price, 1250);
  assert.equal(cart.subtotal, 2500);
});

test("preferencia cobra el total persistido con ajustes o cotización, sin ítems cero", async (t) => {
  const previous = process.env.PUBLIC_BASE_URL;
  process.env.PUBLIC_BASE_URL = "https://example.com";
  t.after(() => { if (previous === undefined) delete process.env.PUBLIC_BASE_URL; else process.env.PUBLIC_BASE_URL = previous; });
  const bodies = [];
  t.mock.method(globalThis, "fetch", async (_url, options) => {
    bodies.push(JSON.parse(options.body));
    return { ok: true, json: async () => ({ id: "pref", sandbox_init_point: "https://sandbox.mercadopago.com.uy/checkout", init_point: "https://www.mercadopago.com.uy/checkout" }) };
  });
  for (const order of [
    { id, code: "DMR-ABC234", total: 1350, subtotal: 1000, discount: 50, shipping_cost: 200, tax: 200 },
    { id, code: "DMR-ABC234", total: 4500, subtotal: 1000, quoted_total: 3500, requires_quote: true },
  ]) {
    await createPreference({ order, items: [{ unit_price: 0, quantity: 4 }], customer: { name: "Cliente", email: "cliente@example.com" } });
    assert.equal(bodies.at(-1).items.reduce((sum, item) => sum + item.quantity * item.unit_price, 0), order.total);
    assert.ok(bodies.at(-1).items.every((item) => item.unit_price > 0));
  }
});

test("pago aprobado repetido descuenta stock y notifica una única vez", async (t) => {
  const { order, writes } = fakeTransaction(t);
  const onPaid = t.mock.fn();
  assert.equal(await applyPayment(payment, { onPaid }), "applied");
  assert.equal(await applyPayment(payment, { onPaid }), "ignored");
  assert.equal(order.status, "paid");
  assert.equal(writes.filter(({ sql }) => sql.includes("UPDATE products")).length, 1);
  assert.equal(onPaid.mock.callCount(), 1);
});

test("pagos repetidos preservan producción, entrega, cancelación y reembolso", async (t) => {
  for (const status of ["in_production", "ready", "delivered", "cancelled", "refunded", "pending_payment"]) {
    await t.test(status, async (sub) => {
      const { order, writes } = fakeTransaction(sub, { status, paid_at: new Date(), mp_payment_id: "123" });
      const onPaid = sub.mock.fn();
      const onStatusChange = sub.mock.fn();
      assert.equal(await applyPayment(payment, { onPaid, onStatusChange }), "ignored");
      assert.equal(order.status, status);
      assert.equal(writes.length, 0);
      assert.equal(onPaid.mock.callCount(), 0);
      assert.equal(onStatusChange.mock.callCount(), 0);
    });
  }
});

test("un reembolso afecta solo al pago confirmado y se notifica una vez", async (t) => {
  const { order, writes } = fakeTransaction(t, { status: "delivered", paid_at: new Date(), mp_payment_id: "123" });
  const onStatusChange = t.mock.fn();
  assert.equal(await applyPayment({ ...payment, id: 999, status: "refunded" }, { onStatusChange }), "ignored");
  assert.equal(await applyPayment({ ...payment, status: "refunded" }, { onStatusChange }), "applied");
  assert.equal(await applyPayment({ ...payment, status: "refunded" }, { onStatusChange }), "ignored");
  assert.equal(order.status, "refunded");
  assert.equal(onStatusChange.mock.callCount(), 1);
  assert.equal(writes.length, 1);
});

test("aprobado tardío de pedido cancelado exige revisión sin descontar stock", async (t) => {
  const { order, writes } = fakeTransaction(t, { status: "cancelled" });
  const onPaid = t.mock.fn();
  assert.equal(await applyPayment(payment, { onPaid }), "review");
  assert.equal(await applyPayment(payment, { onPaid }), "ignored");
  assert.equal(order.status, "review");
  assert.equal(writes.filter(({ sql }) => sql.includes("UPDATE products")).length, 0);
  assert.equal(onPaid.mock.callCount(), 0);
});

test("un importe incorrecto pasa a revisión y no genera confirmación", async (t) => {
  const { order } = fakeTransaction(t);
  const onPaid = t.mock.fn();
  const onStatusChange = t.mock.fn();
  assert.equal(await applyPayment({ ...payment, transaction_amount: 1 }, { onPaid, onStatusChange }), "review");
  assert.equal(await applyPayment({ ...payment, transaction_amount: 1 }, { onPaid, onStatusChange }), "ignored");
  assert.equal(order.status, "review");
  assert.equal(onPaid.mock.callCount(), 0);
  assert.equal(onStatusChange.mock.callCount(), 1);
});

