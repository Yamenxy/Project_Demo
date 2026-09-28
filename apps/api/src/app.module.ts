import { Module } from '@nestjs/common';
import { CommonModule } from './common';
import { ConfigModule } from './config';
import { DatabaseModule } from './database';
import { HealthController } from './health/health.controller';
import { AuditModule } from './modules/audit';

@Module({
  imports: [ConfigModule, CommonModule, DatabaseModule, AuditModule],
  controllers: [HealthController],
})
export class AppModule {}
