import { AsyncLocalStorage } from 'node:async_hooks';

/*
 * The folders of the vault one piece of work may reach (D-114). A run of a Telegram chat
 * where people other than the user ask sees only its project's area, the monster's own area
 * and Inbox: the rest of the vault (clients, the other projects, the other monsters'
 * memories) stays the user's. Set around a tool call (`withVaultScope`) and read by the
 * permissions at every check, reads, lists, searches, links, history and writes alike.
 */

const scope = new AsyncLocalStorage<readonly string[]>();

/** Runs `work` (and everything it awaits) with the vault limited to `folders`. */
export function withVaultScope<T>(folders: readonly string[], work: () => T): T {
  return scope.run(folders, work);
}

/** The folders the current work may reach, or undefined: the whole vault (its permissions). */
export function currentVaultScope(): readonly string[] | undefined {
  return scope.getStore();
}
