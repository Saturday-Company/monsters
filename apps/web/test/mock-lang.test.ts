import { setAppLang, type AgentSummary, type LogEvent } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { MockCore } from '../src/lib/mock/core.ts';
import { mockFiles } from '../src/lib/mock/files-data.ts';
import { ambientJobs } from '../src/lib/mock/ambient.ts';
import { setMockLang } from '../src/lib/mock/lang.ts';
import { mockLayout, mockVaultDir, notePath, noteTitle } from '../src/lib/mock/paths.ts';
import { MockVault } from '../src/lib/mock/vault.ts';

// The mock is bilingual (D-153): the Italian content is what the e2e suite asserts on, the English
// one tells the same story.

afterEach(() => {
  setAppLang('en');
  setMockLang('en');
});

const demo = (lang: 'en' | 'it') => {
  setAppLang(lang);
  return new MockCore({ mode: 'demo', storage: null });
};

const call = (core: MockCore, method: string, path: string, body?: unknown) =>
  core.handle(method, path, body);

/** Every text a person can read in the demo's log (messages, goals, summaries, notices). */
function texts(events: readonly LogEvent[]): string[] {
  const out: string[] = [];
  const walk = (v: unknown, key: string) => {
    if (typeof v === 'string') {
      if (
        /^(text|goal|summary|message|why|doneWhen|question|reason|caption|label|description|error)$/.test(
          key,
        )
      )
        out.push(v);
    } else if (Array.isArray(v)) v.forEach((x) => walk(x, key));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, k);
  };
  for (const e of events) walk(e.data, '');
  return out;
}

// Words that only Italian uses (the English story must not have them).
const ITALIAN =
  /\b(il|lo|la|gli|della|delle|degli|che|per|non|sono|ho|ti|mi|una|uno|con|dei|nel|nella|ecco|fatto|poi|anche)\b|[àèìòù]/i;

describe('the mock in two languages', () => {
  it('keeps the Italian story as it was', () => {
    const core = demo('it');
    const team = call(core, 'GET', '/api/agents').body as AgentSummary[];
    expect(team.find((a) => a.id === 'titan')!.role).toBe('Coordina la squadra');
    const all = texts(core.events);
    expect(all).toContain('Dione, mi scrivi una bio breve per Instagram?');
    expect(all).toContain('Rhea ha trovato 5 spunti su Lisbona. Che tono diamo ai post?');
    const projects = call(core, 'GET', '/api/projects').body as { name: string }[];
    expect(projects.map((p) => p.name)).toEqual(['Social di Saturday', 'Sito di Saturday']);
  });

  it('tells the same story in English', () => {
    const core = demo('en');
    const team = call(core, 'GET', '/api/agents').body as AgentSummary[];
    expect(team.find((a) => a.id === 'titan')!.role).toBe('Coordinates the squad');
    const all = texts(core.events);
    expect(all).toContain('Dione, can you write me a short bio for Instagram?');
    expect(all).toContain('Rhea found 5 tips on Lisbon. What tone should we give the posts?');
    const projects = call(core, 'GET', '/api/projects').body as { name: string }[];
    expect(projects.map((p) => p.name)).toEqual(['Saturday Social', 'Saturday website']);
    // Ids are the same in both languages.
    const ids = call(core, 'GET', '/api/projects').body as { id: string }[];
    expect(ids.map((p) => p.id)).toEqual(['social-di-saturday', 'sito-di-saturday']);
  });

  it('has no Italian in the English log', () => {
    const core = demo('en');
    const found = texts(core.events).filter((t) => ITALIAN.test(t.replace(/\[\[[^\]]*\]\]/g, '')));
    expect(found).toEqual([]);
  });

  it('writes the answers of the scripted scenes in the language in use', () => {
    const core = demo('en');
    // The demo's main bot is connected: take it out to see the answer of a bot without a token.
    call(core, 'DELETE', '/api/telegram/token');
    expect(call(core, 'POST', '/api/telegram/pairing').body).toMatchObject({
      message: 'Connect the bot with its code first.',
    });
    call(core, 'PUT', '/api/settings/language', { language: 'it' });
    expect(call(core, 'POST', '/api/telegram/pairing').body).toMatchObject({
      message: 'Collega prima il bot con il suo codice.',
    });
    // What was seeded stays in the language the mock started with (until the page reloads).
    expect(texts(core.events)).toContain('Dione, can you write me a short bio for Instagram?');
  });

  it('answers a message with the first line in the mock language', async () => {
    setAppLang('en');
    const core = new MockCore({ mode: 'demo', storage: null, speed: 0.05 });
    const runId = (
      call(core, 'POST', '/api/messages', { text: 'I want to publish a post' }).body as {
        runId: string;
      }
    ).runId;
    await new Promise((r) => setTimeout(r, 1500));
    const asked = core.events.filter((e) => e.runId === runId && e.type === 'question');
    expect(asked.length).toBeGreaterThan(0);
    expect(texts(asked)[0]).toMatch(/^Dione wants to publish the post/);
  });
});

describe('the demo vault in two languages', () => {
  for (const lang of ['en', 'it'] as const) {
    it(`links only to notes that exist (${lang})`, () => {
      setAppLang(lang);
      setMockLang(lang);
      const vault = new MockVault({ mode: 'demo', log: (e) => e as unknown as LogEvent });
      const get = (path: string) =>
        vault.handle('GET', '/api/vault/note', new URLSearchParams({ path }), undefined)!;
      const paths = (vault.overview().notes ?? []).map((n) => n.path);
      expect(paths).toContain(notePath('lisbonTips'));
      const missing: string[] = [];
      for (const path of paths) {
        const note = get(path).body as { content: string };
        for (const m of note.content.matchAll(/\[\[([^\]|#\n]+)/g)) {
          const target = m[1]!.trim();
          if (get(target).status !== 200) missing.push(`${path} -> ${target}`);
        }
      }
      // The one dangling link of the quick idea is on purpose.
      expect(missing).toEqual([
        `${notePath('quickIdea')} -> ${lang === 'en' ? 'Note to write' : 'Nota da scrivere'}`,
      ]);
    });
  }

  it('names the notes in English', () => {
    setMockLang('en');
    expect(noteTitle('lisbonTips')).toBe('Lisbon, weekend tips');
    expect(notePath('personalDiary')).toBe('Private/Personal diary.md');
    expect(notePath('rheaMemory')).toBe('Agents/Rhea/MEMORY.md');
    expect(mockLayout().id).toBe('en');
    expect(mockVaultDir()).toBe('/home/demo/Monsters Notes');
    setMockLang('it');
    expect(notePath('personalDiary')).toBe('Privato/Diario personale.md');
    expect(notePath('rheaMemory')).toBe('Agenti/Rhea/MEMORY.md');
    expect(mockLayout().id).toBe('it');
    expect(mockVaultDir()).toBe('/home/demo/Monsters Note');
    expect(noteTitle('lisbonTips')).toBe('Lisbona, spunti per il weekend');
  });
});

describe('the files and the ambient life in two languages', () => {
  it('has the sample page in the language of the mock', () => {
    const page = (lang: 'en' | 'it') => {
      const f = mockFiles(lang).find((x) => x.meta.id === 'f-pagina-menu')!;
      return { name: f.meta.name, text: f.body.kind === 'text' ? f.body.text : '' };
    };
    expect(page('it').name).toBe('Menu della settimana.html');
    expect(page('it').text).toContain('<html lang="it">');
    expect(page('en').name).toBe('Weekly menu.html');
    expect(page('en').text).toContain('<html lang="en">');
    expect(page('en').text).toContain('Pumpkin and chestnut soup');
    expect(page('en').text).not.toMatch(/Zuppa|Mi piace|voti/);
    // The ids and the shape are the same.
    expect(mockFiles('en').map((f) => f.meta.id)).toEqual(mockFiles('it').map((f) => f.meta.id));
  });

  it('has jobs for the same monsters in both', () => {
    setMockLang('it');
    const it_ = ambientJobs().map((j) => j.agent);
    setMockLang('en');
    expect(ambientJobs().map((j) => j.agent)).toEqual(it_);
    expect(ambientJobs()[0]!.goal).toBe('Find three typical restaurants in Lisbon');
  });
});
