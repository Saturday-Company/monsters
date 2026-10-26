import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { MonsterGenomeSchema, hueDistance, monsterFor } from '@monsters/monster-kit';
import { fake } from '@monsters/providers/testing';
import {
  ONBOARDING_QUESTIONS,
  type AgentSummary,
  type LogEvent,
  type OnboardingAnswer,
  type OnboardingState,
  type ProposedAgent,
  type TeamConfirmResponse,
} from '@monsters/shared';
import { VaultPermissions } from '@monsters/vault';
import { describe, expect, it } from 'vitest';
import {
  MAX_AGENTS_MD_LINES,
  blueprintToConfig,
  parseProposal,
  checkAgentsMd,
  decisionRulesFrom,
  designMonster,
  fallbackProposal,
  loadAgentDefinition,
  memberBlueprint,
  pickHue,
  profileFromAnswers,
  proposeTeam,
  readSettingsFile,
  renderAgentFiles,
  renderProfile,
  contextSentence,
  ONBOARDING_STATE_KEY,
  sourcesRule,
  StateStore,
  type Generate,
  type GenerateError,
  type ProposalContext,
} from '../src/index.ts';
import { WEB_TOOLS } from '../src/agents/archetypes.ts';
import { onboardingStrings } from '../src/onboarding/onboarding.strings.ts';
import { deferred, startTestHub, type TestHub } from './hub-helpers.ts';
import { langHome } from './lang-home.ts';
import { inLang } from './prompt-lang.ts';

const ANSWERS: Record<string, OnboardingAnswer> = {
  nomi: { values: { user: ['Giulio'], orchestrator: ['Atlas'] } },
  lavoro: { values: { cosa: ['social', 'consulenza'] }, text: 'Seguo tre clienti nel food' },
  obiettivi: { values: { cosa: ['costanza'] } },
  deleghe: { values: { cosa: ['ricerche', 'bozze', 'piano'] } },
  strumenti: { values: { cosa: ['instagram', 'notion'] } },
  chiedi: { values: { cosa: ['publish', 'spend'] }, text: 'contattare i clienti' },
  tono: { values: { tono: ['diretto'], lingua: ['it'] } },
};

const MODEL_TEAM = {
  agents: [
    {
      name: 'Rhea',
      title: 'la ricercatrice',
      role: 'trova tendenze e dati sul food per i post',
      mission: 'cerchi tendenze, dati e idee sul food e le trasformi in note con fonti',
      context: 'Giulio segue tre clienti nel food e vuole pubblicare con costanza.',
      duties: ['Controlli sempre la data delle fonti.', 'Segnali le tendenze utili ai clienti.'],
      area: 'Risorse/Ricerche',
      tools: ['web'],
    },
    {
      name: 'Dione',
      title: 'la copywriter',
      role: 'scrive post e didascalie pronti da pubblicare',
      mission: 'scrivi post e didascalie nel tono dei clienti di Giulio',
      context: 'Giulio vuole testi diretti, pronti da usare.',
      duties: ['Proponi sempre due varianti.'],
      area: 'Progetti/Social',
      tools: [],
    },
    {
      // Not an allowed name: it becomes the first free moon.
      name: 'Pianificatore',
      title: 'il pianificatore',
      role: 'tiene il calendario editoriale dei clienti',
      mission: 'organizzi il calendario editoriale e ricordi le scadenze',
      context: 'Giulio pubblica per tre clienti ogni settimana.',
      duties: ['Tieni un piano settimanale per cliente.'],
      area: 'Progetti/Calendario',
      tools: ['web'],
      look: { shape: 'dome', eyes: 'cyclops', mouth: 'nope' },
    },
  ],
};

const ctx = (permissions = { vault: true, web: true }): ProposalContext => ({
  profile: profileFromAnswers(ANSWERS),
  permissions,
});

function scripted(answers: (string | Error)[]): Generate & { calls: string[] } {
  const calls: string[] = [];
  const gen = ((_system: string, prompt: string) => {
    calls.push(prompt);
    const next = answers.shift() ?? 'nothing';
    if (next instanceof Error) return Promise.reject(next);
    return Promise.resolve({ text: next, model: 'fake/planner', requests: 1 });
  }) as Generate & { calls: string[] };
  gen.calls = calls;
  return gen;
}

function expectHuesApart(genomes: unknown[]) {
  const hues = genomes.map((g) => MonsterGenomeSchema.parse(g).palette.hue);
  for (let i = 0; i < hues.length; i++) {
    for (let j = i + 1; j < hues.length; j++) {
      expect(
        hueDistance(hues[i]!, hues[j]!),
        `hues ${hues[i]} and ${hues[j]}`,
      ).toBeGreaterThanOrEqual(30);
    }
  }
}

describe('onboarding profile', () => {
  it('a profile without a name is “User” in English and “Utente” in Italian (C20)', () => {
    expect(profileFromAnswers({}).userName).toBe('User');
    expect(profileFromAnswers({}, 'it').userName).toBe('Utente');
  });

  it('turns the answers into a profile, profilo.md and the "always ask" rules', () => {
    inLang('it');
    const p = profileFromAnswers(ANSWERS);
    expect(p).toMatchObject({
      userName: 'Giulio',
      orchestratorName: 'Atlas',
      occupation: ['Social e contenuti', 'Consulenza o freelance', 'Seguo tre clienti nel food'],
      tone: 'diretto',
      language: 'italiano',
    });
    const md = renderProfile(p, { vault: true, web: false });
    expect(md).toContain('# Profilo di Giulio');
    expect(md).toContain('- pubblicare');
    expect(md).toContain('- contattare i clienti');
    expect(md).toContain('niente web');

    const { rules, disabled } = decisionRulesFrom(p);
    expect(rules.map((r) => r.id)).toEqual(['publish', 'spend', 'user-ask']);
    expect(disabled).toEqual(['contact', 'delete', 'goal']);
    expect(rules[2]!.patterns).toEqual(['\\bcontatta', '\\bclien']);
  });

  it('"Su di te": third person from the options, the free text in quotes (review of 16/10)', () => {
    inLang('it');
    const answer = (cosa: string[], text?: string): OnboardingAnswer => ({
      values: { cosa },
      ...(text ? { text } : {}),
    });
    const sentence = (lavoro: OnboardingAnswer, obiettivi: OnboardingAnswer = answer([])): string =>
      contextSentence(
        profileFromAnswers({
          ...ANSWERS,
          lavoro,
          obiettivi,
        }),
      );
    // Only the free text, in the first person: quoted, never "si occupa di co-fondatore…".
    expect(
      sentence(answer([], 'co-fondatore di uno studio digitale, scrivo idee per i clienti…')),
    ).toBe(
      'Giulio si presenta così: «co-fondatore di uno studio digitale, scrivo idee per i clienti».',
    );
    // An option in the first person becomes the third.
    expect(sentence(answer(['impresa']), answer(['clienti']))).toBe(
      'Giulio gestisce un’attività; nelle prossime settimane vuole trovare nuovi clienti.',
    );
    expect(sentence(answer(['sviluppo', 'impresa']))).toBe(
      'Giulio si occupa di sviluppo software e gestisce un’attività.',
    );
    // Nothing said: a neutral line; a goal only in free text, in quotes.
    expect(sentence(answer([]), answer([], 'voglio lanciare il sito nuovo'))).toBe(
      'Giulio ti ha affidato una parte del suo lavoro; per le prossime settimane: «voglio lanciare il sito nuovo».',
    );
    // Long words of the user are cut, the sentence stays within 200 characters.
    const long = sentence(
      answer(['social', 'marketing'], 'x'.repeat(400)),
      answer(['ordine'], 'y'.repeat(400)),
    );
    expect(long.length).toBeLessThanOrEqual(200);
    expect(long).toMatch(
      /^Giulio si occupa di social e contenuti e di marketing e vendite \(in parole sue: «x+…»\); nelle prossime settimane vuole mettere ordine nelle idee\.$/,
    );
    for (const s of [long, sentence(answer(['studio'], 'Faccio ricerca\nsulle api'))]) {
      expect(s).not.toMatch(/\n|scrivo|si occupa di (co-|faccio)/i);
    }
  });

  it('every fixed question accepts its defaults', () => {
    expect(ONBOARDING_QUESTIONS.length).toBeGreaterThanOrEqual(5);
    expect(ONBOARDING_QUESTIONS.length).toBeLessThanOrEqual(7);
  });

  it('without a language answer the monsters write in the app’s language (D-153)', () => {
    const tono = { values: { tono: ['diretto'] } };
    // English app: English monsters, not Italian ones.
    expect(profileFromAnswers({ ...ANSWERS, tono })).toMatchObject({
      languageId: 'en',
      language: 'English',
    });
    // The default the onboarding screen starts on is the same.
    const lingua = ONBOARDING_QUESTIONS.find((q) => q.id === 'tono')!.groups[1]!;
    expect(lingua.defaults).toEqual(['en']);
    inLang('it');
    expect(profileFromAnswers({ ...ANSWERS, tono })).toMatchObject({
      languageId: 'it',
      language: 'italiano',
    });
    expect(lingua.defaults).toEqual(['it']);
  });
});

describe('team proposal', () => {
  it('validates the model JSON and finishes names, tools, colours and monsters', async () => {
    const gen = scripted([JSON.stringify(MODEL_TEAM)]);
    const proposal = await proposeTeam(ctx({ vault: true, web: false }), gen);
    expect(proposal.source).toBe('model');
    expect(proposal.requests).toBe(1);
    expect(proposal.orchestrator).toMatchObject({ id: 'atlas', name: 'Atlas' });
    // Not a roster name: the orchestrator keeps Titan's monster.
    expect(proposal.orchestrator.genome).toEqual(monsterFor('titan'));
    expect(proposal.members.map((m) => [m.id, m.name, m.archetype])).toEqual([
      ['rhea', 'Rhea', 'rhea'],
      ['dione', 'Dione', 'dione'],
      ['tethys', 'Tethys', null],
    ]);
    // Web not allowed: nobody gets web tools, even when the model asked for them.
    for (const m of proposal.members) {
      expect(m.tools).not.toContain('web_search');
      expect(m.tools).toContain('vault_write');
    }
    expectHuesApart([proposal.orchestrator.genome, ...proposal.members.map((m) => m.genome)]);
    for (const m of proposal.members)
      expect(MonsterGenomeSchema.safeParse(m.genome).success).toBe(true);
  });

  it('retries once with the errors, then uses the model answer', async () => {
    inLang('it');
    const gen = scripted([
      'Ecco la squadra: {"agents": [ { "name": "Rhea" } ] }',
      JSON.stringify(MODEL_TEAM),
    ]);
    const errors: string[] = [];
    const attempts: string[] = [];
    const proposal = await proposeTeam(ctx(), gen, {
      onError: (m) => errors.push(m),
      onAttempt: (m) => attempts.push(m),
    });
    expect(proposal.source).toBe('model');
    expect(proposal.requests).toBe(2);
    // The first attempt was recovered: nothing to show as an error (U-3).
    expect(errors).toEqual([]);
    expect(attempts).toHaveLength(1);
    expect(gen.calls[1]).toContain('La tua risposta precedente non era valida');
    expect(gen.calls[1]).toContain('agents.0.title');
  });

  it('falls back to Rhea and Dione when the model fails twice', async () => {
    inLang('it');
    const errors: string[] = [];
    const gen = scripted(['non è JSON', '{"agents": []}']);
    const proposal = await proposeTeam(ctx(), gen, { onError: (m) => errors.push(m) });
    expect(proposal.source).toBe('fallback');
    expect(proposal.requests).toBe(2);
    // One error, in plain words, only because every attempt failed.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toBe(onboardingStrings('it').basicSquad);
    expect(errors[0]).not.toMatch(/JSON|attempt|tentativo/);
    expect(proposal.members.map((m) => m.name)).toEqual(['Rhea', 'Dione']);
    expect(proposal.members[0]!.context).toBe(
      'Giulio si occupa di social e contenuti e di consulenza o freelance (in parole sue: «Seguo tre clienti nel food»); nelle prossime settimane vuole pubblicare con costanza.',
    );
    expect(proposal.members[0]!.tools).toContain('web_search');
    expect(proposal.members[1]!.tools).not.toContain('web_search');
  });

  it('falls back when the model call throws, and without a model', async () => {
    const proposal = await proposeTeam(ctx(), scripted([new Error('429')]));
    expect(proposal.source).toBe('fallback');
    expect((await proposeTeam(ctx(), null)).source).toBe('fallback');
  });

  it('reports the usage of every request, those of a failed call included', async () => {
    const u = (model: string) => ({ provider: 'fake', model });
    const failed: GenerateError = new Error('stream broke');
    failed.usage = [u('first')];
    let call = 0;
    const gen: Generate = () =>
      call++ === 0
        ? Promise.resolve({ text: 'non è JSON', requests: 1, usage: [u('a')] })
        : Promise.reject(failed);
    const seen: string[] = [];
    const proposal = await proposeTeam(ctx(), gen, { onUsage: (x) => seen.push(x.model) });
    expect(proposal.source).toBe('fallback');
    expect(seen).toEqual(['a', 'first']);
  });

  it('renames an archetype when the orchestrator takes its name', () => {
    const answers = { ...ANSWERS, nomi: { values: { user: ['Giulio'], orchestrator: ['rhea'] } } };
    const proposal = fallbackProposal({
      profile: profileFromAnswers(answers),
      permissions: { vault: true, web: true },
    });
    expect(proposal.orchestrator.name).toBe('Rhea');
    expect(proposal.orchestrator.genome).toEqual(monsterFor('rhea'));
    expect(proposal.members.map((m) => [m.name, m.archetype])).toEqual([
      ['Tethys', 'rhea'],
      ['Dione', 'dione'],
    ]);
  });

  it('renders short AGENTS.md files without placeholders', () => {
    inLang('it');
    const proposal = fallbackProposal(ctx());
    for (const m of proposal.members) {
      const files = renderAgentFiles(memberBlueprint(m, { profile: ctx().profile }));
      expect(checkAgentsMd(files['AGENTS.md'])).toEqual([]);
      expect(files['AGENTS.md'].split('\n').length).toBeLessThan(MAX_AGENTS_MD_LINES);
      expect(files['AGENTS.md']).toContain('Giulio si occupa di social');
    }
  });
});

describe('agent areas (write permissions)', () => {
  const withArea = (area: string) =>
    JSON.stringify({
      agents: [{ ...MODEL_TEAM.agents[0], area }, MODEL_TEAM.agents[1]],
    });

  it('never turns a model area into a glob, the root, Agenti/ or profilo.md', () => {
    for (const area of [
      '**',
      '*',
      '?*',
      'Risorse/*',
      'Risorse/[ab]',
      '/',
      '.',
      'Agenti',
      'agenti/Atlas',
      'Agenti/Atlas',
      'Modelli',
      'Privato/Conti',
      'profilo.md',
      'Risorse/../Agenti',
      '.obsidian',
      'a/.git',
    ]) {
      const [rhea] = parseProposal(withArea(area), ctx());
      expect(rhea!.area, area).toBe('Risorse/Rhea');
      const config = blueprintToConfig(memberBlueprint(rhea!, ctx()));
      const perms = new VaultPermissions({
        orchestrator: 'atlas',
        agents: { rhea: { name: 'Rhea', write: config.vault.write } },
      });
      for (const path of ['profilo.md', 'Agenti/Atlas/MEMORY.md', 'Persone/mario.md']) {
        expect(perms.canWrite('rhea', path, null), `${area} → ${path}`).toBe(false);
      }
    }
    expect(parseProposal(withArea(' /Risorse//Idee food/ '), ctx())[0]!.area).toBe(
      'Risorse/Idee food',
    );
  });

  it('gives no step cap of their own (D-200) and the sources rule to the web agents (D-026)', () => {
    inLang('it');
    const members = parseProposal(JSON.stringify(MODEL_TEAM), ctx());
    const steps = members.map((m) => [
      m.name,
      blueprintToConfig(memberBlueprint(m, ctx())).limits.maxSteps,
    ]);
    // Rhea (archetype), Dione (archetype, no web), the planner with web tools.
    expect(steps).toEqual([
      ['Rhea', undefined],
      ['Dione', undefined],
      [members[2]!.name, undefined],
    ]);
    const md = (i: number) => renderAgentFiles(memberBlueprint(members[i]!, ctx()))['AGENTS.md'];
    expect(md(0)).toContain(sourcesRule('it'));
    expect(md(1)).not.toContain(sourcesRule('it'));
    // Without the web permission nobody gets the tools.
    const offline = parseProposal(JSON.stringify(MODEL_TEAM), ctx({ vault: true, web: false }));
    expect(offline[2]!.tools.some((t) => WEB_TOOLS.includes(t))).toBe(false);
  });

  it('the template refuses an unsafe area even from a hand-written blueprint', () => {
    const [rhea] = parseProposal(JSON.stringify(MODEL_TEAM), ctx());
    for (const area of ['**', 'Agenti/Atlas', 'profilo.md']) {
      expect(() => renderAgentFiles(memberBlueprint({ ...rhea!, area }, ctx())), area).toThrow();
    }
  });
});

describe('designed monsters', () => {
  it('are valid genomes with a hue far from the used ones', () => {
    const used = [62, 280, 160, 22, 222, 100, 315];
    for (const name of ['Iapetus', 'Phoebe', 'Janus', 'Pandora', 'Calypso']) {
      const g = designMonster(name, { avoidHues: used, look: { eyes: 'stalk', topper: 'crest' } });
      expect(MonsterGenomeSchema.safeParse(g).success).toBe(true);
      expect(Math.min(...used.map((u) => hueDistance(u, g.palette.hue)))).toBeGreaterThanOrEqual(
        30,
      );
      expect(g.topper?.kind).toBe('tuft');
    }
    expect(pickHue(70, [62])).toBe(92);
  });
});

describe('onboarding API', () => {
  const planner = [{ provider: 'fake', model: 'planner' }];

  async function hub(scripts: Parameters<typeof startTestHub>[0] = {}, home?: string) {
    return startTestHub(
      {
        planner: [
          fake.text('Mi dispiace, non so fare JSON'),
          fake.text(JSON.stringify(MODEL_TEAM)),
        ],
        ...scripts,
      },
      {
        withoutTeam: true,
        hub: { teamModels: planner },
        keyId: 'feedc0ffee00',
        ...(home ? { home } : {}),
      },
    );
  }

  it('runs the whole first start: answers, permissions, proposal, monsters, confirmation', async () => {
    inLang('it');
    const t = await hub(
      {
        // Proposal (not JSON, then JSON), then the orchestrator's reply.
        planner: [
          fake.text('Mi dispiace, non so fare JSON'),
          fake.text(JSON.stringify(MODEL_TEAM)),
          fake.text('Eccomi!'),
        ],
      },
      langHome('it'),
    );
    let state = await t.json<OnboardingState>('GET', '/api/onboarding');
    // The fake provider counts as a configured model: no key step.
    expect(state).toMatchObject({ status: 'pending', step: 'questions', hasKey: true });
    expect(state.guide.name).toBe('Titan');
    expect(await t.json<AgentSummary[]>('GET', '/api/agents')).toEqual([]);

    // Invalid answers are refused.
    const bad = await t.api('POST', '/api/onboarding/answers', {
      answers: { lavoro: { values: { cosa: ['astronauta'] } } },
    });
    expect(bad.status).toBe(400);

    // No team without the names (the only answers the first start needs, C1).
    const propose = await t.api('POST', '/api/onboarding/team/propose');
    expect(propose.status).toBe(409);
    state = await t.json<OnboardingState>('POST', '/api/onboarding/answers', {
      answers: { nomi: ANSWERS['nomi'] },
    });
    expect(state.guide.name).toBe('Atlas');
    expect(state.step).toBe('permissions');

    // The answers of the old questions are accepted and left out (`obiettivi`, `strumenti`).
    state = await t.json<OnboardingState>('POST', '/api/onboarding/answers', { answers: ANSWERS });
    expect(state.step).toBe('permissions');
    expect(Object.keys(state.answers).sort()).toEqual([
      'chiedi',
      'deleghe',
      'lavoro',
      'nomi',
      'tono',
    ]);
    const vault = t.core.hub.vault.root;
    const profile = readFileSync(join(vault, 'profilo.md'), 'utf8');
    expect(profile).toMatch(/^---\n[\s\S]*type: profile[\s\S]*---\n# Profilo di Giulio/);
    // The gate asks for the chosen kinds only.
    const rules = t.core.hub.gate.rules.map((r) => `${r.id}:${r.effect}`);
    expect(rules).toContain('publish:ask');
    expect(rules).toContain('user-ask:ask');
    expect(rules).not.toContain('contact:ask');
    const settings = readSettingsFile(t.home) as {
      userName: string;
      decisions: { disabled: string[] };
    };
    expect(settings.userName).toBe('Giulio');
    expect(settings.decisions.disabled).toEqual(['contact', 'delete', 'goal']);

    state = await t.json<OnboardingState>('POST', '/api/onboarding/answers', {
      permissions: { vault: true, web: false },
    });
    expect(state.step).toBe('team');
    expect(readFileSync(join(vault, 'profilo.md'), 'utf8')).toContain('niente web');

    // First answer is not JSON: one retry, then the model's team.
    state = await t.json<OnboardingState>('POST', '/api/onboarding/team/propose');
    expect(state.proposal?.source).toBe('model');
    expect(state.proposal?.requests).toBe(2);
    expect(t.provider.calls).toHaveLength(2);
    // Both requests, the invalid answer included, are in the log (and count for the budget).
    const usage = t.events().filter((e): e is LogEvent<'provider_usage'> => {
      return e.type === 'provider_usage';
    });
    expect(usage.map((u) => [u.agent, u.data.provider, u.data.model])).toEqual([
      ['system', 'fake', 'planner'],
      ['system', 'fake', 'planner'],
    ]);
    expect(typeof usage[0]!.data.outputTokens).toBe('number');
    // Why the first attempt failed is in the log, as a quiet line for a diagnosis (item 14).
    const attempts = t
      .events()
      .filter((e): e is LogEvent<'error'> => e.type === 'error')
      .filter((e) => e.data.code === 'onboarding_attempt');
    expect(attempts.map((e) => e.data.message)).toEqual([
      expect.stringMatching(/^proposta del team non valida \(tentativo 1\)/),
    ]);
    // With the fingerprint of the key that served them (D-019).
    expect(usage.map((u) => u.data.keyId)).toEqual(['feedc0ffee00', 'feedc0ffee00']);
    const members = state.proposal!.members;
    expect(members.map((m) => m.name)).toEqual(['Rhea', 'Dione', 'Tethys']);

    const before = members[2]!.genome;
    const reborn = await t.json<ProposedAgent>('POST', '/api/onboarding/monster', { id: 'tethys' });
    expect(reborn.genome).not.toEqual(before);
    expectHuesApart([
      state.proposal!.orchestrator.genome,
      members[0]!.genome,
      members[1]!.genome,
      reborn.genome,
    ]);
    expect((await t.api('POST', '/api/onboarding/monster', { id: 'nessuno' })).status).toBe(404);

    // Remove Dione, rename Tethys.
    const sameName = await t.api('POST', '/api/onboarding/team/confirm', {
      members: [{ id: 'rhea' }, { id: 'tethys', name: 'Atlas' }],
    });
    expect(sameName.status).toBe(400);
    const done = await t.json<TeamConfirmResponse>('POST', '/api/onboarding/team/confirm', {
      members: [{ id: 'rhea' }, { id: 'tethys', name: 'Calendario' }],
    });
    expect(done.agents.map((a) => [a.id, a.name, a.isOrchestrator])).toEqual([
      ['atlas', 'Atlas', true],
      ['calendario', 'Calendario', false],
      ['rhea', 'Rhea', false],
    ]);
    expect(done.agents[1]!.genome).toMatchObject({
      id: 'calendario',
      palette: (reborn.genome as { palette: unknown }).palette,
    });
    expect(done.welcome).toContain('Ciao Giulio! Sono Atlas');

    // Files from the fixed templates, valid, with the permitted tools only.
    for (const id of ['atlas', 'rhea', 'calendario']) {
      const def = await loadAgentDefinition(join(t.home, 'agents', id));
      expect(checkAgentsMd(def.instructions)).toEqual([]);
      expect(def.instructions).not.toMatch(/\{\{/);
      expect(def.config.tools).not.toContain('web_search');
      expect(MonsterGenomeSchema.safeParse(def.genome).success).toBe(true);
    }
    const orchestratorMd = readFileSync(join(t.home, 'agents', 'atlas', 'AGENTS.md'), 'utf8');
    expect(orchestratorMd).toContain('# Atlas');
    expect(orchestratorMd).toContain('**Calendario**: tiene il calendario editoriale dei clienti');
    expect(readFileSync(join(t.home, 'agents', 'calendario', 'AGENTS.md'), 'utf8')).toContain(
      'Salvi i risultati in `Progetti/Calendario/`',
    );
    expect(t.core.hub.team.get('rhea')!.config.tools).not.toContain('web_fetch');
    // The default memory of Titan is gone; the vault knows the new areas.
    expect(existsSync(join(vault, 'Agenti/Titan/MEMORY.md'))).toBe(false);
    expect(t.core.hub.vault.permissions.writableAreas('calendario')).toContain(
      'Progetti/Calendario/',
    );

    const welcome = t
      .events()
      .find((e): e is LogEvent<'message'> => e.type === 'message' && e.agent === 'atlas');
    expect(welcome?.data.text).toBe(done.welcome);

    state = await t.json<OnboardingState>('GET', '/api/onboarding');
    expect(state).toMatchObject({ status: 'done', step: 'done' });
    expect(
      (await t.api('POST', '/api/onboarding/team/confirm', { members: [{ id: 'rhea' }] })).status,
    ).toBe(409);
    const saved = readSettingsFile(t.home);
    expect(saved).toMatchObject({
      orchestratorName: 'Atlas',
      permissions: { vault: true, web: false },
    });

    // The orchestrator works with the models given to the team.
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'ciao' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
  });

  it('a confirmation that fails half-way is finished by a new attempt, or at the next start (M10)', async () => {
    for (const via of ['retry', 'restart'] as const) {
      const t = await hub({ planner: [fake.text(JSON.stringify(MODEL_TEAM))] });
      await t.json('POST', '/api/onboarding/answers', {
        answers: ANSWERS,
        permissions: { vault: true, web: true },
      });
      await t.json<OnboardingState>('POST', '/api/onboarding/team/propose');
      // settings.json cannot be written: the step after the folders fails.
      const settings = join(t.home, 'settings.json');
      const saved = readFileSync(settings, 'utf8');
      rmSync(settings);
      mkdirSync(settings);
      const body = { members: [{ id: 'rhea' }, { id: 'dione' }] };
      const failed = await t.api('POST', '/api/onboarding/team/confirm', body);
      expect(failed.ok, via).toBe(false);
      expect(t.core.hub.onboarding.done).toBe(true);
      rmSync(settings, { recursive: true });
      writeFileSync(settings, saved);

      let done: { home: string; events: () => LogEvent[] };
      if (via === 'retry') {
        const res = await t.json<TeamConfirmResponse>('POST', '/api/onboarding/team/confirm', body);
        expect(res.welcome).toContain('Sono Atlas');
        done = t;
      } else {
        const home = t.home;
        await t.core.close();
        done = await startTestHub({}, { withoutTeam: true, home, hub: { teamModels: planner } });
      }
      const file = JSON.parse(readFileSync(settings, 'utf8')) as Record<string, unknown>;
      expect(file['orchestratorName'], via).toBe('Atlas');
      const welcomes = done
        .events()
        .filter((e) => e.type === 'message' && e.data.channel === 'system');
      expect(welcomes, via).toHaveLength(1);
      expect(existsSync(join(done.home, 'agents', 'rhea', 'AGENTS.md'))).toBe(true);
    }
  });

  it('a new attempt does only the steps left, and the start gives up after three (review of 19/10, 8)', async () => {
    const t = await hub({ planner: [fake.text(JSON.stringify(MODEL_TEAM))] });
    await t.json('POST', '/api/onboarding/answers', {
      answers: ANSWERS,
      permissions: { vault: true, web: true },
    });
    await t.json<OnboardingState>('POST', '/api/onboarding/team/propose');
    // The profile cannot be written, and it stays so: the same failure at every attempt.
    const profile = join(t.core.hub.vault.root, 'profilo.md');
    rmSync(profile, { force: true });
    mkdirSync(profile);
    const body = { members: [{ id: 'rhea' }, { id: 'dione' }] };
    expect((await t.api('POST', '/api/onboarding/team/confirm', body)).ok).toBe(false);
    // The user changes a monster meanwhile: no attempt writes it again.
    const rhea = join(t.home, 'agents', 'rhea', 'AGENTS.md');
    writeFileSync(rhea, `${readFileSync(rhea, 'utf8')}\nRegola mia.\n`);
    let home = t.home;
    await t.core.close();
    const failures = (h: TestHub) =>
      h
        .events()
        .filter((e): e is LogEvent<'error'> => e.type === 'error' && e.data.code === 'onboarding')
        .map((e) => e.data.message);
    for (let start = 0; start < 3; start++) {
      const next = await startTestHub(
        {},
        { withoutTeam: true, home, hub: { teamModels: planner } },
      );
      home = next.home;
      await next.core.close();
    }
    expect(readFileSync(rhea, 'utf8')).toContain('Regola mia.');
    // The steps before were done once: the settings are written.
    expect(readSettingsFile(home)).toMatchObject({ orchestratorName: 'Atlas' });
    // Two more attempts at the start, then it stops and says what is left; then nothing more.
    const last = await startTestHub({}, { withoutTeam: true, home, hub: { teamModels: planner } });
    const said = failures(last);
    expect(said).toHaveLength(3);
    expect(said[2]).toMatch(/after 3 attempts.*Missing: the profile, the welcome/);
  });

  it('validates edited duties and area at the confirmation, and refuses an id taken by the orchestrator', async () => {
    inLang('it');
    const unsafe = {
      agents: [{ ...MODEL_TEAM.agents[0], area: '**' }, MODEL_TEAM.agents[1]],
    };
    const t = await hub({ planner: [fake.text(JSON.stringify(unsafe))] }, langHome('it'));
    await t.json('POST', '/api/onboarding/answers', {
      answers: ANSWERS,
      permissions: { vault: true, web: true },
    });
    const state = await t.json<OnboardingState>('POST', '/api/onboarding/team/propose');
    expect(state.proposal?.source).toBe('model');
    expect(state.proposal!.members.map((m) => m.area)).toEqual(['Risorse/Rhea', 'Progetti/Social']);

    for (const area of ['**', 'Agenti/Atlas', 'profilo.md', '']) {
      const res = await t.api('POST', '/api/onboarding/team/confirm', {
        members: [{ id: 'rhea', area }, { id: 'dione' }],
      });
      expect(res.status, area).toBe(400);
    }
    const twoLines = await t.api('POST', '/api/onboarding/team/confirm', {
      members: [{ id: 'rhea', duties: ['Prima riga\nseconda riga'] }],
    });
    expect(twoLines.status).toBe(400);
    // "Àtlas" is not "Atlas", but both would live in agents/atlas.
    const clash = await t.api('POST', '/api/onboarding/team/confirm', {
      members: [{ id: 'rhea', name: 'Àtlas' }, { id: 'dione' }],
    });
    expect(clash.status).toBe(400);
    expect(await clash.json()).toMatchObject({ error: 'invalid_name' });
    expect(existsSync(join(t.home, 'agents', 'atlas'))).toBe(false);

    const done = await t.json<TeamConfirmResponse>('POST', '/api/onboarding/team/confirm', {
      members: [
        {
          id: 'rhea',
          area: ' Risorse/Food/ ',
          duties: ['Citi sempre la fonte.', 'Scrivi in breve.'],
        },
        { id: 'dione' },
      ],
    });
    expect(done.agents.map((a) => a.id)).toEqual(['atlas', 'dione', 'rhea']);
    const md = readFileSync(join(t.home, 'agents', 'rhea', 'AGENTS.md'), 'utf8');
    expect(md).toContain('- Citi sempre la fonte.\n- Scrivi in breve.');
    expect(md).toContain('Salvi i risultati in `Risorse/Food/`');
    const perms = t.core.hub.vault.permissions;
    expect(perms.canWrite('rhea', 'Risorse/Food/nota.md', null)).toBe(true);
    expect(perms.canWrite('rhea', 'profilo.md', null)).toBe(false);
    expect(perms.canWrite('rhea', 'Agenti/Atlas/MEMORY.md', null)).toBe(false);
  });

  it('refuses names that would take the id of the user or of the system (invalid_name)', async () => {
    const t = await hub({ planner: [fake.text(JSON.stringify(MODEL_TEAM))] });
    for (const name of ['User', 'System', 'sYsTeM']) {
      const res = await t.api('POST', '/api/onboarding/answers', {
        answers: { nomi: { values: { user: ['Giulio'], orchestrator: [name] } } },
      });
      expect(res.status, name).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_name' });
    }
    await t.json('POST', '/api/onboarding/answers', {
      answers: ANSWERS,
      permissions: { vault: true, web: true },
    });
    await t.json<OnboardingState>('POST', '/api/onboarding/team/propose');
    for (const name of ['User', 'System']) {
      const res = await t.api('POST', '/api/onboarding/team/confirm', {
        members: [{ id: 'rhea', name }, { id: 'dione' }],
      });
      expect(res.status, name).toBe(400);
      expect(await res.json()).toMatchObject({ error: 'invalid_name' });
      expect(existsSync(join(t.home, 'agents', name.toLowerCase()))).toBe(false);
    }
  });

  it('refuses to propose a team whose orchestrator would be the user', async () => {
    const t = await hub();
    await t.json('POST', '/api/onboarding/answers', {
      answers: ANSWERS,
      permissions: { vault: true, web: true },
    });
    // Answers saved before the check existed.
    const store = new StateStore(t.core.db);
    const saved = store.get<{ answers: Record<string, OnboardingAnswer> }>(ONBOARDING_STATE_KEY)!;
    saved.answers['nomi'] = { values: { user: ['Giulio'], orchestrator: ['User'] } };
    store.set(ONBOARDING_STATE_KEY, saved);
    const res = await t.api('POST', '/api/onboarding/team/propose');
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: 'invalid_name' });
  });

  it('does not ask the model for a team while Monsters is stopped, and a kill stops the call', async () => {
    const t = await hub();
    await t.json('POST', '/api/onboarding/answers', {
      answers: ANSWERS,
      permissions: { vault: true, web: true },
    });
    await t.json('POST', '/api/kill', { reason: 'prova' });
    const refused = await t.api('POST', '/api/onboarding/team/propose');
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: 'halted' });
    expect(t.provider.calls).toHaveLength(0);
    await t.json('POST', '/api/resume');

    // A kill while the model is thinking: the call is aborted, no proposal is saved.
    const started = deferred();
    let aborted = false;
    const slow: Generate = (_system, _prompt, signal) =>
      new Promise((_resolve, reject) => {
        started.resolve();
        signal?.addEventListener('abort', () => {
          aborted = true;
          reject(signal.reason as Error);
        });
      });
    const t2 = await startTestHub(
      {},
      { withoutTeam: true, hub: { teamModels: planner, onboardingGenerate: slow } },
    );
    await t2.json('POST', '/api/onboarding/answers', {
      answers: ANSWERS,
      permissions: { vault: true, web: true },
    });
    const pending = t2.api('POST', '/api/onboarding/team/propose');
    await started.promise;
    await t2.json('POST', '/api/kill', { reason: 'prova' });
    const res = await pending;
    expect(res.status).toBe(409);
    expect(aborted).toBe(true);
    expect((await t2.json<OnboardingState>('GET', '/api/onboarding')).proposal).toBeNull();
  });

  it('keeps the progress across a reload of the state', async () => {
    const t = await hub();
    await t.json('POST', '/api/onboarding/answers', {
      answers: ANSWERS,
      permissions: { vault: true, web: true },
    });
    const again = await t.json<OnboardingState>('GET', '/api/onboarding');
    expect(again.step).toBe('team');
    expect(again.answers['nomi']?.values['orchestrator']).toEqual(['Atlas']);
  });

  it('without a team, messages wait for the first start instead of creating a default team', async () => {
    const t = await startTestHub(
      { titan: [fake.text('Ciao!')] },
      { withoutTeam: true, hub: { teamModels: [{ provider: 'fake', model: 'titan' }] } },
    );
    const res = await t.api('POST', '/api/messages', { text: 'ciao' });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('onboarding_pending');
    expect(body.message).toMatch(/Finish the first start in the interface/);
    expect(await t.json('GET', '/api/agents')).toEqual([]);
    const state = await t.json<OnboardingState>('GET', '/api/onboarding');
    expect(state.status).toBe('pending');
    expect(state.step).not.toBe('done');
    expect(t.events().some((e) => e.type === 'run')).toBe(false);
  });

  it('applies the permissions to the tools of every agent', async () => {
    const t = await startTestHub({});
    expect(t.core.hub.team.get('rhea')!.config.tools).toContain('web_search');
    t.core.hub.team.setPolicy({ vault: false, web: false });
    const rhea = t.core.hub.team.get('rhea')!.config.tools;
    expect(rhea).not.toContain('web_search');
    expect(rhea).not.toContain('vault_write');
    expect(rhea).toContain('vault_read');
    t.core.hub.team.setPolicy({ vault: true, web: true });
    expect(t.core.hub.team.get('rhea')!.config.tools).toContain('web_search');
  });
});

describe('welcome text', () => {
  it('does not nest brackets when a role has its own', async () => {
    const { welcomeText } = await import('../src/onboarding/service.ts');
    const text = welcomeText(
      { userName: 'Giulio', orchestratorName: 'Atlas', languageId: 'it' } as never,
      [{ name: 'Dione', role: 'testi pronti da usare (post, mail, riassunti, piani)' }] as never,
      true,
    );
    expect(text).toContain('Dione (testi pronti da usare: post, mail, riassunti, piani)');
    expect(text).not.toContain('))');
  });
});
