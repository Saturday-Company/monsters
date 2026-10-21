import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  AgentAreaSchema,
  appLang,
  LANGS,
  VAULT_LAYOUT_IDS,
  VAULT_LAYOUTS,
  vaultLayout,
  writingLanguage,
  type Lang,
  type VaultLayout,
} from '@monsters/shared';
import { z } from 'zod';
import { WEB_TOOLS } from './archetypes.ts';
import { AGENTS_MD, type AgentConfig } from './definition.ts';
import {
  BLUEPRINT_JSON,
  currentTemplates,
  renderAgentsMd,
  TEMPLATE_FAMILIES,
  type AgentBlueprint,
  type AgentTemplates,
} from './templates.ts';

/*
 * The fields an AGENTS.md was rendered from (`blueprint.json` next to it), so
 * the team can be changed after the onboarding: a rename, a new role, another
 * user name re-render the file from the same fixed template. Teams created
 * before this file existed are read back from their AGENTS.md, only when the
 * file renders back exactly (never edited by hand). A file edited by hand is
 * never rewritten silently: names are replaced in place, the rest needs `force`.
 * A file rendered by an older template is rendered again with the current one
 * when the team loads (`upgradeInstructions`, D-065).
 *
 * Two families of templates, Italian and English (D-153): a file keeps the family
 * it was written in, whatever the app's language is now. Every reader here tries
 * both, and a file is rendered again only with the templates of its own family.
 */

/** Copy of an AGENTS.md edited by hand, kept when it is rewritten with `force`. */
export const AGENTS_MD_BACKUP = 'AGENTS.md.bak';

const Text = z.string().min(1);

export const SubagentFieldsSchema = z.object({
  kind: z.literal('subagent'),
  name: Text,
  user: Text,
  orchestrator: Text,
  language: Text,
  title: Text,
  summary: Text,
  mission: Text,
  context: z.string().optional(),
  duties: z.array(Text).min(1),
  outputArea: AgentAreaSchema,
  report: Text,
  /** Rendered with the web sources rule (the agent has web tools). */
  web: z.boolean(),
  archetype: z.enum(['rhea', 'dione']).nullable().optional(),
});
export type SubagentFields = z.infer<typeof SubagentFieldsSchema>;

export const OrchestratorFieldsSchema = z.object({
  kind: z.literal('orchestrator'),
  name: Text,
  user: Text,
  language: Text,
  team: z.array(z.object({ name: Text, summary: Text })),
});
export type OrchestratorFields = z.infer<typeof OrchestratorFieldsSchema>;

/** The capo of a project (D-097): `project` is its name, `area` its notes. */
export const LeadFieldsSchema = z.object({
  kind: z.literal('lead'),
  name: Text,
  user: Text,
  language: Text,
  project: Text,
  area: AgentAreaSchema,
  orchestrator: Text,
  team: z.array(z.object({ name: Text, summary: Text })),
  /** What the project is for (D-098). */
  goal: Text.optional(),
});
export type LeadFields = z.infer<typeof LeadFieldsSchema>;

export const InstructionFieldsSchema = z.discriminatedUnion('kind', [
  SubagentFieldsSchema,
  OrchestratorFieldsSchema,
  LeadFieldsSchema,
]);
export type InstructionFields = z.infer<typeof InstructionFieldsSchema>;

/** A blueprint that renders `fields` (id, colour and models come from the agent's config). */
export function blueprintOf(fields: InstructionFields, config: AgentConfig): AgentBlueprint {
  const base = { id: config.id, color: config.color, models: config.models };
  if (fields.kind === 'orchestrator') {
    return {
      ...base,
      kind: 'orchestrator',
      name: fields.name,
      user: fields.user,
      language: fields.language,
      team: fields.team,
    };
  }
  if (fields.kind === 'lead') {
    return {
      ...base,
      kind: 'lead',
      name: fields.name,
      user: fields.user,
      language: fields.language,
      project: config.project ?? 'progetto',
      projectName: fields.project,
      area: fields.area,
      orchestrator: fields.orchestrator,
      team: fields.team,
      ...(fields.goal ? { goal: fields.goal } : {}),
    };
  }
  return {
    ...base,
    ...(config.project ? { project: config.project } : {}),
    kind: 'subagent',
    name: fields.name,
    user: fields.user,
    orchestrator: fields.orchestrator,
    language: fields.language,
    title: fields.title,
    summary: fields.summary,
    mission: fields.mission,
    ...(fields.context ? { context: fields.context } : {}),
    duties: fields.duties,
    outputArea: fields.outputArea,
    report: fields.report,
    tools: fields.web ? [...WEB_TOOLS] : [],
  };
}

/**
 * AGENTS.md of `fields` (throws `TemplateError` or a zod error when they do not fit), with the
 * current templates of the app's language unless told otherwise: pass the file's family
 * (`familyOf`) to render an existing agent again.
 */
export function renderFields(
  fields: InstructionFields,
  config: AgentConfig,
  templates: AgentTemplates = currentTemplates(),
  layout: VaultLayout = vaultLayout(),
): string {
  return renderAgentsMd(blueprintOf(fields, config), templates, layout);
}

/** The vault in use first, then the other layouts: a file names the paths of the vault it was written for (D-154). */
function layoutsToTry(): VaultLayout[] {
  const current = vaultLayout();
  return [
    current,
    ...VAULT_LAYOUT_IDS.filter((id) => id !== current.id).map((id) => VAULT_LAYOUTS[id]),
  ];
}

const same = (a: string, b: string) => a.replace(/\s+$/, '') === b.replace(/\s+$/, '');

const CURRENT_SETS: readonly AgentTemplates[] = LANGS.map((l) => TEMPLATE_FAMILIES[l].current);
const LEGACY_SETS: readonly AgentTemplates[] = LANGS.flatMap((l) => TEMPLATE_FAMILIES[l].legacy);

/**
 * True when `fields` render exactly `text` (the file was not edited by hand): with `templates`,
 * or else with the current templates of either family.
 */
export function rendersTo(
  fields: InstructionFields,
  config: AgentConfig,
  text: string,
  templates?: AgentTemplates,
): boolean {
  return renderedWith(fields, config, text, templates ? [templates] : CURRENT_SETS) !== null;
}

/** The first of `sets` with which `fields` render exactly `text` (in a vault of either layout), or null. */
function renderedWith(
  fields: InstructionFields,
  config: AgentConfig,
  text: string,
  sets: readonly AgentTemplates[],
): AgentTemplates | null {
  return matchOf(fields, config, text, sets)?.templates ?? null;
}

function matchOf(
  fields: InstructionFields,
  config: AgentConfig,
  text: string,
  sets: readonly AgentTemplates[],
): { templates: AgentTemplates; layout: VaultLayout } | null {
  for (const t of sets) {
    for (const layout of layoutsToTry()) {
      try {
        if (same(renderFields(fields, config, t, layout), text)) return { templates: t, layout };
      } catch {
        // Fields that do not fit these templates: not this one.
      }
    }
  }
  return null;
}

/** `text` is what `fields` render with an older template (never edited by hand since). */
export function rendersToLegacy(
  fields: InstructionFields,
  config: AgentConfig,
  text: string,
): boolean {
  return renderedWith(fields, config, text, LEGACY_SETS) !== null;
}

/**
 * The family an AGENTS.md is written in: the one whose templates render it from `fields` when
 * they do, else the one its first sentence reads as ("Sei …," / "You are …,"), else the app's.
 * A file edited by hand keeps its language when it is rewritten.
 */
export function familyOf(
  text: string,
  fields?: InstructionFields | null,
  config?: AgentConfig,
): Lang {
  if (fields && config) {
    const t = renderedWith(fields, config, text, [...CURRENT_SETS, ...LEGACY_SETS]);
    if (t) return t.lang;
  }
  const first = LANGS.map((l) => ({ l, at: TEMPLATE_FAMILIES[l].parse.looksLike.exec(text) }))
    .filter((x) => x.at !== null)
    .sort((a, b) => a.at!.index - b.at!.index)[0];
  return first?.l ?? appLang();
}

/** `blueprint.json` of an agent folder, or null (missing or unreadable). */
export async function readFields(dir: string): Promise<InstructionFields | null> {
  try {
    const parsed = InstructionFieldsSchema.safeParse(
      JSON.parse(await readFile(join(dir, BLUEPRINT_JSON), 'utf8')),
    );
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export async function writeFields(dir: string, fields: InstructionFields): Promise<void> {
  await writeFile(join(dir, BLUEPRINT_JSON), `${JSON.stringify(fields, null, 2)}\n`, 'utf8');
}

function between(text: string, start: string, end: string): string | null {
  const i = text.indexOf(start);
  if (i < 0) return null;
  const j = text.indexOf(end, i + start.length);
  if (j < 0) return null;
  return text.slice(i + start.length, j);
}

/**
 * Reads the fields back from an AGENTS.md rendered by the fixed template
 * (teams created before `blueprint.json`), of either family. Null unless they
 * render the very same text with one of `templates` (the current ones of both
 * families by default): a file edited by hand is never mistaken for a template.
 */
export function parseInstructions(
  text: string,
  config: AgentConfig,
  templates: readonly AgentTemplates[] = CURRENT_SETS,
): InstructionFields | null {
  // A lead always has its blueprint.json (D-097): nothing older to read back.
  if (config.kind === 'lead') return null;
  for (const lang of LANGS) {
    const sets = templates.filter((t) => t.lang === lang);
    if (sets.length === 0) continue;
    try {
      const fields =
        config.kind === 'orchestrator'
          ? parseOrchestrator(text, config, lang)
          : parseSubagent(text, config, lang);
      if (fields && renderedWith(fields, config, text, sets)) return fields;
    } catch {
      // Not this family.
    }
  }
  return null;
}

function parseOrchestrator(
  text: string,
  config: AgentConfig,
  lang: Lang,
): OrchestratorFields | null {
  const family = TEMPLATE_FAMILIES[lang];
  const name = config.name;
  const user = between(text, ...family.parse.orchestratorUser(name));
  const language = family.parse.orchestratorLanguage.exec(text)?.[1];
  const section = between(text, `${family.teamHeading}\n`, '\n\n## ');
  if (user === null || !language || section === null) return null;
  const team: OrchestratorFields['team'] = [];
  for (const line of section.split('\n')) {
    const m = /^- \*\*(.+?)\*\*: (.+)$/.exec(line);
    if (m) team.push({ name: m[1]!, summary: m[2]! });
  }
  return { kind: 'orchestrator', name, user, language, team };
}

function parseSubagent(text: string, config: AgentConfig, lang: Lang): SubagentFields | null {
  const family = TEMPLATE_FAMILIES[lang];
  const p = family.parse;
  const lines = text.split('\n');
  const name = config.name;
  const start = p.subagentIntro(name);
  const intro = lines.find((l) => l.startsWith(start));
  if (!intro) return null;
  const parts = p.subagentTitleUser(intro.slice(start.length));
  if (!parts) return null;
  const { title, user, sentence } = parts;
  const dot = sentence.indexOf('. ');
  const mission = dot >= 0 ? sentence.slice(0, dot) : sentence.replace(/\.$/, '');
  const context = dot >= 0 ? sentence.slice(dot + 2) : undefined;

  const work = lines.indexOf(p.workHeading);
  if (work < 0) return null;
  const orchestrator = between(lines[work + 1] ?? '', ...p.orchestratorOfSubagent);
  if (orchestrator === null) return null;
  const duties: string[] = [];
  let area: string | null = null;
  for (const line of lines.slice(work + 2)) {
    const save = between(line, ...p.area);
    if (save !== null) {
      area = save;
      break;
    }
    if (!line.startsWith('- ')) return null;
    duties.push(line.slice(2));
  }
  const language = between(text, ...p.language);
  let report: string | null = null;
  for (const [a, b] of p.report(orchestrator)) {
    report = between(text, a, b);
    if (report !== null) break;
  }
  if (area === null || language === null || report === null) return null;
  return {
    kind: 'subagent',
    name,
    user,
    orchestrator,
    language,
    title,
    summary: config.role,
    mission,
    ...(context ? { context } : {}),
    duties,
    outputArea: area,
    report,
    web: text.includes(family.sourcesRule),
  };
}

export interface Instructions {
  /** Current AGENTS.md. */
  text: string;
  /** Fields it was rendered from (blueprint.json or read back), null when unknown. */
  fields: InstructionFields | null;
  /** The file is exactly what the fields render: it can be re-rendered without losing anything. */
  pristine: boolean;
  /** The family it is written in: it is rendered again in this one (D-153). */
  lang: Lang;
}

/** The fields and the family of an AGENTS.md, from its `blueprint.json` (`stored`) or read back. */
export function instructionsOf(
  text: string,
  stored: InstructionFields | null,
  config: AgentConfig,
): Instructions {
  if (stored) {
    const t = renderedWith(stored, config, text, CURRENT_SETS);
    return { text, fields: stored, pristine: t !== null, lang: t?.lang ?? familyOf(text) };
  }
  const parsed = parseInstructions(text, config);
  return { text, fields: parsed, pristine: parsed !== null, lang: familyOf(text, parsed, config) };
}

/** The AGENTS.md of an agent folder and the fields behind it. */
export async function loadInstructions(dir: string, config: AgentConfig): Promise<Instructions> {
  const text = await readFile(join(dir, AGENTS_MD), 'utf8');
  return instructionsOf(text, await readFields(dir), config);
}

/**
 * Renders again with the current template an AGENTS.md that an older template
 * rendered and nobody edited since (`blueprint.json` or the file read back),
 * so teams created earlier get the new rules. Writes `blueprint.json` when it
 * was missing. Returns the new text, or null when nothing changed (current
 * already, edited by hand, unknown fields).
 */
export async function upgradeInstructions(
  dir: string,
  config: AgentConfig,
): Promise<string | null> {
  const text = await readFile(join(dir, AGENTS_MD), 'utf8');
  const stored = await readFields(dir);
  const fields = stored ?? parseInstructions(text, config, LEGACY_SETS);
  if (!fields || rendersTo(fields, config, text)) return null;
  // Again in the family it was written in, whatever the app's language is now.
  const old = matchOf(fields, config, text, LEGACY_SETS);
  if (!old) return null;
  let next: string;
  try {
    next = renderFields(fields, config, TEMPLATE_FAMILIES[old.templates.lang].current, old.layout);
  } catch {
    return null;
  }
  await writeFile(join(dir, AGENTS_MD), next, 'utf8');
  if (!stored) await writeFields(dir, fields);
  return next;
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Replaces `from` as a whole word (letters on both sides stop it), case-sensitive. */
export function replaceWord(text: string, from: string, to: string): string {
  if (from === to || from === '') return text;
  const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escapeRegex(from)}(?![\\p{L}\\p{N}_])`, 'gu');
  return text.replace(re, () => to);
}

/**
 * Replaces the writing language `from` with `to` (codes or names in either family, D-153):
 * `from` as written, then its name in each family with the name of `to` in the same family,
 * so an Italian file says "spagnolo" and an English one "Spanish".
 */
export function replaceLanguage(text: string, from: string, to: string): string {
  let out = replaceWord(text, from, to);
  const a = writingLanguage(from);
  const b = writingLanguage(to);
  if (!a || !b) return out;
  for (const lang of LANGS) out = replaceWord(out, a[lang], b[lang]);
  return out;
}

/**
 * Replaces the bullets of the team section of an orchestrator's AGENTS.md ("## La squadra",
 * "## The squad"; a project lead's, `lead`, "## La squadra del progetto", "## The project’s
 * squad", D-097), in the family the file is written in.
 */
export function replaceTeamSection(
  text: string,
  team: readonly { name: string; summary: string }[],
  lead = false,
): string {
  const lines = text.split('\n');
  for (const lang of LANGS) {
    const family = TEMPLATE_FAMILIES[lang];
    const start = lines.indexOf(lead ? family.leadTeamHeading : family.teamHeading);
    if (start < 0) continue;
    let end = start + 1;
    while (end < lines.length && !lines[end]!.startsWith('## ')) end++;
    const body = teamBullets(team, lang);
    return [...lines.slice(0, start + 1), ...body.split('\n'), '', ...lines.slice(end)].join('\n');
  }
  return text;
}

/** Bullets of the team section (one line when the capo squadra works alone), in a family. */
export function teamBullets(
  team: readonly { name: string; summary: string }[],
  lang: Lang = appLang(),
): string {
  return team.length > 0
    ? team.map((m) => `- **${m.name}**: ${m.summary}`).join('\n')
    : TEMPLATE_FAMILIES[lang].noTeam;
}
