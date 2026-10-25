import {
  formatEur,
  formatList,
  MCP_CATALOG,
  type ClaudeConnectionsResponse,
  type McpServersResponse,
  type PermissionsResponse,
  type ProjectSpendView,
  type ProjectView,
  type SpendView,
} from '@monsters/shared';
import { ArrowRight, Copy, Plus } from '@phosphor-icons/react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { describeError } from '../../lib/api.ts';
import { looksAbsolute, newFolderIn } from '../../lib/projects.ts';
import {
  automationPath,
  openPage,
  PATHS,
  SPEND_CAP_PATH,
  settingsPath,
  vaultPath,
} from '../../lib/router.ts';
import { domId, formatAgo } from '../../lib/utils.ts';
import { getApi, notify } from '../../store/app.ts';
import { useAgents } from '../../store/hooks.ts';
import { AutomationList } from '../automations/AutomationList.tsx';
import { useAutomationTick, useLoaded } from '../automations/parts.tsx';
import {
  AgentMark,
  FormField,
  Group,
  LoadFailed,
  Row,
  RowBody,
  Status,
  useRetry,
} from '../settings/parts.tsx';
import {
  CapChain,
  CapsForm,
  chainOf,
  closestMeter,
  closestOf,
  noCapNote,
  SpendDisplay,
  estimatedNotice,
  unpricedNotice,
} from '../settings/SpendSection.tsx';
import { vaultApi } from '../vault/api.ts';
import { Button } from '../ui/button.tsx';
import { Segmented, Switch } from '../ui/controls.tsx';
import { Input } from '../ui/field.tsx';
import { ProjectDocsDrafts } from './DraftCards.tsx';
import { Details } from './Details.tsx';
import { loadProjectNotes, type ProjectNotes } from './project-notes.ts';
import { FolderPickButton, useCanPickFolder } from './FolderPicker.tsx';
import { sectionsStrings } from './sections.strings.ts';

/*
 * The tabs of a project's page besides the chat and the squad (D-100), and the
 * parts of its Settings (one page that scrolls, `ProjectSettings`):
 * - Notes: the notes of its area (`Progetti/<nome>/`), written by its monsters,
 *   read by everyone;
 * - Folder: the folder where its monsters work, on a small screen with
 *   "Copy" (the browser cannot open a folder of the computer, and the
 *   desktop bridge opens only files of the notes), changed or taken away;
 *   the monsters' proposals for its instructions file (D-113);
 * - Apps: the web search with the monsters that cannot use it and why, and
 *   which apps given to all monsters the project sees;
 * - Automations: its automations, as in the Automations section;
 * - Spend: its cap, with the one for all monsters above and the monsters' below
 *   (three levels, D-070, D-097).
 */

/* ---------------------------------------------------------------- Notes */

export function ProjectNotes({ p }: { p: ProjectView }) {
  const s = sectionsStrings().notes;
  const [found, setFound] = useState<ProjectNotes | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, retry] = useRetry(() => setFailed(false));
  const area = p.vaultArea;
  useEffect(() => {
    let alive = true;
    loadProjectNotes(vaultApi, area)
      .then((r) => alive && setFound(r))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [area, attempt]);
  const notes = found?.notes ?? null;

  return (
    <Group
      title={s.title}
      as="ul"
      testId="project-notes"
      description={
        <>
          {s.stayIn} <span className="font-mono text-ink">{area}/</span>
          {s.stayInRest}
        </>
      }
      footer={
        <a href={PATHS.vault} className="font-medium text-signal-ink hover:underline">
          {s.all}
        </a>
      }
    >
      {failed && (
        <li>
          <RowBody>
            <LoadFailed what={s.what} onRetry={retry} />
          </RowBody>
        </li>
      )}
      {!failed && notes === null && (
        <li>
          <RowBody>
            <p className="label text-ink-muted">{sectionsStrings().loading}</p>
          </RowBody>
        </li>
      )}
      {notes?.length === 0 && (
        <li>
          <RowBody>
            <p className="text-body text-ink-muted">{s.empty}</p>
          </RowBody>
        </li>
      )}
      {notes?.map((n) => (
        <li key={n.path}>
          <a
            href={vaultPath(n.path)}
            className="row-key flex min-h-[52px] items-center gap-3 px-4 py-2.5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink"
            data-testid="project-note"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-body font-medium text-ink">{n.title}</span>
              <span className="block truncate font-mono text-micro tracking-[0.04em] text-ink-muted">
                {n.path.slice(area.length + 1)}
              </span>
            </span>
            {Number.isFinite(Date.parse(n.updated)) && (
              <span className="label shrink-0 text-ink-muted">
                {formatAgo(Date.parse(n.updated))}
              </span>
            )}
          </a>
        </li>
      ))}
      {found?.cut && (
        <li>
          <RowBody>
            <p className="text-footnote text-ink-muted" data-testid="project-notes-capped">
              {s.capped(found.notes.length)}
            </p>
          </RowBody>
        </li>
      )}
    </Group>
  );
}

/* --------------------------------------------------------------- Folder */

type FolderChoice = 'existing' | 'new';

export function ProjectFolder({
  p,
  onChanged,
}: {
  p: ProjectView;
  onChanged: (p: ProjectView) => void;
}) {
  const id = domId(useId());
  const s = sectionsStrings().folder;
  // Without a folder it says so and offers "Choose a folder": the form is one tap away, not open.
  const [editing, setEditing] = useState(false);
  const [path, setPath] = useState(p.folder ?? '');
  const [choice, setChoice] = useState<FolderChoice>('existing');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canPick = useCanPickFolder();

  const copy = async () => {
    if (!p.folder) return;
    try {
      await navigator.clipboard.writeText(p.folder);
      notify(s.copied, 'success');
    } catch {
      notify(s.copyFailed, 'error');
    }
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const t = path.trim();
    if (!looksAbsolute(t)) return setError(s.relative);
    setBusy(true);
    setError(null);
    try {
      onChanged(
        await getApi().updateProject(p.id, { folder: { path: t, create: choice === 'new' } }),
      );
      notify(s.saved, 'success');
      setEditing(false);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  // The instructions file changed since it was approved (D-103): the runs start cautious.
  const approve = async () => {
    setBusy(true);
    try {
      onChanged(await getApi().approveProjectDocs(p.id));
      notify(s.approved, 'success');
    } catch (err) {
      notify(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      onChanged(await getApi().updateProject(p.id, { folder: null }));
      notify(s.removed);
      setPath('');
      setEditing(false);
    } catch (err) {
      notify(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group
      title={s.title}
      testId="project-folder"
      description={s.description}
      footer={<Details>{s.details}</Details>}
    >
      {p.folder && (
        <Row
          label={s.path}
          description={
            <span
              className="screen mt-1.5 block rounded-[8px] px-3 py-2 font-mono text-caption leading-[1.5] break-all text-screen-ink"
              data-testid="project-folder-path"
            >
              {p.folder}
            </span>
          }
        >
          <Button
            variant="ghost"
            size="iconSm"
            aria-label={s.copyLabel}
            title={s.copyTitle}
            onClick={() => void copy()}
          >
            <Copy size={18} aria-hidden />
          </Button>
        </Row>
      )}
      {p.folder && !p.folderExists && !(p.status === 'draft' && p.plan?.createFolder) && (
        <RowBody>
          <Status testId="project-folder-missing">{s.missing}</Status>
        </RowBody>
      )}
      {p.folderDocs?.changed && (
        <Row
          label={s.docsChanged}
          description={
            <>
              {s.docsChangedLead}{' '}
              {p.folderDocs.files.map((f, i) => (
                <span key={f}>
                  {i > 0 && s.filesJoin}
                  <span className="font-mono text-micro text-ink">{f}</span>
                </span>
              ))}{' '}
              {s.docsChangedRest}
            </>
          }
          testId="project-folder-docs-changed"
        >
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void approve()}
            data-testid="project-folder-docs-approve"
          >
            {s.approve}
          </Button>
        </Row>
      )}
      {p.folder && <ProjectDocsDrafts project={p.id} />}
      {!p.folder && !editing && <Row label={s.none} description={s.noneText} />}
      {editing ? (
        <form onSubmit={(e) => void save(e)} noValidate>
          <RowBody className="sm:max-w-[560px]">
            <Segmented<FolderChoice>
              value={choice}
              onChange={setChoice}
              label={s.which}
              size="sm"
              options={[
                { value: 'existing', label: s.existing },
                { value: 'new', label: s.new },
              ]}
            />
            <FormField
              id={id}
              label={s.fullPath}
              hint={choice === 'new' ? s.newHint(canPick) : s.existingHint}
              error={error}
            >
              <div className="flex gap-2">
                <Input
                  id={id}
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder={s.placeholder}
                  spellCheck={false}
                  autoCapitalize="off"
                  aria-invalid={error ? true : undefined}
                  data-testid="project-folder-input"
                />
                {canPick && (
                  <FolderPickButton
                    testId="project-folder-pick"
                    onPicked={(picked) =>
                      setPath(choice === 'new' ? newFolderIn(picked, p.name) : picked)
                    }
                  />
                )}
              </div>
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={busy || !path.trim()}>
                {s.save}
              </Button>
              {p.folder && (
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  {s.cancel}
                </Button>
              )}
            </div>
          </RowBody>
        </form>
      ) : (
        <RowBody>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              {p.folder ? s.change : s.choose}
            </Button>
            {p.folder && (
              <Button variant="dangerSoft" size="sm" disabled={busy} onClick={() => void remove()}>
                {s.take}
              </Button>
            )}
          </div>
        </RowBody>
      )}
    </Group>
  );
}

/* ---------------------------------------------------------------- Apps */

/** The name of an app of the gallery (`MCP_CATALOG`), as Impostazioni → Collegamenti says it. */
function serviceName(id: string): string {
  return MCP_CATALOG.find((e) => e.id === id)?.name ?? id;
}

export function ProjectLinks({
  p,
  onChanged,
}: {
  p: ProjectView;
  onChanged: (p: ProjectView) => void;
}) {
  const s = sectionsStrings().links;
  const agents = useAgents();
  const [mcp, setMcp] = useState<McpServersResponse | null>(null);
  const [claude, setClaude] = useState<ClaudeConnectionsResponse | null>(null);
  /** The monsters' own web permission; a failed read just hides the list of who cannot search. */
  const [perms, setPerms] = useState<PermissionsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  /** A read failed (W-35): the list is not complete, the section says so and offers a retry. */
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let alive = true;
    const api = getApi();
    const lost = () => {
      if (alive) setFailed(true);
    };
    api
      .mcpServers()
      .then((r) => alive && setMcp(r))
      .catch(lost);
    api
      .claudeConnections()
      .then((r) => alive && setClaude(r))
      .catch(lost);
    api
      .permissions()
      .then((r) => alive && setPerms(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [attempt]);
  const retry = () => {
    setFailed(false);
    setAttempt((n) => n + 1);
  };
  const members = new Set(p.members.map((m) => m.id));
  const nameOf = (id: string) => agents.find((a) => a.id === id)?.name ?? id;

  const update = async (change: Parameters<ReturnType<typeof getApi>['updateProject']>[1]) => {
    setBusy(true);
    try {
      onChanged(await getApi().updateProject(p.id, change));
    } catch (err) {
      notify(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  // The project keeps what the user turned off (D-164): everything else of the team reaches it.
  const toggle = (kind: 'mcp' | 'claude', name: string, on: boolean) => {
    const off = p.connectionsOff[kind];
    const next = on ? off.filter((x) => x !== name) : [...new Set([...off, name])];
    void update({ connectionsOff: { [kind]: next } });
  };

  const team = (mcp?.servers ?? []).filter((sv) => sv.agents.includes('*'));
  const own = (mcp?.servers ?? []).filter(
    (sv) => !sv.agents.includes('*') && sv.agents.some((a) => members.has(a)),
  );
  const services = (claude?.connections ?? []).filter((c) => c.added && c.agents.includes('*'));

  // Who cannot search the web now, and why: the project's switch, the monster's own permission, or both.
  const webOwn = new Map(perms?.agents.map((a) => [a.id, a.permissions.web]) ?? []);
  const cannot = perms
    ? p.members
        .map((m) => ({ id: m.id, projectOff: !p.webSearch, ownOff: webOwn.get(m.id) === false }))
        .filter((m) => m.projectOff || m.ownOff)
    : [];
  // "Allow" makes that monster able to search: what is off for it is turned on, nothing else.
  const allow = async (m: (typeof cannot)[number]) => {
    setBusy(true);
    try {
      if (m.projectOff) onChanged(await getApi().updateProject(p.id, { webSearch: true }));
      if (m.ownOff) {
        const own = perms?.agents.find((a) => a.id === m.id)?.permissions;
        if (own)
          setPerms(
            await getApi().setPermissions({
              agents: {
                [m.id]: {
                  vault: own.vault,
                  web: true,
                  shell: own.shell ?? false,
                  folders: own.folders ?? [],
                },
              },
            }),
          );
      }
      notify(s.blocked.allowed(nameOf(m.id)), 'success');
    } catch (err) {
      notify(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Group
        title={s.webTitle}
        testId="project-web"
        footer={
          <>
            {s.webFooter}{' '}
            <a
              href={settingsPath('permessi')}
              className="font-medium text-signal-ink hover:underline"
            >
              {s.webFooterLink}
            </a>
            .
          </>
        }
      >
        <Row label={s.webLabel} description={s.webDescription}>
          <Switch
            checked={p.webSearch}
            disabled={busy}
            onCheckedChange={(v) => void update({ webSearch: v })}
            label={s.webSwitch}
          />
        </Row>
        {perms && cannot.length === 0 && (
          <RowBody>
            <Status ok testId="project-web-all-ok">
              {s.blocked.allOk}
            </Status>
          </RowBody>
        )}
      </Group>

      {cannot.length > 0 && (
        <Group
          title={s.blocked.title(cannot.length)}
          as="ul"
          testId="project-web-blocked"
          description={s.blocked.description}
        >
          {cannot.map((m) => (
            <Row
              key={m.id}
              as="li"
              testId="project-web-blocked-monster"
              leading={
                <AgentMark
                  id={m.id}
                  color={perms?.agents.find((a) => a.id === m.id)?.color ?? 'var(--ink-muted)'}
                  width={40}
                  height={34}
                />
              }
              label={nameOf(m.id)}
              description={
                m.projectOff && m.ownOff
                  ? s.blocked.both
                  : m.projectOff
                    ? s.blocked.project
                    : s.blocked.own
              }
            >
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                aria-label={s.blocked.allowLabel(nameOf(m.id))}
                onClick={() => void allow(m)}
                data-testid="project-web-allow"
              >
                {s.blocked.allow}
              </Button>
            </Row>
          ))}
        </Group>
      )}

      <Group
        title={s.title}
        as="ul"
        testId="project-links"
        description={s.description}
        footer={
          <div className="grid gap-1.5">
            <Details>{s.details}</Details>
            <a
              href={settingsPath('collegamenti')}
              className="font-medium text-signal-ink hover:underline"
            >
              {s.more}
            </a>
          </div>
        }
      >
        {failed && (
          <li>
            <RowBody>
              <LoadFailed what={s.what} onRetry={retry} testId="project-links-error" />
            </RowBody>
          </li>
        )}
        {!failed && mcp === null && claude === null && (
          <li>
            <RowBody>
              <p className="label text-ink-muted">{sectionsStrings().loading}</p>
            </RowBody>
          </li>
        )}
        {!failed && mcp !== null && team.length + own.length + services.length === 0 && (
          <li>
            <RowBody>
              <p className="text-body text-ink-muted">{s.none}</p>
            </RowBody>
          </li>
        )}
        {team.map((sv) => (
          <Row
            key={sv.name}
            as="li"
            testId="project-link"
            label={sv.label}
            description={sv.enabled ? s.team : s.off}
          >
            <Switch
              checked={!p.connectionsOff.mcp.includes(sv.name)}
              disabled={busy}
              onCheckedChange={(v) => toggle('mcp', sv.name, v)}
              label={s.switch(sv.label)}
            />
          </Row>
        ))}
        {services.map((c) => (
          <Row
            key={c.id}
            as="li"
            testId="project-link"
            label={serviceName(c.id)}
            description={s.viaClaude}
          >
            <Switch
              checked={!p.connectionsOff.claude.includes(c.id)}
              disabled={busy}
              onCheckedChange={(v) => toggle('claude', c.id, v)}
              label={s.switch(serviceName(c.id))}
            />
          </Row>
        ))}
        {own.map((sv) => (
          <Row
            key={sv.name}
            as="li"
            label={sv.label}
            description={s.only(formatList(sv.agents.filter((a) => members.has(a)).map(nameOf)))}
          />
        ))}
      </Group>
    </>
  );
}

/* ---------------------------------------------------------- Automations */

export function ProjectAutomations({ p }: { p: ProjectView }) {
  const s = sectionsStrings().automations;
  const tick = useAutomationTick();
  const list = useLoaded(() => getApi().automations(), tick);
  const mine = list.data?.filter((a) => a.project === p.id) ?? null;
  const create = () => openPage(automationPath(null, { mode: 'nuova', project: p.id }));
  return (
    <div className="grid gap-4" data-testid="project-automations">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={create} data-testid="project-automation-new">
          <Plus size={16} aria-hidden /> {s.new}
        </Button>
        <a
          href={automationPath()}
          className="inline-flex h-10 items-center gap-1.5 px-2 text-body font-medium text-signal-ink hover:underline"
        >
          {s.all} <ArrowRight size={15} weight="bold" aria-hidden />
        </a>
      </div>
      {mine && mine.length === 0 ? (
        <p className="px-1 text-body text-ink-muted" data-testid="project-automations-empty">
          {s.empty}
        </p>
      ) : (
        <AutomationList
          list={mine}
          error={list.error}
          onRetry={list.retry}
          onChanged={(a) => list.set((list.data ?? []).map((x) => (x.id === a.id ? a : x)))}
        />
      )}
    </div>
  );
}

/* --------------------------------------------------------------- Spend */

export function ProjectSpend({
  p,
  onChanged,
}: {
  p: ProjectView;
  onChanged: (p: ProjectView) => void;
}) {
  const s = sectionsStrings().spend;
  const [view, setView] = useState<ProjectSpendView | null>(null);
  const [team, setTeam] = useState<SpendView | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
  const retryRead = () => {
    setFailed(false);
    setRound((r) => r + 1);
  };
  useEffect(() => {
    let alive = true;
    const api = getApi();
    api
      .projectSpend(p.id)
      .then((v) => alive && (setView(v), setFailed(false)))
      .catch(() => alive && setFailed(true));
    api
      .spend()
      .then((v) => alive && setTeam(v))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [p.id, round]);

  if (failed) return <LoadFailed what={s.what} onRetry={retryRead} />;
  if (!view) return <p className="label px-1 text-ink-muted">{sectionsStrings().loading}</p>;

  const saveProject = async (caps: { dailyEur: number | null; monthlyEur: number | null }) => {
    onChanged(await getApi().updateProject(p.id, { spend: caps }));
    notify(s.projectSaved, 'success');
    setRound((r) => r + 1);
  };
  const saveAgent = async (
    id: string,
    name: string,
    caps: { dailyEur: number | null; monthlyEur: number | null },
  ) => {
    await getApi().setSpend({ agents: { [id]: caps } });
    notify(s.agentSaved(name), 'success');
    setRound((r) => r + 1);
  };
  const teamCaps = team
    ? [
        team.day.capEur !== null ? s.perDay(formatEur(team.day.capEur)) : null,
        team.month.capEur !== null ? s.perMonth(formatEur(team.month.capEur)) : null,
      ].filter(Boolean)
    : [];
  const agentCaps = new Map(team?.agents.map((a) => [a.id, a.caps]) ?? []);
  // The meters of a monster in the project view have no cap of their own: the chain takes it
  // from the team's list of caps (the cap in euro, the spent already counted).
  const capOf = (id: string, key: 'dailyEur' | 'monthlyEur', m: { spentEur: number }) => {
    const capEur = agentCaps.get(id)?.[key] ?? null;
    return { capEur, ratio: capEur ? m.spentEur / capEur : null };
  };
  const unpriced = unpricedNotice(
    view.agents.flatMap((a) => a.unpriced ?? []),
    s.subject,
  );
  const estimated = estimatedNotice(
    view.agents.flatMap((a) => a.estimated ?? []),
    s.subject,
  );

  return (
    <>
      <Group
        title={s.title}
        testId="project-spend"
        description={s.description}
        footer={
          <span data-testid="project-spend-team">
            {teamCaps.length > 0 ? s.teamCap(teamCaps.join(', ')) : s.noTeamCap}
            <a href={SPEND_CAP_PATH} className="font-medium text-signal-ink hover:underline">
              {s.teamLink}
            </a>
          </span>
        }
      >
        <CapChain
          testId="project-spend-chain"
          links={[
            {
              id: 'monster',
              label: s.monster,
              ...chainOf(
                closestOf(
                  view.agents.map((a) => ({
                    name: a.name,
                    day: { ...a.day, ...capOf(a.id, 'dailyEur', a.day) },
                    month: { ...a.month, ...capOf(a.id, 'monthlyEur', a.month) },
                  })),
                ),
              ),
            },
            { id: 'project', label: s.project, ...chainOf(closestMeter(view.day, view.month)) },
            {
              id: 'team',
              label: s.team,
              ...chainOf(team ? closestMeter(team.day, team.month) : null),
            },
          ]}
        />
        {unpriced && (
          <RowBody>
            <Status testId="project-spend-unpriced">{unpriced}</Status>
          </RowBody>
        )}
        {estimated && (
          <RowBody>
            <Status testId="project-spend-estimated">{estimated}</Status>
          </RowBody>
        )}
        {view.status !== 'ok' && (
          <RowBody>
            <Status testId="project-spend-status">
              {view.status === 'stopped' ? s.stopped : s.warning}
            </Status>
          </RowBody>
        )}
        <Row label={s.today} description={noCapNote(view.day)} testId="project-spend-day">
          <SpendDisplay meter={view.day} />
        </Row>
        <Row label={s.month} description={noCapNote(view.month)}>
          <SpendDisplay meter={view.month} />
        </Row>
        <RowBody>
          <CapsForm
            testId="project-caps"
            daily={view.caps.dailyEur ?? null}
            monthly={view.caps.monthlyEur ?? null}
            emptyHint={s.emptyHint}
            onSave={saveProject}
          />
        </RowBody>
      </Group>

      {view.agents.length > 0 && (
        <Group
          title={s.perMonster}
          as="ul"
          testId="project-spend-agents"
          description={s.perMonsterDescription}
        >
          {view.agents.map((a) => (
            <li key={a.id} data-testid={`project-spend-agent-${a.id}`}>
              <Row
                leading={<AgentMark id={a.id} color="var(--ink-muted)" width={40} height={34} />}
                label={a.name}
                description={s.agentLine(
                  formatEur(a.day.spentEur),
                  formatEur(a.month.spentEur),
                  a.paid,
                )}
              />
              {a.paid && (
                <RowBody>
                  <CapsForm
                    testId={`project-caps-${a.id}`}
                    daily={agentCaps.get(a.id)?.dailyEur ?? null}
                    monthly={agentCaps.get(a.id)?.monthlyEur ?? null}
                    emptyHint={s.agentEmptyHint}
                    onSave={(caps) => saveAgent(a.id, a.name, caps)}
                  />
                </RowBody>
              )}
            </li>
          ))}
        </Group>
      )}
    </>
  );
}
