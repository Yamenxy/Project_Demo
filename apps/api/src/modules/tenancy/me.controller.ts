import { Controller, Get } from '@nestjs/common';
import { Authenticated, CurrentSession, type SessionContext } from '../../common/policy';
import { MembershipsService, type MyWorkspace } from './memberships.service';

/** The signed-in user's workspaces and platform role, for the workspace switcher. */
@Controller('v1/me')
@Authenticated()
export class MeController {
  constructor(private readonly memberships: MembershipsService) {}

  @Get('workspaces')
  async workspaces(
    @CurrentSession() session: SessionContext,
  ): Promise<{ platformOwner: boolean; workspaces: MyWorkspace[] }> {
    const [platformOwner, workspaces] = await Promise.all([
      this.memberships.isPlatformOwner(session.userId),
      this.memberships.listForUser(session.userId),
    ]);
    return { platformOwner, workspaces };
  }
}
