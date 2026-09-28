import { BadRequestException, Controller, Get, Module } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createHttpTestApp } from '../../../test/support/http-app';
import { CommonModule } from '../common.module';
import { AppError } from '../errors';

@Controller('probe')
class ProbeController {
  @Get('app-error')
  appError(): never {
    throw new AppError(409, 'already_member', 'Student is already a member', { field: 'phone' });
  }

  @Get('http-error')
  httpError(): never {
    throw new BadRequestException('bad input');
  }

  @Get('zod-error')
  zodError(): void {
    z.object({ phone: z.string().min(11) }).parse({ phone: '0101' });
  }

  @Get('bug')
  bug(): never {
    throw new Error('db password is hunter2');
  }
}

@Module({ imports: [CommonModule], controllers: [ProbeController] })
class ProbeModule {}

type ErrorJson = { error: { code: string; details?: unknown } };

describe('HTTP error format and request ids', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createHttpTestApp({ imports: [ProbeModule] });
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns application errors with their code, details and the request id', async () => {
    const res = await app.inject({ url: '/api/probe/app-error' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      error: {
        code: 'already_member',
        message: 'Student is already a member',
        requestId: res.headers['x-request-id'],
        details: { field: 'phone' },
      },
    });
  });

  it('maps framework HTTP errors to stable codes', async () => {
    const res = await app.inject({ url: '/api/probe/http-error' });
    expect(res.statusCode).toBe(400);
    expect(res.json<ErrorJson>().error.code).toBe('bad_request');
  });

  it('reports validation failures by path and rule, never by value', async () => {
    const res = await app.inject({ url: '/api/probe/zod-error' });
    expect(res.statusCode).toBe(400);
    const body = res.json<ErrorJson>();
    expect(body.error.code).toBe('validation_failed');
    expect(body.error.details).toEqual([{ path: 'phone', code: 'too_small' }]);
    expect(res.body).not.toContain('0101');
  });

  it('hides the message of unexpected errors', async () => {
    const res = await app.inject({ url: '/api/probe/bug' });
    expect(res.statusCode).toBe(500);
    expect(res.json<ErrorJson>().error.code).toBe('internal_error');
    expect(res.body).not.toContain('hunter2');
  });

  it('uses the same format for unknown routes without echoing the URL', async () => {
    const res = await app.inject({ url: '/api/does-not-exist?token=abc&phone=01012345678' });
    expect(res.statusCode).toBe(404);
    expect(res.json<ErrorJson>().error.code).toBe('not_found');
    expect(res.body).not.toContain('01012345678');
    expect(res.body).not.toContain('token');
  });

  it('echoes a well-formed incoming request id and replaces a malformed one', async () => {
    const good = await app.inject({
      url: '/api/probe/http-error',
      headers: { 'x-request-id': 'trace-12345678' },
    });
    expect(good.headers['x-request-id']).toBe('trace-12345678');
    const bad = await app.inject({
      url: '/api/probe/http-error',
      headers: { 'x-request-id': 'bad id; drop table' },
    });
    expect(bad.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });
});
