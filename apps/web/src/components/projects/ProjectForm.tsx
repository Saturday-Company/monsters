import {
  MCP_CATALOG,
  type ClaudeConnectionsResponse,
  type McpServersResponse,
  type ProjectCreateRequest,
  type ProjectView,
} from '@monsters/shared';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { describeError } from '../../lib/api.ts';
import {
  freeCopyName,
  isLive,
  looksAbsolute,
  newFolderIn,
  newFolderPath,
  projectNameProblem,
} from '../../lib/projects.ts';
import { openPage, projectPath } from '../../lib/router.ts';
import { domId } from '../../lib/utils.ts';
import { getApi, notify, refreshAgents } from '../../store/app.ts';
import { useAgents } from '../../store/hooks.ts';
import { putProject, refreshProjects, useProjects } from '../../store/projects.ts';
import { MonsterKey } from '../automations/AutomationForm.tsx';
import { nameProblem } from '../settings/data.ts';
import { Group, Row } from '../settings/parts.tsx';
import { Button } from '../ui/button.tsx';
import { Segmented, Switch } from '../ui/controls.tsx';
import { Field, Input, Label } from '../ui/field.tsx';
import { SquadChart } from './SquadChart.tsx';
import { FolderPickButton, useCanPickFolder } from './FolderPicker.tsx';

/*
 * A new project from the app (D-097, D-100; docs/design.md, "Progetti"): its
 * name, its folder (none, one that exists, or a new one the core creates),
 * its lead (a new monster or a copy of one, with a memory of its own) and the
 * first monsters copied from the other squads. New monsters made to measure
 * come after, from its Squadra (the same flow as Impostazioni → Squadra).
 */

type FolderChoice = 'none' | 'existing' | 'new';

interface TeamLink {
  kind: 'mcp' | 'claude';
  id: string;
  label: string;
}

/**
 * The connections given to the whole team, as the project's Collegamenti tab
 * lists them: a new project starts with all of them on (D-129), the user
 * turns off what it does not need. Null until both lists are answered.
 */
function useTeamLinks(): TeamLink[] | null {
  const [mcp, setMcp] = useState<McpServersResponse['servers'] | null>(null);
  const [claude, setClaude] = useState<ClaudeConnectionsResponse['connections'] | null>(null);
  useEffect(() => {
    let alive = true;
    const api = getApi();
    api
      .mcpServers()
      .then((r) => alive && setMcp(r.servers))
      .catch(() => alive && setMcp([]));
    api
      .claudeConnections()
      .then((r) => alive && setClaude(r.connections))
      .catch(() => alive && setClaude([]));
    return () => {
      alive = false;
    };
  }, []);
  if (!mcp || !claude) return null;
  return [
    ...mcp
      .filter((s) => s.agents.includes('*'))
      .map((s) => ({ kind: 'mcp' as const, id: s.name, label: s.label })),
    ...claude
      .filter((c) => c.added && c.agents.includes('*'))
      .map((c) => ({
        kind: 'claude' as const,
        id: c.id,
        label: MCP_CATALOG.find((e) => e.id === c.id)?.name ?? c.id,
      })),
  ];
}
type LeadChoice = 'new' | 'copy';

type Errors = Partial<Record<'name' | 'folder' | 'lead' | 'form', string>>;

export function ProjectForm() {
  const ids = domId(useId());
  const agents = useAgents();
  const projects = useProjects();
  const [name, setName] = useState('');
  const [folder, setFolder] = useState<FolderChoice>('none');
  const [path, setPath] = useState('');
  // A new folder follows the name until the path is typed by hand.
  const [pathTyped, setPathTyped] = useState(false);
  const [lead, setLead] = useState<LeadChoice>('new');
  const [leadName, setLeadName] = useState('');
  const [leadFrom, setLeadFrom] = useState<string | null>(null);
  const [copies, setCopies] = useState<string[]>([]);
  const [errors, setErrors] = useState<Errors>({});
  const [busy, setBusy] = useState(false);
  const canPick = useCanPickFolder();
  const links = useTeamLinks();
  /** Connections turned off for this project (`kind:id`): the team's are all on by default. */
  const [linksOff, setLinksOff] = useState<string[]>([]);

  const shownPath = folder === 'new' && !pathTyped ? newFolderPath(name) : path;
  const names = agents.map((a) => a.name);
  // Monsters of the other squads that can be copied in (the orchestrator stays above them).
  const sources = agents.filter(
    (a) =>
      !a.isOrchestrator && (!a.project || projects?.some((p) => p.id === a.project && isLive(p))),
  );
  const toggleCopy = (id: string) =>
    setCopies((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id]));

  const check = (): Errors => {
    const e: Errors = {};
    const np = projectNameProblem(name, projects ?? []);
    if (np) e.name = np;
    if (folder !== 'none' && !looksAbsolute(shownPath)) {
      e.folder = 'Scrivi il percorso completo della cartella, per esempio ~/Progetti/Sito.';
    }
    if (lead === 'copy' && !leadFrom) e.lead = 'Scegli il mostro da copiare come capo.';
    if (lead === 'new' && leadName.trim()) {
      const n = leadName.replace(/\s+/g, ' ').trim();
      const problem =
        nameProblem(n) ??
        (names.some((x) => x.toLowerCase() === n.toLowerCase())
          ? 'C’è già un mostro con questo nome, in questa o in un’altra squadra.'
          : null);
      if (problem) e.lead = problem;
    }
    return e;
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    const e = check();
    setErrors(e);
    if (Object.keys(e).length > 0) return;
    const body: ProjectCreateRequest = {
      name: name.replace(/\s+/g, ' ').trim(),
      ...(folder !== 'none'
        ? { folder: { path: shownPath.trim(), create: folder === 'new' } }
        : {}),
      lead:
        lead === 'copy' && leadFrom
          ? { from: leadFrom }
          : leadName.trim()
            ? { name: leadName.replace(/\s+/g, ' ').trim() }
            : {},
      // Not loaded yet: the core gives the project what the whole team has (D-129).
      ...(links
        ? {
            connections: {
              mcp: links
                .filter((l) => l.kind === 'mcp' && !linksOff.includes(`mcp:${l.id}`))
                .map((l) => l.id),
              claude: links
                .filter((l) => l.kind === 'claude' && !linksOff.includes(`claude:${l.id}`))
                .map((l) => l.id),
            },
          }
        : {}),
    };
    setBusy(true);
    let made: ProjectView;
    try {
      made = await getApi().createProject(body);
    } catch (err) {
      setErrors({ form: describeError(err) });
      setBusy(false);
      return;
    }
    // The first monsters, copied one by one: a refusal leaves the project as it is.
    const failed: string[] = [];
    for (const id of copies) {
      try {
        made = await getApi().addProjectMember(made.id, { copyOf: id });
      } catch (err) {
        failed.push(`${agents.find((a) => a.id === id)?.name ?? id}: ${describeError(err)}`);
      }
    }
    putProject(made);
    void refreshProjects();
    void refreshAgents().catch(() => {});
    notify(
      failed.length > 0
        ? `${made.name} è pronto, ma non ho copiato ${failed.join('; ')}`
        : `${made.name} è pronto: scrivi al suo capo da qui.`,
      failed.length > 0 ? 'error' : 'success',
    );
    openPage(projectPath(made.id));
  };

  return (
    <form
      onSubmit={(e) => void submit(e)}
      noValidate
      className="grid gap-6"
      data-testid="project-form"
      aria-labelledby={`${ids}-title`}
    >
      <div className="grid gap-1 px-1">
        <h2 id={`${ids}-title`} className="text-title2 font-semibold text-ink">
          Nuovo progetto
        </h2>
        <p className="max-w-[62ch] text-body text-ink-muted">
          Un progetto è una squadra con il suo capo, i suoi mostri, una cartella delle note, la sua
          cartella sul computer e un suo tetto di spesa. Il tuo capo resta sopra tutti.
        </p>
        <SquadChart className="pt-1.5" />
      </div>

      <Group title="Il progetto">
        <div className="grid gap-5 px-4 pt-1 pb-4">
          <Field id={`${ids}-name`} label="Nome" error={errors.name}>
            <Input
              id={`${ids}-name`}
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              placeholder="Social di Saturday"
              aria-invalid={errors.name ? true : undefined}
              data-testid="project-name"
            />
          </Field>
          <p className="text-footnote text-ink-muted">
            Le sue note andranno in{' '}
            <span className="font-mono text-ink">Progetti/{name.trim() || '…'}/</span>.
          </p>
        </div>
      </Group>

      <Group
        title="Cartella"
        description="La cartella del computer dove lavorano i mostri del progetto: il loro terminale, i file e Claude Code o Codex partono da lì. Tutti i mostri del progetto potranno leggere e scrivere qui. Non la tua cartella personale né le cartelle nascoste."
      >
        <div className="grid gap-4 px-4 pt-1 pb-4">
          <Segmented<FolderChoice>
            value={folder}
            onChange={setFolder}
            label="Cartella del progetto"
            size="sm"
            options={[
              { value: 'none', label: 'Nessuna' },
              { value: 'existing', label: 'Una che c’è' },
              { value: 'new', label: 'Una nuova' },
            ]}
          />
          {folder === 'none' ? (
            <p className="text-footnote text-ink-muted">
              Ogni mostro lavora nella sua cartella privata.
            </p>
          ) : (
            <Field
              id={`${ids}-path`}
              label="Percorso completo"
              error={errors.folder}
              hint={
                folder === 'new'
                  ? `La creo io${canPick ? ': con Scegli… indichi dove' : ''}. Non dentro le note né dentro i dati di Monsters.`
                  : 'Per esempio un repo: ~/Progetti/Sito. Non dentro le note né dentro i dati di Monsters.'
              }
            >
              <div className="flex gap-2">
                <Input
                  id={`${ids}-path`}
                  value={shownPath}
                  onChange={(e) => {
                    setPath(e.target.value);
                    setPathTyped(true);
                  }}
                  placeholder="~/Progetti/Sito"
                  spellCheck={false}
                  autoCapitalize="off"
                  aria-invalid={errors.folder ? true : undefined}
                  data-testid="project-path"
                />
                {canPick && (
                  <FolderPickButton
                    testId="project-path-pick"
                    onPicked={(picked) => {
                      setPath(folder === 'new' ? newFolderIn(picked, name) : picked);
                      setPathTyped(true);
                    }}
                  />
                )}
              </div>
            </Field>
          )}
        </div>
      </Group>

      <Group
        title="Capo del progetto"
        description="Coordina i mostri del progetto come il tuo capo fa con la tua squadra. Una copia ha il ruolo, l’aspetto e i modelli dell’originale e una memoria tutta sua."
      >
        <div className="grid gap-4 px-4 pt-1 pb-4">
          <Segmented<LeadChoice>
            value={lead}
            onChange={setLead}
            label="Chi guida il progetto"
            size="sm"
            options={[
              { value: 'new', label: 'Uno nuovo' },
              { value: 'copy', label: 'Copia un mostro' },
            ]}
          />
          {lead === 'new' ? (
            <Field
              id={`${ids}-lead`}
              label="Nome del capo"
              hint="Vuoto: gli do io un nome libero."
              error={errors.lead}
            >
              <Input
                id={`${ids}-lead`}
                value={leadName}
                maxLength={24}
                onChange={(e) => setLeadName(e.target.value)}
                placeholder="Atlas"
                aria-invalid={errors.lead ? true : undefined}
                data-testid="project-lead-name"
              />
            </Field>
          ) : (
            <div className="grid gap-2">
              <Label id={`${ids}-from`}>Da copiare</Label>
              <div
                role="radiogroup"
                aria-labelledby={`${ids}-from`}
                className="flex flex-wrap gap-2.5 pb-1"
              >
                {agents.map((a) => (
                  <MonsterKey
                    key={a.id}
                    agent={a}
                    role="radio"
                    pressed={leadFrom === a.id}
                    onClick={() => setLeadFrom(a.id)}
                  />
                ))}
              </div>
              {errors.lead && (
                <p className="text-footnote text-stop-ink" role="alert">
                  {errors.lead}
                </p>
              )}
              {leadFrom && (
                <p className="text-footnote text-ink-muted">
                  Si chiamerà {freeCopyName(names) ?? 'con un nome libero'}: lo cambi dopo, dalla
                  sua chat.
                </p>
              )}
            </div>
          )}
        </div>
      </Group>

      {sources.length > 0 && (
        <Group
          title="Primi mostri"
          description="Copia nel progetto i mostri che ti servono: l’originale resta dov’è. Uno nuovo, su misura, lo aggiungi dopo dalla Squadra del progetto."
        >
          <div className="grid gap-2 px-4 pt-1 pb-4">
            <div
              role="group"
              aria-label="Mostri da copiare"
              className="flex flex-wrap gap-2.5 pb-1"
              data-testid="project-copies"
            >
              {sources.map((a) => (
                <MonsterKey
                  key={a.id}
                  agent={a}
                  role="checkbox"
                  pressed={copies.includes(a.id)}
                  onClick={() => toggleCopy(a.id)}
                />
              ))}
            </div>
          </div>
        </Group>
      )}

      {links && links.length > 0 && (
        <Group
          title="Collegamenti"
          as="ul"
          testId="project-form-links"
          description="I programmi e i servizi dati a tutta la squadra arrivano anche al progetto. Spegni quelli che non gli servono: li riaccendi quando vuoi dalla scheda Collegamenti del progetto."
        >
          {links.map((l) => {
            const key = `${l.kind}:${l.id}`;
            return (
              <Row
                key={key}
                as="li"
                testId="project-form-link"
                label={l.label}
                description={
                  l.kind === 'claude'
                    ? 'Tramite l’abbonamento Claude, per chi lavora con Claude'
                    : 'Dato a tutta la squadra'
                }
              >
                <Switch
                  checked={!linksOff.includes(key)}
                  onCheckedChange={(on) =>
                    setLinksOff((off) => (on ? off.filter((x) => x !== key) : [...off, key]))
                  }
                  label={`${l.label} per il progetto`}
                />
              </Row>
            );
          })}
        </Group>
      )}

      {errors.form && (
        <p className="px-1 text-body text-stop-ink" role="alert" data-testid="project-form-error">
          {errors.form}
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2 px-1">
        <Button variant="ghost" onClick={() => window.history.back()}>
          Annulla
        </Button>
        <Button
          type="submit"
          disabled={busy}
          variant={name.trim() ? 'primary' : 'secondary'}
          data-testid="project-create"
        >
          {busy ? 'Lo preparo…' : 'Crea il progetto'}
        </Button>
      </div>
    </form>
  );
}
