import { describeSchedule, draftTaint, type DraftView, type ProjectView } from '@monsters/shared';
import { CaretRight, Warning } from '@phosphor-icons/react';
import { useEffect, useState, type ReactNode } from 'react';
import { describeError } from '../../lib/api.ts';
import { crewOf } from '../../lib/automations.ts';
import { docsDiff } from '../../lib/docs-diff.ts';
import { monsterFor } from '../../lib/monsters.ts';
import { plannedLead, plannedLeadLook, plannedMembers } from '../../lib/projects.ts';
import { automationPath, openPage, projectPath, settingsPath } from '../../lib/router.ts';
import { cn } from '../../lib/utils.ts';
import { getApi, notify, refreshAgents } from '../../store/app.ts';
import { handDraft } from '../../store/draft-handoff.ts';
import { useAgents, useNameOf } from '../../store/hooks.ts';
import {
  holdDraft,
  refreshDrafts,
  refreshProjects,
  releaseDraft,
  useDrafts,
  useLists,
  useProject,
} from '../../store/projects.ts';
import { LoadFailed, RowBody } from '../settings/parts.tsx';
import { Button } from '../ui/button.tsx';
import { PathText } from '../ui/PathText.tsx';
import { DiffLines } from '../vault/NoteHistory.tsx';
import { CrewScreen, type ScreenMonster } from '../monster/CrewScreen.tsx';
import { draftStrings } from './draft.strings.ts';

/*
 * The drafts of the monsters in "To review" (D-098, D-100): a new monster
 * (`team_propose_monster`), a whole project (`project_propose`), an
 * automation (`automation_propose`), newest first, each with Confirm,
 * Edit (the form of its kind, filled in) and Discard. A project shows its
 * plan: the lead, the monsters, the folder and the automations that will
 * wait for a confirmation of their own. A change to CLAUDE.md or AGENTS.md
 * of a project's folder (`project_docs_propose`, D-113) shows its diff, with
 * Apply and Leave it (also on the project's page, Folder). Lines of
 * memory of a run that is not only the user's (review of 18/10, A2) show
 * every line, with Confirm and Discard. Nothing
 * proposed exists until "Confirm"; the list follows `DRAFT_EVENT_TYPES`.
 */

type DocsDraft = Extract<DraftView, { kind: 'docs' }>;

/** Confirms a draft as proposed; the toast says what exists now. */
export async function confirmDraft(d: Pick<DraftView, 'kind' | 'id' | 'title'>): Promise<void> {
  const s = draftStrings();
  const r = await getApi().confirmDraft(d.kind, d.id);
  void refreshDrafts();
  if (d.kind !== 'automation' && d.kind !== 'memory') {
    void refreshProjects();
    if (d.kind !== 'docs') void refreshAgents().catch(() => {});
  }
  if (d.kind === 'project' && r.project) {
    const later = r.automationDrafts?.length ?? 0;
    const project = r.project;
    notify(s.projectReady(d.title, later), 'success', {
      action: { label: s.card.open, run: () => openPage(projectPath(project)) },
      ms: 8000,
    });
  } else if (d.kind === 'monster') {
    notify(s.monsterReady(d.title), 'success');
  } else if (d.kind === 'docs') {
    notify(s.docsDone(s.docsSubject(d.title)), 'success');
  } else if (d.kind === 'memory') {
    notify(s.memoryDone(s.memorySubject(d.title)), 'success');
  } else {
    notify(s.automationDone(d.title), 'success');
  }
}

/** How long a discarded draft can still be brought back with "Undo" (U2-32). */
export const DISCARD_UNDO_MS = 10_000;

/**
 * Leaves a draft aside: nothing is created, who proposed it reads it at its next turn. The draft
 * disappears at once and the core is told after `DISCARD_UNDO_MS`, unless "Undo" is pressed: a
 * discard is not something to take back after the fact, so it waits instead. If the page closes
 * first the draft is still there at the next visit.
 */
export function discardDraft(d: Pick<DraftView, 'kind' | 'id' | 'title'>): Promise<void> {
  const s = draftStrings();
  const key = `${d.kind}:${d.id}`;
  let undone = false;
  const timer = setTimeout(() => {
    if (undone) return;
    getApi()
      .discardDraft(d.kind, d.id)
      .then(() => {
        releaseDraft(key);
        void refreshDrafts();
        if (d.kind === 'project') void refreshProjects();
      })
      .catch((err: unknown) => {
        // It did not go through: the draft is back where it was, and the reason is said.
        releaseDraft(key);
        void refreshDrafts();
        notify(describeError(err), 'error');
      });
  }, DISCARD_UNDO_MS);
  holdDraft(key);
  notify(
    d.kind === 'docs'
      ? s.docsLeft(s.docsSubject(d.title))
      : d.kind === 'memory'
        ? s.memoryLeft(s.memorySubject(d.title))
        : s.discarded(d.title),
    'info',
    {
      action: {
        label: s.card.undo,
        run: () => {
          undone = true;
          clearTimeout(timer);
          releaseDraft(key);
        },
      },
      ms: DISCARD_UNDO_MS,
    },
  );
  return Promise.resolve();
}

/** "Edit": the form of its kind, filled in with the draft. */
function edit(d: DraftView): void {
  if (d.kind === 'monster') {
    handDraft({
      draft: d.monster.draft,
      proposal: d.id,
      ...(d.monster.models ? { models: d.monster.models } : {}),
    });
    openPage(d.project ? projectPath(d.project, 'squadra') : settingsPath('squadra'));
  } else if (d.kind === 'project') {
    openPage(projectPath(d.id));
  } else if (d.kind === 'automation') {
    openPage(automationPath(d.id, { mode: 'modifica' }));
  }
}

/** The plan of a proposed project in a few lines (the card and the draft's page). */
export function PlanLines({
  d,
  className,
}: {
  d: Extract<DraftView, { kind: 'project' }>['projectDraft'];
  className?: string;
}) {
  const s = draftStrings().plan;
  const nameOf = useNameOf();
  const agents = useAgents();
  const taken = agents.map((a) => a.name);
  const lead = plannedLead(d, nameOf);
  const members = plannedMembers(d.plan?.members ?? [], d.name, nameOf, taken);
  const leadName = lead.name ?? s.freeName;
  const leadDetail = lead.detail;
  const automations = d.plan?.automations ?? [];
  return (
    <dl
      className={cn(
        'grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-footnote',
        className,
      )}
      data-testid="draft-plan"
    >
      <dt className="label pt-0.5 text-ink-muted">{s.lead}</dt>
      <dd className="text-ink">
        <span className="font-semibold">{leadName}</span>{' '}
        <span className="text-ink-muted">({leadDetail})</span>
      </dd>
      {members.length > 0 && (
        <>
          <dt className="label pt-0.5 text-ink-muted">{s.monsters}</dt>
          <dd className="grid gap-0.5 text-ink">
            {members.map((m) => (
              <span key={m.name}>
                <span className="font-semibold">{m.name}</span>{' '}
                <span className="text-ink-muted">({m.detail})</span>
              </span>
            ))}
          </dd>
        </>
      )}
      <dt className="label pt-0.5 text-ink-muted">{s.folder}</dt>
      <dd className="min-w-0 text-ink">
        {d.folder ? (
          <>
            <PathText path={d.folder} max={30} />
            {d.plan?.createFolder && (
              <span className="block text-footnote text-ink-muted">{s.createOnConfirm}</span>
            )}
            <span
              className="mt-0.5 block font-sans text-footnote text-ink-muted"
              data-testid="draft-folder-grant"
            >
              {folderGrant(d)}
            </span>
          </>
        ) : (
          <span className="font-sans text-footnote text-ink-muted">{s.none}</span>
        )}
      </dd>
      {automations.length > 0 && (
        <>
          <dt className="label pt-0.5 text-ink-muted">{s.after}</dt>
          <dd className="grid gap-0.5 text-ink">
            {automations.map((a) => (
              <span key={a.name}>
                <span className="font-semibold">{s.quoted(a.name)}</span>{' '}
                <span className="text-ink-muted">
                  {s.separately(describeSchedule(a.schedule.cron))}
                </span>
              </span>
            ))}
          </dd>
        </>
      )}
    </dl>
  );
}

/** What confirming a project grants on its folder (D-097): read and write for all its monsters. */
export function folderGrant(d: Pick<ProjectView, 'plan'>): string {
  return draftStrings().grant(Boolean(d.plan?.createFolder));
}

/**
 * A proposed project in the narrow column of "To review": the lead and how many monsters
 * come with it, and the folder its monsters get with what they may do there (review of ondate
 * 3-4, n. 6: "Confirm" is right below, the folder is not something to find behind "Open").
 * The whole plan and the automations are on the page of the project in draft.
 */
export function PlanSummary({ d }: { d: Extract<DraftView, { kind: 'project' }>['projectDraft'] }) {
  const s = draftStrings().summary;
  const nameOf = useNameOf();
  const lead = plannedLead(d, nameOf);
  const others = d.plan?.members.length ?? 0;
  const leadName = lead.name ?? s.newLead;
  return (
    <div className="grid gap-1 text-footnote leading-snug text-ink-muted">
      <p className="break-words" data-testid="draft-plan-summary">
        <span className="font-semibold text-ink">{leadName}</span> {s.leads(others)}
      </p>
      {d.folder && (
        <p className="min-w-0 break-words" data-testid="draft-plan-folder">
          <span className="text-ink">{s.folder} </span>
          <PathText path={d.folder} max={30} className="text-ink" />
          {d.plan?.createFolder && <span> ({draftStrings().plan.createOnConfirm})</span>}
          <span className="block break-words">{folderGrant(d)}</span>
        </p>
      )}
    </div>
  );
}

/** Who and what a draft shows on its small screen. */
function screenOf(d: DraftView): ScreenMonster[] {
  if (d.kind === 'monster') return [{ genome: d.monster.draft.genome, name: d.title }];
  if (d.kind === 'automation') return crewOf(d.automation).map((id) => ({ id }));
  if (d.kind === 'docs') return d.from === 'user' ? [] : [{ id: d.from }];
  if (d.kind === 'memory') return [{ id: d.memory.agent }];
  return planMonsters(d.projectDraft);
}

/** The monsters of a project's plan on a screen, its lead first with its look (D-102). */
export function planMonsters(p: Pick<ProjectView, 'plan' | 'name'>): ScreenMonster[] {
  const look = plannedLeadLook(p);
  return [
    look,
    ...(p.plan?.members ?? []).map((m): ScreenMonster =>
      'draft' in m
        ? { genome: m.draft.genome, name: m.draft.name }
        : { genome: monsterFor(m.name ?? m.copyOf), name: m.name ?? m.copyOf },
    ),
  ];
}

/** A warning on a docs proposal: an orange mark and a sentence. */
function Caution({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <p
      className="flex items-start gap-1.5 text-footnote leading-snug text-signal-ink"
      data-testid={testId}
    >
      <Warning size={17} aria-hidden className="mt-px shrink-0" />
      <span>{children}</span>
    </p>
  );
}

/**
 * A change to CLAUDE.md or AGENTS.md (D-113): the warnings first (they decide whether to apply it),
 * then the file and the diff behind "Show changes". Who and why are the card's sentence above.
 */
function DocsLines({ d }: { d: DocsDraft }) {
  const s = draftStrings().docs;
  const project = useProject(d.project ?? null);
  const [open, setOpen] = useState(false);
  const x = d.docs;
  const diff = docsDiff(x.diff);
  return (
    <div className="grid gap-2.5" data-testid="docs-draft">
      {x.tainted && <Caution testId="docs-tainted">{s.tainted(x.source ?? null)}</Caution>}
      {x.stale && <Caution testId="docs-stale">{s.stale}</Caution>}
      {x.folderMoved && <Caution testId="docs-folder-moved">{s.folderMoved}</Caution>}
      {x.tooLarge && <Caution testId="docs-too-large">{s.tooLarge(x.file)}</Caution>}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        data-testid="docs-changes-toggle"
        className="row-key label -mx-1 flex min-h-9 items-center gap-2 rounded-[10px] px-1 text-left text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink"
      >
        <CaretRight
          size={12}
          weight="bold"
          aria-hidden
          className={cn('turn shrink-0', open && 'rotate-90')}
        />
        {open ? s.hideChanges : s.showChanges(diff.added, diff.removed)}
      </button>
      {open && (
        <>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-footnote">
            <dt className="label pt-0.5 text-ink-muted">{s.file}</dt>
            <dd className="text-ink">
              <span className="font-mono text-micro leading-5">{x.file}</span>
              {x.current === null && <span className="text-ink-muted">{s.isNew}</span>}
              {project?.folder && <PathText path={project.folder} max={30} className="block" />}
            </dd>
          </dl>
          <DiffLines lines={diff.lines} testId="docs-diff" />
        </>
      )}
    </div>
  );
}

/** Lines of memory waiting for the user (review of 18/10, A2): each one as it would be added. */
function MemoryLines({ d }: { d: Extract<DraftView, { kind: 'memory' }> }) {
  return (
    <div className="grid gap-1.5" data-testid="memory-draft">
      <ul className="grid gap-1 text-footnote leading-snug text-ink">
        {d.memory.lines.map((l) => (
          <li key={l} className="break-words">
            · {l}
          </li>
        ))}
      </ul>
      {d.memory.tainted && (
        <p className="text-footnote leading-snug text-ink-muted">{draftStrings().memoryTainted}</p>
      )}
    </div>
  );
}

/** How long a card whose press went through waits for the drafts to be read again. */
const DRAFT_SETTLE_MS = 6000;

function DraftCard({ d, primary }: { d: DraftView; primary: boolean }) {
  const s = draftStrings();
  const nameOf = useNameOf();
  const [busy, setBusy] = useState<'confirm' | 'discard' | null>(null);
  const [error, setError] = useState<string | null>(null);
  // The press went through: the card should leave with the next read of the drafts. If that read
  // failed it would stay with its keys disabled for good, so they come back after a while (W-39).
  const [went, setWent] = useState(false);
  useEffect(() => {
    if (!went) return;
    const t = setTimeout(() => {
      setBusy(null);
      setWent(false);
    }, DRAFT_SETTLE_MS);
    return () => clearTimeout(t);
  }, [went]);
  const who = d.from === 'user' ? null : (d.fromName ?? nameOf(d.from));
  const run = async (what: 'confirm' | 'discard') => {
    setBusy(what);
    setError(null);
    try {
      await (what === 'confirm' ? confirmDraft(d) : discardDraft(d));
      setWent(true);
    } catch (err) {
      setError(describeError(err));
      setBusy(null);
    }
  };
  const monsters = screenOf(d);
  // Not only the user's request: third-party text, a person of a Telegram group (review 18/10, M5).
  const taint = d.from === 'user' ? null : draftTaint(d);
  // A docs proposal that cannot be applied any more (D-113): why, on the disabled key.
  const blocked =
    d.kind !== 'docs'
      ? null
      : d.docs.stale
        ? s.docs.blockedStale
        : d.docs.folderMoved
          ? s.docs.blockedFolder
          : d.docs.tooLarge
            ? s.docs.blockedLarge
            : null;
  return (
    <li
      className="set-module grid grid-cols-[minmax(0,1fr)] gap-3 px-3.5 py-3"
      data-testid="draft-card"
      aria-busy={busy !== null || undefined}
      data-kind={d.kind}
      data-id={d.id}
    >
      <p className="label flex items-center gap-2 text-ink-muted">
        <span aria-hidden className="led" data-tone="signal" />
        {who ? s.card.proposes(who, s.kindWords[d.kind]) : s.card.draft(s.kindWords[d.kind])}
      </p>
      <div className="flex items-start gap-3">
        {monsters.length > 0 && <CrewScreen monsters={monsters} height={40} max={3} />}
        <div className="min-w-0 flex-1">
          <p
            className="text-large leading-6 font-semibold break-words text-ink"
            data-testid="draft-title"
          >
            {d.kind === 'docs'
              ? s.docs.sentence(who, s.docsSubject(d.title), d.docs.current === null)
              : d.title}
          </p>
          <p
            className={cn(
              'text-footnote leading-snug text-ink-muted',
              d.kind === 'project' && 'line-clamp-2',
            )}
          >
            {d.kind === 'docs' && d.docs.reason ? s.docs.reason(d.docs.reason) : d.summary}
          </p>
        </div>
      </div>
      {d.kind === 'project' && <PlanSummary d={d.projectDraft} />}
      {d.kind === 'docs' && <DocsLines d={d} />}
      {d.kind === 'memory' && <MemoryLines d={d} />}
      {d.kind !== 'docs' && taint && (
        <Caution testId="draft-tainted">{s.card.taint(taint)}</Caution>
      )}
      {error && (
        <p className="text-footnote text-stop-ink" role="alert">
          {error}
        </p>
      )}
      {d.kind === 'docs' ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={primary && !blocked ? 'primary' : 'secondary'}
            disabled={busy !== null || blocked !== null}
            title={blocked ?? undefined}
            onClick={() => void run('confirm')}
            data-testid="draft-confirm"
          >
            {busy === 'confirm' ? s.card.applying : s.card.apply}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            disabled={busy !== null}
            onClick={() => void run('discard')}
            data-testid="draft-discard"
          >
            {s.card.leave}
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant={primary ? 'primary' : 'secondary'}
            disabled={busy !== null}
            onClick={() => void run('confirm')}
            data-testid="draft-confirm"
          >
            {busy === 'confirm' ? s.card.confirming : s.card.confirm}
          </Button>
          {d.kind !== 'memory' && (
            <Button
              size="sm"
              variant="secondary"
              disabled={busy !== null}
              onClick={() => edit(d)}
              data-testid="draft-edit"
            >
              {d.kind === 'project' ? s.card.open : s.card.edit}
            </Button>
          )}
          {/* A project is discarded from its own page, next to the whole plan. */}
          {d.kind !== 'project' && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void run('discard')}
              data-testid="draft-discard"
            >
              {s.card.discard}
            </Button>
          )}
        </div>
      )}
    </li>
  );
}

/** "To confirm" at the top of "To review": only when something waits. */
export function DraftsSection() {
  const drafts = useDrafts();
  const failed = useLists((l) => l.drafts === null && l.draftsError !== null);
  // A first read that failed is not "nothing to review": say so, with a way to ask again.
  if (!drafts && failed) {
    return (
      <div className="mb-6">
        <LoadFailed
          what={draftStrings().what}
          onRetry={() => void refreshDrafts()}
          testId="drafts-load-failed"
        />
      </div>
    );
  }
  if (!drafts || drafts.length === 0) return null;
  return (
    <section aria-labelledby="drafts-title" className="mb-6" data-testid="review-drafts">
      <h3 id="drafts-title" className="label flex items-center gap-2 px-1 pb-2 text-ink-muted">
        <span aria-hidden className="led" data-tone="signal" data-blink="" />
        {draftStrings().toConfirm(drafts.length)}
      </h3>
      <ul className="grid gap-2.5">
        {drafts.map((d, i) => (
          <DraftCard key={`${d.kind}:${d.id}`} d={d} primary={i === 0} />
        ))}
      </ul>
    </section>
  );
}

/** The proposals for the instructions of one project, on its page (Folder, D-113). */
export function ProjectDocsDrafts({ project }: { project: string }) {
  const drafts = useDrafts()?.filter((d) => d.kind === 'docs' && d.project === project) ?? [];
  if (drafts.length === 0) return null;
  return (
    <RowBody>
      <p className="label flex items-center gap-2 text-ink-muted">
        <span aria-hidden className="led" data-tone="signal" />
        {draftStrings().docsProposals(drafts.length)}
      </p>
      <ul className="grid gap-2.5" data-testid="project-docs-drafts">
        {drafts.map((d, i) => (
          <DraftCard key={d.id} d={d} primary={i === 0} />
        ))}
      </ul>
    </RowBody>
  );
}
