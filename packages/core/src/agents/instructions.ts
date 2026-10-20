import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentAreaSchema } from '@monsters/shared';
import { z } from 'zod';
import { WEB_TOOLS } from './archetypes.ts';
import { AGENTS_MD, type AgentConfig } from './definition.ts';
import {
  BLUEPRINT_JSON,
  CURRENT_TEMPLATES,
  LEGACY_TEMPLATES,
  SOURCES_RULE,
  renderAgentsMd,
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

/** AGENTS.md of `fields` (throws `TemplateError` or a zod error when they do not fit). */
export function renderFields(
  fields: InstructionFields,
  config: AgentConfig,
  templates: AgentTemplates = CURRENT_TEMPLATES,
): string {
  return renderAgentsMd(blueprintOf(fields, config), templates);
}

const same = (a: string, b: string) => a.replace(/\s+$/, '') === b.replace(/\s+$/, '');

/** True when `fields` render exactly `text` with `templates` (the file was not edited by hand). */
export function rendersTo(
  fields: InstructionFields,
  config: AgentConfig,
  text: string,
  templates: AgentTemplates = CURRENT_TEMPLATES,
): boolean {
  try {
    return same(renderFields(fields, config, templates), text);
  } catch {
    return false;
  }
}

/** `text` is what `fields` render with an older template (never edited by hand since). */
export function rendersToLegacy(
  fields: InstructionFields,
  config: AgentConfig,
  text: string,
): boolean {
  return LEGACY_TEMPLATES.some((t) => rendersTo(fields, config, text, t));
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
 * (teams created before `blueprint.json`). Null unless they render the very
 * same text: a file edited by hand is never mistaken for a template.
 */
export function parseInstructions(
  text: string,
  config: AgentConfig,
  templates: readonly AgentTemplates[] = [CURRENT_TEMPLATES],
): InstructionFields | null {
  // A lead always has its blueprint.json (D-097): nothing older to read back.
  if (config.kind === 'lead') return null;
  try {
    const fields =
      config.kind === 'orchestrator'
        ? parseOrchestrator(text, config)
        : parseSubagent(text, config);
    if (!fields) return null;
    return templates.some((t) => rendersTo(fields, config, text, t)) ? fields : null;
  } catch {
    return null;
  }
}

function parseOrchestrator(text: string, config: AgentConfig): OrchestratorFields | null {
  const name = config.name;
  const user = between(text, `Sei ${name}, il coordinatore della squadra di `, '. Ricevi ogni');
  const language = /niente gergo, in (.+)\.\s*$/.exec(text)?.[1];
  const section = between(text, '## La squadra\n', '\n\n## ');
  if (user === null || !language || section === null) return null;
  const team: OrchestratorFields['team'] = [];
  for (const line of section.split('\n')) {
    const m = /^- \*\*(.+?)\*\*: (.+)$/.exec(line);
    if (m) team.push({ name: m[1]!, summary: m[2]! });
  }
  return { kind: 'orchestrator', name, user, language, team };
}

function parseSubagent(text: string, config: AgentConfig): SubagentFields | null {
  const lines = text.split('\n');
  const name = config.name;
  const intro = lines.find((l) => l.startsWith(`Sei ${name}, `));
  if (!intro) return null;
  const rest = intro.slice(`Sei ${name}, `.length);
  const marker = ' della squadra di ';
  const at = rest.indexOf(marker);
  if (at < 0) return null;
  const title = rest.slice(0, at);
  const afterTitle = rest.slice(at + marker.length);
  const colon = afterTitle.indexOf(': ');
  if (colon < 0) return null;
  const user = afterTitle.slice(0, colon);
  const sentence = afterTitle.slice(colon + 2);
  const dot = sentence.indexOf('. ');
  const mission = dot >= 0 ? sentence.slice(0, dot) : sentence.replace(/\.$/, '');
  const context = dot >= 0 ? sentence.slice(dot + 2) : undefined;

  const work = lines.indexOf('## Il tuo lavoro');
  if (work < 0) return null;
  const orchestrator = between(lines[work + 1] ?? '', '- Ricevi incarichi da ', ' e lavori fino');
  if (orchestrator === null) return null;
  const duties: string[] = [];
  let area: string | null = null;
  for (const line of lines.slice(work + 2)) {
    const save = between(line, '- Salvi i risultati in `', '/`');
    if (save !== null) {
      area = save;
      break;
    }
    if (!line.startsWith('- ')) return null;
    duties.push(line.slice(2));
  }
  const language = between(text, '- Sempre in ', ', anche quando');
  const report =
    between(text, `Il tuo ultimo messaggio è il rapporto per ${orchestrator}: `, '. Niente log') ??
    // Template before D-065.
    between(text, `Rispondi a ${orchestrator} con: `, '. Niente log.');
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
    web: text.includes(SOURCES_RULE),
  };
}

export interface Instructions {
  /** Current AGENTS.md. */
  text: string;
  /** Fields it was rendered from (blueprint.json or read back), null when unknown. */
  fields: InstructionFields | null;
  /** The file is exactly what the fields render: it can be re-rendered without losing anything. */
  pristine: boolean;
}

/** The AGENTS.md of an agent folder and the fields behind it. */
export async function loadInstructions(dir: string, config: AgentConfig): Promise<Instructions> {
  const text = await readFile(join(dir, AGENTS_MD), 'utf8');
  const stored = await readFields(dir);
  if (stored) return { text, fields: stored, pristine: rendersTo(stored, config, text) };
  const parsed = parseInstructions(text, config);
  return { text, fields: parsed, pristine: parsed !== null };
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
  const fields = stored ?? parseInstructions(text, config, LEGACY_TEMPLATES);
  if (!fields || rendersTo(fields, config, text) || !rendersToLegacy(fields, config, text)) {
    return null;
  }
  let next: string;
  try {
    next = renderFields(fields, config);
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
 * Replaces the bullets of the "## La squadra" section of an orchestrator's
 * AGENTS.md ("## La squadra del progetto" for a project's lead, D-097).
 */
export function replaceTeamSection(
  text: string,
  team: readonly { name: string; summary: string }[],
  heading = '## La squadra',
): string {
  const lines = text.split('\n');
  const start = lines.indexOf(heading);
  if (start < 0) return text;
  let end = start + 1;
  while (end < lines.length && !lines[end]!.startsWith('## ')) end++;
  const body = teamBullets(team);
  return [...lines.slice(0, start + 1), ...body.split('\n'), '', ...lines.slice(end)].join('\n');
}

/** Bullets of the team section (one line when the capo squadra works alone). */
export function teamBullets(team: readonly { name: string; summary: string }[]): string {
  return team.length > 0
    ? team.map((m) => `- **${m.name}**: ${m.summary}`).join('\n')
    : '- Per ora nessuno: lavori da solo.';
}
