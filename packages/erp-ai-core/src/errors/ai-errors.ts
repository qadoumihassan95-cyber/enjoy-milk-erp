/**
 * Standardized reusable AI errors.
 *
 * All extend AiError from types/ai.types.ts so `instanceof AiError`
 * still matches every subclass — but consumers can `instanceof
 * AiRateLimitError` for finer control (e.g., HTTP status mapping).
 *
 * The consuming ERP decides how these map to HTTP responses / UI
 * messages. The core NEVER decides HTTP.
 */

import { AiError } from '../types/ai.types';

export class AiProviderError extends AiError {
  constructor(message: string, provider?: string, httpStatus?: number) {
    super(message, 'provider-unavailable', provider, httpStatus);
    this.name = 'AiProviderError';
  }
}

export class AiTimeoutError extends AiError {
  constructor(message = 'AI request timed out', provider?: string) {
    super(message, 'timeout', provider);
    this.name = 'AiTimeoutError';
  }
}

export class AiRateLimitError extends AiError {
  constructor(message = 'AI request rate-limited', provider?: string, httpStatus?: number) {
    super(message, 'rate-limit', provider, httpStatus);
    this.name = 'AiRateLimitError';
  }
}

export class AiBudgetExceededError extends AiError {
  constructor(message: string, public readonly scope: string) {
    super(message, 'rate-limit');
    this.name = 'AiBudgetExceededError';
  }
}

export class AiPermissionError extends AiError {
  constructor(message = 'Permission denied for AI tool.') {
    super(message, 'unauthorized');
    this.name = 'AiPermissionError';
  }
}

export class AiToolError extends AiError {
  constructor(message: string, public readonly toolName: string) {
    super(message, 'invalid-response');
    this.name = 'AiToolError';
  }
}

export class AiConfigurationError extends AiError {
  constructor(message = 'AI is not configured.') {
    super(message, 'unauthorized');
    this.name = 'AiConfigurationError';
  }
}

export class AiUnavailableError extends AiError {
  constructor(message = 'AI provider is unavailable.', provider?: string) {
    super(message, 'provider-unavailable', provider);
    this.name = 'AiUnavailableError';
  }
}
