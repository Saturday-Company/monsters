import { setAppLang } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { permissionsSummary } from '../src/components/settings/AgentPermissionsSettings.tsx';
import { dataStrings } from '../src/components/settings/data.strings.ts';
import { serviceLabel, teamError, nameProblem } from '../src/components/settings/data.ts';
import { mcpStrings } from '../src/components/settings/mcp.strings.ts';
import { modelsStrings } from '../src/components/settings/models.strings.ts';
import { parsePairs } from '../src/components/settings/McpServersSection.tsx';
import { noCapNote } from '../src/components/settings/SpendSection.tsx';
import { paidSearchText } from '../src/components/settings/PaidSearchSection.tsx';
import { spendStrings } from '../src/components/settings/spend.strings.ts';
import { subscriptionsStrings } from '../src/components/settings/subscriptions.strings.ts';
import { teamStrings } from '../src/components/settings/team.strings.ts';
import { telegramStrings } from '../src/components/settings/telegram.strings.ts';
import { ApiError } from '../src/lib/api.ts';

/* Settings texts (D-153): plurals, agreements and the sentences built from values, in both languages. */

afterEach(() => setAppLang('en'));

describe('permissions summary', () => {
  const p = { vault: true, web: true, shell: true, folders: [{ path: '/a', write: false }] };
  it('lists what a monster may do', () => {
    expect(permissionsSummary(p)).toBe('Notes, web, commands, 1 folder');
    expect(permissionsSummary({ vault: false, web: false })).toBe('Read-only notes');
    expect(
      permissionsSummary({ ...p, folders: [p.folders[0]!, { path: '/b', write: true }] }),
    ).toContain('2 folders');
    setAppLang('it');
    expect(permissionsSummary(p)).toBe('Note, web, comandi, 1 cartella');
    expect(permissionsSummary({ vault: false, web: false })).toBe('Note in sola lettura');
    expect(
      permissionsSummary({ ...p, folders: [p.folders[0]!, { path: '/b', write: true }] }),
    ).toContain('2 cartelle');
  });
});

describe('plurals', () => {
  it('count tools, duties, jobs and requests in English', () => {
    expect(mcpStrings().parts.works(undefined, 1)).toBe('Works: 1 tool.');
    expect(mcpStrings().parts.works('Notion', 3)).toBe('Works (Notion): 3 tools.');
    expect(mcpStrings().gallery.toolsReady(1)).toBe('1 tool ready for the monsters.');
    expect(mcpStrings().servers.kind(true, 2)).toBe('Web service · 2 tools');
    expect(mcpStrings().servers.kind(false, undefined)).toBe('App on this computer');
    expect(teamStrings().members.dutiesLine(1, 'Research', true)).toBe(
      '1 thing it does · writes in Research/ · does web research',
    );
    expect(teamStrings().score.jobs(1)).toBe('1 job');
    expect(teamStrings().score.jobs(4)).toBe('4 jobs');
    expect(spendStrings().freeRequests('1', 1)).toBe('1 request to free models');
    expect(modelsStrings().picker.count(1)).toBe('1 model');
    expect(modelsStrings().picker.count(12)).toBe('12 models');
    expect(telegramStrings().bots.toApproveCount(1)).toBe('1 to approve');
    expect(telegramStrings().bots.toApproveCount(3)).toBe('3 to approve');
  });

  it('and in Italian, with the agreement', () => {
    setAppLang('it');
    expect(mcpStrings().parts.works(undefined, 1)).toBe('Funziona: 1 strumento.');
    expect(mcpStrings().parts.works('Notion', 3)).toBe('Funziona (Notion): 3 strumenti.');
    expect(mcpStrings().gallery.toolsReady(1)).toBe('1 strumento pronto per i mostri.');
    expect(mcpStrings().gallery.toolsReady(5)).toBe('5 strumenti pronti per i mostri.');
    expect(teamStrings().members.dutiesLine(1, 'Ricerca', false)).toBe(
      '1 cosa che fa · scrive in Ricerca/',
    );
    expect(teamStrings().score.finished(1)).toBe('1 finito davvero');
    expect(teamStrings().score.finished(3)).toBe('3 finiti davvero');
    expect(spendStrings().subscriptionRequests('Claude', '12', 12)).toBe('Claude: 12 richieste');
    expect(modelsStrings().picker.partial(60, 300)).toBe('60 di 300 · scrivi per cercare');
    expect(telegramStrings().bots.toApproveCount(1)).toBe('1 da approvare');
  });
});

describe('sentences with the thing that changed', () => {
  it('the tools a server paused', () => {
    const s = mcpStrings().paused;
    expect(s.summary(1, true)).toContain('has a new tool');
    expect(s.summary(1, false)).toContain('has a tool that changed');
    expect(s.summary(3, true)).toContain('has 3 new or changed tools');
    expect(s.accepted(1)).toBe('Tool accepted.');
    expect(s.accepted(2)).toBe('Tools accepted.');
    setAppLang('it');
    expect(mcpStrings().paused.summary(1, true)).toContain('ha uno strumento nuovo');
    expect(mcpStrings().paused.summary(1, false)).toContain('ha cambiato uno strumento');
    expect(mcpStrings().paused.summary(3, true)).toContain('ha 3 strumenti nuovi o cambiati');
  });

  it('a paid model blocked by the free-only switch', () => {
    expect(modelsStrings().providers.blocked.text(1)).toMatch(/^is a paid model/);
    expect(modelsStrings().providers.blocked.text(2)).toMatch(/^are paid models/);
    setAppLang('it');
    expect(modelsStrings().providers.blocked.text(1)).toMatch(/^è un modello a pagamento/);
    expect(modelsStrings().providers.blocked.text(2)).toMatch(/^sono modelli a pagamento/);
  });

  it('the name of a service, in the language of the app', () => {
    expect(serviceLabel('claude-agent')).toBe('Claude subscription');
    expect(serviceLabel('codex')).toBe('Codex (for coding)');
    expect(serviceLabel('chatgpt')).toBe('ChatGPT');
    expect(serviceLabel('other', 'Other one')).toBe('Other one');
    setAppLang('it');
    expect(serviceLabel('claude-agent')).toBe('Abbonamento Claude');
    expect(serviceLabel('codex')).toBe('Codex (per programmare)');
  });

  it('the errors of the team calls', () => {
    expect(teamError(new ApiError(409, 'busy', 'busy'))).toBe(dataStrings().errors.busy);
    expect(teamError(new ApiError(409, 'name_taken', 'That name is taken'))).toBe(
      'That name is taken',
    );
    expect(nameProblem('Rhea 2')).toBe('Letters only, up to 24.');
    setAppLang('it');
    expect(nameProblem('Rhea 2')).toBe('Solo lettere, al massimo 24.');
  });

  it('the format of a line of variables', () => {
    expect(parsePairs('API_KEY', '=')).toBe('Write one line at a time, like NAME=value.');
    expect(parsePairs('Authorization', ':')).toBe('Write one line at a time, like NAME: value.');
    setAppLang('it');
    expect(parsePairs('API_KEY', '=')).toBe('Scrivi una riga per volta nella forma NOME=valore.');
    expect(parsePairs('KEY=1', '=')).toEqual({ KEY: '1' });
  });
});

describe('the spending cap', () => {
  it('says there is no cap', () => {
    const meter = { spentEur: 0, capEur: null, ratio: null };
    expect(noCapNote(meter)).toBe('No cap.');
    setAppLang('it');
    expect(noCapNote(meter)).toBe('Senza tetto.');
  });
});

describe('paid search', () => {
  const ws = {
    mode: 'auto' as const,
    engine: 'parallel' as const,
    active: false,
    reason: 'no_key' as const,
    usdPer1000: { parallel: 1, exa: 7 },
  };
  it('says why it is off, in both languages', () => {
    expect(paidSearchText(ws)).toMatch(/^Needs an OpenRouter key with credit/);
    expect(paidSearchText({ ...ws, reason: undefined })).toMatch(/^Off: free search/);
    setAppLang('it');
    expect(paidSearchText(ws)).toMatch(/^Serve una chiave OpenRouter con credito/);
    expect(paidSearchText({ ...ws, reason: undefined })).toMatch(/^Spenta: ricerca gratuita/);
  });
});

describe('package license', () => {
  it('words the core’s `proprietary` id in the app’s language and lets SPDX ids through', () => {
    expect(subscriptionsStrings().license('proprietary')).toBe(
      'proprietary (Anthropic Commercial Terms)',
    );
    expect(subscriptionsStrings().license('Apache-2.0')).toBe('Apache-2.0');
    setAppLang('it');
    expect(subscriptionsStrings().license('proprietary')).toBe(
      'proprietaria (Anthropic Commercial Terms)',
    );
  });
});
