import { Module, type OnModuleInit } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { JobsRuntime } from '../jobs';
import { IdempotencyInterceptor } from './idempotency.interceptor';

@Module({
  providers: [
    IdempotencyInterceptor,
    { provide: APP_INTERCEPTOR, useExisting: IdempotencyInterceptor },
  ],
})
export class IdempotencyModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobsRuntime,
    private readonly interceptor: IdempotencyInterceptor,
  ) {}

  onModuleInit(): void {
    this.jobs.register(
      'maintenance.idempotency_purge',
      async () => {
        await this.interceptor.purgeExpired();
      },
      '30 * * * *',
    );
  }
}
