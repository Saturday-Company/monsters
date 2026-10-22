/*
 * The comparison pages (/compare/ and /it/compare/): Monsters next to three open-source agent
 * apps people search for. Facts were read from each project's repository and documentation on
 * VERIFIED; the sources are listed on every page. Where the other project is ahead, the text says
 * so; where we found nothing in the pages we read, the text says that and nothing more. The
 * Italian dictionary has the English one's type, so a missing row or paragraph fails the
 * typecheck.
 */
import type { Lang } from './strings.ts';

/** The day the facts below were checked. */
export const VERIFIED = '2026-10-22';

export const COMPETITORS = ['goose', 'eigent', 'openclaw'] as const;
export type CompetitorSlug = (typeof COMPETITORS)[number];

export const ROWS = [
  'what',
  'license',
  'stage',
  'platforms',
  'stack',
  'models',
  'local',
  'subs',
  'agents',
  'mcp',
  'notes',
  'permissions',
  'kill',
  'caps',
  'history',
  'remote',
  'schedule',
  'data',
] as const;
export type RowKey = (typeof ROWS)[number];

export interface Source {
  label: string;
  url: string;
}

/** Facts that are the same in both languages: names, links, numbers. */
export const COMPETITOR_FACTS: Record<
  CompetitorSlug,
  { name: string; site: string; repo: string; sources: Source[] }
> = {
  goose: {
    name: 'Goose',
    site: 'https://goose-docs.ai/',
    repo: 'https://github.com/aaif-goose/goose',
    sources: [
      { label: 'Goose README', url: 'https://github.com/aaif-goose/goose' },
      { label: 'Goose providers', url: 'https://goose-docs.ai/docs/getting-started/providers' },
      {
        label: 'Goose permission modes',
        url: 'https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/managing-tools/goose-permissions.md',
      },
      {
        label: 'Goose subagents',
        url: 'https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/context-engineering/subagents.mdx',
      },
      {
        label: 'Goose Telegram gateway',
        url: 'https://github.com/aaif-goose/goose/blob/main/documentation/docs/experimental/remote-access/telegram-gateway.md',
      },
      {
        label: 'Goose anonymous usage data',
        url: 'https://github.com/aaif-goose/goose/blob/main/documentation/docs/guides/usage-data.md',
      },
      { label: 'Goose releases', url: 'https://github.com/aaif-goose/goose/releases' },
    ],
  },
  eigent: {
    name: 'Eigent',
    site: 'https://www.eigent.ai/',
    repo: 'https://github.com/eigent-ai/eigent',
    sources: [
      { label: 'Eigent README', url: 'https://github.com/eigent-ai/eigent' },
      {
        label: 'Eigent local deployment guide',
        url: 'https://github.com/eigent-ai/eigent/blob/main/server/README_EN.md',
      },
      { label: 'Eigent website', url: 'https://www.eigent.ai/' },
      { label: 'Eigent releases', url: 'https://github.com/eigent-ai/eigent/releases' },
    ],
  },
  openclaw: {
    name: 'OpenClaw',
    site: 'https://openclaw.ai/',
    repo: 'https://github.com/openclaw/openclaw',
    sources: [
      { label: 'OpenClaw README', url: 'https://github.com/openclaw/openclaw' },
      {
        label: 'OpenClaw model providers',
        url: 'https://docs.openclaw.ai/concepts/model-providers',
      },
      { label: 'OpenClaw multi-agent', url: 'https://docs.openclaw.ai/concepts/multi-agent' },
      { label: 'OpenClaw MCP servers', url: 'https://docs.openclaw.ai/tools/mcp' },
      {
        label: 'OpenClaw stopping a run',
        url: 'https://docs.openclaw.ai/help/faq/chat-commands-and-stopping',
      },
      { label: 'OpenClaw usage tracking', url: 'https://docs.openclaw.ai/concepts/usage-tracking' },
      { label: 'OpenClaw releases', url: 'https://github.com/openclaw/openclaw/releases' },
    ],
  },
};

export const MONSTERS_SOURCES: Source[] = [
  { label: 'Monsters README', url: 'https://github.com/Saturday-Company/monsters#readme' },
  {
    label: 'Monsters security model',
    url: 'https://github.com/Saturday-Company/monsters/blob/main/docs/security-model.md',
  },
  {
    label: 'Monsters architecture',
    url: 'https://github.com/Saturday-Company/monsters/blob/main/docs/ARCHITECTURE.md',
  },
];

interface Faq {
  q: string;
  a: string;
}

interface Page {
  /** The `<h1>`: "Monsters vs Goose". */
  title: string;
  metaTitle: string;
  description: string;
  /** Two or three sentences under the title. */
  intro: string;
  /** The "Goose, in one line" card on the index. */
  teaser: string;
  rows: Record<RowKey, string>;
  ahead: string[];
  differs: string[];
  pickThem: string[];
  pickUs: string[];
  faq: Faq[];
}

interface Compare {
  index: {
    title: string;
    metaTitle: string;
    description: string;
    lede: string;
    open: string;
    method: string;
    methodItems: string[];
    othersTitle: string;
    others: string;
  };
  chrome: {
    breadcrumb: string;
    verified: string;
    tableTitle: string;
    row: string;
    scroll: string;
    ahead: string;
    differs: string;
    pickThem: string;
    pickUs: string;
    faq: string;
    sources: string;
    sourcesNote: string;
    other: string;
    note: string;
    ctaDownload: string;
    ctaCode: string;
  };
  rowLabels: Record<RowKey, string>;
  monsters: Record<RowKey, string>;
  pages: Record<CompetitorSlug, Page>;
}

const en: Compare = {
  index: {
    title: 'Monsters compared',
    metaTitle: 'Monsters compared with Goose, Eigent and OpenClaw',
    description:
      'Honest side-by-side comparisons of Monsters with Goose, Eigent and OpenClaw, three open-source AI agent apps that run on your computer: license, platforms, models, safety controls and maturity.',
    lede: 'If you are looking for an open-source AI agent app that runs on your own computer, here is how Monsters compares with three well-known ones. Each page has a table, the places where the other project is ahead, and when we would pick it over Monsters.',
    open: 'Read the comparison',
    method: 'How we compare',
    methodItems: [
      'Every fact comes from the other project’s own repository, website or documentation, linked at the bottom of each page, and was checked on 22 October 2026.',
      'Where we found nothing in the pages we read, the table says so. That is not proof the feature does not exist: tell us and we will fix it.',
      'Star counts, versions and features change. Check the sources before you decide.',
      'Monsters is made by Saturday Company, so we are not neutral. We wrote what we would want to read if we were choosing.',
    ],
    othersTitle: 'Not covered',
    others:
      'OpenCode (an open-source coding agent, MIT) and CrewAI (a Python framework for orchestrating agents, MIT) are also often mentioned. They are built for other jobs, a coding agent and a library for developers, so we have not written pages for them.',
  },
  chrome: {
    breadcrumb: 'Compare',
    verified: 'Facts checked on {date}',
    tableTitle: 'Side by side',
    row: 'Topic',
    scroll: 'Scroll the table sideways on a small screen.',
    ahead: 'Where {name} is ahead',
    differs: 'Where Monsters differs',
    pickThem: 'Pick {name} if',
    pickUs: 'Pick Monsters if',
    faq: 'Questions',
    sources: 'Sources',
    sourcesNote:
      'Read on {date}. Numbers such as stars and versions are the ones shown then. We found no mention of the features marked “not documented” in the pages listed here.',
    other: 'Other comparisons',
    note: 'Not documented in the pages we read.',
    ctaDownload: 'Download Monsters',
    ctaCode: 'Source code',
  },
  rowLabels: {
    what: 'What it is',
    license: 'License',
    stage: 'Maturity',
    platforms: 'Platforms',
    stack: 'Built with',
    models: 'Models and providers',
    local: 'Local models',
    subs: 'Claude and ChatGPT subscriptions',
    agents: 'Many agents',
    mcp: 'MCP',
    notes: 'Notes and memory',
    permissions: 'Permissions by default',
    kill: 'Kill switch',
    caps: 'Spending caps',
    history: 'History and audit',
    remote: 'Remote use',
    schedule: 'Scheduled work',
    data: 'Where data goes',
  },
  monsters: {
    what: 'A desktop app with an orchestrator (Titan) and a squad of named agents, each with its own chat, terminal, permissions and model chain.',
    license: 'Apache-2.0.',
    stage: 'Alpha (0.1.0-alpha.20, 21 October 2026). Public since 20 October 2026. 4 GitHub stars.',
    platforms:
      'Linux (AppImage, .deb), macOS (Apple silicon and Intel, signed and notarized), Windows (installer, not yet signed with a public certificate).',
    stack: 'TypeScript: a Node.js 24 core and an Electron app.',
    models:
      'OpenRouter (free models to start), Anthropic, OpenAI, Google, Mistral and Groq with your own keys. A chain of models with fallback per agent.',
    local: 'Yes: Ollama and LM Studio.',
    subs: 'Yes: Claude through Claude Code, ChatGPT and Codex through Sign in with ChatGPT.',
    agents:
      'Yes. The orchestrator delegates to the agents, in parallel. Whole projects and automations arrive as drafts you confirm.',
    mcp: 'MCP client (stdio and HTTP) with a gallery of services. `monsters mcp` also serves your notes to Claude Desktop, Codex or Cursor.',
    notes:
      'An Obsidian-compatible Markdown vault under git: every agent edit is a commit you can undo. Keyword and semantic search.',
    permissions: 'Terminal and file access are off until you grant them, agent by agent.',
    kill: 'Yes. One lever (the app, /stop on Telegram, `monsters kill`) aborts every run and kills the child processes. A program that detaches on purpose is not stopped.',
    caps: 'Daily and monthly caps, per project too.',
    history:
      'Every action goes into a local action log. It is not tamper-proof against a process that can write your files.',
    remote:
      'Telegram bots (also one per agent, in groups), the terminal chat over SSH, and the desktop app as an SSH client of another computer.',
    schedule: 'Scheduled automations, proposed as drafts you confirm.',
    data: 'Notes, logs and settings stay on your disk. Prompts go to the provider you choose (nowhere with Ollama or LM Studio). No cloud account, no usage analytics.',
  },
  pages: {
    goose: {
      title: 'Monsters vs Goose',
      metaTitle: 'Monsters vs Goose: open-source AI agent apps compared',
      description:
        'Monsters and Goose compared: two open-source apps that run AI agents on your computer. License, platforms, providers, local models, multi-agent, MCP, kill switch, spending caps and maturity, with sources.',
      intro:
        'Goose and Monsters are open-source apps that run AI agents on your own computer with the model you choose. Goose is the larger and older project: one general-purpose agent with a desktop app, a CLI and an API, now part of the Linux Foundation. Monsters is a young alpha built around a standing team of agents, a Markdown notes vault and safety controls.',
      teaser:
        'One general-purpose agent with subagents, as app, CLI and API, from the Linux Foundation. Far more mature.',
      rows: {
        what: 'A general-purpose agent that runs on your machine, as a desktop app, a CLI and an API, for code, research, writing and automation.',
        license: 'Apache-2.0. Part of the Agentic AI Foundation at the Linux Foundation.',
        stage:
          'Version 1.55.0 (16 October 2026), a release about every week. Repository since August 2024. About 55,500 GitHub stars.',
        platforms: 'Desktop app for macOS, Linux and Windows, plus a CLI.',
        stack: 'Rust.',
        models:
          '15+ providers, including Anthropic, OpenAI, Google, OpenRouter, Azure, Bedrock and Vertex AI. Any OpenAI-, Anthropic- or Ollama-compatible endpoint.',
        local:
          'Yes: Ollama, LM Studio, Docker Model Runner. A model without tool calling can only chat.',
        subs: 'Yes: Claude and ChatGPT or Codex (through ACP), and also GitHub Copilot and Cursor.',
        agents:
          'Subagents that goose starts for a task, one after another or in parallel. Only in the autonomous mode, which is the default.',
        mcp: '70+ extensions through MCP.',
        notes:
          'Sessions kept in a local SQLite file, exportable as Markdown, JSON or YAML. A Memory extension. No notes vault.',
        permissions:
          'Four modes (autonomous, manual approval, smart approval, chat only). The default is Completely Autonomous.',
        kill: 'Not documented in the pages we read.',
        caps: 'Not documented in the pages we read.',
        history: 'Session history and application logs.',
        remote:
          'A Telegram gateway (experimental) and an ACP server over HTTP and WebSocket on 127.0.0.1.',
        schedule: 'Cron schedules for recipes, from the CLI.',
        data: 'Runs locally. Prompts go to the provider you choose. Anonymous usage data is opt-in, asked on first use.',
      },
      ahead: [
        'Maturity and community. Goose has been public since 2024, ships a release about every week and has about 55,500 GitHub stars. Monsters became public on 20 October 2026 and has 4.',
        'Governance. Goose belongs to the Agentic AI Foundation at the Linux Foundation. Monsters is run by Saturday Company and its contributors.',
        'Reach. A full command line and an API you can embed, next to the desktop app. Monsters has a command line, but no API meant for embedding.',
        'Providers and extensions. More providers (Azure, Bedrock, Vertex AI and others) and a large catalog of MCP extensions.',
        'Recipes. Reusable tasks you can schedule and share.',
      ],
      differs: [
        'A standing team. You get an orchestrator and named agents with their own chat, terminal, permissions and models, and they keep their identity between jobs. In Goose, subagents are temporary instances the main agent starts for a task.',
        'Notes you can read and undo. The memory is a Markdown vault you can open in Obsidian, and every agent edit is a git commit. In the pages we read Goose has no notes vault.',
        'Brakes from the start. Terminal and files are off until you grant them, per agent, and a small model (Instinct) stops actions that would leave the computer. Goose starts in its autonomous mode and lets you switch to approval modes.',
        'A kill switch and spending caps. One lever stops every run and child process, and daily and monthly caps apply per project. We did not find either in Goose’s documentation.',
        'Remote use as a main path: Telegram (also one bot per agent), the terminal over SSH, and the desktop app as an SSH client. Goose has an experimental Telegram gateway.',
      ],
      pickThem: [
        'You want the most established open-source agent app, with a large community and frequent releases.',
        'You want a CLI and an API to build on, not only a desktop app.',
        'You use a provider Monsters does not support yet, such as Bedrock or Azure.',
        'You like recipes and a wide catalog of MCP extensions.',
      ],
      pickUs: [
        'You want a team of named agents with separate permissions rather than one agent that starts helpers.',
        'You want the agents’ memory as Markdown notes you can open in Obsidian and undo.',
        'You want a hard stop and spending caps built in.',
        'You want to drive agents from your phone with Telegram, or from another computer over SSH.',
        'You accept an alpha with a very small community.',
      ],
      faq: [
        {
          q: 'Is Monsters an alternative to Goose?',
          a: 'For some uses, yes. Both are open-source apps that run AI agents on your computer with the model you choose. They follow different ideas: Goose is one general-purpose agent with subagents, available as app, CLI and API; Monsters is a standing team of agents with its own notes vault, spending caps and a kill switch. Goose is much more mature.',
        },
        {
          q: 'Can Monsters use the same models as Goose?',
          a: 'Mostly. Both work with Anthropic, OpenAI, Google, OpenRouter, Ollama and LM Studio, and both can use your Claude and ChatGPT or Codex subscriptions. Goose lists more providers, such as Azure and Bedrock.',
        },
        {
          q: 'Can I use Goose and Monsters together?',
          a: 'Yes, nothing stops you from installing both. They are separate apps with separate data, and both speak MCP, so the same MCP servers can be connected to either.',
        },
      ],
    },
    eigent: {
      title: 'Monsters vs Eigent',
      metaTitle: 'Monsters vs Eigent: open-source multi-agent desktop apps compared',
      description:
        'Monsters and Eigent compared: two open-source desktop apps with a team of AI agents. License, platforms, local deployment, models, MCP, kill switch, spending caps and maturity, with sources.',
      intro:
        'Eigent and Monsters both put a team of AI agents on your desktop. Eigent is built on CAMEL-AI, calls itself an open-source Cowork app and runs a workforce of specialised agents in parallel. It has reached version 1.0, has about 15,600 GitHub stars and also offers a hosted cloud version. Monsters is a smaller alpha that stays on your computer and adds a Markdown vault, spending caps and a kill switch.',
      teaser:
        'A multi-agent “Cowork” desktop app on CAMEL-AI, at version 1.0, with a hosted option. More mature, heavier to run locally.',
      rows: {
        what: 'An open-source “Cowork” desktop app: a workforce of specialised agents that work in parallel, or a single agent for focused tasks.',
        license: 'Apache-2.0.',
        stage:
          'Version 1.0.6 (16 October 2026). Repository since July 2025. About 15,600 GitHub stars.',
        platforms: 'Builds for macOS (Apple silicon and Intel), Windows and Linux (AppImage).',
        stack:
          'Electron and React for the app, Python (FastAPI) for the back end, CAMEL for the agents.',
        models:
          'Model agnostic: cloud providers, enterprise gateways or local inference, with your own keys.',
        local: 'Yes: vLLM, Ollama and LM Studio are listed for the local deployment.',
        subs: 'Not documented in the pages we read.',
        agents:
          'Yes, it is the main feature: a workforce of agents that split a task and work in parallel, plus a single-agent mode.',
        mcp: 'MCP integration, skills, and built-in browser and terminal toolkits.',
        notes:
          'Users, provider settings, tool settings and chat history are kept in a local database in local mode. No Markdown vault documented.',
        permissions: 'Not documented in the pages we read.',
        kill: 'Not documented in the pages we read.',
        caps: 'Not documented in the pages we read. The hosted plans use credits.',
        history: 'Chat history kept locally in local mode.',
        remote: 'Not documented in the pages we read.',
        schedule: 'Yes: recurring workflows on a schedule.',
        data: 'The recommended local deployment runs a back end on your machine and keeps data there. The quick start uses Eigent’s cloud and needs an account. Hosted Plus, Pro and Enterprise plans exist.',
      },
      ahead: [
        'Maturity and community. Eigent is at version 1.0 with about 15,600 GitHub stars. Monsters is an alpha with 4.',
        'Parallel workforce. Splitting a task across specialised agents is Eigent’s core idea, built on CAMEL-AI’s research, with a single-agent mode for simple tasks.',
        'Built-in browser and terminal toolkits, aimed at everyday desktop work such as organising files or producing reports.',
        'A way up. Hosted plans for people who do not want to run anything, and an Enterprise offer with SSO and access control.',
      ],
      differs: [
        'Lighter to run locally. Monsters is one desktop app with a local core. Eigent’s recommended local deployment needs Docker Desktop, Python 3.12 and Node.js for its back end and database, and its quick start goes through Eigent’s cloud.',
        'Notes you can read and undo: a Markdown vault under git, with every agent edit a commit you can revert. We did not find an equivalent in Eigent.',
        'Safety controls we documented in the open: permissions off by default per agent, a kill switch, spending caps and an action log. We did not find these described for Eigent.',
        'The subscriptions you already pay for (Claude through Claude Code, ChatGPT and Codex) and remote use from Telegram or over SSH.',
      ],
      pickThem: [
        'You want a product that has reached 1.0 and a larger community.',
        'You want agents that browse and operate the desktop in parallel, with a ready toolkit.',
        'You may want a hosted version or an enterprise plan later.',
      ],
      pickUs: [
        'You want everything on your computer without Docker, a database server or a cloud account.',
        'You want Markdown notes you can open in Obsidian and undo.',
        'You want permissions, a kill switch and spending caps from the start.',
        'You want to use your Claude or ChatGPT subscription, or to drive agents from Telegram or SSH.',
        'You accept an alpha with a very small community.',
      ],
      faq: [
        {
          q: 'Is Monsters an open-source alternative to Eigent?',
          a: 'For some uses, yes. Both are Apache-2.0 desktop apps with a team of AI agents and MCP support. Eigent is more mature and aims at parallel desktop work with a hosted option; Monsters is an alpha that stays on your computer and focuses on a notes vault, permissions, spending caps and a kill switch.',
        },
        {
          q: 'Does Eigent run fully offline?',
          a: 'Eigent documents a local deployment that keeps users, provider settings and chat history on your machine, and says a fully offline setup is possible with only local models and local MCP servers. Its quick start connects to Eigent’s cloud and needs an account. Monsters runs locally from the first start; it goes offline too if you use only Ollama or LM Studio.',
        },
      ],
    },
    openclaw: {
      title: 'Monsters vs OpenClaw',
      metaTitle: 'Monsters vs OpenClaw: local AI assistant and agent apps compared',
      description:
        'Monsters and OpenClaw compared: two open-source AI agent systems that run on your own hardware. License, platforms, models, multi-agent, MCP, kill switch, spending caps and maturity, with sources.',
      intro:
        'OpenClaw and Monsters both run on your own hardware with the models you choose, but they sit in different places. OpenClaw is a personal assistant that lives in the chat apps you already use, such as WhatsApp, Telegram, Slack, Discord and iMessage, served by one Gateway. Monsters is a desktop app with a team of agents you watch and steer, a notes vault and a kill switch. OpenClaw is far larger, with about 392,700 GitHub stars and a foundation behind it.',
      teaser:
        'A personal assistant that lives in your chat apps, on a Gateway, with native apps on five platforms. Far larger, a different shape.',
      rows: {
        what: 'An open-source personal assistant that runs on your computer and answers in the chat apps you already use, through one Gateway. Tools, skills and plugins extend it.',
        license:
          'MIT. Run by the OpenClaw Foundation, an independent non-profit. No paid tier or hosted service.',
        stage:
          'Calendar versions: v2026.10.5 (18 October 2026), with beta releases in between. Repository since November 2025. About 392,700 GitHub stars.',
        platforms:
          'Native apps for macOS, iOS, Android, Windows and Linux, plus an installer for macOS, Linux and Windows.',
        stack: 'TypeScript on Node.js (24.16 or newer for npm installs).',
        models:
          'Hosted and local providers, including OpenAI, Anthropic, Google, OpenRouter and xAI, plus custom base URLs.',
        local: 'Yes: Ollama, LM Studio, llama.cpp, vLLM and SGLang.',
        subs: 'ChatGPT and Codex sign-in is documented; Claude Code CLI setups are covered by its usage tracking.',
        agents:
          'Several isolated agents behind one Gateway, routed by channel. An optional team preset adds a coordinator with specialists (researcher, writer, reviewer) that do not delegate further.',
        mcp: 'MCP client (stdio, HTTP and SSE) from Settings or the CLI, and `openclaw mcp serve` to expose channel conversations.',
        notes:
          'State, memory and credentials live on your hardware. No Markdown notes vault documented.',
        permissions:
          'Tools run on the host for the main session unless you set up sandboxing. Exec approvals and pairing for unknown senders are available.',
        kill: 'Send “stop” (or “abort”, “halt”…) as a message to abort a run. Background commands are killed on request. No single switch documented.',
        caps: 'Usage and estimated cost are tracked and shown. Hard caps not documented in the pages we read.',
        history: 'Session transcripts and logs; cost summaries built from them.',
        remote:
          'Reached through its messaging channels, a Control UI, a CLI and a TUI, and companion apps.',
        schedule: 'Cron and heartbeat tools.',
        data: 'State, memory and credentials stay on your hardware. By default it only checks for a new version daily; anonymous statistics are opt-in.',
      },
      ahead: [
        'Scale and community. About 392,700 GitHub stars, a foundation, frequent releases and a hub of plugins. Monsters has 4 stars and became public on 20 October 2026.',
        'Reach. More than 20 messaging platforms, and native apps for iOS and Android. Monsters has Telegram and SSH, and no mobile app.',
        'Ecosystem. Tools, skills and plugins, and companion apps for voice, camera and screen.',
        'Providers. A long list of hosted providers and local runtimes such as llama.cpp, vLLM and SGLang.',
        'Governance. An independent foundation with no paid tier.',
      ],
      differs: [
        'A workspace to watch a team work. Monsters gives each agent a chat, a terminal and a state you can see, and projects and automations arrive as drafts you confirm before anything starts.',
        'Cautious by default. Terminal and files are off until you grant them per agent, and a small model (Instinct) stops actions that would leave the computer. OpenClaw has exec approvals, pairing and optional sandboxing, but its documentation says tools run on the host unless you configure sandboxing.',
        'Notes you can read and undo: a Markdown vault under git, with every agent edit a commit you can revert.',
        'One lever and spending caps. A single switch aborts every run and kills the child processes, and daily and monthly caps apply per project. OpenClaw shows usage and estimated cost, and lets you stop a run by message; we found no hard cap.',
        'An orchestrator that proposes whole projects to a standing team. In OpenClaw the agents are separate personas by default, with a coordinator as an option.',
      ],
      pickThem: [
        'You want an assistant you can message from WhatsApp, Slack, iMessage or Discord, wherever you are.',
        'You want native apps on your phone and a large community and plugin ecosystem.',
        'You want a project run by an independent foundation, with no paid tier.',
      ],
      pickUs: [
        'You want a desktop workspace with a team of agents you can watch, each with its own permissions.',
        'You want the memory as Markdown notes you can open in Obsidian and undo.',
        'You want a kill switch and spending caps built in.',
        'You want to use your Claude Code or ChatGPT subscription through the app.',
        'You accept an alpha with a very small community.',
      ],
      faq: [
        {
          q: 'Is Monsters an alternative to OpenClaw?',
          a: 'Partly. Both run on your own hardware with the models you choose and speak MCP. OpenClaw is a personal assistant that lives in your chat apps and is far larger; Monsters is a desktop app with a team of agents, a notes vault, spending caps and a kill switch. Which fits depends on whether you want to message an assistant or manage a team.',
        },
        {
          q: 'Can I reach Monsters from WhatsApp or iMessage?',
          a: 'No. Monsters can be reached from Telegram (including one bot per agent, in groups), from the terminal chat over SSH, and from the desktop app as an SSH client. OpenClaw supports more than 20 messaging platforms.',
        },
      ],
    },
  },
};

const it: Compare = {
  index: {
    title: 'Monsters a confronto',
    metaTitle: 'Monsters a confronto con Goose, Eigent e OpenClaw',
    description:
      'Confronti onesti di Monsters con Goose, Eigent e OpenClaw, tre app open source di agenti AI che girano sul tuo computer: licenza, sistemi, modelli, controlli di sicurezza e maturità.',
    lede: 'Se cerchi un’app open source di agenti AI che giri sul tuo computer, ecco come si pone Monsters rispetto a tre progetti noti. Ogni pagina ha una tabella, i punti in cui l’altro progetto è avanti e quando sceglieremmo lui al posto di Monsters.',
    open: 'Leggi il confronto',
    method: 'Come confrontiamo',
    methodItems: [
      'Ogni dato viene dalla repository, dal sito o dalla documentazione dell’altro progetto, linkati in fondo a ogni pagina, e il controllo è del 22 ottobre 2026.',
      'Dove nelle pagine lette non abbiamo trovato niente, la tabella lo dice. Non prova che la funzione non esista: scrivici e correggiamo.',
      'Stelle, versioni e funzioni cambiano. Controlla le fonti prima di decidere.',
      'Monsters è fatto da Saturday Company, quindi non siamo neutrali. Abbiamo scritto quello che vorremmo leggere se dovessimo scegliere.',
    ],
    othersTitle: 'Non trattati',
    others:
      'Si citano spesso anche OpenCode (un agente open source per programmare, MIT) e CrewAI (una libreria Python per orchestrare agenti, MIT). Servono a lavori diversi, un agente per il codice e una libreria per sviluppatori, quindi non abbiamo scritto pagine su di loro.',
  },
  chrome: {
    breadcrumb: 'Confronti',
    verified: 'Dati controllati il {date}',
    tableTitle: 'Uno accanto all’altro',
    row: 'Tema',
    scroll: 'Su uno schermo piccolo scorri la tabella di lato.',
    ahead: 'Dove {name} è avanti',
    differs: 'Dove Monsters è diverso',
    pickThem: 'Scegli {name} se',
    pickUs: 'Scegli Monsters se',
    faq: 'Domande',
    sources: 'Fonti',
    sourcesNote:
      'Lette il {date}. Numeri come stelle e versioni sono quelli visibili allora. Per le funzioni segnate «non documentato» non abbiamo trovato nulla nelle pagine elencate qui.',
    other: 'Altri confronti',
    note: 'Non documentato nelle pagine che abbiamo letto.',
    ctaDownload: 'Scarica Monsters',
    ctaCode: 'Codice sorgente',
  },
  rowLabels: {
    what: 'Cos’è',
    license: 'Licenza',
    stage: 'Maturità',
    platforms: 'Sistemi',
    stack: 'Fatto con',
    models: 'Modelli e provider',
    local: 'Modelli locali',
    subs: 'Abbonamenti Claude e ChatGPT',
    agents: 'Più agenti',
    mcp: 'MCP',
    notes: 'Note e memoria',
    permissions: 'Permessi di base',
    kill: 'Interruttore di emergenza',
    caps: 'Tetti di spesa',
    history: 'Cronologia e controllo',
    remote: 'Uso a distanza',
    schedule: 'Lavori programmati',
    data: 'Dove vanno i dati',
  },
  monsters: {
    what: 'Un’app desktop con un orchestratore (Titan) e una squadra di agenti con un nome, ciascuno con la sua chat, il suo terminale, i suoi permessi e la sua catena di modelli.',
    license: 'Apache-2.0.',
    stage:
      'Alpha (0.1.0-alpha.20, 21 ottobre 2026). Pubblico dal 20 ottobre 2026. 4 stelle su GitHub.',
    platforms:
      'Linux (AppImage, .deb), macOS (Apple silicon e Intel, firmato e notarizzato), Windows (installer, non ancora firmato con un certificato pubblico).',
    stack: 'TypeScript: un core Node.js 24 e un’app Electron.',
    models:
      'OpenRouter (modelli gratuiti per iniziare), Anthropic, OpenAI, Google, Mistral e Groq con le tue chiavi. Una catena di modelli con riserva per ogni agente.',
    local: 'Sì: Ollama e LM Studio.',
    subs: 'Sì: Claude tramite Claude Code, ChatGPT e Codex con l’accesso con ChatGPT.',
    agents:
      'Sì. L’orchestratore delega agli agenti, anche in parallelo. Progetti e automazioni intere arrivano come bozze che confermi tu.',
    mcp: 'Client MCP (stdio e HTTP) con una galleria di servizi. `monsters mcp` serve anche le tue note a Claude Desktop, Codex o Cursor.',
    notes:
      'Un vault Markdown compatibile con Obsidian sotto git: ogni modifica di un agente è un commit che puoi annullare. Ricerca per parole e per significato.',
    permissions: 'Terminale e file restano spenti finché non li concedi, agente per agente.',
    kill: 'Sì. Una leva (l’app, /stop su Telegram, `monsters kill`) interrompe ogni lavoro e uccide i processi figli. Un programma che si stacca di proposito non viene fermato.',
    caps: 'Tetti giornalieri e mensili, anche per progetto.',
    history:
      'Ogni azione finisce in un registro locale. Non è a prova di manomissione per un processo che può scrivere nei tuoi file.',
    remote:
      'Bot di Telegram (anche uno per agente, nei gruppi), la chat da terminale via SSH e l’app desktop come client SSH di un altro computer.',
    schedule: 'Automazioni programmate, proposte come bozze che confermi tu.',
    data: 'Note, registro e impostazioni restano sul tuo disco. I prompt vanno al provider che scegli (da nessuna parte con Ollama o LM Studio). Nessun account cloud, nessuna statistica d’uso.',
  },
  pages: {
    goose: {
      title: 'Monsters vs Goose',
      metaTitle: 'Monsters vs Goose: app open source di agenti AI a confronto',
      description:
        'Monsters e Goose a confronto: due app open source che fanno girare agenti AI sul tuo computer. Licenza, sistemi, provider, modelli locali, più agenti, MCP, interruttore di emergenza, tetti di spesa e maturità, con le fonti.',
      intro:
        'Goose e Monsters sono app open source che fanno girare agenti AI sul tuo computer con il modello che scegli. Goose è il progetto più grande e più vecchio: un solo agente generalista con app desktop, CLI e API, oggi nella Linux Foundation. Monsters è un’alpha giovane, costruita attorno a una squadra stabile di agenti, un vault di note in Markdown e controlli di sicurezza.',
      teaser:
        'Un solo agente generalista con subagenti, come app, CLI e API, nella Linux Foundation. Molto più maturo.',
      rows: {
        what: 'Un agente generalista che gira sulla tua macchina, come app desktop, CLI e API, per codice, ricerca, scrittura e automazione.',
        license: 'Apache-2.0. Fa parte dell’Agentic AI Foundation, nella Linux Foundation.',
        stage:
          'Versione 1.55.0 (16 ottobre 2026), una release circa ogni settimana. Repository dall’agosto 2024. Circa 55.500 stelle su GitHub.',
        platforms: 'App desktop per macOS, Linux e Windows, più una CLI.',
        stack: 'Rust.',
        models:
          'Oltre 15 provider, tra cui Anthropic, OpenAI, Google, OpenRouter, Azure, Bedrock e Vertex AI. Qualsiasi endpoint compatibile con OpenAI, Anthropic od Ollama.',
        local:
          'Sì: Ollama, LM Studio, Docker Model Runner. Un modello senza chiamate a strumenti può solo chiacchierare.',
        subs: 'Sì: Claude e ChatGPT o Codex (tramite ACP), ma anche GitHub Copilot e Cursor.',
        agents:
          'Subagenti che goose avvia per un compito, uno dopo l’altro o in parallelo. Solo nella modalità autonoma, che è quella di base.',
        mcp: 'Oltre 70 estensioni tramite MCP.',
        notes:
          'Sessioni salvate in un file SQLite locale, esportabili in Markdown, JSON o YAML. Un’estensione Memory. Nessun vault di note.',
        permissions:
          'Quattro modalità (autonoma, approvazione manuale, approvazione intelligente, solo chat). Quella di base è la completamente autonoma.',
        kill: 'Non documentato nelle pagine che abbiamo letto.',
        caps: 'Non documentato nelle pagine che abbiamo letto.',
        history: 'Cronologia delle sessioni e log dell’applicazione.',
        remote:
          'Un gateway Telegram (sperimentale) e un server ACP su HTTP e WebSocket su 127.0.0.1.',
        schedule: 'Pianificazioni cron per le recipe, dalla CLI.',
        data: 'Gira in locale. I prompt vanno al provider che scegli. I dati d’uso anonimi sono facoltativi e si chiedono al primo avvio.',
      },
      ahead: [
        'Maturità e community. Goose è pubblico dal 2024, rilascia una versione circa ogni settimana e ha circa 55.500 stelle su GitHub. Monsters è pubblico dal 20 ottobre 2026 e ne ha 4.',
        'Governance. Goose appartiene all’Agentic AI Foundation, nella Linux Foundation. Monsters è portato avanti da Saturday Company e dai suoi contributor.',
        'Raggio d’azione. Una riga di comando completa e un’API da incorporare, accanto all’app desktop. Monsters ha una riga di comando, ma nessuna API pensata per essere incorporata.',
        'Provider ed estensioni. Più provider (Azure, Bedrock, Vertex AI e altri) e un grande catalogo di estensioni MCP.',
        'Le recipe. Compiti riutilizzabili che puoi programmare e condividere.',
      ],
      differs: [
        'Una squadra stabile. Hai un orchestratore e agenti con un nome, ciascuno con la sua chat, il suo terminale, i suoi permessi e i suoi modelli, e restano gli stessi da un lavoro all’altro. In Goose i subagenti sono istanze temporanee che l’agente principale avvia per un compito.',
        'Note che puoi leggere e annullare. La memoria è un vault Markdown che apri con Obsidian, e ogni modifica di un agente è un commit git. Nelle pagine che abbiamo letto Goose non ha un vault di note.',
        'Freni fin dall’inizio. Terminale e file restano spenti finché non li concedi, agente per agente, e un modello piccolo (Istinto) ferma le azioni che uscirebbero dal computer. Goose parte in modalità autonoma e ti lascia passare a quelle con approvazione.',
        'Un interruttore di emergenza e tetti di spesa. Una leva ferma ogni lavoro e ogni processo figlio, e i tetti giornalieri e mensili valgono per progetto. Nella documentazione di Goose non abbiamo trovato né l’una né gli altri.',
        'L’uso a distanza come strada principale: Telegram (anche un bot per agente), il terminale via SSH e l’app desktop come client SSH. Goose ha un gateway Telegram sperimentale.',
      ],
      pickThem: [
        'Vuoi l’app open source di agenti più consolidata, con una community grande e release frequenti.',
        'Vuoi una CLI e un’API su cui costruire, non solo un’app desktop.',
        'Usi un provider che Monsters non supporta ancora, come Bedrock o Azure.',
        'Ti piacciono le recipe e un vasto catalogo di estensioni MCP.',
      ],
      pickUs: [
        'Vuoi una squadra di agenti con un nome e permessi separati, più che un solo agente che avvia aiutanti.',
        'Vuoi la memoria degli agenti come note Markdown da aprire con Obsidian e da poter annullare.',
        'Vuoi un arresto di emergenza e tetti di spesa già inclusi.',
        'Vuoi guidare gli agenti dal telefono con Telegram, o da un altro computer via SSH.',
        'Accetti un’alpha con una community molto piccola.',
      ],
      faq: [
        {
          q: 'Monsters è un’alternativa a Goose?',
          a: 'Per alcuni usi sì. Sono entrambe app open source che fanno girare agenti AI sul tuo computer con il modello che scegli. Seguono idee diverse: Goose è un solo agente generalista con subagenti, disponibile come app, CLI e API; Monsters è una squadra stabile di agenti con un suo vault di note, tetti di spesa e un interruttore di emergenza. Goose è molto più maturo.',
        },
        {
          q: 'Monsters può usare gli stessi modelli di Goose?',
          a: 'In gran parte. Entrambi funzionano con Anthropic, OpenAI, Google, OpenRouter, Ollama e LM Studio, ed entrambi possono usare i tuoi abbonamenti Claude e ChatGPT o Codex. Goose elenca più provider, come Azure e Bedrock.',
        },
        {
          q: 'Posso usare Goose e Monsters insieme?',
          a: 'Sì, niente ti impedisce di installarli entrambi. Sono app separate con dati separati, e parlano tutte e due MCP, quindi gli stessi server MCP si possono collegare all’una o all’altra.',
        },
      ],
    },
    eigent: {
      title: 'Monsters vs Eigent',
      metaTitle: 'Monsters vs Eigent: app desktop multi-agente open source a confronto',
      description:
        'Monsters ed Eigent a confronto: due app desktop open source con una squadra di agenti AI. Licenza, sistemi, installazione locale, modelli, MCP, interruttore di emergenza, tetti di spesa e maturità, con le fonti.',
      intro:
        'Eigent e Monsters mettono entrambi una squadra di agenti AI sul tuo desktop. Eigent è costruito su CAMEL-AI, si definisce l’app «Cowork» open source e fa lavorare in parallelo una forza lavoro di agenti specializzati. È arrivato alla versione 1.0, ha circa 15.600 stelle su GitHub e offre anche una versione cloud ospitata. Monsters è un’alpha più piccola che resta sul tuo computer e aggiunge un vault Markdown, tetti di spesa e un interruttore di emergenza.',
      teaser:
        'Un’app desktop «Cowork» multi-agente su CAMEL-AI, alla versione 1.0, con un’opzione ospitata. Più maturo, più pesante da far girare in locale.',
      rows: {
        what: 'Un’app desktop «Cowork» open source: una forza lavoro di agenti specializzati che lavorano in parallelo, oppure un solo agente per compiti mirati.',
        license: 'Apache-2.0.',
        stage:
          'Versione 1.0.6 (16 ottobre 2026). Repository dal luglio 2025. Circa 15.600 stelle su GitHub.',
        platforms: 'Build per macOS (Apple silicon e Intel), Windows e Linux (AppImage).',
        stack:
          'Electron e React per l’app, Python (FastAPI) per il back end, CAMEL per gli agenti.',
        models:
          'Indipendente dal modello: provider cloud, gateway aziendali o inferenza locale, con le tue chiavi.',
        local: 'Sì: vLLM, Ollama e LM Studio sono elencati per l’installazione locale.',
        subs: 'Non documentato nelle pagine che abbiamo letto.',
        agents:
          'Sì, è la funzione principale: una forza lavoro di agenti che si dividono un compito e lavorano in parallelo, più una modalità a singolo agente.',
        mcp: 'Integrazione MCP, skill e strumenti integrati per browser e terminale.',
        notes:
          'In modalità locale utenti, impostazioni dei provider e degli strumenti e cronologia delle chat stanno in un database locale. Nessun vault Markdown documentato.',
        permissions: 'Non documentato nelle pagine che abbiamo letto.',
        kill: 'Non documentato nelle pagine che abbiamo letto.',
        caps: 'Non documentato nelle pagine che abbiamo letto. I piani ospitati usano crediti.',
        history: 'Cronologia delle chat conservata in locale, in modalità locale.',
        remote: 'Non documentato nelle pagine che abbiamo letto.',
        schedule: 'Sì: flussi ricorrenti programmati.',
        data: 'L’installazione locale consigliata fa girare un back end sulla tua macchina e tiene lì i dati. L’avvio rapido passa dal cloud di Eigent e richiede un account. Esistono piani ospitati Plus, Pro ed Enterprise.',
      },
      ahead: [
        'Maturità e community. Eigent è alla versione 1.0 con circa 15.600 stelle su GitHub. Monsters è un’alpha con 4.',
        'La forza lavoro in parallelo. Dividere un compito fra agenti specializzati è l’idea centrale di Eigent, sulla ricerca di CAMEL-AI, con una modalità a singolo agente per i compiti semplici.',
        'Strumenti integrati per browser e terminale, pensati per il lavoro quotidiano al computer, come mettere in ordine i file o produrre report.',
        'Una strada in più. Piani ospitati per chi non vuole far girare niente e un’offerta Enterprise con SSO e controllo degli accessi.',
      ],
      differs: [
        'Più leggero da far girare in locale. Monsters è un’app desktop con un core locale. L’installazione locale consigliata di Eigent richiede Docker Desktop, Python 3.12 e Node.js per back end e database, e il suo avvio rapido passa dal cloud di Eigent.',
        'Note che puoi leggere e annullare: un vault Markdown sotto git, dove ogni modifica di un agente è un commit che puoi ripristinare. In Eigent non ne abbiamo trovato un equivalente.',
        'Controlli di sicurezza documentati apertamente: permessi spenti di base per agente, un interruttore di emergenza, tetti di spesa e un registro delle azioni. Per Eigent non li abbiamo trovati descritti.',
        'Gli abbonamenti che già paghi (Claude tramite Claude Code, ChatGPT e Codex) e l’uso a distanza da Telegram o via SSH.',
      ],
      pickThem: [
        'Vuoi un prodotto arrivato alla 1.0 e una community più grande.',
        'Vuoi agenti che navigano e usano il desktop in parallelo, con strumenti già pronti.',
        'Più avanti potresti volere una versione ospitata o un piano aziendale.',
      ],
      pickUs: [
        'Vuoi tutto sul tuo computer, senza Docker, senza un server di database e senza un account cloud.',
        'Vuoi note Markdown da aprire con Obsidian e da poter annullare.',
        'Vuoi permessi, interruttore di emergenza e tetti di spesa fin dall’inizio.',
        'Vuoi usare il tuo abbonamento Claude o ChatGPT, o guidare gli agenti da Telegram o via SSH.',
        'Accetti un’alpha con una community molto piccola.',
      ],
      faq: [
        {
          q: 'Monsters è un’alternativa open source a Eigent?',
          a: 'Per alcuni usi sì. Sono entrambe app desktop Apache-2.0 con una squadra di agenti AI e supporto MCP. Eigent è più maturo e punta al lavoro parallelo sul desktop con un’opzione ospitata; Monsters è un’alpha che resta sul tuo computer e si concentra su vault di note, permessi, tetti di spesa e interruttore di emergenza.',
        },
        {
          q: 'Eigent funziona del tutto offline?',
          a: 'Eigent documenta un’installazione locale che tiene sulla tua macchina utenti, impostazioni dei provider e cronologia delle chat, e dice che un setup del tutto offline è possibile con soli modelli locali e server MCP locali. Il suo avvio rapido si collega al cloud di Eigent e richiede un account. Monsters gira in locale fin dal primo avvio; va offline anche lui se usi solo Ollama o LM Studio.',
        },
      ],
    },
    openclaw: {
      title: 'Monsters vs OpenClaw',
      metaTitle: 'Monsters vs OpenClaw: assistente AI locale e app di agenti a confronto',
      description:
        'Monsters e OpenClaw a confronto: due sistemi open source di agenti AI che girano sul tuo hardware. Licenza, sistemi, modelli, più agenti, MCP, interruttore di emergenza, tetti di spesa e maturità, con le fonti.',
      intro:
        'OpenClaw e Monsters girano entrambi sul tuo hardware con i modelli che scegli, ma stanno in posti diversi. OpenClaw è un assistente personale che vive nelle app di chat che usi già, come WhatsApp, Telegram, Slack, Discord e iMessage, servito da un solo Gateway. Monsters è un’app desktop con una squadra di agenti che guardi e guidi, un vault di note e un interruttore di emergenza. OpenClaw è molto più grande, con circa 392.700 stelle su GitHub e una fondazione alle spalle.',
      teaser:
        'Un assistente personale che vive nelle tue app di chat, su un Gateway, con app native su cinque sistemi. Molto più grande, e di forma diversa.',
      rows: {
        what: 'Un assistente personale open source che gira sul tuo computer e risponde nelle app di chat che usi già, tramite un solo Gateway. Strumenti, skill e plugin lo estendono.',
        license:
          'MIT. Portato avanti dalla OpenClaw Foundation, un ente indipendente senza scopo di lucro. Nessun piano a pagamento né servizio ospitato.',
        stage:
          'Versioni a calendario: v2026.10.5 (18 ottobre 2026), con beta nel mezzo. Repository dal novembre 2025. Circa 392.700 stelle su GitHub.',
        platforms:
          'App native per macOS, iOS, Android, Windows e Linux, più un installer per macOS, Linux e Windows.',
        stack: 'TypeScript su Node.js (24.16 o successivo per le installazioni con npm).',
        models:
          'Provider ospitati e locali, tra cui OpenAI, Anthropic, Google, OpenRouter e xAI, più URL personalizzati.',
        local: 'Sì: Ollama, LM Studio, llama.cpp, vLLM e SGLang.',
        subs: 'L’accesso con ChatGPT e Codex è documentato; le configurazioni con la CLI di Claude Code rientrano nel suo monitoraggio dell’uso.',
        agents:
          'Più agenti isolati dietro un solo Gateway, instradati per canale. Un preset opzionale aggiunge un coordinatore con specialisti (ricercatore, autore, revisore) che non delegano oltre.',
        mcp: 'Client MCP (stdio, HTTP e SSE) da Impostazioni o dalla CLI, e `openclaw mcp serve` per esporre le conversazioni dei canali.',
        notes:
          'Stato, memoria e credenziali stanno sul tuo hardware. Nessun vault di note in Markdown documentato.',
        permissions:
          'Gli strumenti girano sull’host per la sessione principale, a meno di configurare una sandbox. Ci sono approvazioni per i comandi e l’abbinamento per i mittenti sconosciuti.',
        kill: 'Scrivi «stop» (o «abort», «halt»…) come messaggio per interrompere un lavoro. I comandi in background si uccidono su richiesta. Nessun interruttore unico documentato.',
        caps: 'Uso e costo stimato sono tracciati e mostrati. Tetti rigidi non documentati nelle pagine che abbiamo letto.',
        history: 'Trascrizioni delle sessioni e log; i riepiloghi dei costi si ricavano da questi.',
        remote:
          'Si raggiunge dai suoi canali di messaggistica, da una Control UI, da una CLI e da una TUI, e dalle app companion.',
        schedule: 'Strumenti cron e heartbeat.',
        data: 'Stato, memoria e credenziali restano sul tuo hardware. Di base controlla solo ogni giorno se c’è una versione nuova; le statistiche anonime sono facoltative.',
      },
      ahead: [
        'Dimensioni e community. Circa 392.700 stelle su GitHub, una fondazione, release frequenti e un hub di plugin. Monsters ha 4 stelle ed è pubblico dal 20 ottobre 2026.',
        'Raggio d’azione. Oltre 20 piattaforme di messaggistica e app native per iOS e Android. Monsters ha Telegram e SSH, e nessuna app per il telefono.',
        'Ecosistema. Strumenti, skill e plugin, e app companion per voce, fotocamera e schermo.',
        'Provider. Una lunga lista di provider ospitati e runtime locali come llama.cpp, vLLM e SGLang.',
        'Governance. Una fondazione indipendente e nessun piano a pagamento.',
      ],
      differs: [
        'Uno spazio di lavoro per guardare una squadra al lavoro. Monsters dà a ogni agente una chat, un terminale e uno stato che vedi, e progetti e automazioni arrivano come bozze da confermare prima che parta qualcosa.',
        'Prudente di base. Terminale e file restano spenti finché non li concedi, agente per agente, e un modello piccolo (Istinto) ferma le azioni che uscirebbero dal computer. OpenClaw ha approvazioni dei comandi, abbinamento e sandbox facoltativa, ma la sua documentazione dice che gli strumenti girano sull’host se non configuri la sandbox.',
        'Note che puoi leggere e annullare: un vault Markdown sotto git, dove ogni modifica di un agente è un commit che puoi ripristinare.',
        'Una leva e tetti di spesa. Un solo interruttore interrompe ogni lavoro e uccide i processi figli, e i tetti giornalieri e mensili valgono per progetto. OpenClaw mostra uso e costo stimato e permette di fermare un lavoro con un messaggio; un tetto rigido non l’abbiamo trovato.',
        'Un orchestratore che propone progetti interi a una squadra stabile. In OpenClaw gli agenti sono personaggi separati di base, con un coordinatore come opzione.',
      ],
      pickThem: [
        'Vuoi un assistente a cui scrivere da WhatsApp, Slack, iMessage o Discord, ovunque tu sia.',
        'Vuoi app native sul telefono e una community e un ecosistema di plugin grandi.',
        'Vuoi un progetto portato avanti da una fondazione indipendente, senza piani a pagamento.',
      ],
      pickUs: [
        'Vuoi uno spazio di lavoro sul desktop con una squadra di agenti che puoi guardare, ciascuno con i suoi permessi.',
        'Vuoi la memoria come note Markdown da aprire con Obsidian e da poter annullare.',
        'Vuoi un interruttore di emergenza e tetti di spesa già inclusi.',
        'Vuoi usare il tuo abbonamento a Claude Code o ChatGPT tramite l’app.',
        'Accetti un’alpha con una community molto piccola.',
      ],
      faq: [
        {
          q: 'Monsters è un’alternativa a OpenClaw?',
          a: 'In parte. Entrambi girano sul tuo hardware con i modelli che scegli e parlano MCP. OpenClaw è un assistente personale che vive nelle tue app di chat ed è molto più grande; Monsters è un’app desktop con una squadra di agenti, un vault di note, tetti di spesa e un interruttore di emergenza. Quale ti serve dipende dal volere un assistente a cui scrivere o una squadra da gestire.',
        },
        {
          q: 'Posso usare Monsters da WhatsApp o iMessage?',
          a: 'No. Monsters si raggiunge da Telegram (compreso un bot per agente, nei gruppi), dalla chat da terminale via SSH e dall’app desktop come client SSH. OpenClaw supporta più di 20 piattaforme di messaggistica.',
        },
      ],
    },
  },
};

export const COMPARE: Record<Lang, Compare> = { en, it };
