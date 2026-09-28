import { runMigrations } from '../migrations';

async function main(): Promise<void> {
  const url = process.env.DATABASE_MIGRATOR_URL;
  if (!url) throw new Error('DATABASE_MIGRATOR_URL is required');
  await runMigrations(url);
  process.stdout.write('Migrations applied\n');
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
