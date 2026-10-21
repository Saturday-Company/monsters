import { existsSync } from 'node:fs';
import { mkdir, readFile, readdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  MonsterGenomeSchema,
  ROSTER,
  hashString,
  isRosterName,
  type MonsterGenome,
} from '@monsters/monster-kit';
import { errorMessage, type ModelRef, type ProviderRegistry } from '@monsters/providers';
import {
  appLang,
  ASK_ALWAYS_EXTRAS,
  ASK_ALWAYS_FIXED,
  AGENT_NAME_PATTERN,
  autoChain,
  AgentAreaSchema,
  EventInputSchema,
  MAX_DUTIES,
  MAX_TEAM_MEMBERS,
  TeamMemberCreateRequestSchema,
  isOpenRouterFreeModel,
  MOON_NAMES,
  ONBOARDING_QUESTIONS,
  isReservedActor,
  isClaudePlanChain,
  LANGS,
  type Lang,
  type ArchivedMemberView,
  type Channel,
  type LogEvent,
  type Project,
  type ProjectLeadPlan,
  type ProfileUpdate,
  type ProfileView,
  type ProposedAgent,
  type TeamArchiveResponse,
  type TeamDraft,
  type TeamDraftRequest,
  type TeamLooksRequest,
  type TeamLooksResponse,
  type TeamMemberCreateRequest,
  type TeamMemberUpdate,
  type TeamMemberView,
  type TeamRestoreRequest,
  type TeamSuggestions,
  type TeamView,
} from '@monsters/shared';
import type { VaultActor, VaultService } from '@monsters/vault';
import { parseDocument } from 'yaml';
import { z } from 'zod';
import {
  DEFAULT_FREE_CHAIN,
  TEAM_TOOLS,
  VAULT_READ_TOOLS,
  VAULT_WRITE_TOOLS,
  WEB_AGENT_MAX_STEPS,
  WEB_TOOLS,
  dioneBlueprint,
  rheaBlueprint,
} from '../agents/archetypes.ts';
import {
  AGENT_YAML,
  AGENTS_MD,
  GENOME_JSON,
  loadAgentDefinition,
  type AgentDefinition,
} from '../agents/definition.ts';
import {
  AGENTS_MD_BACKUP,
  InstructionFieldsSchema,
  instructionsOf,
  renderFields,
  replaceLanguage,
  replaceTeamSection,
  replaceWord,
  type InstructionFields,
  type Instructions,
} from '../agents/instructions.ts';
import {
  BLUEPRINT_JSON,
  currentTemplates,
  TemplateError,
  TEMPLATE_FAMILIES,
  renderAgentFiles,
  writeAgentFolder,
  type LeadBlueprint,
} from '../agents/templates.ts';
import type { RunController } from '../kill/run-controller.ts';
import type { EventLog } from '../log/event-log.ts';
import {
  colorOfGenome,
  designMonster,
  minHueDistance,
  monsterForMember,
  pickHue,
} from '../onboarding/monsters.ts';
import {
  cleanName,
  contextSentence,
  decisionRulesFrom,
  profileFromAnswers,
  renderProfile,
  type Answers,
  type Profile,
} from '../onboarding/profile.ts';
import { PROFILE_TEXTS } from '../onboarding/profile.prompts.ts';
import {
  genericReport,
  LlmAgentSchema,
  agentId,
  allowedNames,
  memberBlueprint,
  toolsFor,
  type Generate,
  type GenerateError,
} from '../onboarding/proposal.ts';
import { PROFILE_PATH, providerGenerate, type OnboardingService } from '../onboarding/service.ts';
import { patchSettingsFile } from '../onboarding/settings-file.ts';
import { extractJson, resolveDecisionRules, type DecisionGate } from './decision.ts';
import { proposalText } from './proposal-text.ts';
import type { MonsterProposal, MonsterProposalInput } from './propose-monster.ts';
import type { QuestionStore } from './questions.ts';
import type { HubSettings } from './settings.ts';
import type { TeamService } from './team-service.ts';
import { TEAM_MANAGER_PROMPTS, teamManagerPrompts } from './team-manager.prompts.ts';
import { teamManagerStrings } from './team-manager.strings.ts';

/*
 * The team after the onboarding (Settings → Squadra, contract in
 * shared/src/team.ts). The id of a monster never changes: chats, delegations,
 * questions and the notes it wrote point to it, so a rename only changes what
 * is shown, the memory folder `Agenti/<Name>/` (moved with git, links
 * rewritten) and the AGENTS.md files that name it. Archiving moves the folder
 * to `MONSTERS_HOME/archive/agents/<id>`: nothing is deleted, the chat stays in
 * the log, the monster can come back. AGENTS.md files edited by hand are never
 * rewritten silently (names are replaced in place; a new role needs `force`).
 * Changes are serialised, logged as `team_change`, and structural ones wait
 * until nobody is working.
 */

export const ARCHIVE_DIR = join('archive', 'agents');
const ARCHIVED_JSON = 'archived.json';
const MIN_HUE_DISTANCE = 30;

export type TeamErrorCode =
  | 'onboarding_pending'
  | 'unknown_agent'
  | 'invalid_request'
  | 'invalid_name'
  | 'busy'
  | 'orchestrator'
  | 'instructions_edited'
  | 'memory_conflict'
  | 'color_too_close'
  | 'team_full'
  | 'name_taken'
  | 'halted'
  | 'unknown_proposal'
  | 'proposal_closed'
  | 'unknown_project'
  | 'project_draft'
  | 'project_archived';

export class TeamError extends Error {
  readonly code: TeamErrorCode;
  constructor(code: TeamErrorCode, message: string) {
    super(message);
    this.name = 'TeamError';
    this.code = code;
  }
}

export interface TeamManagerDeps {
  home: string;
  team: TeamService;
  vault: VaultService;
  log: EventLog;
  /** Kill switch: no model call for a draft while halted, and a kill stops it. */
  runs: Pick<RunController, 'halted' | 'signal'>;
  settings: HubSettings;
  gate: DecisionGate;
  questions: QuestionStore;
  onboarding: OnboardingService;
  providers: ProviderRegistry;
  /** Model call of a made-to-measure draft (tests); `null` = always the fallback. */
  generate?: Generate | null;
}

/** Contents written at the end of an operation, read back by the next step of the same one. */
class Pending {
  readonly #files = new Map<string, string>();

  async read(path: string): Promise<string> {
    return this.#files.get(path) ?? (await readFile(path, 'utf8'));
  }

  async readOptional(path: string): Promise<string | null> {
    try {
      return await this.read(path);
    } catch {
      return null;
    }
  }

  set(path: string, content: string): void {
    this.#files.set(path, content);
  }

  async commit(): Promise<void> {
    // Each file is written aside and renamed over the old one: a crash in the middle leaves the
    // old file whole, never a truncated agent.yaml or AGENTS.md that does not load (F-B6).
    for (const [path, content] of this.#files) {
      const tmp = `${path}.${process.pid}.tmp`;
      try {
        await writeFile(tmp, content, 'utf8');
        await rename(tmp, path);
      } catch (err) {
        await rm(tmp, { force: true });
        throw err;
      }
    }
    this.#files.clear();
  }
}

/** How an AGENTS.md changes: through its fields, or as text when it was edited by hand. */
interface InstructionChange {
  fields: (f: InstructionFields) => InstructionFields;
  /** Same change on a file edited by hand; absent → it needs `force` (a new role). */
  text?: (text: string) => string;
  force?: boolean | undefined;
}

interface Move {
  from: string;
  to: string;
}

const lowerFirst = (s: string) =>
  /^\p{Lu}\p{Ll}/u.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;

const clipLine = (s: string, max: number) => {
  const one = s.replace(/\s+/g, ' ').trim();
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one;
};

function formatZod(err: z.ZodError): string {
  return err.issues
    .slice(0, 6)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

const DraftAnswerSchema = z.union([
  z.object({ agents: z.array(LlmAgentSchema).min(1) }),
  z.object({ agent: LlmAgentSchema }),
  LlmAgentSchema,
]);

export class TeamManager {
  readonly #d: TeamManagerDeps;
  /** One change at a time: each starts from what the previous one wrote. */
  #queue: Promise<unknown> = Promise.resolve();

  constructor(deps: TeamManagerDeps) {
    this.#d = deps;
  }

  get archiveDir(): string {
    return join(this.#d.home, ARCHIVE_DIR);
  }

  #serial<T>(work: () => T | Promise<T>): Promise<T> {
    const next = this.#queue.then(work);
    this.#queue = next.catch(() => undefined);
    return next;
  }

  #assertReady(): void {
    if (!this.#d.onboarding.done) {
      throw new TeamError('onboarding_pending', teamManagerStrings().onboardingPending);
    }
  }

  #agent(id: string): AgentDefinition {
    const def = this.#d.team.byId(id);
    if (!def?.dir) throw new TeamError('unknown_agent', `no agent ${id}`);
    return def;
  }

  #assertIdle(): void {
    const busy = this.#d.team.working();
    if (busy.length === 0) return;
    throw new TeamError('busy', teamManagerStrings().busy(busy));
  }

  /** The monsters of a squad besides its capo: the Squadra personale, or a project (D-097). */
  #subagents(project?: string): AgentDefinition[] {
    return this.#d.team.members(project).filter((a) => a.config.kind === 'subagent');
  }

  /** The squad of a monster: its project's id, or undefined (Squadra personale). */
  #squadOf(def: AgentDefinition): string | undefined {
    return this.#d.team.projectOf(def.config.id)?.id;
  }

  /** The capo of a squad: the project's lead, or the orchestrator. */
  #coordinatorOf(project: string | undefined): AgentDefinition | undefined {
    return project ? this.#d.team.lead(project) : this.#d.team.orchestrator();
  }

  /** A project that exists and is in use (D-097). */
  #activeProject(id: string): Project {
    const p = this.#d.team.project(id);
    if (!p) throw new TeamError('unknown_project', teamManagerStrings().unknownProject(id));
    if (p.archivedAt !== undefined) {
      throw new TeamError('project_archived', teamManagerStrings().projectArchived(p.name));
    }
    if (p.status === 'draft') {
      throw new TeamError('project_draft', teamManagerStrings().projectDraft(p.name));
    }
    return p;
  }

  #event(data: {
    action: 'add' | 'rename' | 'edit' | 'look' | 'archive' | 'restore' | 'profile';
    agent?: string;
    name?: string;
    from?: string;
    fields?: string[];
    by: Channel;
  }): void {
    this.#d.log.append({ agent: 'user', type: 'team_change', data });
  }

  #actor(): VaultActor {
    const { log } = this.#d;
    return {
      agentId: 'system',
      emit: (e) =>
        log.append(EventInputSchema.parse({ agent: 'system', type: e.type, data: e.data })),
    };
  }

  // --- profile ---------------------------------------------------------------

  /** The user's profile now: the answers of the first start, names from the team. */
  #profile(answers: Answers = this.#d.onboarding.answers(), lang: Lang = appLang()): Profile {
    const p = profileFromAnswers(answers, lang);
    const orchestrator = this.#d.team.orchestrator()?.config.name;
    return {
      ...p,
      userName: this.#d.settings.userName || p.userName,
      ...(orchestrator ? { orchestratorName: orchestrator } : {}),
    };
  }

  profile(): ProfileView {
    this.#assertReady();
    const answers = this.#d.onboarding.answers();
    const p = this.#profile(answers);
    const tono = ONBOARDING_QUESTIONS.find((q) => q.id === 'tono')!;
    const group = (id: string) => tono.groups.find((g) => g.id === id)!;
    const chosen = answers['chiedi']?.values['cosa'] ?? [];
    return {
      userName: p.userName,
      orchestratorName: p.orchestratorName,
      tone: answers['tono']?.values['tono']?.[0] ?? group('tono').defaults[0] ?? 'amichevole',
      language: p.languageId,
      style: p.styleNotes ?? '',
      askAlways: {
        fixed: ASK_ALWAYS_FIXED.map((id) => ({
          id,
          label: teamManagerStrings().askLabels[id] ?? id,
        })),
        extras: ASK_ALWAYS_EXTRAS.filter((id) => chosen.includes(id)),
        text: p.askFirstText ?? '',
      },
      options: {
        tones: group('tono').options,
        languages: group('lingua').options,
        extras: ASK_ALWAYS_EXTRAS.map((id) => ({
          id,
          label: teamManagerStrings().askLabels[id] ?? id,
        })),
      },
    };
  }

  updateProfile(req: ProfileUpdate, by: Channel): Promise<ProfileView> {
    return this.#serial(() => this.#updateProfile(req, by));
  }

  async #updateProfile(req: ProfileUpdate, by: Channel): Promise<ProfileView> {
    this.#assertReady();
    const { settings, team, home, onboarding, gate } = this.#d;
    const answers = structuredClone(onboarding.answers());
    const before = this.#profile(answers);
    const previousTone = answers['tono']?.values['tono']?.[0];
    const tono = ONBOARDING_QUESTIONS.find((q) => q.id === 'tono')!;
    const options = (id: string) => tono.groups.find((g) => g.id === id)!.options;
    if (req.tone !== undefined && !options('tono').some((o) => o.id === req.tone)) {
      throw new TeamError('invalid_request', `unknown tone ${req.tone}`);
    }
    if (req.language !== undefined && !options('lingua').some((o) => o.id === req.language)) {
      throw new TeamError('invalid_request', `unknown language ${req.language}`);
    }
    const userName = req.userName !== undefined ? cleanName(req.userName) : before.userName;
    const fields: string[] = [];
    if (userName !== before.userName) fields.push('userName');
    const orchestrator = team.orchestrator();
    const renameOrchestrator =
      req.orchestratorName !== undefined &&
      orchestrator !== undefined &&
      cleanName(req.orchestratorName) !== orchestrator.config.name;
    const languageChanged = req.language !== undefined && req.language !== before.languageId;
    if (renameOrchestrator || languageChanged) this.#assertIdle();
    if (renameOrchestrator) {
      // Checked before anything is written: a refused name leaves the profile as it was.
      const name = this.#checkName(req.orchestratorName!, orchestrator.config.id);
      await this.#planMemoryMoves(orchestrator.config.name, name);
    }

    // The answers stay the source of the profile.
    const nomi = answers['nomi'] ?? { values: {} };
    nomi.values = { ...nomi.values, user: [userName] };
    answers['nomi'] = nomi;
    const tone = answers['tono'] ?? { values: { tono: ['amichevole'], lingua: [appLang()] } };
    tone.values = {
      ...tone.values,
      ...(req.tone !== undefined ? { tono: [req.tone] } : {}),
      ...(req.language !== undefined ? { lingua: [req.language] } : {}),
    };
    if (req.style !== undefined) tone.text = req.style;
    answers['tono'] = tone;
    if (req.askAlways) {
      answers['chiedi'] = {
        values: { cosa: [...ASK_ALWAYS_FIXED, ...new Set(req.askAlways.extras)] },
        text: req.askAlways.text,
      };
    }
    if (req.tone !== undefined && req.tone !== previousTone) fields.push('tone');
    if (languageChanged) fields.push('language');
    if (req.style !== undefined && req.style !== (before.styleNotes ?? '')) fields.push('style');
    if (req.askAlways) fields.push('askAlways');
    const after = profileFromAnswers(answers);

    // Every AGENTS.md names the user and speaks the language.
    const pending = new Pending();
    if (userName !== before.userName || languageChanged) {
      for (const def of team.list()) {
        await this.#planInstructions(pending, def, {
          fields: (f) => ({
            ...f,
            user: userName,
            language: after.language,
            ...(f.kind === 'subagent' && f.context
              ? { context: replaceWord(f.context, before.userName, userName) }
              : {}),
          }),
          text: (t) =>
            replaceLanguage(
              replaceWord(t, before.userName, userName),
              before.language,
              after.language,
            ),
        });
      }
      if (orchestrator && userName !== before.userName) {
        // The role in the family it was written in (D-153).
        const role = orchestrator.config.role;
        const lang =
          LANGS.find((l) => role === TEMPLATE_FAMILIES[l].orchestratorRole(before.userName)) ??
          appLang();
        await this.#planYaml(pending, orchestrator, (doc) =>
          doc.set('role', TEMPLATE_FAMILIES[lang].orchestratorRole(userName)),
        );
      }
    }
    await pending.commit();
    onboarding.saveAnswers(answers);
    if (userName !== before.userName) {
      patchSettingsFile(home, { userName });
      settings.userName = userName;
    }
    if (req.askAlways) {
      const profile = profileFromAnswers(answers);
      const decisions = decisionRulesFrom(profile);
      const saved = patchSettingsFile(home, { decisions });
      const rules = ((saved['decisions'] as { rules?: unknown[] } | undefined)?.rules ??
        []) as HubSettings['decisions']['rules'];
      settings.decisions = { ...settings.decisions, rules, disabled: decisions.disabled };
      gate.setRules(resolveDecisionRules(rules, decisions.disabled));
    }
    await team.load();
    if (renameOrchestrator && orchestrator) {
      await this.#rename(orchestrator.config.id, cleanName(req.orchestratorName!), by);
    }
    await this.#writeProfileNote(after, userName);
    if (fields.length > 0) this.#event({ action: 'profile', fields, by });
    return this.profile();
  }

  /**
   * `profilo.md`: only the lines the settings manage change, the rest is the user's. A note on
   * disk keeps the family it was written in (D-153): its lines are found and written in that one.
   */
  async #writeProfileNote(after: Profile, userName: string): Promise<void> {
    const { vault, team, settings } = this.#d;
    const orchestratorName = team.orchestrator()?.config.name ?? after.orchestratorName;
    const full = { ...after, userName, orchestratorName };
    let current: { content: string; hash: string } | null = null;
    try {
      const note = await vault.read({ agentId: 'system' }, { path: PROFILE_PATH, max_chars: 1e6 });
      current = { content: note.content ?? '', hash: note.hash };
    } catch (err) {
      if ((err as { code?: string }).code !== 'NOT_FOUND') throw err;
    }
    if (!current) {
      await vault.write(this.#actor(), {
        path: PROFILE_PATH,
        content: renderProfile(full, settings.permissions),
        frontmatter: { type: 'profile', tags: ['profilo'] },
      });
      return;
    }
    let text = current.content;
    const lang =
      LANGS.find((l) => PROFILE_TEXTS[l].lines.titleRe.test(text)) ??
      LANGS.find((l) => lineRe(PROFILE_TEXTS[l].lines.name).test(text)) ??
      after.lang;
    const words =
      after.lang === lang ? after : profileFromAnswers(this.#d.onboarding.answers(), lang);
    const t = PROFILE_TEXTS[lang].lines;
    // Function replacers: a `$` typed by the user stays a `$`.
    const line = (re: RegExp, value: string) => {
      text = text.replace(re, () => value);
    };
    line(t.titleRe, t.title(userName));
    line(lineRe(t.name), `${t.name}${userName}`);
    line(lineRe(t.coordinator), `${t.coordinator}${orchestratorName}`);
    line(lineRe(t.tone), `${t.tone}${words.tone}`);
    line(lineRe(t.language), `${t.language}${words.language}`);
    if (words.styleNotes) {
      if (lineRe(t.style).test(text)) line(lineRe(t.style), `${t.style}${words.styleNotes}`);
      else {
        text = text.replace(
          new RegExp(`^(${escapeRegex(t.language)}.*)$`, 'm'),
          (m) => `${m}\n${t.style}${words.styleNotes}`,
        );
      }
    } else {
      text = text.replace(new RegExp(`^${escapeRegex(t.style)}.*\n?`, 'm'), '');
    }
    const ask = [
      ...words.askFirst.map((id) => PROFILE_TEXTS[lang].ask[id] ?? id),
      ...(words.askFirstText ? [words.askFirstText] : []),
    ];
    const section = `${t.askHeading}\n${ask.map((a) => `- ${a}`).join('\n')}\n`;
    const lines = text.split('\n');
    const start = lines.indexOf(t.askHeading);
    if (start >= 0) {
      let end = start + 1;
      while (end < lines.length && !lines[end]!.startsWith('## ')) end++;
      text = [...lines.slice(0, start), ...section.split('\n'), ...lines.slice(end)].join('\n');
    } else {
      text = `${text.replace(/\s+$/, '')}\n\n${section}`;
    }
    if (text === current.content) return;
    await vault.write(this.#actor(), {
      path: PROFILE_PATH,
      content: text,
      mode: 'overwrite',
      base_hash: current.hash,
    });
  }

  // --- view ------------------------------------------------------------------

  /** The Squadra personale: the projects' monsters are in `GET /api/projects` (D-097). */
  async view(): Promise<TeamView> {
    this.#assertReady();
    const members: TeamMemberView[] = [];
    for (const def of this.#d.team.members()) members.push(await this.#memberView(def));
    return { members, archived: await this.#archived(), maxMembers: MAX_TEAM_MEMBERS };
  }

  async member(id: string): Promise<TeamMemberView> {
    return this.#memberView(this.#agent(id));
  }

  async #memberView(def: AgentDefinition): Promise<TeamMemberView> {
    const pending = new Pending();
    const { fields, pristine } = await this.#instructions(pending, def);
    const declared = this.#d.team.declaredTools(def.config.id);
    const web =
      fields?.kind === 'subagent' ? fields.web : declared.some((t) => WEB_TOOLS.includes(t));
    const isOrchestrator = def.config.kind === 'orchestrator';
    const project = this.#squadOf(def);
    return {
      id: def.config.id,
      name: def.config.name,
      role: def.config.role,
      color: def.config.color,
      genome: def.genome ?? null,
      isOrchestrator,
      ...(project ? { project, isLead: def.config.kind === 'lead' } : {}),
      state: this.#d.team.state(def.config.id).state,
      ...(fields?.kind === 'subagent'
        ? {
            title: fields.title,
            mission: fields.mission,
            duties: fields.duties,
            area: fields.outputArea,
          }
        : def.config.kind === 'subagent' && this.#areaOf(def)
          ? { area: this.#areaOf(def)! }
          : {}),
      web,
      instructionsEdited: !pristine,
    };
  }

  /** The results folder of a subagent from its write globs (not its memory, not Inbox). */
  #areaOf(def: AgentDefinition): string | undefined {
    return def.config.vault.write
      .filter((g) => g.endsWith('/**') && !g.startsWith('Agenti/') && g !== 'Inbox/**')
      .map((g) => g.slice(0, -3))[0];
  }

  async #archived(): Promise<ArchivedMemberView[]> {
    const out: ArchivedMemberView[] = [];
    let entries: string[];
    try {
      entries = (await readdir(this.archiveDir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
    for (const name of entries) {
      const dir = join(this.archiveDir, name);
      try {
        const def = await loadAgentDefinition(dir);
        // `<id>.<time>`: an older copy set aside, not restorable from here.
        if (def.config.id !== name) continue;
        let archivedAt = 0;
        try {
          const meta = JSON.parse(await readFile(join(dir, ARCHIVED_JSON), 'utf8')) as {
            archivedAt?: unknown;
          };
          if (typeof meta.archivedAt === 'number') archivedAt = meta.archivedAt;
        } catch {
          // no metadata: shown last
        }
        out.push({
          id: def.config.id,
          name: def.config.name,
          role: def.config.role,
          color: def.config.color,
          genome: def.genome ?? null,
          archivedAt,
        });
      } catch {
        // not an agent folder: ignored
      }
    }
    return out.sort((a, b) => b.archivedAt - a.archivedAt);
  }

  // --- names -------------------------------------------------------------------

  /**
   * A valid, free name: unique among the live monsters, and its id never the id
   * of another one (`@Nome` and the ids share one namespace). Returns it clean.
   */
  #checkName(raw: string, self?: string): string {
    const name = cleanName(raw);
    if (!AGENT_NAME_PATTERN.test(name)) {
      throw new TeamError('invalid_name', teamManagerStrings().invalidName(name));
    }
    const id = agentId(name);
    if (isReservedActor(id)) {
      throw new TeamError('invalid_name', teamManagerStrings().reservedName(name));
    }
    for (const other of this.#d.team.list()) {
      if (other.config.id === self) continue;
      if (other.config.name.toLowerCase() === name.toLowerCase()) {
        throw new TeamError(
          'invalid_name',
          teamManagerStrings().monsterNameTaken(other.config.name),
        );
      }
      if (agentId(other.config.name) === id || other.config.id === id) {
        throw new TeamError(
          'invalid_name',
          teamManagerStrings().nameTooSimilar(name, other.config.name),
        );
      }
    }
    // Nor a project's name or id (D-103): `@Nome` and `to` find one thing only.
    const key = name.toLowerCase();
    for (const p of this.#d.team.projects()) {
      if (p.name.toLowerCase() === key || p.id === key || p.id === id) {
        throw new TeamError('invalid_name', teamManagerStrings().projectNameTaken(p.name));
      }
    }
    return name;
  }

  /** An id nobody has, had or will get back from the archive. */
  #freeId(base: string): string {
    const taken = (id: string) =>
      isReservedActor(id) ||
      this.#d.team.byId(id) !== undefined ||
      existsSync(join(this.#d.team.dir, id)) ||
      existsSync(join(this.archiveDir, id)) ||
      this.#d.log.query({ agent: id, limit: 1 }).length > 0;
    if (!taken(base)) return base;
    for (let i = 2; i < 1000; i++) {
      const id = `${base.slice(0, 60)}-${i}`;
      if (!taken(id)) return id;
    }
    throw new TeamError('invalid_name', 'no free id for this name');
  }

  // --- files -------------------------------------------------------------------

  async #instructions(pending: Pending, def: AgentDefinition): Promise<Instructions> {
    const dir = def.dir!;
    const text = await pending.read(join(dir, AGENTS_MD));
    const raw = await pending.readOptional(join(dir, BLUEPRINT_JSON));
    let stored: InstructionFields | null = null;
    if (raw !== null) {
      try {
        const parsed = InstructionFieldsSchema.safeParse(JSON.parse(raw));
        if (parsed.success) stored = parsed.data;
      } catch {
        stored = null;
      }
    }
    return instructionsOf(text, stored, def.config);
  }

  /** Fields for a file edited by hand with nothing to read back (`force` only). */
  #defaultFields(def: AgentDefinition, lang: Lang): InstructionFields {
    const p = this.#profile(undefined, lang);
    const t = TEAM_MANAGER_PROMPTS[lang];
    const top = this.#d.team.orchestrator()?.config.name ?? p.orchestratorName;
    const squad = this.#squadOf(def);
    if (def.config.kind === 'orchestrator') {
      return {
        kind: 'orchestrator',
        name: def.config.name,
        user: p.userName,
        language: p.language,
        team: this.#teamList(undefined),
      };
    }
    const project = squad ? this.#d.team.project(squad) : undefined;
    if (def.config.kind === 'lead' && project) {
      return {
        kind: 'lead',
        name: def.config.name,
        user: p.userName,
        language: p.language,
        project: project.name,
        area: project.vaultArea,
        orchestrator: top,
        team: this.#teamList(project.id),
      };
    }
    // The capo a monster reports to: its project's lead, or the orchestrator.
    const orchestrator = (squad ? this.#d.team.lead(squad)?.config.name : undefined) ?? top;
    const area = AgentAreaSchema.safeParse(this.#areaOf(def) ?? `Risorse/${def.config.name}`);
    return {
      kind: 'subagent',
      name: def.config.name,
      user: p.userName,
      orchestrator,
      language: p.language,
      title: t.helperTitle,
      summary: def.config.role,
      mission: lowerFirst(def.config.role.replace(/\.$/, '')),
      context: contextSentence(p),
      duties: [t.defaultDuty(orchestrator)],
      outputArea: area.success ? area.data : `Risorse/${def.config.name}`,
      report: genericReport(lang),
      web: this.#d.team.declaredTools(def.config.id).some((t) => WEB_TOOLS.includes(t)),
    };
  }

  /** Plans the new AGENTS.md (and blueprint.json) of an agent. Throws before anything is written. */
  async #planInstructions(
    pending: Pending,
    def: AgentDefinition,
    change: InstructionChange,
  ): Promise<void> {
    const dir = def.dir!;
    const current = await this.#instructions(pending, def);
    // Rendered again in the family the file is written in (D-153), not the app's language now.
    if (current.pristine && current.fields) {
      const next = change.fields(current.fields);
      pending.set(join(dir, AGENTS_MD), this.#render(next, def, current.lang));
      pending.set(join(dir, BLUEPRINT_JSON), `${JSON.stringify(next, null, 2)}\n`);
      return;
    }
    if (change.text && !change.force) {
      pending.set(join(dir, AGENTS_MD), change.text(current.text));
      if (current.fields) {
        pending.set(
          join(dir, BLUEPRINT_JSON),
          `${JSON.stringify(change.fields(current.fields), null, 2)}\n`,
        );
      }
      return;
    }
    if (!change.force) {
      throw new TeamError(
        'instructions_edited',
        teamManagerStrings().instructionsEdited(def.config.name),
      );
    }
    const next = change.fields(current.fields ?? this.#defaultFields(def, current.lang));
    pending.set(join(dir, AGENTS_MD_BACKUP), current.text);
    pending.set(join(dir, AGENTS_MD), this.#render(next, def, current.lang));
    pending.set(join(dir, BLUEPRINT_JSON), `${JSON.stringify(next, null, 2)}\n`);
  }

  #render(fields: InstructionFields, def: AgentDefinition, lang: Lang): string {
    try {
      return renderFields(fields, def.config, currentTemplates(lang));
    } catch (err) {
      const message =
        err instanceof TemplateError
          ? err.problems.join('; ')
          : err instanceof z.ZodError
            ? formatZod(err)
            : (err as Error).message;
      throw new TeamError('invalid_request', `${fields.name}: ${message}`);
    }
  }

  async #planYaml(
    pending: Pending,
    def: AgentDefinition,
    edit: (doc: ReturnType<typeof parseDocument>, raw: Record<string, unknown>) => void,
  ): Promise<void> {
    const path = join(def.dir!, AGENT_YAML);
    const doc = parseDocument(await pending.read(path));
    edit(doc, (doc.toJS() ?? {}) as Record<string, unknown>);
    pending.set(path, doc.toString());
  }

  /** Team list of a capo's AGENTS.md (the orchestrator, or a project's lead), after `change`. */
  #teamList(
    project: string | undefined,
    change: (list: { id: string; name: string; summary: string }[]) => typeof list = (l) => l,
  ): { name: string; summary: string }[] {
    const list = this.#subagents(project).map((a) => ({
      id: a.config.id,
      name: a.config.name,
      summary: a.config.role,
    }));
    return change(list)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map(({ name, summary }) => ({ name, summary }));
  }

  /** The team list of a squad's capo: the orchestrator's, or a project lead's (D-097). */
  async #planOrchestratorTeam(
    pending: Pending,
    change: (list: { id: string; name: string; summary: string }[]) => typeof list,
    project?: string,
  ): Promise<void> {
    const capo = this.#coordinatorOf(project);
    if (!capo?.dir) return;
    const team = this.#teamList(project, change);
    await this.#planInstructions(pending, capo, {
      fields: (f) => (f.kind === 'orchestrator' || f.kind === 'lead' ? { ...f, team } : f),
      text: (t) => replaceTeamSection(t, team, project !== undefined),
    });
  }

  /** Memory notes of `Agenti/<from>/` and where they go; refuses to overwrite anything. */
  async #planMemoryMoves(from: string, to: string): Promise<Move[]> {
    const { vault } = this.#d;
    if (from === to) return [];
    const folder = `Agenti/${from}`;
    const list = await vault.list(
      { agentId: 'system' },
      { folder, recursive: true, limit: 100_000 },
    );
    const moves = list.files.map((f) => ({
      from: f.path,
      to: `Agenti/${to}/${f.path.slice(folder.length + 1)}`,
    }));
    const caseOnly = from.toLowerCase() === to.toLowerCase();
    for (const m of moves) {
      if (!caseOnly && existsSync(join(vault.root, m.to))) {
        throw new TeamError('memory_conflict', teamManagerStrings().noteExists(m.to));
      }
    }
    return moves;
  }

  /** Moves the memory notes (with git and the links rewritten); puts them back on a failure. */
  async #moveMemory(moves: Move[], from: string, to: string): Promise<void> {
    const { vault } = this.#d;
    const done: Move[] = [];
    // A change of case only goes through a temporary folder (case-insensitive disks).
    const steps =
      from.toLowerCase() === to.toLowerCase()
        ? [
            ...moves.map((m) => ({
              from: m.from,
              to: m.to.replace(`Agenti/${to}/`, `Agenti/${to} (rinomina)/`),
            })),
            ...moves.map((m) => ({
              from: m.to.replace(`Agenti/${to}/`, `Agenti/${to} (rinomina)/`),
              to: m.to,
            })),
          ]
        : moves;
    try {
      for (const step of steps) {
        await vault.move(this.#actor(), { from: step.from, to: step.to });
        done.push(step);
      }
    } catch (err) {
      for (const step of done.reverse()) {
        try {
          await vault.move(this.#actor(), { from: step.to, to: step.from });
        } catch {
          // best effort: the log has every move
        }
      }
      throw new TeamError(
        'memory_conflict',
        teamManagerStrings().memoryMoveFailed(to, (err as Error).message),
      );
    }
    // The old folder, now empty, goes too (a folder with other files stays).
    try {
      const old = join(vault.root, 'Agenti', from);
      if (from.toLowerCase() !== to.toLowerCase() && (await readdir(old)).length === 0) {
        await rmdir(old);
      }
      const tmp = join(vault.root, 'Agenti', `${to} (rinomina)`);
      if (existsSync(tmp) && (await readdir(tmp)).length === 0) await rmdir(tmp);
    } catch {
      // nothing to clean
    }
  }

  async #reload(): Promise<void> {
    const { team, vault } = this.#d;
    await team.load();
    vault.setPermissions({
      ...team.vaultPermissions(),
      external: vault.permissions.config.external,
    });
  }

  // --- rename and edit -------------------------------------------------------------

  update(id: string, req: TeamMemberUpdate, by: Channel): Promise<TeamMemberView> {
    return this.#serial(async () => {
      this.#assertReady();
      const def = this.#agent(id);
      const isOrchestrator = def.config.kind === 'orchestrator';
      const edits = (['role', 'title', 'mission', 'duties', 'area', 'web'] as const).filter(
        (k) => req[k] !== undefined,
      );
      if (isOrchestrator && edits.length > 0) {
        throw new TeamError('orchestrator', teamManagerStrings().captainRoleLocked);
      }
      if (def.config.kind === 'lead' && edits.length > 0) {
        throw new TeamError('orchestrator', teamManagerStrings().projectLeadRoleLocked);
      }
      const rename = req.name !== undefined && cleanName(req.name) !== def.config.name;
      if (!rename && edits.length === 0) return this.#memberView(def);
      this.#assertIdle();
      if (rename) {
        await this.#rename(id, req.name!, by, edits.length > 0 ? req : undefined);
      } else {
        await this.#edit(def, req, by);
      }
      return this.#memberView(this.#agent(id));
    });
  }

  /** Renames a monster (and applies `edit` in the same go). */
  async #rename(id: string, raw: string, by: Channel, edit?: TeamMemberUpdate): Promise<void> {
    const { settings, home, onboarding } = this.#d;
    const def = this.#agent(id);
    const from = def.config.name;
    const name = this.#checkName(raw, id);
    if (name === from && !edit) return;
    const pending = new Pending();
    const isOrchestrator = def.config.kind === 'orchestrator';
    await this.#planYaml(pending, def, (doc, raw) => {
      doc.set('name', name);
      const write = ((raw['vault'] ?? {}) as { write?: unknown }).write;
      if (Array.isArray(write)) {
        const next = (write as unknown[]).map((g) =>
          g === `Agenti/${from}/**` ? `Agenti/${name}/**` : g,
        );
        doc.setIn(['vault', 'write'], doc.createNode(next));
      }
    });
    await this.#planInstructions(pending, def, {
      fields: (f) => ({ ...f, name }),
      text: (t) => replaceWord(t, from, name),
    });
    if (isOrchestrator || def.config.kind === 'lead') {
      // The monsters that name it: its squad's, and for the orchestrator every lead (D-097).
      const squad = this.#squadOf(def);
      const named = [
        ...this.#subagents(squad),
        ...(isOrchestrator ? this.#d.team.list().filter((a) => a.config.kind === 'lead') : []),
      ];
      for (const sub of named) {
        await this.#planInstructions(pending, sub, {
          fields: (f) =>
            f.kind === 'subagent' || f.kind === 'lead' ? { ...f, orchestrator: name } : f,
          text: (t) => replaceWord(t, from, name),
        });
      }
    } else {
      await this.#planOrchestratorTeam(
        pending,
        (list) =>
          list.map((m) =>
            m.id === id ? { ...m, name, ...(edit?.role ? { summary: edit.role } : {}) } : m,
          ),
        this.#squadOf(def),
      );
    }
    if (edit) await this.#planEdit(pending, def, edit, { team: false });
    const moves = await this.#planMemoryMoves(from, name);
    await this.#moveMemory(moves, from, name);
    await pending.commit();
    if (isOrchestrator) {
      patchSettingsFile(home, { orchestratorName: name });
      settings.orchestratorName = name;
      const answers = onboarding.answers();
      const nomi = answers['nomi'] ?? { values: {} };
      onboarding.saveAnswers({
        nomi: { ...nomi, values: { ...nomi.values, orchestrator: [name] } },
      });
    }
    await this.#reload();
    if (isOrchestrator) {
      await this.#writeProfileNote(this.#profile(), settings.userName);
    }
    this.#event({ action: 'rename', agent: id, name, from, by });
    if (edit) {
      this.#event({ action: 'edit', agent: id, name, fields: this.#editedFields(edit), by });
    }
  }

  #editedFields(req: TeamMemberUpdate): string[] {
    return (['role', 'title', 'mission', 'duties', 'area', 'web'] as const).filter(
      (k) => req[k] !== undefined,
    );
  }

  async #edit(def: AgentDefinition, req: TeamMemberUpdate, by: Channel): Promise<void> {
    const pending = new Pending();
    await this.#planEdit(pending, def, req);
    await pending.commit();
    await this.#reload();
    this.#event({
      action: 'edit',
      agent: def.config.id,
      name: def.config.name,
      fields: this.#editedFields(req),
      by,
    });
  }

  /** Role, title, mission, duties, area, web of a subagent: AGENTS.md, agent.yaml, the capo's list. */
  async #planEdit(
    pending: Pending,
    def: AgentDefinition,
    req: TeamMemberUpdate,
    options: { team: boolean } = { team: true },
  ): Promise<void> {
    const id = def.config.id;
    const current = await this.#instructions(pending, def);
    const oldArea =
      current.fields?.kind === 'subagent' ? current.fields.outputArea : this.#areaOf(def);
    await this.#planInstructions(pending, def, {
      fields: (f) =>
        f.kind === 'subagent'
          ? {
              ...f,
              ...(req.role !== undefined ? { summary: req.role } : {}),
              ...(req.title !== undefined ? { title: req.title } : {}),
              ...(req.mission !== undefined
                ? { mission: lowerFirst(req.mission.replace(/\.$/, '')) }
                : {}),
              ...(req.duties !== undefined ? { duties: req.duties } : {}),
              ...(req.area !== undefined ? { outputArea: req.area } : {}),
              ...(req.web !== undefined ? { web: req.web } : {}),
            }
          : f,
      force: req.force,
    });
    await this.#planYaml(pending, def, (doc, raw) => {
      if (req.role !== undefined) doc.set('role', req.role);
      if (req.area !== undefined) {
        const write = (((raw['vault'] ?? {}) as { write?: unknown }).write ?? []) as string[];
        const next = write.filter((g) => g !== `${oldArea}/**`);
        if (!next.includes(`${req.area}/**`)) next.push(`${req.area}/**`);
        doc.setIn(['vault', 'write'], doc.createNode(next));
      }
      if (req.web !== undefined) {
        const tools = ((raw['tools'] ?? []) as string[]).filter((t) => !WEB_TOOLS.includes(t));
        doc.set('tools', doc.createNode(req.web ? [...WEB_TOOLS, ...tools] : tools));
        if (req.web) {
          const steps = ((raw['limits'] ?? {}) as { maxSteps?: number }).maxSteps ?? 20;
          if (steps < WEB_AGENT_MAX_STEPS) doc.setIn(['limits', 'maxSteps'], WEB_AGENT_MAX_STEPS);
        }
      }
    });
    if (req.role !== undefined && options.team) {
      await this.#planOrchestratorTeam(
        pending,
        (list) => list.map((m) => (m.id === id ? { ...m, summary: req.role! } : m)),
        this.#squadOf(def),
      );
    }
  }

  // --- look ----------------------------------------------------------------------

  /** Validates a genome for an agent: the kit's schema, a colour 30° from the others. */
  #checkGenome(raw: unknown, id: string, project?: string): MonsterGenome {
    const parsed = MonsterGenomeSchema.safeParse({ ...(raw as object), id });
    if (!parsed.success) {
      throw new TeamError('invalid_request', `genome: ${formatZod(parsed.error)}`);
    }
    const genome = parsed.data;
    // 30° from the monsters of the same squad: a project's copy may keep its colour (D-097).
    const self = this.#d.team.byId(id);
    const others = this.#d.team
      .members(self ? this.#squadOf(self) : project)
      .filter((a) => a.config.id !== id)
      .map((a) => MonsterGenomeSchema.safeParse(a.genome))
      .filter((g) => g.success)
      .map((g) => g.data.palette.hue);
    if (minHueDistance(genome.palette.hue, others) < MIN_HUE_DISTANCE) {
      throw new TeamError('color_too_close', teamManagerStrings().colorTooClose);
    }
    return genome;
  }

  /**
   * A proposed monster's colour moved away from its squad's (D-098): the
   * proposal of a project is drawn before its lead exists.
   */
  fitColor(draft: TeamDraft, project: string): TeamDraft {
    const g = MonsterGenomeSchema.safeParse(draft.genome);
    if (!g.success) return draft;
    const hue = Math.round(pickHue(g.data.palette.hue, this.#hues(undefined, project)) * 10) / 10;
    if (hue === g.data.palette.hue) return draft;
    const genome = MonsterGenomeSchema.parse({ ...g.data, palette: { ...g.data.palette, hue } });
    return { ...draft, genome, color: colorOfGenome(genome) };
  }

  /** «È mia»: a marked line of the monster's memory loses the mark (only the user in person). */
  async ownMemoryLine(id: string, line: string): Promise<{ changed: number }> {
    const def = this.#agent(id);
    return { changed: await this.#d.team.ownMemoryLine(def.config.id, line) };
  }

  setLook(id: string, raw: unknown, by: Channel): Promise<TeamMemberView> {
    return this.#serial(async () => {
      this.#assertReady();
      const def = this.#agent(id);
      const genome = this.#checkGenome(raw, id);
      const pending = new Pending();
      const color = colorOfGenome(genome);
      await this.#planYaml(pending, def, (doc) => doc.set('color', color));
      pending.set(join(def.dir!, GENOME_JSON), `${JSON.stringify(genome, null, 2)}\n`);
      await pending.commit();
      await this.#reload();
      this.#event({ action: 'look', agent: id, name: def.config.name, by });
      return this.#memberView(this.#agent(id));
    });
  }

  /** Looks to choose from (nothing saved): the official monster of a roster name, then designed ones. */
  looks(req: TeamLooksRequest): TeamLooksResponse {
    this.#assertReady();
    const count = req.count ?? 3;
    const self = req.agent !== undefined ? this.#agent(req.agent) : undefined;
    const name = self?.config.name ?? cleanName(req.name ?? 'Mostro');
    const id = self?.config.id ?? agentId(name);
    // The squad it is (or will be) in: `#checkGenome` refuses a colour close to one of it.
    const hues = this.#d.team
      .members(self ? this.#squadOf(self) : req.project)
      .filter((a) => a.config.id !== self?.config.id)
      .map((a) => MonsterGenomeSchema.safeParse(a.genome))
      .filter((g) => g.success)
      .map((g) => g.data.palette.hue);
    const current = self?.genome ? JSON.stringify({ ...self.genome, id: '' }) : null;
    const seen = new Set<string>(current ? [current] : []);
    const out: MonsterGenome[] = [];
    const add = (g: MonsterGenome) => {
      const genome = { ...g, id };
      const key = JSON.stringify({ ...genome, id: '' });
      if (seen.has(key) || minHueDistance(genome.palette.hue, hues) < MIN_HUE_DISTANCE) return;
      seen.add(key);
      out.push(genome);
    };
    const key = name.toLowerCase();
    if (isRosterName(key)) {
      add(ROSTER[key].variants.A);
      add(ROSTER[key].variants.B);
    }
    for (let i = 0; out.length < count && i < count * 10; i++) {
      const seed = hashString(`${name}-${Date.now()}-${Math.random()}-${i}`) >>> 0;
      add(designMonster(name, { avoidHues: hues, seed }));
    }
    return {
      looks: out.slice(0, count).map((genome) => ({ genome, color: colorOfGenome(genome) })),
    };
  }

  // --- archive and restore ----------------------------------------------------------

  archive(id: string, by: Channel): Promise<TeamArchiveResponse> {
    return this.#serial(() => this.#archive(id, by));
  }

  /** `withLead`: archiving a whole project (D-097), its lead goes too. */
  async #archive(id: string, by: Channel, withLead = false): Promise<TeamArchiveResponse> {
    {
      this.#assertReady();
      const def = this.#agent(id);
      if (def.config.kind === 'orchestrator') {
        throw new TeamError('orchestrator', teamManagerStrings().captainCantRemove);
      }
      const squad = this.#squadOf(def);
      if (def.config.kind === 'lead' && squad && !withLead) {
        throw new TeamError('orchestrator', teamManagerStrings().projectLeadCantRemove);
      }
      this.#assertIdle();
      const pending = new Pending();
      if (def.config.kind === 'subagent') {
        await this.#planOrchestratorTeam(pending, (list) => list.filter((m) => m.id !== id), squad);
      }
      const archivedAt = Date.now();
      await mkdir(this.archiveDir, { recursive: true, mode: 0o700 });
      const target = join(this.archiveDir, id);
      if (existsSync(target)) {
        await rename(target, join(this.archiveDir, `${id}.${archivedAt}`));
      }
      await writeFile(
        join(def.dir!, ARCHIVED_JSON),
        `${JSON.stringify({ archivedAt, by, name: def.config.name }, null, 2)}\n`,
        'utf8',
      );
      await rename(def.dir!, target);
      await pending.commit();
      await this.#reload();
      // Its open questions would start a run of a monster that is gone.
      const questionsClosed = this.#d.questions.expireOpen({ agent: id }, 'agent_archived');
      this.#event({ action: 'archive', agent: id, name: def.config.name, by });
      return {
        ok: true,
        archived: {
          id,
          name: def.config.name,
          role: def.config.role,
          color: def.config.color,
          genome: def.genome ?? null,
          archivedAt,
        },
        questionsClosed,
      };
    }
  }

  /**
   * Some archived monster among `ids` would come back with the Terminal: its permissions stay
   * in settings.json while it is away (review of 19/10, n. 6). Giving it back is like turning
   * it on in Impostazioni → Permessi, and wants the same recent confirmation.
   */
  restoreGivesShell(ids: readonly string[]): boolean {
    const { team } = this.#d;
    return ids.some(
      (id) =>
        !team.byId(id) &&
        existsSync(join(this.archiveDir, id)) &&
        team.savedPermissionsFor(id).shell === true,
    );
  }

  restore(id: string, req: TeamRestoreRequest, by: Channel): Promise<TeamMemberView> {
    return this.#serial(async () => {
      this.#assertReady();
      const { team } = this.#d;
      const dir = join(this.archiveDir, id);
      let archived: AgentDefinition;
      try {
        archived = await loadAgentDefinition(dir);
      } catch {
        throw new TeamError('unknown_agent', `no archived agent ${id}`);
      }
      if (archived.config.id !== id || team.byId(id) || existsSync(join(team.dir, id))) {
        throw new TeamError('unknown_agent', `no archived agent ${id}`);
      }
      // Back to its squad: its project, when the project is still there (D-097).
      const back = archived.config.project;
      const squad =
        back && this.#d.team.project(back)?.archivedAt === undefined && this.#d.team.project(back)
          ? back
          : undefined;
      if (archived.config.kind === 'lead' && (!squad || this.#d.team.lead(squad))) {
        throw new TeamError(
          'orchestrator',
          teamManagerStrings().leadReturnsWithProject(archived.config.name),
        );
      }
      if (
        archived.config.kind === 'subagent' &&
        this.#subagents(squad).length >= MAX_TEAM_MEMBERS
      ) {
        throw new TeamError('team_full', teamManagerStrings().teamFull(MAX_TEAM_MEMBERS));
      }
      this.#assertIdle();
      const oldName = archived.config.name;
      const wanted = req.name ?? oldName;
      let name: string;
      try {
        name = this.#checkName(wanted, id);
      } catch (err) {
        if (err instanceof TeamError && err.code === 'invalid_name' && req.name === undefined) {
          throw new TeamError(
            'name_taken',
            teamManagerStrings().nameTakenFor(err.message, oldName),
          );
        }
        throw err;
      }
      await rename(dir, join(team.dir, id));
      await rm(join(team.dir, id, ARCHIVED_JSON), { force: true });
      await this.#reload();
      const def = this.#agent(id);
      // The user, the capo and the language may have changed while it was away.
      const p = this.#profile();
      const orchestrator =
        (squad ? team.lead(squad)?.config.name : undefined) ??
        team.orchestrator()?.config.name ??
        p.orchestratorName;
      const pending = new Pending();
      const current = await this.#instructions(pending, def);
      const old = current.fields?.kind === 'subagent' ? current.fields : null;
      await this.#planInstructions(pending, def, {
        fields: (f) =>
          f.kind === 'subagent'
            ? { ...f, user: p.userName, orchestrator, language: p.language }
            : f,
        text: (t) => {
          if (!old) return t;
          return replaceLanguage(
            replaceWord(replaceWord(t, old.user, p.userName), old.orchestrator, orchestrator),
            old.language,
            p.language,
          );
        },
      });
      await pending.commit();
      if (name !== oldName) await this.#rename(id, name, by);
      const after = new Pending();
      await this.#planOrchestratorTeam(after, (list) => list, squad);
      await after.commit();
      await this.#reload();
      this.#event({ action: 'restore', agent: id, name, by });
      return this.#memberView(this.#agent(id));
    });
  }

  // --- add ---------------------------------------------------------------------------

  suggestions(): TeamSuggestions {
    this.#assertReady();
    const live = this.#d.team.list();
    const has = (id: string, name: string) =>
      live.some((a) => a.config.id === id || a.config.name.toLowerCase() === name.toLowerCase());
    const p = this.#profile();
    const base = { user: p.userName, orchestrator: p.orchestratorName };
    const archetypes = [rheaBlueprint(base), dioneBlueprint(base)]
      .filter((bp) => !has(bp.id, bp.name))
      .map((bp) => ({
        archetype: bp.id as 'rhea' | 'dione',
        name: bp.name,
        title: bp.title,
        role: bp.summary,
      }));
    return { archetypes, ideas: teamManagerStrings().ideas, names: this.#freeNames() };
  }

  #freeNames(): string[] {
    const live = this.#d.team.list();
    const taken = new Set(live.flatMap((a) => [agentId(a.config.name), a.config.id]));
    const orchestrator = this.#d.team.orchestrator()?.config.name ?? 'Titan';
    return allowedNames(orchestrator).filter((n) => !taken.has(agentId(n)));
  }

  /** Hues of a squad's monsters (D-097: colours are told apart within a squad). */
  #hues(except?: string, project?: string): number[] {
    return this.#d.team
      .members(project)
      .filter((a) => a.config.id !== except)
      .map((a) => MonsterGenomeSchema.safeParse(a.genome))
      .filter((g) => g.success)
      .map((g) => g.data.palette.hue);
  }

  /** The chain that writes a made-to-measure draft: the capo's, if it is a chat model. */
  #draftChain(): ModelRef[] | null {
    const { providers, team } = this.#d;
    const chain = team.orchestrator()?.config.models ?? [];
    const usable = chain.filter(
      (m) => providers.has(m.provider) && providers.get(m.provider).kind === 'model',
    );
    if (usable.length > 0) return usable;
    if (providers.has('openrouter')) return DEFAULT_FREE_CHAIN;
    return null;
  }

  /** A draft from its fields: the area checked, a monster of its own (hue `hue` when given). */
  #finishDraft(
    d: DraftFields,
    p: Profile,
    hue?: number,
    project?: string,
    extraHues: readonly number[] = [],
  ): TeamDraft {
    const area = AgentAreaSchema.safeParse(d.area);
    const hues = [...this.#hues(undefined, project), ...extraHues];
    let genome = monsterForMember(d.name, hues, d.look);
    if (hue !== undefined) {
      genome = MonsterGenomeSchema.parse({
        ...genome,
        palette: { ...genome.palette, hue: Math.round(pickHue(hue, hues) * 10) / 10 },
      });
    }
    return {
      name: d.name,
      title: d.title,
      role: d.role,
      mission: lowerFirst(d.mission.replace(/\.$/, '')),
      context: contextSentence(p),
      duties: d.duties.slice(0, 4),
      area: area.success ? area.data : `Risorse/${d.name}`,
      web: d.web,
      color: colorOfGenome(genome),
      genome: { ...genome, id: agentId(d.name) },
      archetype: d.archetype,
      source: d.source,
    };
  }

  /** A monster to review before adding it: an archetype, or one made to measure. Nothing is saved. */
  async draft(req: TeamDraftRequest, signal?: AbortSignal): Promise<TeamDraft> {
    this.#assertReady();
    const p = this.#profile();
    const name = req.name !== undefined ? this.#checkName(req.name) : undefined;
    const free = this.#freeNames();
    const finish = (d: DraftFields): TeamDraft => this.#finishDraft(d, p);
    // The user's name, else the suggested one when it is free, else the next free moon.
    const pick = (wanted?: string) => {
      if (name) return name;
      const free_ = wanted && free.find((n) => n.toLowerCase() === wanted.trim().toLowerCase());
      if (free_) return free_;
      const next = free[0] ?? MOON_NAMES.find((n) => !this.#d.team.get(n));
      if (!next) throw new TeamError('team_full', 'no free names left');
      return next;
    };

    if ('archetype' in req) {
      const base = {
        user: p.userName,
        orchestrator: p.orchestratorName,
        context: contextSentence(p),
      };
      const bp = req.archetype === 'rhea' ? rheaBlueprint(base) : dioneBlueprint(base);
      return finish({
        name: pick(bp.name),
        title: bp.title,
        role: bp.summary,
        mission: bp.mission,
        duties: bp.duties,
        area: bp.outputArea,
        web: bp.id === 'rhea',
        archetype: req.archetype,
        source: 'archetype',
      });
    }

    const { runs, log } = this.#d;
    if (runs.halted) {
      throw new TeamError('halted', teamManagerStrings().halted);
    }
    const chain = this.#draftChain();
    const generate =
      this.#d.generate !== undefined
        ? this.#d.generate
        : chain
          ? providerGenerate(this.#d.providers, () => chain)
          : null;
    const kill = runs.signal;
    const stop = signal ? AbortSignal.any([signal, kill]) : kill;
    const fallback = () =>
      finish({
        name: pick(),
        title: teamManagerPrompts().helperTitle,
        role: clipLine(req.description, 120),
        mission: clipLine(lowerFirst(req.description), 200),
        duties: [clipLine(req.description, 200)],
        area: `Risorse/${pick()}`,
        web: req.web ?? false,
        archetype: null,
        source: 'fallback',
      });
    if (!generate) return fallback();
    let prompt = this.#draftPrompt(p, req.description, free, name);
    for (let attempt = 0; attempt < 2; attempt++) {
      let text: string;
      try {
        const answer = await generate(teamManagerPrompts().draftSystem, prompt, stop);
        for (const u of answer.usage ?? []) {
          log.append({ agent: 'system', type: 'provider_usage', data: u });
        }
        text = answer.text;
      } catch (err) {
        for (const u of (err as GenerateError).usage ?? []) {
          log.append({ agent: 'system', type: 'provider_usage', data: u });
        }
        if (kill.aborted || runs.halted) {
          throw new TeamError('halted', teamManagerStrings().haltedDraft);
        }
        if (stop.aborted) throw err;
        log.append({
          agent: 'system',
          type: 'error',
          data: {
            code: 'team_draft',
            message: teamManagerStrings().draftNoAnswer(errorMessage(err)),
          },
        });
        break;
      }
      let json: unknown = null;
      try {
        json = extractJson(text);
      } catch {
        // not JSON: retried below with the error
      }
      const parsed = DraftAnswerSchema.safeParse(json);
      if (parsed.success) {
        const a =
          'agents' in parsed.data
            ? parsed.data.agents[0]!
            : 'agent' in parsed.data
              ? parsed.data.agent
              : parsed.data;
        const draft = finish({
          name: pick(a.name),
          title: a.title,
          role: a.role,
          mission: a.mission,
          duties: a.duties,
          area: a.area,
          web: req.web ?? a.tools.some((t) => /web/i.test(t)),
          archetype: null,
          look: a.look,
          source: 'model',
        });
        const problem = this.#draftProblem(draft);
        if (!problem) return draft;
        prompt = teamManagerPrompts().retry(
          this.#draftPrompt(p, req.description, free, name),
          problem.slice(0, 600),
        );
      } else {
        const reason = formatZod(parsed.error);
        log.append({
          agent: 'system',
          type: 'error',
          data: {
            code: 'team_draft',
            message: teamManagerStrings().draftInvalid(attempt + 1, reason),
          },
        });
        prompt = teamManagerPrompts().retry(
          this.#draftPrompt(p, req.description, free, name),
          reason.slice(0, 600),
        );
      }
    }
    return fallback();
  }

  /** Why a draft would not render (null when it does). */
  #draftProblem(d: TeamDraft): string | null {
    try {
      renderAgentFiles(
        memberBlueprint(this.#proposed(d.name, 'draft-check', d, d.genome), {
          profile: this.#profile(),
        }),
      );
      return null;
    } catch (err) {
      return err instanceof TemplateError
        ? err.problems.join('; ')
        : err instanceof z.ZodError
          ? formatZod(err)
          : (err as Error).message;
    }
  }

  #draftPrompt(p: Profile, description: string, free: string[], name?: string): string {
    const team = this.#d.team
      .list()
      .map((a) => `- ${a.config.name}: ${a.config.role}`)
      .join('\n');
    return teamManagerPrompts().draftPrompt({
      userName: p.userName,
      orchestratorName: p.orchestratorName,
      occupation: p.occupation,
      tone: p.tone,
      language: p.language,
      team,
      description,
      name,
      free: free.slice(0, 8).join(', '),
    });
  }

  #proposed(
    name: string,
    id: string,
    d: {
      title: string;
      role: string;
      mission: string;
      context?: string | undefined;
      duties: string[];
      area: string;
      web: boolean;
      archetype?: 'rhea' | 'dione' | null | undefined;
    },
    genome: unknown,
  ): ProposedAgent {
    const g = genome as MonsterGenome;
    return {
      id,
      name,
      title: d.title,
      role: d.role,
      mission: lowerFirst(d.mission.replace(/\.$/, '')),
      context: d.context ?? contextSentence(this.#profile()),
      duties: d.duties,
      area: d.area,
      tools: toolsFor(d.web, { vault: true, web: true }),
      color: colorOfGenome(g),
      genome: g,
      archetype: d.archetype ?? null,
    };
  }

  /**
   * A monster proposed by the capo squadra (`team_propose_monster`, D-075):
   * the same checks and the same draft as "Aggiungi un mostro" (name, fields,
   * AGENTS.md that renders, a colour of its own), then a `monster_proposal`
   * event that the chat shows as a card. Nothing is written: the user creates
   * it from the card (`create` with `proposal`) or leaves it aside.
   */
  propose(
    input: MonsterProposalInput,
    origin: { agent: string; runId?: string | null; parentId?: string | null },
  ): Promise<MonsterProposal> {
    return this.#serial(() => {
      this.#assertReady();
      // A lead proposes a monster for its project (D-097).
      const project =
        this.#d.team.byId(origin.agent)?.config.kind === 'lead'
          ? this.#d.team.projectOf(origin.agent)?.id
          : undefined;
      if (this.#subagents(project).length >= MAX_TEAM_MEMBERS) {
        throw new TeamError('team_full', teamManagerStrings().teamFullAsk(MAX_TEAM_MEMBERS));
      }
      const name = this.#checkName(input.name);
      const open = this.#openProposals().find(
        (e) => e.data.draft?.name.toLowerCase() === name.toLowerCase(),
      );
      if (open?.data.draft) {
        return {
          id: open.id,
          draft: open.data.draft,
          ...(open.data.models ? { models: open.data.models } : {}),
          repeated: true,
        };
      }
      const { draft, models } = this.draftOf(input, { project });
      const event = this.#d.log.append({
        agent: origin.agent,
        runId: origin.runId ?? null,
        parentId: origin.parentId ?? null,
        type: 'monster_proposal',
        data: {
          action: 'proposed',
          from: origin.agent,
          ...(project ? { project } : {}),
          draft,
          ...(models ? { models } : {}),
        },
      });
      return { id: event.id, draft, ...(models ? { models } : {}) };
    });
  }

  /**
   * The draft of a proposed monster (D-075, D-098): the same checks and the
   * same draft as "Aggiungi un mostro" (name, fields, AGENTS.md that renders,
   * a colour of its own). Nothing is written or logged. `project`: the squad
   * it would join (its area and colours); `taken`: names of the same proposal;
   * `hues`: colours of the same proposal.
   */
  draftOf(
    input: MonsterProposalInput,
    options: {
      project?: string | undefined;
      taken?: readonly string[];
      hues?: readonly number[];
    } = {},
  ): { draft: TeamDraft; models?: ModelRef[] } {
    const { project } = options;
    const name = this.#checkName(input.name);
    if (options.taken?.some((n) => n.toLowerCase() === name.toLowerCase())) {
      throw new TeamError('invalid_name', teamManagerStrings().nameInProposal(name));
    }
    const area = input.area?.trim().replace(/^\/+|\/+$/g, '');
    if (area !== undefined && !AgentAreaSchema.safeParse(area).success) {
      throw new TeamError('invalid_request', teamManagerStrings().badArea(input.area ?? ''));
    }
    // Every text that becomes AGENTS.md, cleaned and checked (D-079): one line,
    // no invisible characters, no links, tool names or secrets from the user.
    const clean = (field: string, raw: string) => {
      const r = proposalText(field, raw);
      if (r.problem) throw new TeamError('invalid_request', r.problem);
      return r.text;
    };
    const duties = (input.duties?.length ? input.duties : [input.mission])
      .map((d, i) => clean(`duties[${i}]`, d))
      .filter(Boolean);
    if (duties.length > MAX_DUTIES) {
      throw new TeamError('invalid_request', teamManagerStrings().tooManyDuties(MAX_DUTIES));
    }
    const draft = this.#finishDraft(
      {
        name,
        title: clean('title', input.title ?? teamManagerPrompts().helperTitle),
        role: clean('role', input.role),
        mission: clean('mission', input.mission),
        duties,
        area:
          area ??
          (project
            ? (this.#d.team.project(project)?.vaultArea ?? `Risorse/${name}`)
            : `Risorse/${name}`),
        web: input.web,
        archetype: null,
        source: 'proposal',
      },
      this.#profile(),
      input.hue,
      project,
      options.hues,
    );
    // The fields the create request will carry, checked as the API checks them.
    const request = TeamMemberCreateRequestSchema.safeParse(createRequestOf(draft));
    if (!request.success) throw new TeamError('invalid_request', formatZod(request.error));
    const problem = this.#draftProblem(draft);
    if (problem) throw new TeamError('invalid_request', problem);
    const models = input.model ? [this.#proposalModel(input.model)] : undefined;
    return { draft, ...(models ? { models } : {}) };
  }

  /** "provider/model" of a proposal, usable now (configured, and free when only free ones run). */
  #proposalModel(raw: string): ModelRef {
    const text = raw.trim();
    const slash = text.indexOf('/');
    const configured = this.#d.providers
      .list()
      .map((x) => x.id)
      .join(', ');
    if (slash <= 0 || slash === text.length - 1) {
      throw new TeamError('invalid_request', teamManagerStrings().badModelRef(text, configured));
    }
    const ref = { provider: text.slice(0, slash), model: text.slice(slash + 1) };
    if (!this.#d.providers.has(ref.provider)) {
      throw new TeamError(
        'invalid_request',
        teamManagerStrings().providerNotConfigured(ref.provider, configured),
      );
    }
    if (
      ref.provider === 'openrouter' &&
      this.#d.settings.openrouter.freeOnly &&
      !isOpenRouterFreeModel(ref.model)
    ) {
      throw new TeamError('invalid_request', teamManagerStrings().paidModel(ref.model));
    }
    return ref;
  }

  /** `monster_proposal` events of the log, oldest first. */
  #proposalEvents(): LogEvent<'monster_proposal'>[] {
    return this.#d.log
      .query({ type: 'monster_proposal', limit: 1000, order: 'desc' })
      .reverse() as LogEvent<'monster_proposal'>[];
  }

  /** Proposals nobody answered yet. */
  #openProposals(): LogEvent<'monster_proposal'>[] {
    const events = this.#proposalEvents();
    const closed = new Set(events.map((e) => e.data.proposalId).filter(Boolean));
    return events.filter((e) => e.data.action === 'proposed' && !closed.has(e.id));
  }

  /** An open proposal by id (`unknown_proposal`, `proposal_closed`). */
  #proposal(id: string): LogEvent<'monster_proposal'> {
    const e = this.#d.log.get(id);
    if (!e || e.type !== 'monster_proposal' || e.data.action !== 'proposed') {
      throw new TeamError('unknown_proposal', `no proposal ${id}`);
    }
    if (!this.#openProposals().some((o) => o.id === id)) {
      throw new TeamError('proposal_closed', teamManagerStrings().proposalClosed);
    }
    return e;
  }

  /** The user leaves a proposal aside: the capo squadra reads it at its next turn. */
  discardProposal(id: string, by: Channel): Promise<{ ok: true }> {
    return this.#serial(() => {
      const e = this.#proposal(id);
      this.#d.log.append({
        agent: 'user',
        type: 'monster_proposal',
        data: {
          action: 'discarded',
          from: e.data.from,
          proposalId: id,
          ...(e.data.draft ? { name: e.data.draft.name } : {}),
          by,
        },
      });
      return { ok: true as const };
    });
  }

  /**
   * A new monster: of the Squadra personale, or of `project` (D-097: from the
   * project's page, or from its lead's proposal).
   */
  create(
    req: TeamMemberCreateRequest,
    by: Channel,
    options: { project?: string; models?: ModelRef[] } = {},
  ): Promise<TeamMemberView> {
    return this.#serial(async () => {
      this.#assertReady();
      const { team } = this.#d;
      const proposal = req.proposal ? this.#proposal(req.proposal) : undefined;
      const projectId = options.project ?? proposal?.data.project;
      const project = projectId ? this.#activeProject(projectId) : undefined;
      if (this.#subagents(project?.id).length >= MAX_TEAM_MEMBERS) {
        throw new TeamError('team_full', teamManagerStrings().teamFull(MAX_TEAM_MEMBERS));
      }
      const lead = project ? team.lead(project.id) : undefined;
      const name = this.#checkName(req.name);
      const id = this.#freeId(agentId(name));
      const genome = this.#checkGenome(req.genome, id, project?.id);
      const member = this.#proposed(name, id, { ...req, archetype: req.archetype ?? null }, genome);
      // The proposed model, checked again now (a provider removed, paid models
      // turned off since the proposal), unless the user chose the capo's ones.
      const proposedModels =
        req.proposalModel === false
          ? undefined
          : proposal?.data.models?.map((m) => this.#proposalModel(`${m.provider}/${m.model}`));
      const models =
        proposedModels ??
        options.models?.map((m) => this.#proposalModel(`${m.provider}/${m.model}`)) ??
        lead?.config.models ??
        team.orchestrator()?.config.models ??
        DEFAULT_FREE_CHAIN;
      const profile = this.#profile();
      // A project's monster reports to its lead (D-097).
      const bp = {
        ...memberBlueprint(member, {
          profile: lead ? { ...profile, orchestratorName: lead.config.name } : profile,
          models,
        }),
        ...(project ? { project: project.id } : {}),
      };
      try {
        renderAgentFiles(bp);
      } catch (err) {
        throw new TeamError(
          'invalid_request',
          err instanceof TemplateError
            ? err.problems.join('; ')
            : err instanceof z.ZodError
              ? formatZod(err)
              : (err as Error).message,
        );
      }
      const pending = new Pending();
      await this.#planOrchestratorTeam(
        pending,
        (list) => [...list, { id, name, summary: req.role }],
        project?.id,
      );
      await writeAgentFolder(join(team.dir, id), bp, { archetype: req.archetype ?? null });
      await pending.commit();
      await this.#reload();
      // A new monster on the Claude plan starts in "Automatica", unless its models were chosen (D-110).
      if (!proposedModels && !options.models && isClaudePlanChain(models)) {
        await team.setModels(id, autoChain('medium'), { base: 'medium' });
      }
      this.#event({ action: 'add', agent: id, name, by });
      if (project) this.#projectEvent('member_added', project, id, by);
      if (proposal) {
        this.#d.log.append({
          agent: 'user',
          type: 'monster_proposal',
          data: {
            action: 'created',
            from: proposal.data.from,
            proposalId: proposal.id,
            agent: id,
            name,
            by,
          },
        });
      }
      return this.#memberView(this.#agent(id));
    });
  }

  // --- projects (D-097) ------------------------------------------------------------------

  #projectEvent(
    action: 'member_added' | 'member_removed',
    project: Project,
    agent: string,
    by: Channel,
  ): void {
    this.#d.log.append({
      agent: 'user',
      type: 'project_change',
      data: { action, project: project.id, name: project.name, agent, by },
    });
  }

  /**
   * A free name of the pool new monsters draw from (unique across every
   * squad), for a copy or a lead that has no name of its own. `taken`: names
   * already given in the same proposal (D-098).
   */
  freeName(taken: readonly string[] = []): string {
    const used = new Set(taken.map((n) => n.toLowerCase()));
    for (const c of this.#freeNames()) {
      if (used.has(c.toLowerCase())) continue;
      try {
        return this.#checkName(c);
      } catch {
        // taken: the next one
      }
    }
    throw new TeamError('invalid_name', teamManagerStrings().noFreeName);
  }

  /**
   * A free name for a monster restored into a project whose own name is taken
   * (names are unique across every squad): "Rhea · Saturday", then "Rhea di
   * Saturday", then a free name.
   */
  copyName(source: string, project: Pick<Project, 'name'>, taken: readonly string[] = []): string {
    const used = new Set(taken.map((n) => n.toLowerCase()));
    const words = project.name
      .replace(/[^\p{L}\p{M}' -]/gu, ' ')
      .replace(/\s+/g, ' ')
      .trim();
    const candidates: string[] = [];
    if (words) {
      for (const sep of [' · ', ' di ']) {
        const room = 24 - source.length - sep.length;
        if (room >= 2) candidates.push(`${source}${sep}${words.slice(0, room).trim()}`);
      }
    }
    candidates.push(...this.#freeNames());
    for (const c of candidates) {
      if (used.has(c.toLowerCase())) continue;
      try {
        return this.#checkName(c);
      } catch {
        // taken: the next one
      }
    }
    throw new TeamError('invalid_name', teamManagerStrings().noFreeName);
  }

  /** A name free in every squad, as "Aggiungi un mostro" checks it (`invalid_name`). */
  checkName(raw: string): string {
    return this.#checkName(raw);
  }

  /**
   * A well-formed name that another monster or a project already has (not a
   * malformed or reserved one: those stay errors of the caller).
   */
  nameTaken(raw: string): boolean {
    try {
      this.#checkName(raw);
      return false;
    } catch (err) {
      if (!(err instanceof TeamError)) throw err;
      const name = cleanName(raw);
      return AGENT_NAME_PATTERN.test(name) && !isReservedActor(agentId(name));
    }
  }

  /** The proposals of new monsters nobody answered yet, oldest first (D-098: "Da rivedere"). */
  openProposals(): LogEvent<'monster_proposal'>[] {
    return this.#openProposals();
  }

  /**
   * The lead of a project (`kind: lead`, D-097): a new monster, or a copy of
   * one (its models; a look, a name and a memory of its own). Its AGENTS.md is the
   * orchestrator's rules inside the project; its tools: the notes, the web
   * (dropped while a monster of the project has it), `delegate`, `ask_user`
   * and `team_propose_monster` on the project's monsters only.
   */
  createLead(project: Project, plan: ProjectLeadPlan, by: Channel): Promise<TeamMemberView> {
    return this.#serial(async () => {
      this.#assertReady();
      const { team } = this.#d;
      if (team.lead(project.id)) {
        throw new TeamError('invalid_request', teamManagerStrings().projectHasLead(project.name));
      }
      const source = plan.from ? this.#agent(plan.from) : undefined;
      const name = plan.name ? this.#checkName(plan.name) : this.freeName();
      const id = this.#freeId(agentId(name));
      const p = this.#profile();
      const orchestrator = team.orchestrator()?.config.name ?? p.orchestratorName;
      // Its own look, never the source's: a copy is another monster.
      const genome: MonsterGenome = monsterForMember(name, this.#hues(undefined, project.id));
      const bp: LeadBlueprint = {
        kind: 'lead',
        id,
        name,
        user: p.userName,
        language: p.language,
        color: colorOfGenome(genome),
        models:
          plan.models?.map((m) => ({
            ...this.#proposalModel(`${m.provider}/${m.model}`),
            ...(m.tier ? { tier: m.tier } : {}),
          })) ??
          source?.config.models ??
          team.orchestrator()?.config.models ??
          DEFAULT_FREE_CHAIN,
        genome: { ...genome, id },
        project: project.id,
        projectName: project.name,
        ...(plan.goal ? { goal: plan.goal } : {}),
        area: project.vaultArea,
        orchestrator,
        team: [],
        tools: [
          ...VAULT_READ_TOOLS,
          ...VAULT_WRITE_TOOLS,
          'vault_move',
          'vault_delete',
          'vault_history',
          ...WEB_TOOLS,
          ...TEAM_TOOLS,
        ],
        limits: { maxSteps: 30 },
      };
      try {
        renderAgentFiles(bp);
      } catch (err) {
        throw new TeamError(
          'invalid_request',
          err instanceof TemplateError
            ? err.problems.join('; ')
            : err instanceof z.ZodError
              ? formatZod(err)
              : (err as Error).message,
        );
      }
      await writeAgentFolder(join(team.dir, id), bp);
      await this.#reload();
      // The lead of a project on the Claude plan starts in "Automatica" too (D-110).
      if (!plan.models && isClaudePlanChain(bp.models)) {
        await team.setModels(id, autoChain('medium'), { base: 'medium' });
      }
      this.#event({ action: 'add', agent: id, name, by });
      return this.#memberView(this.#agent(id));
    });
  }

  /**
   * A monster of any squad copied into a project (D-097): a new instance with
   * its role, rules and models, a name and a look of its own, a memory of its own (`Agenti/<new
   * name>/`), reporting to the project's lead. Memories, permissions and
   * spending stay of one squad only: nothing is shared.
   */
  copyInto(
    projectId: string,
    sourceId: string,
    wanted: string | undefined,
    by: Channel,
  ): Promise<TeamMemberView> {
    return this.#serial(async () => {
      this.#assertReady();
      const { team } = this.#d;
      const project = this.#activeProject(projectId);
      const source = this.#agent(sourceId);
      if (source.config.kind !== 'subagent') {
        throw new TeamError('invalid_request', teamManagerStrings().copyLead(source.config.name));
      }
      if (this.#subagents(project.id).length >= MAX_TEAM_MEMBERS) {
        throw new TeamError('team_full', teamManagerStrings().projectFull(MAX_TEAM_MEMBERS));
      }
      const name = wanted ? this.#checkName(wanted) : this.freeName();
      const id = this.#freeId(agentId(name));
      const lead = team.lead(project.id);
      const capo =
        lead?.config.name ?? team.orchestrator()?.config.name ?? this.#profile().orchestratorName;
      const from = source.config.name;
      const pending = new Pending();
      const current = await this.#instructions(pending, source);
      const old = current.fields?.kind === 'subagent' ? current.fields : null;
      // Its results go in the project's notes: `Risorse/Ricerche` → `Progetti/<name>/Ricerche`.
      const oldArea = old?.outputArea ?? this.#areaOf(source);
      const last = oldArea?.split('/').at(-1);
      const moved = last ? AgentAreaSchema.safeParse(`${project.vaultArea}/${last}`) : null;
      const area = moved?.success ? moved.data : project.vaultArea;
      const doc = parseDocument(await readFile(join(source.dir!, AGENT_YAML), 'utf8'));
      doc.set('id', id);
      doc.set('name', name);
      doc.set('project', project.id);
      // Its own look (a new genome, a hue free in the project), never the source's.
      const genome = monsterForMember(name, this.#hues(undefined, project.id));
      const color = colorOfGenome(genome);
      doc.set('color', color);
      const raw = (doc.toJS() ?? {}) as { vault?: { write?: unknown } };
      const write = Array.isArray(raw.vault?.write) ? (raw.vault.write as unknown[]) : [];
      doc.setIn(
        ['vault', 'write'],
        doc.createNode(
          write.map((g) =>
            g === `Agenti/${from}/**`
              ? `Agenti/${name}/**`
              : oldArea && g === `${oldArea}/**`
                ? `${area}/**`
                : g,
          ),
        ),
      );
      const config = {
        ...source.config,
        id,
        name,
        color,
        project: project.id,
        vault: {
          ...source.config.vault,
          write: (doc.toJS() as { vault: { write: string[] } }).vault.write,
        },
      };
      const copy: AgentDefinition = { ...source, config };
      const fields: InstructionFields | null = old
        ? { ...old, name, orchestrator: capo, outputArea: area }
        : null;
      const replaced = (t: string) => {
        let out = replaceWord(t, from, name);
        if (old) out = replaceWord(out, old.orchestrator, capo);
        return oldArea ? replaceWord(out, oldArea, area) : out;
      };
      const text =
        current.pristine && fields
          ? this.#render(fields, copy, current.lang)
          : replaced(current.text);
      const dir = join(team.dir, id);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, AGENT_YAML), doc.toString(), 'utf8');
      await writeFile(join(dir, AGENTS_MD), text, 'utf8');
      if (fields) {
        await writeFile(join(dir, BLUEPRINT_JSON), `${JSON.stringify(fields, null, 2)}\n`, 'utf8');
      }
      await writeFile(
        join(dir, GENOME_JSON),
        `${JSON.stringify({ ...genome, id }, null, 2)}\n`,
        'utf8',
      );
      await this.#planOrchestratorTeam(
        pending,
        (list) => [...list, { id, name, summary: source.config.role }],
        project.id,
      );
      await pending.commit();
      await this.#reload();
      this.#event({ action: 'add', agent: id, name, by });
      this.#projectEvent('member_added', project, id, by);
      return this.#memberView(this.#agent(id));
    });
  }

  /**
   * The lead's AGENTS.md and role after its project was renamed or its area
   * moved (D-097). `before`: the project's name and area until now.
   */
  refreshLead(projectId: string, before: { name: string; vaultArea: string }): Promise<void> {
    return this.#serial(async () => {
      const p = this.#d.team.project(projectId);
      const lead = this.#d.team.lead(projectId);
      if (!p || !lead?.dir) return;
      if (p.name === before.name && p.vaultArea === before.vaultArea) return;
      const pending = new Pending();
      await this.#planInstructions(pending, lead, {
        fields: (f) => (f.kind === 'lead' ? { ...f, project: p.name, area: p.vaultArea } : f),
        text: (t) =>
          replaceWord(replaceWord(t, before.vaultArea, p.vaultArea), before.name, p.name),
      });
      await this.#planYaml(pending, lead, (doc) => doc.set('role', `capo del progetto ${p.name}`));
      await pending.commit();
      await this.#reload();
    });
  }

  /** A monster leaves its project: it is archived (never deleted), the lead's list updated. */
  removeFromProject(projectId: string, id: string, by: Channel): Promise<TeamArchiveResponse> {
    return this.#serial(async () => {
      const project = this.#d.team.project(projectId);
      if (!project) {
        throw new TeamError('unknown_project', teamManagerStrings().unknownProject(projectId));
      }
      const def = this.#agent(id);
      if (this.#squadOf(def) !== project.id) {
        throw new TeamError(
          'unknown_agent',
          teamManagerStrings().notInProject(def.config.name, project.name),
        );
      }
      const out = await this.#archive(id, by);
      this.#projectEvent('member_removed', project, id, by);
      return out;
    });
  }

  /**
   * The monsters archived with a project come back with it (D-098), its lead
   * first. A name taken meanwhile gets the copy's free name ("Rhea · Saturday").
   * Returns the ids back in the project; a monster no longer in the archive is skipped.
   */
  async restoreSquad(projectId: string, ids: readonly string[], by: Channel): Promise<string[]> {
    const project = this.#d.team.project(projectId);
    if (!project) {
      throw new TeamError('unknown_project', teamManagerStrings().unknownProject(projectId));
    }
    const archived: AgentDefinition[] = [];
    for (const id of ids) {
      try {
        archived.push(await loadAgentDefinition(join(this.archiveDir, id)));
      } catch {
        // restored or gone meanwhile
      }
    }
    const ordered = [
      ...archived.filter((a) => a.config.kind === 'lead'),
      ...archived.filter((a) => a.config.kind !== 'lead'),
    ];
    const back: string[] = [];
    for (const a of ordered) {
      const id = a.config.id;
      if (this.#d.team.byId(id)) continue;
      try {
        await this.restore(id, {}, by);
      } catch (err) {
        if (!(err instanceof TeamError) || err.code !== 'name_taken') throw err;
        await this.restore(id, { name: this.copyName(a.config.name, project) }, by);
      }
      back.push(id);
    }
    return back;
  }

  /** Every monster of a project archived, its lead last (archiving the project, D-097). */
  archiveSquad(projectId: string, by: Channel): Promise<string[]> {
    return this.#serial(async () => {
      this.#assertReady();
      const members = this.#d.team.members(projectId);
      const busy = members.filter((a) =>
        ['working', 'waiting'].includes(this.#d.team.state(a.config.id).state),
      );
      if (busy.length > 0) {
        throw new TeamError(
          'busy',
          teamManagerStrings().busyArchive(busy.map((a) => a.config.name)),
        );
      }
      const ordered = [
        ...members.filter((a) => a.config.kind !== 'lead'),
        ...members.filter((a) => a.config.kind === 'lead'),
      ];
      for (const a of ordered) await this.#archive(a.config.id, by, true);
      return ordered.map((a) => a.config.id);
    });
  }
}

/** The fields a draft is finished from. */
interface DraftFields {
  name: string;
  title: string;
  role: string;
  mission: string;
  duties: string[];
  area: string;
  web: boolean;
  archetype: 'rhea' | 'dione' | null;
  look?: Parameters<typeof monsterForMember>[2];
  source: TeamDraft['source'];
}

/** The fields of "Aggiungi un mostro" from a draft (what the card's "Crea" sends). */
export function createRequestOf(draft: TeamDraft): TeamMemberCreateRequest {
  return {
    name: draft.name,
    title: draft.title,
    role: draft.role,
    mission: draft.mission,
    ...(draft.context ? { context: draft.context } : {}),
    duties: draft.duties,
    area: draft.area,
    web: draft.web,
    genome: draft.genome as Record<string, unknown>,
    archetype: draft.archetype,
  };
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A whole line of `profilo.md` that starts with `prefix` ("- Nome: "). */
const lineRe = (prefix: string) => new RegExp(`^${escapeRegex(prefix)}.*$`, 'm');
