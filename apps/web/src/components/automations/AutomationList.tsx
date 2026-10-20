import type { AutomationView } from '@monsters/shared';
import { Plus } from '@phosphor-icons/react';
import { useState, type MouseEvent } from 'react';
import { crewOf, formatWhen, groupBySquad, shownRun } from '../../lib/automations.ts';
import { automationPath, openPage } from '../../lib/router.ts';
import { cn } from '../../lib/utils.ts';
import { getApi, notify } from '../../store/app.ts';
import { listText } from '../../store/derive.ts';
import { useNameOf } from '../../store/hooks.ts';
import { useProjects } from '../../store/projects.ts';
import { describeError } from '../../lib/api.ts';
import '../settings/settings.css';
import { Button } from '../ui/button.tsx';
import { Switch } from '../ui/controls.tsx';
import { EmptyScreen } from '../ui/EmptyScreen.tsx';
import { CrewScreen } from '../monster/CrewScreen.tsx';
import { RunState } from './parts.tsx';

/*
 * The list of the automations (docs/design.md, "Automazioni"), by squad: one
 * module per squad (the personal one, then each project by its name, D-100), a row
 * per automation with its crew on a small screen, the name, when it runs in
 * Italian, the next giro and how the last one went; on the right the lever
 * that pauses it. A draft has no lever: it waits for "Conferma".
 */

function Row({ a, onChanged }: { a: AutomationView; onChanged: (a: AutomationView) => void }) {
  const nameOf = useNameOf();
  const [busy, setBusy] = useState(false);
  const run = shownRun(a);
  const href = automationPath(a.id);
  const open = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    window.location.hash = href;
  };
  const toggle = async (on: boolean) => {
    setBusy(true);
    try {
      const api = getApi();
      const next = on ? await api.resumeAutomation(a.id) : await api.pauseAutomation(a.id);
      onChanged(next);
      notify(on ? `«${a.name}» riprende a girare.` : `«${a.name}» è in pausa.`);
    } catch (err) {
      notify(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const crew = crewOf(a);
  const who =
    crew.length > 1
      ? `${nameOf(a.lead)} con ${listText(crew.slice(1).map(nameOf))}`
      : nameOf(a.lead);
  return (
    <li
      className="flex items-center gap-3 px-3 py-3 sm:gap-4 sm:px-4"
      data-testid="automation-row"
      data-id={a.id}
      data-status={a.status}
    >
      <a
        href={href}
        onClick={open}
        className="row-key -my-1.5 -ml-1.5 flex min-w-0 flex-1 items-center gap-3 rounded-[12px] py-1.5 pr-2 pl-1.5 focus-visible:outline-2 focus-visible:outline-signal-ink sm:gap-4"
      >
        <CrewScreen
          monsters={crew.map((id) => ({ id }))}
          height={48}
          working={a.current?.state === 'running'}
          className="max-sm:hidden"
        />
        <CrewScreen
          monsters={crew.map((id) => ({ id }))}
          height={40}
          max={2}
          working={a.current?.state === 'running'}
          className="sm:hidden"
        />
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-large font-semibold text-ink">{a.name}</span>
            {a.status === 'draft' && (
              <span className="label inline-flex shrink-0 items-center gap-1.5 text-signal-ink">
                <span aria-hidden className="led" data-tone="signal" />
                Bozza
              </span>
            )}
          </span>
          <span className="truncate text-body text-ink-muted">
            {a.scheduleText} · {who}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-footnote text-ink-muted">
            {run && (
              <span className="inline-flex min-w-0 items-center gap-1.5">
                <span className="sr-only">Ultimo giro:</span>
                <RunState state={run.state} className="text-ink" />
                <span className="truncate">· {formatWhen(run.startedAt)}</span>
              </span>
            )}
            <span className="truncate" data-testid="automation-next">
              {a.status === 'paused'
                ? 'In pausa'
                : a.status === 'draft'
                  ? 'Da confermare'
                  : a.nextRunAt !== null
                    ? `Prossimo: ${formatWhen(a.nextRunAt)}`
                    : 'Nessun giro in vista'}
            </span>
          </span>
        </span>
      </a>
      {a.status !== 'draft' && (
        <Switch
          checked={a.status === 'active'}
          onCheckedChange={(v) => void toggle(v)}
          disabled={busy}
          label={a.status === 'active' ? `Metti in pausa «${a.name}»` : `Riprendi «${a.name}»`}
        />
      )}
    </li>
  );
}

function Empty() {
  return (
    <EmptyScreen
      testId="automations-empty"
      maxWidth={560}
      className="pt-6"
      title="Ancora nessuna automazione"
      text="Un’automazione è un lavoro che la squadra fa da sola, a un’ora fissa: per esempio i post della settimana, ogni domenica sera, pronti da leggere il lunedì."
    >
      <Button onClick={() => openPage(automationPath(null, { mode: 'nuova' }))}>
        <Plus size={18} weight="bold" aria-hidden /> Crea la prima
      </Button>
    </EmptyScreen>
  );
}

export function AutomationList({
  list,
  error,
  onChanged,
}: {
  list: AutomationView[] | null;
  error: string | null;
  onChanged: (a: AutomationView) => void;
}) {
  const projects = useProjects();
  if (error && !list) {
    return (
      <p className="text-body text-stop-ink" role="alert">
        {error}
      </p>
    );
  }
  if (!list) {
    return (
      <p className="label text-ink-muted" aria-busy="true">
        Carico…
      </p>
    );
  }
  if (list.length === 0) return <Empty />;
  return (
    <div className="grid gap-7">
      {groupBySquad(list, (id) => projects?.find((p) => p.id === id)?.name ?? id).map((g) => (
        <section
          key={g.key}
          aria-label={g.label}
          className="grid gap-2.5"
          data-testid="automation-squad"
        >
          <h2 className="label flex items-center gap-2 px-1 text-ink-muted">
            {g.label} · {g.items.length}
          </h2>
          <ul className={cn('set-module set-rows overflow-hidden')}>
            {g.items.map((a) => (
              <Row key={a.id} a={a} onChanged={onChanged} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
