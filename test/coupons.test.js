import assert from "node:assert/strict";
import { test } from "node:test";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { pool } = await import("../src/db.js");
const { createAdminHandlers } = await import("../src/admin.js");
const handlers = createAdminHandlers();
const response = () => ({ status(code) { this.code=code; return this; }, json(body) { this.body=body; return this; } });
const base = { code:"PRUEBA", discount_type:"percent", discount_value:10 };
test("cupón sin límite: omitir, null o vacío son válidos; un límite explícito se conserva", async t => {
  let saved;
  t.mock.method(pool,"query",async(sql,values)=>{
    if(sql.includes("INSERT INTO coupons")){saved=values[5];return {rows:[{id:"test",max_uses:saved}]};}
    return {rows:[]};
  });
  for(const value of [undefined,null,"","   ",10,"25"]){
    const res=response();await handlers.createCoupon({admin:{id:"admin"},body:{...base,...(value===undefined?{}:{max_uses:value})}},res);
    assert.equal(res.code,201);assert.equal(saved,value===10?10:value==="25"?25:null);
  }
});
test("límite inválido se rechaza antes de guardar",async t=>{
  t.mock.method(pool,"query",async()=>assert.fail("No debe guardar"));
  for(const value of [0,-1,1.5,"1.5","10abc","NaN",true,1000001]){
    await assert.rejects(handlers.createCoupon({body:{...base,max_uses:value}},response()),{name:"ValidationError",field:"max_uses"});
  }
});
test("editar permite quitar el límite y omitirlo no lo modifica",async t=>{
  let sqlSaved,valuesSaved;
  t.mock.method(pool,"query",async(sql,values)=>{
    if(sql.includes("UPDATE coupons")){sqlSaved=sql;valuesSaved=values;return {rows:[{id:"test"}]};}return {rows:[]};
  });
  for(const value of [null,"","  "]){await handlers.updateCoupon({admin:{id:"admin"},params:{id:"test"},body:{max_uses:value}},response());assert.equal(valuesSaved[0],null);}
  await handlers.updateCoupon({admin:{id:"admin"},params:{id:"test"},body:{active:true}},response());assert.ok(!sqlSaved.includes("max_uses"));
});
