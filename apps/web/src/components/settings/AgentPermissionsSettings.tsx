import { SETTINGS_SECTIONS } from '@monsters/shared';
import { Globe, Notebook, TerminalWindow, Warning, type Icon } from '@phosphor-icons/react';
import type {
  AgentPermissions,
  AgentPermissionsView,
  FolderGrant,
  PermissionsResponse,
} from '@monsters/shared';
import { useEffect, useMemo, useState } from 'react';
import { squadsOf } from '../../lib/projects.ts';
import { errorText, getApi, notify } from '../../store/app.ts';
import { useAgents } from '../../store/hooks.ts';
import { useProjects } from '../../store/projects.ts';
import { Switch } from '../ui/controls.tsx';
import { TERMINAL_TEXT } from '../../onboarding/PermissionsStep.tsx';
import { FolderGrants } from './FolderGrants.tsx';
import { AgentMark, DisclosureRow, Group, Row, RowBody } from './parts.tsx';

/*
 * Settings → what each monster may do (M2.1): notes, web, terminal and the
 * folders of the computer. Every change is saved at once; a permission removed
 * holds from the next tool call, a permission granted from the next job.
 */

type Full = Required<AgentPermissions>;

function full(p: AgentPermissions): Full {
  return { vault: p.vault, web: p.web, shell: p.shell ?? false, folders: p.folders ?? [] };
}

/** "Note, web, terminale, 2 cartelle" */
export function permissionsSummary(p: AgentPermissions): string {
  const f = full(p);
  const parts = [
    f.vault ? 'note' : 'note in sola lettura',
    ...(f.web ? ['web'] : []),
    ...(f.shell ? ['terminale'] : []),
    ...(f.folders.length === 1
      ? ['1 cartella']
      : f.folders.length > 1
        ? [`${f.folders.length} cartelle`]
        : []),
  ];
  const text = parts.join(', ');
  return text.charAt(0).toUpperCase() + text.slice(1);
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

function AgentRow({
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
      testId={`agent-permissions-${agent.id}`}
      leading={<AgentMark id={agent.id} color={agent.color} />}
      label={
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span className="text-large font-semibold">{agent.name}</span>
          {agent.isOrchestrator && <span className="label text-signal-ink">il tuo capo</span>}
        </span>
      }
      description={<span data-testid="permissions-summary">{permissionsSummary(p)}</span>}
    >
      <div className="set-rows pl-6">
        <ToggleRow
          icon={Notebook}
          title="Scrivere nelle note"
          text="Senza, legge le note ma non le cambia. Ogni modifica si può annullare."
          checked={p.vault}
          onChange={toggle('vault')}
          disabled={saving}
        />
        <ToggleRow
          icon={Globe}
          title={SETTINGS_SECTIONS.ilWeb.label}
          text="Cercare e leggere pagine online, in ogni suo lavoro. In un progetto serve anche la ricerca sul web del progetto (scheda Collegamenti); il browser segue questo permesso."
          checked={p.web}
          onChange={toggle('web')}
          disabled={saving}
        />
        <div>
          <ToggleRow
            icon={TerminalWindow}
            title={SETTINGS_SECTIONS.terminale.label}
            text={
              windows ? `${TERMINAL_TEXT} Su Windows i comandi sono di PowerShell.` : TERMINAL_TEXT
            }
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
              <span>
                Con il terminale {agent.name} può fare sul computer tutto quello che puoi fare tu,
                anche fuori dalle cartelle qui sotto. Ogni comando finisce in Attività e “Ferma” lo
                interrompe.
              </span>
            </p>
          )}
        </div>
        <RowBody>
          <FolderGrants
            folders={p.folders}
            label="Cartelle del computer"
            placeholder={`${home}${windows ? '\\' : '/'}Documenti`}
            home={home}
            disabled={saving}
            onChange={(folders: FolderGrant[]) => save({ ...p, folders })}
          />
        </RowBody>
      </div>
    </DisclosureRow>
  );
}

export function AgentPermissionsSettings() {
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
      out.push({ key: '_boss', label: 'Il tuo capo', items: pick([god.id]) });
    for (const sq of squads) {
      const items = pick(sq.members.map((m) => m.id));
      if (items.length > 0) out.push({ key: sq.key, label: sq.label, items });
    }
    // Any monster the team list does not know yet still shows, at the end.
    const seen = new Set(out.flatMap((g) => g.items.map((a) => a.id)));
    const rest = data.agents.filter((a) => !seen.has(a.id));
    if (rest.length > 0) out.push({ key: '_rest', label: 'Altri', items: rest });
    return out;
  }, [data, team, projects]);

  useEffect(() => {
    let alive = true;
    getApi()
      .permissions()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const onSave = async (id: string, next: Full) => {
    const name = data?.agents.find((a) => a.id === id)?.name ?? id;
    const updated = await getApi().setPermissions({ agents: { [id]: next } });
    setData(updated);
    notify(`Permessi di ${name} salvati.`, 'success');
  };

  return (
    <div data-testid="permissions-settings">
      <Group
        title="Cosa possono fare i mostri"
        description="Per ogni mostro scegli cosa può usare. Un permesso dato vale dal prossimo lavoro, uno tolto subito."
        as="ul"
      >
        {failed && <Row as="li" label="Non riesco a leggere i permessi adesso." />}
        {data &&
          groups.map((g) => (
            <li key={g.key} className="list-none" data-testid={`permissions-squad-${g.key}`}>
              <p className="label px-4 pt-3 pb-1 text-ink-muted">{g.label}</p>
              <ul className="set-rows">
                {g.items.map((a) => (
                  <AgentRow
                    key={a.id}
                    agent={a}
                    home={data.home}
                    windows={data.platform === 'win32'}
                    onSave={onSave}
                  />
                ))}
              </ul>
            </li>
          ))}
      </Group>
    </div>
  );
}
