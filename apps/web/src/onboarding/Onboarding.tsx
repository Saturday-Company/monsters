import { ArrowClockwise, SignOut } from '@phosphor-icons/react';
import type { OnboardingState, OnboardingStep, TeamConfirmResponse } from '@monsters/shared';
import { useEffect, useState } from 'react';
import { Monster } from '../components/monster/Monster.tsx';
import { Button } from '../components/ui/button.tsx';
import { monsterFor } from '../lib/monsters.ts';
import { navigate } from '../lib/router.ts';
import { cn } from '../lib/utils.ts';
import { getApi, logout, notify, refreshAgents } from '../store/app.ts';
import { AccessStep } from './AccessStep.tsx';
import { onboardingApi, onboardingError } from './api.ts';
import { BirthStep } from './BirthStep.tsx';
import { settleModels } from './models.ts';
import { genomeFrom } from './parts.tsx';
import './boot.css';
import { PermissionsStep } from './PermissionsStep.tsx';
import { QuestionsStep } from './QuestionsStep.tsx';
import { TeamStep } from './TeamStep.tsx';

/*
 * First start (M1.6, simplified in D-053, D-066): four steps, then the birth.
 * 1. Modello: how Monsters reaches a model (OpenRouter key, Claude
 *    subscription, ChatGPT plan, a paid key, or later).
 * 2. Su di te: names, work, rules and tone (three short screens).
 * 3. Cosa possono fare: the permissions.
 * 4. Squadra: the proposed team, editable, then confirmed.
 * The core keeps the progress, so a reload lands on the same step.
 * Layout (docs/design.md, "Primo avvio"): the 52 px rail with the steps as
 * indicator lights, then each step in one big module on the chassis.
 */

interface Stage {
  label: string;
  steps: OnboardingStep[];
}

const STAGES: Stage[] = [
  { label: 'Modello', steps: ['key'] },
  { label: 'Su di te', steps: ['questions'] },
  { label: 'Cosa possono fare', steps: ['permissions'] },
  { label: 'Squadra', steps: ['team'] },
];

function stageOf(step: OnboardingStep): number {
  if (step === 'done') return STAGES.length;
  return Math.max(
    0,
    STAGES.findIndex((s) => s.steps.includes(step)),
  );
}

/** Two digits, as on the panel of an instrument: 01, 02, 03. */
const two = (n: number) => String(n).padStart(2, '0');

/**
 * The steps as a row of indicator lights in the rail (docs/design.md, "Primo
 * avvio"): green done, orange (blinking slowly) the one to do now, a hollow ring
 * for a step left for later. Words go with every light.
 */
function Progress({ step, skipped }: { step: OnboardingStep; skipped: boolean }) {
  const current = stageOf(step);
  return (
    <nav aria-label="Avanzamento">
      <ol className="flex items-center gap-0.5 sm:gap-5">
        {STAGES.map((s, i) => {
          // "Lo faccio dopo" moves on without a model: that step is still to do (audit 2.3).
          const todo = i === 0 && skipped && i < current;
          const done = i < current && !todo;
          const active = i === current;
          return (
            <li
              key={s.label}
              aria-current={active ? 'step' : undefined}
              data-done={done ? 'yes' : 'no'}
              data-todo={todo ? 'yes' : undefined}
              className={cn(
                'label flex h-8 items-center gap-2 px-1',
                active ? 'text-ink' : 'text-ink-muted',
              )}
            >
              {todo ? (
                <span
                  aria-hidden
                  data-testid="step-todo"
                  className="size-2 shrink-0 rounded-full border-[1.5px] border-dashed border-signal-ink"
                />
              ) : (
                <span
                  aria-hidden
                  className="led"
                  data-tone={done ? 'ok' : active ? 'signal' : undefined}
                  data-blink={active ? '' : undefined}
                />
              )}
              <span aria-hidden className="text-ink-faint max-md:hidden">
                {two(i + 1)}
              </span>
              {/* On a phone only the lights: the module below says the step in words (audit UI-39). */}
              <span className={cn('max-md:sr-only', !active && 'max-lg:sr-only')}>{s.label}</span>
              {done && <span className="sr-only">, fatto</span>}
              {todo && <span className="sr-only">, da fare</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/** What the module of a step says in its header. */
function moduleTitle(view: string): string {
  switch (view) {
    case 'key':
      return 'Modello';
    case 'questions':
      return 'Su di te';
    case 'permissions':
      return 'Cosa possono fare';
    case 'team':
      return 'Squadra';
    case 'birth':
      return 'Nascita della squadra';
    default:
      return 'Primo avvio';
  }
}

export function Onboarding() {
  const [state, setState] = useState<OnboardingState | null>(null);
  const [born, setBorn] = useState<TeamConfirmResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchState = () =>
    onboardingApi
      .state()
      .then(setState)
      .catch((err: unknown) => setError(onboardingError(err)));

  const load = () => {
    setError(null);
    void fetchState();
  };

  useEffect(() => {
    void fetchState();
  }, []);

  useEffect(() => {
    if (state?.status === 'done' && !born) navigate('home');
  }, [state?.status, born]);

  const confirmed = (res: TeamConfirmResponse) => {
    setBorn(res);
    // Chains the core cannot pick by itself (a paid key, OpenRouter as fallback), then the team.
    settleModels(
      getApi(),
      res.agents.map((a) => a.id),
    )
      .catch(() => undefined)
      .then(() => refreshAgents())
      .catch(() => notify('Non riesco a caricare la squadra: ricarica la pagina.', 'error'));
  };

  const step: OnboardingStep = born ? 'done' : (state?.step ?? 'key');
  // One key per screen: a new step switches in by frames.
  const view = !state ? (error ? 'error' : 'loading') : born ? 'birth' : step;

  return (
    // The window is the chassis: the rail on top, the step in a module set into it (docs/design.md).
    <main data-window className="relative z-[1] flex h-full flex-col bg-chassis">
      {/* The 52 px rail: drags the window, leaves the system buttons free. */}
      <header
        data-titlebar
        className="titlebar-start titlebar-end flex h-[52px] shrink-0 items-center justify-between gap-3 px-4 sm:px-5"
      >
        <span className="dots text-title3 leading-none text-ink" aria-label="Monsters">
          monsters
        </span>
        <div className="flex min-w-0 items-center gap-1 sm:gap-4">
          {state && !born && <Progress step={step} skipped={state.keySkipped && !state.hasKey} />}
          {/* Signing out is not a step (audit 2.14, UI-39): a small key on the rail, out of the way. */}
          {!born && (
            <button
              type="button"
              onClick={() => void logout()}
              aria-label="Esci dall’account"
              title="Esci dall’account"
              className="key-ghost label h-8 shrink-0 rounded-[8px] px-2 text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink"
            >
              <span className="max-sm:hidden">Esci dall’account</span>
              <SignOut size={16} aria-hidden className="sm:hidden" />
            </button>
          )}
        </div>
      </header>
      <div aria-hidden className="seam-h" />

      <div data-content-card className="scroll-soft min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-[880px] flex-col px-3 sm:px-6">
          {/* Anchored at the top: a new part of the step grows the module downwards (audit UI-17). */}
          <section
            aria-label="Primo avvio"
            className="pt-3 pb-6 sm:pt-[max(24px,5vh)] sm:pb-10"
            data-testid="onboarding"
            data-step={step}
          >
            <div className="boot-module overflow-clip rounded-[18px]">
              {/* The header of the module: which part of the boot, and where we are. */}
              <div className="flex h-11 items-center justify-between gap-3 px-4 sm:px-6">
                <span className="label text-ink-muted">{moduleTitle(view)}</span>
              </div>
              <div aria-hidden className="seam-h" />
              <div key={view} className="rise-in px-4 pt-5 pb-6 sm:px-8 sm:pt-7 sm:pb-8">
                {view === 'error' && (
                  <div className="flex flex-col items-center gap-4 py-8 text-center">
                    <span className="screen screen-lines flex h-[120px] w-[150px] items-center justify-center rounded-[14px]">
                      <Monster genome={monsterFor('mimas')} size={110} expression="error" />
                    </span>
                    <p className="text-large text-ink-muted">{error}</p>
                    <Button onClick={load}>
                      <ArrowClockwise size={18} aria-hidden /> Riprova
                    </Button>
                  </div>
                )}
                {view === 'loading' && (
                  <div className="flex justify-center py-10" aria-busy="true">
                    <span className="sr-only">Carico…</span>
                    <span className="screen screen-lines flex h-[120px] w-[150px] items-center justify-center rounded-[14px]">
                      <Monster genome={monsterFor('titan')} size={110} expression="think" />
                    </span>
                  </div>
                )}
                {born && <BirthStep result={born} />}
                {state && !born && step === 'key' && (
                  <AccessStep
                    guide={genomeFrom(state.guide.genome, state.guide.name)}
                    name={state.guide.name}
                    onState={setState}
                  />
                )}
                {state && !born && step === 'questions' && (
                  <QuestionsStep state={state} onState={setState} />
                )}
                {state && !born && step === 'permissions' && (
                  <PermissionsStep state={state} onState={setState} />
                )}
                {state && !born && step === 'team' && (
                  <TeamStep state={state} onState={setState} onConfirmed={confirmed} />
                )}
              </div>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}

// Kept here for older imports; the hook lives in a small module so the shell can
// use it without loading the whole first start (code splitting, M2.8).
export { useOnboardingRedirect } from './redirect.ts';
