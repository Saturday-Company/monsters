import { useEffect, useState } from 'react';
import { openChat, openPage, PATHS } from '../../lib/router.ts';
import { cn } from '../../lib/utils.ts';
import { useApp } from '../../store/app.ts';
import { useConnection, waitsForUser } from '../../store/hooks.ts';
import { timeParts, type TimeParts } from '../../lib/utils.ts';
import { useChats } from '../chat/useChats.ts';
import { Meter } from '../ui/Meter.tsx';
import { shellStrings } from './shell.strings.ts';

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
  const s = shellStrings().status;
  const base = { count: null, blink: false, alsoWorking: 0 };
  if (halted) return { ...base, kind: 'halted', text: s.halted, short: s.halted, tone: 'stop' };
  if (connection === 'closed') {
    return { ...base, kind: 'offline', text: s.offline, short: s.offlineShort, tone: 'stop' };
  }
  if (connection === 'reconnecting') {
    // A wait, not a call: the dashes run beside the words (only what waits for the user blinks).
    return {
      ...base,
      kind: 'reconnecting',
      text: s.reconnecting,
      short: s.reconnectingShort,
      tone: 'signal',
    };
  }
  const n = questions.length;
  if (n > 0) {
    const who = new Set(questions.map((q) => q.from));
    const name = who.size === 1 ? nameOf(questions[0]!.from) : null;
    // The name is what matters, so it comes first and short: "Titan asks".
    const text = n === 1 && name ? s.asks(name) : s.questions(n, name);
    return {
      ...base,
      kind: 'questions',
      text,
      short: s.questionsShort(n),
      count: n,
      tone: 'signal',
      blink: true,
      alsoWorking: working,
    };
  }
  if (working > 0) {
    // One monster changing its way is worth its name: "Rhea is changing course".
    const text =
      confused.length === 1
        ? s.changingCourseOne(nameOf(confused[0]!))
        : confused.length > 1
          ? s.changingCourseMany(confused.length)
          : s.working(working);
    return {
      ...base,
      kind: 'working',
      text,
      short: s.working(working),
      count: working,
      tone: 'ok',
    };
  }
  return { ...base, kind: 'quiet', text: s.quiet, short: s.quietShort, tone: 'ok' };
}

/**
 * The time on the segment clock, updated on the minute and written as the chat writes it
 * (`timeOptions()`: "8:27 PM" in English, "20:27" in Italian), so the screen and the messages agree.
 */
function useClock(): TimeParts {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | undefined;
    // Wakes up just after the next minute starts, then again a minute later.
    const arm = () => {
      const d = new Date();
      t = setTimeout(
        () => {
          setNow(Date.now());
          arm();
        },
        60_000 - (d.getSeconds() * 1000 + d.getMilliseconds()) + 20,
      );
    };
    arm();
    return () => clearTimeout(t);
  }, []);
  return timeParts(now);
}

export function StatusDisplay({ size }: { size: 'full' | 'compact' | 'dot' }) {
  const t = shellStrings().status;
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
  const also = state.alsoWorking > 0 ? t.alsoWorking(state.alsoWorking) : '';
  const spoken = `${state.text}${also}`;

  return (
    <button
      type="button"
      onClick={() => (target ? openChat(target) : openPage(PATHS.log))}
      data-testid="status-display"
      data-state={state.kind}
      aria-label={t.label(spoken, clock.text, target !== null)}
      title={target ? t.goToQuestion : t.openActivity}
      className={cn(
        'screen flex h-8 shrink-0 items-center gap-2.5 rounded-[8px] text-left select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink',
        size === 'full' && '@container w-[clamp(240px,22vw,340px)] pr-2 pl-3',
        size === 'compact' && 'px-3',
        size === 'dot' && 'min-w-8 justify-center px-2',
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
      {size === 'dot' && state.count !== null && (
        // A phone has no room for the words: the light and how many; the words are the name of the key.
        <span
          aria-hidden
          className={cn(
            'label -ml-0.5',
            state.tone === 'stop' ? 'text-screen-stop' : 'text-screen-ink',
          )}
        >
          {state.count}
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
        <span aria-hidden className="flex shrink-0 items-end gap-1.5">
          <span className="relative text-title3 leading-none dots tracking-[0.04em]">
            {/* The unlit dots of the clock, like a real display. */}
            <span className="text-screen-off">88:88</span>
            <span className="absolute inset-0 text-screen-ink">
              {/* A one-digit hour keeps its place on the right of the first cell. */}
              {clock.hour.length < 2 && <span className="invisible">8</span>}
              {clock.hour}
              <span className="clock-colon">:</span>
              {clock.minute}
            </span>
          </span>
          {clock.period && <span className="label pb-px text-screen-ink">{clock.period}</span>}
        </span>
      )}
    </button>
  );
}
