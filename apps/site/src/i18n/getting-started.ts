/*
 * /docs/getting-started/ and /it/docs/getting-started/: from nothing to a first agent at work.
 * Every command comes from the README, the CLI's own help or docs/remote.md, and every name of a
 * setting from the app's own dictionaries (apps/web). The Italian dictionary has the English
 * one's type, so a missing paragraph fails the typecheck.
 */
import type { Lang } from './strings.ts';

/** A block of commands to copy, with what it is for. */
export interface Cmd {
  label: string;
  code: string;
}

export interface Step {
  id: string;
  title: string;
  /** Paragraphs before the commands. */
  body: string[];
  cmds?: Cmd[];
  /** Paragraphs after the commands. */
  after?: string[];
}

interface GettingStarted {
  title: string;
  metaTitle: string;
  description: string;
  /** Two or three sentences, written for this page. */
  tldr: string;
  tldrLabel: string;
  updated: string;
  copy: string;
  copied: string;
  crumb: string;
  /** The label of the card on the docs index. */
  open: string;
  /** The small line over the card's title on the docs index. */
  kicker: string;
  steps: Step[];
  nextTitle: string;
  next: [string, string][];
  faq: { q: string; a: string }[];
  faqTitle: string;
}

/** Where each section of the app is, as the app names it. */
const en: GettingStarted = {
  title: 'Getting started with Monsters',
  metaTitle: 'Getting started with Monsters: install, connect a model, first agent',
  description:
    'Install Monsters, connect a model (free, your own key, a plan or local with Ollama), create your first agent and use it. Commands to copy, no code needed.',
  tldr: 'Download the app for your system (or build it from source), connect one model and say Looks good to the squad Monsters proposes. A free OpenRouter key is enough, and Ollama works if you want everything on your computer. Add more agents later from Settings, Squad, and stop everything with one lever if you need to.',
  tldrLabel: 'In short',
  updated: 'Last updated',
  copy: 'Copy',
  copied: 'Copied',
  crumb: 'Getting started',
  open: 'Read the guide',
  kicker: 'Start here',
  steps: [
    {
      id: 'install',
      title: '1. Install Monsters',
      body: [
        'Download the build for your system from the Download section of the home page or from GitHub Releases. Linux: AppImage or .deb. macOS: .dmg for Apple silicon or Intel, signed and notarized. Windows: an .exe installer that is not yet signed with a certificate from a public authority, so SmartScreen warns you: choose More info, then Run anyway. The app updates itself from a signed feed.',
        'Prefer the source? You need Node.js 24 or newer and pnpm 12 (`corepack enable` picks the pnpm version from `package.json`) and about 1 GB of disk. From a clone of the repository:',
      ],
      cmds: [
        {
          label: 'Build from source and start',
          code: 'git clone https://github.com/Saturday-Company/monsters && cd monsters\npnpm install\npnpm --filter @monsters/web build\npnpm --filter @monsters/cli exec monsters start',
        },
      ],
      after: [
        '`monsters start` prints the address to open (http://127.0.0.1:4747), the data folder and the notes folder, and a one-time setup code for creating your account. The core listens only on 127.0.0.1. To run the Electron desktop app from source instead, use `pnpm desktop:dev`.',
      ],
    },
    {
      id: 'first-start',
      title: '2. The first start',
      body: [
        'The first start has four screens: your account, a model, your name, and then the squad Monsters proposes, with one Looks good. Your work, tone and writing language come later, in a skippable Tell me more about you card.',
        'The installed app first asks where the monsters work; On this computer is the usual answer. From the source, the setup code printed by `monsters start` is what you type to create the account. Data lives in `~/.monsters` (or `MONSTERS_HOME`). If your system has no keychain, start with `MONSTERS_SECRETS=file`.',
      ],
    },
    {
      id: 'model',
      title: '3. Connect a model',
      body: [
        'The second screen asks how to reach a model. One is enough, and you can add the others later in Settings, Models. The options:',
        'A free OpenRouter key: create it at openrouter.ai/keys, paste the full key (it starts with `sk-or-`) and Monsters starts with free models. Your Claude plan through Claude Code, or your ChatGPT plan (also through Codex): see the subscriptions guide. Your own API keys for Anthropic, OpenAI, Google, Mistral or Groq, which are paid and billed by the provider; Monsters recognizes a key by its prefix. Settings, Models is also where you choose the main model and a fallback for all the monsters.',
      ],
    },
    {
      id: 'ollama',
      title: '4. Use a local model with Ollama',
      body: [
        'Ollama and LM Studio run models on your own computer, so prompts never leave it. Install and start Ollama first (see its own documentation), and download a model there. Then in Monsters open Settings, Models, add Ollama and press Connect: the address is usually the one already written, `http://127.0.0.1:11434`. LM Studio works the same way.',
        'Choose the Ollama model as the main model, or as a monster’s first model in Advanced. Each monster has its own chain with a fallback, so one can use a local model for private notes and a cloud model for harder jobs. Monsters says local models are free and private but slower and less capable with tools, so start with something small and try it.',
        'Monsters sizes the context window from the loaded model, else from the Modelfile’s `num_ctx`, else it assumes 4096 tokens: a model that reports no larger context is compacted accordingly, so load it with a bigger context if your jobs need it.',
      ],
    },
    {
      id: 'agent',
      title: '5. Meet the squad and add your first agent',
      body: [
        'Monsters has proposed a squad: a lead (Titan by default) that plans and hands work to the others, each with its own chat, role and a folder in the notes where it writes. Message the lead and watch it delegate. When a choice is yours it asks with two to four options, one recommended, and projects and automations arrive as drafts under To review: nothing exists until you confirm it.',
        'To add an agent, open Settings, Squad and press Add a monster. Pick a ready-made one, or choose Or a custom one and say in a few words what it should do. The model prepares it from your description, which can take a minute; check it, change whatever you like (its role, goal, duties and the folder where it writes), and press Add to the squad. Then message it from its chat.',
        'From a terminal, with the core running, you can talk to the squad too. In a clone of the repository, `monsters` means `pnpm --filter @monsters/cli exec monsters`:',
      ],
      cmds: [
        {
          label: 'Chat in the terminal',
          code: 'pnpm --filter @monsters/cli exec monsters chat',
        },
        {
          label: 'Send one message to a specific monster and follow the run',
          code: 'pnpm --filter @monsters/cli exec monsters chat --to Rhea "sum up this week\'s notes"',
        },
        {
          label: 'See what is running',
          code: 'pnpm --filter @monsters/cli exec monsters status',
        },
      ],
      after: [
        'Inside the terminal chat, `@Rhea` at the start of a line talks to one monster, `/new` starts a new conversation and `/exit` closes the chat; work in progress goes on.',
      ],
    },
    {
      id: 'stop',
      title: '6. Stop everything when you need to',
      body: [
        'One lever stops every run and every child process: the red Stop key in the app, `/stop` on Telegram, or `monsters kill` in a terminal. Nothing runs again until you resume.',
      ],
      cmds: [
        {
          label: 'Stop every agent now',
          code: 'pnpm --filter @monsters/cli exec monsters kill',
        },
        {
          label: 'Allow them to run again',
          code: 'pnpm --filter @monsters/cli exec monsters resume',
        },
      ],
      after: [
        'Terminal and file access stay off until you grant them, monster by monster, and the notes are plain Markdown files with a git commit for every edit, so you can undo a job.',
      ],
    },
  ],
  nextTitle: 'Where to go next',
  next: [
    ['/docs/subscriptions/', 'Use your Claude or ChatGPT plan'],
    ['/docs/remote/', 'Reach Monsters from your phone or another computer'],
    ['/docs/mcp-vault/', 'Open your notes in Claude Desktop, Codex or Cursor'],
    ['/docs/security-model/', 'What the permissions really mean'],
  ],
  faqTitle: 'Questions',
  faq: [
    {
      q: 'Do I need to pay to try Monsters?',
      a: 'No. The app is free and open source, and a free OpenRouter key gives you free models to start. Models from other providers cost what their providers charge, and you can set daily and monthly spending caps.',
    },
    {
      q: 'Can I use Monsters with Ollama?',
      a: 'Yes. Ollama and LM Studio work as providers: add one in Settings, Models, then choose it as a monster’s model. Model calls then stay on your computer. Local models are slower and less capable with tools than the big cloud ones.',
    },
    {
      q: 'Do I need to know how to code?',
      a: 'No. Download the installer, create your local account, connect a model and answer a few questions. Programming is only needed to build from source or to contribute.',
    },
  ],
};

const it: GettingStarted = {
  title: 'Iniziare con Monsters',
  metaTitle: 'Iniziare con Monsters: installa, collega un modello, primo agente',
  description:
    'Installa Monsters, collega un modello (gratis, una tua chiave, un piano o Ollama), crea il primo agente e usalo. Comandi da copiare, senza scrivere codice.',
  tldr: 'Scarica l’app per il tuo sistema (o compilala dai sorgenti), collega un modello e di’ «Va bene» alla squadra che Monsters ti propone. Basta una chiave OpenRouter gratuita, e con Ollama puoi tenere tutto sul tuo computer. Gli altri agenti si aggiungono dopo da Impostazioni, Squadra, e con una sola leva ferma tutto.',
  tldrLabel: 'In breve',
  updated: 'Ultimo aggiornamento',
  copy: 'Copia',
  copied: 'Copiato',
  crumb: 'Iniziare',
  open: 'Leggi la guida',
  kicker: 'Inizia da qui',
  steps: [
    {
      id: 'install',
      title: '1. Installa Monsters',
      body: [
        'Scarica la versione per il tuo sistema dalla sezione Scarica della home o da GitHub Releases. Linux: AppImage o .deb. macOS: .dmg per Apple silicon o Intel, firmato e notarizzato. Windows: un installer .exe non ancora firmato con un certificato di un’autorità pubblica, quindi SmartScreen ti avvisa: scegli Ulteriori informazioni, poi Esegui comunque. L’app si aggiorna da sola da un feed firmato.',
        'Preferisci i sorgenti? Servono Node.js 24 o successivo e pnpm 12 (`corepack enable` usa la versione di pnpm indicata in `package.json`) e circa 1 GB di spazio. Da un clone del repository:',
      ],
      cmds: [
        {
          label: 'Compila dal sorgente e avvia',
          code: 'git clone https://github.com/Saturday-Company/monsters && cd monsters\npnpm install\npnpm --filter @monsters/web build\npnpm --filter @monsters/cli exec monsters start',
        },
      ],
      after: [
        '`monsters start` stampa l’indirizzo da aprire (http://127.0.0.1:4747), la cartella dei dati e quella delle note, e un codice di avvio monouso per creare l’account. Il core ascolta solo su 127.0.0.1. Per far girare dal sorgente l’app desktop Electron, usa `pnpm desktop:dev`.',
      ],
    },
    {
      id: 'first-start',
      title: '2. Il primo avvio',
      body: [
        'Il primo avvio ha quattro schermate: il tuo account, un modello, il tuo nome e poi la squadra che Monsters propone, con un solo Va bene. Il tuo lavoro, il tono e la lingua di scrittura arrivano dopo, in una scheda «Dimmi di più su di te» che puoi saltare.',
        'L’app installata chiede prima dove lavorano i mostri; di solito si risponde Su questo computer. Dal sorgente, il codice di avvio stampato da `monsters start` serve a creare l’account. I dati stanno in `~/.monsters` (o `MONSTERS_HOME`). Se il tuo sistema non ha un portachiavi, avvia con `MONSTERS_SECRETS=file`.',
      ],
    },
    {
      id: 'model',
      title: '3. Collega un modello',
      body: [
        'La seconda schermata chiede come raggiungere un modello. Ne basta uno, e gli altri si aggiungono dopo in Impostazioni, Modelli. Le strade:',
        'Una chiave OpenRouter gratuita: creala su openrouter.ai/keys, incolla la chiave intera (inizia con `sk-or-`) e Monsters parte con i modelli gratuiti. Il tuo piano Claude tramite Claude Code, o il tuo piano ChatGPT (anche con Codex): vedi la guida sugli abbonamenti. Le tue chiavi API di Anthropic, OpenAI, Google, Mistral o Groq, a pagamento e fatturate dal provider; Monsters riconosce una chiave dal prefisso. In Impostazioni, Modelli scegli anche il modello principale e uno di riserva per tutti i mostri.',
      ],
    },
    {
      id: 'ollama',
      title: '4. Usa un modello locale con Ollama',
      body: [
        'Ollama e LM Studio fanno girare i modelli sul tuo computer, quindi i prompt non ne escono. Installa e avvia prima Ollama (vedi la sua documentazione) e scarica lì un modello. Poi in Monsters apri Impostazioni, Modelli, aggiungi Ollama e premi Collega: l’indirizzo di solito è già scritto, `http://127.0.0.1:11434`. LM Studio funziona allo stesso modo.',
        'Scegli il modello di Ollama come modello principale, o come primo modello di un mostro in Avanzate. Ogni mostro ha la sua catena con una riserva, quindi uno può usare un modello locale per le note private e uno nel cloud per i lavori più difficili. Monsters dice che i modelli locali sono gratuiti e privati ma più lenti e meno capaci con gli strumenti, quindi parti da uno piccolo e provalo.',
        'Monsters ricava la finestra di contesto dal modello caricato, altrimenti dal `num_ctx` del Modelfile, altrimenti presume 4096 token: un modello che non dichiara un contesto più grande viene compattato di conseguenza, quindi caricalo con un contesto più ampio se i tuoi lavori lo richiedono.',
      ],
    },
    {
      id: 'agent',
      title: '5. Conosci la squadra e aggiungi il primo agente',
      body: [
        'Monsters ti ha proposto una squadra: un capo (di base Titan) che pianifica e passa il lavoro agli altri, ognuno con la sua chat, il suo ruolo e una cartella nelle note dove scrive. Scrivi al capo e guardalo delegare. Quando la scelta è tua ti chiede con da due a quattro opzioni, una consigliata, e progetti e automazioni arrivano come bozze in Da rivedere: non esiste niente finché non confermi.',
        'Per aggiungere un agente apri Impostazioni, Squadra e premi Aggiungi un mostro. Scegline uno pronto, oppure Oppure su misura e scrivi in qualche parola cosa deve fare. Il modello lo prepara dalla tua descrizione, e può servire un minuto; controllalo, cambia quello che vuoi (ruolo, obiettivo, compiti e cartella dove scrive) e premi Aggiungi alla squadra. Poi scrivigli dalla sua chat.',
        'Da un terminale, con il core avviato, puoi parlare con la squadra anche così. In un clone del repository, `monsters` vuol dire `pnpm --filter @monsters/cli exec monsters`:',
      ],
      cmds: [
        {
          label: 'Chat nel terminale',
          code: 'pnpm --filter @monsters/cli exec monsters chat',
        },
        {
          label: 'Manda un messaggio a un mostro preciso e segui il lavoro',
          code: 'pnpm --filter @monsters/cli exec monsters chat --to Rhea "riassumi le note di questa settimana"',
        },
        {
          label: 'Vedi cosa sta girando',
          code: 'pnpm --filter @monsters/cli exec monsters status',
        },
      ],
      after: [
        'Nella chat da terminale, `@Rhea` a inizio riga parla con un solo mostro, `/nuova` (o `/new`) apre una nuova conversazione e `/esci` (o `/exit`) chiude la chat; il lavoro in corso continua.',
      ],
    },
    {
      id: 'stop',
      title: '6. Ferma tutto quando serve',
      body: [
        'Una sola leva ferma ogni lavoro e ogni processo figlio: il tasto rosso Stop nell’app, `/stop` su Telegram o `monsters kill` in un terminale. Non riparte niente finché non riprendi.',
      ],
      cmds: [
        {
          label: 'Ferma subito ogni agente',
          code: 'pnpm --filter @monsters/cli exec monsters kill',
        },
        {
          label: 'Lasciali ripartire',
          code: 'pnpm --filter @monsters/cli exec monsters resume',
        },
      ],
      after: [
        'Terminale e file restano spenti finché non li concedi, mostro per mostro, e le note sono file Markdown semplici con un commit git per ogni modifica, così puoi annullare un lavoro.',
      ],
    },
  ],
  nextTitle: 'E poi',
  next: [
    ['/docs/subscriptions/', 'Usa il tuo piano Claude o ChatGPT (in inglese)'],
    ['/docs/remote/', 'Raggiungi Monsters dal telefono o da un altro computer (in inglese)'],
    ['/docs/mcp-vault/', 'Apri le tue note in Claude Desktop, Codex o Cursor (in inglese)'],
    ['/docs/security-model/', 'Cosa significano davvero i permessi (in inglese)'],
  ],
  faqTitle: 'Domande',
  faq: [
    {
      q: 'Devo pagare per provare Monsters?',
      a: 'No. L’app è gratuita e open source, e una chiave OpenRouter gratuita ti dà modelli gratuiti per iniziare. I modelli degli altri provider costano quanto chiedono loro, e puoi fissare tetti di spesa giornalieri e mensili.',
    },
    {
      q: 'Posso usare Monsters con Ollama?',
      a: 'Sì. Ollama e LM Studio funzionano come provider: ne aggiungi uno in Impostazioni, Modelli, poi lo scegli come modello di un mostro. Le chiamate al modello restano sul tuo computer. I modelli locali sono più lenti e meno capaci con gli strumenti di quelli grandi nel cloud.',
    },
    {
      q: 'Devo saper programmare?',
      a: 'No. Scarichi l’installer, crei il tuo account locale, colleghi un modello e rispondi a qualche domanda. Programmare serve solo per compilarlo dai sorgenti o per contribuire.',
    },
  ],
};

export const GETTING_STARTED: Record<Lang, GettingStarted> = { en, it };

/** Every command of the page, for the tests that check them against the repository. */
export const gettingStartedCommands = (): string[] =>
  GETTING_STARTED.en.steps.flatMap((s) => (s.cmds ?? []).map((c) => c.code));
