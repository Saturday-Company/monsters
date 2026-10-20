import { z } from 'zod';

/*
 * The mark of a monster's memory line written after third-party text (review
 * of 18/10, A2; review of the waves 3 and 4): shared by the core, which writes
 * it and reads it, and the UI, which shows the marked lines of a memory with
 * «È mia» to take it away.
 */

/** The end of a memory line that carries third-party text. */
export const MEMORY_TAINT_MARK = '⟨da testo di terzi⟩';

/** A line of MEMORY.md that carries the mark. */
export function isMarkedMemoryLine(line: string): boolean {
  return line.includes(MEMORY_TAINT_MARK);
}

/** The line without the mark (and the space before it). */
export function unmarkedMemoryLine(line: string): string {
  return line.replaceAll(` ${MEMORY_TAINT_MARK}`, '').replaceAll(MEMORY_TAINT_MARK, '');
}

/** `POST /api/team/agents/:id/memory/own`: the user says a marked line is theirs. */
export const MemoryOwnRequestSchema = z.object({
  /** The line as the note shows it (with or without the mark and the bullet). */
  line: z.string().min(1).max(2000),
});
export type MemoryOwnRequest = z.infer<typeof MemoryOwnRequestSchema>;

export const MemoryOwnResponseSchema = z.object({
  /** Lines that lost the mark (0: the line was not there, or not marked). */
  changed: z.number().int().nonnegative(),
});
export type MemoryOwnResponse = z.infer<typeof MemoryOwnResponseSchema>;
