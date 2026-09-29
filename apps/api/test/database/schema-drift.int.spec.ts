import { is } from 'drizzle-orm';
import { getTableConfig, PgTable } from 'drizzle-orm/pg-core';
import { Client } from 'pg';
import { describe, expect, inject, it } from 'vitest';
import * as schema from '../../src/database/schema';

/**
 * Migrations are hand-written SQL; the Drizzle tables only mirror them. This test fails when a
 * Drizzle table and the migrated database disagree on columns, types or nullability.
 */
const urls = inject('databaseUrls');

interface DbColumn {
  column_name: string;
  data_type: string;
  is_nullable: 'YES' | 'NO';
  udt_name: string;
}

const tables: PgTable[] = (Object.values(schema) as unknown[]).filter((value): value is PgTable =>
  is(value, PgTable),
);

describe('Drizzle schema matches the migrated database', () => {
  it('has tables to check', () => {
    expect(tables.length).toBeGreaterThan(0);
  });

  it.each(tables.map((table) => [getTableConfig(table).name, table] as const))(
    '%s',
    async (name, table) => {
      const client = new Client({ connectionString: urls.admin });
      await client.connect();
      try {
        const { rows } = await client.query<DbColumn>(
          `select column_name, data_type, is_nullable, udt_name from information_schema.columns
            where table_schema = 'public' and table_name = $1 order by column_name`,
          [name],
        );
        expect(rows.length, `table ${name} exists`).toBeGreaterThan(0);
        const actual = rows.map((r) => ({
          name: r.column_name,
          // Drizzle calls it `time`; PostgreSQL reports the same type by its long name.
          type:
            r.data_type === 'time without time zone'
              ? 'time'
              : // Arrays are reported as ARRAY, with the element type in udt_name (_text).
                r.data_type === 'ARRAY'
                ? `${r.udt_name.replace(/^_/, '')}[]`
                : r.data_type,
          notNull: r.is_nullable === 'NO',
        }));
        const expected = getTableConfig(table)
          .columns.map((c) => ({ name: c.name, type: c.getSQLType(), notNull: c.notNull }))
          .sort((a, b) => a.name.localeCompare(b.name));
        expect(actual).toEqual(expected);
      } finally {
        await client.end();
      }
    },
  );
});
