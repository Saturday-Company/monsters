import {
  Archive,
  CaretRight,
  ClockCountdown,
  Files,
  GearSix,
  ListBullets,
  Notebook,
  Plus,
} from '@phosphor-icons/react';
import type { ProjectView } from '@monsters/shared';
import { useMemo, useState } from 'react';
import type { MouseEvent, ReactNode } from 'react';
import { squadsOf } from '../../lib/projects.ts';
import {
  openChat,
  openPage,
  PATHS,
  projectPath,
  useHashParam,
  type Route,
} from '../../lib/router.ts';
import { cn } from '../../lib/utils.ts';
import { useApp } from '../../store/app.ts';
import { automationWork } from '../../store/derive.ts';
import { useMediaQuery, useOrchestrator } from '../../store/hooks.ts';
import { useProjects } from '../../store/projects.ts';
import { ChatList, isMac } from '../chat/ChatList.tsx';
import { useChats } from '../chat/useChats.ts';
import { ComputerSwitcher } from './ComputerSwitcher.tsx';
import { SIDEBAR_WIDTH } from './Toolbar.tsx';

/*
 * The sidebar (docs/design.md, "La barra laterale"): straight on the chassis,
 * under the wordmark of the rail. The god's bar (its chat, D-101, D-102), the
 * search sunk in a well, the squads (the personal one and each project, D-100) as one strip per
 * monster and "Nuovo progetto", then Automazioni, Note, File and Attività; Impostazioni and, in the desktop
 * app, the computer at the foot. On a phone it is the home screen, edge to
 * edge under the rail.
 */

/** A shortcut as the sidebar shows it (⌘2 on a Mac, Ctrl 2 elsewhere) and as ARIA says it. */
function shortcut(key: string): { shown: string; aria: string } {
  return isMac
    ? { shown: `⌘${key}`, aria: `Meta+${key}` }
    : { shown: `Ctrl ${key}`, aria: `Control+${key}` };
}

/**
 * A section as a square key for the compact foot (windows under 860 px tall): the icon with its
 * name under it in `.label`, short enough for five of them in a row. The full name is the
 * accessible name and the tooltip.
 */
function NavTile({
  href,
  icon,
  label,
  short,
  current,
  keys,
  waiting = 0,
  testId,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  short: string;
  current: boolean;
  keys?: string;
  waiting?: number;
  testId?: string;
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    openPage(href);
  };
  const sc = keys ? shortcut(keys) : null;
  return (
    <a
      href={href}
      onClick={onClick}
      aria-current={current ? 'page' : undefined}
      aria-keyshortcuts={sc?.aria}
      aria-label={
        waiting > 0
          ? `${label}: ${waiting === 1 ? 'un giro aspetta una risposta' : `${waiting} giri aspettano una risposta`}`
          : label
      }
      title={sc ? `${label} (${sc.shown})` : label}
      data-testid={testId}
      className={cn(
        'relative flex h-14 min-w-0 flex-col items-center justify-center gap-0.5 rounded-[12px] text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink',
        current ? 'bg-panel shadow-[inset_0_0_0_1.5px_var(--ink)]' : 'row-key',
      )}
    >
      <span className={current ? 'text-ink' : 'text-ink-muted'}>{icon}</span>
      <span
        aria-hidden
        className={cn(
          'label max-w-full truncate tracking-normal',
          current ? 'text-ink' : 'text-ink-muted',
        )}
      >
        {short}
      </span>
      {waiting > 0 && (
        <span
          aria-hidden
          data-testid="nav-waiting"
          className="absolute top-1.5 right-2 led"
          data-tone="signal"
          data-blink=""
        />
      )}
    </a>
  );
}

function NavRow({
  href,
  icon,
  label,
  current,
  keys,
  waiting = 0,
  testId,
}: {
  href: string;
  icon: ReactNode;
  label: string;
  current: boolean;
  /** The key that opens it with ⌘ / Ctrl (none: no shortcut). */
  keys?: string;
  /** Things that wait for the user there (giri with a question): the orange light and the number. */
  waiting?: number;
  testId?: string;
}) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    e.preventDefault();
    openPage(href);
  };
  const sc = keys ? shortcut(keys) : null;
  return (
    <a
      href={href}
      onClick={onClick}
      aria-current={current ? 'page' : undefined}
      aria-keyshortcuts={sc?.aria}
      data-testid={testId}
      className={cn(
        'flex h-11 items-center gap-3 rounded-[12px] pr-3 pl-3 text-body text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink',
        current ? 'bg-panel font-semibold shadow-[inset_0_0_0_1.5px_var(--ink)]' : 'row-key',
      )}
    >
      <span className={current ? 'text-ink' : 'text-ink-muted'}>{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {waiting > 0 && (
        <span className="flex items-center gap-1.5" data-testid="nav-waiting">
          <span aria-hidden className="led" data-tone="signal" data-blink="" />
          <span className="label text-ink">{waiting}</span>
          <span className="sr-only">
            {waiting === 1
              ? 'un giro aspetta una risposta'
              : `${waiting} giri aspettano una risposta`}
          </span>
        </span>
      )}
      {sc && (
        <span aria-hidden className="label text-ink-muted max-md:hidden">
          {sc.shown}
        </span>
      )}
    </a>
  );
}

/**
 * The archived projects (D-098), folded under "Nuovo progetto": each leads to
 * its page, where "Ripristina" brings it back with its monsters.
 */
function ArchivedProjects({
  projects,
  current,
}: {
  projects: readonly ProjectView[] | null;
  current: string | null;
}) {
  const archived = (projects ?? []).filter((p) => p.archived);
  const [open, setOpen] = useState(() => archived.some((p) => p.id === current));
  if (archived.length === 0) return null;
  return (
    <div data-testid="projects-archived">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="row-key label flex h-9 w-full items-center gap-2 rounded-[10px] px-3 text-left text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink"
      >
        <CaretRight
          size={12}
          weight="bold"
          aria-hidden
          className={cn('turn', open && 'rotate-90')}
        />
        Progetti archiviati · {archived.length}
      </button>
      {open && (
        <ul className="grid gap-0.5 pt-0.5">
          {archived.map((p) => (
            <li key={p.id}>
              <NavRow
                href={projectPath(p.id)}
                icon={<Archive size={20} aria-hidden />}
                label={p.name}
                current={p.id === current}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Sidebar({ route, phone }: { route: Route; phone: boolean }) {
  const { agents, threads, waiting } = useChats();
  const orch = useOrchestrator();
  const param = useHashParam('chat');
  const events = useApp((s) => s.events);
  // A short window: the foot is a row of square keys, so the squads keep their room.
  const short = useMediaQuery('(max-height: 859px)');
  const waitingGiri = useMemo(() => automationWork(events).waiting, [events]);

  const projects = useProjects();
  const { god, squads } = useMemo(() => squadsOf(agents, projects), [agents, projects]);
  const projectParam = useHashParam('id');
  const newProject = useHashParam('vista') === 'nuovo';

  const chosen = agents.find((a) => a.id === param)?.id ?? null;
  // On a wide window the home shows the orchestrator's chat; the phone home is this list.
  const selected = route !== 'home' || phone ? null : (chosen ?? orch?.id ?? null);
  const currentProject = route === 'project' ? projectParam : null;

  const squadsEnd = (
    <div className="grid gap-1 pt-2">
      <NavRow
        href={projectPath(null)}
        icon={<Plus size={20} aria-hidden />}
        label="Nuovo progetto"
        current={route === 'project' && newProject}
        testId="project-new"
      />
      <ArchivedProjects projects={projects} current={currentProject} />
    </div>
  );

  const sections = (
    <nav aria-label="Sezioni" className="grid gap-1">
      <NavRow
        href={PATHS.automations}
        icon={<ClockCountdown size={20} aria-hidden />}
        label="Automazioni"
        current={route === 'automations'}
        keys="2"
        waiting={waitingGiri}
      />
      <NavRow
        href={PATHS.vault}
        icon={<Notebook size={20} aria-hidden />}
        label="Note"
        current={route === 'vault'}
        keys="3"
      />
      <NavRow
        href={PATHS.files}
        icon={<Files size={20} aria-hidden />}
        label="File"
        current={route === 'files'}
        keys="4"
      />
      <NavRow
        href={PATHS.log}
        icon={<ListBullets size={20} aria-hidden />}
        label="Attività"
        current={route === 'log'}
        keys="5"
      />
    </nav>
  );

  return (
    <aside
      aria-label="Barra laterale"
      data-testid="sidebar"
      className={cn('flex min-h-0 shrink-0 flex-col bg-chassis', phone && 'w-full')}
      style={phone ? undefined : { width: SIDEBAR_WIDTH }}
    >
      {agents.length === 0 ? (
        <div className="min-h-0 flex-1 overflow-y-auto px-3 pt-2">
          <p className="px-3 py-4 text-body text-ink-muted">La squadra non c’è ancora.</p>
        </div>
      ) : (
        <ChatList
          god={god}
          squads={squads}
          threads={threads}
          waiting={waiting}
          selected={selected}
          onOpen={openChat}
          currentProject={currentProject}
          afterSquads={squadsEnd}
        />
      )}

      {/* The sections stay in reach however many squads there are: only the squads scroll (D-100). */}
      <div className="grid shrink-0 gap-1 px-3 pt-1 pb-3" data-testid="sidebar-foot">
        <div aria-hidden className="seam-h mx-0 mb-1" />
        {short ? (
          <nav
            aria-label="Sezioni"
            className="-mx-1.5 grid grid-cols-5 gap-0.5"
            data-testid="sidebar-tiles"
          >
            <NavTile
              href={PATHS.automations}
              icon={<ClockCountdown size={22} aria-hidden />}
              label="Automazioni"
              short="Auto"
              current={route === 'automations'}
              keys="2"
              waiting={waitingGiri}
            />
            <NavTile
              href={PATHS.vault}
              icon={<Notebook size={22} aria-hidden />}
              label="Note"
              short="Note"
              current={route === 'vault'}
              keys="3"
            />
            <NavTile
              href={PATHS.files}
              icon={<Files size={22} aria-hidden />}
              label="File"
              short="File"
              current={route === 'files'}
              keys="4"
            />
            <NavTile
              href={PATHS.log}
              icon={<ListBullets size={22} aria-hidden />}
              label="Attività"
              short="Attiv."
              current={route === 'log'}
              keys="5"
            />
            <NavTile
              href={PATHS.settings}
              icon={<GearSix size={22} aria-hidden />}
              label="Impostazioni"
              short="Impost."
              current={route === 'settings'}
              keys=","
            />
          </nav>
        ) : (
          <>
            {sections}
            <NavRow
              href={PATHS.settings}
              icon={<GearSix size={20} aria-hidden />}
              label="Impostazioni"
              current={route === 'settings'}
              keys=","
            />
          </>
        )}
        <ComputerSwitcher />
      </div>
    </aside>
  );
}
