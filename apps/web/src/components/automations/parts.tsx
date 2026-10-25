import type { AutomationRunState } from '@monsters/shared';
import { useEffect, useRef, useState } from 'react';
import { describeError } from '../../lib/api.ts';
import { runStateText, runStateTone } from '../../lib/automations.ts';
import { cn } from '../../lib/utils.ts';
import { useApp } from '../../store/app.ts';

/*
 * Small parts of the Automazioni section (docs/design.md, "Automazioni"): the
 * light of a run's state, and
 * the data hooks that follow the event stream (a new `automation_*` event
 * reads the definitions again; a giro on screen follows its own runs).
 */

/** The id of the latest `automation_*` event: it changes whenever an automation or a giro does. */
export function useAutomationTick(): string {
  return useApp((s) => {
    for (let i = s.events.length - 1; i >= 0; i--) {
      const e = s.events[i]!;
      if (e.type.startsWith('automation_')) return e.id;
    }
    return '';
  });
}

/**
 * The id of the latest event of a giro's runs (an answer to its question
 * continues it in a new run): the conversation on screen grows with it.
 */
export function useGiroTick(giro: string): string {
  return useApp((s) => {
    const runs = new Set([giro]);
    let last = '';
    for (const e of s.events) {
      if (e.type === 'automation_run_started' && e.data.giro === giro && e.runId) runs.add(e.runId);
      if (e.runId && runs.has(e.runId)) last = e.id;
    }
    return last;
  });
}

export interface Loaded<T> {
  data: T | null;
  error: string | null;
  /** Puts what an action returned, without a round trip. */
  set: (value: T) => void;
  /** Asks again (the retry after an error). */
  retry: () => void;
}

/**
 * Loads `load()`, and again whenever `key` changes (an event of the stream);
 * the data stays on screen until the new one arrives.
 */
export function useLoaded<T>(load: () => Promise<T>, key: string): Loaded<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const fn = useRef(load);
  useEffect(() => {
    fn.current = load;
  });
  useEffect(() => {
    let live = true;
    fn.current()
      .then((v) => {
        if (!live) return;
        setData(v);
        setError(null);
      })
      .catch((err: unknown) => live && setError(describeError(err)));
    return () => {
      live = false;
    };
  }, [key, attempt]);
  return {
    data,
    error,
    set: setData,
    retry: () => {
      setError(null);
      setAttempt((n) => n + 1);
    },
  };
}

/** The light and the word of a run's state ("Fatto", "Aspetta una risposta"…). */
export function RunState({ state, className }: { state: AutomationRunState; className?: string }) {
  const tone = runStateTone(state);
  return (
    <span
      className={cn('inline-flex min-w-0 items-center gap-2', className)}
      data-testid="run-state"
      data-state={state}
    >
      <span
        aria-hidden
        className="led"
        data-tone={tone}
        data-blink={state === 'waiting_user' ? '' : undefined}
      />
      <span className="truncate">{runStateText(state)}</span>
    </span>
  );
}
