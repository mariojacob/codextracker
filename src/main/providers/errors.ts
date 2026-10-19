import type { ProviderError } from '../../shared/providers.js';

export class ProviderFetchError extends Error {
  constructor(readonly code: ProviderError, readonly retryAfterMs?: number) {
    super(code);
  }
}
