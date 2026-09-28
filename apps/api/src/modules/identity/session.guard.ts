import {
  createParamDecorator,
  Injectable,
  SetMetadata,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../common';
import { SESSION_COOKIE } from './session-cookie';
import { SessionsService, type ResolvedSession } from './sessions.service';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: ResolvedSession;
  }
}

const ALLOW_PENDING_SECOND_FACTOR = 'allowPendingSecondFactor';

/**
 * Marks a route usable by a session that still owes its second factor: only the 2FA check
 * itself, "who am I" and logout (REQ-AUTH-007).
 */
export const AllowPendingSecondFactor = () => SetMetadata(ALLOW_PENDING_SECOND_FACTOR, true);

/** Requires a live, fully verified session cookie and attaches it to the request. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(
    private readonly sessions: SessionsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.cookies[SESSION_COOKIE];
    const session = token ? await this.sessions.resolve(token) : null;
    if (!session) throw new AppError(401, 'unauthenticated', 'Authentication required');
    if (session.secondFactorPending) {
      const allowed = this.reflector.getAllAndOverride<boolean | undefined>(
        ALLOW_PENDING_SECOND_FACTOR,
        [context.getHandler(), context.getClass()],
      );
      if (!allowed) {
        throw new AppError(401, 'second_factor_required', 'Enter your authenticator code');
      }
    }
    request.auth = session;
    return true;
  }
}

/** The session attached by SessionGuard. */
export const CurrentSession = createParamDecorator(
  (_: unknown, context: ExecutionContext): ResolvedSession => {
    const session = context.switchToHttp().getRequest<FastifyRequest>().auth;
    if (!session) throw new AppError(401, 'unauthenticated', 'Authentication required');
    return session;
  },
);
