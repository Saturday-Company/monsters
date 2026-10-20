import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ProviderRegistry, RateBudget, type HarnessProvider } from '@monsters/providers';
import { fake, FakeProvider } from '@monsters/providers/testing';
import { autoChain, type DraftConfirmResponse, type DraftView } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { monsterForMember } from '../src/onboarding/monsters.ts';
import { startTestHub, type TestHub } from './hub-helpers.ts';

/*
 * D-110: a new monster on the Claude plan starts in "Automatica" (base Media: Sonnet for
 * Semplice and Media, Opus for Difficile), whichever path creates it: Settings → Squadra,
 * a monster proposed by the capo, a project's lead and monsters. Other services and
 * monsters that already exist are left as they are.
 */

const harness = (): HarnessProvider => ({
  id: 'claude-agent',
  kind: 'harness',
  auth: 'external-login',
  budget: new RateBudget({ id: 'claude-agent', windows: [], limitScope: 'account' }),
  listModels: () => Promise.resolve([]),
  // eslint-disable-next-line @typescript-eslint/require-await
  async *run() {
    yield { type: 'done', reason: 'stop', text: 'ok' };
  },
});

/** A hub with the Claude plan registered; the capo stays on the fake model until `toClaude`. */
async function withPlan(scripts: Parameters<typeof startTestHub>[0] = {}): Promise<TestHub> {
  const h = harness();
  const providers = new ProviderRegistry()
    .register(new FakeProvider({ models: scripts }))
    .register(h);
  const t = await startTestHub(scripts, { hub: { providers } });
  if (!providers.has(h.id)) providers.register(h);
  return t;
}

/** The capo on the Claude plan by hand, as Giulio's is today (not in Automatica). */
const toClaude = (t: TestHub) =>
  t.core.hub.team.setModels('titan', [{ provider: 'claude-agent', model: 'sonnet' }]);

const yamlOf = (t: TestHub, id: string) =>
  readFileSync(join(t.home, 'agents', id, 'agent.yaml'), 'utf8');

const lyra = {
  name: 'Lyra',
  role: 'tiene in ordine le idee',
  mission: 'raccogli le idee sparse e le trasformi in note ordinate e collegate',
  area: 'Idee',
  title: 'l’archivista',
  duties: ['Tieni in ordine le idee'],
  web: false,
  genome: monsterForMember('Lyra', []),
};

const SOCIAL = {
  name: 'Social di Saturday',
  goal: 'i post della pagina di Saturday, con testi e immagini',
  folder: 'new',
  monsters: [
    { name: 'Sofia', role: 'piano e testi dei post', mission: 'prepari il piano dei post' },
    { name: 'Grafo', role: 'immagini dei post', mission: 'prepari le immagini dei post' },
  ],
  monthly_cap_eur: 20,
};

const MEDIUM = autoChain('medium');

describe('new monsters on the Claude plan start in "Automatica" (D-110)', () => {
  it('Settings → Squadra: a new monster on the plan, the existing capo untouched', async () => {
    const t = await withPlan();
    await toClaude(t);
    await t.json('POST', '/api/team/agents', lyra);
    const made = t.core.hub.team.byId('lyra')!;
    expect(made.config.autoModels).toEqual({ base: 'medium' });
    expect(made.config.models).toEqual(MEDIUM);
    expect(yamlOf(t, 'lyra')).not.toContain('haiku');
    expect(t.core.hub.team.byId('titan')!.config.autoModels).toBeUndefined();
  });

  it('a monster proposed by the capo: confirmed from the draft list', async () => {
    const t = await withPlan({
      titan: [
        fake.toolCall('team_propose_monster', {
          name: 'Lyra',
          role: lyra.role,
          mission: lyra.mission,
          title: lyra.title,
          tools: ['note'],
          area: 'Idee',
          color: 'verde',
        }),
        fake.text('Proposto.'),
      ],
    });
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'crea Lyra' });
    await t.runEnded(sent.runId);
    await toClaude(t);
    const [d] = await t.json<DraftView[]>('GET', '/api/drafts');
    const made = await t.json<DraftConfirmResponse>('POST', `/api/drafts/monster/${d!.id}/confirm`);
    const agent = t.core.hub.team.byId(made.agent!)!;
    expect(agent.config.autoModels).toEqual({ base: 'medium' });
    expect(agent.config.models).toEqual(MEDIUM);
  });

  it('a project: the lead and every monster of the draft', async () => {
    const t = await withPlan({
      titan: [
        fake.toolCall('tools_search', { query: 'progetto' }),
        fake.toolCall('project_propose', SOCIAL),
        fake.text('Bozza.'),
      ],
    });
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', {
      text: 'apri il progetto',
    });
    await t.runEnded(sent.runId);
    await toClaude(t);
    await t.json('POST', '/api/projects/social-di-saturday/confirm');
    const lead = t.core.hub.team.lead('social-di-saturday')!;
    for (const a of [lead, t.core.hub.team.byId('sofia')!, t.core.hub.team.byId('grafo')!]) {
      expect(a.config.autoModels).toEqual({ base: 'medium' });
      expect(a.config.models).toEqual(MEDIUM);
    }
  });

  it('a project made from the page: its lead on the plan starts in Automatica', async () => {
    const t = await withPlan();
    await toClaude(t);
    await t.json('POST', '/api/projects', { name: 'Saturday', lead: { name: 'Leda' } });
    expect(t.core.hub.team.byId('leda')!.config.autoModels).toEqual({ base: 'medium' });
  });

  it('other services are left as they are', async () => {
    const t = await withPlan();
    await t.json('POST', '/api/team/agents', lyra);
    const made = t.core.hub.team.byId('lyra')!;
    expect(made.config.autoModels).toBeUndefined();
    expect(made.config.models.every((m) => m.provider !== 'claude-agent')).toBe(true);
  });
});
