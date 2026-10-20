import { ArrowClockwise, ChatCircle, Check, Sparkle } from '@phosphor-icons/react';
import {
  AgentDutySchema,
  MAX_DUTIES,
  TeamMissionSchema,
  TeamRoleSchema,
  agentAreaProblem,
  normalizeAgentArea,
  type TeamDraft,
  type TeamMemberUpdate,
  type TeamMemberView,
  type TeamSuggestions,
} from '@monsters/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '../../lib/api.ts';
import { openChat } from '../../lib/router.ts';
import { cn, domId } from '../../lib/utils.ts';
import { genomeFrom } from '../../onboarding/parts.tsx';
import { getApi, notify } from '../../store/app.ts';
import type { DraftHandoff } from '../../store/draft-handoff.ts';
import { statusText, useLive } from '../../store/hooks.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { Button } from '../ui/button.tsx';
import { Chip, Switch } from '../ui/controls.tsx';
import { nameProblem, plainly, teamError } from './data.ts';
import {
  ConfirmButton,
  DisclosureRow,
  FormField,
  Group,
  InlineEdit,
  Row,
  RowBody,
  textareaClass,
} from './parts.tsx';

/*
 * One monster of Settings → Squadra (name, look, role and duties, remove) and
 * the form that adds a new one, from a ready-made monster or a description.
 */

const inputClass =
  'well h-11 w-full rounded-[10px] px-3.5 text-body text-ink placeholder:text-ink-muted focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink aria-[invalid=true]:outline-2 aria-[invalid=true]:outline-stop';

/** What a monster does, as edited in the form. */
interface RoleFields {
  role: string;
  mission: string;
  duties: string;
  area: string;
  web: boolean;
}

function dutiesOf(text: string): string[] {
  return text
    .split('\n')
    .map((l) => l.replace(/^\s*[-*•]\s*/, '').trim())
    .filter(Boolean);
}

/** Problems of the fields, by field, in plain words; empty when they can be saved. */
function roleProblems(f: RoleFields): Record<string, string> {
  const out: Record<string, string> = {};
  if (!TeamRoleSchema.safeParse(f.role).success) {
    out['role'] = 'Una riga sola, tra 5 e 120 caratteri.';
  }
  if (!TeamMissionSchema.safeParse(f.mission).success) {
    out['mission'] = 'Una riga sola, tra 5 e 200 caratteri.';
  }
  const duties = dutiesOf(f.duties);
  if (duties.length === 0) out['duties'] = 'Serve almeno un compito.';
  else if (duties.length > MAX_DUTIES) out['duties'] = `Al massimo ${MAX_DUTIES} compiti.`;
  else {
    const bad = duties.find((d) => !AgentDutySchema.safeParse(d).success);
    if (bad)
      out['duties'] = `Il compito “${bad.slice(0, 30)}” non va bene: troppo corto o troppo lungo.`;
  }
  const area = agentAreaProblem(normalizeAgentArea(f.area));
  if (area) out['area'] = area;
  return out;
}

/** The fields of the role form, shared by "Modifica" and the new monster. */
function RoleInputs({
  name,
  title,
  fields,
  set,
  errors,
}: {
  name: string;
  /** "la ricercatrice": the mission completes "Sei Rhea, la ricercatrice: …". */
  title: string;
  fields: RoleFields;
  set: (patch: Partial<RoleFields>) => void;
  errors: Record<string, string>;
}) {
  const id = domId(useId());
  const aria = (key: string) => ({
    'aria-invalid': errors[key] ? true : undefined,
    'aria-describedby': errors[key] ? `${id}-${key}-error` : `${id}-${key}-hint`,
  });
  return (
    <>
      <FormField
        id={`${id}-role`}
        label="Cosa fa, in una riga"
        error={errors['role']}
        hint="Si legge sotto il suo nome."
      >
        <input
          id={`${id}-role`}
          value={fields.role}
          maxLength={120}
          onChange={(e) => set({ role: e.target.value })}
          className={inputClass}
          {...aria('role')}
        />
      </FormField>
      <FormField
        id={`${id}-mission`}
        label="Il suo obiettivo"
        error={errors['mission']}
        hint={`Completa la frase “Sei ${name}, ${title}: …”.`}
      >
        <input
          id={`${id}-mission`}
          value={fields.mission}
          maxLength={200}
          onChange={(e) => set({ mission: e.target.value })}
          className={inputClass}
          {...aria('mission')}
        />
      </FormField>
      <FormField
        id={`${id}-duties`}
        label="Compiti, uno per riga"
        error={errors['duties']}
        hint={`Al massimo ${MAX_DUTIES}.`}
      >
        <textarea
          id={`${id}-duties`}
          value={fields.duties}
          rows={4}
          onChange={(e) => set({ duties: e.target.value })}
          className={textareaClass}
          {...aria('duties')}
        />
      </FormField>
      <FormField
        id={`${id}-area`}
        label="Dove scrive nelle note"
        error={errors['area']}
        hint="Una cartella delle note: lì mette quello che prepara."
      >
        <input
          id={`${id}-area`}
          value={fields.area}
          maxLength={80}
          onChange={(e) => set({ area: e.target.value })}
          className={cn(inputClass, 'font-mono text-footnote')}
          {...aria('area')}
        />
      </FormField>
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-footnote font-medium text-ink">Fa ricerche sul web</p>
          <p className="text-footnote text-ink-muted">
            È il suo mestiere: il capo gli passa le ricerche e ha più passi per lavoro. Il web lo
            usa ogni mostro che ne ha il permesso, in Permessi.
          </p>
        </div>
        <Switch
          words
          checked={fields.web}
          onCheckedChange={(web) => set({ web })}
          label="Fa ricerche sul web"
        />
      </div>
    </>
  );
}

function RoleForm({
  member,
  onSaved,
  onCancel,
}: {
  member: TeamMemberView;
  onSaved: () => void;
  onCancel: () => void;
}) {
  const start: RoleFields = {
    role: member.role,
    mission: member.mission ?? '',
    duties: (member.duties ?? []).join('\n'),
    area: member.area ?? '',
    web: member.web,
  };
  const [fields, setFields] = useState(start);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [overwrite, setOverwrite] = useState(false);
  const [busy, setBusy] = useState(false);

  const send = async (force: boolean) => {
    const update: TeamMemberUpdate = {};
    if (fields.role.trim() !== start.role) update.role = fields.role.trim();
    if (fields.mission.trim() !== start.mission) update.mission = fields.mission.trim();
    const duties = dutiesOf(fields.duties);
    if (duties.join('\n') !== start.duties) update.duties = duties;
    const area = normalizeAgentArea(fields.area);
    if (area !== start.area) update.area = area;
    if (fields.web !== start.web) update.web = fields.web;
    if (Object.keys(update).length === 0) return onCancel();
    setBusy(true);
    try {
      await getApi().updateMember(member.id, force ? { ...update, force: true } : update);
      notify(`Ruolo e compiti di ${member.name} salvati.`, 'success');
      onSaved();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'instructions_edited') setOverwrite(true);
      else setErrors({ form: teamError(err) });
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const found = roleProblems(fields);
    setErrors(found);
    if (Object.keys(found).length === 0) void send(member.instructionsEdited && overwrite);
  };

  return (
    <form onSubmit={submit} noValidate data-testid={`team-role-form-${member.id}`}>
      <RowBody className="sm:max-w-[520px]">
        <RoleInputs
          name={member.name}
          title={member.title ?? 'della squadra'}
          fields={fields}
          set={(patch) => setFields((f) => ({ ...f, ...patch }))}
          errors={errors}
        />
        {overwrite && (
          <div
            className="grid gap-2 rounded-[10px] bg-panel px-3.5 py-3 shadow-[0_0_0_1px_var(--seam)]"
            role="alert"
            data-testid="team-overwrite"
          >
            <p className="text-footnote leading-snug text-ink">
              Hai modificato a mano le istruzioni di {member.name}: le sostituisco? Una copia resta
              salvata.
            </p>
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={() => void send(true)}>
                Sostituisci
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setOverwrite(false)}>
                Annulla
              </Button>
            </div>
          </div>
        )}
        {errors['form'] && (
          <p role="alert" className="text-footnote text-stop-ink">
            {errors['form']}
          </p>
        )}
        {!overwrite && (
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={busy}>
              {busy ? 'Salvo…' : 'Salva'}
            </Button>
            <Button variant="ghost" size="sm" onClick={onCancel}>
              Annulla
            </Button>
          </div>
        )}
      </RowBody>
    </form>
  );
}

/** A choice of looks: the current one first, then new ones from the core. */
function LookPicker({
  member,
  onSaved,
  onClose,
}: {
  member: TeamMemberView;
  onSaved: () => void;
  onClose: () => void;
}) {
  const [looks, setLooks] = useState<unknown[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<number>(-1);

  const more = async () => {
    setError(null);
    try {
      const r = await getApi().teamLooks({ agent: member.id, count: 3 });
      setLooks(r.looks.map((l) => l.genome));
    } catch (err) {
      setError(teamError(err));
    }
  };
  // The first previews, when the picker opens.
  useEffect(() => {
    let alive = true;
    getApi()
      .teamLooks({ agent: member.id, count: 3 })
      .then((r) => alive && setLooks(r.looks.map((l) => l.genome)))
      .catch((err: unknown) => alive && setError(teamError(err)));
    return () => {
      alive = false;
    };
  }, [member.id]);

  const pick = async (i: number, genome: unknown) => {
    setBusy(true);
    setError(null);
    setChosen(i);
    try {
      await getApi().setMemberLook(member.id, genome);
      notify(`${member.name} ha un aspetto nuovo.`, 'success');
      onSaved();
    } catch (err) {
      setChosen(-1);
      setError(teamError(err));
    } finally {
      setBusy(false);
    }
  };

  const tile = (genome: unknown, i: number, label: string) => (
    <button
      key={i}
      type="button"
      role="radio"
      aria-checked={chosen === i}
      aria-label={label}
      disabled={busy}
      onClick={() => (i === -1 ? onClose() : void pick(i, genome))}
      data-pressed={chosen === i ? 'true' : undefined}
      className={cn(
        'key relative grid justify-items-center gap-2 rounded-[12px] p-2 pb-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink',
        chosen === i && '[--cap:var(--panel)]',
      )}
    >
      <MonsterScreen genome={genomeFrom(genome, member.name)} mood="idle" width={84} height={72} />
      <span className="label flex items-center gap-1.5 text-ink-muted">
        {chosen === i && <span aria-hidden className="led size-1.5" data-tone="signal" />}
        {i === -1 ? 'Com’è adesso' : `Nuovo ${i + 1}`}
      </span>
    </button>
  );

  return (
    <RowBody>
      <div
        role="radiogroup"
        aria-label={`Aspetti per ${member.name}`}
        className="flex flex-wrap gap-3 pb-1"
        data-testid={`team-looks-${member.id}`}
      >
        {tile(member.genome, -1, `Lascia ${member.name} com’è`)}
        {looks?.map((g, i) => tile(g, i, `Aspetto nuovo ${i + 1} per ${member.name}`))}
        {!looks && !error && (
          <span className="self-center text-footnote text-ink-muted">Ne preparo qualcuno…</span>
        )}
      </div>
      {error && (
        <p role="alert" className="text-footnote text-stop-ink">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => void more()}>
          <ArrowClockwise size={16} aria-hidden />
          Altri
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>
          Chiudi
        </Button>
      </div>
    </RowBody>
  );
}

/** The screen of a row: still, or following what the monster is doing now (`live`). */
function MemberScreen({ member, live }: { member: TeamMemberView; live: boolean }) {
  const now = useLive(member.id);
  return (
    <MonsterScreen
      genome={genomeFrom(member.genome, member.name)}
      mood={live ? now.mood : 'idle'}
      confused={live ? now.confused : false}
      width={52}
      height={44}
    />
  );
}

/** The status of a monster, read out after its role. */
function LiveNote({ id }: { id: string }) {
  return <span className="sr-only">, {statusText(useLive(id))}</span>;
}

/**
 * One monster of a squad: the personal one (Impostazioni → Squadra) or a
 * project's (its Squadra tab, D-097), with the same name, look, role and duties.
 * The capo of a squad (the orchestrator, a project's lead) keeps its role.
 */
export function MemberRow({
  member,
  taken,
  onChanged,
  chat = false,
  live = false,
  removal,
  testId,
}: {
  member: TeamMemberView;
  taken: (name: string, self?: string) => boolean;
  onChanged: () => void;
  /** A "Scrivi" row that opens the monster's chat (the project's tab). */
  chat?: boolean;
  /** Its screen follows what it is doing, and its status is read out. */
  live?: boolean;
  /** "Togli" of another kind than the personal squad's archive (a project's monster). */
  removal?: { description: string; run: () => Promise<void> };
  testId?: string;
}) {
  const [open, setOpen] = useState<'look' | 'role' | null>(null);
  const [busy, setBusy] = useState(false);
  const lead = member.isOrchestrator || member.isLead === true;

  const archive = async () => {
    setBusy(true);
    try {
      if (removal) {
        await removal.run();
        return;
      }
      const r = await getApi().archiveMember(member.id);
      notify(
        `${member.name} non è più nella squadra.${
          r.questionsClosed > 0 ? ' Le sue domande aperte sono chiuse.' : ''
        } Lo ritrovi in “Mostri archiviati”.`,
        'success',
      );
      onChanged();
    } catch (err) {
      notify(teamError(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <DisclosureRow
      testId={testId ?? `team-member-${member.id}`}
      leading={<MemberScreen member={member} live={live} />}
      label={
        <span className="flex flex-wrap items-baseline gap-x-2.5">
          <span className="text-large font-semibold">{member.name}</span>
          {member.isOrchestrator && <span className="label text-signal-ink">il tuo capo</span>}
          {member.isLead && <span className="label text-signal-ink">Capo</span>}
        </span>
      }
      description={
        <>
          {member.isLead ? 'Coordina il progetto e passa i compiti agli altri.' : member.role}
          {live && <LiveNote id={member.id} />}
        </>
      }
    >
      <div className="set-rows">
        {chat && (
          <Row label="Chat" description={`Scrivi a ${member.name} dalla sua chat.`}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openChat(member.id)}
              aria-label={`Scrivi a ${member.name}`}
            >
              <ChatCircle size={16} aria-hidden /> Scrivi
            </Button>
          </Row>
        )}
        <Row label="Nome">
          <InlineEdit
            value={member.name}
            label={`il nome di ${member.name}`}
            check={(n) =>
              nameProblem(n) ?? (taken(n, member.id) ? 'C’è già un mostro con questo nome.' : null)
            }
            onSave={(name) =>
              plainly(async () => {
                await getApi().updateMember(member.id, { name });
                notify(`${member.name} ora si chiama ${name}. Chat e note restano sue.`, 'success');
                onChanged();
              })
            }
          />
        </Row>
        <div>
          <Row label="Aspetto">
            {open !== 'look' && (
              <Button variant="secondary" size="sm" onClick={() => setOpen('look')}>
                Cambia aspetto
              </Button>
            )}
          </Row>
          {open === 'look' && (
            <div className="set-seam-t">
              <LookPicker
                member={member}
                onSaved={() => {
                  setOpen(null);
                  onChanged();
                }}
                onClose={() => setOpen(null)}
              />
            </div>
          )}
        </div>
        {lead ? (
          <Row
            label="Ruolo"
            description={
              member.isLead
                ? 'Coordina i mostri del progetto: il suo ruolo non si cambia, il nome sì.'
                : 'Coordina la squadra: il suo ruolo non si cambia, il nome sì.'
            }
          />
        ) : (
          <>
            <div>
              <Row
                label="Ruolo e compiti"
                description={`${member.duties?.length ?? 0} ${
                  member.duties?.length === 1 ? 'compito' : 'compiti'
                } · scrive in ${member.area ?? '…'}/${member.web ? ' · fa ricerche sul web' : ''}`}
              >
                {open !== 'role' && (
                  <Button variant="secondary" size="sm" onClick={() => setOpen('role')}>
                    Modifica
                  </Button>
                )}
              </Row>
              {open === 'role' && (
                <div className="set-seam-t">
                  <RoleForm
                    member={member}
                    onCancel={() => setOpen(null)}
                    onSaved={() => {
                      setOpen(null);
                      onChanged();
                    }}
                  />
                </div>
              )}
            </div>
            <Row
              label={removal ? 'Togli dal progetto' : 'Togli dalla squadra'}
              description={
                removal?.description ??
                'La sua chat resta in Attività e puoi riportarlo quando vuoi.'
              }
            >
              <ConfirmButton
                label="Togli"
                question={`Tolgo ${member.name}?`}
                confirm="Sì, togli"
                busy={busy}
                onConfirm={() => void archive()}
              />
            </Row>
          </>
        )}
      </div>
    </DisclosureRow>
  );
}

/** A monster ready to be added, edited before it is created. */
function DraftReview({
  draft,
  proposal,
  models,
  taken,
  onBack,
  onAdded,
  project,
}: {
  draft: TeamDraft;
  /** The project it joins (D-100): its colour keeps away from that squad's, it is created there. */
  project?: { id: string; name: string } | undefined;
  /** The capo squadra's proposal it comes from (D-075): "Cambia" on the chat card. */
  proposal?: string | undefined;
  /** The model of that proposal (D-079): in sight, and used unless unticked. */
  models?: { provider: string; model: string }[] | undefined;
  taken: (name: string) => boolean;
  onBack: () => void;
  onAdded: () => void;
}) {
  const nameId = domId(useId());
  const form = useRef<HTMLFormElement>(null);
  // Opened from the chat: the form is below the team, in sight at once.
  useEffect(() => {
    if (proposal) form.current?.scrollIntoView?.({ block: 'start' });
  }, [proposal]);
  const [name, setName] = useState(draft.name);
  const [genome, setGenome] = useState<unknown>(draft.genome);
  const [fields, setFields] = useState<RoleFields>({
    role: draft.role,
    mission: draft.mission,
    duties: draft.duties.join('\n'),
    area: draft.area,
    web: draft.web,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const proposedModel = models?.[0];
  const [useProposedModel, setUseProposedModel] = useState(true);
  const modelId = domId(useId());

  const otherLook = async () => {
    try {
      const r = await getApi().teamLooks({
        name: name.trim() || draft.name,
        count: 1,
        ...(project ? { project: project.id } : {}),
      });
      if (r.looks[0]) setGenome(r.looks[0].genome);
    } catch (err) {
      notify(teamError(err), 'error');
    }
  };
  // In a project the colours keep away from that squad's (D-097): the draft's look was
  // chosen against the personal squad, so a project's one comes first.
  const projectId = project?.id;
  useEffect(() => {
    if (!projectId) return;
    let alive = true;
    getApi()
      .teamLooks({ name: draft.name, count: 1, project: projectId })
      .then((r) => alive && r.looks[0] && setGenome(r.looks[0].genome))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [projectId, draft.name]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const n = name.replace(/\s+/g, ' ').trim();
    const found = roleProblems(fields);
    const np = nameProblem(n) ?? (taken(n) ? 'C’è già un mostro con questo nome.' : null);
    if (np) found['name'] = np;
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    setBusy(true);
    try {
      const request = {
        name: n,
        title: draft.title,
        role: fields.role.trim(),
        mission: fields.mission.trim(),
        ...(draft.context ? { context: draft.context } : {}),
        duties: dutiesOf(fields.duties),
        area: normalizeAgentArea(fields.area),
        web: fields.web,
        genome: genome as Record<string, unknown>,
        archetype: draft.archetype,
        ...(proposal ? { proposal } : {}),
        ...(proposal && proposedModel && !useProposedModel ? { proposalModel: false } : {}),
      };
      if (project) {
        await getApi().addProjectMember(project.id, request);
        notify(`${n} è nel progetto ${project.name}: scrivigli dalla sua chat.`, 'success');
      } else {
        const added = await getApi().addMember(request);
        notify(`${added.name} è nella squadra: scrivigli dalla sua chat.`, 'success');
      }
      onAdded();
    } catch (err) {
      setErrors({ form: teamError(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form ref={form} onSubmit={(e) => void submit(e)} noValidate data-testid="team-draft">
      <RowBody className="sm:max-w-[520px]">
        <div className="flex items-center gap-4">
          <MonsterScreen
            genome={genomeFrom(genome, name || draft.name)}
            mood="done"
            width={96}
            height={82}
            animated
          />
          <div className="grid gap-2">
            <p className="text-footnote leading-snug text-ink-muted">
              {draft.source === 'model'
                ? 'L’ho preparato dalla tua descrizione: controlla e cambia quello che vuoi.'
                : draft.source === 'proposal'
                  ? 'L’ha proposto il tuo capo: controlla e cambia quello che vuoi.'
                  : 'Controlla e cambia quello che vuoi.'}
            </p>
            <Button
              variant="secondary"
              size="sm"
              className="justify-self-start"
              onClick={() => void otherLook()}
            >
              <ArrowClockwise size={16} aria-hidden />
              Un altro aspetto
            </Button>
          </div>
        </div>
        <FormField id={nameId} label="Nome" error={errors['name']}>
          <input
            id={nameId}
            value={name}
            maxLength={24}
            onChange={(e) => setName(e.target.value)}
            className={inputClass}
            aria-invalid={errors['name'] ? true : undefined}
          />
        </FormField>
        <RoleInputs
          name={name || draft.name}
          title={draft.title}
          fields={fields}
          set={(patch) => setFields((f) => ({ ...f, ...patch }))}
          errors={errors}
        />
        {proposedModel && (
          <label
            htmlFor={modelId}
            className="flex items-center gap-2 text-footnote text-ink"
            data-testid="team-draft-model"
          >
            <input
              id={modelId}
              type="checkbox"
              checked={useProposedModel}
              onChange={(e) => setUseProposedModel(e.target.checked)}
            />
            <span>
              Modello proposto:{' '}
              <span className="font-mono">
                {proposedModel.provider}/{proposedModel.model}
              </span>
              {useProposedModel ? '' : ' (userà quelli del tuo capo)'}
            </span>
          </label>
        )}
        {errors['form'] && (
          <p role="alert" className="text-footnote text-stop-ink">
            {errors['form']}
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            <Check size={16} aria-hidden />
            {busy ? 'Lo sveglio…' : project ? 'Aggiungi al progetto' : 'Aggiungi alla squadra'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onBack}>
            Indietro
          </Button>
        </div>
      </RowBody>
    </form>
  );
}

/** "Aggiungi un mostro": a ready-made one or one made to measure, reviewed, then added. */
export function AddMonster({
  taken,
  onCancel,
  onAdded,
  initial,
  project,
}: {
  taken: (name: string) => boolean;
  onCancel: () => void;
  onAdded: () => void;
  /** A draft to start from: a proposal of the capo squadra ("Cambia", D-075). */
  initial?: DraftHandoff | null | undefined;
  /** A new monster of a project (D-100): the same flow, created in its squad. */
  project?: { id: string; name: string } | undefined;
}) {
  const descId = domId(useId());
  const [suggestions, setSuggestions] = useState<TeamSuggestions | null>(null);
  const [description, setDescription] = useState('');
  const [draft, setDraft] = useState<TeamDraft | null>(initial?.draft ?? null);
  const [proposal, setProposal] = useState(initial?.proposal);
  const [models, setModels] = useState(initial?.models);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    getApi()
      .teamSuggestions()
      .then((s) => alive && setSuggestions(s))
      .catch((err: unknown) => alive && setError(teamError(err)));
    return () => {
      alive = false;
    };
  }, []);

  const prepare = async (
    request: { archetype: 'rhea' | 'dione' } | { description: string },
    key: string,
  ) => {
    setBusy(key);
    setError(null);
    try {
      setDraft(await getApi().teamDraft(request));
    } catch (err) {
      setError(teamError(err));
    } finally {
      setBusy(null);
    }
  };

  if (draft) {
    return (
      <Group title="Nuovo mostro" testId="team-add">
        <DraftReview
          draft={draft}
          proposal={proposal}
          models={models}
          taken={taken}
          project={project}
          onBack={() => {
            setDraft(null);
            setProposal(undefined);
            setModels(undefined);
          }}
          onAdded={onAdded}
        />
      </Group>
    );
  }

  return (
    <div className="grid gap-5" data-testid="team-add">
      {suggestions && suggestions.archetypes.length > 0 && (
        <Group title="Nuovo mostro: uno pronto" as="ul">
          {suggestions.archetypes.map((a) => (
            <Row
              key={a.archetype}
              as="li"
              label={
                <>
                  <span className="font-medium">{a.name}</span>{' '}
                  <span className="text-ink-muted">{a.title}</span>
                </>
              }
              description={a.role}
            >
              <Button
                variant="secondary"
                size="sm"
                disabled={busy !== null}
                aria-label={`Scegli ${a.name}, ${a.title}`}
                onClick={() => void prepare({ archetype: a.archetype }, a.archetype)}
              >
                {busy === a.archetype ? 'Preparo…' : 'Scegli'}
              </Button>
            </Row>
          ))}
        </Group>
      )}
      <Group
        title={suggestions?.archetypes.length ? 'Oppure su misura' : 'Nuovo mostro'}
        footer="Lo prepara il modello dalla tua descrizione: può volerci un minuto. Prima di aggiungerlo lo puoi cambiare."
      >
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            const d = description.replace(/\s+/g, ' ').trim();
            if (d.length < 5) return setError('Scrivi in qualche parola cosa deve fare.');
            void prepare({ description: d }, 'description');
          }}
        >
          <RowBody>
            {suggestions && suggestions.ideas.length > 0 && (
              <div className="flex flex-wrap gap-1.5" aria-label="Idee" role="group">
                {suggestions.ideas.map((i) => (
                  <Chip
                    key={i.id}
                    pressed={description === i.description}
                    onClick={() => setDescription(i.description)}
                  >
                    {i.label}
                  </Chip>
                ))}
              </div>
            )}
            <FormField id={descId} label="Cosa deve fare?" error={error}>
              <textarea
                id={descId}
                rows={3}
                maxLength={500}
                value={description}
                placeholder="Per esempio: segue le mie spese e mi avvisa quando sforo il budget."
                onChange={(e) => setDescription(e.target.value)}
                className={textareaClass}
              />
            </FormField>
            <div className="flex flex-wrap gap-2">
              <Button type="submit" size="sm" disabled={busy !== null || !description.trim()}>
                <Sparkle size={16} aria-hidden />
                {busy === 'description' ? 'Ci penso…' : 'Prepara il mostro'}
              </Button>
              <Button variant="ghost" size="sm" onClick={onCancel}>
                Annulla
              </Button>
            </div>
          </RowBody>
        </form>
      </Group>
    </div>
  );
}
