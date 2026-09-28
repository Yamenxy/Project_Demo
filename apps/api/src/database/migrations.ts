import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';

/** apps/api/drizzle, resolved the same way from src/ (tsx, tests) and dist/ (built code). */
export const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', '..', 'drizzle');

/** Applies pending migrations. Must run as the migrator role (the schema owner). */
export async function runMigrations(migratorUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: migratorUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
}

export interface LoginRole {
  name: string;
  password: string;
  group: 'app_runtime' | 'app_platform';
}

/**
 * Creates (or updates) login users for local development and tests only. Real environments create
 * their users through the hosting provider, outside the codebase.
 */
export async function createLocalLoginRoles(adminUrl: string, roles: LoginRole[]): Promise<void> {
  const client = new Client({ connectionString: adminUrl });
  await client.connect();
  try {
    for (const role of roles) {
      const name = client.escapeIdentifier(role.name);
      const password = client.escapeLiteral(role.password);
      const exists = await client.query('select 1 from pg_roles where rolname = $1', [role.name]);
      const verb = exists.rowCount ? 'alter' : 'create';
      await client.query(`${verb} role ${name} with login password ${password}`);
      await client.query(`grant ${client.escapeIdentifier(role.group)} to ${name}`);
    }
  } finally {
    await client.end();
  }
}
