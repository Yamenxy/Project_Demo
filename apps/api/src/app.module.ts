import { Module } from '@nestjs/common';
import { CommonModule } from './common';
import { ConfigModule } from './config';
import { DatabaseModule } from './database';
import { HealthController } from './health/health.controller';
import { IdempotencyModule } from './idempotency';
import { JobsModule } from './jobs';
import { AuditModule } from './modules/audit';
import { ClassesModule } from './modules/classes';
import { IdentityModule } from './modules/identity';
import { NotifyModule } from './modules/notify';
import { PlatformAdminModule } from './modules/platform-admin';
import { TenancyModule } from './modules/tenancy';

@Module({
  imports: [
    ConfigModule,
    CommonModule,
    DatabaseModule,
    AuditModule,
    JobsModule,
    NotifyModule,
    IdentityModule,
    TenancyModule,
    ClassesModule,
    IdempotencyModule,
    PlatformAdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
