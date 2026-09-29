import { Controller, Get } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { Clock, notFound } from '../../common';
import { WorkspaceRoles } from '../../common/policy';
import { TenantDb } from '../../database';
import { CurrentWorkspace, type WorkspaceContext } from '../tenancy';
import { subscriptionStatus, type SubscriptionStatus } from './billing-rules';
import { platformPayments, subscriptions, type PaymentMethod, type Plan } from './schema';

export interface BillingView {
  plan: Plan;
  periodEndsAt: Date;
  status: SubscriptionStatus;
  payments: {
    amountPiastres: number;
    method: PaymentMethod;
    paidOn: string;
    months: number;
  }[];
}

/**
 * The teacher's own subscription and payment history (REQ-SUB-001). Available while suspended,
 * because renewing is what a suspended owner can still do (D12a, REQ-RBAC-004).
 */
@Controller('v1/w/:workspaceId/billing')
export class BillingController {
  constructor(
    private readonly db: TenantDb,
    private readonly clock: Clock,
  ) {}

  @Get()
  @WorkspaceRoles(['owner'], { allowWhenSuspended: ['owner'] })
  async view(@CurrentWorkspace() ctx: WorkspaceContext): Promise<BillingView> {
    return this.db.inWorkspace(ctx.workspaceId, async (tx) => {
      const [sub] = await tx
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.workspaceId, ctx.workspaceId));
      if (!sub) throw notFound('Subscription not found');
      const payments = await tx
        .select({
          amountPiastres: platformPayments.amountPiastres,
          method: platformPayments.method,
          paidOn: platformPayments.paidOn,
          months: platformPayments.months,
        })
        .from(platformPayments)
        .where(eq(platformPayments.workspaceId, ctx.workspaceId))
        .orderBy(desc(platformPayments.createdAt));
      return {
        plan: sub.plan,
        periodEndsAt: sub.periodEndsAt,
        status: subscriptionStatus(
          sub.periodEndsAt,
          sub.graceDays,
          payments.length > 0,
          this.clock.now(),
        ),
        payments,
      };
    });
  }
}
