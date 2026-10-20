import type { Question } from '@monsters/shared';
import { useApp } from '../../store/app.ts';
import {
  automationWork,
  buildChat,
  capitalize,
  chatThread,
  runOwners,
  withoutAutomationRuns,
  type ChatItem,
  type PendingSend,
} from '../../store/derive.ts';
import { useAgents, useOrchestrator, type AgentView } from '../../store/hooks.ts';

/*
 * The chats of the monsters, shared by the sidebar (one row per monster, on
 * every page) and the chat view: the thread of each monster and the questions
 * waiting in it. Both ask at once, so the result is kept for the last inputs.
 */

export interface ChatData {
  threads: ReadonlyMap<string, ChatItem[]>;
  /** Open questions by the chat they belong to: the run's owner, else who asked. */
  waiting: ReadonlyMap<string, Question[]>;
}

type Events = ReturnType<typeof useApp.getState>['events'];
type Questions = ReturnType<typeof useApp.getState>['questions'];

let last: {
  events: Events;
  pending: readonly PendingSend[];
  questions: Questions;
  ids: string;
  orchestrator: string;
  data: ChatData;
} | null = null;

export function chatData(
  events: Events,
  pending: readonly PendingSend[],
  questions: Questions,
  agents: readonly AgentView[],
  orchestrator: string,
): ChatData {
  // Each component has its own `agents` array: ids and names are what the threads depend on.
  const ids = agents.map((a) => `${a.id}:${a.name}`).join('|');
  if (
    last &&
    last.events === events &&
    last.pending === pending &&
    last.questions === questions &&
    last.ids === ids &&
    last.orchestrator === orchestrator
  ) {
    return last.data;
  }
  const names = new Map(agents.map((a) => [a.id, a.name]));
  // The giri of the automations are not part of the chat (D-094): the Automazioni menu shows them.
  const auto = automationWork(events).runs;
  const chat = withoutAutomationRuns(events, auto);
  const items = buildChat(chat, pending, (id) => names.get(id) ?? capitalize(id));
  const owners = runOwners(chat);
  const scope = { orchestrator, owners };
  const threads = new Map(agents.map((a) => [a.id, chatThread(items, a.id, scope)]));
  const waiting = new Map<string, Question[]>();
  for (const q of Object.values(questions)) {
    if (q.status !== 'open' || auto.has(q.runId)) continue;
    const home = owners.get(q.runId) ?? q.from;
    waiting.set(home, [...(waiting.get(home) ?? []), q]);
  }
  for (const list of waiting.values()) list.sort((a, b) => a.createdAt - b.createdAt);
  const data = { threads, waiting };
  last = { events, pending, questions, ids, orchestrator, data };
  return data;
}

export function useChats(): ChatData & { agents: AgentView[] } {
  const agents = useAgents();
  const orch = useOrchestrator();
  const events = useApp((s) => s.events);
  const pending = useApp((s) => s.pending);
  const questions = useApp((s) => s.questions);
  return { agents, ...chatData(events, pending, questions, agents, orch?.id ?? '') };
}
