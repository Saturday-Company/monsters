import { dotPalette } from '@monsters/monster-kit';
import { useId, useState } from 'react';
import { openChat, openPage, settingsPath } from '../../lib/router.ts';
import { domId } from '../../lib/utils.ts';
import { genomeFrom } from '../../onboarding/parts.tsx';
import { errorText, getApi, notify, refreshAgents } from '../../store/app.ts';
import type { ChatItem } from '../../store/derive.ts';
import { handDraft } from '../../store/draft-handoff.ts';
import { useAgent } from '../../store/hooks.ts';
import { MonsterScreen } from '../monster/MonsterScreen.tsx';
import { Button } from '../ui/button.tsx';

/*
 * A new monster proposed by the capo squadra (`team_propose_monster`, D-075):
 * the monster on its screen, what it does, every rule of its AGENTS.md, its
 * tools, where it writes in the notes, its services and its model, in
 * instrument lines (D-079: all that "Crea" writes is in sight). "Crea" adds it with the same
 * request as Settings → Squadra, "Cambia" opens that form filled in, "Lascia
 * stare" closes it; the outcome is an event the capo reads at its next turn.
 */

type Proposal = Extract<ChatItem, { kind: 'proposal' }>;

/** "fake/lyra" → "lyra"; the provider stays in the tooltip. */
const modelName = (m: { provider: string; model: string }) => m.model.split('/').at(-1) ?? m.model;

export function ProposalCard({ item }: { item: Proposal }) {
  const capo = useAgent(item.agent);
  const created = useAgent(item.created?.agent ?? '');
  const [busy, setBusy] = useState<'create' | 'discard' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const uid = domId(useId());
  const d = item.draft;
  const genome = genomeFrom(d.genome, d.name);
  const lit = dotPalette(genome).lit;
  const open = item.status === 'proposed';
  const capoName = capo?.name ?? 'Il tuo capo';
  const model = item.models?.[0];

  const create = async () => {
    setBusy('create');
    setError(null);
    try {
      const added = await getApi().addMember({
        name: d.name,
        title: d.title,
        role: d.role,
        mission: d.mission,
        ...(d.context ? { context: d.context } : {}),
        duties: d.duties,
        area: d.area,
        web: d.web,
        genome: d.genome as Record<string, unknown>,
        archetype: d.archetype,
        proposal: item.id,
      });
      notify(`${added.name} è nella squadra: scrivigli dalla sua chat.`, 'success');
      void refreshAgents().catch(() => {});
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const discard = async () => {
    setBusy('discard');
    setError(null);
    try {
      await getApi().discardProposal(item.id);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(null);
    }
  };

  const change = () => {
    handDraft({ draft: d, proposal: item.id, ...(item.models ? { models: item.models } : {}) });
    openPage(settingsPath('squadra'));
  };

  return (
    <article
      aria-labelledby={`${uid}-t`}
      data-testid="proposal-card"
      data-status={item.status}
      className="card w-full max-w-[600px] rounded-[14px]"
    >
      <p id={`${uid}-t`} className="label px-4 pt-3.5 text-ink-muted">
        {capoName} {open ? 'propone' : 'aveva proposto'} un nuovo mostro
      </p>
      <div className="flex items-stretch gap-3 px-3 pt-2.5">
        <MonsterScreen
          genome={genome}
          mood={open ? 'idle' : item.status === 'created' ? 'done' : 'stopped'}
          width={96}
          height={82}
          animated={open}
          className="shrink-0"
        />
        <div className="screen flex min-w-0 flex-1 flex-col justify-center gap-1 px-3.5 py-2.5">
          <h3 className="flex min-w-0 items-baseline gap-2.5">
            <span
              className="dots truncate text-title1 leading-[28px]"
              style={{ color: lit }}
              aria-hidden
            >
              {d.name}
            </span>
            <span className="sr-only">{d.name}</span>
            <span className="truncate text-footnote text-screen-muted">{d.title}</span>
          </h3>
          <p className="text-footnote leading-snug text-pretty text-screen-ink">{d.role}</p>
        </div>
      </div>

      <dl
        className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 px-4 pt-3 font-mono text-micro leading-[17px]"
        data-testid="proposal-details"
      >
        <dt className="label text-ink-muted">Fa</dt>
        <dd className="font-sans text-footnote leading-snug text-ink">{d.mission}</dd>
        {/* Every rule that goes in its AGENTS.md, as written (D-079): nothing hidden. */}
        <dt className="label text-ink-muted">Regole</dt>
        <dd>
          <ol
            className="grid list-decimal gap-0.5 pl-4 font-sans text-footnote leading-snug text-ink"
            data-testid="proposal-duties"
          >
            {d.duties.map((duty, i) => (
              <li key={i} className="break-words">
                {duty}
              </li>
            ))}
          </ol>
        </dd>
        {d.context && (
          <>
            <dt className="label text-ink-muted">Su di te</dt>
            <dd className="font-sans text-footnote leading-snug text-ink">{d.context}</dd>
          </>
        )}
        <dt className="label text-ink-muted">Strumenti</dt>
        <dd className="text-ink" data-testid="proposal-tools">
          {d.web ? 'NOTE · WEB (cerca e legge pagine)' : 'NOTE'} · niente terminale né file
        </dd>
        <dt className="label text-ink-muted">Note</dt>
        <dd className="text-ink">
          legge tutte · scrive in <span className="break-all">{d.area}/</span>, Inbox/
        </dd>
        <dt className="label text-ink-muted">Servizi</dt>
        <dd className="text-ink">nessuno</dd>
        <dt className="label text-ink-muted">Modello</dt>
        <dd className="text-ink" title={model ? `${model.provider}/${model.model}` : undefined}>
          {model ? `${modelName(model)} (${model.provider})` : `come ${capoName}`}
        </dd>
      </dl>

      {open ? (
        <div className="grid gap-2 px-3 pt-3.5 pb-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              disabled={busy !== null}
              onClick={() => void create()}
              data-testid="proposal-create"
            >
              {busy === 'create' ? 'Lo sveglio…' : 'Crea'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={change}
              data-testid="proposal-change"
            >
              Cambia
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy !== null}
              onClick={() => void discard()}
              data-testid="proposal-discard"
            >
              Lascia stare
            </Button>
          </div>
          <p className="px-1 text-footnote text-ink-muted">
            Non esiste finché non lo crei tu. Gli strumenti e i collegamenti li cambi poi in
            Impostazioni.
          </p>
          {error && (
            <p role="alert" className="px-1 text-footnote text-stop-ink">
              {error}
            </p>
          )}
        </div>
      ) : item.status === 'created' ? (
        <div className="flex flex-wrap items-center gap-3 px-4 pt-3 pb-3.5">
          <p className="flex items-center gap-2 text-body text-ink-muted">
            <span aria-hidden className="led" data-tone="ok" />
            <span>
              Creato: <strong className="font-semibold text-ink">{item.created?.name}</strong>
            </span>
          </p>
          {created && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => openChat(created.id)}
              data-testid="proposal-open-chat"
            >
              Apri la chat di {created.name}
            </Button>
          )}
        </div>
      ) : (
        <p className="flex items-center gap-2 px-4 pt-3 pb-3.5 text-body text-ink-muted">
          <span aria-hidden className="led" />
          <span>Lasciato stare: non l’hai creato.</span>
        </p>
      )}
    </article>
  );
}
