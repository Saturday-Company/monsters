import { describeToolCall } from '@monsters/core';
import {
  StreamMessageSchema,
  type AgentSummary,
  type LogEvent,
  type Question,
  uiBlocksToText,
} from '@monsters/shared';
import WebSocket from 'ws';

/*
 * `monsters chat`, `monsters answer`, `monsters vault reindex`: talk to the
 * running core from a terminal (and over SSH, D-014). The chat sends one
 * message and prints the run as it happens, until it ends; `/nuova` (or `/new`)
 * starts a new conversation instead. Without a message, `monsters chat` is
 * interactive (repl.ts).
 */

export interface ChatIo {
  out: (line: string) => void;
  err: (line: string) => void;
}

export type CoreRequest = (
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
) => Promise<Record<string, unknown>>;

export interface CoreAccess {
  url: string;
  token: string;
  request: CoreRequest;
}

/**
 * Control characters other than newline and tab (C0, DEL, C1) and the bidi
 * overrides: agent text, questions and previews must never drive the terminal
 * (OSC 52 writes the clipboard of the computer the SSH session comes from,
 * OSC 8 hides links, CSI clears the screen, U+202E reorders what is shown).
 */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g;

export function stripControl(text: string): string {
  return text.replace(CONTROL, '');
}

/** The same output, with every line and chunk cleaned of control characters. */
export function terminalSafe<T extends ChatIo & { write?: (text: string) => void }>(io: T): T {
  const write = io.write;
  return {
    ...io,
    out: (line: string) => io.out(stripControl(line)),
    err: (line: string) => io.err(stripControl(line)),
    ...(write ? { write: (text: string) => write(stripControl(text)) } : {}),
  };
}

function firstLines(text: string, lines = 3, max = 300): string {
  const t = text.trim().split('\n').slice(0, lines).join('\n');
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

function indent(text: string, prefix = '  '): string {
  return text
    .split('\n')
    .map((l) => `${prefix}${l}`)
    .join('\n');
}

interface FormatOptions {
  /** How to answer a question (default: the `monsters answer` command). */
  answerHint?: (q: LogEvent<'question'>['data']) => string;
}

/** Turns log events into readable lines (one or more), or null to skip; never control characters. */
export function formatEvent(
  e: LogEvent,
  names: Map<string, string>,
  topAgent: string,
  options: FormatOptions = {},
): string | null {
  const line = describeEvent(e, names, topAgent, options);
  return line === null ? null : stripControl(line);
}

function describeEvent(
  e: LogEvent,
  names: Map<string, string>,
  topAgent: string,
  options: FormatOptions,
): string | null {
  const name = (id: string) => names.get(id) ?? id;
  const who = name(e.agent);
  switch (e.type) {
    case 'message': {
      // Only what agents say: the system reminders (D-025) are for the model.
      if (e.data.partial || e.agent === 'user' || e.data.role !== 'agent') return null;
      // Closing of an unfinished turn: the run event says what happened.
      if (e.data.status && !e.data.text.trim()) return null;
      if (e.parentId !== null && e.agent !== topAgent) return null;
      // A drawn block (```ui, D-162) is written as text here: the terminal cannot draw it.
      return `\n${who}: ${uiBlocksToText(e.data.text.trim())}\n`;
    }
    case 'delegation': {
      const to = name(e.data.to);
      switch (e.data.status) {
        case 'started':
          return `→ ${who} delegates to ${to}: ${e.data.goal}`;
        case 'completed':
          return `← ${to} finished:\n${indent(firstLines(uiBlocksToText(e.data.summary ?? '')), '    ')}`;
        case 'failed':
          return `! ${to} failed: ${e.data.error ?? 'error'}`;
        case 'aborted':
          return `■ ${to} stopped`;
      }
      return null;
    }
    case 'tool_call':
      if (e.data.tool === 'delegate' || e.data.tool === 'ask_user') return null;
      return `  · ${who}: ${describeToolCall(e.data.tool, e.data.input)}`;
    case 'tool_result':
      return e.data.ok ? null : `  ! ${who}: ${e.data.tool} failed (${e.data.error ?? ''})`;
    case 'vault_change':
      return `  ✎ ${who}: ${e.data.action} ${e.data.path}`;
    case 'decision':
      if (e.data.kind !== 'ask_or_proceed' || e.data.choice === 'ask_user') return null;
      return `  ${who} decided alone: ${e.data.choice} (${e.data.reason ?? e.data.decidedBy})`;
    case 'question': {
      const lines = [`\n? ${who} asks: ${e.data.question}`];
      for (const [i, o] of e.data.options.entries()) {
        const rec = o.id === e.data.recommended ? ' (recommended)' : '';
        lines.push(`   ${i + 1}) ${o.label}${rec}${o.description ? ` - ${o.description}` : ''}`);
      }
      const how = e.data.options.length > 0 ? '<number or text>' : '<text>';
      lines.push(
        options.answerHint?.(e.data) ??
          `   Answer with: monsters answer ${e.data.questionId} ${how}${e.data.blocking ? '' : ' (work goes on meanwhile)'}`,
      );
      return lines.join('\n');
    }
    case 'answer':
      return `  answer received${e.data.text ? `: ${e.data.text}` : ''}`;
    case 'question_expired':
      return `  question ${e.data.questionId} expired (${e.data.reason ?? 'no answer needed anymore'})`;
    case 'question_parked':
      return `  ${who} waits for your answer (question ${e.data.questionId}): the answer starts the work again`;
    case 'error':
      if (e.data.code === 'aborted') return null;
      return `! ${who}: ${e.data.message}`;
    case 'notice':
      return `  i ${e.data.message}`;
    case 'kill':
      return `■ kill switch (${e.data.by})${e.data.reason ? `: ${e.data.reason}` : ''}`;
    default:
      return null;
  }
}

/** Opens the event stream; resolves once the core has said hello. */
function openStream(
  access: CoreAccess,
  onEvent: (e: LogEvent) => void,
): Promise<{ ws: WebSocket; halted: boolean; closed: Promise<void> }> {
  const wsUrl = `${access.url.replace(/^http/, 'ws')}/api/stream`;
  const ws = new WebSocket(wsUrl, { headers: { authorization: `Bearer ${access.token}` } });
  const closed = new Promise<void>((resolve) => ws.once('close', () => resolve()));
  return new Promise((resolve, reject) => {
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
      const msg = parsed.data;
      if (msg.kind === 'hello') resolve({ ws, halted: msg.halted, closed });
      else if (msg.kind === 'event') onEvent(msg.event);
    });
  });
}

const NEW_CONVERSATION = /^\/(?:nuova|new)(?:\s+(.*))?$/i;

/**
 * `/nuova`, `/new`, `/nuova @Rhea`: the chat command that starts a new
 * conversation. Returns null for any other text, otherwise the agent named
 * after the command or with `--to` (undefined: every conversation).
 */
export function parseNewConversation(text: string, to?: string): { to: string | undefined } | null {
  const m = NEW_CONVERSATION.exec(text.trim());
  if (!m) return null;
  const named = m[1]?.trim().replace(/^@/, '');
  return { to: named || to || undefined };
}

async function newConversation(
  to: string | undefined,
  names: Map<string, string>,
  access: CoreAccess,
  io: ChatIo,
): Promise<number> {
  const res = (await access.request('POST', '/api/conversations', to ? { to } : {})) as {
    to?: string;
  };
  const who = res.to ? ` with ${names.get(res.to) ?? res.to}` : '';
  io.out(
    `New conversation started${who}: the earlier messages stay in the log, but the agents no longer see them.`,
  );
  return 0;
}

export async function cmdChat(
  text: string,
  options: { to?: string | undefined },
  access: CoreAccess,
  ttyIo: ChatIo,
): Promise<number> {
  const io = terminalSafe(ttyIo);
  const agents = (await access.request('GET', '/api/agents')) as unknown as AgentSummary[];
  const names = new Map(agents.map((a) => [a.id, a.name]));
  const fresh = parseNewConversation(text, options.to);
  if (fresh) return newConversation(fresh.to, names, access, io);

  let runId: string | undefined;
  let topAgent = '';
  const early: LogEvent[] = [];
  let requests = 0;
  const models = new Set<string>();
  let finish: (status: string) => void = () => {};
  const ended = new Promise<string>((resolve) => (finish = resolve));

  const handle = (e: LogEvent) => {
    if (e.runId !== runId) return;
    if (e.type === 'provider_usage') {
      requests++;
      models.add(e.data.model);
      return;
    }
    const line = formatEvent(e, names, topAgent);
    if (line !== null) io.out(line);
    if (e.type === 'run' && e.agent === topAgent && e.data.status !== 'started') {
      finish(e.data.status);
    }
  };

  const stream = await openStream(access, (e) => {
    if (runId === undefined) early.push(e);
    else handle(e);
  });
  try {
    if (stream.halted) io.err('Monsters is stopped (kill switch): run "monsters resume" first.');
    const sent = (await access.request('POST', '/api/messages', {
      text,
      ...(options.to ? { to: options.to } : {}),
    })) as { runId: string; agent: string; queued: boolean; answered?: string };
    runId = sent.runId;
    topAgent = sent.agent;
    const who = names.get(sent.agent) ?? sent.agent;
    io.out(
      sent.answered
        ? `(answer sent to the question that ${who}'s work was waiting for)`
        : sent.queued
          ? `(message added to the current work of ${who})`
          : `(${who} is working, run ${sent.runId})`,
    );
    for (const e of early.splice(0)) handle(e);
    const status = await Promise.race([ended, stream.closed.then(() => 'disconnected')]);
    const usage = requests > 0 ? ` · ${requests} model requests: ${[...models].join(', ')}` : '';
    io.out(`(end: ${status}${usage})`);
    // Waiting for the user (D-078): the turn ended well, the answer starts the next one.
    return status === 'completed' || status === 'waiting_user' ? 0 : 1;
  } finally {
    stream.ws.close();
  }
}

export async function cmdAnswer(args: string[], access: CoreAccess, io: ChatIo): Promise<number> {
  const [id, ...rest] = args;
  const reply = rest.join(' ').trim();
  if (!id || !reply) {
    io.err('Usage: monsters answer <question id> <option number or text>');
    return 2;
  }
  const body = /^[1-4]$/.test(reply) ? { optionId: reply } : { text: reply };
  const q = (await access.request(
    'POST',
    `/api/questions/${id}/answer`,
    body,
  )) as unknown as Question;
  const label = q.options.find((o) => o.id === q.answer?.optionId)?.label;
  io.out(`Answer sent: ${label ?? q.answer?.text ?? reply}`);
  return 0;
}

export async function cmdVault(args: string[], access: CoreAccess, io: ChatIo): Promise<number> {
  if (args[0] !== 'reindex') {
    io.err('Usage: monsters vault reindex');
    return 2;
  }
  const r = (await access.request('POST', '/api/vault/reindex')) as {
    files: number;
    ms: number;
    vault: string;
  };
  io.out(`Index rebuilt: ${r.files} files in ${r.ms} ms (${r.vault})`);
  return 0;
}
