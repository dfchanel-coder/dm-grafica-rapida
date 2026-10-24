/** Diagnóstico de solo lectura. No imprime credenciales, cuentas ni datos de clientes. */
import "dotenv/config";
import { pool } from "../src/db.js";
try {
  const tables = (await pool.query(`SELECT c.relname AS table_name, c.relrowsecurity AS rls
    FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY c.relname`)).rows;
  const grants = (await pool.query(`SELECT grantee, table_name, privilege_type FROM information_schema.role_table_grants
    WHERE table_schema = 'public' AND grantee IN ('anon','authenticated','PUBLIC') ORDER BY table_name,grantee`)).rows;
  const adminCounts = (await pool.query(`SELECT role, active, mfa_enabled, COUNT(*)::int AS count
    FROM admin_users GROUP BY role,active,mfa_enabled ORDER BY role,active,mfa_enabled`)).rows;
  console.log(JSON.stringify({ environment: {
    production: process.env.NODE_ENV === 'production',
    publicHttps: (process.env.PUBLIC_BASE_URL || '').startsWith('https://'),
    mfaKeyConfigured: /^[a-f0-9]{64}$/i.test(process.env.ADMIN_MFA_KEY || ''),
    securityRecipientConfigured: Boolean(process.env.SECURITY_NOTIFICATION_EMAIL || process.env.ADMIN_NOTIFICATION_EMAIL),
    emailConfigured: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM),
    explicitDatabaseTls: process.env.DATABASE_SSL === 'true'
  }, adminCounts, tables, apiRoleGrants: grants }, null, 2));
} catch (error) { console.error('No se pudo completar el diagnóstico. Verificá conexión y migraciones. Tipo:',error.name); process.exitCode = 1; }
finally { await pool.end(); }
