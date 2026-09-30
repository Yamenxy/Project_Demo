import { Module, type OnModuleInit } from '@nestjs/common';
import { JobsRuntime } from '../../jobs';
import { FilesModule } from '../files';
import { BillingController } from './billing.controller';
import { PlatformController } from './platform.controller';
import { AnonymizeService } from './anonymize.service';
import { PlatformService } from './platform.service';
import { CommentReportsController } from './reports.controller';
import { CommentReportsService } from './reports.service';
import { RetentionService } from './retention.service';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  imports: [FilesModule],
  controllers: [PlatformController, BillingController, CommentReportsController, SupportController],
  providers: [
    PlatformService,
    CommentReportsService,
    SupportService,
    AnonymizeService,
    RetentionService,
  ],
  exports: [PlatformService],
})
export class PlatformAdminModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsRuntime,
    private readonly platform: PlatformService,
    private readonly anonymizer: AnonymizeService,
    private readonly retention: RetentionService,
  ) {}

  onModuleInit(): void {
    // Hourly: grace ends and reminders go out close to the right time; the check is idempotent.
    this.jobs.register(
      'billing.subscription_check',
      () => this.platform.checkSubscriptions(),
      '5 * * * *',
    );
    // Nightly (00:30 UTC): accounts whose 14 days to change their mind are over (REQ-PRIV-003).
    this.jobs.register(
      'privacy.anonymize',
      () => this.anonymizer.run().then(() => undefined),
      '30 0 * * *',
    );
    // Nightly (01:00 UTC): the retention table (REQ-PRIV-002, docs/retention.md).
    this.jobs.register(
      'retention.run',
      () => this.retention.run().then(() => undefined),
      '0 1 * * *',
    );
  }
}
