import type { IncomingHttpHeaders } from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { uuidV7 } from '../ids';

export const REQUEST_ID_HEADER = 'x-request-id';
const ACCEPTED_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;

/**
 * Reuses a well-formed request ID from a proxy or the web client (so a request can be traced
 * end to end) and otherwise generates one.
 */
export function generateRequestId(req: { headers: IncomingHttpHeaders }): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  if (typeof incoming === 'string' && ACCEPTED_REQUEST_ID.test(incoming)) return incoming;
  return uuidV7(Date.now());
}

/** Shared HTTP setup for main.ts and tests. */
export function configureHttp(app: NestFastifyApplication): void {
  app.setGlobalPrefix('api');
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRequest', (request, reply, done) => {
      void reply.header(REQUEST_ID_HEADER, request.id);
      done();
    });
}
