import {
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
import { onboardingStrings } from './onboarding.strings.ts';

/* Client of the onboarding API (contract at the bottom of packages/shared/src/api.ts). */

/** Through the shared client: a session that must confirm the password gets the prompt, then the request again. */
const call = <S extends z.ZodType>(
  method: string,
  path: string,
  schema: S,
  body?: unknown,
): Promise<z.infer<S>> => getApi().send(method, path, schema, body);

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
      case 'verification_failed':
      case 'invalid_name':
      case 'onboarding_done':
      case 'answers_incomplete':
      case 'answers_changed':
        return onboardingStrings().errors[err.code];
      default:
        break;
    }
  }
  return describeError(err);
}
