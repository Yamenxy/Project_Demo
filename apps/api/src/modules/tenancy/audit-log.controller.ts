import { Controller, Get, Query } from '@nestjs/common';
import { z } from 'zod';
import { ZodPipe } from '../../common/http/zod.pipe';
import { WorkspaceRoles } from '../../common/policy';
import type { WorkspaceContext } from './access.guard';
import { CurrentWorkspace } from './workspace.controller';
import { AuditLogService, type AuditEntry } from './audit-log.service';

const listQuery = z.object({
  // Keyset pagination: the time and id of the last entry already shown.
  beforeAt: z.iso.datetime().optional(),
  beforeId: z.uuid().optional(),
  area: z
    .string()
    .regex(/^[a-z][a-z_]*$/)
    .max(40)
    .optional(),
});

/** The workspace audit log, for the owner (REQ-AUDIT-002). */
@Controller('v1/w/:workspaceId/audit-log')
export class AuditLogController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  @WorkspaceRoles(['owner'], { allowWhenSuspended: ['owner'] })
  list(
    @CurrentWorkspace() ctx: WorkspaceContext,
    @Query(new ZodPipe(listQuery)) query: z.infer<typeof listQuery>,
  ): Promise<{ entries: AuditEntry[]; more: boolean }> {
    return this.auditLog.list(ctx.workspaceId, {
      ...(query.beforeAt && query.beforeId
        ? { before: { at: new Date(query.beforeAt), id: query.beforeId } }
        : {}),
      ...(query.area ? { area: query.area } : {}),
    });
  }
}
