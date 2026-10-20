import type { CoreAuth } from './login.ts';

/*
 * Work in progress on the local core, before something would stop it: switching to another
 * computer or "Esci" stop the core the app started (D-045, D-047), and with it every run.
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

const works = (n: number) => (n === 1 ? 'c’è un lavoro in corso' : `ci sono ${n} lavori in corso`);

/** Leaving this computer for `name`. Button 0 goes on, 1 ("Annulla") is the default. */
export function leaveLocalDialog(name: string, runs: number | null): ConfirmCopy {
  return {
    type: 'warning',
    message:
      runs === null
        ? `Passare a «${name}»?`
        : `Su questo computer ${works(runs)}: se passi a «${name}» ${runs === 1 ? 'si ferma' : 'si fermano'}.`,
    detail:
      runs === null
        ? `Se passi a «${name}», Monsters su questo computer si ferma e i lavori eventualmente in corso si interrompono. Lo ritrovi com’era tornando su «Questo computer».`
        : 'Li ritrovi in Attività tornando su «Questo computer», ma dovrai farli ripartire.',
    buttons: ['Passa comunque', 'Annulla'],
    defaultId: 1,
    cancelId: 1,
  };
}

/**
 * "Esci" (or "Riavvia ora" for an update) with work in progress. Button 0 goes on, 1
 * ("Annulla") is the default.
 */
export function quitDialog(runs: number | null, action: 'quit' | 'update' = 'quit'): ConfirmCopy {
  const verb = action === 'quit' ? 'esci' : 'riavvii per aggiornare';
  return {
    type: 'warning',
    message:
      runs === null
        ? action === 'quit'
          ? 'Uscire da Monsters?'
          : 'Riavviare Monsters per aggiornarlo?'
        : `Su questo computer ${works(runs)}: se ${verb} ${runs === 1 ? 'si ferma' : 'si fermano'}.`,
    detail:
      action === 'update'
        ? 'Monsters si riavvia da solo con la versione nuova; i lavori interrotti li ritrovi in Attività. Se preferisci, aggiorna più tardi.'
        : runs === null
          ? 'Uscendo, Monsters su questo computer si ferma e i lavori eventualmente in corso si interrompono. Per lasciarlo lavorare chiudi solo la finestra.'
          : 'Per lasciare lavorare i mostri chiudi solo la finestra: Monsters resta acceso.',
    buttons: [action === 'quit' ? 'Esci' : 'Riavvia', 'Annulla'],
    defaultId: 1,
    cancelId: 1,
  };
}

/** The first time the window is closed: Monsters keeps working (notification). */
export const CLOSE_NOTICE = {
  title: 'Monsters continua a lavorare',
  body: (quitKeys: string) =>
    `Anche a finestra chiusa i mostri vanno avanti. Per chiudere davvero Monsters: Esci (${quitKeys}).`,
} as const;
