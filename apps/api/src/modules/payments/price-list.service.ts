import { Injectable } from '@nestjs/common';
import { asc, eq, isNull, sql } from 'drizzle-orm';
import { Clock, IdGenerator, notFound } from '../../common';
import { TenantDb } from '../../database';
import { AuditService } from '../audit';
import { priceItems } from './schema';

export interface Actor {
  userId: string;
  requestId?: string;
}

export interface PriceItem {
  id: string;
  name: string;
  amountPiastres: number;
  currency: string;
  description: string | null;
  archived: boolean;
}

export interface PriceItemInput {
  name: string;
  amountPiastres: number;
  currency?: string;
  description?: string | null;
}

/** The owner's price list (REQ-PAY-006). */
@Injectable()
export class PriceListService {
  constructor(
    private readonly db: TenantDb,
    private readonly audit: AuditService,
    private readonly ids: IdGenerator,
    private readonly clock: Clock,
  ) {}

  async list(workspaceId: string, options: { archived: boolean }): Promise<PriceItem[]> {
    const rows = await this.db.inWorkspace(workspaceId, (tx) =>
      tx
        .select()
        .from(priceItems)
        .where(
          options.archived
            ? sql`${priceItems.archivedAt} is not null`
            : isNull(priceItems.archivedAt),
        )
        .orderBy(asc(priceItems.amountPiastres), asc(priceItems.name)),
    );
    return rows.map((r) => ({
      id: r.id,
      name: r.name,
      amountPiastres: r.amountPiastres,
      currency: r.currency,
      description: r.description,
      archived: r.archivedAt !== null,
    }));
  }

  async create(workspaceId: string, input: PriceItemInput, actor: Actor): Promise<{ id: string }> {
    const id = this.ids.newId();
    const now = this.clock.now();
    await this.db.inWorkspace(workspaceId, async (tx) => {
      await tx.insert(priceItems).values({
        workspaceId,
        id,
        name: input.name.trim(),
        amountPiastres: input.amountPiastres,
        currency: input.currency ?? 'EGP',
        description: input.description?.trim() || null,
        createdAt: now,
        updatedAt: now,
      });
      await this.audit.record(tx, {
        action: 'price_item.created',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'price_item', id },
        newValue: { name: input.name.trim(), amountPiastres: input.amountPiastres },
        requestId: actor.requestId,
      });
    });
    return { id };
  }

  /** Changes apply to future payments only: payments keep the name and price they copied. */
  async update(
    workspaceId: string,
    itemId: string,
    change: Partial<PriceItemInput> & { archived?: boolean },
    actor: Actor,
  ): Promise<void> {
    await this.db.inWorkspace(workspaceId, async (tx) => {
      const [current] = await tx
        .select()
        .from(priceItems)
        .where(eq(priceItems.id, itemId))
        .for('update');
      if (!current) throw notFound('Price item not found');
      const now = this.clock.now();
      await tx
        .update(priceItems)
        .set({
          ...(change.name === undefined ? {} : { name: change.name.trim() }),
          ...(change.amountPiastres === undefined ? {} : { amountPiastres: change.amountPiastres }),
          ...(change.currency === undefined ? {} : { currency: change.currency }),
          ...(change.description === undefined
            ? {}
            : { description: change.description?.trim() || null }),
          ...(change.archived === undefined ? {} : { archivedAt: change.archived ? now : null }),
          updatedAt: now,
        })
        .where(eq(priceItems.id, itemId));
      await this.audit.record(tx, {
        action:
          change.archived === true
            ? 'price_item.archived'
            : change.archived === false
              ? 'price_item.restored'
              : 'price_item.updated',
        workspaceId,
        actor: { type: 'user', userId: actor.userId },
        entity: { type: 'price_item', id: itemId },
        oldValue: { name: current.name, amountPiastres: current.amountPiastres },
        newValue: {
          ...(change.name === undefined ? {} : { name: change.name.trim() }),
          ...(change.amountPiastres === undefined ? {} : { amountPiastres: change.amountPiastres }),
        },
        requestId: actor.requestId,
      });
    });
  }
}
