import { z } from 'zod';

/*
 * The vault area of a generated agent: the folder where it saves its results.
 * It becomes a write permission (`<area>/**`), so it must be a plain folder:
 * no glob characters, not the vault root, not the agents' memories, not the
 * user profile, not a system or private folder. Shared by the core (team
 * proposal, confirmation, AGENTS.md template) and the UI (team step).
 */

/** First-level folders an agent area can never be in (compared case-insensitively). */
export const RESERVED_AREA_FOLDERS = ['Agenti', 'Modelli', 'Privato'] as const;

export const MAX_AREA_LENGTH = 80;
const MAX_AREA_DEPTH = 4;
const MAX_SEGMENT_LENGTH = 40;

/** Letters, digits, spaces and a few separators; never glob or path syntax. */
const SEGMENT = /^[\p{L}\p{N}][\p{L}\p{M}\p{N} _'’.-]*$/u;

/** Trims, uses `/`, drops empty parts and outer slashes, single spaces: `" /Risorse//Idee/ "` → `Risorse/Idee`. */
export function normalizeAgentArea(raw: string): string {
  return raw
    .normalize('NFC')
    .replace(/\\/g, '/')
    .split('/')
    .map((s) => s.replace(/\s+/g, ' ').trim())
    .filter((s) => s !== '')
    .join('/');
}

/** Why a (normalized) area is not acceptable, or null when it is. In Italian: the UI shows it. */
export function agentAreaProblem(area: string): string | null {
  if (area === '') return 'Serve una cartella: la radice del vault non va bene.';
  if (area.length > MAX_AREA_LENGTH) return `Al massimo ${MAX_AREA_LENGTH} caratteri.`;
  const parts = area.split('/');
  if (parts.length > MAX_AREA_DEPTH) return `Al massimo ${MAX_AREA_DEPTH} livelli di cartelle.`;
  for (const part of parts) {
    if (part.length > MAX_SEGMENT_LENGTH)
      return `Nomi di cartella fino a ${MAX_SEGMENT_LENGTH} caratteri.`;
    if (!SEGMENT.test(part)) {
      return 'Solo lettere, numeri, spazi, trattini e punti (niente * ? [ ] né cartelle nascoste).';
    }
    if (part.endsWith('.')) return 'Un nome di cartella non finisce con il punto.';
    if (/\.md$/i.test(part)) return 'Serve una cartella, non una nota.';
  }
  const first = parts[0]!.toLowerCase();
  if (RESERVED_AREA_FOLDERS.some((f) => f.toLowerCase() === first)) {
    return `${parts[0]} è una cartella riservata: scegline un'altra.`;
  }
  return null;
}

/** Normalizes then validates an area: the only way an area reaches a permission. */
export const AgentAreaSchema = z
  .string()
  .max(200)
  .transform(normalizeAgentArea)
  .superRefine((area, ctx) => {
    const problem = agentAreaProblem(area);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });

export const MIN_DUTY_LENGTH = 3;
export const MAX_DUTY_LENGTH = 200;
export const MAX_DUTIES = 4;

/** One "Il tuo lavoro" rule of an agent: a single line of plain text. */
export const AgentDutySchema = z
  .string()
  .trim()
  .min(MIN_DUTY_LENGTH)
  .max(MAX_DUTY_LENGTH)
  .refine((s) => !/[\r\n]/.test(s), 'Una riga sola.')
  .refine((s) => !/\{\{[^}]*\}\}/.test(s), 'Niente {{segnaposto}}.')
  .refine((s) => !s.startsWith('#'), 'Non inizia con #.');
