import { pick, vaultLayout } from '@monsters/shared';

/** The default folder of the new projects (`Monsters Progetti`, `Monsters Projects`: D-154). */
const projectsDir = () => vaultLayout().projectsDir;

/*
 * The labels of the card of a draft on Telegram (D-153): English first, Italian as a choice.
 * Picked when the card is made. Values (names, notes) are escaped by the caller; the texts
 * here are the labels around them, with the card's HTML.
 */

const en = {
  yes: 'yes',
  no: 'no',
  none: 'none',
  role: 'Role',
  does: 'Does',
  rules: 'Rules',
  aboutYou: 'About you',
  tools: (web: boolean) =>
    `Tools: ${web ? 'notes and web (searches and reads pages)' : 'notes'}, no terminal or files`,
  notes: (area: string) => `Notes: reads all, writes in ${area}/ and Inbox/`,
  model: 'Model',
  like: (name: string) => `like ${name}`,
  automatic: 'Automatic',
  copyOf: (name: string, from: string) =>
    `🧩 <b>${name}</b>: with ${from}’s role and rules; its own name, look and memory`,
  taint: (source: string, applying: boolean) =>
    `⚠️ Proposed after reading third-party text (${source}): check carefully before ${applying ? 'applying' : 'confirming'}.`,
  project: 'Project',
  theLead: 'the squad lead',
  goal: 'Goal',
  why: 'Why',
  lead: (name: string, copyOf: string | null, model: string) =>
    `👑 Squad lead: <b>${name}</b>${copyOf ? `, copy of ${copyOf}` : ''} · model ${model}`,
  folder: (folder: string, created: boolean) =>
    `Folder: <code>${folder}</code>${created ? ' (new, created on confirmation)' : ''}`,
  noFolder: 'Folder: none (each monster in its own)',
  folderGrant: (created: boolean) =>
    `⚠️ All the project’s monsters will be able to read and write in that folder${created ? '' : ', along with everything already in it'}.`,
  get folderOutside(): string {
    return `⚠️ It’s an existing folder, outside ${projectsDir()}: confirming it is done in the app.`;
  },
  projectNotes: (area: string) => `Project notes: ${area}/`,
  connections: (list: string) => `Connections: ${list}`,
  webSearch: (on: string) => `Web search: ${on}`,
  perDay: (n: number) => `€${n} a day`,
  perMonth: (n: number) => `€${n} a month`,
  spendCap: (caps: string) => `Spending cap: ${caps}`,
  squadCap: 'the squad’s',
  automationDraft: (name: string, schedule: string) =>
    `⏰ <b>${name}</b> (draft, to confirm later): ${schedule}`,
  goalIndented: (objective: string) => `  Goal: ${objective}`,
  participantsIndented: (list: string) => `  Participants: ${list}`,
  resultsIndented: (folder: string) => `  Results in: ${folder}/`,
  noticesIndented: (app: string, telegram: string) => `  Notices: app ${app}, Telegram ${telegram}`,
  file: (file: string, isNew: boolean, project: string) =>
    `📄 File: <b>${file}</b>${isNew ? ' (new)' : ''} · project ${project}`,
  fileChanged: '⚠️ The file changed after the proposal: ask the monster to propose it again.',
  folderChanged:
    '⚠️ The project’s folder changed after the proposal: ask the monster to propose it again.',
  fileTooLarge: (file: string) =>
    `⚠️ ${file} is now larger than 1 MB: it can’t be changed from here.`,
  diffLong: 'The diff is long: you’ll find it in the app too.',
  inMemoryOf: (name: string) => `🧠 In <b>${name}</b>’s memory:`,
  memoryTainted:
    '<i>They stay marked “from third-party text”: the work that reads them has its defenses on.</i>',
  when: (schedule: string) => `When: ${schedule}`,
  leadLine: (lead: string, project: string | null) =>
    `Squad lead: ${lead}${project ? ` · project ${project}` : ''}`,
  participants: (list: string) => `Participants: ${list}`,
  goalLine: (objective: string) => `Goal: ${objective}`,
  resultsLine: (folder: string) => `Results in: ${folder}/`,
  noticesLine: (app: string, telegram: string) => `Notices: app ${app}, Telegram ${telegram}`,
  steps: (n: number) => `${n} steps`,
  tokens: (n: number) => `${n} tokens`,
  euros: (n: number) => `€${n}`,
  limitsPerRun: (limits: string) => `Limits per run: ${limits}`,
  eachJobsOwn: 'each job’s own',
};

const it: typeof en = {
  yes: 'sì',
  no: 'no',
  none: 'nessuno',
  role: 'Ruolo',
  does: 'Fa',
  rules: 'Regole',
  aboutYou: 'Su di te',
  tools: (web) =>
    `Strumenti: ${web ? 'note e web (cerca e legge pagine)' : 'note'}, niente terminale né file`,
  notes: (area) => `Note: legge tutte, scrive in ${area}/ e Inbox/`,
  model: 'Modello',
  like: (name) => `come ${name}`,
  automatic: 'Automatica',
  copyOf: (name, from) =>
    `🧩 <b>${name}</b>: con il ruolo e le regole di ${from}; nome, aspetto e memoria suoi`,
  taint: (source, applying) =>
    `⚠️ Proposta dopo aver letto testo di terzi (${source}): controlla bene prima di ${applying ? 'applicare' : 'confermare'}.`,
  project: 'Progetto',
  theLead: 'il capo',
  goal: 'Obiettivo',
  why: 'Perché',
  lead: (name, copyOf, model) =>
    `👑 Capo: <b>${name}</b>${copyOf ? `, copia di ${copyOf}` : ''} · modello ${model}`,
  folder: (folder, created) =>
    `Cartella: <code>${folder}</code>${created ? ' (nuova, creata alla conferma)' : ''}`,
  noFolder: 'Cartella: nessuna (ogni mostro nella sua)',
  folderGrant: (created) =>
    `⚠️ Tutti i mostri del progetto potranno leggere e scrivere in quella cartella${created ? '' : ', con tutto quello che c’è già'}.`,
  get folderOutside(): string {
    return `⚠️ È una cartella che c’è già, fuori da ${projectsDir()}: la conferma è nell’app.`;
  },
  projectNotes: (area) => `Note del progetto: ${area}/`,
  connections: (list) => `Collegamenti: ${list}`,
  webSearch: (on) => `Ricerca web: ${on}`,
  perDay: (n) => `${n} € al giorno`,
  perMonth: (n) => `${n} € al mese`,
  spendCap: (caps) => `Tetto di spesa: ${caps}`,
  squadCap: 'quello della squadra',
  automationDraft: (name, schedule) => `⏰ <b>${name}</b> (bozza da confermare dopo): ${schedule}`,
  goalIndented: (objective) => `  Obiettivo: ${objective}`,
  participantsIndented: (list) => `  Partecipano: ${list}`,
  resultsIndented: (folder) => `  Risultati in: ${folder}/`,
  noticesIndented: (app, telegram) => `  Avvisi: app ${app}, Telegram ${telegram}`,
  file: (file, isNew, project) =>
    `📄 File: <b>${file}</b>${isNew ? ' (nuovo)' : ''} · progetto ${project}`,
  fileChanged: '⚠️ Il file è cambiato dopo la proposta: chiedi al mostro di riproporla.',
  folderChanged:
    '⚠️ La cartella del progetto è cambiata dopo la proposta: chiedi al mostro di riproporla.',
  fileTooLarge: (file) => `⚠️ ${file} adesso è più grande di 1 MB: non si cambia da qui.`,
  diffLong: 'La differenza è lunga: la trovi anche nell’app.',
  inMemoryOf: (name) => `🧠 Nella memoria di <b>${name}</b>:`,
  memoryTainted:
    '<i>Restano segnate «da testo di terzi»: i lavori che le leggono hanno le difese accese.</i>',
  when: (schedule) => `Quando: ${schedule}`,
  leadLine: (lead, project) => `Capo: ${lead}${project ? ` · progetto ${project}` : ''}`,
  participants: (list) => `Partecipano: ${list}`,
  goalLine: (objective) => `Obiettivo: ${objective}`,
  resultsLine: (folder) => `Risultati in: ${folder}/`,
  noticesLine: (app, telegram) => `Avvisi: app ${app}, Telegram ${telegram}`,
  steps: (n) => `${n} passi`,
  tokens: (n) => `${n} token`,
  euros: (n) => `${n} €`,
  limitsPerRun: (limits) => `Limiti per giro: ${limits}`,
  eachJobsOwn: 'quelli di ogni lavoro',
};

export const draftCardStrings = () => pick({ en, it });
