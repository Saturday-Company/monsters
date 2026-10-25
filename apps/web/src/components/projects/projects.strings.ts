import { defineStrings } from '../../lib/i18n.ts';

/* Projects: the small pieces (archive, folder picker, squad chart) (D-153). */

const en = {
  details: 'Details',
  archive: {
    done: (name: string) =>
      `${name} is in the archive with its monsters. Notes and folder stay where they are.`,
    title: 'Archive the project',
    description:
      'Its monsters go to the archive with it and stop working; the notes and the folder stay where they are. You can restore it whenever you like.',
    rowDescription: 'If you restore it, it finds its monsters again with their notes.',
    label: 'Archive',
    question: 'Archive the project?',
    confirm: 'Yes, archive',
  },
  pickFolder: 'Choose…',
  chart: {
    steps: ['Your lead', 'Personal squad / Projects', 'Project lead', 'Monsters'],
    label:
      'How the monsters are organized: your lead, the personal squad and the projects, the project lead, the monsters',
  },
};
const it: typeof en = {
  details: 'Dettagli',
  archive: {
    done: (name) => `${name} è nell’archivio con i suoi mostri. Note e cartella restano dove sono.`,
    title: 'Archivia il progetto',
    description:
      'I suoi mostri vanno nell’archivio con lui e smettono di lavorare; le note e la cartella restano dove sono. Lo puoi ripristinare quando vuoi.',
    rowDescription: 'Se lo ripristini, ritrova i suoi mostri con le loro note.',
    label: 'Archivia',
    question: 'Archiviare il progetto?',
    confirm: 'Sì, archivia',
  },
  pickFolder: 'Scegli…',
  chart: {
    steps: ['Il tuo capo', 'Squadra personale / Progetti', 'Capo del progetto', 'Mostri'],
    label:
      'Come sono organizzati i mostri: il tuo capo, la squadra personale e i progetti, il capo del progetto, i mostri',
  },
};

export const projectsStrings = defineStrings({ en, it });
