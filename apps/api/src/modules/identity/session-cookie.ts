import type { FastifyReply } from 'fastify';
import type { CreatedSession } from './sessions.service';

export const SESSION_COOKIE = 'lms_session';

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

export function clearSessionCookie(reply: FastifyReply, settings: CookieSettings): void {
  void reply.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: settings.secure,
    sameSite: 'lax',
    path: '/',
  });
}
