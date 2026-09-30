import { Module } from '@nestjs/common';
import { CommonModule } from './common';
import { ConfigModule } from './config';
import { DatabaseModule } from './database';
import { HealthController } from './health/health.controller';
import { IdempotencyModule } from './idempotency';
import { JobsModule } from './jobs';
import { AnnouncementsModule } from './modules/announcements';
import { AssessmentModule } from './modules/assessment';
import { AuditModule } from './modules/audit';
import { ClassesModule } from './modules/classes';
import { ContentModule } from './modules/content';
import { FilesModule } from './modules/files';
import { GradingModule } from './modules/grading';
import { IdentityModule } from './modules/identity';
import { NotifyModule } from './modules/notify';
import { PaymentsModule } from './modules/payments';
import { PlatformAdminModule } from './modules/platform-admin';
import { TenancyModule } from './modules/tenancy';
import { VideoModule } from './modules/video';

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
    ContentModule,
    FilesModule,
    VideoModule,
    GradingModule,
    AssessmentModule,
    PaymentsModule,
    AnnouncementsModule,
    IdempotencyModule,
    PlatformAdminModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
