import { mkdirSync } from 'node:fs';
import type { ClaudeAgentHarness, HarnessConnector } from '@monsters/providers';
import {
  MCP_CATALOG,
  type Channel,
  type ClaudeConnectionState,
  type ClaudeConnectionView,
  type ClaudeConnectionsResponse,
  type McpCatalogEntry,
} from '@monsters/shared';
import type { StateStore } from '../db/state-store.ts';
import type { EventLog } from '../log/event-log.ts';
import { providerStrings } from './providers.strings.ts';

/*
 * Services connected "tramite Claude" (D-069, contract in
 * shared/src/claude-connections.ts). Claude is an approved app of Slack,
 * Google, Figma, Canva, Asana, HubSpot and Vercel: the user connects them
 * once on claude.ai (Settings → Connectors) and Claude Code loads them as
 * "claude.ai <name>" connectors; Claude Design is a first-party server Claude
 * Code signs in to with its own login (`/design-login`). Monsters keeps only
 * the choice (state store `claude.connections`) and hands the chosen ones to
 * the runs of the agents on Claude Agent (`connectorsFor`): the binary
 * admits only those (`allowedMcpServers`), and their tools pass the brake
 * through the hooks. The state is asked to the binary (`claude mcp get`, a
 * run stopped at its start for Claude Design) and updated by every run.
 * Nothing is written to the user's Claude Code configuration.
 */

const KEY = 'claude.connections';
const STATUS_KEY = 'claude.connections.status';

interface Stored {
  id: string;
  agents: string[];
}

interface PartStatus {
  state: ClaudeConnectionState;
  message?: string;
  checkedAt: number;
}

export class ClaudeConnectionError extends Error {
  readonly code: 'unknown_service' | 'unknown_agent';
  constructor(code: ClaudeConnectionError['code'], message: string) {
    super(message);
    this.code = code;
  }
}

export interface ClaudeConnectionsOptions {
  state: StateStore;
  log: Pick<EventLog, 'append'>;
  /** The Claude Code binary of the subscription (status checks). */
  claude: () => Pick<ClaudeAgentHarness, 'connectorStatus' | 'probeServers'>;
  /** The Claude plan is usable now (Claude Agent on, signed in with a subscription). */
  ready: () => boolean;
  /** A folder of Monsters for the checks (their working directory, the probe's files). */
  dir: string;
  agentExists: (id: string) => boolean;
  /**
   * A service chosen for the whole team (`*`) reaches this agent (D-097: a
   * project's monsters only when the project chose it). Default: everyone.
   */
  wildcard?: (agentId: string, id: string) => boolean;
}

/** The gallery entries reachable through Claude. */
export function viaClaudeEntries(): McpCatalogEntry[] {
  return MCP_CATALOG.filter((e) => e.viaClaude !== undefined);
}

/** Parts of an entry as the binary names them: `claude.ai Gmail`, `claude-design`. */
function partsOf(
  entry: McpCatalogEntry,
): { key: string; label: string; connector: HarnessConnector }[] {
  const via = entry.viaClaude!;
  return [
    ...via.connectors.map((c) => ({
      key: `claude.ai ${c.name}`,
      label: c.name,
      connector: { name: `claude.ai ${c.name}`, kind: 'claude-ai' as const, url: c.url },
    })),
    ...(via.server
      ? [
          {
            key: via.server.name,
            label: entry.name,
            connector: { name: via.server.name, kind: 'http' as const, url: via.server.url },
          },
        ]
      : []),
  ];
}

const WORST: ClaudeConnectionState[] = ['error', 'missing', 'needs_login', 'unknown', 'connected'];

/** What a status of the binary's `init` means for a part (`connected`, `failed`, `needs-auth`…). */
function fromInit(status: string, firstParty: boolean): PartStatus {
  const checkedAt = Date.now();
  if (status === 'connected') return { state: 'connected', checkedAt };
  if (/auth/i.test(status)) return { state: 'needs_login', checkedAt };
  if (status === 'failed' && firstParty) {
    // Claude Design answers 403 to a /login token without its scopes.
    return {
      state: 'needs_login',
      message: providerStrings().designLogin,
      checkedAt,
    };
  }
  return {
    state: 'error',
    message: providerStrings().claudeCantConnect(status),
    checkedAt,
  };
}

export class ClaudeConnectionService {
  readonly #o: ClaudeConnectionsOptions;
  #checking: Promise<void> | null = null;

  constructor(options: ClaudeConnectionsOptions) {
    this.#o = options;
  }

  #stored(): Stored[] {
    const raw = this.#o.state.get<Stored[]>(KEY);
    return Array.isArray(raw)
      ? raw.filter((s) => viaClaudeEntries().some((e) => e.id === s.id))
      : [];
  }

  #save(list: Stored[]): void {
    this.#o.state.set(KEY, list);
  }

  #statuses(): Record<string, PartStatus> {
    return this.#o.state.get<Record<string, PartStatus>>(STATUS_KEY) ?? {};
  }

  #setStatuses(update: Record<string, PartStatus>): void {
    if (Object.keys(update).length === 0) return;
    this.#o.state.set(STATUS_KEY, { ...this.#statuses(), ...update });
  }

  #entry(id: string): McpCatalogEntry {
    const entry = viaClaudeEntries().find((e) => e.id === id);
    if (!entry) {
      throw new ClaudeConnectionError('unknown_service', providerStrings().notViaClaude(id));
    }
    return entry;
  }

  view(): ClaudeConnectionsResponse {
    const stored = this.#stored();
    const statuses = this.#statuses();
    const connections = viaClaudeEntries().map((entry): ClaudeConnectionView => {
      const s = stored.find((x) => x.id === entry.id);
      const parts = partsOf(entry).map((p) => ({
        name: p.label,
        state: statuses[p.key]?.state ?? ('unknown' as const),
        message: statuses[p.key]?.message,
        checkedAt: statuses[p.key]?.checkedAt,
      }));
      const state = WORST.find((w) => parts.some((p) => p.state === w)) ?? 'unknown';
      const message = parts.find((p) => p.message && p.state === state)?.message;
      const checked = parts.map((p) => p.checkedAt).filter((t): t is number => t !== undefined);
      return {
        id: entry.id,
        added: s !== undefined,
        agents: s?.agents ?? ['*'],
        state,
        parts: parts.map((p) => ({ name: p.name, state: p.state })),
        ...(message ? { message } : {}),
        ...(checked.length > 0 ? { checkedAt: Math.min(...checked) } : {}),
      };
    });
    return { claude: this.#o.ready(), connections };
  }

  /** Asks the binary how the chosen services (or one) stand on the Claude account. */
  async check(id?: string): Promise<ClaudeConnectionsResponse> {
    if (!this.#o.ready()) return this.view();
    const entries = id
      ? [this.#entry(id)]
      : viaClaudeEntries().filter((e) => this.#stored().some((s) => s.id === e.id));
    if (entries.length === 0) return this.view();
    // One check at a time: the gallery may ask again while one runs.
    while (this.#checking) await this.#checking;
    const work = this.#run(entries);
    this.#checking = work.finally(() => {
      this.#checking = null;
    });
    await this.#checking;
    return this.view();
  }

  async #run(entries: McpCatalogEntry[]): Promise<void> {
    mkdirSync(this.#o.dir, { recursive: true, mode: 0o700 });
    const claude = this.#o.claude();
    const update: Record<string, PartStatus> = {};
    const connectors = entries.flatMap((e) => e.viaClaude!.connectors);
    const servers = entries.flatMap((e) => (e.viaClaude!.server ? [e.viaClaude!.server] : []));
    await Promise.all([
      ...connectors.map(async (c) => {
        const r = await claude.connectorStatus(c.name, this.#o.dir);
        const key = `claude.ai ${c.name}`;
        // Text the check did not recognise says nothing: what a run's `init` reported stays (C-10).
        if (r.state === 'unknown' && this.#statuses()[key]) return;
        update[key] = {
          state: r.state,
          ...(r.message ? { message: r.message } : {}),
          checkedAt: Date.now(),
        };
      }),
      (async () => {
        if (servers.length === 0) return;
        const found = await claude.probeServers(servers, this.#o.dir);
        for (const s of servers) {
          update[s.name] = found[s.name]
            ? fromInit(found[s.name]!, true)
            : {
                state: 'error',
                message: providerStrings().claudeNoAnswer,
                checkedAt: Date.now(),
              };
        }
      })(),
    ]);
    this.#setStatuses(update);
  }

  /** Adds a service (or changes who uses it). */
  set(id: string, agents: string[] | undefined, by: Channel): ClaudeConnectionsResponse {
    const entry = this.#entry(id);
    const bad = agents?.find((a) => a !== '*' && !this.#o.agentExists(a));
    if (bad) throw new ClaudeConnectionError('unknown_agent', providerStrings().noMonster(bad));
    const list = this.#stored();
    const existing = list.find((s) => s.id === id);
    if (existing) {
      if (agents) existing.agents = agents;
    } else {
      list.push({ id, agents: agents ?? ['*'] });
    }
    this.#save(list);
    this.#o.log.append({
      agent: 'system',
      type: 'mcp_server',
      data: {
        server: id,
        action: existing ? 'changed' : 'added',
        transport: 'http',
        by,
        message: existing
          ? providerStrings().viaClaudeChanged(entry.name)
          : providerStrings().viaClaudeAdded(entry.name),
      },
    });
    return this.view();
  }

  remove(id: string, by: Channel): ClaudeConnectionsResponse {
    const entry = this.#entry(id);
    const list = this.#stored();
    if (!list.some((s) => s.id === id)) return this.view();
    this.#save(list.filter((s) => s.id !== id));
    this.#o.log.append({
      agent: 'system',
      type: 'mcp_server',
      data: {
        server: id,
        action: 'removed',
        transport: 'http',
        by,
        message: providerStrings().viaClaudeRemoved(entry.name),
      },
    });
    return this.view();
  }

  /** The services an agent on Claude Agent gets in its run (none when the plan is off). */
  connectorsFor(agentId: string): HarnessConnector[] {
    if (!this.#o.ready()) return [];
    return this.#stored()
      .filter(
        (s) =>
          s.agents.includes(agentId) ||
          (s.agents.includes('*') && (this.#o.wildcard?.(agentId, s.id) ?? true)),
      )
      .flatMap((s) => partsOf(this.#entry(s.id)).map((p) => p.connector));
  }

  /** What a run's harness found at its start: the state of the chosen services. */
  noteRun(servers: { name: string; status: string }[]): void {
    const known = new Map<string, boolean>();
    for (const e of viaClaudeEntries()) {
      for (const p of partsOf(e)) known.set(p.key, p.connector.kind === 'http');
    }
    const update: Record<string, PartStatus> = {};
    for (const s of servers) {
      const firstParty = known.get(s.name);
      // Still connecting when the run started: says nothing about the account.
      if (firstParty === undefined || s.status === 'pending') continue;
      update[s.name] = fromInit(s.status, firstParty);
    }
    this.#setStatuses(update);
  }
}
