import { defineConfig } from 'drizzle-kit';

// Migrations always run as the migrator role (the schema owner). See docs/architecture.md §4.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/database/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_MIGRATOR_URL ?? '' },
});
