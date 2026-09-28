import type { LoggerService } from '@nestjs/common';
import pino, { type DestinationStream, type Logger as PinoLogger } from 'pino';
import { scrub } from './scrub';

export const LOG_LEVELS = ['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

interface RequestLike {
  id?: unknown;
  method?: unknown;
  url?: unknown;
}

/**
 * The root JSON logger. Every call is scrubbed (./scrub.ts) before it is written, and HTTP
 * requests are logged as id, method and path only: no query string, headers, body or IP.
 */
export function createRootLogger(level: LogLevel, destination?: DestinationStream): PinoLogger {
  return pino(
    {
      level,
      base: undefined,
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: { level: (label) => ({ level: label }) },
      serializers: {
        req: (req: RequestLike) => ({
          id: req.id,
          method: req.method,
          path: typeof req.url === 'string' ? req.url.split('?')[0] : undefined,
        }),
        res: (res: { statusCode?: unknown }) => ({ statusCode: res.statusCode }),
        err: (err: unknown) => scrub(err),
      },
      hooks: {
        logMethod(args, method) {
          method.apply(this, args.map((arg) => scrub(arg)) as Parameters<typeof method>);
        },
      },
    },
    destination,
  );
}

/** Adapts the root logger to NestJS so framework and application logs share one format. */
export class AppLogger implements LoggerService {
  constructor(private readonly root: PinoLogger) {}

  log(message: unknown, ...rest: unknown[]): void {
    this.write('info', message, rest);
  }

  error(message: unknown, ...rest: unknown[]): void {
    this.write('error', message, rest);
  }

  warn(message: unknown, ...rest: unknown[]): void {
    this.write('warn', message, rest);
  }

  debug(message: unknown, ...rest: unknown[]): void {
    this.write('debug', message, rest);
  }

  verbose(message: unknown, ...rest: unknown[]): void {
    this.write('trace', message, rest);
  }

  fatal(message: unknown, ...rest: unknown[]): void {
    this.write('fatal', message, rest);
  }

  /** NestJS passes the context (class name) as the last string argument. */
  private write(level: Exclude<LogLevel, 'silent'>, message: unknown, rest: unknown[]): void {
    const args = [...rest];
    const context = typeof args.at(-1) === 'string' ? (args.pop() as string) : undefined;
    const stack = typeof args[0] === 'string' ? args[0] : undefined;
    if (message !== null && typeof message === 'object') {
      this.root[level]({ context, stack, ...(message as Record<string, unknown>) });
    } else {
      this.root[level]({ context, stack }, String(message));
    }
  }
}
