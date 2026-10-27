import { dotPalette } from '@monsters/monster-kit';
import { workOfRun } from '@monsters/shared';
import { memo, useMemo, type ReactNode } from 'react';
import { cn } from '../../lib/utils.ts';
import { useApp } from '../../store/app.ts';
import { busyMood, type ChatItem, type LiveState } from '../../store/derive.ts';
import { useAgent, useResolvedTheme, waitsForUser } from '../../store/hooks.ts';
import { turnEnd, turnHasWork, type Turn, type TurnFlag } from '../../store/turn.ts';
import { accentInk } from '../../theme/bubbles.ts';
import { THEMES } from '../../theme/tokens.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { usePrefs } from '../../store/prefs.ts';
import { openTerminalAt } from '../terminal/focus.ts';
import { AgentBubble, Attachments, RelayedBubble, TelegramBubble, UserBubble } from './Bubbles.tsx';
import { chatStrings } from './chat.strings.ts';
import { behindTheScenes } from './ChatMonitor.tsx';
import { DelegationRow, ErrorRow } from './ChatEvents.tsx';
import { ProposalCard } from './ProposalCard.tsx';
import { QuestionCard } from './QuestionCard.tsx';
import { replyGate, type ReplyState } from './ui-block/reply.ts';
import { WorkStrip } from './WorkStrip.tsx';

/*
 * One turn of a chat (docs/design.md, "The chat"; store/turn.ts): the request, then under the
 * monster's small screen the work strip, then in the column only what must be read or asks for
 * an action: the replies (the files of the turn inside the last one), a question, an error, a
 * draft to approve, and under the reply a short line for what needs a check.
 */

/** What decides the buttons of a drawn block (D-162), besides the bubble itself. */
export type ReplyBase = Omit<ReplyState, 'streaming' | 'answered'>;

/** The monster works on this run now: one of its monsters is busy with it (D-157 work keys). */
export function turnAlive(turn: Turn, live: Readonly<Record<string, LiveState>>): boolean {
  if (turnEnd(turn) !== 'open') return false;
  const who = new Set([turn.agent, ...turn.tasks.map((t) => t.to)]);
  for (const id of who) {
    const l = live[id];
    if (!l || !busyMood(l.mood) || waitsForUser(l)) continue;
    if (l.work?.some((k) => workOfRun(k, turn.runId))) return true;
  }
  return false;
}

/** A line under the reply for what needs a check: a doubt in orange, orders removed in red. */
function FlagLine({ flag, runId }: { flag: TurnFlag; runId: string }) {
  const s = chatStrings();
  return (
    <button
      type="button"
      onClick={() => openTerminalAt(flag.agent, runId)}
      title={s.events.instinctTitle(flag.text)}
      data-testid="turn-flag"
      data-tone={flag.tone}
      className={cn(
        'flex min-h-6 max-w-full items-start gap-2 rounded-[6px] text-left text-footnote leading-snug hover:underline focus-visible:outline-2 focus-visible:outline-signal-ink',
        flag.tone === 'stop' ? 'text-stop-ink' : 'text-signal-ink',
      )}
    >
      <span
        aria-hidden
        className="led mt-[6px]"
        data-tone={flag.tone === 'stop' ? 'stop' : 'signal'}
      />
      <span className="min-w-0">
        <span className="sr-only">{s.strip.flag[flag.tone]}</span>
        {flag.text}
      </span>
    </button>
  );
}

/** The monster's small screen beside its strip (the first bubble then has none). */
function Avatar({ agentId, runId, talking }: { agentId: string; runId: string; talking: boolean }) {
  const agent = useAgent(agentId);
  if (!agent) return <div className="w-[34px] shrink-0" />;
  return (
    <button
      type="button"
      onClick={() => openTerminalAt(agent.id, runId)}
      aria-label={behindTheScenes(agent.name)}
      title={chatStrings().panel.behindTitle}
      className="block w-[34px] shrink-0 rounded-[8px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink"
    >
      <MonsterScreen
        genome={agent.genome}
        mood={talking ? 'working' : 'idle'}
        width={34}
        height={30}
        pad={2}
        animated={talking}
      />
    </button>
  );
}

export const TurnBlock = memo(function TurnBlock({
  turn,
  chat,
  rises,
  greetingAction,
  greetingId,
  replyBase,
  answered,
  sendReply,
}: {
  turn: Turn;
  chat: string;
  /** Whether an item arrived with the chat open (it rises in). */
  rises: (item: ChatItem) => boolean;
  greetingAction: ReactNode;
  greetingId: string | null;
  replyBase: ReplyBase;
  answered: ReadonlySet<string>;
  sendReply: (label: string) => Promise<void>;
}) {
  const details = usePrefs((p) => p.showDetails);
  const alive = useApp((s) => turnAlive(turn, s.live));
  const activity = useApp((s) => (alive ? (s.live[turn.agent]?.activity ?? null) : null));
  const agent = useAgent(turn.agent);
  const theme = useResolvedTheme();
  const color = useMemo(
    () => accentInk(agent ? dotPalette(agent.genome).lit : THEMES[theme].screenMuted, theme),
    [agent, theme],
  );
  const strip = alive || turnHasWork(turn, details);
  const rise = (item: ChatItem | null | undefined) => (item && rises(item) ? 'rise-in' : undefined);
  const bubbles = turn.column.filter((c) => c.kind === 'agent');
  const firstBubble = bubbles[0]?.id;

  const nodes: ReactNode[] = [];
  let prev: ChatItem['kind'] | 'strip' | null = null;
  const gap = (kind: ChatItem['kind']) =>
    prev === null
      ? ''
      : prev === 'agent' && kind === 'agent'
        ? 'mt-1'
        : prev === 'strip' && kind === 'agent'
          ? 'mt-1.5'
          : 'mt-4';
  const flags = turn.flags.length > 0 && (
    <div key="flags" className="mt-1.5 grid gap-1 pr-8 pl-[44px] sm:pr-16" data-testid="turn-flags">
      {turn.flags.map((f) => (
        <FlagLine key={f.id} flag={f} runId={turn.runId} />
      ))}
    </div>
  );

  if (strip) {
    nodes.push(
      <div key="strip" className="flex items-start gap-2.5 pr-8 sm:pr-16">
        <Avatar agentId={turn.agent} runId={turn.runId} talking={alive} />
        <div className="min-w-0 flex-1">
          <WorkStrip turn={turn} alive={alive} activity={activity} color={color} />
        </div>
      </div>,
    );
    prev = 'strip';
  }
  // The files of a turn with no reply in this chat (a task received): under the strip.
  if (bubbles.length === 0 && turn.attachments.length > 0) {
    nodes.push(
      <div key="files" className={cn('pl-[44px]', strip ? 'mt-1.5' : '')}>
        <Attachments items={turn.attachments} />
      </div>,
    );
  }
  if (bubbles.length === 0 && flags) nodes.push(flags);
  for (const item of turn.column) {
    const cls = cn(gap(item.kind), rise(item));
    if (item.kind === 'agent') {
      const last = item.id === turn.lastBubble;
      const gate = replyGate({
        ...replyBase,
        streaming: item.streaming,
        answered: answered.has(item.id),
      });
      nodes.push(
        <div key={item.id} className={cls}>
          <AgentBubble
            item={item}
            first={!strip && item.id === firstBubble}
            attachments={last ? turn.attachments : undefined}
            action={item.id === greetingId ? greetingAction : undefined}
            reply={gate}
            sendReply={sendReply}
          />
        </div>,
      );
      if (last && flags) nodes.push(flags);
    } else if (item.kind === 'question') {
      nodes.push(
        <div key={item.id} className={cn(cls, 'sm:pl-[44px]')}>
          <QuestionCard questionId={item.questionId} />
        </div>,
      );
    } else if (item.kind === 'error') {
      nodes.push(
        <div key={item.id} className={cls}>
          <ErrorRow item={item} />
        </div>,
      );
    } else {
      nodes.push(
        <div key={item.id} className={cn(cls, 'sm:pl-[44px]')}>
          <ProposalCard item={item} />
        </div>,
      );
    }
    prev = item.kind;
  }

  const request = turn.request;
  return (
    <div
      className="flex flex-col"
      data-testid="turn"
      data-run={turn.runId}
      data-alive={alive ? 'true' : undefined}
    >
      {request && (
        <div className={cn('mb-5', rise(request))}>
          {request.kind === 'user' ? (
            <UserBubble item={request} />
          ) : request.kind === 'telegram' ? (
            <TelegramBubble item={request} first />
          ) : (
            <RelayedBubble item={request} first />
          )}
        </div>
      )}
      {turn.received.map((t) => (
        <div key={t.id} className={cn('mb-4', rise(t))}>
          <DelegationRow item={t} chat={chat} />
        </div>
      ))}
      {nodes}
    </div>
  );
});
