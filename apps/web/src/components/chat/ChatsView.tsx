import { useEffect, useRef } from 'react';
import { useHashParam } from '../../lib/router.ts';
import { cn } from '../../lib/utils.ts';
import { useApp } from '../../store/app.ts';
import { useOrchestrator } from '../../store/hooks.ts';
import { useReviewColumn } from '../shell/ReviewSheet.tsx';
import { initBaseline } from '../../store/reads.ts';
import { ActivityPanel } from '../log/ActivityPanel.tsx';
import { chatStrings } from './chat.strings.ts';
import { ChatPanel } from './ChatPanel.tsx';
import { useChats } from './useChats.ts';
import { checkModel } from './useModel.ts';

/*
 * Home: the open chat. The chats themselves, one per monster, are the rows of
 * the sidebar (components/shell/Sidebar.tsx). Without a chat in the address a
 * wide window opens the orchestrator; on a phone the home is the sidebar and a
 * chat opens full screen (`#/?chat=…`, Back returns). On wide windows the
 * "Da rivedere" column can sit next to the chat (not with the right-hand pane
 * open below 1600 px: one thing on the right, D-075). Without a model the chat itself
 * says so (greeting, composer, status: audit 2.4).
 */

export default function ChatsView() {
  const { agents, threads } = useChats();
  const orch = useOrchestrator();
  const events = useApp((s) => s.events);
  const param = useHashParam('chat');
  const activity = useReviewColumn();

  const chosen = agents.find((a) => a.id === param)?.id ?? null;
  const selected = chosen ?? orch?.id ?? null;

  // The history already there when the chats are first shown here counts as read.
  const lastId = events.at(-1)?.id ?? '';
  const first = useRef(lastId);
  useEffect(() => initBaseline(first.current), []);
  // Whether a model is connected: asked again each time the chats are shown.
  useEffect(() => checkModel(), []);

  const thread = selected ? (threads.get(selected) ?? []) : [];

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        data-testid="chats"
        className={cn(
          'grid min-h-0 flex-1 grid-cols-1',
          activity && 'xl:grid-cols-[minmax(0,1fr)_360px]',
        )}
      >
        {selected ? (
          <ChatPanel key={selected} agentId={selected} thread={thread} />
        ) : (
          <p className="px-5 py-8 text-body text-ink-muted">{chatStrings().view.noSquad}</p>
        )}
        {activity && <ActivityPanel className="border-l border-separator" />}
      </div>
    </div>
  );
}
