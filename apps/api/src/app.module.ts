import { Module } from '@nestjs/common';
import { ConfigModule } from './config';
import { DatabaseModule } from './database';
import { HealthController } from './health/health.controller';

@Module({
  imports: [ConfigModule, DatabaseModule],
  controllers: [HealthController],
})
export class AppModule {}
