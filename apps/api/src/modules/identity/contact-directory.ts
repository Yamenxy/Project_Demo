import { Injectable } from '@nestjs/common';
import { and, eq, isNotNull } from 'drizzle-orm';
import { TenantDb } from '../../database';
import { ContactDirectory } from '../notify';
import { users } from './schema';

/** Verified email addresses for notification email (only verified addresses are used). */
@Injectable()
export class UserContactDirectory extends ContactDirectory {
  constructor(private readonly db: TenantDb) {
    super();
  }

  async verifiedEmail(userId: string): Promise<string | null> {
    const [row] = await this.db.transaction((tx) =>
      tx
        .select({ email: users.email })
        .from(users)
        .where(and(eq(users.id, userId), isNotNull(users.emailVerifiedAt))),
    );
    return row?.email ?? null;
  }
}
