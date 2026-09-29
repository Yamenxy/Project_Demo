import { Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { AppError, Clock, IdGenerator } from '../../common';
import { isUniqueViolation, type DbTx } from '../../database';
import { PlatformDb } from '../../database/platform-db';
import { AuditService } from '../audit';
import { users } from '../identity';
import { generateJoinCode } from './join-code';
import { memberships, workspaces, workspaceSettings } from './schema';

export interface CreateWorkspaceInput {
  slug: string;
  name: string;
  ownerUserId: string;
}

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/;

/** Workspace lifecycle. Platform-level, so it uses the platform handle (architecture §4). */
@Injectable()
export class WorkspacesService {
  constructor(
    private readonly platformDb: PlatformDb,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /**
   * Creates a workspace and its owner membership together (OD-01). `afterCreate` runs in the same
   * transaction (for example to start the trial subscription).
   */
  async create(
    input: CreateWorkspaceInput,
    platformOwnerId: string,
    afterCreate?: (tx: DbTx, workspaceId: string) => Promise<void>,
  ): Promise<string> {
    const slug = input.slug.trim().toLowerCase();
    if (!SLUG.test(slug)) throw new AppError(400, 'invalid_slug', 'Slug is not valid');
    const workspaceId = this.ids.newId();
    const now = this.clock.now();
    try {
      await this.platformDb.run('create workspace', async (tx) => {
        const [owner] = await tx
          .select({ status: users.status })
          .from(users)
          .where(eq(users.id, input.ownerUserId));
        if (!owner || owner.status !== 'active') {
          throw new AppError(400, 'owner_not_active', 'The owner must be an active account');
        }
        await tx.insert(workspaces).values({
          id: workspaceId,
          slug,
          name: input.name.trim(),
          ownerUserId: input.ownerUserId,
          createdAt: now,
          updatedAt: now,
        });
        await tx.insert(memberships).values({
          workspaceId,
          id: this.ids.newId(),
          userId: input.ownerUserId,
          role: 'owner',
          status: 'active',
          createdAt: now,
          updatedAt: now,
          version: 1,
        });
        await tx.insert(workspaceSettings).values({
          workspaceId,
          joinCode: generateJoinCode(),
          autoApproveJoins: false,
          updatedAt: now,
        });
        await this.audit.record(tx, {
          action: 'workspace.created',
          workspaceId,
          actor: { type: 'platform_owner', userId: platformOwnerId },
          entity: { type: 'workspace', id: workspaceId },
          newValue: { slug, ownerUserId: input.ownerUserId },
        });
        if (afterCreate) await afterCreate(tx, workspaceId);
      });
    } catch (err) {
      if (isUniqueViolation(err, 'workspaces_slug_key')) {
        throw new AppError(409, 'slug_taken', 'Slug is already taken');
      }
      throw err;
    }
    return workspaceId;
  }
}
