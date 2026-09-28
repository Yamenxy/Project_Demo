import { Global, Module } from '@nestjs/common';
import { DeviceLimitPolicy } from '../identity';
import { MembershipDeviceLimitPolicy } from './device-limit.policy';
import { MembershipsService } from './memberships.service';
import { WorkspacesService } from './workspaces.service';

/** Global so identity can use the role-aware device-limit policy without importing tenancy. */
@Global()
@Module({
  providers: [
    MembershipsService,
    WorkspacesService,
    { provide: DeviceLimitPolicy, useClass: MembershipDeviceLimitPolicy },
  ],
  exports: [MembershipsService, WorkspacesService, DeviceLimitPolicy],
})
export class TenancyModule {}
