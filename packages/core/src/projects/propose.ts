import { defineTool, ToolError, type MonstersTool } from '@monsters/shared';
import { z } from 'zod';
import type { AgentDefinition } from '../agents/definition.ts';
import type { RunHandle } from '../kill/run-controller.ts';
import { hueOfColor } from '../team/propose-monster.ts';
import { ProjectError, type ProjectProposalInput, type ProjectService } from './service.ts';

/*
 * `project_propose` (D-098): the orchestrator proposes a whole project as a
 * draft (name, folder, lead, 1-4 monsters, connections, cap, first
 * automations). Nothing is created: the user confirms it with one tap from
 * "Da rivedere", the chat or Telegram, as for a new monster (D-075). The
 * definition is long: it waits for `tools_search` like the other tools of the
 * projects (C.2), the Monsters card says it exists.
 */

export const PROJECT_PROPOSE = 'project_propose';

const oneOrMany = (v: unknown) => (typeof v === 'string' ? [v] : v);

const Monster = z.object({
  copy_of: z
    .string()
    .max(40)
    .optional()
    .describe(
      'Only if the user explicitly asked to bring this specific monster into the project: copies its role, rules and models, with a new name and look',
    ),
  name: z.string().min(1).max(24).optional().describe('A name no other monster has'),
  role: z.string().min(5).max(120).optional().describe('What it does, one line'),
  mission: z.string().min(5).max(200).optional().describe('Its job, second person'),
  duties: z.preprocess(oneOrMany, z.array(z.string().min(5).max(200)).max(4)).optional(),
  web: z.boolean().optional(),
  model: z.string().max(200).optional().describe('"provider/model" only if asked'),
  color: z.string().max(30).optional(),
});

export const ProposeProjectInput = z.object({
  name: z.string().min(1).max(40),
  goal: z.string().min(3).max(300).describe('What the project is for, one line'),
  folder: z
    .string()
    .max(1000)
    .optional()
    .describe('Absolute path of an existing folder, or "new"; leave out if not needed'),
  lead: z
    .object({ name: z.string().max(24).optional(), copy_of: z.string().max(40).optional() })
    .optional(),
  monsters: z
    .array(Monster)
    .min(1)
    .max(4)
    .describe(
      'New monsters of their own (name, role, mission), with names no monster has; copy_of only if asked',
    ),
  connections: z
    .array(z.string().max(64))
    .max(20)
    .optional()
    .describe(
      'Connected services the project needs besides those of the whole team (those are already in)',
    ),
  monthly_cap_eur: z.number().min(0.5).max(10_000).optional(),
  automations: z
    .array(
      z.object({
        name: z.string().min(1).max(80),
        cron: z.string().min(9).max(120).describe('5 fields, e.g. "0 23 * * 0" = Sundays 23:00'),
        timezone: z.string().max(64).optional(),
        objective: z.string().min(5).max(2000),
        participants: z.array(z.string().max(40)).max(8).optional(),
      }),
    )
    .max(3)
    .optional()
    .describe('Only for recurring work the user asked for'),
});

export function projectProposeTool(ctx: {
  run: RunHandle;
  self: AgentDefinition;
  projects: ProjectService;
  userName?: string | undefined;
  /** The source of the run's taint, when it had read third-party text (D-103). */
  taint?: () => string | undefined;
}): MonstersTool {
  const user = ctx.userName?.trim() || 'the user';
  return defineTool({
    name: PROJECT_PROPOSE,
    description:
      `Propose a new project (its own lead, monsters, notes area and folder) when ${user} asks for one. ` +
      `Every project gets monsters of its own: new ones, with a name no existing monster has. ` +
      `Copy an existing monster (copy_of) only if ${user} explicitly asks for that one. ` +
      `${user} confirms the draft with one tap; nothing exists before. Returns at once.`,
    inputSchema: ProposeProjectInput,
    async execute(input, tc) {
      const monsters: ProjectProposalInput['monsters'] = [];
      for (const [i, m] of input.monsters.entries()) {
        if (m.copy_of) {
          monsters.push({ copyOf: m.copy_of, ...(m.name ? { name: m.name } : {}) });
          continue;
        }
        if (!m.name || !m.role || !m.mission) {
          throw new ToolError(
            'INVALID_INPUT',
            `monsters[${i}] needs name, role and mission (or copy_of)`,
          );
        }
        const hue = m.color ? hueOfColor(m.color) : null;
        monsters.push({
          name: m.name,
          role: m.role,
          mission: m.mission,
          duties: m.duties,
          web: m.web ?? false,
          model: m.model,
          ...(hue !== null ? { hue } : {}),
        });
      }
      const folder = input.folder?.trim();
      try {
        const p = await ctx.projects.propose(
          {
            name: input.name,
            goal: input.goal,
            ...(folder && folder.toLowerCase() !== 'new' ? { folder } : {}),
            ...(folder?.toLowerCase() === 'new' ? { newFolder: true } : {}),
            ...(input.lead ? { lead: { name: input.lead.name, copyOf: input.lead.copy_of } } : {}),
            monsters,
            connections: input.connections,
            ...(input.monthly_cap_eur ? { spend: { monthlyEur: input.monthly_cap_eur } } : {}),
            automations: input.automations?.map((a) => ({
              name: a.name,
              cron: a.cron,
              timezone: a.timezone,
              objective: a.objective,
              participants: a.participants,
            })),
          },
          {
            agent: ctx.self.config.id,
            runId: ctx.run.id,
            parentId: tc.callEventId ?? null,
            taint: ctx.taint?.(),
          },
        );
        return {
          status: p.repeated ? 'already_proposed' : 'proposed',
          project: p.project.name,
          lead: p.names.lead,
          monsters: p.names.monsters,
          ...(p.project.folder ? { folder: p.project.folder } : {}),
          ...(p.schedules.length > 0 ? { automations: p.schedules } : {}),
          ...(p.renamed?.length
            ? {
                renamed: p.renamed.map((r) => `${r.asked} was taken, now ${r.got}`),
              }
            : {}),
          note:
            `Draft sent to ${user}. Check that each "when" is what was asked; ` +
            `tell ${user} in two lines what you proposed and stop: it exists only after the tap.`,
        };
      } catch (err) {
        if (err instanceof ProjectError) {
          throw new ToolError('INVALID_INPUT', err.message, {
            hint: 'Fix that field and call the tool again once.',
          });
        }
        throw err;
      }
    },
  });
}
