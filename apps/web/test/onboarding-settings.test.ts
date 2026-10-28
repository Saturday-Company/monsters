import type { SubscriptionsResponse } from '@monsters/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { plansKey } from '../src/components/settings/SubscriptionsSection.tsx';
import { ApiError } from '../src/lib/api.ts';
import type { RawResponse, Transport } from '../src/lib/transport.ts';
import { onboardingApi } from '../src/onboarding/api.ts';
import { onboardingVerdict } from '../src/onboarding/redirect.ts';
import { answerOwnerPrompt, initApp, resetForTests, useApp } from '../src/store/app.ts';
import { refreshProjects, resetLists, useLists } from '../src/store/projects.ts';

/* Onboarding and settings: the review of 28/10 (D-220). */

function transportOf(answer: (method: string, path: string) => RawResponse, calls: string[]) {
  return {
    kind: 'mock',
    request: (method: string, path: string) => {
      calls.push(`${method} ${path}`);
      return Promise.resolve(answer(method, path));
    },
    connect: () => {
      throw new Error('unused');
    },
  } satisfies Transport;
}

const state = {
  status: 'pending',
  step: 'questions',
  hasKey: true,
  keySkipped: false,
  answers: {},
  permissions: null,
  proposal: null,
  guide: { name: 'Titan', genome: {} },
};

describe('the onboarding goes through the shared client (a limited session gets the prompt)', () => {
  afterEach(() => resetForTests());

  it('"Next" on a session that must confirm the password asks for it, then sends again', async () => {
    const calls: string[] = [];
    let confirmed = false;
    initApp(
      transportOf((_method, path) => {
        if (path === '/api/auth/confirm') {
          confirmed = true;
          return { status: 200, body: { ok: true } };
        }
        return confirmed
          ? { status: 200, body: state }
          : { status: 403, body: { error: 'confirm_required', message: 'Password again' } };
      }, calls),
    );
    const sent = onboardingApi.submit({ answers: {} });
    // The prompt opens by itself; answering it lets the request go again.
    await vi.waitFor(() => expect(useApp.getState().ownerPrompt).toBe('recent'));
    confirmed = true;
    answerOwnerPrompt(true);
    await expect(sent).resolves.toMatchObject({ step: 'questions' });
    expect(calls).toEqual(['POST /api/onboarding/answers', 'POST /api/onboarding/answers']);
  });

  it('a prompt that is cancelled leaves the 403 as the error', async () => {
    const calls: string[] = [];
    initApp(transportOf(() => ({ status: 403, body: { error: 'confirm_required' } }), calls));
    const sent = onboardingApi.propose().catch((e: unknown) => e);
    await vi.waitFor(() => expect(useApp.getState().ownerPrompt).toBe('recent'));
    answerOwnerPrompt(false);
    const err = await sent;
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).code).toBe('confirm_required');
    expect(calls).toHaveLength(1);
  });

  it('the wait for a squad can be abandoned: the signal reaches the transport', async () => {
    const signals: (AbortSignal | undefined)[] = [];
    initApp({
      kind: 'mock',
      request: (_method, _path, _body, signal) => {
        signals.push(signal);
        return Promise.resolve({ status: 200, body: state });
      },
      connect: () => {
        throw new Error('unused');
      },
    } satisfies Transport);
    const ask = new AbortController();
    await onboardingApi.propose(ask.signal);
    expect(signals).toEqual([ask.signal]);
  });
});

describe('onboardingVerdict: only a real answer settles the first start', () => {
  it('"done" is done, "pending" sends to the onboarding', async () => {
    expect(await onboardingVerdict(() => Promise.resolve({ status: 'done' }))).toBe('done');
    expect(await onboardingVerdict(() => Promise.resolve({ status: 'pending' }))).toBe('pending');
  });

  it('a read that fails is unknown (asked again), not done', async () => {
    expect(await onboardingVerdict(() => Promise.reject(new ApiError(500, 'internal')))).toBe(
      'unknown',
    );
    expect(await onboardingVerdict(() => Promise.reject(new TypeError('network')))).toBe('unknown');
  });

  it('a core without the onboarding API (404) has nothing to show', async () => {
    expect(await onboardingVerdict(() => Promise.reject(new ApiError(404, 'not_found')))).toBe(
      'done',
    );
  });
});

describe('the list of the projects is asked again after a first read that failed', () => {
  afterEach(() => {
    resetForTests();
    resetLists();
  });

  it('keeps the error while there is no list, and a new read fills it', async () => {
    const calls: string[] = [];
    let down = true;
    initApp(
      transportOf(
        () => (down ? { status: 500, body: { error: 'internal' } } : { status: 200, body: [] }),
        calls,
      ),
    );
    await refreshProjects();
    expect(useLists.getState().projects).toBeNull();
    expect(useLists.getState().projectsError).not.toBeNull();
    down = false;
    await refreshProjects();
    expect(useLists.getState().projects).toEqual([]);
    expect(useLists.getState().projectsError).toBeNull();
  });
});

describe('plansKey: the pickers follow Codex becoming ready', () => {
  const plans = (codex: { enabled: boolean; state: string }) =>
    ({
      chatgpt: { signedIn: true },
      claude: { enabled: false, state: 'not_found' },
      codex,
    }) as unknown as SubscriptionsResponse;

  it('changes when only the state of Codex changes', () => {
    const waiting = plansKey(plans({ enabled: true, state: 'needs_chatgpt' }));
    const ready = plansKey(plans({ enabled: true, state: 'ready' }));
    expect(ready).not.toBe(waiting);
    expect(plansKey(plans({ enabled: true, state: 'ready' }))).toBe(ready);
  });
});
