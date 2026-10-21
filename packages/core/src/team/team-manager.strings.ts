import { formatList, pick, vaultLayout } from '@monsters/shared';

/** The reserved folders of the vault in use (D-154): `Agenti, Modelli o Privato`. */
const reserved = (or: string) => {
  const l = vaultLayout();
  return `${l.agents}, ${l.templates} ${or} ${l.private}`;
};

/*
 * What the team manager says to the person (D-153): the API errors of the squad, the
 * suggestions of "Add a monster", the labels of the questions that always ask first.
 * The texts written into the monsters' own files (AGENTS.md, the profile note) are not here.
 */

const en = {
  ideas: [
    {
      id: 'ricerche',
      label: 'Online research',
      description: 'Does research online and sums it up in notes with the sources.',
    },
    {
      id: 'bozze',
      label: 'Post and email drafts',
      description: 'Writes post and email drafts ready to use, in my tone.',
    },
    {
      id: 'riassunti',
      label: 'Summaries',
      description: 'Sums up long documents and notes in a few clear points.',
    },
    {
      id: 'note',
      label: 'Tidy notes',
      description: 'Tidies up notes and ideas: links them, groups them, removes duplicates.',
    },
    {
      id: 'piano',
      label: 'Content plan',
      description: 'Plans the week’s content and keeps the editorial calendar.',
    },
    {
      id: 'numeri',
      label: 'Numbers and data',
      description: 'Analyzes numbers and data and draws practical takeaways.',
    },
  ],
  askLabels: {
    publish: 'Publish',
    contact: 'Write to others (messages, emails)',
    spend: 'Pay or buy',
    delete: 'Delete',
    goal: 'Change a goal',
  } as Record<string, string>,
  onboardingPending: 'Finish the first start first: the squad doesn’t exist yet.',
  busy: (names: readonly string[]) =>
    `${formatList(names)} ${names.length === 1 ? 'is' : 'are'} still working: wait for ${names.length === 1 ? 'it' : 'them'} to finish or stop the squad, then change it.`,
  unknownProject: (id: string) => `There’s no project "${id}".`,
  projectArchived: (name: string) => `The project ${name} is archived.`,
  projectDraft: (name: string) =>
    `The project ${name} is still a draft: confirm it before giving it monsters.`,
  invalidName: (name: string) =>
    `"${name}" doesn’t work: only letters, spaces, apostrophes and hyphens (24 at most).`,
  reservedName: (name: string) => `The name ${name} is reserved: pick another one.`,
  monsterNameTaken: (name: string) => `There’s already a monster called ${name}.`,
  nameTooSimilar: (name: string, other: string) =>
    `The name ${name} is too similar to the name of ${other}: pick another one.`,
  projectNameTaken: (name: string) =>
    `There’s already a project called ${name}: pick another name for the monster.`,
  nameTakenFor: (message: string, old: string) => `${message} Pick another name for ${old}.`,
  instructionsEdited: (name: string) =>
    `${name}’s instructions (AGENTS.md) were edited by hand: to rewrite them with the new role, confirm (the old copy stays in AGENTS.md.bak).`,
  noteExists: (path: string) =>
    `There’s already ${path} in the notes: move it or pick another name.`,
  memoryMoveFailed: (to: string, message: string) =>
    `I can’t move the memory to ${vaultLayout().agents}/${to}: ${message}`,
  captainRoleLocked: 'Your lead coordinates the others: its role can’t be changed, only its name.',
  projectLeadRoleLocked:
    'The project lead coordinates the project’s monsters: its role can’t be changed, only its name.',
  colorTooClose: 'This color is too close to another monster’s: pick another one.',
  captainCantRemove: 'Your lead can’t be removed: it coordinates the others. You can rename it.',
  projectLeadCantRemove:
    'The project lead can’t be removed from the project: archive the project, or rename it.',
  leadReturnsWithProject: (name: string) =>
    `${name} was a project lead: it comes back with its project.`,
  teamFull: (max: number) => `The squad already has ${max} monsters besides the lead.`,
  teamFullAsk: (max: number) =>
    `The squad already has ${max} monsters besides the lead: for a new one the user has to archive one first.`,
  projectFull: (max: number) => `The project already has ${max} monsters besides the lead.`,
  halted: 'Monsters is stopped: resume before creating a new monster.',
  haltedDraft: 'Monsters was stopped: the new monster isn’t ready.',
  draftNoAnswer: (reason: string) => `new monster: the model didn’t answer (${reason})`,
  draftInvalid: (attempt: number, reason: string) =>
    `new monster not valid (attempt ${attempt}): ${reason}`,
  nameInProposal: (name: string) => `${name} is already in this proposal: pick another name.`,
  badArea: (area: string) =>
    `area: "${area}" doesn’t work: it must be a notes folder (letters, numbers and "/"), never ${reserved('or')}.`,
  tooManyDuties: (max: number) => `duties: ${max} rules at most.`,
  badModelRef: (text: string, configured: string) =>
    `model: "${text}" is not "provider/model" (configured providers: ${configured || 'none'}). Without model it uses your lead’s.`,
  providerNotConfigured: (provider: string, configured: string) =>
    `model: the provider ${provider} isn’t configured (configured: ${configured || 'none'}).`,
  paidModel: (model: string) =>
    `model: ${model} is paid and paid models are off. Pick a free one or leave model empty.`,
  proposalClosed: 'This proposal was already used or set aside.',
  noFreeName: 'I can’t find a free name: pick one yourself.',
  projectHasLead: (name: string) => `The project ${name} already has a lead.`,
  copyLead: (name: string) =>
    `${name} is a lead: in a project you copy the monsters that work, the lead is already there.`,
  notInProject: (name: string, project: string) => `${name} isn’t in the project ${project}.`,
  busyArchive: (names: readonly string[]) =>
    `${formatList(names)} ${names.length === 1 ? 'is' : 'are'} still working: wait or stop ${names.length === 1 ? 'it' : 'them'}, then archive the project.`,
};

const it: typeof en = {
  ideas: [
    {
      id: 'ricerche',
      label: 'Ricerche online',
      description: 'Fa ricerche online e le riassume in note con le fonti.',
    },
    {
      id: 'bozze',
      label: 'Bozze di post e mail',
      description: 'Scrive bozze di post e mail pronte da usare, nel mio tono.',
    },
    {
      id: 'riassunti',
      label: 'Riassunti',
      description: 'Riassume documenti e note lunghe in pochi punti chiari.',
    },
    {
      id: 'note',
      label: 'Note in ordine',
      description: 'Mette in ordine note e idee: collega, raggruppa, toglie i doppioni.',
    },
    {
      id: 'piano',
      label: 'Piano dei contenuti',
      description: 'Pianifica i contenuti della settimana e tiene il calendario editoriale.',
    },
    {
      id: 'numeri',
      label: 'Numeri e dati',
      description: 'Analizza numeri e dati e ne ricava indicazioni pratiche.',
    },
  ],
  askLabels: {
    publish: 'Pubblicare',
    contact: 'Scrivere ad altri (messaggi, mail)',
    spend: 'Pagare o comprare',
    delete: 'Cancellare',
    goal: 'Cambiare un obiettivo',
  },
  onboardingPending: 'Completa prima il primo avvio: la squadra non esiste ancora.',
  busy: (names) =>
    `${names.length === 1 ? `${names[0]} sta` : `${formatList(names)} stanno`} ancora lavorando: aspetta che finisca o ferma la squadra, poi cambiala.`,
  unknownProject: (id) => `Non c’è un progetto "${id}".`,
  projectArchived: (name) => `Il progetto ${name} è archiviato.`,
  projectDraft: (name) =>
    `Il progetto ${name} è ancora una bozza: confermalo prima di dargli dei mostri.`,
  invalidName: (name) =>
    `"${name}" non va bene: solo lettere, spazi, apostrofi e trattini (al massimo 24).`,
  reservedName: (name) => `Il nome ${name} è riservato: scegline un altro.`,
  monsterNameTaken: (name) => `C'è già un mostro che si chiama ${name}.`,
  nameTooSimilar: (name, other) =>
    `Il nome ${name} è troppo simile a quello di ${other}: scegline un altro.`,
  projectNameTaken: (name) =>
    `C'è già un progetto che si chiama ${name}: scegli un altro nome per il mostro.`,
  nameTakenFor: (message, old) => `${message} Scegli un altro nome per ${old}.`,
  instructionsEdited: (name) =>
    `Le istruzioni di ${name} (AGENTS.md) sono state modificate a mano: per riscriverle con il nuovo ruolo conferma (la copia vecchia resta in AGENTS.md.bak).`,
  noteExists: (path) => `Nelle note c'è già ${path}: spostalo o scegli un altro nome.`,
  memoryMoveFailed: (to, message) =>
    `Non riesco a spostare la memoria in ${vaultLayout().agents}/${to}: ${message}`,
  captainRoleLocked: 'Il tuo capo coordina gli altri: il suo ruolo non si cambia, solo il nome.',
  projectLeadRoleLocked:
    'Il capo del progetto coordina i mostri del progetto: il suo ruolo non si cambia, solo il nome.',
  colorTooClose: 'Questo colore è troppo vicino a quello di un altro mostro: scegline un altro.',
  captainCantRemove: 'Il tuo capo non si può togliere: coordina gli altri. Puoi cambiargli nome.',
  projectLeadCantRemove:
    'Il capo del progetto non si toglie dal progetto: archivia il progetto, o cambiagli nome.',
  leadReturnsWithProject: (name) =>
    `${name} era il capo di un progetto: torna con il suo progetto.`,
  teamFull: (max) => `La squadra ha già ${max} mostri oltre al capo.`,
  teamFullAsk: (max) =>
    `La squadra ha già ${max} mostri oltre al capo: per uno nuovo l'utente deve prima archiviarne uno.`,
  projectFull: (max) => `Il progetto ha già ${max} mostri oltre al capo.`,
  halted: 'Monsters è fermo: riprendi prima di creare un nuovo mostro.',
  haltedDraft: 'Monsters è stato fermato: il nuovo mostro non è pronto.',
  draftNoAnswer: (reason) => `nuovo mostro: il modello non ha risposto (${reason})`,
  draftInvalid: (attempt, reason) => `nuovo mostro non valido (tentativo ${attempt}): ${reason}`,
  nameInProposal: (name) => `${name} c’è già in questa proposta: scegli un altro nome.`,
  badArea: (area) =>
    `area: "${area}" non va bene: una cartella delle note (lettere, numeri e "/"), mai ${reserved('o')}.`,
  tooManyDuties: (max) => `duties: al massimo ${max} regole.`,
  badModelRef: (text, configured) =>
    `model: "${text}" non è "provider/modello" (provider configurati: ${configured || 'nessuno'}). Senza model usa quelli del tuo capo.`,
  providerNotConfigured: (provider, configured) =>
    `model: il provider ${provider} non è configurato (configurati: ${configured || 'nessuno'}).`,
  paidModel: (model) =>
    `model: ${model} è a pagamento e i modelli a pagamento sono spenti. Scegline uno gratuito o lascia model vuoto.`,
  proposalClosed: 'Questa proposta è già stata usata o lasciata stare.',
  noFreeName: 'Non trovo un nome libero: scegline uno tu.',
  projectHasLead: (name) => `Il progetto ${name} ha già un capo.`,
  copyLead: (name) =>
    `${name} è un capo: in un progetto si copiano i mostri che lavorano, il capo c'è già.`,
  notInProject: (name, project) => `${name} non è nel progetto ${project}.`,
  busyArchive: (names) =>
    `${formatList(names)} ${names.length === 1 ? 'sta' : 'stanno'} ancora lavorando: aspetta o fermali, poi archivia il progetto.`,
};

export const teamManagerStrings = () => pick({ en, it });
