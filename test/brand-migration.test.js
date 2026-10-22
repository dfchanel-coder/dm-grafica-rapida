import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

test("brand migration updates former defaults without replacing administrator customizations", async (t) => {
  const db = new PGlite();
  t.after(() => db.close());
  await db.exec("CREATE TABLE settings (key text PRIMARY KEY, value jsonb NOT NULL, updated_at timestamptz DEFAULT now())");
  const sql = await readFile(new URL("../migrations/0006_brand_identity.sql", import.meta.url), "utf8");
  const original = {
    business: { name: "DM Gráfica Rápida", tagline: "Mi lema", phone: "123" },
    brand: { logo_url: "/brand/logodm.jpeg", primary: "#123456" },
    home: { hero_title: "Tu marca, hecha posible", hero_subtitle: "Mi mensaje", hero_cta: "Cotizar ahora" },
    footer: { copyright_name: "Mi razón social" },
  };
  await db.query("INSERT INTO settings (key, value) VALUES ('site',$1)", [JSON.stringify(original)]);
  await db.exec(sql);
  const migrated = (await db.query("SELECT value FROM settings WHERE key='site'")).rows[0].value;
  assert.deepEqual(migrated, {
    ...original,
    business: { ...original.business, name: "DM Comunicación Visual" },
    brand: { ...original.brand },
    home: { ...original.home, hero_title: "Hacemos que te vean." },
  });
  await db.exec(sql);
  assert.deepEqual((await db.query("SELECT value FROM settings WHERE key='site'")).rows[0].value, migrated);
});
