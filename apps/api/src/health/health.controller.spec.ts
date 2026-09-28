import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createHttpTestApp } from '../../test/support/http-app';
import { AppModule } from '../app.module';

describe('GET /api/health', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createHttpTestApp({ imports: [AppModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ok with a request id header', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
