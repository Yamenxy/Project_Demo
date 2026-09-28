import { Module } from '@nestjs/common';
import { ConfigModule } from './config';
import { HealthController } from './health/health.controller';

@Module({
  imports: [ConfigModule],
  controllers: [HealthController],
})
export class AppModule {}
