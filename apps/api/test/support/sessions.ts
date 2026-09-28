import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TenantDb } from '../../src/database';
import { SessionsService } from '../../src/modules/identity';
import { adminQuery } from './fixtures';

/**
 * Signs a fixture user in directly (no password round-trip) and returns the session token.
 * With `twoFactor`, the account is marked as enrolled and the session as verified, as an owner
 * or class teacher needs.
 */
export async function signIn(
  app: NestFastifyApplication,
  userId: string,
  options: { twoFactor?: boolean } = {},
): Promise<string> {
  if (options.twoFactor) {
    await adminQuery(
      `update users set totp_secret_encrypted = 'v1.fixture', totp_enabled_at = now()
        where id = $1`,
      [userId],
    );
  }
  const sessions = app.get(SessionsService);
  const created = await app
    .get(TenantDb)
    .transaction((tx) => sessions.create(tx, userId, { remember: false }));
  return created.token;
}
