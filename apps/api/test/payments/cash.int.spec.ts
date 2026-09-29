import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };

function call(method: 'GET' | 'POST', url: string, token: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { lms_session: token },
    ...(payload ? { payload } : {}),
  });
}

function cairoToday(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Cairo' }).format(new Date());
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('cash and income (REQ-PAY-003, REQ-PAY-007)', () => {
  it('per-collector totals equal their payments, handovers reduce what they hold', async () => {
    const owner = await insertUser();
    const workspaceId = await insertWorkspace(owner);
    const w = `/api/v1/w/${workspaceId}`;
    const ownerToken = await signIn(app, owner, { twoFactor: true });
    const helper = await insertUser();
    const helperMembership = await insertMembership(workspaceId, helper, 'assistant');
    await adminQuery(
      `insert into permission_grants (workspace_id, id, membership_id, permission, granted_by, created_at)
       values ($1, gen_random_uuid(), $2, 'payments.record', $3, now())`,
      [workspaceId, helperMembership, owner],
    );
    const helperToken = await signIn(app, helper);
    const student = await insertMembership(workspaceId, await insertUser(), 'student');
    const pay = (token: string, amountPiastres: number, method = 'cash') =>
      call('POST', `${w}/payments`, token, { membershipId: student, amountPiastres, method });

    await pay(helperToken, 10000);
    await pay(helperToken, 5000);
    const reversible = (await pay(helperToken, 2000)).json<{ id: string }>().id;
    await pay(ownerToken, 7000);
    await pay(ownerToken, 30000, 'transfer');
    await call('POST', `${w}/payments/${reversible}/reverse`, ownerToken, { reason: 'خطأ' });

    const day = (await call('GET', `${w}/reports/cash-day?date=${cairoToday()}`, ownerToken)).json<{
      collectors: { userId: string; collectedPiastres: number; payments: number }[];
    }>();
    const byUser = Object.fromEntries(day.collectors.map((c) => [c.userId, c]));
    // The reversal was given back by the owner, from the owner's cash.
    expect(byUser[helper]).toMatchObject({ collectedPiastres: 17000, payments: 3 });
    expect(byUser[owner]).toMatchObject({ collectedPiastres: 5000, payments: 1 });
    const [sums] = await adminQuery<{ helper: string }>(
      `select sum(amount_piastres) as helper from payment_entries
        where workspace_id = $1 and collected_by = $2 and kind = 'payment'`,
      [workspaceId, helper],
    );
    expect(Number(sums?.helper)).toBe(byUser[helper]?.collectedPiastres);

    // The helper hands 15000 over; the owner confirms.
    const handover = await call('POST', `${w}/cash/handovers`, helperToken, {
      amountPiastres: 15000,
    });
    expect(handover.statusCode).toBe(201);
    const id = handover.json<{ id: string }>().id;
    let mine = (await call('GET', `${w}/cash`, helperToken)).json<{
      balances: { userId: string; holdingPiastres: number; pendingHandoverPiastres: number }[];
    }>();
    expect(mine.balances).toEqual([
      expect.objectContaining({
        userId: helper,
        holdingPiastres: 17000,
        pendingHandoverPiastres: 15000,
      }),
    ]);
    expect((await call('POST', `${w}/cash/handovers/${id}/confirm`, helperToken)).statusCode).toBe(
      403,
    );
    expect((await call('POST', `${w}/cash/handovers/${id}/confirm`, ownerToken)).statusCode).toBe(
      204,
    );
    mine = (await call('GET', `${w}/cash`, helperToken)).json();
    expect(mine.balances[0]).toMatchObject({ holdingPiastres: 2000, pendingHandoverPiastres: 0 });
    expect(
      (
        await call('POST', `${w}/cash/handovers`, ownerToken, { amountPiastres: 100 })
      ).json<ErrorJson>().error.code,
    ).toBe('owner_holds_cash');

    // Income nets out the reversal.
    const today = cairoToday();
    const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + 86_400_000)
      .toISOString()
      .slice(0, 10);
    const income = (
      await call('GET', `${w}/reports/income?from=${today}&to=${tomorrow}`, ownerToken)
    ).json<{ netPiastres: number; byMethod: { method: string; paidPiastres: number }[] }>();
    expect(income.netPiastres).toBe(10000 + 5000 + 2000 + 7000 + 30000 - 2000);
    expect(income.byMethod.map((m) => m.method)).toEqual(['cash', 'transfer']);
    expect(
      (await call('GET', `${w}/reports/income?from=${today}&to=${tomorrow}`, helperToken))
        .statusCode,
    ).toBe(403);
  });
});
