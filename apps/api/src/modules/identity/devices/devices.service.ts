import { Injectable } from '@nestjs/common';
import { and, desc, eq, gt, isNull } from 'drizzle-orm';
import { AppError, Clock, IdGenerator } from '../../../common';
import { TenantDb, type DbTx } from '../../../database';
import { AuditService } from '../../audit';
import type { RequestMeta } from '../request-meta';
import { deviceRegistrations, sessions, users } from '../schema';
import { generateSessionToken, hashToken } from '../tokens';
import { DeviceLimitPolicy } from './device-limit-policy';

/** At most 2 active devices, and at most 2 new registrations per 30 days (REQ-AUTH-005). */
export const DEVICE_LIMIT = 2;
export const NEW_DEVICES_PER_WINDOW = 2;
export const DEVICE_WINDOW_MS = 30 * 24 * 3600 * 1000;

export interface DeviceSummary {
  id: string;
  label: string | null;
  lastSeenAt: Date;
  current: boolean;
}

export interface AdmittedDevice {
  deviceId: string;
  /** Set when a new device was registered: the caller stores it in the device cookie. */
  newToken?: string;
}

@Injectable()
export class DevicesService {
  constructor(
    private readonly db: TenantDb,
    private readonly policy: DeviceLimitPolicy,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  /**
   * Admits the browser presenting `deviceToken` for this user: a known device is reused; an
   * unknown one is registered if the limits allow. Serialized per user with a row lock, so two
   * simultaneous logins can't both take the last slot.
   */
  async admit(
    tx: DbTx,
    userId: string,
    deviceToken: string | undefined,
    label: string | undefined,
  ): Promise<AdmittedDevice> {
    const [user] = await tx
      .select({ devicesResetAt: users.devicesResetAt })
      .from(users)
      .where(eq(users.id, userId))
      .for('update');
    const now = this.clock.now();

    if (deviceToken) {
      const [known] = await tx
        .select({ id: deviceRegistrations.id })
        .from(deviceRegistrations)
        .where(
          and(
            eq(deviceRegistrations.tokenHash, hashToken(deviceToken)),
            eq(deviceRegistrations.userId, userId),
            isNull(deviceRegistrations.revokedAt),
          ),
        );
      if (known) {
        await tx
          .update(deviceRegistrations)
          .set({ lastSeenAt: now })
          .where(eq(deviceRegistrations.id, known.id));
        return { deviceId: known.id };
      }
    }

    if (await this.policy.appliesTo(userId)) {
      const active = await this.activeDevices(tx, userId);
      if (active.length >= DEVICE_LIMIT) {
        throw new AppError(403, 'device_limit_reached', 'Too many devices', {
          devices: active.map((d) => ({ id: d.id, label: d.label, lastSeenAt: d.lastSeenAt })),
        });
      }
      const windowStart = new Date(
        Math.max(now.getTime() - DEVICE_WINDOW_MS, user?.devicesResetAt?.getTime() ?? 0),
      );
      const recent = await tx
        .select({ createdAt: deviceRegistrations.createdAt })
        .from(deviceRegistrations)
        .where(
          and(
            eq(deviceRegistrations.userId, userId),
            // Strictly after: registrations made up to a reset don't count against the new window.
            gt(deviceRegistrations.createdAt, windowStart),
          ),
        )
        .orderBy(deviceRegistrations.createdAt);
      if (recent.length >= NEW_DEVICES_PER_WINDOW) {
        const oldest = recent[recent.length - NEW_DEVICES_PER_WINDOW]?.createdAt ?? now;
        const freeAt = oldest.getTime() + DEVICE_WINDOW_MS;
        throw new AppError(403, 'device_cooldown', 'No new devices allowed yet', {
          retryAfterSeconds: Math.ceil((freeAt - now.getTime()) / 1000),
        });
      }
    }

    const newToken = generateSessionToken();
    const deviceId = this.ids.newId();
    await tx.insert(deviceRegistrations).values({
      id: deviceId,
      userId,
      tokenHash: hashToken(newToken),
      label: label?.slice(0, 120) ?? null,
      createdAt: now,
      lastSeenAt: now,
    });
    return { deviceId, newToken };
  }

  async list(userId: string, currentDeviceToken?: string): Promise<DeviceSummary[]> {
    const currentHash = currentDeviceToken ? hashToken(currentDeviceToken) : undefined;
    const rows = await this.db.transaction((tx) => this.activeDevices(tx, userId));
    return rows.map((d) => ({
      id: d.id,
      label: d.label,
      lastSeenAt: d.lastSeenAt,
      current: d.tokenHash === currentHash,
    }));
  }

  /** A user removes one of their own devices; its sessions end with it. */
  async revokeOwn(userId: string, deviceId: string, meta: RequestMeta): Promise<void> {
    await this.db.transaction(async (tx) => {
      const revoked = await this.revokeDevices(tx, userId, 'user', deviceId);
      if (revoked === 0) throw new AppError(404, 'not_found', 'Device not found');
      await this.audit.record(tx, {
        action: 'auth.device_revoked',
        workspaceId: null,
        actor: { type: 'user', userId },
        entity: { type: 'device', id: deviceId },
        requestId: meta.requestId,
      });
    });
  }

  /**
   * Staff or support reset: removes every device, ends every session and opens a fresh
   * registration window. The caller authorizes and audits it in its own workspace context.
   */
  async resetForUser(tx: DbTx, userId: string, by: 'staff' | 'support'): Promise<number> {
    const count = await this.revokeDevices(tx, userId, by);
    await tx
      .update(users)
      .set({ devicesResetAt: this.clock.now(), updatedAt: this.clock.now() })
      .where(eq(users.id, userId));
    return count;
  }

  private activeDevices(tx: DbTx, userId: string) {
    return tx
      .select()
      .from(deviceRegistrations)
      .where(and(eq(deviceRegistrations.userId, userId), isNull(deviceRegistrations.revokedAt)))
      .orderBy(desc(deviceRegistrations.lastSeenAt));
  }

  private async revokeDevices(
    tx: DbTx,
    userId: string,
    by: 'user' | 'staff' | 'support',
    deviceId?: string,
  ): Promise<number> {
    const now = this.clock.now();
    const revoked = await tx
      .update(deviceRegistrations)
      .set({ revokedAt: now, revokedByType: by })
      .where(
        and(
          eq(deviceRegistrations.userId, userId),
          isNull(deviceRegistrations.revokedAt),
          deviceId ? eq(deviceRegistrations.id, deviceId) : undefined,
        ),
      )
      .returning({ id: deviceRegistrations.id });
    for (const { id } of revoked) {
      await tx
        .update(sessions)
        .set({ revokedAt: now, revokeReason: 'device_revoked' })
        .where(and(eq(sessions.deviceId, id), isNull(sessions.revokedAt)));
    }
    return revoked.length;
  }
}
