import {
  agentOfPath,
  vaultLayout,
  type DelegationVerdict,
  type Effort,
  type EventDataMap,
  type InstinctUseView,
  type InstinctView,
  type ReceiptData,
  type ScorecardRow,
  type ScorecardView,
} from '@monsters/shared';
import { EFFORT_WORD, EffortSchema, INSTINCT_USE_INFO, STUCK_ACTIONS } from '@monsters/shared';
import { clipText, plainText } from '../lib/markdown.ts';
import { formatUsd, modelWords } from '../lib/utils.ts';
import { instinctStrings } from './instinct.strings.ts';
import { localizedRecord } from './localized.ts';

/*
 * The instinct in the UI's words (D-067, D-068): what the team decided on the
 * fly as plain sentences, the receipt of a job and the pagella of the
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

/** Where an external text came from, in words: "a web page (visitlisboa.com)". */
export function sourceText(source: string, tool: string): string {
  const s = instinctStrings().source;
  const url = /https?:\/\/\S+/.exec(source)?.[0];
  const host = url ? hostOf(url) : null;
  if (tool.startsWith('mcp__browser__') || /^mcp:browser\b/.test(source))
    return s.browserPage(host);
  const mcp = /^mcp__([^_]+(?:_[^_]+)*?)__/.exec(tool)?.[1] ?? /^mcp:(\S+)/.exec(source)?.[1];
  if (mcp) return s.app(mcp.replace(/[_-]+/g, ' '));
  if (tool === 'web_search') return s.webSearch;
  return s.webPage(host);
}

/** A text that gave orders to the monsters (injection use), in words. */
export function securitySentence(d: EventDataMap['security']): string {
  const s = instinctStrings().security;
  const from = sourceText(d.source, d.tool);
  switch (d.action) {
    case 'injection_removed':
      return s.injectionRemoved(from);
    case 'invisible_removed':
      return s.invisibleRemoved(from);
    // Tools of another program changed (D-070), a call the core refused (D-078, D-079, D-166): the
    // core's sentence names it as the user does.
    case 'mcp_tools_changed':
    case 'mcp_tools_accepted':
    case 'internal_denied':
      return d.message.replace(/\.$/, '');
    default:
      return s.flagged(from);
  }
}

/** "openrouter:meta-llama/llama-3.3-70b-instruct:free" → "llama 3.3 70b". */
export function chainModelName(ref: string): string {
  const model = ref.includes(':') ? ref.slice(ref.indexOf(':') + 1) : ref;
  if (model === 'openrouter/free') return instinctStrings().freeModel;
  const name = (model.split('/').pop() ?? model).replace(/:free$/, '');
  return modelWords(name);
}

/** The level of a request in words (D-093): "Simple", "Medium", "Hard". */
export const LEVEL_WORD: Record<'simple' | 'medium' | 'hard', string> = localizedRecord(
  () => instinctStrings().level,
);

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

/** "Hard → Opus", "Opus at the plan limit → Sonnet", "Sonnet": the model of a monster and why. */
export function receiptModelLine(m: NonNullable<ReceiptData['models']>[number]): string {
  const served = modelShort(m.model);
  const chosen = m.limited
    ? instinctStrings().receipt.planLimit(modelShort(m.limited), served)
    : served;
  const line = m.level ? `${LEVEL_WORD[m.level]} → ${chosen}` : chosen;
  return m.effort ? `${line} · ${effortWords(m.effort)}` : line;
}

/** "effort High" (D-110): how hard Claude Code works, only in "Automatic". */
export function effortWords(effort: Effort): string {
  return instinctStrings().receipt.effort(EFFORT_WORD[effort]);
}

/** "Hard → Opus": the level of one delegation and the model it chose (D-109), or null. */
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
  return str(d.details?.['summary']) ?? instinctStrings().sentence.outsideDefault;
}

/**
 * One plain sentence for an `instinct` event: "Rhea will handle it",
 * "Dione hadn’t finished the job: I asked for it to be completed".
 */
export function instinctSentence(d: EventDataMap['instinct'], nameOf: NameOf): string {
  const s = instinctStrings().sentence;
  const who = d.subject ? nameOf(d.subject) : s.aMonster;
  const det = d.details ?? {};
  switch (d.action) {
    case 'route_hint': {
      const route = str(det['route']);
      if (!route) return d.message;
      if (route === 'capo') return s.canAnswer(who);
      if (route === 'squadra') return s.needsTeam;
      return s.handles(route);
    }
    case 'shortcut': {
      const route = str(det['route']);
      return route ? s.shortcut(route) : clipText(plainText(d.message), 160);
    }
    case 'tier': {
      const level = str(det['level']);
      const model = str(det['model']);
      // A delegation with the level of its own subtask (D-109): a task, not a request.
      const kind = det['from'] === 'subtask' ? 'subtask' : 'request';
      // "Rhea: hard request → Opus" (D-093).
      if (model && (level === 'simple' || level === 'medium' || level === 'hard')) {
        const effort = EffortSchema.safeParse(det['effort']);
        return s.tier(
          who,
          kind,
          LEVEL_WORD[level].toLowerCase(),
          modelShort(model),
          effort.success ? effortWords(effort.data) : null,
        );
      }
      if (level === 'simple') return s.tierSimple(who, kind);
      if (level === 'hard') return s.tierHard(who, kind);
      return clipText(plainText(d.message), 160);
    }
    case 'tools':
      return s.noWeb(who);
    case 'retry':
      return s.retry(who);
    case 'doubt': {
      // i18n-ignore: "in dubbio:" / "in doubt:", the core's own words
      const why = /(?:in dubbio|in doubt):\s*(.+)$/i.exec(d.message)?.[1]?.trim();
      return why ? s.doubtWhy(who, clipText(plainText(why), 140)) : s.doubt(who);
    }
    case 'stuck_notice':
      return s.stuckNotice(who);
    case 'stuck_nudge':
      return s.stuckNudge(who);
    case 'stuck_demote':
      return s.stuckDemote(who);
    case 'final_question':
      return s.finalQuestion(who);
    case 'outbound_hold':
      return s.outboundHold(who, outboundWhat(d));
    case 'outbound_approved':
      return s.outboundApproved(who, outboundWhat(d));
    case 'outbound_refused':
      return det['outcome'] === 'expired'
        ? s.outboundExpired(who, outboundWhat(d), str(det['unseen']))
        : s.outboundRefused(who, outboundWhat(d));
    case 'outbound_marked':
      return s.outboundMarked(who, outboundWhat(d), str(det['why']));
    case 'memory_skipped':
      return clipText(plainText(d.message), 160);
    case 'access_claim': {
      if (det['mode'] !== 'note') return s.accessClaim(who);
      // Codex cannot be sent back (D-140): the line says what is true.
      const truth = Array.isArray(det['truth']) ? str(det['truth'][0]) : undefined;
      return s.accessClaimNote(who, truth ? clipText(plainText(truth), 140) : undefined);
    }
    case 'chain_reordered': {
      const chain = Array.isArray(det['chain']) ? (det['chain'] as unknown[]) : [];
      const first = typeof chain[0] === 'string' ? chainModelName(chain[0]) : null;
      return first ? s.chainReordered(who, first) : clipText(plainText(d.message), 160);
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
export const VERDICT: Record<DelegationVerdict, { mark: string; word: string; tone: Tone }> =
  localizedRecord(() => {
    const w = instinctStrings().verdict;
    return {
      verified: { mark: '✓', word: w.verified, tone: 'ok' as const },
      doubt: { mark: '?', word: w.doubt, tone: 'warn' as const },
      incomplete: { mark: '✗', word: w.incomplete, tone: 'stop' as const },
      failed: { mark: '✗', word: w.failed, tone: 'stop' as const },
      unchecked: { mark: '·', word: w.unchecked, tone: 'muted' as const },
    };
  });

export type Tone = 'ok' | 'warn' | 'stop' | 'muted';

/** What happened to a note on the receipt ("created", "edited"). */
export const NOTE_ACTION: Record<string, string> = localizedRecord(
  () => instinctStrings().noteAction,
);

export interface ReceiptNote {
  path: string;
  /** The latest thing done to it in the turn. */
  action: string;
}

/** The user's notes the turn touched, one per path (the latest action), oldest first. */
export function receiptNotes(r: ReceiptData): ReceiptNote[] {
  const out = new Map<string, ReceiptNote>();
  for (const n of r.notes) {
    if (agentOfPath(n.path, vaultLayout()) !== null) continue;
    const prev = out.get(n.path);
    // A note created and then edited in the same turn is still a new note.
    out.set(n.path, { path: n.path, action: prev?.action === 'create' ? 'create' : n.action });
  }
  return [...out.values()];
}

/** Owners of the memories the turn updated ("Agenti/Rhea/MEMORY.md" → "Rhea", in the vault's layout). */
export function receiptMemories(r: ReceiptData): string[] {
  const out: string[] = [];
  for (const n of r.notes) {
    // A file of the monster's own folder (memory, state), not the folder itself.
    const owner = n.path.split('/').length > 2 ? agentOfPath(n.path, vaultLayout()) : null;
    if (owner && !out.includes(owner)) out.push(owner);
  }
  return out;
}

/** The cost of a turn as the instrument says it. */
export function receiptCost(r: ReceiptData): string {
  return r.usage.costUsd > 0 ? formatUsd(r.usage.costUsd) : instinctStrings().receipt.free;
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

/** "2 tasks · 1 note · free": the folded line of a receipt. */
export function receiptSummary(r: ReceiptData): string {
  const s = instinctStrings().receipt;
  const parts: string[] = [];
  const d = r.delegations.length;
  if (d > 0) {
    const ok = r.delegations.filter((x) => x.verdict === 'verified').length;
    const doubt = r.delegations.filter((x) => x.verdict === 'doubt').length;
    const bad = r.delegations.filter(
      (x) => x.verdict === 'incomplete' || x.verdict === 'failed',
    ).length;
    parts.push(`${s.tasks(d)}${ok === d ? ' ✓' : ''}`);
    if (doubt > 0) parts.push(s.doubt(doubt));
    if (bad > 0) parts.push(s.notFinished(bad));
  }
  const n = receiptNotes(r).length;
  if (n > 0) parts.push(s.notes(n));
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

/** "Rhea: publish the post · you said yes": an action the brake looked at. */
export function outboundLine(o: ReceiptData['outbound'][number], nameOf: NameOf): string {
  const s = instinctStrings().receipt;
  const who = nameOf(o.agent);
  switch (o.outcome) {
    case 'approved':
      return s.approved(who, o.summary);
    case 'refused':
      return s.refused(who, o.summary);
    case 'expired':
      return s.expired(who, o.summary);
    default:
      return s.marked(who, o.summary);
  }
}

/* --------------------------------------------------------- settings: uses */

/** The words of the modes of a use, never "shadow" (D-068). */
export function modeWord(use: InstinctUseView): string | null {
  if (use.mode === 'shadow') return instinctStrings().settings.notesOnly;
  return null;
}

/**
 * Why a use that is on does nothing with the engine chosen: "Needs the TypeSafe
 * key", "Needs the expert model or the small model". Null when it works (or is off).
 */
export function needsOf(
  use: InstinctUseView,
  view: Pick<InstinctView, 'engine' | 'jev'>,
): string | null {
  const s = instinctStrings().settings;
  if (use.mode === 'off' || use.active) return null;
  const engines = use.engines;
  if (view.engine === 'jev' && engines.includes('jev') && !view.jev.keySet) return s.needsKey;
  if (engines.includes(view.engine)) return null;
  if (engines.includes('llm') && engines.includes('jev')) return s.needsEither;
  if (engines.includes('jev')) return s.needsExpert;
  return s.needsModel;
}

/** The use is a trial ("in prova"): it can only take notes, it never acts. */
export function isTrial(use: InstinctUseView): boolean {
  return !use.modes.includes('on');
}

/** The mode a switch turns on: `on`, or `shadow` for a use in trial. */
export function onMode(use: InstinctUseView): 'on' | 'shadow' {
  return use.modes.includes('on') ? 'on' : 'shadow';
}

/** "Shortcut to the right monster (trial)" → the label without the trial note. */
export function titleOfUse(use: InstinctUseView): string {
  // i18n-ignore: the trial note of the label, in the language of the core's texts
  return use.label.replace(/\s*\((?:in prova|trial)\)\s*$/i, '');
}

/** The label of a use for Activity ("Checks that the jobs are really finished"). */
export function labelOfUse(use: string): string | null {
  const info = (INSTINCT_USE_INFO as Record<string, { label: string } | undefined>)[use];
  // i18n-ignore: the trial note of the label, in the language of the core's texts
  return info ? info.label.replace(/\s*\((?:in prova|trial)\)\s*$/i, '') : null;
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
  /** "free", "$0.002", or null with nothing verified. */
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
          ? instinctStrings().receipt.free
          : formatUsd(r.costPerVerifiedUsd),
    avgSteps: r.avgSteps,
    missing: Math.max(0, view.minDelegations - r.checked),
  }));
}

/** "Now Rhea tries llama 3.3 70b first: it finishes more jobs and costs less." for a reordered chain. */
export function reorderedLines(view: ScorecardView, nameOf: NameOf): string[] {
  return Object.entries(view.reordered).flatMap(([agent, chain]) =>
    chain[0] ? [instinctStrings().sentence.reordered(nameOf(agent), chainModelName(chain[0]))] : [],
  );
}
