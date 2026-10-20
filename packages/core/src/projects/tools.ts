import { defineTool, ToolError, type MonstersTool } from '@monsters/shared';
import { z } from 'zod';
import type { AgentDefinition } from '../agents/definition.ts';
import { HaltedError, type RunHandle } from '../kill/run-controller.ts';
import { DispatchError } from '../team/dispatcher.ts';
import type { RunBudget } from '../team/run-limits.ts';
import type { TeamService } from '../team/team-service.ts';
import { ProjectError, type ProjectService } from './service.ts';

/*
 * The orchestrator's tools for the projects (D-097). It stays the single top
 * figure: it does not delegate to a project's monsters (a second level of
 * `delegate` would have no end), it writes to the project's lead with
 * `project_send`; the lead works in its own run, with its own monsters, and
 * its last answer comes back as a `project_report` event that the
 * orchestrator reads at its next turn, or now with `project_status`. Both
 * wait for a search when the monster has many tools (C.2, `deferrable`).
 */

export const PROJECT_SEND = 'project_send';
export const PROJECT_STATUS = 'project_status';

/**
 * What a run already sent, by project and text: the same work is not sent twice while the
 * lead works on it (F-A6). Once its report is in, the same text is a new request.
 */
interface Sent {
  project: string;
  lead: string;
  runId: string;
  /** The message logged for the lead: its report names it. */
  request?: string | undefined;
}
const sentByRun = new WeakMap<object, Map<string, Sent>>();

/** The same request in other spacing or case is the same request. */
function sameWork(project: string, text: string): string {
  return `${project}\n${text.replace(/\s+/g, ' ').trim().toLowerCase()}`;
}

export function projectTools(ctx: {
  self: AgentDefinition;
  team: TeamService;
  projects: ProjectService;
  /** The orchestrator's run: the lead's run inherits its taint (D-098). */
  run?: RunHandle;
  /**
   * The orchestrator's run budget (F-A6): every send counts as a delegation,
   * and the lead's run counts its cost in this run's tree (`onSent`).
   */
  budget?: RunBudget;
  /** A message was logged for the lead (its event id). */
  onSent?: (messageId: string) => void;
  /**
   * `project_status` gave the model the reports of these runs of the leads:
   * a report written after third-party text taints the run that reads it (D-103).
   */
  onReports?: (runIds: string[]) => void;
}): MonstersTool[] {
  const names = () => ctx.team.activeProjects().map((p) => p.name);
  const list = () => names().join(', ') || 'nessuno';
  const send = defineTool({
    name: PROJECT_SEND,
    description:
      'Give work to a project: the message goes to the chat of its lead, who does it with the project’s monsters ' +
      'in its own folder and notes. Returns at once; the lead’s report comes back to you at your next turn ' +
      '(or call project_status). Use it for work that belongs to a project; do the rest yourself or with delegate. ' +
      'Each send counts as a delegation of this task; the lead has its own steps, and what it spends counts with this task’s cost; ' +
      'send one message with the whole request rather than many.',
    inputSchema: z.object({
      project: z
        .string()
        .min(1)
        .max(80)
        .meta({ description: 'Name of the project', enum: names() }),
      text: z
        .string()
        .min(1)
        .max(8000)
        .describe('What the lead should do, with the user’s words and what is already decided'),
    }),
    execute: (input) => Promise.resolve().then(() => sendNow(input)),
  });
  const sendNow = (input: { project: string; text: string }) => {
    try {
      // The same work to the same project in the same run: sent once (F-A6).
      const known = ctx.team.project(input.project);
      const key = known ? sameWork(known.id, input.text) : undefined;
      const owner = ctx.run ?? ctx.budget;
      let already = key && owner ? sentByRun.get(owner)?.get(key) : undefined;
      // Reported (done, failed or stopped): «riprova lo stesso» sends it again (review of 19/10).
      if (already?.request && ctx.projects.reported(already.runId, already.request)) {
        sentByRun.get(owner!)?.delete(key!);
        already = undefined;
      }
      if (already) {
        return {
          status: 'already_sent',
          project: already.project,
          lead: already.lead,
          run_id: already.runId,
          note: `Hai già passato questo lavoro a ${already.lead} in questo turno: non lo rimando. Il rapporto ti arriva al prossimo turno (o con project_status).`,
        };
      }
      ctx.budget?.assertSendRoom();
      const sent = ctx.projects.sendFrom(
        ctx.self.config.id,
        input.project,
        input.text,
        ctx.run?.id,
      );
      ctx.budget?.countSend();
      if (sent.messageId) ctx.onSent?.(sent.messageId);
      const lead = ctx.team.lead(sent.project.id);
      const who = lead?.config.name ?? 'Il capo';
      if (owner) {
        const map = sentByRun.get(owner) ?? new Map<string, Sent>();
        map.set(sameWork(sent.project.id, input.text), {
          project: sent.project.name,
          lead: lead?.config.name ?? sent.agent,
          runId: sent.runId,
          request: sent.messageId,
        });
        sentByRun.set(owner, map);
      }
      return {
        status: sent.queued ? 'queued' : 'sent',
        project: sent.project.name,
        lead: lead?.config.name ?? sent.agent,
        run_id: sent.runId,
        note:
          (sent.queued
            ? `${who} sta finendo un altro lavoro: comincia appena è libero, in un lavoro a parte. `
            : `${who} ci lavora nel progetto. `) +
          'Il rapporto ti arriva al prossimo turno (o con project_status). Dì all’utente in una riga cosa hai passato e a chi; non aspettarlo qui.',
      };
    } catch (err) {
      if (err instanceof ProjectError) {
        throw new ToolError(
          err.code === 'unknown_project' ? 'NOT_FOUND' : 'INVALID_INPUT',
          err.message,
          {
            hint: `Projects: ${list()}.`,
          },
        );
      }
      if (err instanceof DispatchError) throw new ToolError('UNAVAILABLE', err.message);
      if (err instanceof HaltedError) throw new ToolError('ABORTED', err.message);
      throw err;
    }
  };
  const status = defineTool({
    name: PROJECT_STATUS,
    description:
      'How the projects are doing: for each one its lead, what it is doing now, work you sent not reported yet, ' +
      'and its last report to you.',
    inputSchema: z.object({
      project: z.string().max(80).optional().describe('One project; all of them when left out'),
    }),
    readOnly: true,
    execute(input) {
      const wanted = input.project ? ctx.team.project(input.project) : undefined;
      if (input.project && !wanted) {
        return Promise.reject(
          new ToolError('NOT_FOUND', `no project called "${input.project}"`, {
            hint: `Projects: ${list()}.`,
          }),
        );
      }
      const lines = ctx.projects
        .status(ctx.self.config.id)
        .filter((l) => !wanted || l.id === wanted.id);
      const reportRuns = lines.flatMap((l) => (l.lastReport?.runId ? [l.lastReport.runId] : []));
      if (reportRuns.length > 0) ctx.onReports?.(reportRuns);
      return Promise.resolve({
        projects: lines.map((l) => ({
          name: l.name,
          lead: l.lead?.name ?? null,
          now:
            l.lead?.state === 'working' || l.lead?.state === 'waiting'
              ? (l.lead.activity ?? 'al lavoro')
              : 'libero',
          monsters: l.members,
          waiting_reports: l.pending,
          ...(l.lastReport
            ? {
                last_report: {
                  status: l.lastReport.status,
                  at: new Date(l.lastReport.ts).toISOString(),
                  summary: l.lastReport.summary,
                },
              }
            : {}),
        })),
      });
    },
  });
  return [send, status];
}
