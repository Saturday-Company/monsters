import { defineStrings } from '../../lib/i18n.ts';

/* "Behind the scenes": the terminal of a monster (D-153). */

const en = {
  filters: {
    all: 'All',
    thoughts: 'Thoughts',
    tools: 'Tools',
    delegations: 'Tasks',
    errors: 'Errors',
  },
  running: 'running…',
  stoppedMidway: 'stopped midway',
  failed: 'failed',
  done: 'done',
  stoppedByStop: 'Stopped with Stop',
  tool: 'tool:',
  dataSent: 'Data sent',
  result: 'Result',
  problem: 'Problem',
  technicalError: 'Technical error',
  openFile: (name: string | null) => `Open ${name ? `“${name}”` : 'the file'} in the preview`,
  fileGone: 'file no longer available',
  file: 'file',
  noteDone: (action: string, name: string) => `Note ${action}: ${name}`,
  noteTouched: 'touched',
  vault: {
    create: 'created',
    edit: 'edited',
    move: 'moved',
    delete: 'trashed',
    restore: 'restored',
    undo: 'rolled back',
    propose: 'with a proposed change',
  } as Record<string, string>,
  /** The head of a task line: `dir` is who started it, from this monster’s side. */
  delegation: (dir: 'out' | 'in', status: string, name: string): string => {
    if (dir === 'out') {
      if (status === 'started') return `task to ${name}`;
      if (status === 'completed') return `finished by ${name}`;
      if (status === 'failed') return `${name} couldn’t do it`;
      return `${name} stopped`;
    }
    if (status === 'started') return `task from ${name}`;
    if (status === 'completed') return `delivered to ${name}`;
    if (status === 'failed') return `failed for ${name}`;
    return `stopped for ${name}`;
  },
  question: 'question',
  decision: 'decision',
  receipt: 'receipt',
  run: {
    started: 'job started',
    completed: 'job finished',
    failed: 'job failed',
    aborted: 'job stopped',
  },
  usage: (model: string, tokens: string, count: number, took: string | null) =>
    `${model} · ${tokens} ${count === 1 ? 'token' : 'tokens'}${took ? ` · ${took}` : ''}`,
  behind: (name: string) => `Behind the scenes of ${name}`,
  behindLabel: 'Behind the scenes',
  show: 'What to show',
  searchLabel: (name: string) => `Search what ${name} did`,
  search: 'search',
  emptyDay: (name: string) => `${name} hasn’t done anything yet today.`,
  emptyFilter: 'Nothing with this filter.',
  log: (name: string) => `What ${name} did`,
};

const it: typeof en = {
  filters: {
    all: 'Tutto',
    thoughts: 'Pensieri',
    tools: 'Strumenti',
    delegations: 'Incarichi',
    errors: 'Errori',
  },
  running: 'in corso…',
  stoppedMidway: 'fermato a metà',
  failed: 'non riuscito',
  done: 'fatto',
  stoppedByStop: 'Fermato con Stop',
  tool: 'strumento:',
  dataSent: 'Dati inviati',
  result: 'Risultato',
  problem: 'Problema',
  technicalError: 'Errore tecnico',
  openFile: (name) => `Apri ${name ? `“${name}”` : 'il file'} nell’anteprima`,
  fileGone: 'file non più disponibile',
  file: 'file',
  noteDone: (action, name) => `Nota ${action}: ${name}`,
  noteTouched: 'toccata',
  vault: {
    create: 'creata',
    edit: 'modificata',
    move: 'spostata',
    delete: 'cestinata',
    restore: 'ripristinata',
    undo: 'riportata indietro',
    propose: 'con una modifica proposta',
  },
  delegation: (dir, status, name) => {
    if (dir === 'out') {
      const verb =
        status === 'started'
          ? 'incarico a'
          : status === 'completed'
            ? 'finito da'
            : status === 'failed'
              ? 'non riuscito a'
              : 'fermato di';
      return `${verb} ${name}`;
    }
    const verb =
      status === 'started'
        ? 'incarico da'
        : status === 'completed'
          ? 'consegnato a'
          : status === 'failed'
            ? 'non riuscito per'
            : 'fermato per';
    return `${verb} ${name}`;
  },
  question: 'domanda',
  decision: 'decisione',
  receipt: 'ricevuta',
  run: {
    started: 'lavoro iniziato',
    completed: 'lavoro finito',
    failed: 'lavoro non riuscito',
    aborted: 'lavoro fermato',
  },
  usage: (model, tokens, _count, took) => `${model} · ${tokens} token${took ? ` · ${took}` : ''}`,
  behind: (name) => `Dietro le quinte di ${name}`,
  behindLabel: 'Dietro le quinte',
  show: 'Cosa mostrare',
  searchLabel: (name) => `Cerca in quello che ha fatto ${name}`,
  search: 'cerca',
  emptyDay: (name) => `${name} non ha ancora fatto niente oggi.`,
  emptyFilter: 'Niente con questo filtro.',
  log: (name) => `Cosa ha fatto ${name}`,
};

export const terminalStrings = defineStrings({ en, it });
