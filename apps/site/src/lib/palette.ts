/*
 * The command palette of the page (`/` or Ctrl+K): a one-line shell. Pure parsing and
 * dispatch, no DOM: the browser part (src/client/palette.ts) prints the lines and performs the
 * action. A leading `monsters` is accepted, so the real CLI verbs work as typed in a terminal
 * (`monsters kill`).
 */

export type PaletteLang = 'en' | 'it';

export type PaletteAction =
  | { kind: 'goto'; target: string }
  | { kind: 'download' }
  | { kind: 'open'; url: string }
  | { kind: 'kill' }
  | { kind: 'resume' }
  | { kind: 'summon'; name: string }
  | { kind: 'invaders' }
  | { kind: 'lang'; lang: PaletteLang }
  | { kind: 'clear' }
  | { kind: 'exit' };

export interface PaletteStrings {
  /** One description per command, keyed by name. */
  desc: Record<string, string>;
  /** `{cmd}` is the word typed. */
  unknown: string;
  usage: string;
  download: string;
  star: string;
  killed: string;
  alreadyKilled: string;
  resumed: string;
  notKilled: string;
  squad: string;
  summoning: string;
  invaders: string;
  lang: string;
  sudo: string;
  man: string;
}

export interface PaletteContext {
  killed: boolean;
  repo: string;
  /** The monsters of the squad, orchestrator first. */
  roster: readonly string[];
}

export interface PaletteResult {
  out: string[];
  action?: PaletteAction;
  error?: boolean;
}

/** The commands, in help order, with their usage line. */
export const COMMANDS: readonly { name: string; usage: string }[] = [
  { name: 'help', usage: 'help' },
  { name: 'download', usage: 'download' },
  { name: 'star', usage: 'star' },
  { name: 'kill', usage: 'kill' },
  { name: 'resume', usage: 'resume' },
  { name: 'squad', usage: 'squad' },
  { name: 'summon', usage: 'summon <name>' },
  { name: 'invaders', usage: 'invaders' },
  { name: 'man', usage: 'man monsters' },
  { name: 'lang', usage: 'lang <en|it>' },
  { name: 'clear', usage: 'clear' },
  { name: 'exit', usage: 'exit' },
];

const ALIASES: Record<string, string> = {
  '?': 'help',
  h: 'help',
  stop: 'kill',
  '/stop': 'kill',
  cls: 'clear',
  q: 'exit',
  quit: 'exit',
  ls: 'squad',
  hatch: 'summon',
};

const fill = (template: string, values: Record<string, string>): string =>
  template.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);

/** Splits a line into words; single or double quotes keep spaces together. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out.push(m[1] ?? m[2] ?? m[3] ?? '');
  return out;
}

/** Command names that start with what was typed (Tab completion). */
export function complete(prefix: string): string[] {
  const p = prefix
    .trim()
    .toLowerCase()
    .replace(/^monsters\s+/, '');
  if (!p || /\s/.test(p)) return [];
  return COMMANDS.map((c) => c.name).filter((n) => n.startsWith(p));
}

export function runCommand(line: string, s: PaletteStrings, ctx: PaletteContext): PaletteResult {
  let words = tokenize(line.trim());
  if (words[0]?.toLowerCase() === 'monsters' && words.length > 1) words = words.slice(1);
  const typed = words[0] ?? '';
  if (!typed) return { out: [] };
  const lower = typed.toLowerCase();
  const cmd = ALIASES[lower] ?? lower;
  const args = words.slice(1);

  switch (cmd) {
    case 'help': {
      const width = Math.max(...COMMANDS.map((c) => c.usage.length)) + 2;
      return { out: COMMANDS.map((c) => c.usage.padEnd(width) + (s.desc[c.name] ?? '')) };
    }
    case 'download':
      return { out: [s.download], action: { kind: 'download' } };
    case 'star':
      return { out: [fill(s.star, { repo: ctx.repo })], action: { kind: 'open', url: ctx.repo } };
    case 'kill':
      return ctx.killed
        ? { out: [s.alreadyKilled] }
        : { out: [s.killed], action: { kind: 'kill' } };
    case 'resume':
      return ctx.killed ? { out: [s.resumed], action: { kind: 'resume' } } : { out: [s.notKilled] };
    case 'squad':
      return {
        out: [s.squad, ...ctx.roster.map((n, i) => `  ${String(i).padStart(2, '0')}  ${n}`)],
        action: { kind: 'goto', target: 'squad' },
      };
    case 'summon': {
      const name = args.join(' ').trim().slice(0, 40);
      if (!name) return { out: [fill(s.usage, { usage: 'summon <name>' })], error: true };
      return { out: [fill(s.summoning, { name })], action: { kind: 'summon', name } };
    }
    case 'invaders':
      return { out: [s.invaders], action: { kind: 'invaders' } };
    case 'man':
      return { out: [s.man], action: { kind: 'goto', target: 'faq' } };
    case 'lang': {
      const want = args[0]?.toLowerCase();
      if (want !== 'en' && want !== 'it')
        return { out: [fill(s.usage, { usage: 'lang <en|it>' })], error: true };
      return { out: [fill(s.lang, { lang: want })], action: { kind: 'lang', lang: want } };
    }
    case 'clear':
      return { out: [], action: { kind: 'clear' } };
    case 'exit':
      return { out: [], action: { kind: 'exit' } };
    case 'sudo':
      return { out: [s.sudo], error: true };
    default:
      return { out: [fill(s.unknown, { cmd: typed.slice(0, 40) })], error: true };
  }
}
