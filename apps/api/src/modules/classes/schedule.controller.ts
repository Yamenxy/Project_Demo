import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../common';
import { ZodPipe } from '../../common/http/zod.pipe';
import {
  CurrentSession,
  WorkspacePermission,
  WorkspaceRoles,
  type SessionContext,
} from '../../common/policy';
import { CurrentWorkspace, type WorkspaceContext } from '../tenancy';
import {
  ScheduleService,
  type OverlapWarning,
  type SeriesView,
  type SessionView,
} from './schedule.service';

const uuidParam = new ZodPipe(z.uuid());
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) &&
      new Date(`${v}T00:00:00Z`).toISOString().startsWith(v),
  );
const clockTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const duration = z.number().int().min(15).max(480);

const seriesBody = z
  .object({
    weekday: z.number().int().min(0).max(6),
    startTime: clockTime,
    durationMinutes: duration,
    startsOn: isoDate,
    endsOn: isoDate.optional(),
  })
  .refine((b) => !b.endsOn || b.endsOn >= b.startsOn, { message: 'ends before it starts' });
const endBody = z.object({ endsOn: isoDate });
const sessionBody = z.object({ date: isoDate, startTime: clockTime, durationMinutes: duration });
const cancelBody = z.object({ reason: z.string().trim().min(3).max(300) });
const agendaQuery = z.object({ from: isoDate, to: isoDate });
const skipBody = z.object({ date: isoDate, reason: z.string().trim().max(120).optional() });

const ALL_ROLES = ['owner', 'class_teacher', 'assistant', 'student'] as const;
const STAFF = ['owner', 'class_teacher', 'assistant'] as const;

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/** Workspace-wide days off need `schedule.manage` for the whole workspace. */
function requireEverywhere(ctx: WorkspaceContext): void {
  if (!ctx.permissions.hasEverywhere('schedule.manage')) {
    throw new AppError(403, 'forbidden', 'Not allowed');
  }
}

/** Schedules, sessions and days off (REQ-SCHED-001, REQ-SCHED-002). */
@Controller('v1/w/:workspaceId')
export class ScheduleController {
  constructor(private readonly schedule: ScheduleService) {}

  /** The caller's sessions between two local dates (at most 62 days). */
  @Get('sessions')
  @WorkspaceRoles([...ALL_ROLES])
  async agenda(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodPipe(agendaQuery)) query: z.infer<typeof agendaQuery>,
  ): Promise<{ sessions: SessionView[] }> {
    const days = (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000;
    if (days <= 0 || days > 62) throw new AppError(400, 'invalid_range', 'Up to 62 days');
    return { sessions: await this.schedule.agenda(ctx, query.from, query.to) };
  }

  @Get('classes/:classId/schedule')
  @WorkspaceRoles([...STAFF])
  classSchedule(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('classId', uuidParam) classId: string,
  ): Promise<{ series: SeriesView[]; sessions: SessionView[] }> {
    return this.schedule.classSchedule(ctx, classId);
  }

  @Post('classes/:classId/series')
  @HttpCode(201)
  @WorkspacePermission('schedule.manage')
  addSeries(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('classId', uuidParam) classId: string,
    @Body(new ZodPipe(seriesBody)) body: z.infer<typeof seriesBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string; warnings: OverlapWarning[] }> {
    return this.schedule.addSeries(ctx, classId, body, actorOf(session, request));
  }

  @Post('classes/:classId/series/:seriesId/end')
  @HttpCode(204)
  @WorkspacePermission('schedule.manage')
  async endSeries(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('classId', uuidParam) classId: string,
    @Param('seriesId', uuidParam) seriesId: string,
    @Body(new ZodPipe(endBody)) body: z.infer<typeof endBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.schedule.endSeries(ctx, classId, seriesId, body.endsOn, actorOf(session, request));
  }

  @Post('classes/:classId/sessions')
  @HttpCode(201)
  @WorkspacePermission('schedule.manage')
  addSession(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('classId', uuidParam) classId: string,
    @Body(new ZodPipe(sessionBody)) body: z.infer<typeof sessionBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string; warnings: OverlapWarning[] }> {
    return this.schedule.addSession(ctx, classId, body, actorOf(session, request));
  }

  @Post('sessions/:sessionId/cancel')
  @HttpCode(204)
  @WorkspacePermission('schedule.manage')
  async cancel(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('sessionId', uuidParam) sessionId: string,
    @Body(new ZodPipe(cancelBody)) body: z.infer<typeof cancelBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.schedule.setCancelled(ctx, sessionId, body, actorOf(session, request));
  }

  @Post('sessions/:sessionId/restore')
  @HttpCode(204)
  @WorkspacePermission('schedule.manage')
  async restore(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('sessionId', uuidParam) sessionId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.schedule.setCancelled(ctx, sessionId, null, actorOf(session, request));
  }

  @Get('skip-dates')
  @WorkspaceRoles([...STAFF])
  async skipDates(
    @CurrentWorkspace() ctx: WorkspaceContext,
  ): Promise<{ dates: { date: string; reason: string | null }[] }> {
    return { dates: await this.schedule.skipDates(ctx.workspaceId) };
  }

  @Post('skip-dates')
  @HttpCode(204)
  @WorkspacePermission('schedule.manage')
  async addSkipDate(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(skipBody)) body: z.infer<typeof skipBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    requireEverywhere(ctx);
    await this.schedule.addSkipDate(ctx.workspaceId, body, actorOf(session, request));
  }

  @Delete('skip-dates/:date')
  @HttpCode(204)
  @WorkspacePermission('schedule.manage')
  async removeSkipDate(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('date', new ZodPipe(isoDate)) date: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    requireEverywhere(ctx);
    await this.schedule.removeSkipDate(ctx.workspaceId, date, actorOf(session, request));
  }
}
