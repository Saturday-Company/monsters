import { appendFileSync, chmodSync, renameSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { ensurePrivateDir } from './home.ts';

/*
 * The app's log: `<home>/logs/desktop.log` (mode 600, folder 700), one line per event, with
 * the core's own output when the app started it. Rotated at 1 MB (one old file kept). The
 * setup code the core prints and anything that looks like a token never reach it.
 */

const SECRETS: readonly [RegExp, string][] = [
  [/(setup code:[ \t]*)[0-9A-Za-z][0-9A-Za-z-]{5,}/gi, '$1[nascosto]'],
  [/(token["'=:\s]+)[A-Za-z0-9_-]{16,}/gi, '$1[nascosto]'],
  [/(bearer\s+)\S+/gi, '$1[nascosto]'],
];

export function redact(text: string): string {
  return SECRETS.reduce((t, [re, to]) => t.replace(re, to), text);
}

/**
 * The first line of an app whose main process got past Electron's `ready` (`start()`).
 * install-test.ts waits for it: on macOS without a graphical session it never comes.
 */
export function startedLine(version: string, electron: string, home: string): string {
  return `Monsters desktop ${version} (Electron ${electron}), data ${home}`;
}

/** True if `log` (the text of desktop.log) has the line of `startedLine`. */
export function hasStartedLine(log: string): boolean {
  return /\[app\] Monsters desktop \S+ \(Electron [^)\n]*\), data /.test(log);
}

export class DesktopLog {
  readonly path: string;
  readonly #maxBytes: number;
  #ready = false;

  constructor(path: string, opts: { maxBytes?: number } = {}) {
    this.path = path;
    this.#maxBytes = opts.maxBytes ?? 1024 * 1024;
  }

  /** One line per call, prefixed with time and source (`app`, `core`). */
  write(source: string, text: string): void {
    const lines = redact(text)
      .split(/\r?\n/)
      .map((l) => l.trimEnd())
      .filter(Boolean);
    if (lines.length === 0) return;
    const stamp = new Date().toISOString();
    const out = lines.map((l) => `${stamp} [${source}] ${l}\n`).join('');
    try {
      this.#prepare();
      appendFileSync(this.path, out, { mode: 0o600 });
    } catch {
      // A log that cannot be written must never stop the app.
    }
  }

  info(text: string): void {
    this.write('app', text);
  }

  #prepare(): void {
    if (!this.#ready) {
      ensurePrivateDir(dirname(this.path));
      this.#ready = true;
    }
    let size: number;
    try {
      size = statSync(this.path).size;
    } catch {
      return;
    }
    if (size < this.#maxBytes) return;
    renameSync(this.path, `${this.path}.1`);
    try {
      chmodSync(`${this.path}.1`, 0o600);
    } catch {
      // Windows
    }
  }
}
