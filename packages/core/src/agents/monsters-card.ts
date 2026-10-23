/*
 * The "## Monsters" card of the system prompt (D-075): what Monsters is, what
 * this monster can do there (from the tools it really has, grouped by what they
 * do) and what only the user does from the app. Generated, not written by hand,
 * so it follows the permissions and the connections; nothing volatile in it (no
 * time, no counters), so two runs of the same monster send the same prefix and
 * the providers keep it cached. Before it, a monster asked "puoi creare un
 * mostro?" went to read the files of Monsters on disk (16/10/2026, ~125k tokens).
 */

import {
  PROJECT_TABS,
  settingsLabel,
  SETTINGS_TABS,
  projectPagePath,
  settingsPath,
} from '@monsters/shared';
import { accessStrings } from '../team/access.strings.ts';
import { listIn, monstersCardPrompts } from './monsters-card.prompts.ts';

/** What a harness gives besides Monsters' tools (Claude Code, Codex). */
export interface HarnessCapabilities {
  /** `claude-agent` or `codex`: Codex's commands reach the network by asking Monsters (D-158). */
  id?: string;
  /** Its own web search replaces `web_search`. */
  ownWebSearch: boolean;
  /** Its terminal and files in the working folder (the `shell` permission). */
  terminal: boolean;
  /** Services reached through the user's account (claude.ai connectors). */
  connectors: readonly string[];
}

export interface MonstersCardOptions {
  /** Tools of the run (Monsters' own, and `mcp__<server>__<tool>` of connected programs). */
  toolNames: readonly string[];
  harness?: HarnessCapabilities;
  /** The MCP tools wait for `tools_search` (C.2); default: `tools_search` is there. */
  mcpSearch?: boolean;
  /** Monsters' own tools that wait for `tools_search` (D-098). */
  searched?: readonly string[];
  /**
   * Services given to this monster whose tools it does not get now (not
   * signed in, refused, failing; connettori 6): it tells the user instead of
   * looking for them.
   */
  unlinked?: readonly string[];
  /**
   * The monsters of the squad that have the web, when this one has none
   * (D-127): it knows who to ask instead of believing the web is denied.
   * Undefined: not known (the old words).
   */
  webElsewhere?: readonly string[];
}

/** What the core knows of a run beyond its tools, for the card's causes (D-132). */
export interface CardContext {
  /**
   * Why this monster has no web: the squad has researchers (D-026), its web permission is
   * off, or its project's web search is off. The card says the cause and who changes it,
   * so the model never makes one up.
   */
  webOff?: 'covered' | 'permission' | 'project';
  /** The project of a project's monster (D-097): its squad, services and cap are on its page. */
  project?: string;
  /** MCP servers whose tools are more than this run takes (M1 of the review of 19/10). */
  cut?: readonly { server: string; shown: number; total: number }[];
}

const BROWSER_SERVER = 'browser';

/** Servers of the `mcp__<server>__<tool>` tools, sorted (the browser apart). */
function mcpServers(toolNames: readonly string[]): string[] {
  const out = new Set<string>();
  for (const n of toolNames) {
    // Any server name: upper case and `_` too (`mcp__Anteiku_Prod__list_tasks`).
    const m = /^mcp__([A-Za-z0-9_-]+?)__[^_]/.exec(n);
    if (m?.[1] && m[1] !== BROWSER_SERVER) out.add(m[1]);
  }
  return [...out].sort();
}

/** "claude.ai Gmail" → "Gmail". */
const connectorName = (name: string) => name.replace(/^claude\.ai\s+/i, '').trim();

export function monstersCard(options: MonstersCardOptions & CardContext): string {
  const p = monstersCardPrompts();
  const names = new Set(options.toolNames);
  const has = (n: string) => names.has(n);
  const any = (prefix: string) => options.toolNames.some((n) => n.startsWith(prefix));
  const h = options.harness;
  const can: string[] = [];
  const cannot: string[] = [];

  // Tools that wait for a search (D-098, D-134): the card names them, `tools_search` loads them.
  const later = new Set(options.searched ?? []);
  const load = (names: string[]) => (names.some((n) => later.has(n)) ? p.loadFirst : '');
  if (any('vault_')) {
    const writes = has('vault_write') || has('vault_edit') || has('vault_propose');
    can.push(p.vault(writes));
  }
  const webSearch = has('web_search') || h?.ownWebSearch === true;
  if (webSearch || has('web_fetch')) {
    const search = h?.ownWebSearch ? p.ownSearch : '`web_search`';
    const named = has('web_fetch') ? p.fetchNamed : '';
    can.push(
      (webSearch && has('web_fetch')
        ? p.webBoth(search, load(['web_search', 'web_fetch']))
        : webSearch
          ? p.webSearch(search, load(['web_search']))
          : p.webFetch(load(['web_fetch']))) + named,
    );
    // Pages without the search (D-161): the orchestrator and the leads read what the user names,
    // the squad's researchers search.
    const who = [...new Set(options.webElsewhere ?? [])];
    if (!webSearch && who.length > 0) {
      cannot.push(p.searchElsewhere(listIn(who), who.length, has('delegate')));
    }
  } else {
    cannot.push(webMissing(options, has('delegate'), has('access_request')));
  }
  if (has('preview_show')) can.push(p.preview);
  // The profile of Monsters' browser keeps the sign-ins the user made there (D-131).
  if (any(`mcp__${BROWSER_SERVER}__`)) can.push(p.browser);
  if (h?.terminal) {
    // Codex's sandbox has no network: a command asks Monsters to leave it (D-158).
    can.push(p.terminalHere(h.id === 'codex'));
  } else if (has('shell') || any('fs_')) {
    can.push(p.terminalGranted);
  }
  if (has('artifact_create')) can.push(p.artifact);
  // Drawn blocks (D-162): one line; the manual is the `ui_guide` tool, or attached to the turn.
  if (has('ui_guide')) can.push(p.uiDraw);
  if (has('delegate')) can.push(p.delegate);
  if (has('ask_user')) can.push(p.askUser);
  const projects = ['project_propose', 'project_send', 'project_status'].filter(has);
  if (projects.length > 0) {
    const parts = [
      ...(has('project_propose') ? [p.projectPropose] : []),
      ...(has('project_send') ? [p.projectSend] : []),
    ];
    can.push(p.projects(parts, load(projects)));
  }
  if (has('automation_propose')) can.push(p.automation(load(['automation_propose'])));
  if (has('project_docs_propose')) can.push(p.docs(load(['project_docs_propose'])));
  // The button the user taps is quoted from the dictionary that shows it.
  if (has('access_request')) can.push(p.access(accessStrings().grant));
  if (has('team_propose_monster')) can.push(p.teamMonster);
  const services = [...mcpServers(options.toolNames), ...(h?.connectors ?? []).map(connectorName)];
  if (services.length > 0) {
    // Many tools of a service wait for a search (C.2): the monster must know they exist.
    const search = (options.mcpSearch ?? has('tools_search')) ? p.searchServices : '';
    can.push(p.services([...new Set(services)].join(', '), search));
  } else {
    // The cause and where it changes (D-132), never a bare «non hai» the model fills in.
    cannot.push(
      options.project
        ? p.noServicesProject(projectPagePath(options.project, 'collegamenti'))
        : p.noServices(settingsPath('altriProgrammi')),
    );
  }
  // Own tools that wait for this turn (D-134): there, loadable, never "non ce l'ho".
  const waiting = (options.searched ?? []).filter(
    (n) => !OWN_DEFERRED_LINES.has(n) && !n.startsWith('web_'),
  );
  if (waiting.length > 0) can.push(p.loadable(waiting.join(', ')));

  const lines = [p.head, p.intro, p.youCan, ...can.map((c) => `- ${c}`)];
  if (cannot.length > 0) lines.push(p.youDontHave(cannot.join('; ')));
  for (const c of options.cut ?? []) lines.push(p.cut(c.server, c.shown, c.total));
  const unlinked = [...new Set(options.unlinked ?? [])];
  if (unlinked.length === 1) {
    lines.push(p.unlinkedOne(unlinked[0]!, settingsPath('altriProgrammi')));
  } else if (unlinked.length > 1) {
    lines.push(p.unlinkedMany(listIn(unlinked), settingsPath('altriProgrammi')));
  }
  // The capo squadra's AGENTS.md says it already ("Senza uno strumento che pubblica…").
  if (!has('delegate')) lines.push(p.noPublish);
  // The names the app shows, word for word (review of 16/10: "sezione Mostri" does not exist).
  const t = SETTINGS_TABS;
  lines.push(
    p.onlyUser(settingsLabel(), {
      squad: t.squadra,
      models: t.modelli,
      permissions: t.permessi,
      connections: t.collegamenti,
    }) +
      (options.project
        ? p.onlyUserProject(options.project, {
            squad: PROJECT_TABS.squadra,
            connections: PROJECT_TABS.collegamenti,
            spending: PROJECT_TABS.spesa,
          })
        : '') +
      p.sidebar,
  );
  return lines.join('\n');
}

/** Own deferred tools that a line of their own already names (projects, automations, docs). */
const OWN_DEFERRED_LINES: ReadonlySet<string> = new Set([
  'project_send',
  'project_status',
  'project_propose',
  'automation_propose',
  'project_docs_propose',
]);

/**
 * The "Non hai" of the web, with the cause and who changes it (D-127, D-132): never a
 * "delega" towards nobody, never a cause the core does not know.
 */
function webMissing(
  o: MonstersCardOptions & CardContext,
  delegates: boolean,
  asks: boolean,
): string {
  const p = monstersCardPrompts();
  const who = [...new Set(o.webElsewhere ?? [])];
  if (o.webOff === 'permission') {
    return p.webOffPermission(settingsPath('ilWeb'), asks, who, listIn(who));
  }
  if (o.webOff === 'project') {
    return p.webOffProject(
      o.project,
      o.project ? projectPagePath(o.project, 'collegamenti') : p.projectPageWord,
      asks,
    );
  }
  if (who.length > 0) {
    // Who has it (D-127): not "denied in this session", just not this monster's tool.
    return p.webElsewhere(listIn(who), who.length, delegates);
  }
  if (o.webElsewhere) return p.webNobody;
  return 'web';
}
