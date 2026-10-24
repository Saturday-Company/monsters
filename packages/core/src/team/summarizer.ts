import { mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  costFromMetadata,
  estimateCostUsd,
  errorMessage,
  type HarnessProvider,
  type ModelRef,
  type ProviderRegistry,
} from '@monsters/providers';
import { defaultUsageClass } from '@monsters/shared';
import { streamText } from 'ai';
import { cacheUsage } from '../agents/usage.ts';
import type { EventLog } from '../log/event-log.ts';
import type { Summarizer, SummaryInput, SummaryOutput } from './compaction.ts';
import { blockedByFreeOnly, type TieredRef } from './instinct/triage.ts';
import { summarizerPrompts } from './summarizer.prompts.ts';
import { teamStrings } from './team.strings.ts';

/*
 * Who writes the summary of a conversation (C.3, D-082). The conversation goes
 * only where it already goes: the links of the monster's chain on the same
 * provider as its first one (a free model only when the first is free too:
 * free models may learn from what they read), the cheapest of them by the
 * price the provider's list says. A monster on Claude Code: Haiku through
 * Claude Code, no tool. On Codex: no summary (the latest turns). The whole
 * chain only when the user chose it (`conversationSummaryModels: 'chain'`).
 * Past the spending cap only what costs nothing. Every request is a
 * `provider_usage` with `purpose: 'compaction'` on the monster's run (Consumi).
 * Strict prompt, bounded output.
 */

/**
 * Most tokens of a summary's answer: not the limit of its text (the prompt asks
 * ~500 words, `fitSummary` keeps `SUMMARY_MAX_CHARS`), room for the reasoning
 * of a model that cannot turn it off. With 1000, qwen3.7-flash spent them all
 * thinking and wrote no text (measure of 16/10, D-082); reasoning is asked off.
 */
export const SUMMARY_MAX_OUTPUT_TOKENS = 8000;
/** The whole answer, every link included (the compactor gives 30 s as well). */
const SUMMARY_TIMEOUT_MS = 30_000;
/** The subscription's small model for a summary on Claude Code. */
export const CLAUDE_SUMMARY_MODEL = 'haiku';
/**
 * Effort of that run (D-169): a summary copies and condenses, it does not reason. Without it
 * Haiku spent 1.9-6.5k output tokens, mostly thinking, on summaries of 1-1.5k tokens (audit of
 * 24/10, 205 requests). The run's settings also turn extended thinking off (`plain` runs).
 */
export const CLAUDE_SUMMARY_EFFORT = 'low';

export const summarySystem = (): string => summarizerPrompts().system;

/** The text the summarizer reads: the old summary and the turns, by speaker. */
export function summaryPrompt(input: Pick<SummaryInput, 'agent' | 'previous' | 'turns'>): string {
  const name = input.agent.config.name;
  const p = summarizerPrompts();
  const lines = input.turns.map((t) => `[${t.role === 'user' ? p.userLabel : name}] ${t.content}`);
  return [
    input.previous ? p.previous(input.previous) : '',
    p.messages(lines.join('\n\n')),
    p.writeNow,
  ]
    .filter(Boolean)
    .join('\n\n');
}

export interface SummaryChainOptions {
  /** The provider is registered and is a model provider (not a harness). */
  isModel: (provider: string) => boolean;
  price: (provider: string, model: string) => { input: number; output: number } | undefined;
  freeOnly: boolean;
  /** `chain`: every link may (the user's choice); default `provider`: the first link's provider. */
  scope?: 'provider' | 'chain';
  /** Past the spending cap: only free and subscription models. */
  freeOnlyNow?: boolean;
}

/**
 * The links of a chain that may write a summary, cheapest first: by price
 * (four parts of input to one of output: a summary reads much more than it
 * writes), free and subscription models at no cost, a `light` link before an
 * unpriced one; the chain's order otherwise.
 */
export function summaryChain(models: readonly TieredRef[], o: SummaryChainOptions): ModelRef[] {
  const cost = (m: TieredRef): number => {
    const p = o.price(m.provider, m.model);
    if (p) return p.input * 4 + p.output;
    const cls = defaultUsageClass(m.provider, m.model);
    if (cls === 'free' || cls === 'subscription') return 0;
    return m.tier === 'light' ? 1e6 : 1e7;
  };
  const first = models[0];
  if (!first) return [];
  const isFree = (m: TieredRef) => defaultUsageClass(m.provider, m.model) === 'free';
  const free = (m: TieredRef) => {
    const cls = defaultUsageClass(m.provider, m.model);
    return cls === 'free' || cls === 'subscription';
  };
  const pool =
    o.scope === 'chain'
      ? models
      : models.filter((m) => m.provider === first.provider && (isFree(first) || !isFree(m)));
  return pool
    .filter((m) => o.isModel(m.provider) && !blockedByFreeOnly(m, o.freeOnly))
    .filter((m) => !o.freeOnlyNow || free(m))
    .map((m, i) => ({ m, i, c: cost(m) }))
    .sort((a, b) => a.c - b.c || a.i - b.i)
    .map(({ m }) => ({ provider: m.provider, model: m.model }));
}

export interface SummarizerOptions {
  providers: ProviderRegistry;
  log: EventLog;
  price: SummaryChainOptions['price'];
  freeOnly: () => boolean;
  /** Which links may write it (`settings.conversationSummaryModels`). */
  scope?: () => 'provider' | 'chain';
  /** The monster is past its spending cap (D-070): only what costs nothing. */
  capped?: (agentId: string) => boolean;
  /** Claude Code for a monster on the Claude plan only (one shot, no tool). */
  claude?: () => HarnessProvider | undefined;
  /** Where the private folder of a harness summary goes (removed after). */
  scratchRoot?: string;
  timeoutMs?: number;
  /** The project of a monster, on the summary's `provider_usage` (F-B13). */
  projectOf?: (agentId: string) => string | null;
}

export function createSummarizer(o: SummarizerOptions): Summarizer {
  const isModel = (id: string) => o.providers.has(id) && o.providers.get(id).kind === 'model';
  return async (input) => {
    const first = input.agent.config.models[0];
    if (first?.provider === 'claude-agent') {
      const claude = o.claude?.();
      if (!claude || !input.scope || !o.scratchRoot)
        throw new Error(teamStrings().claudeUnavailable);
      return harnessSummary(claude, input, o.log, o.scratchRoot, o.projectOf);
    }
    if (first?.provider === 'codex') throw new Error(teamStrings().codexNoSummary);
    const chain = summaryChain(input.agent.config.models, {
      isModel,
      price: o.price,
      freeOnly: o.freeOnly(),
      scope: o.scope?.() ?? 'provider',
      freeOnlyNow: o.capped?.(input.agent.config.id) ?? false,
    });
    if (chain.length === 0) {
      throw new Error(
        o.capped?.(input.agent.config.id)
          ? teamStrings().spendCapReached
          : teamStrings().noSummaryModel,
      );
    }
    return modelSummary(o, chain, input);
  };
}

async function modelSummary(
  o: SummarizerOptions,
  chain: ModelRef[],
  input: SummaryInput,
): Promise<SummaryOutput> {
  const agentId = input.agent.config.id;
  const session = o.providers.session(chain, { pin: false });
  const result = streamText({
    model: session,
    system: summarySystem(),
    prompt: summaryPrompt(input),
    maxRetries: 0,
    maxOutputTokens: SUMMARY_MAX_OUTPUT_TOKENS,
    temperature: 0,
    // No thinking for a summary (D-082): `effort: 'low'` was ignored by qwen3.7-flash, which
    // spent the whole budget thinking; `none` gave 0 reasoning tokens (probe of 16/10).
    providerOptions: { openrouter: { reasoning: { effort: 'none', exclude: true } } },
    abortSignal: input.signal,
    timeout: { totalMs: o.timeoutMs ?? SUMMARY_TIMEOUT_MS },
    onError: () => {},
  });
  let text = '';
  let failure: unknown;
  let cut = false;
  let started = Date.now();
  for await (const part of result.stream) {
    if (part.type === 'start-step') started = Date.now();
    else if (part.type === 'text-delta') text += part.text;
    else if (part.type === 'error') failure ??= part.error;
    else if (part.type === 'abort') failure ??= new Error('interrotto');
    else if (part.type === 'finish-step') {
      if (part.finishReason === 'length') cut = true;
      const served = session.lastServed;
      const provider = served?.ref.provider ?? session.provider;
      const model = served?.ref.model ?? part.response.modelId;
      const reported = costFromMetadata(part.providerMetadata);
      // No cost from the provider: the price list's (F-A4).
      const estimated =
        reported === undefined ? estimateCostUsd(part.usage, o.price(provider, model)) : undefined;
      const costUsd = reported ?? estimated;
      o.log.append({
        agent: agentId,
        runId: input.runId,
        type: 'provider_usage',
        data: {
          provider,
          model,
          ...(part.usage.inputTokens !== undefined ? { inputTokens: part.usage.inputTokens } : {}),
          ...(part.usage.outputTokens !== undefined
            ? { outputTokens: part.usage.outputTokens }
            : {}),
          ...cacheUsage(part.usage),
          ...(costUsd !== undefined ? { costUsd } : {}),
          ...(estimated !== undefined ? { estimated: true } : {}),
          ...(o.projectOf ? { project: o.projectOf(agentId) } : {}),
          durationMs: Date.now() - started,
          ...(served && served.requested.model !== served.ref.model
            ? { requestedModel: served.requested.model }
            : {}),
          ...(served?.keyId !== undefined ? { keyId: served.keyId } : {}),
          purpose: 'compaction',
        },
      });
    }
  }
  input.signal.throwIfAborted();
  if (failure !== undefined) throw new Error(errorMessage(failure));
  // A summary cut by the output limit would replace a whole one with half of it.
  if (cut) throw new Error(teamStrings().summaryCut);
  const served = session.lastServed?.ref;
  return { text, ...(served ? { provider: served.provider, model: served.model } : {}) };
}

/** A summary by Claude Code with the subscription's small model: one turn, no tool, no MCP. */
async function harnessSummary(
  harness: HarnessProvider,
  input: SummaryInput,
  log: EventLog,
  scratchRoot: string,
  projectOf?: (agentId: string) => string | null,
): Promise<SummaryOutput> {
  const project = projectOf ? { project: projectOf(input.agent.config.id) } : {};
  const scope = input.scope!;
  const dir = join(scratchRoot, `${input.runId}-summary-${randomBytes(4).toString('hex')}`);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  let text = '';
  let deltas = '';
  let model: string | undefined;
  let started = Date.now();
  try {
    const events = harness.run(
      {
        prompt: summaryPrompt(input),
        cwd: dir,
        instructions: summarySystem(),
        model: CLAUDE_SUMMARY_MODEL,
        effort: CLAUDE_SUMMARY_EFFORT,
        mcp: { name: 'monsters', url: '', token: '' },
        plain: true,
        systemTools: false,
        maxTurns: 1,
        spawn: (command, args, options) => scope.spawn(command, args, options),
        scratchDir: join(dir, 'run'),
      },
      input.signal,
    );
    for await (const e of events) {
      if (e.type === 'text-delta') deltas += e.delta;
      else if (e.type === 'text') text = e.text;
      else if (e.type === 'session' && e.model) model = e.model;
      else if (e.type === 'usage') {
        model = e.model;
        log.append({
          agent: input.agent.config.id,
          runId: input.runId,
          type: 'provider_usage',
          data: {
            provider: harness.id,
            model: e.model,
            inputTokens: e.inTok,
            outputTokens: e.outTok,
            ...(e.cacheReadTok ? { cachedInputTokens: e.cacheReadTok } : {}),
            ...(e.cacheWriteTok ? { cacheWriteTokens: e.cacheWriteTok } : {}),
            durationMs: Date.now() - started,
            purpose: 'compaction',
            ...project,
          },
        });
        started = Date.now();
      } else if (e.type === 'done') {
        if (e.reason !== 'stop') throw new Error(e.error ?? `Claude Code: ${e.reason}`);
        if (e.text) text = e.text;
      }
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  input.signal.throwIfAborted();
  return { text: text || deltas, provider: harness.id, ...(model ? { model } : {}) };
}
