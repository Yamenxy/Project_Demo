import { normalizePhone } from '@lms/shared';
import { Pool } from 'pg';

/**
 * Makes an existing, phone-verified account a platform owner. Needed once per environment
 * (the demo seed creates its own). Runs with the platform role.
 *
 *   pnpm --filter @lms/api platform:add-owner 01012345678
 */
async function main(): Promise<void> {
  const url = process.env.DATABASE_PLATFORM_URL;
  const phone = normalizePhone(process.argv[2] ?? '');
  if (!url) throw new Error('DATABASE_PLATFORM_URL is required');
  if (!phone) throw new Error('Give the owner phone number as the argument');
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const { rows } = await pool.query<{ id: string }>(
      'select id from users where phone_e164 = $1 and phone_verified_at is not null',
      [phone],
    );
    const user = rows[0];
    if (!user) throw new Error('No verified account has this phone number');
    await pool.query(
      'insert into platform_owners (user_id, created_at) values ($1, now()) on conflict do nothing',
      [user.id],
    );
    process.stdout.write(
      'Platform owner added. They must set up two-step verification to use the console.\n',
    );
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
