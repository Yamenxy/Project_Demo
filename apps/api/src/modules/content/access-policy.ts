/**
 * The one rule for opening a lesson (REQ-CONTENT-001, OD-02). Pure, so every term is covered by a
 * table-driven test; `AccessService` gathers the facts from the database and asks this.
 */
export interface AccessFacts {
  /** An active student membership in the workspace. */
  activeStudent: boolean;
  /** Published, and neither the lesson nor its course is deleted. */
  published: boolean;
  workspaceSuspended: boolean;
  paused: boolean;
  rule: 'grant' | 'block' | null;
  /** Names of the active access groups that include the lesson and the student. */
  groups: string[];
}

export type AccessDenied =
  'not_student' | 'not_published' | 'workspace_suspended' | 'paused' | 'blocked' | 'no_access';

export type AccessDecision =
  | { allowed: true; via: 'group' | 'grant'; groups: string[] }
  | { allowed: false; reason: AccessDenied };

/**
 * Allowed only when all hold: active student, published, workspace not suspended, not paused,
 * no block, and a group or a grant. So a pause beats everything, a block beats both a group and
 * a grant, and an unpublished lesson is refused even with a grant.
 */
export function decideAccess(facts: AccessFacts): AccessDecision {
  if (!facts.activeStudent) return { allowed: false, reason: 'not_student' };
  if (!facts.published) return { allowed: false, reason: 'not_published' };
  if (facts.workspaceSuspended) return { allowed: false, reason: 'workspace_suspended' };
  if (facts.paused) return { allowed: false, reason: 'paused' };
  if (facts.rule === 'block') return { allowed: false, reason: 'blocked' };
  if (facts.groups.length > 0) return { allowed: true, via: 'group', groups: facts.groups };
  if (facts.rule === 'grant') return { allowed: true, via: 'grant', groups: [] };
  return { allowed: false, reason: 'no_access' };
}
