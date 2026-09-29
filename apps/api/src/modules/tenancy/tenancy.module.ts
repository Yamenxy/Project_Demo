import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DeviceLimitPolicy, IdentityModule } from '../identity';
import { AccessGuard } from './access.guard';
import { MembershipDeviceLimitPolicy } from './device-limit.policy';
import { InvitationsService } from './invitations.service';
import { MeController } from './me.controller';
import { PublicPageSettingsController, PublicTeacherController } from './public-page.controller';
import { PublicPageService } from './public-page.service';
import { MembersController } from './members.controller';
import { MembersService } from './members.service';
import { MembershipsService } from './memberships.service';
import { PermissionsService } from './permissions.service';
import { InvitationAcceptController, StaffController } from './staff.controller';
import { StaffService } from './staff.service';
import { JoinController, StudentsController } from './students.controller';
import { StudentImportService } from './student-import.service';
import { StudentsService } from './students.service';
import { WorkspaceController } from './workspace.controller';
import { WorkspacesService } from './workspaces.service';

/**
 * Global: provides the access guard for every route (REQ-RBAC-005) and the role-aware
 * device-limit policy that identity uses without importing tenancy.
 */
@Global()
@Module({
  imports: [IdentityModule],
  controllers: [
    WorkspaceController,
    MembersController,
    MeController,
    StaffController,
    InvitationAcceptController,
    JoinController,
    StudentsController,
    PublicTeacherController,
    PublicPageSettingsController,
  ],
  providers: [
    MembershipsService,
    WorkspacesService,
    PermissionsService,
    MembersService,
    InvitationsService,
    StaffService,
    StudentsService,
    StudentImportService,
    PublicPageService,
    { provide: DeviceLimitPolicy, useClass: MembershipDeviceLimitPolicy },
    { provide: APP_GUARD, useClass: AccessGuard },
  ],
  exports: [MembershipsService, WorkspacesService, PermissionsService, DeviceLimitPolicy],
})
export class TenancyModule {}
