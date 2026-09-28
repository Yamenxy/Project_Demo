import { describe, expect, it } from 'vitest';
import { deviceLabelFrom } from './device-label';

describe('deviceLabelFrom', () => {
  it.each([
    [
      'Mozilla/5.0 (Linux; Android 13; SM-A145F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36',
      'Chrome on Android',
    ],
    [
      'Mozilla/5.0 (Linux; Android 12) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0 Mobile Safari/537.36',
      'Samsung Internet on Android',
    ],
    [
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
      'Safari on iOS',
    ],
    [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 Edg/126.0',
      'Edge on Windows',
    ],
    ['curl/8.5.0', 'Unknown device'],
  ])('%s', (ua, label) => {
    expect(deviceLabelFrom(ua)).toBe(label);
  });

  it('returns undefined without a user agent', () => {
    expect(deviceLabelFrom(undefined)).toBeUndefined();
  });
});
