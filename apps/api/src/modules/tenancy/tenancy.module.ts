import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DeviceLimitPolicy, IdentityModule } from '../identity';
import { AccessGuard } from './access.guard';
import { MembershipDeviceLimitPolicy } from './device-limit.policy';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { MembershipsService } from './memberships.service';
import { PermissionsService } from './permissions.service';
import { WorkspaceController } from './workspace.controller';
import { WorkspacesService } from './workspaces.service';

/**
 * Global: provides the access guard for every route (REQ-RBAC-005) and the role-aware
 * device-limit policy that identity uses without importing tenancy.
 */
@Global()
@Module({
  imports: [IdentityModule],
  controllers: [WorkspaceController, MembersController],
  providers: [
    MembershipsService,
    WorkspacesService,
    PermissionsService,
    MembersService,
    { provide: DeviceLimitPolicy, useClass: MembershipDeviceLimitPolicy },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [MembershipsService, WorkspacesService, PermissionsService, DeviceLimitPolicy],
})
export class TenancyModule {}
