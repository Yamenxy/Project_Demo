import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppError } from '../../src/common';
import { Authenticated, Public } from '../../src/common/policy';
import { insertUser } from '../support/fixtures';
import { createIntegrationApp } from '../support/integration-app';
import { signIn } from '../support/sessions';

let effects = 0;
let failNext = false;

@Controller('v1/probe')
class EffectController {
  @Post('effect')
  @HttpCode(201)
  @Authenticated()
  effect(@Body() body: { amount?: number }): { effects: number; amount: number } {
    if (failNext) {
      failNext = false;
      throw new AppError(409, 'temporary_conflict', 'Try again');
    }
    effects += 1;
    return { effects, amount: body.amount ?? 0 };
  }

  @Post('slow')
  @HttpCode(200)
  @Authenticated()
  async slow(): Promise<{ done: true }> {
    await new Promise((resolve) => setTimeout(resolve, 300));
    return { done: true };
  }

  @Post('anonymous')
  @HttpCode(200)
  @Public()
  anonymous(): { effects: number } {
    effects += 1;
    return { effects };
  }
}

let app: NestFastifyApplication;
let token: string;

function post(url: string, key: string | undefined, body: object = { amount: 5 }, as = token) {
  return app.inject({
    method: 'POST',
    url,
    payload: body,
    cookies: { lms_session: as },
    headers: key ? { 'idempotency-key': key } : {},
  });
}

const newKey = () => `key-${Math.random().toString(36).slice(2, 12)}`;

beforeAll(async () => {
  app = await createIntegrationApp(undefined, [EffectController]);
  token = await signIn(app, await insertUser());
});

afterAll(async () => {
  await app.close();
});

describe('idempotency keys', () => {
  it('runs a request once and replays the first response for the same key', async () => {
    const key = newKey();
    const first = await post('/api/v1/probe/effect', key);
    const second = await post('/api/v1/probe/effect', key);
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(201);
    expect(second.json()).toEqual(first.json());
    expect(second.headers['idempotent-replayed']).toBe('true');
    expect(first.headers['idempotent-replayed']).toBeUndefined();
  });

  it('runs every request without a key', async () => {
    const a = await post('/api/v1/probe/effect', undefined);
    const b = await post('/api/v1/probe/effect', undefined);
    expect(b.json<{ effects: number }>().effects).toBe(a.json<{ effects: number }>().effects + 1);
  });

  it('refuses the same key with a different body', async () => {
    const key = newKey();
    await post('/api/v1/probe/effect', key, { amount: 5 });
    const res = await post('/api/v1/probe/effect', key, { amount: 50 });
    expect(res.statusCode).toBe(422);
    expect(res.json<{ error: { code: string } }>().error.code).toBe('idempotency_key_reused');
  });

  it('keeps keys of different users apart', async () => {
    const key = newKey();
    const other = await signIn(app, await insertUser());
    const mine = await post('/api/v1/probe/effect', key);
    const theirs = await post('/api/v1/probe/effect', key, { amount: 5 }, other);
    expect(theirs.headers['idempotent-replayed']).toBeUndefined();
    expect(theirs.json<{ effects: number }>().effects).toBeGreaterThan(
      mine.json<{ effects: number }>().effects,
    );
  });

  it('does not store failures, so the same key can be retried', async () => {
    const key = newKey();
    failNext = true;
    expect((await post('/api/v1/probe/effect', key)).statusCode).toBe(409);
    const retry = await post('/api/v1/probe/effect', key);
    expect(retry.statusCode).toBe(201);
    expect(retry.headers['idempotent-replayed']).toBeUndefined();
  });

  it('reports a duplicate that arrives while the first is still running', async () => {
    const key = newKey();
    const [a, b] = await Promise.all([
      post('/api/v1/probe/slow', key, {}),
      new Promise((r) => setTimeout(r, 50)).then(() => post('/api/v1/probe/slow', key, {})),
    ]);
    expect(a.statusCode).toBe(200);
    expect(b.statusCode).toBe(409);
    expect(b.json<{ error: { code: string } }>().error.code).toBe('request_in_progress');
  });

  it('rejects a malformed key', async () => {
    const res = await post('/api/v1/probe/effect', 'bad key!');
    expect(res.json<{ error: { code: string } }>().error.code).toBe('invalid_idempotency_key');
  });

  it('ignores keys on anonymous requests', async () => {
    const key = newKey();
    const a = await app.inject({
      method: 'POST',
      url: '/api/v1/probe/anonymous',
      headers: { 'idempotency-key': key },
    });
    const b = await app.inject({
      method: 'POST',
      url: '/api/v1/probe/anonymous',
      headers: { 'idempotency-key': key },
    });
    expect(b.json<{ effects: number }>().effects).toBe(a.json<{ effects: number }>().effects + 1);
  });
});
