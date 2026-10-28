/*
 * Installing a downloaded .deb update (D-105). electron-updater's DebUpdater downloads the
 * package listed in alpha-linux.yml and checks its sha512; the install is done here, not by
 * DebUpdater.doInstall, because that one:
 *   - runs `dpkg -i` with spawnSync on the main thread (the window freezes while the password is
 *     asked), and on any dpkg error runs `apt-get install -f -y` as root (a second password
 *     prompt, and apt may remove packages to "fix" the system);
 *   - falls back to `apt install --allow-unauthenticated --allow-downgrades` when dpkg is missing;
 *   - uses sudo when there is no pkexec, which needs a terminal a desktop app does not have;
 *   - reports only "Command … exited with code N".
 *
 * Here: one `pkexec --disable-internal-agent /bin/sh -c <script>` (the desktop's polkit agent asks
 * the password; no text agent on a terminal). The script, as root, first copies the package into
 * a folder only root can write and checks the copy against the sha512 of the feed (the user's
 * cache can change after electron-updater checked it, root's copy cannot), then says "ready"
 * and waits. Only then the app stops its core, and says "go": `dpkg -i` replaces /opt/Monsters
 * and runs the package's scripts (AppArmor profile, link, chrome-sandbox) as a manual install
 * does. A refused or cancelled password, or no agent (an SSH or remote session), ends the
 * script before "ready": nothing was stopped or touched and the app keeps running.
 *
 * Before "ready", root also checks on its own copies (S-A4), with nothing but root's files:
 *   - the signature of the channel file (`alpha-linux.yml` and its `.sig`, the ones the app
 *     verified) with openssl and the public keys in /opt/Monsters/resources/update-keys, which
 *     belong to root; the package's sha512 must be listed in that signed file;
 *   - with `dpkg-deb -f`, that the package is `monsters` and its version higher than the one
 *     installed (`dpkg --compare-versions`): never another package, never a downgrade.
 *
 * No Electron imports: tested with a fake pkexec (test/deb-install.test.ts).
 */
import { execFile, spawn as nodeSpawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { SIGNATURE_HEADER, UPDATE_KEYS_DIR } from './update-signature.ts';
import { debInstallStrings } from './deb-install.strings.ts';

export const PKEXEC = '/usr/bin/pkexec';
export const DPKG = '/usr/bin/dpkg';
export const DPKG_QUERY = '/usr/bin/dpkg-query';
export const DPKG_DEB = '/usr/bin/dpkg-deb';
export const OPENSSL = '/usr/bin/openssl';
/** The name of the package (`deb.packageName` in package-config.ts). */
export const DEB_PACKAGE = 'monsters';
/** The trusted public keys of the installed .deb: root's files. */
export const DEB_KEYS_DIR = `/opt/Monsters/resources/${UPDATE_KEYS_DIR}`;
/** On disk, not /tmp: /tmp may be a small tmpfs and the package is ~100 MB. */
export const ROOT_WORK_DIR = '/var/tmp';
export const READY_LINE = 'monsters-update: ready';

/** Exit codes of the root script (pkexec itself uses 126 and 127). */
export const EXIT = {
  copy: 90,
  mismatch: 91,
  notGo: 92,
  signature: 93,
  notOurs: 94,
  notNewer: 95,
  /** /usr/bin/openssl missing or older than 3.0 (no `pkeyutl -rawin`): not a forged package. */
  openssl: 96,
} as const;

/** A downloaded update: the file in electron-updater's cache and what the feed says of it. */
export interface DebUpdate {
  version: string;
  file: string;
  /** sha512 of the package as written in alpha-linux.yml (base64). */
  sha512: string;
  /** Where the package can be downloaded by hand, if known. */
  url: string | null;
  /** The signed channel file the app verified, checked again by root (null: not installed). */
  channel?: { name: string; text: string; signature: string } | null;
}

export type DebFailure =
  | { kind: 'no-pkexec' }
  | { kind: 'cancelled' }
  /** Nobody answered the password prompt in time (a polkit window hidden behind others). */
  | { kind: 'timeout' }
  | { kind: 'no-agent' }
  | { kind: 'not-authorized' }
  | { kind: 'mismatch' }
  /** The channel file's signature did not check out as root (or there was none). */
  | { kind: 'signature' }
  /** The downloaded file is not the `monsters` package. */
  | { kind: 'not-ours' }
  /** Not a higher version than the one installed. */
  | { kind: 'not-newer' }
  /** The system's OpenSSL cannot check the signature (missing, or older than 3.0). */
  | { kind: 'openssl' }
  /** The package needs packages this computer does not have (checked before the install). */
  | { kind: 'depends'; missing: string[] }
  | { kind: 'copy'; detail: string }
  | { kind: 'dpkg'; code: number | null; detail: string }
  | { kind: 'error'; detail: string };

/** Binaries and folders of the root script (tests: fakes). */
export interface RootScriptOptions {
  dpkg?: string;
  dpkgDeb?: string;
  dpkgQuery?: string;
  openssl?: string;
  workDir?: string;
  keysDir?: string;
}

/**
 * The script run as root. `$1` the downloaded package, `$2` its sha512 in hex, `$3` the channel
 * file the app verified, `$4` its `.sig`, `$5` the channel file's name (part of the signed
 * message). The binaries and the keys are absolute paths and PATH is fixed: nothing comes from
 * the user's environment. Every check runs on root's own copies, before "ready".
 */
export function rootScript(o: RootScriptOptions = {}): string {
  const dpkg = o.dpkg ?? DPKG;
  const dpkgDeb = o.dpkgDeb ?? DPKG_DEB;
  const dpkgQuery = o.dpkgQuery ?? DPKG_QUERY;
  const openssl = o.openssl ?? OPENSSL;
  const workDir = o.workDir ?? ROOT_WORK_DIR;
  const keysDir = o.keysDir ?? DEB_KEYS_DIR;
  return [
    'PATH=/usr/sbin:/usr/bin:/sbin:/bin; export PATH',
    'src=$1; sum=$2; yml=$3; sig=$4; name=$5',
    `case $sum in *[!0-9a-f]*|'') exit ${EXIT.mismatch};; esac`,
    `case $name in *[!A-Za-z0-9.-]*|'') exit ${EXIT.signature};; esac`,
    'umask 077',
    // Ed25519 with `pkeyutl -rawin` needs OpenSSL 3.0 (Debian 11 and Ubuntu 20.04 have 1.1.1):
    // an older one would fail every check and look like a forged package.
    `[ -x '${openssl}' ] || exit ${EXIT.openssl}`,
    `case "$('${openssl}' version 2>/dev/null)" in 'OpenSSL '[3-9].*|'OpenSSL '[1-9][0-9].*) ;; *) exit ${EXIT.openssl};; esac`,
    `dir=$(mktemp -d '${workDir}/monsters-update.XXXXXXXX') || exit ${EXIT.copy}`,
    'trap \'rm -rf "$dir"\' EXIT',
    `cat -- "$src" > "$dir/update.deb" || exit ${EXIT.copy}`,
    `cat -- "$yml" > "$dir/channel.yml" || exit ${EXIT.copy}`,
    `cat -- "$sig" > "$dir/channel.sig" || exit ${EXIT.copy}`,
    `printf '%s  %s\\n' "$sum" "$dir/update.deb" | sha512sum -c --status - || exit ${EXIT.mismatch}`,
    // The signature of the channel file, with root's keys: any trusted key, any `key` line.
    `{ printf '%s\\n%s\\n' '${SIGNATURE_HEADER}' "$name"; cat "$dir/channel.yml"; } > "$dir/message" || exit ${EXIT.copy}`,
    `[ "$(head -n 1 "$dir/channel.sig")" = '${SIGNATURE_HEADER}' ] || exit ${EXIT.signature}`,
    'ok=',
    `for key in '${keysDir}'/*.pem; do`,
    '  [ -f "$key" ] || continue',
    '  while read -r kind id b64 || [ -n "$kind" ]; do',
    '    [ "$kind" = key ] || continue',
    "    case $b64 in *[!A-Za-z0-9+/=]*|'') continue;; esac",
    '    printf \'%s\' "$b64" | base64 -d > "$dir/signature" 2>/dev/null || continue',
    `    if '${openssl}' pkeyutl -verify -pubin -inkey "$key" -rawin -in "$dir/message" -sigfile "$dir/signature" >/dev/null 2>&1; then ok=1; break 2; fi`,
    '  done < "$dir/channel.sig"',
    'done',
    `[ -n "$ok" ] || exit ${EXIT.signature}`,
    // The package must be one that the signed file lists.
    `b64sum=$('${openssl}' dgst -sha512 -binary "$dir/update.deb" | base64 -w 0) || exit ${EXIT.copy}`,
    `sed -n 's/^[ -]*sha512:[ ]*//p' "$dir/channel.yml" | tr -d "\\"' \\r" | grep -Fxq -- "$b64sum" || exit ${EXIT.signature}`,
    // Our package, and a higher version than the one installed.
    `pkg=$('${dpkgDeb}' -f "$dir/update.deb" Package 2>/dev/null) || exit ${EXIT.notOurs}`,
    `[ "$pkg" = '${DEB_PACKAGE}' ] || exit ${EXIT.notOurs}`,
    `new=$('${dpkgDeb}' -f "$dir/update.deb" Version 2>/dev/null) || exit ${EXIT.notOurs}`,
    `old=$('${dpkgQuery}' -W -f='\${Version}' '${DEB_PACKAGE}' 2>/dev/null) || exit ${EXIT.notNewer}`,
    `[ -n "$new" ] && [ -n "$old" ] || exit ${EXIT.notNewer}`,
    `'${dpkg}' --compare-versions "$new" gt "$old" || exit ${EXIT.notNewer}`,
    `echo '${READY_LINE}'`,
    `read -r answer || exit ${EXIT.notGo}`,
    `[ "$answer" = go ] || exit ${EXIT.notGo}`,
    `'${dpkg}' -i "$dir/update.deb" </dev/null`,
    'status=$?',
    'exit $status',
  ].join('\n');
}

/** The sha512 of the feed (base64) in hex, as sha512sum writes it; null if it is not one. */
export function sha512Hex(base64: string): string | null {
  const bytes = Buffer.from(base64, 'base64');
  return bytes.length === 64 ? bytes.toString('hex') : null;
}

/** The command line: pkexec with the desktop's agent only, or the script directly as root. */
export function debInstallCommand(
  update: Pick<DebUpdate, 'file'>,
  hex: string,
  channel: { yml: string; sig: string; name: string },
  o: RootScriptOptions & { asRoot?: boolean; pkexec?: string } = {},
): { command: string; args: string[] } {
  const sh = [
    '/bin/sh',
    '-c',
    rootScript(o),
    'monsters-update',
    update.file,
    hex,
    channel.yml,
    channel.sig,
    channel.name,
  ];
  if (o.asRoot) return { command: sh[0] ?? '/bin/sh', args: sh.slice(1) };
  // --disable-internal-agent: never a password prompt on the terminal the app was started from
  // (the main process would wait for it); without a desktop agent pkexec fails at once.
  return { command: o.pkexec ?? PKEXEC, args: ['--disable-internal-agent', ...sh] };
}

/** A word of the shell, quoted only when needed. */
export function shellWord(word: string): string {
  return /^[A-Za-z0-9_@%+=:,./-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`;
}

/** Finishes a package dpkg left unpacked but not configured (missing dependencies). */
export const REPAIR_COMMAND = 'sudo apt install -f';

/** What to type in a terminal to install the downloaded package by hand. */
export function manualInstallCommand(file: string): string {
  return `sudo apt install ${shellWord(file)}`;
}

function lastLines(text: string, n = 3): string {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(-n)
    .join(' · ');
}

/**
 * What dpkg said: its own `dpkg: …` lines (the package scripts write other things, e.g. the
 * postinst's `unshare` probe); the last lines when there are none.
 */
export function dpkgDetail(stderr: string): string {
  const lines = stderr.split('\n').map((l) => l.trim());
  const own: string[] = [];
  lines.forEach((l, i) => {
    if (!l.startsWith('dpkg:')) return;
    // "dpkg: error processing archive … (--install):" and the reason on the next line.
    const next = lines[i + 1];
    own.push(l.endsWith(':') && next ? `${l} ${next}` : l);
  });
  return own.length > 0 ? own.slice(-2).join(' · ') : lastLines(stderr) || 'no output';
}

/** The failure for an exit of the root script (or of pkexec) before "ready". */
export function failureBeforeReady(code: number | null, stderr: string): DebFailure {
  if (code === 126) return { kind: 'cancelled' };
  if (code === 127) {
    // pkexec's own messages (English: polkit's are not translated on Ubuntu).
    if (/no authentication agent/i.test(stderr)) return { kind: 'no-agent' };
    if (/not authori[sz]ed/i.test(stderr)) return { kind: 'not-authorized' };
    if (/dismissed/i.test(stderr)) return { kind: 'cancelled' };
    return { kind: 'not-authorized' };
  }
  if (code === EXIT.mismatch) return { kind: 'mismatch' };
  if (code === EXIT.signature) return { kind: 'signature' };
  if (code === EXIT.notOurs) return { kind: 'not-ours' };
  if (code === EXIT.notNewer) return { kind: 'not-newer' };
  if (code === EXIT.openssl) return { kind: 'openssl' };
  if (code === EXIT.copy) return { kind: 'copy', detail: lastLines(stderr) || 'copy failed' };
  return { kind: 'error', detail: lastLines(stderr) || `exit code ${String(code)}` };
}

/** The reason of a failure, one or two sentences for the user. */
export function describeDebFailure(f: DebFailure): string {
  const t = debInstallStrings();
  switch (f.kind) {
    case 'no-pkexec':
      return t.noPkexec;
    case 'cancelled':
      return t.cancelled;
    case 'timeout':
      return t.timeout;
    case 'no-agent':
      return t.noAgent;
    case 'not-authorized':
      return t.notAuthorized;
    case 'mismatch':
      return t.mismatch;
    case 'signature':
      return t.signature;
    case 'not-ours':
      return t.notOurs;
    case 'not-newer':
      return t.notNewer;
    case 'openssl':
      return t.openssl;
    case 'copy':
      return t.copy(f.detail);
    case 'depends':
      return t.depends(f.missing.join(', '));
    case 'dpkg':
      return t.dpkg(String(f.code), f.detail, dependencyTrouble(f));
    case 'error':
      return t.error(f.detail);
  }
}

/** dpkg unpacked the package and could not configure it because of missing dependencies. */
export function dependencyTrouble(f: DebFailure): boolean {
  return f.kind === 'dpkg' && /dependency problems|depends on|not configured|unmet/i.test(f.detail);
}

/** One line for desktop.log. */
export function logDebFailure(f: DebFailure): string {
  switch (f.kind) {
    case 'copy':
    case 'error':
      return `${f.kind}: ${f.detail}`;
    case 'dpkg':
      return `dpkg exit ${String(f.code)}: ${f.detail}`;
    case 'depends':
      return `depends: ${f.missing.join(', ')}`;
    default:
      return f.kind;
  }
}

// --- dependencies, checked before the update is offered -----------------------------------

/** One term of a `Depends` field: a package name with an optional version condition. */
export interface DebDependency {
  name: string;
  op?: string;
  version?: string;
}

/** `a (>= 1), b | c` → [[a ≥ 1], [b, c]]: every group needs one of its alternatives. */
export function parseDepends(field: string): DebDependency[][] {
  return field
    .split(',')
    .map((group) =>
      group
        .split('|')
        .map((alt) => {
          const m = /^\s*([^\s(:]+)(?::\w+)?\s*(?:\(\s*(<<|<=|=|>=|>>|<|>)\s*([^)\s]+)\s*\))?/.exec(
            alt,
          );
          return m?.[1]
            ? { name: m[1], ...(m[2] && m[3] ? { op: m[2], version: m[3] } : {}) }
            : null;
        })
        .filter((d): d is DebDependency => d !== null),
    )
    .filter((g) => g.length > 0);
}

export type CommandRunner = (
  command: string,
  args: string[],
) => Promise<{ code: number | null; stdout: string }>;

const runCommand: CommandRunner = (command, args) =>
  new Promise((resolve) => {
    execFile(
      command,
      args,
      { timeout: 20_000, maxBuffer: 8 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        const code = err ? (typeof err.code === 'number' ? err.code : null) : 0;
        resolve({ code, stdout: stdout ?? '' });
      },
    );
  });

const describeDependency = (d: DebDependency): string =>
  d.op ? `${d.name} (${d.op} ${d.version})` : d.name;

/**
 * The dependencies of a downloaded package that this computer cannot satisfy, as written in its
 * `Pre-Depends`/`Depends` (`dpkg-deb -f`) against the installed packages and what they provide
 * (`dpkg-query`). Empty when all are there, and also when the tools do not answer: the check is
 * there to avoid a package left half installed, never to block an update on a doubt.
 */
export async function missingDepends(
  file: string,
  run: CommandRunner = runCommand,
): Promise<string[]> {
  const field = await run('/usr/bin/dpkg-deb', ['-f', file, 'Pre-Depends', 'Depends']);
  if (field.code !== 0) return [];
  // "Depends: a, b" lines (and "Pre-Depends: …"): one list.
  const groups = parseDepends(
    field.stdout.replace(/^(?:Pre-)?Depends:/gim, ',').replace(/\n\s+/g, ' '),
  );
  if (groups.length === 0) return [];
  const known = await run(DPKG_QUERY, [
    '-W',
    '-f',
    '${Package}\t${Version}\t${db:Status-Abbrev}\t${Provides}\n',
  ]);
  if (known.code !== 0) return [];
  const versions = new Map<string, string>();
  /** Virtual packages and the versions they are provided at (`name (= 1.2)`; none when unversioned). */
  const provided = new Map<string, string[]>();
  for (const line of known.stdout.split('\n')) {
    const [name, version, status, provides] = line.split('\t');
    if (!name || !version || !status?.startsWith('ii')) continue;
    versions.set(name, version);
    for (const p of (provides ?? '').split(',')) {
      const m = /^\s*([^\s(:]+)(?::\w+)?\s*(?:\(\s*=\s*([^)\s]+)\s*\))?/.exec(p);
      if (!m?.[1]) continue;
      const list = provided.get(m[1]) ?? [];
      if (m[2]) list.push(m[2]);
      provided.set(m[1], list);
    }
  }
  const satisfies = async (have: string, d: DebDependency) =>
    !d.op ||
    !d.version ||
    (await run(DPKG, ['--compare-versions', have, d.op, d.version])).code === 0;
  const missing: string[] = [];
  for (const group of groups) {
    let ok = false;
    for (const d of group) {
      const have = versions.get(d.name);
      if (have !== undefined) ok = await satisfies(have, d);
      else {
        // A virtual package: any provider without a condition; with one, a provider that gives
        // its version (`libasound2 (= 1.2.11)` of libasound2t64 on Ubuntu 24.04, review of
        // 19/10, item 19). An unversioned Provides never meets a version condition (Debian policy).
        const given = provided.get(d.name);
        if (given && !d.op) ok = true;
        for (const v of given ?? []) {
          if (ok) break;
          ok = await satisfies(v, d);
        }
      }
      if (ok) break;
    }
    if (!ok) missing.push(group.map(describeDependency).join(' | '));
  }
  return missing;
}

/** A running install: root waits for "go" between `ready` and `go()`. */
export interface DebInstallRun {
  /** null when root holds a checked copy and waits; otherwise why it stopped (nothing done). */
  readonly ready: Promise<DebFailure | null>;
  /** Runs dpkg; null when the package is installed. */
  go(): Promise<DebFailure | null>;
  /** Root exits without installing. */
  cancel(): void;
}

export type DebInstaller = (update: DebUpdate) => DebInstallRun;

type Spawn = (command: string, args: string[]) => ChildProcess;

export interface DebInstallOptions extends RootScriptOptions {
  spawn?: Spawn;
  pkexec?: string;
  asRoot?: boolean;
  exists?: (path: string) => boolean;
  /** Where the channel file and its `.sig` are written for root to copy (default: the tmpdir). */
  tmpDir?: string;
}

const failed = (f: DebFailure): DebInstallRun => ({
  ready: Promise.resolve(f),
  go: () => Promise.resolve(f),
  cancel: () => {},
});

/** Starts the root script (the password is asked now). */
export function startDebInstall(update: DebUpdate, o: DebInstallOptions = {}): DebInstallRun {
  const hex = sha512Hex(update.sha512);
  if (!hex) return failed({ kind: 'mismatch' });
  const asRoot = o.asRoot ?? process.getuid?.() === 0;
  const pkexec = o.pkexec ?? PKEXEC;
  // Without the signed channel file root has nothing to check the package against.
  if (!update.channel) return failed({ kind: 'signature' });
  if (!asRoot && !(o.exists ?? existsSync)(pkexec)) return failed({ kind: 'no-pkexec' });
  // The verified channel file and its signature, for root to copy and check again (the user's
  // copy may change afterwards: root checks its own).
  let files: string;
  try {
    files = mkdtempSync(join(o.tmpDir ?? tmpdir(), 'monsters-update-'));
    writeFileSync(join(files, 'channel.yml'), update.channel.text, { mode: 0o600 });
    writeFileSync(join(files, 'channel.yml.sig'), update.channel.signature, { mode: 0o600 });
  } catch (err) {
    return failed({ kind: 'copy', detail: (err as Error).message });
  }
  const removeFiles = () => rmSync(files, { recursive: true, force: true });
  const { command, args } = debInstallCommand(
    update,
    hex,
    {
      yml: join(files, 'channel.yml'),
      sig: join(files, 'channel.yml.sig'),
      name: update.channel.name,
    },
    { ...o, asRoot, pkexec },
  );
  const spawn: Spawn = o.spawn ?? ((c, a) => nodeSpawn(c, a, { stdio: ['pipe', 'pipe', 'pipe'] }));

  let child: ChildProcess;
  try {
    child = spawn(command, args);
  } catch (err) {
    removeFiles();
    return failed({ kind: 'error', detail: (err as Error).message });
  }
  let stderr = '';
  let stdout = '';
  let isReady = false;
  let resolveReady: (f: DebFailure | null) => void = () => {};
  const ready = new Promise<DebFailure | null>((r) => (resolveReady = r));
  const exit = new Promise<{ code: number | null; error?: string }>((r) => {
    child.on('error', (err) => r({ code: null, error: err.message }));
    child.on('close', (code) => r({ code }));
  });
  const errDecoder = new StringDecoder('utf8');
  const outDecoder = new StringDecoder('utf8');
  child.stderr?.on('data', (d: Buffer) => {
    if (stderr.length < 65_536) stderr += errDecoder.write(d);
  });
  child.stdout?.on('data', (d: Buffer) => {
    stdout += outDecoder.write(d);
    if (!isReady && stdout.split('\n').includes(READY_LINE)) {
      isReady = true;
      resolveReady(null);
    }
  });
  // A broken pipe when root has already gone: the exit says why.
  child.stdin?.on('error', () => {});
  void exit.then(({ code, error }) => {
    removeFiles();
    if (isReady) return;
    resolveReady(error ? { kind: 'error', detail: error } : failureBeforeReady(code, stderr));
  });

  return {
    ready,
    async go() {
      if (!isReady) return (await ready) ?? { kind: 'error', detail: 'not ready' };
      child.stdin?.end('go\n');
      const { code, error } = await exit;
      if (error) return { kind: 'error', detail: error };
      if (code === 0) return null;
      return { kind: 'dpkg', code, detail: dpkgDetail(stderr) };
    },
    cancel() {
      child.stdin?.end();
      // Still at the password prompt: the closed pipe does not reach pkexec, stop it.
      if (!isReady) child.kill();
    },
  };
}
