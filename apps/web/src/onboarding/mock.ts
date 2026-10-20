import {
  MonsterGenomeSchema,
  ROSTER,
  hashString,
  hueDistance,
  randomGenome,
  slugify,
  type MonsterGenome,
} from '@monsters/monster-kit';
import {
  MOON_NAMES,
  MonsterRegenerateRequestSchema,
  ONBOARDING_QUESTIONS,
  OnboardingAnswersRequestSchema,
  TeamConfirmRequestSchema,
  checkOnboardingAnswer,
  type AgentPermissions,
  type AgentSummary,
  type OnboardingAccess,
  type OnboardingAnswer,
  type OnboardingState,
  type ProposedAgent,
  type TeamProposal,
} from '@monsters/shared';
import { colorOf, monsterFor } from '../lib/monsters.ts';
import type { RawResponse } from '../lib/transport.ts';

/*
 * Onboarding of the mock core (`?mock=1`): same contract as the real one, with
 * a deterministic team instead of the model (Rhea, Dione, and Tethys when
 * the user wants to plan content).
 */

interface Host {
  agents(): AgentSummary[];
  setAgents(list: AgentSummary[]): void;
  welcome(agentId: string, text: string): void;
  /** The provider is set up (OpenRouter key, Claude Agent on, ChatGPT signed in). */
  hasProvider(id: string): boolean;
  /** The team starts on this chain (the composer shows the ChatGPT plan, …). */
  setChain(agentId: string, models: { provider: string; model: string }[]): void;
}

/** First link of the agents' chain for each way to a model. */
const ACCESS_MODEL: Record<OnboardingAccess, { provider: string; model: string }> = {
  openrouter: { provider: 'openrouter', model: 'openrouter/free' },
  'claude-agent': { provider: 'claude-agent', model: 'sonnet' },
  chatgpt: { provider: 'chatgpt', model: 'gpt-test' },
};

/** Providers set up with a key or a local server (the core's "model provider"). */
const MODEL_KEYS = ['anthropic', 'openai', 'google', 'mistral', 'groq', 'ollama', 'lmstudio'];

const ok = (body: unknown, status = 200): RawResponse => ({ status, body });
const fail = (status: number, error: string, message?: string): RawResponse => ({
  status,
  body: message ? { error, message } : { error },
});

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const isRoster = (k: string): boolean => Object.hasOwn(ROSTER, k);

function idOf(name: string): string {
  const slug = slugify(name);
  return /^[a-z]/.test(slug) ? slug : `a-${slug}`;
}

export class MockOnboarding {
  private readonly host: Host;
  private answers: Record<string, OnboardingAnswer> = {};
  private permissions: AgentPermissions | null = null;
  private keySkipped = false;
  private hasKey = false;
  private access: OnboardingAccess | null = null;
  private proposal: TeamProposal | null = null;

  constructor(host: Host) {
    this.host = host;
  }

  keySaved(): void {
    this.hasKey = true;
  }

  private get done(): boolean {
    return this.host.agents().length > 0;
  }

  private complete(): boolean {
    return ONBOARDING_QUESTIONS.every((q) => {
      const a = this.answers[q.id];
      return a !== undefined && checkOnboardingAnswer(q, a).length === 0;
    });
  }

  private value(q: string, g: string): string | undefined {
    return this.answers[q]?.values[g]?.[0]?.trim() || undefined;
  }

  private orchestratorName(): string {
    return cap(this.value('nomi', 'orchestrator') ?? 'Titan');
  }

  /** A model is reachable: a key, the chosen access, or a paid key saved from the first step. */
  private get hasModel(): boolean {
    return (
      this.hasKey || this.access !== null || MODEL_KEYS.some((id) => this.host.hasProvider(id))
    );
  }

  state(): OnboardingState {
    const name = this.done
      ? (this.host.agents().find((a) => a.isOrchestrator)?.name ?? 'Titan')
      : this.orchestratorName();
    return {
      status: this.done ? 'done' : 'pending',
      step: this.done
        ? 'done'
        : !this.hasModel && !this.keySkipped
          ? 'key'
          : !this.complete()
            ? 'questions'
            : !this.permissions
              ? 'permissions'
              : 'team',
      hasKey: this.hasModel,
      keySkipped: this.keySkipped,
      access: this.access,
      answers: this.answers,
      permissions: this.permissions,
      proposal: this.done ? null : this.proposal,
      guide: { name, genome: monsterFor(isRoster(name.toLowerCase()) ? name : 'titan') },
    };
  }

  private member(
    name: string,
    archetype: 'rhea' | 'dione' | null,
    title: string,
    role: string,
    area: string,
    hues: number[],
  ): ProposedAgent {
    const user = cap(this.value('nomi', 'user') ?? 'tu');
    const key = name.toLowerCase();
    let genome: MonsterGenome = monsterFor(name);
    if (!isRoster(key) || hues.some((h) => hueDistance(h, genome.palette.hue) < 30)) {
      genome = randomGenome(hashString(key), slugify(name), { avoidHues: hues });
    }
    hues.push(genome.palette.hue);
    const web = this.permissions?.web !== false && archetype !== 'dione';
    return {
      id: idOf(name),
      name,
      title,
      role,
      mission: role,
      context: `${user} vuole lavorare meglio e con meno fatica.`,
      duties: ['Lavori fino in fondo e lasci tutto nelle note.'],
      area,
      tools: [
        ...(web ? ['web_search', 'web_fetch'] : []),
        'vault_search',
        'vault_read',
        ...(this.permissions?.vault === false ? [] : ['vault_write', 'vault_edit']),
      ],
      color: colorOf(genome),
      genome,
      archetype,
    };
  }

  private propose(): TeamProposal {
    const orchestrator = this.orchestratorName();
    const okName = (n: string) => n.toLowerCase() !== orchestrator.toLowerCase();
    const free = MOON_NAMES.filter(okName);
    const hues: number[] = [];
    const og = monsterFor(isRoster(orchestrator.toLowerCase()) ? orchestrator : 'titan');
    hues.push(og.palette.hue);
    const members = [
      this.member(
        okName('Rhea') ? 'Rhea' : free[0]!,
        'rhea',
        'la ricercatrice',
        'ricerche online e sintesi con fonti',
        'Risorse/Ricerche',
        hues,
      ),
      this.member(
        okName('Dione') ? 'Dione' : free[1]!,
        'dione',
        'la scrittrice',
        'testi pronti da usare: post, mail, riassunti',
        'Inbox/Bozze',
        hues,
      ),
    ];
    const deleghe = this.answers['deleghe']?.values['cosa'] ?? [];
    if (deleghe.includes('piano') || deleghe.includes('note')) {
      members.push(
        this.member(
          free.find((n) => !members.some((m) => m.name === n))!,
          null,
          'il pianificatore',
          'tiene il calendario dei contenuti e le scadenze',
          'Progetti/Calendario',
          hues,
        ),
      );
    }
    return {
      orchestrator: {
        id: idOf(orchestrator),
        name: orchestrator,
        color: colorOf(og),
        genome: og,
      },
      members,
      source: 'fallback',
      requests: 0,
    };
  }

  /** Handles the onboarding routes; null for any other route. */
  handle(method: string, path: string, body: unknown): RawResponse | null {
    if (!path.startsWith('/api/onboarding')) return null;
    const route = `${method} ${path}`;
    if (route === 'GET /api/onboarding') return ok(this.state());
    if (this.done) return fail(409, 'onboarding_done');
    switch (route) {
      case 'POST /api/onboarding/answers': {
        const p = OnboardingAnswersRequestSchema.safeParse(body ?? {});
        if (!p.success) return fail(400, 'invalid_request');
        for (const [id, a] of Object.entries(p.data.answers ?? {})) {
          const q = ONBOARDING_QUESTIONS.find((x) => x.id === id);
          if (!q || checkOnboardingAnswer(q, a).length > 0) return fail(400, 'invalid_request');
          this.answers[id] = a;
          this.proposal = null;
        }
        if (p.data.permissions) {
          this.permissions = p.data.permissions;
          this.proposal = null;
        }
        if (p.data.skipKey) this.keySkipped = true;
        if (p.data.access) {
          if (!this.host.hasProvider(p.data.access)) return fail(409, 'access_unavailable');
          this.access = p.data.access;
          this.keySkipped = false;
          this.proposal = null;
        }
        return ok(this.state());
      }
      case 'POST /api/onboarding/team/propose':
        if (!this.complete()) return fail(409, 'answers_incomplete');
        this.proposal = this.propose();
        return ok(this.state());
      case 'POST /api/onboarding/monster': {
        const p = MonsterRegenerateRequestSchema.safeParse(body);
        if (!p.success) return fail(400, 'invalid_request');
        const proposal = this.proposal;
        const m = proposal?.members.find((x) => x.id === p.data.id);
        if (!proposal || !m) return fail(404, 'unknown_member');
        const hues = [
          proposal.orchestrator.genome,
          ...proposal.members.filter((x) => x !== m).map((x) => x.genome),
        ].map((g) => MonsterGenomeSchema.parse(g).palette.hue);
        const genome = randomGenome((Math.random() * 2 ** 32) >>> 0, slugify(m.name), {
          avoidHues: hues,
        });
        const next = { ...m, genome, color: colorOf(genome) };
        this.proposal = {
          ...proposal,
          members: proposal.members.map((x) => (x === m ? next : x)),
        };
        return ok(next);
      }
      case 'POST /api/onboarding/team/confirm': {
        const p = TeamConfirmRequestSchema.safeParse(body);
        const proposal = this.proposal;
        if (!p.success) return fail(400, 'invalid_request');
        if (!proposal) return fail(409, 'no_proposal');
        const used = new Set([proposal.orchestrator.name.toLowerCase()]);
        const agents: AgentSummary[] = [
          {
            id: proposal.orchestrator.id,
            name: proposal.orchestrator.name,
            role: 'coordina la squadra',
            color: proposal.orchestrator.color,
            isOrchestrator: true,
            genome: proposal.orchestrator.genome,
            state: 'idle',
          },
        ];
        for (const pick of p.data.members) {
          const m = proposal.members.find((x) => x.id === pick.id);
          if (!m) return fail(404, 'unknown_member');
          const name = cap(pick.name?.trim() || m.name);
          if (used.has(name.toLowerCase())) return fail(400, 'invalid_name');
          used.add(name.toLowerCase());
          agents.push({
            id: idOf(name),
            name,
            role: m.role,
            color: m.color,
            isOrchestrator: false,
            genome: m.genome,
            state: 'idle',
          });
        }
        this.host.setAgents(agents);
        if (this.access)
          for (const a of agents) this.host.setChain(a.id, [ACCESS_MODEL[this.access]]);
        const user = cap(this.value('nomi', 'user') ?? '');
        const team = agents
          .slice(1)
          .map((a) => a.name)
          .join(', ')
          .replace(/, ([^,]*)$/, ' e $1');
        const welcome = ['openrouter', 'chatgpt', 'claude-agent', 'codex'].some((id) =>
          this.host.hasProvider(id),
        )
          ? `Ciao ${user}! Sono ${agents[0]!.name} e coordino la tua squadra. Con me ci sono ${team}. Scrivimi quello che ti serve e ci pensiamo noi: per le cose che mi hai indicato, prima chiedo a te.`
          : `Ciao ${user}! Sono ${agents[0]!.name} e coordino la tua squadra: con me ci sono ${team}. Per lavorare mi manca solo un modello: collegane uno e partiamo.`;
        this.host.welcome(agents[0]!.id, welcome);
        return ok({ ok: true, agents, welcome });
      }
      default:
        return fail(404, 'not_found');
    }
  }
}
