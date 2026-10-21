import { coreJobsStrings } from './core-jobs.strings.ts';
import type { CoreAuth } from './login.ts';

/*
 * Work in progress on the local core, before something would stop it: switching to another
 * computer or "Quit" stop the core the app started (D-045, D-047), and with it every run.
 * The count comes from `GET /api/status` (`runs`: the active runs of RunController), asked with
 * the CLI token of the data directory or the window's cookie. When the core does not answer in
 * time the count is unknown (null) and the app asks anyway: losing work silently is worse than
 * one question too many. Pure logic (fetch injected), tested in test/connections-ux.test.ts.
 */

const STATUS_TIMEOUT_MS = 2_000;

/** Number of active runs on the core at `url`, or null when it cannot be known. */
export async function activeRunCount(
  url: string,
  auth: CoreAuth | null,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = STATUS_TIMEOUT_MS,
): Promise<number | null> {
  if (!auth) return null;
  try {
    const res = await fetchImpl(`${url}/api/status`, {
      headers:
        'bearer' in auth
          ? { authorization: `Bearer ${auth.bearer}` }
          : { cookie: `monsters_session=${auth.cookie}` },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { runs?: unknown };
    return Array.isArray(body.runs) ? body.runs.length : null;
  } catch {
    return null;
  }
}

/**
 * Whether to ask before the local core stops. Only a core the app started stops (`owned`):
 * a core of the CLI keeps running, and a remote one is never stopped by the app. No core yet
 * (starting, crashed) means nothing to lose.
 */
export function shouldConfirmStop(
  kind: 'owned' | 'attached' | 'remote' | null,
  runs: number | null,
): boolean {
  if (kind !== 'owned') return false;
  return runs === null || runs > 0;
}

/** The fields of Electron's MessageBoxOptions used by the confirmations. */
export interface ConfirmCopy {
  type: 'warning';
  message: string;
  detail: string;
  buttons: string[];
  defaultId: number;
  cancelId: number;
}

/** Leaving this computer for `name`. Button 0 goes on, 1 ("Cancel") is the default. */
export function leaveLocalDialog(name: string, runs: number | null): ConfirmCopy {
  const t = coreJobsStrings();
  return {
    type: 'warning',
    message:
      runs === null ? t.leave.unknownMessage(name) : t.running(runs, t.leave.condition(name)),
    detail: runs === null ? t.leave.unknownDetail(name) : t.leave.detail,
    buttons: [t.leave.go, t.leave.cancel],
    defaultId: 1,
    cancelId: 1,
  };
}

/**
 * "Quit" (or "Restart now" for an update) with work in progress. Button 0 goes on, 1
 * ("Cancel") is the default.
 */
export function quitDialog(runs: number | null, action: 'quit' | 'update' = 'quit'): ConfirmCopy {
  const t = coreJobsStrings();
  const condition = action === 'quit' ? t.quit.quitCondition : t.quit.updateCondition;
  return {
    type: 'warning',
    message:
      runs === null
        ? action === 'quit'
          ? t.quit.unknownMessage
          : t.quit.unknownUpdateMessage
        : t.running(runs, condition),
    detail:
      action === 'update'
        ? t.quit.updateDetail
        : runs === null
          ? t.quit.unknownDetail
          : t.quit.detail,
    buttons: [action === 'quit' ? t.quit.quit : t.quit.restart, t.quit.cancel],
    defaultId: 1,
    cancelId: 1,
  };
}

/** The first time the window is closed: Monsters keeps working (notification). */
export function closeNotice(quitKeys: string): { title: string; body: string } {
  const t = coreJobsStrings().closeNotice;
  return { title: t.title, body: t.body(quitKeys) };
}
