import type { ModelRef } from '@monsters/providers';
import { BROWSER_SERVER, defineTool, type MonstersTool } from '@monsters/shared';
import { z } from 'zod';
import { splitAgentToolName } from '../mcp/convert.ts';

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
 * `anteiku_task_crea` and "elenca clienti" finds `list_customers` (stems).
 */
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
  ['attività', 'task'],
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

/** A crude stem for Italian and English: infinitives and final vowels and plurals go. */
export function stem(term: string): string {
  let t = term;
  if (t.length > 5 && /(?:are|ere|ire)$/.test(t)) t = t.slice(0, -3);
  if (t.length > 4 && /(?:ies)$/.test(t)) t = `${t.slice(0, -3)}y`;
  else if (t.length > 4 && /[^s]s$/.test(t)) t = t.slice(0, -1);
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

/** Where a tool found by `tools_search` stands (M6 of the review of 19/10, D-134). */
export type ToolSearchStatus = 'pronto' | 'pronto dal prossimo passo' | 'non caricabile';

export interface ToolSearchResult {
  tools: { name: string; description: string; args: string; status: ToolSearchStatus }[];
  note: string;
}

/** Why a tool called by name is not there, for the line the run adds (D-134). */
export type MissedTool =
  | { name: string; state: 'loaded' }
  | { name: string; state: 'limit'; max: number }
  | { name: string; state: 'unknown' };

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
  /** Loaded by searches, in the order they came. */
  readonly #loaded: string[] = [];
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
  ) {
    this.config = config;
    this.mcp = mcp;
    this.#turn = turn;
    const waits = (t: MonstersTool) =>
      DEFERRABLE_OWN_TOOLS.has(t.name) || turn.has(t.name) || (mcp && deferrable(t));
    const deferred = tools.filter(waits);
    const names = new Set(deferred.map((t) => t.name));
    const preload = new Set(
      recent.filter((n) => names.has(n) && !turn.has(n)).slice(0, config.preload),
    );
    this.base = [...tools.filter((t) => !waits(t)).map((t) => t.name), ...[...preload].sort()];
    this.#deferred = new Map(
      deferred
        .filter((t) => !preload.has(t.name))
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
    );
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

  /** Adds tools to the next steps (never removes); stops once the run's cap is reached. */
  load(names: readonly string[]): string[] {
    const added: string[] = [];
    for (const n of [...names].sort()) {
      if (!this.#deferred.has(n) || this.#loaded.includes(n)) continue;
      if (this.#loaded.length >= this.config.maxLoaded) break;
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
    const by = new Map<string, number>();
    for (const n of this.#deferred.keys()) {
      const s =
        splitAgentToolName(n)?.server ??
        DEFERRABLE_OWN_TOOLS.get(n) ??
        this.#turn.get(n) ??
        'monsters';
      by.set(s, (by.get(s) ?? 0) + 1);
    }
    return [...by]
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([s, k]) => `${s} (${k})`)
      .join(', ');
  }

  search(query: string, limit?: number): ToolSearchResult {
    const k = Math.min(limit ?? this.config.maxResults, this.config.maxResults);
    const hits = this.#index.search(query, k);
    if (hits.length === 0) {
      return {
        tools: [],
        note: 'Nessuno strumento trovato: prova con altre parole (il verbo e la cosa, anche in inglese), o con un modello sui nomi come anteiku_task_*.',
      };
    }
    const wasReady = new Set(hits.filter((h) => this.#ready(h.name)).map((h) => h.name));
    this.load(hits.map((h) => h.name).filter((n) => !wasReady.has(n)));
    const status = (name: string): ToolSearchStatus =>
      wasReady.has(name)
        ? 'pronto'
        : this.#loaded.includes(name)
          ? 'pronto dal prossimo passo'
          : 'non caricabile';
    const tools = hits.map((h) => {
      const t = this.#all.get(h.name)!;
      const d = plainDescription(t);
      return {
        name: h.name,
        description: d.length > 220 ? `${d.slice(0, 219)}…` : d,
        args: argsLine(t),
        status: status(h.name),
      };
    });
    const by = (s: ToolSearchStatus) => tools.filter((t) => t.status === s).map((t) => t.name);
    const [ready, next, out] = [
      by('pronto'),
      by('pronto dal prossimo passo'),
      by('non caricabile'),
    ];
    const note = [
      ...(ready.length > 0 ? [`Già pronti, chiamali ora: ${ready.join(', ')}.`] : []),
      ...(next.length > 0 ? [`Pronti dal prossimo passo: ${next.join(', ')}.`] : []),
      ...(out.length > 0
        ? [
            `Non caricabili: ${out.join(', ')} (limite di ${this.config.maxLoaded} strumenti caricati in questo lavoro raggiunto). Non è un no dell’utente: usa quelli già pronti, o dillo nel rapporto.`,
          ]
        : []),
    ].join(' ');
    return { tools, note };
  }

  /** `tools_search`, for the agent. */
  tool(): MonstersTool<{ query: string; limit?: number | undefined }, ToolSearchResult> {
    return defineTool({
      name: TOOL_SEARCH,
      description:
        `Finds your tools by what they do and loads the ones that wait (${this.#servers()}); the ones you already have come back marked "pronto". ` +
        'Search with a few words (the action and the thing, e.g. "crea task", "elenca clienti") or a name pattern with * (e.g. "anteiku_preventivi_*"; * is the only wildcard, no regex). ' +
        'The tools loaded are callable by name from the next step.',
      inputSchema: z.object({
        query: z.string().min(1).max(200).describe('Words, or a name pattern with *'),
        limit: z.number().int().min(1).max(this.config.maxResults).optional(),
      }),
      readOnly: true,
      execute: ({ query, limit }) => Promise.resolve(this.search(query, limit)),
    });
  }
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
