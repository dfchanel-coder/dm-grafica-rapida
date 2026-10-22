import pg from "pg";

const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL no está configurada. Revisá el archivo .env.");
}

// Render entrega una URL interna sin TLS. La URL externa sí lo usa.
const useSsl = process.env.DATABASE_SSL === "true"
  ? {
    rejectUnauthorized: true,
    ...(process.env.DATABASE_SSL_CA ? { ca: process.env.DATABASE_SSL_CA.replace(/\\n/g, "\n") } : {}),
  }
  : undefined;

export const pool = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX || 8),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  ...(useSsl ? { ssl: useSsl } : {}),
});

pool.on("error", (error) => {
  console.error("Error inesperado del pool de PostgreSQL:", error?.message || "Error");
});
