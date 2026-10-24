import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import sharp from "sharp";
import { TOTP, Secret } from "otpauth";
process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
process.env.ADMIN_MFA_KEY = "ab".repeat(32);
const { pool } = await import("../src/db.js");
const { hashPassword, verifyPassword, createAdminSession, readAdminSession, requireCsrf } = await import("../src/auth.js");
const { consumeLoginLimit, requireOwner, requireRecentAuth, reauthenticate } = await import("../src/admin-security.js");
const { beginMfa, enableMfa, verifySecondFactor, disableMfa } = await import("../src/admin-mfa.js");
const { createAdminHandlers } = await import("../src/admin.js");
const { sanitizeImage, uploadImage } = await import("../src/storage.js");
const response = () => ({ code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });

test("imágenes: decodifica, limita y recodifica sin confiar en el MIME", async t => {
  await assert.rejects(sanitizeImage(Buffer.from("no es PNG"), "image/png"));
  const png = await sharp({ create: { width: 10, height: 10, channels: 4, background: "red" } }).png().toBuffer();
  await assert.rejects(sanitizeImage(png, "image/jpeg"));
  const result = await sanitizeImage(png, "image/png");
  assert.equal((await sharp(result).metadata()).format, "webp");
  assert.equal((await sharp(result).metadata()).exif, undefined);
  await assert.rejects(sanitizeImage(Buffer.alloc(4 * 1024 * 1024 + 1), "image/png"));
  const oversized = await sharp({ create: { width: 5100, height: 5100, channels: 3, background: "red" } }).png().toBuffer();
  await assert.rejects(sanitizeImage(oversized, "image/png"));
  process.env.SUPABASE_URL = "https://example.invalid"; process.env.SUPABASE_BUCKET = "test"; process.env.SUPABASE_SERVICE_ROLE_KEY = "dummy";
  let requests = 0;
  t.mock.method(globalThis, "fetch", async () => { requests++; return { ok: true }; });
  await assert.rejects(uploadImage({ buffer: Buffer.from("invalid"), contentType: "image/png", filename: "bad.png" }));
  assert.equal(requests, 0);
});

test("seguridad SQL: conserva acceso, revoca sesiones y protege MFA", async t => {
  const db = new PGlite(); t.after(() => db.close());
  const files = (await readdir(new URL('../migrations/', import.meta.url))).filter(x => x.endsWith('.sql')).sort();
  for (const file of files.filter(x => !x.startsWith('0011'))) await db.exec(await readFile(new URL('../migrations/'+file, import.meta.url), 'utf8'));
  const password = 'PruebaLocal2026!';
  const owner = (await db.query("INSERT INTO admin_users(email,name,password_hash) VALUES('owner@example.com','Dueño',$1) RETURNING id", [hashPassword(password)])).rows[0].id;
  const query = async (sql, values = []) => { const result = await db.query(sql, values); return { ...result, rowCount: result.affectedRows ?? result.rows.length }; };
  t.mock.method(pool, 'query', query); t.mock.method(pool, 'connect', async () => ({ query, release() {} }));
  await db.query("INSERT INTO admin_sessions(admin_id,token_hash,csrf_token,expires_at) VALUES($1,'old','old',NOW()+INTERVAL '12 hours')",[owner]);
  await db.exec(await readFile(new URL('../migrations/0011_admin_security.sql', import.meta.url), 'utf8'));
  await t.test('migración preserva contraseña, permisos, estado y sesiones existentes', async () => {
    const row = (await db.query('SELECT * FROM admin_users WHERE id=$1',[owner])).rows[0];
    assert.equal(row.role, 'owner'); assert.equal(row.active, true); assert.equal(row.mfa_enabled, false);
    assert.equal(await verifyPassword(password,row.password_hash), true);
    assert.equal((await db.query('SELECT count(*)::int AS n FROM admin_sessions')).rows[0].n,1);
  });
  const actor = { id: owner, role: 'owner', email: 'owner@example.com' };
  const session = await createAdminSession(owner);
  const req = { headers: { cookie: `dm_admin_session=${session.token}` } };
  const sessionInfo = await readAdminSession(req);
  await t.test('roles y reautenticación se exigen en servidor', async () => {
    let next = false; let res = response();
    requireOwner({admin:{role:'operator'}},res,()=>{next=true;}); assert.equal(res.code,403); assert.equal(next,false);
    requireOwner({admin:actor},response(),()=>{next=true;}); assert.equal(next,true);
    res=response(); requireRecentAuth({adminSession:{reauthenticatedAt:null}},res,()=>assert.fail()); assert.equal(res.body.code,'reauth_required');
    res=response(); requireCsrf({get:()=>'',adminSession:{csrfToken:'valid'}},res,()=>assert.fail()); assert.equal(res.code,403);
    const handlers=createAdminHandlers(); res=response();
    await handlers.updateAdmin({params:{id:owner},admin:actor,body:{active:false}},res); assert.equal(res.code,400);
    await assert.rejects(db.query("UPDATE admin_users SET role='operator' WHERE id=$1",[owner]));
  });
  await t.test('limitador persistente cuenta intentos y recupera después del plazo', async () => {
    assert.equal(await consumeLoginLimit('test','value',2),true); assert.equal(await consumeLoginLimit('test','value',2),true); assert.equal(await consumeLoginLimit('test','value',2),false);
    await db.query("UPDATE admin_login_limits SET expires_at=NOW()-INTERVAL '1 second'");
    assert.equal(await consumeLoginLimit('test','value',2),true);
  });
  const mfaReq={admin:actor,adminSession:sessionInfo,body:{}};
  await t.test('MFA opcional solo se activa con prueba del autenticador; recuperación de un uso', async () => {
    assert.equal(await verifySecondFactor(owner,''),true);
    let res=response();await beginMfa(mfaReq,res);const secret=res.body.secret;
    assert.ok(secret);assert.ok(!(await db.query('SELECT mfa_pending FROM admin_sessions WHERE id=$1',[sessionInfo.sessionId])).rows[0].mfa_pending.includes(secret));
    const totp=new TOTP({secret:Secret.fromBase32(secret),algorithm:'SHA1',digits:6,period:30});
    const code=totp.generate();res=response();await enableMfa({...mfaReq,body:{code}},res);assert.equal(res.body.recovery.length,10);
    assert.ok(await readAdminSession(req));
    assert.equal(await verifySecondFactor(owner,'wrong'),false);
    assert.equal(await verifySecondFactor(owner,code),false);
    const nextCode=totp.generate({timestamp:Date.now()+30000});
    assert.equal(await verifySecondFactor(owner,nextCode),true);
    assert.equal(await verifySecondFactor(owner,nextCode),false);
    const recovery=res.body.recovery[0];
    assert.equal(await verifySecondFactor(owner,recovery),true);assert.equal(await verifySecondFactor(owner,recovery),false);
    let bad=response();await reauthenticate({...mfaReq,body:{password,code:'wrong'}},bad);assert.equal(bad.code,403);
    let good=response();await reauthenticate({...mfaReq,body:{password,code:res.body.recovery[1]}},good);assert.equal(good.code,200);
    await disableMfa(mfaReq,response());assert.equal(await verifySecondFactor(owner,''),true);
  });
  await t.test('contraseñas cambiadas por SQL revocan sesiones, sin depender del panel',async()=>{
    await db.query('UPDATE admin_users SET password_hash=$2 WHERE id=$1',[owner,hashPassword('NuevaPrueba2026!')]);
    assert.equal(await readAdminSession(req),null);
  });
  await t.test('desactivar y reactivar no resucita sesiones antiguas',async()=>{
    const other=(await db.query("INSERT INTO admin_users(email,name,password_hash) VALUES('operator@example.com','Operador',$1) RETURNING id,role",[hashPassword(password)])).rows[0];assert.equal(other.role,'operator');
    const old=await createAdminSession(other.id);
    await db.query('UPDATE admin_users SET active=false WHERE id=$1',[other.id]);await db.query('UPDATE admin_users SET active=true WHERE id=$1',[other.id]);
    assert.equal(await readAdminSession({headers:{cookie:`dm_admin_session=${old.token}`}}),null);
  });
});
