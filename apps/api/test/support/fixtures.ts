import { randomInt, randomUUID } from 'node:crypto';
import { Client } from 'pg';
import { inject } from 'vitest';

/** Runs SQL as the migrator (schema owner), bypassing every policy. For test fixtures only. */
export async function adminQuery<T extends object>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const client = new Client({ connectionString: inject('databaseUrls').admin });
  await client.connect();
  try {
    return (await client.query<T>(text, values)).rows;
  } finally {
    await client.end();
  }
}

/** Inserts an active user with a verified random phone. The password hash is a placeholder. */
export async function insertUser(status = 'active'): Promise<string> {
  const id = randomUUID();
  const phone = `+2010${String(randomInt(10_000_000, 99_999_999))}`;
  const code = Array.from(
    { length: 8 },
    () => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[randomInt(32)],
  ).join('');
  await adminQuery(
    `insert into users (id, platform_code, name_ar, phone_e164, phone_verified_at, status,
                        password_hash, password_changed_at, created_at, updated_at)
     values ($1, $2, 'مستخدم تجريبي', $3, now(), $4, 'not-a-real-hash', now(), now(), now())`,
    [id, code, phone, status],
  );
  return id;
}

/** Inserts a workspace owned by the given user, with its owner membership. */
export async function insertWorkspace(ownerUserId: string): Promise<string> {
  const id = randomUUID();
  await adminQuery(
    `insert into workspaces (id, slug, name, owner_user_id, created_at, updated_at)
     values ($1, $2, 'مساحة تجريبية', $3, now(), now())`,
    [id, `ws-${id.slice(0, 8)}`, ownerUserId],
  );
  await insertMembership(id, ownerUserId, 'owner');
  return id;
}

export async function insertMembership(
  workspaceId: string,
  userId: string | null,
  role: string,
  extra: Record<string, unknown> = {},
): Promise<string> {
  const id = randomUUID();
  const columns = ['workspace_id', 'id', 'user_id', 'role', 'created_at', 'updated_at'];
  const values: unknown[] = [workspaceId, id, userId, role, new Date(), new Date()];
  for (const [column, value] of Object.entries(extra)) {
    columns.push(column);
    values.push(value);
  }
  const placeholders = values.map((_, i) => `$${String(i + 1)}`).join(', ');
  await adminQuery(
    `insert into memberships (${columns.join(', ')}) values (${placeholders})`,
    values,
  );
  return id;
}
