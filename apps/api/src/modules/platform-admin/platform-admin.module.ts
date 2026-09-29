import { Module, type OnModuleInit } from '@nestjs/common';
import { JobsRuntime } from '../../jobs';
import { BillingController } from './billing.controller';
import { PlatformController } from './platform.controller';
import { PlatformService } from './platform.service';

@Module({
  controllers: [PlatformController, BillingController],
  providers: [PlatformService],
  exports: [PlatformService],
})
export class PlatformAdminModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsRuntime,
    private readonly platform: PlatformService,
  ) {}

  onModuleInit(): void {
    // Hourly: grace ends and reminders go out close to the right time; the check is idempotent.
    this.jobs.register(
      'billing.subscription_check',
      () => this.platform.checkSubscriptions(),
      '5 * * * *',
    );
  }
}
