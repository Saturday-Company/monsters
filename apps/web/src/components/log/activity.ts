import type { DraftView, LogEvent } from '@monsters/shared';
import {
  agentFileOf,
  categoryOf,
  isQuietError,
  isStopText,
  type EventCategory,
} from '../../store/derive.ts';
import { isBrakeEvent } from '../../store/instinct.ts';
import { noteKey } from '../../lib/markdown.ts';
import { PATHS } from '../../lib/router.ts';
import { logStrings } from './log.strings.ts';

/*
 * Attività: what is shown by default, the filters, and the state of an undo
 * (undone, redone, undone again) read from the events. Pure functions, tested
 * without a browser.
 */

/** The three types of the filter row; the others are under "More filters". */
export function mainTypes(): { value: EventCategory; label: string }[] {
  const t = logStrings().types.main;
  return [
    { value: 'vault', label: t.vault },
    { value: 'questions', label: t.questions },
    { value: 'errors', label: t.errors },
  ];
}

export function otherTypes(): { value: EventCategory; label: string }[] {
  const t = logStrings().types.other;
  return [
    { value: 'messages', label: t.messages },
    { value: 'runs', label: t.runs },
    { value: 'delegations', label: t.delegations },
    { value: 'tools', label: t.tools },
    { value: 'instinct', label: t.instinct },
    { value: 'system', label: t.system },
  ];
}

/** Short name of a category, next to the time of a row. */
export function typeLabel(category: EventCategory): string {
  return logStrings().types.label[category];
}

/** Tools whose call changes something outside the notes: files, commands. */
const EFFECT_TOOLS = new Set(['shell', 'fs_write', 'fs_move', 'fs_delete']);

/** Changes made by the user or Monsters to the setup, worth seeing among the effects. */
const SETUP_EVENTS = new Set([
  'kill',
  'resume',
  'permissions',
  'mcp_server',
  'channel',
  'new_conversation',
  'team_change',
]);

/** Partial chunks are streaming noise: Attività keeps the final messages only. */
export function isLoggable(e: LogEvent): boolean {
  return !(e.type === 'message' && e.data.partial);
}

/** A failed tool call that is not a stop (shown as an error). */
export function isFailedTool(e: LogEvent): boolean {
  return e.type === 'tool_result' && !e.data.ok && !isStopText(e.data.error);
}

/**
 * Events with an effect, shown by default: changes to the notes (not the
 * monsters' own notes), files and commands, questions, errors, external tools,
 * changes to the setup, the orders removed from external texts, the brake and the drafts that wait for you. "Titan replied", "started a job" and
 * reading tools are under "Everything".
 */
export function hasEffect(e: LogEvent): boolean {
  switch (e.type) {
    case 'vault_change':
      return !agentFileOf(e.data.path);
    case 'tool_call':
      return EFFECT_TOOLS.has(e.data.tool) || e.data.tool.includes('__');
    case 'tool_result':
      return isFailedTool(e);
    case 'question':
    case 'answer':
    case 'question_expired':
    case 'question_parked':
      return true;
    case 'decision':
      return categoryOf(e) === 'questions';
    case 'error':
      return !isQuietError(e) && categoryOf(e) === 'errors';
    // News from Monsters itself (a retired model replaced, an old setting dropped): shown, not red.
    case 'notice':
      return true;
    // The instinct (D-068): texts that gave orders to the monsters, and the brake on the
    // actions that leave the computer, are effects; its other lines are under "Everything".
    // A draft waiting for the user (V-8): it is something to decide, not background noise. Its
    // row carries "Review" while it waits.
    case 'monster_proposal':
    case 'project_docs_proposal':
    case 'memory':
      return e.data.action === 'proposed';
    case 'project_change':
    case 'automation_change':
      return e.data.action === 'created' && e.data.status === 'draft';
    case 'security':
      // Only what was removed or paused: a warning (old logs, the core no longer sends it) is in
      // "Everything", and so is the user's own "Accept".
      return (
        e.data.action === 'injection_removed' ||
        e.data.action === 'invisible_removed' ||
        e.data.action === 'mcp_tools_changed'
      );
    // The spending cap (D-070): the 80% warning and the stop.
    case 'spend':
      return true;
    case 'instinct':
      return isBrakeEvent(e.data);
    default:
      return SETUP_EVENTS.has(e.type);
  }
}

/**
 * The draft a row stands for while it still waits for the user (`GET /api/drafts` still lists
 * it): the proposal of a monster, a project or an automation in draft, a change to CLAUDE.md or
 * AGENTS.md, lines of memory. Its row in Attività carries "Review" (V-8).
 */
export function pendingDraftOf(
  e: LogEvent,
  drafts: readonly DraftView[] | null,
): DraftView | undefined {
  if (!drafts || drafts.length === 0) return undefined;
  const find = (kind: DraftView['kind'], id: string) =>
    drafts.find((d) => d.kind === kind && d.id === id);
  switch (e.type) {
    case 'monster_proposal':
      return e.data.action === 'proposed' ? find('monster', e.id) : undefined;
    case 'project_change':
      return e.data.action === 'created' && e.data.status === 'draft'
        ? find('project', e.data.project)
        : undefined;
    case 'automation_change':
      return e.data.action === 'created' && e.data.status === 'draft'
        ? find('automation', e.data.automationId)
        : undefined;
    case 'project_docs_proposal':
      return e.data.action === 'proposed' ? find('docs', e.id) : undefined;
    case 'memory':
      return e.data.action === 'proposed' ? find('memory', e.id) : undefined;
    default:
      return undefined;
  }
}

/**
 * Tools of another program waiting for a decision (D-070), tool by tool: a tool
 * paused by `mcp_tools_changed` waits until an `mcp_tools_accepted` names it
 * (an event without the list stands for all the server's tools), or until the
 * server is removed. One entry per server with tools still waiting: the latest
 * event that paused one of them. "Da rivedere" lists them, with the way to the
 * decision (review of 18/10, item 5: accepting one tool of three emptied it).
 */
export function pausedToolEvents(events: readonly LogEvent[]): LogEvent<'security'>[] {
  const ALL = '\u0000all';
  const waiting = new Map<string, Map<string, LogEvent<'security'>>>();
  for (const e of events) {
    if (e.type === 'mcp_server') {
      if (e.data.action === 'removed') waiting.delete(e.data.server);
      continue;
    }
    if (e.type !== 'security') continue;
    const server = e.data.server ?? e.data.source;
    if (typeof server !== 'string') continue;
    const names = e.data.tools?.map((t) => t.name) ?? [ALL];
    if (e.data.action === 'mcp_tools_changed') {
      const tools = waiting.get(server) ?? new Map<string, LogEvent<'security'>>();
      for (const n of names) tools.set(n, e);
      waiting.set(server, tools);
    } else if (e.data.action === 'mcp_tools_accepted') {
      const tools = waiting.get(server);
      if (!tools) continue;
      if (names.includes(ALL)) tools.clear();
      for (const n of names) tools.delete(n);
      // A pause recorded without the list of tools: any acceptance closes it.
      tools.delete(ALL);
      if (tools.size === 0) waiting.delete(server);
    }
  }
  return [...waiting.values()]
    .map((tools) => [...tools.values()].reduce((a, b) => (b.id > a.id ? b : a)))
    .sort((a, b) => (a.id < b.id ? -1 : 1));
}

/** Events about one note (`#/log?nota=…`). */
export function touchesNote(e: LogEvent, key: string): boolean {
  const is = (p: unknown) => typeof p === 'string' && noteKey(p) === key;
  switch (e.type) {
    case 'vault_change':
      return is(e.data.path) || is(e.data.fromPath) || !!e.data.files?.some(is);
    case 'tool_call': {
      const input = (e.data.input ?? {}) as Record<string, unknown>;
      return is(input['path']) || is(input['from']) || is(input['to']);
    }
    case 'delegation':
      return !!e.data.contextLinks?.some(is);
    default:
      return false;
  }
}

/** Attività filtered on one note. */
export function noteActivityPath(path: string): string {
  return `${PATHS.log}?nota=${encodeURIComponent(path)}`;
}

export interface ActivityFilter {
  /** Agent id, `user` or `system`; null = everyone. */
  who: string | null;
  /** Types chosen; empty = the default (effects only, or everything with `all`). */
  types: ReadonlySet<EventCategory>;
  all: boolean;
  since: number;
  /** `noteKey` of the note of `?nota=`. */
  note: string | null;
}

export function matchesActivity(e: LogEvent, f: ActivityFilter): boolean {
  if (!isLoggable(e) || e.ts < f.since) return false;
  if (f.note && !touchesNote(e, f.note)) return false;
  if (f.who && e.agent !== f.who) return false;
  if (f.types.size > 0) return f.types.has(categoryOf(e));
  return f.all || hasEffect(e);
}

/* ------------------------------------------------------------------ undo */

/** Vault actions that can be undone from the UI (a restore too: it is a change like any other). */
export function canUndo(e: LogEvent): boolean {
  return (
    e.type === 'vault_change' &&
    !!e.data.actionId &&
    ['create', 'edit', 'move', 'delete', 'restore'].includes(e.data.action)
  );
}

let undoCache: { events: readonly LogEvent[]; map: Map<string, string> } | null = null;

/** Action id of the undo of each undone action (`undoneActionId` → the undo's `actionId`). */
export function undoIds(events: readonly LogEvent[]): Map<string, string> {
  if (undoCache?.events === events) return undoCache.map;
  const map = new Map<string, string>();
  for (const e of events) {
    if (e.type === 'vault_change' && e.data.undoneActionId && e.data.actionId)
      map.set(e.data.undoneActionId, e.data.actionId);
  }
  undoCache = { events, map };
  return map;
}

export interface UndoState {
  /** The change is undone now (undone once, or undone again after "Redo"). */
  undone: boolean;
  /**
   * The action to undo to flip the state: the change itself, or the last undo
   * ("Redo" undoes the undo). Null while the event of the last undo is on its way.
   */
  next: string | null;
}

/**
 * Where an action stands after undos and redos: undoing an undo brings the
 * change back, so the chain action → undo → undo of the undo… decides it.
 */
export function undoState(
  actionId: string,
  undone: Readonly<Record<string, string>>,
  events: readonly LogEvent[],
): UndoState {
  const ids = undoIds(events);
  let at = actionId;
  let depth = 0;
  for (let guard = 0; at in undone && guard < 50; guard++) {
    depth++;
    const next = ids.get(at);
    if (!next) return { undone: depth % 2 === 1, next: null };
    at = next;
  }
  return { undone: depth % 2 === 1, next: at };
}
