import {
  ArrowClockwise,
  ArrowCounterClockwise,
  Check,
  FolderSimple,
  ListChecks,
  PencilSimple,
  Shuffle,
  X,
} from '@phosphor-icons/react';
import {
  AGENT_NAME_PATTERN,
  AgentDutySchema,
  MAX_DUTIES,
  agentAreaProblem,
  normalizeAgentArea,
  type OnboardingState,
  type ProposedAgent,
  type TeamConfirmResponse,
  type TeamProposal,
} from '@monsters/shared';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { Monster } from '../components/monster/Monster.tsx';
import { Button, LabeledKey } from '../components/ui/button.tsx';
import { playSound } from '../lib/sound.ts';
import { Input, Label } from '../components/ui/field.tsx';
import { cn, domId } from '../lib/utils.ts';
import { useResolvedTheme } from '../store/hooks.ts';
import { accentInk } from '../theme/bubbles.ts';
import { onboardingApi, onboardingError } from './api.ts';
import { Guide } from './Guide.tsx';
import { modelLabel } from '../store/derive.ts';
import { Badge, DoneCheck, ErrorLine, genomeFrom } from './parts.tsx';

/** "Risorse/Ricerche" → "Ricerche": the folder as the user sees it among the notes. */
function areaName(area: string): string {
  return area.replace(/\/+$/, '').split('/').pop() || area;
}

/** What a member will do and where it may write: shown before the confirmation, editable. */
interface MemberDetails {
  duties: string[];
  area: string;
}

/** Problems of edited details, in Italian; null when they can be saved. */
function detailsProblem(d: MemberDetails): string | null {
  if (d.duties.length === 0) return 'Serve almeno un compito.';
  if (d.duties.length > MAX_DUTIES) return `Al massimo ${MAX_DUTIES} compiti, uno per riga.`;
  for (const duty of d.duties) {
    const parsed = AgentDutySchema.safeParse(duty);
    if (!parsed.success) {
      return `Compito "${duty.slice(0, 30)}": ${parsed.error.issues[0]?.message ?? 'non valido'}`;
    }
  }
  return agentAreaProblem(d.area);
}

function DetailsEditor({
  name,
  details,
  onSave,
  onCancel,
}: {
  name: string;
  details: MemberDetails;
  onSave: (d: MemberDetails) => void;
  onCancel: () => void;
}) {
  const [duties, setDuties] = useState(details.duties.join('\n'));
  const [area, setArea] = useState(details.area);
  const [problem, setProblem] = useState<string | null>(null);
  const id = domId(useId());

  const save = (e: FormEvent) => {
    e.preventDefault();
    const next = {
      duties: duties
        .split('\n')
        .map((l) => l.replace(/^\s*[-*•]\s*/, '').trim())
        .filter(Boolean),
      area: normalizeAgentArea(area),
    };
    const p = detailsProblem(next);
    if (p) return setProblem(p);
    setProblem(null);
    onSave(next);
  };

  return (
    <form onSubmit={save} className="mt-3 grid gap-3" data-testid="member-details-form">
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-duties`}>Compiti di {name} (uno per riga)</Label>
        <textarea
          id={`${id}-duties`}
          value={duties}
          rows={4}
          onChange={(e) => setDuties(e.target.value)}
          className="well w-full resize-y rounded-[10px] px-3.5 py-2.5 text-body leading-snug text-ink focus:outline-2 focus:outline-offset-0 focus:outline-signal-ink"
        />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor={`${id}-area`}>Cartella nelle note di {name}</Label>
        <Input
          id={`${id}-area`}
          value={area}
          maxLength={80}
          onChange={(e) => setArea(e.target.value)}
          className="h-10 px-3.5 text-body"
          aria-invalid={problem ? true : undefined}
        />
      </div>
      {problem && (
        <p className="text-footnote text-stop-ink" role="alert">
          {problem}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Annulla
        </Button>
        <Button type="submit" size="sm" aria-label={`Salva compiti e cartella di ${name}`}>
          <Check size={16} aria-hidden /> Salva
        </Button>
      </div>
    </form>
  );
}

function MemberCard({
  member,
  name,
  details,
  onRename,
  onDetails,
  onRegenerate,
  onRemove,
  canRemove,
  busy,
  taken,
  arrived,
}: {
  /** Came in while the step was on screen (a new or restored monster): it rises in. */
  arrived: boolean;
  member: ProposedAgent;
  name: string;
  details: MemberDetails;
  onRename: (name: string) => void;
  onDetails: (details: MemberDetails) => void;
  onRegenerate: () => void;
  onRemove: () => void;
  canRemove: boolean;
  busy: boolean;
  taken: (name: string) => boolean;
}) {
  const theme = useResolvedTheme();
  const [editing, setEditing] = useState(false);
  // A short "Salvato" after an edit: the change is confirmed where it happened.
  const [saved, setSaved] = useState(0);
  useEffect(() => {
    if (!saved) return;
    const t = setTimeout(() => setSaved(0), 1800);
    return () => clearTimeout(t);
  }, [saved]);
  const [editingDetails, setEditingDetails] = useState(false);
  const [value, setValue] = useState(name);
  const [problem, setProblem] = useState<string | null>(null);
  const id = domId(useId());

  const save = (e?: FormEvent) => {
    e?.preventDefault();
    const v = value.replace(/\s+/g, ' ').trim();
    if (!AGENT_NAME_PATTERN.test(v)) return setProblem('Solo lettere, massimo 24.');
    if (v.toLowerCase() !== name.toLowerCase() && taken(v)) return setProblem('Nome già usato.');
    onRename(v.charAt(0).toUpperCase() + v.slice(1));
    setEditing(false);
    setProblem(null);
    setSaved(Date.now());
  };

  return (
    <li
      data-testid="member"
      data-member={member.id}
      className={cn('card flex flex-col rounded-[14px] p-4', arrived && 'rise-in')}
    >
      <div className="flex items-start gap-3">
        <span className="screen screen-lines flex h-[86px] w-[98px] shrink-0 items-center justify-center rounded-[12px]">
          <Monster genome={genomeFrom(member.genome, name)} size={84} expression="idle" />
        </span>
        <div className="min-w-0 flex-1 pt-1">
          {editing ? (
            <form onSubmit={save} className="grid gap-1">
              <label htmlFor={id} className="sr-only">
                Nuovo nome per {name}
              </label>
              <div className="flex gap-1.5">
                <Input
                  id={id}
                  value={value}
                  maxLength={24}
                  autoFocus
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setEditing(false);
                      setValue(name);
                      setProblem(null);
                    }
                  }}
                  className="h-10 px-3.5"
                  aria-invalid={problem ? true : undefined}
                />
                <Button type="submit" size="iconSm" className="mt-0.5" aria-label="Salva il nome">
                  <Check size={17} aria-hidden />
                </Button>
              </div>
              {problem && <p className="text-footnote text-stop-ink">{problem}</p>}
            </form>
          ) : (
            <h3 className="text-title2 leading-tight font-semibold tracking-[-0.01em] text-ink">
              {name}
            </h3>
          )}
          <p className="label mt-0.5" style={{ color: accentInk(member.color, theme) }}>
            {member.title}
          </p>
          <p className="mt-1 text-body leading-snug text-ink-muted">{member.role}</p>
        </div>
      </div>
      {editingDetails ? (
        <DetailsEditor
          name={name}
          details={details}
          onCancel={() => setEditingDetails(false)}
          onSave={(d) => {
            onDetails(d);
            setEditingDetails(false);
            setSaved(Date.now());
          }}
        />
      ) : (
        <p
          className="mt-3 flex items-center gap-1.5 text-footnote text-ink-muted"
          data-testid="member-area"
        >
          <FolderSimple size={17} className="shrink-0" aria-hidden />
          <span>Lascia il suo lavoro nelle note «{areaName(details.area)}».</span>
        </p>
      )}
      {/* Pushed to the foot of the card: the actions of the two cards line up (audit UI-36). */}
      <div className="mt-auto flex flex-wrap items-end gap-1.5 pt-3">
        {member.tools.some((t) => t.startsWith('web_')) && <Badge>Cerca sul web</Badge>}
        <span role="status" className="flex items-center self-center">
          {saved > 0 && (
            <span
              key={saved}
              className="light-on flex items-center gap-1.5 text-footnote font-semibold text-ink"
              data-testid="member-saved"
            >
              <DoneCheck size={20} /> Salvato
            </span>
          )}
        </span>
        {/* Every action says its name: an icon alone is a guess (audit UI-36). */}
        <span className="ml-auto flex max-w-full flex-wrap items-end justify-end gap-0.5">
          <LabeledKey
            layout="stacked"
            label="Compiti"
            onClick={() => setEditingDetails(true)}
            disabled={busy || editingDetails}
            aria-label={`Personalizza ${name}`}
            title="Compiti e cartella"
          >
            <ListChecks size={18} aria-hidden />
          </LabeledKey>
          <LabeledKey
            layout="stacked"
            label="Nome"
            onClick={() => {
              setValue(name);
              setEditing(true);
            }}
            disabled={busy}
            aria-label={`Rinomina ${name}`}
            title="Rinomina"
          >
            <PencilSimple size={18} aria-hidden />
          </LabeledKey>
          <LabeledKey
            layout="stacked"
            label="Aspetto"
            onClick={onRegenerate}
            disabled={busy}
            aria-label={`Un altro aspetto per ${name}`}
            title="Un altro aspetto"
          >
            <Shuffle size={18} aria-hidden />
          </LabeledKey>
          <LabeledKey
            layout="stacked"
            label="Togli"
            onClick={onRemove}
            disabled={busy || !canRemove}
            aria-label={`Togli ${name} dalla squadra`}
          >
            <X size={16} aria-hidden />
          </LabeledKey>
        </span>
      </div>
    </li>
  );
}

/** Step 4: the proposed team, editable, then confirmed. */
export function TeamStep({
  state,
  onState,
  onConfirmed,
}: {
  state: OnboardingState;
  onState: (s: OnboardingState) => void;
  onConfirmed: (res: TeamConfirmResponse) => void;
}) {
  const [proposal, setProposal] = useState<TeamProposal | null>(state.proposal);
  const [names, setNames] = useState<Record<string, string>>({});
  const [edited, setEdited] = useState<Record<string, MemberDetails>>({});
  const [removed, setRemoved] = useState<string[]>([]);
  /** The monster just taken out: the focus goes to its «Rimetti», not to the page. */
  const justRemoved = useRef<string | null>(null);
  const restoreRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = justRemoved.current;
    if (!id) return;
    justRemoved.current = null;
    restoreRef.current
      ?.querySelector<HTMLButtonElement>(`[data-restore="${CSS.escape(id)}"]`)
      ?.focus();
  });
  const [busy, setBusy] = useState<'propose' | 'confirm' | 'monster' | null>(
    state.proposal ? null : 'propose',
  );
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const guide = genomeFrom(state.guide.genome, state.guide.name);

  const propose = async () => {
    setBusy('propose');
    setError(null);
    try {
      const next = await onboardingApi.propose();
      setProposal(next.proposal);
      setNames({});
      setEdited({});
      setRemoved([]);
      onState(next);
    } catch (err) {
      setError(onboardingError(err));
    } finally {
      setBusy(null);
    }
  };

  useEffect(() => {
    if (started.current || state.proposal) return;
    started.current = true;
    void propose();
    // Only once, when the step opens without a proposal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const regenerate = async (id: string) => {
    setBusy('monster');
    setError(null);
    try {
      const next = await onboardingApi.regenerate(id);
      setProposal((p) =>
        p ? { ...p, members: p.members.map((m) => (m.id === id ? next : m)) } : p,
      );
    } catch (err) {
      setError(onboardingError(err));
    } finally {
      setBusy(null);
    }
  };

  const kept = proposal?.members.filter((m) => !removed.includes(m.id)) ?? [];
  // The monsters on screen when the step opened stay put; the ones that come later rise in.
  const [present] = useState(() => new Set(kept.map((m) => m.id)));
  const nameOf = (m: ProposedAgent) => names[m.id] ?? m.name;
  const detailsOf = (m: ProposedAgent): MemberDetails =>
    edited[m.id] ?? { duties: m.duties, area: m.area };
  const taken = (n: string) =>
    n.toLowerCase() === state.guide.name.toLowerCase() ||
    kept.some((m) => nameOf(m).toLowerCase() === n.toLowerCase());

  const confirm = async () => {
    setBusy('confirm');
    setError(null);
    try {
      const res = await onboardingApi.confirm({
        members: kept.map((m) => ({
          id: m.id,
          ...(names[m.id] && names[m.id] !== m.name ? { name: names[m.id] } : {}),
          ...(edited[m.id] ? { duties: edited[m.id]!.duties, area: edited[m.id]!.area } : {}),
        })),
      });
      onConfirmed(res);
    } catch (err) {
      setError(onboardingError(err));
      setBusy(null);
    }
  };

  if (!proposal) {
    return (
      <div className="grid gap-6" aria-busy={busy === 'propose'}>
        <Guide
          genome={guide}
          name={state.guide.name}
          expression={error ? 'error' : 'think'}
          sayKey={error ? 'propose-error' : 'thinking'}
          say={
            error
              ? 'Ops, mi sono incastrato. Riproviamo?'
              : 'Ci penso un attimo: sto mettendo insieme la squadra giusta per te…'
          }
          hint={error ? undefined : 'Può volerci anche un minuto con i modelli gratuiti.'}
        />
        {error && (
          <>
            <ErrorLine>{error}</ErrorLine>
            <div className="flex justify-end">
              <Button size="lg" onClick={() => void propose()}>
                <ArrowClockwise size={18} aria-hidden /> Riprova
              </Button>
            </div>
          </>
        )}
        {!error && (
          <div className="grid gap-3 sm:grid-cols-2" aria-hidden>
            {[0, 1].map((i) => (
              <div key={i} className="card flex h-[150px] gap-3 rounded-[14px] p-4">
                <span className="screen screen-lines block h-[86px] w-[98px] rounded-[12px]" />
                <span className="grid h-fit flex-1 gap-2 pt-1">
                  <span className="h-5 w-24 rounded-[4px] bg-[color-mix(in_oklab,var(--ink),transparent_90%)]" />
                  <span className="h-3 w-32 rounded-[3px] bg-[color-mix(in_oklab,var(--ink),transparent_93%)]" />
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  const thinking = busy === 'propose';
  return (
    <div className="grid gap-6">
      <Guide
        genome={guide}
        name={state.guide.name}
        expression={thinking ? 'think' : 'happy'}
        sayKey={thinking ? 'rethinking' : `team-${proposal.members.map((m) => m.id).join('-')}`}
        say={
          thinking
            ? 'Ci ripenso un attimo…'
            : `Ecco la squadra che ti propongo: ${kept.length === 1 ? 'un mostro' : `${kept.length} mostri`} più me.`
        }
        hint={
          thinking
            ? undefined
            : 'Puoi togliere qualcuno, cambiare un nome o un aspetto, e con «Compiti» cosa fa ciascuno e dove scrive.'
        }
      />

      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Which model wrote it is not for this screen: a tooltip, never the raw id. */}
        <p
          className="text-footnote text-ink-muted"
          title={
            proposal.source === 'model' && proposal.model
              ? `Scritta da ${modelLabel(proposal.model)}`
              : undefined
          }
        >
          {proposal.source === 'model'
            ? 'Proposta su misura'
            : 'Squadra di partenza, adattata a te'}
        </p>
        <div className="flex items-center gap-2">
          <Badge tone="ok">Il tuo capo: {state.guide.name}</Badge>
        </div>
      </div>

      <ul
        className="grid gap-3 sm:grid-cols-2"
        aria-label="La squadra proposta"
        aria-busy={thinking}
      >
        {kept.map((m) => (
          <MemberCard
            key={m.id}
            arrived={!present.has(m.id)}
            member={m}
            name={nameOf(m)}
            details={detailsOf(m)}
            busy={busy !== null}
            canRemove={kept.length > 1}
            taken={taken}
            onRename={(n) => setNames((x) => ({ ...x, [m.id]: n }))}
            onDetails={(d) => setEdited((x) => ({ ...x, [m.id]: d }))}
            onRegenerate={() => void regenerate(m.id)}
            onRemove={() => {
              setRemoved((r) => [...r, m.id]);
              justRemoved.current = m.id;
            }}
          />
        ))}
      </ul>

      {removed.length > 0 && (
        <div
          ref={restoreRef}
          className="flex flex-wrap items-center gap-2 text-footnote text-ink-muted"
        >
          <span>Tolti:</span>
          {proposal.members
            .filter((m) => removed.includes(m.id))
            .map((m) => (
              <Button
                key={m.id}
                variant="secondary"
                size="sm"
                onClick={() => setRemoved((r) => r.filter((x) => x !== m.id))}
                data-restore={m.id}
                aria-label={`Rimetti ${nameOf(m)} nella squadra`}
              >
                <ArrowCounterClockwise size={16} aria-hidden /> {nameOf(m)}
              </Button>
            ))}
        </div>
      )}

      {error && <ErrorLine>{error}</ErrorLine>}

      <div
        className={cn('flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between')}
      >
        <Button variant="secondary" onClick={() => void propose()} disabled={busy !== null}>
          <ArrowClockwise size={18} aria-hidden /> Proponi un’altra squadra
        </Button>
        <Button
          size="lg"
          onClick={() => {
            playSound('click');
            void confirm();
          }}
          disabled={busy !== null || kept.length === 0}
        >
          {busy === 'confirm' ? 'Li sveglio…' : 'Conferma la squadra'}
          <Check size={18} aria-hidden />
        </Button>
      </div>
    </div>
  );
}
