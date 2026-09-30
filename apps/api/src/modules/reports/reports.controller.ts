import { Controller, Get, Param, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentSession, WorkspacePermission, type SessionContext } from '../../common/policy';
import { CurrentWorkspace, type WorkspaceContext } from '../tenancy';
import { LANGS } from './headers';
import { ReportsService, type CsvFile } from './reports.service';

const uuidParam = new ZodPipe(z.uuid());
const langQuery = z.object({ lang: z.enum(LANGS).default('ar') });
const periodQuery = langQuery.extend({ from: z.iso.date(), to: z.iso.date() });
const dayQuery = langQuery.extend({ date: z.iso.date() });

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/** Cairo midnight at the start of a calendar day, as an instant. */
function cairoDayStart(date: string): Date {
  const utcMidnight = new Date(`${date}T00:00:00Z`);
  const cairo = new Date(utcMidnight.toLocaleString('en-US', { timeZone: 'Africa/Cairo' }));
  const utc = new Date(utcMidnight.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(utcMidnight.getTime() - (cairo.getTime() - utc.getTime()));
}

async function send(reply: FastifyReply, file: CsvFile): Promise<void> {
  await reply
    .header('Content-Type', 'text/csv; charset=utf-8')
    .header('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`)
    .header('X-Content-Type-Options', 'nosniff')
    .header('Cache-Control', 'private, no-store')
    .send(file.body);
}

/** CSV exports (REQ-REPORT-001, `data.export`); every export is audited. */
@Controller('v1/w/:workspaceId/exports')
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get('classes/:classId/gradebook.csv')
  @WorkspacePermission('data.export')
  async gradebook(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('classId', uuidParam) classId: string,
    @Query(new ZodPipe(langQuery)) query: z.infer<typeof langQuery>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await send(
      reply,
      await this.reports.gradebook(ctx, classId, query.lang, actorOf(session, request)),
    );
  }

  @Get('classes/:classId/attendance.csv')
  @WorkspacePermission('data.export')
  async attendance(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('classId', uuidParam) classId: string,
    @Query(new ZodPipe(langQuery)) query: z.infer<typeof langQuery>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await send(
      reply,
      await this.reports.attendance(ctx, classId, query.lang, actorOf(session, request)),
    );
  }

  @Get('payments.csv')
  @WorkspacePermission('data.export')
  async payments(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Query(new ZodPipe(periodQuery)) query: z.infer<typeof periodQuery>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const period = {
      from: cairoDayStart(query.from),
      to: new Date(cairoDayStart(query.to).getTime() + 24 * 3600 * 1000),
    };
    await send(
      reply,
      await this.reports.payments(ctx, period, query.lang, actorOf(session, request)),
    );
  }

  @Get('cash-day.csv')
  @WorkspacePermission('data.export')
  async cashDay(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Query(new ZodPipe(dayQuery)) query: z.infer<typeof dayQuery>,
    @Req() request: FastifyRequest,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    await send(
      reply,
      await this.reports.cashDay(ctx, query.date, query.lang, actorOf(session, request)),
    );
  }
}
