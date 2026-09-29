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
import { PaymentRequestsService, type RequestView } from './requests.service';

const uuidParam = new ZodPipe(z.uuid());
const submitBody = z.object({
  amountPiastres: z.number().int().min(1).max(100_000_000),
  method: z.enum(['transfer', 'wallet', 'other']),
  reference: z.string().trim().min(3).max(80),
  note: z.string().trim().max(300).optional(),
  resubmitsId: z.uuid().optional(),
});
const rejectBody = z.object({ reason: z.string().trim().min(3).max(300) });
const listQuery = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'cancelled']).optional(),
});

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/** Payment requests (REQ-PAY-003, REQ-PAY-008, REQ-PAY-010). */
@Controller('v1/w/:workspaceId')
export class PaymentRequestsController {
  constructor(private readonly requests: PaymentRequestsService) {}

  @Post('my/payment-requests')
  @HttpCode(201)
  @WorkspaceRoles(['student'])
  submit(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(submitBody)) body: z.infer<typeof submitBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string }> {
    return this.requests.submit(ctx, body, actorOf(session, request));
  }

  @Get('my/payment-requests')
  @WorkspaceRoles(['student'])
  async mine(@CurrentWorkspace() ctx: WorkspaceContext): Promise<{ requests: RequestView[] }> {
    return { requests: await this.requests.mine(ctx) };
  }

  @Post('my/payment-requests/:requestId/cancel')
  @HttpCode(204)
  @WorkspaceRoles(['student'])
  async cancel(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('requestId', uuidParam) requestId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.requests.cancel(ctx, requestId, actorOf(session, request));
  }

  @Get('payment-requests')
  @WorkspacePermission('payments.confirm')
  async list(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>,
  ): Promise<{ requests: RequestView[] }> {
    return { requests: await this.requests.list(ctx, query.status) };
  }

  @Post('payment-requests/:requestId/approve')
  @HttpCode(200)
  @WorkspacePermission('payments.confirm')
  approve(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('requestId', uuidParam) requestId: string,
    @Req() request: FastifyRequest,
  ): Promise<{ receiptNumber: number; paymentId: string }> {
    return this.requests.approve(ctx, requestId, actorOf(session, request));
  }

  @Post('payment-requests/:requestId/reject')
  @HttpCode(204)
  @WorkspacePermission('payments.confirm')
  async reject(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('requestId', uuidParam) requestId: string,
    @Body(new ZodPipe(rejectBody)) body: z.infer<typeof rejectBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.requests.reject(ctx, requestId, body.reason, actorOf(session, request));
  }
}
