import { Module, type OnModuleInit } from '@nestjs/common';
import { JobsRuntime } from '../../jobs';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { ConsoleOtpSender, OtpSender } from './otp/otp-sender';
import { OtpService } from './otp/otp.service';
import { RateLimiter } from './rate-limiter';
import { RecoveryController } from './recovery.controller';
import { RecoveryService } from './recovery.service';
import { SessionGuard } from './session.guard';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [AuthController, RecoveryController],
  providers: [
    AuthService,
    SessionsService,
    RateLimiter,
    SessionGuard,
    OtpService,
    RecoveryService,
    // Only the console sender exists until WhatsApp is set up; config forbids it in production.
    { provide: OtpSender, useClass: ConsoleOtpSender },
  ],
  exports: [SessionsService, SessionGuard, RateLimiter],
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
