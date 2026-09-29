import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError } from '../../common';
import { ZodPipe } from '../../common/http/zod.pipe';
import {
  Authenticated,
  CurrentSession,
  WorkspacePermission,
  WorkspaceRoles,
  type SessionContext,
} from '../../common/policy';
import type { WorkspaceContext } from './access.guard';
import {
  MAX_IMPORT_BYTES,
  StudentImportService,
  type ImportReport,
} from './student-import.service';
import { StudentsService, type JoinResult, type StudentRow } from './students.service';
import { CurrentWorkspace } from './workspace.controller';

const joinBody = z
  .object({
    code: z.string().trim().min(4).max(12).optional(),
    slug: z.string().trim().min(3).max(40).optional(),
  })
  .refine((b) => Boolean(b.code) !== Boolean(b.slug), { message: 'code or slug' });

const listQuery = z.object({
  status: z.enum(['active', 'pending', 'suspended']).optional(),
  q: z.string().max(80).optional(),
  consent: z.literal('missing').optional(),
});

const managedBody = z.object({
  name: z.string().trim().min(2).max(120),
  phone: z.string().min(1).max(40),
  internalCode: z.string().trim().max(40).optional(),
});

const paperConsentBody = z.object({ note: z.string().trim().max(300).optional() });

const removeBody = z.object({ reason: z.string().trim().min(3).max(300) });

const settingsBody = z.object({
  rotateCode: z.boolean().optional(),
  autoApproveJoins: z.boolean().optional(),
});

const importBody = z.object({
  fileName: z.string().trim().min(1).max(200),
  // Base64 of at most 512 KB, so the request fits the default 1 MB body limit.
  content: z
    .string()
    .max(Math.ceil(MAX_IMPORT_BYTES / 3) * 4 + 4)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/),
  commit: z.boolean().default(false),
});

const uuidParam = new ZodPipe(z.uuid());

function actorOf(session: SessionContext, request: FastifyRequest) {
  return { userId: session.userId, requestId: String(request.id) };
}

const claimLink = (workspaceId: string, token: string) =>
  `/join/student?w=${workspaceId}&t=${encodeURIComponent(token)}`;

/** A student asks to join a teacher (D8). */
@Controller('v1/join')
@Authenticated()
export class JoinController {
  constructor(private readonly students: StudentsService) {}

  @Post()
  @HttpCode(200)
  join(
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(joinBody)) body: z.infer<typeof joinBody>,
  ): Promise<JoinResult> {
    if (session.userStatus !== 'active') {
      throw new AppError(403, 'account_not_active', 'Verify your phone number first');
    }
    return this.students.join(session.userId, body);
  }
}

@Controller('v1/w/:workspaceId')
export class StudentsController {
  constructor(
    private readonly students: StudentsService,
    private readonly imports: StudentImportService,
  ) {}

  @Get('students')
  @WorkspacePermission('enrollment.manage')
  list(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>,
  ): Promise<{ students: StudentRow[]; pendingCount: number; missingConsentCount: number }> {
    return this.students.list(ctx.workspaceId, {
      status: query.status,
      query: query.q,
      missingConsent: query.consent === 'missing',
      showPhones: ctx.permissions.has('enrollment.manage') || ctx.permissions.has('students.edit'),
    });
  }

  @Post('students')
  @HttpCode(201)
  @WorkspacePermission('enrollment.manage')
  async addManaged(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(managedBody)) body: z.infer<typeof managedBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ membershipId: string; link: string }> {
    const { membershipId, token } = await this.students.addManaged(
      ctx.workspaceId,
      body,
      actorOf(session, request),
    );
    return { membershipId, link: claimLink(ctx.workspaceId, token) };
  }

  /** A preview unless `commit` is true; both return the same per-row report (REQ-USER-002). */
  @Post('students/import')
  @HttpCode(200)
  @WorkspacePermission('students.import')
  import(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(importBody)) body: z.infer<typeof importBody>,
    @Req() request: FastifyRequest,
  ): Promise<ImportReport> {
    return this.imports.import(
      ctx.workspaceId,
      { fileName: body.fileName, data: Buffer.from(body.content, 'base64') },
      { commit: body.commit },
      actorOf(session, request),
    );
  }

  @Post('students/:membershipId/approve')
  @HttpCode(204)
  @WorkspacePermission('enrollment.manage')
  async approve(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('membershipId', uuidParam) membershipId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.students.decide(ctx.workspaceId, membershipId, true, actorOf(session, request));
  }

  @Post('students/:membershipId/reject')
  @HttpCode(204)
  @WorkspacePermission('enrollment.manage')
  async reject(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('membershipId', uuidParam) membershipId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.students.decide(ctx.workspaceId, membershipId, false, actorOf(session, request));
  }

  @Post('students/:membershipId/claim-link')
  @HttpCode(201)
  @WorkspacePermission('enrollment.manage')
  async newClaimLink(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('membershipId', uuidParam) membershipId: string,
    @Req() request: FastifyRequest,
  ): Promise<{ link: string }> {
    const token = await this.students.newClaimLink(
      ctx.workspaceId,
      membershipId,
      actorOf(session, request),
    );
    return { link: claimLink(ctx.workspaceId, token) };
  }

  @Post('students/:membershipId/consent')
  @HttpCode(204)
  @WorkspacePermission('enrollment.manage')
  async paperConsent(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('membershipId', uuidParam) membershipId: string,
    @Body(new ZodPipe(paperConsentBody)) body: z.infer<typeof paperConsentBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.students.recordPaperConsent(
      ctx.workspaceId,
      membershipId,
      body.note || null,
      actorOf(session, request),
    );
  }

  /** Owner only (Appendix A.3: removing a student isn't delegated in the MVP). */
  @Post('students/:membershipId/remove')
  @HttpCode(204)
  @WorkspaceRoles(['owner'])
  async remove(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('membershipId', uuidParam) membershipId: string,
    @Body(new ZodPipe(removeBody)) body: z.infer<typeof removeBody>,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    await this.students.remove(
      ctx.workspaceId,
      membershipId,
      body.reason,
      actorOf(session, request),
    );
  }

  @Get('joining')
  @WorkspaceRoles(['owner'])
  joining(
    @CurrentWorkspace() ctx: WorkspaceContext,
  ): Promise<{ joinCode: string; autoApproveJoins: boolean }> {
    return this.students.settings(ctx.workspaceId);
  }

  @Post('joining')
  @HttpCode(200)
  @WorkspaceRoles(['owner'])
  updateJoining(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Body(new ZodPipe(settingsBody)) body: z.infer<typeof settingsBody>,
    @Req() request: FastifyRequest,
  ): Promise<{ joinCode: string; autoApproveJoins: boolean }> {
    return this.students.updateSettings(ctx.workspaceId, body, actorOf(session, request));
  }
}
