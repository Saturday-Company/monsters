import { z } from 'zod';
import { agentAreaStrings } from './agent-area.strings.ts';

/*
 * The vault area of a generated agent: the folder where it saves its results.
 * It becomes a write permission (`<area>/**`), so it must be a plain folder:
 * no glob characters, not the vault root, not the agents' memories, not the
 * user profile, not a system or private folder. Shared by the core (team
 * proposal, confirmation, AGENTS.md template) and the UI (team step).
 */

/** First-level folders an agent area can never be in (compared case-insensitively). */
export const RESERVED_AREA_FOLDERS = ['Agenti', 'Modelli', 'Privato'] as const;

/** The user's profile, at the root of the notes (written at the first start, read by every monster). */
export const PROFILE_NOTE_PATH = 'profilo.md';

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

/** Why a (normalized) area is not acceptable, or null when it is. In the app's language: the UI shows it. */
export function agentAreaProblem(area: string): string | null {
  const t = agentAreaStrings();
  if (area === '') return t.areaEmpty;
  if (area.length > MAX_AREA_LENGTH) return t.areaTooLong(MAX_AREA_LENGTH);
  const parts = area.split('/');
  if (parts.length > MAX_AREA_DEPTH) return t.areaTooDeep(MAX_AREA_DEPTH);
  for (const part of parts) {
    if (part.length > MAX_SEGMENT_LENGTH) return t.segmentTooLong(MAX_SEGMENT_LENGTH);
    if (!SEGMENT.test(part)) return t.segmentChars;
    if (part.endsWith('.')) return t.segmentDot;
    if (/\.md$/i.test(part)) return t.notANote;
  }
  const first = parts[0]!.toLowerCase();
  if (RESERVED_AREA_FOLDERS.some((f) => f.toLowerCase() === first)) {
    return t.reserved(parts[0]!);
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
  .refine((s) => !/[\r\n]/.test(s), { error: () => agentAreaStrings().dutyOneLine })
  .refine((s) => !/\{\{[^}]*\}\}/.test(s), { error: () => agentAreaStrings().dutyPlaceholder })
  .refine((s) => !s.startsWith('#'), { error: () => agentAreaStrings().dutyHash });
