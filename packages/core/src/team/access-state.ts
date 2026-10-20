import { MCP_CATALOG, type ClaudeConnectionView, type McpServerView } from '@monsters/shared';
import { WEB_TOOLS } from '../agents/archetypes.ts';
import type { AgentDefinition } from '../agents/definition.ts';
import type { AccessFact, AccessState, ClaimContext, ServiceFact } from './access-claims.ts';
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

const connectorName = (name: string) => name.replace(/^claude\.ai\s+/i, '').trim();
const serverOf = (tool: string) => /^mcp__([A-Za-z0-9_-]+?)__[^_]/.exec(tool)?.[1];
const list = (items: readonly string[]) =>
  items.length < 2 ? (items[0] ?? '') : `${items.slice(0, -1).join(', ')} e ${items.at(-1)!}`;
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

const NOT_USER = 'non per un no dell’utente';

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
      why: 'il permesso «Il web» è spento: lo accende l’utente in Impostazioni → Permessi',
    };
  }
  if (p && !p.webSearch) {
    return {
      has: false,
      off: true,
      why: `la ricerca sul web è spenta nel progetto «${p.name}»: si accende nella pagina del progetto, scheda Collegamenti`,
    };
  }
  const others = squad
    .filter((d) => d.config.id !== id && d.config.tools.some((t) => WEB_TOOLS.includes(t)))
    .map((d) => d.config.name);
  return {
    has: false,
    off: false,
    why: others.length
      ? `non è tra gli strumenti di questo lavoro (${NOT_USER}: il permesso è acceso), ce l’hanno ${list(others)}`
      : `non è tra gli strumenti di questo lavoro (${NOT_USER}: il permesso è acceso)`,
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
      why: 'il permesso «Terminale e cartelle» è spento: lo accende l’utente in Impostazioni → Permessi',
    };
  else if (deps.othersAsk(input.runId))
    terminal = {
      has: false,
      off: true,
      why: 'in questa chat di Telegram scrivono altre persone: terminale e file sono chiusi',
    };
  else
    terminal = {
      has: false,
      off: false,
      why: `non sono tra gli strumenti di questo lavoro (${NOT_USER})`,
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
      why: 'il browser di Monsters è spento: lo accende l’utente in Impostazioni → Collegamenti → Altri programmi',
    };
  else if (!permissions.web)
    browser = { has: false, off: true, why: 'il browser vuole il permesso del web, che è spento' };
  else if (deps.allowed(id, browserServer.name))
    browser = { has: false, off: true, why: 'il browser non risponde ora' };
  else
    browser = {
      has: false,
      off: false,
      why: project
        ? `il browser è acceso ma non è dato a te: si dà nella pagina del progetto «${project.name}», scheda Collegamenti`
        : 'il browser è acceso ma non è dato a te: lo dà l’utente in Impostazioni → Collegamenti',
    };

  const services: ServiceFact[] = [];
  const push = (f: ServiceFact) => {
    if (!services.some((s) => s.name.toLowerCase() === f.name.toLowerCase())) services.push(f);
  };
  const notHere = new Set(project ? deps.notHere(agent) : []);
  const unlinked = new Set(input.unlinked ?? []);
  const ask = agent.config.tools.includes('access_request')
    ? ' (puoi chiederlo con `access_request`)'
    : agent.config.kind === 'lead'
      ? ''
      : ' (chiedilo al tuo capo)';
  const projectWhy = (name: string) =>
    `${name} è collegato all’account dell’utente ma non a questo progetto: si dà nella pagina del progetto «${project!.name}», scheda Collegamenti${ask}`;
  for (const s of servers) {
    if (s.preset === BROWSER_SERVER) continue;
    const base = { name: s.label, ...(s.name !== s.label ? { aliases: [s.name] } : {}) };
    if (inRun.has(s.name)) push({ ...base, has: true });
    else if (unlinked.has(s.label) || (s.enabled && deps.allowed(id, s.name)))
      push({
        ...base,
        has: false,
        off: true,
        why: `${s.label} non risponde ora (accesso scaduto o un errore): si ricollega in Impostazioni → Collegamenti`,
      });
    else if (!s.enabled)
      push({
        ...base,
        has: false,
        off: true,
        why: `${s.label} è spento in Impostazioni → Collegamenti → Altri programmi`,
      });
    else if (notHere.has(s.label))
      push({ ...base, has: false, off: false, project: true, why: projectWhy(s.label) });
    else
      push({
        ...base,
        has: false,
        off: false,
        why: `${s.label} è collegato all’account dell’utente ma non è dato a te: lo dà l’utente in Impostazioni → Collegamenti`,
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
        why: `${name} (tramite Claude) va ricollegato: Impostazioni → Collegamenti`,
      });
    else if (input.harness !== 'claude-agent')
      push({
        ...base,
        has: false,
        off: false,
        why: `${name} è collegato tramite Claude: arriva solo ai mostri che lavorano con Claude`,
      });
    else if (notHere.has(`${name} (tramite Claude)`))
      push({ ...base, has: false, off: false, project: true, why: projectWhy(name) });
    else
      push({
        ...base,
        has: false,
        off: false,
        why: `${name} è collegato all’account dell’utente ma non è dato a te: lo dà l’utente in Impostazioni → Collegamenti`,
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
      why: `${e.name} non è collegato all’account: lo collega l’utente in Impostazioni → Collegamenti`,
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
  if (tools.some((t) => WEB_TOOLS.includes(t))) caps.add('il web');
  if (
    run.harness ? run.terminal : tools.includes('shell') || tools.some((t) => t.startsWith('fs_'))
  )
    caps.add('terminale e file');
  for (const s of deps.servers()) {
    if (!s.enabled || !deps.allowed(id, s.name)) continue;
    caps.add(s.preset === BROWSER_SERVER ? 'il browser di Monsters' : s.label);
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
  const gained = now.filter((c) => !before.includes(c));
  const lost = before.filter((c) => !now.includes(c));
  if (gained.length === 0 && lost.length === 0) return null;
  const parts = [
    ...(gained.length ? [`da ora hai ${list(gained)}`] : []),
    ...(lost.length ? [`non hai più ${list(lost)}`] : []),
  ];
  return `[Accessi cambiati] L’utente ha cambiato i tuoi accessi: ${parts.join('; ')}. Vale la sezione «## Monsters» di adesso: quello che memoria, note e conversazione dicono sugli accessi è di prima del cambio.`;
}
