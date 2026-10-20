import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fake } from '@monsters/providers/testing';
import type { LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import {
  MAX_MEMORY_CHARS,
  buildSystemPrompt,
  keepMemoryFrom,
  memoryWindow,
  newMemoryLines,
  splitRemember,
} from '../src/index.ts';
import { promptText, startTestHub, toolResultsSeen } from './hub-helpers.ts';

type Sent = { runId: string };

const HEAD = '# Memoria di Rhea\n\nIndice corto della memoria di Rhea: una riga per voce.\n';

describe('memory window (AG-05)', () => {
  it('a memory that fits is whole', () => {
    expect(memoryWindow(`${HEAD}- una voce\n`)).toEqual({
      text: `${HEAD}- una voce\n`,
      dropped: 0,
    });
  });

  it('past the limit keeps the title and the newest lines, and says what was left out', () => {
    const lines = Array.from({ length: 400 }, (_, i) => `- voce numero ${i} con un po' di testo`);
    const content = `${HEAD}${lines.join('\n')}\n`;
    expect(content.length).toBeGreaterThan(10_000);
    const w = memoryWindow(content);
    expect(w.text.length).toBeLessThanOrEqual(MAX_MEMORY_CHARS);
    expect(w.text.startsWith('# Memoria di Rhea\n\nIndice corto')).toBe(true);
    expect(w.text).toContain(lines.at(-1));
    expect(w.text).not.toContain('- voce numero 0 ');
    expect(w.text).toMatch(/\[… \d+ caratteri più vecchi non mostrati: la memoria va compattata\]/);
    expect(w.dropped).toBeGreaterThan(0);
    // Whole lines only.
    const after = w.text.split('\n')[4]!;
    expect(after).toMatch(/^- voce numero \d+ con un po' di testo$/);
  });
});

describe('«Da ricordare:» (AG-06)', () => {
  it('takes the section out of the report', () => {
    const text =
      'Ho trovato 3 fonti.\nNote create: Risorse/Ricerche/Zucca.\n\nDa ricordare:\n- Il sito del Comune pubblica gli orari aggiornati.\n- Gambero Rosso ha un paywall: meglio evitarlo.';
    expect(splitRemember(text)).toEqual({
      report: 'Ho trovato 3 fonti.\nNote create: Risorse/Ricerche/Zucca.',
      remember: [
        'Il sito del Comune pubblica gli orari aggiornati.',
        'Gambero Rosso ha un paywall: meglio evitarlo.',
      ],
    });
  });

  it('with Markdown, guillemets or the item on the same line; "niente" saves nothing', () => {
    expect(
      splitRemember('Fatto.\n\n**Da ricordare:**\n1. Giulio vuole frasi brevi').remember,
    ).toEqual(['Giulio vuole frasi brevi']);
    expect(splitRemember('Fatto.\n«Da ricordare:» niente emoji nei post').remember).toEqual([
      'niente emoji nei post',
    ]);
    expect(splitRemember('Fatto.\n## Da ricordare\n- una').remember).toEqual(['una']);
    expect(splitRemember('Fatto.\n\nDa ricordare: niente.')).toEqual({
      report: 'Fatto.',
      remember: [],
    });
    // A sentence that only mentions it is not the section.
    const plain = 'È da ricordare che il menu cambia a novembre.';
    expect(splitRemember(plain)).toEqual({ report: plain, remember: [] });
  });

  it('what follows the section after a blank line stays in the report', () => {
    expect(splitRemember('Fatto.\nDa ricordare:\n- una cosa\n\nDa decidere: il titolo.')).toEqual({
      report: 'Fatto.\n\nDa decidere: il titolo.',
      remember: ['una cosa'],
    });
  });

  it('skips lines already in the memory (case, accents, punctuation) and repeated ones, at most 5', () => {
    const memory = `${HEAD}- Giulio preferisce i post brevi.\n`;
    expect(
      newMemoryLines(memory, [
        'giulio preferisce i post BREVI',
        'Il Comune è affidabile',
        'il comune e affidabile!',
        'a',
        'b',
        'c',
        'd',
        'e',
      ]),
    ).toEqual(['Il Comune è affidabile', 'a', 'b', 'c', 'd']);
  });

  it('keepMemoryFrom saves for a finished turn only, and cleans text and finalText', async () => {
    const saved: string[][] = [];
    const save = (lines: string[]) => Promise.resolve(saved.push(lines));
    const done = await keepMemoryFrom(
      {
        status: 'completed',
        text: 'Ok.\nDa ricordare:\n- x',
        finalText: 'Ok.\nDa ricordare:\n- x',
      },
      save,
    );
    expect(done).toMatchObject({ text: 'Ok.', finalText: 'Ok.' });
    await keepMemoryFrom({ status: 'failed', text: 'A metà.\nDa ricordare:\n- y' }, save);
    expect(saved).toEqual([['x']]);
  });
});

describe('memory kept by the runtime (hub)', () => {
  it('a sub-agent’s «Da ricordare:» goes to its MEMORY.md, not to the orchestrator; the brief has the user’s words', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('delegate', { agent: 'Rhea', goal: 'Orari del mercato di Campagna Amica' }),
        fake.toolCall('delegate', { agent: 'Rhea', goal: 'Orari del mercato, di nuovo' }),
        fake.text('Il mercato è aperto il sabato.'),
      ],
      rhea: [
        fake.text(
          'Aperto il sabato 8-13.\n\nDa ricordare:\n- Il sito di Campagna Amica ha gli orari aggiornati.\n- Le pagine Facebook dei mercati sono vecchie.',
        ),
        // The same lesson again: nothing new to save.
        fake.text(
          'Confermo: sabato.\n\nDa ricordare:\n- il sito di Campagna Amica ha gli orari aggiornati',
        ),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', {
      text: 'Quando apre il mercato contadino? Solo fonti ufficiali',
    });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');

    const memory = readFileSync(join(t.core.hub.vault.root, 'Agenti/Rhea/MEMORY.md'), 'utf8');
    expect(memory).toContain('- Il sito di Campagna Amica ha gli orari aggiornati.\n');
    expect(memory).toContain('- Le pagine Facebook dei mercati sono vecchie.\n');
    expect(memory.match(/Campagna Amica/g)).toHaveLength(1);

    const log = t.events(sent.runId);
    const remembered = log.filter(
      (e): e is LogEvent<'memory'> => e.type === 'memory' && e.data.action === 'remembered',
    );
    expect(remembered).toHaveLength(1);
    expect(remembered[0]).toMatchObject({ agent: 'rhea', data: { path: 'Agenti/Rhea/MEMORY.md' } });

    // The orchestrator gets the report without the memory section.
    const seen = toolResultsSeen(t.provider.callsTo('titan')[1]!.options.prompt);
    expect(seen).toContain('Aperto il sabato 8-13.');
    expect(seen).not.toContain('Da ricordare');
    // Rhea made no step for her memory: one model call per delegation.
    expect(t.provider.callsTo('rhea')).toHaveLength(2);

    // AG-11: the brief carries the user's words and a "done when"; the event says what was filled.
    const brief = promptText(t.provider.callsTo('rhea')[0]!.options.prompt);
    expect(brief).toContain(
      'Richiesta di Giulio: «Quando apre il mercato contadino? Solo fonti ufficiali»',
    );
    expect(brief).toContain('Finito quando: il risultato è salvato in Risorse/Ricerche/');
    const started = log.find(
      (e): e is LogEvent<'delegation'> => e.type === 'delegation' && e.data.status === 'started',
    );
    expect(started?.data.filled).toEqual([]);

    // The next run of Rhea sees the new lines in her memory.
    expect(await t.core.hub.team.memory('rhea')).toContain('Campagna Amica');
  });

  it('the orchestrator’s «Da ricordare:» stays in the chat and goes to its memory', async () => {
    const t = await startTestHub({
      titan: [
        fake.text('Va bene, niente emoji.\n\nDa ricordare: Giulio non vuole emoji nei post.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', {
      text: 'Niente emoji nei post, mai',
    });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const memory = readFileSync(join(t.core.hub.vault.root, 'Agenti/Titan/MEMORY.md'), 'utf8');
    expect(memory).toContain('- Giulio non vuole emoji nei post.');
    const answer = t
      .events(sent.runId)
      .find(
        (e): e is LogEvent<'message'> =>
          e.type === 'message' && e.agent === 'titan' && !e.data.partial,
      );
    expect(answer?.data.text).toContain('Da ricordare:');
  });

  it('a long MEMORY.md shows its newest lines in the prompt, with one over_limit event', async () => {
    const t = await startTestHub({ rhea: [fake.text('Ciao.'), fake.text('Ancora ciao.')] });
    await t.core.hub.team.memory('rhea');
    const path = join(t.core.hub.vault.root, 'Agenti/Rhea/MEMORY.md');
    const old = readFileSync(path, 'utf8');
    const lines = Array.from({ length: 300 }, (_, i) => `- lezione ${i}: qualcosa da non scordare`);
    writeFileSync(path, `${old}${lines.join('\n')}\n- ULTIMA RIGA\n`);
    await t.core.hub.vault.reindex();

    for (const text of ['@Rhea ciao', '@Rhea ancora']) {
      const sent = await t.json<Sent>('POST', '/api/messages', { text });
      await t.runEnded(sent.runId);
    }
    const prompt = promptText(t.provider.callsTo('rhea')[0]!.options.prompt);
    expect(prompt).toContain('ULTIMA RIGA');
    expect(prompt).not.toContain('lezione 0:');
    const over = t.events().filter((e) => e.type === 'memory' && e.data.action === 'over_limit');
    expect(over).toHaveLength(1);
    expect(over[0]).toMatchObject({ agent: 'rhea', data: { path: 'Agenti/Rhea/MEMORY.md' } });
    // The same windowed text reaches buildSystemPrompt unchanged.
    const def = t.core.hub.team.get('rhea')!;
    const system = buildSystemPrompt({
      agent: def,
      memory: await t.core.hub.team.memory('rhea'),
      toolNames: [],
    });
    expect(system).toContain('ULTIMA RIGA');
  });
});
