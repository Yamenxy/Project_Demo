import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { AppLogger, configureHttp, createRootLogger, generateRequestId } from './common';
import { ConfigError, loadConfig } from './config';
import { DatabaseModule, UnsafeDatabaseRoleError } from './database';

async function bootstrap(): Promise<void> {
  // Validate configuration before anything else starts (REQ-OPS-005).
  const config = loadConfig(process.env);
  const rootLogger = createRootLogger(config.logLevel);
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      loggerInstance: rootLogger,
      genReqId: generateRequestId,
      requestIdHeader: false,
    }),
    { logger: new AppLogger(rootLogger) },
  );
  // Refuse to serve with database users that could bypass row-level security (REQ-DATA-001).
  await app.get(DatabaseModule).verifyRoles();
  configureHttp(app);
  app.enableShutdownHooks();
  await app.listen(config.port, '0.0.0.0');
}

bootstrap().catch((err: unknown) => {
  // Expected startup failures: print the reason only, without a stack trace.
  if (err instanceof ConfigError || err instanceof UnsafeDatabaseRoleError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  throw err;
});
