import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
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
  CashService,
  type CashBalance,
  type CollectorDay,
  type Handover,
  type IncomeReport,
} from './cash.service';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const dayQuery = z.object({ date: isoDate });
const rangeQuery = z.object({ from: isoDate, to: isoDate });
const handoverBody = z.object({
  amountPiastres: z.number().int().min(1).max(1_000_000_000),
  note: z.string().trim().max(300).optional(),
});

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/** Cash per collector, handovers and income (REQ-PAY-003, REQ-PAY-007). */
@Controller('v1/w/:workspaceId')
export class CashController {
  constructor(private readonly cash: CashService) {}

  @Get('reports/cash-day')
  @WorkspacePermission('finance.view')
  async day(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodPipe(dayQuery)) query: z.infer<typeof dayQuery>,
  ): Promise<{ collectors: CollectorDay[] }> {
    return { collectors: await this.cash.day(ctx.workspaceId, query.date) };
  }

  @Get('reports/income')
  @WorkspacePermission('finance.view')
  income(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodPipe(rangeQuery)) query: z.infer<typeof rangeQuery>,
  ): Promise<IncomeReport> {
    if (query.to <= query.from)
      throw new AppError(400, 'invalid_range', 'The end is before the start');
    return this.cash.income(ctx.workspaceId, query.from, query.to);
  }

  /** The owner sees everyone; a collector sees their own cash and handovers. */
  @Get('cash')
  @WorkspaceRoles(['owner', 'class_teacher', 'assistant'])
  async overview(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
  ): Promise<{ balances: CashBalance[]; handovers: Handover[] }> {
    const own =
      ctx.role === 'owner' || ctx.permissions.has('finance.view') ? undefined : session.userId;
    const [balances, handovers] = await Promise.all([
      this.cash.balances(ctx.workspaceId, own),
      this.cash.handovers(ctx.workspaceId, own),
    ]);
    return { balances, handovers };
  }

  @Post('cash/handovers')
  @HttpCode(201)
  @WorkspacePermission('payments.record')
  handOver(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(handoverBody)) body: z.infer<typeof handoverBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string }> {
    return this.cash.handOver(ctx, body, actorOf(session, request));
  }

  @Post('cash/handovers/:handoverId/confirm')
  @HttpCode(204)
  @WorkspaceRoles(['owner'])
  async confirm(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('handoverId', new ZodPipe(z.uuid())) handoverId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.cash.decide(ctx.workspaceId, handoverId, true, actorOf(session, request));
  }

  @Post('cash/handovers/:handoverId/reject')
  @HttpCode(204)
  @WorkspaceRoles(['owner'])
  async reject(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('handoverId', new ZodPipe(z.uuid())) handoverId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.cash.decide(ctx.workspaceId, handoverId, false, actorOf(session, request));
  }
}
