import { fake } from '@monsters/providers/testing';
import type { LogEvent } from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { MAX_SUMMARY_CHARS, truncateSummary } from '../src/index.ts';
import { startTestHub } from './hub-helpers.ts';

/* Delegations after D-064: the report is the last message (AG-10), an agent
 * stopped without a word is a failure (AG-03), the same delegation is not run
 * twice (AG-16). */

type Sent = { runId: string };

const reports = (events: LogEvent[]) =>
  events
    .filter(
      (e): e is LogEvent<'tool_result'> => e.type === 'tool_result' && e.data.tool === 'delegate',
    )
    .map((e) => e.data.output as Record<string, unknown>);

describe('delegations (D-064)', () => {
  it('the summary is the last message of the agent, not the announcements before its tools', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('delegate', { agent: 'Rhea', goal: 'Cerca le lune di Saturno' }),
        fake.text('Ecco le lune.'),
      ],
      rhea: [
        fake.toolCall('web_search', { query: 'lune di Saturno' }, { text: 'Ora cerco le fonti…' }),
        fake.text('Rapporto: Titano, Rea e Giapeto, fonti nella nota.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Le lune di Saturno?' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const [report] = reports(t.events(sent.runId));
    expect(report).toMatchObject({
      status: 'completed',
      summary: 'Rapporto: Titano, Rea e Giapeto, fonti nella nota.',
    });
    // The chat still shows every useful part of Rhea's turn (D-038).
    const final = t
      .events(sent.runId)
      .findLast(
        (e): e is LogEvent<'message'> =>
          e.type === 'message' && e.agent === 'rhea' && !e.data.partial && e.data.role === 'agent',
      );
    expect(final?.data.text).toContain('Ora cerco le fonti');
  });

  it('summaries are cut at 3000 characters', () => {
    expect(MAX_SUMMARY_CHARS).toBe(3000);
    const long = `${'Una frase del rapporto. '.repeat(200)}`;
    const cut = truncateSummary(long);
    expect(cut.truncated).toBe(true);
    expect(cut.text.length).toBeLessThan(3100);
  });

  it('an agent stopped at its limit without a word is a failed delegation, with what it touched', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('delegate', { agent: 'Rhea', goal: 'Cerca tutto sulle lune' }),
        fake.text('Rhea non ha concluso.'),
      ],
      // Even at the last step (no tools) this model calls one: no text at all.
      rhea: () => fake.toolCall('web_search', { query: 'lune' }),
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Tutto sulle lune' });
    await t.runEnded(sent.runId);
    const [report] = reports(t.events(sent.runId));
    expect(report).toMatchObject({
      agent: 'Rhea',
      status: 'failed',
      error: expect.stringContaining('without a report') as unknown,
      notes_check: expect.any(String) as unknown,
      next: expect.stringContaining('there is no result') as unknown,
    });
    expect(report).not.toHaveProperty('summary');
    const end = t
      .events(sent.runId)
      .find(
        (e): e is LogEvent<'delegation'> => e.type === 'delegation' && e.data.status !== 'started',
      );
    expect(end?.data.status).toBe('failed');
  });

  it('the same goal to the same agent, already completed in the run, returns the earlier report', async () => {
    const goal = 'Cerca le lune di Saturno';
    const t = await startTestHub({
      titan: [
        fake.toolCall('delegate', { agent: 'Rhea', goal }),
        fake.toolCall('delegate', { agent: 'rhea', goal: `${goal.toUpperCase()}!` }),
        fake.text('Ecco le lune.'),
      ],
      rhea: [fake.text('Rapporto: Titano e Rea.')],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Le lune?' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const [first, second] = reports(t.events(sent.runId));
    expect(first).toMatchObject({ status: 'completed', summary: 'Rapporto: Titano e Rea.' });
    expect(second).toMatchObject({
      status: 'completed',
      summary: 'Rapporto: Titano e Rea.',
      repeated: true,
    });
    expect(t.provider.callsTo('rhea')).toHaveLength(1);
    expect(
      t.events(sent.runId).filter((e) => e.type === 'delegation' && e.data.status === 'started'),
    ).toHaveLength(1);
  });
});
