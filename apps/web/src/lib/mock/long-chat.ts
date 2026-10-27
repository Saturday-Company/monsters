import type { EventInput, LogEvent, Question } from '@monsters/shared';
import { tr } from './lang.ts';

/*
 * A long chat for measuring the transcript (`?mockChat=1500`, stream J): N turns of mixed content
 * in the orchestrator's chat, spread over the days before the demo's own: bubbles with markdown,
 * tables, code, drawn ui blocks, a picture, work strips with steps and a delegation, answered
 * questions. Deterministic (turn i always looks the same), so two measurements compare.
 */

type Append = (input: EventInput, ts: number) => LogEvent;

interface LongChatDeps {
  append: Append;
  /** The browser screenshot of the demo's files, logged as made in the run. */
  screenshot: (agent: string, runId: string, ts: number) => void;
  questions: Map<string, Question>;
}

const ASKS = [
  'What do I have tomorrow morning?',
  'Summarise the notes of the last meeting with the printer, in three points.',
  'Find a cheaper flight to Lisbon for next month, Friday evening if possible.',
  'Draft a short reply to Marta: yes for Thursday, but after 3 pm.',
  'How did the newsletter do this week compared with last week?',
  'Can you check the shop’s opening hours on Sunday?\nAnd whether they take bookings.',
  'Make me a table of the subscriptions we pay each month.',
  'Write the regex for an Italian VAT number.',
];

const PARAGRAPH =
  'I went through the notes of the week and the calendar. Nothing clashes, but the afternoon of Thursday is tight: the call with the printer runs until 4 pm and the dentist is at 4:30, twenty minutes away.';

const REPLIES: ((i: number) => string)[] = [
  (i) =>
    `${PARAGRAPH}\n\n- **9:30** stand-up with the team\n- **11:00** review of the site (#${i})\n- **15:00** call with the printer`,
  () =>
    `Three points from the meeting:\n\n1. The paper changes to 120 g, same price.\n2. Delivery moves to the **14th**.\n3. They want the files in PDF/X-4, not PNG.\n\nI saved them in *Meetings/Printer*.`,
  () =>
    `The cheapest one leaves on Friday at 19:40 and costs **86 €** return. Two others:\n\n| Flight | Leaves | Back | Price |\n| --- | --- | --- | ---: |\n| TP 813 | Fri 19:40 | Sun 21:10 | 86 € |\n| FR 4521 | Fri 21:05 | Mon 06:30 | 64 € |\n| U2 7721 | Sat 07:15 | Sun 22:40 | 112 € |\n\nThe second is cheaper, but you’d land after midnight.`,
  () =>
    `Here is a draft:\n\n> Hi Marta, Thursday works for me, but only after 3 pm: does 3:30 suit you? Talk soon.\n\nIt’s in your drafts, not sent.`,
  () =>
    `The week went well.\n\n\`\`\`ui\nroot = Block([stats, bars])\nstats = Stats([Stat("Opened", "48%", "+6%", "up"), Stat("Clicks", "9.1%", "-1%", "down"), Stat("Unsubscribed", "3", "same as last week", "flat")])\nbars = BarChart(["Mon", "Tue", "Wed", "Thu", "Fri"], [{label: "This week", values: [120, 310, 260, 180, 90]}, {label: "Last week", values: [100, 280, 240, 200, 70]}], "Opens by day")\n\`\`\`\n\nTuesday is still the best day to send it.`,
  () =>
    `It’s open on Sunday from 10 to 13 and they take bookings by phone only. I looked at their site and at the page on the map: the hours match.`,
  () =>
    `\`\`\`ui\nroot = Block([t])\nt = Table(["Service", "Monthly", "Renews"], [["Notion", 10, "3rd"], ["Figma", 15, "9th"], ["Google Workspace", 12, "1st"], ["Domain", 1.5, "every year"]], "Subscriptions")\n\`\`\`\n\nAbout **38.5 €** a month in all.`,
  () =>
    'This one checks the 11 digits and the IT prefix, if there:\n\n```ts\nconst VAT = /^(IT)?\\d{11}$/;\nVAT.test("IT01234567890"); // true\n```\n\nIt doesn’t check the control digit: tell me if you need that too.',
];

/**
 * Logs `turns` turns of the orchestrator's chat between `from` and `to` (ms), oldest first.
 * Every 9th turn delegates to Rhea, every 7th logs a picture, every 25th asks a question that
 * was answered; most turns have one to three steps, so their strip has something to open.
 */
export function seedLongChat(
  deps: LongChatDeps,
  orch: string,
  turns: number,
  from: number,
  to: number,
): void {
  const { append, screenshot, questions } = deps;
  const span = Math.max(1, to - from);
  const gap = span / Math.max(1, turns);
  for (let i = 0; i < turns; i++) {
    let t = from + Math.floor(i * gap);
    const at = (ms: number) => (t += ms);
    const runId = `run_long_${String(i).padStart(5, '0')}`;
    const ask = ASKS[i % ASKS.length]!;
    append(
      {
        agent: 'user',
        runId,
        type: 'message',
        data: { role: 'user', text: ask, to: orch, channel: 'ui' },
      },
      at(0),
    );
    append({ agent: orch, runId, type: 'run', data: { status: 'started', goal: ask } }, at(400));
    const steps = i % 4;
    for (let s = 0; s < steps; s++) {
      const callId = `l${i}_${s}`;
      const tool = s % 2 === 0 ? 'web_search' : 'vault_read';
      append(
        {
          agent: orch,
          runId,
          type: 'tool_call',
          data: {
            callId,
            tool,
            input:
              tool === 'web_search'
                ? { query: `${ask.slice(0, 40)} ${s}` }
                : { path: 'Meetings/Printer.md' },
          },
        },
        at(300),
      );
      append(
        {
          agent: orch,
          runId,
          type: 'tool_result',
          data: { callId, tool, ok: true, durationMs: 420 },
        },
        at(500),
      );
    }
    if (i % 9 === 4) {
      const goal = tr('Check the sources of the reply', 'Controlla le fonti della risposta');
      append(
        {
          agent: orch,
          runId,
          type: 'tool_call',
          data: { callId: `d${i}`, tool: 'delegate', input: { to: 'rhea', goal } },
        },
        at(200),
      );
      const del = append(
        {
          agent: orch,
          runId,
          type: 'delegation',
          data: { from: orch, to: 'rhea', status: 'started', goal },
        },
        at(50),
      );
      append(
        {
          agent: 'rhea',
          runId,
          parentId: del.id,
          type: 'tool_call',
          data: { callId: `dr${i}`, tool: 'web_fetch', input: { url: 'https://example.org/' } },
        },
        at(400),
      );
      append(
        {
          agent: orch,
          runId,
          type: 'delegation',
          data: {
            from: orch,
            to: 'rhea',
            status: 'completed',
            goal,
            summary: tr('The sources hold', 'Le fonti reggono'),
          },
        },
        at(2_000),
      );
    }
    if (i % 25 === 12) {
      const questionId = `q_long_${i}`;
      const options = [
        { id: 'a', label: tr('Book it', 'Prenota') },
        { id: 'b', label: tr('Just keep the list', 'Tieni solo la lista') },
      ];
      const question = tr('Shall I book the cheapest one?', 'Prenoto il più economico?');
      const createdAt = at(300);
      append(
        {
          agent: orch,
          runId,
          type: 'question',
          data: { questionId, question, options, blocking: true },
        },
        createdAt,
      );
      append(
        {
          agent: 'user',
          runId,
          type: 'answer',
          data: { questionId, optionId: 'b', channel: 'ui' },
        },
        at(20_000),
      );
      questions.set(questionId, {
        id: questionId,
        from: orch,
        runId,
        question,
        options,
        blocking: true,
        status: 'answered',
        createdAt,
        answer: { optionId: 'b' },
      });
    }
    if (i % 7 === 3) screenshot(orch, runId, at(300));
    append(
      {
        agent: orch,
        runId,
        type: 'message',
        data: { role: 'agent', text: REPLIES[i % REPLIES.length]!(i) },
      },
      at(1_500),
    );
    append({ agent: orch, runId, type: 'run', data: { status: 'completed' } }, at(100));
  }
}
