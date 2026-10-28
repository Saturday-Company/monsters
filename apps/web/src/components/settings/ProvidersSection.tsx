import {
  ArrowSquareOut,
  ArrowUp,
  CurrencyCircleDollar,
  Info,
  Plus,
  X,
} from '@phosphor-icons/react';
import {
  AUTO_MODELS_PROVIDER,
  autoChain,
  autoEffort,
  CLAUDE_PLAN_MODELS,
  EFFORT_WORD,
  isOpenRouterFreeModel,
  ProviderKeyRequestSchema,
  SETTINGS_SECTIONS,
  ProviderUrlRequestSchema,
  type AgentModels,
  type AutoBase,
  type ModelInfoView,
  type ModelRefView,
  type ProviderView,
} from '@monsters/shared';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError, describeError } from '../../lib/api.ts';
import { settingsPath } from '../../lib/router.ts';
import { cn, domId } from '../../lib/utils.ts';
import { getApi, notify, refreshAgents } from '../../store/app.ts';
import { Button, buttonVariants } from '../ui/button.tsx';
import { Segmented, Switch } from '../ui/controls.tsx';
import { Input } from '../ui/field.tsx';
import { ModelPicker, modelName, type ModelList } from './ModelPicker.tsx';
import { serviceLabel } from './data.ts';
import { modelsStrings } from './models.strings.ts';
import { partsStrings } from './parts.strings.ts';
import {
  AgentMark,
  DisclosureRow,
  fieldOnGroup,
  FormField,
  Group,
  RowBody,
  selectClass,
} from './parts.tsx';

/*
 * Settings → Modelli, the accounts with a key or an address (M2.2) and, in Advanced, the chain of
 * models of every monster, saved by itself at each change.
 */

/**
 * What a model provider is called: "OpenRouter account" for one with a key, the plan for Claude and
 * ChatGPT, the program for a local server (glossary: an account, never a "service").
 */
export function accountLabel(
  p: Pick<ProviderView, 'id' | 'label'> & { local?: boolean; subscription?: boolean },
): string {
  if (p.local || p.subscription) return serviceLabel(p.id, p.label);
  return serviceLabel(p.id, modelsStrings().providers.account(p.label));
}

/** One line on what each account is, in plain words. */
export function aboutOf(id: string): string | undefined {
  return modelsStrings().providers.about[id];
}

/** The message of the core when it has a specific one, the generic one otherwise. */
export function errorOf(err: unknown): string {
  if (err instanceof ApiError && err.message && err.message !== err.code) {
    if (
      [
        'invalid_key',
        'verification_failed',
        'key_from_env',
        'not_configured',
        'unknown_provider',
        'paid_model_blocked',
      ].includes(err.code)
    ) {
      return err.message;
    }
  }
  return describeError(err);
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

export function tagOf(p: ProviderView): string {
  const s = modelsStrings().providers.tag;
  if (p.local) return s.local;
  if (p.paid && p.freeTier) return s.payAsYouGoFree;
  if (p.paid) return s.payAsYouGo;
  return s.free;
}

/** A small neutral label next to a name. */
export function Tag({ children }: { children: string }) {
  return (
    <span className="label rounded-[5px] px-1.5 py-px whitespace-nowrap text-ink-muted shadow-[inset_0_0_0_1px_var(--seam)]">
      {children}
    </span>
  );
}

/** The cost and privacy note shown before a paid service (or paid OpenRouter models) is used. */
export function PaidNotice({
  provider,
  className,
}: {
  provider: Pick<ProviderView, 'label' | 'freeTier'>;
  className?: string;
}) {
  const s = modelsStrings().providers;
  return (
    <div
      className={cn(
        'flex gap-2.5 rounded-[10px] bg-panel px-3.5 py-3 text-footnote leading-snug text-ink-muted shadow-[0_0_0_1px_var(--seam)]',
        className,
      )}
      data-testid="paid-notice"
    >
      <CurrencyCircleDollar size={20} className="mt-px shrink-0 text-ink" aria-hidden />
      <p>
        <strong className="font-semibold text-ink">{s.paidTitle}</strong>{' '}
        {s.paidText(provider.label, !!provider.freeTier)}
      </p>
    </div>
  );
}

/** The key (or the address of a local server) of one service, verified before it is saved. */
export function ProviderForm({
  p,
  onDone,
  onCancel,
}: {
  p: ProviderView;
  onDone: () => void;
  onCancel: () => void;
}) {
  const s = modelsStrings().providers.form;
  const common = partsStrings();
  const id = domId(useId());
  const [value, setValue] = useState(p.local ? (p.baseURL ?? '') : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const label = serviceLabel(p.id, p.label);
  const change = p.configured;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (p.local) {
        const parsed = ProviderUrlRequestSchema.safeParse({ baseURL: value });
        if (!parsed.success) {
          setError(s.urlInvalid);
          return;
        }
        await getApi().setProviderUrl(p.id, parsed.data.baseURL);
        notify(s.connected(label), 'success');
      } else if (p.id === 'openrouter') {
        if (!value.trim().startsWith('sk-or-')) {
          setError(s.openrouterPrefix);
          return;
        }
        await getApi().setOpenRouterKey(value.trim());
        notify(s.saved, 'success');
      } else {
        const parsed = ProviderKeyRequestSchema.safeParse({ key: value });
        if (!parsed.success) {
          setError(s.keyInvalid);
          return;
        }
        await getApi().setProviderKey(p.id, parsed.data.key);
        notify(s.verified(label), 'success');
      }
      setValue(p.local ? value : '');
      onDone();
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <RowBody>
        {p.paid && <PaidNotice provider={p} />}
        <FormField
          id={id}
          label={p.local ? s.addressOf(label) : change ? s.newKey : s.keyOf(label)}
          error={error}
          hint={p.local ? s.localHint(label) : s.keyHint}
        >
          <Input
            id={id}
            type={p.local ? 'url' : 'password'}
            autoComplete="off"
            spellCheck={false}
            placeholder={p.local ? 'http://127.0.0.1:11434' : `${p.keyPrefix ?? ''}…`}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            className={fieldOnGroup}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : `${id}-hint`}
          />
        </FormField>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="submit" size="sm" disabled={busy || !value.trim()}>
            {busy ? s.checking : p.local ? s.connect : s.verifyAndSave}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {common.cancel}
          </Button>
          {p.keyUrl && !p.local && (
            <a
              href={p.keyUrl}
              target="_blank"
              rel="noreferrer"
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'sm:ml-auto')}
            >
              {s.createKey(hostOf(p.keyUrl))}
              <ArrowSquareOut size={16} aria-hidden />
            </a>
          )}
        </div>
      </RowBody>
    </form>
  );
}

export type ModelLists = Record<string, ModelInfoView[] | 'loading' | 'error'>;

export { modelName };

/** The OpenRouter cost note: paid models are billed to the user's OpenRouter account. */
export const OPENROUTER_PAID = { label: 'OpenRouter', freeTier: false };

/** A paid OpenRouter model (anything but the free router and `:free` variants). */
export function isPaidOpenRouter(link: ModelRefView): boolean {
  return (
    link.provider === 'openrouter' &&
    !!link.model.trim() &&
    !isOpenRouterFreeModel(link.model.trim())
  );
}

/**
 * Paid OpenRouter models chosen while OpenRouter is limited to free ones: the
 * chain cannot be saved, and the user can turn paid models on right here,
 * after reading what they cost.
 */
export function PaidBlocked({ models, onEnabled }: { models: string[]; onEnabled: () => void }) {
  const s = modelsStrings().providers.blocked;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enable = async () => {
    setBusy(true);
    setError(null);
    try {
      await getApi().setOpenRouterFreeOnly(false);
      notify(s.enabled, 'success');
      onEnabled();
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="grid gap-2.5" data-testid="paid-blocked">
      <p className="text-footnote leading-snug text-ink" role="status">
        <strong className="font-semibold">{models.join(', ')}</strong> {s.text(models.length)}
      </p>
      <PaidNotice provider={OPENROUTER_PAID} />
      {error && (
        <p className="text-footnote text-stop-ink" role="alert">
          {error}
        </p>
      )}
      <Button
        size="sm"
        className="justify-self-start"
        disabled={busy}
        onClick={() => void enable()}
      >
        {busy ? s.turningOn : s.button}
      </Button>
    </div>
  );
}

const same = (a: readonly ModelRefView[], b: readonly ModelRefView[]) =>
  JSON.stringify(a) === JSON.stringify(b);

/** Time after the last change before a chain saves itself (typing a model name). */
const SAVE_AFTER_MS = 700;

/** The words of a base level of "Automatic". */
export function autoBaseLabel(base: AutoBase): string {
  return modelsStrings().providers.base[base];
}

/** What an automatic chain does, in one line: "Usually Sonnet (medium effort) · hard → Opus (high effort)". */
export function autoLine(base: AutoBase): string {
  const s = modelsStrings().providers.autoLine;
  const chain = autoChain(base);
  const base_ = (id: string) => CLAUDE_PLAN_MODELS.find((m) => m.id === id)?.name ?? id;
  // "Sonnet (medium effort)": the effort of the model in "Automatic" (D-110).
  const name = (id: string) => {
    const effort = autoEffort(id);
    return effort ? s.withEffort(base_(id), EFFORT_WORD[effort]) : base_(id);
  };
  const usual = chain[0]!;
  const light = chain.find((m) => m.tier === 'light');
  const strong = chain.find((m) => m.tier === 'strong');
  return [
    s.usually(name(usual.model)),
    light && light !== usual ? s.simple(name(light.model)) : null,
    strong && strong !== usual ? s.hard(name(strong.model)) : null,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** The base of a monster in "Automatic": its own, or the one of its archetype. */
export const baseOf = (a: AgentModels): AutoBase => a.auto?.base ?? a.suggestedBase ?? 'medium';

/** The editor's state: the chain, and the base when it is "Automatica". */
interface ChainState {
  links: ModelRefView[];
  auto: AutoBase | null;
}

const stateOf = (a: AgentModels): ChainState => ({
  links: a.models,
  auto: a.auto ? a.auto.base : null,
});
const sameState = (a: ChainState, b: ChainState) => a.auto === b.auto && same(a.links, b.links);

/**
 * What "Automatic" needs (U2-29): the expert model decides whether a request is quick or thorough.
 * Without it the base stays; the row says so and links to where it is turned on (Squad > Advanced >
 * Monsters' decisions), instead of naming the place in plain text.
 */
function NeedsExpert() {
  const s = modelsStrings().providers.chain;
  const [state, setState] = useState<'unknown' | 'ready' | 'off' | 'needs'>('unknown');
  useEffect(() => {
    let alive = true;
    getApi()
      .instinct()
      .then((view) => {
        if (!alive) return;
        const tier = view.uses.find((u) => u.id === 'tier');
        setState(
          tier?.active && tier.mode === 'on' ? 'ready' : tier?.mode === 'off' ? 'off' : 'needs',
        );
      })
      .catch(() => alive && setState('unknown'));
    return () => {
      alive = false;
    };
  }, []);
  return (
    <div className="grid gap-1.5" data-testid="auto-expert" data-state={state}>
      {(state === 'off' || state === 'needs') && (
        <p
          className="flex items-start gap-1.5 text-footnote leading-snug text-ink"
          data-testid="auto-needs-expert"
        >
          <Info size={17} aria-hidden className="mt-px shrink-0 text-ink-muted" />
          <span>
            <strong className="font-semibold">
              {state === 'off' ? s.expertOff : s.needsExpert}
            </strong>{' '}
            {s.needsExpertText}{' '}
            <a
              href={settingsPath('istinto')}
              className="font-medium text-ink underline underline-offset-2"
              data-testid="auto-expert-link"
            >
              {s.expertLink}
            </a>
          </span>
        </p>
      )}
      <p className="text-footnote leading-snug text-ink-muted">{s.limitFallback}</p>
    </div>
  );
}

function ChainEditor({
  agent,
  team,
  providers,
  models,
  needModels,
  onPaidEnabled,
  onSaved,
}: {
  agent: AgentModels;
  /** One chain for the whole team: saved to every monster of the list. */
  team?: readonly AgentModels[];
  providers: ProviderView[];
  models: ModelLists;
  needModels: (provider: string) => Promise<ModelInfoView[] | null>;
  onPaidEnabled: () => void;
  /** The chain the core saved: the page keeps it, so the editor is not reset. */
  onSaved: (saved: AgentModels) => void;
}) {
  // The team editor in "Automatic" stands for every base: it shows the mode, not one base.
  const fromCore = stateOf(agent);
  /** What the core has: a change of it from outside replaces an untouched editor. */
  const [base, setBase] = useState<ChainState>(fromCore);
  const [edit, setEdit] = useState<ChainState>(fromCore);
  const [seen, setSeen] = useState<ChainState>(fromCore);
  if (!sameState(seen, fromCore)) {
    setSeen(fromCore);
    if (sameState(edit, base)) setEdit(fromCore);
    setBase(fromCore);
  }
  const { links, auto } = edit;
  const setLinks = (f: (ls: ModelRefView[]) => ModelRefView[]) =>
    setEdit((e) => ({ ...e, links: f(e.links) }));
  const [error, setError] = useState<string | null>(null);
  const configured = providers.filter((p) => p.configured);
  const claude = configured.some((p) => p.id === AUTO_MODELS_PROVIDER);
  const label = (id: string) => {
    const p = providers.find((x) => x.id === id);
    return p ? accountLabel(p) : serviceLabel(id);
  };
  const dirty = !sameState(edit, base);
  const manual = auto === null;
  const paid = manual
    ? providers.find((p) => p.paid && links.some((l) => l.provider === p.id))
    : undefined;
  /** OpenRouter refuses paid models until the switch in its settings is on. */
  const freeOnly = providers.find((p) => p.id === 'openrouter')?.freeOnly === true;
  const paidOpenRouter = manual ? links.filter(isPaidOpenRouter).map((l) => l.model.trim()) : [];
  const blocked = freeOnly ? paidOpenRouter : [];
  const incomplete = manual && links.some((l) => !l.model.trim());
  const saving = useRef(0);
  const s = modelsStrings().providers.chain;
  const who = team ? s.everyone : agent.name;
  // A single model is not a chain: no order to change, nothing to take away.
  const chain = links.length > 1;

  useEffect(() => {
    if (!manual) return;
    for (const l of links) void needModels(l.provider);
  }, [links, manual, needModels]);

  /** The save waiting for its moment: sent at once if the editor goes away before that. */
  const due = useRef<(() => void) | null>(null);
  useEffect(
    () => () => {
      const send = due.current;
      due.current = null;
      send?.();
    },
    [],
  );

  // Saved by itself, a moment after the last change, when it can be.
  useEffect(() => {
    due.current = null;
    if (!dirty || incomplete || blocked.length > 0) return;
    const sent: ChainState = {
      auto,
      links: links.map((l) => ({
        provider: l.provider,
        model: l.model.trim(),
        // The tier of a link stays (D-067, D-093): zod used to drop it at every save.
        ...(l.tier ? { tier: l.tier } : {}),
      })),
    };
    const send = () => {
      due.current = null;
      const ticket = ++saving.current;
      setError(null);
      const targets = team ?? [agent];
      // One request per monster, none waiting for the others: what the core accepted is applied
      // even if another refused (W-20), and the refusal is said with the monsters' names.
      void Promise.allSettled(
        targets.map((a) => {
          if (sent.auto === null) return getApi().setAgentModels(a.id, sent.links);
          // "Same for everyone" with Automatic: each monster on its own base (D-093).
          const b = team ? baseOf(a) : sent.auto;
          return getApi().setAgentModels(a.id, autoChain(b), { base: b });
        }),
      ).then((results) => {
        if (ticket !== saving.current) return;
        const saved = results.flatMap((r) => (r.status === 'fulfilled' ? [r.value] : []));
        const refused = targets.flatMap((a, i) => {
          const r = results[i]!;
          return r.status === 'rejected' ? [{ agent: a, reason: r.reason as unknown }] : [];
        });
        for (const one of saved) onSaved(one);
        if (refused.length === 0) {
          const now = stateOf(saved[0]!);
          setBase(now);
          setSeen(now);
          setEdit((e) => (sameState(e, sent) ? now : e));
          notify(s.saved(team ? null : agent.name), 'success');
        } else if (saved.length === 0) {
          setError(errorOf(refused[0]!.reason));
        } else {
          // Some saved and some not: the monsters now have different chains, so "same for
          // everyone" gives way to one chain each, which is the truth.
          const text = s.partial(
            saved.length,
            refused.map((r) => r.agent.name),
            errorOf(refused[0]!.reason),
          );
          setError(text);
          notify(text, 'error');
        }
        // The composer shows which plan an agent uses (M2.7).
        if (saved.length > 0) void refreshAgents().catch(() => {});
      });
    };
    due.current = send;
    const t = setTimeout(send, SAVE_AFTER_MS);
    return () => clearTimeout(t);
    // `edit` carries every change; the rest follows from it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edit, dirty, incomplete, blocked.length]);

  const update = (i: number, patch: Partial<ModelRefView>) =>
    setLinks((ls) => ls.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  const pickProvider = (i: number, provider: string) => {
    const list = models[provider];
    // A new account: its default model, and no tier (it was the other model's).
    update(i, { provider, model: firstModel(provider, list), tier: undefined });
    // The list arrives later: its first model fills a link still empty.
    void needModels(provider).then((loaded) => {
      const first = firstModel(provider, loaded ?? undefined);
      if (!first) return;
      setLinks((ls) =>
        ls.map((l, j) =>
          j === i && l.provider === provider && !l.model ? { ...l, model: first } : l,
        ),
      );
    });
  };

  const setAuto = (on: boolean) =>
    setEdit((e) =>
      on
        ? {
            links: autoChain(team ? 'medium' : baseOf(agent)),
            auto: team ? 'medium' : baseOf(agent),
          }
        : // Back to a chain of its own: the automatic one, to change by hand.
          { auto: null, links: e.links },
    );
  const setAutoBase = (b: AutoBase) => setEdit({ auto: b, links: autoChain(b) });

  return (
    <li
      className="grid gap-2.5 px-4 py-3"
      data-testid={team ? 'team-chain' : `agent-chain-${agent.id}`}
      data-auto={auto ?? 'off'}
    >
      <div className="flex items-center gap-2">
        {team ? (
          <span className="flex -space-x-2" aria-hidden>
            {team.slice(0, 5).map((a) => (
              <AgentMark key={a.id} id={a.id} color={a.color} width={30} height={26} />
            ))}
          </span>
        ) : (
          <AgentMark id={agent.id} color={agent.color} width={36} height={30} />
        )}
        <h3 className="text-body font-semibold text-ink">{team ? s.allMonsters : agent.name}</h3>
        {!team && agent.isOrchestrator && <span className="label text-signal-ink">{s.lead}</span>}
        <span className="ml-auto label text-ink-muted" aria-live="polite">
          {dirty && !incomplete && blocked.length === 0 ? s.saving : ''}
        </span>
      </div>
      {(claude || !manual) && (
        <div className="flex min-h-11 items-center gap-3" data-testid="auto-models">
          <div className="min-w-0 flex-1">
            <p className="text-body font-medium text-ink">{s.automatic}</p>
            <p className="text-footnote leading-snug text-ink-muted">{s.automaticText}</p>
          </div>
          <Switch
            words
            checked={!manual}
            onCheckedChange={setAuto}
            label={s.automaticLabel(who)}
            disabled={!claude && manual}
          />
        </div>
      )}
      {!manual ? (
        <div className="grid gap-2.5">
          {team ? (
            <p className="text-footnote leading-snug text-ink-muted" data-testid="auto-team">
              {s.teamAuto}
            </p>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="text-footnote font-medium text-ink">{s.baseWord}</span>
                <Segmented
                  size="sm"
                  label={s.baseOf(who)}
                  value={auto}
                  onChange={setAutoBase}
                  options={(['light', 'medium', 'strong'] as const).map((b) => ({
                    value: b,
                    label: autoBaseLabel(b),
                  }))}
                />
              </div>
              <p
                className="screen rounded-[10px] px-3.5 py-2.5 font-mono text-micro leading-[19px] text-screen-ink"
                data-testid="auto-line"
              >
                {autoLine(auto)}
              </p>
            </>
          )}
          <NeedsExpert />
        </div>
      ) : (
        <ol className="grid gap-1.5">
          {links.map((l, i) => {
            const list = models[l.provider];
            const known = configured.some((p) => p.id === l.provider);
            return (
              <li
                key={i}
                className="grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-x-2 gap-y-1.5 sm:grid-cols-[1.5rem_12rem_minmax(0,1fr)_auto]"
              >
                <span
                  className={cn('label pt-3 text-center text-ink-muted', !chain && 'invisible')}
                >
                  {String(i + 1).padStart(2, '0')}
                </span>
                <select
                  className={cn(selectClass, 'h-10 w-full')}
                  aria-label={s.accountOf(i + 1, who)}
                  value={l.provider}
                  onChange={(e) => pickProvider(i, e.target.value)}
                >
                  {!known && (
                    <option value={l.provider}>{s.notConnected(label(l.provider))}</option>
                  )}
                  {configured.map((p) => (
                    <option key={p.id} value={p.id}>
                      {accountLabel(p)}
                    </option>
                  ))}
                </select>
                <div className="col-start-2 row-start-2 sm:col-start-3 sm:row-start-1">
                  <ModelPicker
                    key={l.provider}
                    provider={l.provider}
                    value={l.model}
                    list={list}
                    label={s.modelOf(i + 1, who)}
                    freeOnly={freeOnly}
                    onChange={(model) => update(i, { model })}
                  />
                  {l.tier && (
                    <p className="mt-1 px-1 label text-ink-muted" data-testid="link-tier">
                      {l.tier === 'light' ? s.tierLight : s.tierStrong}
                    </p>
                  )}
                </div>
                <div
                  className={cn('col-start-3 row-start-1 flex sm:col-start-4', !chain && 'hidden')}
                >
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={s.moveUp(i + 1, who)}
                    disabled={i === 0}
                    onClick={() =>
                      setLinks((ls) => {
                        const next = [...ls];
                        [next[i - 1], next[i]] = [next[i]!, next[i - 1]!];
                        return next;
                      })
                    }
                  >
                    <ArrowUp size={17} aria-hidden />
                  </Button>
                  <Button
                    variant="ghost"
                    size="iconSm"
                    aria-label={s.remove(i + 1, who)}
                    disabled={links.length <= 1}
                    onClick={() => setLinks((ls) => ls.filter((_, j) => j !== i))}
                  >
                    <X size={15} aria-hidden />
                  </Button>
                </div>
              </li>
            );
          })}
        </ol>
      )}
      {paid && <PaidNotice provider={paid} />}
      {blocked.length > 0 ? (
        <PaidBlocked models={blocked} onEnabled={onPaidEnabled} />
      ) : (
        paidOpenRouter.length > 0 && <PaidNotice provider={OPENROUTER_PAID} />
      )}
      {error && (
        <p className="text-footnote text-stop-ink" role="alert">
          {error}
        </p>
      )}
      {manual && (
        <div>
          <Button
            variant="ghost"
            size="sm"
            className="-ml-2"
            disabled={links.length >= 6 || configured.length === 0}
            onClick={() => {
              const first = configured[0]!.id;
              setLinks((ls) => [
                ...ls,
                { provider: first, model: firstModel(first, models[first]) },
              ]);
            }}
          >
            <Plus size={16} aria-hidden /> {s.addAlternative}
          </Button>
        </div>
      )}
    </li>
  );
}

/** The model a new link of a service starts on: Sonnet on the Claude plan, else the first. */
export function firstModel(provider: string, list: ModelList): string {
  if (!Array.isArray(list)) return '';
  if (provider === AUTO_MODELS_PROVIDER && list.some((m) => m.id === 'sonnet')) return 'sonnet';
  return list[0]?.id ?? '';
}

export type ModelListsState = {
  models: ModelLists;
  needModels: (provider: string) => Promise<ModelInfoView[] | null>;
};

const NO_PROVIDERS: ProviderView[] = [];

/**
 * Model lists by account, for one set of configured accounts: an account added, changed or removed
 * makes a new set, and its lists are read again. The simple view and Advanced share them.
 */
export function useModelLists(providers: ProviderView[] = NO_PROVIDERS): ModelListsState {
  const configuredKey = providers
    .filter((p) => p.configured)
    .map((p) => `${p.id}:${p.freeOnly ?? ''}:${p.baseURL ?? ''}`)
    .join('|');
  const [lists, setLists] = useState<{ key: string; models: ModelLists }>({
    key: configuredKey,
    models: {},
  });
  const models = lists.key === configuredKey ? lists.models : {};
  /** Model lists asked for, by set and account (one request each). */
  const requested = useRef(new Map<string, Promise<ModelInfoView[] | null>>());

  const needModels = useCallback(
    (provider: string): Promise<ModelInfoView[] | null> => {
      const configured = providers.some((p) => p.id === provider && p.configured);
      if (!configured) return Promise.resolve(null);
      const id = `${configuredKey}#${provider}`;
      const asked = requested.current.get(id);
      if (asked) return asked;
      const put = (value: ModelLists[string]) =>
        setLists((l) => ({
          key: configuredKey,
          models: { ...(l.key === configuredKey ? l.models : {}), [provider]: value },
        }));
      put('loading');
      const loading = getApi()
        .providerModels(provider)
        .then((r) => {
          put(r.models);
          return r.models;
        })
        .catch(() => {
          requested.current.delete(id);
          put('error');
          return null;
        });
      requested.current.set(id, loading);
      return loading;
    },
    // The set of configured accounts is all that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [configuredKey],
  );
  return { models, needModels };
}

/**
 * Advanced: one chain per monster, each saved by itself, with the order, up to six links, the
 * Quick / Balanced / Thorough tiers and "Automatic". The simple view above edits the first two
 * links of the same chains.
 */
export function ChainsAdvanced({
  providers,
  agents,
  lists,
  open,
  onOpenChange,
  onPaidEnabled,
  onSaved,
}: {
  providers: ProviderView[];
  agents: AgentModels[];
  lists: ModelListsState;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPaidEnabled: () => void;
  onSaved: (saved: AgentModels) => void;
}) {
  const s = modelsStrings().providers.group;
  const { models, needModels } = lists;
  const first = agents[0];
  // Every monster in "Automatica" counts as the same choice, whatever its base (D-093).
  const alike =
    !!first &&
    (agents.every((a) => a.auto !== undefined) ||
      agents.every((a) => a.auto === undefined && same(a.models, first.models)));
  // One chain for everybody until the user asks for one per monster (UX 6).
  const [perMonster, setPerMonster] = useState(!alike);
  const each = perMonster || !alike;

  const toggle = (
    <li className="px-4 pt-1 pb-3">
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2"
        aria-expanded={each}
        data-testid="chains-per-monster"
        onClick={() => setPerMonster(!each)}
        disabled={each && !alike}
        title={each && !alike ? s.different : undefined}
      >
        {each ? s.same : s.each}
      </Button>
    </li>
  );

  return (
    <Group label={SETTINGS_SECTIONS.avanzate.label} id="settings-modelli-avanzate" testId="chains">
      <DisclosureRow
        as="div"
        label={SETTINGS_SECTIONS.avanzate.label}
        description={s.advancedHint}
        open={open}
        onOpenChange={onOpenChange}
        testId="chains-advanced-toggle"
        advanced
      >
        <p className="max-w-[62ch] px-4 pt-3 text-footnote leading-snug text-ink-muted">
          {s.description}
        </p>
        <ul className="set-rows" data-testid="chains-list">
          {each
            ? agents.map((a) => (
                <ChainEditor
                  key={a.id}
                  agent={a}
                  providers={providers}
                  models={models}
                  needModels={needModels}
                  onPaidEnabled={onPaidEnabled}
                  onSaved={onSaved}
                />
              ))
            : first && (
                <ChainEditor
                  key="team"
                  agent={first}
                  team={agents}
                  providers={providers}
                  models={models}
                  needModels={needModels}
                  onPaidEnabled={onPaidEnabled}
                  onSaved={onSaved}
                />
              )}
          {agents.length > 1 && (alike || each) && toggle}
        </ul>
      </DisclosureRow>
    </Group>
  );
}
