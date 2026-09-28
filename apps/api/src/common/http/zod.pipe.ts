import type { PipeTransform } from '@nestjs/common';
import type { z } from 'zod';

/**
 * Validates and parses a request part with a zod schema. Failures become 400
 * `validation_failed` responses listing paths and rules only (see error-filter.ts).
 */
export class ZodPipe<S extends z.ZodType> implements PipeTransform<unknown, z.infer<S>> {
  constructor(private readonly schema: S) {}

  transform(value: unknown): z.infer<S> {
    return this.schema.parse(value);
  }
}
