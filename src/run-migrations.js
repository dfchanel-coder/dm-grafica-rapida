import "dotenv/config";

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { pool } from "./db.js";

const dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationDir = path.resolve(dirname, "../migrations");

async function run() {
  await pool.query(`CREATE TABLE IF NOT EXISTS app_migrations (
    version text PRIMARY KEY,
    applied_at timestamptz NOT NULL DEFAULT now()
  )`);

  const migrations = (await fs.readdir(migrationDir))
    .filter((filename) => /^\d{4}_[a-z0-9_-]+\.sql$/i.test(filename))
    .sort((left, right) => left.localeCompare(right, "en"));

  for (const filename of migrations) {
    const alreadyApplied = await pool.query(
      "SELECT 1 FROM app_migrations WHERE version = $1",
      [filename],
    );
    if (alreadyApplied.rowCount) {
      console.log(`${filename} ya estaba aplicada.`);
      continue;
    }

    const sql = await fs.readFile(path.resolve(migrationDir, filename), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO app_migrations (version) VALUES ($1)", [filename]);
      await client.query("COMMIT");
      console.log(`${filename} aplicada correctamente.`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw new Error(`Falló la migración ${filename}: ${error?.message || "Error"}`);
    } finally {
      client.release();
    }
  }
}

try {
  await run();
} catch (error) {
  console.error(error?.message || "Error al aplicar migraciones.");
  process.exitCode = 1;
} finally {
  await pool.end();
}
