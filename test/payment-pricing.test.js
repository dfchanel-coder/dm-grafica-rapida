import assert from "node:assert/strict";
import { test } from "node:test";
import { paymentTotals, allocateAmount } from "../public/js/payment-pricing.js";
import { fillBusiness, fillCatalog } from "../src/page-content.js";

test("precio único no descuenta automáticamente; recargo y descuento son por producto", () => {
  const base = { line_total: 1000, payment_percent: 12 };
  assert.equal(paymentTotals([{...base, payment_rule: "none"}], {method:"transfer"}).total, 1000);
  assert.equal(paymentTotals([{...base, payment_rule: "mp_surcharge"}]).total, 1120);
  assert.equal(paymentTotals([{...base, payment_rule: "cash_discount"}], {method:"transfer"}).total, 880);
  assert.equal(paymentTotals([{...base, line_total:1120, payment_rule:"cash_discount"}], {method:"cash"}).total, 986);
});
test("carrito mixto reparte cupón, deja envío fuera y calcula IVA después del ajuste", () => {
  const lines = ["none","mp_surcharge","cash_discount"].map(payment_rule => ({line_total:1000,payment_rule,payment_percent:12}));
  const mp = paymentTotals(lines, {discount:300,shipping:200,tax:{include_tax:false,rate:22}});
  assert.deepEqual(mp.lines.map(l=>l.coupon_share), [100,100,100]);
  assert.equal(mp.adjustment,108); assert.equal(mp.tax,618); assert.equal(mp.total,3626);
  const cash = paymentTotals(lines, {method:"cash",discount:300,shipping:200});
  assert.equal(cash.adjustment,-108); assert.equal(cash.total,2792);
});
test("redondeos distribuyen exactamente el cupón incluso con precios distintos", () => {
  assert.deepEqual(allocateAmount(2,[1,1,1]),[1,1,0]);
  for(let amount=0;amount<300;amount++) {
    const parts=allocateAmount(amount,[101,57,149]);
    assert.equal(parts.reduce((a,b)=>a+b,0),amount);
    assert.ok(parts.every((v,i)=>v<=[101,57,149][i]));
  }
});
test("HTML inicial incluye contacto y catálogo, escapa contenido y filtra categoría", () => {
  const html=fillBusiness('<span data-business-address></span><span data-business-phone></span><span data-business-tax-id></span>',{address:'Artigas <1636>',city:'Rivera',phone:'095 010 244',tax_id:'123'});
  assert.match(html,/Artigas &lt;1636&gt;/);assert.match(html,/095 010 244/);assert.match(html,/RUT: 123/);
  const products=[{name:'Tarjetas <especiales>',slug:'tarjetas',price:1000,category_slug:'papel',payment_rule:'cash_discount',payment_percent:12},{name:'Otro',slug:'otro',price:2,category_slug:'otro'}];
  const rendered=fillCatalog('<div data-catalog-grid><p>Cargando catálogo…</p></div>',{products,categories:[],category:'papel'});
  assert.match(rendered,/Tarjetas &lt;especiales&gt;/);assert.match(rendered,/12% de descuento/);assert.doesNotMatch(rendered,/Cargando|Otro/);
});
