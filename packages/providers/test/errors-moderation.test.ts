import { APICallError } from 'ai';
import { describe, expect, it } from 'vitest';
import { classifyProviderError, isFallbackError, isProviderError } from '../src/index.ts';

const http = (statusCode: number, message: string, responseBody = '') =>
  new APICallError({
    message,
    url: 'https://openrouter.ai/api/v1/chat/completions',
    requestBodyValues: {},
    statusCode,
    responseBody,
  });

describe('OpenRouter 403 classification (F-B9)', () => {
  it('treats a moderation 403 as a model error, so the chain moves to the next link', () => {
    const err = http(
      403,
      'Forbidden',
      '{"error":{"message":"Input was flagged by moderation","code":403}}',
    );
    expect(classifyProviderError(err)).toBe('model_gone');
    expect(isFallbackError(err)).toBe(true);
    expect(isProviderError(err)).toBe(false);
  });

  it('keeps a plain 403 as an auth error', () => {
    const err = http(403, 'Forbidden', '{"error":{"message":"Key limit exceeded"}}');
    expect(classifyProviderError(err)).toBe('auth');
  });
});
