/**
 * Revisa que los archivos de texto del proyecto estén en UTF-8 válido y que
 * no contengan caracteres fuera del juego habitual (CJK, emoji rotos, controles).
 *
 * Uso: node scripts/check-text.js
 * Devuelve código de salida 1 si encuentra algún problema.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(dirname, "..");

const SKIP_DIRS = new Set(["node_modules", ".git", "data", "coverage"]);
const EXTENSIONS = new Set([".html", ".js", ".css", ".sql", ".json", ".md", ".yaml", ".yml", ".txt"]);

// Caracteres aceptados: ASCII, latín extendido, signos habituales y los
// rangos de diacríticos que usamos en las expresiones regulares.
const ALLOWED = [
  [0x00, 0x7f],
  [0xa0, 0xff],
  [0x2010, 0x2027],
  [0x2030, 0x205e],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
  [0x2190, 0x21ff],
  [0x2200, 0x22ff],
  [0x2500, 0x25ff],
  [0x2600, 0x27bf],
  [0x0300, 0x036f],
];

function isAllowed(codePoint) {
  return ALLOWED.some(([from, to]) => codePoint >= from && codePoint <= to);
}

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      yield* walk(full);
      continue;
    }
    if (EXTENSIONS.has(path.extname(entry.name).toLowerCase())) yield full;
  }
}

const problems = [];

for await (const file of walk(projectRoot)) {
  const buffer = await fs.readFile(file);
  const text = buffer.toString("utf8");

  // UTF-8 inválido: Node reemplaza los bytes rotos por U+FFFD.
  if (text.includes("\uFFFD")) {
    const lines = text.split("\n");
    lines.forEach((line, index) => {
      if (line.includes("\uFFFD")) {
        problems.push({ file, line: index + 1, kind: "utf8-invalido", text: line.trim().slice(0, 120) });
      }
    });
    continue;
  }

  text.split("\n").forEach((line, index) => {
    for (const character of line) {
      const codePoint = character.codePointAt(0);
      if (!isAllowed(codePoint)) {
        problems.push({
          file,
          line: index + 1,
          kind: "caracter-inesperado",
          text: `${character} (U+${codePoint.toString(16).toUpperCase().padStart(4, "0")}) ${line.trim().slice(0, 100)}`,
        });
        break;
      }
    }
    if (line.includes("\u0000")) {
      problems.push({ file, line: index + 1, kind: "caracter-nulo", text: line.trim().slice(0, 100) });
    }
  });
}

if (problems.length === 0) {
  console.log("OK: todos los archivos de texto están en UTF-8 válido y sin caracteres extraños.");
  process.exit(0);
}

console.log(`Se encontraron ${problems.length} problemas:\n`);
for (const problem of problems) {
  console.log(`${path.relative(projectRoot, problem.file)}:${problem.line}  [${problem.kind}]`);
  console.log(`    ${problem.text}`);
}
process.exit(1);
