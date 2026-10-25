import { defineStrings } from '../../lib/i18n.ts';

/* The form of a new project (D-153). */

const en = {
  folderRelative: 'Type the full path of the folder, for example ~/Projects/Site.',
  leadMissing: 'Choose the monster to copy as the lead.',
  leadTaken: 'There’s already a monster with this name, in this squad or another one.',
  readyWithFailures: (name: string, failed: string) =>
    `${name} is ready, but I couldn’t copy ${failed}`,
  ready: (name: string) => `${name} is ready: message its lead from here.`,
  title: 'New project',
  intro:
    'A project is a squad of its own: a lead, its monsters, notes, a folder and a spending cap. Your lead still oversees everyone.',
  project: {
    title: 'The project',
    name: 'Name',
    placeholder: 'Social media',
    notesIn: 'Its notes will go in',
  },
  more: {
    title: 'More options',
    description: 'Folder, lead, first monsters and apps.',
  },
  folder: {
    title: 'Folder',
    description: 'The computer folder where the project’s monsters work. Optional.',
    details:
      'Their commands, the files and the other assistants (Claude Code, Codex) start from there. All the project’s monsters will be able to read and write in it. Not your home folder or hidden folders.',
    label: 'The project’s folder',
    none: 'None',
    existing: 'An existing one',
    new: 'A new one',
    noneHint: 'Each monster works in its own private folder.',
    path: 'Full path',
    newHint: (canPick: boolean) =>
      `I’ll create it${canPick ? ': pick where with Choose…' : ''}. Not inside the notes or Monsters’ data.`,
    existingHint: 'For example a repo: ~/Projects/Site. Not inside the notes or Monsters’ data.',
    placeholder: '~/Projects/Site',
  },
  lead: {
    title: 'Project lead',
    description:
      'Coordinates the project’s monsters. A copy has the original’s role, look and models and a memory of its own.',
    label: 'Who leads the project',
    new: 'A new one',
    copy: 'Copy a monster',
    name: 'Lead’s name',
    nameHint: 'Leave it empty and I’ll pick a free name.',
    placeholder: 'Atlas',
    from: 'To copy',
    willBeCalled: (name: string | null) =>
      `It will be called ${name ?? 'a free name'}: you can change it later, from its chat.`,
  },
  first: {
    title: 'First monsters',
    description: 'Copy the monsters you need into the project: the originals stay where they are.',
    label: 'Monsters to copy',
  },
  links: {
    title: 'Apps',
    description:
      'Apps given to all monsters reach the project too. Turn off what it doesn’t need: you can change it later in the project’s Settings.',
    viaClaude: 'Through your Claude plan, for the monsters that work with Claude',
    team: 'Given to all monsters',
    switch: (label: string) => `${label} for the project`,
  },
  cancel: 'Cancel',
  creating: 'Getting it ready…',
  create: 'Create the project',
};
const it: typeof en = {
  folderRelative: 'Scrivi il percorso completo della cartella, per esempio ~/Progetti/Sito.',
  leadMissing: 'Scegli il mostro da copiare come capo.',
  leadTaken: 'C’è già un mostro con questo nome, in questa o in un’altra squadra.',
  readyWithFailures: (name, failed) => `${name} è pronto, ma non ho copiato ${failed}`,
  ready: (name) => `${name} è pronto: scrivi al suo capo da qui.`,
  title: 'Nuovo progetto',
  intro:
    'Un progetto è una squadra a sé: un capo, i suoi mostri, le note, una cartella e un tetto di spesa. Il tuo capo resta sopra tutti.',
  project: {
    title: 'Il progetto',
    name: 'Nome',
    placeholder: 'Social di Saturday',
    notesIn: 'Le sue note andranno in',
  },
  more: {
    title: 'Altre opzioni',
    description: 'Cartella, capo, primi mostri e app.',
  },
  folder: {
    title: 'Cartella',
    description: 'La cartella del computer dove lavorano i mostri del progetto. Facoltativa.',
    details:
      'I loro comandi, i file e gli altri assistenti (Claude Code, Codex) partono da lì. Tutti i mostri del progetto potranno leggere e scrivere qui. Non la tua cartella personale né le cartelle nascoste.',
    label: 'Cartella del progetto',
    none: 'Nessuna',
    existing: 'Una che c’è',
    new: 'Una nuova',
    noneHint: 'Ogni mostro lavora nella sua cartella privata.',
    path: 'Percorso completo',
    newHint: (canPick) =>
      `La creo io${canPick ? ': con Scegli… indichi dove' : ''}. Non dentro le note né dentro i dati di Monsters.`,
    existingHint:
      'Per esempio un repo: ~/Progetti/Sito. Non dentro le note né dentro i dati di Monsters.',
    placeholder: '~/Progetti/Sito',
  },
  lead: {
    title: 'Capo del progetto',
    description:
      'Coordina i mostri del progetto. Una copia ha il ruolo, l’aspetto e i modelli dell’originale e una memoria tutta sua.',
    label: 'Chi guida il progetto',
    new: 'Uno nuovo',
    copy: 'Copia un mostro',
    name: 'Nome del capo',
    nameHint: 'Vuoto: gli do io un nome libero.',
    placeholder: 'Atlas',
    from: 'Da copiare',
    willBeCalled: (name) =>
      `Si chiamerà ${name ?? 'con un nome libero'}: lo cambi dopo, dalla sua chat.`,
  },
  first: {
    title: 'Primi mostri',
    description: 'Copia nel progetto i mostri che ti servono: gli originali restano dove sono.',
    label: 'Mostri da copiare',
  },
  links: {
    title: 'App',
    description:
      'Le app date a tutti i mostri arrivano anche al progetto. Spegni quelle che non gli servono: le cambi dopo, nelle Impostazioni del progetto.',
    viaClaude: 'Tramite il tuo piano Claude, per chi lavora con Claude',
    team: 'Data a tutti i mostri',
    switch: (label) => `${label} per il progetto`,
  },
  cancel: 'Annulla',
  creating: 'Lo preparo…',
  create: 'Crea il progetto',
};

export const formStrings = defineStrings({ en, it });
