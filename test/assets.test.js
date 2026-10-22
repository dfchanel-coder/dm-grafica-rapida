import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { assetVersion, versionAssetLinks } from "../src/assets.js";

test("cambiar un módulo importado renueva todas las URLs y conserva imports relativos", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "dm-assets-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, "js"));
  await writeFile(path.join(root, "js", "main.js"), 'import "./api.js";');
  await writeFile(path.join(root, "js", "api.js"), "export const value = 1;");
  const first = await assetVersion([root]);
  assert.equal(await assetVersion([root]), first);
  await writeFile(path.join(root, "js", "api.js"), "export const value = 2;");
  const second = await assetVersion([root]);
  assert.notEqual(first, second);
  const html = versionAssetLinks('<script src="/js/main.js"></script><link href="/css/base.css"><a href="/catalogo">Catálogo</a><img src="https://example.com/x.jpg">', second);
  assert.ok(html.includes(`/assets/${second}/js/main.js`));
  assert.ok(html.includes(`/assets/${second}/css/base.css`));
  assert.ok(html.includes('href="/catalogo"'));
  assert.ok(html.includes('src="https://example.com/x.jpg"'));
  assert.equal(new URL("./api.js", `https://example.com/assets/${second}/js/main.js`).pathname, `/assets/${second}/js/api.js`);
});
