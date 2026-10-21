import { formatDate, type ProjectView } from '@monsters/shared';
import { useId, useState, type FormEvent } from 'react';
import { describeError } from '../../lib/api.ts';
import { projectNameProblem } from '../../lib/projects.ts';
import { openPage, PATHS, projectPath } from '../../lib/router.ts';
import { domId } from '../../lib/utils.ts';
import { getApi, notify, refreshAgents } from '../../store/app.ts';
import { useNameOf } from '../../store/hooks.ts';
import { putProject, refreshProjects, useProjects } from '../../store/projects.ts';
import { FormField, Group, RowBody } from '../settings/parts.tsx';
import { ToolbarContent, ToolbarTitle } from '../shell/Toolbar.tsx';
import { Button } from '../ui/button.tsx';
import { Input } from '../ui/field.tsx';
import { confirmDraft, discardDraft, PlanLines, planMonsters } from './DraftCards.tsx';
import { CrewScreen } from '../monster/CrewScreen.tsx';
import { ProjectFolder, ProjectLinks, ProjectSpend } from './ProjectSections.tsx';
import { viewStrings } from './view.strings.ts';

/*
 * A project that is not in use (D-098, D-100): a draft shows its plan with
 * "Conferma" and "Scarta" and lets the user change what the plan does not
 * fix (name, folder, connections, cap) before confirming; an archived one
 * says when it was archived and "Ripristina" brings it back with its
 * monsters.
 */

function Page({
  title,
  testId,
  children,
}: {
  title: string;
  testId: string;
  children: React.ReactNode;
}) {
  return (
    <section
      aria-labelledby="project-title"
      className="flex min-h-0 w-full flex-1 flex-col overflow-hidden"
      data-testid={testId}
    >
      <ToolbarContent>
        <ToolbarTitle id="project-title">{title}</ToolbarTitle>
      </ToolbarContent>
      <div className="scroll-soft min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto grid w-full max-w-[920px] gap-7 px-4 pt-5 pb-12 sm:px-6 sm:pt-6">
          {children}
        </div>
      </div>
    </section>
  );
}

function Rename({ p }: { p: ProjectView }) {
  const s = viewStrings().draft;
  const id = domId(useId());
  const projects = useProjects();
  const [name, setName] = useState(p.name);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const changed = name.replace(/\s+/g, ' ').trim() !== p.name;
  const save = async (e: FormEvent) => {
    e.preventDefault();
    const problem = projectNameProblem(name, projects ?? [], p.id);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      putProject(await getApi().updateProject(p.id, { name: name.replace(/\s+/g, ' ').trim() }));
      notify(s.saved, 'success');
    } catch (err) {
      setError(describeError(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Group title={s.nameGroup}>
      <form onSubmit={(e) => void save(e)} noValidate>
        <RowBody className="sm:max-w-[520px]">
          <FormField id={id} label={s.nameLabel} hint={s.nameHint(p.vaultArea)} error={error}>
            <Input
              id={id}
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              aria-invalid={error ? true : undefined}
            />
          </FormField>
          <div>
            <Button type="submit" size="sm" variant="secondary" disabled={busy || !changed}>
              {s.saveName}
            </Button>
          </div>
        </RowBody>
      </form>
    </Group>
  );
}

export function DraftPage({ p }: { p: ProjectView }) {
  const s = viewStrings().draft;
  const nameOf = useNameOf();
  const [busy, setBusy] = useState<'confirm' | 'discard' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const proposer = p.createdBy !== 'user' ? nameOf(p.createdBy) : null;
  const run = async (what: 'confirm' | 'discard') => {
    setBusy(what);
    setError(null);
    try {
      const d = { kind: 'project' as const, id: p.id, title: p.name };
      if (what === 'confirm') {
        await confirmDraft(d);
        await refreshProjects();
        void refreshAgents().catch(() => {});
        openPage(projectPath(p.id));
      } else {
        await discardDraft(d);
        openPage(PATHS.home);
      }
    } catch (err) {
      setError(describeError(err));
      setBusy(null);
    }
  };
  return (
    <Page title={s.title(p.name)} testId="project-draft-page">
      <section
        aria-label={s.banner}
        data-testid="project-draft-banner"
        className="set-module grid gap-4 px-4 py-4 shadow-[inset_0_0_0_1.5px_var(--signal)]"
      >
        <div className="flex items-start gap-3">
          <span aria-hidden className="led mt-2" data-tone="signal" data-blink="" />
          <div className="min-w-0 flex-1">
            <p className="text-large font-semibold text-ink">{s.bannerTitle}</p>
            <p className="text-body text-ink-muted">{s.bannerText(proposer)}</p>
          </div>
        </div>
        {/* The squad it will be, the lead first with the look it will have (D-102). */}
        <div data-testid="draft-squad">
          <CrewScreen monsters={planMonsters(p)} height={52} max={5} />
        </div>
        <PlanLines d={p} className="text-body" />
        {p.plan?.why && <p className="text-footnote text-ink-muted">{s.why(p.plan.why)}</p>}
        {error && (
          <p className="text-footnote text-stop-ink" role="alert">
            {error}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null}
            onClick={() => void run('discard')}
            data-testid="project-draft-discard"
          >
            {s.discard}
          </Button>
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() => void run('confirm')}
            data-testid="project-draft-confirm"
          >
            {busy === 'confirm' ? s.confirming : s.confirm}
          </Button>
        </div>
      </section>
      <Rename p={p} />
      <ProjectFolder p={p} onChanged={putProject} />
      <ProjectLinks p={p} onChanged={putProject} />
      <ProjectSpend p={p} onChanged={putProject} />
    </Page>
  );
}

export function ArchivedPage({ p }: { p: ProjectView }) {
  const s = viewStrings().archived;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const restore = async () => {
    setBusy(true);
    setError(null);
    try {
      putProject(await getApi().restoreProject(p.id));
      notify(s.restored(p.name), 'success');
      void refreshAgents().catch(() => {});
      void refreshProjects();
    } catch (err) {
      setError(describeError(err));
      setBusy(false);
    }
  };
  return (
    <Page title={p.name} testId="project-archived-page">
      <section
        aria-label={s.label}
        className="set-module grid gap-3 px-4 py-4"
        data-testid="project-archived"
      >
        <p className="label flex items-center gap-2 text-ink-muted">
          <span aria-hidden className="led" />
          {s.on(
            p.archivedAt
              ? formatDate(p.archivedAt, { day: 'numeric', month: 'long', year: 'numeric' })
              : null,
          )}
        </p>
        <p className="text-body text-ink">
          {s.intro} <span className="font-mono">{p.vaultArea}/</span>
          {p.folder ? (
            <>
              {' '}
              {s.andFolder} <span className="font-mono break-all">{p.folder}</span>
            </>
          ) : null}{' '}
          {s.outro}
        </p>
        {error && (
          <p className="text-footnote text-stop-ink" role="alert">
            {error}
          </p>
        )}
        <div>
          <Button
            size="sm"
            disabled={busy}
            onClick={() => void restore()}
            data-testid="project-restore"
          >
            {busy ? s.restoring : s.restore}
          </Button>
        </div>
      </section>
    </Page>
  );
}
