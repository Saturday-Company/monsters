import type { ModelRef } from '@monsters/providers';
import type { AgentDefinition } from '../agents/definition.ts';
import { isFreeChain } from './team-service.ts';
import { wordRegex } from './word-boundary.ts';

/*
 * Tools of one turn (review AG-07, ARCHITECTURE §5.7): every tool schema goes
 * to the model at every step (~4,400 tokens for the orchestrator), and with
 * many similar tools free models pick the wrong one. Decided per request, on
 * top of the permissions (`TeamService`), so agent.yaml never changes:
 * - `vault_propose` only for agents that cannot write everywhere (the
 *   orchestrator writes directly);
 * - on a free chain, history, undo, move, delete and proposals only when the
 *   request is about them, links and tags not at all.
 */

/** Tools a free chain gets only when the request is about them. */
export const RARE_VAULT_TOOLS = [
  'vault_move',
  'vault_delete',
  'vault_history',
  'vault_restore',
  'vault_undo',
  'vault_apply_proposal',
];
/** Tools a free chain does without (search and the links in `vault_read` cover them). */
export const GRAPH_VAULT_TOOLS = ['vault_links', 'vault_tags'];

/**
 * Hook for a System 1 decision ("does the request ask to undo, restore, move,
 * delete or rename?", review §3 point 9). Today a rule on the words of the
 * request; a small model can take its place with the same signature.
 */
export type RareToolsCheck = (request: string) => boolean;

const RARE_REQUEST = wordRegex(
  '\\b(annull\\w*|ripristin\\w*|torn\\w*\\s+(indietro|com.era)|com.era\\s+prima|version[ei]\\s+precedent[ei]|cronologia|modifiche\\s+precedenti|recuper\\w*|spost\\w*|cancell\\w*|elimin\\w*|cestin\\w*|togli\\w*|rimuov\\w*|rinomin\\w*|propost[ae]|undo|restore|revert|history|move|delete|remove|rename|proposal|roll\\s*back|bring\\s+back|(previous|earlier)\\s+version|as\\s+it\\s+was|recover|trash|discard)', // i18n-ignore
);

export const needsRareTools: RareToolsCheck = (request) => RARE_REQUEST.test(request);

/**
 * The words of a request whose answer reads better drawn (a table, a chart, key numbers, a
 * comparison, steps; D-162). The instinct's `ui` use adds Jev's answer in OR with these:
 * measured on 23/10/2026 on 38 labelled requests, the words alone 29/38, Jev 33/38.
 */
const UI_REQUEST = wordRegex(
  '\\b(confront\\w*|compar\\w*|tabell\\w*|table|grafic\\w*|chart|andament\\w*|trend|numeri|numbers|prezz\\w*|pric\\w*|percentual\\w*|statistic\\w*|riepilog\\w*|passi|steps|checklist|status|stato\\s+de|month\\s+by\\s+month|mese\\s+per\\s+mese|categori\\w*|quale\\s+.*\\s+tra|which\\s+one|vs\\.?|versus)\\b', // i18n-ignore
);

/** Does the request ask for data that is easier to read drawn? */
export const needsDrawnBlock: RareToolsCheck = (request) => UI_REQUEST.test(request);

export interface TurnToolsOptions {
  /** Text of the request of this turn (the user's message, or the brief's goal). */
  request: string;
  /** The agent's chain is free models only (`isFreeChain`). */
  free: boolean;
  /** The agent may write anywhere in the vault (`**`). */
  writesEverywhere: boolean;
  needsRare?: RareToolsCheck;
}

/** The tools of `tools` this turn gets (order kept). */
export function turnTools(tools: readonly string[], options: TurnToolsOptions): string[] {
  const rare = options.free && !(options.needsRare ?? needsRareTools)(options.request);
  return tools.filter(
    (t) =>
      !(t === 'vault_propose' && options.writesEverywhere) &&
      !(options.free && GRAPH_VAULT_TOOLS.includes(t)) &&
      !(rare && RARE_VAULT_TOOLS.includes(t)),
  );
}

/** The agent with the tools of this turn (the definition of the team is not changed). */
export function withTurnTools(
  agent: AgentDefinition,
  request: string,
  needsRare?: RareToolsCheck,
): AgentDefinition {
  const tools = turnTools(agent.config.tools, {
    request,
    free: isFreeChain(agent.config.models),
    writesEverywhere: agent.config.vault.write.includes('**'),
    ...(needsRare ? { needsRare } : {}),
  });
  return tools.length === agent.config.tools.length
    ? agent
    : { ...agent, config: { ...agent.config, tools } };
}

/**
 * The agent of this turn and its own tools that wait for `tools_search` (D-134): what
 * `withTurnTools` takes away on a free chain (the rare note tools when the request is not about
 * them, links and tags) stays in the run, deferred and named by the card, so the monster can
 * load it instead of saying it has no tool to delete a note. Only `vault_propose` for who
 * writes everywhere goes: it has `vault_write`.
 */
export function withTurnDeferrals(
  agent: AgentDefinition,
  request: string,
  needsRare?: RareToolsCheck,
): { agent: AgentDefinition; deferred: Map<string, string> } {
  const sent = new Set(withTurnTools(agent, request, needsRare).config.tools);
  const writesEverywhere = agent.config.vault.write.includes('**');
  const tools = agent.config.tools.filter((t) => !(t === 'vault_propose' && writesEverywhere));
  const deferred = new Map(tools.filter((t) => !sent.has(t)).map((t) => [t, 'note'] as const));
  return {
    agent:
      tools.length === agent.config.tools.length
        ? agent
        : { ...agent, config: { ...agent.config, tools } },
    deferred,
  };
}

const sameRef = (a: ModelRef, b: ModelRef) => a.provider === b.provider && a.model === b.model;

/**
 * The chain with the model that served this agent earlier in the run first
 * (review AG-25): with `openrouter/free` every delegation could land on another
 * model. A model of the router goes first only when it is a free one.
 */
export function pinnedChain(models: readonly ModelRef[], served: ModelRef | undefined): ModelRef[] {
  if (!served || (models[0] && sameRef(models[0], served))) return [...models];
  if (models.some((m) => sameRef(m, served))) {
    return [served, ...models.filter((m) => !sameRef(m, served))];
  }
  const viaRouter =
    served.provider === 'openrouter' &&
    served.model.endsWith(':free') &&
    models.some((m) => m.provider === 'openrouter' && m.model === 'openrouter/free');
  return viaRouter ? [{ ...served }, ...models] : [...models];
}
