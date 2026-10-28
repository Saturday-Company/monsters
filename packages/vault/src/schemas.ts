import { z } from 'zod';
import type { EditOp } from './markdown/edit.ts';

/** Zod schema of one `vault_edit` op (shared by the tools and by `vault_apply_proposal`). */
export const EditOpSchema: z.ZodType<EditOp> = z.union([
  z
    .object({
      str_replace: z.object({
        old: z.string().min(1).describe('Exact text to replace; must occur once in the note'),
        new: z.string().describe('Replacement text (empty string deletes)'),
      }),
    })
    .strict(),
  z
    .object({
      append: z.object({
        text: z.string(),
        section: z
          .string()
          .optional()
          .describe(
            'Heading of the section to append to (created at the end if missing). With two headings of the same name use "Parent > Child"',
          ),
      }),
    })
    .strict(),
  z.object({ prepend: z.object({ text: z.string() }) }).strict(),
  z
    .object({
      replace_section: z.object({
        heading: z
          .string()
          .min(1)
          .describe(
            'Heading of the section. With two headings of the same name use "Parent > Child"',
          ),
        text: z.string().describe('New content of the section, heading line excluded'),
      }),
    })
    .strict(),
  z
    .object({
      set_props: z
        .record(z.string(), z.unknown())
        .describe('Frontmatter properties to set, e.g. {"status": "done", "tags": ["a"]}'),
    })
    .strict(),
  z.object({ remove_props: z.array(z.string().min(1)).min(1) }).strict(),
]);

export const EditOpsSchema = z.array(EditOpSchema).min(1).max(50);
