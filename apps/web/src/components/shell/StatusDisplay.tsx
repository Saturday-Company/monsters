import { useEffect, useState } from 'react';
import { openChat, openPage, PATHS } from '../../lib/router.ts';
import { cn } from '../../lib/utils.ts';
import { useApp } from '../../store/app.ts';
import { useConnection, waitsForUser } from '../../store/hooks.ts';
import { useChats } from '../chat/useChats.ts';
import { Meter } from '../ui/Meter.tsx';

/*
 * The status display of the top rail (docs/design.md, "Display di stato"): a
 * black screen with the state of the team in luminous Martian Mono and the
 * clock in dots. It shows the first true state: stopped, not connected or
 * reconnecting, questions for the user, monsters at work, all quiet. A click
 * goes to the chat that waits for an answer, else to Attività. Under 1100 px
 * the light and a short phrase ("1 domanda"); on a phone only the light.
 */

export type DisplayTone = 'stop' | 'signal' | 'ok' | 'off';

export interface DisplayState {
  kind: 'halted' | 'offline' | 'reconnecting' | 'questions' | 'working' | 'quiet';
  /** What the screen says, upper case on screen (CSS), plain here. */
  text: string;
  /** The number in the compact display (questions, monsters at work). */
  count: number | null;
  /** The words of the compact display (under 1100 px): short, never a bare number. */
  short: string;
  tone: DisplayTone;
  blink: boolean;
  /** Monsters at work besides a question, said after it when there is room. */
  alsoWorking: number;
}

/** The state of the team for the display, in the order of docs/design.md. */
export function displayState(input: {
  halted: boolean;
  connection: string;
  questions: readonly { from: string }[];
  nameOf: (id: string) => string;
  working: number;
  /** Monsters at work that go round in circles (the instinct, D-067). */
  confused?: readonly string[];
}): DisplayState {
  const { halted, connection, questions, nameOf, working, confused = [] } = input;
  const base = { count: null, blink: false, alsoWorking: 0 };
  if (halted) return { ...base, kind: 'halted', text: 'Fermi', short: 'Fermi', tone: 'stop' };
  if (connection === 'closed') {
    return { ...base, kind: 'offline', text: 'Non collegato', short: 'Scollegato', tone: 'stop' };
  }
  if (connection === 'reconnecting') {
    // A wait, not a call: the dashes run beside the words (only what waits for the user blinks).
    return {
      ...base,
      kind: 'reconnecting',
      text: 'Mi ricollego…',
      short: 'Ricollego…',
      tone: 'signal',
    };
  }
  const n = questions.length;
  if (n > 0) {
    const who = new Set(questions.map((q) => q.from));
    const name = who.size === 1 ? nameOf(questions[0]!.from) : null;
    // The name is what matters, so it comes first and short: "Titan chiede".
    const text =
      n === 1 && name
        ? `${name} chiede`
        : `${n} ${n === 1 ? 'domanda' : 'domande'}${name ? ` · ${name}` : ''}`;
    return {
      ...base,
      kind: 'questions',
      text,
      short: `${n} ${n === 1 ? 'domanda' : 'domande'}`,
      count: n,
      tone: 'signal',
      blink: true,
      alsoWorking: working,
    };
  }
  if (working > 0) {
    // One monster changing its way is worth its name: "Rhea cambia strada".
    const text =
      confused.length === 1
        ? `${nameOf(confused[0]!)} cambia strada`
        : confused.length > 1
          ? `${confused.length} cambiano strada`
          : `${working} al lavoro`;
    return {
      ...base,
      kind: 'working',
      text,
      short: `${working} al lavoro`,
      count: working,
      tone: 'ok',
    };
  }
  return { ...base, kind: 'quiet', text: 'Tutto tranquillo', short: 'Tranquillo', tone: 'ok' };
}

/** "17:42", updated on the minute. */
function useClock(): string {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    // Wakes up just after the next minute starts, then again a minute later.
    const arm = () => {
      const d = new Date();
      t = setTimeout(
        () => {
          setNow(new Date());
          arm();
        },
        60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 20,
      );
    };
    arm();
    return () => clearTimeout(t);
  }, []);
  const hh = String(now.getHours()).padStart(2, '0');
  const mm = String(now.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

export function StatusDisplay({ size }: { size: 'full' | 'compact' | 'dot' }) {
  const halted = useApp((s) => s.halted);
  const connection = useConnection();
  const agents = useApp((s) => s.agents);
  const working = useApp(
    (s) =>
      Object.values(s.live).filter(
        (l) =>
          (l.mood === 'working' || l.mood === 'talking' || l.mood === 'waiting') &&
          !waitsForUser(l),
      ).length,
  );
  const confusedIds = useApp((s) =>
    Object.entries(s.live)
      .filter(([, l]) => l.confused && (l.mood === 'working' || l.mood === 'talking'))
      .map(([id]) => id)
      .join('|'),
  );
  const { agents: team, waiting } = useChats();
  const questions = [...waiting.values()].flat();
  const clock = useClock();
  const state = displayState({
    halted,
    connection,
    questions,
    nameOf: (id) => agents[id]?.name ?? id,
    working,
    confused: confusedIds ? confusedIds.split('|') : [],
  });
  // The chat that waits for an answer, in the team's order.
  const target = team.find((a) => (waiting.get(a.id)?.length ?? 0) > 0)?.id ?? null;
  const also = state.alsoWorking > 0 ? ` · ${state.alsoWorking} al lavoro` : '';
  const spoken = `${state.text}${also}`;

  return (
    <button
      type="button"
      onClick={() => (target ? openChat(target) : openPage(PATHS.log))}
      data-testid="status-display"
      data-state={state.kind}
      aria-label={`Stato della squadra: ${spoken}, ore ${clock}. ${target ? 'Apri la chat che aspetta' : 'Apri Attività'}`}
      title={target ? 'Vai alla domanda' : 'Apri Attività'}
      className={cn(
        'screen flex h-8 shrink-0 items-center gap-2.5 rounded-[8px] text-left select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink',
        size === 'full' && '@container w-[clamp(240px,24vw,340px)] pr-2 pl-3',
        size === 'compact' && 'px-3',
        size === 'dot' && 'w-8 justify-center',
      )}
    >
      <span
        aria-hidden
        className="led"
        data-tone={state.tone}
        data-blink={state.blink ? '' : undefined}
      />
      {size !== 'dot' && (
        <span
          aria-hidden
          className={cn(
            'label min-w-0 flex-1 truncate',
            state.tone === 'stop' ? 'text-screen-stop' : 'text-screen-ink',
          )}
        >
          {size === 'compact' ? state.short : state.text}
        </span>
      )}
      {size === 'full' && (state.kind === 'working' || state.alsoWorking > 0) && (
        // The words first: on a narrow display the meter gives way.
        <Meter active color="var(--ok)" className="shrink-0 @max-[300px]:hidden" />
      )}
      {size === 'full' && state.kind === 'reconnecting' && (
        <Meter active color="var(--signal)" className="shrink-0 @max-[300px]:hidden" />
      )}
      {size === 'full' && (
        <span
          aria-hidden
          className="relative shrink-0 text-title3 leading-none dots tracking-[0.04em]"
        >
          {/* The unlit dots of the clock, like a real display. */}
          <span className="text-screen-off">88:88</span>
          <span className="absolute inset-0 text-screen-ink">
            {clock.slice(0, 2)}
            <span className="clock-colon">:</span>
            {clock.slice(3)}
          </span>
        </span>
      )}
    </button>
  );
}
