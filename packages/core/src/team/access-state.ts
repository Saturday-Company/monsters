import { MCP_CATALOG, type ClaudeConnectionView, type McpServerView } from '@monsters/shared';
import { WEB_TOOLS } from '../agents/archetypes.ts';
import type { AgentDefinition } from '../agents/definition.ts';
import type { AccessFact, AccessState, ClaimContext, ServiceFact } from './access-claims.ts';
import { accessPrompts } from './access.prompts.ts';
import type { TeamService } from './team-service.ts';

/*
 * The accesses of a monster now, from the settings and the tools of its run (D-140, D-141):
 * what the end-of-turn check compares the claims with, and the fingerprint whose change gives
 * the monster a note at its next run ("da ora hai…").
 */

const BROWSER_SERVER = 'browser';

export interface AccessStateDeps {
  team: Pick<
    TeamService,
    'projectOf' | 'members' | 'permissionsFor' | 'savedPermissionsFor' | 'get' | 'list'
  >;
  servers: () => readonly Pick<McpServerView, 'name' | 'label' | 'preset' | 'enabled'>[];
  /** The server is given to the monster now (assignment, project, web for the browser). */
  allowed: (agentId: string, server: string) => boolean;
  /** Why a server given to the monster has no tool in its run (`McpManager.missingWhy`, C-15). */
  missingWhy?: (
    agentId: string,
    server: string,
  ) => 'unlinked' | 'paused' | 'cut' | 'unlisted' | undefined;
  claude: () => readonly Pick<ClaudeConnectionView, 'id' | 'added' | 'state' | 'parts'>[];
  /** Connected and given to the whole squad, but not ticked in the monster's project (D-129). */
  notHere: (agent: AgentDefinition) => readonly string[];
  /** Why people other than the user ask in this run (a Telegram chat, D-114). */
  othersAsk: (runId: string) => string | undefined;
  /** The name the user gave ("Giulio"). */
  userName: () => string | undefined;
}

export interface RunAccessInput {
  agent: AgentDefinition;
  runId: string;
  /** Tools of the run: Monsters' own and `mcp__<server>__<tool>`. */
  toolNames: readonly string[];
  /** Services through Claude in the run (`claude.ai Canva`). */
  connectors?: readonly string[];
  /** The harness of the run (`claude-agent`, `codex`), if any. */
  harness?: string;
  /** A harness run with its terminal and files. */
  terminal?: boolean;
  /** Services given to it that do not answer now. */
  unlinked?: readonly string[];
}

/** What the fingerprint of the accesses called each built-in access in each family: data, not copy. */
const BUILT_IN_CAPS: Record<'capWeb' | 'capTerminal' | 'capBrowser', readonly string[]> = {
  capWeb: ['il web', 'web access'], // i18n-ignore
  // The first two are the names in use; the others are what an older version saved.
  capTerminal: ['comandi e file', 'commands and files', 'terminale e file', 'terminal and files'], // i18n-ignore
  capBrowser: ['il browser di Monsters', 'the Monsters browser'], // i18n-ignore
};

const connectorName = (name: string) => name.replace(/^claude\.ai\s+/i, '').trim();
const serverOf = (tool: string) => /^mcp__([A-Za-z0-9_-]+?)__[^_]/.exec(tool)?.[1];

const catalogName = (id: string) => MCP_CATALOG.find((e) => e.id === id)?.name ?? id;
/** "Gmail", "Google Drive" for «Gmail, Drive e Calendar». */
const catalogAliases = (e: (typeof MCP_CATALOG)[number]): string[] =>
  (e.viaClaude?.connectors ?? []).map((c) => c.name).filter((n) => n !== e.name);

/** The other monsters of an agent's squad. */
function squadOf(deps: AccessStateDeps, agent: AgentDefinition): AgentDefinition[] {
  return deps.team
    .members(deps.team.projectOf(agent.config.id)?.id)
    .filter((d) => d.config.id !== agent.config.id);
}

/** The names a claim may mention: services of the account and of the gallery, the squad, the user. */
export function claimContext(deps: AccessStateDeps, agent: AgentDefinition): ClaimContext {
  const services = new Map<string, { name: string; aliases?: string[] }>();
  const add = (name: string, aliases: string[] = []) => {
    if (!services.has(name.toLowerCase())) services.set(name.toLowerCase(), { name, aliases });
  };
  for (const s of deps.servers()) {
    if (s.preset !== BROWSER_SERVER) add(s.label, s.name !== s.label ? [s.name] : []);
  }
  for (const c of deps.claude())
    add(
      catalogName(c.id),
      c.parts.map((p) => p.name),
    );
  for (const e of MCP_CATALOG) add(e.name, catalogAliases(e));
  const user = deps.userName()?.trim();
  return {
    services: [...services.values()],
    // Every monster: "Nova non ha il web" is about Nova, whatever its squad.
    members: deps.team
      .list()
      .filter((d) => d.config.id !== agent.config.id)
      .map((d) => d.config.name),
    ...(user ? { userNames: [user] } : {}),
  };
}

function webFact(
  deps: AccessStateDeps,
  agent: AgentDefinition,
  has: boolean,
  squad: readonly AgentDefinition[],
): AccessFact {
  if (has) return { has: true };
  const id = agent.config.id;
  const p = deps.team.projectOf(id);
  if (!deps.team.savedPermissionsFor(id).web) {
    return {
      has: false,
      off: true,
      why: accessPrompts().webPermissionOff(),
    };
  }
  if (p && !p.webSearch) {
    return {
      has: false,
      off: true,
      why: accessPrompts().webOffInProject(p.name),
    };
  }
  const others = squad
    .filter((d) => d.config.id !== id && d.config.tools.some((t) => WEB_TOOLS.includes(t)))
    .map((d) => d.config.name);
  return {
    has: false,
    off: false,
    why: accessPrompts().webNotInRun(others),
  };
}

/** The accesses of a monster in a run, with the cause of what it lacks. */
export function accessState(deps: AccessStateDeps, input: RunAccessInput): AccessState {
  const { agent } = input;
  const id = agent.config.id;
  const names = new Set(input.toolNames);
  const project = deps.team.projectOf(id);
  const squad = squadOf(deps, agent);
  const permissions = deps.team.permissionsFor(id);

  const web = webFact(
    deps,
    agent,
    WEB_TOOLS.some((t) => names.has(t)),
    [agent, ...squad],
  );

  let terminal: AccessFact;
  if (names.has('shell') || input.terminal) terminal = { has: true };
  else if (!permissions.shell)
    terminal = {
      has: false,
      off: true,
      why: accessPrompts().terminalPermissionOff(),
    };
  else if (deps.othersAsk(input.runId))
    terminal = {
      has: false,
      off: true,
      why: accessPrompts().terminalOthersAsk,
    };
  else
    terminal = {
      has: false,
      off: false,
      why: accessPrompts().terminalNotInRun,
    };

  const servers = deps.servers();
  const inRun = new Set(input.toolNames.map(serverOf).filter((s): s is string => !!s));
  const browserServer = servers.find((s) => s.preset === BROWSER_SERVER);
  let browser: AccessFact | undefined;
  if (browserServer && inRun.has(browserServer.name)) browser = { has: true };
  else if (!browserServer || !browserServer.enabled)
    browser = {
      has: false,
      off: true,
      why: accessPrompts().browserOff(),
    };
  else if (!permissions.web)
    browser = { has: false, off: true, why: accessPrompts().browserNeedsWeb };
  else if (deps.allowed(id, browserServer.name))
    browser = { has: false, off: true, why: accessPrompts().browserNotResponding };
  else
    browser = {
      has: false,
      off: false,
      why: project
        ? accessPrompts().browserNotGivenProject(project.name)
        : accessPrompts().browserNotGiven(),
    };

  const services: ServiceFact[] = [];
  const push = (f: ServiceFact) => {
    if (!services.some((s) => s.name.toLowerCase() === f.name.toLowerCase())) services.push(f);
  };
  const notHere = new Set(project ? deps.notHere(agent) : []);
  const unlinked = new Set(input.unlinked ?? []);
  const ask = accessPrompts().askHow(
    agent.config.tools.includes('access_request'),
    agent.config.kind === 'lead',
  );
  const projectWhy = (name: string) => accessPrompts().serviceOnlyProject(name, project!.name, ask);
  for (const s of servers) {
    if (s.preset === BROWSER_SERVER) continue;
    const base = { name: s.label, ...(s.name !== s.label ? { aliases: [s.name] } : {}) };
    if (inRun.has(s.name)) push({ ...base, has: true });
    else if (unlinked.has(s.label) || (s.enabled && deps.allowed(id, s.name))) {
      // Given but not in the run: the cause the run had, never "not responding" by default (C-15).
      const missing = unlinked.has(s.label) ? 'unlinked' : deps.missingWhy?.(id, s.name);
      push({
        ...base,
        has: false,
        off: true,
        why:
          missing === 'paused'
            ? accessPrompts().servicePaused(s.label)
            : missing === 'cut'
              ? accessPrompts().serviceCut(s.label)
              : missing === 'unlisted'
                ? accessPrompts().serviceNotListed(s.label)
                : accessPrompts().serviceNotResponding(s.label),
      });
    } else if (!s.enabled)
      push({
        ...base,
        has: false,
        off: true,
        why: accessPrompts().serverOff(s.label),
      });
    else if (notHere.has(s.label))
      push({ ...base, has: false, off: false, project: true, why: projectWhy(s.label) });
    else
      push({
        ...base,
        has: false,
        off: false,
        why: accessPrompts().serviceNotGiven(s.label),
      });
  }
  const connectors = new Set((input.connectors ?? []).map((c) => connectorName(c).toLowerCase()));
  for (const c of deps.claude()) {
    if (!c.added) continue;
    const name = catalogName(c.id);
    const aliases = c.parts.map((p) => p.name).filter((n) => n !== name);
    const base = { name, ...(aliases.length ? { aliases } : {}) };
    if ([name, ...aliases].some((n) => connectors.has(n.toLowerCase())))
      push({ ...base, has: true });
    else if (c.state === 'needs_login' || c.state === 'missing')
      push({
        ...base,
        has: false,
        off: true,
        why: accessPrompts().viaClaudeReconnect(name),
      });
    else if (input.harness !== 'claude-agent')
      push({
        ...base,
        has: false,
        off: false,
        why: accessPrompts().viaClaudeOnlyClaude(name),
      });
    // The hub names it "(tramite Claude)" (a key of its own list, in both families).
    else if (notHere.has(`${name} (tramite Claude)`) || notHere.has(`${name} (through Claude)`))
      push({ ...base, has: false, off: false, project: true, why: projectWhy(name) });
    else
      push({
        ...base,
        has: false,
        off: false,
        why: accessPrompts().serviceNotGiven(name),
      });
  }
  // The gallery's services nobody connected: "non è collegato" is true.
  for (const e of MCP_CATALOG) {
    const aliases = catalogAliases(e);
    push({
      name: e.name,
      ...(aliases.length ? { aliases } : {}),
      has: false,
      off: true,
      why: accessPrompts().serviceNotConnected(e.name),
    });
  }

  // The squad first: "nessun mostro ha il web" is about it.
  const inSquad = new Set(squad.map((d) => d.config.id));
  const others = deps.team.list().filter((d) => d.config.id !== id && !inSquad.has(d.config.id));
  const members = [...squad, ...others].map((d) => ({
    name: d.config.name,
    squad: inSquad.has(d.config.id),
    web: webFact(
      deps,
      d,
      d.config.tools.some((t) => WEB_TOOLS.includes(t)),
      [d, ...squadOf(deps, d)],
    ),
  }));
  const user = deps.userName()?.trim();
  return {
    web,
    terminal,
    browser,
    services,
    members,
    ...(user ? { userNames: [user] } : {}),
  };
}

/**
 * What a monster may use, by its settings (not by the turn: the web the free chain leaves out
 * for one request, the terminal closed in a chat with other people, a server down for a moment
 * do not count): its change gives the next run a note (D-141).
 */
export function accessCaps(
  deps: AccessStateDeps,
  agent: AgentDefinition,
  run: { harness?: string; terminal?: boolean; connectors?: readonly string[] },
): string[] {
  const id = agent.config.id;
  const tools = deps.team.get(id)?.config.tools ?? agent.config.tools;
  const caps = new Set<string>();
  const t = accessPrompts();
  if (tools.some((t) => WEB_TOOLS.includes(t))) caps.add(t.capWeb);
  if (
    run.harness ? run.terminal : tools.includes('shell') || tools.some((t) => t.startsWith('fs_'))
  )
    caps.add(t.capTerminal);
  for (const s of deps.servers()) {
    if (!s.enabled || !deps.allowed(id, s.name)) continue;
    caps.add(s.preset === BROWSER_SERVER ? t.capBrowser : s.label);
  }
  for (const c of run.connectors ?? []) caps.add(connectorName(c));
  return [...caps].sort((a, b) => a.localeCompare(b));
}

/** The note of the first run after a change of accesses, or null (D-141). */
export function accessChangeNote(
  before: readonly string[] | undefined,
  now: readonly string[],
): string | null {
  if (!before) return null;
  // What was saved in the other language is the same access (the app's language changed).
  const own = (cap: string) => capsOf(cap);
  const was = before.map(own);
  const is = now.map(own);
  const gained = is.filter((c) => !was.includes(c));
  const lost = was.filter((c) => !is.includes(c));
  if (gained.length === 0 && lost.length === 0) return null;
  return accessPrompts().accessChanged(gained, lost);
}

/** The built-in accesses of the fingerprint ("il web", "web access"…) in the language in use. */
function capsOf(cap: string): string {
  const now = accessPrompts();
  for (const key of ['capWeb', 'capTerminal', 'capBrowser'] as const) {
    if (BUILT_IN_CAPS[key].includes(cap)) return now[key];
  }
  return cap;
}
