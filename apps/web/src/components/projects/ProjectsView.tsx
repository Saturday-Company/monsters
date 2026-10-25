import { PROJECT_TABS } from '@monsters/shared';
import type { ProjectView } from '@monsters/shared';
import { HandPalm } from '@phosphor-icons/react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { describeError } from '../../lib/api.ts';
import {
  goHome,
  projectPartOf,
  projectPath,
  projectTabOf,
  replaceHash,
  useHashParam,
  type ProjectTab,
} from '../../lib/router.ts';
import { cn } from '../../lib/utils.ts';
import { getApi, notify, useApp } from '../../store/app.ts';
import { initBaseline } from '../../store/reads.ts';
import { putProject, useLists, useProjects } from '../../store/projects.ts';
import { ChatPanel } from '../chat/ChatPanel.tsx';
import { checkModel } from '../chat/useModel.ts';
import { useChats } from '../chat/useChats.ts';
import { ActivityPanel } from '../log/ActivityPanel.tsx';
import { useReviewColumn } from '../shell/ReviewSheet.tsx';
import { ToolbarContent, ToolbarTitle } from '../shell/Toolbar.tsx';
import { Button } from '../ui/button.tsx';
import { panelId, tabId, Tabs } from '../ui/tabs.tsx';
import { ArchivedPage, DraftPage } from './ProjectDraft.tsx';
import { ProjectForm } from './ProjectForm.tsx';
import { ProjectAutomations, ProjectNotes } from './ProjectSections.tsx';
import { ProjectSettings } from './ProjectSettings.tsx';
import { ProjectSquad } from './ProjectSquad.tsx';
import { viewStrings } from './view.strings.ts';
import '../settings/settings.css';

/*
 * A project's page (plan of 17/10 §3 B1, D-097, D-100; docs/design.md,
 * "Progetti"): `#/progetto?id=…&sezione=…`. The chat with its lead first (the
 * `@Nome` of the composer reaches its monsters), then Squadra, Note,
 * Automazioni and Impostazioni (folder, apps, spending, archive: one page that
 * scrolls) as tabs of one row of joined keys. The old tabs' names (`cartella`,
 * `collegamenti`, `spesa`) open Impostazioni at their part.
 * "Ferma i mostri di questo progetto", in the page header, stops its monsters only
 * (the kill switch stays Ferma). A draft shows its plan with Conferma, an
 * archived project its "Ripristina"; `?vista=nuovo` is the form of a new one.
 */

/** Built at render, not at module load: the labels follow a language switch (W-28). */
const projectTabs = (): { value: ProjectTab; label: string }[] => [
  { value: 'chat', label: PROJECT_TABS.chat },
  { value: 'squadra', label: PROJECT_TABS.squadra },
  { value: 'note', label: PROJECT_TABS.note },
  { value: 'automazioni', label: PROJECT_TABS.automazioni },
  { value: 'impostazioni', label: PROJECT_TABS.impostazioni },
];

/** How long "Ferma progetto" waits for its second press, as Ferma (docs/design.md). */
const ARMED_MS = 5000;

/**
 * "Ferma progetto" (D-098): the runs of the project's monsters, the work the
 * orchestrator sent and the giri waiting for its lead. Two presses, as Ferma:
 * the first arms it for five seconds.
 */
function StopProjectKey({ p }: { p: ProjectView }) {
  const s = viewStrings().stop;
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const t = setTimeout(() => setArmed(false), ARMED_MS);
    return () => clearTimeout(t);
  }, [armed]);
  const stop = async () => {
    setArmed(false);
    setBusy(true);
    try {
      const r = await getApi().stopProject(p.id);
      const stopped = r.runsStopped + r.sendsDropped + r.giriSkipped;
      notify(
        stopped === 0
          ? s.nobody(p.name)
          : s.stopped(p.name, r.runsStopped, r.sendsDropped, r.giriSkipped),
        'success',
      );
    } catch (err) {
      notify(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Button
      variant={armed ? 'danger' : 'secondary'}
      size="sm"
      aria-label={armed ? s.armedLabel(p.name) : s.label(p.name)}
      title={armed ? s.armedTitle : s.title}
      disabled={busy}
      onClick={() => (armed ? void stop() : setArmed(true))}
      data-testid="project-stop"
      data-armed={armed ? 'true' : undefined}
    >
      <HandPalm size={18} aria-hidden />
      {armed ? s.armedText : s.text}
    </Button>
  );
}

function Message({ children, alert = false }: { children: ReactNode; alert?: boolean }) {
  return (
    <div className="mx-auto w-full max-w-[920px] px-4 pt-6 sm:px-6">
      <p
        className={cn('text-body', alert ? 'text-stop-ink' : 'label text-ink-muted')}
        role={alert ? 'alert' : undefined}
      >
        {children}
      </p>
    </div>
  );
}

/** A tab's content: one column that scrolls, as the other pages. */
function Scroll({ children, testId }: { children: ReactNode; testId?: string }) {
  return (
    <div className="scroll-soft min-h-0 flex-1 overflow-y-auto" data-testid={testId}>
      <div className="mx-auto grid w-full max-w-[920px] gap-7 px-4 pt-5 pb-12 sm:px-6 sm:pt-6">
        {children}
      </div>
    </div>
  );
}

/** The chat with the lead, as the home's chat: the "Da rivedere" column beside it on wide windows. */
function LeadChat({ p }: { p: ProjectView }) {
  const { threads } = useChats();
  const column = useReviewColumn();
  const events = useApp((s) => s.events);
  const first = useRef(events.at(-1)?.id ?? '');
  useEffect(() => initBaseline(first.current), []);
  useEffect(() => checkModel(), []);
  if (!p.lead) return <Message>{viewStrings().noLead}</Message>;
  return (
    <div
      className={cn(
        'grid min-h-0 flex-1 grid-cols-1',
        column && 'xl:grid-cols-[minmax(0,1fr)_360px]',
      )}
    >
      <ChatPanel
        key={p.lead}
        agentId={p.lead}
        thread={threads.get(p.lead) ?? []}
        rail={{ title: p.name }}
      />
      {column && <ActivityPanel className="border-l border-separator" />}
    </div>
  );
}

function ProjectPage({ p, tab, part }: { p: ProjectView; tab: ProjectTab; part: string | null }) {
  const onChanged = (next: ProjectView) => putProject(next);

  // An old tab's name (`?sezione=spesa`): the link becomes Settings' own, and its part scrolls into
  // view once it is there (the section may still be loading). The target outlives the hash.
  const [target, setTarget] = useState<string | null>(null);
  const [seenPart, setSeenPart] = useState<string | null>(null);
  if (part !== seenPart) {
    setSeenPart(part);
    if (part) setTarget(part);
  }
  useEffect(() => {
    if (part) replaceHash(projectPath(p.id, tab));
  }, [part, tab, p.id]);
  useEffect(() => {
    if (!target) return;
    let tries = 0;
    const timer = setInterval(() => {
      const el = document.getElementById(`project-settings-${target}`);
      if (el || ++tries > 30) {
        clearInterval(timer);
        setTarget(null);
        // Only the tab's own column scrolls: scrollIntoView would also move the window's frame.
        const box = el?.closest<HTMLElement>('.scroll-soft');
        if (el && box)
          box.scrollTop += el.getBoundingClientRect().top - box.getBoundingClientRect().top - 16;
      }
    }, 100);
    return () => clearInterval(timer);
  }, [target]);

  let body: ReactNode;
  switch (tab) {
    case 'chat':
      body = <LeadChat p={p} />;
      break;
    case 'squadra':
      body = (
        <Scroll testId="project-squad-tab">
          <ProjectSquad p={p} onChanged={onChanged} />
        </Scroll>
      );
      break;
    case 'note':
      body = (
        <Scroll>
          <ProjectNotes p={p} />
        </Scroll>
      );
      break;
    case 'automazioni':
      body = (
        <Scroll>
          <ProjectAutomations p={p} />
        </Scroll>
      );
      break;
    case 'impostazioni':
      body = (
        <Scroll testId="project-settings-tab">
          <ProjectSettings p={p} onChanged={onChanged} />
        </Scroll>
      );
      break;
  }

  return (
    <section
      aria-labelledby="project-title"
      className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid="project-page"
      data-project={p.id}
    >
      {/* The chat puts its own keys in the rail, with the project's title. */}
      {tab !== 'chat' && (
        <ToolbarContent>
          <ToolbarTitle id="project-title">{p.name}</ToolbarTitle>
        </ToolbarContent>
      )}
      {/* One Ferma in the rail (all the monsters); the one of this project is here, in its header. */}
      <header className="seam-b flex shrink-0 flex-wrap items-center justify-center gap-x-4 gap-y-2 px-4 pt-3 pb-3 sm:px-6">
        <Tabs
          base="project"
          items={projectTabs()}
          value={tab}
          onChange={(t) => replaceHash(projectPath(p.id, t))}
          label={viewStrings().sectionsOf(p.name)}
        />
        <StopProjectKey p={p} />
      </header>
      <div
        role="tabpanel"
        id={panelId('project', tab)}
        aria-labelledby={tabId('project', tab)}
        data-testid={`project-panel-${tab}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {tab === 'chat' && (
          <h2 id="project-title" className="sr-only">
            {p.name}
          </h2>
        )}
        {body}
      </div>
    </section>
  );
}

export default function ProjectsView() {
  const id = useHashParam('id');
  const param = useHashParam('sezione');
  const tab = projectTabOf(param);
  const part = projectPartOf(param);
  const projects = useProjects();
  const error = useLists((s) => s.projectsError);
  const p = id ? (projects?.find((x) => x.id === id) ?? null) : null;

  if (!id) {
    return (
      <section
        aria-labelledby="project-new-title"
        className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
        data-testid="project-new-page"
      >
        <ToolbarContent>
          <ToolbarTitle id="project-new-title">{viewStrings().newProject}</ToolbarTitle>
        </ToolbarContent>
        <Scroll>
          <ProjectForm />
        </Scroll>
      </section>
    );
  }
  if (!projects) {
    return error ? <Message alert>{error}</Message> : <Message>{viewStrings().loading}</Message>;
  }
  if (!p) {
    return (
      <Scroll testId="project-missing">
        <p className="text-large font-semibold text-ink">{viewStrings().missing}</p>
        <p className="mt-1 text-body text-ink-muted">{viewStrings().missingHint}</p>
        <Button
          variant="secondary"
          className="mt-4"
          onClick={goHome}
          data-testid="project-missing-home"
        >
          {viewStrings().missingHome}
        </Button>
      </Scroll>
    );
  }
  if (p.status === 'draft') return <DraftPage key={p.id} p={p} />;
  if (p.archived) return <ArchivedPage key={p.id} p={p} />;
  return <ProjectPage key={p.id} p={p} tab={tab} part={part} />;
}
