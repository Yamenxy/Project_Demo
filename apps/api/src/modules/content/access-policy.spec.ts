import { describe, expect, it } from 'vitest';
import { decideAccess, type AccessFacts } from './access-policy';

const open: AccessFacts = {
  activeStudent: true,
  published: true,
  workspaceSuspended: false,
  paused: false,
  rule: null,
  groups: ['مجموعة السبت'],
};

describe('AccessPolicy (REQ-CONTENT-001)', () => {
  it.each<[string, Partial<AccessFacts>, string]>([
    ['a group opens the lesson', {}, 'group'],
    ['a grant opens the lesson', { groups: [], rule: 'grant' }, 'grant'],
    ['a group wins the reason when both apply', { rule: 'grant' }, 'group'],
    ['neither group nor grant', { groups: [] }, 'no_access'],
    ['not an active student', { activeStudent: false }, 'not_student'],
    [
      'unpublished, even with a grant',
      { published: false, groups: [], rule: 'grant' },
      'not_published',
    ],
    ['unpublished, even with a group', { published: false }, 'not_published'],
    ['workspace suspended', { workspaceSuspended: true }, 'workspace_suspended'],
    ['a block beats a group', { rule: 'block' }, 'blocked'],
    ['a block beats a grant (only one rule can exist)', { groups: [], rule: 'block' }, 'blocked'],
    ['a pause beats a group', { paused: true }, 'paused'],
    ['a pause beats a grant', { paused: true, groups: [], rule: 'grant' }, 'paused'],
    ['a pause beats a block', { paused: true, rule: 'block' }, 'paused'],
  ])('%s', (_, change, expected) => {
    const decision = decideAccess({ ...open, ...change });
    expect(decision.allowed ? decision.via : decision.reason).toBe(expected);
  });
});
