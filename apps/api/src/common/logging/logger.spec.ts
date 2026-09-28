import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { AppLogger, createRootLogger } from './logger';

function capture(): { lines: () => Record<string, unknown>[]; stream: Writable } {
  const chunks: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _enc, done) {
      chunks.push(chunk.toString());
      done();
    },
  });
  const lines = () =>
    chunks
      .join('')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  return { lines, stream };
}

describe('structured logging', () => {
  it('writes JSON with level, time, context and scrubbed fields', () => {
    const { lines, stream } = capture();
    const logger = new AppLogger(createRootLogger('info', stream));
    logger.log({ event: 'user_registered', userId: 'u1', phone: '01012345678' }, 'Identity');
    const [line] = lines();
    expect(line).toMatchObject({
      level: 'info',
      context: 'Identity',
      event: 'user_registered',
      userId: 'u1',
      phone: '[redacted]',
    });
    expect(typeof line?.time).toBe('string');
  });

  it('masks personal data inside plain messages', () => {
    const { lines, stream } = capture();
    new AppLogger(createRootLogger('info', stream)).warn('failed for ali@example.com', 'Mail');
    expect(lines()[0]?.msg).toBe('failed for [email]');
  });

  it('logs requests as id, method and path only', () => {
    const { lines, stream } = capture();
    const root = createRootLogger('info', stream);
    root.info({ req: { id: 'r1', method: 'GET', url: '/api/x?token=secret', headers: { a: 1 } } });
    expect(lines()[0]?.req).toEqual({ id: 'r1', method: 'GET', path: '/api/x' });
  });

  it('respects the level', () => {
    const { lines, stream } = capture();
    new AppLogger(createRootLogger('warn', stream)).log('ignored');
    expect(lines()).toEqual([]);
  });
});
