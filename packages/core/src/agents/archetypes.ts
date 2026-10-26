import type { ModelRef } from '@monsters/providers';
import { vaultLayout, type Lang, type VaultLayout } from '@monsters/shared';
import { archetypeTexts } from './archetypes.prompts.ts';
import type { OrchestratorBlueprint, SubagentBlueprint } from './templates.ts';

/*
 * Starting agents of the MVP (DECISIONS D-006): Rhea (research) and Dione
 * (writing), plus the orchestrator blueprint. The onboarding personalises them
 * with the user's name and one sentence of context.
 */

/**
 * Free chain suggested for the first key (research 02 §1): two free models with
 * good tool calling, then the free router as last resort. The catalog changes:
 * the onboarding should refresh it from the live model list.
 */
export const DEFAULT_FREE_CHAIN: ModelRef[] = [
  { provider: 'openrouter', model: 'nvidia/nemotron-3-ultra-550b-a55b:free' },
  { provider: 'openrouter', model: 'poolside/laguna-s-2.1:free' },
  { provider: 'openrouter', model: 'openrouter/free' },
];

/**
 * Models gone upstream, with the one that takes their place in every chain
 * (D-165): nemotron-3-super:free answers 404 since 23/10/2026.
 */
export const RETIRED_MODELS: Readonly<Record<string, ModelRef>> = {
  'openrouter/nvidia/nemotron-3-super-120b-a12b:free': {
    provider: 'openrouter',
    model: 'nvidia/nemotron-3-ultra-550b-a55b:free',
  },
};

/**
 * The chain with its retired models replaced (each link keeps its tier), or null when none is.
 * When two links collapse into one, the stronger tier is kept (`[old(light), new(strong)]`
 * stays strong).
 */
export function replaceRetired<T extends ModelRef & { tier?: 'light' | 'strong' | undefined }>(
  models: readonly T[],
): T[] | null {
  if (!models.some((m) => RETIRED_MODELS[`${m.provider}/${m.model}`])) return null;
  const out: T[] = [];
  for (const m of models) {
    const next = RETIRED_MODELS[`${m.provider}/${m.model}`];
    const link = next ? { ...m, provider: next.provider, model: next.model } : m;
    const same = out.findIndex((x) => x.provider === link.provider && x.model === link.model);
    if (same < 0) out.push(link);
    else if (link.tier === 'strong' && out[same]!.tier !== 'strong') {
      out[same] = { ...out[same]!, tier: 'strong' };
    }
  }
  return out;
}

/** The successor of a retired model, or the model itself (a model chosen by hand, a draft). */
export function replaceRetiredRef<T extends ModelRef>(ref: T): T {
  const next = RETIRED_MODELS[`${ref.provider}/${ref.model}`];
  return next ? { ...ref, provider: next.provider, model: next.model } : ref;
}

/**
 * A chain Monsters chose, not the user (D-069): empty, the default free
 * chain, the free router alone, or one whose providers are none of those set
 * up (it cannot run). A subscription that becomes usable replaces it.
 */
export function isDefaultChain(
  models: readonly ModelRef[],
  configured: (provider: string) => boolean,
): boolean {
  if (models.length === 0) return true;
  if (!models.some((m) => configured(m.provider))) return true;
  const same = (a: readonly ModelRef[], b: readonly ModelRef[]) =>
    a.length === b.length &&
    a.every((m, i) => m.provider === b[i]!.provider && m.model === b[i]!.model);
  return (
    same(models, DEFAULT_FREE_CHAIN) ||
    same(models, [{ provider: 'openrouter', model: 'openrouter/free' }])
  );
}

export const VAULT_READ_TOOLS = [
  'vault_search',
  'vault_read',
  'vault_list',
  'vault_links',
  'vault_tags',
];
export const VAULT_WRITE_TOOLS = ['vault_write', 'vault_edit', 'vault_propose'];
/** Every vault tool: the orchestrator has full access to the vault (ARCHITECTURE §6). */
export const ALL_VAULT_TOOLS = [
  ...VAULT_READ_TOOLS,
  ...VAULT_WRITE_TOOLS,
  'vault_move',
  'vault_delete',
  'vault_history',
  'vault_restore',
  'vault_undo',
  'vault_apply_proposal',
];
export const WEB_TOOLS = ['web_search', 'web_fetch'];
/**
 * Least steps of an agent with web tools, when it has its own cap (D-200: none by default):
 * searching, reading 3-5 pages, writing the note and the memory took Rhea past 20 in the
 * Phase 1 demo (DECISIONS D-026).
 */
export const WEB_AGENT_MAX_STEPS = 30;
/** Orchestrator only (ARCHITECTURE §5.4; `team_propose_monster`, D-075). */
export const TEAM_TOOLS = ['delegate', 'ask_user', 'team_propose_monster'];

export interface ArchetypeOptions {
  /** How the agents address the user. */
  user: string;
  /** Name of the orchestrator. Default "Titan". */
  orchestrator?: string;
  /** One sentence about the user, from the onboarding. */
  context?: string;
  models?: ModelRef[];
  /** The family of the texts (D-153): the app's language by default. */
  lang?: Lang;
  /** The vault's folder names (D-154), for the default areas: the vault in use by default. */
  layout?: VaultLayout;
}

export const DEFAULT_ORCHESTRATOR_NAME = 'Titan';

export function rheaBlueprint(options: ArchetypeOptions): SubagentBlueprint {
  const t = archetypeTexts(options.lang).rhea;
  return {
    kind: 'subagent',
    id: 'rhea',
    name: 'Rhea',
    user: options.user,
    orchestrator: options.orchestrator ?? DEFAULT_ORCHESTRATOR_NAME,
    title: t.title,
    summary: t.summary,
    mission: t.mission,
    ...(options.context ? { context: options.context } : {}),
    duties: [...t.duties],
    outputArea: (options.layout ?? vaultLayout()).research,
    report: t.report,
    color: '#4f8df7',
    models: options.models ?? DEFAULT_FREE_CHAIN,
    tools: [...WEB_TOOLS, ...VAULT_READ_TOOLS, 'vault_write', 'vault_edit'],
    limits: { maxOutputTokens: 4000 },
  };
}

export function dioneBlueprint(options: ArchetypeOptions): SubagentBlueprint {
  const t = archetypeTexts(options.lang).dione;
  return {
    kind: 'subagent',
    id: 'dione',
    name: 'Dione',
    user: options.user,
    orchestrator: options.orchestrator ?? DEFAULT_ORCHESTRATOR_NAME,
    title: t.title,
    summary: t.summary,
    mission: t.mission,
    ...(options.context ? { context: options.context } : {}),
    duties: [...t.duties],
    outputArea: (options.layout ?? vaultLayout()).drafts,
    report: t.report,
    color: '#f2994a',
    models: options.models ?? DEFAULT_FREE_CHAIN,
    tools: [...VAULT_READ_TOOLS, ...VAULT_WRITE_TOOLS],
    limits: { maxOutputTokens: 6000 },
  };
}

export function orchestratorBlueprint(
  options: ArchetypeOptions & {
    name?: string;
    language?: string;
    team?: { name: string; summary: string }[];
  },
): OrchestratorBlueprint {
  const name = options.name ?? options.orchestrator ?? DEFAULT_ORCHESTRATOR_NAME;
  const t = archetypeTexts(options.lang);
  return {
    kind: 'orchestrator',
    id:
      name
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'orchestrator',
    name,
    user: options.user,
    // The writing language, a code or a name in either family (rendered in the template's).
    language: options.language ?? 'italiano', // i18n-ignore
    team: options.team ?? [
      { name: 'Rhea', summary: t.rhea.summary },
      { name: 'Dione', summary: t.dione.summary },
    ],
    color: '#9b6dff',
    models: options.models ?? DEFAULT_FREE_CHAIN,
    tools: [...ALL_VAULT_TOOLS, ...WEB_TOOLS, ...TEAM_TOOLS],
  };
}
