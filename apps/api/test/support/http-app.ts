import type { ModuleMetadata } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test, type TestingModuleBuilder } from '@nestjs/testing';
import { configureHttp, generateRequestId } from '../../src/common';

export const TEST_WEB_ORIGIN = 'http://localhost:3000';

/** Builds a Fastify-backed Nest app configured exactly like main.ts, for HTTP-level tests. */
export async function createHttpTestApp(
  metadata: ModuleMetadata,
  configure: (builder: TestingModuleBuilder) => TestingModuleBuilder = (b) => b,
): Promise<NestFastifyApplication> {
  const moduleRef = await configure(Test.createTestingModule(metadata)).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ genReqId: generateRequestId, requestIdHeader: false }),
    { logger: false },
  );
  await configureHttp(app, { allowedOrigins: [TEST_WEB_ORIGIN] });
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
