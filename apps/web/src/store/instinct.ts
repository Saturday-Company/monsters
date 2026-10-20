import type {
  DelegationVerdict,
  Effort,
  EventDataMap,
  InstinctUseView,
  InstinctView,
  ReceiptData,
  ScorecardRow,
  ScorecardView,
} from '@monsters/shared';
import { EFFORT_WORD, EffortSchema, INSTINCT_USE_INFO, STUCK_ACTIONS } from '@monsters/shared';
import { clipText, plainText } from '../lib/markdown.ts';
import { formatUsd, modelWords } from '../lib/utils.ts';

/*
 * The instinct in the UI's words (D-067, D-068): what the team decided on the
 * fly as plain Italian sentences, the receipt of a job and the pagella of the
 * monsters. Pure functions, tested without a browser. The core writes its own
 * `message` too; the UI says it again from the structured fields, in neutral
 * forms (no gender for the monsters) and without tool names or codes.
 */

type NameOf = (id: string) => string;

const str = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** The host of a URL without "www.", or null. */
function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

/** Where an external text came from, in words: "una pagina web (visitlisboa.com)". */
export function sourceText(source: string, tool: string): string {
  const url = /https?:\/\/\S+/.exec(source)?.[0];
  const host = url ? hostOf(url) : null;
  if (tool.startsWith('mcp__browser__') || /^mcp:browser\b/.test(source))
    return host ? `una pagina aperta nel browser (${host})` : 'una pagina aperta nel browser';
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(tool)?.[1] ?? /^mcp:(\S+)/.exec(source)?.[1];
  if (mcp) return `i risultati di ${mcp.replace(/[_-]+/g, ' ')}`;
  if (tool === 'web_search') return 'i risultati di una ricerca sul web';
  return host ? `una pagina web (${host})` : 'una pagina web';
}

/** A text that gave orders to the monsters (injection use), in words. */
export function securitySentence(d: EventDataMap['security']): string {
  const from = sourceText(d.source, d.tool);
  switch (d.action) {
    case 'injection_removed':
      return `Ho tolto da ${from} un testo che dava ordini ai mostri`;
    case 'invisible_removed':
      return `Ho tolto da ${from} un testo scritto in caratteri invisibili`;
    // Tools of another program changed (D-070): the core's sentence names it as the user does.
    case 'mcp_tools_changed':
    case 'mcp_tools_accepted':
      return d.message.replace(/\.$/, '');
    default:
      return `In ${from} c’erano frasi rivolte ai mostri: le ho segnalate come semplici dati`;
  }
}

/** "openrouter:meta-llama/llama-3.3-70b-instruct:free" → "llama 3.3 70b". */
export function chainModelName(ref: string): string {
  const model = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
  if (model === 'openrouter/free') return 'il modello gratuito di OpenRouter';
  const name = (model.split('/').pop() ?? model).replace(/:free$/, '');
  return modelWords(name);
}

/** The level of a request in words (D-093): "Semplice", "Media", "Difficile". */
export const LEVEL_WORD: Record<'simple' | 'medium' | 'hard', string> = {
  simple: 'Semplice',
  medium: 'Media',
  hard: 'Difficile',
};

/**
 * A model as the receipt says it: the Claude plan by its family ("Opus", also
 * for `claude-agent:claude-opus-5-5`), the others as the chain says them.
 */
export function modelShort(ref: string): string {
  const [provider] = ref.split(':');
  const family = /(?:^|[^a-z])(haiku|sonnet|opus)(?:[^a-z]|$)/i.exec(ref)?.[1];
  if (provider === 'claude-agent' && family) {
    return family.charAt(0).toUpperCase() + family.slice(1).toLowerCase();
  }
  return chainModelName(ref);
}

/** "Difficile → Opus", "Opus al limite del piano → Sonnet", "Sonnet": the model of a monster and why. */
export function receiptModelLine(m: NonNullable<ReceiptData['models']>[number]): string {
  const served = modelShort(m.model);
  const chosen = m.limited ? `${modelShort(m.limited)} al limite del piano → ${served}` : served;
  const line = m.level ? `${LEVEL_WORD[m.level]} → ${chosen}` : chosen;
  return m.effort ? `${line} · ${effortWords(m.effort)}` : line;
}

/** "impegno Alto" (D-110): how hard Claude Code works, only in "Automatica". */
export function effortWords(effort: Effort): string {
  return `impegno ${EFFORT_WORD[effort]}`;
}

/** "Difficile → Opus": the level of one delegation and the model it chose (D-109), or null. */
export function delegationModelLine(d: ReceiptData['delegations'][number]): string | null {
  if (!d.level || !d.model) return null;
  const line = `${LEVEL_WORD[d.level]} → ${modelShort(d.model)}`;
  return d.effort ? `${line} · ${effortWords(d.effort)}` : line;
}

/** The receipt names the models when there is a reason to tell (a level, a limit) or with the details on. */
export function receiptModels(
  r: ReceiptData,
  details: boolean,
): NonNullable<ReceiptData['models']> {
  const all = r.models ?? [];
  return details ? all : all.filter((m) => m.level !== undefined || m.limited !== undefined);
}

/** What an action that leaves the computer is about, from the details of the brake. */
function outboundWhat(d: EventDataMap['instinct']): string {
  return str(d.details?.['summary']) ?? 'un’azione fuori dal computer';
}

/**
 * One plain-Italian sentence for an `instinct` event: "Ci pensa Rhea",
 * "Dione non aveva finito il lavoro: ho chiesto di completarlo".
 */
export function instinctSentence(d: EventDataMap['instinct'], nameOf: NameOf): string {
  const who = d.subject ? nameOf(d.subject) : 'Un mostro';
  const det = d.details ?? {};
  switch (d.action) {
    case 'route_hint': {
      const route = str(det['route']);
      if (!route) return d.message;
      if (route === 'capo') return `${who} può rispondere da solo`;
      if (route === 'squadra') return 'Serve il lavoro di più mostri, uno dopo l’altro';
      return `Ci pensa ${route}`;
    }
    case 'shortcut': {
      const route = str(det['route']);
      return route
        ? `In prova: avrei passato la richiesta direttamente a ${route}`
        : clipText(plainText(d.message), 160);
    }
    case 'tier': {
      const level = str(det['level']);
      const model = str(det['model']);
      // A delegation with the level of its own subtask (D-109): "incarico", not "richiesta".
      const what = det['from'] === 'subtask' ? 'incarico' : 'richiesta';
      // "Rhea: richiesta difficile → Opus" (D-093).
      if (model && (level === 'simple' || level === 'medium' || level === 'hard')) {
        const effort = EffortSchema.safeParse(det['effort']);
        return `${who}: ${what} ${LEVEL_WORD[level].toLowerCase()} → ${modelShort(model)}${
          effort.success ? ` · ${effortWords(effort.data)}` : ''
        }`;
      }
      const What = what.charAt(0).toUpperCase() + what.slice(1);
      if (level === 'simple') return `${What} semplice: ${who} usa il modello leggero`;
      if (level === 'hard') return `${What} difficile: ${who} usa il modello più forte`;
      return clipText(plainText(d.message), 160);
    }
    case 'tools':
      return `Per questa richiesta ${who} lavora senza il web`;
    case 'retry':
      return `${who} non aveva finito il lavoro: ho chiesto di completarlo`;
    case 'doubt': {
      const why = /in dubbio:\s*(.+)$/i.exec(d.message)?.[1]?.trim();
      return why
        ? `Il lavoro di ${who} è in dubbio: ${clipText(plainText(why), 140)}`
        : `Il lavoro di ${who} è in dubbio: controllalo prima di usarlo`;
    }
    case 'stuck_notice':
      return `${who} sembra girare a vuoto: lo tengo d’occhio`;
    case 'stuck_nudge':
      return `${who} girava a vuoto: ho chiesto di cambiare strada`;
    case 'stuck_demote':
      return `${who} girava ancora a vuoto: provo con il modello successivo`;
    case 'final_question':
      return `${who} ti ha chiesto una cosa nel testo: te la mando come domanda`;
    case 'outbound_hold':
      return `${who} vuole ${outboundWhat(d)}: aspetta la tua risposta`;
    case 'outbound_approved':
      return `Hai detto sì: ${who} può ${outboundWhat(d)}`;
    case 'outbound_refused':
      return det['outcome'] === 'expired'
        ? `Nessuna risposta${str(det['unseen']) ? ` (${str(det['unseen'])})` : ''}: ${who} non ha fatto ${outboundWhat(d)}`
        : `Hai detto no: ${who} non farà ${outboundWhat(d)}`;
    case 'outbound_marked': {
      const why = str(det['why']);
      return `${who} ha potuto ${outboundWhat(d)}${why ? ` (${why})` : ''}`;
    }
    case 'memory_skipped':
      return clipText(plainText(d.message), 160);
    case 'access_claim': {
      if (det['mode'] !== 'note')
        return `${who} diceva che un accesso mancava o era negato, e non era così: l’ho fatto correggere`;
      // Codex cannot be sent back (D-140): the line says what is true.
      const truth = Array.isArray(det['truth']) ? str(det['truth'][0]) : undefined;
      return `${who} ha scritto che un accesso mancava o era negato, e non è così${truth ? `: ${clipText(plainText(truth), 140)}` : ''}`;
    }
    case 'chain_reordered': {
      const chain = Array.isArray(det['chain']) ? (det['chain'] as unknown[]) : [];
      const first = typeof chain[0] === 'string' ? chainModelName(chain[0]) : null;
      return first
        ? `Ora ${who} usa prima ${first}: finisce più lavori e costa meno`
        : clipText(plainText(d.message), 160);
    }
  }
}

/** Instinct events that are worth a line in the chat; the rest stays in Attività. */
const IN_CHAT = new Set<EventDataMap['instinct']['action']>([
  'route_hint',
  'retry',
  'doubt',
  'stuck_nudge',
  'stuck_demote',
  'outbound_marked',
  'outbound_refused',
  'access_claim',
]);

export function instinctInChat(d: EventDataMap['instinct']): boolean {
  if (!IN_CHAT.has(d.action)) return false;
  // A route hint towards the lead itself says nothing the chat does not show.
  return !(d.action === 'route_hint' && d.details?.['route'] === 'capo');
}

/** The tone of an instinct line: `warn` for doubts and refusals, `stop` for removed orders. */
export function instinctTone(d: EventDataMap['instinct']): 'warn' | 'stop' | null {
  if (
    d.action === 'doubt' ||
    d.action === 'outbound_marked' ||
    d.action === 'stuck_demote' ||
    d.action === 'access_claim'
  )
    return 'warn';
  if (d.action === 'outbound_refused') return 'stop';
  return null;
}

/** The stuck actions that show the confused monster (`stuck_notice` only shows it); the core reads them too. */
export { STUCK_ACTIONS };

/** Instinct events of the brake on the actions that leave the computer: always "Importanti". */
export function isBrakeEvent(d: EventDataMap['instinct']): boolean {
  return d.use === 'outbound' && d.action !== 'outbound_hold';
}

/* ------------------------------------------------------------------ receipt */

/** A delegation's outcome on the receipt: the mark and the words (D-068). */
export const VERDICT: Record<DelegationVerdict, { mark: string; word: string; tone: Tone }> = {
  verified: { mark: '✓', word: 'finito davvero', tone: 'ok' },
  doubt: { mark: '?', word: 'in dubbio', tone: 'warn' },
  incomplete: { mark: '✗', word: 'incompleto', tone: 'stop' },
  failed: { mark: '✗', word: 'non riuscito', tone: 'stop' },
  unchecked: { mark: '·', word: 'non controllato', tone: 'muted' },
};

export type Tone = 'ok' | 'warn' | 'stop' | 'muted';

/** Files the monsters keep for themselves (memory, state): not the user's notes. */
const AGENT_FILE = /^Agenti\/[^/]+\//;

/** What happened to a note on the receipt ("creata", "modificata"). */
export const NOTE_ACTION: Record<string, string> = {
  create: 'creata',
  edit: 'modificata',
  move: 'spostata',
  delete: 'nel cestino',
  restore: 'ripristinata',
  undo: 'riportata indietro',
};

export interface ReceiptNote {
  path: string;
  /** The latest thing done to it in the turn. */
  action: string;
}

/** The user's notes the turn touched, one per path (the latest action), oldest first. */
export function receiptNotes(r: ReceiptData): ReceiptNote[] {
  const out = new Map<string, ReceiptNote>();
  for (const n of r.notes) {
    if (AGENT_FILE.test(n.path)) continue;
    const prev = out.get(n.path);
    // A note created and then edited in the same turn is still a new note.
    out.set(n.path, { path: n.path, action: prev?.action === 'create' ? 'create' : n.action });
  }
  return [...out.values()];
}

/** Owners of the memories the turn updated ("Agenti/Rhea/MEMORY.md" → "Rhea"). */
export function receiptMemories(r: ReceiptData): string[] {
  const out: string[] = [];
  for (const n of r.notes) {
    const m = /^Agenti\/([^/]+)\//.exec(n.path);
    if (m && !out.includes(m[1]!)) out.push(m[1]!);
  }
  return out;
}

/** The cost of a turn as the instrument says it. */
export function receiptCost(r: ReceiptData): string {
  return r.usage.costUsd > 0 ? formatUsd(r.usage.costUsd) : 'gratis';
}

/** A receipt worth a block in the chat: a request of the user, and something to account for. */
export function receiptInChat(r: ReceiptData): boolean {
  if (!r.request.trim()) return false;
  return (
    r.delegations.length > 0 ||
    receiptNotes(r).length > 0 ||
    r.outbound.length > 0 ||
    r.alerts.stuck > 0 ||
    r.alerts.injections > 0
  );
}

/** "2 incarichi · 1 nota · gratis": the folded line of a receipt. */
export function receiptSummary(r: ReceiptData): string {
  const parts: string[] = [];
  const d = r.delegations.length;
  if (d > 0) {
    const ok = r.delegations.filter((x) => x.verdict === 'verified').length;
    const doubt = r.delegations.filter((x) => x.verdict === 'doubt').length;
    const bad = r.delegations.filter(
      (x) => x.verdict === 'incomplete' || x.verdict === 'failed',
    ).length;
    parts.push(`${d} ${d === 1 ? 'incarico' : 'incarichi'}${ok === d ? ' ✓' : ''}`);
    if (doubt > 0) parts.push(`${doubt} in dubbio`);
    if (bad > 0) parts.push(`${bad} non ${bad === 1 ? 'finito' : 'finiti'}`);
  }
  const n = receiptNotes(r).length;
  if (n > 0) parts.push(`${n} ${n === 1 ? 'nota' : 'note'}`);
  parts.push(receiptCost(r));
  return parts.join(' · ');
}

/** The note actions of a receipt still to undo (what "Annulla tutto il lavoro" undoes). */
export function receiptActions(r: ReceiptData): string[] {
  const out: string[] = [];
  for (const n of r.notes)
    if (n.actionId && n.action !== 'undo' && !out.includes(n.actionId)) out.push(n.actionId);
  return out;
}

/** "Rhea ha voluto pubblicare il post (hai detto sì)": an action the brake looked at. */
export function outboundLine(o: ReceiptData['outbound'][number], nameOf: NameOf): string {
  const who = nameOf(o.agent);
  switch (o.outcome) {
    case 'approved':
      return `${who}: ${o.summary} · hai detto sì`;
    case 'refused':
      return `${who}: ${o.summary} · hai detto no`;
    case 'expired':
      return `${who}: ${o.summary} · nessuna risposta, non fatto`;
    default:
      return `${who}: ${o.summary} · fatto, da controllare`;
  }
}

/* --------------------------------------------------------- settings: uses */

/** The words of the modes of a use, never "shadow" (D-068). */
export function modeWord(use: InstinctUseView): string | null {
  if (use.mode === 'shadow') return 'Solo annota';
  return null;
}

/**
 * Why a use that is on does nothing with the engine chosen: "Serve Jev",
 * "Serve Jev o il modello piccolo", "Serve la chiave di TypeSafe". Null when
 * it works (or is off).
 */
export function needsOf(
  use: InstinctUseView,
  view: Pick<InstinctView, 'engine' | 'jev'>,
): string | null {
  if (use.mode === 'off' || use.active) return null;
  const engines = use.engines;
  if (view.engine === 'jev' && engines.includes('jev') && !view.jev.keySet)
    return 'Serve la chiave di TypeSafe';
  if (engines.includes(view.engine)) return null;
  if (engines.includes('llm') && engines.includes('jev'))
    return 'Serve il modello esperto o il modello piccolo';
  if (engines.includes('jev')) return 'Serve il modello esperto';
  return 'Serve un modello';
}

/** The use is a trial ("in prova"): it can only take notes, it never acts. */
export function isTrial(use: InstinctUseView): boolean {
  return !use.modes.includes('on');
}

/** The mode a switch turns on: `on`, or `shadow` for a use in trial. */
export function onMode(use: InstinctUseView): 'on' | 'shadow' {
  return use.modes.includes('on') ? 'on' : 'shadow';
}

/** "Scorciatoia verso il mostro giusto (in prova)" → the label without the trial note. */
export function titleOfUse(use: InstinctUseView): string {
  return use.label.replace(/\s*\(in prova\)\s*$/i, '');
}

/** The label of a use for Attività ("Controlla che i lavori siano finiti davvero"). */
export function labelOfUse(use: string): string | null {
  const info = (INSTINCT_USE_INFO as Record<string, { label: string } | undefined>)[use];
  return info ? info.label.replace(/\s*\(in prova\)\s*$/i, '') : null;
}

/* -------------------------------------------------------------- pagella */

/** One line of the pagella: who, which model, how it went. */
export interface ScoreLine {
  key: string;
  agent: string;
  agentName: string;
  model: string;
  delegations: number;
  checked: number;
  verified: number;
  /** verified / checked, 0-1, or null with nothing checked. */
  rate: number | null;
  /** "gratis", "0,002 $", or null with nothing verified. */
  costPerJob: string | null;
  avgSteps: number | null;
  /** Checked jobs still missing before the scorecard can move this model. */
  missing: number;
}

export function scoreLines(view: ScorecardView): ScoreLine[] {
  return view.rows.map((r: ScorecardRow) => ({
    key: `${r.agent}|${r.model}|${r.tier}`,
    agent: r.agent,
    agentName: r.agentName,
    model: chainModelName(r.model),
    delegations: r.delegations,
    checked: r.checked,
    verified: r.verified,
    rate: r.successRate,
    costPerJob:
      r.costPerVerifiedUsd === null
        ? null
        : r.costPerVerifiedUsd === 0
          ? 'gratis'
          : formatUsd(r.costPerVerifiedUsd),
    avgSteps: r.avgSteps,
    missing: Math.max(0, view.minDelegations - r.checked),
  }));
}

/** "Ora Rhea usa prima llama 3.3 70b: finisce più lavori e costa meno." per reordered chain. */
export function reorderedLines(view: ScorecardView, nameOf: NameOf): string[] {
  return Object.entries(view.reordered).flatMap(([agent, chain]) =>
    chain[0]
      ? [
          `Ora ${nameOf(agent)} usa prima ${chainModelName(chain[0])}: finisce più lavori e costa meno.`,
        ]
      : [],
  );
}
