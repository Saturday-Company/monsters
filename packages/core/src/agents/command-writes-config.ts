/*
 * Does a shell command line write the harness configuration (CLAUDE.md, AGENTS.md, `.claude`, …)?
 *
 * A speed bump in front of Claude Code's Bash (D-079, D-166). The line is cut into the commands the shell
 * would run (`;`, `&&`, `||`, `|`, newlines, groups) and each one is judged on its own: a command writes the
 * configuration when it redirects into it, when it is not a known read-only command and it names the
 * configuration, or when it runs code inline (`node -e`, `bash -c`, `eval`) on a line that names it. Reading
 * (`cat`, `ls`, `du`, `grep`, `git diff`, …) passes whatever else is on the line. What the parser cannot
 * follow (`$(…)`, backticks, here-documents, process substitution) keeps blocking when a name is present:
 * when in doubt, block. Followed since the review of 25/10: a name the shell expands (`CLAU*`,
 * `{CLAUDE,x}.md`, `$'\x43LAUDE.md'`, `C\LAUDE.md`), a copy into a folder, the substitutions that print a
 * path (`$(git rev-parse --show-toplevel)`), arithmetic, and the quoted here-document of a commit message.
 * Not followed: a variable's value on a line that names no configuration (`echo x > $OUT`, `rm $F`), and
 * writers that never name a file (`git stash pop`, `git checkout main`).
 */

/**
 * Names of the harness configuration inside a command line (a word, any path before it). A folder name
 * may follow a brace or a comma (`{a,.claude}`), a host (`host:.claude`) or a short option glued to it
 * (`-t.claude`); `CLAUDE.md` and `AGENTS.md` count anywhere (`-oCLAUDE.md`, `sed 1wCLAUDE.md`):
 * review of 25/10, C-18.
 */
const CONFIG_WORD =
  /(?:(?:^|[\s'"`=;|&(<>/\\{,:]|(?:^|\s)-[A-Za-z]{1,12})(?:\.claude(?:[/\\]|\b)|\.mcp\.json\b|\.codex(?:[/\\]|\b))|CLAUDE(?:\.local)?\.md\b|AGENTS(?:\.override)?\.md\b)/i;
/** The same names as whole path segments, for the words the shell expands (`CLAU*`, `{CLAUDE,x}.md`). */
const CONFIG_SEGMENTS = [
  '.claude',
  '.codex',
  '.mcp.json',
  'CLAUDE.md',
  'CLAUDE.local.md',
  'AGENTS.md',
  'AGENTS.override.md',
];

/**
 * Redirections that write no file (`2>&1`, `>&2`, `>/dev/null`, `2> NUL`): a read of
 * CLAUDE.md with `2>&1` elsewhere in the line was refused as a write (22/10/2026). The digits start
 * where a run of digits starts: from inside one the match was tried again at every digit, and a
 * 50,000-digit line held the core for 1.5 s (review of 25/10, C-19).
 */
const NO_FILE_REDIRECT = /(?:(?<!\d)\d*|&)>>?\s*(?:&\d+|&-|\/dev\/null|NUL|\$null)(?=[\s;&|)]|$)/gi;

const namesConfig = (text: string): boolean => CONFIG_WORD.test(` ${text}`);

interface Word {
  text: string;
  /** Unquoted or double-quoted `$name`, `${…}`, a glob or a brace: the real word is not the one written. */
  expands: boolean;
  /**
   * The word as bash reads it, when it differs from `text`: a backslash outside quotes always escapes
   * (`C\LAUDE.md` is `CLAUDE.md`), while `text` keeps it before other characters for Windows paths.
   */
  bash?: string;
  /** The word as a pattern, when it has unquoted glob or brace characters (quoted ones escaped). */
  glob?: string;
  /** `wordNames`, once computed. */
  names?: boolean;
}

/** The brace expansions of a pattern (`{CLAUDE,x}.md`, `x{1..3}`), at most `limit`. */
function braces(pattern: string, limit = 64): string[] {
  // A pattern longer than any path a model writes: its braces read as wildcards, once.
  if (pattern.length > 1_024) return [pattern.replace(/[{},]/g, '*')];
  const out: string[] = [];
  const todo = [pattern];
  while (todo.length > 0 && out.length + todo.length <= limit) {
    const p = todo.pop()!;
    // The first brace pair with a comma or a range, not escaped.
    let open = -1;
    let found: { at: number; end: number; parts: string[] } | undefined;
    for (let i = 0; i < p.length && !found; i++) {
      if (p[i] === '\\') {
        i++;
        continue;
      }
      if (p[i] === '{') open = i;
      else if (p[i] === '}' && open !== -1) {
        const body = p.slice(open + 1, i);
        // A range (`{A..Z}`) stands for any of its letters or numbers.
        if (body.includes(',')) found = { at: open, end: i, parts: body.split(',') };
        else if (/^-?\w+\.\.-?\w+$/.test(body)) found = { at: open, end: i, parts: ['*'] };
        else open = -1;
      }
    }
    if (!found) {
      out.push(p);
      continue;
    }
    for (const part of found.parts) {
      todo.push(p.slice(0, found.at) + part + p.slice(found.end + 1));
    }
  }
  // Too many to follow: the pattern as it is, its braces read as wildcards.
  if (todo.length > 0) out.push(...todo.map((p) => p.replace(/[{},]/g, '*')));
  return out;
}

const STAR = '\0*';
const ANY = '\0?';

/** A glob path segment as tokens: `STAR`, `ANY` (also for a `[…]` class) or one literal character. */
function globTokens(segment: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < segment.length; i++) {
    const c = segment[i]!;
    if (c === '\\') {
      if (i + 1 < segment.length) out.push(segment[++i]!);
    } else if (c === '*') {
      if (out[out.length - 1] !== STAR) out.push(STAR);
    } else if (c === '?') out.push(ANY);
    else if (c === '[') {
      const end = segment.indexOf(']', i + 2);
      if (end === -1) out.push(c);
      else {
        out.push(ANY);
        i = end;
      }
    } else out.push(c);
  }
  return out;
}

/** Does a glob segment match a name, case aside? Linear wildcard matching; `*` skips a leading dot, as in bash. */
function globMatch(tokens: readonly string[], name: string): boolean {
  if (name.startsWith('.') && tokens[0] !== '.') return false;
  let p = 0;
  let s = 0;
  let star = -1;
  let mark = 0;
  while (s < name.length) {
    const t = tokens[p];
    if (
      t !== undefined &&
      t !== STAR &&
      (t === ANY || t.toLowerCase() === name[s]!.toLowerCase())
    ) {
      p++;
      s++;
    } else if (t === STAR) {
      star = p++;
      mark = s;
    } else if (star !== -1) {
      p = star + 1;
      s = ++mark;
    } else return false;
  }
  while (tokens[p] === STAR) p++;
  return p === tokens.length;
}

/**
 * Could the shell expand this pattern into a configuration name (`CLAU*`, `CLAUDE.m?`, `.cl*de/x`,
 * `{CLAUDE,x}.md`, `*.md`)? A segment of wildcards only (`*`, `build/*`) names nothing by itself: the
 * command is then judged by its other words, as before (review of 25/10, C-21).
 */
function globNames(pattern: string): boolean {
  return braces(pattern).some((p) => {
    if (namesConfig(p.replace(/\\(.)/g, '$1'))) return true;
    return p.split('/').some((segment) => {
      // Longer than any name can be, or wildcards only: nothing to match.
      if (segment.length > 256 || /^[*?]*$/.test(segment)) return false;
      if (!/[*?[]/.test(segment.replace(/\\./g, ''))) return false;
      const tokens = globTokens(segment);
      return CONFIG_SEGMENTS.some((name) => globMatch(tokens, name));
    });
  });
}

/** Does this word name the configuration, as written, as bash reads it, or once the shell expands it? */
const wordNames = (w: Word): boolean =>
  (w.names ??=
    namesConfig(w.text) ||
    (w.bash !== undefined && namesConfig(w.bash)) ||
    (w.glob !== undefined && globNames(w.glob)));

interface Command {
  words: Word[];
  /** Targets of the redirections that write (`>`, `>>`, `>|`, `&>`, `<>`). */
  targets: Word[];
  /** The text of the command as written, to find a name the quoting split. */
  raw: string;
  /** It reads what the command before it printed (`… | node`). */
  piped: boolean;
}

interface Lexed {
  commands: Command[];
  /** `$(…)`, backticks, here-documents, process substitution, `$'…'`: nothing can be said of what runs. */
  opaque: boolean;
  /** `$((…))` was read as a number: opaque after all if the line spells a substitution elsewhere. */
  arith: boolean;
}

/** Characters a backslash escapes outside of single quotes; before any other it is a literal (Windows paths). */
const ESCAPABLE = new Set([
  ' ',
  '\t',
  '"',
  "'",
  '$',
  '`',
  '\\',
  ';',
  '&',
  '|',
  '<',
  '>',
  '(',
  ')',
  '#',
  '*',
  '?',
]);

/** The text of `$'…'` (ANSI-C quoting) as bash decodes it: `$'\x43LAUDE.md'` is `CLAUDE.md`. */
function ansiC(body: string): string {
  const simple: Record<string, string> = {
    n: '\n',
    t: '\t',
    r: '\r',
    a: '\x07',
    b: '\b',
    e: '\x1b',
    E: '\x1b',
    f: '\f',
    v: '\v',
  };
  return body.replace(
    /\\(x[0-9a-fA-F]{1,2}|u[0-9a-fA-F]{1,4}|U[0-9a-fA-F]{1,8}|[0-7]{1,3}|c.|.)/g,
    (_, e: string) => {
      const code = (n: number) => (n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : '');
      if (/^[xuU]./.test(e)) return code(parseInt(e.slice(1), 16));
      if (/^[0-7]/.test(e)) return code(parseInt(e, 8));
      if (e[0] === 'c') return code(e.charCodeAt(1) & 0x1f);
      return simple[e] ?? e;
    },
  );
}

/**
 * Where the `(…)` that opens at `open` closes (the index of its `)`), or -1. Only a short one is
 * followed: a substitution of a path or a number is short, and a line of nested `$(` stays linear.
 */
function closing(src: string, open: number): number {
  let depth = 0;
  for (let j = open; j < Math.min(src.length, open + 256); j++) {
    if (src[j] === '(') depth++;
    else if (src[j] === ')' && --depth === 0) return j;
  }
  return -1;
}

/**
 * Command substitutions whose output is a path or a name, never what a file holds: `cat
 * $(git rev-parse --show-toplevel)/CLAUDE.md` is a read (review of 25/10, C-22). Any other keeps
 * the line opaque.
 */
const PATH_SUBSTITUTION =
  /^\s*(?:pwd|dirname|basename|realpath|readlink|whoami|uname|hostname|git\s+rev-parse)(?:\s+[\w./=-]+)*\s*$/;

/**
 * Characters that are a glob or a brace when unquoted; in a word's pattern they are escaped when
 * quoted.
 */
const GLOB_CHARS = '*?[]{},\\';

/** A small shell lexer: enough to cut the line into commands and words, quoting included. */
function lex(src: string): Lexed {
  const commands: Command[] = [];
  let words: Word[] = [];
  let targets: Word[] = [];
  let cur = '';
  /** The word as bash reads it (see `Word.bash`). */
  let bashCur = '';
  /** The word as a pattern (see `Word.glob`), and whether it has an unquoted glob or brace. */
  let pat = '';
  let globbed = false;
  let inWord = false;
  let expands = false;
  let redirect = false;
  let opaque = false;
  let arith = false;
  let start = 0;
  let piped = false;

  const endWord = () => {
    if (!inWord) return;
    const word: Word = { text: cur, expands };
    if (bashCur !== cur) word.bash = bashCur;
    if (globbed) word.glob = pat;
    (redirect ? targets : words).push(word);
    redirect = false;
    cur = '';
    bashCur = '';
    pat = '';
    globbed = false;
    inWord = false;
    expands = false;
  };
  /** Text that is literal for the shell (quoted or escaped). */
  const lit = (text: string) => {
    cur += text;
    bashCur += text;
    for (const c of text) pat += GLOB_CHARS.includes(c) ? `\\${c}` : c;
    inWord = true;
  };
  /**
   * `$(…)` at `at` (inside double quotes or not): a substitution that prints a path is kept as an
   * expanding word, any other makes the line opaque. Returns where to go on, or -1 when not followed.
   */
  const substitution = (at: number): number => {
    if (src[at + 2] === '(') {
      // `$((N+1))`: arithmetic, a number, unless it hides a substitution (checked on the whole line).
      const end = closing(src, at + 1);
      const body = end < 0 ? '' : src.slice(at + 3, end - 1);
      if (end < 0 || src[end - 1] !== ')' || /\$\(|`/.test(body)) return -1;
      arith = true;
      expands = true;
      lit(src.slice(at, end + 1));
      return end + 1;
    }
    const end = closing(src, at + 1);
    if (end < 0 || !PATH_SUBSTITUTION.test(src.slice(at + 2, end))) return -1;
    expands = true;
    lit(src.slice(at, end + 1));
    return end + 1;
  };
  const endCommand = (at: number) => {
    endWord();
    redirect = false;
    if (words.length > 0 || targets.length > 0) {
      commands.push({ words, targets, raw: src.slice(start, at), piped });
    }
    piped = false;
    words = [];
    targets = [];
    start = at + 1;
  };
  /** A file descriptor number right before a redirection (`2>`) is not an argument. */
  const dropDescriptor = () => {
    if (inWord && /^\d+$/.test(cur)) {
      cur = '';
      inWord = false;
    }
  };
  /** Unquoted text: a glob or a brace character keeps its meaning in the pattern. */
  const add = (ch: string) => {
    cur += ch;
    bashCur += ch;
    pat += ch === '\\' ? '\\\\' : ch;
    inWord = true;
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (ch === "'") {
      const end = src.indexOf("'", i + 1);
      const stop = end < 0 ? src.length : end;
      lit(src.slice(i + 1, stop));
      i = stop + 1;
      continue;
    }
    if (ch === '"') {
      inWord = true;
      i++;
      while (i < src.length && src[i] !== '"') {
        const c = src[i]!;
        if (c === '\\' && i + 1 < src.length && '"$`\\\n'.includes(src[i + 1]!)) {
          if (src[i + 1] !== '\n') lit(src[i + 1]!);
          i += 2;
          continue;
        }
        if (c === '$' && src[i + 1] === '(') {
          const after = substitution(i);
          if (after >= 0) {
            i = after;
            continue;
          }
          opaque = true;
        } else if (c === '`') opaque = true;
        else if (c === '$' && /[A-Za-z_{0-9@*#?!-]/.test(src[i + 1] ?? '')) expands = true;
        lit(c);
        i++;
      }
      i++;
      continue;
    }
    if (ch === '\\') {
      if (next === '\n') {
        i += 2;
        continue;
      }
      if (next !== undefined && ESCAPABLE.has(next)) {
        lit(next);
        i += 2;
        continue;
      }
      // Kept for a Windows path (`.\.claude`), dropped by bash (`C\LAUDE.md`): both readings are checked.
      inWord = true;
      if (next === undefined) {
        cur += ch;
        i++;
        continue;
      }
      cur += ch + next;
      bashCur += next;
      pat += GLOB_CHARS.includes(next) ? `\\${next}` : next;
      i += 2;
      continue;
    }
    if (ch === '`') {
      opaque = true;
      add(ch);
      i++;
      continue;
    }
    if (ch === '$') {
      if (next === "'") {
        // ANSI-C quoting: decoded, so the name is seen; still opaque, as it may spell a command.
        let end = i + 2;
        while (end < src.length && src[end] !== "'") end += src[end] === '\\' ? 2 : 1;
        opaque = true;
        lit(ansiC(src.slice(i + 2, Math.min(end, src.length))));
        i = end + 1;
        continue;
      }
      if (next === '(') {
        const after = substitution(i);
        if (after >= 0) {
          i = after;
          continue;
        }
        opaque = true;
      } else if (/[A-Za-z_{0-9@*#?!-]/.test(next ?? '')) expands = true;
      add(ch);
      i++;
      continue;
    }
    if (ch === ' ' || ch === '\t' || ch === '\r') {
      endWord();
      i++;
      continue;
    }
    if (ch === '#' && !inWord) {
      const nl = src.indexOf('\n', i);
      i = nl < 0 ? src.length : nl;
      continue;
    }
    if (ch === '\n' || ch === ';' || ch === '(' || ch === ')') {
      endCommand(i);
      i++;
      continue;
    }
    if (ch === '|') {
      endCommand(i);
      piped = true;
      i += next === '|' || next === '&' ? 2 : 1;
      continue;
    }
    if (ch === '&') {
      if (next === '>') {
        // `&>file` writes it.
        dropDescriptor();
        endWord();
        i += src[i + 2] === '>' ? 3 : 2;
        redirect = true;
        continue;
      }
      endCommand(i);
      i += next === '&' ? 2 : 1;
      continue;
    }
    if (ch === '>') {
      dropDescriptor();
      endWord();
      i++;
      if (src[i] === '>' || src[i] === '|' || src[i] === '&') i++;
      if (src[i] === '(') opaque = true;
      redirect = true;
      continue;
    }
    if (ch === '<') {
      endWord();
      if (next === '<' && src[i + 2] === '<') {
        i += 3;
        continue;
      }
      if (next === '<' || next === '(') {
        opaque = true;
        i += 2;
        continue;
      }
      if (next === '>') {
        // `<>` opens for writing too.
        i += 2;
        redirect = true;
        continue;
      }
      i++;
      continue;
    }
    if (ch === '*' || ch === '?' || ch === '[') expands = globbed = true;
    if (ch === '{' && inWord) expands = true;
    // A brace pair expands at the start of a word too (`{a,CLAUDE.md}`); a lone `{` is a group.
    if (ch === '{') globbed = true;
    add(ch);
    i++;
  }
  endCommand(src.length);
  return { commands, opaque, arith };
}

/** Options of the wrappers a command word may hide behind: letters without a value, letters with one. */
const WRAPPERS: Record<string, { flags: string; values: string }> = {
  sudo: { flags: 'EHnSsibkKvPAB', values: 'ughpCrtUDRT' },
  doas: { flags: 'nsL', values: 'uC' },
  env: { flags: 'i0v', values: 'uC' },
  command: { flags: 'pvV', values: '' },
  builtin: { flags: '', values: '' },
  exec: { flags: 'cl', values: 'a' },
  nice: { flags: '0123456789', values: 'n' },
  nohup: { flags: '', values: '' },
  time: { flags: 'plv', values: 'fo' },
  timeout: { flags: 'v', values: 'sk' },
  xargs: { flags: '0rtpxoe', values: 'IinPdELlsaJ' },
  stdbuf: { flags: '', values: 'ioe' },
  ionice: { flags: 't', values: 'cnp' },
  setsid: { flags: 'cfw', values: '' },
  watch: { flags: 'bceg', values: 'nd' },
};
/** Package runners and the subcommand that makes them run another command (none: the runner itself). */
const RUNNERS: Record<string, string[]> = {
  npx: [],
  pnpx: [],
  bunx: [],
  pnpm: ['exec', 'dlx'],
  npm: ['exec', 'x'],
  yarn: ['exec', 'dlx'],
  bun: ['x'],
};
/** Words of the shell that come before a command. */
const KEYWORDS = new Set([
  'then',
  'else',
  'elif',
  'do',
  'if',
  'while',
  'until',
  '!',
  '{',
  '}',
  'fi',
  'done',
  'esac',
]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*\+?=/;

interface Parsed {
  /** The command word, lower case, without its path; `?` when a wrapper's options could not be followed. */
  cmd: string;
  args: Word[];
  xargs: boolean;
  /** Variables set for this command only (`PAGER=… git log`, `env LESSOPEN=… less`). */
  assigns: string[];
}

/** The command a simple command runs, after assignments, keywords and wrappers (`sudo`, `env`, `xargs`…). */
function parseCommand(words: readonly Word[]): Parsed {
  let i = 0;
  let xargs = false;
  const assigns: string[] = [];
  const name = (t: string) => t.slice(0, t.indexOf('=')).replace(/\+$/, '');
  for (;;) {
    const w = words[i];
    if (!w) return { cmd: '', args: [], xargs, assigns };
    const bare = w.text.replace(/^\\/, '');
    const wrapper = WRAPPERS[bare.toLowerCase()];
    if (ASSIGNMENT.test(w.text) || KEYWORDS.has(w.text)) {
      if (ASSIGNMENT.test(w.text)) assigns.push(name(w.text));
      i++;
      continue;
    }
    if (!wrapper) {
      const cmd = (bare.split(/[/\\]/).pop() ?? bare).toLowerCase().replace(/\.exe$/, '');
      const run = RUNNERS[cmd];
      if (run) {
        // A package runner: the command it runs is the one judged (review of 25/10, C-20, C-22).
        let j = i + 1;
        if (run.length > 0) {
          if (!run.includes(words[j]?.text ?? '')) {
            return { cmd, args: words.slice(i + 1), xargs, assigns };
          }
          j++;
        }
        for (let w2 = words[j]; w2; w2 = words[j]) {
          const t = w2.text;
          if (t === '--') {
            j++;
            break;
          }
          if (!t.startsWith('-')) break;
          if (/^(?:-p|--package)$/.test(t)) j++;
          else if (
            !/^(?:-y|--yes|-q|--quiet|-s|--silent|--no-install|--prefer-offline|--package=.*)$/.test(
              t,
            )
          ) {
            // An option it cannot follow (`npx -c '…'` runs a shell string): as code run inline.
            return { cmd: 'eval', args: [], xargs, assigns };
          }
          j++;
        }
        if (j >= words.length) return { cmd, args: words.slice(i + 1), xargs, assigns };
        i = j;
        continue;
      }
      return { cmd, args: words.slice(i + 1), xargs, assigns };
    }
    if (bare.toLowerCase() === 'xargs') xargs = true;
    const wrapperName = bare.toLowerCase();
    i++;
    // The wrapper's own options; one that cannot be read leaves the command unknown.
    for (let w2 = words[i]; w2; w2 = words[i]) {
      const t = w2.text;
      if (t === '--') {
        i++;
        break;
      }
      if (ASSIGNMENT.test(t) && wrapperName === 'env') {
        assigns.push(name(t));
        i++;
        continue;
      }
      if (wrapperName === 'timeout' && /^[\d.]+[smhd]?$/.test(t)) {
        i++;
        continue;
      }
      if (!t.startsWith('-') || t === '-') break;
      i++;
      if (t.startsWith('--')) {
        if (!t.includes('=')) return { cmd: '?', args: [], xargs, assigns };
        continue;
      }
      for (let k = 1; k < t.length; k++) {
        const letter = t[k]!;
        if (wrapper.flags.includes(letter)) continue;
        if (!wrapper.values.includes(letter)) return { cmd: '?', args: [], xargs, assigns };
        if (k === t.length - 1) i++;
        break;
      }
    }
  }
}

/** Commands that only read, whatever their arguments, for the config files they name. */
const PLAIN_READ = new Set([
  'cat',
  'tac',
  'nl',
  'head',
  'tail',
  'less',
  'more',
  'most',
  'bat',
  'batcat',
  'view',
  'zcat',
  'bzcat',
  'xzcat',
  'zless',
  'zgrep',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'ag',
  'ack',
  'ls',
  'll',
  'la',
  'dir',
  'vdir',
  'exa',
  'eza',
  'lsd',
  'tree',
  'du',
  'df',
  'stat',
  'file',
  'wc',
  'diff',
  'cmp',
  'comm',
  'diff3',
  'od',
  'hexdump',
  'strings',
  'md5sum',
  'sha1sum',
  'sha256sum',
  'sha512sum',
  'shasum',
  'b2sum',
  'cksum',
  'sum',
  'cut',
  'tr',
  'rev',
  'fold',
  'fmt',
  'column',
  'expand',
  'unexpand',
  'paste',
  'join',
  'jq',
  'echo',
  'printf',
  'test',
  '[',
  '[[',
  'true',
  'false',
  ':',
  'pwd',
  'date',
  'whoami',
  'id',
  'uname',
  'which',
  'whereis',
  'type',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'namei',
  'lsattr',
  'getfacl',
  'locate',
  'sleep',
  'seq',
  'export',
  'unset',
  'local',
  'declare',
  'typeset',
  'readonly',
  'wait',
  'exit',
  'return',
  'get-content',
  'gc',
  'select-string',
  'sls',
  'get-childitem',
  'gci',
  'test-path',
  'get-item',
  'get-itemproperty',
  'measure-object',
  'get-filehash',
  'findstr',
  'sort',
  'uniq',
  'sed',
  'gsed',
  'awk',
  'gawk',
  'mawk',
  'find',
  'fd',
  'fdfind',
  'git',
  'xxd',
  'yq',
  'prettier',
  'eslint',
  'markdownlint',
  'for',
  'select',
  'case',
]);
/** Commands that change directory: later commands may then write the configuration without naming it. */
const CHDIR = new Set(['cd', 'pushd', 'popd', 'chdir', 'set-location', 'sl']);
/** Read-only subcommands of git (it also reads the files of the working tree for `add` and `commit`). */
const GIT_READ = new Set([
  'diff',
  'log',
  'show',
  'status',
  'blame',
  'ls-files',
  'grep',
  'rev-parse',
  'rev-list',
  'shortlog',
  'describe',
  'cat-file',
  'ls-tree',
  'show-ref',
  'whatchanged',
  'merge-base',
  'count-objects',
  'ls-remote',
  'add',
  'commit',
  'tag',
  'push',
  'fetch',
  'remote',
  'branch',
  'diff-tree',
  'diff-files',
  'diff-index',
]);
/** Options of git that come before the subcommand, with the ones that take a value. */
const GIT_GLOBAL_VALUE = new Set(['-C', '--git-dir', '--work-tree', '--namespace']);
/**
 * Variables a read command may be given without becoming a writer: locale, time zone, colours. Any
 * other (`PAGER`, `GIT_PAGER`, `GIT_EXTERNAL_DIFF`, `LESSOPEN`, `RIPGREP_CONFIG_PATH`…) can make a
 * reader run a command of the model's choosing.
 */
/** Builtins that set variables for the commands after them. */
const EXPORTS = new Set(['export', 'declare', 'typeset', 'readonly', 'local', 'set']);
const HARMLESS_VARS =
  /^(?:LC_\w+|LANG|LANGUAGE|TZ|NO_COLOR|CLICOLOR|CLICOLOR_FORCE|COLUMNS|LINES|TERM)$/;
const INTERPRETERS =
  /^(?:node|nodejs|deno|bun|tsx|ts-node|esno|python[\d.]*|pypy[\d.]*|ruby|perl|php[\d.]*|lua|tclsh|osascript|rscript|r|julia|elixir|groovy|pwsh|powershell|cmd|bash|sh|zsh|dash|ksh|fish|eval|source|\.)$/;
const SHELL_EVAL = new Set(['eval', 'source', '.']);
/**
 * Options that run the code that follows (`-e`, `-c`, `-p`, `php -r`, `-B`/`-R`/`-E`/`-F` of php, `-`
 * for the input, `--eval=…`): review of 25/10, C-20.
 */
const INLINE_FLAG = /^(?:-|--(?:eval|command|print|expr|exec)(?:=.*)?|-[a-zA-Z]*[ecEpxrRBF])$/;
/** PowerShell and cmd take their options in any case and abbreviated (`-Command`, `-c`, `-enc`, `/c`). */
const WINDOWS_INLINE = /^[-/](?:c|com\w*|e|ec|enc\w*|k|r)$/i;
/** Subcommands that run the code that follows: `deno eval "…"`. */
const INLINE_SUBCOMMAND = new Set(['eval']);
const VERSION_FLAG = /^(?:-v|-V|--version|-h|--help)$/;

const argText = (args: readonly Word[]) => args.map((a) => a.text);
const positional = (args: readonly Word[]) =>
  argText(args).filter((a) => !a.startsWith('-') || a === '-');

/** The scripts of a `sed` command: its `-e`/`--expression` values, or its first argument. */
function sedScripts(a: readonly string[]): string[] {
  const scripts: string[] = [];
  let first: string | undefined;
  for (let i = 0; i < a.length; i++) {
    const t = a[i]!;
    const glued = /^-[a-zA-Z]*?e(.+)$/.exec(t);
    if (t === '--') {
      first ??= a[i + 1];
      break;
    }
    if (t.startsWith('--expression=')) scripts.push(t.slice(13));
    else if (t === '--expression' || /^-[a-zA-Z]*e$/.test(t)) scripts.push(a[++i] ?? '');
    else if (glued && !t.startsWith('--')) scripts.push(glued[1]!);
    else if (t === '-l' || t === '--line-length') i++;
    else if (!t.startsWith('-') || t === '-') first ??= t;
  }
  if (scripts.length === 0 && first !== undefined) scripts.push(first);
  return scripts;
}

/**
 * Does a `sed` script write a file or run a command? The commands `w`, `W` and `e`, and the `w`/`e`
 * flags of `s`, with a space before the file or not (`1wCLAUDE.md`, review of 25/10, C-18), while
 * `/web/p` only prints. A script it cannot read counts as one that writes.
 */
function sedWrites(script: string): boolean {
  const n = script.length;
  let i = 0;
  const space = () => {
    while (i < n && /[ \t]/.test(script[i]!)) i++;
  };
  /** Past the closing `delim` of a regular expression or a replacement. */
  const until = (delim: string): boolean => {
    while (i < n) {
      const c = script[i++]!;
      if (c === '\\') i++;
      else if (c === delim) return true;
      else if (c === '\n') return false;
    }
    return false;
  };
  const toLineEnd = () => {
    while (i < n && script[i] !== '\n') i += script[i] === '\\' ? 2 : 1;
  };
  const address = (): boolean => {
    const c = script[i];
    if (c === undefined) return true;
    if (/[\d+~]/.test(c)) {
      while (i < n && /[\d+~]/.test(script[i]!)) i++;
    } else if (c === '$') i++;
    else if (c === '/' || c === '\\') {
      const delim = c === '/' ? '/' : script[i + 1];
      if (delim === undefined || delim === '\n') return false;
      i += c === '/' ? 1 : 2;
      if (!until(delim)) return false;
      while (i < n && /[IM]/.test(script[i]!)) i++;
    }
    return true;
  };
  while (i < n) {
    while (i < n && /[\s;}]/.test(script[i]!)) i++;
    if (i >= n) break;
    if (!address()) return true;
    space();
    if (script[i] === ',') {
      i++;
      space();
      if (!address()) return true;
      space();
    }
    if (script[i] === '!') {
      i++;
      space();
    }
    const cmd = script[i++];
    if (cmd === undefined) return true;
    if ('wWe'.includes(cmd)) return true;
    if (cmd === 's' || cmd === 'y') {
      const delim = script[i++];
      if (
        delim === undefined ||
        delim === '\\' ||
        delim === '\n' ||
        !until(delim) ||
        !until(delim)
      ) {
        return true;
      }
      if (cmd === 's') {
        for (; i < n && !/[;\n}]/.test(script[i]!); i++) if ('we'.includes(script[i]!)) return true;
      }
    } else if ('aicrRbtT:'.includes(cmd)) {
      // Text, a file to read or a label: to the end of the line (`b`, `t`, `:` also to a `;`).
      if ('btT:'.includes(cmd)) while (i < n && !/[;\n]/.test(script[i]!)) i++;
      else toLineEnd();
    } else if ('qQlL'.includes(cmd)) {
      space();
      while (i < n && /\d/.test(script[i]!)) i++;
    } else if (!'{pPdDnNgGhHx=zF'.includes(cmd)) return true;
  }
  return false;
}

/** gawk's and mawk's options that change nothing outside (`-S` is gawk's sandbox). */
const AWK_HARMLESS =
  /^(?:-[bcCgMNOPrsStV]+|--(?:posix|traditional|re-interval|characters-as-bytes|sandbox|version|help|bignum|use-lc-numeric|non-decimal-data|optimize|no-optimize|lint(?:=\w+)?))$/;

/**
 * Does an `awk` command only read? Its programs must not run commands (`system`, `getline`, a pipe)
 * nor print into a file (`print > "f"`): `awk '$1 > 3'` and `-F'|'` are reads (review of 25/10, C-22).
 */
function awkReads(a: readonly string[]): boolean {
  const programs: string[] = [];
  let first: string | undefined;
  for (let i = 0; i < a.length; i++) {
    const t = a[i]!;
    if (t === '--') {
      first ??= a[i + 1];
      break;
    }
    if (/^-[Fv]$|^--(?:field-separator|assign)$/.test(t)) i++;
    else if (/^-[Fv].|^--(?:field-separator|assign)=/.test(t)) continue;
    else if (t === '-e' || t === '--source') programs.push(a[++i] ?? '');
    else if (t.startsWith('--source=')) programs.push(t.slice(9));
    else if (t.startsWith('-') && t !== '-') {
      // A program from a file, an extension, a profile or a dump written somewhere: not a read.
      if (!AWK_HARMLESS.test(t)) return false;
    } else first ??= t;
  }
  if (programs.length === 0) {
    if (first === undefined) return false;
    programs.push(first);
  }
  return programs.every((p) => {
    if (/\b(?:system|getline)\b|@(?:load|include)|\|&/.test(p)) return false;
    // In a print statement `>` and `|` send it into a file or a command.
    return p.split(/[;{}\n]/).every((statement) => {
      const at = statement.search(/\bprintf?\b/);
      return at === -1 || !/[>|]/.test(statement.slice(at));
    });
  });
}

/** Is this command, with these arguments, one that cannot write a file by itself? */
function readsOnly(cmd: string, args: readonly Word[]): boolean {
  if (!PLAIN_READ.has(cmd)) return false;
  const a = argText(args);
  const has = (re: RegExp) => a.some((x) => re.test(x));
  switch (cmd) {
    case 'sed':
    case 'gsed':
      // In place, a script from a file, or a script that writes (`w`) or runs (`e`) something.
      return !has(/^--in-place|^--file|^-[a-zA-Z]*[if]/) && !sedScripts(a).some(sedWrites);
    case 'awk':
    case 'gawk':
    case 'mawk':
      return awkReads(a);
    case 'find':
      return !has(/^-(?:delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)$/);
    case 'fd':
    case 'fdfind':
      // `-x rm`, and glued to it or to other flags (`-xrm`, `-HIx`).
      return !has(/^-[a-zA-Z]*[xX]|^--exec/);
    case 'sort':
      return !has(/^-[a-zA-Z]*o|^--output/);
    case 'uniq':
      return positional(args).length <= 1;
    case 'less':
    case 'more':
    case 'most':
      return !has(/^-[oO]|^--log-file|^--LOG-FILE/i);
    case 'rg':
      return !has(/^--pre/);
    case 'tree':
      return !has(/^-[a-zA-Z]*o|^--output/);
    case 'xxd':
      return !has(/^-[a-zA-Z]*r/) && positional(args).length <= 1;
    case 'yq':
      // In place, or split into files.
      return !has(/^-[a-zA-Z]*[is]|^--in-?place|^--split-exp/);
    case 'prettier':
      // Writing, a cache of its own, or code it loads (a plugin, a JavaScript config).
      return !has(/^(?:--write|-w)$|^--(?:cache-location|plugin|config)/);
    case 'eslint':
      return !has(/^--fix|^(?:-o|-c)$|^--(?:output-file|cache-location|config|rulesdir)/);
    case 'markdownlint':
      return !has(/^(?:--fix|-f|-o|-r)$|^--(?:output|rules)/);
    case 'git': {
      for (let i = 0; i < a.length; i++) {
        const t = a[i]!;
        // `-c core.pager=…`, `--config-env`, `--exec-path=` choose programs git runs: never a plain read.
        if (t === '-c' || /^--(?:config-env|exec-path)/.test(t)) return false;
        if (!t.startsWith('-')) {
          if (!GIT_READ.has(t) || has(/^--output|^--ext-diff$/)) return false;
          // `git grep -O<cmd>` opens the matches with a program of its choosing.
          return t !== 'grep' || !has(/^-O|^--open-files-in-pager/);
        }
        if (GIT_GLOBAL_VALUE.has(t)) i++;
      }
      return false;
    }
    default:
      return true;
  }
}

/** Is any of these words the name of a configuration, or a word the shell has still to expand? */
const anyNames = (words: readonly Word[]) => words.some(wordNames);
const anyExpands = (words: readonly Word[]) => words.some((w) => w.expands);

/** The last part of a path, without the slashes at its end. */
const baseName = (path: string) =>
  path
    .replace(/[/\\]+$/, '')
    .split(/[/\\]/)
    .pop() ?? '';
/** Is the last part of this word a configuration name (`../template/CLAUDE.md`, `~/t/.claude`, `*.md`)? */
const baseNames = (w: Word): boolean =>
  wordNames({ text: baseName(w.text), expands: false }) ||
  (w.bash !== undefined && namesConfig(baseName(w.bash))) ||
  (w.glob !== undefined && globNames(baseName(w.glob)));
/** A destination that is a folder for sure: `.`, `..`, `~`, `$HOME`, a path that ends in a slash. */
const FOLDER = /^(?:\.{1,2}|~|\$HOME|\$\{HOME\})$|[/\\]\.{0,2}$/;
/** A destination with no extension may be a folder that exists: `cp CLAUDE.md sub`. */
const MAYBE_FOLDER = (path: string) => !/\.[^./\\]+$/.test(baseName(path));
/** A folder clearly outside any workspace: the temporary ones. */
const TEMP_FOLDER = /^(?:\/tmp|\/var\/tmp|\/private\/tmp|\$TMPDIR|\$\{TMPDIR\})(?:[/\\]|$)/;

/**
 * `cp` and `rsync` write only their last argument: copying a configuration file out is a read. Copied
 * into a folder (`cp ../template/CLAUDE.md .`, `rsync -a t/.claude ./`, `cp -t dir CLAUDE.md`) it lands
 * there under its own name, a write like `mv` (review of 25/10, C-17), unless the folder is a
 * temporary one.
 */
function copyWritesConfig(cmd: string, args: readonly Word[]): boolean | null {
  const flags = cmd === 'cp' ? 'arRfinpvudPHLxbT' : 'avzrtpogDnhPuiHLWcxqS';
  const rest: Word[] = [];
  let target: Word | undefined;
  for (let i = 0; i < args.length; i++) {
    const w = args[i]!;
    const t = w.text;
    if (t === '--') {
      rest.push(...args.slice(i + 1));
      break;
    }
    if (cmd === 'cp' && (t === '-t' || t.startsWith('--target-directory='))) {
      target = t === '-t' ? args[++i] : { text: t.split('=')[1] ?? '', expands: w.expands };
      if (!target) return null;
      continue;
    }
    if (t.startsWith('--')) {
      if (
        /^--(?:recursive|force|interactive|no-clobber|verbose|update|archive|preserve(?:=[\w,]+)?|dereference|no-dereference|dry-run|progress|human-readable)$/.test(
          t,
        )
      )
        continue;
      return null;
    }
    if (t.startsWith('-') && t.length > 1) {
      if (![...t.slice(1)].every((l) => flags.includes(l))) return null;
      continue;
    }
    rest.push(w);
  }
  const dest = target ?? rest[rest.length - 1];
  if (!dest || (!target && rest.length < 2)) return null;
  if (wordNames(dest) || dest.expands) return true;
  const sources = target ? rest : rest.slice(0, -1);
  const folder =
    target !== undefined ||
    sources.length > 1 ||
    FOLDER.test(dest.text) ||
    MAYBE_FOLDER(dest.bash ?? dest.text);
  return folder && !TEMP_FOLDER.test(dest.text) && sources.some(baseNames);
}

/** `tar` writes the configuration when it extracts, deletes, appends, or when the archive is the configuration. */
function tarWritesConfig(args: readonly Word[]): boolean {
  const a = argText(args);
  const first = a[0] ?? '';
  const letters = first.startsWith('--') ? '' : first.replace(/^-/, '');
  const long = a.filter((x) => x.startsWith('--'));
  const writes =
    /[xrAu]/.test(letters) ||
    long.some((x) =>
      /^--(?:extract|get|delete|append|update|concatenate|remove-files|overwrite|to-command)/.test(
        x,
      ),
    );
  const mode =
    /[ctd]/.test(letters) || long.some((x) => /^--(?:create|list|diff|compare)$/.test(x));
  // Not a mode it knows: extracting is the safe guess.
  if (writes || !mode) return true;
  // The archive: `-f x`, `czf x`, `--file x`, `--file=x`.
  let archive: string | undefined;
  a.forEach((x, k) => {
    if (x.startsWith('--file=')) archive = x.slice(7);
    else if (x === '--file') archive = a[k + 1];
    else if (/^-?[a-zA-Z]*f$/.test(x) && (x.startsWith('-') || k === 0)) archive = a[k + 1];
    else if (/^-f./.test(x)) archive = x.slice(2);
  });
  return archive === undefined || namesConfig(archive) || /[$`*?]/.test(archive);
}

/** `dd` writes where `of=` says, and to stdout without it. */
function ddWritesConfig(args: readonly Word[]): boolean | null {
  if (!args.every((w) => /^\w+=/.test(w.text))) return null;
  return args.some((w) => w.text.startsWith('of=') && (wordNames(w) || w.expands));
}

/** Is position `at` of the line outside any quote? */
function outsideQuotes(line: string, at: number): boolean {
  let quote = '';
  for (let i = 0; i < at; i++) {
    const c = line[i]!;
    if (quote === "'") {
      if (c === "'") quote = '';
    } else if (c === '\\') i++;
    else if (quote === '"') {
      if (c === '"') quote = '';
    } else if (c === "'" || c === '"') quote = c;
  }
  return quote === '';
}

/**
 * `git commit -m "$(cat <<'EOF' … EOF\n)"`, the commit format Claude Code is told to use: a here-document
 * with a quoted delimiter expands nothing and `cat` prints it, so inside double quotes it is the text it
 * holds, and it is read as that text (review of 25/10, C-22). A body with a line that would end the
 * here-document before (a second `EOF`) stays opaque; at most eight are followed.
 */
function inlineQuotedHeredocs(line: string): string {
  const head = /"\$\(\s*cat\s+<<(-?)\s*(['"])(\w+)\2[ \t]*\n/g;
  let out = '';
  let last = 0;
  for (let n = 0, m = head.exec(line); m && n < 8; n++, m = head.exec(line)) {
    if (!outsideQuotes(line, m.index)) continue;
    const [, dash, , delim] = m as unknown as [string, string, string, string];
    const tabs = dash ? '\\t*' : '';
    const tail = new RegExp(`\\n${tabs}${delim}\\n[ \\t]*\\)"`, 'g');
    tail.lastIndex = head.lastIndex - 1;
    const end = tail.exec(line);
    if (!end) continue;
    const body = line.slice(head.lastIndex, end.index);
    if (body.split('\n').some((l) => (dash ? l.replace(/^\t+/, '') : l) === delim)) continue;
    out += `${line.slice(last, m.index)}"${body.replace(/[\\"$`]/g, '\\$&')}"`;
    last = end.index + end[0].length;
    head.lastIndex = last;
  }
  return out + line.slice(last);
}

/** Does a Bash command line write the harness configuration? */
export function commandWritesConfig(raw: string): boolean {
  const line = inlineQuotedHeredocs(raw.replace(NO_FILE_REDIRECT, ' '));
  const lexed = lex(line);
  const { commands } = lexed;
  // `$((x))` evaluates what `x` holds, and a value may spell a substitution: one on the line, opaque.
  const opaque = lexed.opaque || (lexed.arith && /\$\((?!\()|`/.test(line));
  const lineNames =
    CONFIG_WORD.test(line) || commands.some((c) => anyNames(c.words) || anyNames(c.targets));
  if (!lineNames) return false;
  if (opaque) return true;
  let moved = false;
  // A variable set earlier in the line (`export GIT_EXTERNAL_DIFF=…; git diff CLAUDE.md`) reaches later readers.
  let tainted = false;
  for (const c of commands) {
    // Redirected into the configuration, or into something that may be it.
    if (c.targets.some((t) => moved || wordNames(t) || t.expands)) return true;
    const { cmd, args, xargs, assigns } = parseCommand(c.words);
    const unsafe = (v: string) => !HARMLESS_VARS.test(v);
    if (!cmd) {
      if (assigns.some(unsafe)) tainted = true;
      continue;
    }
    if (
      EXPORTS.has(cmd) &&
      args.some((w) => ASSIGNMENT.test(w.text) && unsafe(w.text.split(/\+?=/)[0]!))
    )
      tainted = true;
    const names = CONFIG_WORD.test(c.raw) || anyNames(c.words);
    const expands = anyExpands(c.words);
    if (CHDIR.has(cmd)) {
      if (names || (expands && lineNames)) moved = true;
      continue;
    }
    if (INTERPRETERS.test(cmd)) {
      const a = argText(args);
      // `node -v` in a configuration folder runs nothing of it (review of 25/10, C-22).
      const onlyVersion = a.length > 0 && a.every((x) => VERSION_FLAG.test(x));
      if (names || (moved && !onlyVersion)) return true;
      const version = a.some((x) => VERSION_FLAG.test(x));
      const windows = cmd === 'pwsh' || cmd === 'powershell' || cmd === 'cmd';
      const inline =
        SHELL_EVAL.has(cmd) ||
        a.some((x) => INLINE_FLAG.test(x) || (windows && WINDOWS_INLINE.test(x))) ||
        INLINE_SUBCOMMAND.has(positional(args)[0] ?? '');
      const stdin = c.piped && !version && positional(args).length === 0;
      if (inline || stdin) return true;
      continue;
    }
    if (!tainted && !assigns.some(unsafe) && readsOnly(cmd, args)) continue;
    if (!xargs && (cmd === 'cp' || cmd === 'rsync')) {
      const verdict = copyWritesConfig(cmd, args);
      if (verdict !== null) {
        if (verdict || moved) return true;
        continue;
      }
    } else if (!xargs && cmd === 'tar') {
      if ((names || expands) && tarWritesConfig(args)) return true;
      if (moved) return true;
      continue;
    } else if (!xargs && cmd === 'dd') {
      const verdict = ddWritesConfig(args);
      if (verdict !== null) {
        if (verdict || moved) return true;
        continue;
      }
    }
    // Any other command: it writes if it names the configuration, runs in its folder, or may reach it
    // through a word the shell expands, a list on its input or a search that runs commands.
    if (names || moved) return true;
    if (expands || xargs || cmd === 'find' || cmd === 'fd' || cmd === 'fdfind') return true;
  }
  return false;
}
