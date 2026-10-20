import { runOwnersOf, type AgentUsageView, type LogEvent } from '@monsters/shared';
import { useEffect, useMemo, useRef, useState } from 'react';
import { create } from 'zustand';
import { errorText, getApi, useApp } from '../../store/app.ts';
import { usePreview } from '../../store/preview.ts';
import {
  contextNow,
  latestContext,
  usageRefreshDelay,
  usageStamp,
  type CurrentModel,
} from './model.ts';

/*
 * Which monster's Consumi are shown, and its data (D-075). The panel is the
 * Consumi tab of the right-hand pane (store/preview.ts): opening it selects
 * that tab; the monster stays when the pane closes, and follows the chat that
 * opens (components/dock/follow.ts).
 */

export const useUsageSheet = create<{ agentId: string | null }>(() => ({ agentId: null }));

export function openUsage(agentId: string): void {
  useUsageSheet.setState({ agentId });
  useApp.setState({ reviewOpen: false });
  usePreview.getState().showTab('usage');
}

/** Hides the pane when it shows Consumi. */
export function closeUsage(): void {
  const dock = usePreview.getState();
  if (dock.visible && dock.tab === 'usage') dock.hide();
}

/** Whether the Consumi of `agentId` are on screen. */
export function useUsageShown(agentId: string): boolean {
  const mine = useUsageSheet((s) => s.agentId === agentId);
  const shown = usePreview((s) => s.visible && s.tab === 'usage');
  return mine && shown;
}

const pageHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * `GET /api/agents/:id/usage`: read when the panel opens and when the
 * conversation starts over; with `live`, read again when an event that may
 * change it arrives, at most every 2 s and only while the page is visible
 * (a hidden page reads once when it shows again). The panel itself mounts
 * only while it is open.
 */
export function useAgentUsage(
  agentId: string,
  live: boolean,
): { view: AgentUsageView | null; error: string | null } {
  const stamp = useApp((s) => (live ? usageStamp(s.events) : ''));
  const restart = useApp((s) => lastRestart(s.events, agentId));
  // A change of model reads again: the share follows the new window (D-086).
  const model = useApp((s) => modelKey(s.agents[agentId]));
  const [state, setState] = useState<{
    id: string;
    view: AgentUsageView | null;
    error: string | null;
  }>({ id: agentId, view: null, error: null });
  /** When the last read started, and for which monster and conversation. */
  const last = useRef<{ key: string; at: number } | null>(null);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (!live) return;
    const onVisible = () => {
      if (!pageHidden()) setShown((n) => n + 1);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [live]);
  useEffect(() => {
    const key = `${agentId}\n${restart}\n${model}`;
    // An event while the page is hidden: read when it shows again (`shown`).
    if (stamp && pageHidden()) return;
    const prev = last.current?.key === key ? last.current.at : null;
    let stale = false;
    const t = setTimeout(
      () => {
        last.current = { key, at: Date.now() };
        getApi()
          .agentUsage(agentId)
          .then((view) => !stale && setState({ id: agentId, view, error: null }))
          .catch(
            (err: unknown) =>
              !stale && setState((s) => ({ id: agentId, view: s.view, error: errorText(err) })),
          );
      },
      // First read of this monster and conversation at once, then at most every 2 s.
      prev === null ? 0 : usageRefreshDelay(prev, Date.now()),
    );
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [agentId, stamp, restart, shown, model]);
  return state.id === agentId ? state : { view: null, error: null };
}

const modelKey = (a: { models?: { provider: string; model: string }[] } | undefined): string =>
  a?.models?.map((m) => `${m.provider}:${m.model}`).join(',') ?? '';

function lastRestart(events: readonly LogEvent[], agentId: string): string {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i]!;
    if (e.type === 'new_conversation' && (!e.data.to || e.data.to === agentId)) return e.id;
  }
  return '';
}

/**
 * The context of the monster's latest step: live from the stream, the panel's
 * data before the first event (and for the window, when the step lacked it).
 */
export function useContextNow(agentId: string) {
  const events = useApp((s) => s.events);
  const owners = useMemo(() => runOwnersOf(events), [events]);
  const fromEvents = useMemo(
    () => latestContext(events, agentId, owners),
    [events, agentId, owners],
  );
  const { view } = useAgentUsage(agentId, false);
  const chain: readonly CurrentModel[] | null = useApp((s) => s.agents[agentId]?.models ?? null);
  return contextNow(fromEvents, view?.context ?? null, chain);
}
