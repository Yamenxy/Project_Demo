import { Module, type OnModuleInit } from '@nestjs/common';
import { JobsRuntime } from '../../jobs';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { DevicesController } from './devices/devices.controller';
import { DevicesService } from './devices/devices.service';
import { APP_CONFIG, type AppConfig } from '../../config';
import { FileOtpSender } from './otp/file-otp-sender';
import { ConsoleOtpSender, OtpSender } from './otp/otp-sender';
import { OtpService } from './otp/otp.service';
import { RateLimiter } from './rate-limiter';
import { RecoveryController } from './recovery.controller';
import { RecoveryService } from './recovery.service';
import { TwoFactorController } from './two-factor/two-factor.controller';
import { TwoFactorService } from './two-factor/two-factor.service';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [AuthController, RecoveryController, DevicesController, TwoFactorController],
  providers: [
    AuthService,
    SessionsService,
    RateLimiter,
    OtpService,
    RecoveryService,
    DevicesService,
    TwoFactorService,
    // Only development senders exist until WhatsApp is set up; config forbids them in production.
    {
      provide: OtpSender,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig): OtpSender =>
        config.otpProvider === 'file' ? new FileOtpSender(config) : new ConsoleOtpSender(),
    },
  ],
  exports: [SessionsService, RateLimiter, DevicesService],
})
export class IdentityModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsRuntime,
    private readonly rateLimiter: RateLimiter,
  ) {}

  onModuleInit(): void {
    this.jobs.register(
      'maintenance.rate_limit_purge',
      async () => {
        await this.rateLimiter.purgeExpired();
      },
      '15 * * * *',
    );
  }
}
