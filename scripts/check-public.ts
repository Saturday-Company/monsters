/*
 * Guard of the public repo (D-143): fails when a file that git would publish carries personal
 * data, the hosts and paths of the maintainers' machines, links to private agent sessions, the
 * third-party references of `bozze/`, or something shaped like a real secret.
 *
 *   node scripts/check-public.ts          (part of `pnpm lint`, so of ci:local and ci.yml)
 *
 * Two layers:
 * - classes, in plain text: any CGNAT/Tailscale address, any absolute home or /srv folder that is
 *   not an example name, personal and company mailboxes, Claude session links, key and token
 *   shapes of the usual providers, files under `bozze/`;
 * - private terms (host names, account ids, private project names): only their SHA-256 is here,
 *   so the list does not publish what it protects. Text is cut into atoms (`[a-z0-9]+`, lower
 *   case); a window of n atoms is keyed as the atoms joined by the single `.`, `_` or `-` between
 *   them, or by a space for any other gap, and the key is hashed. A term is normalised the same
 *   way, so "Alice  Host" matches the term "alice host" and "a.b-c" only "a.b-c". Extra
 *   plain-text terms can live in `scripts/check-public.local.txt` (gitignored, one per line,
 *   `#` comments): the maintainers keep the real list there. File names are checked too.
 *
 * Files: tracked plus untracked-but-not-ignored (`git ls-files --cached --others
 * --exclude-standard`), so a new file is caught before it is committed. Binary files are checked
 * by name only.
 *
 * Allowed on purpose:
 * - example addresses of the 100.64.0.0/10 range in 100.64.x.x and 100.127.x.x (tests, docs);
 * - example home folders (alice, u, demo…, see EXAMPLE_HOMES) and /srv examples (EXAMPLE_SRV);
 * - fake keys of the tests: a match that reads as a fixture (test, fake, wrong, example, prova,
 *   0123456789, abcdef, a character repeated 6 times…) or one listed in FIXTURES.
 * The patterns below are written so that this file does not match itself.
 *
 * Exit code: 0 clean, 1 findings (one line each: file:line rule: match), 2 setup error.
 */
import { execFileSync } from 'node:child_process';
import { hash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

export interface Finding {
  file: string;
  line: number;
  rule: string;
  match: string;
}

interface Rule {
  id: string;
  pattern: RegExp;
  /** True when this match is an allowed example or fixture. */
  allowed?: (match: string) => boolean;
}

/**
 * The private terms, normalised (see `normalizeTerm`), as `HashedTerm`: atom count, key length,
 * 16-bit quick hash and SHA-256. No plain text here; the first three only spare the SHA-256 of
 * almost every window of the text.
 */
const PRIVATE_TERMS: readonly HashedTerm[] = [
  [2, 9, 0x5ff1, 'd0d57b7fa7e1e56ef5655ec3ff79bba26aec069f2e05491e51ff90411f58dfa0'],
  [1, 14, 0x4184, '893144c67797271c5201d646ab54641055375561b905100363d4ddaa2d06049e'],
  [2, 15, 0xf3cc, '5c133c9f45bcaf744e91a8ecfca8c77b07e449fde176774a7df4c113fc069e0c'],
  [2, 11, 0x8260, '57302d52f252fa309ee7e7e81aa6877625074f2b5e43c654244f0e2c73e066f4'],
  [2, 13, 0x0f7e, '815c29b30621cc444bc8d5c1d6f9fac8199a963425ba11021b22a838fb681f11'],
  [2, 16, 0x7cda, 'e8ae71495e05c6f6cb4465a885d8adcea15d1b94552104ccf185348277f8ea64'],
  [1, 10, 0x2194, '5f6f29ba7231e9eeffc6d944c5b5919012b667de2b47e8beebbb1fc451ef7a56'],
  [1, 10, 0xd95e, '872b02c0e5d8a6882cd2f11051549f290e15146d0bb54fd2f130003ab34d8d32'],
  [1, 5, 0x42a0, 'f829ab6b144ee5b51142f77e77c91885cd3276d8fcc36175a68f919388efbfbb'],
  [1, 10, 0x2dd0, '1d315d4598189d36b0e47c3f8fe32d90c2d817acbaff20a4751d742791d0e0ea'],
  [1, 7, 0x8091, '49eff747f7b66f70133bfe00aa8ac2d6b0fbee5be80e52537b0163f147d20418'],
  [2, 15, 0x8510, '4c73e45fb7e4380acec32a83b9dcb0943afc15fed62bcc7ca226d85716d84804'],
  [2, 15, 0xcf1d, '24497fbf970d091e47b09d7b9f3d953f4a854feb3fd11be6fc5c9fb495ad4221'],
  [1, 10, 0xbee9, '76ab15d8f0993c012fe4664cff1e8fb8413f09e8c5f1bc31d608d7743b872270'],
  [1, 8, 0x7177, '50619eb5fb38485dbeca50f49c70b318f5279142e30c9303bf32c695ae843ca3'],
  [1, 3, 0x0fb8, '1dd882ca328f95c4a866d6f665e7f9a65b855d8cd77d5d90787b853738a229ee'],
  [3, 14, 0x4bc2, 'c8cfbd44a454f578fe6d1b8dd2781cb245802b6f18e1a40659154701626c0390'],
  [3, 19, 0x2df2, 'ce78052061cc7a987fbc7502b8072d558eb8bf9cd5b9014311fc84af75d1dcee'],
];

/** Fixtures that do not read as fakes by themselves but are. Exact strings. */
const FIXTURES = new Set<string>([
  'AKIA' + 'IOSFODNN7EXAMPLE',
  'mario.rossi' + '@gmail.com',
  'sk-ant-' + 'api03-AAAABBBBCCCCDDDDEEEE',
]);

const FAKE_MARKERS =
  /test|fake|wrong|example|prova|should|not-for|user-key|dummy|sample|0123456789|abcdef|(.)\1{5,}/i;

const looksFake = (m: string): boolean => FIXTURES.has(m) || FAKE_MARKERS.test(m);

/** 100.64.0.0/10 (CGNAT, Tailscale): only 100.64.x.x and 100.127.x.x are examples. */
const cgnatExample = (m: string): boolean => /^100\.(64|127)\./.test(m);

/**
 * Home folder names that are examples, system folders or the documented users of the signing
 * and CI scripts, lower case. A one-letter name is always an example.
 */
const EXAMPLE_HOMES = new Set([
  'alice',
  'bob',
  'carol',
  'dave',
  'eve',
  'mallory',
  'user',
  'username',
  'utente',
  'example',
  'esempio',
  'me',
  'you',
  'name',
  'nome',
  'runner',
  'runneradmin',
  'ubuntu',
  'demo',
  'test',
  'tester',
  'andrea',
  'ana',
  'mario',
  'shared',
  'library',
  'logs',
  'monsters',
  'monsters-ci',
  'monsters-sign',
]);
const EXAMPLE_SRV = new Set(['progetti', 'projects', 'notes', 'monsters', 'data', 'example']);

const exampleFolder = (m: string): boolean => {
  const [, root, name] = /^\/(home|Users|srv)\/(.*)$/i.exec(m) ?? [];
  if (root === undefined || name === undefined) return false;
  const n = name.toLowerCase();
  if (root.toLowerCase() === 'srv') return EXAMPLE_SRV.has(n);
  return n.length === 1 || EXAMPLE_HOMES.has(n);
};

/** Mailboxes of the company domain that are public on purpose. */
const companyMailbox = (m: string): boolean => /^(opensource|noreply|no-reply)@/i.test(m);

export const RULES: readonly Rule[] = [
  {
    id: 'cgnat-address',
    pattern: /(?<![\d.])100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}(?![\d])/g,
    allowed: cgnatExample,
  },
  {
    id: 'private-path',
    // Absolute only: not after a word, a dot, `~`, `$`, `}`, `/` or `-` (`$h/home/logs`).
    pattern: /(?<![\w.~$}/-])\/(?:home|Users|srv)\/[A-Za-z0-9._-]+|\/tmp\/claude-\d+/g,
    allowed: exampleFolder,
  },
  {
    id: 'personal-email',
    pattern:
      /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@(?:gmail|googlemail|icloud|me|hotmail|outlook|live|yahoo|proton(?:mail)?)\.[a-z.]+/gi,
    allowed: looksFake,
  },
  {
    id: 'company-email',
    pattern: /(?<![A-Za-z0-9._%+-])[A-Za-z0-9._%+-]+@saturday(?:company\.it|\.company)\b/gi,
    allowed: companyMailbox,
  },
  {
    id: 'agent-session',
    pattern: new RegExp(['Claude' + '-Session', 'claude\\.ai/code/' + 'session_'].join('|'), 'g'),
  },
  {
    id: 'secret',
    pattern: new RegExp(
      [
        'sk-or-' + 'v1-[A-Za-z0-9]{16,}',
        'sk-' + 'ant-[A-Za-z0-9_-]{16,}',
        'sk-' + 'proj-[A-Za-z0-9_-]{16,}',
        'gh' + '[pousr]_[A-Za-z0-9]{30,}',
        'github' + '_pat_[A-Za-z0-9_]{30,}',
        'AK' + 'IA[0-9A-Z]{16}',
        'xox' + '[abprs]-[A-Za-z0-9-]{10,}',
        'AI' + 'za[0-9A-Za-z_-]{35}',
        // Telegram bot token: id, colon, 35 characters.
        '\\b\\d{8,10}:A[A-Za-z0-9_-]{34}\\b',
        // A PEM private key with a real body (a header alone is a redaction test).
        '-----BEGIN [A-Z ]*PRIVATE' + ' KEY-----\\r?\\n[A-Za-z0-9+/=]{60,}',
      ].join('|'),
      'g',
    ),
    allowed: looksFake,
  },
];

const JOINERS = '._-';

/** A gap between two atoms as keyed: a single `.`, `_` or `-` stays, anything else is a space. */
const gapKey = (gap: string): string => (gap.length === 1 && JOINERS.includes(gap) ? gap : ' ');

/** A term as the scanner keys it: atoms in lower case, a single `._-` kept, other gaps a space. */
export function normalizeTerm(term: string): string {
  let out = '';
  let prevEnd = -1;
  for (const m of term.matchAll(/[a-z0-9]+/gi)) {
    if (prevEnd >= 0) out += gapKey(term.slice(prevEnd, m.index));
    out += m[0].toLowerCase();
    prevEnd = m.index + m[0].length;
  }
  return out;
}

export const sha256 = (s: string): string => hash('sha256', s, 'hex');

const FNV_OFFSET = 0x811c9dc5;
const fnvStep = (h: number, c: number): number => Math.imul(h ^ c, 0x01000193) >>> 0;

/** Low 16 bits of the FNV-1a of a key: the cheap prefilter before SHA-256. */
export function quickHash(key: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < key.length; i++) h = fnvStep(h, key.charCodeAt(i));
  return h & 0xffff;
}

/** A hashed private term: atom count, key length, `quickHash` and SHA-256 of the key. */
export type HashedTerm = readonly [atoms: number, length: number, quick: number, sha: string];

/** The private terms as the scanner looks them up. */
export interface TermSet {
  hashes: Set<string>;
  /** By atom count: length × 65536 + quick hash of each term. */
  quick: Map<number, Set<number>>;
  maxAtoms: number;
}

export function hashTerm(term: string): HashedTerm | null {
  const key = normalizeTerm(term);
  if (key === '') return null;
  return [key.split(/[ ._-]/).length, key.length, quickHash(key), sha256(key)];
}

/** The set of private terms from hashed entries and plain-text terms. */
export function termSet(hashed: Iterable<HashedTerm>, plain: Iterable<string> = []): TermSet {
  const hashes = new Set<string>();
  const quick = new Map<number, Set<number>>();
  const add = ([atoms, length, q, sha]: HashedTerm): void => {
    hashes.add(sha);
    let set = quick.get(atoms);
    if (set === undefined) quick.set(atoms, (set = new Set()));
    set.add(length * 65536 + q);
  };
  for (const t of hashed) add(t);
  for (const t of plain) {
    const h = hashTerm(t);
    if (h !== null) add(h);
  }
  return { hashes, quick, maxAtoms: Math.max(0, ...quick.keys()) };
}

/** Plain-text terms of a local list: one per line, blank lines and `#` comments skipped. */
export function parseLocalTerms(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== '' && !l.startsWith('#'));
}

const lineOf = (content: string, index: number): number => {
  let n = 1;
  for (let i = content.indexOf('\n'); i !== -1 && i < index; i = content.indexOf('\n', i + 1)) n++;
  return n;
};

function scanTerms(file: string, content: string, terms: TermSet): Finding[] {
  const out: Finding[] = [];
  const max = terms.maxAtoms;
  if (max === 0) return out;
  // Wanted key lengths by window size, as flags, so most windows cost no hashing at all.
  const wanted: Uint8Array[] = [];
  const quick: Set<number>[] = [];
  for (let n = 1; n <= max; n++) {
    const flags = new Uint8Array(256);
    const set = terms.quick.get(n) ?? new Set<number>();
    for (const v of set) if (v < 256 * 65536) flags[Math.floor(v / 65536)] = 1;
    wanted[n] = flags;
    quick[n] = set;
  }
  // Ring of the last `max` atoms: start and end offsets.
  const starts = new Array<number>(max).fill(0);
  const ends = new Array<number>(max).fill(0);
  let count = 0;
  const atom = /[A-Za-z0-9]+/g;
  for (let m = atom.exec(content); m !== null; m = atom.exec(content)) {
    const slot = count % max;
    starts[slot] = m.index;
    ends[slot] = atom.lastIndex;
    count++;
    // The windows that end at this atom, n atoms long. Their key is never built unless its
    // length (atoms plus one character per gap) and then its quick hash belong to a term.
    let atomsLen = 0;
    for (let n = 1; n <= max && n <= count; n++) {
      const first = (count - n) % max;
      atomsLen += ends[first]! - starts[first]!;
      const keyLen = atomsLen + n - 1;
      if (keyLen >= 256 || wanted[n]![keyLen] === 0) continue;
      let h = FNV_OFFSET;
      for (let k = n; k >= 1; k--) {
        const t = (count - k) % max;
        if (k < n) {
          const gapStart = ends[(count - k - 1) % max]!;
          const g = starts[t]! - gapStart === 1 ? content.charCodeAt(gapStart) : 32;
          h = fnvStep(h, g === 46 || g === 95 || g === 45 ? g : 32);
        }
        for (let c = starts[t]!; c < ends[t]!; c++) {
          const ch = content.charCodeAt(c);
          h = fnvStep(h, ch >= 65 && ch <= 90 ? ch + 32 : ch);
        }
      }
      if (!quick[n]!.has(keyLen * 65536 + (h & 0xffff))) continue;
      const raw = content.slice(starts[first], atom.lastIndex);
      if (!terms.hashes.has(sha256(normalizeTerm(raw)))) continue;
      out.push({
        file,
        line: lineOf(content, starts[first]!),
        rule: 'private-term',
        match: raw.split(/\r?\n/)[0]!,
      });
    }
  }
  return out;
}

const BINARY = /\.(png|jpe?g|gif|webp|ico|icns|woff2?|ttf|otf|pdf|zip|gz|dmg|exe|wasm|node)$/i;

const DEFAULT_TERMS = termSet(PRIVATE_TERMS);

/** Findings in the given files (path relative to the repo, content or null for binaries). */
export function scan(
  files: Iterable<{ path: string; content: string | null }>,
  terms: TermSet = DEFAULT_TERMS,
): Finding[] {
  const out: Finding[] = [];
  for (const { path, content } of files) {
    const p = path.replace(/\\/g, '/');
    if (p === 'bozze' || p.startsWith('bozze/')) {
      out.push({ file: p, line: 0, rule: 'third-party-draft', match: p });
      continue;
    }
    // A private term in a file name is published as much as one in the text.
    for (const f of scanTerms(p, p, terms)) out.push({ ...f, line: 0 });
    if (content === null) continue;
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      for (const m of content.matchAll(rule.pattern)) {
        const match = m[0];
        if (rule.allowed?.(match)) continue;
        out.push({ file: p, line: lineOf(content, m.index), rule: rule.id, match });
      }
    }
    out.push(...scanTerms(p, content, terms));
  }
  return out;
}

function repoFiles(root: string): string[] {
  const raw = execFileSync(
    'git',
    ['ls-files', '-z', '--cached', '--others', '--exclude-standard', '--deduplicate'],
    { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  return raw.split('\0').filter((f) => f !== '');
}

function* readAll(
  root: string,
  files: string[],
): Generator<{ path: string; content: string | null }> {
  for (const path of files) {
    if (BINARY.test(path)) {
      yield { path, content: null };
      continue;
    }
    let buf: Buffer;
    try {
      buf = readFileSync(resolve(root, path));
    } catch {
      continue; // deleted in the working tree, or a submodule/directory entry
    }
    yield { path, content: buf.includes(0) ? null : buf.toString('utf8') };
  }
}

/** The maintainers' plain-text terms, next to this script; it must stay gitignored. */
export const LOCAL_TERMS = 'scripts/check-public.local.txt';

function main(): void {
  const root = resolve(import.meta.dirname, '..');
  let files: string[];
  try {
    files = repoFiles(root);
  } catch (err) {
    console.error(`check-public: cannot list the files with git: ${(err as Error).message}`);
    process.exit(2);
  }
  if (files.includes(LOCAL_TERMS)) {
    console.error(`check-public: ${LOCAL_TERMS} would be published: add it to .gitignore`);
    process.exit(2);
  }
  const localPath = resolve(root, LOCAL_TERMS);
  const local = existsSync(localPath) ? parseLocalTerms(readFileSync(localPath, 'utf8')) : [];
  const findings = scan(readAll(root, files), termSet(PRIVATE_TERMS, local));
  if (findings.length === 0) {
    const extra = local.length > 0 ? `, ${local.length} local terms` : '';
    process.stdout.write(`check-public: ${files.length} files${extra}, nothing private\n`);
    return;
  }
  for (const f of findings) console.error(`${f.file}:${f.line} ${f.rule}: ${f.match}`);
  console.error(
    `check-public: ${findings.length} finding(s). Replace them with examples (100.64.0.1, alice, ` +
      '/home/alice), move the value to a gitignored local file, or, for a test fixture, make it ' +
      'read as fake (see scripts/check-public.ts).',
  );
  process.exit(1);
}

if (import.meta.filename === resolve(process.argv[1] ?? '')) main();
