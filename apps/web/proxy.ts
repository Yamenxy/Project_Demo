import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

/** Redirects to the right locale prefix (/ar or /en). */
export default createMiddleware(routing);

export const config = {
  // Everything except the API proxy, Next internals and files with an extension.
  matcher: ['/((?!api|_next|.*\\..*).*)'],
};
