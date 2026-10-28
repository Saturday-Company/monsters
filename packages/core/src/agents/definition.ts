import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentIdSchema, AutoModelsSchema, EffortSchema, ProjectIdSchema } from '@monsters/shared';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

/*
 * An agent is a folder (ARCHITECTURE §5.3):
 *   AGENTS.md    role and essential rules, generated from a template
 *   agent.yaml   name, colour, provider chain, tools, vault permissions, limits
 *   genome.json  monster appearance (optional)
 */

export const AGENTS_MD = 'AGENTS.md';
export const AGENT_YAML = 'agent.yaml';
export const GENOME_JSON = 'genome.json';

export const ModelRefSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  /**
   * Tier of the link (D-067): with a `light` and a `strong` model in the chain,
   * the instinct gives simple turns to the light one and hard ones to the
   * strong one, once per turn (never across the model pinned in a run).
   */
  tier: z.enum(['light', 'strong']).optional(),
  /** Effort of the link (D-110): set at run time for "Automatica", not written by the UI. */
  effort: EffortSchema.optional(),
});

/**
 * A chain as stored, cleaned: an older version let a model id with spaces around it, or a blank
 * one, into the file. The spaces go, a link with no model goes (it would fail every call); a chain
 * left empty is refused with the rest of the file.
 */
export function cleanModelChain<T extends { model: string }>(links: readonly T[]): T[] {
  return links.map((l) => ({ ...l, model: l.model.trim() })).filter((l) => l.model !== '');
}

/** A stored chain (`agent.yaml`): cleaned, and at least one link must remain. */
export const ModelChainSchema = z
  .array(ModelRefSchema)
  .transform(cleanModelChain)
  .pipe(z.array(ModelRefSchema).min(1));

/** Vault glob, relative to the vault root (`Risorse/Ricerche/**`). */
const VaultGlobSchema = z
  .string()
  .min(1)
  .refine((g) => !g.startsWith('/') && !g.split('/').includes('..'), {
    message: 'vault globs are relative to the vault and cannot leave it',
  });

/** Vault permissions as globs: what the agent may read and write. */
export const VaultPermissionsSchema = z.object({
  read: z.array(VaultGlobSchema).default(['**']),
  write: z.array(VaultGlobSchema).default([]),
});

export const AgentConfigSchema = z.object({
  id: AgentIdSchema,
  name: z.string().min(1).max(40),
  /** One line: what the agent does (shown in the team and used for routing). */
  role: z.string().min(1).max(200),
  /**
   * `orchestrator`: the single top figure, every generic request goes to it;
   * `lead`: the capo of a project (D-097), an orchestrator inside its project
   * only; `subagent`: everybody else.
   */
  kind: z.enum(['orchestrator', 'lead', 'subagent']).default('subagent'),
  /** The project the monster belongs to (D-097); absent = Squadra personale. */
  project: ProjectIdSchema.optional(),
  /** CSS colour of the monster and of its chat bubbles. */
  color: z.string().regex(/^(#[0-9a-fA-F]{6}|oklch\([^)]*\))$/, 'use #rrggbb or oklch(…)'),
  /** Fallback chain, first link preferred. */
  models: ModelChainSchema,
  /**
   * "Automatica" (D-093): `models` was written from this base level with the
   * tiers, and the settings show the mode instead of the raw chain.
   */
  autoModels: AutoModelsSchema.optional(),
  tools: z.array(z.string().regex(/^[a-z][a-z0-9_]*$/)).default([]),
  vault: VaultPermissionsSchema.default({ read: ['**'], write: [] }),
  limits: z
    .object({
      /**
       * Model calls per run, when the monster has its own cap. None by default (D-200): the job's
       * limits (steps, tokens, spending cap), the loop guard and the stop bound every run.
       */
      maxSteps: z.number().int().min(1).max(200).optional(),
      /** Output tokens per model call. */
      maxOutputTokens: z.number().int().min(64).optional(),
      /** Input + output tokens per run: the loop stops after the step that crosses it. */
      maxTotalTokens: z.number().int().min(1000).optional(),
    })
    .default({}),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type AgentConfigInput = z.input<typeof AgentConfigSchema>;
export type AgentKind = AgentConfig['kind'];

/** The orchestrator and the projects' leads coordinate a squad (`delegate`, `ask_user`). */
export function coordinates(config: Pick<AgentConfig, 'kind'>): boolean {
  return config.kind === 'orchestrator' || config.kind === 'lead';
}

/** The genome schema is owned by the monsters package: here it is only an object. */
export const GenomeSchema = z.record(z.string(), z.unknown());

export interface AgentDefinition {
  /** Folder the agent was loaded from (undefined for in-memory definitions). */
  dir?: string;
  config: AgentConfig;
  /** Content of AGENTS.md. */
  instructions: string;
  genome?: Record<string, unknown>;
}

export class AgentDefinitionError extends Error {
  readonly file: string;
  constructor(file: string, message: string, options?: { cause?: unknown }) {
    super(`${file}: ${message}`, options);
    this.name = 'AgentDefinitionError';
    this.file = file;
  }
}

function formatZod(err: z.ZodError): string {
  return err.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ');
}

export function parseAgentConfig(raw: unknown, file = AGENT_YAML): AgentConfig {
  const parsed = AgentConfigSchema.safeParse(raw);
  if (!parsed.success) throw new AgentDefinitionError(file, formatZod(parsed.error));
  return parsed.data;
}

async function readOptional(path: string): Promise<string | undefined> {
  try {
    return await readFile(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

/** Loads and validates an agent folder. */
export async function loadAgentDefinition(dir: string): Promise<AgentDefinition> {
  const mdPath = join(dir, AGENTS_MD);
  const yamlPath = join(dir, AGENT_YAML);
  const instructions = await readOptional(mdPath);
  if (instructions === undefined) throw new AgentDefinitionError(mdPath, 'missing');
  if (instructions.trim() === '') throw new AgentDefinitionError(mdPath, 'empty');
  const yamlText = await readOptional(yamlPath);
  if (yamlText === undefined) throw new AgentDefinitionError(yamlPath, 'missing');
  let raw: unknown;
  try {
    raw = parseYaml(yamlText);
  } catch (err) {
    throw new AgentDefinitionError(yamlPath, `invalid YAML (${(err as Error).message})`, {
      cause: err,
    });
  }
  const config = parseAgentConfig(raw, yamlPath);

  const def: AgentDefinition = { dir, config, instructions };
  const genomePath = join(dir, GENOME_JSON);
  const genomeText = await readOptional(genomePath);
  if (genomeText !== undefined) {
    let json: unknown;
    try {
      json = JSON.parse(genomeText);
    } catch (err) {
      throw new AgentDefinitionError(genomePath, 'invalid JSON', { cause: err });
    }
    const genome = GenomeSchema.safeParse(json);
    if (!genome.success) throw new AgentDefinitionError(genomePath, 'must be a JSON object');
    def.genome = genome.data;
  }
  return def;
}
