/**
 * Decides whose accounts are subject to device limits. Provided by the tenancy module (it knows
 * roles), so identity doesn't depend on tenancy.
 */
export abstract class DeviceLimitPolicy {
  abstract appliesTo(userId: string): Promise<boolean>;
}
