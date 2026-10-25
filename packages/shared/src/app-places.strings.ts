import { pick, type Lang } from './i18n.ts';

/** The names of the app's places in each language, word for word as the UI shows them (D-133, D-153). */
const en = {
  settings: 'Settings',
  tabs: {
    squadra: 'Squad',
    modelli: 'Models',
    permessi: 'Permissions',
    collegamenti: 'Connections',
    generale: 'General',
  },
  sections: {
    avanzate: 'Advanced',
    abbonamenti: 'Plans you already have',
    tettoDiSpesa: 'Spending cap',
    limiti: 'Safety net',
    teLoChiedonoSempre: 'They always ask you',
    ilWeb: 'The web',
    terminale: 'Run commands',
    telegram: 'Telegram',
    ricercaWeb: 'Web search',
    altriProgrammi: 'Apps and services',
  },
  projectTabs: {
    chat: 'Chat',
    squadra: 'Squad',
    note: 'Notes',
    cartella: 'Folder',
    collegamenti: 'Connections',
    automazioni: 'Automations',
    spesa: 'Spending',
  },
  /** A project's page, as a noun phrase to follow “the” (English) or “nella” (Italian). */
  projectPage: (project: string, tab: string) => `“${project}” project page, ${tab} tab`,
  /** The tab of a project's page, the project not known here. */
  projectTabOfPage: (tab: string) => `${tab} tab of the project page`,
};

const it: typeof en = {
  settings: 'Impostazioni',
  tabs: {
    squadra: 'Squadra',
    modelli: 'Modelli',
    permessi: 'Permessi',
    collegamenti: 'Collegamenti',
    generale: 'Generale',
  },
  sections: {
    avanzate: 'Avanzate',
    abbonamenti: 'Piani che hai già',
    tettoDiSpesa: 'Tetto di spesa',
    limiti: 'Rete di sicurezza',
    teLoChiedonoSempre: 'Te lo chiedono sempre',
    ilWeb: 'Il web',
    terminale: 'Eseguire comandi',
    telegram: 'Telegram',
    ricercaWeb: 'Ricerca sul web',
    altriProgrammi: 'App e servizi',
  },
  projectTabs: {
    chat: 'Chat',
    squadra: 'Squadra',
    note: 'Note',
    cartella: 'Cartella',
    collegamenti: 'Collegamenti',
    automazioni: 'Automazioni',
    spesa: 'Spesa',
  },
  projectPage: (project, tab) => `pagina del progetto «${project}», scheda ${tab}`,
  projectTabOfPage: (tab) => `scheda ${tab} della pagina del progetto`,
};

export const placesStrings = () => pick({ en, it });
/** The names in a given language, for what reads texts written in either. */
export const placesStringsOf = (lang: Lang) => pick({ en, it }, lang);
