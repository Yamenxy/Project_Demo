import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
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
import { LedgerService, type LedgerEntry } from './ledger.service';

const uuidParam = new ZodPipe(z.uuid());
const recordBody = z.object({
  membershipId: z.uuid(),
  amountPiastres: z.number().int().min(1).max(100_000_000),
  method: z.enum(['cash', 'transfer', 'wallet', 'other']),
  priceItemId: z.uuid().optional(),
  note: z.string().trim().max(300).optional(),
});
const searchQuery = z.object({ q: z.string().trim().max(80).default('') });
const reverseBody = z.object({ reason: z.string().trim().min(3).max(300) });
const listQuery = z.object({
  membershipId: z.uuid().optional(),
  from: z.iso.datetime().optional(),
  to: z.iso.datetime().optional(),
});

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/** Recorded payments, reversals and receipts (REQ-PAY-003, -004, -007). */
@Controller('v1/w/:workspaceId')
export class LedgerController {
  constructor(private readonly ledger: LedgerService) {}

  @Post('payments')
  @HttpCode(201)
  @WorkspacePermission('payments.record')
  record(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(recordBody)) body: z.infer<typeof recordBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string; receiptNumber: number }> {
    return this.ledger.record(ctx, body, actorOf(session, request));
  }

  @Get('payments/students')
  @WorkspacePermission('payments.record')
  async students(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodPipe(searchQuery)) query: z.infer<typeof searchQuery>,
  ): Promise<{ students: Awaited<ReturnType<LedgerService['searchStudents']>> }> {
    return { students: await this.ledger.searchStudents(ctx, query.q) };
  }

  @Get('payments')
  @WorkspacePermission('payments.view')
  async list(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>,
  ): Promise<{ entries: LedgerEntry[] }> {
    return {
      entries: await this.ledger.list(ctx, {
        ...(query.membershipId ? { membershipId: query.membershipId } : {}),
        ...(query.from ? { from: new Date(query.from) } : {}),
        ...(query.to ? { to: new Date(query.to) } : {}),
      }),
    };
  }

  /** Reversing is kept with the owner in the MVP: it moves money back. */
  @Post('payments/:paymentId/reverse')
  @HttpCode(201)
  @WorkspaceRoles(['owner'])
  reverse(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('paymentId', uuidParam) paymentId: string,
    @Body(new ZodPipe(reverseBody)) body: z.infer<typeof reverseBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string; receiptNumber: number }> {
    return this.ledger.reverse(ctx, paymentId, body.reason, actorOf(session, request));
  }

  @Get('payments/:paymentId')
  @WorkspaceRoles(['owner', 'class_teacher', 'assistant', 'student'], {
    allowWhenSuspended: ['student'],
  })
  receipt(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('paymentId', uuidParam) paymentId: string,
  ): Promise<LedgerEntry> {
    return this.ledger.receipt(ctx, paymentId);
  }

  @Get('my/payments')
  @WorkspaceRoles(['student'], { allowWhenSuspended: ['student'] })
  async mine(@CurrentWorkspace() ctx: WorkspaceContext): Promise<{ entries: LedgerEntry[] }> {
    return { entries: await this.ledger.mine(ctx) };
  }
}
