import type { IncomingHttpHeaders } from 'node:http';
import fastifyCookie from '@fastify/cookie';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { uuidV7 } from '../ids';

export const REQUEST_ID_HEADER = 'x-request-id';
const ACCEPTED_REQUEST_ID = /^[A-Za-z0-9-]{8,64}$/;
const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Reuses a well-formed request ID from a proxy or the web client (so a request can be traced
 * end to end) and otherwise generates one.
 */
export function generateRequestId(req: { headers: IncomingHttpHeaders }): string {
  const incoming = req.headers[REQUEST_ID_HEADER];
  if (typeof incoming === 'string' && ACCEPTED_REQUEST_ID.test(incoming)) return incoming;
  return uuidV7(Date.now());
}

export interface HttpOptions {
  /** Origins allowed to make state-changing requests (the web app). */
  allowedOrigins: string[];
}

/** Shared HTTP setup for main.ts and tests. */
/** The largest file upload (REQ-FILE-001). */
export const UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;

/**
 * The largest lesson video upload on the free setup. The body is held in memory, so this stays
 * modest; production uploads go straight to object storage (paid-services.md).
 */
export const VIDEO_UPLOAD_LIMIT_BYTES = 200 * 1024 * 1024;

export async function configureHttp(
  app: NestFastifyApplication,
  options: HttpOptions,
): Promise<void> {
  app.setGlobalPrefix('api');
  await app.register(fastifyCookie);
  const allowed = new Set(options.allowedOrigins);
  const fastify = app.getHttpAdapter().getInstance();

  // File uploads send raw bytes (REQ-FILE-001). Not a CORS-simple type, so another site can't
  // send one without a preflight; the Origin check below still applies.
  fastify.addContentTypeParser(
    'application/octet-stream',
    { parseAs: 'buffer', bodyLimit: VIDEO_UPLOAD_LIMIT_BYTES },
    (_request, body, done) => done(null, body),
  );

  fastify.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    // CSRF defence for cookie sessions: browsers send Origin on cross-site requests, so a
    // state-changing request from any other site is refused. SameSite=Lax cookies and the JSON-only
    // body parser are the other two layers.
    const origin = request.headers.origin;
    if (
      STATE_CHANGING_METHODS.has(request.method) &&
      origin !== undefined &&
      !allowed.has(origin)
    ) {
      void reply.status(403).send({
        error: { code: 'forbidden_origin', message: 'Origin not allowed', requestId: request.id },
      });
      return;
    }
    done();
  });
}
