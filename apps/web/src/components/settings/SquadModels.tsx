import type { AgentModels, ModelRefView, ProviderView } from '@monsters/shared';
import { Plus, X } from '@phosphor-icons/react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils.ts';
import { getApi, notify, refreshAgents } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { ModelPicker } from './ModelPicker.tsx';
import { modelsStrings } from './models.strings.ts';
import { Group, Row, selectClass } from './parts.tsx';
import {
  accountLabel,
  errorOf,
  firstModel,
  isPaidOpenRouter,
  OPENROUTER_PAID,
  PaidBlocked,
  PaidNotice,
  type ModelListsState,
} from './ProvidersSection.tsx';
import { sameChain, squadModels, withFallback, withMain } from './squad-models.ts';

/*
 * The simple view of what the monsters think with (wave C3, U2-1): "Main model" and "If it doesn't
 * answer, use", for the whole squad. They are the first two links of the chain every monster has;
 * the rest (a model for each monster, more links, tiers, "Automatic") is in Advanced, and a squad
 * whose monsters differ says so instead of showing one of their chains as if it were everyone's.
 */

type Slot = 'main' | 'fallback';

/** One link of the chain: its account (when there is a choice) and its model. */
function LinkFields({
  slot,
  link,
  providers,
  lists,
  freeOnly,
  onAccount,
  onModel,
  onRemove,
}: {
  slot: Slot;
  link: ModelRefView;
  providers: ProviderView[];
  lists: ModelListsState;
  freeOnly: boolean;
  onAccount: (provider: string) => void;
  onModel: (model: string) => void;
  onRemove?: () => void;
}) {
  const s = modelsStrings().squad;
  const configured = providers.filter((p) => p.configured);
  const known = configured.some((p) => p.id === link.provider);
  // The account is asked about only when there is more than one, or the one in use is gone.
  const chooseAccount = configured.length > 1 || !known;
  const name = (id: string) => {
    const p = providers.find((x) => x.id === id);
    return p ? accountLabel(p) : id;
  };
  return (
    <div
      className={cn(
        'grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2',
        chooseAccount && 'sm:grid-cols-[12rem_minmax(0,1fr)_auto]',
      )}
    >
      {chooseAccount && (
        <select
          className={cn(selectClass, 'col-span-2 h-10 w-full sm:col-span-1')}
          aria-label={s.accountOf[slot]}
          value={link.provider}
          onChange={(e) => onAccount(e.target.value)}
        >
          {!known && <option value={link.provider}>{s.notConnected(name(link.provider))}</option>}
          {configured.map((p) => (
            <option key={p.id} value={p.id}>
              {accountLabel(p)}
            </option>
          ))}
        </select>
      )}
      <ModelPicker
        key={link.provider}
        provider={link.provider}
        value={link.model}
        list={lists.models[link.provider]}
        label={s.modelOf[slot]}
        freeOnly={freeOnly}
        onChange={onModel}
      />
      {onRemove && (
        <Button variant="ghost" size="iconSm" aria-label={s.removeFallback} onClick={onRemove}>
          <X size={15} aria-hidden />
        </Button>
      )}
    </div>
  );
}

function SlotRow({ slot, testId, children }: { slot: Slot; testId: string; children: ReactNode }) {
  const s = modelsStrings().squad;
  return (
    <li className="grid gap-2.5 px-4 py-3" data-testid={testId}>
      <div>
        <p className="text-body text-ink">{s.label[slot]}</p>
        <p className="text-footnote leading-snug text-ink-muted">{s.text[slot]}</p>
      </div>
      {children}
    </li>
  );
}

/** "Main model" and "If it doesn't answer, use" for the whole squad. */
export function SquadModels({
  providers,
  agents,
  lists,
  onSaved,
  onPaidEnabled,
  onOpenAdvanced,
  footer,
}: {
  providers: ProviderView[];
  agents: AgentModels[];
  lists: ModelListsState;
  onSaved: (saved: AgentModels) => void;
  onPaidEnabled: () => void;
  onOpenAdvanced: () => void;
  /** Rows after the two choices (the paid-models switch of OpenRouter). */
  footer?: ReactNode;
}) {
  const s = modelsStrings().squad;
  const view = useMemo(() => squadModels(agents), [agents]);
  const core = view.kind === 'shared' ? (agents[0]?.models ?? []) : [];
  /** A chain that cannot be saved yet (a paid OpenRouter model while only free ones are on). */
  const [pending, setPending] = useState<ModelRefView[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const freeOnly = providers.find((p) => p.id === 'openrouter')?.freeOnly === true;
  const blockedIn = (chain: readonly ModelRefView[]) =>
    freeOnly ? chain.filter(isPaidOpenRouter).map((l) => l.model.trim()) : [];
  // A chain that waited stops waiting once nothing blocks it (paid models turned on elsewhere).
  const waiting = pending && blockedIn(pending).length > 0 ? pending : null;
  const shown = waiting ?? core;
  const blocked = blockedIn(shown);
  const { needModels } = lists;
  const shownProviders = shown.slice(0, 2).map((l) => l.provider);

  // The models of the accounts in use are read once they show (a short select, or the search).
  const key = shownProviders.join('|');
  useEffect(() => {
    for (const p of key ? key.split('|') : []) void needModels(p);
  }, [key, needModels]);

  /** Saves a chain to every monster; what the core accepted is applied even if another refused (W-20). */
  const save = async (chain: ModelRefView[]) => {
    setBusy(true);
    setError(null);
    const results = await Promise.allSettled(
      agents.map((a) => getApi().setAgentModels(a.id, chain)),
    );
    const saved = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
    const refused = agents.flatMap((a, i) => {
      const r = results[i]!;
      return r.status === 'rejected' ? [{ agent: a, reason: r.reason as unknown }] : [];
    });
    for (const one of saved) onSaved(one);
    setPending(null);
    if (refused.length === 0) {
      notify(modelsStrings().providers.chain.saved(null), 'success');
    } else if (saved.length === 0) {
      setError(errorOf(refused[0]!.reason));
    } else {
      const text = modelsStrings().providers.chain.partial(
        saved.length,
        refused.map((r) => r.agent.name),
        errorOf(refused[0]!.reason),
      );
      setError(text);
      notify(text, 'error');
    }
    if (saved.length > 0) void refreshAgents().catch(() => {});
    setBusy(false);
  };

  /** A chain chosen here: saved at once, or kept aside while it is blocked. */
  const change = (chain: ModelRefView[]) => {
    if (blockedIn(chain).length > 0) {
      setPending(chain);
      setError(null);
      return;
    }
    if (sameChain(chain, core)) {
      setPending(null);
      return;
    }
    void save(chain);
  };

  /** Paid models turned on from the notice: the chain that waited is saved. */
  const paidEnabled = () => {
    onPaidEnabled();
    if (waiting) void save(waiting);
  };

  /** The first model of an account, once its list is there. */
  const defaultOf = async (provider: string, not?: ModelRefView): Promise<ModelRefView | null> => {
    const list = lists.models[provider];
    const loaded = Array.isArray(list) ? list : await needModels(provider);
    const options = (loaded ?? []).map((m) => m.id);
    const model =
      options.length > 1 &&
      not?.provider === provider &&
      not.model === firstModel(provider, loaded ?? undefined)
        ? options.find((m) => m !== not.model)!
        : firstModel(provider, loaded ?? undefined);
    if (!model) {
      const p = providers.find((x) => x.id === provider);
      setError(s.noModels(p ? accountLabel(p) : provider));
      return null;
    }
    return { provider, model };
  };

  const pickAccount = async (slot: Slot, provider: string) => {
    const now = slot === 'main' ? shown[0] : shown[1];
    if (!now || now.provider === provider) return;
    const next = await defaultOf(provider, slot === 'fallback' ? shown[0] : undefined);
    if (!next) return;
    change(slot === 'main' ? withMain(shown, next) : withFallback(shown, next));
  };

  const addFallback = async () => {
    const main = shown[0];
    if (!main) return;
    const other = providers.find((p) => p.configured && p.id !== main.provider);
    const next = await defaultOf(other?.id ?? main.provider, main);
    if (next) change(withFallback(shown, next));
  };

  if (!providers.some((p) => p.configured)) return null;

  if (view.kind === 'none') return null;
  if (view.kind !== 'shared') {
    const automatic = view.kind === 'automatic';
    return (
      <Group title={s.title} as="ul" testId="squad-models">
        <Row
          as="li"
          testId="squad-models-other"
          label={s.label.main}
          description={automatic ? s.automatic : s.different}
          wrap
        >
          <Button variant="secondary" size="sm" onClick={onOpenAdvanced}>
            {s.inAdvanced}
          </Button>
        </Row>
        {footer}
      </Group>
    );
  }

  const [main, fallback] = shown;
  const paidLink = providers.find(
    (p) => p.paid && shown.slice(0, 2).some((l) => l.provider === p.id),
  );
  const more = view.more;
  return (
    <Group title={s.title} description={s.description} as="ul" testId="squad-models">
      {main && (
        <SlotRow slot="main" testId="squad-main">
          <LinkFields
            slot="main"
            link={main}
            providers={providers}
            lists={lists}
            freeOnly={freeOnly}
            onAccount={(p) => void pickAccount('main', p)}
            onModel={(model) => change(withMain(shown, { provider: main.provider, model }))}
          />
        </SlotRow>
      )}
      {main && (
        <SlotRow slot="fallback" testId="squad-fallback">
          {fallback ? (
            <LinkFields
              slot="fallback"
              link={fallback}
              providers={providers}
              lists={lists}
              freeOnly={freeOnly}
              onAccount={(p) => void pickAccount('fallback', p)}
              onModel={(model) =>
                change(withFallback(shown, { provider: fallback.provider, model }))
              }
              onRemove={() => change(withFallback(shown, null))}
            />
          ) : (
            <div>
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void addFallback()}
              >
                <Plus size={16} aria-hidden /> {s.addFallback}
              </Button>
            </div>
          )}
        </SlotRow>
      )}
      {(more > 0 || paidLink || blocked.length > 0 || error) && (
        <li className="grid gap-2.5 px-4 py-3" data-testid="squad-models-notes">
          {more > 0 && (
            <p className="text-footnote leading-snug text-ink-muted" data-testid="squad-more">
              {s.more(more)}{' '}
              <button
                type="button"
                onClick={onOpenAdvanced}
                className="font-medium text-ink underline underline-offset-2"
              >
                {s.inAdvanced}
              </button>
            </p>
          )}
          {paidLink && <PaidNotice provider={paidLink} />}
          {blocked.length > 0 ? (
            <PaidBlocked models={blocked} onEnabled={paidEnabled} />
          ) : (
            shown.slice(0, 2).some(isPaidOpenRouter) && <PaidNotice provider={OPENROUTER_PAID} />
          )}
          {error && (
            <p className="text-footnote text-stop-ink" role="alert">
              {error}
            </p>
          )}
        </li>
      )}
      {footer}
    </Group>
  );
}
