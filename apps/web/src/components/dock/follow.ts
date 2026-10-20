import type { LogEvent } from '@monsters/shared';
import { useEffect, useRef } from 'react';
import type { Route } from '../../lib/router.ts';
import { useApp } from '../../store/app.ts';
import { runOwners } from '../../store/derive.ts';
import { openPreview, usePreview } from '../../store/preview.ts';
import { useUsageSheet } from '../usage/state.ts';
import { PHONE_BELOW } from './layout.ts';

/*
 * How the right-hand pane follows the page (D-075), mounted once by the shell:
 * - another chat: "Dietro le quinte" and Consumi show that chat's monster (the
 *   pane is an inspector of the chat beside it, it does not close);
 * - on a phone the pane covers the page, so another page or chat closes it;
 * - "Da rivedere" as a sheet closes with the page, as before;
 * - a monster showing something (`preview_show`, a `preview` event that
 *   arrives now) opens it in Anteprima only when its chat is the one on screen,
 *   on a wide window, in a window in front, and without taking the keyboard
 *   focus; anywhere else the chip in its chat is enough. A page made after
 *   reading third-party text (`inert`, D-085) never opens by itself.
 */

const isPhone = () => window.innerWidth < PHONE_BELOW;

/** The monster the pane's tabs follow: the open chat's, else the team leader's at home. */
export function chatAgentOf(
  route: Route,
  chat: string | null,
  orchId: string | null,
): string | null {
  if (route !== 'home') return null;
  return chat ?? orchId;
}

export function useDockFollowsPage(route: Route, chat: string | null, orchId: string | null): void {
  const target = chatAgentOf(route, chat, orchId);
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    useApp.setState({ reviewOpen: false });
    if (isPhone()) usePreview.getState().hide();
  }, [route, chat]);
  useEffect(() => {
    if (!target) return;
    const app = useApp.getState();
    if (app.terminalAgent && app.terminalAgent !== target)
      useApp.setState({ terminalAgent: target });
    const usage = useUsageSheet.getState().agentId;
    if (usage && usage !== target) useUsageSheet.setState({ agentId: target });
  }, [target]);
}

/** The chat a `preview` event belongs to: the owner of its run, else who showed it. */
export function previewChat(e: LogEvent<'preview'>, owners: ReadonlyMap<string, string>): string {
  return (e.runId ? owners.get(e.runId) : undefined) ?? e.agent;
}

export function usePreviewEvents(viewing: string | null): void {
  const viewingRef = useRef(viewing);
  useEffect(() => {
    viewingRef.current = viewing;
  }, [viewing]);
  useEffect(() => {
    // What was already in the log when the shell came up is history: only the new ones open.
    let after = useApp.getState().events.at(-1)?.id ?? '';
    return useApp.subscribe((s, prev) => {
      if (s.events === prev.events) return;
      const fresh: LogEvent<'preview'>[] = [];
      for (let i = s.events.length - 1; i >= 0; i--) {
        const e = s.events[i]!;
        if (e.id <= after) break;
        if (e.type === 'preview') fresh.unshift(e);
      }
      after = s.events.at(-1)?.id ?? after;
      if (fresh.length === 0) return;
      const here = viewingRef.current;
      if (!here || isPhone() || document.visibilityState !== 'visible') return;
      const owners = runOwners(s.events);
      for (const e of fresh) {
        if (e.data.inert) continue;
        if (previewChat(e, owners) === here) openPreview(e.data.item, { focus: false });
      }
    });
  }, []);
}
