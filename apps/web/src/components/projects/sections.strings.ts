import { defineStrings } from '../../lib/i18n.ts';

/* The tabs of a project's page besides the chat and the squad (D-153). */

const en = {
  loading: 'Loading…',
  notes: {
    title: 'Project notes',
    stayIn: 'They live in',
    stayInRest: ': the project’s monsters write there, everyone can read them.',
    all: 'All notes',
    what: 'the notes',
    capped:
      'This list may be missing some notes: the vault is large. Open All notes to search the rest.',
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
      'This is where the project’s monsters work: the terminal, the files and the other assistants (Claude Code, Codex) start from this folder. The project’s instructions (CLAUDE.md, AGENTS.md) they find here are read as notes, not as orders. All the project’s monsters can read and write here, including files that run commands (Makefile, package.json scripts and the like) and start at your next test or commit: the ones without a terminal don’t touch them, the ones with a terminal do, and if they have read text from third parties they ask first.',
    path: 'Path',
    copyLabel: 'Copy the path of the project folder',
    copyTitle: 'Copy the path',
    missing: 'The folder is gone (moved or deleted): pick another one or put it back where it was.',
    docsChanged: 'Instructions changed',
    docsChangedText: (files: string) =>
      `The folder’s ${files} is no longer as you approved it: until you approve it, the project’s monsters work with the defenses they use when they read third-party text (they ask before sending data out).`,
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
    webFooter:
      'This works alongside each monster’s permissions: a monster without web access doesn’t get it from here.',
    webLabel: 'The project’s monsters search the web',
    webDescription:
      'When off, the project works only with the notes, the folder and the connections below (the browser turns off too).',
    webSwitch: 'Web search for the project',
    title: 'Apps and services',
    description:
      'Every connection given to the whole squad reaches the project’s monsters, also the ones you connect later: they use it when the work needs it. Turn off here what this project must not use. One given to a monster by name reaches it anyway.',
    more: 'Connect other apps in Settings → Apps and Telegram',
    none: 'No app connected, for now.',
    what: 'the connections',
    team: 'Given to the whole squad',
    off: 'Off in Settings',
    viaClaude: 'Through your Claude subscription, for the monsters that work with Claude',
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
      'How much the project’s monsters can spend on paid models. At the cap their paid work stops; the other projects and the personal squad carry on.',
    teamCap: (caps: string) =>
      `The whole squad’s cap applies too (${caps}): whichever comes first stops it. `,
    noTeamCap: 'The whole squad has no cap. ',
    teamLink: 'Squad spending cap',
    monster: 'Monster',
    project: 'Project',
    team: 'Whole squad',
    stopped:
      'The project has reached its cap: its monsters’ paid work is stopped. Raise it below to get them going again.',
    warning: 'The project has spent more than 80% of its cap.',
    today: 'Today',
    month: 'This month',
    emptyHint: 'Empty: only the squad’s cap applies.',
    perMonster: 'Per monster',
    perMonsterDescription:
      'An extra cap just for one monster, on top of the project’s and the squad’s.',
    agentLine: (today: string, month: string, free: boolean) =>
      `Today ${today} · this month ${month}${free ? '' : ' · uses free models or a subscription'}`,
    agentEmptyHint: 'Empty: the project’s and the squad’s caps apply.',
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
    capped:
      'Nell’elenco potrebbero mancare delle note: l’archivio è grande. Apri Tutte le note per cercare nel resto.',
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
      'Qui lavorano i mostri del progetto: il terminale, i file e gli altri assistenti (Claude Code, Codex) partono da questa cartella. Le istruzioni del progetto (CLAUDE.md, AGENTS.md) che ci trovano le leggono come note, non come ordini. Tutti i mostri del progetto possono leggere e scrivere qui, anche i file che lanciano comandi (Makefile, script di package.json e simili) e partono al tuo prossimo test o commit: quelli senza terminale non li toccano, quelli con il terminale sì, e se hanno letto testo di terzi chiedono prima.',
    path: 'Percorso',
    copyLabel: 'Copia il percorso della cartella del progetto',
    copyTitle: 'Copia il percorso',
    missing:
      'La cartella non c’è più (spostata o cancellata): scegline un’altra o rimettila al suo posto.',
    docsChanged: 'Istruzioni cambiate',
    docsChangedText: (files) =>
      `${files} della cartella non è più come l’hai approvato: finché non lo approvi, i mostri del progetto lavorano con le difese di quando leggono testo di terzi (chiedono prima di mandare dati fuori).`,
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
    webFooter: 'Vale insieme ai permessi di ogni mostro: chi non ha il web non lo prende da qui.',
    webLabel: 'I mostri del progetto cercano sul web',
    webDescription:
      'Spenta, il progetto lavora solo con le note, la cartella e i collegamenti qui sotto (anche il browser si spegne).',
    webSwitch: 'Ricerca sul web per il progetto',
    title: 'Programmi e servizi',
    description:
      'Ogni collegamento dato a tutta la squadra arriva ai mostri del progetto, anche quelli che colleghi dopo: lo usano quando il lavoro lo chiede. Spegni qui quello che questo progetto non deve usare. Uno dato a un mostro per nome gli arriva comunque.',
    more: 'Collega altri programmi in Impostazioni → App e Telegram',
    none: 'Nessun programma collegato, per ora.',
    what: 'i collegamenti',
    team: 'Dato a tutta la squadra',
    off: 'Spento in Impostazioni',
    viaClaude: 'Tramite l’abbonamento Claude, per chi lavora con Claude',
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
      'Quanto possono spendere i mostri del progetto con i modelli a pagamento. Al tetto i loro lavori a pagamento si fermano; gli altri progetti e la Squadra personale vanno avanti.',
    teamCap: (caps) =>
      `Vale anche il tetto di tutta la squadra (${caps}): si ferma il primo che arriva. `,
    noTeamCap: 'Tutta la squadra non ha un tetto. ',
    teamLink: 'Tetto di spesa della squadra',
    monster: 'Mostro',
    project: 'Progetto',
    team: 'Tutta la squadra',
    stopped:
      'Il progetto ha raggiunto il suo tetto: i lavori a pagamento dei suoi mostri sono fermi. Alzalo qui sotto per farli ripartire.',
    warning: 'Il progetto ha speso più dell’80% del suo tetto.',
    today: 'Oggi',
    month: 'Questo mese',
    emptyHint: 'Vuoto: vale solo il tetto della squadra.',
    perMonster: 'Per mostro',
    perMonsterDescription:
      'Un tetto in più solo per un mostro, oltre a quelli del progetto e della squadra.',
    agentLine: (today, month, free) =>
      `Oggi ${today} · questo mese ${month}${free ? '' : ' · usa modelli gratuiti o un abbonamento'}`,
    agentEmptyHint: 'Vuoto: valgono i tetti del progetto e della squadra.',
  },
};

export const sectionsStrings = defineStrings({ en, it });
