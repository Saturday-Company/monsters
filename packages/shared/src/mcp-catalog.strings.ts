import { pick, type Lang } from './i18n.ts';

/*
 * The words of the gallery of apps (D-063, D-153): categories, one line on what the
 * monsters can do with each, the company field, the token's name and hint, notes and the reason
 * a service is "soon". Ids, addresses and commands are data and stay in `mcp-catalog.ts`.
 */

export interface CatalogEntryTexts {
  /** Only for the names that have words in them ("Jira e Confluence"). */
  name?: string;
  /** One sentence: what the monsters can do with it (10 to 60 characters). */
  description: string;
  tenantLabel?: string;
  tenantHint?: string;
  /** The token method: what to call it in the panel and which permissions to give it. */
  token?: { label: string; hint?: string };
  note?: string;
  soon?: string;
}

const en = {
  categories: {
    sviluppo: 'Development',
    lavoro: 'Work and projects',
    dati: 'Data',
    pagamenti: 'Payments',
    ricerca: 'Research',
    automazioni: 'Automations',
    design: 'Design',
  },
  tenantChars: 'only lowercase letters, numbers and dashes',
  /** The default name of the company field. */
  tenantLabel: 'Your company',
  soonApproved:
    'It only accepts apps approved one by one and has no key to paste. With your Claude plan connected you use it through Claude.',
  /** `settings` is the place of the models in the settings ("Settings → Models"). */
  soonClaudeDesign: (settings: string) =>
    `It connects only through Claude: you need your Claude plan connected in ${settings}.`,
  /** Where to get the program that starts a server. */
  nodeDownload: 'https://nodejs.org/en/download',
  entries: {
    anteiku: {
      description: 'Clients, projects, tasks, calendar and quotes',
      tenantLabel: 'Your company',
      tenantHint: 'The name before .anteiku.it in the address you use (for Saturday: saturday).',
      token: {
        label: 'Personal key',
        hint: 'In Sistema › Connessioni, after unlocking with your password: it starts with anteiku_pat_ and is shown only once.',
      },
      note: 'The monsters work like you, with your permissions; every change stays in Anteiku’s activity.',
    },
    witdesk: {
      description: 'Customer service tickets and requests',
      tenantLabel: 'Your company',
      tenantHint: 'The name before .witdesk.it in the address you use.',
      token: {
        label: 'Personal key',
        hint: 'In Preferenze › Connessioni: it starts with witdesk_pat_ and is shown only once.',
      },
      note: 'First your company’s administrator turns on “Connettori” in WitDesk (Banco → Impostazioni → Collegamenti).',
    },
    github: {
      description: 'Read and create issues and pull requests',
      token: {
        label: 'Personal key',
        hint: 'Pick the repositories and give read and write access to Contents, Issues and Pull requests.',
      },
    },
    notion: { description: 'Search, read and write pages and databases' },
    linear: {
      description: 'Read and create issues, projects and comments',
      token: {
        label: 'API key',
        hint: 'The “Read” permission is enough if the monsters only need to read.',
      },
    },
    atlassian: {
      name: 'Jira and Confluence',
      description: 'Read and create Jira tickets and Confluence pages',
      note: 'Your Atlassian site’s administrator may have to approve access.',
    },
    sentry: { description: 'Read errors and issues, analyze crashes' },
    supabase: {
      description: 'Manage databases, tables and functions',
      note: 'If you can, use a test project: the monsters can change the data.',
    },
    stripe: {
      description: 'Read payments, customers, subscriptions and invoices',
      token: {
        label: 'Key for agents',
        hint: 'Create a key with the “Agent” mark and only the permissions it needs.',
      },
      note: 'Refunds and outgoing payments always ask for your confirmation on Stripe.',
    },
    cloudflare: {
      description: 'Manage Workers, DNS, R2 and the Cloudflare API',
      token: {
        label: 'API key',
        hint: 'Give the key only the permissions for the apps you want used.',
      },
    },
    airtable: { description: 'Read and edit bases, tables and records' },
    zapier: {
      description: 'Run actions on thousands of connected apps',
      note: 'Every successful action counts as 2 tasks of your Zapier plan.',
    },
    context7: { description: 'Up-to-date documentation for libraries and APIs' },
    huggingface: {
      description: 'Search models, datasets, Spaces and papers',
      token: { label: 'Access key', hint: 'A read-only key is enough.' },
    },
    neon: { description: 'Manage Postgres databases and branches' },
    exa: {
      description: 'Search and read web pages for research',
      token: { label: 'API key', hint: 'Optional: without a key there are usage limits.' },
    },
    firecrawl: {
      description: 'Extract text and data from whole websites',
      token: { label: 'API key' },
    },
    todoist: { description: 'Read and create tasks and projects' },
    monday: {
      description: 'Manage boards, items and updates',
      note: 'Your monday account’s administrator may have to approve access.',
    },
    shopify: {
      description: 'Shopify API documentation and schemas',
      note: 'The first time, the server downloads itself.',
    },
    blender: {
      description: 'Model, animate and render 3D scenes',
      note: 'Needs Blender 5.1+ open with the MCP add-on and online access on. The monsters run Python code in Blender: every run goes through the brake.',
    },
    slack: { description: 'Read channels, search and send messages' },
    google: {
      name: 'Gmail, Drive and Calendar',
      description: 'Read mail, files and events',
      soon: 'Google’s servers are in preview and ask for a Google Cloud project of your own. With your Claude plan connected you use them through Claude.',
    },
    figma: { description: 'Read designs and turn them into code' },
    canva: { description: 'Create, edit and export designs' },
    asana: { description: 'Read and create tasks, projects and comments' },
    hubspot: { description: 'Read and update contacts, companies and deals' },
    vercel: { description: 'Manage projects, deploys and logs' },
    'claude-design': { description: 'Create and edit Claude Design projects' },
  } as Record<string, CatalogEntryTexts>,
};

const it: typeof en = {
  categories: {
    sviluppo: 'Sviluppo',
    lavoro: 'Lavoro e progetti',
    dati: 'Dati',
    pagamenti: 'Pagamenti',
    ricerca: 'Ricerca',
    automazioni: 'Automazioni',
    design: 'Design',
  },
  tenantChars: 'solo lettere minuscole, numeri e trattini',
  tenantLabel: 'La tua azienda',
  soonApproved:
    'Accetta solo app approvate una per una e non ha una chiave da incollare. Con il piano Claude collegato lo usi tramite Claude.',
  soonClaudeDesign: (settings) =>
    `Si collega solo tramite Claude: serve il piano Claude collegato in ${settings}.`,
  nodeDownload: 'https://nodejs.org/it/download',
  entries: {
    anteiku: {
      description: 'Clienti, progetti, task, agenda e preventivi',
      tenantLabel: 'La tua azienda',
      tenantHint: 'Il nome prima di .anteiku.it nell’indirizzo che usi (per Saturday: saturday).',
      token: {
        label: 'Chiave personale',
        hint: 'In Sistema › Connessioni, dopo lo sblocco con la password: inizia con anteiku_pat_ e si vede una volta sola.',
      },
      note: 'I mostri lavorano come te, con i tuoi permessi; ogni modifica resta nelle attività di Anteiku.',
    },
    witdesk: {
      description: 'Ticket e richieste del servizio clienti',
      tenantLabel: 'La tua azienda',
      tenantHint: 'Il nome prima di .witdesk.it nell’indirizzo che usi.',
      token: {
        label: 'Chiave personale',
        hint: 'In Preferenze › Connessioni: inizia con witdesk_pat_ e si vede una volta sola.',
      },
      note: 'Prima l’amministratore dell’azienda accende «Connettori» in WitDesk (Banco → Impostazioni → Collegamenti).',
    },
    github: {
      description: 'Leggi e crea issue e pull request',
      token: {
        label: 'Chiave personale',
        hint: 'Scegli i repository e dai lettura e scrittura a Contents, Issues e Pull requests.',
      },
    },
    notion: { description: 'Cerca, leggi e scrivi pagine e database' },
    linear: {
      description: 'Leggi e crea issue, progetti e commenti',
      token: { label: 'Chiave API', hint: 'Basta “Read” se i mostri devono solo leggere.' },
    },
    atlassian: {
      name: 'Jira e Confluence',
      description: 'Leggi e crea ticket Jira e pagine Confluence',
      note: 'L’amministratore del tuo spazio Atlassian può dover approvare l’accesso.',
    },
    sentry: { description: 'Leggi errori e issue, analizza i crash' },
    supabase: {
      description: 'Gestisci database, tabelle e funzioni',
      note: 'Su un progetto vero meglio un progetto di prova: i mostri possono cambiare i dati.',
    },
    stripe: {
      description: 'Leggi pagamenti, clienti, abbonamenti e fatture',
      token: {
        label: 'Chiave per agenti',
        hint: 'Crea una chiave con il segno “Agent” e solo i permessi che servono.',
      },
      note: 'Rimborsi e pagamenti in uscita chiedono sempre una tua conferma su Stripe.',
    },
    cloudflare: {
      description: 'Gestisci Workers, DNS, R2 e l’API Cloudflare',
      token: {
        label: 'Chiave API',
        hint: 'Dai alla chiave solo i permessi sulle app che vuoi far usare.',
      },
    },
    airtable: { description: 'Leggi e modifica basi, tabelle e record' },
    zapier: {
      description: 'Fai azioni su migliaia di app collegate',
      note: 'Ogni azione riuscita conta 2 task del tuo piano Zapier.',
    },
    context7: { description: 'Documentazione aggiornata di librerie e API' },
    huggingface: {
      description: 'Cerca modelli, dataset, Spaces e paper',
      token: { label: 'Chiave di accesso', hint: 'Basta una chiave di sola lettura.' },
    },
    neon: { description: 'Gestisci database e branch Postgres' },
    exa: {
      description: 'Cerca e leggi pagine web per le ricerche',
      token: { label: 'Chiave API', hint: 'Facoltativa: senza chiave ci sono limiti di uso.' },
    },
    firecrawl: {
      description: 'Estrai testo e dati da interi siti web',
      token: { label: 'Chiave API' },
    },
    todoist: { description: 'Leggi e crea attività e progetti' },
    monday: {
      description: 'Gestisci board, elementi e aggiornamenti',
      note: 'L’amministratore del tuo account monday può dover approvare l’accesso.',
    },
    shopify: {
      description: 'Documentazione e schemi delle API Shopify',
      note: 'La prima volta il server si scarica da solo.',
    },
    blender: {
      description: 'Modella, anima e renderizza scene 3D',
      note: 'Serve Blender 5.1+ aperto con l’add-on MCP e l’accesso online attivo. I mostri eseguono codice Python in Blender: ogni esecuzione passa dal freno.',
    },
    slack: { description: 'Leggi canali, cerca e manda messaggi' },
    google: {
      name: 'Gmail, Drive e Calendar',
      description: 'Leggi mail, file e appuntamenti',
      soon: 'I server di Google sono in anteprima e chiedono un progetto Google Cloud tuo. Con il piano Claude collegato li usi tramite Claude.',
    },
    figma: { description: 'Leggi i design e trasformali in codice' },
    canva: { description: 'Crea, modifica ed esporta design' },
    asana: { description: 'Leggi e crea attività, progetti e commenti' },
    hubspot: { description: 'Leggi e aggiorna contatti, aziende e trattative' },
    vercel: { description: 'Gestisci progetti, deploy e log' },
    'claude-design': { description: 'Crea e modifica progetti di Claude Design' },
  },
};

export const catalogStrings = () => pick({ en, it });
/** A language's words, for the checks that read both. */
export const catalogStringsOf = (lang: Lang) => pick({ en, it }, lang);
