import { ArrowLeft, ArrowRight, Lock } from '@phosphor-icons/react';
import type { Expression } from '@monsters/monster-kit';
import {
  AGENT_NAME_PATTERN,
  ASK_ALWAYS_FIXED,
  ONBOARDING_QUESTIONS,
  checkOnboardingAnswer,
  type OnboardingAnswer,
  type OnboardingGroup,
  type OnboardingQuestion,
  type OnboardingState,
} from '@monsters/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Button } from '../components/ui/button.tsx';
import { Chip } from '../components/ui/controls.tsx';
import { playSound } from '../lib/sound.ts';
import { Input, Label } from '../components/ui/field.tsx';
import { domId } from '../lib/utils.ts';
import { onboardingApi, onboardingError } from './api.ts';
import { Guide } from './Guide.tsx';
import { ErrorLine, ScreenProgress, genomeFrom } from './parts.tsx';

/** How long the starting agent's comment stays before the next screen. */
const REPLY_MS = 950;

/**
 * The fixed questions (shared/onboarding.ts) grouped in three short screens
 * (D-053). `obiettivi` and `strumenti` are no longer asked: they are sent
 * empty (an older answer is kept) and the user can write them in profilo.md.
 */
interface Screen {
  id: string;
  /** What the guide asks; default: the title of the first question. */
  title?: string;
  hint?: string;
  ask: { id: string; label?: string; text?: string }[];
  quiet?: string[];
  /** Question whose `reply` the guide says once the screen is saved. */
  reply: string;
}

const SCREENS: Screen[] = [
  { id: 'nomi', ask: [{ id: 'nomi' }], reply: 'nomi' },
  {
    id: 'lavoro',
    title: 'Di cosa ti occupi, e cosa vorresti delegare?',
    hint: 'Scegli quello che vuoi, anche niente: mi serve per proporti la squadra giusta.',
    ask: [
      { id: 'lavoro', label: 'Il tuo lavoro', text: 'In parole tue (se vuoi)' },
      { id: 'deleghe', label: 'Cosa ti ruba tempo' },
    ],
    quiet: ['obiettivi', 'strumenti'],
    reply: 'deleghe',
  },
  {
    id: 'regole',
    title: 'Due cose ancora: cosa non facciamo mai senza chiederti, e come ti scriviamo?',
    hint: 'Per tutto il resto lavoriamo da soli e ti avvisiamo alla fine.',
    ask: [
      {
        id: 'chiedi',
        label: 'Chiedimi anche prima di',
        text: 'Altro da chiederti sempre (se vuoi)',
      },
      { id: 'tono' },
    ],
    reply: 'tono',
  },
];

const question = (id: string): OnboardingQuestion => ONBOARDING_QUESTIONS.find((q) => q.id === id)!;

/**
 * Always asked, whatever the answer (D-058, shared/team.ts): shown as a fact,
 * not as chips that could be turned off (audit 2.8).
 */
const FIXED_ASK: readonly string[] = ASK_ALWAYS_FIXED;

/**
 * "Cosa ti ruba tempo" follows the work chosen on the same screen (audit 2.11):
 * the union of the lists of every work, in the order of the question.
 */
const DELEGATE_BY_WORK: Record<string, string[]> = {
  social: ['bozze', 'piano', 'ricerche', 'note', 'numeri'],
  sviluppo: ['bug', 'test', 'docs', 'review', 'capire', 'ricerche'],
  marketing: ['ricerche', 'bozze', 'piano', 'numeri'],
  consulenza: ['ricerche', 'riassunti', 'bozze', 'note'],
  impresa: ['bozze', 'numeri', 'riassunti', 'note'],
  studio: ['ricerche', 'riassunti', 'note'],
  scrittura: ['bozze', 'riassunti', 'ricerche', 'note'],
};
const DELEGATE_DEFAULT = ['ricerche', 'bozze', 'riassunti', 'note', 'piano', 'numeri'];

function delegateOptions(work: string[], chosen: string[]): Set<string> {
  const ids = work.flatMap((w) => DELEGATE_BY_WORK[w] ?? []);
  return new Set([...(ids.length ? ids : DELEGATE_DEFAULT), ...chosen]);
}

/** The language of the system, when it is one of the options (audit 2.12). */
function systemLanguage(options: string[]): string | undefined {
  const tag = typeof navigator === 'undefined' ? '' : (navigator.language ?? '');
  const code = tag.slice(0, 2).toLowerCase();
  return options.includes(code) ? code : undefined;
}

const answered = (answers: OnboardingState['answers'], id: string): boolean => {
  const a = answers[id];
  return !!a && checkOnboardingAnswer(question(id), a).length === 0;
};

function firstOpen(answers: OnboardingState['answers']): number {
  const i = SCREENS.findIndex((s) =>
    [...s.ask.map((a) => a.id), ...(s.quiet ?? [])].some((id) => !answered(answers, id)),
  );
  return i < 0 ? SCREENS.length - 1 : i;
}

function draftFor(q: OnboardingQuestion, saved: OnboardingAnswer | undefined): OnboardingAnswer {
  if (saved) return { values: { ...saved.values }, text: saved.text ?? '' };
  const values: Record<string, string[]> = {};
  for (const g of q.groups) {
    const lang = g.id === 'lingua' ? systemLanguage(g.options.map((o) => o.id)) : undefined;
    values[g.id] = lang ? [lang] : [...g.defaults];
  }
  return { values, text: '' };
}

function draftsFor(screen: Screen, answers: OnboardingState['answers']) {
  return Object.fromEntries(
    screen.ask.map((a) => [a.id, draftFor(question(a.id), answers[a.id])]),
  ) as Record<string, OnboardingAnswer>;
}

function fillReply(q: OnboardingQuestion, all: OnboardingState['answers']) {
  const names = all['nomi'];
  return q.reply
    .replace('{orchestrator}', names?.values['orchestrator']?.[0]?.trim() || 'Titan')
    .replace('{user}', names?.values['user']?.[0]?.trim() || '');
}

function NameGroup({
  group,
  value,
  onChange,
  invalid,
  autoFocus,
}: {
  group: OnboardingGroup;
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
  autoFocus: boolean;
}) {
  const id = domId(useId());
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{group.label}</Label>
      <Input
        id={id}
        value={value}
        maxLength={24}
        autoComplete={group.id === 'user' ? 'given-name' : 'off'}
        placeholder={group.placeholder}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={invalid ? true : undefined}
        autoFocus={autoFocus}
      />
      {group.options.length > 0 && (
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Nomi suggeriti">
          {group.options.map((o) => (
            <Chip
              size="lg"
              key={o.id}
              role="radio"
              pressed={value.trim().toLowerCase() === o.id.toLowerCase()}
              onClick={() => onChange(o.id)}
            >
              {o.label}
            </Chip>
          ))}
        </div>
      )}
    </div>
  );
}

function FreeText({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder?: string | undefined;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = domId(useId());
  return (
    <div className="grid gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        value={value}
        maxLength={1000}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

/** The chips of a group: the extras only for "chiedi", the ones of the work for "deleghe". */
function visibleOptions(
  q: OnboardingQuestion,
  g: OnboardingGroup,
  draft: OnboardingAnswer,
  work: string[],
): OnboardingGroup['options'] {
  if (q.id === 'chiedi') return g.options.filter((o) => !FIXED_ASK.includes(o.id));
  if (q.id === 'deleghe') {
    const show = delegateOptions(work, draft.values[g.id] ?? []);
    return g.options.filter((o) => show.has(o.id));
  }
  return g.options;
}

/** Step 2: who you are and what you need, in three short screens. */
export function QuestionsStep({
  state,
  onState,
}: {
  state: OnboardingState;
  onState: (s: OnboardingState) => void;
}) {
  const [index, setIndex] = useState(() => firstOpen(state.answers));
  const screen = SCREENS[index]!;
  const [drafts, setDrafts] = useState(() => draftsFor(screen, state.answers));
  const [reply, setReply] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const first = question(screen.ask[0]!.id);
  const guideName =
    (screen.id === 'nomi'
      ? drafts['nomi']?.values['orchestrator']?.[0]
      : state.guide.name
    )?.trim() || state.guide.name;

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  const go = (next: number, answers = state.answers) => {
    setIndex(next);
    setDrafts(draftsFor(SCREENS[next]!, answers));
    setProblem(null);
  };

  const set = (qid: string, group: OnboardingGroup, v: string) => {
    setDrafts((all) => {
      const d = all[qid]!;
      const current = d.values[group.id] ?? [];
      let next: string[];
      if (group.kind === 'multi') {
        next = current.includes(v) ? current.filter((x) => x !== v) : [...current, v];
      } else if (group.kind === 'single') {
        next = [v];
      } else {
        next = v === '' ? [] : [v];
      }
      return { ...all, [qid]: { ...d, values: { ...d.values, [group.id]: next } } };
    });
  };

  const setText = (qid: string, text: string) =>
    setDrafts((all) => ({ ...all, [qid]: { ...all[qid]!, text } }));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy || reply) return;
    const answers: Record<string, OnboardingAnswer> = {};
    for (const ask of screen.ask) {
      const q = question(ask.id);
      const draft = drafts[ask.id]!;
      const answer: OnboardingAnswer = {
        values: Object.fromEntries(
          q.groups.map((g) => {
            const vals = (draft.values[g.id] ?? []).map((v) => v.trim()).filter(Boolean);
            // The fixed "always ask" are always in, the extras are the user's.
            return [g.id, q.id === 'chiedi' ? [...new Set([...FIXED_ASK, ...vals])] : vals];
          }),
        ),
        ...(q.freeText && draft.text?.trim() ? { text: draft.text.trim() } : {}),
      };
      for (const g of q.groups) {
        const vals = answer.values[g.id] ?? [];
        if (g.required && vals.length === 0) {
          setProblem(
            g.kind === 'name'
              ? `Scrivi ${g.label?.toLowerCase() ?? 'un nome'}.`
              : 'Scegli una opzione.',
          );
          return;
        }
        if (g.kind === 'name' && vals.some((v) => !AGENT_NAME_PATTERN.test(v))) {
          setProblem('Per i nomi usa solo lettere (anche spazi e apostrofi), massimo 24.');
          return;
        }
      }
      answers[ask.id] = answer;
    }
    // Questions no longer asked: empty, unless answered before.
    for (const id of screen.quiet ?? []) {
      if (!answered(state.answers, id)) answers[id] = { values: { cosa: [] } };
    }
    setBusy(true);
    setProblem(null);
    try {
      const next = await onboardingApi.submit({ answers });
      setReply(fillReply(question(screen.reply), next.answers));
      timer.current = setTimeout(() => {
        setReply(null);
        setBusy(false);
        if (index < SCREENS.length - 1) {
          go(index + 1, next.answers);
          onState({ ...next, step: 'questions' });
        } else {
          onState(next);
        }
      }, REPLY_MS);
    } catch (err) {
      setProblem(onboardingError(err));
      setBusy(false);
    }
  };

  const expression: Expression = reply ? 'happy' : 'talk';
  const title = screen.title ?? first.title;
  const hint = screen.hint ?? first.hint;
  const multi = screen.ask.length > 1;
  // Until the names are saved the guide is "il tuo primo mostro" (audit 2.16).
  const named = screen.id !== 'nomi' || !!reply;
  const work = drafts['lavoro']?.values['cosa'] ?? [];

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      className="grid gap-6"
      data-testid="question"
      data-question={screen.id}
    >
      <Guide
        genome={genomeFrom(state.guide.genome, guideName)}
        name={guideName}
        named={named}
        expression={expression}
        sayKey={reply ? `reply-${screen.id}` : `q-${screen.id}`}
        say={reply ?? title}
        hint={reply ? undefined : hint}
      />

      <ScreenProgress
        total={SCREENS.length}
        current={index}
        done={index + (reply ? 1 : 0)}
        flash={!!reply}
      />

      <fieldset className="grid gap-5" disabled={busy}>
        <legend className="sr-only">{title}</legend>
        {screen.ask.map((ask, ai) => {
          const q = question(ask.id);
          const draft = drafts[ask.id]!;
          return (
            <div key={ask.id} className="grid gap-4" data-ask={ask.id}>
              {q.groups.map((g, gi) => {
                const label = g.label ?? (multi ? ask.label : undefined);
                return g.kind === 'name' ? (
                  <NameGroup
                    key={`${q.id}-${g.id}`}
                    group={g}
                    value={draft.values[g.id]?.[0] ?? ''}
                    onChange={(v) => set(q.id, g, v)}
                    invalid={!!problem}
                    autoFocus={ai === 0 && gi === 0}
                  />
                ) : (
                  <div key={`${q.id}-${g.id}`} className="grid gap-2">
                    {q.id === 'chiedi' && (
                      <p
                        className="card flex items-start gap-2.5 rounded-[12px] px-3.5 py-3 text-body leading-snug text-ink"
                        data-testid="ask-always-fixed"
                      >
                        <Lock size={20} className="mt-px shrink-0 text-ink-muted" aria-hidden />
                        <span>
                          <strong className="font-semibold">
                            Pubblicare, scrivere ad altri, spendere e cancellare:
                          </strong>{' '}
                          te lo chiediamo sempre.
                        </span>
                      </p>
                    )}
                    {label && <p className="text-footnote font-medium text-ink">{label}</p>}
                    <div
                      className="flex flex-wrap gap-2"
                      role={g.kind === 'single' ? 'radiogroup' : 'group'}
                      aria-label={label ?? q.title}
                    >
                      {visibleOptions(q, g, draft, work).map((o) => (
                        <Chip
                          size="lg"
                          key={o.id}
                          {...(g.kind === 'single' ? { role: 'radio' as const } : {})}
                          pressed={(draft.values[g.id] ?? []).includes(o.id)}
                          onClick={() => set(q.id, g, o.id)}
                        >
                          {o.label}
                        </Chip>
                      ))}
                    </div>
                  </div>
                );
              })}
              {ask.text && q.freeText && (
                <FreeText
                  label={ask.text}
                  placeholder={q.freeText}
                  value={draft.text ?? ''}
                  onChange={(v) => setText(q.id, v)}
                />
              )}
            </div>
          );
        })}
      </fieldset>

      {problem && <ErrorLine>{problem}</ErrorLine>}

      <div className="flex items-center justify-between gap-3">
        <Button
          variant="ghost"
          onClick={() => go(index - 1)}
          disabled={index === 0 || busy}
          className={index === 0 ? 'invisible' : undefined}
        >
          <ArrowLeft size={18} aria-hidden /> Indietro
        </Button>
        <Button type="submit" size="lg" disabled={busy} onClick={() => playSound('click')}>
          Avanti <ArrowRight size={18} aria-hidden />
        </Button>
      </div>
    </form>
  );
}
