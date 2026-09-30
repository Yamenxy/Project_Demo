import { z } from 'zod';
import { LOG_LEVELS, type LogLevel } from '../common/logging/logger';

/**
 * Environment tiers (REQ-OPS-005):
 * - local, demo, staging: free setups that must only ever hold synthetic data;
 * - production: the paid setup that may hold real data.
 */
export const DEPLOY_TIERS = ['local', 'demo', 'staging', 'production'] as const;
export type DeployTier = (typeof DEPLOY_TIERS)[number];

/** OTP senders that don't reach real phones; never allowed in production. */
const DEVELOPMENT_OTP_PROVIDERS = new Set(['console', 'file']);

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DEPLOY_TIER: z.enum(DEPLOY_TIERS),
    DATA_CLASS: z.enum(['synthetic', 'real']),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    // Proxies in front of the API (hosting load balancer, the web app's /api proxy). The client IP
    // for rate limits is read that many hops back in X-Forwarded-For; 0 trusts no header.
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(5).default(0),
    // inline: the API process also runs job workers (free setup). separate: a worker process does.
    WORKER_MODE: z.enum(['inline', 'separate']).default('inline'),
    // One-time code delivery. Only development senders exist until WhatsApp is set up (OQ-19):
    // 'console' prints codes; 'file' appends them to OTP_OUTBOX_FILE (browser tests, demos).
    OTP_PROVIDER: z.enum(['console', 'file']).default('console'),
    OTP_OUTBOX_FILE: z.string().min(1).optional(),
    // 32 random bytes, base64. Encrypts secrets at rest (TOTP). Each environment has its own.
    // Email for teachers and owners. 'smtp' covers Mailpit locally and any SMTP relay.
    EMAIL_PROVIDER: z.enum(['none', 'smtp']).default('none'),
    // Uploaded files (REQ-FILE-001). Only local disk exists for the free setup (OD-09).
    STORAGE_PROVIDER: z.enum(['local']).default('local'),
    STORAGE_DIR: z.string().min(1).default('var/storage'),
    // self-hls video (REQ-VIDEO-005): the ffmpeg and ffprobe programs, found on PATH by default.
    FFMPEG_PATH: z.string().min(1).default('ffmpeg'),
    FFPROBE_PATH: z.string().min(1).default('ffprobe'),
    // Web push (REQ-NOTIF-001). 'webpush' needs a VAPID key pair: `npx web-push generate-vapid-keys`.
    PUSH_PROVIDER: z.enum(['none', 'webpush']).default('none'),
    VAPID_PUBLIC_KEY: z.string().min(20).optional(),
    VAPID_PRIVATE_KEY: z.string().min(20).optional(),
    VAPID_SUBJECT: z.string().min(3).default('mailto:no-reply@localhost'),
    SMTP_URL: z.url({ protocol: /^smtps?$/ }).optional(),
    EMAIL_FROM: z.string().min(3).default('LMS <no-reply@localhost>'),
    SECRET_ENCRYPTION_KEY: z
      .string()
      .refine((value) => Buffer.from(value, 'base64').length === 32, 'must be 32 bytes, base64'),
    // Comma-separated origins of the web app, allowed to make state-changing requests.
    WEB_ORIGINS: z
      .string()
      .transform((value) =>
        value
          .split(',')
          .map((origin) => origin.trim())
          .filter(Boolean),
      )
      .pipe(z.array(z.url()).min(1)),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_PLATFORM_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    DATABASE_POOL_MAX: z.coerce.number().int().min(1).max(100).default(10),
  })
  .superRefine((env, ctx) => {
    if (env.DEPLOY_TIER !== 'production' && env.DATA_CLASS !== 'synthetic') {
      ctx.addIssue({
        code: 'custom',
        path: ['DATA_CLASS'],
        message: `tier "${env.DEPLOY_TIER}" may only run with DATA_CLASS=synthetic`,
      });
    }
    if (env.EMAIL_PROVIDER === 'smtp' && !env.SMTP_URL) {
      ctx.addIssue({
        code: 'custom',
        path: ['SMTP_URL'],
        message: 'required when EMAIL_PROVIDER=smtp',
      });
    }
    if (env.PUSH_PROVIDER === 'webpush' && (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY)) {
      ctx.addIssue({
        code: 'custom',
        path: ['VAPID_PRIVATE_KEY'],
        message: 'VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY are required when PUSH_PROVIDER=webpush',
      });
    }
    if (env.OTP_PROVIDER === 'file' && !env.OTP_OUTBOX_FILE) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_OUTBOX_FILE'],
        message: 'required when OTP_PROVIDER=file',
      });
    }
    if (env.DEPLOY_TIER === 'production' && DEVELOPMENT_OTP_PROVIDERS.has(env.OTP_PROVIDER)) {
      ctx.addIssue({
        code: 'custom',
        path: ['OTP_PROVIDER'],
        message: 'production needs a real OTP provider (WhatsApp or SMS)',
      });
    }
    if (env.DEPLOY_TIER === 'production' && env.DATA_CLASS !== 'real') {
      ctx.addIssue({
        code: 'custom',
        path: ['DATA_CLASS'],
        message: 'production must declare DATA_CLASS=real',
      });
    }
  });

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  deployTier: DeployTier;
  dataClass: 'synthetic' | 'real';
  port: number;
  logLevel: LogLevel;
  trustProxyHops: number;
  workerMode: 'inline' | 'separate';
  otpProvider: 'console' | 'file';
  otpOutboxFile?: string;
  secretEncryptionKey: string;
  email: { provider: 'none' } | { provider: 'smtp'; smtpUrl: string; from: string };
  push:
    | { provider: 'none' }
    | { provider: 'webpush'; publicKey: string; privateKey: string; subject: string };
  webOrigins: string[];
  /** Secure cookies everywhere except plain-http local development. */
  cookieSecure: boolean;
  /** Runtime role (app_runtime): all normal application queries. */
  databaseUrl: string;
  /** Platform role (app_platform): the restricted cross-workspace handle. */
  databasePlatformUrl: string;
  databasePoolMax: number;
  storage: { provider: 'local'; dir: string };
  video: { ffmpegPath: string; ffprobePath: string };
}

export class ConfigError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid configuration:\n- ${issues.join('\n- ')}`);
    this.name = 'ConfigError';
  }
}

/**
 * Validates the environment and returns typed config. Error messages name the variable and the
 * rule, never the value, so secrets such as DATABASE_URL can't leak into logs.
 */
export function loadConfig(env: Record<string, string | undefined>): AppConfig {
  const result = envSchema.safeParse(env);
  if (!result.success) {
    throw new ConfigError(
      result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    );
  }
  const e = result.data;
  return {
    nodeEnv: e.NODE_ENV,
    deployTier: e.DEPLOY_TIER,
    dataClass: e.DATA_CLASS,
    port: e.PORT,
    logLevel: e.LOG_LEVEL,
    trustProxyHops: e.TRUST_PROXY_HOPS,
    workerMode: e.WORKER_MODE,
    otpProvider: e.OTP_PROVIDER,
    ...(e.OTP_OUTBOX_FILE ? { otpOutboxFile: e.OTP_OUTBOX_FILE } : {}),
    secretEncryptionKey: e.SECRET_ENCRYPTION_KEY,
    email:
      e.EMAIL_PROVIDER === 'smtp' && e.SMTP_URL
        ? { provider: 'smtp', smtpUrl: e.SMTP_URL, from: e.EMAIL_FROM }
        : { provider: 'none' },
    push:
      e.PUSH_PROVIDER === 'webpush' && e.VAPID_PUBLIC_KEY && e.VAPID_PRIVATE_KEY
        ? {
            provider: 'webpush',
            publicKey: e.VAPID_PUBLIC_KEY,
            privateKey: e.VAPID_PRIVATE_KEY,
            subject: e.VAPID_SUBJECT,
          }
        : { provider: 'none' },
    webOrigins: e.WEB_ORIGINS,
    cookieSecure: e.DEPLOY_TIER !== 'local',
    databaseUrl: e.DATABASE_URL,
    databasePlatformUrl: e.DATABASE_PLATFORM_URL,
    databasePoolMax: e.DATABASE_POOL_MAX,
    storage: { provider: e.STORAGE_PROVIDER, dir: e.STORAGE_DIR },
    video: { ffmpegPath: e.FFMPEG_PATH, ffprobePath: e.FFPROBE_PATH },
  };
}
