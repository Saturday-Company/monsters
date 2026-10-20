import {
  defineTool,
  projectPagePath,
  settingsPath,
  ToolError,
  type MonstersTool,
  type TeamDraft,
} from '@monsters/shared';
import { z } from 'zod';
import type { AgentDefinition } from '../agents/definition.ts';
import type { RunHandle } from '../kill/run-controller.ts';
import { TeamError } from './team-manager.ts';

/*
 * `team_propose_monster` (D-075): the capo squadra prepares a new monster and
 * the user confirms it from a card in the chat. Never a monster created by an
 * agent: the tool builds the same draft as "Aggiungi un mostro" (TeamManager),
 * logs it as a `monster_proposal` event and returns at once. "Crea" on the card
 * calls `POST /api/team/agents` with the draft, "Cambia" opens the same form
 * filled in; the outcome reaches the capo squadra at its next turn.
 */

export const PROPOSE_MONSTER_TOOL = 'team_propose_monster';

/** What the creation form offers besides the notes, which every monster has. */
export const PROPOSAL_TOOLS = ['note', 'web'] as const;

/** What the capo squadra gives for a proposal (already checked by the tool's schema). */
export interface MonsterProposalInput {
  name: string;
  title?: string | undefined;
  role: string;
  mission: string;
  duties?: string[] | undefined;
  area?: string | undefined;
  web: boolean;
  /** "provider/model"; absent, the capo squadra's models. */
  model?: string | undefined;
  /** Hue of its light (0-360), from the colour asked for. */
  hue?: number | undefined;
}

export interface MonsterProposal {
  /** Id of the `monster_proposal` event. */
  id: string;
  draft: TeamDraft;
  models?: { provider: string; model: string }[];
  /** The same monster was already proposed and is waiting for the user. */
  repeated?: boolean;
}

export interface MonsterProposals {
  propose(
    input: MonsterProposalInput,
    origin: { agent: string; runId?: string | null; parentId?: string | null },
  ): Promise<MonsterProposal>;
}

/** Hues of the colour names a model may use (Italian and English), on the monster kit's wheel. */
const COLOR_HUES: Record<string, number> = {
  rosso: 25,
  red: 25,
  arancione: 55,
  arancio: 55,
  orange: 55,
  giallo: 95,
  yellow: 95,
  oro: 85,
  gold: 85,
  verde: 145,
  green: 145,
  lime: 125,
  turchese: 185,
  teal: 185,
  ciano: 205,
  cyan: 205,
  azzurro: 230,
  blu: 260,
  blue: 260,
  indaco: 280,
  indigo: 280,
  viola: 300,
  purple: 300,
  violet: 300,
  lilla: 310,
  rosa: 350,
  pink: 350,
  magenta: 330,
};

/** Hue (0-360) of `#rrggbb` (HSL), or null. */
function hexHue(hex: string): number | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1]!, 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255) as [
    number,
    number,
    number,
  ];
  const max = Math.max(r, g, b);
  const d = max - Math.min(r, g, b);
  if (d === 0) return null;
  const h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return Math.round(((h * 60 + 360) % 360) * 10) / 10;
}

/** Hue of a colour given as `#rrggbb` or a name ("verde", "blue"), or null when unknown. */
export function hueOfColor(color: string): number | null {
  const key = color
    .trim()
    .toLowerCase()
    .replace(/[^a-z#0-9]/g, '');
  return COLOR_HUES[key] ?? hexHue(key);
}

const oneOrMany = (v: unknown) => (typeof v === 'string' ? [v] : v);

export const ProposeMonsterInput = z.object({
  name: z.string().min(1).max(24).describe('Its name, not one of the team'),
  role: z
    .string()
    .min(5)
    .max(120)
    .describe('What it does, one line, e.g. "tiene in ordine le idee"'),
  mission: z
    .string()
    .min(5)
    .max(200)
    .describe('Its job in the second person, e.g. "raccogli le idee e le metti in ordine"'),
  title: z.string().min(3).max(60).optional().describe('With the article, e.g. "l’archivista"'),
  duties: z
    .preprocess(oneOrMany, z.array(z.string().min(5).max(200)).min(1).max(4))
    .optional()
    .describe('1-4 rules in the second person'),
  tools: z
    .preprocess(oneOrMany, z.array(z.enum(PROPOSAL_TOOLS)).max(2))
    .optional()
    .describe('"note" (always) and "web"; services are connected by the user later'),
  area: z
    .string()
    .min(1)
    .max(80)
    .optional()
    .describe('Notes folder it writes in, e.g. "Idee" (it reads every note)'),
  model: z.string().max(200).optional().describe('"provider/model" only if asked; default: yours'),
  color: z.string().max(30).optional().describe('e.g. "verde" or "#4f8df7"'),
});

export function proposeMonsterTool(ctx: {
  run: RunHandle;
  self: AgentDefinition;
  proposals: MonsterProposals;
  /** How the agents address the user ("Giulio"). */
  userName?: string | undefined;
  /** The project of `self` (a capo): its squad is changed on the project's page. */
  projectName?: string | undefined;
}): MonstersTool {
  const projectOfSelf = ctx.projectName;
  const user = ctx.userName?.trim() || 'the user';
  return defineTool({
    name: PROPOSE_MONSTER_TOOL,
    description:
      `Propose a new monster when ${user} asks for one or recurring work has nobody to do it. ` +
      `It sends ${user} a draft card in the chat: ${user} creates it with one tap, changes it or leaves it. ` +
      'Returns at once.',
    inputSchema: ProposeMonsterInput,
    async execute(input, tc) {
      const hue = input.color ? hueOfColor(input.color) : null;
      if (input.color && hue === null) {
        throw new ToolError('INVALID_INPUT', `unknown colour "${input.color}"`, {
          hint: 'Use a colour name (rosso, verde, blu, viola…) or #rrggbb, or leave it out.',
        });
      }
      try {
        const p = await ctx.proposals.propose(
          {
            name: input.name,
            title: input.title,
            role: input.role,
            mission: input.mission,
            duties: input.duties,
            area: input.area,
            web: input.tools?.includes('web') ?? false,
            model: input.model,
            ...(hue !== null ? { hue } : {}),
          },
          { agent: ctx.self.config.id, runId: ctx.run.id, parentId: tc.callEventId ?? null },
        );
        return {
          status: p.repeated ? 'already_proposed' : 'proposed',
          proposal_id: p.id,
          name: p.draft.name,
          note:
            `Draft sent to ${user}: ${user} confirms it from the card in the chat. ` +
            'Tell them in one line what you proposed and stop here: the monster exists only after their tap.',
        };
      } catch (err) {
        if (err instanceof TeamError) {
          const code =
            err.code === 'team_full' || err.code === 'onboarding_pending'
              ? 'LIMIT_REACHED'
              : 'INVALID_INPUT';
          throw new ToolError(code, err.message, {
            hint:
              code === 'LIMIT_REACHED'
                ? err.code === 'team_full'
                  ? `Tell ${user} plainly: a monster is added or archived from the app (${projectOfSelf ? projectPagePath(projectOfSelf, 'squadra') : settingsPath('squadra')}).`
                  : `Tell ${user} plainly: the first start is not finished yet; new monsters come after it.`
                : 'Fix that field and call the tool again once.',
          });
        }
        throw err;
      }
    },
  });
}
