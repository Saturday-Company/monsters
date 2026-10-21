import { isAgentMemoryPath, type FileMeta, type LogEvent } from '@monsters/shared';
import { attachmentsLine } from '../files/model-input.ts';
import type { ModelMessage } from 'ai';
import { automationRuns } from '../automations/run-index.ts';
import { telegramText } from '../channels/telegram/lines.ts';
import { threadRuns } from '../channels/telegram/threads.ts';
import type { EventLog } from '../log/event-log.ts';
import { fromLine } from '../projects/lines.ts';
import { conversationPrompts } from './conversation.prompts.ts';
import type { QuestionStore } from './questions.ts';

/*
 * Recent conversation of one agent, rebuilt from the event log (the state lives
 * in the log, not in the model context): the user's messages to the agent, the
 * agent's final answers, the user's answers to its questions and to its
 * proposals of new monsters (D-075), and for the orchestrator the reports of
 * the projects' leads it sent work to (D-097). It never goes back past the latest
 * `new_conversation` event that applies to the agent. The runs of an
 * automation are not part of it (D-094), nor those of the Telegram chats of a
 * dedicated bot (D-107): they have their own history (`runs`).
 */

const MAX_TURN_CHARS = 4000;
const PAGE = 500;
const MAX_PAGES = 6;
/** Paths listed after an answer: the notes a later turn is likely to ask about. */
const MAX_NOTE_PATHS = 8;

function clip(text: string): string {
  return text.length > MAX_TURN_CHARS ? `${text.slice(0, MAX_TURN_CHARS)}…` : text;
}

/** What the orchestrator reads of a lead's report (D-097). */
export function projectReportText(d: {
  project: string;
  status: string;
  summary: string;
  leadName: string;
  projectName: string;
}): string {
  const t = conversationPrompts();
  return t.projectReport(d.projectName, d.leadName, t.reportStatus(d.status), d.summary);
}

export interface ConversationOptions {
  agentId: string;
  /** The orchestrator also receives the user's messages without an addressee. */
  isOrchestrator: boolean;
  /** Only events before this id (exclusive). */
  before?: string | undefined;
  /** Events to leave out (the messages the agent is about to receive as its task). */
  exclude?: ReadonlySet<string> | undefined;
  /** Max turns (user + agent). */
  turns: number;
  /** The files of past messages, by id: they become a line with their names, never the bytes. */
  files?: (ids: readonly string[]) => FileMeta[];
  /**
   * Only the events of these runs: the earlier runs of a giro of an
   * automation (D-094), whatever `new_conversation` says.
   */
  runs?: ReadonlySet<string> | undefined;
  /** Names of monsters and projects, for the lines of `project_send` and its reports (D-097). */
  names?: ((id: string) => string) | undefined;
}

/** Text of a user's answer as the asking agent sees it. */
export function answerText(
  question: { question: string; options: { id: string; label: string }[] },
  answer: { optionId?: string | undefined; text?: string | undefined },
): string {
  const label = question.options.find((o) => o.id === answer.optionId)?.label;
  const parts = [label, answer.text].filter(Boolean).join(' — ');
  return conversationPrompts().answer(question.question, parts);
}

/** What the capo squadra reads of the user's answer to its proposal (D-075). */
export function proposalOutcomeText(d: { action: string; name?: string | undefined }): string {
  const t = conversationPrompts();
  const name = d.name ?? t.theMonster;
  return d.action === 'created' ? t.monsterCreated(name) : t.monsterDropped(name);
}

/** What the proposer reads of the user's answer to its draft of a project or an automation (D-098). */
export function draftOutcomeText(
  kind: 'project' | 'automation',
  action: 'confirmed' | 'discarded',
  name: string,
): string {
  const t = conversationPrompts();
  if (kind === 'project') {
    return action === 'confirmed' ? t.projectConfirmed(name) : t.projectDropped(name);
  }
  return action === 'confirmed' ? t.automationConfirmed(name) : t.automationDropped(name);
}

/** What the proposer reads of the user's answer to its change of CLAUDE.md or AGENTS.md (D-113). */
export function docsOutcomeText(d: { action: string; file: string; name: string }): string {
  const t = conversationPrompts();
  return d.action === 'applied' ? t.docsApplied(d.file, d.name) : t.docsDropped(d.file, d.name);
}

function toTurn(
  e: LogEvent,
  opts: ConversationOptions,
  questions: QuestionStore | undefined,
): ModelMessage | null {
  if (e.type === 'message') {
    const d = e.data;
    if (e.agent === 'user' && d.role === 'user') {
      const mine = d.to === opts.agentId || (d.to === undefined && opts.isOrchestrator);
      if (!mine) return null;
      // Written by the orchestrator with `project_send` (D-097): the lead reads who wrote it.
      if (d.from) {
        return {
          role: 'user',
          content: clip(`${fromLine(opts.names?.(d.from) ?? d.from)}\n\n${d.text}`),
        };
      }
      // Written to a dedicated bot (D-107): where and who, the user or a person of the group.
      if (d.telegram) return { role: 'user', content: clip(telegramText(d.telegram, d.text)) };
      if (!d.attachments?.length) return { role: 'user', content: clip(d.text) };
      const found = opts.files?.(d.attachments) ?? [];
      const line = attachmentsLine(found, d.attachments.length - found.length);
      return { role: 'user', content: [clip(d.text), line].filter(Boolean).join('\n\n') };
    }
    if (e.agent === opts.agentId && d.role === 'agent' && !d.partial && e.parentId === null) {
      return d.text.trim() ? { role: 'assistant', content: clip(d.text) } : null;
    }
    return null;
  }
  if (e.type === 'monster_proposal' && e.agent === 'user' && e.data.from === opts.agentId) {
    return { role: 'user', content: proposalOutcomeText(e.data) };
  }
  if (
    e.type === 'project_docs_proposal' &&
    e.agent === 'user' &&
    e.data.from === opts.agentId &&
    (e.data.action === 'applied' || e.data.action === 'discarded')
  ) {
    return { role: 'user', content: docsOutcomeText(e.data) };
  }
  if (
    (e.type === 'project_change' || e.type === 'automation_change') &&
    e.agent === 'user' &&
    e.data.from === opts.agentId &&
    (e.data.action === 'confirmed' || e.data.action === 'discarded')
  ) {
    const kind = e.type === 'project_change' ? 'project' : 'automation';
    return { role: 'user', content: draftOutcomeText(kind, e.data.action, e.data.name) };
  }
  if (e.type === 'project_report' && e.data.to === opts.agentId) {
    const name = (id: string) => opts.names?.(id) ?? id;
    return {
      role: 'user',
      content: clip(
        projectReportText({
          ...e.data,
          leadName: name(e.data.lead),
          projectName: name(`project:${e.data.project}`),
        }),
      ),
    };
  }
  if (e.type === 'answer' && questions) {
    const q = questions.get(e.data.questionId);
    if (!q || q.from !== opts.agentId) return null;
    return { role: 'user', content: clip(answerText(q, e.data)) };
  }
  return null;
}

/** The agent's final answer of a turn (not partial, not a delegated one). */
function isFinalAnswer(e: LogEvent, agentId: string): e is LogEvent<'message'> {
  return (
    e.type === 'message' &&
    e.agent === agentId &&
    e.data.role === 'agent' &&
    !e.data.partial &&
    e.parentId === null
  );
}

/** An agent's own file (`Agenti/<Name>/MEMORY.md` in the vault's layout): not a note of the work. */
const isAgentFile = (path: string) => isAgentMemoryPath(path);

/**
 * "[Note di questo lavoro: …]" for each final answer: the notes created or
 * changed in its run (by any agent of the run) since the previous answer of
 * the turn, from the log (AG-19). A later "accorcia il secondo post" then
 * finds the note without searching for it.
 */
function notesOfAnswers(
  log: EventLog,
  agentId: string,
  answers: readonly LogEvent<'message'>[],
): Map<string, string> {
  const out = new Map<string, string>();
  const runs = new Set(answers.map((a) => a.runId).filter((r): r is string => r !== null));
  for (const runId of runs) {
    const finals = log
      .query({ runId, type: 'message', agent: agentId, limit: 5000 })
      .filter((e) => isFinalAnswer(e, agentId));
    const changes = log.query({ runId, type: 'vault_change', limit: 5000 });
    let from = '';
    for (const answer of finals) {
      const paths: string[] = [];
      for (const c of changes) {
        if (c.id <= from || c.id >= answer.id || c.type !== 'vault_change') continue;
        const { action, path } = c.data;
        if (action === 'delete') {
          const i = paths.indexOf(path);
          if (i >= 0) paths.splice(i, 1);
          continue;
        }
        if (!['create', 'edit', 'move', 'restore'].includes(action) || isAgentFile(path)) continue;
        if (!paths.includes(path)) paths.push(path);
      }
      from = answer.id;
      if (paths.length === 0) continue;
      const shown = paths.slice(0, MAX_NOTE_PATHS).join(', ');
      const more = Math.max(0, paths.length - MAX_NOTE_PATHS);
      out.set(answer.id, conversationPrompts().notesOfJob(shown, more));
    }
  }
  return out;
}

/** True when a `new_conversation` event starts over the conversation of `agentId`. */
export function startsConversationOf(e: LogEvent, agentId: string): boolean {
  return e.type === 'new_conversation' && (e.data.to === undefined || e.data.to === agentId);
}

/**
 * Id of the latest `new_conversation` event that applies to the agent (a
 * general one, or one for that agent), before `before` when given; null when
 * the conversation never started over.
 */
export function conversationStart(log: EventLog, agentId: string, before?: string): string | null {
  let cursor = before;
  for (;;) {
    const events = log.query({
      type: 'new_conversation',
      agent: 'user',
      before: cursor,
      order: 'desc',
      limit: PAGE,
    });
    const hit = events.find((e) => startsConversationOf(e, agentId));
    if (hit) return hit.id;
    if (events.length < PAGE) return null;
    cursor = events.at(-1)?.id;
  }
}

/** One turn of the conversation with the event it comes from (C.3: what a summary covers). */
export interface ConversationTurn {
  /** The `message`, `answer` or `monster_proposal` event. */
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** The run the event belongs to (a summary of it is tainted when the run read third-party text). */
  runId?: string | null;
}

export interface ConversationTurnsOptions extends ConversationOptions {
  /** Only events after this id (exclusive): the end of a summary (D-082). */
  after?: string | undefined;
  /** The oldest `turns` instead of the newest (a backlog summarised in chunks, D-082). */
  oldest?: boolean;
}

/**
 * The newest `turns` turns since the start of the conversation (and after
 * `after`), oldest first, one per event, not merged; with `oldest`, the
 * oldest ones.
 */
export function conversationTurns(
  log: EventLog,
  questions: QuestionStore | undefined,
  opts: ConversationTurnsOptions,
): ConversationTurn[] {
  if (opts.turns <= 0) return [];
  if (opts.runs) return turnsOfRuns(log, questions, opts, opts.runs);
  const picked: ConversationTurn[] = [];
  const answers: { event: LogEvent<'message'>; turn: ConversationTurn }[] = [];
  // The runs of an automation stay out of the chat (D-094), and so do a dedicated bot's (D-107).
  const automation = automationRuns(log);
  const telegram = threadRuns(log);
  const start = conversationStart(log, opts.agentId, opts.before) ?? undefined;
  const after =
    opts.after !== undefined && (start === undefined || opts.after > start) ? opts.after : start;
  let before = opts.before;
  let from = after;
  for (let page = 0; page < MAX_PAGES && picked.length < opts.turns; page++) {
    const events = log.query({
      // `system`: the reports of the projects' leads (D-097).
      type: [
        'message',
        'answer',
        'monster_proposal',
        'project_report',
        'project_change',
        'automation_change',
        'project_docs_proposal',
      ],
      agent: ['user', 'system', opts.agentId],
      after: from,
      before,
      order: opts.oldest ? 'asc' : 'desc',
      limit: PAGE,
    });
    for (const e of events) {
      if (opts.exclude?.has(e.id) || automation(e.runId) || telegram(e.runId)) continue;
      const m = toTurn(e, opts, questions);
      if (!m) continue;
      const turn: ConversationTurn = {
        id: e.id,
        role: m.role as 'user' | 'assistant',
        content: m.content as string,
        runId: e.runId,
      };
      picked.push(turn);
      if (isFinalAnswer(e, opts.agentId)) answers.push({ event: e, turn });
      if (picked.length >= opts.turns) break;
    }
    if (events.length < PAGE) break;
    if (opts.oldest) from = events.at(-1)?.id;
    else before = events.at(-1)?.id;
  }
  const notes = notesOfAnswers(
    log,
    opts.agentId,
    answers.map((a) => a.event),
  );
  for (const { event, turn } of answers) {
    const line = notes.get(event.id);
    if (line) turn.content = `${turn.content}\n\n${line}`;
  }
  return opts.oldest ? picked : picked.reverse();
}

/** The turns of some runs only (a giro of an automation), oldest first, the newest `turns`. */
function turnsOfRuns(
  log: EventLog,
  questions: QuestionStore | undefined,
  opts: ConversationTurnsOptions,
  runs: ReadonlySet<string>,
): ConversationTurn[] {
  const events = [...runs]
    .flatMap((runId) =>
      log.query({ runId, type: ['message', 'answer', 'monster_proposal'], limit: 1000 }),
    )
    .filter((e) => e.agent === 'user' || e.agent === opts.agentId)
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const picked: ConversationTurn[] = [];
  for (const e of events) {
    if (opts.exclude?.has(e.id)) continue;
    if (opts.before !== undefined && e.id >= opts.before) continue;
    const m = toTurn(e, { ...opts, isOrchestrator: true }, questions);
    if (!m) continue;
    picked.push({
      id: e.id,
      role: m.role as 'user' | 'assistant',
      content: m.content as string,
      runId: e.runId,
    });
  }
  return picked.slice(-opts.turns);
}

/** Turns as model messages: consecutive turns of the same role are merged. */
export function mergeTurns(turns: readonly ConversationTurn[]): ModelMessage[] {
  const merged: ModelMessage[] = [];
  for (const t of turns) {
    const last = merged.at(-1);
    if (last && last.role === t.role && typeof last.content === 'string') {
      last.content = `${last.content}\n\n${t.content}`;
    } else {
      merged.push({ role: t.role, content: t.content });
    }
  }
  return merged;
}

/** Oldest first; consecutive turns of the same role are merged; starts with a user turn. */
export function recentConversation(
  log: EventLog,
  questions: QuestionStore | undefined,
  opts: ConversationOptions,
): ModelMessage[] {
  const merged = mergeTurns(conversationTurns(log, questions, opts));
  while (merged[0] && merged[0].role !== 'user') merged.shift();
  return merged;
}
