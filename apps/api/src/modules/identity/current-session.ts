import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { AppError } from '../../common';
import type { ResolvedSession } from './sessions.service';

/** The session the access guard attached to the request (any non-public route). */
export const CurrentSession = createParamDecorator(
  (_: unknown, context: ExecutionContext): ResolvedSession => {
    const session = context.switchToHttp().getRequest<FastifyRequest>().auth;
    if (!session) throw new AppError(401, 'unauthenticated', 'Authentication required');
    return session;
  },
);
