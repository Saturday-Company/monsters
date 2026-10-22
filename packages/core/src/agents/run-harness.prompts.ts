import { pick, type Lang } from '@monsters/shared';

/*
 * What a model on a harness (Claude Code, Codex) reads from Monsters (D-153): the section that
 * says where Monsters' tools are and what the web of the run is, the recent conversation, the
 * refusal of a change of the harness configuration. Two families, the one of the app's language
 * when the text is produced. The Italian one is byte for byte what it was. The names of the
 * settings come in as parameters, taken from the dictionaries that show them.
 */

const en = {
  head: '## Monsters tools',
  vaultPart: 'The user’s notes',
  webPart: 'the web',
  squadPart: 'the squad',
  and: 'and',
  here: (parts: readonly string[], server: string, and: string) =>
    `${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${and} ${parts.at(-1)!} are` : `${parts[0]!} is`} in the MCP server ${server}: use those for notes, not files on disk.`,
  webOwn: (claude: boolean, server: string) =>
    `To search the web use your own search (${claude ? 'WebSearch' : 'web_search'}); to read a page use \`web_fetch\` of ${server}${claude ? ' (Claude Code’s WebFetch is not among your tools)' : ''}. \`web_search\` of ${server} only if your search fails or is not available.`,
  webSearchPart: '`web_search` (to search)',
  webFetchPart: '`web_fetch` (to read a page)',
  webOnly: (own: string, server: string, claude: boolean) =>
    `For the web use ${own} of ${server}${claude ? ': Claude Code’s WebSearch and WebFetch are not among your tools' : ''}.`,
  webNone: (who: string, n: number, team: boolean) =>
    `The web is not among your tools${
      n > 0
        ? `: ${who} ${n > 1 ? 'have' : 'has'} it. If needed, ${team ? 'delegate the search to whoever has it' : 'write it in the report: the search is done by whoever has it'}`
        : ''
    }. It is not a ban from the user nor a block of the session: do not say that the web was denied to you.`,
  codexAsk: (ask: boolean, server: string) =>
    `To ask the user something ${ask ? `use \`ask_user\` of ${server}` : 'write the question in the report'}: Codex’s \`request_user_input\` reaches nobody.`,
  codexNetwork:
    'Your commands run in Codex’s sandbox, without network. When one needs it (npm install, git clone or push, curl), run it with `sandbox_permissions: "require_escalated"` and a short `justification`: Monsters checks it and lets it run, also after a “Could not resolve host”. If Monsters stops a command, Codex says “rejected by user”: the real reason follows in a [Monsters] note.',
  claudeBuiltins:
    'The built-in tools of Claude Code that you don’t have are not part of this run: if one shows as denied, the user did not deny it.',
  claudeRule: (docs: boolean) =>
    `“denied by your permission settings” is a fixed rule of Monsters (its data, the Claude Code and Codex configuration in the folders, the folders closed to this job), not a permission of the user: do not ask them to change it${docs ? '; for the CLAUDE.md and AGENTS.md of a project, propose the text with `project_docs_propose`' : ''}.`,
  recent: '## Recent conversation',
  userLabel: 'User',
  youLabel: 'You',
  configDenied: (settings: string) =>
    `The Claude Code and Codex configuration in your folder (.claude, .mcp.json, CLAUDE.md, AGENTS.md, .codex) is not written: the user changes your rules in ${settings}. For the CLAUDE.md or AGENTS.md of a project’s folder, propose the new text with \`project_docs_propose\`: the user applies it.`,
  // Where a result comes from (the envelope of external data and Activity)
  sourcePlanSearch: (query: string) => `the subscription’s web search: ${query}`,
  sourceViaClaude: (server: string, tool: string) => `${server} (via Claude): ${tool}`,
};

const it: typeof en = {
  head: '## Strumenti di Monsters',
  vaultPart: "Il vault dell'utente",
  webPart: 'il web',
  squadPart: 'la squadra',
  and: 'e',
  here: (parts, server, and) =>
    `${parts.length > 1 ? `${parts.slice(0, -1).join(', ')} ${and} ${parts.at(-1)!} sono` : `${parts[0]!} è`} nel server MCP ${server}: usa quelli per le note, non file sul disco.`,
  webOwn: (claude, server) =>
    `Per cercare sul web usa la tua ricerca (${claude ? 'WebSearch' : 'web_search'}); per leggere una pagina usa \`web_fetch\` di ${server}${claude ? ' (WebFetch di Claude Code non è tra i tuoi strumenti)' : ''}. \`web_search\` di ${server} solo se la tua ricerca fallisce o non è disponibile.`,
  webSearchPart: '`web_search` (cercare)',
  webFetchPart: '`web_fetch` (leggere una pagina)',
  webOnly: (own, server, claude) =>
    `Per il web usa ${own} di ${server}${claude ? ': WebSearch e WebFetch di Claude Code non sono tra i tuoi strumenti' : ''}.`,
  webNone: (who, n, team) =>
    `Il web non è tra i tuoi strumenti${
      n > 0
        ? `: ce l’ha ${who}. Se serve, ${team ? 'delega la ricerca a chi ce l’ha' : 'scrivilo nel rapporto: la ricerca la fa chi ce l’ha'}`
        : ''
    }. Non è un divieto dell’utente né un blocco della sessione: non dire che il web ti è stato negato.`,
  codexAsk: (ask, server) =>
    `Per chiedere qualcosa all’utente ${ask ? `usa \`ask_user\` di ${server}` : 'scrivi la domanda nel rapporto'}: \`request_user_input\` di Codex non arriva a nessuno.`,
  codexNetwork:
    'I tuoi comandi girano nella sandbox di Codex, senza rete. Quando a uno serve (npm install, git clone o push, curl), lancialo con `sandbox_permissions: "require_escalated"` e una breve `justification`: Monsters lo controlla e lo fa partire, anche dopo un «Could not resolve host». Se Monsters ferma un comando, Codex dice «rejected by user»: il motivo vero segue in una nota [Monsters].',
  claudeBuiltins:
    'Gli strumenti integrati di Claude Code che non hai non sono di questa run: se uno risulta negato, non l’ha negato l’utente.',
  claudeRule: (docs) =>
    `«denied by your permission settings» è una regola fissa di Monsters (i suoi dati, la configurazione di Claude Code e Codex nelle cartelle, le cartelle chiuse a questo lavoro), non un permesso dell’utente: non chiedergli di cambiarlo${docs ? '; per CLAUDE.md e AGENTS.md di un progetto proponi il testo con `project_docs_propose`' : ''}.`,
  recent: '## Conversazione recente',
  userLabel: 'Utente',
  youLabel: 'Tu',
  configDenied: (settings) =>
    `La configurazione di Claude Code e Codex nella tua cartella (.claude, .mcp.json, CLAUDE.md, AGENTS.md, .codex) non si scrive: le tue regole le cambia l’utente in ${settings}. Per CLAUDE.md o AGENTS.md della cartella di un progetto proponi il testo nuovo con \`project_docs_propose\`: lo applica l’utente.`,
  // Where a result comes from (the envelope of external data and Activity)
  sourcePlanSearch: (query: string) => `ricerca sul web dell'abbonamento: ${query}`,
  sourceViaClaude: (server: string, tool: string) => `${server} (tramite Claude): ${tool}`,
};

export const runHarnessPrompts = (lang?: Lang) => pick({ en, it }, lang);

/** "A", "A and B", "A, B and C" (`e` in the Italian family). */
export function listWords(items: readonly string[], lang?: Lang): string {
  const and = runHarnessPrompts(lang).and;
  return items.length < 2
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} ${and} ${items.at(-1)!}`;
}
