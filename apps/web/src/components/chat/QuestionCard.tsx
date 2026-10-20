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
import { answerQuestion, askAgain, errorText, notify, useApp } from '../../store/app.ts';
import { runOwners } from '../../store/derive.ts';
import { useAgent, useMediaQuery } from '../../store/hooks.ts';
import { cn, domId } from '../../lib/utils.ts';
import { plainText } from '../../lib/markdown.ts';
import { playSound } from '../../lib/sound.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { Button, KeyCap } from '../ui/button.tsx';
import { Input } from '../ui/field.tsx';

/** The letters of the keypad, one per option (2-4 options). */
export const KEYPAD_LETTERS = ['A', 'B', 'C', 'D'] as const;

/** How long a key stays down before the answer leaves (the press must be seen). */
const PRESS_MS = 120;

/**
 * The question the composer answers: its keypad takes the letters typed with
 * the composer empty (one keypad at a time, the oldest open question).
 */
export const ActiveKeypad = createContext<string | null>(null);

/**
 * Whether a key press may play the keypad: no modifier, and the focus is not in
 * a field with something in it (the empty composer is fine: its letters would
 * be the first of a free answer, which the keypad answers better).
 */
export function keypadAccepts(
  e: Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'repeat' | 'defaultPrevented'>,
  active: { tagName: string; id?: string; value?: string; isContentEditable?: boolean } | null,
): boolean {
  if (e.metaKey || e.ctrlKey || e.altKey || e.repeat || e.defaultPrevented) return false;
  if (!active) return true;
  if (active.isContentEditable) return false;
  const tag = active.tagName.toUpperCase();
  if (tag === 'TEXTAREA') return active.id === 'composer-input' && !active.value;
  return tag !== 'INPUT' && tag !== 'SELECT';
}

/** "A, B o C": the letters of a keypad of `n` options, in words. */
export function lettersText(n: number): string {
  const l = KEYPAD_LETTERS.slice(0, Math.max(0, Math.min(n, KEYPAD_LETTERS.length)));
  if (l.length <= 1) return l.join('');
  return `${l.slice(0, -1).join(', ')} o ${l.at(-1)}`;
}

type ExpiredWhy = LogEvent<'question_expired'>['data']['reason'];

/** Why a question closed without an answer, in words. */
const EXPIRED_TEXT: Record<NonNullable<ExpiredWhy> | 'other', string> = {
  kill: 'Non hai risposto: hai fermato i mostri.',
  run_aborted: 'Non hai risposto: il lavoro si è fermato.',
  restart: 'Non hai risposto: Monsters si è riavviato.',
  agent_archived: 'Non hai risposto: il mostro è stato tolto dalla squadra.',
  run_ended: 'Non serve più: il lavoro è finito senza questa azione.',
  other: 'La domanda è scaduta.',
};

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

/** A question that will never be answered: why, and "Chiedimelo di nuovo" when it makes sense. */
function Expired({ q }: { q: Question }) {
  const halted = useApp((s) => s.halted);
  const events = useApp((s) => s.events);
  const expiry = useMemo(() => expiryOf(events, q), [events, q]);
  const [sent, setSent] = useState(false);
  const why = expiry?.why;
  // While stopped, "Riprendi e continua" in the halt band does it: the key comes after.
  const again = !halted && why !== 'agent_archived' && !expiry?.resumed && !sent;
  return (
    <div className="grid gap-2.5 px-4 pt-2.5 pb-4" data-testid="question-expired" data-why={why}>
      <p className="flex items-center gap-2 text-body text-ink-muted">
        {/* An unlit light, never the tick of "done": nobody answered. */}
        <span aria-hidden className="led" data-tone={why === 'kill' ? 'stop' : undefined} />
        <span>{EXPIRED_TEXT[why ?? 'other']}</span>
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
            Chiedimelo di nuovo
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * A question from a monster as a keypad (docs/design.md, "Domanda con
 * opzioni"): the options are full-width keys with their letter, the
 * recommended one with the orange lamp. With the composer empty, the letter on
 * the keyboard presses the key (it sinks, it clicks if the sounds are on).
 * Words of one's own go in the composer below, which answers the open
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
   * question of a round said "Rispondi qui sotto, nel campo dei messaggi" on a
   * page without one, and could be answered only from the CLI.
   */
  answerField?: boolean;
}) {
  const q = useApp((s) => s.questions[questionId]);
  if (!q) return null;
  return <QuestionBody q={q} answerField={answerField} />;
}

function QuestionBody({ q, answerField }: { q: Question; answerField: boolean }) {
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
  const uid = domId(useId());
  const open = q.status === 'open';
  const freeOnly = q.options.length === 0;
  const chosen = q.answer?.optionId
    ? q.options.find((o) => o.id === q.answer?.optionId)?.label
    : q.answer?.text;
  const locked = busy !== null || pressed !== null || halted;

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
      press(options[i]!.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // `press` only reads state that is in the dependencies
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, open, options, locked]);

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
          <p className="label text-ink-muted">
            {agent?.name ?? 'Un mostro'} {open ? 'ti chiede' : 'ti aveva chiesto'}
          </p>
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
            <ul className="grid gap-2.5" aria-label="Opzioni">
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
                      data-pressed={pressed === o.id ? 'true' : undefined}
                      aria-keyshortcuts={active && letter ? letter : undefined}
                      className={cn(
                        'key keypad-key flex w-full items-center gap-3.5 px-3.5 py-2.5 text-left text-ink',
                        // the pressed key stays solid while the answer leaves
                        locked && pressed !== o.id && busy !== o.id && 'opacity-60',
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
                          Consigliata
                        </span>
                      )}
                      {busy === o.id && <span className="sr-only">Invio in corso</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          <p className={cn('px-1 text-footnote text-ink-muted', !freeOnly && 'pt-1')}>
            {/* Parked (D-078): the monster ended its turn, the answer starts it again. */}
            {q.parked && !halted && (
              <span className="light-on block" data-testid="question-parked">
                {agent?.name ?? 'Il mostro'} ha messo in pausa il lavoro: riparte quando rispondi.
              </span>
            )}
            {halted
              ? 'Riprendi i mostri per rispondere.'
              : answerField
                ? freeOnly
                  ? 'Scrivi la tua risposta qui sotto.'
                  : 'Oppure scrivi la tua risposta qui sotto.'
                : freeOnly
                  ? 'Rispondi qui sotto, nel campo dei messaggi.'
                  : active && keyboard
                    ? `Premi ${lettersText(options.length)} sulla tastiera, oppure scrivi la tua risposta qui sotto.`
                    : 'Oppure scrivi la tua risposta qui sotto.'}
          </p>
          {answerField && !halted && (
            <form
              onSubmit={(e) => void sendWords(e)}
              className="flex items-center gap-2 px-1"
              data-testid="question-answer-form"
            >
              <Input
                aria-label={`Risposta a ${agent?.name ?? 'il mostro'}`}
                value={words}
                onChange={(e) => setWords(e.target.value)}
                maxLength={5000}
                disabled={locked}
                placeholder="La tua risposta"
                data-testid="question-answer-input"
              />
              <Button type="submit" disabled={locked || words.trim() === ''}>
                Rispondi
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
            {freeOnly || !q.answer?.optionId ? 'Hai risposto:' : 'Hai scelto:'}{' '}
            <strong className="font-semibold text-ink">{chosen ?? 'risposta inviata'}</strong>
          </span>
        </p>
      ) : (
        <Expired q={q} />
      )}
    </article>
  );
}
