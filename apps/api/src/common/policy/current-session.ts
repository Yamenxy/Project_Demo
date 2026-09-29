import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../errors';

/** The signed-in session, as the access guard attaches it to the request. */
export interface SessionContext {
  sessionId: string;
  userId: string;
  userStatus: string;
  twoFactorEnabled: boolean;
  secondFactorPending: boolean;
  /** Guardian consent state (REQ-PRIV-001); enforced for student memberships only. */
  consent: 'not_required' | 'granted' | 'needed' | 'overdue';
}

declare module 'fastify' {
  interface FastifyRequest {
    auth?: SessionContext;
  }
}

/** The session of any non-public route. */
export const CurrentSession = createParamDecorator(
  (_: unknown, context: ExecutionContext): SessionContext => {
    const session = context.switchToHttp().getRequest<FastifyRequest>().auth;
    if (!session) throw new AppError(401, 'unauthenticated', 'Authentication required');
    return session;
  },
);
