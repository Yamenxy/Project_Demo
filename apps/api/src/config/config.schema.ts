import { z } from 'zod';

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
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
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
  databaseUrl: string;
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
    databaseUrl: e.DATABASE_URL,
  };
}
