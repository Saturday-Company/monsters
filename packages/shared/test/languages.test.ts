import { afterEach, describe, expect, it } from 'vitest';
import {
  AgentDutySchema,
  agentAreaProblem,
  CLAUDE_PLAN_MODELS,
  checkOnboardingAnswer,
  draftTaint,
  EFFORT_WORD,
  formatEur,
  INSTINCT_ENGINE_TEXTS,
  INSTINCT_USE_INFO,
  INSTINCT_USES,
  instinctDescription,
  instinctTitle,
  LANGS,
  MCP_CATALOG,
  MCP_CATEGORY_LABEL,
  McpCatalogEntrySchema,
  ONBOARDING_QUESTIONS,
  onboardingQuestionsIn,
  defaultWritingLanguage,
  originalRequest,
  PROJECT_TABS,
  projectPagePath,
  RESUME_EXTRA_CHARS,
  resumeText,
  SETTINGS_SECTIONS,
  SETTINGS_TABS,
  setAppLang,
  settingsLabel,
  settingsPath,
  SPEND_PERIOD_WORDS,
  spendCapPath,
  spendSentence,
  STDIO_LAUNCHERS,
  TeamNameSchema,
  telegramTokenShapeMessage,
  type DraftView,
} from '../src/index.ts';
import { nodeMissing, npmMissing } from '../src/node/index.ts';
import { catalogStringsOf } from '../src/mcp-catalog.strings.ts';
import { onboardingStrings } from '../src/onboarding.strings.ts';
import { pick } from '../src/i18n.ts';

/* The texts of the shared package follow the app's language (D-153): English first, Italian kept. */

afterEach(() => setAppLang('en'));

describe('the places of the app', () => {
  it('are named in the language in use, with the same ids', () => {
    expect(settingsLabel()).toBe('Settings');
    expect(settingsPath('altriProgrammi')).toBe('Settings → Connections → Other apps');
    expect(settingsPath('abbonamenti')).toBe('Settings → Models → A subscription you already have');
    expect(settingsPath('ilWeb')).toBe('Settings → Permissions → The web');
    expect(SETTINGS_TABS.squadra).toBe('Squad');
    expect(SETTINGS_SECTIONS.tettoDiSpesa.label).toBe('Spending cap');
    expect(PROJECT_TABS.spesa).toBe('Spending');
    expect(projectPagePath('Saturday', 'spesa')).toBe('“Saturday” project page, Spending tab');
    expect(spendCapPath(true)).toBe('Spending tab of the project page');
    expect(spendCapPath()).toBe('Settings → Models → Spending cap');

    setAppLang('it');
    expect(settingsLabel()).toBe('Impostazioni');
    expect(settingsPath('altriProgrammi')).toBe('Impostazioni → Collegamenti → Altri programmi');
    expect(SETTINGS_TABS.squadra).toBe('Squadra');
    expect(projectPagePath('Saturday', 'spesa')).toBe(
      'pagina del progetto «Saturday», scheda Spesa',
    );
    expect(spendCapPath(true)).toBe('scheda Spesa della pagina del progetto');
    expect(spendCapPath()).toBe('Impostazioni → Modelli → Tetto di spesa');
  });

  it('keeps every id a route: the tabs and sections list the same ids in both languages', () => {
    const ids = (lang: 'en' | 'it') => {
      setAppLang(lang);
      return [
        Object.keys(SETTINGS_TABS),
        Object.keys(SETTINGS_SECTIONS),
        Object.keys(PROJECT_TABS),
      ];
    };
    expect(ids('it')).toEqual(ids('en'));
  });
});

describe('the instinct', () => {
  it('has a title, three engines and twelve uses in both languages', () => {
    expect(instinctTitle()).toBe('Monsters’ decisions');
    expect(instinctDescription()).toMatch(/^The quick calls the squad makes/);
    expect(INSTINCT_ENGINE_TEXTS.rules.label).toBe('Rules only');
    expect(INSTINCT_USE_INFO.gate.label).toBe('Asks you only when needed');
    for (const id of INSTINCT_USES) {
      const info = INSTINCT_USE_INFO[id];
      expect(info.label.length, id).toBeGreaterThan(5);
      expect(info.description.length, id).toBeGreaterThan(10);
      expect(info.sends.length, id).toBeGreaterThan(5);
    }

    setAppLang('it');
    expect(instinctTitle()).toBe('Decisioni dei mostri');
    expect(INSTINCT_ENGINE_TEXTS.rules.label).toBe('Solo regole');
    expect(INSTINCT_USE_INFO.gate.label).toBe('Ti chiede solo quando serve');
    expect(INSTINCT_USE_INFO.scorecard.modes).toEqual(['off', 'on']);
  });

  it('a copy made with the descriptors keeps following the language', () => {
    const spec = Object.defineProperties(
      { timeoutMs: 5 },
      Object.getOwnPropertyDescriptors(INSTINCT_USE_INFO.stuck),
    ) as (typeof INSTINCT_USE_INFO)['stuck'] & { timeoutMs: number };
    expect(spec.label).toBe('Stops monsters going in circles');
    setAppLang('it');
    expect(spec.label).toBe('Ferma chi gira a vuoto');
    expect(spec.timeoutMs).toBe(5);
  });
});

describe('the onboarding questions', () => {
  it('keep their ids and options in both languages; only the texts change', () => {
    const shape = () =>
      JSON.parse(
        JSON.stringify(ONBOARDING_QUESTIONS, function (this: { id?: string }, k, v: unknown) {
          if (['title', 'hint', 'freeText', 'reply', 'label', 'placeholder'].includes(k)) return '';
          // The writing language's default follows the app's language (next test).
          return k === 'defaults' && this.id === 'lingua' ? [] : v;
        }),
      ) as unknown;
    const en = shape();
    setAppLang('it');
    expect(shape()).toEqual(en);
  });

  const lingua = () =>
    ONBOARDING_QUESTIONS.find((q) => q.id === 'tono')!.groups.find((g) => g.id === 'lingua')!;

  it('start the writing language on the app’s language', () => {
    expect(lingua().defaults).toEqual(['en']);
    expect(onboardingQuestionsIn('it').find((q) => q.id === 'tono')!.groups[1]!.defaults).toEqual([
      'it',
    ]);
    setAppLang('it');
    expect(lingua().defaults).toEqual(['it']);
    expect(
      checkOnboardingAnswer(
        ONBOARDING_QUESTIONS.find((q) => q.id === 'tono')!,
        {
          values: { tono: ['amichevole'], lingua: lingua().defaults },
        },
      ),
    ).toEqual([]);
  });

  it('pick the browser’s language only when the app has no words for it', () => {
    const ids = lingua().options.map((o) => o.id);
    expect(defaultWritingLanguage(ids, 'en', 'en-US')).toBe('en');
    expect(defaultWritingLanguage(ids, 'it', 'it-IT')).toBe('it');
    // The user chose the app's language on the first screen: it wins over the browser's.
    expect(defaultWritingLanguage(ids, 'en', 'it-IT')).toBe('en');
    expect(defaultWritingLanguage(ids, 'it', 'en-GB')).toBe('it');
    // Spanish, French, German: the app is in English only because it has no such words.
    expect(defaultWritingLanguage(ids, 'en', 'es-ES')).toBe('es');
    expect(defaultWritingLanguage(ids, 'en', 'de')).toBe('de');
    expect(defaultWritingLanguage(ids, 'it', 'fr-FR')).toBe('it');
    expect(defaultWritingLanguage(ids, 'en', 'ja-JP')).toBe('en');
    expect(defaultWritingLanguage(ids, 'en', '')).toBe('en');
    expect(defaultWritingLanguage(['de'], 'en')).toBeUndefined();
  });

  it('say the first question in the language in use', () => {
    const nomi = () => ONBOARDING_QUESTIONS.find((q) => q.id === 'nomi')!;
    expect(nomi().title).toBe(
      'Nice to meet you! What’s your name? And what should we call your lead?',
    );
    expect(nomi().groups[0]!.label).toBe('Your name');
    expect(nomi().reply).toContain('{orchestrator}');
    const tono = ONBOARDING_QUESTIONS.find((q) => q.id === 'tono')!;
    expect(tono.groups[0]!.options.map((o) => o.label)).toEqual([
      'Friendly',
      'Direct',
      'Formal',
      'Playful',
    ]);
    // The languages and the products are named as they are in every language.
    expect(tono.groups[1]!.options.map((o) => o.label)).toContain('Italiano');

    setAppLang('it');
    expect(nomi().title).toBe('Piacere! Come ti chiami? E come chiamiamo il tuo capo?');
    expect(tono.groups[0]!.options[0]!.label).toBe('Amichevole');
    expect(tono.groups[0]!.label).toBe('Tono');
  });

  it('every question has its words in both languages, and answers are checked by id', () => {
    for (const lang of LANGS) {
      const t = pick({ en: onboardingStrings(), it: onboardingStrings() }, lang);
      expect(t).toBeDefined();
    }
    for (const lang of LANGS) {
      setAppLang(lang);
      for (const q of ONBOARDING_QUESTIONS) {
        expect(q.title.length, q.id).toBeGreaterThan(3);
        expect(q.reply.length, q.id).toBeGreaterThan(3);
        for (const g of q.groups) for (const o of g.options) expect(o.label, o.id).not.toBe('');
      }
    }
    const lavoro = ONBOARDING_QUESTIONS.find((q) => q.id === 'lavoro')!;
    expect(checkOnboardingAnswer(lavoro, { values: { cosa: ['social'] } })).toEqual([]);
    expect(checkOnboardingAnswer(lavoro, { values: { cosa: ['nope'] } })).toEqual([
      'lavoro.cosa: unknown option',
    ]);
  });
});

describe('money and spending', () => {
  it('writes money for the language', () => {
    expect(formatEur(10)).toBe('€10');
    expect(formatEur(0.43)).toBe('€0.43');
    expect(formatEur(12500)).toBe('€12,500');
    setAppLang('it');
    expect(formatEur(10)).toBe('10 €');
    expect(formatEur(0.43)).toBe('0,43 €');
    expect(formatEur(12500)).toBe('12.500 €');
  });

  it('says the cap events in both languages', () => {
    const d = { scopeName: null, period: 'day', spentEur: 8, capEur: 10 } as const;
    expect(SPEND_PERIOD_WORDS.day).toBe('for today');
    expect(spendSentence({ ...d, action: 'warning' })).toBe(
      'Spent €8: that’s 80% of the squad’s cap for today (€10).',
    );
    expect(spendSentence({ ...d, action: 'stopped', scopeName: 'Rhea', period: 'month' })).toBe(
      'Reached Rhea’s cap for this month (€10): jobs with paid models stop until you raise the cap.',
    );
    setAppLang('it');
    expect(SPEND_PERIOD_WORDS.day).toBe('di oggi');
    expect(spendSentence({ ...d, action: 'warning' })).toBe(
      'Spesi 8 €: è l’80% del tetto della squadra di oggi (10 €).',
    );
    expect(spendSentence({ ...d, action: 'stopped', scopeName: 'Rhea', period: 'month' })).toBe(
      'Raggiunto il tetto di Rhea di questo mese (10 €): i lavori con modelli a pagamento si fermano finché non alzi il tetto.',
    );
  });
});

describe('a stopped request that starts again', () => {
  it('is worded in the language in use and read back in either', () => {
    const en = resumeText('Write me a long poem');
    expect(en).toBe('Resume the work I stopped: “Write me a long poem”');
    setAppLang('it');
    const it = resumeText('Scrivimi una poesia lunga');
    expect(it).toBe('Riprendi il lavoro che avevo fermato: «Scrivimi una poesia lunga»');
    // The log keeps what was written, whatever the language is now.
    expect(originalRequest(en)).toBe('Write me a long poem');
    expect(originalRequest(it)).toBe('Scrivimi una poesia lunga');
    expect(originalRequest(resumeText(en))).toBe('Write me a long poem');
    expect(originalRequest('A request that was never resumed')).toBe(
      'A request that was never resumed',
    );
    expect(RESUME_EXTRA_CHARS).toBeGreaterThanOrEqual(
      'Riprendi il lavoro che avevo fermato: «'.length + 1,
    );
  });
});

describe('what the forms say is wrong', () => {
  it('names the problem of a folder or a duty in the language in use', () => {
    expect(agentAreaProblem('')).toBe(
      'A folder is needed: the top of your notes folder won’t work.',
    );
    expect(agentAreaProblem('Agenti/x')).toBe('Agenti is a reserved folder: pick another one.');
    expect(agentAreaProblem('Notes.md')).toBe('It has to be a folder, not a note.');
    expect(AgentDutySchema.safeParse('#title').error?.issues[0]?.message).toBe(
      'It can’t start with #.',
    );
    expect(TeamNameSchema.safeParse('Rh3a').error?.issues[0]?.message).toBe(
      'Only letters, spaces, apostrophes and dashes (24 at most).',
    );
    setAppLang('it');
    expect(agentAreaProblem('')).toBe('Serve una cartella: la radice del vault non va bene.');
    expect(agentAreaProblem('Agenti/x')).toBe(
      "Agenti è una cartella riservata: scegline un'altra.",
    );
    expect(AgentDutySchema.safeParse('#titolo').error?.issues[0]?.message).toBe(
      'Non inizia con #.',
    );
  });
});

describe('small words', () => {
  it('efforts, models of the Claude plan, the Telegram token, Node', () => {
    expect(EFFORT_WORD.xhigh).toBe('Very high');
    expect(CLAUDE_PLAN_MODELS[2].description).toBe('the most capable');
    expect(telegramTokenShapeMessage()).toMatch(/^That doesn’t look like a Telegram token/);
    expect(nodeMissing()).toMatch(/^Node\.js not found: install Node\.js 20/);
    expect(npmMissing()).toMatch(/^npm not found/);
    const draft = { kind: 'docs', docs: { tainted: true } } as unknown as DraftView;
    expect(draftTaint(draft)).toBe('third-party text');
    setAppLang('it');
    expect(EFFORT_WORD.xhigh).toBe('Molto alto');
    expect(CLAUDE_PLAN_MODELS[2].description).toBe('il più capace');
    expect(telegramTokenShapeMessage()).toMatch(/^Questo non sembra un token di Telegram/);
    expect(nodeMissing()).toMatch(/^Node\.js non trovato/);
    expect(draftTaint(draft)).toBe('testo di terzi');
  });
});

describe('the gallery of apps', () => {
  it('has the words of the language in use', () => {
    const entry = (id: string) => MCP_CATALOG.find((e) => e.id === id)!;
    expect(MCP_CATEGORY_LABEL.lavoro).toBe('Work and projects');
    expect(entry('anteiku').description).toBe('Clients, projects, tasks, calendar and quotes');
    expect(entry('anteiku').tenantLabel).toBe('Your company');
    expect(entry('atlassian').name).toBe('Jira and Confluence');
    const token = entry('github').auth.find((a) => a.kind === 'token')!;
    expect(token.kind === 'token' && token.label).toBe('Personal token');
    expect(entry('claude-design').soon).toBe(
      'It connects only through Claude: you need your Claude subscription connected in Settings → Models.',
    );
    expect(entry('slack').soon).toMatch(/^It only accepts apps approved one by one/);
    expect(STDIO_LAUNCHERS['npx']!.url).toBe('https://nodejs.org/en/download');

    setAppLang('it');
    expect(MCP_CATEGORY_LABEL.lavoro).toBe('Lavoro e progetti');
    expect(entry('anteiku').description).toBe('Clienti, progetti, task, agenda e preventivi');
    expect(entry('atlassian').name).toBe('Jira e Confluence');
    expect(token.kind === 'token' && token.label).toBe('Token personale');
    expect(entry('claude-design').soon).toBe(
      'Si collega solo tramite Claude: serve l’abbonamento Claude collegato in Impostazioni → Modelli.',
    );
    expect(STDIO_LAUNCHERS['npx']!.url).toBe('https://nodejs.org/it/download');
  });

  it('has every entry’s words in both languages, with the same optional parts', () => {
    const en = catalogStringsOf('en');
    const it = catalogStringsOf('it');
    expect(Object.keys(it.entries).sort()).toEqual(Object.keys(en.entries).sort());
    for (const e of MCP_CATALOG) {
      const a = en.entries[e.id]!;
      const b = it.entries[e.id]!;
      for (const key of ['name', 'tenantLabel', 'tenantHint', 'note', 'soon'] as const) {
        expect(a[key] === undefined, `${e.id}.${key}`).toBe(b[key] === undefined);
      }
      expect(a.token === undefined, `${e.id}.token`).toBe(b.token === undefined);
      expect(a.token?.hint === undefined, `${e.id}.token.hint`).toBe(b.token?.hint === undefined);
    }
    // The schema (lengths, the company field) holds with the words of each language.
    for (const lang of LANGS) {
      setAppLang(lang);
      for (const e of MCP_CATALOG) {
        const plain = JSON.parse(JSON.stringify(e)) as unknown;
        expect(McpCatalogEntrySchema.safeParse(plain).success, `${lang} ${e.id}`).toBe(true);
      }
    }
  });
});
