/**
 * Removes personal data and secrets from anything that goes to logs (review OPS-04: logs carry
 * IDs, never names, phone numbers, answers or credentials).
 *
 * - Values under sensitive keys are replaced, at any depth.
 * - Phone numbers and email addresses inside any string are masked, because free text (error
 *   messages, notes) can contain them.
 */
const REDACTED = '[redacted]';

const SENSITIVE_KEYS = new Set(
  [
    'password',
    'passwordhash',
    'newpassword',
    'currentpassword',
    'token',
    'accesstoken',
    'refreshtoken',
    'sessiontoken',
    'secret',
    'totpsecret',
    'otp',
    'otpcode',
    'recoverycode',
    'authorization',
    'cookie',
    'setcookie',
    'phone',
    'phonenumber',
    'guardianphone',
    'email',
    'name',
    'fullname',
    'firstname',
    'lastname',
    'dateofbirth',
    'dob',
    'answer',
    'answers',
    'notes',
    'proof',
    'address',
    'ip',
  ].map(normalizeKey),
);

// Egyptian mobiles (+20 1x..., 0020 1x..., 01x...) and any other long international number.
const PHONE_PATTERN = /(?:\+|00)?(?:20)?0?1[0125]\d{8}|\+\d{9,15}/g;
const EMAIL_PATTERN = /[^\s@"'<>]+@[^\s@"'<>]+\.[^\s@"'<>]+/g;
const MAX_DEPTH = 8;

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[-_]/g, '');
}

export function scrubString(value: string): string {
  return value.replace(EMAIL_PATTERN, '[email]').replace(PHONE_PATTERN, '[phone]');
}

export function scrub(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return scrubString(value);
  if (value === null || typeof value !== 'object') return value;
  if (depth >= MAX_DEPTH) return '[truncated]';
  if (value instanceof Error) {
    return { name: value.name, message: scrubString(value.message), stack: value.stack };
  }
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  // Class instances (Date, Buffer, framework request objects) are left to their serializers.
  const proto: unknown = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return value;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    out[key] = SENSITIVE_KEYS.has(normalizeKey(key)) ? REDACTED : scrub(inner, depth + 1);
  }
  return out;
}
