import { Module } from '@nestjs/common';
import { CommonModule } from './common';
import { ConfigModule } from './config';
import { DatabaseModule } from './database';
import { HealthController } from './health/health.controller';
import { IdempotencyModule } from './idempotency';
import { JobsModule } from './jobs';
import { AuditModule } from './modules/audit';
import { IdentityModule } from './modules/identity';
import { TenancyModule } from './modules/tenancy';

@Module({
  imports: [
    ConfigModule,
    CommonModule,
    DatabaseModule,
    AuditModule,
    JobsModule,
    IdentityModule,
    TenancyModule,
    IdempotencyModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
