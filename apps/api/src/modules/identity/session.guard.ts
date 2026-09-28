import {
  createParamDecorator,
  Injectable,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../common';
import { SESSION_COOKIE } from './session-cookie';
import { SessionsService, type ResolvedSession } from './sessions.service';

declare module 'fastify' {
  interface FastifyRequest {
    auth?: ResolvedSession;
  }
}

/** Requires a live session cookie and attaches it to the request. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(private readonly sessions: SessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const token = request.cookies[SESSION_COOKIE];
    const session = token ? await this.sessions.resolve(token) : null;
    if (!session) throw new AppError(401, 'unauthenticated', 'Authentication required');
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
