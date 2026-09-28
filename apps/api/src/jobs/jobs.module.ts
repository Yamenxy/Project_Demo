import { Global, Module } from '@nestjs/common';
import { JobsRuntime } from './jobs.runtime';
import { MaintenanceJobs } from './maintenance';

@Global()
@Module({
  providers: [JobsRuntime, MaintenanceJobs],
  exports: [JobsRuntime],
})
export class JobsModule {}
