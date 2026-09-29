/**
 * Calls the API through the same-origin /api proxy, so the session cookie is first-party.
 * Errors carry the API's stable `code`; the UI translates it (messages `errors.<code>`).
 */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly details?: unknown,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export async function api<T>(
  path: string,
  options: { method?: 'GET' | 'POST' | 'PUT' | 'DELETE'; body?: unknown } = {},
): Promise<T> {
  const init: RequestInit = {
    method: options.method ?? 'GET',
    credentials: 'same-origin',
    headers: options.body === undefined ? {} : { 'content-type': 'application/json' },
  };
  if (options.body !== undefined) init.body = JSON.stringify(options.body);
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, init);
  } catch {
    throw new ApiError(0, 'network_error');
  }
  if (response.status === 204) return undefined as T;
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; details?: unknown } } | null)?.error;
    throw new ApiError(response.status, error?.code ?? 'generic', error?.details);
  }
  return payload as T;
}

/** Sends a file's raw bytes (REQ-FILE-001). */
export async function uploadFile<T>(path: string, file: Blob): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/octet-stream' },
      body: file,
    });
  } catch {
    throw new ApiError(0, 'network_error');
  }
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = (payload as { error?: { code?: string; details?: unknown } } | null)?.error;
    throw new ApiError(response.status, error?.code ?? 'generic', error?.details);
  }
  return payload as T;
}

export interface UserSummary {
  id: string;
  nameAr: string;
  platformCode: string;
  status: 'pending' | 'active' | 'suspended' | 'archived' | 'anonymized';
  phoneVerified: boolean;
  twoFactorEnabled: boolean;
}

export interface DeviceSummary {
  id: string;
  label: string | null;
  lastSeenAt: string;
  current: boolean;
}
