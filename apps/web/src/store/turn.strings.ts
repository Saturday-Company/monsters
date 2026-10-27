import { defineStrings } from '../lib/i18n.ts';

/* The work strip of a turn (store/turn.ts): its closed sentence and its live line, D-153. */

const en = {
  /** "Worked 1 min": how long the turn took, at its start. */
  worked: (time: string) => `Worked ${time}`,
  /** The turn ended without a known start: only that it is done. */
  done: 'Done',
  stopped: (time: string | null) => (time ? `Stopped after ${time}` : 'Stopped'),
  failed: (time: string | null) => (time ? `Couldn’t finish · ${time}` : 'Couldn’t finish'),
  asked: (names: string) => `asked ${names}`,
  searches: (n: number) => (n === 1 ? '1 web search' : `${n} web searches`),
  steps: (n: number) => (n === 1 ? '1 step' : `${n} steps`),
  notes: (n: number) => (n === 1 ? '1 note' : `${n} notes`),
  undone: 'job undone',
  seconds: (n: number) => `${n} s`,
  minutes: (n: number) => `${n} min`,
  hours: (h: number, m: number) => (m > 0 ? `${h} h ${m} min` : `${h} h`),
  /** The live line while delegated monsters work: "Asking Rhea and Dione". */
  asking: (names: string) => `Asking ${names}`,
  thinking: 'Thinking…',
  writing: 'Writing…',
  /** A step done, in the timeline: what it reached outside the computer. */
  searched: (query: string) => `Searched “${query}”`,
  searchedAny: 'Searched the web',
  read: (host: string) => `Read ${host}`,
  readAny: 'Read a web page',
  browsed: (host: string) => `Opened ${host} in the browser`,
  browsedAny: 'Used the browser',
  used: (app: string) => `Used ${app}`,
};

const it: typeof en = {
  worked: (time) => `${time} di lavoro`,
  done: 'Fatto',
  stopped: (time) => (time ? `Fermato dopo ${time}` : 'Fermato'),
  failed: (time) => (time ? `Non finito · ${time}` : 'Non finito'),
  asked: (names) => `chiesto a ${names}`,
  searches: (n) => (n === 1 ? '1 ricerca sul web' : `${n} ricerche sul web`),
  steps: (n) => (n === 1 ? '1 passo' : `${n} passi`),
  notes: (n) => (n === 1 ? '1 nota' : `${n} note`),
  undone: 'lavoro annullato',
  seconds: (n) => `${n} s`,
  minutes: (n) => `${n} min`,
  hours: (h, m) => (m > 0 ? `${h} h ${m} min` : `${h} h`),
  asking: (names) => `Chiede a ${names}`,
  thinking: 'Ci pensa…',
  writing: 'Scrive…',
  searched: (query) => `Cercato “${query}”`,
  searchedAny: 'Cercato sul web',
  read: (host) => `Letto ${host}`,
  readAny: 'Letta una pagina web',
  browsed: (host) => `Aperto ${host} nel browser`,
  browsedAny: 'Usato il browser',
  used: (app) => `Usato ${app}`,
};

export const turnStrings = defineStrings({ en, it });
