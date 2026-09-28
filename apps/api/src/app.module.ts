import { Module } from '@nestjs/common';
import { CommonModule } from './common';
import { ConfigModule } from './config';
import { DatabaseModule } from './database';
import { HealthController } from './health/health.controller';
import { JobsModule } from './jobs';
import { AuditModule } from './modules/audit';
import { IdentityModule } from './modules/identity';

@Module({
  imports: [ConfigModule, CommonModule, DatabaseModule, AuditModule, JobsModule, IdentityModule],
  controllers: [HealthController],
})
export class AppModule {}
