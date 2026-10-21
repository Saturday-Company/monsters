import type { DraftKind } from '@monsters/shared';
import { defineStrings } from '../../lib/i18n.ts';

/* The drafts of the monsters in "To review" (D-153). */

const en = {
  kindWords: {
    monster: 'a new monster',
    project: 'a project',
    automation: 'an automation',
    docs: 'a change to the instructions',
    memory: 'to remember',
  } satisfies Record<DraftKind, string>,
  projectReady: (title: string, later: number) =>
    later > 0
      ? `${title} is ready. ${later === 1 ? 'Its first automation is waiting' : `Its ${later} automations are waiting`} for a separate confirmation, here in To review.`
      : `${title} is ready: message its lead from the project page.`,
  monsterReady: (title: string) => `${title} is on the squad: message it from its chat.`,
  /** The subject of a docs draft from its title ("Instructions of Saturday (CLAUDE.md)"). */
  docsSubject: (title: string) => title.replace(/^(?:Instructions of|Istruzioni di) /, ''),
  /** The subject of a memory draft from its title ("Memory of Rhea"). */
  memorySubject: (title: string) => title.replace(/^(?:Memory of|Memoria di) (.+)$/, '$1’s memory'),
  docsDone: (title: string) => `I updated the instructions: ${title}.`,
  memoryDone: (subject: string) => `Done: ${subject} has the new lines.`,
  automationDone: (title: string) => `“${title}” is confirmed: it runs at the scheduled time.`,
  docsLeft: (subject: string) =>
    `I left the proposal alone: the instructions stay as they were (${subject}).`,
  memoryLeft: (subject: string) => `I left it alone: ${subject} stays as it was.`,
  discarded: (title: string) => `I discarded the draft “${title}”.`,
  plan: {
    lead: 'Lead',
    monsters: 'Monsters',
    folder: 'Folder',
    after: 'Later',
    freeName: 'a free name',
    createOnConfirm: 'I’ll create it when you confirm',
    none: 'none',
    /** An automation's name in a line of text: “Posts” / «Post». */
    quoted: (name: string) => `“${name}”`,
    separately: (schedule: string) => `· ${schedule}, to confirm separately`,
  },
  grant: (createFolder: boolean) =>
    `All the project’s monsters will be able to read and write here${
      createFolder ? '.' : ', with everything that’s already in it.'
    }`,
  summary: {
    newLead: 'a new lead',
    leads: (others: number) =>
      `leads${others > 0 ? `, with ${others} ${others === 1 ? 'monster' : 'monsters'}` : ''}`,
    folder: 'Folder',
  },
  docs: {
    file: 'File',
    isNew: ' · new, I’ll create it',
    tainted: (source: string | null) =>
      `Proposed after reading third-party text${source ? ` (${source})` : ''}: check it carefully before applying.`,
    stale:
      'The file changed after the proposal: it can’t be applied. Ask the monster to propose it again.',
    folderMoved:
      'The project’s folder changed after the proposal: it can’t be applied. Ask the monster to propose it again.',
    tooLarge: (file: string) => `${file} is now larger than 1 MB: it can’t be changed from here.`,
    changes: (added: number, removed: number) => `What changes · +${added} −${removed}`,
    blockedStale: 'The file changed after the proposal',
    blockedFolder: 'The project’s folder changed after the proposal',
    blockedLarge: 'The file is larger than 1 MB',
  },
  memoryTainted:
    'They stay marked “from third-party text”: the jobs that read them have their defenses on.',
  card: {
    proposes: (who: string, kind: string) => `${who} proposes ${kind}`,
    draft: (kind: string) => `Draft: ${kind}`,
    taint: (taint: string) =>
      `Proposed after reading third-party text (${taint}): check it carefully before confirming.`,
    applying: 'Applying…',
    apply: 'Apply',
    leave: 'Leave it',
    confirming: 'Confirming…',
    confirm: 'Confirm',
    open: 'Open',
    edit: 'Edit',
    discard: 'Discard',
  },
  toConfirm: (n: number) => `To confirm · ${n}`,
  docsProposals: (n: number) => `Proposals for the instructions · ${n}`,
};
const it: typeof en = {
  kindWords: {
    monster: 'un nuovo mostro',
    project: 'un progetto',
    automation: 'un’automazione',
    docs: 'una modifica alle istruzioni',
    memory: 'di ricordare',
  },
  projectReady: (title, later) =>
    later > 0
      ? `${title} è pronto. ${later === 1 ? 'La sua prima automazione aspetta' : `Le sue ${later} automazioni aspettano`} una conferma a parte, qui in Da rivedere.`
      : `${title} è pronto: scrivi al suo capo dalla pagina del progetto.`,
  monsterReady: (title) => `${title} è nella squadra: scrivigli dalla sua chat.`,
  docsSubject: (title) => title.replace(/^(?:Instructions of|Istruzioni di) /, ''),
  memorySubject: (title) => title.replace(/^(?:Memory of|Memoria) /, 'la memoria '),
  docsDone: (title) => `Ho aggiornato le istruzioni: ${title}.`,
  memoryDone: (subject) => `Fatto: ${subject} ha le righe nuove.`,
  automationDone: (title) => `«${title}» è confermata: gira all’ora prevista.`,
  docsLeft: (subject) =>
    `Ho lasciato stare la proposta: le istruzioni restano com’erano (${subject}).`,
  memoryLeft: (subject) => `Ho lasciato stare: ${subject} resta com’era.`,
  discarded: (title) => `Ho scartato la bozza «${title}».`,
  plan: {
    lead: 'Capo',
    monsters: 'Mostri',
    folder: 'Cartella',
    after: 'Dopo',
    freeName: 'un nome libero',
    createOnConfirm: 'la creo alla conferma',
    none: 'nessuna',
    quoted: (name) => `«${name}»`,
    separately: (schedule) => `· ${schedule}, da confermare a parte`,
  },
  grant: (createFolder) =>
    `Tutti i mostri del progetto potranno leggere e scrivere qui${
      createFolder ? '.' : ', con tutto quello che c’è già.'
    }`,
  summary: {
    newLead: 'un capo nuovo',
    leads: (others) =>
      `a capo${others > 0 ? `, con ${others} ${others === 1 ? 'mostro' : 'mostri'}` : ''}`,
    folder: 'Cartella',
  },
  docs: {
    file: 'File',
    isNew: ' · nuovo, lo creo',
    tainted: (source) =>
      `Proposta dopo aver letto testo di terzi${source ? ` (${source})` : ''}: controlla bene prima di applicare.`,
    stale:
      'Il file è cambiato dopo la proposta: non si può applicare. Chiedi al mostro di riproporla.',
    folderMoved:
      'La cartella del progetto è cambiata dopo la proposta: non si può applicare. Chiedi al mostro di riproporla.',
    tooLarge: (file) => `${file} adesso è più grande di 1 MB: non si cambia da qui.`,
    changes: (added, removed) => `Cosa cambia · +${added} −${removed}`,
    blockedStale: 'Il file è cambiato dopo la proposta',
    blockedFolder: 'La cartella del progetto è cambiata dopo la proposta',
    blockedLarge: 'Il file è più grande di 1 MB',
  },
  memoryTainted:
    'Restano segnate «da testo di terzi»: i lavori che le leggono hanno le difese accese.',
  card: {
    proposes: (who, kind) => `${who} propone ${kind}`,
    draft: (kind) => `Bozza: ${kind}`,
    taint: (taint) =>
      `Proposta dopo aver letto testo di terzi (${taint}): controlla bene prima di confermare.`,
    applying: 'Applico…',
    apply: 'Applica',
    leave: 'Lascia stare',
    confirming: 'Confermo…',
    confirm: 'Conferma',
    open: 'Apri',
    edit: 'Modifica',
    discard: 'Scarta',
  },
  toConfirm: (n) => `Da confermare · ${n}`,
  docsProposals: (n) => `Proposte per le istruzioni · ${n}`,
};

export const draftStrings = defineStrings({ en, it });
