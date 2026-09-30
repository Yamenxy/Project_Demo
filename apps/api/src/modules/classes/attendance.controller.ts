import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import {
  CurrentSession,
  WorkspacePermission,
  WorkspaceRoles,
  type SessionContext,
} from '../../common/policy';
import { CurrentWorkspace, type WorkspaceContext } from '../tenancy';
import {
  AttendanceService,
  type AttendanceStatus,
  type AttendanceSummaryRow,
  type Roster,
} from './attendance.service';

const uuidParam = new ZodPipe(z.uuid());
const recordBody = z.object({
  records: z
    .array(
      z.object({
        membershipId: z.uuid(),
        status: z.enum(['present', 'late', 'absent', 'excused']),
        method: z.enum(['manual', 'qr']).default('manual'),
        takenAt: z.iso.datetime().optional(),
      }),
    )
    .min(1)
    .max(500),
  reason: z.string().trim().max(300).optional(),
});

/** Attendance (REQ-ATT-001, REQ-ATT-002). */
@Controller('v1/w/:workspaceId')
export class AttendanceController {
  constructor(private readonly attendance: AttendanceService) {}

  @Get('sessions/:sessionId/attendance')
  @WorkspacePermission('attendance.mark')
  roster(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('sessionId', uuidParam) sessionId: string,
  ): Promise<Roster> {
    return this.attendance.roster(ctx, sessionId);
  }

  /** Idempotent: safe to resend, which offline scanners do (REQ-ATT-001). */
  @Post('sessions/:sessionId/attendance')
  @HttpCode(200)
  @WorkspacePermission('attendance.mark')
  record(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('sessionId', uuidParam) sessionId: string,
    @Body(new ZodPipe(recordBody)) body: z.infer<typeof recordBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ saved: number }> {
    return this.attendance.record(
      ctx,
      sessionId,
      {
        records: body.records.map((r) => ({
          membershipId: r.membershipId,
          status: r.status,
          method: r.method,
          ...(r.takenAt ? { takenAt: new Date(r.takenAt) } : {}),
        })),
        ...(body.reason ? { reason: body.reason } : {}),
      },
      { userId: session.userId, requestId: String(request.id) },
    );
  }

  @Get('classes/:classId/attendance')
  @WorkspacePermission('attendance.mark')
  async summary(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('classId', uuidParam) classId: string,
  ): Promise<{ students: AttendanceSummaryRow[] }> {
    return { students: await this.attendance.classSummary(ctx, classId) };
  }

  @Get('my/attendance')
  @WorkspaceRoles(['student'], { allowWhenSuspended: ['student'] })
  mine(@CurrentWorkspace() ctx: WorkspaceContext): Promise<{
    records: {
      sessionId: string;
      className: string;
      startsAt: Date;
      status: AttendanceStatus;
      cancelled: boolean;
    }[];
    rate: number | null;
  }> {
    return this.attendance.mine(ctx);
  }
}
