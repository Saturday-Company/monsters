import { z } from 'zod';
import type { EventType, LogEvent } from './events.ts';
import { UlidSchema } from './ulid.ts';

/*
 * One page of a chat's history (D-173), in one request: `GET /api/chats/:agent/history`. The
 * same rule runs in the core, in the mock and, against a core without that route, in the web
 * client over `/api/events`: the monster's own events (every kind), and in the same span what
 * the chat shows of the others (`CHAT_EVENT_TYPES`) and the user's messages. The chat is then
 * complete down to the newest edge of the pages that came back full.
 *
 * The previous conversations of a chat (the chat plan of 27/10): "New conversation"
 * (`new_conversation`, a general one or one for this monster) closes one, and it can be read
 * again, read-only:
 *
 *   GET /api/chats/:agent/conversations?before=&limit=      → ChatConversationsResponse
 *   GET /api/chats/:agent/conversations/:id/history?before= → ChatHistoryResponse
 *
 * A conversation's id is the `new_conversation` event that closed it; its history is the same
 * page as the chat's, between the boundary that opened it and that one (both left out).
 * Errors: 404 `unknown_conversation` (not a boundary of this chat), 400 `invalid_request`.
 */

/** One page of a chat's own history: its monster's events, of every kind. */
export const CHAT_PAGE = 300;
/** The pages of what the chats of other monsters bring along (delegations, questions…). */
export const CHAT_AROUND_PAGE = 1000;

/**
 * What a chat shows besides its own monster's events: a task given by the lead, a question
 * asked by a monster working for this chat, a file, a stop, a receipt… They are rare kinds, so
 * one page of them covers a long time (the streamed words are never among them).
 */
export const CHAT_EVENT_TYPES: readonly EventType[] = [
  'run',
  'delegation',
  'question',
  'answer',
  'question_expired',
  'question_parked',
  'new_conversation',
  'kill',
  'resume',
  'instinct',
  'security',
  'spend',
  'monster_proposal',
  'preview',
  'file',
  'project_report',
  'receipt',
  'vault_change',
  'error',
];

export const ChatHistoryQuerySchema = z.object({
  /** The page before this id (the `floor` of the previous page); the newest without it. */
  before: UlidSchema.optional(),
});

export const ChatHistoryResponseSchema = z.object({
  /** The events of the page, newest first, each once. */
  events: z.array(z.unknown()),
  /** Everything of this chat newer than this id is in the pages so far; null: nothing older. */
  floor: UlidSchema.nullable(),
  /** How many events of the chat's own monster came (0: nothing older of it). */
  own: z.number().int().nonnegative(),
});
export type ChatHistoryResponse = z.infer<typeof ChatHistoryResponseSchema>;

/** A query of the log as `/api/events` takes it. */
export interface ChatHistoryQuery {
  agent?: string[];
  type?: string[];
  before?: string;
  after?: string;
  limit: number;
  order: 'desc' | 'asc';
}

/** The first query of a page: the monster's own events, of every kind (newer than `after`). */
export function chatOwnQuery(
  agent: string,
  before: string | undefined,
  after?: string,
): ChatHistoryQuery {
  return {
    agent: [agent],
    limit: CHAT_PAGE,
    order: 'desc',
    ...(before ? { before } : {}),
    ...(after ? { after } : {}),
  };
}

/** The two queries of the same span (down to the edge of the own page when it came back full). */
export function chatAroundQueries(
  own: readonly { id: string }[],
  before: string | undefined,
  after?: string,
): [ChatHistoryQuery, ChatHistoryQuery] {
  const cut = own.length >= CHAT_PAGE ? own.at(-1)!.id : (after ?? null);
  const span = {
    ...(before ? { before } : {}),
    ...(cut ? { after: cut } : {}),
    order: 'desc' as const,
  };
  return [
    { ...span, type: [...CHAT_EVENT_TYPES], limit: CHAT_AROUND_PAGE },
    { ...span, agent: ['user'], type: ['message'], limit: CHAT_AROUND_PAGE },
  ];
}

/** The page from the three answers: each event once, newest first, and how far it is complete. */
export function chatHistoryMerge<E extends { id: string }>(
  own: readonly E[],
  around: readonly E[],
  words: readonly E[],
): { events: E[]; floor: string | null; own: number } {
  let floor = own.length >= CHAT_PAGE ? own.at(-1)!.id : null;
  for (const page of [around, words]) {
    const edge = page.length >= CHAT_AROUND_PAGE ? page.at(-1)!.id : null;
    if (edge && (floor === null || edge > floor)) floor = edge;
  }
  const byId = new Map<string, E>();
  for (const e of [...own, ...around, ...words]) byId.set(e.id, e);
  const events = [...byId.values()].sort((a, b) => (a.id < b.id ? 1 : a.id > b.id ? -1 : 0));
  return { events, floor, own: own.length };
}

/**
 * One page of a chat's history from a query of the log (the core's, the mock's). With `after`
 * (a previous conversation): nothing older than that id, and a null `floor` is its start.
 */
export function chatHistoryPage<E extends { id: string }>(
  agent: string,
  before: string | undefined,
  query: (q: ChatHistoryQuery) => readonly E[],
  after?: string,
): { events: E[]; floor: string | null; own: number } {
  const own = query(chatOwnQuery(agent, before, after));
  const [around, words] = chatAroundQueries(own, before, after);
  return chatHistoryMerge(own, query(around), query(words));
}

// --- previous conversations -------------------------------------------------------------------

/** At most this many conversations in one page of the list. */
export const CHAT_CONVERSATIONS_PAGE = 50;
/** The title of a conversation: its first message, on one line, cut at this length. */
export const CHAT_CONVERSATION_TITLE = 120;

export const ChatConversationsQuerySchema = z.object({
  /** The conversations older than this one (the `next` of the previous page). */
  before: UlidSchema.optional(),
  limit: z.coerce.number().int().min(1).max(CHAT_CONVERSATIONS_PAGE).optional(),
});

/** One previous conversation of a chat. */
export const ChatConversationSchema = z.object({
  /** The `new_conversation` event that closed it: the conversation's id. */
  id: UlidSchema,
  /** The `new_conversation` event that opened it; null: the chat's first conversation. */
  openedBy: UlidSchema.nullable(),
  /** Its first message (or task), epoch ms. */
  startedAt: z.number(),
  /** Its latest event of the chat, epoch ms. */
  endedAt: z.number(),
  /** When "New conversation" closed it, epoch ms. */
  closedAt: z.number(),
  /**
   * The user's first message to the monster, on one line, cut at 120 characters; without one,
   * the objective of an automation or a task delegated to it. Empty when that first message
   * had only files.
   */
  title: z.string(),
  /** Messages the user wrote to the monster in it (automations, Telegram and monsters apart). */
  messages: z.number().int().nonnegative(),
});
export type ChatConversation = z.infer<typeof ChatConversationSchema>;

export const ChatConversationsResponseSchema = z.object({
  /** Newest first. A span with nothing of this chat in it is left out. */
  conversations: z.array(ChatConversationSchema),
  /** Pass it as `before` for the older ones; null: there are none. */
  next: UlidSchema.nullable(),
});
export type ChatConversationsResponse = z.infer<typeof ChatConversationsResponseSchema>;

/** A boundary of `agent`'s conversations: a general "New conversation", or one for it. */
export function isConversationBoundary(e: LogEvent, agent: string): boolean {
  return e.type === 'new_conversation' && (e.data.to === undefined || e.data.to === agent);
}

/** A message the user typed to the monster in its chat (not an automation's, not Telegram's). */
function typedTo(e: LogEvent, agent: string): e is LogEvent<'message'> {
  return (
    e.type === 'message' &&
    e.data.role === 'user' &&
    e.data.to === agent &&
    e.data.channel !== 'automation' &&
    e.data.telegram === undefined &&
    e.data.from === undefined
  );
}

function titleOf(text: string): string {
  const line = text.replace(/\s+/g, ' ').trim();
  return line.length <= CHAT_CONVERSATION_TITLE
    ? line
    : `${line.slice(0, CHAT_CONVERSATION_TITLE - 1).trimEnd()}…`;
}

type Query = (q: ChatHistoryQuery) => readonly LogEvent[];

const BOUNDARY_PAGE = 200;
/** The events of one kind read in a conversation's span (the count of messages stops there). */
const SPAN_PAGE = 1000;

/** The boundaries of the chat older than `before`, newest first, at most `count`. */
function boundaries(agent: string, before: string | undefined, count: number, query: Query) {
  const out: LogEvent[] = [];
  let cursor = before;
  while (out.length < count) {
    const page = query({
      agent: ['user'],
      type: ['new_conversation'],
      limit: BOUNDARY_PAGE,
      order: 'desc',
      ...(cursor ? { before: cursor } : {}),
    });
    for (const e of page) {
      if (out.length < count && isConversationBoundary(e, agent)) out.push(e);
    }
    if (page.length < BOUNDARY_PAGE) break;
    cursor = page.at(-1)!.id;
  }
  return out;
}

/** The list's line for the span between two boundaries; null when the chat had nothing in it. */
function summarize(
  agent: string,
  close: LogEvent,
  open: LogEvent | undefined,
  query: Query,
): ChatConversation | null {
  const span = { before: close.id, ...(open ? { after: open.id } : {}) };
  const words = query({
    ...span,
    agent: ['user'],
    type: ['message'],
    limit: SPAN_PAGE,
    order: 'asc',
  });
  const typed = words.filter((e) => typedTo(e, agent));
  // Nothing typed: the objective of an automation, else a task delegated to the monster.
  const lead: LogEvent | undefined =
    typed[0] ??
    words.find(
      (e) => e.type === 'message' && e.data.to === agent && e.data.channel === 'automation',
    ) ??
    query({ ...span, type: ['delegation'], limit: SPAN_PAGE, order: 'asc' }).find(
      (e) => e.type === 'delegation' && e.data.to === agent && e.data.status === 'started',
    );
  if (!lead) return null;
  const text =
    lead.type === 'delegation' ? lead.data.goal : lead.type === 'message' ? lead.data.text : '';
  const first = query({ ...span, agent: [agent], limit: 1, order: 'asc' })[0];
  const last = query({ ...span, agent: [agent], limit: 1, order: 'desc' })[0];
  return {
    id: close.id,
    openedBy: open?.id ?? null,
    startedAt: Math.min(lead.ts, first?.ts ?? lead.ts),
    endedAt: Math.max(lead.ts, last?.ts ?? 0, typed.at(-1)?.ts ?? 0),
    closedAt: close.ts,
    title: titleOf(text),
    messages: typed.length,
  };
}

/**
 * One page of the previous conversations of a chat, newest first (the core's and the mock's).
 * The current conversation, after the latest boundary, is not among them.
 */
export function chatConversations(
  agent: string,
  params: { before?: string | undefined; limit?: number | undefined },
  query: Query,
): ChatConversationsResponse {
  const limit = Math.min(params.limit ?? CHAT_CONVERSATIONS_PAGE, CHAT_CONVERSATIONS_PAGE);
  const conversations: ChatConversation[] = [];
  let cursor = params.before;
  let more = true;
  while (conversations.length < limit && more) {
    const wanted = limit - conversations.length;
    // One boundary more than the conversations wanted: the one that opened the oldest.
    const batch = boundaries(agent, cursor, wanted + 1, query);
    more = batch.length > wanted;
    const closing = more ? batch.slice(0, wanted) : batch;
    for (const [i, close] of closing.entries()) {
      const c = summarize(agent, close, batch[i + 1], query);
      if (c) conversations.push(c);
    }
    if (closing.length === 0) break;
    cursor = closing.at(-1)!.id;
  }
  return { conversations, next: more && cursor ? cursor : null };
}

/**
 * The span of one previous conversation (`id`: the boundary that closed it) for its history;
 * null when `id` is not a boundary of this chat. `get` reads one event by id.
 */
export function chatConversationSpan(
  agent: string,
  id: string,
  get: (id: string) => LogEvent | undefined,
  query: Query,
): { before: string; after: string | undefined } | null {
  const close = get(id);
  if (!close || !isConversationBoundary(close, agent)) return null;
  const open = boundaries(agent, id, 1, query)[0];
  return { before: id, after: open?.id };
}
