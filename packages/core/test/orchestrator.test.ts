import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fake } from '@monsters/providers/testing';
import type { AgentSummary, LogEvent, Question } from '@monsters/shared';
import { describe, expect, it, vi } from 'vitest';
import { optionsWithoutContent } from '../src/index.ts';
import { deferred, never, promptText, startTestHub, toolResultsSeen } from './hub-helpers.ts';

type Sent = { runId: string; agent: string; queued: boolean };

const isType =
  <T extends LogEvent['type']>(
    type: T,
    extra: (e: Extract<LogEvent, { type: T }>) => boolean = () => true,
  ) =>
  (e: LogEvent): e is Extract<LogEvent, { type: T }> =>
    e.type === type && extra(e as Extract<LogEvent, { type: T }>);

describe('orchestrator scenarios (fake provider)', () => {
  it('(a) answers a simple request alone, without delegating, and keeps the conversation', async () => {
    const t = await startTestHub({
      titan: [fake.text('Ciao Giulio! Come posso aiutarti?'), fake.text('Va bene, a dopo.')],
    });
    const first = await t.json<Sent>('POST', '/api/messages', { text: 'ciao' });
    expect(first).toMatchObject({ agent: 'titan', queued: false });
    expect((await t.runEnded(first.runId)).data.status).toBe('completed');

    const log = t.events(first.runId);
    expect(log.some((e) => e.type === 'delegation')).toBe(false);
    const answer = log.find(
      (e): e is LogEvent<'message'> =>
        e.type === 'message' && e.agent === 'titan' && !e.data.partial,
    );
    expect(answer?.data.text).toBe('Ciao Giulio! Come posso aiutarti?');
    expect(t.provider.calls.map((c) => c.model)).toEqual(['titan']);

    // The next run receives the recent conversation from the log.
    const second = await t.json<Sent>('POST', '/api/messages', { text: 'niente, grazie' });
    await t.runEnded(second.runId);
    const seen = promptText(t.provider.calls[1]!.options.prompt);
    expect(seen).toContain('ciao');
    expect(seen).toContain('Ciao Giulio! Come posso aiutarti?');
    expect(seen).toContain('niente, grazie');
    // The orchestrator's tools include the team tools and every vault tool; the
    // web is Rhea's (D-026).
    const tools = (t.provider.calls[0]!.options.tools ?? []).map((x) => x.name);
    expect(tools).toEqual(expect.arrayContaining(['delegate', 'ask_user', 'vault_undo']));
    expect(tools).not.toContain('web_search');
    expect(tools).not.toContain('web_fetch');
  });

  it('(b) delegates to Rhea and Dione in parallel; Dione reads Rhea’s note by link', async () => {
    const rheaWrote = deferred();
    const t = await startTestHub({
      titan: [
        fake.toolCalls([
          {
            name: 'delegate',
            input: {
              agent: 'Rhea',
              goal: 'Trova 3 fatti su Encelado e salvali nella nota Risorse/Ricerche/Encelado',
              why: 'servono per un post',
              output_format: 'una nota con fonti',
              done_when: 'la nota esiste con 3 fatti',
            },
          },
          {
            name: 'delegate',
            input: {
              agent: 'dione',
              goal: 'Scrivi una bozza di post su Encelado partendo dalla nota di Rhea',
              context_links: ['[[Encelado]]'],
              constraints: ['massimo 80 parole'],
            },
          },
        ]),
        fake.text('Fatto: la ricerca è in [[Encelado]] e la bozza in Inbox/Bozze.'),
      ],
      rhea: [
        fake.toolCall('web_search', { query: 'Encelado fatti' }),
        fake.toolCall('vault_write', {
          path: 'Risorse/Ricerche/Encelado',
          content:
            '# Encelado\n\nTre fatti.\n\n- Ha geyser di acqua salata.\n- Ha un oceano sotto il ghiaccio.\n- Riflette quasi tutta la luce.\n',
          frontmatter: { tags: ['ricerca/spazio'] },
        }),
        fake.text('Ho salvato 3 fatti con fonti in Risorse/Ricerche/Encelado.md.'),
      ],
      dione: [
        fake.toolCall('vault_read', { path: 'Encelado' }, { gate: rheaWrote.promise }),
        fake.toolCall('vault_write', {
          path: 'Inbox/Bozze/Post Encelado',
          content: '# Post Encelado\n\nSotto il ghiaccio di Encelado c’è un oceano.\n',
        }),
        fake.text('Bozza pronta in Inbox/Bozze/Post Encelado.md, tono divulgativo.'),
      ],
    });
    t.core.log.subscribe((e) => {
      if (e.type === 'vault_change' && e.agent === 'rhea') rheaWrote.resolve();
    });

    const sent = await t.json<Sent>('POST', '/api/messages', {
      text: 'Preparami un post su Encelado',
    });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');

    const log = t.events(sent.runId);
    const delegations = log.filter((e): e is LogEvent<'delegation'> => e.type === 'delegation');
    // Parallel: both start (in either order) before either finishes, and both briefs are focused.
    const steps = delegations.map((d) => `${d.data.to}:${d.data.status}`);
    expect(steps.slice(0, 2).sort()).toEqual(['dione:started', 'rhea:started']);
    expect(steps.slice(2).sort()).toEqual(['dione:completed', 'rhea:completed']);
    const dioneStart = delegations.find(
      (d) => d.data.to === 'dione' && d.data.status === 'started',
    );
    expect(dioneStart!.data.contextLinks).toEqual(['[[Encelado]]']);
    const dioneBrief = promptText(t.provider.callsTo('dione')[0]!.options.prompt);
    expect(dioneBrief).toContain('Note utili nel vault: [[Encelado]]');
    expect(dioneBrief).not.toContain('Riflette quasi tutta la luce');

    // Dione read Rhea's note through the link.
    const read = log.find(
      (e): e is LogEvent<'tool_result'> =>
        e.type === 'tool_result' && e.agent === 'dione' && e.data.tool === 'vault_read',
    );
    expect(read?.data.ok).toBe(true);
    expect(JSON.stringify(read?.data.output)).toContain('oceano sotto il ghiaccio');

    // Sub-agent events hang under their delegation.
    const rheaStarted = delegations.find(
      (d) => d.data.to === 'rhea' && d.data.status === 'started',
    )!;
    const rheaCalls = log.filter((e) => e.type === 'tool_call' && e.agent === 'rhea');
    expect(rheaCalls.every((e) => e.parentId === rheaStarted.id)).toBe(true);

    // The orchestrator got two short reports with the notes touched.
    const results = toolResultsSeen(t.provider.callsTo('titan')[1]!.options.prompt);
    expect(results).toContain('Ho salvato 3 fatti');
    expect(results).toContain('Risorse/Ricerche/Encelado.md');
    expect(results).toContain('Bozza pronta');
    expect(results).toContain('Inbox/Bozze/Post Encelado.md');

    const vault = t.core.hub.vault.root;
    expect(readFileSync(join(vault, 'Risorse/Ricerche/Encelado.md'), 'utf8')).toContain(
      'author: rhea',
    );
    expect(existsSync(join(vault, 'Inbox/Bozze/Post Encelado.md'))).toBe(true);

    // The memories were created in the vault on first use.
    expect(existsSync(join(vault, 'Agenti/Rhea/MEMORY.md'))).toBe(true);

    // Undo Rhea's write through the API.
    const change = log.find(
      (e): e is LogEvent<'vault_change'> => e.type === 'vault_change' && e.agent === 'rhea',
    )!;
    const undo = await t.json<{ ok: boolean; files: string[] }>('POST', '/api/vault/undo', {
      actionId: change.data.actionId,
    });
    expect(undo.ok).toBe(true);
    expect(existsSync(join(vault, 'Risorse/Ricerche/Encelado.md'))).toBe(false);
    // The undo event names the action it undid, so a client can mark it after a reload.
    const undoEvent = t
      .events()
      .find(
        (e): e is LogEvent<'vault_change'> => e.type === 'vault_change' && e.data.action === 'undo',
      );
    expect(undoEvent).toMatchObject({
      agent: 'user',
      data: { undoneActionId: change.data.actionId },
    });
    const again = await t.api('POST', '/api/vault/undo', { actionId: change.data.actionId });
    expect(again.status).toBe(400);
  });

  it('the delegate report lists the notes from the vault log, even when the agent claims one', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('delegate', { agent: 'Rhea', goal: 'Tendenze autunnali, con una nota' }),
        fake.toolCall('delegate', { agent: 'Dione', goal: 'Una bozza di post' }),
        fake.text('Fatto.'),
      ],
      // The demo: Rhea says she created a note, the vault says otherwise.
      rhea: [fake.text('Ho creato una nota "Tendenze autunnali" in Risorse/Ricerche/.')],
      dione: [
        fake.toolCall('vault_write', {
          path: 'Inbox/Bozze/Post autunno',
          content: '# Post autunno\n\nZucca e castagne.\n',
        }),
        fake.text('Bozza in Inbox/Bozze/Post autunno.md.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Un post sull’autunno' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const reports = t
      .events(sent.runId)
      .filter((e): e is LogEvent<'tool_result'> => e.type === 'tool_result' && e.agent === 'titan')
      .map((e) => e.data.output as Record<string, unknown>);
    expect(reports[0]).toMatchObject({
      agent: 'Rhea',
      status: 'completed',
      notes_created: [],
      notes_changed: [],
      notes_check: expect.stringContaining('Rhea created no note and changed none') as unknown,
    });
    // `notes` repeated created + changed: gone (D-064).
    expect(reports[0]).not.toHaveProperty('notes');
    expect(reports[1]).toMatchObject({
      agent: 'Dione',
      notes_created: ['Inbox/Bozze/Post autunno.md'],
      notes_check: expect.stringContaining('Dione created Inbox/Bozze/Post autunno.md.') as unknown,
    });
    // The orchestrator read it before answering.
    const seen = toolResultsSeen(t.provider.callsTo('titan')[1]!.options.prompt);
    expect(seen).toContain('created no note and changed none');
  });

  it('a delegated agent that answers empty is an error for the orchestrator, not an empty summary', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('delegate', { agent: 'Dione', goal: 'Scrivi 3 post sul menu autunnale' }),
        fake.text('Dione non è riuscita a scrivere i post: riprovo più tardi.'),
      ],
      dione: [fake.empty(), fake.empty()],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Tre post sul menu' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const log = t.events(sent.runId);
    const end = log.find(
      (e): e is LogEvent<'delegation'> => e.type === 'delegation' && e.data.status !== 'started',
    );
    expect(end?.data).toMatchObject({
      to: 'dione',
      status: 'failed',
      error: expect.stringMatching(/^Dione non ha dato una risposta/) as unknown,
    });
    const report = log.find(
      (e): e is LogEvent<'tool_result'> => e.type === 'tool_result' && e.data.tool === 'delegate',
    )?.data.output as Record<string, unknown>;
    expect(report).toMatchObject({ status: 'failed', error: expect.any(String) as unknown });
    expect(report).not.toHaveProperty('summary');
    expect(String(report['next'])).toMatch(/there is no result/);
    // Dione was asked twice (one retry); her run left no "completed" with an empty message.
    expect(t.provider.callsTo('dione')).toHaveLength(2);
    expect(
      log.some(
        (e) => e.type === 'message' && e.agent === 'dione' && !e.data.partial && e.data.text === '',
      ),
    ).toBe(false);
  });

  it('(c) a blocking ask_user waits for the answer from the API, then the run resumes', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('ask_user', {
          question: 'Pubblico il post su Instagram adesso?',
          options: [
            'Sì, pubblica ora',
            { label: 'No, aspetta domani', description: 'più visibilità' },
          ],
          recommended: 'No, aspetta domani',
          kind: 'publish',
        }),
        fake.text('Va bene: lo pubblico domani.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Il post è pronto?' });
    await t.waitEvent(isType('question'));

    const open = await t.json<Question[]>('GET', '/api/questions?status=open');
    expect(open).toHaveLength(1);
    const q = open[0]!;
    expect(q).toMatchObject({
      from: 'titan',
      runId: sent.runId,
      blocking: true,
      status: 'open',
      recommended: '2',
      options: [
        { id: '1', label: 'Sì, pubblica ora' },
        { id: '2', label: 'No, aspetta domani', description: 'più visibilità' },
      ],
    });
    const agents = await t.json<AgentSummary[]>('GET', '/api/agents');
    expect(agents.find((a) => a.id === 'titan')?.state).toBe('waiting');

    const wrong = await t.api('POST', `/api/questions/${q.id}/answer`, { optionId: '9' });
    expect(wrong.status).toBe(400);
    const answered = await t.json<Question>('POST', `/api/questions/${q.id}/answer`, {
      optionId: '2',
    });
    expect(answered).toMatchObject({ status: 'answered', answer: { optionId: '2' } });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const twice = await t.api('POST', `/api/questions/${q.id}/answer`, { optionId: '1' });
    expect(twice.status).toBe(409);

    expect(toolResultsSeen(t.provider.calls[1]!.options.prompt)).toContain('No, aspetta domani');
    const decisions = t
      .events(sent.runId)
      .filter((e): e is LogEvent<'decision'> => e.type === 'decision');
    expect(decisions.map((d) => [d.data.kind, d.data.decidedBy, d.data.choice])).toEqual([
      ['ask_or_proceed', 'rules', 'ask_user'],
      ['user_choice', 'user', 'No, aspetta domani'],
    ]);
    expect(t.events(sent.runId).some((e) => e.type === 'answer')).toBe(true);
  });

  it('ask_user refuses bare "Variante A / Variante B" options: they must say what they contain', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('ask_user', {
          question: 'Quale variante preferisci?',
          options: ['Variante A (Consigliata)', 'Variante B'],
          recommended: '1',
          kind: 'taste',
        }),
        fake.toolCall('ask_user', {
          question: 'Quale variante preferisci?',
          options: [
            { label: 'Variante A', description: 'Tono caldo, racconto della nonna' },
            { label: 'Variante B', description: 'Diretta, prezzi ed emoji' },
          ],
          recommended: '1',
          kind: 'taste',
        }),
        fake.text('Ok, la A.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Scegli tu i post' });
    const question = await t.waitEvent(isType('question'));
    expect(question.data.options.map((o) => o.description)).toEqual([
      'Tono caldo, racconto della nonna',
      'Diretta, prezzi ed emoji',
    ]);
    await t.api('POST', `/api/questions/${question.data.questionId}/answer`, { optionId: '1' });
    await t.runEnded(sent.runId);
    const results = t
      .events(sent.runId)
      .filter(
        (e): e is LogEvent<'tool_result'> => e.type === 'tool_result' && e.data.tool === 'ask_user',
      );
    expect(results.map((r) => r.data.ok)).toEqual([false, true]);
    expect(results[0]!.data.output).toMatchObject({
      error: { code: 'INVALID_INPUT', hint: expect.stringContaining('content') as unknown },
    });
    expect(t.events(sent.runId).filter((e) => e.type === 'question')).toHaveLength(1);
  });

  it('ask_user asks one choice per task: a second one is refused with the first answer', async () => {
    const variants = (topic: string) => ({
      question: `Per il post ${topic}, quale variante preferisci?`,
      options: [
        { label: 'Tono amichevole', description: `${topic}: caldo, con emoji` },
        { label: 'Tono energico', description: `${topic}: breve, invito a prenotare` },
      ],
      recommended: '1',
      kind: 'taste',
    });
    const t = await startTestHub({
      titan: [
        // An open question for a fact first: it does not count.
        fake.toolCall('ask_user', { question: 'Quali piatti ci sono nel menu?' }),
        fake.toolCall('ask_user', variants('sulla ribollita')),
        fake.toolCall('ask_user', variants('sul peposo')),
        // A consequential choice still reaches the user.
        fake.toolCall('ask_user', {
          question: 'Pubblico i post adesso?',
          options: ['Sì', 'No, li rivedo io'],
          kind: 'publish',
        }),
        fake.text('Ecco i post, tutti in tono amichevole.'),
      ],
    });
    const off = t.core.log.subscribe((e) => {
      if (e.type !== 'question') return;
      setTimeout(() => {
        void t.api(
          'POST',
          `/api/questions/${e.data.questionId}/answer`,
          e.data.options.length ? { optionId: '1' } : { text: 'ribollita, peposo' },
        );
      }, 0);
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Preparami 3 post' });
    await t.runEnded(sent.runId);
    off();
    const log = t.events(sent.runId);
    expect(
      log
        .filter((e): e is LogEvent<'question'> => e.type === 'question')
        .map((q) => q.data.question),
    ).toEqual([
      'Quali piatti ci sono nel menu?',
      'Per il post sulla ribollita, quale variante preferisci?',
      'Pubblico i post adesso?',
    ]);
    const refused = log.find(
      (e): e is LogEvent<'tool_result'> =>
        e.type === 'tool_result' && e.data.tool === 'ask_user' && !e.data.ok,
    );
    expect(refused?.data.output).toMatchObject({
      error: {
        code: 'LIMIT_REACHED',
        hint: expect.stringContaining('"Tono amichevole"') as unknown,
      },
    });
  });

  it('the one-question limit counts per request: a new message in the same run gets its own', async () => {
    const choice = (topic: string) => ({
      question: `Quale variante per ${topic}?`,
      options: [
        { label: 'Calda', description: `${topic}: racconto e emoji` },
        { label: 'Diretta', description: `${topic}: breve, invito a prenotare` },
      ],
      kind: 'taste',
    });
    const release = deferred();
    const t = await startTestHub({
      titan: [
        fake.toolCall('ask_user', choice('i post di ottobre')),
        // Answered by typing a message: still the same request.
        fake.toolCall('ask_user', choice('la newsletter di ottobre')),
        fake.text('Ecco i post di ottobre.', { gate: release.promise }),
        // Next turn: the request typed meanwhile.
        fake.toolCall('ask_user', choice('i post di Natale')),
        fake.toolCall('ask_user', choice('la newsletter di Natale')),
        fake.text('Ecco i post di Natale.'),
      ],
    });
    const first = await t.json<Sent>('POST', '/api/messages', { text: 'Post di ottobre' });
    await t.waitEvent(isType('question'));
    const typed = await t.json<Sent & { answered?: string }>('POST', '/api/messages', {
      text: 'la calda',
    });
    expect(typed.answered).toBeDefined();
    // The third model call is waiting at the gate: a new request now joins the run.
    await vi.waitFor(() => expect(t.provider.callsTo('titan')).toHaveLength(3));
    const second = await t.json<Sent>('POST', '/api/messages', { text: 'Ora i post di Natale' });
    expect(second).toMatchObject({ runId: first.runId, queued: true });
    const off = t.core.log.subscribe((e) => {
      if (e.type === 'question' && e.data.question.includes('Natale')) {
        setTimeout(() => {
          void t.api('POST', `/api/questions/${e.data.questionId}/answer`, { optionId: '2' });
        }, 0);
      }
    });
    release.resolve();
    expect((await t.runEnded(first.runId)).data.status).toBe('completed');
    off();
    const log = t.events(first.runId);
    expect(
      log
        .filter((e): e is LogEvent<'question'> => e.type === 'question')
        .map((q) => q.data.question),
    ).toEqual(['Quale variante per i post di ottobre?', 'Quale variante per i post di Natale?']);
    const results = log.filter(
      (e): e is LogEvent<'tool_result'> => e.type === 'tool_result' && e.data.tool === 'ask_user',
    );
    expect(results.map((r) => r.data.ok)).toEqual([true, false, true, false]);
    expect(results[1]!.data.output).toMatchObject({
      error: { code: 'LIMIT_REACHED', hint: expect.stringContaining('"la calda"') as unknown },
    });
    expect(results[3]!.data.output).toMatchObject({
      error: { code: 'LIMIT_REACHED', hint: expect.stringContaining('"Diretta"') as unknown },
    });
  });

  it('tells generic option labels from options with content', () => {
    const opts = (...labels: (string | [string, string])[]) =>
      labels.map((l, i) =>
        typeof l === 'string'
          ? { id: String(i + 1), label: l }
          : { id: String(i + 1), label: l[0], description: l[1] },
      );
    expect(optionsWithoutContent(opts('Variante A (Consigliata)', 'Variante B'))).toBe(true);
    expect(optionsWithoutContent(opts('Opzione 1', 'Opzione 2', 'scelta C'))).toBe(true);
    expect(optionsWithoutContent(opts(['Variante A', 'Tono caldo'], 'Variante B'))).toBe(true);
    expect(
      optionsWithoutContent(opts(['Variante A', 'Tono caldo'], ['Variante B', 'Ironica'])),
    ).toBe(false);
    expect(optionsWithoutContent(opts('Variante A: tono caldo', 'Variante B: ironica'))).toBe(
      false,
    );
    expect(optionsWithoutContent(opts('Ironico', 'Serio'))).toBe(false);
    expect(optionsWithoutContent(opts('Sì, pubblica ora', 'Variante B'))).toBe(false);
    expect(optionsWithoutContent([])).toBe(false);
  });

  it('(d) kill during two parallel delegations stops everything and expires the question', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCalls([
          { name: 'delegate', input: { agent: 'Rhea', goal: 'Ricerca lunga' } },
          { name: 'delegate', input: { agent: 'Dione', goal: 'Bozza lunga' } },
          {
            name: 'ask_user',
            input: {
              question: 'Che tono preferisci?',
              options: ['Ironico', 'Serio'],
              kind: 'taste',
            },
          },
        ]),
        fake.text('Ripartito.'),
      ],
      rhea: [fake.text('mai', { gate: never })],
      dione: [fake.text('mai', { gate: never })],
    });
    const clearQueues = vi.spyOn(t.core.hub.providers, 'clearQueues');
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Lavoro lungo' });
    await t.waitEvent(isType('question'));
    await t.waitEvent(
      isType('delegation', (e) => e.data.to === 'dione' && e.data.status === 'started'),
    );
    const working = await t.json<AgentSummary[]>('GET', '/api/agents');
    expect(working.find((a) => a.id === 'rhea')).toMatchObject({
      state: 'working',
      activity: 'Ricerca lunga',
    });

    const kill = await t.json<{ report: { runsAborted: number } }>('POST', '/api/kill', {
      reason: 'prova',
    });
    expect(kill.report.runsAborted).toBe(1);
    await t.core.hub.dispatcher.idle();
    expect(clearQueues).toHaveBeenCalled();

    const log = t.events(sent.runId);
    expect(
      log.filter((e) => e.type === 'run').map((e) => (e.type === 'run' ? e.data.status : '')),
    ).toEqual(['started', 'aborted']);
    const ends = log
      .filter(
        (e): e is LogEvent<'delegation'> => e.type === 'delegation' && e.data.status !== 'started',
      )
      .map((e) => `${e.data.to}:${e.data.status}`)
      .sort();
    expect(ends).toEqual(['dione:aborted', 'rhea:aborted']);
    const questions = await t.json<Question[]>('GET', '/api/questions');
    expect(questions.map((q) => q.status)).toEqual(['expired']);
    // Clients learn it from the stream: one `question_expired` event, child of the question.
    const expired = t.events(sent.runId).filter((e) => e.type === 'question_expired');
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({
      agent: 'titan',
      data: { questionId: questions[0]!.id },
      parentId: t.events(sent.runId).find((e) => e.type === 'question')!.id,
    });
    const answer = await t.api('POST', `/api/questions/${questions[0]!.id}/answer`, {
      optionId: '1',
    });
    expect(answer.status).toBe(409);
    const agents = await t.json<AgentSummary[]>('GET', '/api/agents');
    expect(agents.map((a) => a.state)).toEqual(['stopped', 'stopped', 'stopped']);

    // Nothing new starts until resume.
    const refused = await t.api('POST', '/api/messages', { text: 'riprova' });
    expect(refused.status).toBe(409);
    expect(((await refused.json()) as { error: string }).error).toBe('halted');
    expect(t.core.runs.activeRuns()).toEqual([]);

    await t.json('POST', '/api/resume');
    const after = await t.json<Sent>('POST', '/api/messages', { text: 'riprova' });
    expect((await t.runEnded(after.runId)).data.status).toBe('completed');
    expect((await t.json<AgentSummary[]>('GET', '/api/agents')).map((a) => a.state)).toEqual([
      'idle',
      'idle',
      'idle',
    ]);
  });

  it('(f) routes @Name and `to` to the agent, and queues messages for an active run', async () => {
    const release = deferred();
    const t = await startTestHub({
      titan: [
        fake.text('Prima risposta', { gate: release.promise }),
        fake.text('Visto anche il secondo'),
      ],
      dione: [fake.text('Ecco la bozza.'), fake.text('Ecco la ricerca? No, sono Dione.')],
      rhea: [fake.text('Sono Rhea.')],
    });
    const direct = await t.json<Sent>('POST', '/api/messages', {
      text: '@Dione scrivi una mail a Marco',
    });
    expect(direct.agent).toBe('dione');
    await t.runEnded(direct.runId);
    const userMsg = t
      .events(direct.runId)
      .find((e): e is LogEvent<'message'> => e.type === 'message' && e.agent === 'user');
    expect(userMsg?.data).toMatchObject({
      text: 'scrivi una mail a Marco',
      to: 'dione',
      channel: 'cli',
    });
    expect(t.provider.calls.map((c) => c.model)).toEqual(['dione']);
    expect(t.events(direct.runId).some((e) => e.type === 'run' && e.agent === 'dione')).toBe(true);

    const byTo = await t.json<Sent>('POST', '/api/messages', { text: 'ciao', to: 'Rhea' });
    expect(byTo.agent).toBe('rhea');
    await t.runEnded(byTo.runId);
    expect((await t.api('POST', '/api/messages', { text: 'x', to: 'Nessuno' })).status).toBe(404);
    // An unknown @mention goes to the orchestrator with the full text.
    const first = await t.json<Sent>('POST', '/api/messages', { text: '@Nessuno ciao' });
    expect(first).toMatchObject({ agent: 'titan', queued: false });
    const second = await t.json<Sent>('POST', '/api/messages', { text: 'e anche questo' });
    expect(second).toEqual({
      runId: first.runId,
      agent: 'titan',
      queued: true,
      messageId: expect.any(String) as unknown,
    });
    release.resolve();
    expect((await t.runEnded(first.runId)).data.status).toBe('completed');
    const titanCalls = t.provider.callsTo('titan');
    expect(titanCalls).toHaveLength(2);
    expect(promptText(titanCalls[0]!.options.prompt)).toContain('@Nessuno ciao');
    expect(promptText(titanCalls[1]!.options.prompt)).toContain('e anche questo');
    expect(promptText(titanCalls[1]!.options.prompt)).toContain('Prima risposta');
  });
});

describe('messages and answers around a run', () => {
  it('a message typed while a blocking question is open answers it', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('ask_user', {
          question: 'Che tono?',
          options: ['Ironico', 'Serio'],
          kind: 'taste',
        }),
        fake.text('Ok, ironico.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'scrivi 3 post' });
    const question = await t.waitEvent(isType('question'));
    const typed = await t.json<Sent & { answered?: string }>('POST', '/api/messages', {
      text: 'ironico, grazie',
    });
    expect(typed).toEqual({
      runId: sent.runId,
      agent: 'titan',
      queued: true,
      answered: question.data.questionId,
      messageId: expect.any(String) as unknown,
    });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const q = await t.json<Question[]>('GET', '/api/questions?status=answered');
    expect(q[0]).toMatchObject({ status: 'answered', answer: { text: 'ironico, grazie' } });
    expect(toolResultsSeen(t.provider.calls[1]!.options.prompt)).toContain('ironico, grazie');
    expect(t.provider.calls).toHaveLength(2);
  });

  it('messages queued in a run that fails get a run of their own', async () => {
    const release = deferred();
    const t = await startTestHub({
      titan: [
        // Broken twice: the retry of the step (D-064) breaks as well.
        fake.text('Sto per', { gate: release.promise, breakWith: new Error('boom') }),
        fake.text('Sto per', { breakWith: new Error('boom') }),
        fake.text('Ecco la seconda risposta.'),
      ],
    });
    const first = await t.json<Sent>('POST', '/api/messages', { text: 'primo' });
    const second = await t.json<Sent>('POST', '/api/messages', { text: 'secondo, importante' });
    expect(second).toMatchObject({ runId: first.runId, queued: true });
    release.resolve();
    expect((await t.runEnded(first.runId)).data.status).toBe('failed');
    const next = await t.waitEvent(
      isType('run', (e) => e.data.status === 'started' && e.runId !== first.runId),
    );
    expect(next.data.goal).toBe('secondo, importante');
    expect((await t.runEnded(next.runId!)).data.status).toBe('completed');
    expect(promptText(t.provider.calls[2]!.options.prompt)).toContain('secondo, importante');
  });

  it('answering a non-blocking question after its run ended starts a new run of the asker', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('ask_user', {
          question: 'Pubblico?',
          options: ['Sì', 'No'],
          blocking: false,
          kind: 'publish',
        }),
        fake.text('Ti ho chiesto, intanto ho finito.'),
        fake.text('Pubblicato, come chiedevi.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'fai' });
    await t.runEnded(sent.runId);
    const q = t.events(sent.runId).find(isType('question'))!;
    const res = await t.api('POST', `/api/questions/${q.data.questionId}/answer`, {
      optionId: '1',
    });
    expect(res.status).toBe(200);
    const next = await t.waitEvent(
      isType('run', (e) => e.data.status === 'started' && e.runId !== sent.runId),
    );
    expect(next.agent).toBe('titan');
    expect((await t.runEnded(next.runId!)).data.status).toBe('completed');
    expect(promptText(t.provider.calls[2]!.options.prompt)).toContain(
      'Risposta alla tua domanda \\"Pubblico?\\": Sì',
    );
  });

  it('undo refuses (409 + files) when the note changed afterwards, unless forced', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('vault_write', { path: 'Inbox/Idee', content: '# Idee\n\nPrima idea.\n' }),
        fake.text('Salvata.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'salva le idee' });
    await t.runEnded(sent.runId);
    const change = t.events(sent.runId).find(isType('vault_change'))!;
    const file = join(t.core.hub.vault.root, 'Inbox/Idee.md');
    // The user edits the note in Obsidian afterwards.
    writeFileSync(file, `${readFileSync(file, 'utf8')}\nSeconda idea, mia.\n`);

    const refused = await t.api('POST', '/api/vault/undo', { actionId: change.data.actionId });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ error: 'conflict', files: ['Inbox/Idee.md'] });
    expect(existsSync(file)).toBe(true);

    const forced = await t.api('POST', '/api/vault/undo', {
      actionId: change.data.actionId,
      force: true,
    });
    expect(forced.status).toBe(200);
    expect(existsSync(file)).toBe(false);
  });
});
