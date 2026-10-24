/*
 * Does a shell command line write the harness configuration (CLAUDE.md, AGENTS.md, `.claude`, …)?
 *
 * A speed bump in front of Claude Code's Bash (D-079, D-166). The line is cut into the commands the shell
 * would run (`;`, `&&`, `||`, `|`, newlines, groups) and each one is judged on its own: a command writes the
 * configuration when it redirects into it, when it is not a known read-only command and it names the
 * configuration, or when it runs code inline (`node -e`, `bash -c`, `eval`) on a line that names it. Reading
 * (`cat`, `ls`, `du`, `grep`, `git diff`, …) passes whatever else is on the line. What the parser cannot
 * follow (`$(…)`, backticks, here-documents, process substitution) keeps blocking when a name is present:
 * when in doubt, block.
 */

/** Names of the harness configuration inside a command line (a word, any path before it). */
const CONFIG_WORD =
  /(?:^|[\s'"`=;|&(<>/\\])(?:\.claude(?:[/\\]|\b)|\.mcp\.json\b|CLAUDE(?:\.local)?\.md\b|AGENTS(?:\.override)?\.md\b|\.codex(?:[/\\]|\b))/i;

/**
 * Redirections that write no file (`2>&1`, `>&2`, `>/dev/null`, `2> NUL`): a read of
 * CLAUDE.md with `2>&1` elsewhere in the line was refused as a write (22/10/2026).
 */
const NO_FILE_REDIRECT = /(?:\d*|&)>>?\s*(?:&\d+|&-|\/dev\/null|NUL|\$null)(?=[\s;&|)]|$)/gi;

const namesConfig = (text: string): boolean => CONFIG_WORD.test(` ${text}`);

interface Word {
  text: string;
  /** Unquoted or double-quoted `$name`, `${…}`, a glob or a brace: the real word is not the one written. */
  expands: boolean;
}

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

/** A small shell lexer: enough to cut the line into commands and words, quoting included. */
function lex(src: string): Lexed {
  const commands: Command[] = [];
  let words: Word[] = [];
  let targets: Word[] = [];
  let cur = '';
  let inWord = false;
  let expands = false;
  let redirect = false;
  let opaque = false;
  let start = 0;
  let piped = false;

  const endWord = () => {
    if (!inWord) return;
    const word = { text: cur, expands };
    (redirect ? targets : words).push(word);
    redirect = false;
    cur = '';
    inWord = false;
    expands = false;
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
  const add = (ch: string) => {
    cur += ch;
    inWord = true;
  };

  let i = 0;
  while (i < src.length) {
    const ch = src[i]!;
    const next = src[i + 1];
    if (ch === "'") {
      const end = src.indexOf("'", i + 1);
      const stop = end < 0 ? src.length : end;
      inWord = true;
      cur += src.slice(i + 1, stop);
      i = stop + 1;
      continue;
    }
    if (ch === '"') {
      inWord = true;
      i++;
      while (i < src.length && src[i] !== '"') {
        const c = src[i]!;
        if (c === '\\' && i + 1 < src.length && '"$`\\\n'.includes(src[i + 1]!)) {
          if (src[i + 1] !== '\n') cur += src[i + 1];
          i += 2;
          continue;
        }
        if (c === '`' || (c === '$' && src[i + 1] === '(')) opaque = true;
        else if (c === '$' && /[A-Za-z_{0-9@*#?!-]/.test(src[i + 1] ?? '')) expands = true;
        cur += c;
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
        add(next);
        i += 2;
        continue;
      }
      add(ch);
      i++;
      continue;
    }
    if (ch === '`') {
      opaque = true;
      add(ch);
      i++;
      continue;
    }
    if (ch === '$') {
      if (next === '(' || next === "'") opaque = true;
      else if (/[A-Za-z_{0-9@*#?!-]/.test(next ?? '')) expands = true;
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
    if (ch === '*' || ch === '?' || ch === '[') expands = true;
    if (ch === '{' && inWord) expands = true;
    add(ch);
    i++;
  }
  endCommand(src.length);
  return { commands, opaque };
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
  /^(?:node|nodejs|deno|bun|python[\d.]*|pypy[\d.]*|ruby|perl|php|lua|tclsh|osascript|pwsh|powershell|bash|sh|zsh|dash|ksh|fish|eval|source|\.)$/;
const SHELL_EVAL = new Set(['eval', 'source', '.']);

const argText = (args: readonly Word[]) => args.map((a) => a.text);
const positional = (args: readonly Word[]) =>
  argText(args).filter((a) => !a.startsWith('-') || a === '-');

/** Is this command, with these arguments, one that cannot write a file by itself? */
function readsOnly(cmd: string, args: readonly Word[]): boolean {
  if (!PLAIN_READ.has(cmd)) return false;
  const a = argText(args);
  const has = (re: RegExp) => a.some((x) => re.test(x));
  switch (cmd) {
    case 'sed':
    case 'gsed':
      // In place, or a script that writes (`w`) or runs (`e`) something.
      return (
        !has(/^--in-place|^--file|^-[a-zA-Z]*[if]/) &&
        !has(/(?:^|[;{}\s\d$/])[we]\s+\S|\/[a-zA-Z]*[we](?:\s|$)/)
      );
    case 'awk':
    case 'gawk':
    case 'mawk':
      return !has(/[>|]|system|getline|^-i/);
    case 'find':
      return !has(/^-(?:delete|exec|execdir|ok|okdir|fprint0?|fprintf|fls)$/);
    case 'fd':
    case 'fdfind':
      return !has(/^(?:-x|-X|--exec|--exec-batch)$/);
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
      return !has(/^-[a-zA-Z]*i|^--inplace/);
    case 'prettier':
      return !has(/^(?:--write|-w)$/);
    case 'eslint':
      return !has(/^--fix/);
    case 'markdownlint':
      return !has(/^(?:--fix|-f)$/);
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
const anyNames = (words: readonly Word[]) => words.some((w) => namesConfig(w.text));
const anyExpands = (words: readonly Word[]) => words.some((w) => w.expands);

/** `cp` and `rsync` write only their last argument: copying a configuration file out is a read. */
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
  return namesConfig(dest.text) || dest.expands;
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
  return args.some((w) => w.text.startsWith('of=') && (namesConfig(w.text) || w.expands));
}

/** Does a Bash command line write the harness configuration? */
export function commandWritesConfig(raw: string): boolean {
  const line = raw.replace(NO_FILE_REDIRECT, ' ');
  const { commands, opaque } = lex(line);
  const lineNames =
    CONFIG_WORD.test(line) || commands.some((c) => anyNames(c.words) || anyNames(c.targets));
  if (!lineNames) return false;
  if (opaque) return true;
  let moved = false;
  // A variable set earlier in the line (`export GIT_EXTERNAL_DIFF=…; git diff CLAUDE.md`) reaches later readers.
  let tainted = false;
  for (const c of commands) {
    // Redirected into the configuration, or into something that may be it.
    if (c.targets.some((t) => moved || namesConfig(t.text) || t.expands)) return true;
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
      if (names || moved) return true;
      const a = argText(args);
      const version = a.some((x) => /^(?:-v|-V|--version|-h|--help)$/.test(x));
      const inline =
        SHELL_EVAL.has(cmd) ||
        a.some((x) => /^(?:-|--eval|--command|--print|-[a-zA-Z]*[ecEpx])$/.test(x));
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
