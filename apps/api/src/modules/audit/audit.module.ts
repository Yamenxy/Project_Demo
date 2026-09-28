import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

/** Global: every module records audit events (review §3.24). */
@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
