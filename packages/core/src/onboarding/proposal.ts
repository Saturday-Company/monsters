import { slugify, type MonsterGenome } from '@monsters/monster-kit';
import type { ModelRef } from '@monsters/providers';
import {
  AgentAreaSchema,
  MOON_NAMES,
  type AgentPermissions,
  type ProposedAgent,
  type TeamProposal,
} from '@monsters/shared';
import { z } from 'zod';
import {
  DEFAULT_FREE_CHAIN,
  VAULT_READ_TOOLS,
  WEB_AGENT_MAX_STEPS,
  WEB_TOOLS,
  dioneBlueprint,
  rheaBlueprint,
} from '../agents/archetypes.ts';
import { renderAgentFiles, type SubagentBlueprint } from '../agents/templates.ts';
import type { ProviderUsage } from '../agents/usage.ts';
import { extractJson } from '../team/decision.ts';
import {
  LookSchema,
  colorOfGenome,
  minHueDistance,
  monsterForMember,
  orchestratorMonster,
} from './monsters.ts';
import { contextSentence, type Profile } from './profile.ts';

/*
 * Team proposal (ARCHITECTURE §7.5-6, research 03 §5): a model fills a small
 * JSON (2-5 agents), zod validates it, one retry with the errors, then the
 * deterministic fallback (Rhea and Dione with the user's context). The code
 * picks names, tools, colours and monsters, and checks that every AGENTS.md
 * renders from the fixed template.
 */

export const MIN_MEMBERS = 2;
export const MAX_MEMBERS = 5;

/** Write tools granted when the vault permission is on. */
export const VAULT_AGENT_WRITE_TOOLS = ['vault_write', 'vault_edit', 'vault_propose'];

const PLACEHOLDER = /\{\{[^}]*\}\}/;

/** One line of plain text, as the AGENTS.md template wants it. */
const Line = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(min)
    .max(max)
    .refine((s) => !/[\r\n]/.test(s), 'must be a single line')
    .refine((s) => !PLACEHOLDER.test(s), 'no {{placeholders}}')
    .refine((s) => !s.startsWith('#'), 'must not start with #');

export const LlmAgentSchema = z.object({
  name: Line(1, 24),
  title: Line(3, 60),
  role: Line(5, 120),
  mission: Line(5, 200),
  context: Line(5, 200),
  duties: z.array(Line(3, 200)).min(1).max(4),
  area: Line(1, 80),
  tools: z.array(z.string()).default([]),
  /** Optional look hints: unknown values are ignored, never fatal. */
  look: LookSchema.optional().catch(undefined),
});
export type LlmAgent = z.infer<typeof LlmAgentSchema>;

export const LlmTeamSchema = z.object({
  agents: z.array(LlmAgentSchema).min(MIN_MEMBERS).max(MAX_MEMBERS),
});

export interface ProposalContext {
  profile: Profile;
  permissions: AgentPermissions;
  /** Model chain of the generated agents. */
  models?: ModelRef[];
}

/** What a model call returns to the proposal. */
export interface Generated {
  text: string;
  model?: string | undefined;
  /** Requests sent (fallback models included). */
  requests: number;
  /** One per request served: the proposal logs them as `provider_usage`. */
  usage?: ProviderUsage[] | undefined;
}

/** A failed call can still have spent requests: a `Generate` may attach them to its error. */
export type GenerateError = Error & { requests?: number; usage?: ProviderUsage[] };

export type Generate = (system: string, prompt: string, signal?: AbortSignal) => Promise<Generated>;

// --- prompt ------------------------------------------------------------------

export const PROPOSAL_SYSTEM = `Progetti la squadra di agenti AI di una persona, a partire dal suo profilo.
Rispondi SOLO con un oggetto JSON valido, senza testo prima o dopo e senza markdown.`;

export function proposalPrompt(ctx: ProposalContext): string {
  const p = ctx.profile;
  const names = allowedNames(p.orchestratorName);
  const tools = ctx.permissions.web
    ? '["web"] se l’agente deve cercare o leggere sul web, altrimenti []'
    : '[] (il web non è permesso)';
  const profile = {
    nome: p.userName,
    occupazione: p.occupation,
    obiettivi: p.goals,
    da_delegare: p.delegate,
    strumenti: p.tools,
    chiedere_sempre_prima_di: p.askFirst,
    tono: p.tone,
    lingua: p.language,
  };
  return `Profilo:
${JSON.stringify(profile, null, 2)}

Proponi da 2 a 5 agenti (meglio 2-3, pochi e utili) che lavorano per ${p.userName} sotto il coordinatore ${p.orchestratorName}.
Ogni agente ha un compito chiaro e diverso dagli altri, legato al profilo.
Se ${p.userName} deve ricevere testi (post, mail, documenti), uno degli agenti li scrive: il coordinatore gli passa quei lavori. Se servono fatti dal web, uno degli agenti fa le ricerche.
Le regole comuni a tutti (scrivere in ${p.language}, link alle pagine web come [testo](url), nomi dei file leggibili) sono già nel modello: nei duties metti solo regole proprie del mestiere di quell'agente.
Per ora gli agenti lavorano solo con le note del vault e, se permesso, con il web: niente compiti su app o account esterni (mail, social, Notion…).

Archetipi di partenza, da usare quando servono e adattare al profilo:
- Rhea: ricerche online e sintesi con fonti.
- Dione: testi pronti da usare (post, mail, riassunti, piani).

Nomi ammessi: ${names.slice(0, 8).join(', ')} (gli altri nell'ordine). Mai ${p.orchestratorName}.

Formato:
{"agents":[{"name":"Rhea","title":"la ricercatrice","role":"ricerche online e sintesi con fonti","mission":"trovi informazioni affidabili e aggiornate e le trasformi in note utili","context":"${p.userName} …","duties":["…"],"area":"Risorse/Ricerche","tools":["web"],"look":{"shape":"egg","eyes":"round"}}]}

Regole dei campi (tutto in italiano, ogni campo su una riga, niente markdown):
- name: uno dei nomi ammessi.
- title: chi è, con l'articolo ("la ricercatrice", "il pianificatore"), max 60 caratteri.
- role: cosa fa in una frase breve, max 120 caratteri.
- mission: il suo lavoro in seconda persona, max 200 caratteri.
- context: una frase su ${p.userName} utile a quell'agente, max 200 caratteri.
- duties: da 1 a 4 regole pratiche in seconda persona, max 200 caratteri ciascuna.
- area: una cartella del vault per i risultati, come "Risorse/Ricerche" o "Progetti/Social" (solo lettere, numeri e "/", mai Agenti, Modelli o Privato).
- tools: ${tools}.
- look (facoltativo): shape tra blob, egg, pear, bean, dome, lumpy; eyes tra round, cyclops, stalk, trio; mouth tra smile, grin, canyon, tiny; topper tra tuft, antenna, crest, geyser.`;
}

// --- normalisation -------------------------------------------------------------

/** Names a member may take: the archetypes, then the moons, minus the orchestrator. */
export function allowedNames(orchestratorName: string): string[] {
  // By id, not by spelling: "Rhéa" and "Rhea" share the folder `rhea`.
  const taken = agentId(orchestratorName.trim());
  return ['Rhea', 'Dione', ...MOON_NAMES].filter((n) => agentId(n) !== taken);
}

function nextFreeName(used: Set<string>, orchestratorName: string): string {
  const taken = agentId(orchestratorName.trim());
  const free = MOON_NAMES.find((n) => !used.has(n.toLowerCase()) && agentId(n) !== taken);
  if (!free) throw new Error('no free names left');
  return free;
}

/** "Trovi informazioni" → "trovi informazioni" (the mission follows a colon), acronyms untouched. */
const lowerFirst = (s: string) =>
  /^\p{Lu}\p{Ll}/u.test(s) ? s.charAt(0).toLowerCase() + s.slice(1) : s;

export function agentId(name: string): string {
  const slug = slugify(name);
  return /^[a-z]/.test(slug) ? slug.slice(0, 64) : `a-${slug}`.slice(0, 64);
}

export function toolsFor(web: boolean, permissions: AgentPermissions): string[] {
  return [
    ...(web && permissions.web ? WEB_TOOLS : []),
    ...VAULT_READ_TOOLS,
    ...(permissions.vault ? VAULT_AGENT_WRITE_TOOLS : []),
  ];
}

interface Draft {
  name: string;
  archetype: 'rhea' | 'dione' | null;
  title: string;
  role: string;
  mission: string;
  context: string;
  duties: string[];
  area: string;
  web: boolean;
  look?: z.infer<typeof LookSchema> | undefined;
}

/**
 * Names (allowed and unique), areas, tools, colours and monsters (hues at
 * least 30° apart, the orchestrator's included).
 */
export function finishMembers(drafts: Draft[], ctx: ProposalContext): ProposedAgent[] {
  const orch = ctx.profile.orchestratorName;
  const allowed = new Map(allowedNames(orch).map((n) => [n.toLowerCase(), n]));
  const used = new Set<string>();
  const hues = [orchestratorMonster(orch).palette.hue];
  const out: ProposedAgent[] = [];
  for (const d of drafts.slice(0, MAX_MEMBERS)) {
    const wanted = allowed.get(d.name.trim().toLowerCase());
    const name = wanted && !used.has(wanted.toLowerCase()) ? wanted : nextFreeName(used, orch);
    used.add(name.toLowerCase());
    const archetype = d.archetype ?? (name === 'Rhea' ? 'rhea' : name === 'Dione' ? 'dione' : null);
    // The area becomes a write permission: anything but a plain folder gets the default.
    const area = AgentAreaSchema.safeParse(d.area);
    const genome = monsterForMember(name, hues, d.look);
    hues.push(genome.palette.hue);
    out.push({
      id: agentId(name),
      name,
      title: d.title,
      role: d.role,
      mission: lowerFirst(d.mission.replace(/\.$/, '')),
      context: d.context,
      duties: d.duties.slice(0, 4),
      area: area.success ? area.data : `Risorse/${name}`,
      tools: toolsFor(d.web, ctx.permissions),
      color: colorOfGenome(genome),
      genome,
      archetype,
    });
  }
  return out;
}

/** The fixed team: Rhea and Dione with the user's context (renamed if the orchestrator took the name). */
export function fallbackDrafts(ctx: ProposalContext): Draft[] {
  const context = contextSentence(ctx.profile);
  const base = { user: ctx.profile.userName, orchestrator: ctx.profile.orchestratorName, context };
  return [rheaBlueprint(base), dioneBlueprint(base)].map((bp) => ({
    name: bp.name,
    archetype: bp.id as 'rhea' | 'dione',
    title: bp.title,
    role: bp.summary,
    mission: bp.mission,
    context,
    duties: bp.duties,
    area: bp.outputArea,
    web: bp.id === 'rhea',
  }));
}

function fromLlm(agent: LlmAgent): Draft {
  return {
    name: agent.name,
    archetype: null,
    title: agent.title,
    role: agent.role,
    mission: agent.mission,
    context: agent.context,
    duties: agent.duties,
    area: agent.area,
    web: agent.tools.some((t) => /web/i.test(t)),
    look: agent.look,
  };
}

// --- blueprints ----------------------------------------------------------------

export const GENERIC_REPORT =
  'cosa hai fatto (massimo 5 righe), le note create o modificate, i dubbi aperti';

/** Limits of a member: the archetype's, and room for searching and reading with web tools. */
function memberLimits(
  member: ProposedAgent,
  base: SubagentBlueprint['limits'],
): NonNullable<SubagentBlueprint['limits']> {
  const limits = base ?? { maxSteps: 20, maxOutputTokens: 4000 };
  const web = member.tools.some((t) => WEB_TOOLS.includes(t));
  return web
    ? { ...limits, maxSteps: Math.max(limits.maxSteps ?? 20, WEB_AGENT_MAX_STEPS) }
    : limits;
}

/** The blueprint of a confirmed member, rendered with the fixed template. */
export function memberBlueprint(
  member: ProposedAgent,
  ctx: { profile: Profile; models?: ModelRef[] | undefined },
): SubagentBlueprint {
  const base = { user: ctx.profile.userName, orchestrator: ctx.profile.orchestratorName };
  const archetype =
    member.archetype === 'rhea'
      ? rheaBlueprint(base)
      : member.archetype === 'dione'
        ? dioneBlueprint(base)
        : null;
  return {
    kind: 'subagent',
    id: member.id,
    name: member.name,
    user: ctx.profile.userName,
    orchestrator: ctx.profile.orchestratorName,
    language: ctx.profile.language,
    title: member.title,
    summary: member.role,
    mission: member.mission,
    context: member.context,
    duties: member.duties,
    outputArea: member.area,
    report: archetype?.report ?? GENERIC_REPORT,
    color: member.color,
    models: ctx.models ?? DEFAULT_FREE_CHAIN,
    tools: member.tools,
    limits: memberLimits(member, archetype?.limits),
    genome: member.genome as Record<string, unknown>,
  };
}

/** Problems of a proposal: every member must render a valid AGENTS.md, hues 30° apart. */
export function checkMembers(members: ProposedAgent[], ctx: ProposalContext): string[] {
  const problems: string[] = [];
  const hues = [orchestratorMonster(ctx.profile.orchestratorName).palette.hue];
  for (const m of members) {
    try {
      renderAgentFiles(memberBlueprint(m, ctx));
    } catch (err) {
      problems.push(`${m.name}: ${(err as Error).message}`);
    }
    const hue = (m.genome as MonsterGenome).palette.hue;
    if (minHueDistance(hue, hues) < 30) problems.push(`${m.name}: colour too close to another`);
    hues.push(hue);
  }
  return problems;
}

function formatZod(err: z.ZodError): string {
  return err.issues
    .slice(0, 8)
    .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
    .join('; ');
}

/** Parses a model answer into members, or throws with the reasons. */
export function parseProposal(text: string, ctx: ProposalContext): ProposedAgent[] {
  const parsed = LlmTeamSchema.safeParse(extractJson(text));
  if (!parsed.success) throw new Error(formatZod(parsed.error));
  const members = finishMembers(parsed.data.agents.map(fromLlm), ctx);
  const problems = checkMembers(members, ctx);
  if (problems.length > 0) throw new Error(problems.join('; '));
  return members;
}

export function orchestratorOf(ctx: ProposalContext): TeamProposal['orchestrator'] {
  const name = ctx.profile.orchestratorName;
  const genome = orchestratorMonster(name);
  return { id: agentId(name), name, color: colorOfGenome(genome), genome };
}

export function fallbackProposal(ctx: ProposalContext, requests = 0): TeamProposal {
  return {
    orchestrator: orchestratorOf(ctx),
    members: finishMembers(fallbackDrafts(ctx), ctx),
    source: 'fallback',
    requests,
  };
}

/**
 * Asks the model (one retry with the validation errors), falls back to the
 * fixed team. Never throws, except when `signal` is aborted.
 */
export async function proposeTeam(
  ctx: ProposalContext,
  generate: Generate | null,
  options: {
    signal?: AbortSignal;
    /**
     * Called once, in plain Italian, only when no attempt worked and the fixed team is
     * proposed instead: an attempt that the next one recovers is not an error to show.
     */
    onError?: (message: string) => void;
    /** The technical reason of each failed attempt, recovered or not (for tests and debugging). */
    onAttempt?: (message: string) => void;
    /** Every model request served, failed answers included (D-024). */
    onUsage?: (usage: ProviderUsage) => void;
  } = {},
): Promise<TeamProposal> {
  if (!generate) return fallbackProposal(ctx);
  let prompt = proposalPrompt(ctx);
  let requests = 0;
  for (let attempt = 0; attempt < 2; attempt++) {
    let answer: Generated;
    try {
      answer = await generate(PROPOSAL_SYSTEM, prompt, options.signal);
    } catch (err) {
      for (const u of (err as GenerateError).usage ?? []) options.onUsage?.(u);
      if (options.signal?.aborted) throw err;
      options.onAttempt?.(
        `proposta del team: il modello non ha risposto (${(err as Error).message})`,
      );
      break;
    }
    requests += answer.requests;
    for (const u of answer.usage ?? []) options.onUsage?.(u);
    try {
      const members = parseProposal(answer.text, ctx);
      return {
        orchestrator: orchestratorOf(ctx),
        members,
        source: 'model',
        ...(answer.model ? { model: answer.model } : {}),
        requests,
      };
    } catch (err) {
      const reason = (err as Error).message;
      options.onAttempt?.(`proposta del team non valida (tentativo ${attempt + 1}): ${reason}`);
      prompt = `${proposalPrompt(ctx)}\n\nLa tua risposta precedente non era valida: ${reason.slice(0, 600)}\nRispondi di nuovo con il solo JSON corretto.`;
    }
  }
  options.onError?.(
    'Non sono riuscito a preparare una squadra su misura per te: ti propongo quella di base, che puoi cambiare.',
  );
  return fallbackProposal(ctx, requests);
}
