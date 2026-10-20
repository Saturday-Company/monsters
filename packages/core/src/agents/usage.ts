import { costFromMetadata, type ModelSession } from '@monsters/providers';
import type { EventDataMap } from '@monsters/shared';

/** Data of a `provider_usage` event: one per model request served (D-024). */
export type ProviderUsage = EventDataMap['provider_usage'];

/** What `streamText` reports when a step finishes. */
export interface FinishedStep {
  usage: {
    inputTokens?: number | undefined;
    outputTokens?: number | undefined;
    inputTokenDetails?: {
      cacheReadTokens?: number | undefined;
      cacheWriteTokens?: number | undefined;
    };
  };
  response: { modelId: string };
  /** Where providers that report a cost put it (OpenRouter). */
  providerMetadata?: unknown;
}

/** Prompt-cache tokens of a step, when the provider reports them (D-064). */
export function cacheUsage(usage: FinishedStep['usage']): {
  cachedInputTokens?: number;
  cacheWriteTokens?: number;
} {
  const read = usage.inputTokenDetails?.cacheReadTokens;
  const write = usage.inputTokenDetails?.cacheWriteTokens;
  return {
    ...(read !== undefined && read > 0 ? { cachedInputTokens: read } : {}),
    ...(write !== undefined && write > 0 ? { cacheWriteTokens: write } : {}),
  };
}

/**
 * The `provider_usage` of one finished step on a model session: the model that
 * served it (after the router), tokens, duration and time in the rate budget.
 */
export function stepUsage(
  session: ModelSession,
  step: FinishedStep,
  durationMs: number,
): ProviderUsage {
  const served = session.lastServed;
  const model = served?.ref.model ?? step.response.modelId;
  const costUsd = costFromMetadata(step.providerMetadata);
  return {
    provider: served?.ref.provider ?? session.provider,
    model,
    ...(step.usage.inputTokens !== undefined ? { inputTokens: step.usage.inputTokens } : {}),
    ...(step.usage.outputTokens !== undefined ? { outputTokens: step.usage.outputTokens } : {}),
    ...cacheUsage(step.usage),
    ...(costUsd !== undefined ? { costUsd } : {}),
    durationMs,
    ...(served && served.requested.model !== model
      ? { requestedModel: served.requested.model }
      : {}),
    ...(served && served.queuedMs > 0 ? { queuedMs: served.queuedMs } : {}),
    ...(served?.keyId !== undefined ? { keyId: served.keyId } : {}),
  };
}
