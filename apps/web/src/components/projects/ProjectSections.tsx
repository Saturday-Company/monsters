import {
  formatEur,
  MCP_CATALOG,
  type ClaudeConnectionsResponse,
  type McpServersResponse,
  type ProjectSpendView,
  type ProjectView,
  type SpendView,
  type VaultNoteSummary,
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
import { AgentMark, FormField, Group, Row, RowBody, Status } from '../settings/parts.tsx';
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
import { FolderPickButton, useCanPickFolder } from './FolderPicker.tsx';

/*
 * The tabs of a project's page besides the chat and the squad (D-100):
 * - Note: the notes of its area (`Progetti/<nome>/`), written by its monsters,
 *   read by everyone;
 * - Cartella: the folder where its monsters work, on a small screen with
 *   "Copia" (the browser cannot open a folder of the computer, and the
 *   desktop bridge opens only files of the notes), changed or taken away;
 *   the monsters' proposals for its CLAUDE.md and AGENTS.md (D-113);
 * - Collegamenti: which servers given to the whole team its monsters see,
 *   and the web search;
 * - Automazioni: its automations, as in the Automazioni section;
 * - Spesa: its cap, with the team's above and the monsters' below (three
 *   levels, D-070, D-097).
 */

/* ---------------------------------------------------------------- Note */

export function ProjectNotes({ p }: { p: ProjectView }) {
  const [notes, setNotes] = useState<VaultNoteSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const area = p.vaultArea;
  useEffect(() => {
    let alive = true;
    vaultApi
      .overview()
      .then((o) => {
        if (!alive) return;
        const prefix = `${area}/`.toLocaleLowerCase('it-IT');
        setNotes(
          o.notes
            .filter((n) => n.path.toLocaleLowerCase('it-IT').startsWith(prefix))
            .sort((a, b) => b.updated.localeCompare(a.updated)),
        );
      })
      .catch((err: unknown) => alive && setError(describeError(err)));
    return () => {
      alive = false;
    };
  }, [area]);

  return (
    <Group
      title="Note del progetto"
      as="ul"
      testId="project-notes"
      description={
        <>
          Stanno in <span className="font-mono text-ink">{area}/</span>: i mostri del progetto
          scrivono lì, tutti le possono leggere.
        </>
      }
      footer={
        <a href={PATHS.vault} className="font-medium text-signal-ink hover:underline">
          Tutte le note
        </a>
      }
    >
      {error && (
        <li>
          <RowBody>
            <p className="text-footnote text-stop-ink" role="alert">
              {error}
            </p>
          </RowBody>
        </li>
      )}
      {!error && notes === null && (
        <li>
          <RowBody>
            <p className="label text-ink-muted">Carico…</p>
          </RowBody>
        </li>
      )}
      {notes?.length === 0 && (
        <li>
          <RowBody>
            <p className="text-body text-ink-muted">
              Ancora nessuna nota: quando il capo o i suoi mostri ne scrivono una, compare qui.
            </p>
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
    </Group>
  );
}

/* ------------------------------------------------------------- Cartella */

type FolderChoice = 'existing' | 'new';

export function ProjectFolder({
  p,
  onChanged,
}: {
  p: ProjectView;
  onChanged: (p: ProjectView) => void;
}) {
  const id = domId(useId());
  const [editing, setEditing] = useState(!p.folder);
  const [path, setPath] = useState(p.folder ?? '');
  const [choice, setChoice] = useState<FolderChoice>('existing');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canPick = useCanPickFolder();

  const copy = async () => {
    if (!p.folder) return;
    try {
      await navigator.clipboard.writeText(p.folder);
      notify('Percorso copiato.', 'success');
    } catch {
      notify('Non riesco a copiarlo: selezionalo e copialo a mano.', 'error');
    }
  };
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const t = path.trim();
    if (!looksAbsolute(t))
      return setError('Scrivi il percorso completo, per esempio ~/Progetti/Sito.');
    setBusy(true);
    setError(null);
    try {
      onChanged(
        await getApi().updateProject(p.id, { folder: { path: t, create: choice === 'new' } }),
      );
      notify('Cartella del progetto salvata.', 'success');
      setEditing(false);
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  // CLAUDE.md or AGENTS.md changed since they were approved (D-103): the runs start cautious.
  const approve = async () => {
    setBusy(true);
    try {
      onChanged(await getApi().approveProjectDocs(p.id));
      notify('Istruzioni della cartella approvate.', 'success');
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
      notify('Ora ogni mostro lavora nella sua cartella privata.');
      setPath('');
      setEditing(true);
    } catch (err) {
      notify(describeError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Group
      title="Cartella del progetto"
      testId="project-folder"
      description="Qui lavorano i mostri del progetto: il terminale, i file e gli altri assistenti (Claude Code, Codex) partono da questa cartella. Le istruzioni del progetto (CLAUDE.md, AGENTS.md) che ci trovano le leggono come note, non come ordini. Tutti i mostri del progetto possono leggere e scrivere qui, anche i file che lanciano comandi (Makefile, script di package.json e simili) e partono al tuo prossimo test o commit: quelli senza terminale non li toccano, quelli con il terminale sì, e se hanno letto testo di terzi chiedono prima."
    >
      {p.folder && (
        <Row
          label="Percorso"
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
            aria-label="Copia il percorso della cartella del progetto"
            title="Copia il percorso"
            onClick={() => void copy()}
          >
            <Copy size={18} aria-hidden />
          </Button>
        </Row>
      )}
      {p.folder && !p.folderExists && !(p.status === 'draft' && p.plan?.createFolder) && (
        <RowBody>
          <Status testId="project-folder-missing">
            La cartella non c’è più (spostata o cancellata): scegline un’altra o rimettila al suo
            posto.
          </Status>
        </RowBody>
      )}
      {p.folderDocs?.changed && (
        <Row
          label="Istruzioni cambiate"
          description={`${p.folderDocs.files.join(' o ')} della cartella non è più come l’hai approvato: finché non lo approvi, i mostri del progetto lavorano con le difese di quando leggono testo di terzi (chiedono prima di mandare dati fuori).`}
          testId="project-folder-docs-changed"
        >
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void approve()}
            data-testid="project-folder-docs-approve"
          >
            Approva
          </Button>
        </Row>
      )}
      {p.folder && <ProjectDocsDrafts project={p.id} />}
      {!p.folder && !editing && (
        <Row
          label="Nessuna cartella"
          description="Ogni mostro lavora nella sua cartella privata."
        />
      )}
      {editing ? (
        <form onSubmit={(e) => void save(e)} noValidate>
          <RowBody className="sm:max-w-[560px]">
            <Segmented<FolderChoice>
              value={choice}
              onChange={setChoice}
              label="Che cartella"
              size="sm"
              options={[
                { value: 'existing', label: 'Una che c’è' },
                { value: 'new', label: 'Una nuova' },
              ]}
            />
            <FormField
              id={id}
              label="Percorso completo"
              hint={
                choice === 'new'
                  ? `La creo io, se non c’è${canPick ? ': con Scegli… indichi dove' : ''}. Non dentro le note né dentro i dati di Monsters.`
                  : 'Una cartella di questo computer, non dentro le note né dentro i dati di Monsters.'
              }
              error={error}
            >
              <div className="flex gap-2">
                <Input
                  id={id}
                  value={path}
                  onChange={(e) => setPath(e.target.value)}
                  placeholder="~/Progetti/Sito"
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
                Salva
              </Button>
              {p.folder && (
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  Annulla
                </Button>
              )}
            </div>
          </RowBody>
        </form>
      ) : (
        <RowBody>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setEditing(true)}>
              {p.folder ? 'Cambia cartella' : 'Scegli una cartella'}
            </Button>
            {p.folder && (
              <Button variant="dangerSoft" size="sm" disabled={busy} onClick={() => void remove()}>
                Togli la cartella
              </Button>
            )}
          </div>
        </RowBody>
      )}
    </Group>
  );
}

/* --------------------------------------------------------- Collegamenti */

/** The name of a service of the gallery (`MCP_CATALOG`), as Impostazioni → Collegamenti says it. */
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
  const agents = useAgents();
  const [mcp, setMcp] = useState<McpServersResponse | null>(null);
  const [claude, setClaude] = useState<ClaudeConnectionsResponse | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let alive = true;
    const api = getApi();
    api
      .mcpServers()
      .then((r) => alive && setMcp(r))
      .catch(() => {});
    api
      .claudeConnections()
      .then((r) => alive && setClaude(r))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);
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
  const toggle = (kind: 'mcp' | 'claude', name: string, on: boolean) => {
    const list = p.connections[kind];
    const next = on ? [...new Set([...list, name])] : list.filter((x) => x !== name);
    void update({ connections: { [kind]: next } });
  };

  const team = (mcp?.servers ?? []).filter((s) => s.agents.includes('*'));
  const own = (mcp?.servers ?? []).filter(
    (s) => !s.agents.includes('*') && s.agents.some((a) => members.has(a)),
  );
  const services = (claude?.connections ?? []).filter((c) => c.added && c.agents.includes('*'));

  return (
    <>
      <Group
        title="Ricerca sul web"
        testId="project-web"
        footer="Vale insieme ai permessi di ogni mostro: chi non ha il web non lo prende da qui."
      >
        <Row
          label="I mostri del progetto cercano sul web"
          description="Spenta, il progetto lavora solo con le note, la cartella e i collegamenti qui sotto (anche il browser si spegne)."
        >
          <Switch
            checked={p.webSearch}
            disabled={busy}
            onCheckedChange={(v) => void update({ webSearch: v })}
            label="Ricerca sul web per il progetto"
          />
        </Row>
      </Group>

      <Group
        title="Programmi e servizi"
        as="ul"
        testId="project-links"
        description="Un collegamento dato a tutta la squadra arriva ai mostri del progetto solo se lo accendi qui. Uno dato a un mostro per nome gli arriva comunque."
        footer={
          <a
            href={settingsPath('collegamenti')}
            className="font-medium text-signal-ink hover:underline"
          >
            Collega altri programmi in Impostazioni → Collegamenti
          </a>
        }
      >
        {mcp === null && claude === null && (
          <li>
            <RowBody>
              <p className="label text-ink-muted">Carico…</p>
            </RowBody>
          </li>
        )}
        {mcp !== null && team.length + own.length + services.length === 0 && (
          <li>
            <RowBody>
              <p className="text-body text-ink-muted">Nessun programma collegato, per ora.</p>
            </RowBody>
          </li>
        )}
        {team.map((s) => (
          <Row
            key={s.name}
            as="li"
            testId="project-link"
            label={s.label}
            description={s.enabled ? 'Dato a tutta la squadra' : 'Spento in Impostazioni'}
          >
            <Switch
              checked={p.connections.mcp.includes(s.name)}
              disabled={busy}
              onCheckedChange={(v) => toggle('mcp', s.name, v)}
              label={`${s.label} per il progetto`}
            />
          </Row>
        ))}
        {services.map((c) => (
          <Row
            key={c.id}
            as="li"
            testId="project-link"
            label={serviceName(c.id)}
            description="Tramite l’abbonamento Claude, per chi lavora con Claude"
          >
            <Switch
              checked={p.connections.claude.includes(c.id)}
              disabled={busy}
              onCheckedChange={(v) => toggle('claude', c.id, v)}
              label={`${serviceName(c.id)} per il progetto`}
            />
          </Row>
        ))}
        {own.map((s) => (
          <Row
            key={s.name}
            as="li"
            label={s.label}
            description={`Solo per ${s.agents
              .filter((a) => members.has(a))
              .map(nameOf)
              .join(', ')}: si cambia in Impostazioni`}
          />
        ))}
      </Group>
    </>
  );
}

/* ---------------------------------------------------------- Automazioni */

export function ProjectAutomations({ p }: { p: ProjectView }) {
  const tick = useAutomationTick();
  const list = useLoaded(() => getApi().automations(), tick);
  const mine = list.data?.filter((a) => a.project === p.id) ?? null;
  const create = () => openPage(automationPath(null, { mode: 'nuova', project: p.id }));
  return (
    <div className="grid gap-4" data-testid="project-automations">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="secondary" onClick={create} data-testid="project-automation-new">
          <Plus size={16} aria-hidden /> Nuova automazione
        </Button>
        <a
          href={automationPath()}
          className="inline-flex h-10 items-center gap-1.5 px-2 text-body font-medium text-signal-ink hover:underline"
        >
          Tutte le automazioni <ArrowRight size={15} weight="bold" aria-hidden />
        </a>
      </div>
      {mine && mine.length === 0 ? (
        <p className="px-1 text-body text-ink-muted" data-testid="project-automations-empty">
          Il progetto non ha ancora automazioni: un lavoro che la squadra fa da sola, a un’ora
          fissa, con il capo che passa i compiti ai suoi mostri.
        </p>
      ) : (
        <AutomationList
          list={mine}
          error={list.error}
          onChanged={(a) => list.set((list.data ?? []).map((x) => (x.id === a.id ? a : x)))}
        />
      )}
    </div>
  );
}

/* ---------------------------------------------------------------- Spesa */

export function ProjectSpend({
  p,
  onChanged,
}: {
  p: ProjectView;
  onChanged: (p: ProjectView) => void;
}) {
  const [view, setView] = useState<ProjectSpendView | null>(null);
  const [team, setTeam] = useState<SpendView | null>(null);
  const [failed, setFailed] = useState(false);
  const [round, setRound] = useState(0);
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

  if (failed) {
    return (
      <p className="px-1 text-footnote text-ink-muted" role="status">
        Non riesco a leggere la spesa del progetto adesso. Riprova tra poco.
      </p>
    );
  }
  if (!view) return <p className="label px-1 text-ink-muted">Carico…</p>;

  const saveProject = async (caps: { dailyEur: number | null; monthlyEur: number | null }) => {
    onChanged(await getApi().updateProject(p.id, { spend: caps }));
    notify('Tetto del progetto salvato.', 'success');
    setRound((r) => r + 1);
  };
  const saveAgent = async (
    id: string,
    name: string,
    caps: { dailyEur: number | null; monthlyEur: number | null },
  ) => {
    await getApi().setSpend({ agents: { [id]: caps } });
    notify(`Tetto di ${name} salvato.`, 'success');
    setRound((r) => r + 1);
  };
  const teamCaps = team
    ? [
        team.day.capEur !== null ? `${formatEur(team.day.capEur)} al giorno` : null,
        team.month.capEur !== null ? `${formatEur(team.month.capEur)} al mese` : null,
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
    'Il tetto del progetto',
  );
  const estimated = estimatedNotice(
    view.agents.flatMap((a) => a.estimated ?? []),
    'Il tetto del progetto',
  );

  return (
    <>
      <Group
        title="Tetto del progetto"
        testId="project-spend"
        description="Quanto possono spendere i mostri del progetto con i modelli a pagamento. Al tetto i loro lavori a pagamento si fermano; gli altri progetti e la Squadra personale vanno avanti."
        footer={
          <span data-testid="project-spend-team">
            {teamCaps.length > 0
              ? `Vale anche il tetto di tutta la squadra (${teamCaps.join(', ')}): si ferma il primo che arriva. `
              : 'Tutta la squadra non ha un tetto. '}
            <a href={SPEND_CAP_PATH} className="font-medium text-signal-ink hover:underline">
              Tetto di spesa della squadra
            </a>
          </span>
        }
      >
        <CapChain
          testId="project-spend-chain"
          links={[
            {
              id: 'monster',
              label: 'Mostro',
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
            { id: 'project', label: 'Progetto', ...chainOf(closestMeter(view.day, view.month)) },
            {
              id: 'team',
              label: 'Tutta la squadra',
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
              {view.status === 'stopped'
                ? 'Il progetto ha raggiunto il suo tetto: i lavori a pagamento dei suoi mostri sono fermi. Alzalo qui sotto per farli ripartire.'
                : 'Il progetto ha speso più dell’80% del suo tetto.'}
            </Status>
          </RowBody>
        )}
        <Row label="Oggi" description={noCapNote(view.day)} testId="project-spend-day">
          <SpendDisplay meter={view.day} />
        </Row>
        <Row label="Questo mese" description={noCapNote(view.month)}>
          <SpendDisplay meter={view.month} />
        </Row>
        <RowBody>
          <CapsForm
            testId="project-caps"
            daily={view.caps.dailyEur ?? null}
            monthly={view.caps.monthlyEur ?? null}
            emptyHint="Vuoto: vale solo il tetto della squadra."
            onSave={saveProject}
          />
        </RowBody>
      </Group>

      {view.agents.length > 0 && (
        <Group
          title="Per mostro"
          as="ul"
          testId="project-spend-agents"
          description="Un tetto in più solo per un mostro, oltre a quelli del progetto e della squadra."
        >
          {view.agents.map((a) => (
            <li key={a.id} data-testid={`project-spend-agent-${a.id}`}>
              <Row
                leading={<AgentMark id={a.id} color="var(--ink-muted)" width={40} height={34} />}
                label={a.name}
                description={`Oggi ${formatEur(a.day.spentEur)} · questo mese ${formatEur(a.month.spentEur)}${a.paid ? '' : ' · usa modelli gratuiti o un abbonamento'}`}
              />
              {a.paid && (
                <RowBody>
                  <CapsForm
                    testId={`project-caps-${a.id}`}
                    daily={agentCaps.get(a.id)?.dailyEur ?? null}
                    monthly={agentCaps.get(a.id)?.monthlyEur ?? null}
                    emptyHint="Vuoto: valgono i tetti del progetto e della squadra."
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
