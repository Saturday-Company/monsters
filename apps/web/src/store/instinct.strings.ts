import { defineStrings } from '../lib/i18n.ts';

/* The instinct and the receipt in the UI's words (store/instinct.ts), D-153. */

type Level = 'simple' | 'medium' | 'hard';
type Kind = 'subtask' | 'request';

const en = {
  source: {
    browserPage: (host: string | null) =>
      host ? `a page opened in the browser (${host})` : 'a page opened in the browser',
    app: (name: string) => `results from ${name}`,
    webSearch: 'the results of a web search',
    webPage: (host: string | null) => (host ? `a web page (${host})` : 'a web page'),
  },
  security: {
    injectionRemoved: (from: string) =>
      `I removed text that gave orders to the monsters from ${from}`,
    invisibleRemoved: (from: string) =>
      `I removed text written in invisible characters from ${from}`,
    flagged: (from: string) =>
      `There were sentences aimed at the monsters in ${from}: I flagged them as plain data`,
  },
  freeModel: 'the free OpenRouter model',
  level: { simple: 'Simple', medium: 'Medium', hard: 'Hard' } as Record<Level, string>,
  receipt: {
    planLimit: (limited: string, served: string) => `${limited} at the plan limit → ${served}`,
    effort: (word: string) => `effort ${word}`,
    free: 'free',
    tasks: (n: number) => `${n} ${n === 1 ? 'task' : 'tasks'}`,
    doubt: (n: number) => `${n} in doubt`,
    notFinished: (n: number) => `${n} not finished`,
    notes: (n: number) => `${n} ${n === 1 ? 'note' : 'notes'}`,
    approved: (who: string, summary: string) => `${who}: ${summary} · you said yes`,
    refused: (who: string, summary: string) => `${who}: ${summary} · you said no`,
    expired: (who: string, summary: string) => `${who}: ${summary} · no answer, not done`,
    marked: (who: string, summary: string) => `${who}: ${summary} · done, to be checked`,
  },
  sentence: {
    aMonster: 'A monster',
    canAnswer: (who: string) => `${who} can answer without help`,
    needsTeam: 'This needs several monsters, one after the other',
    handles: (route: string) => `${route} will handle it`,
    shortcut: (route: string) => `Trial: I would have passed the request straight to ${route}`,
    /** "Rhea: hard request → Opus" (D-093); `level` is the word of the level in lower case. */
    tier: (who: string, kind: Kind, level: string, model: string, effort: string | null) =>
      `${who}: ${level} ${kind === 'subtask' ? 'task' : 'request'} → ${model}${
        effort ? ` · ${effort}` : ''
      }`,
    tierSimple: (who: string, kind: Kind) =>
      `${kind === 'subtask' ? 'Simple task' : 'Simple request'}: ${who} uses the quick model`,
    tierHard: (who: string, kind: Kind) =>
      `${kind === 'subtask' ? 'Hard task' : 'Hard request'}: ${who} uses the thorough model`,
    noWeb: (who: string) => `For this request ${who} works without the web`,
    retry: (who: string) => `${who} hadn’t finished the job: I asked for it to be completed`,
    doubtWhy: (who: string, why: string) => `${who}’s work is in doubt: ${why}`,
    doubt: (who: string) => `${who}’s work is in doubt: check it before using it`,
    stuckNotice: (who: string) => `${who} seems to be going in circles: I’m keeping an eye on it`,
    stuckNudge: (who: string) => `${who} was going in circles: I asked for a change of approach`,
    stuckDemote: (who: string) => `${who} was still going in circles: I’m trying the next model`,
    finalQuestion: (who: string) =>
      `${who} asked you something in the text: I’m sending it to you as a question`,
    outsideDefault: 'do something outside the computer',
    outboundHold: (who: string, what: string) => `${who} wants to ${what}: waiting for your answer`,
    outboundApproved: (who: string, what: string) => `You said yes: ${who} can ${what}`,
    outboundExpired: (who: string, what: string, unseen: string | undefined) =>
      `No answer${unseen ? ` (${unseen})` : ''}: ${who} didn’t ${what}`,
    outboundRefused: (who: string, what: string) => `You said no: ${who} won’t ${what}`,
    outboundMarked: (who: string, what: string, why: string | undefined) =>
      `${who} was able to ${what}${why ? ` (${why})` : ''}`,
    accessClaim: (who: string) =>
      `${who} said an access was missing or denied, and it wasn’t: I had it corrected`,
    accessClaimNote: (who: string, truth: string | undefined) =>
      `${who} wrote that an access was missing or denied, and that’s not true${
        truth ? `: ${truth}` : ''
      }`,
    chainReordered: (who: string, first: string) =>
      `Now ${who} tries ${first} first: it finishes more jobs and costs less`,
    reordered: (who: string, first: string) =>
      `Now ${who} tries ${first} first: it finishes more jobs and costs less.`,
  },
  verdict: {
    verified: 'really finished',
    doubt: 'in doubt',
    incomplete: 'incomplete',
    failed: 'failed',
    unchecked: 'unchecked',
  },
  noteAction: {
    create: 'created',
    edit: 'edited',
    move: 'moved',
    delete: 'in the trash',
    restore: 'restored',
    undo: 'rolled back',
  } as Record<string, string>,
  settings: {
    notesOnly: 'Notes only',
    needsKey: 'Needs the TypeSafe key',
    needsEither: 'Needs the expert model or the small model',
    needsExpert: 'Needs the expert model',
    needsModel: 'Needs a model',
  },
};

const it: typeof en = {
  source: {
    browserPage: (host) =>
      host ? `una pagina aperta nel browser (${host})` : 'una pagina aperta nel browser',
    app: (name) => `i risultati di ${name}`,
    webSearch: 'i risultati di una ricerca sul web',
    webPage: (host) => (host ? `una pagina web (${host})` : 'una pagina web'),
  },
  security: {
    injectionRemoved: (from) => `Ho tolto da ${from} un testo che dava ordini ai mostri`,
    invisibleRemoved: (from) => `Ho tolto da ${from} un testo scritto in caratteri invisibili`,
    flagged: (from) =>
      `In ${from} c’erano frasi rivolte ai mostri: le ho segnalate come semplici dati`,
  },
  freeModel: 'il modello gratuito di OpenRouter',
  level: { simple: 'Semplice', medium: 'Media', hard: 'Difficile' },
  receipt: {
    planLimit: (limited, served) => `${limited} al limite del piano → ${served}`,
    effort: (word) => `impegno ${word}`,
    free: 'gratis',
    tasks: (n) => `${n} ${n === 1 ? 'incarico' : 'incarichi'}`,
    doubt: (n) => `${n} in dubbio`,
    notFinished: (n) => `${n} non ${n === 1 ? 'finito' : 'finiti'}`,
    notes: (n) => `${n} ${n === 1 ? 'nota' : 'note'}`,
    approved: (who, summary) => `${who}: ${summary} · hai detto sì`,
    refused: (who, summary) => `${who}: ${summary} · hai detto no`,
    expired: (who, summary) => `${who}: ${summary} · nessuna risposta, non fatto`,
    marked: (who, summary) => `${who}: ${summary} · fatto, da controllare`,
  },
  sentence: {
    aMonster: 'Un mostro',
    canAnswer: (who) => `${who} può rispondere da solo`,
    needsTeam: 'Serve il lavoro di più mostri, uno dopo l’altro',
    handles: (route) => `Ci pensa ${route}`,
    shortcut: (route) => `In prova: avrei passato la richiesta direttamente a ${route}`,
    tier: (who, kind, level, model, effort) =>
      `${who}: ${kind === 'subtask' ? 'incarico' : 'richiesta'} ${level} → ${model}${
        effort ? ` · ${effort}` : ''
      }`,
    tierSimple: (who, kind) =>
      `${kind === 'subtask' ? 'Incarico' : 'Richiesta'} semplice: ${who} usa il modello veloce`,
    tierHard: (who, kind) =>
      `${kind === 'subtask' ? 'Incarico' : 'Richiesta'} difficile: ${who} usa il modello accurato`,
    noWeb: (who) => `Per questa richiesta ${who} lavora senza il web`,
    retry: (who) => `${who} non aveva finito il lavoro: ho chiesto di completarlo`,
    doubtWhy: (who, why) => `Il lavoro di ${who} è in dubbio: ${why}`,
    doubt: (who) => `Il lavoro di ${who} è in dubbio: controllalo prima di usarlo`,
    stuckNotice: (who) => `${who} sembra girare a vuoto: lo tengo d’occhio`,
    stuckNudge: (who) => `${who} girava a vuoto: ho chiesto di cambiare strada`,
    stuckDemote: (who) => `${who} girava ancora a vuoto: provo con il modello successivo`,
    finalQuestion: (who) => `${who} ti ha chiesto una cosa nel testo: te la mando come domanda`,
    outsideDefault: 'un’azione fuori dal computer',
    outboundHold: (who, what) => `${who} vuole ${what}: aspetta la tua risposta`,
    outboundApproved: (who, what) => `Hai detto sì: ${who} può ${what}`,
    outboundExpired: (who, what, unseen) =>
      `Nessuna risposta${unseen ? ` (${unseen})` : ''}: ${who} non ha fatto ${what}`,
    outboundRefused: (who, what) => `Hai detto no: ${who} non farà ${what}`,
    outboundMarked: (who, what, why) => `${who} ha potuto ${what}${why ? ` (${why})` : ''}`,
    accessClaim: (who) =>
      `${who} diceva che un accesso mancava o era negato, e non era così: l’ho fatto correggere`,
    accessClaimNote: (who, truth) =>
      `${who} ha scritto che un accesso mancava o era negato, e non è così${
        truth ? `: ${truth}` : ''
      }`,
    chainReordered: (who, first) =>
      `Ora ${who} usa prima ${first}: finisce più lavori e costa meno`,
    reordered: (who, first) => `Ora ${who} usa prima ${first}: finisce più lavori e costa meno.`,
  },
  verdict: {
    verified: 'finito davvero',
    doubt: 'in dubbio',
    incomplete: 'incompleto',
    failed: 'non riuscito',
    unchecked: 'non controllato',
  },
  noteAction: {
    create: 'creata',
    edit: 'modificata',
    move: 'spostata',
    delete: 'nel cestino',
    restore: 'ripristinata',
    undo: 'riportata indietro',
  },
  settings: {
    notesOnly: 'Solo annota',
    needsKey: 'Serve la chiave di TypeSafe',
    needsEither: 'Serve il modello esperto o il modello piccolo',
    needsExpert: 'Serve il modello esperto',
    needsModel: 'Serve un modello',
  },
};

export const instinctStrings = defineStrings({ en, it });
