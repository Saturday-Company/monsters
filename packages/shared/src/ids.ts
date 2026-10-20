import { z } from 'zod';

/** Actors that are not agents but can appear as the author of an event. */
export const RESERVED_ACTORS = ['system', 'user'] as const;
export type ReservedActor = (typeof RESERVED_ACTORS)[number];

/** True for the ids no agent may take: they would pass for the user or the system in the log. */
export function isReservedActor(id: string): id is ReservedActor {
  return (RESERVED_ACTORS as readonly string[]).includes(id);
}

/**
 * Agent identifier: a short lowercase slug, stable across renames of the display
 * name (e.g. "titan", "rhea", "social-writer").
 */
export const AgentIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9_-]{0,63}$/, 'agent id must be a lowercase slug (a-z, 0-9, _ and -)');
export type AgentId = z.infer<typeof AgentIdSchema>;

/** Who authored an event: an agent id or one of the reserved actors (same slug format). */
export const ActorSchema = AgentIdSchema;
export type Actor = z.infer<typeof ActorSchema>;

/** Identifier of a run (one goal pursued by the orchestrator and its agents). */
export const RunIdSchema = z.string().min(1).max(128);
export type RunId = z.infer<typeof RunIdSchema>;

export const EmailSchema = z.email().max(320);

/**
 * Identifier of a project (plan of 17/10, B1; D-097): a slug, stable across
 * renames, the name of its folder `MONSTERS_HOME/projects/<id>/`.
 */
export const ProjectIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9-]{0,47}$/, 'project id must be a lowercase slug (a-z, 0-9 and -)');
export type ProjectId = z.infer<typeof ProjectIdSchema>;
