import { defineStrings } from '../../lib/i18n.ts';

/* A project's page, a draft and an archived project (D-153). */

const en = {
  stop: {
    nobody: (name: string) => `Nobody was working in ${name}: nothing to stop.`,
    stopped: (name: string, runs: number, sends: number, giri: number) =>
      `I stopped the work of ${name}: ${[
        runs > 0 ? `${runs} ${runs === 1 ? 'job' : 'jobs'}` : null,
        sends > 0 ? `${sends} ${sends === 1 ? 'request' : 'requests'} from your lead` : null,
        giri > 0 ? `${giri} ${giri === 1 ? 'automation run' : 'automation runs'}` : null,
      ]
        .filter(Boolean)
        .join(', ')}.`,
    armedLabel: (name: string) => `Press again to stop ${name}`,
    label: (name: string) => `Stop the monsters of ${name}`,
    armedTitle: 'Press again to stop the work of the project’s monsters',
    title: 'Stop the work of the project’s monsters (not the others)',
    armedText: 'Again to stop',
    text: 'Stop this project’s monsters',
  },
  noLead: 'The project has no lead yet.',
  sectionsOf: (name: string) => `${name} sections`,
  newProject: 'New project',
  loading: 'Loading…',
  missing: 'This project is gone.',
  missingHint: 'It was deleted, or the link is old.',
  missingHome: 'Back to the chats',
  draft: {
    saved: 'Draft name saved.',
    nameGroup: 'Name',
    nameLabel: 'Project name',
    nameHint: (area: string) => `Its notes will go in ${area}/.`,
    saveName: 'Save the name',
    title: (name: string) => `Draft: ${name}`,
    banner: 'Draft to confirm',
    bannerTitle: 'Draft: confirm',
    bannerText: (proposer: string | null) =>
      `${proposer ? `${proposer} proposed it. ` : ''}Nothing exists yet: when you confirm, the lead, the monsters and the folder are all born together. Automations stay drafts to confirm separately.`,
    why: (why: string) => `Why: ${why}`,
    discard: 'Discard',
    confirming: 'Confirming…',
    confirm: 'Confirm',
  },
  archived: {
    restored: (name: string) => `${name} is back with its monsters.`,
    label: 'Archived project',
    on: (date: string | null) => (date ? `Archived on ${date}` : 'Archived'),
    intro: 'Its monsters are in the archive and not working. The notes in',
    andFolder: 'and the folder',
    outro: 'are where you left them.',
    restoring: 'Bringing it back…',
    restore: 'Restore',
  },
};
const it: typeof en = {
  stop: {
    nobody: (name) => `Nel progetto ${name} non lavorava nessuno: niente da fermare.`,
    stopped: (name, runs, sends, giri) =>
      `Ho fermato il lavoro di ${name}: ${[
        runs > 0 ? `${runs} ${runs === 1 ? 'lavoro' : 'lavori'}` : null,
        sends > 0 ? `${sends} ${sends === 1 ? 'richiesta' : 'richieste'} del tuo capo` : null,
        giri > 0 ? `${giri} ${giri === 1 ? 'giro' : 'giri'}` : null,
      ]
        .filter(Boolean)
        .join(', ')}.`,
    armedLabel: (name) => `Premi di nuovo per fermare ${name}`,
    label: (name) => `Ferma i mostri di ${name}`,
    armedTitle: 'Premi di nuovo per fermare il lavoro dei mostri del progetto',
    title: 'Ferma il lavoro dei mostri del progetto (non gli altri)',
    armedText: 'Di nuovo per fermare',
    text: 'Ferma i mostri di questo progetto',
  },
  noLead: 'Il progetto non ha ancora un capo.',
  sectionsOf: (name) => `Sezioni di ${name}`,
  newProject: 'Nuovo progetto',
  loading: 'Carico…',
  missing: 'Questo progetto non c’è più.',
  missingHint: 'È stato eliminato, o il link è vecchio.',
  missingHome: 'Torna alle chat',
  draft: {
    saved: 'Nome della bozza salvato.',
    nameGroup: 'Nome',
    nameLabel: 'Nome del progetto',
    nameHint: (area) => `Le sue note andranno in ${area}/.`,
    saveName: 'Salva il nome',
    title: (name) => `Bozza: ${name}`,
    banner: 'Bozza da confermare',
    bannerTitle: 'Bozza: conferma',
    bannerText: (proposer) =>
      `${proposer ? `L’ha proposta ${proposer}. ` : ''}Non c’è ancora niente: alla conferma nascono il capo, i mostri e la cartella, tutti insieme. Le automazioni restano bozze da confermare a parte.`,
    why: (why) => `Perché: ${why}`,
    discard: 'Scarta',
    confirming: 'Confermo…',
    confirm: 'Conferma',
  },
  archived: {
    restored: (name) => `${name} è tornato con i suoi mostri.`,
    label: 'Progetto archiviato',
    on: (date) => (date ? `Archiviato il ${date}` : 'Archiviato'),
    intro: 'I suoi mostri sono nell’archivio e non lavorano. Le note in',
    andFolder: 'e la cartella',
    outro: 'sono dove le hai lasciate.',
    restoring: 'Lo riporto…',
    restore: 'Ripristina',
  },
};

export const viewStrings = defineStrings({ en, it });
