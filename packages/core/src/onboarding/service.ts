import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { hashString, type MonsterGenome } from '@monsters/monster-kit';
import { errorMessage, type ModelRef, type ProviderRegistry } from '@monsters/providers';
import {
  AGENT_NAME_PATTERN,
  AgentAreaSchema,
  autoChain,
  DEFAULT_AGENT_PERMISSIONS,
  EventInputSchema,
  ONBOARDING_QUESTIONS,
  checkOnboardingAnswer,
  isClaudePlanChain,
  isReservedActor,
  type AgentPermissions,
  type FolderGrant,
  type AgentSummary,
  type OnboardingAccess,
  type OnboardingAnswersRequest,
  type OnboardingState,
  type ProposedAgent,
  type TeamConfirmRequest,
  type TeamProposal,
} from '@monsters/shared';
import type { VaultActor, VaultService } from '@monsters/vault';
import { streamText } from 'ai';
import { DEFAULT_FREE_CHAIN, orchestratorBlueprint } from '../agents/archetypes.ts';
import { BLUEPRINT_JSON, renderAgentFiles, writeAgentFolder } from '../agents/templates.ts';
import { stepUsage, type ProviderUsage } from '../agents/usage.ts';
import type { StateStore } from '../db/state-store.ts';
import type { RunController } from '../kill/run-controller.ts';
import type { EventLog } from '../log/event-log.ts';
import { resolveDecisionRules, type DecisionGate } from '../team/decision.ts';
import type { HubSettings } from '../team/settings.ts';
import { allowedTools, fullPermissions, type TeamService } from '../team/team-service.ts';
import { colorOfGenome, designMonster, orchestratorMonster } from './monsters.ts';
import {
  decisionRulesFrom,
  missingAnswers,
  profileFromAnswers,
  renderProfile,
  cleanName,
  type Answers,
  type Profile,
} from './profile.ts';
import {
  agentId,
  checkMembers,
  memberBlueprint,
  proposeTeam,
  type Generate,
  type GenerateError,
  type ProposalContext,
} from './proposal.ts';
import { patchSettingsFile } from './settings-file.ts';

/*
 * The first start (ARCHITECTURE §7): key, questions, permissions, team
 * proposal and confirmation. Progress lives in the state store, so a reload
 * (or a restart of the core) resumes where the user left. The onboarding is
 * over when the team exists.
 */

export const ONBOARDING_STATE_KEY = 'onboarding';
export const PROFILE_PATH = 'profilo.md';

interface Stored {
  answers: Answers;
  permissions: AgentPermissions | null;
  keySkipped: boolean;
  /** How the team reaches a model (first screen); null = not chosen (skipped, or older state). */
  access: OnboardingAccess | null;
  proposal: TeamProposal | null;
  /**
   * A confirmation started and not finished (M10 of 18/10): its request. Once
   * the first folder is written the team "exists" (`done`), so a failure or a
   * power cut after it left settings, policy and welcome never written: a new
   * attempt, or the next start, runs the same confirmation again to its end.
   */
  confirming?: Confirming | null;
}

/** The steps of a confirmation, in order: a new attempt does only those not done (review of 19/10). */
type ConfirmStep = 'folders' | 'models' | 'vault' | 'settings' | 'profile' | 'welcome';

interface Confirming {
  request: TeamConfirmRequest;
  /** The models of the first attempt: the next ones use the same, without asking the provider. */
  models?: ModelRef[] | null;
  /** Steps already done: never done again over what the user may have changed since. */
  steps?: ConfirmStep[];
  /** Attempts so far: past `MAX_CONFIRM_ATTEMPTS` the start gives up and says so. */
  attempts?: number;
}

/** Attempts of a confirmation left half-way before the start stops trying it. */
export const MAX_CONFIRM_ATTEMPTS = 3;
/** The longest wait for the provider's list of models during the onboarding. */
const MODELS_TIMEOUT_MS = 15_000;

const EMPTY: Stored = {
  answers: {},
  permissions: null,
  keySkipped: false,
  access: null,
  proposal: null,
};

export type OnboardingErrorCode =
  | 'onboarding_done'
  | 'answers_incomplete'
  | 'no_proposal'
  | 'unknown_member'
  | 'invalid_request'
  | 'invalid_name'
  | 'invalid_folder'
  | 'busy'
  | 'halted'
  | 'access_unavailable';

const CONFIRM_STEPS: readonly ConfirmStep[] = [
  'folders',
  'models',
  'vault',
  'settings',
  'profile',
  'welcome',
];

/** The steps a confirmation has still to do, in Italian for the log. */
function pendingSteps(done: readonly ConfirmStep[]): string[] {
  const names: Record<ConfirmStep, string> = {
    folders: 'le cartelle dei mostri',
    models: 'i modelli',
    vault: 'le aree del vault',
    settings: 'le impostazioni',
    profile: 'il profilo',
    welcome: 'il benvenuto',
  };
  return CONFIRM_STEPS.filter((x) => !done.includes(x)).map((x) => names[x]);
}

export class OnboardingError extends Error {
  readonly code: OnboardingErrorCode;
  constructor(code: OnboardingErrorCode, message: string) {
    super(message);
    this.name = 'OnboardingError';
    this.code = code;
  }
}

/** A name whose id is `user` or `system` would pass for them in the log (D-021). */
function assertNotReserved(name: string): void {
  if (isReservedActor(agentId(name.trim()))) {
    throw new OnboardingError('invalid_name', `the name ${name} is reserved: choose another one`);
  }
}

const haltedError = () =>
  new OnboardingError('halted', 'Monsters is stopped: resume it before proposing the team');

export interface OnboardingDeps {
  home: string;
  /** Kill switch: no model call while halted, and a kill stops the proposal. */
  runs: Pick<RunController, 'halted' | 'signal'>;
  state: StateStore;
  log: EventLog;
  team: TeamService;
  vault: VaultService;
  gate: DecisionGate;
  providers: ProviderRegistry;
  /** The hub settings, updated in place with what the onboarding decides. */
  settings: HubSettings;
  hasModelProvider: () => boolean;
  /** Models for the team proposal. Default: the free chain, or the chosen ChatGPT plan. */
  proposalModels?: () => ModelRef[];
  /** Models of the generated agents. Default: the chain of the chosen access (`modelsFor`). */
  agentModels?: () => ModelRef[];
  /** Replaces the model call of the proposal (tests). `null` = always the fallback. */
  generate?: Generate | null;
  /**
   * Checks and normalises the folders granted on the permissions screen
   * (throws with a message for the UI). Without it folders are refused.
   */
  checkFolders?: (folders: readonly FolderGrant[]) => Promise<FolderGrant[]>;
}

/** Calls a model through the providers, streaming, and counts the requests sent. */
export function providerGenerate(providers: ProviderRegistry, models: () => ModelRef[]): Generate {
  return async (system, prompt, signal) => {
    let requests = 0;
    const session = providers.session(models(), {
      pin: false,
      onEvent: (e) => {
        if (e.type === 'served' || e.type === 'fallback') requests++;
      },
    });
    const result = streamText({
      model: session,
      system,
      prompt,
      maxRetries: 0,
      maxOutputTokens: 3000,
      temperature: 0.4,
      ...(signal ? { abortSignal: signal } : {}),
      onError: () => {},
    });
    let text = '';
    let failure: unknown;
    const usage: ProviderUsage[] = [];
    let started = Date.now();
    for await (const part of result.stream) {
      if (part.type === 'start-step') started = Date.now();
      else if (part.type === 'text-delta') text += part.text;
      else if (part.type === 'error') failure ??= part.error;
      else if (part.type === 'finish-step')
        usage.push(stepUsage(session, part, Date.now() - started));
    }
    if (failure !== undefined) {
      const err: GenerateError = new Error(errorMessage(failure));
      err.requests = Math.max(1, requests);
      err.usage = usage;
      throw err;
    }
    return {
      text,
      model: session.lastServed?.ref.model,
      requests: Math.max(1, requests),
      usage,
    };
  };
}

/**
 * The first message of the orchestrator. Without a model it says so instead of
 * promising answers it cannot give yet (the chat adds "Collega un modello").
 */
export function welcomeText(p: Profile, members: ProposedAgent[], hasModel: boolean): string {
  const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
  // A role with its own brackets would nest them: "(a (b))" reads "(a: b)".
  const inline = (role: string) =>
    lower(role)
      .replace(/\.$/, '')
      .replace(/\s*\(([^()]*)\)/g, ': $1');
  const names = members.map((m) => `${m.name} (${inline(m.role)})`);
  const team =
    names.length === 1
      ? names[0]!
      : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`;
  if (p.languageId === 'en') {
    if (!hasModel)
      return `Hi ${p.userName}! I'm ${p.orchestratorName}, I coordinate your team: with me there are ${team}. To get to work I only need a model: connect one and we start.`;
    return `Hi ${p.userName}! I'm ${p.orchestratorName}, I coordinate your team. With me there are ${team}. Tell me what you need and I'll take it from there: before anything you asked me to check with you, I'll ask first.`;
  }
  if (!hasModel)
    return `Ciao ${p.userName}! Sono ${p.orchestratorName} e coordino la tua squadra: con me ci sono ${team}. Per lavorare mi manca solo un modello: collegane uno e partiamo.`;
  return `Ciao ${p.userName}! Sono ${p.orchestratorName} e coordino la tua squadra. Con me ci sono ${team}. Scrivimi quello che ti serve e ci pensiamo noi: per le cose che mi hai indicato, prima chiedo a te.`;
}

export class OnboardingService {
  readonly #d: OnboardingDeps;
  readonly #generate: Generate | null;
  /** Models asked for the team proposal (set by `propose`). */
  #proposalChain: ModelRef[] = DEFAULT_FREE_CHAIN;
  #busy = false;

  constructor(deps: OnboardingDeps) {
    this.#d = deps;
    this.#generate =
      deps.generate !== undefined
        ? deps.generate
        : providerGenerate(deps.providers, () => this.#proposalChain);
  }

  /** True once the team exists (onboarding done, or the default team of the fallback). */
  get done(): boolean {
    return this.#d.team.list().length > 0;
  }

  #load(): Stored {
    return { ...EMPTY, ...(this.#d.state.get<Stored>(ONBOARDING_STATE_KEY) ?? {}) };
  }

  #save(s: Stored): void {
    this.#d.state.set(ONBOARDING_STATE_KEY, s);
  }

  /** The answers of the first start: still the source of the profile after it. */
  answers(): Answers {
    return this.#load().answers;
  }

  /** Replaces some answers after the first start (Settings → Squadra, profile). */
  saveAnswers(answers: Answers): void {
    const s = this.#load();
    this.#save({ ...s, answers: { ...s.answers, ...answers } });
  }

  #assertPending(): void {
    if (this.done) throw new OnboardingError('onboarding_done', 'the team already exists');
  }

  state(): OnboardingState {
    const s = this.#load();
    // A harness (Claude Agent) is not a "model" provider, but once chosen it is the way to one.
    const hasKey = this.#d.hasModelProvider() || s.access !== null;
    const done = this.done;
    const step: OnboardingState['step'] = done
      ? 'done'
      : !hasKey && !s.keySkipped
        ? 'key'
        : missingAnswers(s.answers).length > 0
          ? 'questions'
          : !s.permissions
            ? 'permissions'
            : 'team';
    const named = s.answers['nomi']?.values['orchestrator']?.[0];
    const guideName = done
      ? (this.#d.team.orchestrator()?.config.name ?? 'Titan')
      : cleanName(named ?? 'Titan');
    const guideGenome = done
      ? (this.#d.team.orchestrator()?.genome ?? orchestratorMonster(guideName))
      : orchestratorMonster(guideName);
    return {
      status: done ? 'done' : 'pending',
      step,
      hasKey,
      keySkipped: s.keySkipped,
      access: s.access,
      answers: s.answers,
      permissions: s.permissions,
      proposal: done ? null : s.proposal,
      guide: { name: guideName, genome: guideGenome },
    };
  }

  /** Merges answers and permissions. Complete answers write `profilo.md` and the rules. */
  async submit(req: OnboardingAnswersRequest): Promise<OnboardingState> {
    this.#assertPending();
    const s = this.#load();
    let changed = false;
    if (req.answers) {
      for (const [id, answer] of Object.entries(req.answers)) {
        const q = ONBOARDING_QUESTIONS.find((x) => x.id === id);
        if (!q) throw new OnboardingError('invalid_request', `unknown question ${id}`);
        const problems = checkOnboardingAnswer(q, answer);
        if (problems.length > 0) throw new OnboardingError('invalid_request', problems.join('; '));
        if (id === 'nomi')
          for (const n of answer.values['orchestrator'] ?? []) assertNotReserved(n);
        s.answers[id] = answer;
        changed = true;
      }
    }
    if (req.permissions) {
      const folders = req.permissions.folders ?? [];
      let checked: FolderGrant[] = [];
      if (folders.length > 0) {
        if (!this.#d.checkFolders) {
          throw new OnboardingError('invalid_folder', 'folders cannot be granted here');
        }
        try {
          checked = await this.#d.checkFolders(folders);
        } catch (err) {
          throw new OnboardingError('invalid_folder', (err as Error).message);
        }
      }
      s.permissions = {
        vault: req.permissions.vault,
        web: req.permissions.web,
        shell: req.permissions.shell ?? false,
        folders: checked,
      };
      changed = true;
    }
    if (req.skipKey) s.keySkipped = true;
    if (req.access) {
      if (!this.#d.providers.has(req.access)) {
        throw new OnboardingError('access_unavailable', `${req.access} is not set up yet`);
      }
      s.access = req.access;
      s.keySkipped = false;
      s.proposal = null;
    }
    if (changed) s.proposal = null;
    this.#save(s);
    if (changed && missingAnswers(s.answers).length === 0) await this.#applyAnswers(s);
    return this.state();
  }

  /** profilo.md, the "always ask" rules, the permissions: written as soon as they are known. */
  async #applyAnswers(s: Stored): Promise<void> {
    const profile = profileFromAnswers(s.answers);
    await this.#writeProfile(profile, s.permissions);
    const decisions = decisionRulesFrom(profile);
    const saved = patchSettingsFile(this.#d.home, {
      userName: profile.userName,
      decisions,
      ...(s.permissions ? { permissions: s.permissions } : {}),
    });
    const settings = this.#d.settings;
    settings.userName = profile.userName;
    const rules = ((saved['decisions'] as { rules?: unknown[] } | undefined)?.rules ??
      []) as HubSettings['decisions']['rules'];
    settings.decisions = { ...settings.decisions, rules, disabled: decisions.disabled };
    this.#d.gate.setRules(resolveDecisionRules(rules, decisions.disabled));
    if (s.permissions) {
      settings.permissions = { ...fullPermissions(s.permissions), agents: {} };
      this.#d.team.setPolicy(settings.permissions);
    }
  }

  #actor(): VaultActor {
    const { log } = this.#d;
    return {
      agentId: 'system',
      emit: (e) =>
        log.append(EventInputSchema.parse({ agent: 'system', type: e.type, data: e.data })),
    };
  }

  async #writeProfile(profile: Profile, permissions: AgentPermissions | null): Promise<void> {
    const { vault } = this.#d;
    const content = renderProfile(profile, permissions);
    let hash: string | undefined;
    try {
      const current = await vault.read({ agentId: 'system' }, { path: PROFILE_PATH });
      if (current.content?.trim() === content.trim()) return;
      hash = current.hash;
    } catch (err) {
      if ((err as { code?: string }).code !== 'NOT_FOUND') throw err;
    }
    await vault.write(this.#actor(), {
      path: PROFILE_PATH,
      content,
      frontmatter: { type: 'profile', tags: ['profilo'] },
      ...(hash ? { mode: 'overwrite' as const, base_hash: hash } : {}),
    });
  }

  /**
   * The chain the agents start on for the chosen access: the first model with
   * tools of that provider (Claude Agent: `sonnet`; ChatGPT: the plan's first
   * model). Undefined means the default free chain (OpenRouter, nothing chosen,
   * or a provider that is no longer set up).
   */
  async #accessModels(access: OnboardingAccess | null): Promise<ModelRef[] | undefined> {
    const { providers, log } = this.#d;
    if (!access || access === 'openrouter' || !providers.has(access)) return undefined;
    try {
      // A slow provider must not hold the onboarding (or the start that finishes it).
      const list = await Promise.race([
        providers.get(access).listModels({ tools: true }),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error('the list of models did not come in time')),
            MODELS_TIMEOUT_MS,
          ).unref(),
        ),
      ]);
      const first = list[0];
      if (first) return [{ provider: access, model: first.id }];
    } catch (err) {
      log.append({
        agent: 'system',
        type: 'error',
        data: { code: 'onboarding', message: `${access}: ${errorMessage(err)}` },
      });
    }
    return undefined;
  }

  async #context(s: Stored, saved?: ModelRef[] | null): Promise<ProposalContext> {
    if (missingAnswers(s.answers).length > 0) {
      throw new OnboardingError('answers_incomplete', 'answer every question first');
    }
    const models =
      saved !== undefined
        ? (saved ?? undefined)
        : (this.#d.agentModels?.() ?? (await this.#accessModels(s.access)));
    const profile = profileFromAnswers(s.answers);
    // Answers saved before the check: the orchestrator would become `user` or `system`.
    assertNotReserved(profile.orchestratorName);
    return {
      profile,
      permissions: s.permissions ?? this.#d.settings.permissions ?? DEFAULT_AGENT_PERMISSIONS,
      ...(models ? { models } : {}),
    };
  }

  /**
   * Proposes the team: the model (one retry), or the fixed team. Refused while
   * the kill switch is engaged; a kill during the model call stops it.
   */
  async propose(signal?: AbortSignal): Promise<OnboardingState> {
    this.#assertPending();
    const { log, runs } = this.#d;
    if (runs.halted) throw haltedError();
    const s = this.#load();
    const ctx = await this.#context(s);
    // The ChatGPT plan, when chosen, also proposes the team; a harness cannot
    // (not a chat model): then the free chain if there is a key, or the fixed team.
    this.#proposalChain =
      this.#d.proposalModels?.() ??
      (s.access === 'chatgpt' && ctx.models ? ctx.models : DEFAULT_FREE_CHAIN);
    const generate = this.#d.hasModelProvider() ? this.#generate : null;
    // The global scope signal is replaced after each kill: take the current one.
    const kill = runs.signal;
    const stop = signal ? AbortSignal.any([signal, kill]) : kill;
    let proposal: TeamProposal;
    try {
      proposal = await proposeTeam(ctx, generate, {
        signal: stop,
        onError: (message) =>
          log.append({ agent: 'system', type: 'error', data: { code: 'onboarding', message } }),
        // Why each attempt failed, for a diagnosis: a quiet line, not in Attività (item 14).
        onAttempt: (message) =>
          log.append({
            agent: 'system',
            type: 'error',
            data: { code: 'onboarding_attempt', message },
          }),
        onUsage: (data) => log.append({ agent: 'system', type: 'provider_usage', data }),
      });
    } catch (err) {
      if (kill.aborted || runs.halted) throw haltedError();
      throw err;
    }
    if (kill.aborted || runs.halted) throw haltedError();
    log.append({
      agent: 'system',
      type: 'decision',
      data: {
        kind: 'team_proposal',
        question: 'Quale squadra serve?',
        options: proposal.members.map((m) => m.name),
        choice: proposal.members.map((m) => m.name).join(', '),
        decidedBy: proposal.source === 'model' ? 'model' : 'rules',
        reason:
          proposal.source === 'model'
            ? `proposta del modello ${proposal.model ?? ''}`.trim()
            : 'squadra di partenza (Rhea e Dione)',
      },
    });
    const fresh = this.#load();
    this.#save({ ...fresh, proposal });
    return this.state();
  }

  /** A new monster for one proposed member, keeping the hues apart. */
  regenerate(id: string): ProposedAgent {
    this.#assertPending();
    const s = this.#load();
    const proposal = s.proposal;
    if (!proposal) throw new OnboardingError('no_proposal', 'propose the team first');
    const member = proposal.members.find((m) => m.id === id);
    if (!member) throw new OnboardingError('unknown_member', `no proposed member ${id}`);
    const others = [
      proposal.orchestrator.genome,
      ...proposal.members.filter((m) => m.id !== id).map((m) => m.genome),
    ].map((g) => (g as MonsterGenome).palette.hue);
    const previous = member.genome as MonsterGenome;
    const seed =
      (hashString(`${member.name}-${Date.now()}-${Math.random()}`) ^ previous.seed) >>> 0;
    const genome = designMonster(member.name, { avoidHues: others, seed });
    const next: ProposedAgent = { ...member, genome, color: colorOfGenome(genome) };
    this.#save({
      ...s,
      proposal: {
        ...proposal,
        members: proposal.members.map((m) => (m.id === id ? next : m)),
      },
    });
    return next;
  }

  /**
   * Creates the team: agent folders from the fixed templates (validated),
   * orchestrator with the chosen name, settings, vault permissions, and the
   * welcome message of the orchestrator.
   */
  async confirm(req: TeamConfirmRequest): Promise<{ agents: AgentSummary[]; welcome: string }> {
    // A confirmation left half-way: the team being created is that one, finished now.
    const pending = this.#load().confirming;
    if (!pending) this.#assertPending();
    if (this.#busy) throw new OnboardingError('busy', 'the team is being created');
    this.#busy = true;
    try {
      return await this.#confirm(pending?.request ?? req);
    } finally {
      this.#busy = false;
    }
  }

  /**
   * At the start: a confirmation a previous core left half-way (it failed, or
   * the computer went off) is run again to its end (M10). False when there was
   * none; a failure is logged, never thrown.
   */
  async finishPending(): Promise<boolean> {
    const pending = this.#load().confirming;
    if (!pending || this.#busy) return false;
    if ((pending.attempts ?? 0) >= MAX_CONFIRM_ATTEMPTS) {
      // It fails the same way every time: stop rewriting at each start, and say what is left.
      const left = pendingSteps(pending.steps ?? []);
      this.#save({ ...this.#load(), proposal: null, confirming: null });
      this.#d.log.append({
        agent: 'system',
        type: 'error',
        data: {
          code: 'onboarding',
          message: `la squadra non è stata completata dopo ${MAX_CONFIRM_ATTEMPTS} tentativi: non riprovo più. Mancano: ${left.join(', ')}. Controlla Impostazioni.`,
        },
      });
      return false;
    }
    try {
      await this.confirm(pending.request);
      return true;
    } catch (err) {
      this.#d.log.append({
        agent: 'system',
        type: 'error',
        data: {
          code: 'onboarding',
          message: `la squadra non è stata completata: ${(err as Error).message}`,
        },
      });
      return false;
    }
  }

  async #confirm(req: TeamConfirmRequest) {
    const { team, vault, log, home } = this.#d;
    const s = this.#load();
    const pending = s.confirming ?? undefined;
    const ctx = await this.#context(s, pending ? (pending.models ?? null) : undefined);
    const proposal = s.proposal;
    if (!proposal) throw new OnboardingError('no_proposal', 'propose the team first');
    const profile = ctx.profile;

    // Names and ids must be unique, the orchestrator's included: two names can
    // differ ("Àtlas", "Atlas") and still give the same id, i.e. the same folder.
    const orchestratorId = proposal.orchestrator.id;
    const usedNames = new Set([profile.orchestratorName.toLowerCase()]);
    const usedIds = new Map([[orchestratorId, profile.orchestratorName]]);
    const members: ProposedAgent[] = [];
    for (const pick of req.members) {
      const member = proposal.members.find((m) => m.id === pick.id);
      if (!member) throw new OnboardingError('unknown_member', `no proposed member ${pick.id}`);
      const name = pick.name ? cleanName(pick.name) : member.name;
      if (!AGENT_NAME_PATTERN.test(name)) {
        throw new OnboardingError('invalid_name', `"${name}" is not a valid name`);
      }
      if (usedNames.has(name.toLowerCase())) {
        throw new OnboardingError('invalid_name', `the name ${name} is already taken`);
      }
      assertNotReserved(name);
      const id = agentId(name);
      const clash = usedIds.get(id);
      if (clash !== undefined) {
        throw new OnboardingError(
          'invalid_name',
          `the name ${name} is too similar to ${clash}: choose another one`,
        );
      }
      usedNames.add(name.toLowerCase());
      usedIds.set(id, name);
      // Duties and area as the user reviewed them; the area is validated again
      // here, whatever the client sent or the stored proposal holds.
      const area = AgentAreaSchema.safeParse(pick.area ?? member.area);
      if (!area.success) {
        throw new OnboardingError(
          'invalid_request',
          `${name}: ${area.error.issues[0]?.message ?? 'invalid area'}`,
        );
      }
      const genome = { ...(member.genome as MonsterGenome), id };
      members.push({
        ...member,
        id,
        name,
        genome,
        area: area.data,
        ...(pick.duties ? { duties: pick.duties } : {}),
      });
    }
    const problems = checkMembers(members, ctx);
    if (problems.length > 0) throw new OnboardingError('invalid_request', problems.join('; '));

    const base = orchestratorBlueprint({
      user: profile.userName,
      name: profile.orchestratorName,
      language: profile.language,
      team: members.map((m) => ({ name: m.name, summary: m.role })),
      ...(ctx.models ? { models: ctx.models } : {}),
    });
    const orchestrator = {
      ...base,
      id: proposal.orchestrator.id,
      color: proposal.orchestrator.color,
      tools: allowedTools(base.tools ?? [], ctx.permissions),
      genome: proposal.orchestrator.genome as Record<string, unknown>,
    };
    const blueprints = [orchestrator, ...members.map((m) => memberBlueprint(m, ctx))];
    // Render everything before writing anything: a bad file never leaves half a team.
    for (const bp of blueprints) renderAgentFiles(bp);
    // From the first folder on the team exists: what follows is finished by a new attempt or
    // at the next start if it stops half-way (M10). The steps done, the models chosen and the
    // attempts are saved: a new attempt does only what is missing, never over what the user
    // changed meanwhile, with the same models (review of 19/10, item 8).
    const done = new Set<ConfirmStep>(pending?.steps ?? []);
    this.#save({
      ...s,
      confirming: {
        request: req,
        models: ctx.models ?? null,
        steps: [...done],
        attempts: (pending?.attempts ?? 0) + 1,
      },
    });
    const step = async (name: ConfirmStep, work: () => unknown): Promise<void> => {
      if (done.has(name)) return;
      await work();
      done.add(name);
      const now = this.#load();
      if (now.confirming)
        this.#save({ ...now, confirming: { ...now.confirming, steps: [...done] } });
    };
    await step('folders', async () => {
      for (const bp of blueprints) {
        const dir = join(team.dir, bp.id);
        // Written whole by an attempt cut before the end of this step (its last file is the
        // blueprint): kept as it is.
        if (pending && existsSync(join(dir, BLUEPRINT_JSON))) continue;
        await writeAgentFolder(dir, bp);
      }
    });
    await team.load();
    // The squad of "abbonamento prima" (D-069): on the Claude plan every monster, the capo
    // included, starts in "Automatica", base Media (D-110).
    await step('models', async () => {
      if (!isClaudePlanChain(ctx.models ?? [])) return;
      for (const bp of blueprints) {
        await team.setModels(bp.id, autoChain('medium'), { base: 'medium' });
      }
    });

    vault.setPermissions(team.vaultPermissions());
    await step('vault', () => this.#moveDefaultMemory(profile.orchestratorName));

    const permissions = ctx.permissions;
    await step('settings', () => {
      patchSettingsFile(home, {
        userName: profile.userName,
        orchestratorName: profile.orchestratorName,
        permissions,
      });
      Object.assign(this.#d.settings, {
        userName: profile.userName,
        orchestratorName: profile.orchestratorName,
        permissions: { ...fullPermissions(permissions), agents: {} },
      });
      team.setPolicy(permissions);
    });
    await step('profile', () => this.#writeProfile(profile, permissions));

    const welcome = welcomeText(profile, members, this.#d.hasModelProvider());
    // The welcome is the last step, and closes the confirmation at once.
    log.append({
      agent: orchestrator.id,
      type: 'message',
      data: { role: 'agent', text: welcome, channel: 'system' },
    });
    this.#save({ ...this.#load(), proposal: null, confirming: null });
    return { agents: team.summaries(), welcome };
  }

  /**
   * A new vault starts with `Agenti/Titan/MEMORY.md`. When the orchestrator
   * has another name and that note was never touched, it goes to the trash
   * (the right one is created on first use).
   */
  async #moveDefaultMemory(orchestratorName: string): Promise<void> {
    const { vault, team } = this.#d;
    const fallback = this.#d.settings.orchestratorName || 'Titan';
    if (fallback.toLowerCase() === orchestratorName.toLowerCase() || team.get(fallback)) return;
    const path = `Agenti/${fallback}/MEMORY.md`;
    try {
      const note = await vault.read({ agentId: 'system' }, { path });
      const pristine =
        (note.content ?? '')
          .trim()
          .split('\n')
          .filter((l) => l.trim()).length <= 2;
      if (pristine)
        await vault.delete(this.#actor(), {
          path,
          reason: 'onboarding: altro nome del coordinatore',
        });
    } catch {
      // not there, or already changed by the user: leave it
    }
  }
}
