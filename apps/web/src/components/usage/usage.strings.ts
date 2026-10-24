import type { ContextPart } from '@monsters/shared';
import { defineStrings } from '../../lib/i18n.ts';

/* Usage ("Consumi") of a monster: the context, the session, the plan windows (D-153). */

const en = {
  parts: {
    base: (provider?: string): string =>
      provider === 'codex'
        ? 'Codex base'
        : provider === 'claude-agent'
          ? 'Claude Code base'
          : 'Program base',
    instructions: 'Instructions',
    memory: 'Memory and profile',
    tools: 'Tools',
    summary: 'Summary',
    conversation: 'Conversation',
    tool_results: 'Tool results',
    current: 'Current message',
  },
  hints: {
    base: 'the program’s prompt and tools, not ours',
    instructions: 'AGENTS.md and the system rules',
    memory: 'your profile and the monster’s memory',
    tools: 'the definitions of the tools it can use',
    summary: 'the older messages, summarized',
    conversation: 'the earlier messages and its steps so far',
    tool_results: 'what the tools returned',
    current: 'this turn’s message, with the task’s instructions',
  } satisfies Record<ContextPart, string>,

  plan: {
    resetsLessThanMinute: 'in under a minute',
    resetsInMinutes: (m: number) => `in ${m} min`,
    resetsInHours: (h: number, m: number) => (m === 0 ? `in ${h} h` : `in ${h} h ${m} min`),
    agoNow: 'just now',
    agoMinutes: (m: number) => `${m} min ago`,
    agoHours: (h: number) => `${h} h ago`,
    agoYesterday: 'yesterday',
    agoDays: (d: number) => `${d} days ago`,
    resetNote: 'reset · updates on next use',
    resetUnknown: 'reset time unknown',
    resetsAt: (when: string) => `resets ${when}`,
    limitReached: 'limit reached',
    almostAtLimit: 'almost at the limit',
    runningLow: 'running low',
    empty: (plan: string) =>
      `No data yet: it appears after a monster’s first job on the ${plan} plan.`,
    meter: (label: string, percent: number, flag: string | null) =>
      `${label}: ${percent}% used${flag ? `, ${flag}` : ''}`,
    updated: (ago: string | null) =>
      `${ago ? `Updated ${ago}. ` : ''}It updates only when a monster works on this plan.`,
  },

  key: {
    window: (amount: string) => `${amount} of the model’s window`,
    changed: 'model changed, I’ll measure it at the next step',
    tokens: (n: string) => `${n} tokens`,
    noStep: 'no steps yet',
    aria: (name: string, said: string) => `Context and usage of ${name}: ${said}`,
    title: 'Context: how much of the model’s working memory this conversation takes up. Open usage',
    label: 'Context',
  },

  panel: {
    free: 'free',
    notReported: 'not reported',
    summaryTitle: 'Summary of the older messages',
    summary: (turns: number, chars: string, at: string, nearLimit: boolean) =>
      `${turns === 1 ? '1 message' : `${turns} messages`} in ${chars} characters, at ${at}${nearLimit ? ' (the context was nearing the threshold)' : ''}.`,
    contextTitle: 'Context',
    noStep: 'No steps in this conversation: the context is measured at the first message.',
    tokensOf: (total: string, window: string | null) =>
      `${total}${window ? ` / ${window}` : ''} tokens`,
    windowUnknown: ' · window unknown',
    compactsHere: (pct: number) => `${pct}% · compacts here`,
    partsLabel: 'The parts of the context',
    measured: (subscription: boolean) =>
      `Total counted by the model${subscription ? ' (with the cache)' : ''}; the parts are estimated from the characters and scaled to that total.`,
    estimated: 'The model didn’t report tokens: estimated from the characters.',
    freeModel: 'free, picked by OpenRouter',
    calls: (n: number) => (n === 1 ? '1 call' : `${n} calls`),
    inOut: (input: string, output: string, cached?: string) =>
      `${input} in${cached ? ` + ${cached} from cache` : ''} · ${output} out`,
    fromCache: (n: string) => `+ ${n} from cache`,
    subscription: 'subscription',
    archived: (day: string) =>
      `Partial count: this conversation’s usage before ${day} is in the log archive and doesn’t count here. The month’s spending is complete.`,
    sessionTitle: 'This conversation',
    sessionEmpty: 'Nothing yet: no work since the last “New conversation”.',
    includedInSubscription: 'included in the subscription',
    tokensIn: 'Tokens in',
    tokensOut: 'Tokens out',
    callsLabel: 'Calls',
    cacheRead: 'Cache read',
    cacheWritten: 'Cache written',
    duration: 'Duration',
    cost: 'Cost',
    perModel: 'By model',
    searches: 'Web searches',
    searchesPaid: (paid: number, cost: string) => ` · ${paid} paid, ${cost}`,
    summaries: 'Summaries',
    decisions: 'Monsters’ decisions',
    questions: (n: number) => (n === 1 ? '1 question' : `${n} questions`),
    spentNoCap: (spent: string, period: string) => `${spent} ${period}, no cap`,
    spentOf: (spent: string, cap: string, pct: number) => `${spent} of ${cap} (${pct}%)`,
    planTitle: (plan: string) => `Plan usage · ${plan}`,
    today: 'Today',
    thisMonth: 'This month',
    todayPeriod: 'today',
    monthPeriod: 'this month',
    spendTitle: 'Today · this month',
    teamLabel: (label: string) => `${label} · the squad`,
    onSubscription: (name: string) =>
      `${name} works on the subscription: it’s included in the plan and doesn’t count toward the spending cap.`,
    agentSpend: (name: string, day: string, month: string) =>
      `${name}: ${day} today · ${month} this month`,
    capsLink: 'Spending cap · Settings → Models',
    loading: 'Reading usage…',
    usageOf: (name: string) => `Usage of ${name}`,
    usage: 'Usage',
    close: 'Close',
    closeTitle: 'Close (Esc)',
  },
};

const it: typeof en = {
  parts: {
    base: (provider) =>
      provider === 'codex'
        ? 'Base di Codex'
        : provider === 'claude-agent'
          ? 'Base di Claude Code'
          : 'Base del programma',
    instructions: 'Istruzioni',
    memory: 'Memoria e profilo',
    tools: 'Strumenti',
    summary: 'Riassunto',
    conversation: 'Conversazione',
    tool_results: 'Risultati degli strumenti',
    current: 'Messaggio di adesso',
  },
  hints: {
    base: 'il prompt e gli strumenti del programma, non nostri',
    instructions: 'AGENTS.md e le regole del sistema',
    memory: 'il tuo profilo e la memoria del mostro',
    tools: 'le definizioni degli strumenti che può usare',
    summary: 'i messaggi più vecchi, riassunti',
    conversation: 'i messaggi di prima e i suoi passi di adesso',
    tool_results: 'quello che gli strumenti hanno restituito',
    current: 'il messaggio di questo turno, con le istruzioni del compito',
  },

  plan: {
    resetsLessThanMinute: 'tra meno di un minuto',
    resetsInMinutes: (m) => `tra ${m} min`,
    resetsInHours: (h, m) => (m === 0 ? `tra ${h} h` : `tra ${h} h ${m}`),
    agoNow: 'adesso',
    agoMinutes: (m) => `${m} min fa`,
    agoHours: (h) => `${h} h fa`,
    agoYesterday: 'ieri',
    agoDays: (d) => `${d} giorni fa`,
    resetNote: 'azzerato · si aggiorna al prossimo uso',
    resetUnknown: 'orario di azzeramento non noto',
    resetsAt: (when) => `si azzera ${when}`,
    limitReached: 'limite raggiunto',
    almostAtLimit: 'quasi al limite',
    runningLow: 'in esaurimento',
    empty: (plan) =>
      `Ancora nessun dato: compare dopo il primo lavoro di un mostro col piano ${plan}.`,
    meter: (label, percent, flag) => `${label}: ${percent}% usato${flag ? `, ${flag}` : ''}`,
    updated: (ago) =>
      `${ago ? `Aggiornato ${ago}. ` : ''}Si aggiorna solo quando un mostro lavora con questo piano.`,
  },

  key: {
    window: (amount) => `${amount} della finestra del modello`,
    changed: 'modello cambiato, lo misuro al prossimo passo',
    tokens: (n) => `${n} token`,
    noStep: 'nessun passo ancora',
    aria: (name, said) => `Contesto e consumi di ${name}: ${said}`,
    title:
      'Contesto: quanto della memoria di lavoro del modello occupa questa conversazione. Apri i consumi',
    label: 'Contesto',
  },

  panel: {
    free: 'gratis',
    notReported: 'non riportato',
    summaryTitle: 'Riassunto dei messaggi più vecchi',
    summary: (turns, chars, at, nearLimit) =>
      `${turns === 1 ? '1 messaggio' : `${turns} messaggi`} in ${chars} lettere, alle ${at}${nearLimit ? ' (il contesto si avvicinava alla soglia)' : ''}.`,
    contextTitle: 'Contesto',
    noStep: 'Nessun passo in questa conversazione: il contesto si misura al primo messaggio.',
    tokensOf: (total, window) => `${total}${window ? ` / ${window}` : ''} token`,
    windowUnknown: ' · finestra non nota',
    compactsHere: (pct) => `${pct}% · qui si compatta`,
    partsLabel: 'Le parti del contesto',
    measured: (subscription) =>
      `Totale contato dal modello${subscription ? ' (con la cache)' : ''}; le parti sono stimate dalle lettere e tarate su quel totale.`,
    estimated: 'Il modello non ha detto i token: stima dalle lettere.',
    freeModel: 'gratuito, scelto da OpenRouter',
    calls: (n) => `${n} ${n === 1 ? 'chiamata' : 'chiamate'}`,
    inOut: (input, output, cached) =>
      `${input} in${cached ? ` + ${cached} dalla cache` : ''} · ${output} out`,
    fromCache: (n) => `+ ${n} dalla cache`,
    subscription: 'abbonamento',
    archived: (day) =>
      `Conto parziale: i consumi di questa conversazione prima del ${day} sono nell’archivio del registro e qui non contano. La spesa del mese resta intera.`,
    sessionTitle: 'Questa conversazione',
    sessionEmpty: 'Ancora niente: nessun lavoro dall’ultima “Nuova conversazione”.',
    includedInSubscription: 'incluso nell’abbonamento',
    tokensIn: 'Token in',
    tokensOut: 'Token out',
    callsLabel: 'Chiamate',
    cacheRead: 'Cache letta',
    cacheWritten: 'Cache scritta',
    duration: 'Durata',
    cost: 'Costo',
    perModel: 'Per modello',
    searches: 'Ricerche web',
    searchesPaid: (paid, cost) => ` · ${paid} a pagamento, ${cost}`,
    summaries: 'Riassunti',
    decisions: 'Decisioni dei mostri',
    questions: (n) => `${n} ${n === 1 ? 'domanda' : 'domande'}`,
    spentNoCap: (spent, period) => `${spent} ${period}, senza tetto`,
    spentOf: (spent, cap, pct) => `${spent} su ${cap} (${pct}%)`,
    planTitle: (plan) => `Utilizzo del piano · ${plan}`,
    today: 'Oggi',
    thisMonth: 'Questo mese',
    todayPeriod: 'oggi',
    monthPeriod: 'questo mese',
    spendTitle: 'Oggi · questo mese',
    teamLabel: (label) => `${label} · la squadra`,
    onSubscription: (name) =>
      `${name} lavora con l’abbonamento: è incluso nel piano e non conta nel tetto di spesa.`,
    agentSpend: (name, day, month) => `${name}: ${day} oggi · ${month} questo mese`,
    capsLink: 'Tetto di spesa · Impostazioni → Modelli',
    loading: 'Leggo i consumi…',
    usageOf: (name) => `Consumi di ${name}`,
    usage: 'Consumi',
    close: 'Chiudi',
    closeTitle: 'Chiudi (Esc)',
  },
};

export const usageStrings = defineStrings({ en, it });
