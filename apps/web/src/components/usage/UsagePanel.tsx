import { dotPalette } from '@monsters/monster-kit';
import {
  formatDate,
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
import { formatTime, formatUsd } from '../../lib/utils.ts';
import { formatDuration, modelShort } from '../../store/derive.ts';
import { useAgent, useLive } from '../../store/hooks.ts';
import { expressionFor, Monster } from '../monster/Monster.tsx';
import { fitDots } from '../monster/MonsterScreen.tsx';
import { Meter } from '../ui/Meter.tsx';
import { ContextBar } from './ContextKey.tsx';
import { PlanLimitsBlock } from './PlanLimitsBlock.tsx';
import { contextAmount, formatCount, formatTokens, partHint, partName } from './model.ts';
import { useAgentUsage } from './state.ts';
import { usageStrings } from './usage.strings.ts';
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

/** "$0.0123 · €0.011", or "free", or nothing known. */
function money(usd: number | null, eur: number | null, free: boolean): string {
  const s = usageStrings().panel;
  if (free && !usd) return s.free;
  if (usd === null) return s.notReported;
  if (usd === 0) return s.free;
  return `${formatUsd(usd)} · ${eur !== null ? formatEurSmall(eur) : ''}`.replace(/ · $/, '');
}

/** Euros with the precision of the cents' fractions, like the dollars. */
function formatEurSmall(eur: number): string {
  return eur >= 0.01 ? formatEur(eur) : formatUsd(eur, '€');
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

/** "Summary of the older messages: 18 messages, at 14:32" (D-082). */
function SummaryNote({ summary }: { summary: UsageSummary }) {
  const s = usageStrings().panel;
  return (
    <p className="text-micro leading-[18px] text-screen-muted" data-testid="usage-summary">
      <span className="label mr-2 text-screen-ink">{s.summaryTitle}</span>
      {s.summary(
        summary.turns,
        formatCount(summary.chars),
        formatTime(summary.ts),
        summary.reason === 'context',
      )}
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
  const s = usageStrings().panel;
  if (!context) {
    return (
      <Section title={s.contextTitle} testId="usage-context">
        <p className="text-footnote leading-[22px] text-screen-muted">{s.noStep}</p>
        <ContextBar context={null} count={BIG_SEGMENTS} size="lg" />
        {summary && <SummaryNote summary={summary} />}
      </Section>
    );
  }
  const near = context.window !== null && context.total / context.window >= context.threshold;
  const model = modelShort(context.model) ?? context.model;
  return (
    <Section title={s.contextTitle} testId="usage-context">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-1">
        <p
          className={`dots text-hero leading-[44px] ${near ? 'text-screen-signal' : 'text-[var(--lit)]'}`}
          data-testid="usage-percent"
        >
          {contextAmount(context)}
        </p>
        <div className="grid min-w-0 gap-0.5 pb-0.5">
          <p className="text-footnote leading-5 text-screen-ink tabular-nums">
            {s.tokensOf(
              formatCount(context.total),
              context.window ? formatCount(context.window) : null,
            )}
          </p>
          <p className="label truncate text-screen-muted">
            {model}
            {context.window ? '' : s.windowUnknown}
          </p>
        </div>
      </div>
      <div className="grid gap-1.5">
        <ContextBar context={context} count={BIG_SEGMENTS} size="lg" />
        {context.window !== null && (
          <p className="label flex justify-between text-screen-muted" aria-hidden>
            <span>0</span>
            <span>{s.compactsHere(Math.round(context.threshold * 100))}</span>
            <span>{formatTokens(context.window)}</span>
          </p>
        )}
      </div>
      <ul className="grid gap-2" aria-label={s.partsLabel} data-testid="usage-legend">
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
                {partHint(p.part)}
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
        {context.source === 'measured' ? s.measured(subscription) : s.estimated}
      </p>
    </Section>
  );
}

function ModelRow({ m, subscription }: { m: UsageModel; subscription: boolean }) {
  const s = usageStrings().panel;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3" data-testid="usage-model">
      <span className="min-w-0">
        <span className="block truncate text-footnote leading-5 text-screen-ink">
          {modelShort(m.model) ?? s.freeModel}
        </span>
        <span className="label block text-screen-muted">
          {s.calls(m.calls)} · {s.inOut(formatTokens(m.inputTokens), formatTokens(m.outputTokens))}
        </span>
      </span>
      <span className="text-right text-footnote leading-5 text-screen-ink tabular-nums">
        {m.subscription || subscription ? s.subscription : money(m.costUsd, m.costEur, m.free)}
      </span>
    </li>
  );
}

/** The conversation is older than the archive of the log: the counts above start at its cut. */
function ArchivedNote({ before }: { before: number }) {
  const s = usageStrings().panel;
  const day = formatDate(before, { day: 'numeric', month: 'long', year: 'numeric' });
  return (
    <p className="text-micro leading-[18px] text-screen-muted" data-testid="usage-archived">
      {s.archived(day)}
    </p>
  );
}

function SessionScreen({ view }: { view: AgentUsageView }) {
  const t = usageStrings().panel;
  const s = view.session;
  const sub = view.subscription;
  if (s.runs === 0 && s.calls === 0) {
    return (
      <Section title={t.sessionTitle} testId="usage-session">
        <p className="text-footnote leading-[22px] text-screen-muted">{t.sessionEmpty}</p>
      </Section>
    );
  }
  const cost = sub ? t.includedInSubscription : money(s.costUsd, s.costEur, s.free);
  // Each question to Jev is a decision and a call; the rules alone only decide.
  const instinct = Math.max(s.instinct.questions, s.instinct.calls);
  return (
    <Section title={t.sessionTitle} testId="usage-session">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3">
        <Stat label={t.tokensIn} value={formatCount(s.inputTokens)} testId="usage-in" />
        <Stat label={t.tokensOut} value={formatCount(s.outputTokens)} />
        <Stat label={t.callsLabel} value={formatCount(s.calls)} />
        <Stat label={t.cacheRead} value={formatCount(s.cacheReadTokens)} />
        <Stat label={t.cacheWritten} value={formatCount(s.cacheWriteTokens)} />
        <Stat label={t.duration} value={s.durationMs > 0 ? formatDuration(s.durationMs) : '–'} />
      </dl>
      <p className="text-footnote leading-5 text-screen-ink" data-testid="usage-cost">
        <span className="label mr-2 text-screen-muted">{t.cost}</span>
        {cost}
      </p>
      {s.models.length > 0 && (
        <ul className="grid gap-2" aria-label={t.perModel}>
          {s.models.map((m) => (
            <ModelRow key={`${m.provider}:${m.model}`} m={m} subscription={sub} />
          ))}
        </ul>
      )}
      <dl className="grid gap-2">
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="label text-screen-muted">{t.searches}</dt>
          <dd
            className="text-footnote leading-5 text-screen-ink tabular-nums"
            data-testid="usage-searches"
          >
            {s.searches.count}
            {s.searches.paid > 0
              ? t.searchesPaid(s.searches.paid, formatUsd(s.searches.costUsd))
              : ''}
          </dd>
        </div>
        {s.compaction && s.compaction.calls > 0 && (
          <div className="flex flex-wrap justify-between gap-x-3">
            <dt className="label text-screen-muted">{t.summaries}</dt>
            <dd
              className="text-footnote leading-5 text-screen-ink tabular-nums"
              data-testid="usage-compaction"
            >
              {s.compaction.calls} ·{' '}
              {t.inOut(
                formatTokens(s.compaction.inputTokens),
                formatTokens(s.compaction.outputTokens),
              )}
              {sub ? '' : s.compaction.costUsd > 0 ? ` · ${formatUsd(s.compaction.costUsd)}` : ''}
            </dd>
          </div>
        )}
        <div className="flex flex-wrap justify-between gap-x-3">
          <dt className="label text-screen-muted">{t.decisions}</dt>
          <dd
            className="text-footnote leading-5 text-screen-ink tabular-nums"
            data-testid="usage-instinct"
          >
            {t.questions(instinct)}
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
  const s = usageStrings().panel;
  if (meter.capEur === null) return s.spentNoCap(formatEur(meter.spentEur), period);
  const pct = Math.round((meter.ratio ?? 0) * 100);
  return s.spentOf(formatEur(meter.spentEur), formatEur(meter.capEur), pct);
}

/** The plan the monster works on, from the first link of its chain (D-111). */
function planOf(provider: string | undefined): 'claude' | 'chatgpt' | null {
  if (provider === 'claude-agent') return 'claude';
  return provider === 'codex' || provider === 'chatgpt' ? 'chatgpt' : null;
}

function PlanScreen({ view, provider }: { view: AgentUsageView; provider: string | undefined }) {
  const s = usageStrings().panel;
  const plan = view.planLimits?.plan ?? planOf(provider);
  if (!plan) return null;
  return (
    <Section title={s.planTitle(plan === 'claude' ? 'Claude' : 'ChatGPT')} testId="usage-plan">
      <PlanLimitsBlock plan={plan} view={view.planLimits ?? null} embedded />
    </Section>
  );
}

function SpendScreen({ view, name }: { view: AgentUsageView; name: string }) {
  const s = usageStrings().panel;
  const { spend } = view;
  const rows = [
    { label: s.today, meter: spend.day, period: s.todayPeriod, testId: 'usage-day' },
    { label: s.thisMonth, meter: spend.month, period: s.monthPeriod, testId: 'usage-month' },
  ];
  return (
    <Section title={s.spendTitle} testId="usage-spend">
      {view.subscription && (
        <p
          className="text-footnote leading-[22px] text-screen-ink"
          data-testid="usage-subscription"
        >
          {s.onSubscription(name)}
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
              <span className="label block text-screen-muted">{s.teamLabel(r.label)}</span>
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
          {s.agentSpend(
            name,
            formatEur(spend.agent.day.spentEur),
            formatEur(spend.agent.month.spentEur),
          )}
        </p>
      )}
      <button
        type="button"
        className="screen-key -ml-3 justify-start self-start"
        onClick={() => openPage(SPEND_CAP_PATH)}
        data-testid="usage-caps-link"
      >
        <span className="label">{s.capsLink}</span>
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
  const s = usageStrings().panel;
  return (
    <div aria-busy="true" data-testid="usage-loading">
      <p className="sr-only" role="status">
        {s.loading}
      </p>
      {[
        [s.contextTitle, 'usage-context'],
        [s.sessionTitle, 'usage-session'],
        [s.spendTitle, 'usage-spend'],
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
  const s = usageStrings().panel;
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
          <span className="sr-only">{s.usageOf(agent.name)}</span>
          <span
            aria-hidden
            className="dots truncate text-title2 leading-[26px]"
            style={{ color: lit }}
          >
            {agent.name}
          </span>
          <span aria-hidden className="label shrink-0 text-screen-muted">
            {s.usage}
          </span>
        </h2>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label={s.close}
            title={s.closeTitle}
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
