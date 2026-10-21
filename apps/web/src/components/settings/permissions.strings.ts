import { defineStrings } from '../../lib/i18n.ts';

/* Settings → Permissions: what each monster may do, and the folders of the computer (D-153). */

const en = {
  title: 'What the monsters can do',
  description:
    'For each monster, choose what it can use. A permission you give applies from the next job, one you take away applies right away.',
  failed: 'I can’t read the permissions right now.',
  lead: 'your lead',
  leadGroup: 'Your lead',
  others: 'Others',
  saved: (name: string) => `${name}’s permissions saved.`,
  summary: {
    notes: 'notes',
    notesReadOnly: 'read-only notes',
    web: 'web',
    terminal: 'terminal',
    folders: (n: number) => (n === 1 ? '1 folder' : `${n} folders`),
  },
  vault: {
    title: 'Write in the notes',
    text: 'Without it, it reads the notes but doesn’t change them. Every change can be undone.',
  },
  web: {
    text: 'Search and read pages online, in all its work. In a project, the project’s web search is needed too (Connections tab); the browser follows this permission.',
  },
  terminal: {
    onWindows: (text: string) => `${text} On Windows the commands are PowerShell.`,
    warning: (name: string) =>
      `With the terminal, ${name} can do anything on the computer that you can, even outside the folders below. Every command is logged in Activity, and Stop interrupts it.`,
  },
  folders: {
    label: 'Computer folders',
    example: (home: string, sep: string) => `${home}${sep}Documents`,
    granted: 'Granted folders',
    needFullPath: 'Type the full path of the folder, starting with / (or C:\\ on Windows).',
    alreadyThere: 'This folder is already there.',
    canEdit: 'can edit',
    readOnly: 'read-only',
    canEditFiles: (path: string) => `Can edit the files in ${path}`,
    remove: (path: string) => `Remove ${path}`,
    none: 'No folders: the files on the computer stay off limits.',
    launchFiles:
      'Without the terminal a monster still can’t change .git folders or files that start programs (.bashrc, .profile, autostart).',
    addTo: (label: string) => `Add a folder: ${label.toLowerCase()}`,
    add: 'Add',
  },
};

const it: typeof en = {
  title: 'Cosa possono fare i mostri',
  description:
    'Per ogni mostro scegli cosa può usare. Un permesso dato vale dal prossimo lavoro, uno tolto subito.',
  failed: 'Non riesco a leggere i permessi adesso.',
  lead: 'il tuo capo',
  leadGroup: 'Il tuo capo',
  others: 'Altri',
  saved: (name) => `Permessi di ${name} salvati.`,
  summary: {
    notes: 'note',
    notesReadOnly: 'note in sola lettura',
    web: 'web',
    terminal: 'terminale',
    folders: (n) => (n === 1 ? '1 cartella' : `${n} cartelle`),
  },
  vault: {
    title: 'Scrivere nelle note',
    text: 'Senza, legge le note ma non le cambia. Ogni modifica si può annullare.',
  },
  web: {
    text: 'Cercare e leggere pagine online, in ogni suo lavoro. In un progetto serve anche la ricerca sul web del progetto (scheda Collegamenti); il browser segue questo permesso.',
  },
  terminal: {
    onWindows: (text) => `${text} Su Windows i comandi sono di PowerShell.`,
    warning: (name) =>
      `Con il terminale ${name} può fare sul computer tutto quello che puoi fare tu, anche fuori dalle cartelle qui sotto. Ogni comando finisce in Attività e “Ferma” lo interrompe.`,
  },
  folders: {
    label: 'Cartelle del computer',
    example: (home, sep) => `${home}${sep}Documenti`,
    granted: 'Cartelle concesse',
    needFullPath:
      'Scrivi il percorso completo della cartella, che inizia con / (o C:\\ su Windows).',
    alreadyThere: 'Questa cartella c’è già.',
    canEdit: 'può modificare',
    readOnly: 'solo lettura',
    canEditFiles: (path) => `Può modificare i file in ${path}`,
    remove: (path) => `Togli ${path}`,
    none: 'Nessuna cartella: i file del computer restano chiusi.',
    launchFiles:
      'Senza il terminale un mostro non cambia comunque le cartelle .git né i file che avviano programmi (.bashrc, .profile, avvio automatico).',
    addTo: (label) => `Aggiungi una cartella a ${label.toLowerCase()}`,
    add: 'Aggiungi',
  },
};

export const permissionsStrings = defineStrings({ en, it });
