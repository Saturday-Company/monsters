import { dotPalette } from '@monsters/monster-kit';
import { NotePencil, TerminalWindow } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { KICK_MS } from '../../lib/motion.ts';
import { errorText, notify, startNewConversation } from '../../store/app.ts';
import { CONFUSED_TEXT, type LiveState } from '../../store/derive.ts';
import { waitsForUser, type AgentView } from '../../store/hooks.ts';
import { expressionFor, Monster } from '../monster/Monster.tsx';
import { fitDots } from '../monster/MonsterScreen.tsx';
import { openTerminalAt } from '../terminal/focus.ts';
import { Meter } from '../ui/Meter.tsx';
import { ContextKey } from '../usage/ContextKey.tsx';

/** "Dietro le quinte" (the agent terminal): the label of the UI, "terminale" in the tooltip. */
export const behindTheScenes = (name: string) => `Dietro le quinte di ${name}`;

/** Height of the monitor and of the creature on it (docs/design.md, "Monitor del mostro"). */
const MONITOR_H = 76;
const CREATURE_H = 60;

/*
 * The monster's monitor, on top of its chat (docs/design.md, "La chat"): a
 * black screen across the column that never scrolls, with the creature big,
 * its name in Doto in its own light, what it is doing in Martian Mono, and on
 * wide chats the sum of the conversation and two light keys. When the monster
 * starts working the name flickers like a screen waking up and the meter
 * starts; a question waiting lights the orange lamp.
 */
export function ChatMonitor({
  agent,
  live,
  roleText,
  asking,
  halted,
  noModel,
  summary,
  canStartOver,
}: {
  agent: AgentView;
  live: LiveState;
  /** "capo squadra · coordina 3 mostri", or the role of a member. */
  roleText: string;
  /** A question of this chat waits for the user. */
  asking: boolean;
  halted: boolean;
  noModel: boolean;
  /** "3 strumenti · 4,1 s · gratis", or null. */
  summary: string | null;
  canStartOver: boolean;
}) {
  const lit = dotPalette(agent.genome).lit;
  const busy =
    !waitsForUser(live) &&
    (live.mood === 'working' || live.mood === 'talking' || live.mood === 'waiting');
  const kick = useKick(busy);
  const size = fitDots(200, CREATURE_H, 0);

  let status: ReactNode;
  if (halted) {
    // The halt band says why: the monitor only says how the monster is.
    status = <span className="truncate text-screen-muted">dorme</span>;
  } else if (asking) {
    status = (
      <span className="text-screen-signal flex min-w-0 items-center gap-2">
        <span aria-hidden className="led" data-tone="signal" data-blink="" />
        <span className="truncate @max-[460px]:hidden">aspetta una tua risposta</span>
        <span className="truncate @min-[460px]:hidden">domanda per te</span>
      </span>
    );
  } else if (live.mood === 'error') {
    status = (
      <span className="flex min-w-0 items-start gap-2 text-screen-stop">
        <span aria-hidden className="led mt-1" data-tone="stop" />
        <span className="line-clamp-2">{live.activity ?? 'ha un problema'}</span>
      </span>
    );
  } else if (busy && live.confused) {
    // Going round in circles: the instinct asked it to change its way (D-067).
    status = (
      <span
        className="flex min-w-0 items-center gap-2 text-screen-ink"
        data-testid="monitor-confused"
      >
        <span aria-hidden className="monitor-name font-mono text-caption leading-4 font-semibold">
          ?
        </span>
        <span className="label truncate @max-[460px]:hidden">{CONFUSED_TEXT}</span>
        <span className="label truncate @min-[460px]:hidden">cambia strada</span>
      </span>
    );
  } else if (busy) {
    status = (
      <span className="flex min-w-0 items-start gap-2 text-screen-ink">
        <Meter active color={lit} className="monitor-meter mt-[3px] shrink-0" />
        <span className="line-clamp-2">
          {live.activity ?? (live.mood === 'talking' ? 'sta scrivendo…' : 'al lavoro…')}
        </span>
      </span>
    );
  } else if (noModel) {
    status = <span className="text-screen-muted">in attesa di un modello</span>;
  } else {
    status = <span className="truncate text-screen-muted">{roleText}</span>;
  }

  return (
    <div className="@container shrink-0 px-4 pt-4 pb-1">
      <div
        className="monitor screen screen-lines flex items-center gap-4 overflow-hidden @max-[460px]:gap-3 rounded-[12px] pr-2 pl-4"
        style={{ height: MONITOR_H, '--lit': lit } as CSSProperties}
        data-testid="chat-monitor"
        data-kick={kick ? '' : undefined}
        data-mood={live.mood}
        data-confused={live.confused ? 'true' : undefined}
      >
        <span
          className="flex shrink-0 items-center justify-center"
          style={{ width: size, height: CREATURE_H }}
        >
          <Monster
            genome={agent.genome}
            size={size}
            expression={expressionFor(live.mood, live.confused)}
          />
        </span>
        <div className="min-w-0 flex-1" aria-hidden>
          <p className="monitor-name dots truncate text-title1 leading-[30px]">{agent.name}</p>
          {/* What it is doing comes before the keys: two lines rather than cut. */}
          <p className="mt-0.5 flex max-h-8 min-h-4 min-w-0 items-center font-mono text-micro leading-4 tracking-[0.02em]">
            {status}
          </p>
        </div>
        {summary && (
          <p
            className="label shrink-0 text-screen-muted @max-[1320px]:hidden"
            data-testid="chat-summary"
            title="Questa conversazione: strumenti usati, tempo di lavoro, costo"
          >
            {summary}
          </p>
        )}
        <div className="flex shrink-0 items-center gap-0.5">
          {/* Consumi (D-075): the context as lineette; the panel opens on a click. */}
          <ContextKey agentId={agent.id} name={agent.name} />
          <button
            type="button"
            className="screen-key"
            onClick={() => openTerminalAt(agent.id)}
            aria-label={behindTheScenes(agent.name)}
            title="Dietro le quinte: il terminale, con il ragionamento e gli strumenti passo per passo"
            data-testid="behind-the-scenes"
          >
            <TerminalWindow size={18} aria-hidden />
            <span className="label @max-[860px]:hidden" aria-hidden>
              Dietro le quinte
            </span>
          </button>
          <NewConversationKey agent={agent} disabled={!canStartOver} />
        </div>
      </div>
    </div>
  );
}

function NewConversationKey({ agent, disabled }: { agent: AgentView; disabled: boolean }) {
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    try {
      await startNewConversation(agent.id);
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <button
      type="button"
      className="screen-key"
      onClick={() => void start()}
      disabled={disabled || busy}
      aria-label="Nuova conversazione"
      title={`Nuova conversazione con ${agent.name}`}
    >
      <NotePencil size={18} aria-hidden />
      <span className="label @max-[860px]:hidden" aria-hidden>
        Nuova conversazione
      </span>
    </button>
  );
}

/** True for the length of the flicker (KICK_MS, chat.css) when `busy` turns on: the monitor wakes up. */
function useKick(busy: boolean): boolean {
  const [kick, setKick] = useState(false);
  const was = useRef(busy);
  useEffect(() => {
    if (busy && !was.current) {
      setKick(true);
      const t = setTimeout(() => setKick(false), KICK_MS);
      was.current = busy;
      return () => clearTimeout(t);
    }
    was.current = busy;
    return undefined;
  }, [busy]);
  return kick;
}
