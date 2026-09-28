import { randomInt } from 'node:crypto';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { TestingModuleBuilder } from '@nestjs/testing';
import { inject } from 'vitest';
import { AppModule } from '../../src/app.module';
import { createHttpTestApp } from './http-app';

/** The full application against the Testcontainers database, as the runtime and platform roles. */
export async function createIntegrationApp(
  configure?: (builder: TestingModuleBuilder) => TestingModuleBuilder,
): Promise<NestFastifyApplication> {
  const urls = inject('databaseUrls');
  process.env.DATABASE_URL = urls.runtime;
  process.env.DATABASE_PLATFORM_URL = urls.platform;
  return createHttpTestApp({ imports: [AppModule] }, configure);
}

/** A random, valid Egyptian mobile number in local format. */
export function randomPhone(): string {
  return `010${String(randomInt(10_000_000, 99_999_999))}`;
}

/** A random client IP, so per-IP rate limits don't couple unrelated tests. */
export function randomIp(): string {
  return `10.${randomInt(0, 255)}.${randomInt(0, 255)}.${randomInt(1, 254)}`;
}

/** Extracts the value of a Set-Cookie header for the given cookie name. */
export function cookieValue(setCookie: string | string[] | undefined, name: string): string | null {
  const headers = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  for (const header of headers) {
    const [pair] = header.split(';');
    const [key, ...rest] = (pair ?? '').split('=');
    if (key === name) return rest.join('=');
  }
  return null;
}
