import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };
type Entry = {
  id: string;
  receiptNumber: number;
  kind: string;
  amountPiastres: number;
  collectedBy: { userId: string } | null;
  itemName: string | null;
  reversed: boolean;
};

function call(method: 'GET' | 'POST' | 'PUT', url: string, token: string, payload?: object) {
  return app.inject({
    method,
    url,
    cookies: { lms_session: token },
    ...(payload ? { payload } : {}),
  });
}

async function setup() {
  const owner = await insertUser();
  const workspaceId = await insertWorkspace(owner);
  const ownerToken = await signIn(app, owner, { twoFactor: true });
  const studentUser = await insertUser();
  const student = await insertMembership(workspaceId, studentUser, 'student');
  return { owner, workspaceId, ownerToken, studentUser, student, w: `/api/v1/w/${workspaceId}` };
}

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('payment ledger (REQ-PAY-003, REQ-PAY-004, REQ-PAY-007)', () => {
  it('records a cash payment with its collector and a copy of the price item', async () => {
    const s = await setup();
    const item = (
      await call('POST', `${s.w}/price-items`, s.ownerToken, {
        name: 'اشتراك شهري',
        amountPiastres: 30000,
      })
    ).json<{ id: string }>().id;
    const paid = await call('POST', `${s.w}/payments`, s.ownerToken, {
      membershipId: s.student,
      amountPiastres: 25000, // the amount actually received (D20)
      method: 'cash',
      priceItemId: item,
    });
    expect(paid.statusCode).toBe(201);
    expect(paid.json()).toMatchObject({ receiptNumber: 1 });
    // A later price change doesn't touch the payment.
    await call('POST', `${s.w}/price-items/${item}`, s.ownerToken, {
      name: 'اشتراك شهري جديد',
      amountPiastres: 40000,
    });
    const entries = (await call('GET', `${s.w}/payments`, s.ownerToken)).json<{
      entries: Entry[];
    }>().entries;
    expect(entries[0]).toMatchObject({
      amountPiastres: 25000,
      itemName: 'اشتراك شهري',
      collectedBy: { userId: s.owner },
    });
    const [copy] = await adminQuery<{ price: string }>(
      'select item_price_piastres as price from payment_entries where workspace_id = $1',
      [s.workspaceId],
    );
    expect(copy?.price).toBe('30000');

    // The student sees their receipt and gets a notification.
    const studentToken = await signIn(app, s.studentUser);
    const mine = (await call('GET', `${s.w}/my/payments`, studentToken)).json<{
      entries: Entry[];
    }>();
    expect(mine.entries.map((e) => e.receiptNumber)).toEqual([1]);
    const receipt = await call('GET', `${s.w}/payments/${entries[0]?.id}`, studentToken);
    expect(receipt.statusCode).toBe(200);
    const [note] = await adminQuery<{ type: string }>(
      'select type from notifications where recipient_user_id = $1',
      [s.studentUser],
    );
    expect(note?.type).toBe('payment.recorded');
  });

  it('20 concurrent payments get receipt numbers 1 to 20 with no gaps', async () => {
    const s = await setup();
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        call('POST', `${s.w}/payments`, s.ownerToken, {
          membershipId: s.student,
          amountPiastres: 1000,
          method: 'transfer',
        }),
      ),
    );
    const numbers = results.map((r) => r.json<{ receiptNumber: number }>().receiptNumber);
    expect([...numbers].sort((a, b) => a - b)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1));
  });

  it('reverses once, keeps the original, and the database refuses updates and deletes', async () => {
    const s = await setup();
    const id = (
      await call('POST', `${s.w}/payments`, s.ownerToken, {
        membershipId: s.student,
        amountPiastres: 5000,
        method: 'cash',
      })
    ).json<{ id: string }>().id;
    const reversed = await call('POST', `${s.w}/payments/${id}/reverse`, s.ownerToken, {
      reason: 'دفع بالخطأ',
    });
    expect(reversed.json()).toMatchObject({ receiptNumber: 2 });
    const again = await call('POST', `${s.w}/payments/${id}/reverse`, s.ownerToken, {
      reason: 'مرة ثانية',
    });
    expect(again.json<ErrorJson>().error.code).toBe('already_reversed');
    const entries = (await call('GET', `${s.w}/payments`, s.ownerToken)).json<{
      entries: Entry[];
    }>().entries;
    expect(entries.map((e) => [e.receiptNumber, e.kind, e.reversed])).toEqual([
      [2, 'reversal', false],
      [1, 'payment', true],
    ]);
    const [privileges] = await adminQuery<{ upd: boolean; del: boolean }>(
      `select has_table_privilege('app_runtime', 'payment_entries', 'UPDATE') as upd,
              has_table_privilege('app_runtime', 'payment_entries', 'DELETE') as del`,
    );
    expect(privileges).toEqual({ upd: false, del: false });
    const [audit] = await adminQuery<{ reason: string }>(
      `select reason from audit_log where workspace_id = $1 and action = 'payment.reversed'`,
      [s.workspaceId],
    );
    expect(audit?.reason).toBe('دفع بالخطأ');
  });

  it('respects permissions and class scope', async () => {
    const s = await setup();
    const helper = await insertUser();
    const helperMembership = await insertMembership(s.workspaceId, helper, 'assistant');
    const helperToken = await signIn(app, helper);
    const body = { membershipId: s.student, amountPiastres: 1000, method: 'cash' };
    expect((await call('POST', `${s.w}/payments`, helperToken, body)).statusCode).toBe(403);

    // Limited to a class the student isn't in: the student is out of reach.
    const classId = (
      await call('POST', `${s.w}/classes`, s.ownerToken, { name: 'فصل المساعد' })
    ).json<{ id: string }>().id;
    await call(
      'PUT',
      `${s.w}/memberships/${helperMembership}/permissions/payments.record`,
      s.ownerToken,
      { classIds: [classId] },
    );
    expect((await call('POST', `${s.w}/payments`, helperToken, body)).statusCode).toBe(404);
    await call('POST', `${s.w}/classes/${classId}/students`, s.ownerToken, {
      membershipIds: [s.student],
    });
    const ok = await call('POST', `${s.w}/payments`, helperToken, body);
    expect(ok.statusCode).toBe(201);
    // Recording doesn't let the helper see the ledger, or reverse.
    expect((await call('GET', `${s.w}/payments`, helperToken)).statusCode).toBe(403);
    const id = ok.json<{ id: string }>().id;
    expect(
      (await call('POST', `${s.w}/payments/${id}/reverse`, helperToken, { reason: 'تجربة' }))
        .statusCode,
    ).toBe(403);
    // Another student can't read someone else's receipt.
    const other = await insertUser();
    await insertMembership(s.workspaceId, other, 'student');
    expect((await call('GET', `${s.w}/payments/${id}`, await signIn(app, other))).statusCode).toBe(
      404,
    );
  });
});
