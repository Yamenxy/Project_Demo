import { Global, Inject, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { APP_CONFIG, type AppConfig } from '../config';
import { PlatformDb } from './platform-db';
import { assertApplicationRole } from './role-check';
import { TenantDb } from './tenant-db';
import { PLATFORM_POOL, RUNTIME_POOL } from './types';

@Global()
@Module({
  providers: [
    {
      provide: RUNTIME_POOL,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        new Pool({ connectionString: config.databaseUrl, max: config.databasePoolMax }),
    },
    {
      provide: PLATFORM_POOL,
      inject: [APP_CONFIG],
      // The platform handle is used rarely (admin console, support sessions).
      useFactory: (config: AppConfig) =>
        new Pool({ connectionString: config.databasePlatformUrl, max: 2 }),
    },
    TenantDb,
    PlatformDb,
  ],
  exports: [TenantDb, PlatformDb],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(
    @Inject(RUNTIME_POOL) private readonly runtimePool: Pool,
    @Inject(PLATFORM_POOL) private readonly platformPool: Pool,
  ) {}

  /** Called from main.ts before the server listens. */
  async verifyRoles(): Promise<void> {
    await assertApplicationRole(this.runtimePool, 'app_runtime');
    await assertApplicationRole(this.platformPool, 'app_platform');
  }

  async onApplicationShutdown(): Promise<void> {
    await Promise.all([this.runtimePool.end(), this.platformPool.end()]);
  }
}
