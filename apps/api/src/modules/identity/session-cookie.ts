import type { FastifyReply } from 'fastify';
import type { CreatedSession } from './sessions.service';

export const SESSION_COOKIE = 'lms_session';
/** Identifies the browser for device limits (REQ-AUTH-005). Outlives sessions. */
export const DEVICE_COOKIE = 'lms_device';
const DEVICE_COOKIE_DAYS = 400; // the maximum lifetime browsers allow

export interface CookieSettings {
  secure: boolean;
}

/** HttpOnly so scripts can't read it; SameSite=Lax as one of the CSRF defences. */
export function setSessionCookie(
  reply: FastifyReply,
  session: CreatedSession,
  settings: CookieSettings,
): void {
  void reply.setCookie(SESSION_COOKIE, session.token, {
    httpOnly: true,
    secure: settings.secure,
    sameSite: 'lax',
    path: '/',
    ...(session.cookieExpiresAt ? { expires: session.cookieExpiresAt } : {}),
  });
}

export function setDeviceCookie(
  reply: FastifyReply,
  token: string,
  settings: CookieSettings,
  now: Date,
): void {
  void reply.setCookie(DEVICE_COOKIE, token, {
    httpOnly: true,
    secure: settings.secure,
    sameSite: 'lax',
    path: '/',
    expires: new Date(now.getTime() + DEVICE_COOKIE_DAYS * 24 * 3600 * 1000),
  });
}

export function clearSessionCookie(reply: FastifyReply, settings: CookieSettings): void {
  void reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: settings.secure,
    sameSite: 'lax',
    path: '/',
  });
}
