import { describe, expect, it } from 'vitest';
import { ConfigError, loadConfig } from './config.schema';

const base = {
  DEPLOY_TIER: 'local',
  DATA_CLASS: 'synthetic',
  DATABASE_URL: 'postgres://user:secret-password@localhost:5432/lms_dev',
  DATABASE_PLATFORM_URL: 'postgres://platform:secret-password@localhost:5432/lms_dev',
  WEB_ORIGINS: 'http://localhost:3000',
  SECRET_ENCRYPTION_KEY: 'bHUi9RJpLGyXJBsx54GiqCJNN7W72cshb2sYwWcIFDE=',
};

function issuesOf(env: Record<string, string | undefined>): string[] {
  try {
    loadConfig(env);
  } catch (err) {
    if (err instanceof ConfigError) return err.issues;
    throw err;
  }
  return [];
}

describe('loadConfig', () => {
  it('accepts a valid local configuration and applies defaults', () => {
    const config = loadConfig(base);
    expect(config).toMatchObject({
      deployTier: 'local',
      dataClass: 'synthetic',
      port: 3001,
      nodeEnv: 'development',
    });
  });

  it.each(['local', 'demo', 'staging'])('refuses real data on the %s tier', (tier) => {
    expect(issuesOf({ ...base, DEPLOY_TIER: tier, DATA_CLASS: 'real' })).toEqual([
      `DATA_CLASS: tier "${tier}" may only run with DATA_CLASS=synthetic`,
    ]);
  });

  it('requires production to declare real data explicitly', () => {
    expect(issuesOf({ ...base, DEPLOY_TIER: 'production', DATA_CLASS: 'synthetic' })).toContain(
      'DATA_CLASS: production must declare DATA_CLASS=real',
    );
  });

  it('refuses the console OTP sender in production', () => {
    expect(issuesOf({ ...base, DEPLOY_TIER: 'production', DATA_CLASS: 'real' })).toEqual([
      'OTP_PROVIDER: production needs a real OTP provider (WhatsApp or SMS)',
    ]);
  });

  it('refuses to start when DATA_CLASS or DEPLOY_TIER is missing', () => {
    const issues = issuesOf({
      DATABASE_URL: base.DATABASE_URL,
      DATABASE_PLATFORM_URL: base.DATABASE_PLATFORM_URL,
      WEB_ORIGINS: base.WEB_ORIGINS,
      SECRET_ENCRYPTION_KEY: base.SECRET_ENCRYPTION_KEY,
    });
    expect(issues.some((i) => i.startsWith('DEPLOY_TIER'))).toBe(true);
    expect(issues.some((i) => i.startsWith('DATA_CLASS'))).toBe(true);
  });

  it('rejects a non-Postgres database URL', () => {
    expect(issuesOf({ ...base, DATABASE_URL: 'mysql://localhost/db' })[0]).toMatch(/^DATABASE_URL/);
  });

  it('never includes secret values in error messages', () => {
    const issues = issuesOf({ ...base, DATA_CLASS: 'real', PORT: 'not-a-port' });
    expect(issues.join(' ')).not.toContain('secret-password');
  });
});
