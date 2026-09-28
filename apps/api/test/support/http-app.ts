import type { ModuleMetadata } from '@nestjs/common';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { configureHttp, generateRequestId } from '../../src/common';

/** Builds a Fastify-backed Nest app configured exactly like main.ts, for HTTP-level tests. */
export async function createHttpTestApp(metadata: ModuleMetadata): Promise<NestFastifyApplication> {
  const moduleRef = await Test.createTestingModule(metadata).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ genReqId: generateRequestId, requestIdHeader: false }),
    { logger: false },
  );
  configureHttp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}
