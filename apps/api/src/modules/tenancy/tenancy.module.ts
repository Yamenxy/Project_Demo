import { Module } from '@nestjs/common';
import { MembershipsService } from './memberships.service';
import { WorkspacesService } from './workspaces.service';

@Module({
  providers: [MembershipsService, WorkspacesService],
  exports: [MembershipsService, WorkspacesService],
})
export class TenancyModule {}
