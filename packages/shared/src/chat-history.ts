import { z } from 'zod';
import type { EventType } from './events.ts';
import { UlidSchema } from './ulid.ts';

/*
 * One page of a chat's history (D-173), in one request: `GET /api/chats/:agent/history`. The
 * same rule runs in the core, in the mock and, against a core without that route, in the web
 * client over `/api/events`: the monster's own events (every kind), and in the same span what
 * the chat shows of the others (`CHAT_EVENT_TYPES`) and the user's messages. The chat is then
 * complete down to the newest edge of the pages that came back full.
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
  order: 'desc';
}

/** The first query of a page: the monster's own events, of every kind. */
export function chatOwnQuery(agent: string, before: string | undefined): ChatHistoryQuery {
  return { agent: [agent], limit: CHAT_PAGE, order: 'desc', ...(before ? { before } : {}) };
}

/** The two queries of the same span (down to the edge of the own page when it came back full). */
export function chatAroundQueries(
  own: readonly { id: string }[],
  before: string | undefined,
): [ChatHistoryQuery, ChatHistoryQuery] {
  const cut = own.length >= CHAT_PAGE ? own.at(-1)!.id : null;
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

/** One page of a chat's history from a query of the log (the core's, the mock's). */
export function chatHistoryPage<E extends { id: string }>(
  agent: string,
  before: string | undefined,
  query: (q: ChatHistoryQuery) => readonly E[],
): { events: E[]; floor: string | null; own: number } {
  const own = query(chatOwnQuery(agent, before));
  const [around, words] = chatAroundQueries(own, before);
  return chatHistoryMerge(own, query(around), query(words));
}
