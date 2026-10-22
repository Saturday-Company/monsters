/*
 * The words around the text pages: documentation index and guide pages, changelog. The guides and
 * the changelogs themselves are read from the repository at build time (src/lib/docs.ts). The
 * guides exist only in English, so the Italian index says so. The Italian dictionary has the
 * English one's type, so a missing key fails the typecheck.
 */
import type { GuideSlug } from '../lib/docs.ts';
import type { Lang } from './strings.ts';

const en = {
  crumbHome: 'Monsters',
  docs: {
    crumb: 'Docs',
    title: 'Documentation',
    metaTitle: 'Monsters documentation: architecture, security, MCP, remote use',
    description:
      'The guides to Monsters, an open-source app that runs a team of AI agents on your computer: architecture, security model, subscriptions, the vault as an MCP server, and remote use over SSH and Telegram.',
    lede: 'The guides for people who use Monsters. They are read from the repository when the site is built, so they are always the ones in the code.',
    englishOnly: '',
    read: 'Read the guide',
    summaries: {
      architecture:
        'How Monsters is built: one local core, the event log, the kill switch, the orchestrator and its agents, the providers, the tools and the Markdown vault.',
      'security-model':
        'The perimeter, the threat model and the risks Monsters accepts: the local core, permissions, the action log, the kill switch and what the terminal permission really means.',
      subscriptions:
        'How to use the ChatGPT, Codex and Claude subscriptions you already pay for, and what Monsters does and does not do with them.',
      'mcp-vault':
        'Serve your Monsters notes to Claude Desktop, Codex, Cursor or Claude Code with `monsters mcp`: configuration, permissions and search.',
      remote:
        'Use Monsters from another computer or from your phone: the terminal chat over SSH, the desktop app as an SSH client, and Telegram bots.',
      roadmap:
        'Where Monsters has been and where it is going: finished phases, what is open before a stable release, and what comes later.',
    } satisfies Record<GuideSlug, string>,
    source:
      'These pages are generated from the Markdown files in the docs folder of the repository. To fix a mistake or add to a guide, open a pull request.',
    sourceLink: 'docs on GitHub',
    more: 'Also in the repository',
    moreItems: [
      [
        'Technical decisions',
        'docs/DECISIONS.md',
        'Every non-obvious choice, with context and rationale. Mostly in Italian.',
      ],
      ['Signing and updates', 'docs/signing.md', 'Packaging, signing and the signed update feed.'],
      [
        'Contributing',
        'CONTRIBUTING.md',
        'How to send a change, and the sign-off every commit needs.',
      ],
    ] as [string, string, string][],
  },
  guide: {
    onThisPage: 'On this page',
    all: 'All documentation',
    github: 'This guide on GitHub',
    updatedNote: 'Read from the repository when the site was built.',
    next: 'Next guide',
    metaSuffix: 'Monsters documentation',
  },
  changelog: {
    crumb: 'Changelog',
    title: 'Changelog',
    metaTitle: 'Monsters changelog: what changed in every release',
    description:
      'What changed in each release of Monsters, the open-source app that runs a team of AI agents on your computer. Written for people who use the app, newest first.',
    lede: 'What changed in each release, written for people who use the app. Monsters is in alpha, so releases are frequent.',
    latest: 'Latest',
    github: 'Releases and downloads on GitHub',
    file: 'This page is generated from CHANGELOG.md.',
    jump: 'Jump to a release',
  },
};

export type PagesStrings = typeof en;

const it: PagesStrings = {
  crumbHome: 'Monsters',
  docs: {
    crumb: 'Guide',
    title: 'Guide',
    metaTitle: 'Guide di Monsters: architettura, sicurezza, MCP, uso a distanza',
    description:
      'Le guide di Monsters, l’app open source che fa girare una squadra di agenti AI sul tuo computer: architettura, modello di sicurezza, abbonamenti, il vault come server MCP e l’uso a distanza con SSH e Telegram.',
    lede: 'Le guide per chi usa Monsters. Vengono lette dalla repository quando si costruisce il sito, quindi sono sempre quelle che stanno nel codice.',
    englishOnly:
      'Le guide sono scritte solo in inglese e restano in inglese anche qui. Questa pagina le elenca in italiano; ogni guida si apre nella versione inglese.',
    read: 'Leggi la guida (in inglese)',
    summaries: {
      architecture:
        'Come è fatto Monsters: un core locale, il registro degli eventi, l’interruttore di emergenza, l’orchestratore e i suoi agenti, i provider, gli strumenti e il vault Markdown.',
      'security-model':
        'Il perimetro, il modello delle minacce e i rischi che Monsters accetta: il core locale, i permessi, il registro delle azioni, l’interruttore di emergenza e cosa significa davvero il permesso del terminale.',
      subscriptions:
        'Come usare gli abbonamenti a ChatGPT, Codex e Claude che già paghi, e cosa fa e non fa Monsters con loro.',
      'mcp-vault':
        'Servire le note di Monsters a Claude Desktop, Codex, Cursor o Claude Code con `monsters mcp`: configurazione, permessi e ricerca.',
      remote:
        'Usare Monsters da un altro computer o dal telefono: la chat da terminale via SSH, l’app desktop come client SSH e i bot di Telegram.',
      roadmap:
        'Da dove viene Monsters e dove va: le fasi concluse, cosa resta aperto prima di una versione stabile e cosa verrà dopo.',
    },
    source:
      'Queste pagine sono generate dai file Markdown della cartella docs della repository. Per correggere un errore o aggiungere qualcosa a una guida, apri una pull request.',
    sourceLink: 'docs su GitHub',
    more: 'Nella repository c’è anche',
    moreItems: [
      [
        'Decisioni tecniche',
        'docs/DECISIONS.md',
        'Ogni scelta non ovvia, con contesto e motivazione. In gran parte in italiano.',
      ],
      [
        'Firma e aggiornamenti',
        'docs/signing.md',
        'Pacchetti, firma e il feed degli aggiornamenti firmato. In inglese.',
      ],
      [
        'Contribuire',
        'CONTRIBUTING.md',
        'Come proporre una modifica e la firma (sign-off) che serve a ogni commit. In inglese.',
      ],
    ],
  },
  guide: {
    onThisPage: 'In questa pagina',
    all: 'Tutta la documentazione',
    github: 'Questa guida su GitHub',
    updatedNote: 'Letta dalla repository quando è stato costruito il sito.',
    next: 'Guida successiva',
    metaSuffix: 'Documentazione di Monsters',
  },
  changelog: {
    crumb: 'Changelog',
    title: 'Changelog',
    metaTitle: 'Changelog di Monsters: cosa cambia in ogni versione',
    description:
      'Cosa cambia in ogni versione di Monsters, l’app open source che fa girare una squadra di agenti AI sul tuo computer. Scritto per chi usa l’app, dalla più recente.',
    lede: 'Cosa cambia in ogni versione, scritto per chi usa l’app. Monsters è in alpha, quindi le versioni escono spesso.',
    latest: 'Ultima',
    github: 'Versioni e download su GitHub',
    file: 'Questa pagina è generata da CHANGELOG.it.md.',
    jump: 'Vai a una versione',
  },
};

export const PAGES: Record<Lang, PagesStrings> = { en, it };
