import { z } from 'zod';

/*
 * A monster still to be added (`POST /api/team/drafts`, and the capo squadra's
 * proposals, D-075). Apart from `team.ts` so the event schemas can carry one
 * without an import cycle (team.ts → api.ts → events.ts).
 */

export const ArchetypeSchema = z.enum(['rhea', 'dione']);
export type Archetype = z.infer<typeof ArchetypeSchema>;

/** A monster ready to be added: review, change, then `POST /api/team/agents`. */
export const TeamDraftSchema = z.object({
  name: z.string(),
  title: z.string(),
  role: z.string(),
  mission: z.string(),
  context: z.string(),
  duties: z.array(z.string()),
  area: z.string(),
  web: z.boolean(),
  color: z.string(),
  genome: z.unknown(),
  archetype: ArchetypeSchema.nullable(),
  /**
   * `archetype`, `model` (generated), `fallback` (no model, or it failed twice),
   * `proposal` (written by the capo squadra with `team_propose_monster`).
   */
  source: z.enum(['archetype', 'model', 'fallback', 'proposal']),
});
export type TeamDraft = z.infer<typeof TeamDraftSchema>;
