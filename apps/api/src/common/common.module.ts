import { Global, Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { Clock, SystemClock } from './clock';
import { HttpErrorFilter } from './http/error-filter';
import { IdGenerator, UuidV7Generator } from './ids';

@Global()
@Module({
  providers: [
    { provide: Clock, useClass: SystemClock },
    { provide: IdGenerator, useClass: UuidV7Generator },
    { provide: APP_FILTER, useClass: HttpErrorFilter },
  ],
  exports: [Clock, IdGenerator],
})
export class CommonModule {}
