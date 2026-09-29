import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import { CurrentSession, WorkspaceRoles, type SessionContext } from '../../common/policy';
import { CurrentWorkspace, type WorkspaceContext } from '../tenancy';
import { FilesService, type FileView, type OwnerType } from './files.service';

const uuidParam = new ZodPipe(z.uuid());
const ownerParam = new ZodPipe(z.enum(['lessons', 'payment-requests', 'homework-submissions']));
const nameQuery = z.object({ name: z.string().trim().min(1).max(200).default('file') });
const ALL_ROLES = ['owner', 'class_teacher', 'assistant', 'student'] as const;

type OwnerSegment = 'lessons' | 'payment-requests' | 'homework-submissions';

const OWNER_TYPES: Record<OwnerSegment, OwnerType> = {
  lessons: 'lesson',
  'payment-requests': 'payment_request',
  'homework-submissions': 'homework_submission',
};
const ownerType = (segment: OwnerSegment): OwnerType => OWNER_TYPES[segment];

/**
 * Files of lessons and payment requests (REQ-FILE-001, REQ-PAY-010). Each route checks the
 * owner's rules in the service: AccessPolicy for lessons, `payments.confirm` for proofs.
 */
@Controller('v1/w/:workspaceId')
export class FilesController {
  constructor(private readonly filesService: FilesService) {}

  /** Raw bytes (`application/octet-stream`); the name travels in the query string. */
  @Post(':owner/:ownerId/files')
  @HttpCode(201)
  @WorkspaceRoles([...ALL_ROLES])
  upload(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @CurrentSession() session: SessionContext,
    @Param('owner', ownerParam) owner: OwnerSegment,
    @Param('ownerId', uuidParam) ownerId: string,
    @Query(new ZodPipe(nameQuery)) query: z.infer<typeof nameQuery>,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<FileView> {
    return this.filesService.upload(
      ctx,
      { type: ownerType(owner), id: ownerId },
      { name: query.name, data: body },
      { userId: session.userId, requestId: String(request.id) },
    );
  }

  @Get(':owner/:ownerId/files')
  @WorkspaceRoles([...ALL_ROLES])
  async list(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('owner', ownerParam) owner: OwnerSegment,
    @Param('ownerId', uuidParam) ownerId: string,
  ): Promise<{ files: FileView[] }> {
    return { files: await this.filesService.list(ctx, { type: ownerType(owner), id: ownerId }) };
  }

  /**
   * Served with headers that keep it inert: no sniffing, a sandbox policy, and a download for
   * anything that isn't an image. (A separate cookieless origin needs its own domain; see
   * paid-services.md.)
   */
  @Get('files/:fileId')
  @WorkspaceRoles([...ALL_ROLES])
  async download(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Param('fileId', uuidParam) fileId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const file = await this.filesService.download(ctx, fileId);
    const encoded = encodeURIComponent(file.name);
    await reply
      .header('Content-Type', file.contentType)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Content-Security-Policy', "default-src 'none'; sandbox")
      .header('Cache-Control', 'private, no-store')
      .header(
        'Content-Disposition',
        `${file.inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encoded}`,
      )
      .send(file.data);
  }
}
