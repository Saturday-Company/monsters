import { AGENT_NAME_PATTERN, type SettingsResponse } from '@monsters/shared';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, describeError } from '../../lib/api.ts';
import { getApi } from '../../store/app.ts';

/** `GET /api/settings`, with a reload: null while loading or when the core does not answer. */
export function useSettings(): [SettingsResponse | null, () => void] {
  const [settings, setSettings] = useState<SettingsResponse | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    getApi()
      .settings()
      .then((s) => alive && setSettings(s))
      .catch(() => alive && setSettings(null));
    return () => {
      alive = false;
    };
  }, [version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return [settings, reload];
}

/**
 * What the user reads for a model service (docs/design.md, glossary): the
 * subscriptions by the name of the plan, "Codex" with what it is for.
 */
const LABELS: Record<string, string> = {
  'claude-agent': 'Abbonamento Claude',
  chatgpt: 'ChatGPT',
  codex: 'Codex (per programmare)',
};

export function serviceLabel(id: string, label?: string): string {
  return LABELS[id] ?? label ?? id;
}

/** Codes whose message from the core is already the sentence to show (Italian, specific). */
const OWN_MESSAGE = new Set([
  'invalid_name',
  'name_taken',
  'team_full',
  'color_too_close',
  'memory_conflict',
  'orchestrator',
  'instructions_edited',
  'invalid_request',
]);

/** Errors of the team, profile and password calls, in plain words. */
export function teamError(err: unknown): string {
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'busy':
        return 'Un mostro sta lavorando: aspetta che finiscano o premi Ferma, poi riprova.';
      case 'wrong_password':
        return 'La password attuale non è giusta.';
      case 'same_password':
        return 'La nuova password è uguale a quella di adesso.';
      case 'halted':
        return 'I mostri sono fermi: premi “Riprendi”, poi riprova.';
      default:
        if (OWN_MESSAGE.has(err.code) && err.message && err.message !== err.code) {
          return err.message;
        }
    }
  }
  return describeError(err);
}

/** A name as the core takes it, checked here first. */
export function nameProblem(name: string): string | null {
  return AGENT_NAME_PATTERN.test(name) ? null : 'Solo lettere, al massimo 24.';
}

/** Runs a call of the core and turns its refusal into the sentence to show. */
export async function plainly<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    throw new Error(teamError(err), { cause: err });
  }
}
