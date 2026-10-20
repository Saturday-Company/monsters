import { dotPalette } from '@monsters/monster-kit';
import {
  formatEur,
  type AgentUsageView,
  type SpendMeterView,
  type UsageContext,
  type UsageModel,
  type UsageSummary,
} from '@monsters/shared';
import { ArrowRight, X } from '@phosphor-icons/react';
import type { CSSProperties, ReactNode } from 'react';
import { openPage, SPEND_CAP_PATH } from '../../lib/router.ts';
import { formatUsd } from '../../lib/utils.ts';
import { formatDuration, modelShort } from '../../store/derive.ts';
import { useAgent, useLive } from '../../store/hooks.ts';
import { expressionFor, Monster } from '../monster/Monster.tsx';
import { fitDots } from '../monster/MonsterScreen.tsx';
import { Meter } from '../ui/Meter.tsx';
import { ContextBar } from './ContextKey.tsx';
import { PlanLimitsBlock } from './PlanLimitsBlock.tsx';
import { contextAmount, formatCount, formatTokens, partName, PART_HINT } from './model.ts';
import { useAgentUsage } from './state.ts';
import './usage.css';

/*
 * Consumi of a monster (docs/design.md, "Consumi"; D-075): a screen of the
 * instrument, like "Dietro le quinte". On top the context of its latest step,
 * a big bar of lineette with the legend in the same order and the tokens of
 * each part, the window and the compaction mark; then what this conversation
 * consumed; at the bottom today and this month against the spending caps.
 * Self-contained: the Consumi tab of the right-hand pane mounts it.
 */

const BIG_SEGMENTS = 40;

/** "0,0123 $ · 0,011 €", or "gratis", or nothing known. */
function money(usd: number | null, eur: number | null, free: boolean): string {
  if (free && !usd) return 'gratis';
  if (usd === null) return 'non riportato';
  if (usd === 0) return 'gratis';
  return `${formatUsd(usd)} · ${eur !== null ? formatEurSmall(eur) : ''}`.replace(/ · $/, '');
}

/** Euros with the precision of the cents' fractions, like the dollars. */
function formatEurSmall(eur: number): string {
  return eur >= 0.01 ? formatEur(eur) : formatUsd(eur).replace(' $', ' €');
}

function Section({
  title,
  children,
  testId,
}: {
  title: string;
  children: ReactNode;
  testId: string;
}) {
  return (
    <section className="ctx-sheet-rule grid gap-3 px-5 pt-4 pb-5" data-testid={testId}>
      <h3 className="label text-screen-muted">{title}</h3>
      {children}
    </section>
  );
}

function Stat({ label, value, testId }: { label: string; value: string; testId?: string }) {
  return (
    <div className="grid gap-0.5" data-testid={testId}>
      <dt className="label text-screen-muted">{label}</dt>
      <dd className="text-footnote leading-5 text-screen-ink tabular-nums">{value}</dd>
    </div>
  );
}

/** "Riassunto dei messaggi più vecchi: 18 messaggi, alle 14:32" (D-082). */
function SummaryNote({ summary }: { summary: UsageSummary }) {
  const at = new Date(summary.ts).toLocaleTimeString('it-IT', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return (
    <p className="text-micro leading-[18px] text-screen-muted" data-testid="usage-summary">
      <span className="label mr-2 text-screen-ink">Riassunto dei messaggi più vecchi</span>
      {summary.turns} {summary.turns === 1 ? 'messaggio' : 'messaggi'} in{' '}
      {formatCount(summary.chars)} lettere, alle {at}
      {summary.reason === 'context' ? ' (il contesto si avvicinava alla soglia)' : ''}.
    </p>
  );
}

function ContextScreen({
  context,
  subscription,
  summary,
}: {
  context: UsageContext | null;
  subscription: boolean;
  summary: UsageSummary | null;
}) {
  if (!context) {
    return (
      <Section title="Contesto" testId="usage-context">
        <p className="text-footnote leading-[22px] text-screen-muted">
          Nessun passo in questa conversazione: il contesto si misura al primo messaggio.
        </p>
        <ContextBar context={null} count={BIG_SEGMENTS} size="lg" />
        {summary && <SummaryNote summary={summary} />}
      </Section>
    );
  }
  const near = context.window !== null && context.total / context.window >= context.threshold;
  const model = modelShort(context.model) ?? context.model;
  return (
    <Section title="Contesto" testId="usage-context">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-1">
        <p
          className={`dots text-hero leading-[44px] ${near ? 'text-screen-signal' : 'text-[var(--lit)]'}`}
          data-testid="usage-percent"
        >
          {contextAmount(context)}
        </p>
        <div className="grid min-w-0 gap-0.5 pb-0.5">
          <p className="text-footnote leading-5 text-screen-ink tabular-nums">
            {formatCount(context.total)}
            {context.window ? ` / ${formatCount(context.window)}` : ''} token
          </p>
          <p className="label truncate text-screen-muted">
            {model}
            {context.window ? '' : ' · finestra non nota'}
          </p>
        </div>
      </div>
      <div className="grid gap-1.5">
        <ContextBar context={context} count={BIG_SEGMENTS} size="lg" />
        {context.window !== null && (
          <p className="label flex justify-between text-screen-muted" aria-hidden>
            <span>0</span>
            <span>{Math.round(context.threshold * 100)}% · qui si compatta</span>
            <span>{formatTokens(context.window)}</span>
          </p>
        )}
      </div>
      <ul className="grid gap-2" aria-label="Le parti del contesto" data-testid="usage-legend">
        {context.parts.map((p) => (
          <li
            key={p.part}
            className="grid grid-cols-[6px_minmax(0,1fr)_auto] items-start gap-x-3"
            data-part={p.part}
          >
            <span aria-hidden className="ctx-swatch mt-0.5" data-part={p.part} />
            <span className="min-w-0">
              <span className="block text-footnote leading-5 text-screen-ink">
                {partName(p.part, context.provider)}
              </span>
              <span className="block text-micro leading-[18px] text-screen-muted">
                {PART_HINT[p.part]}
              </span>
            </span>
            <span className="text-right text-footnote leading-5 text-screen-ink tabular-nums">
              {formatCount(p.tokens)}
              <span className="block text-micro leading-[18px] text-screen-muted">
                {Math.round((p.tokens / context.total) * 100)}%
              </span>
            </span>
          </li>
        ))}
      </ul>
      {summary && <SummaryNote summary={summary} />}
      <p className="text-micro leading-[18px] text-screen-muted">
        {context.source === 'measured'
          ? `Totale contato dal modello${subscription ? ' (con la cache)' : ''}; le parti sono stimate dalle lettere e tarate su quel totale.`
          : 'Il modello non ha detto i token: stima dalle lettere.'}
      </p>
    </Section>
  );
}

function ModelRow({ m, subscription }: { m: UsageModel; subscription: boolean }) {
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3" data-testid="usage-model">
      <span className="min-w-0">
        <span className="block truncate text-footnote leading-5 text-screen-ink">
          {modelShort(m.model) ?? 'gratuito, scelto da OpenRouter'}
        </span>
        <span className="label block text-screen-muted">
          {m.calls} {m.calls === 1 ? 'chiamata' : 'chiamate'} · {formatTokens(m.inputTokens)} in ·{' '}
          {formatTokens(m.outputTokens)} out
        </span>
      </span>
      <span className="text-right text-footnote leading-5 text-screen-ink tabular-nums">
        {m.subscription || subscription ? 'abbonamento' : money(m.costUsd, m.costEur, m.free)}
      </span>
    </li>
  );
}

/** The conversation is older than the archive of the log: the counts above start at its cut. */
function ArchivedNote({ before }: { before: number }) {
  const day = new Date(before).toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  return (
    <p className="text-micro leading-[18px] text-screen-muted" data-testid="usage-archived">
      Conto parziale: i consumi di questa conversazione prima del {day} sono nell’archivio del
      registro e qui non contano. La spesa del mese resta intera.
    </p>
  );
}

function SessionScreen({ view }: { view: AgentUsageView }) {
  const s = view.session;
  const sub = view.subscription;
  if (s.runs === 0 && s.calls === 0) {
    return (
      <Section title="Questa conversazione" testId="usage-session">
        <p className="text-footnote leading-[22px] text-screen-muted">
          Ancora niente: nessun lavoro dall’ultima “Nuova conversazione”.
        </p>
      </Section>
    );
  }
  const cost = sub ? 'incluso nell’abbonamento' : money(s.costUsd, s.costEur, s.free);
  // Each question to Jev is a decision and a call; the rules alone only decide.
  const instinct = Math.max(s.instinct.questions, s.instinct.calls);
  return (
    <Section title="Questa conversazione" testId="usage-session">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Stat label="Token in" value={formatCount(s.inputTokens)} testId="usage-in" />
        <Stat label="Token out" value={formatCount(s.outputTokens)} />
        <Stat label="Chiamate" value={formatCount(s.calls)} />
        <Stat label="Cache letta" value={formatCount(s.cacheReadTokens)} />
        <Stat label="Cache scritta" value={formatCount(s.cacheWriteTokens)} />
        <Stat label="Durata" value={s.durationMs > 0 ? formatDuration(s.durationMs) : '–'} />
      </dl>
      <p className="text-footnote leading-5 text-screen-ink" data-testid="usage-cost">
        <span className="label mr-2 text-screen-muted">Costo</span>
        {cost}
      </p>
      {s.models.length > 0 && (
        <ul className="grid gap-2" aria-label="Per modello">
          {s.models.map((m) => (
            <ModelRow key={`${m.provider}:${m.model}`} m={m} subscription={sub} />
          ))}
        </ul>
      )}
      <dl className="grid gap-2">
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="label text-screen-muted">Ricerche web</dt>
          <dd
            className="text-footnote leading-5 text-screen-ink tabular-nums"
            data-testid="usage-searches"
          >
            {s.searches.count}
            {s.searches.paid > 0
              ? ` · ${s.searches.paid} a pagamento, ${formatUsd(s.searches.costUsd)}`
              : ''}
          </dd>
        </div>
        {s.compaction && s.compaction.calls > 0 && (
          <div className="flex flex-wrap justify-between gap-x-3">
            <dt className="label text-screen-muted">Riassunti</dt>
            <dd
              className="text-footnote leading-5 text-screen-ink tabular-nums"
              data-testid="usage-compaction"
            >
              {s.compaction.calls} · {formatTokens(s.compaction.inputTokens)} in ·{' '}
              {formatTokens(s.compaction.outputTokens)} out
              {sub ? '' : s.compaction.costUsd > 0 ? ` · ${formatUsd(s.compaction.costUsd)}` : ''}
            </dd>
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="label text-screen-muted">Decisioni dei mostri</dt>
          <dd
            className="text-footnote leading-5 text-screen-ink tabular-nums"
            data-testid="usage-instinct"
          >
            {instinct} {instinct === 1 ? 'domanda' : 'domande'}
            {s.instinct.costUsd > 0 ? ` · ${formatUsd(s.instinct.costUsd)}` : ''}
          </dd>
        </div>
      </dl>
      {view.archivedBefore != null && <ArchivedNote before={view.archivedBefore} />}
    </Section>
  );
}

/** Ten segments for a cap: screen ink, signal from 80%, stop at 100% (like Settings → Modelli). */
function CapMeter({ meter, warnAt }: { meter: SpendMeterView; warnAt: number }) {
  const ratio = meter.ratio ?? 0;
  const on = meter.capEur === null ? 0 : Math.min(10, Math.ceil(ratio * 10 - 1e-9));
  const lit =
    ratio >= 1 ? 'var(--screen-stop)' : ratio >= warnAt ? 'var(--signal)' : 'var(--screen-ink)';
  return (
    <span aria-hidden className="flex items-center gap-[2px]">
      {Array.from({ length: 10 }, (_, i) => (
        <i
          key={i}
          className="block h-[12px] w-[4px] rounded-[1px]"
          style={{ background: i < on ? lit : 'var(--screen-off)' }}
        />
      ))}
    </span>
  );
}

function spentText(meter: SpendMeterView, period: string): string {
  if (meter.capEur === null) return `${formatEur(meter.spentEur)} ${period}, senza tetto`;
  const pct = Math.round((meter.ratio ?? 0) * 100);
  return `${formatEur(meter.spentEur)} su ${formatEur(meter.capEur)} (${pct}%)`;
}

/** The plan the monster works on, from the first link of its chain (D-111). */
function planOf(provider: string | undefined): 'claude' | 'chatgpt' | null {
  if (provider === 'claude-agent') return 'claude';
  return provider === 'codex' || provider === 'chatgpt' ? 'chatgpt' : null;
}

function PlanScreen({ view, provider }: { view: AgentUsageView; provider: string | undefined }) {
  const plan = view.planLimits?.plan ?? planOf(provider);
  if (!plan) return null;
  return (
    <Section
      title={`Utilizzo del piano · ${plan === 'claude' ? 'Claude' : 'ChatGPT'}`}
      testId="usage-plan"
    >
      <PlanLimitsBlock plan={plan} view={view.planLimits ?? null} embedded />
    </Section>
  );
}

function SpendScreen({ view, name }: { view: AgentUsageView; name: string }) {
  const { spend } = view;
  const rows = [
    { label: 'Oggi', meter: spend.day, period: 'oggi', testId: 'usage-day' },
    { label: 'Questo mese', meter: spend.month, period: 'questo mese', testId: 'usage-month' },
  ];
  return (
    <Section title="Oggi · questo mese" testId="usage-spend">
      {view.subscription && (
        <p
          className="text-footnote leading-[22px] text-screen-ink"
          data-testid="usage-subscription"
        >
          {name} lavora con l’abbonamento: è incluso nel piano e non conta nel tetto di spesa.
        </p>
      )}
      <ul className="grid gap-2.5">
        {rows.map((r) => (
          <li
            key={r.label}
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3"
            data-testid={r.testId}
          >
            <span className="min-w-0">
              <span className="label block text-screen-muted">{r.label} · la squadra</span>
              <span className="block text-footnote leading-5 text-screen-ink tabular-nums">
                {spentText(r.meter, r.period)}
              </span>
            </span>
            <CapMeter meter={r.meter} warnAt={spend.warnAt} />
          </li>
        ))}
      </ul>
      {spend.agent.paid && (
        <p className="text-footnote leading-5 text-screen-muted tabular-nums">
          {name}: {formatEur(spend.agent.day.spentEur)} oggi ·{' '}
          {formatEur(spend.agent.month.spentEur)} questo mese
        </p>
      )}
      <button
        type="button"
        className="screen-key -ml-3 justify-start self-start"
        onClick={() => openPage(SPEND_CAP_PATH)}
        data-testid="usage-caps-link"
      >
        <span className="label">Tetto di spesa · Impostazioni → Modelli</span>
        <ArrowRight size={14} weight="bold" aria-hidden />
      </button>
    </Section>
  );
}

/**
 * The panel before the numbers arrive (docs/design.md: a wait is lineette, not
 * only a sentence): the four sections with their names, an unlit bar and the
 * meter running, so the screen keeps its shape when the numbers come in.
 */
function UsageSkeleton() {
  return (
    <div aria-busy="true" data-testid="usage-loading">
      <p className="sr-only" role="status">
        Leggo i consumi…
      </p>
      {[
        ['Contesto', 'usage-context'],
        ['Questa conversazione', 'usage-session'],
        ['Oggi · questo mese', 'usage-spend'],
      ].map(([title, testId]) => (
        <Section key={testId} title={title!} testId={`${testId}-loading`}>
          <div className="flex items-center gap-3" aria-hidden>
            <ContextBar context={null} count={BIG_SEGMENTS} size="lg" />
            <Meter active className="shrink-0 text-screen-muted" />
          </div>
        </Section>
      ))}
    </div>
  );
}

/** The panel; `onClose` adds a ✕ (the right-hand pane has its own). */
export function UsagePanel({ agentId, onClose }: { agentId: string; onClose?: () => void }) {
  const agent = useAgent(agentId);
  const live = useLive(agentId);
  const { view, error } = useAgentUsage(agentId, true);
  if (!agent) return null;
  const lit = dotPalette(agent.genome).lit;
  return (
    <div className="term flex min-h-0 flex-1 flex-col" style={{ '--lit': lit } as CSSProperties}>
      <header className="flex items-center gap-3.5 px-5 pt-4 pb-3">
        <span
          className="flex shrink-0 items-center justify-center"
          style={{ width: fitDots(80, 34, 0), height: 34 }}
        >
          <Monster
            genome={agent.genome}
            size={fitDots(80, 34, 0)}
            expression={expressionFor(live.mood, live.confused)}
            title={agent.name}
          />
        </span>
        <h2 id="usage-title" className="flex min-w-0 flex-1 items-baseline gap-3">
          <span className="sr-only">Consumi di {agent.name}</span>
          <span
            aria-hidden
            className="dots truncate text-title2 leading-[26px]"
            style={{ color: lit }}
          >
            {agent.name}
          </span>
          <span aria-hidden className="label shrink-0 text-screen-muted">
            Consumi
          </span>
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Chiudi"
            title="Chiudi (Esc)"
            className="screen-key size-9 px-0"
          >
            <X size={18} weight="bold" aria-hidden />
          </button>
        )}
      </header>
      <div className="scroll-screen min-h-0 flex-1 overflow-y-auto pb-4" data-testid="usage-body">
        {error && !view && (
          <p role="alert" className="px-5 py-4 text-footnote text-screen-stop">
            {error}
          </p>
        )}
        {!view && !error && <UsageSkeleton />}
        {view && (
          <>
            <ContextScreen
              context={view.context}
              subscription={view.subscription}
              summary={view.summary ?? null}
            />
            <SessionScreen view={view} />
            <PlanScreen view={view} provider={agent.models?.[0]?.provider} />
            <SpendScreen view={view} name={agent.name} />
          </>
        )}
      </div>
    </div>
  );
}
