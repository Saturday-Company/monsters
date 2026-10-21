import { pick } from '@monsters/shared';

/*
 * The errors and hints of the web and system tools that a model reads (D-153). The Italian
 * family is the one the models have always read; the English one is its twin. They follow the
 * app's language at the moment they are written (the error is made when the call fails, never
 * at module load).
 */

const it = {
  /** The label of the headings `web_fetch` puts first when it returns passages of a long page. */
  headings: 'Intestazioni:',
  /** Why a site's refusal is nobody's setting, and what to do instead (`httpError`). */
  siteRefusedHint:
    "Non è un permesso dell'utente né di Monsters: il sito non accetta la lettura automatica e nessuno può attivarla da Monsters. " +
    "Prova un'altra fonte (web_search per un'altra pagina) oppure dillo nel resoconto.",
  /** The same when `web_fetch` itself was refused. */
  fetchRefusedHint:
    "Non è un permesso dell'utente né di Monsters: il sito non accetta la lettura automatica e nessuno può attivarla da Monsters. " +
    "Non aprire le sue altre pagine: usa quello che dicono gli snippet di web_search, oppure un'altra fonte, o dillo nel resoconto.",
  siteRefused: (site: string, status: number) =>
    `il sito ${site} ha rifiutato la lettura (HTTP ${status})`,
  pageRefused: (what: string, status: number) =>
    `${what}: il sito ha rifiutato la lettura (HTTP ${status})`,
  alreadyRefused: (host: string) => `il sito ${host} ha già rifiutato la lettura in questo compito`,
  instructionFilesDenied:
    'CLAUDE.md, AGENTS.md, .claude, .mcp.json e .codex della cartella del progetto (anche nelle sottocartelle) non si scrivono: sono le istruzioni del progetto, le cambia l’utente.',
  internalFilesDenied:
    'I file interni di Monsters non sono accessibili: usa gli strumenti di Monsters.',
  internalFilesTreeDenied:
    'Questo comando passerebbe dai file interni di Monsters: restringilo a una cartella precisa, oppure usa gli strumenti di Monsters.',
};

const en: typeof it = {
  headings: 'Headings:',
  siteRefusedHint:
    'This isn’t a setting of the user or of Monsters: the site doesn’t accept automatic reading and nobody can turn it on from Monsters. ' +
    'Try another source (web_search for another page) or say so in the report.',
  fetchRefusedHint:
    'This isn’t a setting of the user or of Monsters: the site doesn’t accept automatic reading and nobody can turn it on from Monsters. ' +
    'Don’t open its other pages: use what the web_search snippets say, or another source, or say so in the report.',
  siteRefused: (site, status) => `the site ${site} refused the reading (HTTP ${status})`,
  pageRefused: (what, status) => `${what}: the site refused the reading (HTTP ${status})`,
  alreadyRefused: (host) => `the site ${host} already refused the reading in this task`,
  instructionFilesDenied:
    'CLAUDE.md, AGENTS.md, .claude, .mcp.json and .codex in the project’s folder (also in the subfolders) are not written: they are the project’s instructions, the user changes them.',
  internalFilesDenied: 'The internal files of Monsters aren’t accessible: use the Monsters tools.',
  internalFilesTreeDenied:
    'This command would go through the internal files of Monsters: narrow it to a specific folder, or use the Monsters tools.',
};

export const toolPrompts = () => pick({ en, it });
