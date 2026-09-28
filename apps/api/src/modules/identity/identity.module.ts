import { Module, type OnModuleInit } from '@nestjs/common';
import { JobsRuntime } from '../../jobs';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { RateLimiter } from './rate-limiter';
import { SessionGuard } from './session.guard';
import { SessionsService } from './sessions.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, SessionsService, RateLimiter, SessionGuard],
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
