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
  SETTINGS_LABEL,
  SETTINGS_TABS,
  projectPagePath,
  settingsPath,
} from '@monsters/shared';

/** What a harness gives besides Monsters' tools (Claude Code, Codex). */
export interface HarnessCapabilities {
  /** `claude-agent` or `codex`: Codex's commands have no network (its sandbox). */
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

/** "A", "A e B", "A, B e C". */
function listWords(items: readonly string[]): string {
  return items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} e ${items.at(-1)!}`;
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
  const names = new Set(options.toolNames);
  const has = (n: string) => names.has(n);
  const any = (prefix: string) => options.toolNames.some((n) => n.startsWith(prefix));
  const h = options.harness;
  const can: string[] = [];
  const cannot: string[] = [];

  // Tools that wait for a search (D-098, D-134): the card names them, `tools_search` loads them.
  const later = new Set(options.searched ?? []);
  const load = (names: string[]) =>
    names.some((n) => later.has(n)) ? ' (prima caricali con `tools_search`)' : '';
  if (any('vault_')) {
    const writes = has('vault_write') || has('vault_edit') || has('vault_propose');
    can.push(`note: cerchi${writes ? ', leggi e scrivi' : ' e leggi'} (\`vault_*\`)`);
  }
  const webSearch = has('web_search') || h?.ownWebSearch === true;
  if (webSearch || has('web_fetch')) {
    const search = h?.ownWebSearch ? 'la tua ricerca web' : '`web_search`';
    can.push(
      webSearch && has('web_fetch')
        ? `web: ${search}, pagine con \`web_fetch\`${load(['web_search', 'web_fetch'])}`
        : webSearch
          ? `web: ${search}${load(['web_search'])}`
          : `web: pagine con \`web_fetch\`${load(['web_fetch'])}`,
    );
  } else {
    cannot.push(webMissing(options, has('delegate'), has('access_request')));
  }
  if (has('preview_show')) can.push('anteprima: mostri note e file (`preview_show`)');
  // The profile of Monsters' browser keeps the sign-ins the user made there (D-131).
  if (any(`mcp__${BROWSER_SERVER}__`)) {
    can.push(
      'browser: usi siti veri nel browser di Monsters, con gli accessi che l’utente ci ha fatto (es. Instagram): leggi e prepari; prima di Pubblica, Condividi, Invia o Paga Monsters chiede all’utente',
    );
  }
  if (h?.terminal) {
    // Codex's sandbox keeps the network closed to its commands (M3 of the review of 19/10).
    can.push(
      `terminale e file: nella cartella di questo lavoro${h.id === 'codex' ? ' (i comandi non hanno rete: per il web usa gli strumenti web)' : ''}`,
    );
  } else if (has('shell') || any('fs_')) {
    can.push('terminale e file: solo nelle cartelle concesse (`shell`, `fs_*`)');
  }
  if (has('artifact_create'))
    can.push('pagine HTML per l’utente, tra i suoi File (`artifact_create`)');
  if (has('delegate')) can.push('squadra: deleghi agli altri mostri (`delegate`)');
  if (has('ask_user')) can.push('domande all’utente (`ask_user`)');
  const projects = ['project_propose', 'project_send', 'project_status'].filter(has);
  if (projects.length > 0) {
    const parts = [
      ...(has('project_propose')
        ? [
            'proponi un progetto nuovo come bozza (`project_propose`: mostri nuovi, con nomi mai usati; copi un mostro esistente solo se l’utente lo chiede)',
          ]
        : []),
      ...(has('project_send')
        ? ['passi lavoro al capo di un progetto (`project_send`, `project_status`)']
        : []),
    ];
    can.push(`progetti: ${parts.join('; ')}${load(projects)}`);
  }
  if (has('automation_propose')) {
    can.push(
      `lavori che si ripetono a orario: proponi un’automazione come bozza (\`automation_propose\`)${load(['automation_propose'])}`,
    );
  }
  if (has('project_docs_propose')) {
    can.push(
      `CLAUDE.md e AGENTS.md della cartella del progetto: non li scrivi, proponi il testo nuovo (\`project_docs_propose\`), l’utente lo applica${load(['project_docs_propose'])}`,
    );
  }
  if (has('access_request')) {
    can.push(
      'accessi che mancano alla squadra (il web a un mostro, un servizio già collegato all’account, il browser): li chiedi all’utente con `access_request`, lui tocca «Sì, concedi»',
    );
  }
  if (has('team_propose_monster')) {
    can.push('nuovi mostri: proponi una bozza (`team_propose_monster`), l’utente la crea');
  }
  const services = [...mcpServers(options.toolNames), ...(h?.connectors ?? []).map(connectorName)];
  if (services.length > 0) {
    // Many tools of a service wait for a search (C.2): the monster must know they exist.
    const search =
      (options.mcpSearch ?? has('tools_search'))
        ? ' (molti strumenti: cercali con `tools_search`)'
        : '';
    can.push(`servizi collegati: ${[...new Set(services)].join(', ')}${search}`);
  } else {
    // The cause and where it changes (D-132), never a bare «non hai» the model fills in.
    cannot.push(
      options.project
        ? `servizi collegati (nessuno è acceso per questo progetto: li accende l’utente nella ${projectPagePath(options.project, 'collegamenti')})`
        : `servizi collegati (nessuno è dato a te: li collega e li dà l’utente in ${settingsPath('altriProgrammi')})`,
    );
  }
  // Own tools that wait for this turn (D-134): there, loadable, never "non ce l'ho".
  const waiting = (options.searched ?? []).filter(
    (n) => !OWN_DEFERRED_LINES.has(n) && !n.startsWith('web_'),
  );
  if (waiting.length > 0) {
    can.push(`anche, da caricare con \`tools_search\` quando servono: ${waiting.join(', ')}`);
  }

  const lines = [
    '## Monsters',
    'Sei in Monsters: mostri AI che lavorano per l’utente sul suo computer; lui li segue dall’app.',
    'Puoi:',
    ...can.map((c) => `- ${c}`),
  ];
  if (cannot.length > 0) lines.push(`Non hai: ${cannot.join('; ')}.`);
  for (const c of options.cut ?? []) {
    lines.push(
      `Di ${c.server} vedi ${c.shown} strumenti su ${c.total} (limite di strumenti di questo lavoro): gli altri non sono tra i tuoi, non è un no dell’utente.`,
    );
  }
  const unlinked = [...new Set(options.unlinked ?? [])];
  if (unlinked.length === 1) {
    lines.push(
      `${unlinked[0]!} non risponde ora (accesso scaduto o un errore): i suoi strumenti mancano. Se ti serve, chiedi all’utente di ricollegarlo in ${settingsPath('altriProgrammi')}.`,
    );
  } else if (unlinked.length > 1) {
    lines.push(
      `${listWords(unlinked)} non rispondono ora (accesso scaduto o un errore): i loro strumenti mancano. Se ti servono, chiedi all’utente di ricollegarli in ${settingsPath('altriProgrammi')}.`,
    );
  }
  // The capo squadra's AGENTS.md says it already ("Senza uno strumento che pubblica…").
  if (!has('delegate')) {
    lines.push(
      'Senza uno strumento apposta non pubblichi, non invii mail o messaggi, non paghi: prepari bozze.',
    );
  }
  // The names the app shows, word for word (review of 16/10: "sezione Mostri" does not exist).
  const t = SETTINGS_TABS;
  lines.push(
    `Solo l’utente, in ${SETTINGS_LABEL}: ${t.squadra} (creare, cambiare e archiviare mostri; chi è lui per voi), ${t.modelli} (modelli e spesa; tu non la vedi), ${t.permessi}, ${t.collegamenti} (servizi, Telegram).${
      options.project
        ? ` Per il progetto «${options.project}» la pagina del progetto: schede ${PROJECT_TABS.squadra}, ${PROJECT_TABS.collegamenti} (servizi e ricerca sul web) e ${PROJECT_TABS.spesa} (tetto di spesa).`
        : ''
    } Nella barra a sinistra anche Note, File (allegati e pagine) e Attività. Se te lo chiede, usa questi nomi e rispondi da qui, non dai file.`,
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
  const who = [...new Set(o.webElsewhere ?? [])];
  if (o.webOff === 'permission') {
    const ask = asks ? ', o lo chiedi tu con `access_request`' : '';
    return `web (spento per te: lo accende l’utente in ${settingsPath('ilWeb')}${ask}${who.length > 0 ? `, e intanto ce l’ha ${listWords(who)}` : ''})`;
  }
  if (o.webOff === 'project') {
    return `web (la ricerca sul web è spenta per il progetto${o.project ? ` «${o.project}»` : ''}: la accende l’utente nella ${o.project ? projectPagePath(o.project, 'collegamenti') : 'pagina del progetto'}${asks ? ', o la chiedi tu con `access_request`' : ''})`;
  }
  if (who.length > 0) {
    // Who has it (D-127): not "denied in this session", just not this monster's tool.
    return `web (ce l’ha ${listWords(who)}${delegates ? ': delega la ricerca' : ''})`;
  }
  if (o.webElsewhere) return 'web (nessuno nella squadra ce l’ha)';
  return 'web';
}
