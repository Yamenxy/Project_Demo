import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentSession, WorkspaceRoles, type SessionContext } from '../../common/policy';
import { CurrentWorkspace, type WorkspaceContext } from '../tenancy';
import { PriceListService, type PriceItem } from './price-list.service';

const piastres = z.number().int().min(0).max(100_000_000);
const itemBody = z.object({
  name: z.string().trim().min(2).max(80),
  amountPiastres: piastres,
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .optional(),
  description: z.string().trim().max(300).nullable().optional(),
});
const updateBody = itemBody
  .partial()
  .extend({ archived: z.boolean().optional() })
  .refine((b) => Object.keys(b).length > 0, { message: 'nothing to change' });
const listQuery = z.object({ archived: z.enum(['true', 'false']).optional() });

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

/** The price list (REQ-PAY-006): the owner edits it; every staff member can read it. */
@Controller('v1/w/:workspaceId/price-items')
export class PriceListController {
  constructor(private readonly prices: PriceListService) {}

  @Get()
  @WorkspaceRoles(['owner', 'class_teacher', 'assistant', 'student'])
  async list(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>,
  ): Promise<{ items: PriceItem[] }> {
    const archived = query.archived === 'true' && ctx.role === 'owner';
    return { items: await this.prices.list(ctx.workspaceId, { archived }) };
  }

  @Post()
  @HttpCode(201)
  @WorkspaceRoles(['owner'])
  create(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(itemBody)) body: z.infer<typeof itemBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string }> {
    return this.prices.create(ctx.workspaceId, body, actorOf(session, request));
  }

  @Post(':itemId')
  @HttpCode(204)
  @WorkspaceRoles(['owner'])
  async update(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('itemId', new ZodPipe(z.uuid())) itemId: string,
    @Body(new ZodPipe(updateBody)) body: z.infer<typeof updateBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.prices.update(ctx.workspaceId, itemId, body, actorOf(session, request));
  }
}
