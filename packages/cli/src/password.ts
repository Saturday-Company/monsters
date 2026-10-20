import { existsSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { Writable } from 'node:stream';
import {
  acquireHomeLock,
  AuthError,
  HomeLockedError,
  homePaths,
  resetPasswordOffline,
} from '@monsters/core';
import { PASSWORD_MIN_LENGTH, PasswordSchema } from '@monsters/shared';
import type { Io } from './main.ts';

/*
 * `monsters password`: sets a new password for the local account, on the
 * computer where the core runs, without the old one. Only with the core
 * stopped: the data folder is changed directly, under its lock, and every
 * session is logged out. With the core running it says to stop it first.
 *
 * Earlier versions asked the running core with the CLI token; not any more
 * (review of 18/10, M1). The token is a file every process of the user can
 * read, a monster's terminal too: with it a monster could lock the user out
 * of the UI and the tunnel while it works. Stopping the core ends the work of
 * every monster (and their commands, kill switch), so it cannot be done from
 * inside a monster's run without ending it; and the user sees it. A check of
 * the terminal (TTY) would not help: a monster can open one (`script`).
 */

export const CORE_RUNNING_MESSAGE =
  'Monsters is running: stop it first (Ctrl+C where you started it, or quit the app), then run "monsters password" again. With Monsters running, change the password from Settings → Account.';

/** Reads two lines without echoing them on a terminal. */
async function readTwice(io: Io): Promise<[string, string] | null> {
  const input = io.input ?? process.stdin;
  const tty = io.tty ?? (input === process.stdin && process.stdin.isTTY === true);
  const write = io.write ?? ((text: string) => process.stdout.write(text));
  // On a terminal readline echoes what is typed: into a sink.
  const sink = new Writable({ write: (_chunk, _enc, done) => done() });
  const rl = createInterface({ input, output: sink, terminal: tty });
  // Ctrl+C on a terminal in raw mode: give up instead of pausing.
  rl.on('SIGINT', () => rl.close());
  const lines = rl[Symbol.asyncIterator]();
  try {
    const out: string[] = [];
    for (const prompt of ['New password: ', 'Type it again: ']) {
      write(prompt);
      const next = await lines.next();
      if (tty) write('\n');
      if (next.done) return null;
      out.push(next.value);
    }
    return [out[0]!, out[1]!];
  } finally {
    rl.close();
  }
}

export async function cmdPassword(home: string, io: Io): Promise<number> {
  if (!existsSync(homePaths(home).db)) {
    io.err(`No account in ${home} yet: start Monsters and create it from the browser.`);
    return 1;
  }
  // Said before the password is typed; the change itself holds the lock (`resetPasswordOffline`).
  try {
    acquireHomeLock(home).release();
  } catch (err) {
    if (!(err instanceof HomeLockedError)) throw err;
    io.err(CORE_RUNNING_MESSAGE);
    return 1;
  }
  io.out(`New password for the account in ${home} (at least ${PASSWORD_MIN_LENGTH} characters).`);
  const typed = await readTwice(io);
  if (!typed) {
    io.err('No password typed: nothing changed.');
    return 1;
  }
  const [password, again] = typed;
  if (password !== again) {
    io.err('The two passwords are different: nothing changed.');
    return 1;
  }
  const valid = PasswordSchema.safeParse(password);
  if (!valid.success) {
    io.err(`Too short: at least ${PASSWORD_MIN_LENGTH} characters. Nothing changed.`);
    return 1;
  }
  let closed: number;
  try {
    closed = await resetPasswordOffline(home, password);
  } catch (err) {
    if (err instanceof AuthError && err.code === 'no_account') {
      io.err('No account yet: create it from the browser first.');
      return 1;
    }
    if (!(err instanceof HomeLockedError)) throw err;
    io.err(`${CORE_RUNNING_MESSAGE} Nothing changed.`);
    return 1;
  }
  io.out(
    closed > 0
      ? `Password changed. ${closed} open session${closed === 1 ? '' : 's'} logged out: log in again with the new password.`
      : 'Password changed: log in with the new password.',
  );
  return 0;
}
