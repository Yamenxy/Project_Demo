import { createLocalLoginRoles, runMigrations } from '../migrations';

/**
 * Local development only: applies migrations and creates the local login users named in
 * DATABASE_URL and DATABASE_PLATFORM_URL.
 */
async function main(): Promise<void> {
  if (process.env.DEPLOY_TIER !== 'local') {
    throw new Error('dev-setup only runs with DEPLOY_TIER=local');
  }
  const migratorUrl = required('DATABASE_MIGRATOR_URL');
  await runMigrations(migratorUrl);
  await createLocalLoginRoles(migratorUrl, [
    { ...credentials(required('DATABASE_URL')), group: 'app_runtime' },
    { ...credentials(required('DATABASE_PLATFORM_URL')), group: 'app_platform' },
  ]);
  process.stdout.write('Local database ready\n');
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function credentials(url: string): { name: string; password: string } {
  const parsed = new URL(url);
  return {
    name: decodeURIComponent(parsed.username),
    password: decodeURIComponent(parsed.password),
  };
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
