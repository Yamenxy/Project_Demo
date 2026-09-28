import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

/** A Drizzle transaction handle. Services receive this, never a pool or a raw client. */
export type DbTx = Parameters<Parameters<NodePgDatabase['transaction']>[0]>[0];

export const RUNTIME_POOL = Symbol('RUNTIME_POOL');
export const PLATFORM_POOL = Symbol('PLATFORM_POOL');

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}
