/**
 * AppError hierarchy. Public messages are safe to return to clients.
 * Internal details (stack traces, DB errors) are logged but never sent.
 */
export class AppError extends Error {
  readonly code: string;
  readonly status: number;
  readonly publicMessage: string;
  readonly cause?: unknown;

  constructor(
    code: string,
    publicMessage: string,
    status: number,
    options?: { cause?: unknown; internalMessage?: string },
  ) {
    super(options?.internalMessage ?? publicMessage);
    this.name = this.constructor.name;
    this.code = code;
    this.status = status;
    this.publicMessage = publicMessage;
    this.cause = options?.cause;
  }

  toResponse(): { error: { code: string; message: string } } {
    return { error: { code: this.code, message: this.publicMessage } };
  }
}

export class AuthError extends AppError {
  constructor(publicMessage = 'Authentication required', code = 'AUTH_REQUIRED') {
    super(code, publicMessage, 401);
  }
}

export class ForbiddenError extends AppError {
  constructor(publicMessage = 'Forbidden', code = 'FORBIDDEN') {
    super(code, publicMessage, 403);
  }
}

export class ValidationError extends AppError {
  readonly issues?: unknown;
  constructor(publicMessage = 'Invalid input', issues?: unknown, code = 'VALIDATION_ERROR') {
    super(code, publicMessage, 400);
    this.issues = issues;
  }

  override toResponse() {
    return {
      error: {
        code: this.code,
        message: this.publicMessage,
        ...(this.issues ? { issues: this.issues } : {}),
      },
    } as { error: { code: string; message: string; issues?: unknown } };
  }
}

export class NotFoundError extends AppError {
  constructor(publicMessage = 'Not found', code = 'NOT_FOUND') {
    super(code, publicMessage, 404);
  }
}

export class ConflictError extends AppError {
  constructor(publicMessage = 'Conflict', code = 'CONFLICT') {
    super(code, publicMessage, 409);
  }
}

export class RateLimitError extends AppError {
  constructor(publicMessage = 'Too many requests', code = 'RATE_LIMITED') {
    super(code, publicMessage, 429);
  }
}
