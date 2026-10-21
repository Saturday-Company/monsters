import { ProviderRegistry } from '@monsters/providers';
import { fake, FakeProvider, type FakeScript } from '@monsters/providers/testing';
import type { LogEvent, Question } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyKind,
  createCoreServices,
  DecisionGate,
  LlmDecisionPort,
  resolveDecisionRules,
  type CoreServices,
  type DecisionPort,
  type SystemOneRequest,
} from '../src/index.ts';
import { tempHome } from './helpers.ts';
import { startTestHub, toolResultsSeen } from './hub-helpers.ts';

const opened: CoreServices[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.db.close();
});

function services(): CoreServices {
  const s = createCoreServices({ home: tempHome() });
  opened.push(s);
  return s;
}

function llmPort(script: FakeScript): { port: LlmDecisionPort; provider: FakeProvider } {
  const provider = new FakeProvider({ models: { gate: script } });
  const providers = new ProviderRegistry().register(provider);
  return {
    port: new LlmDecisionPort({ providers, models: [{ provider: 'fake', model: 'gate' }] }),
    provider,
  };
}

const answers = (needsUser: number, conf: number, option?: { value: string; confidence: number }) =>
  JSON.stringify({
    answers: [
      { id: 'needs_user', value: needsUser, confidence: conf },
      ...(option ? [{ id: 'option', ...option }] : []),
    ],
  });

function decisions(s: CoreServices): LogEvent<'decision'>[] {
  return s.log.query({ type: 'decision' }) as LogEvent<'decision'>[];
}

describe('DecisionGate', () => {
  it('(e) "ask always" actions become questions, reversible ones proceed, every decision is logged', async () => {
    const s = services();
    const gate = new DecisionGate({ log: s.log });
    const publish = await gate.decide({
      agent: 'titan',
      runId: 'r1',
      question: 'Pubblico il post su LinkedIn?',
      options: ['Sì', 'No'],
      recommended: 'Sì',
    });
    expect(publish).toMatchObject({ outcome: 'ask', decidedBy: 'rules', rule: 'publish' });

    const cases: [string, string[]][] = [
      ['Mando la mail al cliente Rossi?', ['Manda', 'Aspetta']],
      ['Rinnovo l’abbonamento a 12 € al mese?', ['Sì', 'No']],
      ['Elimino definitivamente la cartella Archivio?', ['Sì', 'No']],
      ['Cambiamo obiettivo e puntiamo sul podcast?', ['Sì', 'No']],
    ];
    for (const [question, options] of cases) {
      expect((await gate.decide({ agent: 'titan', question, options })).outcome, question).toBe(
        'ask',
      );
    }
    // A declared kind is enough, even with neutral words.
    expect(
      (
        await gate.decide({
          agent: 'titan',
          question: 'Quale dei due?',
          options: ['A', 'B'],
          kind: 'taste',
        })
      ).outcome,
    ).toBe('ask');

    const local = await gate.decide({
      agent: 'titan',
      question: 'Salvo gli appunti in Inbox o in Progetti?',
      options: ['Inbox', 'Progetti'],
      recommended: 'Inbox',
    });
    expect(local).toMatchObject({ outcome: 'proceed', choice: 'Inbox', rule: 'local' });
    // Drafts without a declared kind never pass on keywords alone (no model here: ask).
    expect(
      await gate.decide({
        agent: 'titan',
        question: 'Salvo la bozza in Inbox o in Progetti?',
        options: ['Inbox', 'Progetti'],
        recommended: 'Inbox',
      }),
    ).toMatchObject({ outcome: 'ask', decidedBy: 'rules' });
    // "Ask" wins over "proceed" when both match.
    expect(
      (
        await gate.decide({
          agent: 'titan',
          question: 'Pubblico la bozza della nota?',
          options: ['Sì', 'No'],
          recommended: 'No',
        })
      ).outcome,
    ).toBe('ask');
    // Gray zone without a model: ask.
    expect(
      await gate.decide({
        agent: 'titan',
        question: 'Ordine delle sezioni?',
        options: ['A', 'B'],
        recommended: 'A',
      }),
    ).toMatchObject({ outcome: 'ask', decidedBy: 'rules' });

    const logged = decisions(s);
    expect(logged).toHaveLength(10);
    expect(logged[0]!.data).toMatchObject({
      kind: 'ask_or_proceed',
      question: 'Pubblico il post su LinkedIn?',
      options: ['Sì', 'No'],
      choice: 'ask_user',
      decidedBy: 'rules',
    });
    expect(logged[0]!.runId).toBe('r1');
    expect(logged.find((d) => d.data.choice === 'Inbox')?.data.reason).toMatch(/^local:/);
  });

  it('asks matters of taste even when they look local, unless the profile says otherwise', async () => {
    const s = services();
    const gate = new DecisionGate({ log: s.log });
    const taste: [string, string[]][] = [
      ['Quale delle tre bozze di post preferisci?', ['Ironica', 'Seria', 'Tecnica']],
      ['Che tono uso per le bozze?', ['Ironico', 'Serio']],
      ['Quale variante della bozza salvo nella nota?', ['A', 'B']],
      ['Che stile grafico per la nota di copertina?', ['Minimale', 'Colorato']],
    ];
    for (const [question, options] of taste) {
      const d = await gate.decide({ agent: 'titan', question, options, recommended: options[0] });
      expect(d, question).toMatchObject({ outcome: 'ask', rule: 'taste' });
    }
    // The length of a text is taste even when it is a summary ("riassun" is local, D-037).
    const length: [string, string[]][] = [
      [
        'Il riassunto lo vuoi lungo, una pagina, o corto, cinque righe?',
        ['Una pagina', 'Cinque righe'],
      ],
      ['La sintesi della nota?', ['Breve', 'Estesa']],
      ['Should the summary be short or long?', ['Short', 'Long']],
    ];
    for (const [question, options] of length) {
      const d = await gate.decide({ agent: 'titan', question, options, recommended: options[1] });
      expect(d, question).toMatchObject({ outcome: 'ask', rule: 'taste' });
    }
    expect(
      await gate.decide({
        agent: 'titan',
        question: 'Salvo il riassunto lungo in Inbox o in Progetti?',
        options: ['Inbox', 'Progetti'],
        recommended: 'Inbox',
      }),
    ).toMatchObject({ outcome: 'proceed', rule: 'local' });
    // Still local: no taste in it.
    expect(
      await gate.decide({
        agent: 'titan',
        question: 'Salvo la ricerca in Inbox o in Progetti?',
        options: ['Inbox', 'Progetti'],
        recommended: 'Inbox',
      }),
    ).toMatchObject({ outcome: 'proceed', rule: 'local' });

    // An explicit preference ("decidi tu il tono") turns the rule off.
    const relaxed = new DecisionGate({
      log: s.log,
      rules: resolveDecisionRules([{ id: 'taste', effect: 'proceed' }]),
    });
    expect(
      await relaxed.decide({
        agent: 'titan',
        question: 'Quale delle tre bozze preferisci?',
        options: ['A', 'B', 'C'],
        recommended: 'A',
      }),
    ).toMatchObject({ outcome: 'proceed', choice: 'A', rule: 'taste' });
  });

  it('lets the user change the rules ("puoi pubblicare senza chiedere")', async () => {
    const s = services();
    const gate = new DecisionGate({
      log: s.log,
      rules: resolveDecisionRules([{ id: 'publish', effect: 'proceed' }], ['taste']),
    });
    const d = await gate.decide({
      agent: 'titan',
      question: 'Pubblico il post?',
      options: ['Ora', 'Domani'],
      recommended: 'Ora',
    });
    expect(d).toMatchObject({ outcome: 'proceed', choice: 'Ora', rule: 'publish' });
    expect(gate.rules.some((r) => r.id === 'taste')).toBe(false);
    expect(() => resolveDecisionRules([{ id: 'bad', effect: 'ask', patterns: ['('] }])).toThrow();
  });

  it('asks the small model in the gray zone and respects the confidence threshold', async () => {
    const s = services();
    const { port, provider } = llmPort([
      fake.text(
        `Ecco: \`\`\`json\n${answers(0.1, 0.95, { value: 'Per tema', confidence: 0.9 })}\n\`\`\``,
      ),
      fake.text(answers(0.1, 0.6, { value: 'Per tema', confidence: 0.9 })),
      fake.text(answers(0.8, 0.9, { value: 'Per tema', confidence: 0.9 })),
      fake.text('non so'),
      fake.text(answers(0.1, 0.95, { value: 'Inventata', confidence: 0.99 })),
    ]);
    const gate = new DecisionGate({ log: s.log, port, threshold: 0.8 });
    const req = {
      agent: 'titan',
      question: 'Ordine delle sezioni?',
      options: ['Cronologico', 'Per tema'],
    };

    expect(await gate.decide(req)).toMatchObject({
      outcome: 'proceed',
      choice: 'Per tema',
      decidedBy: 'model',
    });
    expect(await gate.decide(req)).toMatchObject({ outcome: 'ask', decidedBy: 'model' });
    expect(await gate.decide(req)).toMatchObject({ outcome: 'ask', decidedBy: 'model' });
    // Invalid answers never let the agent proceed.
    expect(await gate.decide(req)).toMatchObject({ outcome: 'ask', decidedBy: 'rules' });
    expect(await gate.decide(req)).toMatchObject({ outcome: 'ask', decidedBy: 'rules' });

    // The model got the /v1/systemone request as JSON.
    const prompt = JSON.stringify(provider.calls[0]!.options.prompt);
    expect(prompt).toContain('needs_user');
    expect(prompt).toContain('noul');
    expect(decisions(s).map((d) => d.data.decidedBy)).toEqual([
      'model',
      'model',
      'model',
      'rules',
      'rules',
    ]);
    expect(decisions(s)[0]!.data.confidence).toBeCloseTo(0.9);
    // Every model call of the gate is a provider_usage event, failed answers included.
    const usage = s.log.query({ type: 'provider_usage' }) as LogEvent<'provider_usage'>[];
    expect(usage).toHaveLength(5);
    expect(usage[0]).toMatchObject({ agent: 'titan', data: { provider: 'fake', model: 'gate' } });
    expect(typeof usage[0]!.data.inputTokens).toBe('number');
  });

  it('any DecisionPort with the /v1/systemone contract can plug in', async () => {
    const s = services();
    const seen: SystemOneRequest[] = [];
    const jev: DecisionPort = {
      id: 'jev',
      decide: (request) => {
        seen.push(request);
        return Promise.resolve({
          answers: [
            { id: 'needs_user', value: 0.05, confidence: 0.97 },
            { id: 'option', value: 'B', confidence: 0.92 },
            { id: 'option_rev', value: 'B', confidence: 0.9 },
          ],
          model: 'jev-1.13.0',
        });
      },
    };
    const gate = new DecisionGate({ log: s.log, port: jev });
    const d = await gate.decide({ agent: 'titan', question: 'A o B?', options: ['A', 'B'] });
    expect(d).toMatchObject({ outcome: 'proceed', choice: 'B' });
    // P0 (D-067): one condition with criteria, the option asked in both orders, no
    // `recommended` in the state.
    expect(seen[0]!.questions.map((q) => q.id)).toEqual(['needs_user', 'option', 'option_rev']);
    expect(seen[0]!.questions[0]).toHaveProperty('criteria.true');
    expect(seen[0]!.state).not.toHaveProperty('recommended');
  });

  it('(e) through ask_user: a reversible choice is decided, an "ask always" one becomes a question', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('ask_user', {
          question: 'Salvo la ricerca nella nota Risorse/Encelado o in Inbox?',
          options: ['Risorse/Encelado', 'Inbox'],
          recommended: '1',
        }),
        fake.toolCall('ask_user', {
          question: 'Invio la mail al cliente con il preventivo?',
          options: ['Invia', 'Aspetta'],
          recommended: 'Aspetta',
          blocking: false,
        }),
        fake.text('Ho salvato in Risorse e ti ho chiesto della mail.'),
        fake.text('Ok, la mando lunedì.'),
      ],
    });
    const sent = await t.json<{ runId: string }>('POST', '/api/messages', {
      text: 'Sistema la ricerca',
    });
    // The question left open waits for the user (D-078): the run ends on it.
    expect((await t.runEnded(sent.runId)).data.status).toBe('waiting_user');

    const results = toolResultsSeen(t.provider.calls[2]!.options.prompt);
    expect(results).toContain('"status":"decided"');
    expect(results).toContain('Risorse/Encelado');
    expect(results).toContain('"status":"sent"');
    const open = await t.json<Question[]>('GET', '/api/questions?status=open');
    expect(open.map((q) => q.question)).toEqual(['Invio la mail al cliente con il preventivo?']);
    expect(open[0]!.blocking).toBe(false);
    expect(open[0]!.parked).toBe(true);

    const logged = t
      .events(sent.runId)
      .filter((e): e is LogEvent<'decision'> => e.type === 'decision')
      .map((d) => [d.data.choice, d.data.decidedBy]);
    expect(logged).toEqual([
      ['Risorse/Encelado', 'rules'],
      ['ask_user', 'rules'],
    ]);

    // The late answer of a non-blocking question reaches the next run as a message.
    await t.json('POST', `/api/questions/${open[0]!.id}/answer`, {
      optionId: '2',
      text: 'meglio lunedì',
    });
    const next = await t.json<{ runId: string }>('POST', '/api/messages', { text: 'Novità?' });
    await t.runEnded(next.runId);
    const seen = JSON.stringify(t.provider.calls[3]!.options.prompt);
    expect(seen).toContain(
      'Risposta alla tua domanda \\"Invio la mail al cliente con il preventivo?\\": Aspetta — meglio lunedì',
    );
  });

  it('classifies choices among drafts, variants, tones and styles as taste (it and en)', () => {
    const taste: [string, string[]][] = [
      ['Vado con la bozza A o con la B?', ['Bozza A', 'Bozza B']],
      ['Quale delle due versioni del post?', ['1', '2']],
      ['Ti mando la prima bozza o la seconda?', ['Prima', 'Seconda']],
      ['Come chiudiamo il post?', ['Tono ironico', 'Tono caldo']],
      ['Per il post di lunedì', ['Più ironico', 'Più formale', 'Più poetico']],
      ['Which draft should I go with?', ['Draft 1', 'Draft 2']],
      ['Pick a style for the newsletter', ['Playful', 'Warm']],
      ['Usiamo la variante 2?', ['Sì', 'No']],
    ];
    for (const [question, options] of taste) {
      expect(classifyKind(question, options), question).toBe('taste');
    }
    const other: [string, string[]][] = [
      ['Salvo gli appunti in Inbox o in Progetti?', ['Inbox', 'Progetti']],
      ['In quale cartella salvo le bozze?', ['Bozze', 'Post']],
      ['Ordine delle sezioni?', ['Cronologico', 'Per tema']],
      ['Pubblico il post?', ['Sì', 'No']],
    ];
    for (const [question, options] of other) {
      expect(classifyKind(question, options), question).toBeUndefined();
    }
  });

  it('asks a choice among drafts without kind, even when it looks local', async () => {
    const s = services();
    const gate = new DecisionGate({ log: s.log });
    const d = await gate.decide({
      agent: 'titan',
      question: 'Vado con la bozza A o la bozza B?',
      options: ['Bozza A', 'Bozza B'],
      recommended: 'Bozza A',
    });
    expect(d).toMatchObject({ outcome: 'ask', decidedBy: 'rules', rule: 'taste' });
    expect(d.reason).toContain('inferred kind: taste');
    // "local" declared by the agent does not turn a choice among drafts into housekeeping.
    expect(
      await gate.decide({
        agent: 'titan',
        question: 'Vado con la bozza A o la bozza B?',
        options: ['Bozza A', 'Bozza B'],
        recommended: 'Bozza A',
        kind: 'local',
      }),
    ).toMatchObject({ outcome: 'ask', rule: 'taste' });
  });

  it('a kind declared "local" is not enough to go on: facts only the user knows are asked (demo)', async () => {
    const s = services();
    const gate = new DecisionGate({ log: s.log });
    // The Phase 2 demo: Titan marked it local and the gate decided alone.
    expect(
      await gate.decide({
        agent: 'titan',
        question: 'In che giorno facciamo la cena del personale?',
        options: ['Domenica sera', 'Lunedì sera'],
        recommended: 'Domenica sera',
        kind: 'local',
      }),
    ).toMatchObject({ outcome: 'ask', decidedBy: 'rules', rule: 'facts' });
    for (const question of [
      'Quando facciamo la riunione con lo staff?',
      'Chi viene alla cena?',
      'A che ora apro il locale sabato?',
      'Uso il tuo indirizzo di casa per la consegna?',
    ]) {
      expect(
        await gate.decide({
          agent: 'titan',
          question,
          options: ['Sì', 'No'],
          recommended: 'Sì',
          kind: 'local',
        }),
      ).toMatchObject({ outcome: 'ask', rule: 'facts' });
    }
    // "local" with nothing local in the words: no rule confirms it, the gray zone
    // (no model here) asks.
    expect(
      await gate.decide({
        agent: 'titan',
        question: 'Va bene così?',
        options: ['Sì', 'No'],
        recommended: 'Sì',
        kind: 'local',
      }),
    ).toMatchObject({ outcome: 'ask', reason: 'gray area without a model: asking' });
    // When the words confirm it, local work still goes on alone.
    expect(
      await gate.decide({
        agent: 'titan',
        question: 'Salvo gli appunti nella nota Progetti/Cena?',
        options: ['Sì, salva', 'No'],
        recommended: 'Sì, salva',
        kind: 'local',
      }),
    ).toMatchObject({ outcome: 'proceed', rule: 'local', choice: 'Sì, salva' });
  });

  it('lets the small model tell taste from housekeeping when drafts are only mentioned', async () => {
    const s = services();
    const kindAnswer = (kind: string, needsUser = 0.05) =>
      JSON.stringify({
        answers: [
          { id: 'needs_user', value: needsUser, confidence: 0.95 },
          { id: 'option', value: 'Inbox', confidence: 0.9 },
          { id: 'kind', value: kind, confidence: 0.9 },
        ],
      });
    const { port, provider } = llmPort([
      fake.text(kindAnswer('local')),
      fake.text(kindAnswer('taste')),
    ]);
    const gate = new DecisionGate({ log: s.log, port });
    const req = {
      agent: 'titan',
      question: 'Salvo la bozza in Inbox o in Progetti?',
      options: ['Inbox', 'Progetti'],
      recommended: 'Inbox',
    };
    expect(await gate.decide(req)).toMatchObject({ outcome: 'proceed', choice: 'Inbox' });
    expect(await gate.decide(req)).toMatchObject({
      outcome: 'ask',
      decidedBy: 'model',
      reason: 'the model classifies it as taste',
    });
    expect(JSON.stringify(provider.calls[0]!.options.prompt)).toContain('Di che tipo è la scelta');
  });

  it('never decides an open question (no options) for the user', async () => {
    const s = services();
    const { port, provider } = llmPort([fake.text(answers(0.01, 0.99))]);
    const gate = new DecisionGate({ log: s.log, port });
    const d = await gate.decide({
      agent: 'titan',
      question: 'Quali piatti ci sono nel menu?',
      options: [],
    });
    expect(d).toMatchObject({ outcome: 'ask', decidedBy: 'rules' });
    expect(provider.calls).toHaveLength(0);
  });
});
