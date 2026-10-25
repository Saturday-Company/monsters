import { SETTINGS_SECTIONS } from '@monsters/shared';
import { Globe, Notebook, TerminalWindow, Warning, type Icon } from '@phosphor-icons/react';
import type {
  AgentPermissions,
  AgentPermissionsView,
  FolderGrant,
  PermissionsResponse,
  ProjectView,
} from '@monsters/shared';
import { useEffect, useMemo, useState } from 'react';
import { squadsOf } from '../../lib/projects.ts';
import { projectPath } from '../../lib/router.ts';
import { errorText, getApi, notify } from '../../store/app.ts';
import { useAgents } from '../../store/hooks.ts';
import { useProjects } from '../../store/projects.ts';
import { Button } from '../ui/button.tsx';
import { Switch } from '../ui/controls.tsx';
import { FolderGrants } from './FolderGrants.tsx';
import {
  AgentMark,
  ConfirmButton,
  DisclosureRow,
  Group,
  LoadFailed,
  Row,
  RowBody,
  selectClass,
  useRetry,
} from './parts.tsx';
import {
  full,
  presetOf,
  PRESETS,
  withPreset,
  type Full,
  type Preset,
} from './permission-presets.ts';
import { permissionsStrings } from './permissions.strings.ts';

/*
 * Settings → what each monster may do (M2.1, C7): one choice per monster, "Notes only / Notes and
 * web / Also runs commands", with "Apply to all" on top; behind each row, "Fine-tune" has the
 * switches one by one (notes, web, commands) and the folders of the computer. Every change is
 * saved at once; a permission removed holds from the next tool call, a permission granted from the
 * next job. Where a project switches the web off, the row says so, with a link to the project.
 */

/** "Notes, web, commands, 2 folders" */
export function permissionsSummary(p: AgentPermissions): string {
  const f = full(p);
  const s = permissionsStrings().summary;
  const parts = [
    f.vault ? s.notes : s.notesReadOnly,
    ...(f.web ? [s.web] : []),
    ...(f.shell ? [s.commands] : []),
    ...(f.folders.length > 0 ? [s.folders(f.folders.length)] : []),
  ];
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function PresetSelect({
  value,
  onChange,
  label,
  disabled,
  placeholder,
}: {
  value: Preset | null;
  onChange: (next: Preset) => void;
  label: string;
  disabled?: boolean;
  /** Without a value (the "apply to all" one): a first option that says to choose. */
  placeholder?: string;
}) {
  const s = permissionsStrings().preset;
  return (
    <select
      aria-label={label}
      className={selectClass}
      value={value ?? (placeholder !== undefined ? '' : 'custom')}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as Preset)}
    >
      {placeholder !== undefined && (
        <option value="" disabled>
          {placeholder}
        </option>
      )}
      {placeholder === undefined && value === null && (
        <option value="custom" disabled>
          {s.custom}
        </option>
      )}
      {PRESETS.map((p) => (
        <option key={p} value={p}>
          {s[p]}
        </option>
      ))}
    </select>
  );
}

function ToggleRow({
  icon: IconCmp,
  title,
  text,
  checked,
  onChange,
  disabled,
}: {
  icon: Icon;
  title: string;
  text: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled: boolean;
}) {
  return (
    <Row
      label={title}
      description={text}
      leading={<IconCmp size={20} aria-hidden className="text-ink-muted" />}
    >
      <Switch
        words
        checked={checked}
        onCheckedChange={onChange}
        label={title}
        disabled={disabled}
      />
    </Row>
  );
}

/** One monster on the first layer: its level, and where a project switches the web off. */
function AgentRow({
  agent,
  noWebIn,
  onSave,
}: {
  agent: AgentPermissionsView;
  /** The project this monster belongs to when that project switches the web off. */
  noWebIn: ProjectView | null;
  onSave: (id: string, next: Full) => Promise<void>;
}) {
  const s = permissionsStrings();
  const [saving, setSaving] = useState(false);
  const p = full(agent.permissions);
  const choose = async (preset: Preset) => {
    setSaving(true);
    try {
      await onSave(agent.id, withPreset(p, preset));
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Row
      as="li"
      testId={`agent-permissions-${agent.id}`}
      leading={<AgentMark id={agent.id} color={agent.color} />}
      label={<AgentName agent={agent} />}
      description={
        <>
          <span data-testid="permissions-summary">{permissionsSummary(p)}</span>
          {p.web && noWebIn && (
            <a
              href={projectPath(noWebIn.id, 'collegamenti')}
              className="mt-0.5 block font-medium text-ink underline underline-offset-2"
              data-testid="permissions-web-override"
            >
              {s.webOffIn(noWebIn.name)}
            </a>
          )}
        </>
      }
      wrap
    >
      <PresetSelect
        value={presetOf(p)}
        label={s.preset.label(agent.name)}
        disabled={saving}
        onChange={(preset) => void choose(preset)}
      />
    </Row>
  );
}

function AgentName({ agent }: { agent: AgentPermissionsView }) {
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-large font-semibold">{agent.name}</span>
      {agent.isOrchestrator && (
        <span className="label text-signal-ink">{permissionsStrings().lead}</span>
      )}
    </span>
  );
}

/** One monster behind "Switches and folders": the three switches one by one, and its folders. */
function AgentDetail({
  agent,
  home,
  windows,
  onSave,
}: {
  agent: AgentPermissionsView;
  home: string;
  windows: boolean;
  onSave: (id: string, next: Full) => Promise<void>;
}) {
  const s = permissionsStrings();
  const [saving, setSaving] = useState(false);
  const p = full(agent.permissions);

  const save = async (next: Full) => {
    setSaving(true);
    try {
      await onSave(agent.id, next);
    } finally {
      setSaving(false);
    }
  };
  const toggle = (key: 'vault' | 'web' | 'shell') => (v: boolean) => {
    void save({ ...p, [key]: v }).catch((err: unknown) => notify(errorText(err), 'error'));
  };

  return (
    <DisclosureRow
      testId={`agent-permissions-fine-${agent.id}`}
      leading={<AgentMark id={agent.id} color={agent.color} />}
      label={<AgentName agent={agent} />}
      description={permissionsSummary(p)}
    >
      <div className="set-rows pl-6">
        <ToggleRow
          icon={Notebook}
          title={s.vault.title}
          text={s.vault.text}
          checked={p.vault}
          onChange={toggle('vault')}
          disabled={saving}
        />
        <ToggleRow
          icon={Globe}
          title={SETTINGS_SECTIONS.ilWeb.label}
          text={s.web.text}
          checked={p.web}
          onChange={toggle('web')}
          disabled={saving}
        />
        <div>
          <ToggleRow
            icon={TerminalWindow}
            title={SETTINGS_SECTIONS.terminale.label}
            text={windows ? s.commands.onWindows(s.commands.text) : s.commands.text}
            checked={p.shell}
            onChange={toggle('shell')}
            disabled={saving}
          />
          {p.shell && (
            <p
              className="mx-4 mb-3 flex gap-2 rounded-[10px] bg-stop-soft px-3 py-2.5 text-footnote leading-snug text-stop-ink"
              data-testid="shell-warning"
            >
              <Warning size={18} aria-hidden className="mt-px shrink-0" />
              <span>{s.commands.warning(agent.name)}</span>
            </p>
          )}
        </div>
        <RowBody>
          <FolderGrants
            folders={p.folders}
            label={s.folders.label}
            placeholder={s.folders.example(home, windows ? '\\' : '/')}
            home={home}
            disabled={saving}
            onChange={(folders: FolderGrant[]) => save({ ...p, folders })}
          />
        </RowBody>
      </div>
    </DisclosureRow>
  );
}

/** "The same for everyone": one level for every monster. Giving commands to all asks first. */
function ApplyToAll({
  data,
  onApply,
}: {
  data: PermissionsResponse;
  onApply: (preset: Preset) => Promise<void>;
}) {
  const s = permissionsStrings();
  const [preset, setPreset] = useState<Preset | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async () => {
    if (!preset) return;
    setBusy(true);
    try {
      await onApply(preset);
      setPreset(null);
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const gives = preset === 'commands' && data.agents.some((a) => !full(a.permissions).shell);
  return (
    <Row as="li" testId="permissions-all" label={s.all.label} description={s.all.text} wrap>
      <PresetSelect
        value={preset}
        label={s.all.selectLabel}
        placeholder={s.all.choose}
        disabled={busy}
        onChange={setPreset}
      />
      {gives ? (
        <ConfirmButton
          label={s.all.apply}
          question={s.all.askCommands}
          confirm={s.all.confirm}
          busy={busy}
          onConfirm={() => void run()}
        />
      ) : (
        <Button variant="secondary" size="sm" disabled={busy || !preset} onClick={() => void run()}>
          {s.all.apply}
        </Button>
      )}
    </Row>
  );
}

export function AgentPermissionsSettings() {
  const s = permissionsStrings();
  const [data, setData] = useState<PermissionsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const team = useAgents();
  const projects = useProjects();
  // The monsters by squad, as the sidebar lists them (U-12): the boss, the personal squad, projects.
  const groups = useMemo(() => {
    if (!data) return [];
    const byId = new Map(data.agents.map((a) => [a.id, a]));
    const { god, squads } = squadsOf(team, projects);
    const out: { key: string; label: string; items: AgentPermissionsView[] }[] = [];
    const pick = (ids: readonly string[]) =>
      ids.map((id) => byId.get(id)).filter((a): a is AgentPermissionsView => !!a);
    if (god && byId.has(god.id))
      out.push({ key: '_boss', label: s.leadGroup, items: pick([god.id]) });
    for (const sq of squads) {
      const items = pick(sq.members.map((m) => m.id));
      if (items.length > 0) out.push({ key: sq.key, label: sq.label, items });
    }
    // Any monster the team list does not know yet still shows, at the end.
    const seen = new Set(out.flatMap((g) => g.items.map((a) => a.id)));
    const rest = data.agents.filter((a) => !seen.has(a.id));
    if (rest.length > 0) out.push({ key: '_rest', label: s.others, items: rest });
    return out;
  }, [data, team, projects, s]);

  /** Monsters of a project that switches the web off: the web permission does not reach them there. */
  const noWebIn = useMemo(() => {
    const out = new Map<string, ProjectView>();
    for (const a of team) {
      const project = a.project ? projects?.find((p) => p.id === a.project) : undefined;
      if (project && !project.webSearch) out.set(a.id, project);
    }
    return out;
  }, [team, projects]);

  const [attempt, retry] = useRetry(() => setFailed(false));
  useEffect(() => {
    let alive = true;
    getApi()
      .permissions()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [attempt]);

  const onSave = async (id: string, next: Full) => {
    const name = data?.agents.find((a) => a.id === id)?.name ?? id;
    const updated = await getApi().setPermissions({ agents: { [id]: next } });
    setData(updated);
    notify(s.saved(name), 'success');
  };

  const onApplyAll = async (preset: Preset) => {
    if (!data) return;
    const agents = Object.fromEntries(
      data.agents.map((a) => [a.id, withPreset(a.permissions, preset)]),
    );
    setData(await getApi().setPermissions({ agents }));
    notify(s.all.done, 'success');
  };

  return (
    <div data-testid="permissions-settings">
      <Group title={s.title} description={s.description} footer={s.footer} as="ul">
        {failed && (
          <li className="list-none px-4 py-3">
            <LoadFailed what={s.what} onRetry={retry} />
          </li>
        )}
        {data && data.agents.length > 1 && <ApplyToAll data={data} onApply={onApplyAll} />}
        {data &&
          groups.map((g) => (
            <li key={g.key} className="list-none" data-testid={`permissions-squad-${g.key}`}>
              <p className="label px-4 pt-3 pb-1 text-ink-muted">{g.label}</p>
              <ul className="set-rows">
                {g.items.map((a) => (
                  <AgentRow
                    key={a.id}
                    agent={a}
                    noWebIn={noWebIn.get(a.id) ?? null}
                    onSave={onSave}
                  />
                ))}
              </ul>
            </li>
          ))}
        {data && (
          <DisclosureRow
            advanced
            testId="permissions-fine"
            label={s.fine.label}
            description={s.fine.text}
          >
            <ul className="set-rows">
              {groups.flatMap((g) =>
                g.items.map((a) => (
                  <AgentDetail
                    key={a.id}
                    agent={a}
                    home={data.home}
                    windows={data.platform === 'win32'}
                    onSave={onSave}
                  />
                )),
              )}
            </ul>
          </DisclosureRow>
        )}
      </Group>
    </div>
  );
}
