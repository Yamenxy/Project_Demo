import { Injectable } from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { Clock, notFound } from '../../common';
import { TenantDb } from '../../database';
import { AuditService } from '../audit';
import { workspaces, workspaceSettings } from './schema';
import type { Actor } from './students.service';

export interface PublicTeacherPage {
  slug: string;
  name: string;
  bio: string | null;
  subjects: string[];
}

export interface PublicPageSettings {
  slug: string;
  enabled: boolean;
  bio: string | null;
  subjects: string[];
}

const splitSubjects = (value: string | null): string[] =>
  (value ?? '')
    .split(/[,،\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

/**
 * The public teacher page (REQ-CONTENT-003): the workspace name, a short text and subjects the
 * owner writes, and the join action. No student data, no phone numbers. The price list is added
 * with payments (Phase 4).
 */
@Injectable()
export class PublicPageService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly clock: Clock,
  ) {}

  async page(slug: string): Promise<PublicTeacherPage> {
    const result = await this.db.transaction((tx) =>
      tx.execute<{ slug: string; name: string; bio: string | null; subjects: string | null }>(
        sql`select * from app.public_teacher_page(${slug})`,
      ),
    );
    const row = result.rows[0];
    if (!row) throw notFound('Page not found');
    return { slug: row.slug, name: row.name, bio: row.bio, subjects: splitSubjects(row.subjects) };
  }

  async settings(workspaceId: string): Promise<PublicPageSettings> {
    const [row] = await this.db.inWorkspace(workspaceId, (tx) =>
      tx
        .select({
          slug: workspaces.slug,
          enabled: workspaceSettings.publicPageEnabled,
          bio: workspaceSettings.publicBio,
          subjects: workspaceSettings.publicSubjects,
        })
        .from(workspaceSettings)
        .innerJoin(workspaces, eq(workspaces.id, workspaceSettings.workspaceId)),
    );
    if (!row) throw notFound('Settings not found');
    return {
      slug: row.slug,
      enabled: row.enabled,
      bio: row.bio,
      subjects: splitSubjects(row.subjects),
    };
  }

  async update(
    workspaceId: string,
    change: { enabled?: boolean; bio?: string | null; subjects?: string[] },
    actor: Actor,
  ): Promise<PublicPageSettings> {
    await this.db.inWorkspace(workspaceId, async (tx) => {
      await tx.update(workspaceSettings).set({
        ...(change.enabled === undefined ? {} : { publicPageEnabled: change.enabled }),
        ...(change.bio === undefined ? {} : { publicBio: change.bio?.trim() || null }),
        ...(change.subjects === undefined
          ? {}
          : {
              publicSubjects:
                change.subjects
                  .map((s) => s.trim())
                  .filter(Boolean)
                  .join('، ') || null,
            }),
        updatedAt: this.clock.now(),
      });
      await this.audit.record(tx, {
        action: 'workspace.public_page_changed',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'workspace', id: workspaceId },
        newValue: {
          ...(change.enabled === undefined ? {} : { enabled: change.enabled }),
          bioChanged: change.bio !== undefined,
          subjectsChanged: change.subjects !== undefined,
        },
        requestId: actor.requestId,
      });
    });
    return this.settings(workspaceId);
  }
}
