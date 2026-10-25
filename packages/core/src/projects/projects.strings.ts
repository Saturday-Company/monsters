import { pick } from '@monsters/shared';

/*
 * The texts a person reads from the projects (D-153): API errors, the drafts'
 * summaries and the reports of `project_send`. Pick them where they are
 * written (`projectStrings()`), never at module load: the language can change
 * while the core runs.
 */

const en = {
  unknownProject: (id: string) => `There is no project “${id}”.`,
  archived: (name: string) => `The project ${name} is archived.`,
  nameTakenProject: (name: string) => `There is already a project called ${name}.`,
  nameTakenMonster: (name: string) =>
    `There is already a monster called ${name}: pick another name for the project.`,
  areaTaken: (name: string, area: string) =>
    `${name}’s notes are already in ${area}: pick another folder.`,
  folderHoldsData:
    'This folder contains Monsters’ notes or data: the project’s monsters would read and write all of it. Pick one that doesn’t.',
  folderAbsolute: 'Type the full path of the project folder.',
  folderMissing: (path: string) =>
    `The folder ${path} doesn’t exist: pick one that does, or ask me to create it.`,
  leadFixed: 'You can’t change the lead of an active project from here: rename it from its page.',
  draftNotArchivable: (name: string) =>
    `${name} is a draft: leave it aside instead of archiving it.`,
  notArchived: (name: string) => `The project ${name} isn’t archived.`,
  leadGone: (name: string) =>
    `${name}’s lead is no longer in the archive: the project stays archived.`,
  notDraft: (name: string) => `${name} isn’t a draft: archive it instead of leaving it aside.`,
  newFolderUnknown: 'I don’t know where to create the folder: give me an existing one.',
  folderPathAbsolute: 'folder: type the full path of the folder.',
  notAFolder: (path: string) => `${path} isn’t a folder.`,
  folderMissingOrNew: (path: string) =>
    `The folder ${path} doesn’t exist: pick one that does, or “new” for a new one.`,
  connectionUnknown: (name: string, have: string) =>
    `connections: “${name}” isn’t connected (connected: ${have}). Connect it from Settings → Apps and Telegram.`,
  none: 'none',
  connectionsReset: (project: string, allowed: string) =>
    `${project}: the old list of allowed connections (${allowed}) no longer applies. The project now reaches every connection given to the whole squad: turn off the ones it doesn’t need in its Connections tab.`,
  connectionsStale: (project: string, names: string) =>
    `${project}: turned off for the project but no longer a connection (removed or renamed): ${names}. They have no effect.`,
  nameInvalid: 'not valid',
  unconfirmed: (name: string, id: string) =>
    `project “${name}” (${id}): active without the user’s confirmation, back to a draft to confirm`,
  monstersCount: (max: number) => `monsters: from 1 to ${max} monsters besides the lead.`,
  automationsMax: (max: number) => `automations: ${max} at most.`,
  automationsUnavailable: 'automations: not available.',
  leadCopyUnknown: (name: string) => `lead.copy_of: there is no monster “${name}”.`,
  copyOfLead: (i: number, name: string) =>
    `monsters[${i}].copy_of: ${name} is a lead, it can’t be copied.`,
  copyOfUnknown: (i: number, name: string) =>
    `monsters[${i}].copy_of: there is no monster “${name}”.`,
  copyNameTwice: (i: number, name: string) => `monsters[${i}]: ${name} is already in the proposal.`,
  participantUnknown: (i: number, name: string, names: string) =>
    `automations[${i}].participants: “${name}” isn’t one of the project’s monsters (${names}).`,
  alreadyConfirmed: (name: string) => `The project ${name} is already confirmed.`,
  renameInDraft: (message: string) => `${message} Change the name in the draft and confirm again.`,
  noFolder: (name: string) => `The project ${name} has no folder.`,
  folderGone: (name: string) => `The folder of the project ${name} is gone: I can’t write there.`,
  stoppedReason: (name: string) => `You stopped the project ${name}`,
  giroNotStarted: (reason: string) => `${reason}: the run didn’t start.`,
  stillDraftConfirm: (name: string) => `The project ${name} is still a draft: confirm it first.`,
  noLead: (name: string) => `The project ${name} has no lead.`,
  stillDraft: (name: string) => `The project ${name} is still a draft.`,
  reportRestart:
    'Monsters closed while it was working on this: the work was interrupted. If it’s still needed, send it again with project_send.',
  reportStopped: 'Stopped before it began (you stopped the project or Monsters).',
  reportNoAnswer: '(no answer)',
  rootFolder:
    'This is the root of the disk: the project’s monsters would read and write everything in it. Pick the project’s folder.',
  homeFolder:
    'This is your home folder (or one that contains it): the project’s monsters would read and write everything in it, keys included. Pick the project’s folder.',
  insideHome: (hidden: boolean) =>
    `Inside ${hidden ? 'a hidden folder' : 'the settings'} of your home folder there are keys and settings of your programs (for example ~/.ssh): the project’s monsters must not read or write them. Pick another folder.`,
  // docs proposals (D-113)
  docsChanged: 'The file changed after the proposal: ask the monster to propose it again.',
  docsFolderMoved:
    'The project’s folder changed after the proposal: ask the monster to propose it again.',
  docsLink: 'a link',
  docsTooLarge: 'larger than 1 MB',
  docsSpecial: 'a folder or a special file',
  docsNoFolder: (name: string) => `The project ${name} has no folder.`,
  docsEmpty: (file: string) => `An empty ${file} can’t be proposed.`,
  docsInvisible: (file: string, unseen: string) =>
    `The text has a character you can’t see (${unseen}): it can’t be proposed in ${file}.`,
  docsTooBig: (file: string, kb: number, max: number) =>
    `${file} is ${kb} KB: the limit is ${max} KB.`,
  docsFolderGone: (path: string) => `The folder ${path} is gone.`,
  docsNotFileProposal: (file: string, what: string) =>
    `${file} in the folder is ${what}: it can’t be changed with a proposal.`,
  docsNotFileWrite: (file: string, what: string) =>
    `${file} in the folder is ${what}: I won’t write it.`,
  docsUnchanged: (file: string) => `${file} is already exactly like this.`,
  docsTooMany: (name: string, max: number) =>
    `The project ${name} already has ${max} proposals for the instructions waiting for you.`,
  docsUnknownProposal: 'This proposal doesn’t exist.',
  docsProposalClosed: 'This proposal was already applied, set aside or replaced.',
  docsProjectFolderGone: 'The project’s folder is gone.',
  docsTitle: (name: string, file: string) => `Instructions of ${name} (${file})`,
  docsSummary: (
    who: string | undefined,
    create: boolean,
    name: string,
    file: string,
    reason: string,
  ) =>
    `${who ?? 'A monster'} proposes to ${create ? 'create' : 'change'} the instructions of “${name}” (${file})${reason ? `: ${reason}` : ''}.`,
  // drafts
  draftClosed: 'This draft was already confirmed or set aside.',
  draftUnknownUsed: 'This draft doesn’t exist (or was already used).',
  draftUnknown: 'This draft doesn’t exist.',
  automationsMissing: 'Automations aren’t available.',
  monsterDraftSummary: (who: string | undefined, name: string, role: string) =>
    `${who ?? 'A monster'} proposes a new monster, ${name}: ${role}.`,
  automationDraftSummary: (who: string | undefined, name: string, schedule: string) =>
    `${who ? `${who} proposes the automation` : 'Draft of the automation'} “${name}”: ${schedule}.`,
  projectDraftSummary: (o: {
    who: string | undefined;
    name: string;
    lead: string | undefined;
    members: string[];
    automations: number;
    folder: string | undefined;
  }) => {
    const lead = o.lead ? `lead ${o.lead}` : 'a lead';
    const members = o.members.length > 0 ? `, with ${o.members.join(', ')}` : '';
    const autos =
      o.automations === 0
        ? ''
        : `; ${o.automations === 1 ? 'one automation' : `${o.automations} automations`}`;
    const folder = o.folder ? `; the monsters read and write in ${o.folder}` : '';
    return `${o.who ? `${o.who} proposes the` : 'Draft of the'} project “${o.name}”: ${lead}${members}${autos}${folder}.`;
  },
};

const it: typeof en = {
  unknownProject: (id) => `Non c’è un progetto "${id}".`,
  archived: (name) => `Il progetto ${name} è archiviato.`,
  nameTakenProject: (name) => `C’è già un progetto che si chiama ${name}.`,
  nameTakenMonster: (name) =>
    `C’è già un mostro che si chiama ${name}: scegli un altro nome per il progetto.`,
  areaTaken: (name, area) => `Le note di ${name} stanno già in ${area}: scegli un’altra cartella.`,
  folderHoldsData:
    'Questa cartella contiene le note o i dati di Monsters: i mostri del progetto ci leggerebbero e scriverebbero tutto. Scegline una che non li contenga.',
  folderAbsolute: 'Scrivi il percorso completo della cartella del progetto.',
  folderMissing: (path) =>
    `La cartella ${path} non esiste: scegline una che c’è, o chiedi di crearla.`,
  leadFixed: 'Il capo di un progetto attivo non si cambia da qui: cambiagli nome dalla sua scheda.',
  draftNotArchivable: (name) => `${name} è una bozza: lasciala stare invece di archiviarla.`,
  notArchived: (name) => `Il progetto ${name} non è archiviato.`,
  leadGone: (name) => `Il capo di ${name} non è più nell'archivio: il progetto resta archiviato.`,
  notDraft: (name) => `${name} non è una bozza: si archivia, non si lascia stare.`,
  newFolderUnknown: 'Non so dove creare la cartella: indicane una esistente.',
  folderPathAbsolute: 'folder: scrivi il percorso completo della cartella.',
  notAFolder: (path) => `${path} non è una cartella.`,
  folderMissingOrNew: (path) =>
    `La cartella ${path} non esiste: scegline una che c’è, o "new" per una nuova.`,
  connectionUnknown: (name, have) =>
    `connections: "${name}" non è collegato (collegati: ${have}). Si collega da Impostazioni → App e Telegram.`,
  none: 'nessuno',
  connectionsReset: (project, allowed) =>
    `${project}: la vecchia lista dei collegamenti consentiti (${allowed}) non vale più. Ora il progetto raggiunge tutti i collegamenti dati a tutta la squadra: spegni quelli che non gli servono nella scheda Collegamenti.`,
  connectionsStale: (project, names) =>
    `${project}: spenti per il progetto ma non più collegamenti (tolti o rinominati): ${names}. Non hanno effetto.`,
  nameInvalid: 'non va bene',
  unconfirmed: (name, id) =>
    `progetto «${name}» (${id}): attivo senza una conferma dell'utente, torna una bozza da confermare`,
  monstersCount: (max) => `monsters: da 1 a ${max} mostri oltre al capo.`,
  automationsMax: (max) => `automations: al massimo ${max}.`,
  automationsUnavailable: 'automations: non disponibili.',
  leadCopyUnknown: (name) => `lead.copy_of: non c’è un mostro "${name}".`,
  copyOfLead: (i, name) => `monsters[${i}].copy_of: ${name} è un capo, non si copia.`,
  copyOfUnknown: (i, name) => `monsters[${i}].copy_of: non c’è un mostro "${name}".`,
  copyNameTwice: (i, name) => `monsters[${i}]: ${name} c’è già nella proposta.`,
  participantUnknown: (i, name, names) =>
    `automations[${i}].participants: "${name}" non è tra i mostri del progetto (${names}).`,
  alreadyConfirmed: (name) => `Il progetto ${name} è già confermato.`,
  renameInDraft: (message) => `${message} Cambia il nome nella bozza e conferma di nuovo.`,
  noFolder: (name) => `Il progetto ${name} non ha una cartella.`,
  folderGone: (name) => `La cartella del progetto ${name} non c’è più: non posso scriverci.`,
  stoppedReason: (name) => `Hai fermato il progetto ${name}`,
  giroNotStarted: (reason) => `${reason}: il giro non è partito.`,
  stillDraftConfirm: (name) => `Il progetto ${name} è ancora una bozza: confermalo prima.`,
  noLead: (name) => `Il progetto ${name} non ha un capo.`,
  stillDraft: (name) => `Il progetto ${name} è ancora una bozza.`,
  reportRestart:
    'Monsters si è chiuso mentre ci lavorava: il lavoro si è interrotto. Se serve ancora, rimandalo con project_send.',
  reportStopped: 'Fermato prima di cominciare (hai fermato il progetto o Monsters).',
  reportNoAnswer: '(nessuna risposta)',
  rootFolder:
    'È la radice del disco: i mostri del progetto ci leggerebbero e scriverebbero tutto. Scegli la cartella del progetto.',
  homeFolder:
    'È la tua cartella personale (o una che la contiene): i mostri del progetto ci leggerebbero e scriverebbero tutto, chiavi comprese. Scegli la cartella del progetto.',
  insideHome: (hidden) =>
    `Dentro ${hidden ? 'una cartella nascosta' : 'le impostazioni'} della tua cartella personale ci sono chiavi e impostazioni dei tuoi programmi (per esempio ~/.ssh): i mostri del progetto non devono leggerle né scriverle. Scegli un’altra cartella.`,
  docsChanged: 'Il file è cambiato dopo la proposta: chiedi al mostro di riproporla.',
  docsFolderMoved:
    'La cartella del progetto è cambiata dopo la proposta: chiedi al mostro di riproporla.',
  docsLink: 'un collegamento',
  docsTooLarge: 'più grande di 1 MB',
  docsSpecial: 'una cartella o un file speciale',
  docsNoFolder: (name) => `Il progetto ${name} non ha una cartella.`,
  docsEmpty: (file) => `${file} vuoto non si propone.`,
  docsInvisible: (file, unseen) =>
    `Il testo ha un carattere che non si vede (${unseen}): in ${file} non si propone.`,
  docsTooBig: (file, kb, max) => `${file} di ${kb} KB: al massimo ${max} KB.`,
  docsFolderGone: (path) => `La cartella ${path} non c’è più.`,
  docsNotFileProposal: (file, what) =>
    `${file} nella cartella è ${what}: non si cambia con una proposta.`,
  docsNotFileWrite: (file, what) => `${file} nella cartella è ${what}: non lo scrivo.`,
  docsUnchanged: (file) => `${file} è già esattamente così.`,
  docsTooMany: (name, max) =>
    `Il progetto ${name} ha già ${max} proposte per le istruzioni che aspettano l’utente.`,
  docsUnknownProposal: 'Questa proposta non c’è.',
  docsProposalClosed: 'Questa proposta è già stata applicata, lasciata stare o sostituita.',
  docsProjectFolderGone: 'La cartella del progetto non c’è più.',
  docsTitle: (name, file) => `Istruzioni di ${name} (${file})`,
  docsSummary: (who, create, name, file, reason) =>
    `${who ?? 'Un mostro'} propone di ${create ? 'creare' : 'cambiare'} le istruzioni di «${name}» (${file})${reason ? `: ${reason}` : ''}.`,
  draftClosed: 'Questa bozza è già stata confermata o lasciata stare.',
  draftUnknownUsed: 'Questa bozza non c’è (o è già stata usata).',
  draftUnknown: 'Questa bozza non c’è.',
  automationsMissing: 'Le automazioni non ci sono.',
  monsterDraftSummary: (who, name, role) =>
    `${who ?? 'Un mostro'} propone un nuovo mostro, ${name}: ${role}.`,
  automationDraftSummary: (who, name, schedule) =>
    `${who ? `${who} propone l’automazione` : 'Bozza dell’automazione'} «${name}»: ${schedule}.`,
  projectDraftSummary: (o) => {
    const lead = o.lead ? `capo ${o.lead}` : 'un capo';
    const members = o.members.length > 0 ? `, con ${o.members.join(', ')}` : '';
    const autos =
      o.automations === 0
        ? ''
        : `; ${o.automations === 1 ? 'un’automazione' : `${o.automations} automazioni`}`;
    const folder = o.folder ? `; i mostri leggono e scrivono in ${o.folder}` : '';
    return `${o.who ? `${o.who} propone il` : 'Bozza del'} progetto «${o.name}»: ${lead}${members}${autos}${folder}.`;
  },
};

export const projectStrings = () => pick({ en, it });
