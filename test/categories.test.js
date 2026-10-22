import assert from "node:assert/strict";
import { test } from "node:test";

process.env.DATABASE_URL = "postgresql://test:test@127.0.0.1:1/test";
const { pool } = await import("../src/db.js");
const { createAdminHandlers } = await import("../src/admin.js");
const handlers = createAdminHandlers();
const root = "12345678-1234-1234-1234-123456789abc";
const child = "12345678-1234-1234-1234-123456789abd";
function response() {
  return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

test("categoría rechaza superior inválida, inexistente o de tercer nivel", async (t) => {
  t.mock.method(pool, "query", async (_sql, values) => ({ rows: values[0] === child ? [{ id: child, parent_id: root }] : [] }));
  for (const parent_id of ["invalid", root, child]) {
    await assert.rejects(handlers.createCategory({ body: { name: "Nueva", parent_id } }, response()), { name: "ValidationError", field: "parent_id" });
  }
});

test("categoría rechaza autorreferencia y convertir raíz con hijos en subcategoría", async (t) => {
  t.mock.method(pool, "query", async (sql) => ({ rows: sql.includes("WHERE parent_id") ? [{ id: child }] : [{ id: child, parent_id: null }] }));
  for (const parent_id of [root, child]) {
    await assert.rejects(handlers.updateCategory({ params: { id: root }, body: { parent_id } }, response()), { name: "ValidationError", field: "parent_id" });
  }
});

test("crear subcategoría conserva superior y permite reutilizar su id", async (t) => {
  t.mock.method(pool, "query", async (sql, values) => {
    if (sql.startsWith("SELECT")) return { rows: [{ id: root, parent_id: null }] };
    if (sql.startsWith("INSERT INTO categories")) {
      assert.equal(values[5], root);
      return { rows: [{ id: child, name: values[0], parent_id: values[5] }] };
    }
    return { rows: [] };
  });
  const res = response();
  await handlers.createCategory({ admin: { id: root }, body: { name: "Especial", parent_id: root } }, res);
  assert.equal(res.code, 201);
  assert.equal(res.body.category.parent_id, root);
});

test("productos rechazan categorías inválidas e inexistentes antes de guardar", async (t) => {
  t.mock.method(pool, "query", async () => ({ rows: [] }));
  for (const category_id of ["invalid", root]) {
    await assert.rejects(handlers.updateProduct({ params: { id: child }, body: { category_id } }, response()), { name: "ValidationError", field: "category_id" });
  }
});

test("borrado bloqueado por productos o hijos devuelve explicación y 409", async (t) => {
  t.mock.method(pool, "query", async () => { throw Object.assign(new Error("FK"), { code: "23503" }); });
  const res = response();
  await handlers.deleteCategory({ params: { id: root } }, res);
  assert.equal(res.code, 409);
  assert.match(res.body.error, /productos o subcategorías/);
});

test("carrera al guardar superior se informa como validación", async (t) => {
  t.mock.method(pool, "query", async (sql) => {
    if (sql.startsWith("SELECT")) return { rows: [{ id: root, parent_id: null }] };
    throw Object.assign(new Error("depth"), { code: "23514" });
  });
  await assert.rejects(handlers.createCategory({ body: { name: "Nueva", parent_id: root } }, response()), { name: "ValidationError", field: "parent_id" });
});
