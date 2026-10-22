import { ToolError } from '@monsters/shared';
import { z } from 'zod';
import { teamStrings } from './team.strings.ts';

/*
 * Cost limits of one run (the orchestrator, its turns and every delegated
 * agent): delegations at once and in total, open non-blocking questions, and
 * a total of model steps, tokens and dollars. When a limit is reached the
 * agent gets a clear `LIMIT_REACHED` tool error, and the model loop ends with
 * one last step without tools, for the report (D-064). Configurable in
 * `settings.json` (`limits`).
 */

export const RunLimitsSchema = z.object({
  /** Delegations running at the same time, i.e. in one step of the orchestrator. */
  maxParallelDelegations: z.number().int().min(1).max(20).default(4),
  /** Delegations in a whole run. */
  maxDelegationsPerRun: z.number().int().min(1).max(500).default(12),
  /** Non-blocking questions of a run still waiting for an answer. */
  maxOpenQuestionsPerRun: z.number().int().min(0).max(50).default(3),
  /** Model steps of a run, every agent included. */
  maxRunSteps: z.number().int().min(1).default(150),
  /** Fresh input + output tokens of a run, every agent included (`limitTokens`). */
  maxRunTokens: z.number().int().min(1000).default(1_500_000),
  /**
   * Dollars a run may spend, counted from the cost the providers report
   * (`provider_usage.costUsd`: OpenRouter; free models cost 0). Subscriptions
   * run on a harness are not counted: their cost is notional (D-064).
   */
  maxRunCostUsd: z.number().min(0.01).default(0.5),
  /**
   * Dollars of a run and of the runs of the projects' leads it sent work to (`project_send`,
   * F-A6), together. Unset: `TREE_COST_FACTOR` times `maxRunCostUsd`.
   */
  maxTreeCostUsd: z.number().min(0.01).optional(),
  /**
   * Fresh input + output tokens of one delegated agent in one task, when its
   * agent.yaml sets none: one agent cannot use the budget of all (D-064).
   */
  maxSubagentTokens: z.number().int().min(1000).default(400_000),
});
export type RunLimits = z.infer<typeof RunLimitsSchema>;
export type RunLimitsInput = z.input<typeof RunLimitsSchema>;

export const DEFAULT_RUN_LIMITS: RunLimits = RunLimitsSchema.parse({});

/**
 * The cost of a run with the work it sent to projects, against the limit of one run. Each
 * lead's run keeps its own limits (a project's job delegates to its monsters), and every send
 * counts as a delegation of the sender: at most `maxDelegationsPerRun` leads' runs. Three
 * times one run (1,50 $ by default) covers the sender plus two or three leads working, and
 * still stops a fan-out that would multiply the cost by the number of sends.
 */
export const TREE_COST_FACTOR = 3;

/** The limit of a run with the work it sent to projects (`maxTreeCostUsd`). */
export function treeCostLimit(limits: RunLimits): number {
  return limits.maxTreeCostUsd ?? TREE_COST_FACTOR * limits.maxRunCostUsd;
}

function limitError(message: string, hint: string): ToolError {
  return new ToolError('LIMIT_REACHED', message, { hint });
}

/**
 * Usage of one run against its limits. Shared by every agent of the run. A
 * run started by another one (the lead's run of a `project_send`, F-A6) has
 * that run's budget as its parent: it keeps its own steps, tokens, delegations
 * and cost limit, and its cost counts in the tree of the first run too, which
 * has one limit for all (`treeCostLimit`): N sends never multiply the cost.
 */
export class RunBudget {
  readonly limits: RunLimits;
  readonly #parent: RunBudget | undefined;
  /**
   * The spending cap of an agent (D-070): a sentence when the euros of the
   * day or the month are spent and the agent's models cost money, else null.
   * Checked only when the agent is known (the harnesses run on subscriptions).
   */
  spendCheck: ((agentId: string) => string | null) | undefined;
  #steps = 0;
  #tokens = 0;
  #costUsd = 0;
  #delegations = 0;
  #active = 0;
  /** This run's cost with the runs it sent work to. */
  #treeCostUsd = 0;

  constructor(limits: RunLimits = DEFAULT_RUN_LIMITS, parent?: RunBudget) {
    this.limits = limits;
    this.#parent = parent;
  }

  /**
   * The budget of a run that is not live any more (its core closed, or Ferma stopped it), as
   * the log tells it: what it spent, with the work it sent to projects, and its delegations.
   * The parent of the work it sent that starts again later (residual of F-A6): that work keeps
   * the limit of its tree instead of a new one.
   */
  static restored(
    limits: RunLimits,
    spent: { costUsd: number; treeCostUsd: number; delegations: number },
  ): RunBudget {
    const b = new RunBudget(limits);
    b.#costUsd = Math.max(0, spent.costUsd);
    b.#treeCostUsd = Math.max(b.#costUsd, spent.treeCostUsd);
    b.#delegations = Math.max(0, spent.delegations);
    return b;
  }

  get usage(): {
    steps: number;
    tokens: number;
    costUsd: number;
    delegations: number;
    active: number;
  } {
    return {
      steps: this.#steps,
      tokens: this.#tokens,
      costUsd: this.#costUsd,
      delegations: this.#delegations,
      active: this.#active,
    };
  }

  /** Counts one finished model step, with its cost when the provider reports one. */
  addStep(tokens: number, costUsd = 0): void {
    this.#steps++;
    this.#tokens += Math.max(0, tokens);
    this.#spent(costUsd);
  }

  /** Counts a cost that is not a model step: a paid web search (D-071). */
  addCost(costUsd: number): void {
    this.#spent(costUsd);
  }

  /**
   * Counts a request that is not a finished step (a stream broken halfway and
   * asked again, an answer given up): its tokens and cost, not a step (F-A4).
   */
  addUsage(tokens: number, costUsd = 0): void {
    if (Number.isFinite(tokens)) this.#tokens += Math.max(0, tokens);
    this.#spent(costUsd);
  }

  #spent(costUsd: number): void {
    if (!Number.isFinite(costUsd) || costUsd <= 0) return;
    this.#costUsd += costUsd;
    this.#addTree(costUsd);
  }

  #addTree(costUsd: number): void {
    this.#treeCostUsd += costUsd;
    if (this.#parent) this.#parent.#addTree(costUsd);
  }

  /** The first run of the tree: the one whose work was not sent by another. */
  #root(): RunBudget {
    return this.#parent ? this.#parent.#root() : this;
  }

  /** Model steps the run may still take (every agent of the run included). */
  stepsLeft(): number {
    return Math.max(0, this.limits.maxRunSteps - this.#steps);
  }

  /** Delegations the run may still start in total (its sends to projects included). */
  #delegationsLeft(): number {
    return Math.max(0, this.limits.maxDelegationsPerRun - this.#delegations);
  }

  #countDelegation(): void {
    this.#delegations++;
  }

  /** Why the run must stop, or null while it may go on (with the agent: its spending cap too). */
  exhausted(agentId?: string): string | null {
    const l = this.limits;
    if (this.#steps >= l.maxRunSteps) {
      return teamStrings().runSteps(l.maxRunSteps);
    }
    if (this.#tokens >= l.maxRunTokens) {
      return teamStrings().runTokens(l.maxRunTokens);
    }
    if (this.#costUsd >= l.maxRunCostUsd) {
      return teamStrings().runCost(l.maxRunCostUsd);
    }
    // The run that sent the work and every lead's run it started: one cost limit (F-A6).
    const root = this.#root();
    const tree = treeCostLimit(root.limits);
    if (root.#treeCostUsd >= tree) {
      return teamStrings().runTreeCost(tree);
    }
    if (agentId !== undefined && this.spendCheck) return this.spendCheck(agentId);
    return null;
  }

  /** Throws `LIMIT_REACHED` when the run is out of steps or tokens. */
  assertActive(agentId?: string): void {
    const why = this.exhausted(agentId);
    if (why) {
      throw limitError(
        `limit reached: ${why}`,
        'Stop here: tell the user what is done and what is left.',
      );
    }
  }

  /**
   * Reserves a delegation (parallel and total caps). Returns the function
   * that releases the parallel slot when the delegation ends.
   */
  beginDelegation(): () => void {
    this.assertActive();
    const l = this.limits;
    this.#assertDelegationRoom();
    if (this.#active >= l.maxParallelDelegations) {
      throw limitError(
        `limit reached: at most ${l.maxParallelDelegations} delegations at the same time`,
        'Wait for the results of these, then delegate the rest in the next step.',
      );
    }
    this.#countDelegation();
    this.#active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.#active--;
    };
  }

  #assertDelegationRoom(): void {
    if (this.#delegationsLeft() > 0) return;
    throw limitError(
      `limit reached: at most ${this.limits.maxDelegationsPerRun} delegations per task`,
      'Do the rest yourself, or finish and tell the user what is left.',
    );
  }

  /**
   * Work may be sent to a project's lead now (`project_send`, F-A6): the run is
   * not exhausted and has a delegation left. Throws `LIMIT_REACHED` otherwise.
   */
  assertSendRoom(): void {
    this.assertActive();
    this.#assertDelegationRoom();
  }

  /**
   * Counts work sent to a project's lead: a delegation of this run that returns
   * at once (no parallel slot), whose run then counts its cost in this run's
   * tree (`new RunBudget(limits, this)`).
   */
  countSend(): void {
    this.#countDelegation();
  }

  /** Throws when the run already has too many non-blocking questions open. */
  assertQuestionRoom(open: number): void {
    const max = this.limits.maxOpenQuestionsPerRun;
    if (open >= max) {
      throw limitError(
        `limit reached: at most ${max} open questions without waiting`,
        'Wait for the answers already asked, or decide yourself and say so.',
      );
    }
  }
}

/**
 * The tokens of one request that count against the token limits: the input read
 * fresh and the output. Prompt-cache reads are left out: every step of a run
 * re-reads its whole context, and on Claude Code a research of nine steps already
 * summed 400k input tokens, 92% of them cache reads, so a delegated monster was
 * stopped halfway through its work (22/10/2026). They still go in `provider_usage`.
 */
export function limitTokens(inTok: number, outTok: number, cacheReadTok = 0): number {
  const fresh = Math.max(0, inTok - Math.max(0, cacheReadTok));
  return fresh + Math.max(0, outTok);
}

/**
 * Token limit of one agent in one task: its own `maxTotalTokens`, or for a
 * delegated agent the run's `maxSubagentTokens`, counted with `limitTokens`.
 */
export function agentTokenLimit(
  agent: {
    kind: 'orchestrator' | 'lead' | 'subagent';
    limits: { maxTotalTokens?: number | undefined };
  },
  limits: RunLimits | undefined,
): number | undefined {
  if (agent.limits.maxTotalTokens !== undefined) return agent.limits.maxTotalTokens;
  return agent.kind === 'subagent' && limits ? limits.maxSubagentTokens : undefined;
}

const budgets = new WeakMap<object, RunBudget>();

/**
 * The budget of a run (one per run handle, created on first use), with the
 * budget of the run that started it as parent when there is one (F-A6).
 */
export function runBudget(
  run: object,
  limits: RunLimits = DEFAULT_RUN_LIMITS,
  parent?: RunBudget,
): RunBudget {
  let budget = budgets.get(run);
  if (!budget) budgets.set(run, (budget = new RunBudget(limits, parent)));
  return budget;
}
