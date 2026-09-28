import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { AppError, type ErrorBody } from '../errors';

// Framework errors get a fixed message: their own messages can echo request input (for example
// the full URL with its query string), which must not be reflected back or logged.
const FRAMEWORK_ERRORS: Record<number, { code: string; message: string }> = {
  400: { code: 'bad_request', message: 'Bad request' },
  401: { code: 'unauthenticated', message: 'Authentication required' },
  403: { code: 'forbidden', message: 'Not allowed' },
  404: { code: 'not_found', message: 'Resource not found' },
  405: { code: 'method_not_allowed', message: 'Method not allowed' },
  409: { code: 'conflict', message: 'Conflict' },
  413: { code: 'payload_too_large', message: 'Payload too large' },
  415: { code: 'unsupported_media_type', message: 'Unsupported media type' },
  422: { code: 'unprocessable', message: 'Unprocessable request' },
  429: { code: 'rate_limited', message: 'Too many requests' },
};

export function toErrorResponse(
  exception: unknown,
  requestId: string,
): { status: number; body: ErrorBody } {
  const make = (status: number, code: string, message: string, details?: unknown) => ({
    status,
    body: {
      error: { code, message, requestId, ...(details === undefined ? {} : { details }) },
    },
  });

  if (exception instanceof AppError) {
    return make(exception.status, exception.code, exception.message, exception.details);
  }
  if (exception instanceof ZodError) {
    // Paths and rule codes only, never the submitted values.
    const details = exception.issues.map((issue) => ({
      path: issue.path.join('.'),
      code: issue.code,
    }));
    return make(400, 'validation_failed', 'Request validation failed', details);
  }
  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    if (status < 500) {
      const known = FRAMEWORK_ERRORS[status] ?? {
        code: `http_${status}`,
        message: 'Request failed',
      };
      return make(status, known.code, known.message);
    }
  }
  // Anything else is a bug: never expose its message or stack (review §3.31, safe errors).
  return make(500, 'internal_error', 'Internal server error');
}

/** One JSON error format for every endpoint (review §3.33). */
@Catch()
export class HttpErrorFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const { status, body } = toErrorResponse(exception, String(request.id));
    if (status >= 500) {
      this.logger.error({ event: 'unhandled_error', requestId: request.id, err: exception });
    }
    void reply.status(status).send(body);
  }
}
