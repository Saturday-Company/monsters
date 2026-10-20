import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { HarnessBinary } from '@monsters/providers';
import {
  FAKE_CLAUDE_SCRIPT,
  fakeSiwc,
  responsesText,
  type FakeSiwc,
} from '@monsters/providers/testing';
import type {
  OnboardingAnswer,
  OnboardingState,
  SubscriptionsResponse,
  TeamConfirmResponse,
} from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startTestHub, type TestHub } from './hub-helpers.ts';

/*
 * The first screen of the onboarding (D-053): how the team reaches a model.
 * Besides the OpenRouter key, the Claude subscription (Claude Agent harness)
 * and the ChatGPT plan; the agents of the new team start on the chosen one.
 */

const ANSWERS: Record<string, OnboardingAnswer> = {
  nomi: { values: { user: ['Giulio'], orchestrator: ['Atlas'] } },
  lavoro: { values: { cosa: ['social'] } },
  obiettivi: { values: { cosa: [] } },
  deleghe: { values: { cosa: ['ricerche', 'bozze'] } },
  strumenti: { values: { cosa: [] } },
  chiedi: { values: { cosa: ['publish'] } },
  tono: { values: { tono: ['diretto'], lingua: ['it'] } },
};

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'monsters-access-'));
  // The fake `claude` is logged in when this file exists (it reads it, Monsters never does).
  const home = join(dir, 'home');
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', '.credentials.json'), '{"method":"claude.ai"}');
  vi.stubEnv('HOME', home);
  vi.stubEnv('USERPROFILE', home);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function claudeBinary(): HarnessBinary {
  return {
    command: process.execPath,
    args: [
      FAKE_CLAUDE_SCRIPT,
      `--fake-record=${join(dir, 'claude.jsonl')}`,
      '--fake-scenario=tool',
    ],
    source: 'configured',
  };
}

async function hub(fake: FakeSiwc, options: { generate?: null } = {}): Promise<TestHub> {
  const t = await startTestHub(
    {},
    {
      withoutTeam: true,
      hub: {
        fetch: fake.fetch,
        ...(options.generate === null ? { onboardingGenerate: null } : {}),
        subscriptions: {
          siwcEndpoints: fake.endpoints,
          callbackPort: 0,
          binaries: { claude: claudeBinary(), codex: null },
        },
      },
    },
  );
  // No model provider at all, as on a fresh install without a key.
  t.core.hub.providers.unregister('fake');
  return t;
}

async function finish(t: TestHub): Promise<TeamConfirmResponse> {
  await t.json('POST', '/api/onboarding/answers', { answers: ANSWERS });
  await t.json('POST', '/api/onboarding/answers', {
    permissions: { vault: true, web: true, shell: false, folders: [] },
  });
  const state = await t.json<OnboardingState>('POST', '/api/onboarding/team/propose', {});
  return t.json<TeamConfirmResponse>('POST', '/api/onboarding/team/confirm', {
    members: state.proposal!.members.map((m) => ({ id: m.id })),
  });
}

const agentYaml = (t: TestHub, id: string) =>
  readFileSync(join(t.home, 'agents', id, 'agent.yaml'), 'utf8');

describe('onboarding: the way to a model', () => {
  it('starts on the model screen without a provider, and refuses an access not set up', async () => {
    const t = await hub(fakeSiwc(), { generate: null });
    const state = await t.json<OnboardingState>('GET', '/api/onboarding');
    expect(state).toMatchObject({ step: 'key', hasKey: false, access: null });

    const res = await t.api('POST', '/api/onboarding/answers', { access: 'claude-agent' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: 'access_unavailable' });
    const bad = await t.api('POST', '/api/onboarding/answers', { access: 'codex' });
    expect(bad.status).toBe(400);
  });

  it('with the Claude subscription: no key, and the whole team on Claude Agent', async () => {
    const t = await hub(fakeSiwc(), { generate: null });
    const on = await t.json<SubscriptionsResponse>(
      'POST',
      '/api/subscriptions/claude-agent/activate',
      {},
    );
    expect(on.claude).toMatchObject({ enabled: true, state: 'subscription' });

    const state = await t.json<OnboardingState>('POST', '/api/onboarding/answers', {
      access: 'claude-agent',
    });
    expect(state).toMatchObject({ step: 'questions', hasKey: true, access: 'claude-agent' });
    // A reload keeps the choice.
    expect(await t.json<OnboardingState>('GET', '/api/onboarding')).toMatchObject({
      access: 'claude-agent',
    });

    const res = await finish(t);
    expect(res.agents.map((a) => a.id)).toContain('atlas');
    for (const a of res.agents) {
      expect(agentYaml(t, a.id)).toMatch(/provider: claude-agent\s+model: sonnet/);
      expect(agentYaml(t, a.id)).not.toContain('openrouter');
      // D-110: the squad of the subscription starts in "Automatica", base Media (Sonnet, Opus for Difficile).
      expect(agentYaml(t, a.id)).toMatch(/autoModels:\s+base: medium/);
      expect(agentYaml(t, a.id)).toMatch(/model: opus\s+tier: strong/);
      expect(agentYaml(t, a.id)).not.toContain('haiku');
    }
  });

  it('with the ChatGPT plan: the plan proposes the team and the agents use it', async () => {
    const fake = fakeSiwc();
    const t = await hub(fake);
    const login = await t.json<{ authorizeUrl: string }>(
      'POST',
      '/api/subscriptions/chatgpt/login',
      {},
    );
    expect((await fetch(fake.approve(login.authorizeUrl))).status).toBe(200);
    for (let i = 0; i < 200; i++) {
      const v = await t.json<SubscriptionsResponse>('GET', '/api/subscriptions');
      if (v.chatgpt.signedIn) break;
      await new Promise((r) => setTimeout(r, 25));
    }
    const state = await t.json<OnboardingState>('POST', '/api/onboarding/answers', {
      access: 'chatgpt',
    });
    expect(state).toMatchObject({ step: 'questions', access: 'chatgpt' });

    fake.replies.push(() =>
      responsesText(
        JSON.stringify({
          agents: [
            {
              name: 'Rhea',
              title: 'la ricercatrice',
              role: 'cerca idee per i post',
              mission: 'cerchi idee e dati per i post e li lasci in note con fonti',
              context: 'Giulio cura i social.',
              duties: ['Citi sempre le fonti.'],
              area: 'Risorse/Ricerche',
              tools: ['web'],
            },
            {
              name: 'Dione',
              title: 'la scrittrice',
              role: 'scrive i post',
              mission: 'scrivi post pronti da pubblicare nel tono di Giulio',
              context: 'Giulio vuole testi diretti.',
              duties: ['Proponi due varianti.'],
              area: 'Progetti/Social',
              tools: [],
            },
          ],
        }),
      ),
    );
    await t.json('POST', '/api/onboarding/answers', { answers: ANSWERS });
    await t.json('POST', '/api/onboarding/answers', {
      permissions: { vault: true, web: true, shell: false, folders: [] },
    });
    const proposed = await t.json<OnboardingState>('POST', '/api/onboarding/team/propose', {});
    expect(proposed.proposal).toMatchObject({ source: 'model', model: 'gpt-test' });
    await t.json('POST', '/api/onboarding/team/confirm', {
      members: proposed.proposal!.members.map((m) => ({ id: m.id })),
    });
    expect(agentYaml(t, 'rhea')).toMatch(/provider: chatgpt\s+model: gpt-test/);
  });
});
