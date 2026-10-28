import type { ProjectView, TeamMemberView } from '@monsters/shared';
import { ChatCircle, Copy, Plus } from '@phosphor-icons/react';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { describeError } from '../../lib/api.ts';
import { freeCopyName, isLive } from '../../lib/projects.ts';
import { projectsLibStrings } from '../../lib/projects.strings.ts';
import { openChat } from '../../lib/router.ts';
import { domId } from '../../lib/utils.ts';
import { getApi, notify, refreshAgents } from '../../store/app.ts';
import { useDraftHandoff } from '../../store/draft-handoff.ts';
import { statusText, useAgents, useLive, type AgentView } from '../../store/hooks.ts';
import { refreshProjects, useProjects } from '../../store/projects.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { nameProblem } from '../settings/data.ts';
import { ConfirmButton, FormField, Group, Row, RowBody } from '../settings/parts.tsx';
import { AddMonster, MemberRow } from '../settings/TeamMembers.tsx';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/field.tsx';
import { squadStrings } from './squad.strings.ts';
import { SquadChart } from './SquadChart.tsx';

/*
 * Squadra of a project (D-100): who is in it (the lead first, "LEAD"), each
 * a row as in Impostazioni → Squadra (name, look, role and duties), with its
 * chat and "Remove" (archived, never deleted; the lead stays); a copy
 * of a monster of another squad, with the free name the core will give it
 * ("Rhea · Saturday", editable); a new monster through the same flow as
 * Impostazioni → Squadra, its colour kept away from this squad's; and at the
 * foot a note on where "Archive the project" went (Settings).
 */

/** A member before its fields are read: the name, the chat and "Remove". */
function PlainMember({
  agent,
  remove,
  busy,
}: {
  agent: AgentView;
  remove: () => void;
  busy: boolean;
}) {
  const live = useLive(agent.id);
  const s = squadStrings();
  return (
    <Row
      as="li"
      testId="project-member"
      leading={
        <MonsterScreen
          genome={agent.genome}
          mood={live.mood}
          confused={live.confused}
          width={52}
          height={46}
        />
      }
      label={
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-large font-semibold">{agent.name}</span>
          {agent.isLead && <span className="label shrink-0 text-signal-ink">{s.lead}</span>}
        </span>
      }
      description={
        <>
          {agent.isLead ? s.leadDuty : agent.role}
          <span className="sr-only">, {statusText(live)}</span>
        </>
      }
      wrap
    >
      <Button
        variant="secondary"
        size="sm"
        onClick={() => openChat(agent.id)}
        aria-label={s.messageLabel(agent.name)}
      >
        <ChatCircle size={16} aria-hidden /> {s.message}
      </Button>
      {!agent.isLead && (
        <ConfirmButton
          label={s.remove}
          question={s.removeQuestion(agent.name)}
          confirm={s.removeConfirm}
          busy={busy}
          onConfirm={remove}
        />
      )}
    </Row>
  );
}

/**
 * A monster of the project: the same row as in Impostazioni → Squadra (name,
 * look, role and duties), plus its chat; "Remove" leaves the project, the lead stays.
 */
function Member({
  agent,
  p,
  taken,
  onChanged,
}: {
  agent: AgentView;
  p: ProjectView;
  taken: (name: string, self?: string) => boolean;
  onChanged: (p: ProjectView) => void;
}) {
  const [view, setView] = useState<TeamMemberView | null>(null);
  const [busy, setBusy] = useState(false);
  // Read again when the monster changes (renamed, a new role): the agents list follows `team_change`.
  const stamp = `${agent.name}|${agent.role}|${p.updatedAt}`;
  useEffect(() => {
    let alive = true;
    getApi()
      .teamMember(agent.id)
      .then((v) => alive && setView(v))
      .catch(() => alive && setView(null));
    return () => {
      alive = false;
    };
  }, [agent.id, stamp]);

  /** After a change: this project and the agents list (sidebar, chats) read again. */
  const changed = () => {
    void getApi()
      .project(p.id)
      .then(onChanged)
      .catch(() => {});
    void refreshProjects();
    void refreshAgents().catch(() => {});
  };
  const run = async () => {
    onChanged(await getApi().removeProjectMember(p.id, agent.id));
    notify(squadStrings().archived(agent.name));
    void refreshAgents().catch(() => {});
  };
  const remove = async () => {
    setBusy(true);
    try {
      await run();
    } catch (err) {
      notify(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!view) return <PlainMember agent={agent} remove={() => void remove()} busy={busy} />;
  return (
    <MemberRow
      member={view}
      taken={taken}
      onChanged={changed}
      testId="project-member"
      chat
      live
      removal={{
        description: squadStrings().removalDescription,
        run,
      }}
    />
  );
}

/** Where a monster to copy comes from, in words. */
function squadOf(a: AgentView, projects: readonly ProjectView[] | null): string {
  if (!a.project) return projectsLibStrings().personalSquad;
  return projects?.find((p) => p.id === a.project)?.name ?? a.project;
}

/** One monster of another squad: "Copy" opens its name, as the core would give it. */
function CopyRow({
  source,
  p,
  taken,
  from,
  onCopied,
}: {
  source: AgentView;
  p: ProjectView;
  taken: readonly string[];
  from: string;
  onCopied: (p: ProjectView) => void;
}) {
  const id = domId(useId());
  const s = squadStrings();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = () => {
    setName(freeCopyName(taken) ?? '');
    setError(null);
    setOpen(true);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.replace(/\s+/g, ' ').trim();
    const problem =
      nameProblem(n) ??
      (taken.some((t) => t.toLowerCase() === n.toLowerCase()) ? s.nameTaken : null);
    if (problem) return setError(problem);
    setBusy(true);
    try {
      onCopied(await getApi().addProjectMember(p.id, { copyOf: source.id, name: n }));
      notify(s.copied(n, source.name), 'success');
      void refreshAgents().catch(() => {});
      setOpen(false);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li data-testid="project-copy-row" data-agent={source.id}>
      <Row
        leading={
          <MonsterScreen genome={source.genome} mood="idle" width={40} height={36} pad={2} />
        }
        label={<span className="font-semibold">{source.name}</span>}
        description={`${source.role} · ${from}`}
      >
        {!open && (
          <Button
            variant="secondary"
            size="sm"
            onClick={start}
            aria-label={s.copyLabel(source.name)}
          >
            <Copy size={16} aria-hidden /> {s.copy}
          </Button>
        )}
      </Row>
      {open && (
        <form onSubmit={(e) => void submit(e)} noValidate className="bg-panel set-seam-t">
          <RowBody className="sm:max-w-[520px]">
            <FormField id={id} label={s.copyName} hint={s.copyNameHint} error={error}>
              <Input
                id={id}
                value={name}
                maxLength={24}
                onChange={(e) => setName(e.target.value)}
                aria-invalid={error ? true : undefined}
                data-testid="project-copy-name"
              />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={busy} data-testid="project-copy-save">
                {busy ? s.copying : s.copyToProject}
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setOpen(false)}>
                {s.cancel}
              </Button>
            </div>
          </RowBody>
        </form>
      )}
    </li>
  );
}

export function ProjectSquad({
  p,
  onChanged,
}: {
  p: ProjectView;
  onChanged: (p: ProjectView) => void;
}) {
  const s = squadStrings();
  const agents = useAgents();
  const projects = useProjects();
  // "Edit" on a monster proposed by the lead (To review): the form opens with its draft.
  const [handoff, consumeHandoff] = useDraftHandoff();
  const [adding, setAdding] = useState<'new' | 'copy' | null>(handoff ? 'new' : null);

  const members = p.members
    .map((m) => agents.find((a) => a.id === m.id))
    .filter((a): a is AgentView => a !== undefined);
  const others = members.length - (p.lead ? 1 : 0);
  const full = others >= p.maxMembers;
  const names = agents.map((a) => a.name);
  // Names are unique across every squad: the core refuses the rest.
  const takenBy = (n: string, self?: string) =>
    agents.some((a) => a.id !== self && a.name.toLowerCase() === n.trim().toLowerCase());
  const sources = agents.filter(
    (a) =>
      !a.isOrchestrator &&
      a.project !== p.id &&
      (!a.project || projects?.some((x) => x.id === a.project && isLive(x))),
  );

  // The first project, or a squad with only its lead: the hierarchy in one line (U-5).
  const liveProjects = (projects ?? []).filter(isLive).length;
  const showChart = others === 0 || liveProjects <= 1;

  return (
    <>
      {showChart && <SquadChart className="px-1" />}
      <Group
        title={s.squadTitle(members.length)}
        as="ul"
        testId="project-members"
        footer={full ? s.full(p.maxMembers) : s.footer}
      >
        {members.map((a) => (
          <Member key={a.id} agent={a} p={p} taken={takenBy} onChanged={onChanged} />
        ))}
        {adding === null && (
          <li className="flex flex-wrap gap-2 px-4 py-3">
            <Button
              variant="secondary"
              size="sm"
              disabled={full || sources.length === 0}
              onClick={() => setAdding('copy')}
              data-testid="project-add-copy"
            >
              <Copy size={16} aria-hidden /> {s.copyAMonster}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={full}
              onClick={() => setAdding('new')}
              data-testid="project-add-new"
            >
              <Plus size={16} aria-hidden /> {s.newMonster}
            </Button>
          </li>
        )}
      </Group>

      {adding === 'copy' && (
        <Group
          title={s.copyAMonster}
          as="ul"
          testId="project-copy"
          description={s.copyDescription}
          footer={
            <Button variant="ghost" size="sm" onClick={() => setAdding(null)}>
              {s.close}
            </Button>
          }
        >
          {sources.map((a) => (
            <CopyRow
              key={a.id}
              source={a}
              p={p}
              taken={names}
              from={squadOf(a, projects)}
              onCopied={(next) => {
                onChanged(next);
                setAdding(null);
              }}
            />
          ))}
        </Group>
      )}

      {adding === 'new' && (
        <AddMonster
          initial={handoff}
          project={{ id: p.id, name: p.name }}
          taken={(n) => names.some((x) => x.toLowerCase() === n.trim().toLowerCase())}
          onCancel={() => {
            consumeHandoff();
            setAdding(null);
          }}
          onAdded={() => {
            consumeHandoff();
            setAdding(null);
            void refreshProjects();
            void refreshAgents().catch(() => {});
          }}
        />
      )}
    </>
  );
}
