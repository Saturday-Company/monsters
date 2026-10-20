/*
 * The vault section's history: commits in the vault's own subject format
 * (`tool: summary [agent=… action=…]`, packages/vault/src/service.ts) and the diff of one edit,
 * with its undo. Shared by the build (first render) and the browser (the undo key).
 */
import { ulidAt } from './eventlog.ts';

export interface Commit {
  sha: string;
  subject: string;
}

const T = Date.UTC(2026, 9, 20, 17, 42, 0);
export const EDIT_ACTION = ulidAt(T + 21_000, 41);
const UNDO_ACTION = ulidAt(T + 64_000, 42);

export const subject = (tool: string, summary: string, agent: string, action: string): string =>
  `${tool}: ${summary} [agent=${agent} action=${action}]`;

export const NOTE_PATH = 'Inbox/week-42.md';

export const HISTORY: Commit[] = [
  { sha: '9b27e51', subject: subject('vault_edit', NOTE_PATH, 'titan', EDIT_ACTION) },
  { sha: 'c2e9d47', subject: subject('vault_write', NOTE_PATH, 'dione', ulidAt(T + 7_140, 40)) },
  {
    sha: '5a0e8f2',
    subject: subject(
      'vault_write',
      'Risorse/Ricerche/notes-tools.md',
      'rhea',
      ulidAt(T - 86_400_000, 7),
    ),
  },
  { sha: '31c7b9d', subject: 'vault_create: nuovo vault' },
];

export const UNDO_COMMIT: Commit = {
  sha: 'e81f4c0',
  subject: subject('vault_undo', NOTE_PATH, 'user', UNDO_ACTION),
};

/** The edit of 9b27e51: context, removed, added (in this order inside the hunk). */
export const DIFF = {
  context: ['# Week 42', '', '- Kill switch on Telegram: /stop'],
  removed: ['- Two drafts waiting for review'],
  added: ['- Two drafts waiting for review: the newsletter, the quote', '- Ask Rhea for sources'],
  after: ['- Next: [[Risorse/Ricerche/notes-tools]]'],
};

export type DiffLine = { text: string; kind: 'meta' | 'hunk' | 'ctx' | 'del' | 'add' };

/** The diff as `git show` prints it; `undone` gives the revert (the same hunk, reversed). */
export function diffLines(undone = false): DiffLine[] {
  const del = undone ? DIFF.added : DIFF.removed;
  const add = undone ? DIFF.removed : DIFF.added;
  const before = DIFF.context.length + del.length + DIFF.after.length;
  const after = DIFF.context.length + add.length + DIFF.after.length;
  return [
    { text: `diff --git a/${NOTE_PATH} b/${NOTE_PATH}`, kind: 'meta' },
    { text: `--- a/${NOTE_PATH}`, kind: 'meta' },
    { text: `+++ b/${NOTE_PATH}`, kind: 'meta' },
    { text: `@@ -1,${before} +1,${after} @@`, kind: 'hunk' },
    ...DIFF.context.map((text) => ({ text: ` ${text}`, kind: 'ctx' as const })),
    ...del.map((text) => ({ text: `-${text}`, kind: 'del' as const })),
    ...add.map((text) => ({ text: `+${text}`, kind: 'add' as const })),
    ...DIFF.after.map((text) => ({ text: ` ${text}`, kind: 'ctx' as const })),
  ];
}
