import { formatList, type AutomationRunSummary, type AutomationView } from '@monsters/shared';
import { CaretRight, Pause, PencilSimple, Play, Trash } from '@phosphor-icons/react';
import { useState } from 'react';
import { ApiError, describeError } from '../../lib/api.ts';
import {
  crewOf,
  formatWhen,
  limitsText,
  nextRuns,
  runDuration,
  runStateText,
  triggerText,
  usageText,
} from '../../lib/automations.ts';
import { automationPath, openPage } from '../../lib/router.ts';
import { cn } from '../../lib/utils.ts';
import { getApi, notify, resumeAll, useApp } from '../../store/app.ts';
import { useAgent, useAgents, useNameOf } from '../../store/hooks.ts';
import { usePrefs } from '../../store/prefs.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { Group, Row } from '../settings/parts.tsx';
import { Button } from '../ui/button.tsx';
import { CrewScreen } from '../monster/CrewScreen.tsx';
import { automationsStrings } from './automations.strings.ts';
import { RunState } from './parts.tsx';

/*
 * One automation (docs/design.md, "Automazioni"): its monitor (the crew on a
 * black screen, the name, when, the next giro), the keys (Esegui ora, Metti in
 * pausa / Riprendi, Modifica, Elimina with a confirmation in the page), the
 * modules of what it is (objective, when, who, results and notices) and the
 * history of its giri, each one opening its conversation.
 */

/** Why "Esegui ora" did not start, in words, with what to do. */
function runNowError(err: unknown): { text: string; halted: boolean } {
  if (err instanceof ApiError && err.code === 'halted') {
    return { text: automationsStrings().detail.haltedRun, halted: true };
  }
  return { text: describeError(err), halted: false };
}

function DraftBanner({
  a,
  onChanged,
}: {
  a: AutomationView;
  onChanged: (a: AutomationView) => void;
}) {
  const s = automationsStrings().detail;
  const nameOf = useNameOf();
  const [busy, setBusy] = useState(false);
  const proposer = a.createdBy !== 'user' ? nameOf(a.createdBy) : null;
  const confirm = async () => {
    setBusy(true);
    try {
      // One contract for the drafts of every kind (D-098).
      const api = getApi();
      await api.confirmDraft('automation', a.id);
      onChanged(await api.automation(a.id));
      notify(s.confirmed(a.name, a.scheduleText));
    } catch (err) {
      notify(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const discard = async () => {
    setBusy(true);
    try {
      await getApi().discardDraft('automation', a.id);
      notify(s.discarded(a.name));
      openPage(automationPath());
    } catch (err) {
      notify(describeError(err), 'error');
      setBusy(false);
    }
  };
  return (
    <section
      aria-label={s.draftLabel}
      data-testid="draft-banner"
      className="set-module flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 shadow-[inset_0_0_0_1.5px_var(--signal)]"
    >
      <span aria-hidden className="led" data-tone="signal" data-blink="" />
      <div className="min-w-0 flex-1 basis-[16rem]">
        <p className="text-large font-semibold text-ink">{s.draftTitle}</p>
        <p className="text-body text-ink-muted">{s.draftBody(proposer)}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="dangerSoft" size="sm" onClick={() => void discard()} disabled={busy}>
          {s.discard}
        </Button>
        <Button size="sm" onClick={() => void confirm()} disabled={busy}>
          {s.confirm}
        </Button>
      </div>
    </section>
  );
}

function Monitor({ a }: { a: AutomationView }) {
  const s = automationsStrings().detail;
  const status =
    a.status === 'draft' ? s.statusDraft : a.status === 'paused' ? s.statusPaused : s.statusActive;
  const tone = a.status === 'active' ? 'ok' : a.status === 'draft' ? 'signal' : undefined;
  return (
    <div
      className="screen flex min-w-0 items-center gap-x-4 gap-y-2 rounded-[14px] px-4 py-3 max-sm:flex-wrap"
      data-testid="automation-monitor"
    >
      <CrewScreen
        monsters={crewOf(a).map((id) => ({ id }))}
        height={60}
        max={4}
        working={a.current?.state === 'running'}
        className="bg-transparent px-0 shadow-none"
      />
      <div className="grid min-w-0 flex-1 gap-1 max-sm:basis-full">
        <h2
          className="font-display text-title1 leading-7 break-words text-screen-ink sm:truncate"
          data-testid="automation-name"
        >
          {a.name}
        </h2>
        <p className="font-mono text-micro leading-4 tracking-[0.06em] text-screen-muted uppercase">
          {a.scheduleText}
          {a.nextRunAt !== null && ` · ${s.nextRun(formatWhen(a.nextRunAt))}`}
        </p>
      </div>
      <p className="flex shrink-0 items-center gap-2 font-mono text-micro tracking-[0.06em] text-screen-ink uppercase max-sm:hidden">
        <span aria-hidden className="led" data-tone={tone} data-on-screen="" />
        {status}
      </p>
    </div>
  );
}

function Crew({ a }: { a: AutomationView }) {
  const s = automationsStrings().detail;
  const agents = useAgents();
  return (
    <Group title={s.crewTitle} as="ul" testId="automation-crew">
      {crewOf(a).map((id, i) => {
        const agent = agents.find((x) => x.id === id);
        return (
          <Row
            key={id}
            as="li"
            leading={
              agent ? (
                <MonsterScreen genome={agent.genome} mood="idle" width={40} height={36} pad={2} />
              ) : undefined
            }
            label={
              <span className="flex items-center gap-2">
                <span className="font-semibold">{agent?.name ?? id}</span>
                {i === 0 && <span className="label text-signal-ink">{s.lead}</span>}
              </span>
            }
            description={i === 0 ? s.leadRole : (agent?.role ?? s.gone)}
          />
        );
      })}
    </Group>
  );
}

function When({ a }: { a: AutomationView }) {
  const s = automationsStrings().detail;
  const next =
    a.status === 'active' ? (nextRuns(a.schedule.cron, a.schedule.timezone, 3) ?? []) : [];
  return (
    <Group title={s.whenTitle} testId="automation-when">
      <Row
        label={<span className="font-semibold">{a.scheduleText}</span>}
        description={
          <>
            {s.timezone(a.schedule.timezone)}
            <details className="mt-1">
              <summary className="cursor-pointer text-footnote text-ink-muted">
                {s.advanced}
              </summary>
              <span className="block text-footnote text-ink-muted">
                {s.technicalRule} <code className="font-mono text-micro">{a.schedule.cron}</code>
              </span>
            </details>
          </>
        }
      />
      {next.length > 0 && (
        <div className="px-4 py-3">
          <p className="label mb-2 text-ink-muted">{s.nextRuns}</p>
          <ol className="grid gap-1 text-body text-ink" data-testid="automation-next-runs">
            {next.map((t) => (
              <li key={t} className="tabular-nums">
                {formatWhen(t)}
              </li>
            ))}
          </ol>
        </div>
      )}
      {a.status === 'paused' && <Row label={s.pausedTitle} description={s.pausedText} />}
    </Group>
  );
}

function Results({ a }: { a: AutomationView }) {
  const s = automationsStrings().detail;
  const limits = limitsText(a.limits);
  const where = [a.notify.app && s.inApp, a.notify.telegram && s.onTelegram].filter(
    (x): x is string => typeof x === 'string',
  );
  return (
    <Group title={s.resultsTitle} testId="automation-results">
      <Row
        label={s.notesFolder}
        description={
          a.resultsFolder ? (
            <code className="text-ink">{a.resultsFolder}</code>
          ) : (
            s.notesFolderDefault
          )
        }
      />
      <Row label={s.capPerRun} description={limits ? s.capWith(limits) : s.capDefault} />
      <Row
        label={s.noticesTitle}
        description={where.length > 0 ? s.notified(formatList(where)) : s.noNotices}
      />
    </Group>
  );
}

function GiroRow({ a, run }: { a: AutomationView; run: AutomationRunSummary }) {
  const s = automationsStrings().detail;
  const duration = runDuration(run);
  const showDetails = usePrefs((p) => p.showDetails);
  const usage = usageText(run, showDetails);
  const when = formatWhen(run.slot ?? run.startedAt);
  const body = (
    <>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
          <RunState state={run.state} className="text-body font-semibold text-ink" />
          <span className="text-body text-ink tabular-nums">{when}</span>
        </span>
        <span className="text-footnote text-ink-muted">
          {run.state === 'skipped' && run.message
            ? run.message
            : [triggerText(run.trigger), duration].filter(Boolean).join(' · ')}
          {run.error && run.state !== 'skipped' ? ` · ${run.error}` : ''}
        </span>
        {usage && <span className="label text-ink-muted">{usage}</span>}
      </span>
      {run.runIds.length > 0 && (
        <CaretRight size={18} aria-hidden className="shrink-0 text-ink-muted" />
      )}
    </>
  );
  if (run.runIds.length === 0) {
    return (
      <li
        className="flex items-center gap-3 px-4 py-3"
        data-testid="giro-row"
        data-state={run.state}
      >
        {body}
      </li>
    );
  }
  const href = automationPath(a.id, { giro: run.id });
  return (
    <li data-testid="giro-row" data-state={run.state}>
      <a
        href={href}
        onClick={(e) => {
          if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
          e.preventDefault();
          window.location.hash = href;
        }}
        className="row-key flex items-center gap-3 px-4 py-3 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink"
        aria-label={s.runAria(when, runStateText(run.state).toLowerCase(), run.state)}
      >
        {body}
      </a>
    </li>
  );
}

export function AutomationDetail({
  a,
  runs,
  runsError,
  onRetryRuns,
  onChanged,
}: {
  a: AutomationView;
  runs: AutomationRunSummary[] | null;
  /** Why the runs could not be read (nothing loaded yet): shown with a retry (W-12). */
  runsError?: string | null;
  onRetryRuns?: () => void;
  onChanged: (a: AutomationView) => void;
}) {
  const s = automationsStrings().detail;
  const halted = useApp((st) => st.halted);
  const lead = useAgent(a.lead);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<{ text: string; halted: boolean } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const running = a.current !== null;

  const runNow = async () => {
    setBusy(true);
    setProblem(null);
    try {
      const r = await getApi().runAutomation(a.id);
      notify(
        r.state === 'running'
          ? s.started(lead?.name ?? s.leadFallback)
          : s.queued(lead?.name ?? s.leadFallback),
      );
      if (r.runId) window.location.hash = automationPath(a.id, { giro: r.runId });
    } catch (err) {
      setProblem(runNowError(err));
    } finally {
      setBusy(false);
    }
  };
  const pauseOrResume = async () => {
    setBusy(true);
    try {
      const api = getApi();
      const next =
        a.status === 'paused' ? await api.resumeAutomation(a.id) : await api.pauseAutomation(a.id);
      onChanged(next);
    } catch (err) {
      notify(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await getApi().deleteAutomation(a.id);
      notify(s.deleted(a.name));
      openPage(automationPath());
    } catch (err) {
      notify(describeError(err), 'error');
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-5" data-testid="automation-detail" data-status={a.status}>
      {a.status === 'draft' && <DraftBanner a={a} onChanged={onChanged} />}
      <Monitor a={a} />
      <div className="flex flex-wrap items-center gap-2.5" data-testid="automation-actions">
        {a.status !== 'draft' && (
          <Button
            onClick={() => void runNow()}
            disabled={busy || running}
            variant={halted ? 'secondary' : 'primary'}
            data-testid="automation-run-now"
          >
            <Play size={18} weight="fill" aria-hidden />
            {running ? s.running : s.runNow}
          </Button>
        )}
        {a.status !== 'draft' && (
          <Button variant="secondary" onClick={() => void pauseOrResume()} disabled={busy}>
            {a.status === 'paused' ? (
              <>
                <Play size={18} aria-hidden /> {s.resume}
              </>
            ) : (
              <>
                <Pause size={18} aria-hidden /> {s.pause}
              </>
            )}
          </Button>
        )}
        <Button
          variant="secondary"
          onClick={() => openPage(automationPath(a.id, { mode: 'modifica' }))}
          disabled={busy}
        >
          <PencilSimple size={18} aria-hidden /> {s.edit}
        </Button>
        <Button
          variant="dangerSoft"
          onClick={() => setConfirmDelete(true)}
          disabled={busy || confirmDelete}
          className="sm:ml-auto"
        >
          <Trash size={18} aria-hidden /> {s.delete}
        </Button>
      </div>

      {problem && (
        <div
          role="alert"
          data-testid="run-now-problem"
          className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-[12px] bg-stop-soft px-4 py-3 text-body text-stop-ink"
        >
          <span className="min-w-0 flex-1 basis-[16rem]">{problem.text}</span>
          {problem.halted && halted && (
            <Button size="sm" variant="secondary" onClick={() => void resumeAll()}>
              {s.resumeMonsters}
            </Button>
          )}
        </div>
      )}

      {confirmDelete && (
        <div
          role="alertdialog"
          aria-labelledby="delete-title"
          data-testid="delete-confirm"
          className="set-module grid gap-3 px-4 py-4 shadow-[inset_0_0_0_1.5px_var(--stop)]"
        >
          <p id="delete-title" className="text-large font-semibold text-ink">
            {s.deleteTitle(a.name)}
          </p>
          <p className="text-body text-ink-muted">{s.deleteText}</p>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setConfirmDelete(false)} autoFocus>
              {s.cancel}
            </Button>
            <Button variant="danger" size="sm" onClick={() => void remove()} disabled={busy}>
              {s.delete}
            </Button>
          </div>
        </div>
      )}

      <section aria-labelledby="giri-title" className="grid gap-2.5" data-testid="automation-giri">
        <h2 id="giri-title" className="label px-1 text-ink-muted">
          {s.runsTitle(runs?.length ?? 0)}
        </h2>
        {runs === null && runsError ? (
          <div
            role="alert"
            data-testid="automation-giri-error"
            className="flex flex-wrap items-center gap-x-4 gap-y-2 px-1 text-body text-stop-ink"
          >
            <span>{s.runsFailed}</span>
            {onRetryRuns && (
              <Button size="sm" variant="secondary" onClick={onRetryRuns}>
                {s.retry}
              </Button>
            )}
          </div>
        ) : runs === null ? (
          <p className="label px-1 text-ink-muted" aria-busy="true">
            {automationsStrings().loading}
          </p>
        ) : runs.length === 0 ? (
          <p className="px-1 text-body text-ink-muted">
            {s.noRuns(a.nextRunAt !== null ? formatWhen(a.nextRunAt) : null)}
          </p>
        ) : (
          <ul className={cn('set-module set-rows overflow-hidden')}>
            {runs.map((r) => (
              <GiroRow key={r.id} a={a} run={r} />
            ))}
          </ul>
        )}
      </section>
      <Group title={s.goal} testId="automation-objective">
        <p className="max-w-[68ch] px-4 pb-4 text-large leading-[1.55] whitespace-pre-wrap text-ink">
          {a.objective}
        </p>
      </Group>
      <div className="grid gap-5 min-[1100px]:grid-cols-2">
        <When a={a} />
        <Crew a={a} />
      </div>
      <Results a={a} />
    </div>
  );
}
