import type { AutomationRunNowResponse, AutomationView } from '@monsters/shared';
import type { Io } from './main.ts';

/*
 * `monsters automations list|run <id>` (D-094): the automations of the core
 * and "Esegui ora" from the terminal. The menu of the app does the rest.
 */

type Request = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown>;

const STATE_WORDS: Record<string, string> = {
  waiting_lead: 'aspetta che il capo si liberi',
  running: 'in corso',
  waiting_user: 'aspetta una risposta',
  completed: 'finito',
  failed: 'non riuscito',
  aborted: 'fermato',
  skipped: 'saltato',
};

const STATUS_WORDS: Record<string, string> = {
  active: 'attiva',
  paused: 'in pausa',
  draft: 'bozza',
};

function when(ms: number | null | undefined): string {
  return ms ? new Date(ms).toLocaleString() : '-';
}

export async function cmdAutomations(
  args: string[],
  request: Request,
  io: Io,
  json = false,
): Promise<number> {
  const [sub = 'list', id] = args;
  if (sub === 'list') {
    const list = (await request('GET', '/api/automations')) as AutomationView[];
    if (json) {
      io.out(JSON.stringify(list));
      return 0;
    }
    if (list.length === 0) {
      io.out('Nessuna automazione.');
      return 0;
    }
    for (const a of list) {
      const run = a.current ?? a.last;
      const state = run ? ` · ultimo giro: ${STATE_WORDS[run.state] ?? run.state}` : '';
      io.out(`${a.id}  ${a.name} (${STATUS_WORDS[a.status] ?? a.status})`);
      io.out(`  ${a.scheduleText} · capo: ${a.lead} · prossimo: ${when(a.nextRunAt)}${state}`);
    }
    return 0;
  }
  if (sub === 'run') {
    if (!id) {
      io.err('usage: monsters automations run <id>');
      return 2;
    }
    const res = (await request(
      'POST',
      `/api/automations/${encodeURIComponent(id)}/run`,
    )) as AutomationRunNowResponse;
    if (json) io.out(JSON.stringify(res));
    else if (res.state === 'running') io.out(`Giro avviato (run ${res.runId ?? '?'}).`);
    else io.out('Il capo sta lavorando: il giro parte appena è libero.');
    return 0;
  }
  io.err(`unknown subcommand: automations ${sub}`);
  io.err('usage: monsters automations list | run <id>');
  return 2;
}
