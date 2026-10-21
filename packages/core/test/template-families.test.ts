import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  LANGS,
  setAppLang,
  writingLanguage,
  writingLanguageName,
  type Lang,
  type ProfileView,
} from '@monsters/shared';
import { describe, expect, it, onTestFinished } from 'vitest';
import { parse as parseYaml } from 'yaml';
import {
  BLUEPRINT_JSON,
  checkAgentsMd,
  contextSentence,
  currentTemplates,
  dioneBlueprint,
  familyOf,
  fieldsOf,
  instructionsOf,
  orchestratorBlueprint,
  parseInstructions,
  profileFromAnswers,
  proposalPrompt,
  renderAgentFiles,
  renderAgentsMd,
  renderProfile,
  replaceLanguage,
  replaceTeamSection,
  rheaBlueprint,
  sourcesRule,
  TEMPLATE_FAMILIES,
  upgradeInstructions,
  webMethod,
  type AgentBlueprint,
  type AgentConfig,
} from '../src/index.ts';
import { instructionsForTools } from '../src/agents/run-agent.ts';
import { tempHome } from './helpers.ts';
import { startTestHub } from './hub-helpers.ts';
import { inLang } from './prompt-lang.ts';

/*
 * The two families of AGENTS.md (D-153, wave 3): the Italian one never moves (the evals measured
 * it), the English one says the same; a file keeps the family it was written in, whatever the
 * app's language is when it is read back, checked or rewritten.
 */

const sha = (s: string) => createHash('sha256').update(s).digest('hex');

const user = { user: 'Giulio', context: 'Giulio runs Saturday Company, a studio in Milan.' };

function blueprints(lang: Lang): Record<string, AgentBlueprint> {
  return {
    orchestrator: orchestratorBlueprint({ ...user, name: 'Titan', lang }),
    rhea: rheaBlueprint({ ...user, lang }),
    dione: dioneBlueprint({ ...user, lang }),
  };
}

/** What a file of family `lang` is: its text, config and fields. */
function rendered(bp: AgentBlueprint, lang: Lang) {
  const files = renderAgentFiles(bp, lang);
  return {
    text: files['AGENTS.md'],
    config: parseYaml(files['agent.yaml']) as AgentConfig,
    fields: fieldsOf(bp),
  };
}

function inApp(lang: Lang): void {
  setAppLang(lang);
  onTestFinished(() => setAppLang('en'));
}

describe('the Italian family did not move', () => {
  it('has the very texts of before wave 3', () => {
    const it = TEMPLATE_FAMILIES.it;
    expect(
      [
        it.current.orchestrator,
        it.current.lead,
        it.current.subagent,
        it.legacy[0]!.orchestrator,
        it.legacy[1]!.orchestrator,
        it.legacy[1]!.subagent,
        it.legacy[2]!.orchestrator,
        it.legacy[2]!.subagent,
        it.webMethod,
        it.sourcesRule,
      ].map(sha),
    ).toEqual([
      'bab2c0234f703bac6fd30387dd064a8658c4dc837ce5feef425845a3de2d79c0',
      '0f602f545121c07d5942ad103bc21764970b60545465de97c491443942e2997b',
      'efc162fd9bcc22b20c2beaeb9964871301af5f315417b78a9f2af8dff78125fb',
      'b0585949e10fcac99fbf5c597143e4abab32c0b7b9c8c262799355c2d740fa26',
      'b54a254e2ce69ce517e39b0f988f61792b608a00beafc209d8863b034bbc81ac',
      '5914c090353afcf07c167187062cbd369f27d249772b7529ce0f97294f701b06',
      '039bf3aa86cd6016df417777671716987debdaccc9bb8667a67e65e2c94cf0b1',
      '948f4c59dd3622c3e95801134a968b2cc34302fa8330cd229defd0e8378db5af',
      'cc198908f4dc179cf7c73f2b7ddf94b21a7b27b5e12758b48df41d84a804f061',
      '8ee698ed95821fcaddb0ec34d84f5669f66e96e5a6f29c11e6aca7394b1f37c1',
    ]);
    expect(it.current.orchestrator.split('\n')[2]).toBe(
      'Sei {{NOME}}, il coordinatore della squadra di {{UTENTE}}. Ricevi ogni richiesta che non è rivolta a un agente preciso e la porti fino in fondo.',
    );
  });

  it('renders the archetypes as before, with the Italian word of the language', () => {
    inLang('it');
    const md = renderAgentsMd(rheaBlueprint(user));
    expect(md).toContain('Sei Rhea, la ricercatrice della squadra di Giulio: trovi informazioni');
    expect(md).toContain('- Sempre in italiano, anche quando le fonti sono in altre lingue');
    // A blueprint holding the English word renders the Italian one in the Italian family.
    expect(renderAgentsMd({ ...rheaBlueprint(user), language: 'Spanish' })).toContain(
      '- Sempre in spagnolo,',
    );
  });
});

describe('the English family', () => {
  const placeholders = (t: string) => [...new Set(t.match(/\{\{[A-Z_]+\}\}/g))].sort();

  it('has the structure of the Italian one: same lines, placeholders and sections', () => {
    const it = TEMPLATE_FAMILIES.it.current;
    const en = TEMPLATE_FAMILIES.en.current;
    for (const k of ['orchestrator', 'lead', 'subagent'] as const) {
      expect(en[k].split('\n').length, k).toBe(it[k].split('\n').length);
      expect(placeholders(en[k]), k).toEqual(placeholders(it[k]));
      expect(en[k].match(/^## /gm)?.length, k).toBe(it[k].match(/^## /gm)?.length);
      // The same tools and files named, in the same order.
      const named = (t: string) =>
        t
          .match(/`[^`]+`/g)
          ?.filter((c) => /^`(?:vault_|web_|ask_|team_|notes_|delegate|profilo)/.test(c));
      expect(named(en[k]), k).toEqual(named(it[k]));
    }
    expect(webMethod('en').split('\n').length).toBe(webMethod('it').split('\n').length);
  });

  it('is what a new agent gets in an English app, naming the language in English', () => {
    for (const [name, bp] of Object.entries(blueprints('en'))) {
      const md = renderAgentsMd(bp);
      expect(checkAgentsMd(md), name).toEqual([]);
      expect(md, name).toMatch(/^# \S+\n\nYou are /);
      expect(md, name).not.toMatch(/\bSei\b|squadra|italiano/);
    }
    const rhea = renderAgentsMd(blueprints('en').rhea!);
    expect(rhea).toContain(
      'You are Rhea, the researcher on Giulio’s squad: you find reliable, up-to-date information and turn it into useful notes. Giulio runs Saturday Company',
    );
    expect(rhea).toContain('- Always in Italian, even when the sources are in other languages');
    expect(rhea).toContain(`- ${sourcesRule('en')}`);
    expect(rhea).toContain('## How you search the web');
    expect(rhea).toContain('end the report with “To remember:”');
    expect(rhea).toContain('under “To decide”');
    const titan = renderAgentsMd(blueprints('en').orchestrator!);
    expect(titan).toContain('- **Rhea**: online research and summaries with sources');
    expect(titan).toContain('no jargon, in Italian.');
    expect(
      renderAgentsMd({ ...blueprints('en').orchestrator!, team: [] } as AgentBlueprint),
    ).toContain('- Nobody yet: you work alone.');
    expect(renderAgentFiles(blueprints('en').orchestrator!)['agent.yaml']).toContain(
      'role: coordinator of Giulio’s squad',
    );
  });
});

describe('a file keeps its family', () => {
  const cases = LANGS.flatMap((family) =>
    LANGS.flatMap((app) => ['orchestrator', 'rhea', 'dione'].map((who) => ({ family, app, who }))),
  );

  for (const { family, app, who } of cases) {
    it(`${who} of the ${family} family, read back in an ${app} app`, () => {
      const { text, config, fields } = rendered(blueprints(family)[who]!, family);
      inApp(app);
      // Read back without blueprint.json (teams of before), from the file only.
      const parsed = parseInstructions(text, config);
      expect(parsed).toMatchObject({ kind: fields.kind, name: fields.name, user: 'Giulio' });
      expect(parsed?.language).toBe(writingLanguage('it')![family]);
      if (fields.kind === 'subagent') {
        expect(parsed).toMatchObject({
          orchestrator: 'Titan',
          outputArea: fields.outputArea,
          web: who === 'rhea',
          duties: fields.duties,
          report: fields.report,
          title: fields.title,
        });
      } else {
        expect(parsed).toMatchObject({ team: (fields as { team: unknown }).team });
      }
      // Pristine with blueprint.json (whatever word of the language it holds) and without.
      for (const stored of [fields, { ...fields, language: 'Italian' }, parsed]) {
        const i = instructionsOf(text, stored, config);
        expect(i, `${family}/${app}`).toMatchObject({ pristine: true, lang: family });
      }
      expect(instructionsOf(text, null, config)).toMatchObject({ pristine: true, lang: family });
      // Edited by hand: never read back, still of its family.
      const edited = `${text}\n- A rule of mine.\n`;
      expect(parseInstructions(edited, config)).toBeNull();
      expect(instructionsOf(edited, fields, config)).toMatchObject({
        pristine: false,
        lang: family,
      });
      expect(familyOf(edited)).toBe(family);
    });
  }

  it('an Italian file of an older template is rendered again in Italian in an English app', async () => {
    inLang('it');
    const bp = rheaBlueprint(user);
    const legacy = renderAgentsMd(bp, TEMPLATE_FAMILIES.it.legacy[1]);
    const files = renderAgentFiles(bp);
    const current = files['AGENTS.md'];
    setAppLang('en');
    for (const withBlueprint of [false, true]) {
      const dir = join(tempHome(), 'rhea');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'AGENTS.md'), legacy);
      if (withBlueprint) writeFileSync(join(dir, BLUEPRINT_JSON), JSON.stringify(fieldsOf(bp)));
      const config = parseYaml(files['agent.yaml']) as AgentConfig;
      expect(await upgradeInstructions(dir, config)).toBe(current);
      expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toMatch(/^# Rhea\n\nSei Rhea, /);
      // Current already: nothing to do, in either app language.
      expect(await upgradeInstructions(dir, config)).toBeNull();
    }
  });

  it('an English file is never upgraded nor turned Italian by an Italian app', async () => {
    const bp = rheaBlueprint({ ...user, lang: 'en' });
    const { text, config } = rendered(bp, 'en');
    inApp('it');
    const dir = join(tempHome(), 'rhea');
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'AGENTS.md'), text);
    expect(await upgradeInstructions(dir, config)).toBeNull();
    expect(readFileSync(join(dir, 'AGENTS.md'), 'utf8')).toBe(text);
  });

  it('replaces the team section and the language in the file’s own family', () => {
    const team = [{ name: 'Tethys', summary: 'the calendar' }];
    for (const family of LANGS) {
      const orch = rendered(blueprints(family).orchestrator!, family).text;
      const next = replaceTeamSection(orch, team);
      expect(next).toContain('- **Tethys**: the calendar\n\n## ');
      expect(next).not.toContain('**Rhea**');
      expect(replaceTeamSection(orch, [])).toContain(TEMPLATE_FAMILIES[family].noTeam);
      // The language, whichever family's word the profile gives.
      for (const [from, to] of [
        ['italiano', 'spagnolo'],
        ['Italian', 'Spanish'],
      ] as const) {
        const md = replaceLanguage(orch, from, to);
        expect(md).toContain(`, in ${writingLanguageName('es', family)}.`);
        expect(md).not.toMatch(/\bitaliano\b|\bItalian\b/);
      }
    }
    const lead = renderAgentsMd(
      {
        kind: 'lead',
        id: 'leda',
        name: 'Leda',
        user: 'Giulio',
        color: '#123456',
        models: [{ provider: 'fake', model: 'x' }],
        project: 'saturday',
        projectName: 'Saturday',
        area: 'Progetti/Saturday',
        orchestrator: 'Titan',
        team: [],
        goal: 'Launch the new site.',
      },
      currentTemplates('en'),
    );
    expect(lead).toContain('the lead of the “Saturday” project');
    expect(lead).toContain('The project’s goal: Launch the new site.');
    expect(TEMPLATE_FAMILIES.it.goal('i post della pagina')).toBe(
      " L'obiettivo del progetto: i post della pagina.",
    );
    expect(replaceTeamSection(lead, team, true)).toContain(
      '## The project’s squad\n- **Tethys**: the calendar\n',
    );
  });

  it('a run without web tools reads neither family’s web method nor sources rule', () => {
    for (const family of LANGS) {
      const { text } = rendered(blueprints(family).rhea!, family);
      const out = instructionsForTools(text, ['vault_read']);
      expect(out).not.toContain(webMethod(family).trim().split('\n')[0]!);
      expect(out).not.toContain(sourcesRule(family));
      expect(instructionsForTools(text, ['web_search'])).toBe(text);
    }
  });
});

describe('writing languages', () => {
  it('maps codes and both words, keeping a word already of the family', () => {
    expect(writingLanguage('italiano')?.id).toBe('it');
    expect(writingLanguage('German')?.id).toBe('de');
    expect(writingLanguageName('italiano', 'en')).toBe('Italian');
    expect(writingLanguageName('Italian', 'it')).toBe('italiano');
    expect(writingLanguageName('Italiano', 'it')).toBe('Italiano');
    expect(writingLanguageName('fr', 'en')).toBe('French');
    expect(writingLanguageName('klingon', 'en')).toBe('klingon');
  });
});

const ANSWERS = {
  nomi: { values: { user: ['Giulio'], orchestrator: ['Atlas'] } },
  lavoro: { values: { cosa: ['social', 'impresa'] }, text: 'Seguo tre clienti nel food' },
  obiettivi: { values: { cosa: ['ordine'] } },
  deleghe: { values: { cosa: ['ricerche'] } },
  strumenti: { values: { cosa: ['notion'] } },
  chiedi: { values: { cosa: ['publish'] } },
  tono: { values: { tono: ['diretto'], lingua: ['de'] } },
};

describe('the profile in two families', () => {
  it('writes profilo.md and the sentence about the user in English in an English app', () => {
    const p = profileFromAnswers(ANSWERS);
    expect(p).toMatchObject({ lang: 'en', language: 'German', tone: 'direct' });
    const md = renderProfile(p, { vault: true, web: false });
    expect(md).toMatch(/^# Giulio’s profile\n/);
    expect(md).toContain('- Squad coordinator: Atlas');
    expect(md).toContain('## Always ask before\n- publishing');
    expect(md).toContain('- Tone: direct\n- Language: German');
    expect(md).toContain('- no web');
    expect(contextSentence(p)).toBe(
      'Giulio works in social media and content and runs a business (in their own words: «Seguo tre clienti nel food»); in the next few weeks they want to get their ideas in order.',
    );
  });

  it('writes them in Italian in an Italian app, as before', () => {
    inLang('it');
    const p = profileFromAnswers(ANSWERS);
    expect(p).toMatchObject({ lang: 'it', language: 'tedesco' });
    expect(renderProfile(p, null)).toContain(
      '## Tono e lingua\n- Tono: diretto\n- Lingua: tedesco',
    );
    expect(contextSentence(p)).toMatch(
      /^Giulio si occupa di social e contenuti e gestisce un’attività/,
    );
  });

  it('asks for the team in the app’s language, naming the writing language in it', () => {
    const ctx = { profile: profileFromAnswers(ANSWERS), permissions: { vault: true, web: true } };
    const en = proposalPrompt(ctx);
    expect(en).toMatch(/^Profile:\n/);
    expect(en).toContain('(writing in German, links');
    expect(en).toContain('Rules of the fields (everything in English');
    expect(en).toContain('"title":"the researcher"');
    expect(proposalPrompt(ctx, 'it')).toContain('(scrivere in tedesco, link');
  });
});

describe('the profile and the AGENTS.md of a family the app is not in', () => {
  it('an English team in an Italian app: names and language change in English', async () => {
    // The team was written by an English app; then the user switches the app to Italian.
    const t = await startTestHub({});
    onTestFinished(() => setAppLang('en'));
    t.core.hub.setLanguage('it');
    const md = (id: string) => readFileSync(join(t.home, 'agents', id, 'AGENTS.md'), 'utf8');
    expect(md('titan')).toMatch(/^# Titan\n\nYou are Titan, /);
    await t.json<ProfileView>('PUT', '/api/profile', { userName: 'Giuliano', language: 'es' });
    expect(md('titan')).toContain('You are Titan, the coordinator of Giuliano’s squad.');
    expect(md('titan')).toContain('no jargon, in Spanish.');
    expect(md('rhea')).toContain('on Giuliano’s squad:');
    expect(md('rhea')).toContain('- Always in Spanish, even when');
    const yaml = parseYaml(readFileSync(join(t.home, 'agents', 'titan', 'agent.yaml'), 'utf8')) as {
      role: string;
    };
    expect(yaml.role).toBe('coordinator of Giuliano’s squad');
    // No profilo.md yet: a new one, in the app's language.
    const path = join(t.core.hub.vault.root, 'profilo.md');
    expect(readFileSync(path, 'utf8')).toContain('- Lingua: spagnolo');

    // An English profilo.md (written by an English app) keeps its family.
    const english = renderProfile(
      {
        ...profileFromAnswers({ tono: { values: { tono: ['diretto'], lingua: ['es'] } } }, 'en'),
        userName: 'Giuliano',
        orchestratorName: 'Titan',
      },
      null,
    );
    writeFileSync(path, `${english}\n## My notes\n- No emoji.\n`);
    await t.core.hub.vault.reindex();
    await t.json('PUT', '/api/profile', { userName: 'Pino', language: 'fr', style: 'short' });
    const note = readFileSync(path, 'utf8');
    expect(note).toContain('# Pino’s profile');
    expect(note).toContain('- Name: Pino');
    expect(note).toContain('- Language: French\n- Style: short');
    expect(note).toContain('- No emoji.');
    expect(note).not.toMatch(/Lingua|Profilo/);
    expect(md('rhea')).toContain('- Always in French, even when');
  });
});
