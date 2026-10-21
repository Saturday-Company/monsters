import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AgentAreaSchema,
  AgentIdSchema,
  appLang,
  ProjectIdSchema,
  VAULT_LAYOUTS,
  agentFolder,
  vaultLayout,
  writingLanguageName,
  type Lang,
  type VaultLayout,
} from '@monsters/shared';
import { stringify as stringifyYaml } from 'yaml';
import { z } from 'zod';
import type { InstructionFields } from './instructions.ts';
import {
  TEMPLATE_FAMILIES,
  type AgentTemplates,
  type TemplateFamily,
} from './templates.prompts.ts';
import {
  AGENT_YAML,
  AGENTS_MD,
  AgentConfigSchema,
  GENOME_JSON,
  GenomeSchema,
  ModelRefSchema,
  VaultPermissionsSchema,
  type AgentConfig,
} from './definition.ts';

/*
 * AGENTS.md generation (DECISIONS D-007, research 03 §5 and §7). An LLM (or
 * the onboarding) fills a small JSON blueprint, zod validates it, and the code
 * renders a fixed template (Italian or English, `templates.prompts.ts`, D-153):
 * files stay short, consistent and checkable.
 */

export const MAX_AGENTS_MD_LINES = 40;
const PLACEHOLDER = /\{\{[^}]*\}\}/;

/** One line of plain text: no newlines, no template markers, no Markdown headings. */
const Line = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine((s) => !/[\r\n]/.test(s), 'must be a single line')
    .refine((s) => !PLACEHOLDER.test(s), 'must not contain {{placeholders}}')
    .refine((s) => !s.startsWith('#'), 'must not start with #');

/** Agent names end up in permission globs (`Agenti/<name>/**`, `Agents/<name>/**`): no glob or path syntax. */
const AgentName = Line(40).refine((s) => !/[*?[\]{}/\\]/.test(s), 'no glob or path characters');

const shared = {
  id: AgentIdSchema,
  name: AgentName,
  /** How the agents address the user. */
  user: Line(60),
  color: AgentConfigSchema.shape.color,
  models: z.array(ModelRefSchema).min(1),
  limits: AgentConfigSchema.shape.limits.optional(),
  genome: GenomeSchema.optional(),
  /** Language of the conversation with the user and of the notes. */
  language: Line(30).default('italiano'),
};

export const OrchestratorBlueprintSchema = z.object({
  kind: z.literal('orchestrator'),
  ...shared,
  // Empty when the capo squadra works alone (every other monster archived).
  team: z.array(z.object({ name: Line(40), summary: Line(120) })).max(7),
  tools: z.array(z.string()).default([]),
});

export const SubagentBlueprintSchema = z.object({
  kind: z.literal('subagent'),
  ...shared,
  /** Name of the orchestrator the agent reports to. */
  orchestrator: Line(40),
  /** With article, e.g. "la ricercatrice". */
  title: Line(60),
  /** One line for the team list, e.g. "ricerche online e sintesi con fonti". */
  summary: Line(120),
  /** Second half of the role sentence: what the agent does. */
  mission: Line(200),
  /** One sentence about the user, from the onboarding. */
  context: Line(200).optional(),
  /** "Il tuo lavoro" bullets (besides the fixed ones). */
  duties: z.array(Line(200)).min(1).max(4),
  /**
   * Where results go, e.g. "Risorse/Ricerche". It becomes a write permission:
   * a plain folder, never a glob, the root, the agents' folder or the profile.
   */
  outputArea: AgentAreaSchema,
  /** What the final report contains. */
  report: Line(200),
  tools: z.array(z.string()).default([]),
  vault: VaultPermissionsSchema.optional(),
  /** The project it belongs to (D-097); absent = Squadra personale. */
  project: ProjectIdSchema.optional(),
});

/** The capo of a project (D-097): an orchestrator inside its project only. */
export const LeadBlueprintSchema = z.object({
  kind: z.literal('lead'),
  ...shared,
  /** The project's id (agent.yaml) and its name (AGENTS.md). */
  project: ProjectIdSchema,
  projectName: Line(40),
  /** The project's area of the notes, e.g. "Progetti/Saturday". */
  area: AgentAreaSchema,
  /** Name of the orchestrator above every squad. */
  orchestrator: Line(40),
  team: z.array(z.object({ name: Line(40), summary: Line(120) })).max(7),
  tools: z.array(z.string()).default([]),
  /** What the project is for, one line (a proposal of the orchestrator, D-098). */
  goal: Line(300).optional(),
});

export const AgentBlueprintSchema = z.discriminatedUnion('kind', [
  OrchestratorBlueprintSchema,
  LeadBlueprintSchema,
  SubagentBlueprintSchema,
]);
export type OrchestratorBlueprint = z.input<typeof OrchestratorBlueprintSchema>;
export type LeadBlueprint = z.input<typeof LeadBlueprintSchema>;
export type SubagentBlueprint = z.input<typeof SubagentBlueprintSchema>;
export type AgentBlueprint = z.input<typeof AgentBlueprintSchema>;

export {
  TEMPLATE_FAMILIES,
  type AgentTemplates,
  type TemplateFamily,
} from './templates.prompts.ts';

/** The templates of a family, the app's language by default (a new agent's). */
export function templateFamily(lang: Lang = appLang()): TemplateFamily {
  return TEMPLATE_FAMILIES[lang];
}

/** The current templates of a family. */
export function currentTemplates(lang: Lang = appLang()): Required<AgentTemplates> {
  return TEMPLATE_FAMILIES[lang].current;
}

/** Older Italian templates, newest first (the English family has none yet). */
export const LEGACY_TEMPLATES: readonly AgentTemplates[] = TEMPLATE_FAMILIES.it.legacy;

/** How an agent with web tools searches (D-071), in a family. */
export function webMethod(lang: Lang = appLang()): string {
  return TEMPLATE_FAMILIES[lang].webMethod;
}

/** The sources rule of agents with web tools (D-026), in a family. */
export function sourcesRule(lang: Lang = appLang()): string {
  return TEMPLATE_FAMILIES[lang].sourcesRule;
}

export class TemplateError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`invalid AGENTS.md: ${problems.join('; ')}`);
    this.name = 'TemplateError';
    this.problems = problems;
  }
}

/** Checks a rendered AGENTS.md: under 40 lines, no placeholders left. */
export function checkAgentsMd(text: string): string[] {
  const problems: string[] = [];
  const lines = text.replace(/\n+$/, '').split('\n');
  if (lines.length >= MAX_AGENTS_MD_LINES) {
    problems.push(`${lines.length} lines (max ${MAX_AGENTS_MD_LINES - 1})`);
  }
  const left = text.match(new RegExp(PLACEHOLDER.source, 'g'));
  if (left) problems.push(`placeholders left: ${[...new Set(left)].join(', ')}`);
  if (!lines[0]?.startsWith('# ')) problems.push('must start with a "# Name" heading');
  return problems;
}

/**
 * The templates name the paths of the Italian layout (`profilo.md`): in a vault of another
 * layout, its own (D-154). The Italian layout renders the very text of the templates.
 */
function vaultPaths(text: string, layout: VaultLayout): string {
  const it = VAULT_LAYOUTS.it;
  if (layout.id === it.id) return text;
  return text.replaceAll(`\`${it.profile}\``, `\`${layout.profile}\``);
}

function fill(template: string, values: Record<string, string>, layout: VaultLayout): string {
  // The paths of the template only, never a value that happens to name one.
  const out = vaultPaths(template, layout).replace(
    /\{\{([A-Z_]+)\}\}/g,
    (match, key: string) => values[key] ?? match,
  );
  const problems = checkAgentsMd(out);
  if (problems.length > 0) throw new TemplateError(problems);
  return out;
}

const bullets = (items: string[]) => items.map((i) => `- ${i}`).join('\n');

/**
 * The AGENTS.md of a blueprint with the templates of a family (the current ones of the app's
 * language by default), with the paths of a vault's layout (the vault in use by default,
 * D-154). The writing language is named in the family's own words ("italiano", "Italian"): a
 * blueprint holds either.
 */
export function renderAgentsMd(
  input: AgentBlueprint,
  templates: AgentTemplates = currentTemplates(),
  layout: VaultLayout = vaultLayout(),
): string {
  const bp = AgentBlueprintSchema.parse(input);
  const family = TEMPLATE_FAMILIES[templates.lang];
  const language = writingLanguageName(bp.language, templates.lang);
  if (bp.kind === 'orchestrator') {
    return fill(
      templates.orchestrator,
      {
        NOME: bp.name,
        UTENTE: bp.user,
        LINGUA: language,
        SQUADRA:
          bp.team.length > 0
            ? bullets(bp.team.map((m) => `**${m.name}**: ${m.summary}`))
            : family.noTeam,
      },
      layout,
    );
  }
  if (bp.kind === 'lead') {
    return fill(
      templates.lead ?? family.current.lead,
      {
        NOME: bp.name,
        UTENTE: bp.user,
        LINGUA: language,
        PROGETTO: bp.projectName,
        OBIETTIVO: bp.goal ? family.goal(bp.goal.replace(/\.$/, '')) : '',
        AREA: bp.area,
        ORCHESTRATORE: bp.orchestrator,
        SQUADRA:
          bp.team.length > 0
            ? bullets(bp.team.map((m) => `**${m.name}**: ${m.summary}`))
            : family.noTeam,
      },
      layout,
    );
  }
  const web = bp.tools.some((t) => t.startsWith('web_'));
  return fill(
    templates.subagent,
    {
      NOME: bp.name,
      TITOLO: bp.title,
      UTENTE: bp.user,
      MISSIONE: bp.mission.replace(/\.$/, ''),
      CONTESTO: bp.context ? ` ${bp.context}` : '',
      ORCHESTRATORE: bp.orchestrator,
      COMPITI: bullets(bp.duties),
      AREA: bp.outputArea,
      LINGUA: language,
      RAPPORTO: bp.report.replace(/\.$/, ''),
      FONTI: web ? `\n- ${family.sourcesRule}` : '',
      WEB: web ? family.webMethod : '',
    },
    layout,
  );
}

/**
 * The agent.yaml of a blueprint; the roles of the capi are written in the family `lang`, the
 * permissions name the folders of the vault's layout (D-154).
 */
export function blueprintToConfig(
  input: AgentBlueprint,
  lang: Lang = appLang(),
  layout: VaultLayout = vaultLayout(),
): AgentConfig {
  const bp = AgentBlueprintSchema.parse(input);
  const family = TEMPLATE_FAMILIES[lang];
  const own = `${agentFolder(layout, bp.name)}/**`;
  const inbox = `${layout.inbox}/**`;
  return AgentConfigSchema.parse({
    id: bp.id,
    name: bp.name,
    kind: bp.kind,
    role:
      bp.kind === 'orchestrator'
        ? family.orchestratorRole(bp.user)
        : bp.kind === 'lead'
          ? family.leadRole(bp.projectName)
          : bp.summary,
    color: bp.color,
    models: bp.models,
    tools: bp.tools,
    // The project's area is not written here: the team adds it from project.yaml (D-097).
    vault:
      bp.kind === 'orchestrator'
        ? { read: ['**'], write: ['**'] }
        : bp.kind === 'lead'
          ? { read: ['**'], write: [own, inbox] }
          : (bp.vault ?? {
              read: ['**'],
              write: [own, inbox, `${bp.outputArea}/**`],
            }),
    ...(bp.kind !== 'orchestrator' && bp.project ? { project: bp.project } : {}),
    ...(bp.limits ? { limits: bp.limits } : {}),
  });
}

export interface AgentFiles {
  [AGENTS_MD]: string;
  [AGENT_YAML]: string;
  [GENOME_JSON]?: string;
}

/** Renders the files of an agent folder from a blueprint, for a vault of `layout`. */
export function renderAgentFiles(
  input: AgentBlueprint,
  lang: Lang = appLang(),
  layout: VaultLayout = vaultLayout(),
): AgentFiles {
  const bp = AgentBlueprintSchema.parse(input);
  const config = blueprintToConfig(bp, lang, layout);
  const files: AgentFiles = {
    [AGENTS_MD]: renderAgentsMd(bp, currentTemplates(lang), layout),
    [AGENT_YAML]: stringifyYaml(config, { lineWidth: 0 }),
  };
  if (bp.genome) files[GENOME_JSON] = `${JSON.stringify(bp.genome, null, 2)}\n`;
  return files;
}

/** Fields an AGENTS.md was rendered from, kept next to it so the team can change later. */
export const BLUEPRINT_JSON = 'blueprint.json';

/** The template fields of a blueprint (what `blueprint.json` keeps, see instructions.ts). */
export function fieldsOf(input: AgentBlueprint): InstructionFields {
  const bp = AgentBlueprintSchema.parse(input);
  if (bp.kind === 'orchestrator') {
    return {
      kind: 'orchestrator',
      name: bp.name,
      user: bp.user,
      language: bp.language,
      team: bp.team,
    };
  }
  if (bp.kind === 'lead') {
    return {
      kind: 'lead',
      name: bp.name,
      user: bp.user,
      language: bp.language,
      project: bp.projectName,
      area: bp.area,
      orchestrator: bp.orchestrator,
      team: bp.team,
      ...(bp.goal ? { goal: bp.goal } : {}),
    };
  }
  return {
    kind: 'subagent',
    name: bp.name,
    user: bp.user,
    orchestrator: bp.orchestrator,
    language: bp.language,
    title: bp.title,
    summary: bp.summary,
    mission: bp.mission,
    ...(bp.context ? { context: bp.context } : {}),
    duties: bp.duties,
    outputArea: bp.outputArea,
    report: bp.report,
    web: bp.tools.some((t) => t.startsWith('web_')),
  };
}

/**
 * Writes (or overwrites) an agent folder from a blueprint, with the fields of
 * its AGENTS.md in `blueprint.json`. Returns the folder path.
 */
export async function writeAgentFolder(
  dir: string,
  input: AgentBlueprint,
  extra: { archetype?: 'rhea' | 'dione' | null; layout?: VaultLayout } = {},
): Promise<string> {
  const files = renderAgentFiles(input, appLang(), extra.layout ?? vaultLayout());
  await mkdir(dir, { recursive: true });
  for (const [name, content] of Object.entries(files) as [string, string | undefined][]) {
    if (content !== undefined) await writeFile(join(dir, name), content, 'utf8');
  }
  const fields = fieldsOf(input);
  if (fields.kind === 'subagent' && extra.archetype !== undefined) {
    fields.archetype = extra.archetype;
  }
  await writeFile(join(dir, BLUEPRINT_JSON), `${JSON.stringify(fields, null, 2)}\n`, 'utf8');
  return dir;
}
