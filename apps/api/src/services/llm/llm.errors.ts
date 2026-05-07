/**
 * LLM-specific errors. All extend AppError so the standard error
 * middleware emits safe public messages.
 *
 * Privacy: error messages must never echo user input or model output
 * verbatim — only structural information ("the model returned invalid
 * JSON" not "the model said …").
 */
import { AppError } from '../../lib/errors.js';

/** Raised when ANTHROPIC_API_KEY is unset and an AI feature is invoked. */
export class LlmUnavailableError extends AppError {
  constructor(
    publicMessage = 'AI features are not configured on this server. Use the manual form instead.',
    code = 'LLM_UNAVAILABLE',
  ) {
    super(code, publicMessage, 503);
  }
}

/** Raised when the upstream call exceeded our hard timeout. */
export class LlmTimeoutError extends AppError {
  constructor(
    publicMessage = 'The AI assistant is taking too long. Try again or use the manual form.',
    code = 'LLM_TIMEOUT',
  ) {
    super(code, publicMessage, 504);
  }
}

/** Raised when the model output cannot be parsed into the expected shape. */
export class LlmParseError extends AppError {
  constructor(
    publicMessage = 'The AI assistant returned an unexpected response. Try again or use the manual form.',
    code = 'LLM_PARSE_ERROR',
    options?: { cause?: unknown; internalMessage?: string },
  ) {
    super(code, publicMessage, 502, options);
  }
}

/** Raised on any other LLM call failure (network, auth, rate limit). */
export class LlmError extends AppError {
  constructor(
    publicMessage = 'The AI assistant is unavailable right now. Try again later.',
    code = 'LLM_ERROR',
    options?: { cause?: unknown; internalMessage?: string },
  ) {
    super(code, publicMessage, 502, options);
  }
}
