/**
 * Top-level error handler. Maps AppError → JSON response.
 * Hides internal stack traces and unknown errors behind a generic 500.
 */
import type { ErrorHandler } from 'hono';
import { ZodError } from 'zod';
import { AppError, ValidationError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof AppError) {
    return c.json(err.toResponse(), err.status as never);
  }
  if (err instanceof ZodError) {
    const ve = new ValidationError('Invalid input', err.flatten());
    return c.json(ve.toResponse(), ve.status as never);
  }
  logger.error('unhandled error', {
    message: (err as Error).message,
    stack: (err as Error).stack,
  });
  return c.json(
    { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
    500,
  );
};
