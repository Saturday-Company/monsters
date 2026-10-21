import { createHash } from 'node:crypto';
import { isAbsolute } from 'node:path';
import { ToolError, type MonstersTool } from '@monsters/shared';
import { expandHome, FS_WRITE_TOOLS, isInside, realPathOf } from '@monsters/tools';
import type { ToolGuard } from '../../agents/tool-adapter.ts';
import type { EventLog } from '../../log/event-log.ts';
import type { DecisionRule } from '../decision.ts';
import { pickedOption, QuestionExpiredError, type QuestionStore } from '../questions.ts';
import { splitAgentToolName } from '../../mcp/convert.ts';
import { INJECTION_REMOVED_MARKS, instinctPrompts } from './instinct.prompts.ts';
import { instinctStrings } from './instinct.strings.ts';
import { classifyOutbound, type OutboundCategory } from './outbound.ts';
import { BANDS, bandOf, injectionBlocks, injectionRequest, outboundRequest } from './questions.ts';
import { choiceOf, pOf, type System1 } from './system1.ts';
import type { RunTaint } from './taint.ts';

/*
 * The instinct around the tool calls of one agent in one run (D-067):
 * - the brake on actions that leave the computer (research 07, killer
 *   feature 1): rules first (`outbound.ts`), then the instinct on the
 *   candidates. Only the categories the user has in "Chiedi sempre" stop:
 *   the action becomes a card ("Rhea vuole …: procedo?") and the agent waits
 *   for that action only; the others go on and are marked on the receipt.
 *   "Puoi pubblicare senza chiedere" (a `proceed` rule) is respected. The
 *   rules hold whatever the mode of the use and whether an engine answers
 *   (D-070): the mode only decides what the instinct does with the candidates;
 * - the data that leave the computer once the run read third-party text
 *   (`RunTaint`, D-070): `afterCall` tells the run what each tool read;
 * - injections in external data (research 08 §5.5): only third-party sources
 *   (web, other programs), never the user's notes nor the terminal. Above the
 *   high band the block is removed, in the middle a warning in the envelope;
 *   without an answer the text passes as it is (today's behaviour). It is a
 *   first filter, not a security boundary: `<dati_esterni>`, permissions and
 *   the gate stay.
 */

/**
 * The mark of a removed block and the warning, in Italian (the family of an Italian app). What is
 * sent follows the app's language (`injectionRemoved()`, `injectionWarning()`); what reads a body
 * back looks for the mark of either family (`INJECTION_REMOVED_MARKS`).
 */
export const INJECTION_REMOVED = instinctPrompts('it').injectionRemoved;
export const INJECTION_WARNING = instinctPrompts('it').injectionWarning;
export { INJECTION_REMOVED_MARKS };
export const injectionRemoved = () => instinctPrompts().injectionRemoved;
export const injectionWarning = () => instinctPrompts().injectionWarning;

/**
 * The category of the card of a run that read third-party text and writes in a project's folder
 * (review of 18/10, B1): not one of the user's "Chiedi sempre" kinds, always asked.
 */
export const PROJECT_WRITE = 'project_write';

/** The card of the brake: "Rhea vuole usare «send_email» di gmail, cioè scrivere a terzi. Procedo?" */
export function brakeQuestion(
  agent: string,
  summary: string,
  category: OutboundCategory | typeof PROJECT_WRITE,
  /** What the action means when the category's words would mislead ("togliere l’accesso…"). */
  meaning?: string,
  /** Whose request it is when it is not the user's ("richiesta di Marco su Telegram…"). */
  asker?: string,
): string {
  const t = instinctStrings();
  const words = meaning ?? (category === PROJECT_WRITE ? summary : t.categoryWords[category]);
  const what = summary.includes(words) ? summary : t.withMeaning(summary, words);
  return t.brakeCard(agent, what, asker);
}

/** What a tool of another program does when the rules cannot say (a card in a chat, D-114). */
const programEffect = () => instinctStrings().programEffect;
/** What reading with another program means in a chat with other people (D-114). */
const programRead = () => instinctStrings().programRead;

/** Tools whose output is checked for injections: third parties only. */
export function scannedForInjection(tool: string): boolean {
  return tool.startsWith('web_') || tool.startsWith('mcp__');
}

/**
 * The longest a card of the brake waits for the user, below the 1 h of a harness hook
 * (`CLAUDE_HOOK_TIMEOUT_S`): past it the action is refused, so a run of the night does not
 * stay busy for ever (F-M7).
 */
export const BRAKE_HOLD_MS = 55 * 60_000;

/**
 * Why the user could not see a card of the brake (D-142): a run of an automation nobody
 * follows, a Telegram chat where other people write, the app closed without Telegram.
 */
export type BrakeUnseen = 'automation' | 'others' | 'closed';

/** The cause in the Activity's words ("No answer (…): …"), in the app's language now. */
export const unseenWords = (unseen: BrakeUnseen): string => instinctStrings().unseen[unseen];

const UNSEEN_MODEL: Record<BrakeUnseen, string> = {
  automation: 'this is an automation: the user was not following it and could not see the card',
  others:
    'the card was for the user, but other people were writing in this Telegram chat: the user may not have seen it',
  closed: 'the app was closed and Telegram is not connected: the user could not see the card',
};

/**
 * What the model reads when a card of the brake had no answer: never "the user did not answer"
 * when the user could not see it, and never a no of the user (D-142, audit M7).
 */
export function brakeNoAnswer(unseen?: BrakeUnseen, holdMs = BRAKE_HOLD_MS): string {
  const minutes = Math.max(1, Math.round(holdMs / 60_000));
  const why = unseen ? UNSEEN_MODEL[unseen] : 'the user may not have seen it';
  const where =
    unseen === 'automation' ? ` (the user finds it in ${instinctStrings().activity})` : '';
  return (
    `Nobody answered the confirmation within ${minutes} minute${minutes === 1 ? '' : 's'} (${why}): the action was not done. ` +
    'It is not a no of the user: do not write that the user refused it or did not answer. ' +
    `Do not try it in another way; say in your report that it waits for the user's ok${where}.`
  );
}

export interface InstinctGuardOptions {
  /** How long a card waits for an answer (default `BRAKE_HOLD_MS`). */
  holdMs?: number;
  system1: System1;
  log: Pick<EventLog, 'append'>;
  questions: QuestionStore;
  /** The rules of the gate now: which categories the user wants to be asked. */
  rules: () => readonly DecisionRule[];
  agent: { id: string; name: string };
  runId: string;
  /** The delegation of a sub-agent, if any. */
  parentId?: string | null;
  /** A registered secret in a text (a key in an URL). */
  containsSecret?: (text: string) => boolean;
  /**
   * What the run has read and knows, shared by its agents (D-070). Without it
   * only the rules on the single call hold.
   */
  taint?: RunTaint;
  /**
   * The folders the agent may change (granted with writes, and its own
   * working folder): a tool that writes a file passes inside them (D-092).
   * Without it, every such write is a card.
   */
  writableFolders?: () => readonly string[];
  /**
   * The folders of the projects: once the run read third-party text, `fs_write`, `fs_move` and
   * `fs_delete` there are a card, whatever the user's rules (a file of a repo can run commands
   * at the user's next test or commit, review of 18/10, B1).
   */
  projectFolders?: () => readonly string[];
  /**
   * Someone who is not the user asks in this run (a person of a Telegram chat, D-114): why,
   * or undefined. Then every tool of another program (MCP) that does something, not only
   * reads, waits for a card to the user, whatever the rules and the instinct say.
   */
  othersAsk?: () => string | undefined;
  /** What a ref of the browser's last snapshot is (D-131): the brake reads clicks from it. */
  browserLabel?: (ref: string) => string | undefined;
  /** Why the user cannot see a card now, if so (D-142): the words of a card left unanswered. */
  unseen?: () => BrakeUnseen | undefined;
}

const hashOf = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 16);

export class InstinctGuard implements ToolGuard {
  readonly #o: InstinctGuardOptions;
  /** Injection answers by text: a page read again is not asked again. */
  readonly #scanned = new Map<string, { body: string; warning?: string }>();
  /** Actions the user already approved in this run (same tool and arguments). */
  readonly #approved = new Set<string>();

  constructor(options: InstinctGuardOptions) {
    this.#o = options;
  }

  /** The user wants to be asked before this kind of action (a rule "ask" with it). */
  #asksAlways(category: OutboundCategory): boolean {
    return this.#o.rules().some((r) => r.effect === 'ask' && r.kinds.includes(category));
  }

  async beforeCall(call: {
    tool: MonstersTool;
    input: unknown;
    callEventId: string;
    signal: AbortSignal;
  }): Promise<void> {
    const { system1 } = this.#o;
    await this.#projectWrite(call);
    const mode = system1.mode('outbound');
    const writeInside =
      call.tool.writesPath !== undefined
        ? await this.#writeInside(call.input, call.tool.writesPath)
        : undefined;
    const found = classifyOutbound(call.tool, call.input, {
      ...(this.#o.containsSecret ? { containsSecret: this.#o.containsSecret } : {}),
      ...(this.#o.taint ? { taint: this.#o.taint } : {}),
      ...(writeInside !== undefined ? { writeInside } : {}),
      ...(this.#o.browserLabel ? { browserLabel: this.#o.browserLabel } : {}),
    });
    // A person of a Telegram chat asks (D-114): another program is the user's call, a read
    // too (the user's mail, Notion, the calendars would reach the chat in the reply: review
    // of the waves 3 and 4), unless the bot gives them the whole toolset ("Strumenti per gli
    // altri", then `othersAsk` is undefined).
    const asker = call.tool.name.startsWith('mcp__') ? this.#o.othersAsk?.() : undefined;
    if (asker && !found) {
      const mcp = splitAgentToolName(call.tool.name);
      const t = instinctStrings();
      const summary = t.useTool(mcp?.tool ?? call.tool.name, mcp?.server ?? t.otherProgram);
      const key = `${call.tool.name}:${hashOf(JSON.stringify(call.input ?? null))}`;
      if (this.#approved.has(key)) return;
      await this.#hold(call, summary, 'contact', undefined, key, programRead(), asker);
      return;
    }
    if (!found) return;
    if (asker) {
      const key = `${call.tool.name}:${hashOf(found.args)}`;
      if (this.#approved.has(key)) return;
      await this.#hold(
        call,
        found.summary,
        found.category ?? 'contact',
        undefined,
        key,
        found.meaning ??
          (found.markOnly ? programRead() : found.category ? undefined : programEffect()),
        asker,
      );
      return;
    }
    if (found.markOnly) {
      this.#mark(call, found.summary, found.category ?? 'contact', undefined, found.markOnly);
      return;
    }
    let { category } = found;
    let p: number | undefined;
    if (!found.certain) {
      // The instinct off: the candidates go on as before the instinct (a mark stays a mark).
      if (mode === 'off') {
        if (found.markAlways)
          this.#mark(
            call,
            found.summary,
            category ?? 'contact',
            undefined,
            instinctStrings().whyUnchecked,
          );
        return;
      }
      const answer = await system1.ask({
        use: 'outbound',
        agent: this.#o.agent.id,
        runId: this.#o.runId,
        parentId: call.callEventId,
        request: outboundRequest({
          tool: call.tool.name,
          // What the rules know more (the server's destructive hint) first: the text is cut.
          description: found.hint
            ? `${found.hint} ${call.tool.description}`
            : call.tool.description,
          args: found.args,
          seed: call.callEventId,
        }),
        logAs: {
          outbound: { kind: 'outbound', bands: BANDS.outbound },
          outbound_kind: { kind: 'outbound_kind' },
        },
        signal: call.signal,
      });
      if (!answer) {
        // No engine: the action goes on as today, but the receipt shows it (a mark always).
        if (mode === 'on' || found.markAlways)
          this.#mark(
            call,
            found.summary,
            category ?? 'contact',
            undefined,
            instinctStrings().whyUnchecked,
          );
        return;
      }
      if (answer.mode !== 'on') {
        if (found.markAlways)
          this.#mark(
            call,
            found.summary,
            category ?? 'contact',
            undefined,
            instinctStrings().whyUnchecked,
          );
        return;
      }
      p = pOf(answer, 'outbound');
      if (p === undefined) return;
      const kind = choiceOf(answer, 'outbound_kind')?.value;
      if (kind && kind !== 'none') category = kind as OutboundCategory;
      const band = bandOf(p, BANDS.outbound.low, BANDS.outbound.high);
      if (band === 'low') {
        if (found.markAlways)
          this.#mark(call, found.summary, category ?? 'contact', p, instinctStrings().whyToCheck);
        return;
      }
      if (band === 'mid' || !category) {
        this.#mark(call, found.summary, category ?? 'contact', p, instinctStrings().whyDoubt);
        return;
      }
    }
    if (!category) return;
    if (!this.#asksAlways(category)) {
      // "Puoi … senza chiedere": the user's rule holds, the receipt shows it.
      this.#mark(call, found.summary, category, p, instinctStrings().whyRules);
      return;
    }
    const key = `${call.tool.name}:${hashOf(found.args)}`;
    if (this.#approved.has(key)) return;
    await this.#hold(call, found.summary, category, p, key, found.meaning);
  }

  /**
   * A run that read third-party text writes in the folder of a project: a card, always. A
   * relative path cannot be placed from here, so it counts as inside. The approved action is
   * not asked again in the same run.
   */
  async #projectWrite(call: {
    tool: MonstersTool;
    input: unknown;
    callEventId: string;
    signal: AbortSignal;
  }): Promise<void> {
    const taint = this.#o.taint;
    if (!taint || (!taint.tainted && taint.guarded === undefined)) return;
    if (!(FS_WRITE_TOOLS as readonly string[]).includes(call.tool.name)) return;
    const folders = this.#o.projectFolders?.() ?? [];
    if (folders.length === 0) return;
    const input = (call.input && typeof call.input === 'object' ? call.input : {}) as Record<
      string,
      unknown
    >;
    const paths = [input['path'], input['from'], input['to']].filter(
      (v): v is string => typeof v === 'string' && v.trim() !== '',
    );
    let target: string | undefined;
    for (const raw of paths) {
      const path = expandHome(raw.trim());
      if (!isAbsolute(path)) {
        target = raw;
        break;
      }
      try {
        const real = await realPathOf(path);
        for (const folder of folders) {
          if (isInside(await realPathOf(folder), real)) target = raw;
        }
      } catch {
        // Unreadable: not placed inside.
      }
      if (target) break;
    }
    if (!target) return;
    const key = `${call.tool.name}:${hashOf(paths.join('\n'))}`;
    if (this.#approved.has(key)) return;
    await this.#hold(
      call,
      instinctStrings().projectWrite(target.length > 80 ? `…${target.slice(-79)}` : target),
      PROJECT_WRITE,
      undefined,
      key,
      instinctStrings().projectWriteMeaning,
    );
  }

  async #hold(
    call: { tool: MonstersTool; callEventId: string; signal: AbortSignal },
    summary: string,
    category: OutboundCategory | typeof PROJECT_WRITE,
    p: number | undefined,
    key: string,
    meaning?: string,
    asker?: string,
  ): Promise<void> {
    const { agent, questions, runId } = this.#o;
    const t = instinctStrings();
    const details = { tool: call.tool.name, category, summary, ...(asker ? { asker } : {}) };
    this.#event('outbound_hold', t.hold(agent.name, summary), p, details, call.callEventId);
    const question = questions.create({
      agent: agent.id,
      runId,
      parentId: call.callEventId,
      question: brakeQuestion(agent.name, summary, category, meaning, asker),
      options: [
        { id: '1', label: t.yesLabel, description: t.yesDescription },
        { id: '2', label: t.noLabel, description: t.noDescription },
      ],
      blocking: true,
      // The card of this call: when its run ends unanswered it expires, never parks (D-078).
      kind: 'brake',
    });
    let answer;
    const holdMs = this.#o.holdMs ?? BRAKE_HOLD_MS;
    const hold = AbortSignal.timeout(holdMs);
    // Sampled when the card goes out and again at its end: the app open in between saw it.
    const unseenAtStart = this.#o.unseen?.();
    try {
      answer = await questions.waitFor(question.id, AbortSignal.any([call.signal, hold]));
    } catch (err) {
      if (call.signal.aborted) throw err;
      // Nobody answered in time: the card is closed and the action is not done.
      if (hold.aborted) questions.expireOpen({ id: question.id });
      if (hold.aborted || err instanceof QuestionExpiredError) {
        const now = this.#o.unseen?.();
        const unseen = now === 'closed' && unseenAtStart !== 'closed' ? undefined : now;
        this.#event(
          'outbound_refused',
          t.noAnswer(unseen ? unseenWords(unseen) : undefined, agent.name, summary),
          p,
          { ...details, outcome: 'expired', ...(unseen ? { unseen: unseenWords(unseen) } : {}) },
          call.callEventId,
        );
        throw new ToolError('ABORTED', brakeNoAnswer(unseen, holdMs));
      }
      throw err;
    }
    // The option chosen on the card, or the one a typed answer picks, read like the chat does.
    const picked = answer.optionId ?? pickedOption(question, answer.text ?? '');
    if (picked === '1') {
      this.#approved.add(key);
      this.#event(
        'outbound_approved',
        t.approved(agent.name, summary),
        p,
        { ...details, outcome: 'approved' },
        call.callEventId,
      );
      return;
    }
    const words = answer.text?.trim();
    if (picked === undefined && words) {
      // Not a plain yes ("sì, ma non a Marco"): never an approval. The action is not done,
      // and the monster reads what the user wrote (review of 19/10, item 2).
      this.#event(
        'outbound_refused',
        t.notYes(agent.name, summary),
        p,
        { ...details, outcome: 'refused' },
        call.callEventId,
      );
      throw new ToolError(
        'USER_DECLINED',
        `the user did not approve this action as it is; they answered: «${words.slice(0, 500)}»`,
        {
          hint:
            'Do not do this action now. Follow what the user wrote: if it allows the action ' +
            'with a change, do it with that change (it will be asked again); otherwise go on ' +
            'without it and say in your report what you did not do.',
        },
      );
    }
    this.#event(
      'outbound_refused',
      t.declined(agent.name, summary),
      p,
      { ...details, outcome: 'refused' },
      call.callEventId,
    );
    throw new ToolError('USER_DECLINED', 'the user said no to this action', {
      hint:
        'Do not do it, and do not try it in another way (another tool, another command). ' +
        'Go on with the rest and say in your report what you did not do.',
    });
  }

  /**
   * The file a tool writes is inside a folder the agent may change, on real
   * paths like the monsters' own writes (a link that leads out is out). A
   * relative path, whose folder only the other program knows, is out.
   */
  async #writeInside(input: unknown, arg: string): Promise<boolean> {
    const raw = input && typeof input === 'object' ? (input as Record<string, unknown>)[arg] : '';
    if (typeof raw !== 'string' || !raw.trim()) return false;
    const path = expandHome(raw.trim());
    if (!isAbsolute(path)) return false;
    try {
      const real = await realPathOf(path);
      for (const folder of this.#o.writableFolders?.() ?? []) {
        if (isInside(await realPathOf(folder), real)) return true;
      }
    } catch {
      // Unreadable: out, on the safe side.
    }
    return false;
  }

  /** The words of a card left unanswered, for a hook that stopped waiting first (D-142). */
  noAnswer(): string {
    return brakeNoAnswer(this.#o.unseen?.(), this.#o.holdMs ?? BRAKE_HOLD_MS);
  }

  /** A tool finished: the run learns what it read (taint, hosts, notes). */
  afterCall(call: { tool: MonstersTool; input: unknown; output: unknown }): void {
    this.#o.taint?.observe(call.tool.name, call.input, call.output);
  }

  #mark(
    call: { tool: MonstersTool; callEventId: string },
    summary: string,
    category: OutboundCategory,
    p: number | undefined,
    why: string,
  ): void {
    this.#event(
      'outbound_marked',
      instinctStrings().marked(this.#o.agent.name, summary, why),
      p,
      { tool: call.tool.name, category, summary, outcome: 'marked', why },
      call.callEventId,
    );
  }

  #event(
    action: 'outbound_hold' | 'outbound_approved' | 'outbound_refused' | 'outbound_marked',
    message: string,
    p: number | undefined,
    details: Record<string, unknown>,
    parentId: string,
  ): void {
    this.#o.log.append({
      agent: 'system',
      runId: this.#o.runId,
      parentId,
      type: 'instinct',
      data: {
        use: 'outbound',
        action,
        message,
        subject: this.#o.agent.id,
        ...(p !== undefined ? { confidence: p } : {}),
        details,
      },
    });
  }

  async external(call: {
    tool: MonstersTool;
    source: string;
    body: string;
    callEventId: string;
    signal: AbortSignal;
  }): Promise<{ body: string; warning?: string }> {
    const { system1 } = this.#o;
    if (!scannedForInjection(call.tool.name) || !system1.available('injection')) {
      return { body: call.body };
    }
    const key = hashOf(call.body);
    const seen = this.#scanned.get(key);
    if (seen) return seen;
    const { blocks, unchecked } = injectionBlocks(call.body);
    if (blocks.length === 0) return { body: call.body };
    const { request, ids } = injectionRequest({ source: call.source, blocks });
    const answer = await system1.ask({
      use: 'injection',
      agent: this.#o.agent.id,
      runId: this.#o.runId,
      parentId: call.callEventId,
      request,
      logAs: Object.fromEntries(
        ids.map((id) => [id, { kind: 'injection', bands: BANDS.injection }]),
      ),
      signal: call.signal,
    });
    if (answer?.mode !== 'on') return { body: call.body };
    let removed = 0;
    let warned = false;
    let top = 0;
    const out = blocks.map((block, i) => {
      const p = pOf(answer, ids[i]!) ?? 0;
      top = Math.max(top, p);
      const band = bandOf(p, BANDS.injection.low, BANDS.injection.high);
      if (band === 'high') {
        removed++;
        return `\n${injectionRemoved()}\n`;
      }
      if (band === 'mid') warned = true;
      return block;
    });
    const body = out.join('') + call.body.slice(call.body.length - unchecked);
    const result =
      removed > 0 || warned
        ? { body: removed > 0 ? body : call.body, warning: injectionWarning() }
        : { body: call.body };
    // Only a removal reaches the user: in the middle band the agent gets the warning and the
    // decision is in the log, but benign search results score 0.5-0.7 (eval of 16/10, 9 false
    // alarms in 10 runs) and an alarm that cries wolf teaches the user to ignore it.
    if (removed > 0) {
      this.#o.log.append({
        agent: 'system',
        runId: this.#o.runId,
        parentId: call.callEventId,
        type: 'security',
        data: {
          action: 'injection_removed',
          source: call.source.slice(0, 300),
          tool: call.tool.name,
          p: top,
          blocks: removed,
          message: instinctStrings().injectionRemoved(call.source.slice(0, 120)),
        },
      });
    }
    this.#scanned.set(key, result);
    return result;
  }
}
