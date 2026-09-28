import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { AppLogger, createRootLogger } from './common';
import { ConfigError, loadConfig } from './config';
import { DatabaseModule, UnsafeDatabaseRoleError } from './database';
import { JobsRuntime } from './jobs';

/** Separate job worker process (WORKER_MODE=separate on the API). No HTTP server. */
async function bootstrap(): Promise<void> {
  const config = loadConfig(process.env);
  const rootLogger = createRootLogger(config.logLevel);
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: new AppLogger(rootLogger),
  });
  await app.get(DatabaseModule).verifyRoles();
  const jobs = app.get(JobsRuntime);
  await jobs.start();
  await jobs.startWorkers();
  app.enableShutdownHooks();
}

bootstrap().catch((err: unknown) => {
  if (err instanceof ConfigError || err instanceof UnsafeDatabaseRoleError) {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  }
  throw err;
});
