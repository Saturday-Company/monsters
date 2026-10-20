import { z } from 'zod';

/*
 * Engine of the DecisionGate (M2.9, D-037). Same rules as the rest of the API
 * (JSON body, anti-CSRF header, session or bearer). The TypeSafe key never
 * comes back.
 *
 *   GET    /api/settings/decisions        → DecisionsView
 *   PUT    /api/settings/decisions        DecisionsUpdate → DecisionsView
 *   PUT    /api/settings/typesafe-key     TypeSafeKeyRequest → DecisionsView (verified with
 *                                         `GET /v1/models`, no tokens spent)
 *   DELETE /api/settings/typesafe-key     → DecisionsView
 *
 * Errors: 409 `no_key` (Jev chosen without a TypeSafe key), 400 `invalid_key`
 * (TypeSafe does not know it), 502 `verification_failed` (TypeSafe not
 * reachable), 409 `key_from_env` (remove `TYPESAFE_API_KEY` instead).
 */

/**
 * `rules`: only the rules, the gray zone is always asked; `llm`: rules, then
 * the small model; `jev`: rules, then Jev (TypeSafe), then the small model
 * when Jev fails.
 */
export const DecisionEngineSchema = z.enum(['rules', 'llm', 'jev']);
export type DecisionEngine = z.infer<typeof DecisionEngineSchema>;

export const DecisionsViewSchema = z.object({
  engine: DecisionEngineSchema,
  /** Minimum confidence for the model to decide without asking. */
  threshold: z.number(),
  jev: z.object({
    keySet: z.boolean(),
    /** Where the key comes from: saved from the UI or `TYPESAFE_API_KEY`. */
    keySource: z.enum(['file', 'env']).optional(),
    model: z.string(),
  }),
});
export type DecisionsView = z.infer<typeof DecisionsViewSchema>;

export const DecisionsUpdateSchema = z.object({ engine: DecisionEngineSchema });
export type DecisionsUpdate = z.infer<typeof DecisionsUpdateSchema>;

export const TypeSafeKeyRequestSchema = z.object({
  key: z.string().trim().min(10).max(300).regex(/^\S+$/, 'the key cannot contain spaces'),
});
export type TypeSafeKeyRequest = z.infer<typeof TypeSafeKeyRequestSchema>;
