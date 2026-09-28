import type { FastifyRequest } from 'fastify';

/** Request details recorded with security events (IP and user agent go to personal context). */
export interface RequestMeta {
  ip: string;
  userAgent?: string;
  requestId: string;
}

export function metaOf(request: FastifyRequest): RequestMeta {
  return {
    ip: request.ip,
    userAgent: request.headers['user-agent'],
    requestId: String(request.id),
  };
}
