import {
  ApiErrorSchema,
  OnboardingStateSchema,
  ProposedAgentSchema,
  TeamConfirmResponseSchema,
  type OnboardingAnswersRequest,
  type OnboardingState,
  type ProposedAgent,
  type TeamConfirmRequest,
  type TeamConfirmResponse,
} from '@monsters/shared';
import type { z } from 'zod';
import { ApiError, describeError } from '../lib/api.ts';
import { getApi } from '../store/app.ts';

/* Client of the onboarding API (contract at the bottom of packages/shared/src/api.ts). */

async function call<S extends z.ZodType>(
  method: string,
  path: string,
  schema: S,
  body?: unknown,
): Promise<z.infer<S>> {
  const res = await getApi().transport.request(method, path, body);
  if (res.status < 200 || res.status >= 300) {
    const err = ApiErrorSchema.safeParse(res.body);
    throw new ApiError(
      res.status,
      err.success ? err.data.error : `http_${res.status}`,
      err.success ? err.data.message : undefined,
    );
  }
  const parsed = schema.safeParse(res.body);
  if (!parsed.success) throw new ApiError(res.status, 'invalid_response', parsed.error.message);
  return parsed.data;
}

export const onboardingApi = {
  state: (): Promise<OnboardingState> => call('GET', '/api/onboarding', OnboardingStateSchema),
  submit: (body: OnboardingAnswersRequest): Promise<OnboardingState> =>
    call('POST', '/api/onboarding/answers', OnboardingStateSchema, body),
  propose: (): Promise<OnboardingState> =>
    call('POST', '/api/onboarding/team/propose', OnboardingStateSchema, {}),
  regenerate: (id: string): Promise<ProposedAgent> =>
    call('POST', '/api/onboarding/monster', ProposedAgentSchema, { id }),
  confirm: (body: TeamConfirmRequest): Promise<TeamConfirmResponse> =>
    call('POST', '/api/onboarding/team/confirm', TeamConfirmResponseSchema, body),
  setKey: async (key: string): Promise<void> => {
    await getApi().setOpenRouterKey(key);
  },
};

/** Friendly text for the errors of the onboarding. */
export function onboardingError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'invalid_key':
        return 'OpenRouter dice che la chiave non va. Controlla di averla copiata tutta.';
      case 'verification_failed':
        return 'Non riesco a verificare la chiave adesso. Riprova tra poco.';
      case 'invalid_name':
        return 'Questo nome non va: usa solo lettere, niente doppioni, e non User o System.';
      case 'onboarding_done':
        return 'La squadra esiste già.';
      case 'answers_incomplete':
        return 'Manca ancora qualche risposta.';
      default:
        break;
    }
  }
  return describeError(err);
}
