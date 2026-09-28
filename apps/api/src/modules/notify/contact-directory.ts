/**
 * Where notify finds a recipient's verified email address. Implemented by the identity module,
 * so notify doesn't depend on identity (identity sends notifications).
 */
export abstract class ContactDirectory {
  abstract verifiedEmail(userId: string): Promise<string | null>;
}
