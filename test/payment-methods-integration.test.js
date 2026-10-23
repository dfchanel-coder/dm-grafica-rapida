import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
process.env.DATABASE_URL="postgresql://test:test@127.0.0.1:1/test";
process.env.CHECKOUT_ENABLED="true";
process.env.MERCADOPAGO_ACCESS_TOKEN="TEST-fake";
process.env.PUBLIC_BASE_URL="https://example.com";
process.env.RESEND_API_KEY="fake";
process.env.EMAIL_FROM="test@example.com";
const {pool}=await import("../src/db.js");
const {updateSettings,toPublicSettings,getSettings}=await import("../src/settings.js");
const {createOrder,previewCart,confirmManualPayment,trackOrder,changeOrderPayment,orderPaymentOptions,quoteOrder}=await import("../src/orders.js");
const {applyPayment}=await import("../src/payments.js");

test("pagos por producto: SQL real, snapshots, confirmaciones, cotizaciones y callbacks",async t=>{
 const db=new PGlite();t.after(()=>db.close());
 const migrations=new URL('../migrations/',import.meta.url);
 for(const file of (await readdir(migrations)).filter(x=>x.endsWith('.sql')).sort()) await db.exec(await readFile(new URL(file,migrations),'utf8'));
 const query=async(sql,values=[])=>{const r=await db.query(sql,values);return {...r,rowCount:r.affectedRows??r.rows.length};};
 t.mock.method(pool,'query',query);t.mock.method(pool,'connect',async()=>({query,release(){}}));
 const requests=[];
 t.mock.method(globalThis,'fetch',async(url,opts)=>{requests.push({url,body:JSON.parse(opts.body)});return {ok:true,json:async()=>({id:crypto.randomUUID(),sandbox_init_point:'https://sandbox.mercadopago.com.uy/checkout'})};});
 await updateSettings({payments:{transfer:{enabled:true,bank:'Banco Prueba',holder:'Titular Prueba',account:'123',currency:'UYU'},cash:{enabled:true,instructions:'Pagar en el local antes de producir.'}},notifications:{admin_email:'admin@example.com',notify_customer:true},checkout:{shipping_cost:200}});
 const admin=(await db.query("INSERT INTO admin_users(email,name,password_hash) VALUES('admin@example.com','Admin','fake') RETURNING id")).rows[0].id;
 const products=[];
 for(const rule of ['none','mp_surcharge','cash_discount']) products.push((await db.query("INSERT INTO products(name,slug,price,active,manage_stock,stock,payment_rule,payment_percent) VALUES($1,$1,1000,true,true,20,$2,12) RETURNING *",[rule,rule])).rows[0]);
 const customer={name:'Cliente Prueba',email:'cliente@example.com',phone:'099123456'};
 const items=products.map(p=>({productId:p.id,quantity:1}));
 const args={customer,items,delivery:{method:'pickup'},paymentMethod:'transfer'};
 const paymentFor=(order,id)=>({id,external_reference:order.id,status:'approved',transaction_amount:order.total,currency_id:'UYU',metadata:{payment_revision:order.payment_revision}});
 await t.test('no publica la cuenta bancaria y rechaza configuración incompleta',async()=>{
  assert.equal(toPublicSettings(await getSettings()).payments.transfer.account,undefined);
  await assert.rejects(updateSettings({payments:{transfer:{account:''}}}),/cuenta|account/);
 });
 await t.test('preview y creación coinciden, el navegador no puede alterar importes',async()=>{
  const preview=await previewCart({items,deliveryMethod:'pickup'});
  assert.equal(preview.totals.transfer.total,2880);assert.equal(preview.totals.mercadopago.total,3120);
  await assert.rejects(createOrder({...args,expectedTotal:1}),/total cambió/);
  const before=(await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n;
  await updateSettings({payments:{cash:{enabled:false}}});
  await assert.rejects(createOrder({...args,paymentMethod:'cash'}),/no está disponible/);
  assert.equal((await db.query('SELECT count(*)::int AS n FROM orders')).rows[0].n,before);
 });
 let manual;
 await t.test('pedido conserva cuenta, regla y precio; correo incluye instrucciones',async()=>{
  manual=(await createOrder({...args,expectedTotal:2880})).order;
  assert.equal(manual.payment_snapshot.account,'123');assert.equal(manual.payment_adjustment,-120);
  await updateSettings({payments:{transfer:{account:'999'}}});
  await db.query('UPDATE products SET payment_percent=30 WHERE id=$1',[products[2].id]);
  const preview=await orderPaymentOptions(manual.code,customer.email);
  assert.equal(preview.totals.transfer.total,2880);
  assert.equal((await trackOrder(manual.code,customer.email)).payment_snapshot.account,'123');
  assert.ok(requests.some(r=>r.url.includes('resend')&&r.body.text.includes('Cuenta: 123')));
  await db.query('UPDATE products SET payment_percent=12 WHERE id=$1',[products[2].id]);
 });
 await t.test('confirmación manual es idempotente, auditada y no puede omitir importe o revisión',async()=>{
  await assert.rejects(confirmManualPayment(manual.id,admin,{reference:'Ingreso',revision:99,expectedTotal:2880}),/pedido cambió/);
  const confirm={reference:'Ingreso 456',revision:manual.payment_revision,expectedTotal:2880};
  assert.equal((await confirmManualPayment(manual.id,admin,confirm)).changed,true);
  assert.equal((await confirmManualPayment(manual.id,admin,confirm)).changed,false);
  assert.deepEqual((await db.query('SELECT stock FROM products WHERE id = ANY($1::uuid[]) ORDER BY slug',[products.map(p=>p.id)])).rows.map(r=>r.stock),[19,19,19]);
  assert.equal((await db.query("SELECT count(*)::int AS n FROM admin_audit_events WHERE action='confirm_payment'")).rows[0].n,1);
  await assert.rejects(changeOrderPayment({code:manual.code,email:customer.email,method:'mercadopago',revision:1,expectedTotal:3120}),/pedido cambió/);
 });
 await t.test('cambio de medio invalida revisión anterior y el pago viejo pasa a revisión',async()=>{
  const original=(await createOrder({...args,paymentMethod:'mercadopago'})).order;
  const latest=await changeOrderPayment({code:original.code,email:customer.email,method:'transfer',revision:original.payment_revision,expectedTotal:2880});
  assert.equal(latest.order.payment_provider,'transfer');assert.equal(latest.order.total,2880);
  assert.equal(await applyPayment(paymentFor(original,400)),'review');
  const tracked=await trackOrder(original.code,customer.email);assert.equal(tracked.status,'review');assert.equal(tracked.paid_at,null);
 });
 await t.test('Mercado Pago recibe total exacto y confirma una sola vez',async()=>{
  const order=(await createOrder({...args,paymentMethod:'mercadopago'})).order;
  const preference=requests.filter(r=>r.url.includes('/checkout/preferences')).at(-1).body;
  assert.equal(preference.items[0].unit_price,3120);assert.equal(preference.metadata.payment_revision,1);
  assert.equal(await applyPayment(paymentFor(order,401)),'applied');assert.equal(await applyPayment(paymentFor(order,401)),'ignored');
 });
 await t.test('cupones y stock revierten juntos si la confirmación no puede completarse',async()=>{
  await db.query("INSERT INTO coupons(code,discount_type,discount_value,max_uses) VALUES('ULTIMO','fixed',300,1)");
  const order=(await createOrder({...args,couponCode:'ULTIMO'})).order;
  assert.equal(order.total,2592);
  await db.query('UPDATE products SET stock=0 WHERE id=$1',[products[0].id]);
  await assert.rejects(confirmManualPayment(order.id,admin,{reference:'X',revision:1,expectedTotal:2592}),/Stock insuficiente/);
  assert.equal((await db.query("SELECT used_count FROM coupons WHERE code='ULTIMO'")).rows[0].used_count,0);
  assert.equal((await trackOrder(order.code,customer.email)).paid_at,null);
  await db.query('UPDATE products SET stock=20 WHERE id=$1',[products[0].id]);
  await confirmManualPayment(order.id,admin,{reference:'X',revision:1,expectedTotal:2592});
  assert.equal((await db.query("SELECT used_count FROM coupons WHERE code='ULTIMO'")).rows[0].used_count,1);
 });
 await t.test('cotiza cada línea con su regla y no recotiza pedidos pagados o cancelados',async()=>{
  const q=(await db.query("INSERT INTO products(name,slug,price,active,pricing_mode,requires_quote,payment_rule,payment_percent) VALUES('A medida','medida',0,true,'quote',true,'cash_discount',12) RETURNING id")).rows[0].id;
  const requested=(await createOrder({...args,items:[items[0],{productId:q,quantity:2}]})).order;
  const quoteItem=(await db.query('SELECT id FROM order_items WHERE order_id=$1 AND is_quote',[requested.id])).rows[0].id;
  const result=await quoteOrder(requested.id,{quoteItems:{[quoteItem]:2000},generatePaymentLink:false});
  assert.equal(result.order.total,2760);assert.equal(result.order.payment_adjustment,-240);assert.equal(result.order.quoted_total,2000);
  await confirmManualPayment(requested.id,admin,{reference:'Q',revision:result.order.payment_revision,expectedTotal:2760});
  await assert.rejects(quoteOrder(requested.id,{quoteAmount:1}),/no admite/);
  const cancelled=(await createOrder({...args,items:[{productId:q,quantity:1}]})).order;
  await db.query("UPDATE orders SET status='cancelled' WHERE id=$1",[cancelled.id]);
  await assert.rejects(quoteOrder(cancelled.id,{quoteAmount:1}),/no admite/);
 });
});
