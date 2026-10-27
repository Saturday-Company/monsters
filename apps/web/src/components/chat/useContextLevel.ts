import { contextLevel, runOwnersOf, type ContextLevel } from '@monsters/shared';
import { useMemo } from 'react';
import { useApp } from '../../store/app.ts';
import { contextNow, latestContext } from '../usage/model.ts';
import { useAgentUsage } from '../usage/state.ts';

/**
 * How long the current conversation of a monster is, in words (`contextLevel`, the chat plan of
 * 27/10): from its latest step in the stream and, for the older turns summarised, the usage the
 * core reports (read again as the conversation goes, at most every 2 s).
 */
export function useContextLevel(agentId: string): ContextLevel {
  const events = useApp((s) => s.events);
  const chain = useApp((s) => s.agents[agentId]?.models ?? null);
  const owners = useMemo(() => runOwnersOf(events), [events]);
  const fromEvents = useMemo(
    () => latestContext(events, agentId, owners),
    [events, agentId, owners],
  );
  const { view } = useAgentUsage(agentId, true);
  const context = contextNow(fromEvents, view?.context ?? null, chain);
  // A summary from before a new conversation is not this conversation's: without a step there is none.
  return contextLevel({ context, summary: context ? (view?.summary ?? null) : null });
}
