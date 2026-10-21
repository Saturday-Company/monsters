import { z } from 'zod';
import { AutomationViewSchema } from './automations.ts';
import { draftStrings } from './drafts.strings.ts';
import { PROJECT_DOC_PROPOSAL_FILES } from './events.ts';
import { ProjectIdSchema } from './ids.ts';
import { ProjectViewSchema } from './projects.ts';
import { ModelRefViewSchema } from './providers.ts';
import { TeamDraftSchema } from './team-draft.ts';

/*
 * Drafts (D-098): what a monster proposed and the user has not confirmed
 * yet, in one list for "Da rivedere" and Telegram. Four kinds, each with the
 * flow it already had: a new monster (`team_propose_monster`, D-075), a whole
 * project (`project_propose`), an automation (`automation_propose`, D-094);
 * and a change to CLAUDE.md or AGENTS.md of a project's folder
 * (`project_docs_propose`, D-113: confirming writes the file); the lines of
 * «Da ricordare:» of a run that read third-party text, that a person who is
 * not the user asked for or of a Telegram chat (`memory`, review of 18/10, A2:
 * confirming adds them to the monster's MEMORY.md).
 * Nothing proposed runs or exists until the user confirms it.
 *
 *   GET  /api/drafts                       → DraftView[] (newest first)
 *   POST /api/drafts/:kind/:id/confirm     → DraftConfirmResponse
 *                                          (a monster as proposed; to change it first, the
 *                                          creation form with `proposal`, as before)
 *   POST /api/drafts/:kind/:id/discard     → { ok: true }
 *
 * Errors: 404 `unknown_draft`, 409 `draft_closed` (confirmed or left aside
 * already), 409 `docs_changed` (the file changed after the proposal: the
 * monster must propose it again), plus those of the kind (`invalid_name`,
 * `team_full`, `invalid_folder`, `invalid_schedule`…).
 *
 * The list changes with the events in `DRAFT_EVENT_TYPES`: the app reads it
 * again when one arrives (no event of its own).
 */

export const DraftKindSchema = z.enum(['monster', 'project', 'automation', 'docs', 'memory']);
export type DraftKind = z.infer<typeof DraftKindSchema>;

/** Events after which `GET /api/drafts` may answer differently. */
export const DRAFT_EVENT_TYPES = [
  'monster_proposal',
  'project_change',
  'automation_change',
  'project_docs_proposal',
  'memory',
] as const;

const DraftBase = {
  /**
   * monster: the `monster_proposal` event; project: the project's id; automation: its id;
   * docs: the `project_docs_proposal` event; memory: the `memory` `proposed` event.
   */
  id: z.string().min(1),
  /** The name of what would be created. */
  title: z.string(),
  /** One line in Italian: the list of "Da rivedere" and the message on Telegram. */
  summary: z.string(),
  /** Who proposed it: a monster's id, or `user` (a draft saved from the app). */
  from: z.string(),
  fromName: z.string().optional(),
  /** The project it belongs to (a monster or an automation of a project). */
  project: ProjectIdSchema.optional(),
  createdAt: z.number(),
};

export const DraftViewSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('monster'),
    ...DraftBase,
    monster: z.object({
      draft: TeamDraftSchema,
      models: z.array(ModelRefViewSchema).optional(),
    }),
  }),
  z.object({ kind: z.literal('project'), ...DraftBase, projectDraft: ProjectViewSchema }),
  z.object({ kind: z.literal('automation'), ...DraftBase, automation: AutomationViewSchema }),
  z.object({
    kind: z.literal('docs'),
    ...DraftBase,
    docs: z.object({
      file: z.enum(PROJECT_DOC_PROPOSAL_FILES),
      /** The file's text now (read with the list, clipped); null, it is not there (a new file). */
      current: z.string().nullable(),
      /** `current` is only the start of a longer file. */
      currentClipped: z.literal(true).optional(),
      /** The whole new text. */
      proposed: z.string(),
      /**
       * The diff from the whole file now to `proposed` (`textDiff`, computed by the core:
       * also past the clip of `current`), what the user applies.
       */
      diff: z.string(),
      reason: z.string(),
      /** The file changed after the proposal: it cannot be applied, the monster proposes again. */
      stale: z.boolean(),
      /** The project's folder changed after the proposal: it cannot be applied. */
      folderMoved: z.literal(true).optional(),
      /** The file now is bigger than 1 MB: it is not changed from here. */
      tooLarge: z.literal(true).optional(),
      /** The run that proposed it had read third-party text (D-103): `source` says what. */
      tainted: z.literal(true).optional(),
      source: z.string().optional(),
    }),
  }),
  z.object({
    kind: z.literal('memory'),
    ...DraftBase,
    memory: z.object({
      /** The monster whose MEMORY.md gets the lines. */
      agent: z.string(),
      /** The lines, as they would be added. */
      lines: z.array(z.string()),
      /** Why they wait for the user: the third-party text, the person who asked, the chat. */
      source: z.string(),
      /** They carry third-party text: saved with the mark, a run that reads them starts tainted. */
      tainted: z.literal(true).optional(),
    }),
  }),
]);
export type DraftView = z.infer<typeof DraftViewSchema>;

export const DraftConfirmResponseSchema = z.object({
  kind: DraftKindSchema,
  id: z.string(),
  /** What exists now: the new monster, the project (and its monsters), the automation; docs: the project. */
  agent: z.string().optional(),
  project: ProjectIdSchema.optional(),
  automation: z.string().optional(),
  /** A project's first automations, created as drafts to confirm one by one. */
  automationDrafts: z.array(z.string()).optional(),
});
export type DraftConfirmResponse = z.infer<typeof DraftConfirmResponseSchema>;

/** What a card says as the source of a text of third parties whose own name is unknown. */
export function thirdPartySource(): string {
  return draftStrings().thirdParty;
}

/**
 * Where a monster's draft comes from when it is not only the user's request: the third-party
 * text its run read, or the person of a Telegram group who asked for it (D-103, D-107; review of
 * 18/10, M5). Null: the user's own. The card says it, in the app and on Telegram.
 */
export function draftTaint(d: DraftView): string | null {
  if (d.kind === 'docs') return d.docs.tainted ? (d.docs.source ?? thirdPartySource()) : null;
  if (d.kind === 'project') return d.projectDraft.plan?.taint?.source ?? null;
  if (d.kind === 'automation') {
    const from = d.automation.objectiveFrom;
    return from?.tainted ? (from.source ?? thirdPartySource()) : null;
  }
  if (d.kind === 'memory') return d.memory.tainted ? d.memory.source : null;
  return null;
}
