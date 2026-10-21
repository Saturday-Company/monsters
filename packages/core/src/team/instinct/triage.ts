import type { InstinctUse } from '@monsters/shared';
import type { ModelRef } from '@monsters/providers';
import { coordinates, type AgentDefinition } from '../../agents/definition.ts';
import type { EventLog } from '../../log/event-log.ts';
import { matchRule, type DecisionRule } from '../decision.ts';
import { instinctStrings } from './instinct.strings.ts';
import { instinctPrompts } from './instinct.prompts.ts';
import { BANDS, isRouteLead, isRouteTeam, tierOf, triageRequest } from './questions.ts';
import { choiceOf, pOf, type QuestionLog, type System1 } from './system1.ts';

/*
 * The "radiografia" of a request (D-067, research 08 §5.4): one call when a
 * message of the user reaches an agent, in parallel with the memory and the
 * profile (no wait of its own). What it gives, each with its own use:
 * - `route_hint`: who fits the request, as one line of the first message of
 *   the orchestrator ("sembra adatta Rhea"), from confidence 0.7 and only
 *   when the choice asked in both orders agrees;
 * - `tier`: simple / medium / hard, with the measured cuts on the score (the
 *   coordinator's run; each delegation asks again on its brief, D-109);
 * - `tools`: the web is not needed (free chains lose the web tools for the
 *   turn) and the rare vault tools are needed (in OR with the words);
 * - `shortcut` (trial, shadow only): when the request could have gone
 *   straight to one monster, logged and nothing else.
 * Without an answer within 1.5 s the turn goes on as without the instinct.
 */

export type TierLevel = 'simple' | 'medium' | 'hard';

export interface TriageOutcome {
  /** Line for the first message of the orchestrator. */
  hint?: string;
  tier?: TierLevel;
  /** p("the web is needed"), when asked. */
  needsWeb?: number;
  /** p("the rare tools are needed"), when asked. */
  rareTools?: number;
}

export interface TriageInput {
  /** The agent receiving the request. */
  agent: AgentDefinition;
  /** The other members of the team (for the route). */
  members: readonly AgentDefinition[];
  request: string;
  history: readonly string[];
  runId: string;
  /** The user's message. */
  parentId?: string | null;
  signal?: AbortSignal;
  /** Ask the tier (some agent has a light and a strong model). */
  tier: boolean;
  /** Ask about the web (the agent is on a free chain with web tools). */
  web: boolean;
  /** Ask about the rare tools (free chain and the words did not say it). */
  rare: boolean;
  /** Rules of the gate: a request that touches an "ask always" one never takes the shortcut. */
  rules: readonly DecisionRule[];
}

export interface SubtaskTierInput {
  /** The monster the subtask is delegated to. */
  agent: AgentDefinition;
  /** The subtask as the coordinator wrote it (`subtaskText`). */
  subtask: string;
  runId: string;
  /** The `delegation` event. */
  parentId: string;
  signal?: AbortSignal;
}

/** One line describing a member for the route: "Rhea, ricercatrice: …". */
export function memberLine(a: AgentDefinition): string {
  return `${a.config.name}, ${a.config.role}`.slice(0, 240);
}

export class Triage {
  readonly #s1: System1;
  readonly #log: Pick<EventLog, 'append'>;

  constructor(system1: System1, log: Pick<EventLog, 'append'>) {
    this.#s1 = system1;
    this.#log = log;
  }

  #on(use: InstinctUse): boolean {
    return this.#s1.mode(use) === 'on';
  }

  async run(input: TriageInput): Promise<TriageOutcome> {
    const s1 = this.#s1;
    // The orchestrator and a project's lead (its members only, D-097) get routing hints.
    const lead = coordinates(input.agent.config);
    const ask = {
      route:
        lead &&
        input.members.length > 0 &&
        (s1.available('route_hint') || s1.available('shortcut')),
      tier: input.tier && s1.available('tier'),
      web: input.web && s1.available('tools'),
      rare: input.rare && s1.available('tools'),
    };
    if (!ask.route && !ask.tier && !ask.web && !ask.rare) return {};
    const primary: InstinctUse = ask.route
      ? s1.available('route_hint')
        ? 'route_hint'
        : 'shortcut'
      : ask.tier
        ? 'tier'
        : 'tools';
    const routeUse: InstinctUse = s1.available('route_hint') ? 'route_hint' : 'shortcut';
    const logAs: Record<string, QuestionLog> = {
      route: { kind: 'route', use: routeUse },
      route_rev: { kind: 'route', use: routeUse },
      tier: { kind: 'tier', use: 'tier' },
      needs_web: { kind: 'needs_web', use: 'tools', bands: { low: BANDS.web.drop, high: 0.85 } },
      rare_tools: { kind: 'rare_tools', use: 'tools', bands: { low: 0.15, high: BANDS.rare.add } },
    };
    const answer = await s1
      .ask({
        use: primary,
        agent: input.agent.config.id,
        runId: input.runId,
        parentId: input.parentId ?? null,
        request: triageRequest({
          request: input.request,
          history: input.history,
          members: input.members.map((m) => ({ name: m.config.name, description: memberLine(m) })),
          ask,
        }),
        logAs,
        ...(input.signal ? { signal: input.signal } : {}),
      })
      .catch((err: unknown) => {
        if (input.signal?.aborted) throw err;
        return null;
      });
    if (!answer) return {};
    const out: TriageOutcome = {};

    const route = choiceOf(answer, 'route');
    const reversed = choiceOf(answer, 'route_rev');
    const stable = route !== undefined && reversed !== undefined && route.value === reversed.value;
    const score = answer.answers.get('tier')?.value;
    const tier = typeof score === 'number' ? tierOf(score) : undefined;
    if (tier && this.#on('tier')) out.tier = tier;

    if (route && stable && route.confidence >= BANDS.route.hint && this.#on('route_hint')) {
      const member = input.members.find((m) => m.config.name === route.value);
      const hints = instinctPrompts();
      out.hint = isRouteLead(route.value)
        ? hints.hintLead
        : isRouteTeam(route.value)
          ? hints.hintTeam
          : member
            ? hints.hintMember(memberLine(member))
            : undefined;
      if (out.hint) {
        this.#event(
          input,
          'route_hint',
          'route_hint',
          isRouteLead(route.value)
            ? instinctStrings().routeLead
            : isRouteTeam(route.value)
              ? instinctStrings().routeTeam
              : instinctStrings().routeMember(route.value),
          route.confidence,
          {
            route: route.value,
          },
        );
      }
    }

    // Shortcut (trial): one monster, sure in both orders, not hard, nothing "ask always".
    const member = route ? input.members.find((m) => m.config.name === route.value) : undefined;
    const risky = input.rules.some(
      (r) => r.effect === 'ask' && r.patterns.length > 0 && matchRule(r, { text: input.request }),
    );
    if (
      member &&
      stable &&
      route.confidence >= BANDS.route.shortcut &&
      tier !== 'hard' &&
      !risky &&
      s1.mode('shortcut') === 'shadow'
    ) {
      this.#event(
        input,
        'shortcut',
        'shortcut',
        instinctStrings().shortcutTrial(member.config.name),
        route.confidence,
        { route: member.config.name, tier: tier ?? null, applied: false },
      );
    }

    if (this.#on('tools')) {
      const web = pOf(answer, 'needs_web');
      const rare = pOf(answer, 'rare_tools');
      if (web !== undefined) out.needsWeb = web;
      if (rare !== undefined) out.rareTools = rare;
    }
    return out;
  }

  /**
   * The level of one delegation (D-109): the same tier question on the subtask
   * the coordinator wrote, one call per delegation (parallel delegations ask in
   * parallel). Undefined without an answer within the use's timeout, with the
   * use not on, or on any error: the delegation then takes the run's level.
   * The subtask is a monster's text: the score only chooses a model, it never
   * becomes the user's words or a known site.
   */
  async subtaskTier(input: SubtaskTierInput): Promise<TierLevel | undefined> {
    if (!this.#s1.available('tier')) return undefined;
    const answer = await this.#s1
      .ask({
        use: 'tier',
        agent: input.agent.config.id,
        runId: input.runId,
        parentId: input.parentId,
        request: triageRequest({
          request: input.subtask,
          history: [],
          members: [],
          ask: { route: false, tier: true, web: false, rare: false },
        }),
        logAs: { tier: { kind: 'tier', use: 'tier' } },
        ...(input.signal ? { signal: input.signal } : {}),
      })
      .catch((err: unknown) => {
        if (input.signal?.aborted) throw err;
        return null;
      });
    const score = answer?.answers.get('tier')?.value;
    return typeof score === 'number' && this.#on('tier') ? tierOf(score) : undefined;
  }

  #event(
    input: TriageInput,
    use: InstinctUse,
    action: 'route_hint' | 'shortcut' | 'tier' | 'tools',
    message: string,
    confidence: number | undefined,
    details: Record<string, unknown>,
  ): void {
    this.#log.append({
      agent: 'system',
      runId: input.runId,
      parentId: input.parentId ?? null,
      type: 'instinct',
      data: {
        use,
        action,
        message,
        subject: input.agent.config.id,
        ...(confidence !== undefined ? { confidence } : {}),
        details,
      },
    });
  }
}

/** A link of a chain with its tier (agent.yaml: `tier: light | strong`, D-067). */
export type TieredRef = ModelRef & { tier?: 'light' | 'strong' | undefined };

/**
 * The chain has a light and a strong model: the tier can choose between them. A chain of
 * "Automatica" (`auto`, D-110) has only the strong one (Sonnet is the base, Opus the
 * Difficile link): Semplice and Media stay on the base, so one tier is enough.
 */
export function hasTiers(models: readonly TieredRef[], auto = false): boolean {
  const light = models.some((m) => m.tier === 'light');
  const strong = models.some((m) => m.tier === 'strong');
  return auto ? light || strong : light && strong;
}

/** A paid OpenRouter model while the user allows only the free ones. */
export function blockedByFreeOnly(m: ModelRef, freeOnly: boolean): boolean {
  return (
    freeOnly &&
    m.provider === 'openrouter' &&
    !m.model.endsWith(':free') &&
    m.model !== 'openrouter/free'
  );
}

/**
 * The chain for a tier: the light links first for a simple turn, the strong
 * ones for a hard one, the order of the rest kept. Null when nothing changes
 * (medium, no tiers, or the links to move are paid models with `freeOnly` on).
 */
export function tieredChain(
  models: readonly TieredRef[],
  level: TierLevel,
  freeOnly: boolean,
  auto = false,
): TieredRef[] | null {
  if (level === 'medium' || !hasTiers(models, auto)) return null;
  const want = level === 'simple' ? 'light' : 'strong';
  const first = models.filter((m) => m.tier === want && !blockedByFreeOnly(m, freeOnly));
  if (first.length === 0) return null;
  const rest = models.filter((m) => !first.includes(m));
  const next = [...first, ...rest];
  return next.every((m, i) => m === models[i]) ? null : next;
}
