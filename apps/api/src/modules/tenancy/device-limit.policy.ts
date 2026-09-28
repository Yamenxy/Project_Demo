import { Injectable } from '@nestjs/common';
import { and, eq, ne } from 'drizzle-orm';
import { TenantDb } from '../../database';
import { DeviceLimitPolicy } from '../identity';
import { memberships, platformOwners } from './schema';

/**
 * Device limits guard student accounts against sharing (D13). Staff (owner, class teacher,
 * helper in any workspace) and platform owners work from several devices, so they're exempt.
 */
@Injectable()
export class MembershipDeviceLimitPolicy extends DeviceLimitPolicy {
  constructor(private readonly db: TenantDb) {
    super();
  }

  async appliesTo(userId: string): Promise<boolean> {
    const owner = await this.db.transaction((tx) =>
      tx.select().from(platformOwners).where(eq(platformOwners.userId, userId)),
    );
    if (owner.length > 0) return false;
    const staff = await this.db.forUser(userId, (tx) =>
      tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.userId, userId),
            ne(memberships.role, 'student'),
            ne(memberships.status, 'removed'),
          ),
        )
        .limit(1),
    );
    return staff.length === 0;
  }
}
