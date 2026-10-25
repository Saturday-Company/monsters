import { defineStrings } from '../../lib/i18n.ts';

/* A project's notes, automations and Settings (folder, apps, spending), besides the chat and the squad (D-153). */

const en = {
  loading: 'Loading…',
  notes: {
    title: 'Project notes',
    stayIn: 'They live in',
    stayInRest: ': the project’s monsters write there, everyone can read them.',
    all: 'All notes',
    what: 'the notes',
    capped: (n: number) =>
      `Showing the newest ${n} notes of this project. Open All notes to search the rest.`,
    empty: 'No notes yet: when the lead or its monsters write one, it shows up here.',
  },
  folder: {
    copied: 'Path copied.',
    copyFailed: 'I can’t copy it: select it and copy it by hand.',
    relative: 'Type the full path, for example ~/Projects/Site.',
    saved: 'Project folder saved.',
    approved: 'Folder instructions approved.',
    removed: 'Now each monster works in its own private folder.',
    title: 'Project folder',
    description:
      'The computer folder where the project’s monsters work. All of them can read and write in it.',
    details:
      'Their commands, the files and the other assistants (Claude Code, Codex) start from this folder. The project’s instructions file they find here (CLAUDE.md or AGENTS.md) is read as notes, not as orders. Files that run commands (a Makefile, package.json scripts and the like) start at your next test or commit: monsters without the Run commands permission don’t touch them, those with it do, and if they have read third-party text they ask first.',
    path: 'Path',
    copyLabel: 'Copy the path of the project folder',
    copyTitle: 'Copy the path',
    missing: 'The folder is gone (moved or deleted): pick another one or put it back where it was.',
    docsChanged: 'Instructions changed',
    docsChangedLead: 'The project’s instructions file',
    docsChangedRest:
      'is no longer as you approved it: until you approve it, the project’s monsters work with the defenses they use when they read third-party text (they ask before sending data out).',
    filesJoin: ' or ',
    approve: 'Approve',
    none: 'No folder',
    noneText: 'Each monster works in its own private folder.',
    which: 'Which folder',
    existing: 'An existing one',
    new: 'A new one',
    fullPath: 'Full path',
    newHint: (canPick: boolean) =>
      `I’ll create it if it doesn’t exist${canPick ? ': pick where with Choose…' : ''}. Not inside the notes or Monsters’ data.`,
    existingHint: 'A folder on this computer, not inside the notes or Monsters’ data.',
    placeholder: '~/Projects/Site',
    save: 'Save',
    cancel: 'Cancel',
    change: 'Change folder',
    choose: 'Choose a folder',
    take: 'Remove the folder',
  },
  links: {
    webTitle: 'Web search',
    webFooter: 'Each monster’s own web permission is set in',
    webFooterLink: 'Settings → Permissions',
    webLabel: 'The project’s monsters search the web',
    webDescription:
      'When off, the project works only with the notes, the folder and the apps below (the browser turns off too).',
    webSwitch: 'Web search for the project',
    blocked: {
      title: (n: number) => `Can’t search the web · ${n}`,
      description: 'These monsters can’t search the web right now.',
      project: 'Web search is off for the project',
      own: 'Its web permission is off',
      both: 'Off for the project and in its own permission',
      allow: 'Allow',
      allowLabel: (name: string) => `Allow ${name} to search the web`,
      allowed: (name: string) => `${name} can search the web now.`,
      allOk: 'All the project’s monsters can search the web.',
    },
    title: 'Apps',
    description:
      'Every app given to all monsters reaches the project’s monsters, also the ones you connect later. Turn off what this project must not use.',
    details: 'An app given to a monster by name reaches it anyway, in every project.',
    more: 'Connect other apps in Settings → Apps and Telegram',
    none: 'No app connected, for now.',
    what: 'the apps',
    team: 'Given to all monsters',
    off: 'Off in Settings',
    viaClaude: 'Through your Claude plan, for the monsters that work with Claude',
    switch: (label: string) => `${label} for the project`,
    only: (names: string) => `Only for ${names}: change it in Settings`,
  },
  automations: {
    new: 'New automation',
    all: 'All automations',
    empty:
      'The project has no automations yet: work the squad does on its own, at a set time, with the lead handing tasks to its monsters.',
  },
  spend: {
    what: 'the project’s spending',
    projectSaved: 'Project cap saved.',
    agentSaved: (name: string) => `${name}’s cap saved.`,
    perDay: (amount: string) => `${amount} a day`,
    perMonth: (amount: string) => `${amount} a month`,
    subject: 'The project’s cap',
    title: 'Project cap',
    description:
      'What the project’s monsters can spend on paid models. At the cap their paid work stops; the rest carries on.',
    teamCap: (caps: string) =>
      `The cap for all monsters applies too (${caps}): whichever comes first stops it. `,
    noTeamCap: 'All monsters together have no cap. ',
    teamLink: 'Spending cap for all monsters',
    monster: 'Monster',
    project: 'Project',
    team: 'All monsters',
    stopped:
      'The project has reached its cap: its monsters’ paid work is stopped. Raise it below to get them going again.',
    warning: 'The project has spent more than 80% of its cap.',
    today: 'Today',
    month: 'This month',
    emptyHint: 'Empty: only the cap for all monsters applies.',
    perMonster: 'Per monster',
    perMonsterDescription:
      'An extra cap just for one monster, on top of the project’s and the one for all monsters.',
    agentLine: (today: string, month: string, free: boolean) =>
      `Today ${today} · this month ${month}${free ? '' : ' · uses free models or a plan'}`,
    agentEmptyHint: 'Empty: the project’s cap and the one for all monsters apply.',
  },
};
const it: typeof en = {
  loading: 'Carico…',
  notes: {
    title: 'Note del progetto',
    stayIn: 'Stanno in',
    stayInRest: ': i mostri del progetto scrivono lì, tutti le possono leggere.',
    all: 'Tutte le note',
    what: 'le note',
    capped: (n) =>
      `Mostro le ${n} note più recenti di questo progetto. Apri Tutte le note per cercare nel resto.`,
    empty: 'Ancora nessuna nota: quando il capo o i suoi mostri ne scrivono una, compare qui.',
  },
  folder: {
    copied: 'Percorso copiato.',
    copyFailed: 'Non riesco a copiarlo: selezionalo e copialo a mano.',
    relative: 'Scrivi il percorso completo, per esempio ~/Progetti/Sito.',
    saved: 'Cartella del progetto salvata.',
    approved: 'Istruzioni della cartella approvate.',
    removed: 'Ora ogni mostro lavora nella sua cartella privata.',
    title: 'Cartella del progetto',
    description:
      'La cartella del computer dove lavorano i mostri del progetto. Tutti possono leggere e scrivere qui.',
    details:
      'I loro comandi, i file e gli altri assistenti (Claude Code, Codex) partono da questa cartella. Il file delle istruzioni del progetto che ci trovano (CLAUDE.md o AGENTS.md) lo leggono come una nota, non come un ordine. I file che lanciano comandi (Makefile, script di package.json e simili) partono al tuo prossimo test o commit: i mostri senza il permesso «Eseguire comandi» non li toccano, quelli che ce l’hanno sì, e se hanno letto testo di terzi chiedono prima.',
    path: 'Percorso',
    copyLabel: 'Copia il percorso della cartella del progetto',
    copyTitle: 'Copia il percorso',
    missing:
      'La cartella non c’è più (spostata o cancellata): scegline un’altra o rimettila al suo posto.',
    docsChanged: 'Istruzioni cambiate',
    docsChangedLead: 'Il file delle istruzioni del progetto',
    docsChangedRest:
      'non è più come l’hai approvato: finché non lo approvi, i mostri del progetto lavorano con le difese di quando leggono testo di terzi (chiedono prima di mandare dati fuori).',
    filesJoin: ' o ',
    approve: 'Approva',
    none: 'Nessuna cartella',
    noneText: 'Ogni mostro lavora nella sua cartella privata.',
    which: 'Che cartella',
    existing: 'Una che c’è',
    new: 'Una nuova',
    fullPath: 'Percorso completo',
    newHint: (canPick) =>
      `La creo io, se non c’è${canPick ? ': con Scegli… indichi dove' : ''}. Non dentro le note né dentro i dati di Monsters.`,
    existingHint:
      'Una cartella di questo computer, non dentro le note né dentro i dati di Monsters.',
    placeholder: '~/Progetti/Sito',
    save: 'Salva',
    cancel: 'Annulla',
    change: 'Cambia cartella',
    choose: 'Scegli una cartella',
    take: 'Togli la cartella',
  },
  links: {
    webTitle: 'Ricerca sul web',
    webFooter: 'Il permesso per il web di ogni mostro si imposta in',
    webFooterLink: 'Impostazioni → Permessi',
    webLabel: 'I mostri del progetto cercano sul web',
    webDescription:
      'Spenta, il progetto lavora solo con le note, la cartella e le app qui sotto (anche il browser si spegne).',
    webSwitch: 'Ricerca sul web per il progetto',
    blocked: {
      title: (n) => `Non possono cercare sul web · ${n}`,
      description: 'Questi mostri ora non possono cercare sul web.',
      project: 'La ricerca sul web è spenta per il progetto',
      own: 'Il suo permesso per il web è spento',
      both: 'Spenta per il progetto e nel suo permesso',
      allow: 'Consenti',
      allowLabel: (name) => `Consenti a ${name} di cercare sul web`,
      allowed: (name) => `${name} ora può cercare sul web.`,
      allOk: 'Tutti i mostri del progetto possono cercare sul web.',
    },
    title: 'App',
    description:
      'Ogni app data a tutti i mostri arriva a quelli del progetto, anche quelle che colleghi dopo. Spegni quella che il progetto non deve usare.',
    details: 'Un’app data a un mostro per nome gli arriva comunque, in ogni progetto.',
    more: 'Collega altre app in Impostazioni → App e Telegram',
    none: 'Nessuna app collegata, per ora.',
    what: 'le app',
    team: 'Data a tutti i mostri',
    off: 'Spenta in Impostazioni',
    viaClaude: 'Tramite il tuo piano Claude, per chi lavora con Claude',
    switch: (label) => `${label} per il progetto`,
    only: (names) => `Solo per ${names}: si cambia in Impostazioni`,
  },
  automations: {
    new: 'Nuova automazione',
    all: 'Tutte le automazioni',
    empty:
      'Il progetto non ha ancora automazioni: un lavoro che la squadra fa da sola, a un’ora fissa, con il capo che passa i compiti ai suoi mostri.',
  },
  spend: {
    what: 'la spesa del progetto',
    projectSaved: 'Tetto del progetto salvato.',
    agentSaved: (name) => `Tetto di ${name} salvato.`,
    perDay: (amount) => `${amount} al giorno`,
    perMonth: (amount) => `${amount} al mese`,
    subject: 'Il tetto del progetto',
    title: 'Tetto del progetto',
    description:
      'Quanto possono spendere i mostri del progetto con i modelli a pagamento. Al tetto i loro lavori a pagamento si fermano; il resto va avanti.',
    teamCap: (caps) =>
      `Vale anche il tetto di tutti i mostri (${caps}): si ferma il primo che arriva. `,
    noTeamCap: 'Tutti i mostri insieme non hanno un tetto. ',
    teamLink: 'Tetto di spesa di tutti i mostri',
    monster: 'Mostro',
    project: 'Progetto',
    team: 'Tutti i mostri',
    stopped:
      'Il progetto ha raggiunto il suo tetto: i lavori a pagamento dei suoi mostri sono fermi. Alzalo qui sotto per farli ripartire.',
    warning: 'Il progetto ha speso più dell’80% del suo tetto.',
    today: 'Oggi',
    month: 'Questo mese',
    emptyHint: 'Vuoto: vale solo il tetto di tutti i mostri.',
    perMonster: 'Per mostro',
    perMonsterDescription:
      'Un tetto in più solo per un mostro, oltre a quello del progetto e a quello di tutti i mostri.',
    agentLine: (today, month, free) =>
      `Oggi ${today} · questo mese ${month}${free ? '' : ' · usa modelli gratuiti o un piano'}`,
    agentEmptyHint: 'Vuoto: valgono il tetto del progetto e quello di tutti i mostri.',
  },
};

export const sectionsStrings = defineStrings({ en, it });
