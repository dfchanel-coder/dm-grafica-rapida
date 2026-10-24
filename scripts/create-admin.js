/**
 * Crea (o restablece) un usuario del panel de administración.
 *
 * Uso:
 *   ADMIN_EMAIL=admin@dominio.com ADMIN_PASSWORD="una-clave-larga" npm run admin:create
 *   node scripts/create-admin.js admin@dominio.com "una-clave-larga" "Nombre Admin"
 *
 * Si el usuario ya existe, se actualiza la contraseña, el nombre y se reactiva.
 */

import "dotenv/config";

import { pool } from "../src/db.js";
import { hashPassword } from "../src/auth.js";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MIN_PASSWORD_LENGTH = 10;

function readInput() {
  const email = String(process.env.ADMIN_EMAIL || process.argv[2] || "").trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || process.argv[3] || "");
  const name = String(process.env.ADMIN_NAME || process.argv[4] || "").trim() || "Administrador";
  return { email, password, name };
}

function validate({ email, password }) {
  if (!email) {
    throw new Error("Falta el correo: pasalo como ADMIN_EMAIL o como primer argumento.");
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new Error(`"${email}" no parece un correo válido.`);
  }
  if (!password) {
    throw new Error("Falta la contraseña: pasala como ADMIN_PASSWORD o como segundo argumento.");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`La contraseña debe tener al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
  }
  if (password === password.toLowerCase() && !/[0-9]/.test(password)) {
    console.warn("Aviso: la contraseña es muy simple. Conviene combinar letras, números y símbolos.");
  }
}

async function main() {
  const input = readInput();
  validate(input);

  const passwordHash = hashPassword(input.password);
  const result = await pool.query(
    `INSERT INTO admin_users (email, name, password_hash, active, role)
     VALUES ($1, $2, $3, true, 'owner')
     ON CONFLICT (email) DO UPDATE
        SET password_hash = EXCLUDED.password_hash,
            name = EXCLUDED.name,
            active = true
     RETURNING id, email, name, (xmax = 0) AS es_nuevo`,
    [input.email, input.name, passwordHash],
  );

  const admin = result.rows[0];
  const isNew = admin.es_nuevo === true;

  console.log("");
  console.log(isNew ? "Administrador creado:" : "Administrador actualizado:");
  console.log(`  correo: ${admin.email}`);
  console.log(`  nombre: ${admin.name}`);
  console.log("");
  console.log("Entrá al panel en /admin con ese correo y la contraseña indicada.");
  console.log("");
}

main()
  .catch((error) => {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
