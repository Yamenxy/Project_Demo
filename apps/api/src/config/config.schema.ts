import { z } from 'zod';
import { LOG_LEVELS, type LogLevel } from '../common/logging/logger';

/**
 * Environment tiers (REQ-OPS-005):
 * - local, demo, staging: free setups that must only ever hold synthetic data;
 * - production: the paid setup that may hold real data.
 */
export const DEPLOY_TIERS = ['local', 'demo', 'staging', 'production'] as const;
export type DeployTier = (typeof DEPLOY_TIERS)[number];

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    DEPLOY_TIER: z.enum(DEPLOY_TIERS),
    DATA_CLASS: z.enum(['synthetic', 'real']),
    PORT: z.coerce.number().int().min(1).max(65535).default(3001),
    LOG_LEVEL: z.enum(LOG_LEVELS).default('info'),
    // inline: the API process also runs job workers (free setup). separate: a worker process does.
    WORKER_MODE: z.enum(['inline', 'separate']).default('inline'),
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
  workerMode: 'inline' | 'separate';
  webOrigins: string[];
  /** Secure cookies everywhere except plain-http local development. */
  cookieSecure: boolean;
  /** Runtime role (app_runtime): all normal application queries. */
  databaseUrl: string;
  /** Platform role (app_platform): the restricted cross-workspace handle. */
  databasePlatformUrl: string;
  databasePoolMax: number;
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
    workerMode: e.WORKER_MODE,
    webOrigins: e.WEB_ORIGINS,
    cookieSecure: e.DEPLOY_TIER !== 'local',
    databaseUrl: e.DATABASE_URL,
    databasePlatformUrl: e.DATABASE_PLATFORM_URL,
    databasePoolMax: e.DATABASE_POOL_MAX,
  };
}
