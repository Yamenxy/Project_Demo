import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { ConfigError, loadConfig } from './config';
import { DatabaseModule, UnsafeDatabaseRoleError } from './database';

async function bootstrap(): Promise<void> {
  // Validate configuration before anything else starts (REQ-OPS-005).
  const config = loadConfig(process.env);
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter());
  // Refuse to serve with database users that could bypass row-level security (REQ-DATA-001).
  await app.get(DatabaseModule).verifyRoles();
  app.setGlobalPrefix('api');
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
