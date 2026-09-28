import type { ReactNode } from 'react';

/**
 * Mixed-direction text (REQ-I18N-001, review UX-02).
 *
 * Phone numbers, codes, scores like "18/20" and formulas are left-to-right runs inside Arabic
 * text. Without isolation the browser reorders them ("20/18"). Wrap them in <Ltr>. Wrap any
 * user-provided text whose direction isn't known in <Auto>.
 */
export function Ltr({ children }: { children: ReactNode }) {
  return <bdi dir="ltr">{children}</bdi>;
}

export function Auto({ children }: { children: ReactNode }) {
  return <bdi dir="auto">{children}</bdi>;
}
