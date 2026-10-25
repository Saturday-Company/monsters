import {
  BROWSER_SERVER,
  MCP_CATALOG,
  defineTool,
  formatList,
  settingsPath,
  ToolError,
  type Channel,
  type ClaudeConnectionsResponse,
  type McpServerRequest,
  type McpServersResponse,
  type MonstersTool,
  type PermissionsUpdateRequest,
  type Project,
  type ProjectUpdateRequest,
  type Question,
} from '@monsters/shared';
import { z } from 'zod';
import type { AgentDefinition } from '../agents/definition.ts';
import type { RunHandle } from '../kill/run-controller.ts';
import type { EventLog } from '../log/event-log.ts';
import { accessPrompts } from './access.prompts.ts';
import { accessStrings } from './access.strings.ts';
import { pickedOption, QuestionExpiredError, type QuestionStore } from './questions.ts';
import { ASK_USER_WAIT_MS } from './team-tools.ts';
import type { TeamService } from './team-service.ts';

/*
 * `access_request` (D-130): the capo of a project, or the orchestrator, asks
 * the user for an access a monster lacks. Three kinds, nothing else:
 * - the web for a monster (its permission in Permessi, and the project's
 *   "Ricerca sul web" when the project has it off);
 * - a service already connected and given to the whole team (an MCP server
 *   or a service through Claude), for a project that has not chosen it;
 * - the browser of Monsters for a project (or for some of its monsters).
 * The monster never grants anything: the request is a question of the
 * questions store (parked like `ask_user`, so the app and Telegram show it)
 * with "Sì, concedi" and "No", answered by the user in person only (never the
 * CLI token, never a person of a group, never a message that does not pick
 * one for sure). On "Sì, concedi" the core checks again and applies what was
 * asked through the same services as the app (permissions, project,
 * browser), and writes `access_grant` in Attività. A service not connected to
 * the account cannot be asked: the tool says where the user connects it.
 */

export const ACCESS_TOOL = 'access_request';

const GRANT = 'grant';
const DENY = 'deny';

/** One change the core applies when the user grants a request. */
export type AccessStep =
  /** The monster's own web permission (Impostazioni → Permessi). */
  | { do: 'agent_web'; agent: string }
  /** The project's "Ricerca sul web" (scheda Collegamenti). */
  | { do: 'project_web'; project: string }
  /** A connection of the whole team chosen for the project (scheda Collegamenti). */
  | { do: 'project_link'; project: string; via: 'mcp' | 'claude'; id: string }
  /** A server given to one monster by name (the browser, Impostazioni → App e Telegram). */
  | { do: 'server_agent'; server: string; agent: string };

/** What a request stores with its question. */
export interface AccessGrant {
  from: string;
  /** What it gives, in the app's language at the time ("Pixel web access"). */
  summary: string;
  steps: AccessStep[];
}

const AccessGrantSchema = z.object({
  from: z.string().min(1),
  summary: z.string().min(1),
  steps: z.array(
    z.union([
      z.object({ do: z.literal('agent_web'), agent: z.string().min(1) }),
      z.object({ do: z.literal('project_web'), project: z.string().min(1) }),
      z.object({
        do: z.literal('project_link'),
        project: z.string().min(1),
        via: z.enum(['mcp', 'claude']),
        id: z.string().min(1),
      }),
      z.object({
        do: z.literal('server_agent'),
        server: z.string().min(1),
        agent: z.string().min(1),
      }),
    ]),
  ),
});

export interface AccessRequestsOptions {
  team: TeamService;
  questions: QuestionStore;
  log: Pick<EventLog, 'append' | 'query'>;
  /** Impostazioni → Permessi (`PermissionsService.update`). */
  permissions: {
    update(req: PermissionsUpdateRequest, by: Channel): Promise<unknown>;
  };
  /** The project's settings (`ProjectService.update`). */
  projects: () =>
    { update(id: string, req: ProjectUpdateRequest, by: Channel): Promise<unknown> } | undefined;
  /** The MCP servers (`McpManager`). */
  mcp: {
    view(): McpServersResponse;
    upsert(name: string, req: McpServerRequest, by: Channel): Promise<unknown>;
    /** May this monster use this server now (`McpManager.allowed`): then there is nothing to ask. */
    allowed?(agentId: string, server: string): boolean;
    /** The labels of its servers that are not responding (`McpManager.unlinkedFor`). */
    unlinkedFor?(agent: AgentDefinition): string[];
  };
  /** The services through Claude (`ClaudeConnectionService.view`). */
  claude: () => ClaudeConnectionsResponse;
  /** How the monsters call the user ("Giulio"). */
  userName?: () => string | undefined;
}

/** Lower case, without "claude.ai " and spaces around. */
const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/^claude\.ai\s+/, '')
    .trim();

const Input = z.object({
  access: z
    .enum(['web', 'service', 'browser'])
    .describe(
      'web: search and read pages; service: a program or service already connected to the account (Canva, Notion…); browser: the browser of Monsters (sites where the user is signed in)',
    ),
  monster: z
    .string()
    .max(40)
    .optional()
    .describe(
      'Who needs it (name). web: required (yourself too). browser: default every monster of the project',
    ),
  service: z
    .string()
    .max(64)
    .optional()
    .describe('service: its name as the user sees it ("Canva", "Notion")'),
  project: z
    .string()
    .max(64)
    .optional()
    .describe('Only the orchestrator: the project it is for (default: the project of the monster)'),
  why: z.string().min(3).max(300).describe('One line for the user: what it is needed for'),
});

export interface AccessToolContext {
  run: RunHandle;
  self: AgentDefinition;
  /** How long a native run holds the request (0 on a harness: it parks at once, D-078). */
  waitMs?: () => number;
}

/** What the model reads when its request is parked: the answer starts a new turn. */
const parkedNote = () => accessPrompts().parked(accessStrings().grant, accessStrings().deny);

/** The note after an answer starts "Fatto"/"Done" when the access was granted and applied. */
const GRANTED_NOTE = /^(?:Fatto|Done)\b/;

export class AccessRequests {
  readonly #o: AccessRequestsOptions;
  /** Grants being applied, by question: the run that continues waits for them. */
  readonly #pending = new Map<string, Promise<string>>();

  constructor(options: AccessRequestsOptions) {
    this.#o = options;
  }

  /**
   * Applies a granted request when its answer comes (call before the listener
   * that wakes the monster: it waits with `settled`). Returns the detach.
   */
  attach(): () => void {
    return this.#o.questions.onAnswer((q) => {
      const grant = this.#grantOf(q.id);
      if (!grant || !q.answer) return;
      const work = this.#answered(q, grant);
      this.#pending.set(q.id, work);
      void work.finally(() => {
        // Kept a little: a continuation may ask after the work ended.
        setTimeout(() => this.#pending.delete(q.id), 60_000).unref?.();
      });
    });
  }

  /**
   * The line the monster reads after the answer to a request ("Fatto: …"), once the core has
   * applied it; empty for any other question.
   */
  async settled(questionId: string): Promise<string> {
    return (await this.#pending.get(questionId)) ?? '';
  }

  /** A question that is a request of an access. */
  isRequest(questionId: string): boolean {
    return this.#grantOf(questionId) !== undefined;
  }

  #grantOf(questionId: string): AccessGrant | undefined {
    const raw = this.#o.questions.accessOf(questionId);
    if (raw === undefined) return undefined;
    const parsed = AccessGrantSchema.safeParse(raw);
    return parsed.success ? parsed.data : undefined;
  }

  /** The answer's channel, from its event: the grant is the user's in person. */
  #answerChannel(q: Question): Channel | undefined {
    const e = this.#o.log
      .query({ runId: q.runId, type: 'answer', order: 'desc', limit: 20 })
      .find((x) => x.type === 'answer' && x.data.questionId === q.id);
    return e?.type === 'answer' ? e.data.channel : undefined;
  }

  async #answered(q: Question, grant: AccessGrant): Promise<string> {
    const answer = q.answer ?? {};
    const channel = this.#answerChannel(q);
    const picked = answer.optionId ?? pickedOption(q, answer.text ?? '');
    // The CLI token is never the user in person (a monster with the terminal can read it).
    const granted = picked === GRANT && channel !== 'cli';
    const by: Channel = channel ?? 'ui';
    if (!granted) {
      this.#o.log.append({
        agent: 'user',
        runId: q.runId,
        type: 'access_grant',
        data: {
          questionId: q.id,
          from: grant.from,
          outcome: 'denied',
          summary: grant.summary,
          by,
        },
      });
      return accessPrompts().notGranted(grant.summary);
    }
    try {
      await this.#apply(grant, by);
    } catch (err) {
      const message = (err as Error).message.slice(0, 400);
      this.#o.log.append({
        agent: 'system',
        runId: q.runId,
        type: 'access_grant',
        data: {
          questionId: q.id,
          from: grant.from,
          outcome: 'failed',
          summary: grant.summary,
          message,
          by,
        },
      });
      return accessPrompts().grantedNotApplied(message);
    }
    this.#o.log.append({
      agent: 'user',
      runId: q.runId,
      type: 'access_grant',
      data: { questionId: q.id, from: grant.from, outcome: 'granted', summary: grant.summary, by },
    });
    return accessPrompts().granted(grant.summary);
  }

  /** The steps of a granted request, checked again: what changed meanwhile is skipped. */
  async #apply(grant: AccessGrant, by: Channel): Promise<void> {
    const { team } = this.#o;
    for (const step of grant.steps) {
      switch (step.do) {
        case 'agent_web': {
          if (!team.byId(step.agent)) throw new Error(accessStrings().stepMonsterGone);
          const saved = team.savedPermissionsFor(step.agent);
          if (saved.web) break;
          await this.#o.permissions.update(
            { agents: { [step.agent]: { ...saved, web: true } } },
            by,
          );
          break;
        }
        case 'project_web': {
          const p = team.project(step.project);
          if (!p || p.archivedAt !== undefined) throw new Error(accessStrings().stepProjectGone);
          if (p.webSearch) break;
          await this.#projects().update(p.id, { webSearch: true }, by);
          break;
        }
        case 'project_link': {
          const p = team.project(step.project);
          if (!p || p.archivedAt !== undefined) throw new Error(accessStrings().stepProjectGone);
          if (!this.#teamWide(step.via, step.id)) {
            throw new Error(accessStrings().stepLinkNotTeamWide);
          }
          // The user turned it off for the project (D-164): on again.
          const off = p.connectionsOff[step.via];
          if (!off.includes(step.id)) break;
          await this.#projects().update(
            p.id,
            { connectionsOff: { [step.via]: off.filter((x) => x !== step.id) } },
            by,
          );
          break;
        }
        case 'server_agent': {
          const server = this.#o.mcp.view().servers.find((s) => s.name === step.server);
          if (!server) throw new Error(accessStrings().stepServerGone(step.server));
          if (!team.byId(step.agent)) throw new Error(accessStrings().stepMonsterGone);
          if (server.agents.includes(step.agent)) break;
          await this.#o.mcp.upsert(step.server, { agents: [...server.agents, step.agent] }, by);
          break;
        }
      }
    }
  }

  #projects() {
    const p = this.#o.projects();
    if (!p) throw new Error(accessStrings().stepProjectsNotReady);
    return p;
  }

  /** The connection is given to the whole team (`*`). */
  #teamWide(via: 'mcp' | 'claude', id: string): boolean {
    return via === 'mcp'
      ? this.#o.mcp.view().servers.some((s) => s.name === id && s.agents.includes('*'))
      : this.#o.claude().connections.some((c) => c.id === id && c.added && c.agents.includes('*'));
  }

  // --- the tool -----------------------------------------------------------------------

  tool(ctx: AccessToolContext): MonstersTool {
    return defineTool({
      name: ACCESS_TOOL,
      description: accessPrompts().toolDescription(accessStrings().grant, accessStrings().deny),
      inputSchema: Input,
      execute: async (input, tc) => {
        const plan = this.#plan(ctx.self, input);
        if ('done' in plan) return { status: 'already', note: plan.done };
        const user = this.#o.userName?.()?.trim() || accessPrompts().theUser;
        const question = this.#o.questions.create({
          agent: ctx.self.config.id,
          runId: ctx.run.id,
          parentId: tc.callEventId ?? null,
          question: accessStrings().question(plan.summary, input.why.trim()).slice(0, 1000),
          options: [
            { id: GRANT, label: accessStrings().grant, description: plan.changes },
            { id: DENY, label: accessStrings().deny, description: accessStrings().denyDescription },
          ],
          blocking: true,
          access: {
            from: ctx.self.config.id,
            summary: plan.summary,
            steps: plan.steps,
          } satisfies AccessGrant,
        });
        const waitMs = Math.max(0, ctx.waitMs?.() ?? ASK_USER_WAIT_MS);
        const parked = (reason: 'harness' | 'timeout') => {
          this.#o.questions.park(question.id, reason);
          return { status: 'waiting_user', question_id: question.id, note: parkedNote() };
        };
        // What the asking monster gains itself comes with its next run only (its tools are fixed for
        // this one): parked at once, the user's tap starts that run, no message to write (D-163).
        if (waitMs === 0 || this.#gainsSelf(ctx.self, plan.steps)) return parked('harness');
        const timeout = AbortSignal.timeout(waitMs);
        try {
          await this.#o.questions.waitFor(question.id, AbortSignal.any([tc.signal, timeout]));
          const outcome = await this.settled(question.id);
          return {
            status: GRANTED_NOTE.test(outcome) ? 'granted' : 'not_granted',
            question_id: question.id,
            note: outcome,
          };
        } catch (err) {
          if (tc.signal.aborted) throw err;
          if (timeout.aborted && !(err instanceof QuestionExpiredError)) {
            return this.#o.questions.get(question.id)?.status === 'open'
              ? parked('timeout')
              : { status: 'waiting_user', question_id: question.id, note: parkedNote() };
          }
          if (err instanceof QuestionExpiredError) {
            throw new ToolError('ABORTED', 'the request expired without an answer', {
              hint: `Go on without it and tell ${user} what is missing.`,
            });
          }
          throw err;
        }
      },
    });
  }

  /** A step that gives the asking monster itself a tool: its web, its project's service, a server. */
  #gainsSelf(self: AgentDefinition, steps: readonly AccessStep[]): boolean {
    const own = this.#o.team.projectOf(self.config.id)?.id;
    return steps.some((s) =>
      s.do === 'project_link' || s.do === 'project_web'
        ? s.project === own
        : s.agent === self.config.id,
    );
  }

  /**
   * What a request asks, checked now: the steps and their words, or `done`
   * when there is nothing to grant (the line says why). Throws `ToolError`
   * for what cannot be asked (with where the user does it).
   */
  #plan(
    self: AgentDefinition,
    input: z.infer<typeof Input>,
  ): { steps: AccessStep[]; summary: string; changes: string } | { done: string } {
    const { team } = this.#o;
    const isOrchestrator = self.config.kind === 'orchestrator';
    const own = team.projectOf(self.config.id);
    if (!isOrchestrator && !(self.config.kind === 'lead' && own)) {
      throw new ToolError('NOT_IN_RUN', 'only a capo asks for an access', {
        hint: 'Tell your capo what you need.',
      });
    }
    const monster = input.monster?.trim() ? team.get(input.monster) : undefined;
    if (input.monster?.trim() && !monster) {
      throw new ToolError('NOT_FOUND', `no monster "${input.monster}"`, {
        hint: 'Use the name of a monster of your squad.',
      });
    }
    // The project the request is for: the lead's own, or the one the orchestrator names.
    let project: Project | undefined;
    if (!isOrchestrator) {
      project = own;
      if (input.project?.trim() && team.project(input.project)?.id !== own?.id) {
        throw new ToolError('BLOCKED_BY_POLICY', 'only for your project', {
          hint: accessPrompts().onlyForProject(own?.name ?? ''),
        });
      }
      if (monster && team.projectOf(monster.config.id)?.id !== own?.id) {
        throw new ToolError('BLOCKED_BY_POLICY', `${monster.config.name} is not of your project`, {
          hint: 'Ask for the monsters of your project only.',
        });
      }
    } else if (input.project?.trim()) {
      project = team.project(input.project);
      if (!project || project.status !== 'active' || project.archivedAt !== undefined) {
        throw new ToolError('NOT_FOUND', `no active project "${input.project}"`);
      }
    } else if (monster) {
      project = team.projectOf(monster.config.id);
    }
    if (monster && project && team.projectOf(monster.config.id)?.id !== project.id) {
      throw new ToolError(
        'INVALID_INPUT',
        accessPrompts().monsterNotOfProject(monster.config.name, project.name),
      );
    }

    if (input.access === 'web') {
      const who = monster ?? self;
      const p = team.projectOf(who.config.id);
      const steps = this.#webSteps(who, p);
      if (steps.length === 0) {
        return {
          done: `${who.config.name} has the web already: it gets web_search and web_fetch at every job (delegate again if it said otherwise).`,
        };
      }
      return {
        steps,
        summary: accessStrings().summaryWeb(who.config.name, p?.name),
        changes: this.#changesOf(steps),
      };
    }

    if (input.access === 'service') {
      const name = input.service?.trim();
      if (!name) throw new ToolError('INVALID_INPUT', 'say which service (its name)');
      // A service the monster has already (D-163): an answer, never a card to the user.
      const forSelf =
        (!monster || monster.config.id === self.config.id) &&
        (!input.project?.trim() || project?.id === own?.id);
      const mine = forSelf ? this.#serverOf(name) : undefined;
      if (mine && this.#o.mcp.allowed?.(self.config.id, mine.name)) {
        const unlinked = this.#o.mcp.unlinkedFor?.(self).includes(mine.label) ?? false;
        return { done: accessPrompts().serviceYours(mine.label, `mcp__${mine.name}__`, unlinked) };
      }
      const found = this.#findService(name);
      if (!project) {
        return {
          done: accessPrompts().serviceReaches(found.label),
        };
      }
      if (!project.connectionsOff[found.via].includes(found.id)) {
        return {
          done: accessPrompts().serviceOnAlready(found.label, project.name, found.via === 'claude'),
        };
      }
      const steps: AccessStep[] = [
        { do: 'project_link', project: project.id, via: found.via, id: found.id },
      ];
      return {
        steps,
        summary: accessStrings().summaryService(found.label, project.name),
        changes: this.#changesOf(steps),
      };
    }

    // The browser.
    const browser = this.#o.mcp.view().servers.find((s) => s.preset === 'browser');
    if (!browser) {
      throw new ToolError('NOT_FOUND', 'the browser of Monsters is not set up', {
        hint: accessPrompts().browserNotSetUp(this.#o.userName?.()?.trim() || 'the user'),
      });
    }
    if (!browser.enabled) {
      throw new ToolError('UNAVAILABLE', 'the browser of Monsters is off', {
        hint: accessPrompts().browserIsOff(),
      });
    }
    const targets = monster
      ? [monster]
      : project
        ? team.members(project.id)
        : isOrchestrator
          ? []
          : [self];
    if (targets.length === 0) {
      throw new ToolError('INVALID_INPUT', 'say which monster or which project needs the browser');
    }
    const steps: AccessStep[] = [];
    if (browser.agents.includes('*')) {
      if (project?.connectionsOff.mcp.includes(browser.name)) {
        steps.push({ do: 'project_link', project: project.id, via: 'mcp', id: browser.name });
      }
    } else {
      for (const t of targets) {
        if (!browser.agents.includes(t.config.id)) {
          steps.push({ do: 'server_agent', server: browser.name, agent: t.config.id });
        }
      }
    }
    // The browser follows the web permission (D-097).
    for (const t of targets) {
      for (const s of this.#webSteps(t, team.projectOf(t.config.id))) {
        if (!steps.some((x) => JSON.stringify(x) === JSON.stringify(s))) steps.push(s);
      }
    }
    const names = targets.map((t) => t.config.name);
    if (steps.length === 0) {
      return {
        done: `${formatList(names)} ${names.length === 1 ? 'has' : 'have'} the browser already, from the next job.`,
      };
    }
    return {
      steps,
      summary:
        !monster && project
          ? accessStrings().summaryBrowserProject(project.name)
          : accessStrings().summaryBrowserMonsters(names, project?.name),
      changes: this.#changesOf(steps),
    };
  }

  /** What gives the web to a monster: its permission, and its project's search. */
  #webSteps(who: AgentDefinition, project: Project | undefined): AccessStep[] {
    const steps: AccessStep[] = [];
    if (!this.#o.team.savedPermissionsFor(who.config.id).web) {
      steps.push({ do: 'agent_web', agent: who.config.id });
    }
    if (project && !project.webSearch) steps.push({ do: 'project_web', project: project.id });
    return steps;
  }

  /** An MCP server (not the browser) by the name the user knows, its label or its catalog entry. */
  #serverOf(name: string): McpServersResponse['servers'][number] | undefined {
    const n = norm(name);
    return this.#o.mcp
      .view()
      .servers.filter((s) => s.preset !== 'browser')
      .find(
        (s) =>
          norm(s.name) === n ||
          norm(s.label) === n ||
          (s.catalog !== undefined &&
            norm(MCP_CATALOG.find((e) => e.id === s.catalog)?.name ?? '') === n),
      );
  }

  /** A service connected to Monsters and given to the whole team, by the name the user knows. */
  #findService(name: string): { via: 'mcp' | 'claude'; id: string; label: string } {
    const n = norm(name);
    const user = this.#o.userName?.()?.trim() || 'the user';
    const servers = this.#o.mcp.view().servers.filter((s) => s.preset !== 'browser');
    const server = this.#serverOf(name);
    const services = this.#o.claude().connections;
    const entry = MCP_CATALOG.find(
      (e) => e.viaClaude !== undefined && (norm(e.id) === n || norm(e.name) === n),
    );
    const service = entry ? services.find((c) => c.id === entry.id && c.added) : undefined;
    if (n === BROWSER_SERVER) {
      throw new ToolError('INVALID_INPUT', 'the browser is its own access', {
        hint: accessPrompts().browserOwnAccess,
      });
    }
    if (server) {
      if (!server.agents.includes('*')) {
        throw new ToolError('SETTING_OFF', `${server.label} is not given to the whole team`, {
          hint: accessPrompts().onlyUserChanges(
            `${settingsPath('collegamenti')} (${server.label})`,
            user,
          ),
        });
      }
      return { via: 'mcp', id: server.name, label: server.label };
    }
    if (service) {
      if (!service.agents.includes('*')) {
        throw new ToolError('SETTING_OFF', `${entry!.name} is not given to the whole team`, {
          hint: accessPrompts().onlyUserChanges(
            `${settingsPath('collegamenti')} (${entry!.name}, ${accessPrompts().viaClaudeLabel})`,
            user,
          ),
        });
      }
      return { via: 'claude', id: service.id, label: entry!.name };
    }
    const known = MCP_CATALOG.find((e) => norm(e.id) === n || norm(e.name) === n);
    const connected = [
      ...servers.filter((s) => s.agents.includes('*')).map((s) => s.label),
      ...services
        .filter((c) => c.added && c.agents.includes('*'))
        .map((c) => MCP_CATALOG.find((e) => e.id === c.id)?.name ?? c.id),
    ];
    throw new ToolError('NOT_FOUND', `${known?.name ?? name} is not connected to the account`, {
      hint: accessPrompts().notConnectedHint(
        known?.name ?? name,
        user,
        Boolean(known?.viaClaude),
        connected.join(', ') || 'none',
      ),
    });
  }

  /** The changes in the app's words, for the card. */
  #changesOf(steps: readonly AccessStep[]): string {
    const { team } = this.#o;
    const name = (id: string) => team.byId(id)?.config.name ?? id;
    const project = (id: string) => team.project(id)?.name ?? id;
    const label = (via: 'mcp' | 'claude', id: string) =>
      via === 'mcp'
        ? (this.#o.mcp.view().servers.find((s) => s.name === id)?.label ?? id)
        : (MCP_CATALOG.find((e) => e.id === id)?.name ?? id);
    const t = accessStrings();
    return t.changesTail(
      steps.map((s) => {
        switch (s.do) {
          case 'agent_web':
            return t.changeAgentWeb(name(s.agent));
          case 'project_web':
            return t.changeProjectWeb(project(s.project));
          case 'project_link':
            return t.changeProjectLink(project(s.project), label(s.via, s.id));
          case 'server_agent':
            return t.changeServerAgent(
              label('mcp', s.server),
              name(s.agent),
              s.server === BROWSER_SERVER,
            );
        }
      }),
    );
  }
}
