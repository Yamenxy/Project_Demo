/**
 * A short, human-readable device description ("Chrome on Android") shown in the session list.
 * The full user agent is not stored (data minimization).
 */
export function deviceLabelFrom(userAgent: string | undefined): string | undefined {
  if (!userAgent) return undefined;
  const os = /Android/i.test(userAgent)
    ? 'Android'
    : /iPhone|iPad|iPod/i.test(userAgent)
      ? 'iOS'
      : /Windows/i.test(userAgent)
        ? 'Windows'
        : /Mac OS X|Macintosh/i.test(userAgent)
          ? 'macOS'
          : /Linux/i.test(userAgent)
            ? 'Linux'
            : undefined;
  const browser = /SamsungBrowser/i.test(userAgent)
    ? 'Samsung Internet'
    : /Edg\//i.test(userAgent)
      ? 'Edge'
      : /OPR\/|Opera/i.test(userAgent)
        ? 'Opera'
        : /Firefox\//i.test(userAgent)
          ? 'Firefox'
          : /Chrome\//i.test(userAgent)
            ? 'Chrome'
            : /Safari\//i.test(userAgent)
              ? 'Safari'
              : undefined;
  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os ?? 'Unknown device';
}
