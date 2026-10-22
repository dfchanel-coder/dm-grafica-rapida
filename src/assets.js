import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

// Una versión para todo el árbol mantiene también los imports relativos de JS.
export async function assetVersion(roots) {
  const hash = createHash("sha256");
  async function visit(root, relative = "") {
    const entries = await readdir(path.join(root, relative), { withFileTypes: true });
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) await visit(root, name);
      else if (entry.isFile()) {
        hash.update(name.replaceAll("\\", "/"));
        hash.update(await readFile(path.join(root, name)));
      }
    }
  }
  for (const root of roots) await visit(root);
  return hash.digest("hex").slice(0, 16);
}

export function versionAssetLinks(html, version) {
  return html.replace(/\b(src|href)=(['"])(\/(?:css|js|img|brand)\/[^'"]+)\2/g,
    (_match, attr, quote, url) => `${attr}=${quote}/assets/${version}${url}${quote}`);
}
