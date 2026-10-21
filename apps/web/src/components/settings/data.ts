import { AGENT_NAME_PATTERN, type SettingsResponse } from '@monsters/shared';
import { useCallback, useEffect, useState } from 'react';
import { ApiError, describeError } from '../../lib/api.ts';
import { getApi } from '../../store/app.ts';
import { dataStrings } from './data.strings.ts';

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
export function serviceLabel(id: string, label?: string): string {
  const s = dataStrings().services;
  switch (id) {
    case 'claude-agent':
      return s.claudeAgent;
    case 'chatgpt':
      return 'ChatGPT';
    case 'codex':
      return s.codex;
    default:
      return label ?? id;
  }
}

/** Codes whose message from the core is already the sentence to show (specific). */
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
  const e = dataStrings().errors;
  if (err instanceof ApiError) {
    switch (err.code) {
      case 'busy':
        return e.busy;
      case 'wrong_password':
        return e.wrongPassword;
      case 'same_password':
        return e.samePassword;
      case 'halted':
        return e.halted;
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
  return AGENT_NAME_PATTERN.test(name) ? null : dataStrings().nameProblem;
}

/** Runs a call of the core and turns its refusal into the sentence to show. */
export async function plainly<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (err) {
    throw new Error(teamError(err), { cause: err });
  }
}
