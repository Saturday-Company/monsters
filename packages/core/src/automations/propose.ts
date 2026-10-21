import { defineTool, formatDate, ToolError, type MonstersTool } from '@monsters/shared';
import { z } from 'zod';
import type { AgentDefinition } from '../agents/definition.ts';
import type { RunHandle } from '../kill/run-controller.ts';
import type { TeamService } from '../team/team-service.ts';
import { AutomationError, type AutomationService } from './service.ts';

/*
 * `automation_propose` (D-098): the orchestrator, or a project's lead for its
 * own squad, proposes an automation as a draft (D-094 `status: draft`). The
 * model turns the user's words into a cron rule and a time zone; the tool
 * checks it with the scheduler and answers with the Italian description and
 * the next slot, so the model can see whether it understood. The user
 * confirms it with one tap; until then it never runs.
 */

export const AUTOMATION_PROPOSE = 'automation_propose';

export const ProposeAutomationInput = z.object({
  name: z.string().min(1).max(80),
  cron: z
    .string()
    .min(9)
    .max(120)
    .describe('5 fields m h dom mon dow, e.g. "0 23 * * 0" = Sundays 23:00, "0 8 * * 1-5"'),
  timezone: z.string().max(64).optional().describe("IANA zone; default the user's"),
  objective: z.string().min(5).max(4000).describe('What the lead does at every run'),
  participants: z.array(z.string().max(40)).max(8).optional().describe('Names of the monsters'),
  project: z.string().max(80).optional().describe('A project: its lead does it'),
  results_folder: z.string().max(300).optional().describe('Notes folder for the results'),
  telegram: z.boolean().optional().describe('Tell the user on Telegram at the end'),
});

/** A rule with a fixed day of the month and a fixed month: it fires once a year. */
export function onceAYear(cron: string): boolean {
  const [, , dom, mon] = cron.trim().split(/\s+/);
  return /^\d{1,2}$/.test(dom ?? '') && /^\d{1,2}$/.test(mon ?? '');
}

function when(at: number | null, timezone: string): string | null {
  if (at === null) return null;
  return formatDate(at, {
    timeZone: timezone,
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function automationProposeTool(ctx: {
  run: RunHandle;
  self: AgentDefinition;
  team: TeamService;
  automations: AutomationService;
  userName?: string | undefined;
  /** The source of the run's taint, when it had read third-party text (D-103). */
  taint?: () => string | undefined;
}): MonstersTool {
  const user = ctx.userName?.trim() || 'the user';
  const lead = ctx.self.config.kind === 'lead';
  return defineTool({
    name: AUTOMATION_PROPOSE,
    description:
      `Propose recurring work on a schedule (an automation) when ${user} asks for it. ` +
      `${user} confirms the draft with one tap; it never runs before. Returns at once with the schedule in words.`,
    inputSchema: ProposeAutomationInput,
    execute: (input, tc) =>
      Promise.resolve().then(() => {
        const { team, automations, self } = ctx;
        try {
          // A lead proposes for its own project; the orchestrator for its squad or a project.
          const project = lead
            ? team.projectOf(self.config.id)
            : input.project
              ? team.project(input.project)
              : undefined;
          if (input.project && !lead && (!project || project.archivedAt !== undefined)) {
            const names = team.activeProjects().map((p) => p.name);
            throw new ToolError('NOT_FOUND', `no project called "${input.project}"`, {
              hint: `Projects: ${names.join(', ') || 'none'}.`,
            });
          }
          const squad = team.members(project?.id);
          const participants: string[] = [];
          for (const n of input.participants ?? []) {
            const m = team.get(n);
            if (!m || !squad.some((s) => s.config.id === m.config.id)) {
              throw new ToolError('INVALID_INPUT', `"${n}" is not a monster of this squad`, {
                hint: `Monsters: ${squad.map((s) => s.config.name).join(', ')}.`,
              });
            }
            participants.push(m.config.id);
          }
          const open = automations
            .list()
            .find(
              (a) =>
                a.status === 'draft' &&
                a.createdBy === self.config.id &&
                a.name.toLowerCase() === input.name.trim().toLowerCase(),
            );
          const preview = automations.preview({ cron: input.cron, timezone: input.timezone });
          // A day and a month fixed: once a year, usually a one-off in disguise (eval of D-098).
          if (onceAYear(preview.cron) && !open) {
            throw new ToolError('INVALID_INPUT', `"${preview.text}" runs once a year`, {
              hint: `An automation is work that repeats. Something to do once is not one: tell ${user} so. A yearly one is made from the app.`,
            });
          }
          const a =
            open ??
            automations.create(
              {
                name: input.name,
                ...(lead ? { lead: self.config.id } : {}),
                ...(project ? { project: project.id } : {}),
                participants,
                schedule: { cron: preview.cron, timezone: preview.timezone },
                objective: input.objective,
                ...(input.results_folder ? { resultsFolder: input.results_folder } : {}),
                notify: { app: true, telegram: input.telegram ?? false },
                status: 'draft',
              },
              'system',
              self.config.id,
              { runId: ctx.run.id, parentId: tc.callEventId ?? null, taint: ctx.taint?.() },
            );
          const shown = open ? automations.preview(open.schedule) : preview;
          return {
            status: open ? 'already_proposed' : 'proposed',
            automation: a.name,
            when: shown.text,
            next_run: when(shown.next, shown.timezone),
            timezone: shown.timezone,
            note:
              `Draft sent to ${user}. If "when" is not what ${user} asked, propose again with the right cron. ` +
              `Tell ${user} in one line what and when, and stop: it runs only after the tap.`,
          };
        } catch (err) {
          if (err instanceof AutomationError) {
            throw new ToolError('INVALID_INPUT', err.message, {
              hint:
                err.code === 'invalid_schedule'
                  ? 'cron: five fields (minute hour day month weekday), e.g. "0 23 * * 0".'
                  : 'Fix that field and call the tool again once.',
            });
          }
          throw err;
        }
      }),
  });
}
