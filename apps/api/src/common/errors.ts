/**
 * Application errors carry a stable machine-readable `code`. The web client translates codes
 * into Arabic or English text; `message` is for developers and logs only.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/**
 * Used for resources outside the caller's workspace or scope, so the response doesn't reveal
 * whether the resource exists (REQ-SEC-001).
 */
export function notFound(message = 'Resource not found'): AppError {
  return new AppError(404, 'not_found', message);
}

export function forbidden(message = 'Not allowed'): AppError {
  return new AppError(403, 'forbidden', message);
}

export function conflict(code: string, message: string, details?: unknown): AppError {
  return new AppError(409, code, message, details);
}

export interface ErrorBody {
  error: {
    code: string;
    message: string;
    requestId: string;
    details?: unknown;
  };
}
