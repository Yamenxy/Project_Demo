import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentSession, PlatformOwnerOnly, type SessionContext } from '../../common/policy';
import { PlatformService, type PaymentView, type WorkspaceSummary } from './platform.service';
import { PAYMENT_METHODS, PLANS } from './schema';

const createBody = z.object({
  slug: z.string().trim().min(3).max(40),
  name: z.string().trim().min(2).max(120),
  ownerPhone: z.string().min(1).max(40),
  plan: z.enum(PLANS).optional(),
});

const paymentBody = z.object({
  // EGP, entered in pounds; stored as integer piastres (DB-03).
  amount: z.number().positive().max(1_000_000),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(80).optional(),
  paidOn: z.iso.date(),
  months: z.number().int().min(1).max(12),
  plan: z.enum(PLANS).optional(),
  notes: z.string().trim().max(500).optional(),
});

const noteBody = z.object({ note: z.string().trim().min(3).max(500) });

@Controller('v1/platform/workspaces')
@PlatformOwnerOnly()
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get()
  async list(): Promise<{ workspaces: WorkspaceSummary[] }> {
    return { workspaces: await this.platform.list() };
  }

  @Post()
  @HttpCode(201)
  async create(
    @Body(new ZodPipe(createBody)) body: z.infer<typeof createBody>,
    @CurrentSession() session: SessionContext,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string }> {
    const id = await this.platform.createWorkspace(body, {
      userId: session.userId,
      requestId: String(request.id),
    });
    return { id };
  }

  @Get(':workspaceId')
  detail(
    @Param('workspaceId', new ZodPipe(z.uuid())) workspaceId: string,
  ): Promise<WorkspaceSummary & { payments: PaymentView[] }> {
    return this.platform.detail(workspaceId);
  }

  @Post(':workspaceId/payments')
  @HttpCode(201)
  async recordPayment(
    @Param('workspaceId', new ZodPipe(z.uuid())) workspaceId: string,
    @Body(new ZodPipe(paymentBody)) body: z.infer<typeof paymentBody>,
    @CurrentSession() session: SessionContext,
    @Req() request: FastifyRequest,
  ): Promise<{ periodEndsAt: Date }> {
    const periodEndsAt = await this.platform.recordPayment(
      workspaceId,
      {
        amountPiastres: Math.round(body.amount * 100),
        method: body.method,
        paidOn: body.paidOn,
        months: body.months,
        ...(body.reference ? { reference: body.reference } : {}),
        ...(body.plan ? { plan: body.plan } : {}),
        ...(body.notes ? { notes: body.notes } : {}),
      },
      { userId: session.userId, requestId: String(request.id) },
    );
    return { periodEndsAt };
  }

  @Post(':workspaceId/suspend')
  @HttpCode(204)
  async suspend(
    @Param('workspaceId', new ZodPipe(z.uuid())) workspaceId: string,
    @Body(new ZodPipe(noteBody)) body: z.infer<typeof noteBody>,
    @CurrentSession() session: SessionContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.platform.suspend(workspaceId, body.note, {
      userId: session.userId,
      requestId: String(request.id),
    });
  }

  @Post(':workspaceId/restore')
  @HttpCode(204)
  async restore(
    @Param('workspaceId', new ZodPipe(z.uuid())) workspaceId: string,
    @Body(new ZodPipe(noteBody)) body: z.infer<typeof noteBody>,
    @CurrentSession() session: SessionContext,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.platform.restore(workspaceId, body.note, {
      userId: session.userId,
      requestId: String(request.id),
    });
  }
}
