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
      'Guides to Monsters, the open-source app that runs a team of AI agents on your computer: architecture, security, subscriptions, vault as MCP, remote use.',
    lede: 'The guides for people who use Monsters. They are read from the repository when the site is built, so they are always the ones in the code.',
    englishOnly: '',
    read: 'Read the guide',
    summaries: {
      architecture:
        'How Monsters is built: one local core, the event log, the kill switch, the orchestrator and its agents, the providers, the tools and the Markdown vault.',
      'security-model':
        'The perimeter, threat model and accepted risks of Monsters: the local core, permissions, the action log, the kill switch and what terminal access means.',
      subscriptions:
        'How to use the ChatGPT, Codex and Claude plans you already pay for in Monsters, what the app does and does not do with them, and what happens at a limit.',
      'mcp-vault':
        'Serve your Monsters notes to Claude Desktop, Codex, Cursor or Claude Code with monsters mcp: how it works, setup for each client, permissions and search.',
      remote:
        'Use Monsters from another computer or your phone: the terminal chat over SSH, a tunnel to the web UI, the desktop app as an SSH client, and Telegram bots.',
      roadmap:
        'Where Monsters has been and where it is going: the finished phases, what is still open before a stable release, and what comes later, for an alpha project.',
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
    metaSuffix: 'Monsters',
    tldr: 'In short',
    updated: 'Last updated',
  },
  changelog: {
    crumb: 'Changelog',
    title: 'Changelog',
    metaTitle: 'Monsters changelog: what changed in every release',
    description:
      'What changed in each release of Monsters, the open-source app that runs a team of AI agents on your computer. For people who use the app, newest first.',
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
      'Le guide di Monsters, l’app open source con una squadra di agenti AI sul tuo computer: architettura, sicurezza, abbonamenti, vault come MCP, uso remoto.',
    lede: 'Le guide per chi usa Monsters. Vengono lette dal repository quando si costruisce il sito, quindi sono sempre quelle che stanno nel codice.',
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
      'Queste pagine sono generate dai file Markdown della cartella docs del repository. Per correggere un errore o aggiungere qualcosa a una guida, apri una pull request.',
    sourceLink: 'docs su GitHub',
    more: 'Nel repository c’è anche',
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
    updatedNote: 'Letta dal repository quando è stato costruito il sito.',
    next: 'Guida successiva',
    metaSuffix: 'Monsters',
    tldr: 'In breve',
    updated: 'Ultimo aggiornamento',
  },
  changelog: {
    crumb: 'Changelog',
    title: 'Changelog',
    metaTitle: 'Changelog di Monsters: cosa cambia in ogni versione',
    description:
      'Cosa cambia in ogni versione di Monsters, l’app open source con una squadra di agenti AI sul tuo computer. Scritto per chi usa l’app, dalla più recente.',
    lede: 'Cosa cambia in ogni versione, scritto per chi usa l’app. Monsters è in alpha, quindi le versioni escono spesso.',
    latest: 'Ultima',
    github: 'Versioni e download su GitHub',
    file: 'Questa pagina è generata da CHANGELOG.it.md.',
    jump: 'Vai a una versione',
  },
};

export const PAGES: Record<Lang, PagesStrings> = { en, it };

/**
 * A short summary at the top of each guide, written for the site and not taken from the guide
 * (English only, like the guides): two or three sentences on what the guide says and who needs it.
 */
export const TLDR: Record<GuideSlug, string> = {
  architecture:
    'Monsters is one Node.js process on your computer that owns the agents, the notes and an append-only action log; the desktop app, the web UI, Telegram and SSH are all clients of that one core. An orchestrator hands work to the agents, every action goes through the log, and a single kill switch stops it all. Read it for the principles, the stack and where each part lives in the repository.',
  'security-model':
    'The core listens only on 127.0.0.1, and this guide lists what counts as a vulnerability: the local API, the kill switch, the action log, the agents’ permissions, the granted folders and the secrets. It is just as clear about the risks the project accepts, such as an action log that is not tamper-proof against a process that can write your files. Read it before you grant a monster the terminal.',
  subscriptions:
    'You can run the monsters on a ChatGPT Plus or Pro plan, also through Codex, or on a Claude plan through Claude Code, instead of paying for API keys; free OpenRouter models are enough to start without any plan. Everything is set up under Settings, Models, Plans you already have. The guide covers signing in, usage windows, what happens at a plan’s limit and using a plan from another computer over SSH.',
  'mcp-vault':
    'monsters mcp is an MCP server over stdio that lets Claude Desktop, Codex, Cursor or Claude Code search, read and edit your Monsters notes. It forwards every call to the running core, so each client shows up in the action log under its own name and every change is a git commit you can undo. The guide has the setup for each client and the permission rules.',
  remote:
    'The core never opens a port to the outside, so remote use goes through SSH or Telegram. With SSH you get the terminal chat, a tunnel to the web UI, or the desktop app of another computer as a client; with Telegram you write to your own bot from your phone, and a monster can have a bot of its own in a group. Both reach the same core, with the same log and the same kill switch.',
  roadmap:
    'Monsters is in alpha. The roadmap lists the phases already finished, the work still open before a stable release, such as signed updates on every system, a Windows certificate and a week-long soak test, and the ideas that come after it.',
};
