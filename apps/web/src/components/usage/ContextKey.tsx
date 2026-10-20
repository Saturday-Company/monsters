import type { ContextPart, UsageContext } from '@monsters/shared';
import { contextAmount, formatTokens, segmentsOf, thresholdAt } from './model.ts';
import { openUsage, useContextNow, useUsageShown } from './state.ts';
import './usage.css';

/*
 * The context as lineette (docs/design.md, "Consumi"): one segment for every
 * 1/count of the model's window, lit in the light of its part, unlit for the
 * free space, the compaction mark at 75%. Decorative: the words beside it (a
 * percentage, the legend of the panel, the accessible name of the key) say
 * the same.
 */
export function ContextBar({
  context,
  count,
  size = 'sm',
}: {
  context: UsageContext | null;
  count: number;
  size?: 'sm' | 'lg';
}) {
  const segments = context
    ? segmentsOf(context.parts, context.total, context.window, count)
    : Array.from({ length: count }, () => null);
  const tick = thresholdAt(count, context?.threshold);
  const cells: React.ReactNode[] = [];
  let before: ContextPart | null = null;
  segments.forEach((part, i) => {
    if (i === tick) cells.push(<b key="tick" className="ctx-tick" />);
    cells.push(
      <i
        // A segment that lights up (or changes part) is a new one: it comes on by frames.
        key={`${i}:${part ?? '-'}`}
        data-part={part ?? undefined}
        data-edge={part && before && part !== before ? '' : undefined}
      />,
    );
    before = part;
  });
  return (
    <span
      aria-hidden
      className="ctx-bar"
      data-size={size}
      data-testid="context-bar"
      data-lit={segments.filter(Boolean).length}
    >
      {cells}
    </span>
  );
}

/**
 * The key on the monster's monitor (the preview of Consumi): CONTESTO, the
 * lineette and the share of the window. Opens the panel.
 */
export function ContextKey({ agentId, name }: { agentId: string; name: string }) {
  const context = useContextNow(agentId);
  const open = useUsageShown(agentId);
  const amount = contextAmount(context);
  const ratio = context?.window ? context.total / context.window : 0;
  const near = context !== null && ratio >= context.threshold;
  const said = context
    ? context.window
      ? `${amount} della finestra del modello`
      : context.measuredWith
        ? 'modello cambiato, lo misuro al prossimo passo'
        : `${formatTokens(context.total)} token`
    : 'nessun passo ancora';
  return (
    <button
      type="button"
      className="screen-key gap-2.5 px-2.5 @max-[460px]:px-0.5"
      onClick={() => openUsage(agentId)}
      aria-label={`Contesto e consumi di ${name}: ${said}`}
      aria-expanded={open}
      title="Contesto: quanto della memoria di lavoro del modello occupa questa conversazione. Apri i consumi"
      data-testid="context-key"
      data-near={near ? '' : undefined}
    >
      {/* A meter without its name is a riddle: the word stays down to 680 px of monitor (the summary gives way first). */}
      <span className="label @max-[680px]:hidden" aria-hidden>
        Contesto
      </span>
      <span className="@max-[520px]:hidden">
        <ContextBar context={context} count={20} />
      </span>
      <span
        aria-hidden
        className={`font-mono text-micro leading-4 tabular-nums ${near ? 'text-screen-signal' : 'text-screen-ink'}`}
        data-testid="context-amount"
      >
        {amount}
      </span>
    </button>
  );
}
