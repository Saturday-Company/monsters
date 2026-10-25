import { setAppLang, type TelegramOrigin } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentDefinition } from '../src/agents/definition.ts';
import { telegramLine, telegramPlace, telegramText } from '../src/channels/telegram/lines.ts';
import {
  answerText,
  docsOutcomeText,
  draftOutcomeText,
  EventLog,
  coreMigrations,
  migrate,
  openDb,
  projectReportText,
  proposalOutcomeText,
  recentConversation,
} from '../src/index.ts';
import { pickedOption, readsAsAnswer } from '../src/team/questions.ts';
import { teamSpendStrings } from '../src/team/spend.strings.ts';
import { teamPrompts } from '../src/team/team.prompts.ts';
import {
  askUserTool,
  completeBrief,
  delegateTool,
  earlierChoice,
  subtaskText,
  truncateSummary,
  type TeamToolsContext,
} from '../src/team/team-tools.ts';
import { needsRareTools } from '../src/team/toolsets.ts';
import { startTestHub } from './hub-helpers.ts';

/*
 * The texts the models read in the team layer (D-153, wave 3), in the two families, and the
 * words that read what the user and the monsters write. Tests run in English: the Italian
 * family is pinned with `setAppLang('it')` and must read byte for byte what it always did.
 */

afterEach(() => setAppLang('en'));

const memoryLog = () => {
  const db = openDb(':memory:');
  migrate(db, 'core', coreMigrations);
  return new EventLog(db);
};

describe('the conversation a monster reads', () => {
  it('Italian family: the lines are what they always were', () => {
    setAppLang('it');
    expect(
      answerText(
        { question: 'Che tono?', options: [{ id: '1', label: 'Serio' }] },
        { optionId: '1' },
      ),
    ).toBe('Risposta alla tua domanda "Che tono?": Serio');
    expect(proposalOutcomeText({ action: 'created', name: 'Lyra' })).toBe(
      "[Dall'app] Ho creato Lyra dalla tua proposta: ora è nella squadra.",
    );
    expect(proposalOutcomeText({ action: 'dropped' })).toBe(
      "[Dall'app] Ho lasciato stare la tua proposta di il mostro: non l'ho creato.",
    );
    expect(
      projectReportText({
        project: 'p',
        status: 'waiting_user',
        summary: 'x',
        leadName: 'Leda',
        projectName: 'Saturday',
      }),
    ).toBe('[Rapporto del progetto «Saturday»: Leda aspetta una risposta dell’utente] x');
  });

  it('English family: the same lines, translated', () => {
    expect(
      answerText(
        { question: 'Which tone?', options: [{ id: '1', label: 'Serious' }] },
        { optionId: '1', text: 'but warm' },
      ),
    ).toBe('Answer to your question "Which tone?": Serious — but warm');
    expect(proposalOutcomeText({ action: 'created', name: 'Lyra' })).toBe(
      '[From the app] I created Lyra from your proposal: it is now in the squad.',
    );
    expect(proposalOutcomeText({ action: 'dropped', name: 'Lyra' })).toBe(
      '[From the app] I dropped your proposal for Lyra: I did not create it.',
    );
    expect(draftOutcomeText('project', 'confirmed', 'Saturday')).toBe(
      '[From the app] I confirmed the project “Saturday” you proposed: it now exists, with its lead and its monsters.',
    );
    expect(draftOutcomeText('project', 'discarded', 'Saturday')).toContain(
      'I dropped the project “Saturday”',
    );
    expect(draftOutcomeText('automation', 'confirmed', 'Weekly')).toBe(
      '[From the app] I confirmed the automation “Weekly”: from now on it runs on its schedule.',
    );
    expect(draftOutcomeText('automation', 'discarded', 'Weekly')).toBe(
      '[From the app] I dropped the automation “Weekly” you proposed.',
    );
    expect(docsOutcomeText({ action: 'applied', file: 'CLAUDE.md', name: 'Saturday' })).toBe(
      '[From the app] I applied your proposal for CLAUDE.md of “Saturday”: the file is now as you wrote it.',
    );
    expect(docsOutcomeText({ action: 'discarded', file: 'AGENTS.md', name: 'Saturday' })).toBe(
      '[From the app] I dropped your proposal for AGENTS.md of “Saturday”: the file stays as it was.',
    );
    expect(
      projectReportText({
        project: 'p',
        status: 'completed',
        summary: 'Done.',
        leadName: 'Leda',
        projectName: 'Saturday',
      }),
    ).toBe('[Report from the project “Saturday”: Leda has finished] Done.');
    expect(
      projectReportText({
        project: 'p',
        status: 'failed',
        summary: 'x',
        leadName: 'Leda',
        projectName: 'Saturday',
      }),
    ).toBe('[Report from the project “Saturday”: Leda has stopped] x');
  });

  it('the line with the notes of a job follows the language', () => {
    const log = memoryLog();
    const user = (text: string) =>
      log.append({ agent: 'user', type: 'message', data: { role: 'user', text, to: 'rhea' } });
    const run = '01JRUN0000000000000000000A';
    user('Write the post');
    log.append({
      agent: 'rhea',
      runId: run,
      type: 'vault_change',
      data: { action: 'create', path: 'Inbox/Bozze/Post.md' } as never,
    });
    log.append({
      agent: 'rhea',
      runId: run,
      parentId: null,
      type: 'message',
      data: { role: 'agent', text: 'Here it is.' },
    });
    const read = () =>
      recentConversation(log, undefined, { agentId: 'rhea', isOrchestrator: false, turns: 10 }).map(
        (m) => `${m.role}:${m.content as string}`,
      );
    expect(read().at(-1)).toBe(
      'assistant:Here it is.\n\n[Notes from this job: Inbox/Bozze/Post.md]',
    );
    setAppLang('it');
    expect(read().at(-1)).toBe(
      'assistant:Here it is.\n\n[Note di questo lavoro: Inbox/Bozze/Post.md]',
    );
  });
});

describe('the tools of the team', () => {
  const member = (id: string, name: string, kind = 'subagent') =>
    ({ config: { id, name, kind, role: name } }) as unknown as AgentDefinition;
  const ctx = {
    self: member('titan', 'Titan', 'orchestrator'),
    team: { list: () => [member('titan', 'Titan'), member('rhea', 'Rhea')] },
  } as unknown as TeamToolsContext;

  it('the descriptions: English example in English, Italian example in Italian, the rest the same', () => {
    const en = [delegateTool(ctx).description, askUserTool(ctx).description];
    expect(en[0]).toContain('"goal": "The November newsletter for the customers, in 2 variants"');
    expect(en[0]).toContain('"context_links": ["Risorse/Ricerche/November news"]');
    expect(en[1]).toContain('{"question": "Which version of the newsletter?"');
    expect(en[1]).toContain('never just "Variant A" / "Variant B"');
    setAppLang('it');
    const it = [delegateTool(ctx).description, askUserTool(ctx).description];
    expect(it[0]).toContain('"goal": "La newsletter di novembre per i clienti, in 2 varianti"');
    expect(it[0]).toContain('"context_links": ["Risorse/Ricerche/Novità di novembre"]');
    expect(it[1]).toContain('never just "Variante A" / "Variante B"');
    expect(it[1]).toContain('{"question": "Quali novità ci sono questo mese?"}');
    // Same text and keys in both families.
    const strip = (s: string) => s.replace(/Example:.*$/s, '').replace(/Examples:.*$/s, '');
    expect(strip(en[0]!)).toBe(strip(it[0]!));
  });

  it('a brief with only the goal: the defaults in English', () => {
    const { brief } = completeBrief(
      { agent: 'Dione', goal: 'Three posts about the menu' },
      {
        request: 'Prepare 3 posts for the autumn menu, no emoji',
        user: 'Giulio',
        area: 'Inbox/Bozze',
      },
    );
    expect(brief).toEqual({
      goal: 'Three posts about the menu',
      why: 'Request from Giulio: “Prepare 3 posts for the autumn menu, no emoji”',
      doneWhen: 'the result is saved in Inbox/Bozze/ and the report is ready',
    });
    const none = completeBrief(
      { agent: 'Dione', goal: 'A post' },
      { request: 'Something else entirely' },
    );
    expect(none.brief.why).toBe('Request from the user: “Something else entirely”');
    expect(none.brief.doneWhen).toBe('the report is ready');
  });

  it('the subtask the level is asked on and the cut summary', () => {
    const input = {
      agent: 'Dione',
      goal: 'A post',
      why: 'for Friday',
      constraints: ['short', 'no emoji'],
      output_format: 'the text',
      done_when: 'saved',
    };
    expect(subtaskText(input)).toBe(
      'A post\nWhy: for Friday\nConstraints: short; no emoji\nResult: the text\nDone when: saved',
    );
    setAppLang('it');
    expect(subtaskText(input)).toBe(
      'A post\nPerché: for Friday\nVincoli: short; no emoji\nRisultato: the text\nFinito quando: saved',
    );
    const long = `${'word. '.repeat(1000)}`;
    expect(
      truncateSummary(long, 100).text.endsWith('[…riassunto tagliato: i dettagli sono nelle note]'),
    ).toBe(true);
    setAppLang('en');
    expect(
      truncateSummary(long, 100).text.endsWith('[…summary cut: the details are in the notes]'),
    ).toBe(true);
  });

  it('the words of a consequential choice are read in English too', () => {
    const asked = [
      {
        from: 'titan',
        options: [
          { id: '1', label: 'A' },
          { id: '2', label: 'B' },
        ],
        status: 'answered',
      },
    ] as never;
    const next = (question: string) => ({
      question,
      options: [
        { id: '1', label: 'Warm' },
        { id: '2', label: 'Short' },
      ],
    });
    expect(earlierChoice(asked, 'titan', next('Which tone for the post?'))).toBeDefined();
    for (const q of [
      'Do I cancel the order?',
      'Can I purchase the plan?',
      'Send it to the client?',
    ]) {
      expect(earlierChoice(asked, 'titan', next(q)), q).toBeUndefined();
    }
    expect(earlierChoice(asked, 'titan', next('Posso cancellare l’ordine?'))).toBeUndefined();
  });

  it('a request to undo or recover is read in English too', () => {
    for (const r of [
      'Roll back the last edit',
      'Bring back the previous version',
      'Recover the deleted note',
    ]) {
      expect(needsRareTools(r), r).toBe(true);
    }
    expect(needsRareTools('Annulla l’ultima modifica')).toBe(true);
    expect(needsRareTools('Write a post')).toBe(false);
  });
});

describe('the answer to a question with options, in English', () => {
  const options = [
    { id: '1', label: 'Yes, go ahead' },
    { id: '2', label: 'No' },
    { id: '3', label: 'Later' },
  ];
  const q = { options };

  it('reads a short English message as the answer', () => {
    for (const text of [
      'yes',
      'Yeah, sure',
      'the first one',
      'I choose the second',
      'sounds good',
      'option 3',
      'none',
      'no thanks',
    ]) {
      expect(readsAsAnswer(q, text), text).toBe(true);
    }
    expect(readsAsAnswer(q, 'Please write a longer report about the new menu for next week')).toBe(
      false,
    );
    expect(readsAsAnswer(q, 'Which one is better?')).toBe(false);
    expect(readsAsAnswer(q, 'sì')).toBe(true);
    expect(readsAsAnswer(q, 'la seconda')).toBe(true);
  });

  it('picks the option for sure only for a plain yes or no, in English too', () => {
    for (const text of [
      'yes',
      'Yes please',
      'yeah',
      'sure',
      'go ahead',
      'do it',
      'sounds good',
      'of course',
      'all right',
    ]) {
      expect(pickedOption(q, text), text).toBe('1');
    }
    for (const text of ['no', 'No.', 'cancel', 'never mind', "don't do", 'not now']) {
      expect(pickedOption(q, text), text).toBe('2');
    }
    // A condition or a request is not an approval.
    for (const text of [
      'yes but not to Marco',
      'yes, only if it is short',
      'ok however first check the date',
    ]) {
      expect(pickedOption(q, text), text).toBeUndefined();
    }
    // Ordinals and the last one.
    expect(pickedOption(q, 'the first')).toBe('1');
    expect(pickedOption(q, 'I choose the second')).toBe('2');
    expect(pickedOption(q, 'the last')).toBe('3');
    // The Italian still works.
    expect(pickedOption(q, 'sì')).toBe('1');
    expect(pickedOption(q, 'va bene')).toBe('1');
    expect(pickedOption(q, 'annulla')).toBe('2');
    expect(pickedOption(q, 'la terza')).toBe('3');
    expect(pickedOption(q, 'scelgo la terza')).toBe('3');
  });
});

describe('the spending cap reason', () => {
  it('follows the language', () => {
    const t = teamSpendStrings();
    expect(t.capReached(t.squadCap, 'for today', '€10')).toBe(
      'reached all monsters’ spending cap for today (€10)',
    );
    expect(t.capReached(t.agentCap('Rhea'), 'for today', '€1')).toBe(
      'reached Rhea’s spending cap for today (€1)',
    );
    expect(t.capReached(t.projectCap('Saturday'), 'for this month', '€5')).toBe(
      'reached the “Saturday” project’s spending cap for this month (€5)',
    );
    setAppLang('it');
    const it = teamSpendStrings();
    expect(it.capReached(it.squadCap, 'di oggi', '10 €')).toBe(
      'raggiunto il tetto di spesa di tutti i mostri di oggi (10 €)',
    );
    expect(it.capReached(it.agentCap('Rhea'), 'di oggi', '1 €')).toBe(
      'raggiunto il tetto di spesa di Rhea di oggi (1 €)',
    );
    expect(it.capReached(it.projectCap('Saturday'), 'di oggi', '1 €')).toBe(
      'raggiunto il tetto di spesa del progetto Saturday di oggi (1 €)',
    );
  });
});

describe('the Telegram line before a message', () => {
  const origin = (over: Partial<TelegramOrigin> = {}): TelegramOrigin =>
    ({
      bot: 'b',
      chatId: 1,
      chatType: 'group',
      chatTitle: 'Saturday Team',
      sender: { id: 2, name: 'Livio' },
      owner: false,
      ...over,
    }) as TelegramOrigin;

  it('English: where and who', () => {
    expect(telegramLine(origin())).toBe(
      '[Telegram, group “Saturday Team”: Livio writes, a person in the group, not the user]',
    );
    expect(telegramLine(origin({ owner: true, chatType: 'private' }))).toBe(
      '[Telegram, private chat: Livio (the user) writes]',
    );
    expect(telegramPlace(origin({ chatTitle: '' }))).toBe('group “unnamed”');
    expect(telegramText(origin(), 'Hello')).toContain('\nHello');
  });

  it('Italian: byte for byte what it was', () => {
    setAppLang('it');
    expect(telegramLine(origin())).toBe(
      '[Telegram, gruppo «Saturday Team»: scrive Livio, una persona del gruppo, non l’utente]',
    );
    expect(telegramLine(origin({ owner: true, chatType: 'private' }))).toBe(
      '[Telegram, chat privata: scrive Livio (l’utente)]',
    );
    expect(telegramPlace(origin({ chatTitle: '' }))).toBe('gruppo «senza nome»');
  });
});

describe('the heading of a new MEMORY.md', () => {
  it('follows the language and is the same text the vault writes', () => {
    expect(teamPrompts().memoryIndex('Rhea')).toBe(
      '# Memory of Rhea\n\nShort index of Rhea’s memory: one line per item, with the link to the detail note.\n',
    );
    setAppLang('it');
    expect(teamPrompts().memoryIndex('Rhea')).toBe(
      '# Memoria di Rhea\n\nIndice corto della memoria di Rhea: una riga per voce, con il link alla nota di dettaglio.\n',
    );
  });
});

describe('the MEMORY.md the team service creates', () => {
  it('follows the app language at the moment, and an existing file is left as it is', async () => {
    const en = await startTestHub({}, { lang: 'en' });
    expect(await en.core.hub.team.memory('rhea')).toBe(
      '# Memory of Rhea\n\nShort index of Rhea’s memory: one line per item, with the link to the detail note.\n',
    );
    const it = await startTestHub({}, { lang: 'it' });
    expect(await it.core.hub.team.memory('rhea')).toBe(
      '# Memoria di Rhea\n\nIndice corto della memoria di Rhea: una riga per voce, con il link alla nota di dettaglio.\n',
    );
    // The language changes: the file written before is not rewritten.
    setAppLang('en');
    expect(await it.core.hub.team.memory('rhea')).toContain('# Memoria di Rhea');
  });
});
