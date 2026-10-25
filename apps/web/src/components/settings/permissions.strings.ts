import { defineStrings } from '../../lib/i18n.ts';

/* Settings → Permissions: what each monster may do, and the folders of the computer (D-153). */

const en = {
  title: 'What the monsters can do',
  description:
    'Choose how far each monster can go. A permission you give applies from the next job, one you take away applies right away.',
  footer: 'Running commands lets a monster do anything you can do on this computer.',
  what: 'the permissions',
  lead: 'your lead',
  leadGroup: 'Your lead',
  others: 'Others',
  saved: (name: string) => `${name}’s permissions saved.`,
  summary: {
    notes: 'notes',
    notesReadOnly: 'read-only notes',
    web: 'web',
    commands: 'commands',
    folders: (n: number) => (n === 1 ? '1 folder' : `${n} folders`),
  },
  preset: {
    label: (name: string) => `What ${name} can do`,
    notes: 'Notes only',
    web: 'Notes and web',
    commands: 'Also runs commands',
    custom: 'Custom',
  },
  all: {
    label: 'The same for everyone',
    text: 'Set every monster to one of the three levels. Notes and folders stay as they are.',
    choose: 'Choose…',
    selectLabel: 'Level for all monsters',
    apply: 'Apply to all',
    askCommands: 'Let every monster run commands?',
    confirm: 'Yes, apply',
    done: 'Done: every monster is set.',
  },
  webOffIn: (project: string) => `Web: off in project ${project}`,
  fine: {
    label: 'Switches and folders',
    text: 'Notes, web, commands and computer folders, one monster at a time.',
  },
  vault: {
    title: 'Write in the notes',
    text: 'Without it, it reads the notes but doesn’t change them. Every change can be undone.',
  },
  web: {
    text: 'Search and read pages online. A project can switch the web off for itself; the browser follows this permission.',
  },
  commands: {
    text: 'Run commands and install programs in their own folder, without admin rights. Commands can read and change your account’s files.',
    onWindows: (text: string) => `${text} On Windows the commands are PowerShell.`,
    warning: (name: string) =>
      `With commands on, ${name} can do anything on the computer that you can, even outside the folders below. Every command is logged in Activity, and Stop interrupts it.`,
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
      'Unless it can run commands, a monster still can’t change .git folders or files that start programs (.bashrc, .profile, autostart).',
    addTo: (label: string) => `Add a folder: ${label.toLowerCase()}`,
    add: 'Add',
    typePath: 'Type a path instead',
  },
};

const it: typeof en = {
  title: 'Cosa possono fare i mostri',
  description:
    'Scegli fin dove può arrivare ogni mostro. Un permesso dato vale dal prossimo lavoro, uno tolto subito.',
  footer:
    'Eseguire comandi permette a un mostro di fare sul computer tutto quello che puoi fare tu.',
  what: 'i permessi',
  lead: 'il tuo capo',
  leadGroup: 'Il tuo capo',
  others: 'Altri',
  saved: (name) => `Permessi di ${name} salvati.`,
  summary: {
    notes: 'note',
    notesReadOnly: 'note in sola lettura',
    web: 'web',
    commands: 'comandi',
    folders: (n) => (n === 1 ? '1 cartella' : `${n} cartelle`),
  },
  preset: {
    label: (name) => `Cosa può fare ${name}`,
    notes: 'Solo note',
    web: 'Note e web',
    commands: 'Esegue anche comandi',
    custom: 'Personalizzato',
  },
  all: {
    label: 'Uguale per tutti',
    text: 'Porta ogni mostro a uno dei tre livelli. Note e cartelle restano come sono.',
    choose: 'Scegli…',
    selectLabel: 'Livello per tutti i mostri',
    apply: 'Applica a tutti',
    askCommands: 'Far eseguire comandi a tutti i mostri?',
    confirm: 'Sì, applica',
    done: 'Fatto: ogni mostro è impostato.',
  },
  webOffIn: (project) => `Web: spento nel progetto ${project}`,
  fine: {
    label: 'Interruttori e cartelle',
    text: 'Note, web, comandi e cartelle del computer, un mostro alla volta.',
  },
  vault: {
    title: 'Scrivere nelle note',
    text: 'Senza, legge le note ma non le cambia. Ogni modifica si può annullare.',
  },
  web: {
    text: 'Cercare e leggere pagine online. Un progetto può spegnere il web per sé; il browser segue questo permesso.',
  },
  commands: {
    text: 'Eseguire comandi e installare programmi nella propria cartella, senza essere amministratore. I comandi possono leggere e cambiare i file del tuo account.',
    onWindows: (text) => `${text} Su Windows i comandi sono di PowerShell.`,
    warning: (name) =>
      `Con i comandi accesi ${name} può fare sul computer tutto quello che puoi fare tu, anche fuori dalle cartelle qui sotto. Ogni comando finisce in Attività e “Ferma” lo interrompe.`,
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
      'Se non può eseguire comandi, un mostro non cambia comunque le cartelle .git né i file che avviano programmi (.bashrc, .profile, avvio automatico).',
    addTo: (label) => `Aggiungi una cartella a ${label.toLowerCase()}`,
    add: 'Aggiungi',
    typePath: 'Scrivi un percorso',
  },
};

export const permissionsStrings = defineStrings({ en, it });
