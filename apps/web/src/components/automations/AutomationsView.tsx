import type { AutomationView } from '@monsters/shared';
import { Plus } from '@phosphor-icons/react';
import { useEffect, useRef } from 'react';
import { automationPath, openPage, useHashParam } from '../../lib/router.ts';
import { cn } from '../../lib/utils.ts';
import { getApi } from '../../store/app.ts';
import { useMediaQuery } from '../../store/hooks.ts';
import { ToolbarActions, ToolbarContent, ToolbarTitle, useToolbarBack } from '../shell/Toolbar.tsx';
import { LabeledKey } from '../ui/button.tsx';
import { preloadMarkdown } from '../ui/Markdown.tsx';
import { AutomationDetail } from './AutomationDetail.tsx';
import { AutomationForm } from './AutomationForm.tsx';
import { AutomationList } from './AutomationList.tsx';
import { automationsStrings } from './automations.strings.ts';
import { GiroView } from './GiroView.tsx';
import { useAutomationTick, useGiroTick, useLoaded } from './parts.tsx';
import '../settings/settings.css';

/*
 * The Automazioni section (plan of 17/10 §3 B3, D-094; docs/design.md,
 * "Automazioni"): the list by squad, one automation with its giri, one giro
 * with its conversation, the form. Everything follows the event stream: an
 * `automation_*` event reads the definitions again, a giro on screen follows
 * the events of its runs. On a phone each level opens over the one before and
 * the rail's back key goes one level up.
 */

// The giri are read in Markdown: the renderer's chunk comes with the page.
preloadMarkdown();

function go(hash: string) {
  window.location.hash = hash;
}

function Missing() {
  const s = automationsStrings().view;
  return (
    <div className="grid gap-3 pt-4" data-testid="automation-missing">
      <p className="text-large font-semibold text-ink">{s.missing}</p>
      <a href={automationPath()} className="text-body font-medium text-signal-ink hover:underline">
        {s.backToList}
      </a>
    </div>
  );
}

function DetailPage({
  a,
  tick,
  onChanged,
}: {
  a: AutomationView;
  tick: string;
  onChanged: (a: AutomationView) => void;
}) {
  const runs = useLoaded(() => getApi().automationRuns(a.id), tick);
  return <AutomationDetail a={a} runs={runs.data} onChanged={onChanged} />;
}

function GiroPage({ a, giro, tick }: { a: AutomationView; giro: string; tick: string }) {
  const s = automationsStrings();
  const runsTick = useGiroTick(giro);
  const detail = useLoaded(() => getApi().automationRun(a.id, giro), `${tick}|${runsTick}`);
  if (detail.error && !detail.data) {
    return (
      <p className="text-body text-stop-ink" role="alert">
        {detail.error}
      </p>
    );
  }
  if (!detail.data) {
    return (
      <p className="label text-ink-muted" aria-busy="true">
        {s.loading}
      </p>
    );
  }
  return <GiroView a={a} d={detail.data} />;
}

export default function AutomationsView() {
  const s = automationsStrings();
  const id = useHashParam('automazione');
  const giro = useHashParam('giro');
  const mode = useHashParam('vista');
  const tick = useAutomationTick();
  const phone = useMediaQuery('(max-width: 767px)');
  const roomy = useMediaQuery('(min-width: 1280px)');
  const list = useLoaded(() => getApi().automations(), tick);
  const current = id ? (list.data?.find((a) => a.id === id) ?? null) : null;
  const creating = mode === 'nuova';
  const editing = mode === 'modifica' && current !== null;
  const atList = !id && !creating;

  const onChanged = (a: AutomationView) =>
    list.set((list.data ?? []).map((x) => (x.id === a.id ? a : x)));

  // On a phone the rail's back key goes one level up: giro → automation → list.
  const back = atList
    ? null
    : giro && id
      ? { label: s.view.backRuns, run: () => go(automationPath(id)) }
      : editing && id
        ? { label: s.view.backBack, run: () => go(automationPath(id)) }
        : { label: s.title, run: () => go(automationPath()) };
  useToolbarBack(phone ? back : null);

  // A new place in the section starts at the top.
  const scroller = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scroller.current?.scrollTo({ top: 0 });
  }, [id, giro, mode]);

  let body;
  if (creating) body = <AutomationForm a={null} />;
  else if (!id) body = <AutomationList list={list.data} error={list.error} onChanged={onChanged} />;
  else if (!list.data) {
    body = list.error ? (
      <p className="text-body text-stop-ink" role="alert">
        {list.error}
      </p>
    ) : (
      <p className="label text-ink-muted" aria-busy="true">
        {s.loading}
      </p>
    );
  } else if (!current) body = <Missing />;
  else if (editing) body = <AutomationForm key={current.id} a={current} />;
  else if (giro) body = <GiroPage key={giro} a={current} giro={giro} tick={tick} />;
  else body = <DetailPage key={current.id} a={current} tick={tick} onChanged={onChanged} />;

  return (
    <section
      aria-labelledby="automations-title"
      className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="automations-view"
    >
      <ToolbarContent>
        <ToolbarTitle id="automations-title" className={cn(phone && !atList && 'sr-only')}>
          {s.title}
        </ToolbarTitle>
        {/* With no automation the screen has its own "Crea la prima": one key for the action. */}
        {!creating && !editing && !(atList && list.data?.length === 0) && (
          <ToolbarActions>
            <LabeledKey
              label={phone ? s.view.new : s.view.newLong}
              aria-label={s.view.newLong}
              title={s.view.newLong}
              layout={phone ? 'stacked' : roomy ? 'inline' : 'icon'}
              onClick={() => openPage(automationPath(null, { mode: 'nuova' }))}
              data-testid="automation-new"
            >
              <Plus size={20} aria-hidden />
            </LabeledKey>
          </ToolbarActions>
        )}
      </ToolbarContent>
      <div ref={scroller} className="scroll-soft min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[920px] px-4 pt-5 pb-12 sm:px-6 sm:pt-6">{body}</div>
      </div>
    </section>
  );
}
