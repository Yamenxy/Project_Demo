import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { PgBoss } from 'pg-boss';
import { Client, Pool } from 'pg';
import { bossOptions } from '../jobs/boss';
import { QUEUES } from '../jobs/queues';

/** apps/api/drizzle, resolved the same way from src/ (tsx, tests) and dist/ (built code). */
export const MIGRATIONS_FOLDER = path.resolve(__dirname, '..', '..', 'drizzle');

/**
 * Applies pending SQL migrations, then installs or upgrades the job queue schema and its queues.
 * Must run as the migrator role (the schema owner).
 */
export async function runMigrations(migratorUrl: string): Promise<void> {
  const pool = new Pool({ connectionString: migratorUrl, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: MIGRATIONS_FOLDER });
  } finally {
    await pool.end();
  }
  await installJobQueue(migratorUrl);
}

async function installJobQueue(migratorUrl: string): Promise<void> {
  const boss = new PgBoss({
    ...bossOptions(migratorUrl),
    createSchema: true,
    migrate: true,
    supervise: false,
    schedule: false,
    max: 1,
  });
  let failure: Error | undefined;
  boss.on('error', (err) => {
    failure ??= err;
  });
  await boss.start();
  try {
    for (const [name, options] of Object.entries(QUEUES)) {
      const [existing] = await boss.getQueues([name]);
      if (existing) await boss.updateQueue(name, options);
      else await boss.createQueue(name, options);
    }
  } finally {
    await boss.stop({ graceful: false, close: true });
  }
  if (failure) throw failure;

  // Default privileges (migration 0002) cover new objects; this also covers objects from
  // earlier pg-boss versions.
  const client = new Client({ connectionString: migratorUrl });
  await client.connect();
  try {
    await client.query(
      'grant select, insert, update, delete on all tables in schema pgboss to app_runtime',
    );
    await client.query('grant usage, select on all sequences in schema pgboss to app_runtime');
    await client.query('grant execute on all functions in schema pgboss to app_runtime');
  } finally {
    await client.end();
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
