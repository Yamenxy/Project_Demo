import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import type { TestProject } from 'vitest/node';
import { createLocalLoginRoles, runMigrations } from '../src/database/migrations';

export interface TestDatabaseUrls {
  /** Migrator / schema owner. Only test fixtures use it. */
  admin: string;
  runtime: string;
  platform: string;
}

declare module 'vitest' {
  export interface ProvidedContext {
    databaseUrls: TestDatabaseUrls;
  }
}

let container: StartedPostgreSqlContainer | undefined;

export default async function setup(project: TestProject): Promise<() => Promise<void>> {
  container = await new PostgreSqlContainer('postgres:17-alpine')
    .withDatabase('lms_test')
    .withUsername('lms_admin')
    .withPassword('lms_admin_test')
    .start();

  const admin = container.getConnectionUri();
  await runMigrations(admin);
  await createLocalLoginRoles(admin, [
    { name: 'lms_app', password: 'lms_app_test', group: 'app_runtime' },
    { name: 'lms_platform', password: 'lms_platform_test', group: 'app_platform' },
  ]);

  const withUser = (user: string, password: string): string => {
    const url = new URL(admin);
    url.username = user;
    url.password = password;
    return url.toString();
  };
  project.provide('databaseUrls', {
    admin,
    runtime: withUser('lms_app', 'lms_app_test'),
    platform: withUser('lms_platform', 'lms_platform_test'),
  });

  return async () => {
    await container?.stop();
  };
}
