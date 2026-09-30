import { Module, type OnModuleInit } from '@nestjs/common';
import { JobsRuntime } from '../../jobs';
import { BillingController } from './billing.controller';
import { PlatformController } from './platform.controller';
import { AnonymizeService } from './anonymize.service';
import { PlatformService } from './platform.service';
import { CommentReportsController } from './reports.controller';
import { CommentReportsService } from './reports.service';
import { SupportController } from './support.controller';
import { SupportService } from './support.service';

@Module({
  controllers: [PlatformController, BillingController, CommentReportsController, SupportController],
  providers: [PlatformService, CommentReportsService, SupportService, AnonymizeService],
  exports: [PlatformService],
})
export class PlatformAdminModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsRuntime,
    private readonly platform: PlatformService,
    private readonly anonymizer: AnonymizeService,
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
  }
}
