import { Module } from '@nestjs/common';
import { CommonModule } from './common';
import { ConfigModule } from './config';
import { DatabaseModule } from './database';
import { HealthController } from './health/health.controller';

@Module({
  imports: [ConfigModule, CommonModule, DatabaseModule],
  controllers: [HealthController],
})
export class AppModule {}
