/**
 * Workspace permission keys (docs/requirements.md Appendix A.2). Pure data, shared by the
 * permission engine, the grant API and (later) the web app.
 */
export const PERMISSION_KEYS = [
  'enrollment.manage',
  'students.edit',
  'students.import',
  'students.sessions_reset',
  'attendance.mark',
  'attendance.edit_late',
  'grading.grade',
  'grading.release',
  'content.edit',
  'content.publish',
  'assessment.edit',
  'schedule.manage',
  'access.grants',
  'access.groups',
  'access.pause',
  'payments.record',
  'payments.confirm',
  'payments.view',
  'finance.view',
  'announcements.post',
  'reports.academic',
  'data.export',
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export function isPermissionKey(value: string): value is PermissionKey {
  return (PERMISSION_KEYS as readonly string[]).includes(value);
}

/**
 * Owner-only actions are not keys at all, so nothing can grant them: managing staff and their
 * permissions, the price list, workspace settings and subscription, deleting content, "remove
 * from all groups and grants", the full workspace export (REQ-RBAC-002). Routes for those
 * actions require the owner role directly.
 */

/** Keys only a class teacher may hold, never a helper, in the MVP (Appendix A.2). */
export const CLASS_TEACHER_ONLY: ReadonlySet<PermissionKey> = new Set([
  'attendance.edit_late',
  'grading.release',
]);

/** What every class teacher holds within their classes (REQ-RBAC-006). */
export const CLASS_TEACHER_DEFAULTS: readonly PermissionKey[] = [
  'enrollment.manage',
  'students.sessions_reset',
  'attendance.mark',
  'attendance.edit_late',
  'grading.grade',
  'grading.release',
  'content.edit',
  'content.publish',
  'assessment.edit',
  'schedule.manage',
  'access.grants',
  'payments.view',
  'announcements.post',
  'reports.academic',
];

export type StaffRole = 'class_teacher' | 'assistant';

/** Whether the owner may grant this key to a member with this role. */
export function isGrantable(role: StaffRole, key: PermissionKey): boolean {
  return role === 'class_teacher' || !CLASS_TEACHER_ONLY.has(key);
}
