import type { ModelRef } from '@monsters/providers';
import { BROWSER_SERVER, defineTool, type MonstersTool } from '@monsters/shared';
import { z } from 'zod';
import { splitAgentToolName } from '../mcp/convert.ts';
import { toolGroupName, toolSearchPrompts } from './tool-search.prompts.ts';

/*
 * Tools of big servers loaded when needed (C.2 of the plan of 16/10, D-075):
 * Anteiku alone has 124 tools, tens of thousands of tokens at every step, and a
 * small model does not even fit them. Past a threshold of MCP tools, a native
 * monster gets only its own tools, the MCP tools it used most lately, and
 * `tools_search`: a query (BM25 over name, description and argument names,
 * Italian and English) returns the best matches and loads them, so they are
 * sent from the next step on.
 *
 * - One mechanism for every provider, on our side: the models of a chain may
 *   change in the middle of a run (fallback from Anthropic to OpenRouter), so a
 *   provider's own tool search (Anthropic `tool_search_tool_bm25`) would not
 *   survive the switch; the AI SDK's `toolSearch` keeps its state out of reach
 *   (no preloaded set, no log of the searches). Harness runs (Claude Code)
 *   load MCP tools with their own ToolSearch.
 * - Order is fixed (Monsters' tools as given, then the MCP tools by name, the
 *   loaded ones appended in the order they came) and the loaded set only grows
 *   within a run: each load changes the prefix once, never back and forth.
 */

export interface ToolSearchConfig {
  /** Defer when the MCP tools of the run are more than this. */
  threshold: number;
  /** MCP tools always sent: the most used lately. */
  preload: number;
  /** Most MCP tools loaded by searches in one run. */
  maxLoaded: number;
  /** Most tools one search returns (and loads). */
  maxResults: number;
}

/** Paid and subscription models. */
export const TOOL_SEARCH_DEFAULT: ToolSearchConfig = {
  threshold: 30,
  preload: 8,
  maxLoaded: 40,
  maxResults: 5,
};

/** Free models: small windows, fewer tools at once (as `MAX_MCP_TOOLS_FREE`). */
export const TOOL_SEARCH_FREE: ToolSearchConfig = {
  threshold: 12,
  preload: 4,
  maxLoaded: 12,
  maxResults: 4,
};

export const TOOL_SEARCH = 'tools_search';
/** Codex (D-163): runs a tool of the run that its tool list does not have. */
export const TOOLS_CALL = 'tools_call';

/** Free (or router) models only, as `isFreeChain` of the team. */
export function toolSearchConfigFor(models: readonly ModelRef[]): ToolSearchConfig {
  const free = models.every(
    (m) =>
      m.provider === 'openrouter' && (m.model.endsWith(':free') || m.model === 'openrouter/free'),
  );
  return free ? TOOL_SEARCH_FREE : TOOL_SEARCH_DEFAULT;
}

// --- ranking ----------------------------------------------------------------------------

/**
 * A few words both ways between Italian and English, so "create task" finds
 * `anteiku_task_crea` and "elenca clienti" finds `list_customers` (stems). A query is
 * written in either language (D-153): the English words also reach each other
 * ("make", "show", "remove") and the Italian ones keep their pairs.
 */
// i18n-ignore: the words of the tool search, data and not copy
const SYNONYMS: [string, string][] = [
  ['crea', 'create'],
  ['nuovo', 'new'],
  ['nuova', 'new'],
  ['aggiungi', 'add'],
  ['elenca', 'list'],
  ['leggi', 'read'],
  ['leggi', 'get'],
  ['cerca', 'search'],
  ['cerca', 'find'],
  ['aggiorna', 'update'],
  ['modifica', 'edit'],
  ['elimina', 'delete'],
  ['cancella', 'delete'],
  ['rimuovi', 'remove'],
  ['togli', 'remove'],
  ['archivia', 'archive'],
  ['cliente', 'customer'],
  ['cliente', 'client'],
  ['progetto', 'project'],
  ['attività', 'task'], // i18n-ignore
  ['compito', 'task'],
  ['pagamento', 'payment'],
  ['fattura', 'invoice'],
  ['preventivo', 'quote'],
  ['preventivo', 'estimate'],
  ['riunione', 'meeting'],
  ['evento', 'event'],
  ['agenda', 'calendar'],
  ['pagina', 'page'],
  ['commento', 'comment'],
  ['contatto', 'contact'],
  ['persona', 'people'],
  ['persona', 'user'],
  ['ore', 'hours'],
  ['messaggio', 'message'],
  ['invia', 'send'],
  ['automazione', 'automation'],
  ['proponi', 'propose'],
  ['istruzione', 'instruction'],
  // English with English: what a query in English says for what the tools call otherwise
  ['make', 'create'],
  ['show', 'read'],
  ['show', 'get'],
  ['view', 'read'],
  ['view', 'get'],
  ['fetch', 'get'],
  ['change', 'update'],
  ['change', 'edit'],
  ['modify', 'edit'],
  ['remove', 'delete'],
  ['find', 'search'],
  ['lookup', 'search'],
  ['todo', 'task'],
  ['appointment', 'event'],
  ['appointment', 'meeting'],
  ['schedule', 'calendar'],
  ['bill', 'invoice'],
  ['proposal', 'quote'],
  // more Italian verbs and nouns, with their English
  ['mostra', 'show'],
  ['trova', 'find'],
  ['salva', 'save'],
  ['scrivi', 'write'],
  ['sposta', 'move'],
  ['apri', 'open'],
  ['chiudi', 'close'],
];

/** The pairs as stems (`crea` ↔ `creat`), built on first use. */
let synonymMap: Map<string, Set<string>> | undefined;
function synonymsOf(term: string): Iterable<string> {
  if (!synonymMap) {
    synonymMap = new Map();
    for (const [x, y] of SYNONYMS) {
      const [a, b] = [searchTerms(x)[0]!, searchTerms(y)[0]!];
      if (!synonymMap.has(a)) synonymMap.set(a, new Set());
      if (!synonymMap.has(b)) synonymMap.set(b, new Set());
      synonymMap.get(a)!.add(b);
      synonymMap.get(b)!.add(a);
    }
  }
  return synonymMap.get(term) ?? [];
}

/** Lower case, no accents, split on anything but letters and digits (and camelCase). */
export function searchTerms(text: string): string[] {
  return text
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 2)
    .map(stem);
}

/**
 * A crude stem for Italian and English: infinitives, final vowels, plurals and the English
 * `-ing` and `-ed` go ("creating", "created", "create" and "crea" meet at `creat`).
 */
export function stem(term: string): string {
  let t = term;
  if (t.length > 5 && /(?:are|ere|ire)$/.test(t)) t = t.slice(0, -3);
  if (t.length > 4 && /(?:ies)$/.test(t)) t = `${t.slice(0, -3)}y`;
  else if (t.length > 4 && /[^s]s$/.test(t)) t = t.slice(0, -1);
  // After the plural, so "strings" and "string" stem alike.
  if (t.length > 5 && /ing$/.test(t)) t = t.slice(0, -3);
  else if (t.length > 4 && /ed$/.test(t)) t = t.slice(0, -2);
  while (t.length > 3 && /[aeiouy]$/.test(t)) t = t.slice(0, -1);
  return t;
}

interface Doc {
  name: string;
  /** Term → weighted frequency. */
  tf: Map<string, number>;
  length: number;
}

const WEIGHT = { name: 3, args: 1.5, description: 1 };

/** Names of the arguments of a JSON schema, top level. */
function argNames(t: MonstersTool): string[] {
  const props = (t.inputJsonSchema as { properties?: Record<string, unknown> } | undefined)
    ?.properties;
  if (props && typeof props === 'object') return Object.keys(props);
  try {
    const json = z.toJSONSchema(t.inputSchema, { io: 'input', unrepresentable: 'any' }) as {
      properties?: Record<string, unknown>;
    };
    return Object.keys(json.properties ?? {});
  } catch {
    return [];
  }
}

/** The input JSON schema of a tool, compact (no `$schema`), for a search that loads nothing. */
function inputSchemaOf(t: MonstersTool): unknown {
  let schema: unknown = t.inputJsonSchema;
  if (schema === undefined) {
    try {
      schema = z.toJSONSchema(t.inputSchema, { io: 'input', unrepresentable: 'any' });
    } catch {
      schema = {};
    }
  }
  if (schema && typeof schema === 'object' && '$schema' in schema) {
    const rest = { ...(schema as Record<string, unknown>) };
    delete rest['$schema'];
    return rest;
  }
  return schema;
}

/** The description without the "[External tool, MCP server "x"]" the core puts first. */
export function plainDescription(t: MonstersTool): string {
  return t.description.replace(/^\[External tool, MCP server "[^"]*"\]\s*/, '');
}

/** BM25 over the tools: name, argument names and description, weighted. */
export class ToolIndex {
  readonly #docs: Doc[];
  readonly #df = new Map<string, number>();
  readonly #avg: number;

  constructor(tools: readonly MonstersTool[]) {
    this.#docs = tools.map((t) => {
      const tf = new Map<string, number>();
      const add = (terms: string[], w: number) => {
        for (const term of terms) tf.set(term, (tf.get(term) ?? 0) + w);
      };
      const tool = splitAgentToolName(t.name)?.tool ?? t.name;
      add(searchTerms(tool), WEIGHT.name);
      add(searchTerms(argNames(t).join(' ')), WEIGHT.args);
      add(searchTerms(plainDescription(t)), WEIGHT.description);
      let length = 0;
      for (const v of tf.values()) length += v;
      return { name: t.name, tf, length };
    });
    for (const d of this.#docs)
      for (const term of d.tf.keys()) {
        this.#df.set(term, (this.#df.get(term) ?? 0) + 1);
      }
    this.#avg = this.#docs.reduce((n, d) => n + d.length, 0) / Math.max(1, this.#docs.length);
  }

  /**
   * The best matches of a query, best first (ties by name: deterministic).
   * A pattern with `*` (or written `/…/` as a regex, read as a pattern) matches
   * the names; a full tool name ranks first.
   */
  search(query: string, limit: number): { name: string; score: number }[] {
    const q = query.trim();
    const pattern = namePattern(q);
    if (pattern === 'invalid') return [];
    if (pattern) {
      return this.#docs
        .filter((d) => pattern((splitAgentToolName(d.name)?.tool ?? d.name).toLowerCase()))
        .map((d) => ({ name: d.name, score: 1 }))
        .sort((a, b) => (a.name < b.name ? -1 : 1))
        .slice(0, limit);
    }
    const terms = new Map<string, number>();
    for (const t of searchTerms(q)) {
      terms.set(t, Math.max(terms.get(t) ?? 0, 1));
      for (const s of synonymsOf(t)) terms.set(s, Math.max(terms.get(s) ?? 0, 0.8));
    }
    const exact = q.toLowerCase();
    const n = this.#docs.length;
    const k1 = 1.2;
    const b = 0.75;
    return this.#docs
      .map((d) => {
        let score = 0;
        for (const [term, w] of terms) {
          const f = d.tf.get(term);
          if (!f) continue;
          const df = this.#df.get(term) ?? 0;
          const idf = Math.log(1 + (n - df + 0.5) / (df + 0.5));
          score += w * idf * ((f * (k1 + 1)) / (f + k1 * (1 - b + (b * d.length) / this.#avg)));
        }
        const tool = (splitAgentToolName(d.name)?.tool ?? d.name).toLowerCase();
        if (exact === tool || exact === d.name.toLowerCase()) score += 100;
        return { name: d.name, score };
      })
      .filter((r) => r.score > 0)
      .sort((a, b2) => b2.score - a.score || (a.name < b2.name ? -1 : 1))
      .slice(0, limit);
  }
}

/** Longest name pattern, and most `*` in it. */
const PATTERN_MAX_CHARS = 100;
const PATTERN_MAX_STARS = 5;

/**
 * A pattern on the tool names (review of 16/10: a regex of the model could
 * block the core, `(a+)+$`): `*` is the only wildcard, everything else is
 * literal, case-insensitive; matched piece by piece with `indexOf`, linear in
 * the name. `/…/` (models used to regex tool search) is read as a pattern:
 * `^` and `$` anchor, `.*` and `.+` are `*`; any other regex syntax makes it
 * invalid. Null when the query is plain words (BM25).
 */
export function namePattern(query: string): ((name: string) => boolean) | 'invalid' | null {
  let text = query;
  let start = false;
  let end = false;
  const slashed = /^\/(.+)\/[a-z]*$/s.exec(query);
  if (slashed) {
    text = slashed[1]!;
    if (text.startsWith('^')) {
      start = true;
      text = text.slice(1);
    }
    if (text.endsWith('$') && !text.endsWith('\\$')) {
      end = true;
      text = text.slice(0, -1);
    }
    text = text.replace(/\.[*+]/g, '*');
    if (/[\\^$.+?()[\]{}|]/.test(text)) return 'invalid';
  } else if (!query.includes('*')) {
    return null;
  }
  if (text.length > PATTERN_MAX_CHARS) return 'invalid';
  const pieces = text.toLowerCase().split('*');
  if (pieces.length - 1 > PATTERN_MAX_STARS) return 'invalid';
  if (pieces.every((p) => p === '')) return () => true;
  // Found anywhere in the name (`preventivi_*`, `/togli/`) unless `^` or `$` anchor it.
  const lastAt = pieces.length - 1;
  return (name) => {
    let at = 0;
    for (let i = 0; i <= lastAt; i++) {
      const piece = pieces[i]!;
      if (i === 0 && start) {
        if (!name.startsWith(piece)) return false;
        at = piece.length;
        if (lastAt === 0) return !end || name.length === piece.length;
      } else if (i === lastAt && end) {
        return name.length - piece.length >= at && name.endsWith(piece);
      } else if (piece !== '') {
        const found = name.indexOf(piece, at);
        if (found === -1) return false;
        at = found + piece.length;
      }
    }
    return true;
  };
}

// --- the deferred tools of a run ----------------------------------------------------------

/**
 * Monsters' own tools that wait for a search (D-097, D-098, D-113): the tools of
 * the projects, the proposals of automations and of the folder's CLAUDE.md and
 * AGENTS.md, needed for a few requests only.
 * They always wait, also with few MCP tools: their definitions cost more than
 * `tools_search` and the line of the Monsters card that names them.
 */
export const DEFERRABLE_OWN_TOOLS: ReadonlyMap<string, string> = new Map([
  ['project_send', 'progetti'],
  ['project_status', 'progetti'],
  ['project_propose', 'progetti'],
  ['automation_propose', 'automazioni'],
  ['project_docs_propose', 'istruzioni'],
]);

/** MCP tools that can wait for a search: all but the browser (a web monster's hands). */
export function deferrable(t: MonstersTool): boolean {
  if (DEFERRABLE_OWN_TOOLS.has(t.name)) return true;
  const mcp = splitAgentToolName(t.name);
  return mcp !== null && mcp.server !== BROWSER_SERVER;
}

/** Arguments in one line: `titolo, progetto_id, scadenza?`. */
function argsLine(t: MonstersTool): string {
  const schema = (t.inputJsonSchema ?? {}) as { required?: string[] };
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);
  return argNames(t)
    .map((a) => (required.has(a) || !t.inputJsonSchema ? a : `${a}?`))
    .join(', ');
}

/**
 * Where a tool found by `tools_search` stands (M6 of the review of 19/10, D-134), in the words of
 * the family the run speaks (`pronto` / `ready`, `pronto dal prossimo passo` / `ready from the
 * next step`, `non caricabile` / `not loadable`).
 */
export type ToolSearchStatus = string;

export interface ToolSearchResult {
  tools: {
    name: string;
    description: string;
    args: string;
    status: ToolSearchStatus;
    /** Call mode only: the input JSON schema, so the tool can be called without being loaded. */
    schema?: unknown;
  }[];
  note: string;
}

/**
 * How `tools_search` answers: `load` (a native run: the hits join the tools of the next steps) or
 * `call` (Codex, D-163: its tool list cannot change in a session, so nothing is loaded and the
 * answer carries each hit's schema, to be called through `tools_call`).
 */
export type ToolSearchMode = 'load' | 'call';

/** Why a tool called by name is not there, for the line the run adds (D-134). */
export type MissedTool =
  | { name: string; state: 'loaded' }
  | { name: string; state: 'limit'; max: number }
  | { name: string; state: 'unknown' };

/**
 * The tools an agent had sent at the end of its last run (D-168): `preload` the ones sent from
 * the first step, `loaded` the ones searches and direct calls added, both in the order they went.
 */
export interface KeptTools {
  preload: readonly string[];
  loaded: readonly string[];
}

/** How long the tools of a run are kept for the next one: the life of the providers' prompt cache. */
export const TOOL_SET_TTL_MS = 5 * 60_000;

/**
 * The tools each agent sent at the end of its last run (D-168). The tools come first in the
 * prompt, so a turn that preloads other tools than the turn before rewrites the whole cache even
 * if the system prompt and the history are the same. A turn that follows within the life of the
 * cache starts with the tools of the last one, in the same order, and what its own words point at
 * comes after: the list only grows, as it does inside a run, and a cache that is still warm is
 * read. After `ttlMs` the entry is forgotten (the cache is cold, a stale tool would only cost
 * tokens) and a list grown past twice the preload is dropped (`DeferredTools`).
 */
export class ToolSetMemory {
  readonly #sets = new Map<string, { at: number; kept: KeptTools }>();
  readonly #ttlMs: number;
  readonly #now: () => number;
  readonly #max: number;

  constructor(options: { ttlMs?: number; now?: () => number; max?: number } = {}) {
    this.#ttlMs = options.ttlMs ?? TOOL_SET_TTL_MS;
    this.#now = options.now ?? Date.now;
    this.#max = options.max ?? 200;
  }

  get(key: string): KeptTools | undefined {
    const entry = this.#sets.get(key);
    if (!entry) return undefined;
    if (this.#now() - entry.at > this.#ttlMs) {
      this.#sets.delete(key);
      return undefined;
    }
    return entry.kept;
  }

  set(key: string, kept: KeptTools): void {
    this.#sets.delete(key);
    this.#sets.set(key, {
      at: this.#now(),
      kept: { preload: [...kept.preload], loaded: [...kept.loaded] },
    });
    // Oldest first out: a map keeps the order things were set in.
    for (const old of this.#sets.keys()) {
      if (this.#sets.size <= this.#max) break;
      this.#sets.delete(old);
    }
  }
}

/**
 * The tools of one run of an agent when its MCP tools are many, or when some
 * of its own wait for this turn: what is sent at each step (`activeNames`) and
 * the `tools_search` tool that adds to it.
 *
 * Taking away becomes deferring (D-134, defence D1 of the review of 19/10): a
 * tool the run has but does not send now (many MCP tools, the web or the rare
 * note tools on a free chain for a request that does not seem to need them)
 * waits here, named by the card and loadable with `tools_search` or by calling
 * it. The index covers every tool of the run, the ready ones too, so a search
 * for a tool already sent says "pronto" instead of "nessuno strumento trovato".
 */
export class DeferredTools {
  readonly config: ToolSearchConfig;
  /** Sent from the first step: the agent's own tools, then the preloaded MCP tools. */
  readonly base: readonly string[];
  /** Tools that wait for a search, by name. */
  readonly #deferred: Map<string, MonstersTool>;
  /** Every tool of the run (but `tools_search`), by name: what a search can find. */
  readonly #all: Map<string, MonstersTool>;
  readonly #index: ToolIndex;
  /** Loaded by searches (after the ones kept from the last run), in the order they came. */
  readonly #loaded: string[] = [];
  /** The first of `#loaded` came with the last run's tools or the turn's words, not from a search. */
  #carried = 0;
  /** The MCP tools of `base`, the ones preloaded (what the next run keeps). */
  readonly #preloaded: string[];
  /** Every tool that waits, the preloaded ones too (what `tools_search` says it holds). */
  readonly #waiting: readonly MonstersTool[];
  /** The MCP tools wait too (they are many). */
  readonly mcp: boolean;
  /** Own tools that wait for this turn only, with the group the card names them by. */
  readonly #turn: ReadonlyMap<string, string>;

  private constructor(
    tools: readonly MonstersTool[],
    config: ToolSearchConfig,
    recent: string[],
    /** The MCP tools are many: they wait too (otherwise only Monsters' own deferrable ones). */
    mcp: boolean,
    turn: ReadonlyMap<string, string>,
    /** The words of the turn (the request, the last messages), for the preload (D-163). */
    query: string,
    /** The tools the last run of the agent sent, while the cache is warm (D-168). */
    kept?: KeptTools,
  ) {
    this.config = config;
    this.mcp = mcp;
    this.#turn = turn;
    const waits = (t: MonstersTool) =>
      DEFERRABLE_OWN_TOOLS.has(t.name) || turn.has(t.name) || (mcp && deferrable(t));
    const deferred = tools.filter(waits);
    const preload = new Set(
      mcp
        ? preloadOf(
            deferred.filter((t) => !DEFERRABLE_OWN_TOOLS.has(t.name) && !turn.has(t.name)),
            recent,
            query,
            config.preload,
          )
        : [],
    );
    this.#waiting = deferred;
    // The last run's list first, in its order, then what the words of this turn point at that it
    // did not have, appended like a load (D-168). A list grown past twice the preload is let go
    // (a model whose provider does not cache would pay for the tools it does not use) and the
    // turn starts over from its own words, as it did before.
    const waiting = new Set(deferred.map((t) => t.name));
    const fresh = [...preload].sort();
    let keptPreload = (kept?.preload ?? []).filter((n) => waiting.has(n));
    let keptLoaded = (kept?.loaded ?? []).filter((n) => waiting.has(n) && !keptPreload.includes(n));
    const news = fresh.filter((n) => !keptPreload.includes(n) && !keptLoaded.includes(n));
    if (keptPreload.length + keptLoaded.length + news.length > config.preload * 2) {
      keptPreload = [];
      keptLoaded = [];
    }
    const sticky = keptPreload.length + keptLoaded.length > 0;
    this.#preloaded = sticky ? keptPreload : fresh;
    this.#loaded.push(...(sticky ? [...keptLoaded, ...news] : []));
    this.#carried = this.#loaded.length;
    const inBase = new Set(this.#preloaded);
    this.base = [...tools.filter((t) => !waits(t)).map((t) => t.name), ...this.#preloaded];
    this.#deferred = new Map(
      deferred
        .filter((t) => !inBase.has(t.name))
        .sort((a, b) => (a.name < b.name ? -1 : 1))
        .map((t) => [t.name, t]),
    );
    this.#all = new Map(tools.filter((t) => t.name !== TOOL_SEARCH).map((t) => [t.name, t]));
    this.#index = new ToolIndex([...this.#all.values()]);
  }

  /**
   * The deferred tools of a run, or null when there is nothing to wait: the
   * MCP tools are few enough to send them all and none of Monsters' own
   * deferrable tools is there. `recent`: MCP tool names, most used first.
   * `turn`: own tools of the run that wait for this turn (name → group).
   */
  static plan(
    tools: readonly MonstersTool[],
    config: ToolSearchConfig,
    recent: () => string[] = () => [],
    turn: ReadonlyMap<string, string> = new Map(),
    query = '',
    kept?: KeptTools,
  ): DeferredTools | null {
    const mcp = tools.filter((t) => deferrable(t) && !DEFERRABLE_OWN_TOOLS.has(t.name)).length;
    const own = tools.some((t) => DEFERRABLE_OWN_TOOLS.has(t.name) || turn.has(t.name));
    if (mcp <= config.threshold && !own) return null;
    return new DeferredTools(
      tools,
      config,
      mcp > config.threshold ? recent() : [],
      mcp > config.threshold,
      new Map([...turn].filter(([n]) => tools.some((t) => t.name === n))),
      query,
      kept,
    );
  }

  /** What the next run of the agent starts from while the cache is warm (`ToolSetMemory`). */
  kept(): KeptTools {
    return { preload: [...this.#preloaded], loaded: [...this.#loaded] };
  }

  get loaded(): readonly string[] {
    return this.#loaded;
  }

  /** Monsters' own tools that wait for a search (D-098, and those of this turn, D-134). */
  get ownDeferred(): string[] {
    return [...this.#deferred.keys()].filter(
      (n) => DEFERRABLE_OWN_TOOLS.has(n) || this.#turn.has(n),
    );
  }

  get deferredCount(): number {
    return this.#deferred.size;
  }

  /** Names sent at this step, in their fixed order (`tools_search` with the agent's own). */
  activeNames(): string[] {
    return [...this.base, TOOL_SEARCH, ...this.#loaded];
  }

  /** Sent at this step (in the base or loaded). */
  #ready(name: string): boolean {
    return name === TOOL_SEARCH || this.base.includes(name) || this.#loaded.includes(name);
  }

  /** Is this tool sent to the model now? Tools of the run that wait are not (D-163). */
  sends(name: string): boolean {
    return this.#ready(name) || !this.#all.has(name);
  }

  /**
   * Waiting tools the model called by their name and that ran (D-163: every tool of the run is
   * callable, only the loaded ones are sent): loaded for the next steps, so the model sees their
   * parameters from then on. Past the cap they still run when called.
   */
  calledDirectly(names: readonly string[]): string[] {
    return this.load(names.filter((n) => this.#deferred.has(n)));
  }

  /** Adds tools to the next steps (never removes); stops once the run's cap is reached. */
  load(names: readonly string[]): string[] {
    const added: string[] = [];
    for (const n of [...names].sort()) {
      if (!this.#deferred.has(n) || this.#loaded.includes(n)) continue;
      if (this.#loaded.length - this.#carried >= this.config.maxLoaded) break;
      this.#loaded.push(n);
      added.push(n);
    }
    return added;
  }

  /**
   * Tools the model called by name while they waited (the card names them): loaded now when
   * the cap allows, and what the run tells the model about each (D-134): loaded, the cap, or
   * not a tool of this run. Never a silent stop (M6).
   */
  loadCalled(names: readonly string[]): MissedTool[] {
    const fresh = [...new Set(names)].filter((n) => !this.#ready(n));
    this.load(fresh.filter((n) => this.#deferred.has(n)));
    return fresh.map((name): MissedTool => {
      if (this.#loaded.includes(name)) return { name, state: 'loaded' };
      if (this.#deferred.has(name)) return { name, state: 'limit', max: this.config.maxLoaded };
      return { name, state: 'unknown' };
    });
  }

  /** Servers and how many of their tools wait: `anteiku (124)`. */
  #servers(): string {
    // All that wait, the preloaded ones too: the search holds them all, and the number must not
    // change with the turn's preload, or the tool's description (first in the prompt) would (D-168).
    const by = new Map<string, number>();
    for (const { name: n } of this.#waiting) {
      const s =
        splitAgentToolName(n)?.server ??
        DEFERRABLE_OWN_TOOLS.get(n) ??
        this.#turn.get(n) ??
        'monsters';
      by.set(s, (by.get(s) ?? 0) + 1);
    }
    return [...by]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([s, k]) => `${toolGroupName(s)} (${k})`)
      .join(', ');
  }

  search(query: string, limit?: number, mode: ToolSearchMode = 'load'): ToolSearchResult {
    const k = Math.min(limit ?? this.config.maxResults, this.config.maxResults);
    const hits = this.#index.search(query, k);
    if (hits.length === 0) {
      return {
        tools: [],
        note: toolSearchPrompts().notFound,
      };
    }
    const wasReady = new Set(hits.filter((h) => this.#ready(h.name)).map((h) => h.name));
    const calling = mode === 'call';
    if (!calling) this.load(hits.map((h) => h.name).filter((n) => !wasReady.has(n)));
    const words = toolSearchPrompts();
    const status = (name: string): ToolSearchStatus =>
      wasReady.has(name)
        ? words.statusReady
        : calling
          ? words.statusCall
          : this.#loaded.includes(name)
            ? words.statusNext
            : words.statusOut;
    const tools = hits.map((h) => {
      const t = this.#all.get(h.name)!;
      const d = plainDescription(t);
      return {
        name: h.name,
        description: d.length > 220 ? `${d.slice(0, 219)}…` : d,
        args: argsLine(t),
        status: status(h.name),
        ...(calling ? { schema: inputSchemaOf(t) } : {}),
      };
    });
    const by = (s: ToolSearchStatus) => tools.filter((t) => t.status === s).map((t) => t.name);
    const [ready, next, out] = [by(words.statusReady), by(words.statusNext), by(words.statusOut)];
    const call = by(words.statusCall);
    const note = [
      ...(ready.length > 0 ? [words.readyNote(ready.join(', '))] : []),
      ...(next.length > 0 ? [words.nextNote(next.join(', '))] : []),
      ...(call.length > 0 ? [words.callNote(call.join(', '))] : []),
      ...(out.length > 0 ? [words.outNote(out.join(', '), this.config.maxLoaded)] : []),
    ].join(' ');
    return { tools, note };
  }

  /** `tools_search`, for the agent (`call` mode for Codex: it loads nothing, D-163). */
  tool(
    mode: ToolSearchMode = 'load',
  ): MonstersTool<{ query: string; limit?: number | undefined }, ToolSearchResult> {
    const words = toolSearchPrompts();
    return defineTool({
      name: TOOL_SEARCH,
      description:
        mode === 'call'
          ? words.callDescription(this.#servers())
          : words.description(this.#servers()),
      inputSchema: z.object({
        query: z.string().min(1).max(200).describe('Words, or a name pattern with *'),
        limit: z.number().int().min(1).max(this.config.maxResults).optional(),
      }),
      readOnly: true,
      execute: ({ query, limit }) => Promise.resolve(this.search(query, limit, mode)),
    });
  }
}

/**
 * The tools Codex gets in a run with many MCP tools (D-163). Codex cannot change its tool list in
 * a session, so loading is out: it sees the plan's base (Monsters' own tools and the preloaded
 * MCP tools) plus `tools_search` and `tools_call`, and reaches the rest by name through
 * `tools_call`. Null when the MCP tools are few enough to list them all (nothing changes then).
 * `exposed` are the names of the run's tools the session lists; the session still holds all of
 * them, so every call goes through the adapter.
 */
export function codexToolPlan(
  tools: readonly MonstersTool[],
  config: ToolSearchConfig,
  recent: () => string[],
  query: string,
): { search: MonstersTool; exposed: string[] } | null {
  const mcp = tools.filter((t) => deferrable(t) && !DEFERRABLE_OWN_TOOLS.has(t.name)).length;
  if (mcp <= config.threshold) return null;
  // No `turn` map: Monsters' own tools stay in the list (the card names them as plain tools).
  const plan = DeferredTools.plan(tools, config, recent, new Map(), query);
  if (!plan) return null;
  const base = new Set(plan.base);
  const exposed = tools
    .filter((t) => base.has(t.name) || DEFERRABLE_OWN_TOOLS.has(t.name) || !deferrable(t))
    .map((t) => t.name);
  return { search: plan.tool('call'), exposed: [...exposed, TOOL_SEARCH] };
}

/** Tools that open a service: search, list and read (the preload without other signals). */
export const ENTRY_TOOL =
  /^(?:search|fetch)$|(?:^|_)(?:cerca|search|find|elenca|list|leggi|get|read)(?:_|$)/;

/**
 * The MCP tools sent from the first step (D-163): the ones the turn's words point at (BM25 over
 * the request and the last messages, as `tools_search`), then the most used lately; with neither,
 * a few tools that open a service (search, list, read). Fixed for the turn, so the prefix stays.
 */
export function preloadOf(
  tools: readonly MonstersTool[],
  recent: readonly string[],
  query: string,
  slots: number,
): string[] {
  if (slots <= 0 || tools.length === 0) return [];
  const names = new Set(tools.map((t) => t.name));
  const out: string[] = [];
  const add = (n: string) => {
    if (out.length < slots && names.has(n) && !out.includes(n)) out.push(n);
  };
  const relevant = query.trim() ? relevantTools(tools, query.slice(0, 4000), slots) : [];
  const own = Math.max(1, Math.ceil((slots * 3) / 4));
  for (const n of relevant.slice(0, own)) add(n);
  for (const n of recent) add(n);
  for (const n of relevant) add(n);
  if (out.length > 0) return out;
  // No signal at all: the tools that open a service, the search of each first, half the slots.
  const tool = (t: MonstersTool) => (splitAgentToolName(t.name)?.tool ?? t.name).toLowerCase();
  const rank = (t: MonstersTool) => (/(?:^|_)(?:search|cerca|find)(?:_|$)/.test(tool(t)) ? 0 : 1);
  const entries = tools
    .filter((t) => ENTRY_TOOL.test(tool(t)))
    .sort((a, b) => rank(a) - rank(b) || (a.name < b.name ? -1 : 1))
    .slice(0, Math.max(1, Math.floor(slots / 2)));
  for (const t of entries) add(t.name);
  return out;
}

/**
 * The tools a request names (D-163): a long request shares stray words with many descriptions
 * ("crea", "id", "completo"), so the words of a tool's own name decide first, "clienti" and
 * "elenco" for `anteiku_clienti_elenca`, the share of them the request has; BM25 breaks the ties.
 * The words every tool shares (`anteiku`) do not count.
 */
function relevantTools(tools: readonly MonstersTool[], query: string, limit: number): string[] {
  const asked = new Set<string>();
  for (const t of searchTerms(query)) {
    asked.add(t);
    for (const s of synonymsOf(t)) asked.add(s);
  }
  const nameTerms = tools.map((t) => [
    ...new Set(searchTerms(splitAgentToolName(t.name)?.tool ?? t.name)),
  ]);
  const everywhere = new Set(
    nameTerms[0]?.filter((term) => nameTerms.every((n) => n.includes(term))) ?? [],
  );
  const bm25 = new Map(
    new ToolIndex(tools).search(query, tools.length).map((h) => [h.name, h.score]),
  );
  return tools
    .map((t, i) => {
      const own = nameTerms[i]!.filter((term) => !everywhere.has(term));
      const hit = own.filter((term) => asked.has(term)).length;
      return {
        name: t.name,
        share: own.length > 0 ? hit / own.length : 0,
        hit,
        score: bm25.get(t.name) ?? 0,
      };
    })
    .filter((r) => r.share >= 0.5 && r.hit > 0)
    .sort(
      (a, b) =>
        b.share - a.share || b.hit - a.hit || b.score - a.score || (a.name < b.name ? -1 : 1),
    )
    .slice(0, limit)
    .map((r) => r.name);
}

/** Most characters of one service's names in the card before they become groups. */
const CATALOG_MAX_CHARS = 2600;

/**
 * The names of one service's tools in a few words (D-163, as Claude Code names its deferred
 * tools): the prefix all share, then the names grouped where they part,
 * `clienti_{crea,elenca} · task_{crea,sposta}`, by their head, their area or their verb,
 * whichever is shorter. Past `CATALOG_MAX_CHARS` only the groups and how many: `clienti_* (5)`.
 */
export function toolCatalog(tools: readonly string[]): { prefix: string; names: string } {
  const sorted = [...new Set(tools)].sort();
  if (sorted.length === 0) return { prefix: '', names: '' };
  // The prefix all names share, cut after a `_` ("anteiku_").
  let prefix = sorted[0]!;
  for (const n of sorted) while (!n.startsWith(prefix)) prefix = prefix.slice(0, -1);
  prefix = sorted.length > 1 ? prefix.slice(0, prefix.lastIndexOf('_') + 1) : '';
  const rest = sorted.map((n) => n.slice(prefix.length));
  /** Groups by a key and the part after it; a name without `_` stands alone. */
  const grouped = (split: (parts: string[]) => [string, string]) => {
    const by = new Map<string, string[]>();
    for (const n of rest) {
      const parts = n.split('_');
      const [key, part] = parts.length > 1 ? split(parts) : [`\0${n}`, ''];
      by.set(key, [...(by.get(key) ?? []), part]);
    }
    return [...by];
  };
  const write = (groups: [string, string[]][]) =>
    groups
      .map(([key, parts]) =>
        key.startsWith('\0')
          ? key.slice(1)
          : parts.length === 1
            ? `${key}_${parts[0]!}`
            : `${key}_{${parts.join(',')}}`,
      )
      .join(' · ');
  // `clienti_crea` groups by its head (`clienti_{…}`), `list_issues` by its verb (`list_{…}`).
  const byHead = grouped((p) => [p.slice(0, -1).join('_'), p.at(-1)!]);
  const byArea = grouped((p) =>
    p.length > 2 ? [p.slice(0, 2).join('_'), p.slice(2).join('_')] : [p[0]!, p[1]!],
  );
  const byVerb = grouped((p) => [p[0]!, p.slice(1).join('_')]);
  const names = [write(byHead), write(byArea), write(byVerb)].reduce((a, b) =>
    b.length < a.length ? b : a,
  );
  if (names.length <= CATALOG_MAX_CHARS) return { prefix, names };
  const groups = byHead
    .map(([key, parts]) =>
      key.startsWith('\0')
        ? key.slice(1)
        : parts.length > 1
          ? `${key}_* (${parts.length})`
          : `${key}_${parts[0]!}`,
    )
    .join(' · ');
  // Names with no group to share (`modulo0_azione0_x`): only how many, `tools_search` finds them.
  return { prefix, names: groups.length <= CATALOG_MAX_CHARS ? groups : `${sorted.length} tools` };
}

/** MCP tools this agent used lately, most used first (ties by name). */
export function recentToolUse(events: readonly { data: unknown }[]): string[] {
  const count = new Map<string, number>();
  for (const e of events) {
    const tool = (e.data as { tool?: unknown }).tool;
    if (typeof tool === 'string' && tool.startsWith('mcp__')) {
      count.set(tool, (count.get(tool) ?? 0) + 1);
    }
  }
  return [...count].sort(([a, x], [b, y]) => y - x || (a < b ? -1 : 1)).map(([n]) => n);
}
