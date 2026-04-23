import { BadRequestException, PipeTransform } from '@nestjs/common';
import { ZodSchema } from 'zod';

export class ZodValidationPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodSchema<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      // Don't leak the full Zod error tree (which would reveal every
      // enum value, field constraint, and internal field name to a
      // fuzzer). Return only the offending path + the Zod error code
      // so the client knows WHICH field, not WHAT it expects.
      throw new BadRequestException({
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: result.error.issues.map((i) => ({
          path: i.path.join('.'),
          code: i.code,
        })),
      });
    }
    return result.data;
  }
}
