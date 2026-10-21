import { createInterface } from 'node:readline';
import {
  StreamMessageSchema,
  type AgentSummary,
  type LogEvent,
  type StatusResponse,
} from '@monsters/shared';
import WebSocket from 'ws';
import { teamBanner } from './banner.ts';
import { replStrings } from './repl.strings.ts';
import {
  formatEvent,
  parseNewConversation,
  terminalSafe,
  type ChatIo,
  type CoreAccess,
} from './chat.ts';

/*
 * `monsters chat` without a message: an interactive chat in the terminal, the
 * way to use Monsters over SSH (D-014). Every line is a message (to the
 * orchestrator, `@Name` or `--to` for one agent); the agents' answers stream as
 * they are written; a question shows numbered options and a number answers
 * it. Commands (English first, the Italian names always accepted): /stop, /resume
 * (/riprendi), /new [@Name] (/nuova), /status (/stato), /answer <text> (/risposta), /help
 * (/aiuto), /quit (/esci). No browser needed (the first start still happens in the UI).
 */

export interface ReplIo extends ChatIo {
  /** Lines typed by the user (stdin). */
  input: NodeJS.ReadableStream;
  /** Raw output without a newline, for streamed text. Without it, answers print when complete. */
  write?: (text: string) => void;
  /** The input is a terminal: show a prompt. */
  tty?: boolean;
  /** Width of the terminal, for the picture of the team (default: stdout's, else 80). */
  columns?: number;
}

interface OpenQuestion {
  id: string;
  agent: string;
  options: { id: string; label: string }[];
}

function statusLines(s: StatusResponse, names: Map<string, string>): string[] {
  const t = replStrings();
  const out = [s.halted ? t.killEngaged(s.haltedReason ?? null) : t.killOff];
  if (s.runs.length === 0) out.push(t.nothingRunning);
  for (const r of s.runs) {
    const minutes = Math.max(0, Math.round((Date.now() - r.startedAt) / 60_000));
    out.push(t.runLine(names.get(r.agent) ?? r.agent, r.goal ?? t.working, minutes));
  }
  return out;
}

export async function cmdChatInteractive(
  options: { to?: string | undefined },
  access: CoreAccess,
  ttyIo: ReplIo,
): Promise<number> {
  const io = terminalSafe(ttyIo);
  const agents = (await access.request('GET', '/api/agents')) as unknown as AgentSummary[];
  const names = new Map(agents.map((a) => [a.id, a.name]));
  const topOf = new Map<string, string>();
  /** Runs started from this chat: leaving with Ctrl+D waits for them. */
  const mine = new Set<string>();
  const questions: OpenQuestion[] = [];
  let streaming: { runId: string; agent: string } | null = null;
  /** Runs whose current answer was streamed: its final message is not printed again. */
  const streamed = new Set<string>();
  let confirmResume = false;
  let runEnded: () => void = () => {};

  const endStream = () => {
    if (streaming && io.write) io.write('\n');
    streaming = null;
  };
  const say = (line: string) => {
    endStream();
    io.out(line);
  };

  const onEvent = (e: LogEvent) => {
    if (e.type === 'run' && e.runId) {
      if (e.data.status === 'started') topOf.set(e.runId, e.agent);
    }
    if (e.runId === null && e.type !== 'kill' && e.type !== 'resume') return;
    const top = (e.runId && topOf.get(e.runId)) || '';
    if (e.type === 'message' && e.agent === top && e.parentId === null && e.data.role === 'agent') {
      // Answers of the agent the user talks to, as they are written.
      if (e.data.partial && io.write) {
        if (streaming?.runId !== e.runId) {
          endStream();
          io.write(`\n${names.get(e.agent) ?? e.agent}: `);
          streaming = { runId: e.runId!, agent: e.agent };
        }
        streamed.add(e.runId!);
        io.write(e.data.text);
        return;
      }
      // The final message of a streamed answer: already on screen, even when
      // another line (a tool call) came in between.
      if (!e.data.partial && streamed.delete(e.runId!)) {
        if (streaming?.runId === e.runId) endStream();
        return;
      }
    }
    if (e.type === 'question') {
      questions.push({ id: e.data.questionId, agent: e.agent, options: e.data.options });
    } else if (e.type === 'answer' || e.type === 'question_expired') {
      const i = questions.findIndex((q) => q.id === e.data.questionId);
      if (i >= 0) questions.splice(i, 1);
    }
    let line = formatEvent(e, names, top, {
      answerHint: (q) => {
        const t = replStrings();
        const tail = q.blocking ? '' : t.meanwhile;
        return q.options.length > 0 ? t.answerWithNumber(tail) : t.answerWithText(tail);
      },
    });
    if (e.type === 'resume') line = replStrings().resumedBy(e.data.by);
    if (line !== null) say(line);
    if (e.type === 'run' && e.runId && e.data.status !== 'started') {
      topOf.delete(e.runId);
      if (mine.delete(e.runId) && e.agent === top) {
        say(replStrings().endOf(e.data.status));
      }
      runEnded();
    }
  };

  // The event stream, for the whole session.
  const wsUrl = `${access.url.replace(/^http/, 'ws')}/api/stream`;
  const ws = new WebSocket(wsUrl, { headers: { authorization: `Bearer ${access.token}` } });
  const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
  const hello = await new Promise<{ halted: boolean }>((resolve, reject) => {
    ws.once('error', (err) => reject(new Error(`stream: ${err.message}`)));
    // A socket closed before the hello, with no error, would leave this waiting forever.
    ws.once('close', () => reject(new Error('stream: the core closed the connection')));
    ws.on('message', (raw: Buffer) => {
      let json: unknown;
      try {
        json = JSON.parse(raw.toString());
      } catch {
        return;
      }
      const parsed = StreamMessageSchema.safeParse(json);
      if (!parsed.success) return;
      if (parsed.data.kind === 'hello') resolve({ halted: parsed.data.halted });
      else if (parsed.data.kind === 'event') onEvent(parsed.data.event);
    });
  });

  if (ttyIo.tty) {
    // The creatures are trusted output of the kit (with colours); names are cleaned there.
    const columns = ttyIo.columns ?? process.stdout.columns ?? 80;
    const color = !process.env['NO_COLOR'];
    const team = options.to ? agents.filter((a) => a.id === options.to) : agents;
    const banner = teamBanner(team.length > 0 ? team : agents, { columns, color });
    if (banner.length > 0) {
      for (const line of banner) ttyIo.out(line);
      ttyIo.out('');
    }
  }
  io.out(
    replStrings().chatWith(
      options.to ? (names.get(options.to) ?? options.to) : replStrings().yourTeam,
    ),
  );
  if (hello.halted) io.out(replStrings().haltedNotice);

  const call = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (err) {
      say(`! ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handle = async (raw: string): Promise<'quit' | void> => {
    const text = raw.trim();
    if (!text) return;
    if (confirmResume) {
      confirmResume = false;
      if (/^(y|yes|s|si|sì)$/i.test(text)) {
        await call(async () => {
          const s = await access.request('POST', '/api/resume');
          say(s['resumed'] ? replStrings().resumed : replStrings().notStopped);
        });
      } else {
        say(replStrings().stayStopped);
      }
      return;
    }
    const last = questions.at(-1);
    if (/^\d{1,2}$/.test(text) && last && last.options.length > 0) {
      const n = Number(text);
      const option = last.options[n - 1];
      if (!option) {
        say(replStrings().chooseNumber(last.options.length));
        return;
      }
      await call(async () => {
        await access.request('POST', `/api/questions/${last.id}/answer`, { optionId: option.id });
      });
      return;
    }
    const command = /^\/(\w+)(?:\s+([\s\S]*))?$/.exec(text);
    if (command && !parseNewConversation(text)) {
      const [, name, rest = ''] = command;
      // English names first; the Italian ones are always accepted.
      switch (name!.toLowerCase()) {
        case 'quit':
        case 'exit':
        case 'esci':
          return 'quit';
        case 'help':
        case 'aiuto':
          say(replStrings().help);
          return;
        case 'stop':
        case 'kill':
        case 'ferma':
          await call(async () => {
            const s = await access.request('POST', '/api/kill', {
              reason: '/stop from the terminal chat',
            });
            const report = s['report'] as
              { runsAborted: number; processesKilled: number } | undefined;
            say(replStrings().stopped(report?.runsAborted ?? 0, report?.processesKilled ?? 0));
          });
          return;
        case 'resume':
        case 'riprendi':
          confirmResume = true;
          say(replStrings().resumeAsk);
          return;
        case 'status':
        case 'stato':
          await call(async () => {
            const s = (await access.request('GET', '/api/status')) as unknown as StatusResponse;
            for (const l of statusLines(s, names)) say(l);
            if (questions.length > 0) say(replStrings().questionsWaiting(questions.length));
          });
          return;
        case 'answer':
        case 'a':
        case 'risposta':
        case 'r':
          if (!last) {
            say(replStrings().noQuestion);
            return;
          }
          if (!rest.trim()) {
            say(replStrings().writeAnswer);
            return;
          }
          await call(async () => {
            await access.request('POST', `/api/questions/${last.id}/answer`, { text: rest.trim() });
          });
          return;
        default:
          say(replStrings().unknownCommand(name!));
          return;
      }
    }
    const fresh = parseNewConversation(text, options.to);
    if (fresh) {
      await call(async () => {
        const res = (await access.request(
          'POST',
          '/api/conversations',
          fresh.to ? { to: fresh.to } : {},
        )) as {
          to?: string;
        };
        say(replStrings().newConversation(res.to ? (names.get(res.to) ?? res.to) : null));
      });
      return;
    }
    await call(async () => {
      const sent = (await access.request('POST', '/api/messages', {
        text,
        ...(options.to ? { to: options.to } : {}),
      })) as { runId: string; agent: string; queued: boolean; answered?: string };
      const who = names.get(sent.agent) ?? sent.agent;
      if (!topOf.has(sent.runId)) topOf.set(sent.runId, sent.agent);
      if (sent.answered) say(replStrings().answerSent(who));
      else if (sent.queued) say(replStrings().addedTo(who));
      else {
        mine.add(sent.runId);
        say(replStrings().isWorking(who));
      }
    });
  };

  const rl = createInterface({ input: io.input, terminal: false });
  const prompt = () => {
    if (io.tty && io.write) io.write('› ');
  };
  prompt();
  let quit = false;
  // One line at a time, in order: a /stop typed while a message is on its way waits only for it.
  let queue = Promise.resolve();
  const inputDone = new Promise<void>((resolve) => {
    rl.on('line', (line) => {
      queue = queue.then(async () => {
        if (quit) return;
        if ((await handle(line)) === 'quit') {
          quit = true;
          rl.close();
          return;
        }
        prompt();
      });
    });
    rl.once('close', () => resolve());
  });

  const lost = closed.then(() => 'lost' as const);
  let lostConnection =
    (await Promise.race([inputDone.then(() => 'input' as const), lost])) === 'lost';
  await queue;
  if (!lostConnection && !quit) {
    // End of the input (Ctrl+D, or a script piped in): wait for the work it started.
    while (mine.size > 0 && !lostConnection) {
      const ended = new Promise<void>((resolve) => (runEnded = resolve));
      lostConnection = (await Promise.race([ended.then(() => 'ok' as const), lost])) === 'lost';
    }
  }
  endStream();
  rl.close();
  if (ws.readyState === WebSocket.OPEN) ws.close();
  if (lostConnection) {
    io.err(replStrings().connectionLost);
    return 1;
  }
  return 0;
}
