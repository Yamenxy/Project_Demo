import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminQuery, insertMembership, insertUser, insertWorkspace } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let app: NestFastifyApplication;

type ErrorJson = { error: { code: string } };
type RequestJson = {
  id: string;
  status: string;
  duplicateReference: boolean;
  rejectReason: string | null;
  resubmitsId: string | null;
};

function call(method: 'GET' | 'POST', url: string, token: string, payload?: object) {
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
  await insertMembership(workspaceId, studentUser, 'student');
  const studentToken = await signIn(app, studentUser);
  return { owner, workspaceId, ownerToken, studentToken, w: `/api/v1/w/${workspaceId}` };
}

const request = { amountPiastres: 30000, method: 'wallet', reference: 'VF-123456' };

beforeAll(async () => {
  app = await createIntegrationApp();
});

afterAll(async () => {
  await app.close();
});

describe('payment requests (REQ-PAY-008, REQ-PAY-010)', () => {
  it('20 parallel approvals produce exactly one ledger entry and one receipt', async () => {
    const s = await setup();
    const id = (await call('POST', `${s.w}/my/payment-requests`, s.studentToken, request)).json<{
      id: string;
    }>().id;
    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        call('POST', `${s.w}/payment-requests/${id}/approve`, s.ownerToken),
      ),
    );
    expect(results.filter((r) => r.statusCode === 200)).toHaveLength(1);
    expect(
      results
        .filter((r) => r.statusCode !== 200)
        .every((r) => r.json<ErrorJson>().error.code === 'request_not_pending'),
    ).toBe(true);
    const [ledger] = await adminQuery<{ n: string; counter: number }>(
      `select (select count(*) from payment_entries where workspace_id = $1) as n,
              (select last_number from receipt_counters where workspace_id = $1) as counter`,
      [s.workspaceId],
    );
    expect(ledger).toEqual({ n: '1', counter: 1 });
  });

  it('rejects with a reason, links a resubmission, and flags reused references', async () => {
    const s = await setup();
    const first = (await call('POST', `${s.w}/my/payment-requests`, s.studentToken, request)).json<{
      id: string;
    }>().id;
    const noReason = await call('POST', `${s.w}/payment-requests/${first}/reject`, s.ownerToken, {
      reason: '',
    });
    expect(noReason.statusCode).toBe(400);
    await call('POST', `${s.w}/payment-requests/${first}/reject`, s.ownerToken, {
      reason: 'المبلغ غير واضح',
    });
    const second = await call('POST', `${s.w}/my/payment-requests`, s.studentToken, {
      ...request,
      resubmitsId: first,
    });
    expect(second.statusCode).toBe(201);
    const mine = (await call('GET', `${s.w}/my/payment-requests`, s.studentToken)).json<{
      requests: RequestJson[];
    }>().requests;
    expect(mine.map((r) => [r.status, r.duplicateReference])).toEqual([
      ['pending', true],
      ['rejected', true],
    ]);
    expect(mine[0]?.resubmitsId).toBe(first);
    expect(mine[1]?.rejectReason).toBe('المبلغ غير واضح');
    // Resubmitting something that isn't rejected is refused.
    const bad = await call('POST', `${s.w}/my/payment-requests`, s.studentToken, {
      ...request,
      resubmitsId: mine[0]?.id,
    });
    expect(bad.json<ErrorJson>().error.code).toBe('not_rejected');
  });

  it('the student can cancel before review; decided requests stay as they are', async () => {
    const s = await setup();
    const id = (await call('POST', `${s.w}/my/payment-requests`, s.studentToken, request)).json<{
      id: string;
    }>().id;
    expect(
      (await call('POST', `${s.w}/my/payment-requests/${id}/cancel`, s.studentToken)).statusCode,
    ).toBe(204);
    const approve = await call('POST', `${s.w}/payment-requests/${id}/approve`, s.ownerToken);
    expect(approve.json<ErrorJson>().error.code).toBe('request_not_pending');
    const audit = await adminQuery<{ action: string }>(
      `select action from audit_log where workspace_id = $1 and action like 'payment_request.%'`,
      [s.workspaceId],
    );
    expect(audit.map((a) => a.action).sort()).toEqual([
      'payment_request.cancelled',
      'payment_request.submitted',
    ]);
  });

  it('an approver whose permission was just revoked gets 403', async () => {
    const s = await setup();
    const helper = await insertUser();
    const helperMembership = await insertMembership(s.workspaceId, helper, 'assistant');
    await adminQuery(
      `insert into permission_grants (workspace_id, id, membership_id, permission, granted_by, created_at)
       values ($1, gen_random_uuid(), $2, 'payments.confirm', $3, now())`,
      [s.workspaceId, helperMembership, s.owner],
    );
    const helperToken = await signIn(app, helper);
    const id = (await call('POST', `${s.w}/my/payment-requests`, s.studentToken, request)).json<{
      id: string;
    }>().id;
    const listed = await call('GET', `${s.w}/payment-requests?status=pending`, helperToken);
    expect(listed.json<{ requests: unknown[] }>().requests).toHaveLength(1);
    await adminQuery('delete from permission_grants where membership_id = $1', [helperMembership]);
    expect(
      (await call('POST', `${s.w}/payment-requests/${id}/approve`, helperToken)).statusCode,
    ).toBe(403);
    const [count] = await adminQuery<{ n: string }>(
      'select count(*) as n from payment_entries where workspace_id = $1',
      [s.workspaceId],
    );
    expect(count?.n).toBe('0');
  });
});
