import { randomBytes } from 'node:crypto';
import { Pool } from 'pg';
import { loadConfig } from '../../config';
import { seedDemoData } from '../seed';

/**
 * Loads synthetic demo data (local, demo and staging tiers only). Prints the logins, including
 * each 2FA account's authenticator key. Uses the platform role, which may write every workspace.
 */
async function main(): Promise<void> {
  const config = loadConfig(process.env);
  if (config.deployTier === 'production' || config.dataClass !== 'synthetic') {
    throw new Error('The demo seed only runs on synthetic, non-production tiers');
  }
  const password = process.env.DEMO_PASSWORD ?? `demo-${randomBytes(4).toString('hex')}`;
  const pool = new Pool({ connectionString: config.databasePlatformUrl, max: 1 });
  try {
    const result = await seedDemoData(pool, {
      password,
      secretEncryptionKey: config.secretEncryptionKey,
    });
    if (!result.created) {
      process.stdout.write('Demo data already present; nothing changed.\n');
      return;
    }
    process.stdout.write(`Demo password for every account: ${result.password}\n\n`);
    for (const login of result.logins) {
      const totp = login.totpSecret ? `  authenticator key: ${login.totpSecret}` : '';
      process.stdout.write(`${login.role.padEnd(13)} ${login.phone}  ${login.name}${totp}\n`);
    }
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
