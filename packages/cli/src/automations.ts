import { formatDate, type AutomationRunNowResponse, type AutomationView } from '@monsters/shared';
import { cliStrings } from './cli.strings.ts';
import type { Io } from './main.ts';

/*
 * `monsters automations list|run <id>` (D-094): the automations of the core
 * and "Run now" from the terminal. The menu of the app does the rest.
 */

type Request = (method: 'GET' | 'POST', path: string, body?: unknown) => Promise<unknown>;

function when(ms: number | null | undefined): string {
  return ms ? formatDate(ms, { dateStyle: 'short', timeStyle: 'short' }) : '-';
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
      io.out(cliStrings().noAutomations);
      return 0;
    }
    const t = cliStrings();
    for (const a of list) {
      const run = a.current ?? a.last;
      const last = run ? (t.runStates[run.state] ?? run.state) : null;
      io.out(`${a.id}  ${a.name} (${t.statuses[a.status] ?? a.status})`);
      io.out(t.automationLine(a.scheduleText, a.lead, when(a.nextRunAt), last));
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
    else if (res.state === 'running') io.out(cliStrings().runStarted(res.runId ?? '?'));
    else io.out(cliStrings().leadBusy);
    return 0;
  }
  io.err(`unknown subcommand: automations ${sub}`);
  io.err('usage: monsters automations list | run <id>');
  return 2;
}
