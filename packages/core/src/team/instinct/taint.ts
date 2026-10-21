import { inAnyPrivateFolder, trimUrlEnd, URL_IN_TEXT } from '@monsters/shared';
import { getDomain } from 'tldts';
import { instinctStrings } from './instinct.strings.ts';

/*
 * What may leave the computer once a run has read third-party text (D-070,
 * research 07 §5.2a). One `RunTaint` per run, shared by every agent of the
 * run (the capo squadra may read a private note and pass it in a brief).
 *
 * - The run is **tainted** from the first result of a third-party source
 *   (`web_*`, other programs and the browser): from then on an instruction
 *   hidden in that text could ask a monster to send data out.
 * - **Known hosts**: those in the user's own words and the profile, as long
 *   as no third-party text came from them. Not the memory (review of 18/10,
 *   A2: a page or a person of a group could have had a line written there),
 *   nor the results
 *   of a search nor the pages opened (D-074): a hostile page or snippet would
 *   only have to name its own site ("open evil.example/log?d=<notes>"), or
 *   the model could search for it after the taint. Their links stay known.
 * - **Known URLs**: every URL in the run's text, tool results included: a link
 *   followed as it is carries nothing the monster put in it.
 * - **Sensitive text**: the notes read in the run (private notes apart), the
 *   profile and the memory, as 6-word shingles. A payload (query, path) that
 *   repeats them is data leaving, not a search.
 *
 * It is a rule, not a model: it works with "Solo regole" and without Jev.
 */

/** Words in a row that make a piece of a note recognisable. */
const SHINGLE = 6;
/** Shorter notes match as a whole, from this many words. */
const MIN_WORDS = 3;
/** Characters of notes (not private) in one payload that make it a card, not a mark. */
export const NOTE_LEAK_CHARS = 120;
/** Characters of a result read for its links (a result of megabytes costs no more). */
const MAX_OBSERVED_CHARS = 1_000_000;

/**
 * The property of a note written by a run that had read third-party text or
 * that a person who is not the user asked for (review of 18/10, A2): its value
 * says what. A run that reads such a note (`vault_read`, or finds it with
 * `vault_search`) is tainted, as after the page itself. The user takes it
 * away from the note's properties when the text is theirs again.
 */
export const THIRD_PARTY_PROP = 'da_testo_di_terzi';

export type SensitiveKind = 'private' | 'note' | 'profile';

export interface Leak {
  kind: SensitiveKind;
  /** Characters of the payload that repeat sensitive text. */
  chars: number;
  /** The host is not one the run knows. */
  unknownHost: boolean;
}

function words(text: string): string[] {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 0);
}

/**
 * The site of a host: `m.tripadvisor.it` and `www.tripadvisor.it` are the same
 * one. The list of public suffixes (`tldts`, private domains included) keeps
 * apart the sites of different people on a shared host: `attacker.github.io`
 * is not `vitejs.github.io`, `x.vercel.app` is not `y.vercel.app` (D-074).
 */
export function siteOf(host: string): string {
  const h = host
    .toLowerCase()
    .replace(/^www\./, '')
    .replace(/\.$/, '');
  if (/^[\d.]+$/.test(h) || h.includes(':') || h.startsWith('[')) return h;
  return getDomain(h, { allowPrivateDomains: true }) ?? h;
}

const URL_RE = URL_IN_TEXT;

function hostOf(raw: string): string | null {
  try {
    return new URL(raw).hostname;
  } catch {
    return null;
  }
}

function normalUrl(raw: string): string {
  const url = trimUrlEnd(raw);
  try {
    const u = new URL(url);
    return `${u.host.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}${u.search}`;
  } catch {
    return url.toLowerCase();
  }
}

function textOf(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value) ?? '';
  } catch {
    return '';
  }
}

/** `url` fields of a structured result (search results, also as the plan's `WebSearch` nests them), not the URLs in its text. */
function resultUrls(value: unknown, depth = 0, out: string[] = []): string[] {
  if (depth > 6 || !value || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    for (const v of value) resultUrls(v, depth + 1, out);
    return out;
  }
  const o = value as Record<string, unknown>;
  if (typeof o.url === 'string') out.push(o.url);
  for (const v of Object.values(o)) resultUrls(v, depth + 1, out);
  return out;
}

/** Third-party sources: the web and other programs (the same as the injection check). */
export function isThirdPartySource(tool: string): boolean {
  return tool.startsWith('web_') || tool.startsWith('mcp__');
}

export class RunTaint {
  #tainted = false;
  #source: string | undefined;
  /**
   * Someone who is not the user asks in this run (a person of a Telegram
   * group, D-107): not third-party text, so the run is not tainted, but what
   * they ask may send the user's notes out, so the leak checks of a tainted
   * run are on.
   */
  #guarded: string | undefined;
  readonly #sites = new Set<string>();
  /** Sites a third-party text came from (pages read, search results). */
  readonly #read = new Set<string>();
  readonly #urls = new Set<string>();
  readonly #shingles: Record<SensitiveKind, Set<string>> = {
    private: new Set(),
    note: new Set(),
    profile: new Set(),
  };
  /**
   * The notes each shingle of `note` comes from ('' when no note says: a file, a result
   * without its path): a reply to a chat leaves out the notes the chat may see (D-114).
   */
  readonly #noteOrigins = new Map<string, Set<string>>();

  get tainted(): boolean {
    return this.#tainted;
  }

  /** The first third-party source of the run. */
  get source(): string | undefined {
    return this.#source;
  }

  /** The leak checks are on without third-party text (D-107): why, or undefined. */
  get guarded(): string | undefined {
    return this.#guarded;
  }

  /** Turns the leak checks on for a request that is not the user's (D-107). */
  guard(reason: string): void {
    this.#guarded ??= reason;
  }

  taint(source: string): void {
    if (this.#tainted) return;
    this.#tainted = true;
    this.#source = source;
  }

  /** A copy of what the run knows now (what a message written in this run carries, D-098). */
  clone(): RunTaint {
    const copy = new RunTaint();
    copy.absorb(this);
    return copy;
  }

  /**
   * What another run knew goes into this one (D-098): a message of the
   * orchestrator to a lead carries the orchestrator's run. Its taint, its known
   * sites (from the user's own words there) and links, its sensitive text.
   */
  absorb(other: RunTaint): void {
    if (other.#tainted) this.taint(other.#source ?? instinctStrings().otherMonsterWork);
    if (other.#guarded) this.guard(other.#guarded);
    for (const s of other.#sites) this.#sites.add(s);
    for (const s of other.#read) this.#read.add(s);
    for (const u of other.#urls) this.#urls.add(u);
    for (const kind of Object.keys(this.#shingles) as SensitiveKind[]) {
      for (const sh of other.#shingles[kind]) this.#shingles[kind].add(sh);
    }
    for (const [sh, paths] of other.#noteOrigins) {
      const mine = this.#noteOrigins.get(sh) ?? new Set<string>();
      for (const p of paths) mine.add(p);
      this.#noteOrigins.set(sh, mine);
    }
  }

  /** Text the user wrote or Monsters gave (request, profile, memory): its hosts are known. */
  known(text: string): void {
    for (const m of text.matchAll(URL_RE)) {
      this.#urls.add(normalUrl(m[0]));
      const host = hostOf(m[0]);
      if (host) this.#sites.add(siteOf(host));
    }
  }

  /** A site of the user's own words, the profile or the memory that gave no third-party text. */
  knownHost(host: string): boolean {
    const site = siteOf(host);
    return this.#sites.has(site) && !this.#read.has(site);
  }

  knownUrl(url: string): boolean {
    return this.#urls.has(normalUrl(url));
  }

  /** Text that must not leave the computer in a query: a note read, the profile, the memory. */
  sensitive(text: string, kind: SensitiveKind, path = ''): void {
    const w = words(text);
    const set = this.#shingles[kind];
    if (w.length < SHINGLE) {
      // Short texts kept whole only when private: three ordinary words match any query.
      if (w.length >= MIN_WORDS && kind === 'private') set.add(w.join(' '));
      return;
    }
    for (let i = 0; i + SHINGLE <= w.length; i++) {
      const sh = w.slice(i, i + SHINGLE).join(' ');
      set.add(sh);
      if (kind !== 'note') continue;
      const origins = this.#noteOrigins.get(sh) ?? new Set<string>();
      origins.add(path);
      this.#noteOrigins.set(sh, origins);
    }
  }

  /**
   * A tool finished: the run learns its hosts and URLs, its sensitive text,
   * and whether it is tainted now.
   */
  observe(tool: string, input: unknown, output: unknown): void {
    const i = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
    if (isThirdPartySource(tool)) {
      const text = textOf(output).slice(0, MAX_OBSERVED_CHARS);
      const opened =
        tool === 'web_fetch' || tool.endsWith('__browser_navigate')
          ? [i['url'], ...(Array.isArray(i['urls']) ? (i['urls'] as unknown[]) : [])].filter(
              (u): u is string => typeof u === 'string',
            )
          : [];
      this.taint(`${tool}${opened[0] ? ` ${opened[0]}` : ''}`);
      for (const m of text.matchAll(URL_RE)) this.#urls.add(normalUrl(m[0]));
      // The pages opened (also where they ended up) and the results of a search
      // (their snippets are text of those sites): known links, followed as they
      // are, and sites that gave third-party text, never known sites (D-074).
      const pages = (output as { pages?: unknown } | null)?.pages;
      const given = [
        ...opened,
        ...(tool === 'web_fetch'
          ? [
              (output as { url?: unknown } | null)?.url,
              ...(Array.isArray(pages)
                ? pages.map((p) => (p as { url?: unknown } | null)?.url)
                : []),
            ]
          : []),
        ...(tool === 'web_search' ? resultUrls(output) : []),
      ];
      for (const url of given) {
        if (typeof url !== 'string') continue;
        this.#urls.add(normalUrl(url));
        const host = hostOf(url);
        if (host) this.#read.add(siteOf(host));
      }
      return;
    }
    if (tool === 'vault_read' && output && typeof output === 'object') {
      const o = output as { path?: unknown; content?: unknown; frontmatter?: unknown };
      const props = (o.frontmatter ?? {}) as Record<string, unknown>;
      const path = typeof o.path === 'string' ? o.path : '';
      const isPrivate = props['private'] === true || inAnyPrivateFolder(path);
      if (typeof o.content === 'string') {
        this.sensitive(o.content, isPrivate ? 'private' : 'note', path);
      }
      if (props[THIRD_PARTY_PROP] !== undefined) {
        this.taint(instinctStrings().noteAfterThirdParty(path));
      }
      return;
    }
    if (tool === 'vault_search') {
      // Hit by hit, each with its note (a reply to a chat leaves out the chat's notes).
      if (Array.isArray(output)) {
        for (const h of output as unknown[]) {
          const p = (h as { path?: unknown } | null)?.path;
          this.sensitive(textOf(h), 'note', typeof p === 'string' ? p : '');
        }
      } else this.sensitive(textOf(output), 'note');
      const hit = Array.isArray(output)
        ? (output as unknown[]).find(
            (h) => !!h && typeof h === 'object' && (h as Record<string, unknown>)[THIRD_PARTY_PROP],
          )
        : undefined;
      if (hit) {
        const path = (hit as { path?: unknown }).path;
        this.taint(instinctStrings().noteAfterThirdParty(typeof path === 'string' ? path : ''));
      }
    }
    // A file read again (`file_read`): the user's are the user's data, like a note; one a
    // monster or a tool made carries third-party text, like the attachments of a message.
    if (tool === 'file_read' && output && typeof output === 'object') {
      const o = output as { name?: unknown; source?: unknown; text?: unknown };
      if (o.source !== 'user') this.taint(`file:${typeof o.name === 'string' ? o.name : ''}`);
      if (typeof o.text === 'string') this.sensitive(o.text, 'note');
    }
  }

  /**
   * Sensitive text in a payload going to `host` (null: a search engine, always
   * known). Private notes count everywhere, the rest only towards an unknown
   * host. Null when nothing leaks or the run is neither tainted nor guarded.
   */
  leak(payload: string, host: string | null): Leak | null {
    if (!this.#tainted && !this.#guarded) return null;
    const w = words(payload);
    if (w.length < MIN_WORDS) return null;
    const unknownHost = host !== null && !this.knownHost(host);
    const kinds: SensitiveKind[] = unknownHost ? ['private', 'note', 'profile'] : ['private'];
    for (const kind of kinds) {
      const set = this.#shingles[kind];
      if (set.size === 0) continue;
      const covered = new Set<number>();
      // Windows of 6 words; shorter ones find the short notes kept whole.
      for (let n = MIN_WORDS; n <= SHINGLE; n++) {
        for (let i = 0; i + n <= w.length; i++) {
          if (set.has(w.slice(i, i + n).join(' '))) {
            for (let j = i; j < i + n; j++) covered.add(j);
          }
        }
      }
      if (covered.size > 0) {
        const chars = [...covered].reduce((s, j) => s + w[j]!.length + 1, 0);
        return { kind, chars, unknownHost };
      }
    }
    return null;
  }
  /**
   * What a reply to a chat with other people repeats (D-114; review of the waves 3 and 4),
   * whether or not the run is tainted: a private note at all; the profile and the memory as
   * the characters of every piece; the notes as the longest stretch in a row equal to a note
   * (a few short quotes are an answer, a long stretch is the note), leaving out the notes
   * `shared` says the chat may see (the area of the bot's project).
   */
  replyLeak(payload: string, shared: (path: string) => boolean = () => false): Leak | null {
    const w = words(payload);
    if (w.length < MIN_WORDS) return null;
    let best: Leak | null = null;
    for (const kind of ['private', 'profile', 'note'] as const) {
      const set = this.#shingles[kind];
      if (set.size === 0) continue;
      const covered = new Set<number>();
      for (let n = MIN_WORDS; n <= SHINGLE; n++) {
        for (let i = 0; i + n <= w.length; i++) {
          const sh = w.slice(i, i + n).join(' ');
          if (!set.has(sh)) continue;
          if (kind === 'note') {
            // Only from notes the chat may see: not a leak.
            const origins = this.#noteOrigins.get(sh);
            if (origins && [...origins].every((p) => p !== '' && shared(p))) continue;
          }
          for (let j = i; j < i + n; j++) covered.add(j);
        }
      }
      if (covered.size === 0) continue;
      if (kind === 'private') return { kind, chars: covered.size, unknownHost: true };
      let chars = 0;
      if (kind === 'profile') {
        chars = [...covered].reduce((sum, j) => sum + w[j]!.length + 1, 0);
      } else {
        let stretch = 0;
        for (let j = 0; j < w.length; j++) {
          stretch = covered.has(j) ? stretch + w[j]!.length + 1 : 0;
          chars = Math.max(chars, stretch);
        }
      }
      if (!best || chars > best.chars) best = { kind, chars, unknownHost: true };
    }
    return best;
  }
}
