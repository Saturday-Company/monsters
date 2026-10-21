import { defineStrings } from '../../lib/i18n.ts';

/* The form of a new project (D-153). */

const en = {
  folderRelative: 'Type the full path of the folder, for example ~/Projects/Site.',
  leadMissing: 'Choose the monster to copy as the lead.',
  leadTaken: 'There’s already a monster with this name, in this squad or another one.',
  readyWithFailures: (name: string, failed: string) =>
    `${name} is ready, but I couldn’t copy ${failed}`,
  ready: (name: string) => `${name} is ready: write to its lead from here.`,
  title: 'New project',
  intro:
    'A project is a squad with its own lead, its own monsters, a notes folder, its own folder on the computer and its own spending cap. Your lead stays above everyone.',
  project: {
    title: 'The project',
    name: 'Name',
    placeholder: 'Social media',
    notesIn: 'Its notes will go in',
  },
  folder: {
    title: 'Folder',
    description:
      'The folder on the computer where the project’s monsters work: their terminal, the files and Claude Code or Codex start from there. All the project’s monsters will be able to read and write here. Not your home folder or hidden folders.',
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
      'Coordinates the project’s monsters the way your lead does with your squad. A copy has the original’s role, look and models and a memory of its own.',
    label: 'Who leads the project',
    new: 'A new one',
    copy: 'Copy a monster',
    name: 'Lead’s name',
    nameHint: 'Empty: I’ll pick a free name.',
    placeholder: 'Atlas',
    from: 'To copy',
    willBeCalled: (name: string | null) =>
      `It will be called ${name ?? 'a free name'}: you can change it later, from its chat.`,
  },
  first: {
    title: 'First monsters',
    description:
      'Copy the monsters you need into the project: the original stays where it is. You can add a new tailor-made one later from the project’s Squad.',
    label: 'Monsters to copy',
  },
  links: {
    title: 'Connections',
    description:
      'The apps and services given to the whole squad reach the project too. Turn off the ones it doesn’t need: you can turn them back on whenever you like from the project’s Connections tab.',
    viaClaude: 'Through the Claude subscription, for those who work with Claude',
    team: 'Given to the whole squad',
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
    'Un progetto è una squadra con il suo capo, i suoi mostri, una cartella delle note, la sua cartella sul computer e un suo tetto di spesa. Il tuo capo resta sopra tutti.',
  project: {
    title: 'Il progetto',
    name: 'Nome',
    placeholder: 'Social di Saturday',
    notesIn: 'Le sue note andranno in',
  },
  folder: {
    title: 'Cartella',
    description:
      'La cartella del computer dove lavorano i mostri del progetto: il loro terminale, i file e Claude Code o Codex partono da lì. Tutti i mostri del progetto potranno leggere e scrivere qui. Non la tua cartella personale né le cartelle nascoste.',
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
      'Coordina i mostri del progetto come il tuo capo fa con la tua squadra. Una copia ha il ruolo, l’aspetto e i modelli dell’originale e una memoria tutta sua.',
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
    description:
      'Copia nel progetto i mostri che ti servono: l’originale resta dov’è. Uno nuovo, su misura, lo aggiungi dopo dalla Squadra del progetto.',
    label: 'Mostri da copiare',
  },
  links: {
    title: 'Collegamenti',
    description:
      'I programmi e i servizi dati a tutta la squadra arrivano anche al progetto. Spegni quelli che non gli servono: li riaccendi quando vuoi dalla scheda Collegamenti del progetto.',
    viaClaude: 'Tramite l’abbonamento Claude, per chi lavora con Claude',
    team: 'Dato a tutta la squadra',
    switch: (label) => `${label} per il progetto`,
  },
  cancel: 'Annulla',
  creating: 'Lo preparo…',
  create: 'Crea il progetto',
};

export const formStrings = defineStrings({ en, it });
