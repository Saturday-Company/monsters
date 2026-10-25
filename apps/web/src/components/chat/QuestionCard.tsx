import { ArrowClockwise, CheckCircle } from '@phosphor-icons/react';
import type { LogEvent, Question } from '@monsters/shared';
import {
  createContext,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from 'react';
import {
  answerQuestion,
  askAgain,
  chooseOption,
  errorText,
  notify,
  undoChoice,
  useApp,
} from '../../store/app.ts';
import { runOwners } from '../../store/derive.ts';
import { useAgent, useMediaQuery } from '../../store/hooks.ts';
import { cn, domId } from '../../lib/utils.ts';
import { plainText } from '../../lib/markdown.ts';
import { playSound } from '../../lib/sound.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { Button, KeyCap } from '../ui/button.tsx';
import { Input } from '../ui/field.tsx';
import { chatStrings } from './chat.strings.ts';

/** The letters of the keypad, one per option (2-4 options). */
export const KEYPAD_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** How long a key stays down before the answer leaves (the press must be seen). */
const PRESS_MS = 120;

/**
 * The question the composer answers: its keypad takes the letters typed outside
 * the text fields (one keypad at a time, the oldest open question).
 */
export const ActiveKeypad = createContext<string | null>(null);

/**
 * Whether a key press may play the keypad: no modifier, and the focus is not in
 * a text field. Not even the empty composer, which has the focus by default: a
 * sentence starting with "Can…" or "Do…" answered the question and the text was
 * gone (V-1). There a letter alone and Enter picks the option (`keypadPick`).
 */
export function keypadAccepts(
  e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'repeat' | 'defaultPrevented'>,
  active: { tagName: string; isContentEditable?: boolean } | null,
): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return false;
  if (!active) return true;
  if (active.isContentEditable) return false;
  const tag = active.tagName.toUpperCase();
  return tag !== 'TEXTAREA' && tag !== 'INPUT' && tag !== 'SELECT';
}

/**
 * The option a text sent from the composer picks: a letter of the keypad alone ("b", " C "),
 * within the options. Null for anything else, which is an answer in words.
 */
export function keypadPick(text: string, options: number): number | null {
  const m = /^\s*([a-d])\s*$/i.exec(text);
  if (!m) return null;
  const i = KEYPAD_LETTERS.indexOf(m[1]!.toUpperCase() as (typeof KEYPAD_LETTERS)[number]);
  return i >= 0 && i < Math.min(options, KEYPAD_LETTERS.length) ? i : null;
}

/** "A, B or C": the letters of a keypad of `n` options, in words. */
export function lettersText(n: number): string {
  return chatStrings().composer.letters(
    KEYPAD_LETTERS.slice(0, Math.max(0, Math.min(n, KEYPAD_LETTERS.length))),
  );
}

type ExpiredWhy = LogEvent<'question_expired'>['data']['reason'];

/**
 * The expiry of a question and whether the work went on afterwards (a new run
 * of the same chat): then there is nothing to ask again.
 */
function expiryOf(
  events: readonly LogEvent[],
  q: Question,
): { why: ExpiredWhy; resumed: boolean } | null {
  const at = events.findIndex((e) => e.type === 'question_expired' && e.data.questionId === q.id);
  if (at < 0) return null;
  const e = events[at] as LogEvent<'question_expired'>;
  const owner = (q.runId && runOwners(events).get(q.runId)) || q.from;
  const resumed = events
    .slice(at + 1)
    .some((x) => x.type === 'run' && x.data.status === 'started' && x.agent === owner);
  return { why: e.data.reason, resumed };
}

/** A question that will never be answered: why, and "Ask me again" when it makes sense. */
function Expired({ q }: { q: Question }) {
  const s = chatStrings().question;
  const halted = useApp((s) => s.halted);
  const events = useApp((s) => s.events);
  const expiry = useMemo(() => expiryOf(events, q), [events, q]);
  const [sent, setSent] = useState(false);
  const why = expiry?.why;
  // While stopped, "Resume and continue" in the halt band does it: the key comes after.
  const again = !halted && why !== 'agent_archived' && !expiry?.resumed && !sent;
  return (
    <div className="grid gap-2.5 px-4 pt-2.5 pb-4" data-testid="question-expired" data-why={why}>
      <p className="flex items-center gap-2 text-body text-ink-muted">
        {/* An unlit light, never the tick of "done": nobody answered. */}
        <span aria-hidden className="led" data-tone={why === 'kill' ? 'stop' : undefined} />
        <span>{s.expired[why ?? 'other']}</span>
      </p>
      {again && (
        <div>
          <Button
            variant="secondary"
            size="sm"
            data-testid="ask-again"
            onClick={() => {
              setSent(true);
              askAgain(q.id).catch((err: unknown) => {
                setSent(false);
                notify(errorText(err), 'error');
              });
            }}
          >
            <ArrowClockwise size={16} aria-hidden />
            {s.askAgain}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * A question from a monster as a keypad (docs/design.md, "Domanda con
 * opzioni"): the options are full-width keys with their letter, the
 * recommended one with the orange lamp. Outside the text fields the letter on
 * the keyboard presses the key (it sinks, it clicks if the sounds are on); in
 * the composer a letter alone and Enter does the same. A key picked with the
 * keyboard waits a moment with "Undo" before it leaves (V-1); a click goes at
 * once. Words of one's own go in the composer below, which answers the open
 * question: one field, not two. An open question (no options) is the
 * question only.
 */
export function QuestionCard({
  questionId,
  answerField = false,
}: {
  questionId: string;
  /**
   * The card has its own field for words: where no composer answers it (the
   * page of an automation round, D-096). In the collaudo of 17/10 an open
   * question of a round said "Answer below, in the message field" on a
   * page without one, and could be answered only from the CLI.
   */
  answerField?: boolean;
}) {
  const q = useApp((s) => s.questions[questionId]);
  if (!q) return null;
  return <QuestionBody q={q} answerField={answerField} />;
}

function QuestionBody({ q, answerField }: { q: Question; answerField: boolean }) {
  const s = chatStrings().question;
  const agent = useAgent(q.from);
  const halted = useApp((s) => s.halted);
  const active = useContext(ActiveKeypad) === q.id;
  // The letters are worth saying only with a real keyboard.
  const keyboard = !useMediaQuery('(pointer: coarse)');
  const [busy, setBusy] = useState<string | null>(null);
  const [pressed, setPressed] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [words, setWords] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoKey = useRef<HTMLButtonElement>(null);
  const uid = domId(useId());
  const open = q.status === 'open';
  const freeOnly = q.options.length === 0;
  const chosen = q.answer?.optionId
    ? q.options.find((o) => o.id === q.answer?.optionId)?.label
    : q.answer?.text;
  // Picked with a letter of the keyboard: it leaves in a moment, unless undone (V-1).
  const choice = useApp((s) => s.choices[q.id]);
  const picked = choice ? q.options.find((o) => o.id === choice) : undefined;
  const locked = busy !== null || pressed !== null || halted || choice !== undefined;

  const send = async (optionId: string) => {
    setBusy(optionId);
    setError(null);
    try {
      await answerQuestion(q.id, { optionId });
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const sendWords = async (e: FormEvent) => {
    e.preventDefault();
    const text = words.trim();
    if (!text || locked) return;
    setBusy('text');
    setError(null);
    try {
      await answerQuestion(q.id, { text });
      setWords('');
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  // A key goes down, clicks, and the answer leaves once the press was seen.
  const press = (optionId: string) => {
    if (locked) return;
    setPressed(optionId);
    playSound('click');
    timer.current = setTimeout(() => {
      setPressed(null);
      void send(optionId);
    }, PRESS_MS);
  };
  useEffect(() => () => clearTimeout(timer.current ?? undefined), []);

  const options = q.options;
  useEffect(() => {
    if (!active || !open || options.length === 0 || locked) return;
    const onKey = (e: KeyboardEvent) => {
      const i = KEYPAD_LETTERS.indexOf(e.key.toUpperCase() as (typeof KEYPAD_LETTERS)[number]);
      if (i < 0 || i >= options.length) return;
      if (!keypadAccepts(e, document.activeElement)) return;
      e.preventDefault();
      // The key sinks and clicks; the answer waits for the undo window.
      setPressed(options[i]!.id);
      playSound('click');
      timer.current = setTimeout(() => {
        setPressed(null);
        chooseOption(q.id, options[i]!.id);
      }, PRESS_MS);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [active, open, options, locked, q.id]);

  // Esc takes back an option picked with the keyboard while it waits (from the composer too).
  useEffect(() => {
    if (!choice) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return;
      if (undoChoice(q.id)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    // Picked from outside the fields: the focus goes to "Undo", one key away.
    const at = document.activeElement;
    if (!at || at === document.body) undoKey.current?.focus({ preventScroll: true });
    return () => window.removeEventListener('keydown', onKey);
  }, [choice, q.id]);

  return (
    <article
      aria-labelledby={`${uid}-q`}
      data-testid="question-card"
      data-question={q.id}
      data-status={q.status}
      data-parked={open && q.parked ? 'true' : undefined}
      data-keypad={active ? 'on' : undefined}
      className="card w-full max-w-[600px] rounded-[14px]"
    >
      <div className="flex items-start gap-3 px-4 pt-4">
        {agent && (
          <MonsterScreen
            genome={agent.genome}
            mood={open ? 'waiting' : 'done'}
            width={34}
            height={30}
            pad={2}
            animated={open}
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="label text-ink-muted">{s.asks(agent?.name ?? s.someone, open)}</p>
          <h3
            id={`${uid}-q`}
            className="mt-0.5 text-large leading-snug font-semibold text-pretty text-ink"
          >
            {plainText(q.question)}
          </h3>
        </div>
      </div>

      {open ? (
        <div className="grid gap-2 px-3 pt-3.5 pb-3">
          {!freeOnly && (
            <ul className="grid gap-2.5" aria-label={s.options}>
              {options.map((o, i) => {
                const rec = o.id === q.recommended;
                const letter = KEYPAD_LETTERS[i];
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      disabled={locked}
                      onClick={() => press(o.id)}
                      data-recommended={rec ? 'true' : undefined}
                      data-pressed={pressed === o.id || choice === o.id ? 'true' : undefined}
                      aria-keyshortcuts={active && letter ? letter : undefined}
                      className={cn(
                        'key keypad-key flex w-full items-center gap-3.5 px-3.5 py-2.5 text-left text-ink',
                        // the pressed key stays solid while the answer leaves
                        locked &&
                          pressed !== o.id &&
                          busy !== o.id &&
                          choice !== o.id &&
                          'opacity-60',
                      )}
                    >
                      {letter && <KeyCap>{letter}</KeyCap>}
                      <span className="min-w-0 flex-1">
                        <span className="block text-large leading-6 font-semibold">
                          {plainText(o.label)}
                        </span>
                        {o.description && (
                          <span className="block text-footnote leading-snug text-ink-muted">
                            {plainText(o.description)}
                          </span>
                        )}
                      </span>
                      {rec && (
                        <span className="label inline-flex shrink-0 items-center gap-2 text-signal-ink">
                          <span aria-hidden className="led" data-tone="signal" />
                          {s.recommended}
                        </span>
                      )}
                      {busy === o.id && <span className="sr-only">{s.sendingSr}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {/* Always there, so screen readers hear the pick and how to take it back. */}
          <p role="status" className="sr-only">
            {picked ? s.chosenSr(plainText(picked.label)) : ''}
          </p>
          {picked && (
            <p
              className="flex flex-wrap items-center gap-x-2 gap-y-1 px-1 pt-1 text-footnote text-ink-muted"
              data-testid="answer-undo"
            >
              <span>
                {s.chosenBefore}
                <strong className="font-semibold text-ink">{plainText(picked.label)}</strong>
              </span>
              <span aria-hidden>·</span>
              <button
                ref={undoKey}
                type="button"
                onClick={() => undoChoice(q.id)}
                aria-keyshortcuts="Escape"
                aria-label={s.undoAnswer}
                className="inline-flex items-center gap-1.5 rounded-[6px] font-medium text-signal-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink"
              >
                {s.undo}
                {keyboard && <KeyCap>{s.escKey}</KeyCap>}
              </button>
            </p>
          )}
          <p
            className={cn(
              'px-1 text-footnote text-ink-muted',
              !freeOnly && 'pt-1',
              picked && 'hidden',
            )}
          >
            {/* Parked (D-078): the monster ended its turn, the answer starts it again. */}
            {q.parked && !halted && (
              <span className="light-on block" data-testid="question-parked">
                {s.parked(agent?.name ?? s.theMonster)}
              </span>
            )}
            {halted
              ? s.resumeToAnswer
              : answerField
                ? freeOnly
                  ? s.writeBelow
                  : s.orWriteBelow
                : freeOnly
                  ? s.answerBelow
                  : active && keyboard
                    ? s.press(lettersText(options.length))
                    : s.orWriteBelow}
          </p>
          {answerField && !halted && (
            <form
              onSubmit={(e) => void sendWords(e)}
              className="flex items-center gap-2 px-1"
              data-testid="question-answer-form"
            >
              <Input
                aria-label={s.answerTo(agent?.name ?? s.answerToDefault)}
                value={words}
                onChange={(e) => setWords(e.target.value)}
                maxLength={5000}
                disabled={locked}
                placeholder={s.placeholder}
                data-testid="question-answer-input"
              />
              <Button type="submit" disabled={locked || words.trim() === ''}>
                {s.answer}
              </Button>
            </form>
          )}
          {error && (
            <p role="alert" className="px-1 text-footnote text-stop-ink">
              {error}
            </p>
          )}
        </div>
      ) : q.status === 'answered' ? (
        <p className="flex items-center gap-2 px-4 pt-2.5 pb-4 text-body text-ink-muted">
          <CheckCircle size={20} weight="fill" aria-hidden className="shrink-0 text-ink" />
          <span>
            {freeOnly || !q.answer?.optionId ? s.youAnswered : s.youChose}{' '}
            <strong className="font-semibold text-ink">{chosen ?? s.sent}</strong>
          </span>
        </p>
      ) : (
        <Expired q={q} />
      )}
    </article>
  );
}
