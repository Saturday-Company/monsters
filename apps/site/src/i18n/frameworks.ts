/*
 * /compare/frameworks/ and /it/compare/frameworks/: Monsters, an app, next to three libraries for
 * building agents in code. Facts about the three were read from their repositories, documentation
 * and package pages on VERIFIED (sources at the bottom of the page); where we found nothing in the
 * pages we read, the text says so. The Italian dictionary has the English one's type.
 */
import type { Source } from './compare.ts';
import type { Lang } from './strings.ts';

/** The day the facts below were checked. */
export const FRAMEWORKS_VERIFIED = '2026-11-24';

export const FRAMEWORKS = ['crewai', 'langgraph', 'autogen'] as const;
export type FrameworkSlug = (typeof FRAMEWORKS)[number];

export const FRAMEWORK_ROWS = [
  'what',
  'use',
  'language',
  'license',
  'stage',
  'paid',
  'visual',
  'local',
  'mcp',
  'memory',
  'safety',
] as const;
export type FrameworkRow = (typeof FRAMEWORK_ROWS)[number];

/** What is the same in both languages: names, links, figures. */
export const FRAMEWORK_FACTS: Record<
  FrameworkSlug,
  { name: string; site: string; repo: string; sources: Source[] }
> = {
  crewai: {
    name: 'CrewAI',
    site: 'https://docs.crewai.com/',
    repo: 'https://github.com/crewAIInc/crewAI',
    sources: [
      { label: 'CrewAI README', url: 'https://github.com/crewAIInc/crewAI' },
      { label: 'CrewAI documentation', url: 'https://docs.crewai.com/' },
      { label: 'CrewAI on PyPI', url: 'https://pypi.org/project/crewai/' },
      { label: 'CrewAI releases', url: 'https://github.com/crewAIInc/crewAI/releases' },
      { label: 'CrewAI LLM connections', url: 'https://docs.crewai.com/en/learn/llm-connections' },
      { label: 'CrewAI MCP', url: 'https://docs.crewai.com/en/mcp/overview' },
      { label: 'CrewAI memory', url: 'https://docs.crewai.com/en/concepts/memory' },
      {
        label: 'CrewAI Crew Studio',
        url: 'https://docs-platform.crewai.com/platform/en/features/crew-studio',
      },
    ],
  },
  langgraph: {
    name: 'LangGraph',
    site: 'https://docs.langchain.com/oss/python/langgraph/overview',
    repo: 'https://github.com/langchain-ai/langgraph',
    sources: [
      { label: 'LangGraph README', url: 'https://github.com/langchain-ai/langgraph' },
      {
        label: 'LangGraph overview',
        url: 'https://docs.langchain.com/oss/python/langgraph/overview',
      },
      {
        label: 'LangGraph persistence',
        url: 'https://docs.langchain.com/oss/python/langgraph/persistence',
      },
      { label: 'LangGraph on PyPI', url: 'https://pypi.org/project/langgraph/' },
      { label: 'LangGraph releases', url: 'https://github.com/langchain-ai/langgraph/releases' },
      { label: 'LangGraph.js', url: 'https://github.com/langchain-ai/langgraphjs' },
      { label: 'LangSmith Studio', url: 'https://docs.langchain.com/langsmith/studio' },
      { label: 'LangChain pricing', url: 'https://www.langchain.com/pricing' },
      {
        label: 'LangChain models (Ollama)',
        url: 'https://docs.langchain.com/oss/python/langchain/models',
      },
      { label: 'LangChain MCP', url: 'https://docs.langchain.com/oss/python/langchain/mcp' },
    ],
  },
  autogen: {
    name: 'AutoGen',
    site: 'https://microsoft.github.io/autogen/stable/',
    repo: 'https://github.com/microsoft/autogen',
    sources: [
      { label: 'AutoGen README', url: 'https://github.com/microsoft/autogen' },
      { label: 'AutoGen documentation', url: 'https://microsoft.github.io/autogen/stable/' },
      { label: 'AutoGen releases', url: 'https://github.com/microsoft/autogen/releases' },
      { label: 'autogen-agentchat on PyPI', url: 'https://pypi.org/project/autogen-agentchat/' },
      {
        label: 'AutoGen models (Ollama)',
        url: 'https://microsoft.github.io/autogen/stable/user-guide/agentchat-user-guide/tutorial/models.html',
      },
      {
        label: 'Microsoft Agent Framework',
        url: 'https://learn.microsoft.com/en-us/agent-framework/overview/',
      },
      {
        label: 'Migrating from AutoGen',
        url: 'https://learn.microsoft.com/en-us/agent-framework/migration-guide/from-autogen/',
      },
    ],
  },
};

interface Faq {
  q: string;
  a: string;
}

interface Frameworks {
  title: string;
  metaTitle: string;
  description: string;
  intro: string;
  /** Used on the comparison index. */
  teaser: string;
  chrome: {
    verified: string;
    tableTitle: string;
    row: string;
    kindTitle: string;
    aheadTitle: string;
    differsTitle: string;
    pickThem: string;
    pickUs: string;
    faq: string;
    sources: string;
    sourcesNote: string;
    other: string;
    note: string;
  };
  kind: string[];
  rowLabels: Record<FrameworkRow, string>;
  /** The Monsters column; `{release}` is filled from the build. */
  monsters: Record<FrameworkRow, string>;
  rows: Record<FrameworkSlug, Record<FrameworkRow, string>>;
  ahead: string[];
  differs: string[];
  pickThem: string[];
  pickUs: string[];
  faq: Faq[];
}

const en: Frameworks = {
  title: 'Monsters vs CrewAI, LangGraph and AutoGen',
  metaTitle: 'Monsters vs CrewAI, LangGraph, AutoGen: an app vs agent frameworks',
  description:
    'Monsters is a ready-made desktop app; CrewAI, LangGraph and AutoGen are code libraries for building agents. A dated, honest comparison: when to pick which.',
  intro:
    'CrewAI, LangGraph and AutoGen are libraries: you write code to build agents. Monsters is a desktop app you install and set up from its interface. They solve different problems, so this page does not crown a winner. It says what each is, where the frameworks are the better choice and when Monsters fits.',
  teaser:
    'An app next to three libraries for building agents in code. They win on flexibility and community; Monsters wins if you want a team of agents without writing code.',
  chrome: {
    verified: 'Facts checked on {date}',
    tableTitle: 'Side by side',
    row: 'Topic',
    kindTitle: 'An app and a framework are different things',
    aheadTitle: 'Where the frameworks win',
    differsTitle: 'Where Monsters is the better fit',
    pickThem: 'Pick a framework if',
    pickUs: 'Pick Monsters if',
    faq: 'Questions',
    sources: 'Sources',
    sourcesNote:
      'Read on {date}. Versions and star counts are the ones shown then. Where a row says “not described”, we found nothing in the pages listed here.',
    other: 'Other comparisons',
    note: 'Not described in the pages we read.',
  },
  kind: [
    'A framework is a toolbox for programmers. You install a library, write Python (or, for LangGraph, JavaScript; for AutoGen, .NET) code that defines the agents, their tools and how they work together, and you run it yourself, on your own servers or on a platform you choose. You get full control and you do the engineering.',
    'An app is the finished thing. Monsters is installed like any desktop program: you pick a model, answer a few questions and get an orchestrator with a squad of agents, a notes vault, spending caps and a kill switch, all set up from the interface. You get less freedom to reshape the machinery and nothing to build.',
    'So the question is rarely “which is better” and usually “do I want to build agents into something, or use a team of agents?”',
  ],
  rowLabels: {
    what: 'What it is',
    use: 'How you use it',
    language: 'Language',
    license: 'License',
    stage: 'Maturity',
    paid: 'Paid offers around it',
    visual: 'Visual tools',
    local: 'Local models',
    mcp: 'MCP',
    memory: 'Memory and state',
    safety: 'Safety controls',
  },
  monsters: {
    what: 'A desktop app with an orchestrator (Titan) and a squad of named agents, each with its own chat, terminal, permissions and model chain.',
    use: 'You install it and set it up in the app. Projects and automations are proposed as drafts you confirm. A command line and Telegram are there too.',
    language: 'TypeScript: a Node.js 24 core and an Electron app.',
    license: 'Apache-2.0.',
    stage:
      'Alpha ({release}). Public since 20 October 2026. A young project with a small community.',
    paid: 'None. The app is free; models cost what their providers charge.',
    visual: 'The app itself: chats, a behind-the-scenes view, notes, activity, settings.',
    local: 'Yes: Ollama and LM Studio.',
    mcp: 'MCP client (stdio and HTTP) with a gallery of services. `monsters mcp` serves your notes to Claude Desktop, Codex or Cursor.',
    memory:
      'An Obsidian-compatible Markdown vault under git: every agent edit is a commit you can undo.',
    safety:
      'Built in: terminal and files off until granted per agent, daily and monthly spending caps, an action log and one kill switch.',
  },
  rows: {
    crewai: {
      what: 'An open-source Python framework for multi-agent workflows: Crews of collaborating agents and event-driven Flows.',
      use: 'You write Python code against its API and run it yourself.',
      language: 'Python (3.10 to 3.13).',
      license: 'MIT. The commercial CrewAI AMP Suite is separate.',
      stage:
        'Version 1.15.45 (24 November 2026), releases every few days. Repository since October 2023. About 61,200 GitHub stars.',
      paid: 'CrewAI AMP Suite: a commercial control plane for deployment, observability and governance. Its Crew Control Plane can be tried for free.',
      visual:
        'Crew Studio, an AI-assisted visual workspace on the CrewAI platform. Code exported from it loses the visual editor.',
      local: 'Yes: Ollama and LM Studio are named in its documentation.',
      mcp: 'Yes: stdio, SSE and streamable HTTP are documented.',
      memory:
        'A unified memory system, stored locally by default. Checkpointing and Flow state are also listed.',
      safety:
        'Not an app feature: limits and approvals are code you write. Anonymous telemetry is on by default and can be turned off.',
    },
    langgraph: {
      what: 'A low-level orchestration framework and runtime for long-running, stateful agents, from the LangChain team.',
      use: 'You write code against its API and run it yourself, or deploy it on LangSmith.',
      language: 'Python (3.10 and later) and JavaScript (LangGraph.js).',
      license: 'MIT. LangSmith, the platform around it, is commercial.',
      stage:
        'Version 1.2.24 (20 November 2026), releases every few days. Repository since August 2023. About 45,400 GitHub stars.',
      paid: 'LangSmith (Studio and Agent Server deployment), with a free developer plan and paid plans.',
      visual: 'LangSmith Studio, an agent IDE to visualize and debug agents; it needs LangSmith.',
      local: 'Through LangChain’s model integrations, which include Ollama.',
      mcp: 'Through LangChain’s MCP support, marked beta in its documentation.',
      memory:
        'Persistence with checkpointers (short-term memory) and stores (long-term memory), with in-memory, SQLite and Postgres backends.',
      safety:
        'Not an app feature: limits and stops are code you write. Human-in-the-loop is a headline feature.',
    },
    autogen: {
      what: 'A framework for multi-agent AI applications. Archived: Microsoft no longer maintains it.',
      use: 'You write code against its API and run it yourself. AutoGen Studio is a no-code interface for prototyping.',
      language: 'Python (3.10 and later) and .NET.',
      license: 'Code under MIT, documentation under CC-BY-4.0.',
      stage:
        'Archived. The last release is python-v0.7.5 (30 September 2025). About 62,000 GitHub stars. Microsoft says it gives no bug fixes, security fixes or new features, and points new users to Microsoft Agent Framework.',
      paid: 'None found.',
      visual:
        'AutoGen Studio. Its README says it is for prototyping and not meant to be a production-ready app.',
      local: 'Yes: an Ollama client, marked experimental.',
      mcp: 'Yes: an MCP workbench is in its extensions.',
      memory: 'Not described in the pages we read.',
      safety:
        'Not an app feature: limits and approvals are code you write. Microsoft advises against production use.',
    },
  },
  ahead: [
    'Freedom. You decide how agents are built, how they talk to each other, what tools they have and what happens on failure. Monsters has one shape: a lead and a squad.',
    'Embedding. If agents must live inside your own product, service or pipeline, a library is the right tool. Monsters is an app, with a command line but no library to embed.',
    'Community and ecosystem. CrewAI and LangGraph are used by far more people, ship releases every few days and have tooling, tutorials and hosted platforms around them. Monsters is a young alpha with a small community.',
    'More languages. LangGraph also has a JavaScript version and AutoGen has .NET. Monsters is a TypeScript app.',
    'Production paths. CrewAI and LangGraph have commercial platforms for deployment and observability. Monsters has nothing like that.',
  ],
  differs: [
    'Nothing to build. You install it, connect a model and get a working team, instead of writing and maintaining code.',
    'The controls are already there: permissions off until you grant them, spending caps, an action log and one kill switch that stops every run. In a framework these are yours to implement.',
    'Notes you can read and undo. The memory is a Markdown vault you can open in Obsidian, and every agent edit is a git commit.',
    'Your plans and your machine. It uses your Claude or ChatGPT plan, runs local models with Ollama or LM Studio and keeps notes and logs on your disk.',
    'Reach without code: Telegram, the terminal chat over SSH and the desktop app as a client of another computer.',
  ],
  pickThem: [
    'You are a developer and want agents inside your own software or service.',
    'You need a custom workflow, with your own agent roles, routing and error handling.',
    'You want a large community, mature tooling and a hosted platform to deploy on.',
    'You work in Python, JavaScript or .NET and want full control of the code.',
  ],
  pickUs: [
    'You want a team of agents that works on your computer without writing code.',
    'You want spending caps, permissions and a kill switch without building them.',
    'You want the memory as Markdown notes you can open in Obsidian and undo.',
    'You want to use your Claude or ChatGPT plan, or run local models.',
    'You accept an alpha with a very small community.',
  ],
  faq: [
    {
      q: 'Is Monsters an alternative to CrewAI or LangGraph?',
      a: 'Only partly, because they are different kinds of tool. CrewAI and LangGraph are libraries for building agents in code. Monsters is a ready-made desktop app with a squad of agents. If you need agents inside your own product, use a framework; if you want a team of agents on your computer without code, use Monsters.',
    },
    {
      q: 'Is AutoGen still maintained?',
      a: 'No. Its repository is archived, and Microsoft says it is no longer actively maintained and gives no bug fixes, security fixes or new features. The README points new users to Microsoft Agent Framework, which it calls the successor.',
    },
    {
      q: 'Can I use Monsters together with CrewAI or LangGraph?',
      a: 'They are separate programs with separate data, so nothing stops you from running both. Monsters speaks MCP and can serve its notes to MCP clients with monsters mcp, and CrewAI documents MCP support, but we have not tried them together.',
    },
  ],
};

const it: Frameworks = {
  title: 'Monsters e CrewAI, LangGraph, AutoGen',
  metaTitle: 'Monsters e CrewAI, LangGraph, AutoGen: un’app e dei framework per agenti',
  description:
    'Monsters è un’app desktop già pronta; CrewAI, LangGraph e AutoGen sono librerie per costruire agenti nel codice. Confronto datato: quando scegliere cosa.',
  intro:
    'CrewAI, LangGraph e AutoGen sono librerie: scrivi codice per costruire agenti. Monsters è un’app desktop che installi e configuri dall’interfaccia. Risolvono problemi diversi, quindi questa pagina non proclama un vincitore. Dice cos’è ciascuno, dove i framework sono la scelta migliore e quando va bene Monsters.',
  teaser:
    'Un’app accanto a tre librerie per costruire agenti nel codice. Loro vincono per flessibilità e community; Monsters se vuoi una squadra di agenti senza scrivere codice.',
  chrome: {
    verified: 'Dati controllati il {date}',
    tableTitle: 'Uno accanto all’altro',
    row: 'Tema',
    kindTitle: 'Un’app e un framework sono cose diverse',
    aheadTitle: 'Dove vincono i framework',
    differsTitle: 'Dove Monsters è più adatto',
    pickThem: 'Scegli un framework se',
    pickUs: 'Scegli Monsters se',
    faq: 'Domande',
    sources: 'Fonti',
    sourcesNote:
      'Lette il {date}. Versioni e stelle sono quelle visibili allora. Dove una riga dice «non descritto», non abbiamo trovato nulla nelle pagine elencate qui.',
    other: 'Altri confronti',
    note: 'Non descritto nelle pagine che abbiamo letto.',
  },
  kind: [
    'Un framework è una cassetta degli attrezzi per chi programma. Installi una libreria, scrivi codice Python (o, per LangGraph, JavaScript; per AutoGen, .NET) che definisce gli agenti, i loro strumenti e come lavorano insieme, e lo fai girare tu, sui tuoi server o su una piattaforma che scegli. Hai pieno controllo e fai tu l’ingegneria.',
    'Un’app è la cosa finita. Monsters si installa come un qualsiasi programma desktop: scegli un modello, rispondi a qualche domanda e ottieni un orchestratore con una squadra di agenti, un vault di note, tetti di spesa e un interruttore di stop, tutto configurato dall’interfaccia. Hai meno libertà di rimodellare gli ingranaggi e niente da costruire.',
    'Quindi la domanda raramente è «qual è meglio» e di solito «voglio costruire agenti dentro qualcosa o usare una squadra di agenti?».',
  ],
  rowLabels: {
    what: 'Cos’è',
    use: 'Come lo usi',
    language: 'Linguaggio',
    license: 'Licenza',
    stage: 'Maturità',
    paid: 'Offerte a pagamento attorno',
    visual: 'Strumenti visuali',
    local: 'Modelli locali',
    mcp: 'MCP',
    memory: 'Memoria e stato',
    safety: 'Controlli di sicurezza',
  },
  monsters: {
    what: 'Un’app desktop con un orchestratore (Titan) e una squadra di agenti con un nome, ciascuno con la sua chat, il suo terminale, i suoi permessi e la sua catena di modelli.',
    use: 'La installi e la configuri nell’app. Progetti e automazioni arrivano come bozze che confermi tu. Ci sono anche una riga di comando e Telegram.',
    language: 'TypeScript: un core Node.js 24 e un’app Electron.',
    license: 'Apache-2.0.',
    stage: 'Alpha ({release}). Pubblico dal 20 ottobre 2026. Progetto giovane, community piccola.',
    paid: 'Nessuna. L’app è gratuita; i modelli costano quanto chiedono i loro provider.',
    visual: 'L’app stessa: chat, vista dietro le quinte, note, attività, impostazioni.',
    local: 'Sì: Ollama e LM Studio.',
    mcp: 'Client MCP (stdio e HTTP) con una galleria di servizi. `monsters mcp` serve le tue note a Claude Desktop, Codex o Cursor.',
    memory:
      'Un vault Markdown compatibile con Obsidian sotto git: ogni modifica di un agente è un commit che puoi annullare.',
    safety:
      'Integrati: terminale e file spenti finché non li concedi agente per agente, tetti di spesa giornalieri e mensili, un registro delle azioni e un solo interruttore di stop.',
  },
  rows: {
    crewai: {
      what: 'Un framework Python open source per flussi multi-agente: Crew di agenti che collaborano e Flow guidati dagli eventi.',
      use: 'Scrivi codice Python con la sua API e lo fai girare tu.',
      language: 'Python (da 3.10 a 3.13).',
      license: 'MIT. La CrewAI AMP Suite commerciale è separata.',
      stage:
        'Versione 1.15.45 (24 novembre 2026), una release ogni pochi giorni. Repository dall’ottobre 2023. Circa 61.200 stelle su GitHub.',
      paid: 'CrewAI AMP Suite: un piano di controllo commerciale per distribuzione, osservabilità e governance. Il suo Crew Control Plane si può provare gratis.',
      visual:
        'Crew Studio, uno spazio visuale assistito dall’AI sulla piattaforma CrewAI. Il codice esportato da lì perde l’editor visuale.',
      local: 'Sì: Ollama e LM Studio sono citati nella documentazione.',
      mcp: 'Sì: stdio, SSE e HTTP in streaming sono documentati.',
      memory:
        'Un sistema di memoria unificato, salvato in locale di base. Sono elencati anche checkpoint e stato dei Flow.',
      safety:
        'Non è una funzione di un’app: limiti e approvazioni sono codice che scrivi tu. La telemetria anonima è attiva di base e si può spegnere.',
    },
    langgraph: {
      what: 'Un framework e runtime di orchestrazione di basso livello per agenti con stato e a lunga durata, del team di LangChain.',
      use: 'Scrivi codice con la sua API e lo fai girare tu, oppure lo distribuisci su LangSmith.',
      language: 'Python (3.10 e successivi) e JavaScript (LangGraph.js).',
      license: 'MIT. LangSmith, la piattaforma attorno, è commerciale.',
      stage:
        'Versione 1.2.24 (20 novembre 2026), una release ogni pochi giorni. Repository dall’agosto 2023. Circa 45.400 stelle su GitHub.',
      paid: 'LangSmith (Studio e distribuzione con Agent Server), con un piano gratuito per sviluppatori e piani a pagamento.',
      visual:
        'LangSmith Studio, un IDE per agenti per visualizzarli e fare debug; richiede LangSmith.',
      local: 'Tramite le integrazioni di modelli di LangChain, che includono Ollama.',
      mcp: 'Tramite il supporto MCP di LangChain, segnato beta nella sua documentazione.',
      memory:
        'Persistenza con checkpointer (memoria a breve termine) e store (memoria a lungo termine), con backend in memoria, SQLite e Postgres.',
      safety:
        'Non è una funzione di un’app: limiti e stop sono codice che scrivi tu. Il human-in-the-loop è una funzione in evidenza.',
    },
    autogen: {
      what: 'Un framework per applicazioni AI multi-agente. Archiviato: Microsoft non lo mantiene più.',
      use: 'Scrivi codice con la sua API e lo fai girare tu. AutoGen Studio è un’interfaccia no-code per i prototipi.',
      language: 'Python (3.10 e successivi) e .NET.',
      license: 'Codice con licenza MIT, documentazione con CC-BY-4.0.',
      stage:
        'Archiviato. L’ultima release è python-v0.7.5 (30 settembre 2025). Circa 62.000 stelle su GitHub. Microsoft dice di non dare correzioni di bug, di sicurezza né nuove funzioni, e indirizza i nuovi utenti a Microsoft Agent Framework.',
      paid: 'Nessuna trovata.',
      visual:
        'AutoGen Studio. Il suo README dice che serve per prototipi e non è pensato come app pronta per la produzione.',
      local: 'Sì: un client Ollama, segnato come sperimentale.',
      mcp: 'Sì: un MCP workbench fra le estensioni.',
      memory: 'Non descritto nelle pagine che abbiamo letto.',
      safety:
        'Non è una funzione di un’app: limiti e approvazioni sono codice che scrivi tu. Microsoft sconsiglia l’uso in produzione.',
    },
  },
  ahead: [
    'Libertà. Decidi tu come sono costruiti gli agenti, come parlano fra loro, quali strumenti hanno e cosa succede se qualcosa va storto. Monsters ha una sola forma: un capo e una squadra.',
    'Integrazione. Se gli agenti devono vivere dentro il tuo prodotto, servizio o pipeline, una libreria è lo strumento giusto. Monsters è un’app, con una riga di comando ma senza una libreria da incorporare.',
    'Community ed ecosistema. CrewAI e LangGraph sono usati da molte più persone, rilasciano ogni pochi giorni e hanno attorno strumenti, tutorial e piattaforme ospitate. Monsters è un’alpha giovane con una community piccola.',
    'Più linguaggi. LangGraph ha anche una versione JavaScript e AutoGen ha .NET. Monsters è un’app TypeScript.',
    'Strade verso la produzione. CrewAI e LangGraph hanno piattaforme commerciali per distribuzione e osservabilità. Monsters non ha niente del genere.',
  ],
  differs: [
    'Niente da costruire. La installi, colleghi un modello e hai una squadra funzionante, invece di scrivere e mantenere codice.',
    'I controlli ci sono già: permessi spenti finché non li concedi, tetti di spesa, un registro delle azioni e un solo interruttore che ferma ogni lavoro. In un framework sono da implementare a mano.',
    'Note che puoi leggere e annullare. La memoria è un vault Markdown che apri con Obsidian, e ogni modifica di un agente è un commit git.',
    'I tuoi piani e il tuo computer. Usa il tuo piano Claude o ChatGPT, fa girare modelli locali con Ollama o LM Studio e tiene note e registri sul tuo disco.',
    'Raggiungibile senza codice: Telegram, la chat da terminale via SSH e l’app desktop come client di un altro computer.',
  ],
  pickThem: [
    'Sei uno sviluppatore e vuoi agenti dentro il tuo software o servizio.',
    'Ti serve un flusso su misura, con i tuoi ruoli di agente, il tuo instradamento e la tua gestione degli errori.',
    'Vuoi una community grande, strumenti maturi e una piattaforma ospitata su cui distribuire.',
    'Lavori in Python, JavaScript o .NET e vuoi il pieno controllo del codice.',
  ],
  pickUs: [
    'Vuoi una squadra di agenti che lavora sul tuo computer senza scrivere codice.',
    'Vuoi tetti di spesa, permessi e un interruttore di stop senza costruirteli.',
    'Vuoi la memoria in note Markdown che apri con Obsidian e annulli.',
    'Vuoi usare il tuo piano Claude o ChatGPT, oppure far girare modelli locali.',
    'Accetti un’alpha con una community molto piccola.',
  ],
  faq: [
    {
      q: 'Monsters è un’alternativa a CrewAI o LangGraph?',
      a: 'Solo in parte, perché sono strumenti di tipo diverso. CrewAI e LangGraph sono librerie per costruire agenti nel codice. Monsters è un’app desktop già pronta con una squadra di agenti. Se ti servono agenti dentro il tuo prodotto, usa un framework; se vuoi una squadra di agenti sul tuo computer senza codice, usa Monsters.',
    },
    {
      q: 'AutoGen è ancora mantenuto?',
      a: 'No. Il suo repository è archiviato e Microsoft dice che non è più mantenuto attivamente e che non dà correzioni di bug, di sicurezza né nuove funzioni. Il README indirizza i nuovi utenti a Microsoft Agent Framework, che chiama il successore.',
    },
    {
      q: 'Posso usare Monsters insieme a CrewAI o LangGraph?',
      a: 'Sono programmi separati con dati separati, quindi niente impedisce di far girare entrambi. Monsters parla MCP e con monsters mcp può servire le sue note ai client MCP, e CrewAI documenta il supporto MCP, ma non li abbiamo provati insieme.',
    },
  ],
};

export const FRAMEWORKS_PAGE: Record<Lang, Frameworks> = { en, it };
