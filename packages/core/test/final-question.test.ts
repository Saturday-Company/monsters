import { fake } from '@monsters/providers/testing';
import { setAppLang, type LogEvent, type Question } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { endsWithQuestion, FINAL_QUESTION_REMINDER, lastSentence } from '../src/index.ts';
import { finalQuestionPrompts } from '../src/team/final-question.prompts.ts';
import { promptText, startTestHub, toolResultsSeen } from './hub-helpers.ts';

type Sent = { runId: string };

afterEach(() => setAppLang('en'));

const finals = (events: LogEvent[], agent = 'titan') =>
  events
    .filter(
      (e): e is LogEvent<'message'> =>
        e.type === 'message' && e.agent === agent && e.data.role === 'agent' && !e.data.partial,
    )
    .map((e) => e.data.text);

const reminders = (events: LogEvent[]) =>
  events.filter((e) => e.type === 'message' && e.data.role === 'system');

describe('endsWithQuestion', () => {
  it('spots a question at the end of an answer, in Italian and English', () => {
    const yes = [
      'Ecco le due bozze.\n\nQuale preferisci?',
      'Ho preparato i post. Vuoi che li programmi per lunedì',
      'Ecco tutto.\n\n**Dimmi quale tono ti piace di più.**',
      'Le bozze sono nella nota. Fammi sapere se vanno bene 😊',
      'Ho finito: preferisci la versione breve o quella lunga',
      '- Variante A\n- Variante B\n\nSe ti piace, vuoi che prepari anche le stories?',
      'Here are the drafts. Which one do you prefer?',
      'Ecco i post. Vuoi che cambi il tono in uno più ironico',
      'Ecco le caption.\n\nTi va bene così o preferisci modificare qualcosa?  \n- Va bene così  \n- Voglio modificare qualcosa  \n\n**Consiglio:** Va bene così.',
      'Done. Let me know which tone works best.',
    ];
    for (const text of yes) expect(endsWithQuestion(text), text).toBe(true);
    const no = [
      'Ecco le bozze, salvate in Bozze/Post autunno.',
      'Ciao Giulio! Come posso aiutarti?',
      'Fatto. Posso fare altro?',
      'Ti ho chiesto prima "quale preferisci?". Ora procedo con la prima.',
      'How can I help?',
      'Puoi caricarle quando vuoi. Fammi sapere se ti serve altro! 🚀',
      'Let me know if you need anything else.',
      'Fammi sapere se vuoi apportare modifiche o se desideri le varianti narrative!',
      'Post 1: avete già provato la ribollita?\n#TrattoriaDaLapo #MenuAutunnale',
      "Domanda di prova? No.\n- una nota lunga che non è un'opzione ma un elenco di cose fatte nel lavoro di oggi, con tanti dettagli in più",
      'Let me know if you want any changes.',
      '',
    ];
    for (const text of no) expect(endsWithQuestion(text), text).toBe(false);
  });

  it('spots the English ways of asking, and does not take a courtesy or a thing the agent does itself', () => {
    const yes = [
      'Here are the drafts. Which one do you prefer?',
      'Done. Please let me know which tone you want.',
      'The email is ready. Please confirm the date for the meeting.',
      'I prepared the email. Only the contact’s name is missing.',
      'I prepared the email. I’m still missing the contact’s name.',
      'I prepared the email. I still need the contact’s name',
      'I prepared the email. I don’t have your address yet',
      'Ready. Would you prefer the short one or the long one',
      'Both are saved. Choose the one you like.',
    ];
    for (const text of yes) expect(endsWithQuestion(text), text).toBe(true);
    const no = [
      'Done. Feel free to ask for changes.',
      'Done. If you want any adjustments, let me know.',
      'Done. Hope this helps!',
      'Saved. Is there anything else?',
      'I’m missing the prices, I’ll look them up myself.',
      'I don’t have the permission to send emails, so the draft is above.',
      'I need the prices, which Rhea will search.',
    ];
    for (const text of no) expect(endsWithQuestion(text), text).toBe(false);
  });

  it('takes the last sentence without Markdown or emoji', () => {
    expect(lastSentence('Primo.\n\n> **Secondo? Terzo!** 🎉')).toBe('Terzo!');
    expect(lastSentence('Uno. Due')).toBe('Due');
  });
});

describe('final question in plain text (stop hook)', () => {
  it('reminds the orchestrator once; an ask_user call follows and the first answer stays', async () => {
    const t = await startTestHub({
      titan: [
        fake.text('Ecco le due versioni del post. Quale preferisci?'),
        fake.toolCall('ask_user', {
          question: 'Quale versione del post?',
          options: ['Ironica', 'Calda'],
          recommended: 'Calda',
          kind: 'taste',
        }),
        fake.text('Perfetto, tengo la versione calda.'),
      ],
    });
    // The reminder is in the language of the app when it is sent: Italian here.
    setAppLang('it');
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Due versioni del post' });
    const q = await t.waitEvent(
      (e): e is LogEvent<'question'> => e.type === 'question' && e.runId === sent.runId,
    );
    await t.json('POST', `/api/questions/${q.data.questionId}/answer`, { optionId: '2' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');

    const events = t.events(sent.runId);
    expect(reminders(events)).toHaveLength(1);
    expect(finals(events)).toEqual([
      'Ecco le due versioni del post. Quale preferisci?',
      'Perfetto, tengo la versione calda.',
    ]);
    // The model saw its own answer, then the reminder.
    const seen = promptText(t.provider.calls[1]!.options.prompt);
    expect(seen).toContain('Ecco le due versioni del post. Quale preferisci?');
    expect(seen).toContain(FINAL_QUESTION_REMINDER.slice(0, 40));
    expect(toolResultsSeen(t.provider.calls[2]!.options.prompt)).toContain('Calda');
    expect(t.provider.calls).toHaveLength(3);
  });

  it('the same in an English app: the reminder is the English one', async () => {
    const t = await startTestHub({
      titan: [
        fake.text('Here are the two versions of the post. Which do you prefer?'),
        fake.toolCall('ask_user', {
          question: 'Which version of the post?',
          options: ['Ironic', 'Warm'],
          recommended: 'Warm',
          kind: 'taste',
        }),
        fake.text('Perfect, I’m keeping the warm one.'),
      ],
    });
    setAppLang('en');
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Two versions of the post' });
    const q = await t.waitEvent(
      (e): e is LogEvent<'question'> => e.type === 'question' && e.runId === sent.runId,
    );
    await t.json('POST', `/api/questions/${q.data.questionId}/answer`, { optionId: '2' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    expect(reminders(t.events(sent.runId))).toHaveLength(1);
    const seen = promptText(t.provider.calls[1]!.options.prompt);
    expect(seen).toContain(finalQuestionPrompts('en').reminder.slice(0, 40));
    expect(seen).not.toContain(FINAL_QUESTION_REMINDER.slice(0, 40));
    expect(t.provider.calls).toHaveLength(3);
  });

  it('drops a text-only reply to the reminder and never reminds twice in a run', async () => {
    const t = await startTestHub({
      titan: [
        fake.text('Ho scritto la mail. Vuoi che aggiunga i prezzi?'),
        fake.text('OK'),
        fake.text('Aggiunti. Vuoi che la accorci?'),
        fake.text('OK'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Scrivi la mail' });
    await t.runEnded(sent.runId);
    let events = t.events(sent.runId);
    expect(reminders(events)).toHaveLength(1);
    expect(finals(events)).toEqual(['Ho scritto la mail. Vuoi che aggiunga i prezzi?']);
    expect(t.provider.calls).toHaveLength(2);

    // The conversation keeps the answer the user saw, not the dropped "OK".
    const next = await t.json<Sent>('POST', '/api/messages', { text: 'sì, aggiungili' });
    await t.runEnded(next.runId);
    const seen = promptText(t.provider.calls[2]!.options.prompt);
    expect(seen).toContain('Vuoi che aggiunga i prezzi?');
    expect(seen).not.toContain('"OK"');
    // Once per run: the next run may get its own reminder.
    events = t.events(next.runId);
    expect(reminders(events)).toHaveLength(1);
    expect(finals(events)).toEqual(['Aggiunti. Vuoi che la accorci?']);
  });

  it('an "OK" after the ask_user of the reminder is never the answer (D-108)', async () => {
    for (const last of ['OK', 'Ok, fatto.', 'Va bene!']) {
      const t = await startTestHub({
        titan: [
          fake.text(
            'La mail è in Bozze, con i segnaposto. Se mi dai il nome del cliente, la compilo?',
          ),
          fake.toolCall('ask_user', { question: 'Nome del cliente?', options: [] }),
          fake.text(last),
        ],
      });
      const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Mail di sollecito' });
      const q = await t.waitEvent(
        (e): e is LogEvent<'question'> => e.type === 'question' && e.runId === sent.runId,
      );
      await t.json('POST', `/api/questions/${q.data.questionId}/answer`, { text: 'Rossi' });
      expect((await t.runEnded(sent.runId)).data.status, last).toBe('completed');
      const events = t.events(sent.runId);
      expect(finals(events), last).toEqual([
        'La mail è in Bozze, con i segnaposto. Se mi dai il nome del cliente, la compilo?',
      ]);
      const streamed = events
        .filter((e): e is LogEvent<'message'> => e.type === 'message' && e.data.role === 'agent')
        .map((e) => e.data.text)
        .join('');
      expect(streamed).not.toContain(last);
    }
  });

  it('keeps the first answer when the extra request fails', async () => {
    const t = await startTestHub({
      titan: [fake.text('Ecco le bozze. Quale preferisci?'), fake.httpError(500, 'boom')],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Le bozze' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    expect(finals(t.events(sent.runId))).toEqual(['Ecco le bozze. Quale preferisci?']);
  });

  it('does not remind when the run already used ask_user', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('ask_user', {
          question: 'Pubblico il post adesso?',
          options: ['Sì', 'No'],
          recommended: 'No',
          kind: 'publish',
        }),
        fake.text('Va bene. Vuoi che lo riguardi domani?'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Il post?' });
    const q = await t.waitEvent(
      (e): e is LogEvent<'question'> => e.type === 'question' && e.runId === sent.runId,
    );
    await t.json('POST', `/api/questions/${q.data.questionId}/answer`, { optionId: '2' });
    await t.runEnded(sent.runId);
    expect(reminders(t.events(sent.runId))).toHaveLength(0);
    expect(t.provider.calls).toHaveLength(2);
  });
});

describe('ask_user with an open question', () => {
  it('sends a question without options and returns the free answer', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('ask_user', { question: 'Quali piatti ci sono nel menu autunnale?' }),
        fake.text('Grazie: preparo i post con ribollita e pappardelle.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Post sul menu' });
    const q = await t.waitEvent(
      (e): e is LogEvent<'question'> => e.type === 'question' && e.runId === sent.runId,
    );
    expect(q.data.options).toEqual([]);
    const open = await t.json<Question[]>('GET', '/api/questions?status=open');
    expect(open[0]).toMatchObject({ options: [], status: 'open' });
    const answered = await t.json<Question>('POST', `/api/questions/${q.data.questionId}/answer`, {
      text: 'Ribollita, pappardelle al cinghiale',
    });
    expect(answered.answer).toEqual({ text: 'Ribollita, pappardelle al cinghiale' });
    await t.runEnded(sent.runId);
    const result = toolResultsSeen(t.provider.calls[1]!.options.prompt);
    expect(result).toContain('"status":"answered"');
    expect(result).toContain('Ribollita, pappardelle al cinghiale');
    const decision = t
      .events(sent.runId)
      .find((e): e is LogEvent<'decision'> => e.type === 'decision');
    expect(decision?.data.reason).toContain('open question');
  });

  it('refuses a single option with a clear error', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('ask_user', { question: 'Va bene?', options: ['Sì'] }),
        fake.text('Ok.'),
      ],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'prova' });
    await t.runEnded(sent.runId);
    const result = toolResultsSeen(t.provider.calls[1]!.options.prompt);
    expect(result).toContain('2-4 options, or none');
    expect(t.events(sent.runId).some((e) => e.type === 'question')).toBe(false);
  });

  it('takes a bare option number as the text of an open question', async () => {
    const t = await startTestHub({
      titan: [fake.toolCall('ask_user', { question: 'Quanti coperti?' }), fake.text('Ok.')],
    });
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'prenota' });
    const q = await t.waitEvent(
      (e): e is LogEvent<'question'> => e.type === 'question' && e.runId === sent.runId,
    );
    const answered = await t.json<Question>('POST', `/api/questions/${q.data.questionId}/answer`, {
      optionId: '4',
    });
    expect(answered.answer).toEqual({ text: '4' });
    await t.runEnded(sent.runId);
  });
});
