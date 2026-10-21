import {
  ArrowRight,
  ArrowSquareOut,
  ChatCircleDots,
  Gift,
  Info,
  Key,
  Terminal,
  type Icon,
} from '@phosphor-icons/react';
import type { MonsterGenome } from '@monsters/monster-kit';
import {
  ProviderKeyRequestSchema,
  type OnboardingAccess,
  type OnboardingState,
  type SubscriptionsResponse,
} from '@monsters/shared';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ChatGPTWelcome } from '../components/settings/SubscriptionsSection.tsx';
import { subscriptionsStrings } from '../components/settings/subscriptions.strings.ts';
import { Button } from '../components/ui/button.tsx';
import { Field, Input } from '../components/ui/field.tsx';
import { ApiError, describeError } from '../lib/api.ts';
import { cn, domId, eurFirst } from '../lib/utils.ts';
import { getApi } from '../store/app.ts';
import { onboardingApi, onboardingError } from './api.ts';
import { accessStrings } from './access.strings.ts';
import { Guide } from './Guide.tsx';
import { chainHint, keyKind, rankConnected, type Connected, type KeyKind } from './models.ts';
import { DoneCheck, ErrorLine } from './parts.tsx';
import { Meter } from '../components/ui/Meter.tsx';
import { playSound } from '../lib/sound.ts';

/*
 * Step 1 (D-053): how Monsters reaches a model. Three ways, one is enough:
 * free models with an OpenRouter key, the user's Claude subscription through
 * Claude Code (Claude Agent harness, D-035) or the ChatGPT plan (Sign in with
 * ChatGPT). A key of a paid provider is recognised by its prefix and saved
 * with the providers API (audit 2.5). Every way connects on its own: "Continua"
 * works as soon as one is connected, whatever card is open (audit 2.2).
 * "Lo faccio dopo" goes on without a model: the app says so.
 */

interface Way {
  id: OnboardingAccess;
  icon: Icon;
}

// The subscription first (choice of 16/10), the free models last. The words of
// each way (title, text, the name in the guide's confirmation) are in access.strings.ts.
const WAYS: Way[] = [
  { id: 'claude-agent', icon: Terminal },
  { id: 'chatgpt', icon: ChatCircleDots },
  { id: 'openrouter', icon: Gift },
];

function errorOf(err: unknown): string {
  if (err instanceof ApiError && err.message && err.message !== err.code) return err.message;
  return describeError(err);
}

/** Card of one way to a model: a radio that opens its panel, with a check once connected. */
function WayCard({
  way,
  selected,
  ready,
  onSelect,
}: {
  way: Way;
  selected: boolean;
  ready: boolean;
  onSelect: () => void;
}) {
  const Icon = way.icon;
  const s = accessStrings();
  const words = s.ways[way.id];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      data-testid={`way-${way.id}`}
      data-ready={ready ? 'yes' : 'no'}
      data-pressed={selected ? 'true' : undefined}
      className={cn(
        'key group relative flex h-full flex-col items-start gap-1.5 rounded-[14px] p-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink',
        selected && '[--cap:var(--panel)]',
      )}
    >
      <span className="mb-1 flex w-full items-center justify-between gap-2">
        <span
          className="well flex size-9 items-center justify-center rounded-[9px] text-ink"
          aria-hidden
        >
          <Icon size={20} />
        </span>
        {ready ? (
          <span className="label flex items-center gap-1.5 text-ink">
            <DoneCheck size={18} />
            {s.connected}
          </span>
        ) : (
          <span aria-hidden className="led" data-tone={selected ? 'signal' : undefined} />
        )}
      </span>
      <span className="text-large leading-tight font-semibold text-ink">{words.title}</span>
      <span className="text-footnote leading-snug text-ink-muted">{words.text}</span>
    </button>
  );
}

function Note({ icon: Icon = Info, children }: { icon?: Icon; children: React.ReactNode }) {
  return (
    <div className="card flex gap-3 rounded-[12px] px-3.5 py-3 text-body leading-snug text-ink-muted">
      <Icon size={20} className="mt-0.5 shrink-0 text-ink" aria-hidden />
      <div className="grid gap-1.5">{children}</div>
    </div>
  );
}

function Connected({ children }: { children: React.ReactNode }) {
  return (
    <p
      className="card flex items-center gap-2.5 rounded-[12px] px-3.5 py-3 text-body font-medium text-ink"
      data-testid="access-connected"
    >
      <DoneCheck size={22} />
      <span>{children}</span>
    </p>
  );
}

function Working({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2 text-body text-ink-muted" role="status">
      <Meter active color="var(--signal)" />
      {children}
    </p>
  );
}

/**
 * A key, verified by the core. OpenRouter goes through the onboarding API; a
 * key of another provider is recognised by its prefix and, once the user
 * agrees, saved with the providers API (it costs money: the user says yes).
 */
function KeyForm({
  label,
  placeholder,
  hint,
  unknown,
  submit = accessStrings().verifySave,
  quiet = false,
  onOpenRouter,
  onOther,
}: {
  label: string;
  placeholder: string;
  hint: string;
  /** Error for a key that matches no known prefix. */
  unknown: string;
  /** The words of the key: "Verify and continue" where the key is all the step needs. */
  submit?: string;
  /** Another way is connected already: its "Continua" is the orange key, this one is normal. */
  quiet?: boolean;
  onOpenRouter: () => void;
  onOther: (kind: KeyKind) => void;
}) {
  const s = accessStrings();
  const id = domId(useId());
  const [key, setKey] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** A key of a paid provider: asked before saving it. */
  const [offer, setOffer] = useState<KeyKind | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setOffer(null);
    const parsed = ProviderKeyRequestSchema.safeParse({ key });
    const kind = parsed.success ? keyKind(parsed.data.key) : null;
    if (!parsed.success || !kind) {
      setError(unknown);
      return;
    }
    if (kind.provider !== 'openrouter') {
      setOffer(kind);
      return;
    }
    setBusy(true);
    try {
      await onboardingApi.setKey(parsed.data.key);
      onOpenRouter();
    } catch (err) {
      setError(onboardingError(err));
    } finally {
      setBusy(false);
    }
  };

  const saveOther = async (kind: KeyKind) => {
    setBusy(true);
    setError(null);
    try {
      await getApi().setProviderKey(kind.provider, key.trim());
      onOther(kind);
    } catch (err) {
      setError(errorOf(err));
      setOffer(null);
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void save(e)} noValidate className="grid gap-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
        <Field id={id} label={label} error={error} hint={hint}>
          <Input
            id={id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={placeholder}
            value={key}
            onChange={(e) => {
              setKey(e.target.value);
              setOffer(null);
            }}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : `${id}-hint`}
            className="h-11"
          />
        </Field>
        <Button
          type="submit"
          size="lg"
          variant={offer || quiet ? 'secondary' : 'primary'}
          disabled={busy || !key.trim()}
          className="h-11 sm:mt-[26px]"
        >
          {busy && !offer ? s.checking : submit}
        </Button>
      </div>
      {offer && (
        <div
          role="status"
          data-testid="key-offer"
          className="card grid gap-3 rounded-[12px] px-3.5 py-3 text-body leading-snug text-ink"
        >
          <p>
            <strong className="font-semibold">{s.offerTitle(offer.label)}</strong>{' '}
            <span className="text-ink-muted">{s.offerText(offer.label)}</span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void saveOther(offer)}>
              {busy ? s.checking : s.offerYes}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOffer(null)}>
              {s.offerNo}
            </Button>
          </div>
        </div>
      )}
    </form>
  );
}

/** OpenRouter: paste the key, the core verifies it. */
function OpenRouterPanel({
  ready,
  quiet = false,
  onReady,
  onOther,
}: {
  ready: boolean;
  /** Another model is connected: one orange key on screen, the "Continua" below. */
  quiet?: boolean;
  onReady: () => void;
  onOther: (kind: KeyKind) => void;
}) {
  const s = accessStrings();
  const w = s.openrouter;
  if (ready) return <Connected>{w.ready}</Connected>;
  return (
    <div className="grid gap-4">
      <p className="text-body leading-snug text-ink-muted">
        {w.openBefore}
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-signal-ink hover:underline"
        >
          {/* i18n-ignore: an address */}
          openrouter.ai/keys
          <ArrowSquareOut size={15} aria-hidden />
        </a>
        {w.openAfter}
      </p>
      <KeyForm
        label={w.keyLabel}
        // i18n-ignore: the start of a key
        placeholder="sk-or-v1-…"
        hint={w.keyHint}
        unknown={w.keyUnknown}
        submit={s.verifyContinue}
        quiet={quiet}
        onOpenRouter={onReady}
        onOther={onOther}
      />
      <Note>
        <p>
          <strong className="font-semibold text-ink">{w.freeTitle}</strong>{' '}
          {w.freeText(eurFirst(10, undefined, 0))}
        </p>
      </Note>
    </div>
  );
}

/** Claude: Claude Code on the computer of the core, with the user's own login. */
function ClaudePanel({
  s,
  refresh,
  onError,
}: {
  s: SubscriptionsResponse;
  refresh: (check?: boolean) => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const t = accessStrings().claude;
  const [busy, setBusy] = useState(false);
  const c = s.claude;
  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    onError(null);
    try {
      await work();
      await refresh(true);
    } catch (err) {
      onError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  // While the user signs in in a terminal, ask Claude Code again now and then.
  const waiting = c.enabled && !c.installing && c.state !== 'subscription' && c.state !== 'other';
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void refresh(true), 4000);
    return () => clearInterval(t);
  }, [waiting, refresh]);

  if (c.enabled && (c.state === 'subscription' || c.state === 'other')) {
    return (
      <Connected>
        {c.state === 'subscription' ? t.readySubscription(c.version ?? undefined) : t.readyOther}
      </Connected>
    );
  }

  const check = (
    <Button variant="secondary" disabled={busy} onClick={() => void act(() => refresh(true))}>
      {busy ? accessStrings().checking : t.recheck}
    </Button>
  );

  return (
    <div className="grid gap-4">
      <p className="text-body leading-snug text-ink-muted">
        {t.introBefore} <strong className="font-semibold text-ink">{t.introStrong}</strong>{' '}
        {t.introAfter}
      </p>
      {c.installing ? (
        <Working>{t.installing}</Working>
      ) : !c.enabled ? (
        c.state === 'not_found' ? (
          <div className="grid gap-3">
            <Note>
              <p>
                {t.notFound(
                  c.package.name,
                  c.package.version,
                  subscriptionsStrings().license(c.package.license),
                )}
              </p>
            </Note>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => void act(() => getApi().activateHarness('claude-agent', true))}
              >
                {t.install}
              </Button>
              {check}
            </div>
          </div>
        ) : (
          <div>
            <Button
              disabled={busy}
              onClick={() => void act(() => getApi().activateHarness('claude-agent', false))}
            >
              {busy ? accessStrings().oneMoment : t.use}
            </Button>
          </div>
        )
      ) : (
        <div className="grid gap-3">
          {c.state === 'api_key' ? (
            <Note>
              <p>
                {t.apiKeyBefore} {/* i18n-ignore: a command */}
                <code className="font-mono text-ink">claude</code> {t.apiKeyAfter}
              </p>
            </Note>
          ) : c.state === 'not_found' ? (
            <Note>
              <p>{t.lostIt}</p>
            </Note>
          ) : (
            <Note icon={Terminal}>
              <p data-testid="claude-terminal-hint">
                <strong className="font-semibold text-ink">{t.terminalStrong}</strong>{' '}
                {/* i18n-ignore: a command */}
                <code className="font-mono text-ink">claude</code>
                {t.terminalMid}
                {/* i18n-ignore: a command */}
                <code className="font-mono text-ink">/login</code>
                {t.terminalAfter}
              </p>
            </Note>
          )}
          <div>{check}</div>
        </div>
      )}
      {c.message && <p className="text-footnote text-ink-muted">{c.message}</p>}
    </div>
  );
}

/**
 * ChatGPT: Sign in with ChatGPT, in the system browser (OpenAI's rules, D-035).
 * OpenAI's own words stay in English (D-005), on lines of their own: the app's
 * language comes after, never in the same sentence (audit 2.6).
 */
function ChatGPTPanel({
  s,
  refresh,
  onError,
}: {
  s: SubscriptionsResponse;
  refresh: () => Promise<void>;
  onError: (m: string | null) => void;
}) {
  const t = accessStrings().chatgpt;
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const c = s.chatgpt;

  const signIn = async () => {
    setBusy(true);
    onError(null);
    try {
      const login = await getApi().chatgptLogin();
      setUrl(login.authorizeUrl);
      window.open(login.authorizeUrl, '_blank', 'noopener');
      await refresh();
    } catch (err) {
      onError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  if (c.signedIn) {
    return (
      <div className="grid gap-2">
        <Connected>{t.connected(c.email ?? undefined)}</Connected>
        <a
          href={c.usageUrl}
          target="_blank"
          rel="noreferrer"
          lang="en"
          className="inline-flex w-fit items-center gap-1 pl-1 text-body font-medium text-signal-ink hover:underline"
        >
          {/* i18n-ignore: OpenAI's own words stay in English (D-005) */}
          Manage usage <ArrowSquareOut size={15} aria-hidden />
        </a>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid justify-items-start gap-3">
        <p lang="en" className="text-body leading-snug text-ink">
          {/* i18n-ignore: OpenAI's own words stay in English (D-005) */}
          Complete eligible AI requests in this app with usage included in your ChatGPT plan.
        </p>
        <button
          type="button"
          lang="en"
          onClick={() => void signIn()}
          disabled={busy || c.pending}
          data-testid="continue-with-chatgpt"
          className="inline-flex h-11 items-center justify-center rounded-full bg-[#0d0d0d] px-5 text-large font-medium text-white ring-1 ring-white/15 hover:bg-[#262626] active:translate-y-px focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-ink disabled:opacity-50"
        >
          {/* i18n-ignore: OpenAI's own words stay in English (D-005) */}
          Continue with ChatGPT
        </button>
      </div>
      <p className="text-footnote leading-snug text-ink-muted">{t.works}</p>
      {c.pending && (
        <Note>
          <Working>{t.finish}</Working>
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="text-signal-ink underline">
              {t.reopen}
            </a>
          )}
          <p>
            {t.tunnel}{' '}
            <code className="font-mono break-all text-ink">
              {/* i18n-ignore: a command */}
              ssh -L {c.callbackPort ?? 1455}:127.0.0.1:{c.callbackPort ?? 1455} {t.sshTarget}
            </code>
          </p>
        </Note>
      )}
      {c.message && <p className="text-footnote text-ink-muted">{c.message}</p>}
    </div>
  );
}

/** A connected way, in the guide's words. */
function doneText(c: Connected): string {
  const s = accessStrings();
  if (typeof c === 'object') return s.doneModelsOf(c.key.label);
  return s.ways[c].done;
}

export function AccessStep({
  guide,
  name,
  onState,
}: {
  guide: MonsterGenome;
  name: string;
  onState: (s: OnboardingState) => void;
}) {
  const [selected, setSelected] = useState<OnboardingAccess | null>(null);
  const [keyReady, setKeyReady] = useState(false);
  const [paidKey, setPaidKey] = useState<KeyKind | null>(null);
  const [subs, setSubs] = useState<SubscriptionsResponse | null>(null);
  const [subsFailed, setSubsFailed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'go' | 'skip' | null>(null);
  const [other, setOther] = useState(false);
  const otherId = domId(useId());
  const go = useRef<HTMLButtonElement>(null);
  const t = accessStrings();

  // Something already set up (e.g. Claude Code used before): start from it.
  const preset = useRef(false);
  const refresh = useCallback(
    (check = false): Promise<void> =>
      getApi()
        .subscriptions({ check })
        .then((d) => {
          setSubs(d);
          setSubsFailed(false);
          if (preset.current) return;
          preset.current = true;
          const claude =
            d.claude.enabled && (d.claude.state === 'subscription' || d.claude.state === 'other');
          if (claude) setSelected((v) => v ?? 'claude-agent');
          else if (d.chatgpt.signedIn) setSelected((v) => v ?? 'chatgpt');
        })
        .catch(() => setSubsFailed(true)),
    [],
  );

  useEffect(() => {
    void refresh(true);
  }, [refresh]);

  // A sign-in waiting for the browser, or an install: ask again quickly.
  const waiting = !!subs && (subs.chatgpt.pending || subs.claude.installing);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void refresh(), 1200);
    return () => clearInterval(t);
  }, [waiting, refresh]);

  const ready: Record<OnboardingAccess, boolean> = {
    openrouter: keyReady,
    'claude-agent':
      !!subs?.claude.enabled &&
      (subs.claude.state === 'subscription' || subs.claude.state === 'other'),
    chatgpt: !!subs?.chatgpt.signedIn,
  };
  const connected: Connected[] = [
    ...WAYS.filter((w) => ready[w.id]).map((w) => w.id),
    ...(paidKey ? [{ key: paidKey }] : []),
  ];
  // The way the monsters will use first: whatever card is open (audit 2.2).
  const primary = rankConnected(connected)[0] ?? null;
  const primaryId = primary === null ? null : typeof primary === 'object' ? 'key' : primary;

  // The first confirmation takes the focus to the next action, once.
  const announced = useRef<string | null>(null);
  useEffect(() => {
    if (primaryId && announced.current === null) {
      announced.current = primaryId;
      go.current?.focus({ preventScroll: true });
    }
  }, [primaryId]);

  const proceed = async (first: Connected | null = primary) => {
    if (!first) return;
    setBusy('go');
    setError(null);
    try {
      // A paid key is a configured model already: the core moves on by itself.
      onState(
        typeof first === 'object'
          ? await onboardingApi.state()
          : await onboardingApi.submit({ access: first }),
      );
    } catch (err) {
      setError(onboardingError(err));
      setBusy(null);
    }
  };

  const skip = async () => {
    setBusy('skip');
    setError(null);
    try {
      onState(await onboardingApi.submit({ skipKey: true }));
    } catch (err) {
      setError(onboardingError(err));
      setBusy(null);
    }
  };

  const panel =
    selected === 'openrouter' ? (
      <OpenRouterPanel
        ready={keyReady}
        quiet={primary !== null}
        // "Verifica e continua": a verified key is all this step needs (audit UI-18).
        onReady={() => {
          setKeyReady(true);
          void proceed(rankConnected([...connected, 'openrouter'])[0] ?? 'openrouter');
        }}
        onOther={(k) => {
          setPaidKey(k);
          setOther(true);
        }}
      />
    ) : !subs ? (
      subsFailed ? (
        <ErrorLine>{t.subsFailed}</ErrorLine>
      ) : (
        <Working>{t.looking}</Working>
      )
    ) : selected === 'claude-agent' ? (
      <ClaudePanel s={subs} refresh={refresh} onError={setError} />
    ) : (
      <ChatGPTPanel s={subs} refresh={() => refresh()} onError={setError} />
    );

  return (
    <div className="grid gap-6">
      <Guide
        genome={guide}
        name={name}
        named={false}
        expression={primary ? 'happy' : 'talk'}
        sayKey={primaryId ? `ready-${primaryId}` : 'key'}
        say={primary ? t.guide.done(doneText(primary)) : t.guide.ask}
        hint={primary ? chainHint(connected) : t.guide.hint}
      />

      <div role="radiogroup" aria-label={t.waysLabel} className="grid gap-2.5 sm:grid-cols-3">
        {WAYS.map((w) => (
          <WayCard
            key={w.id}
            way={w}
            selected={selected === w.id}
            ready={ready[w.id]}
            onSelect={() => {
              setSelected(w.id);
              setError(null);
            }}
          />
        ))}
      </div>

      {selected && (
        <div key={selected} data-testid="access-panel" data-access={selected} className="rise-in">
          {panel}
        </div>
      )}

      {error && <ErrorLine>{error}</ErrorLine>}

      {other && (
        <div id={otherId} className="grid gap-3" data-testid="other-ways">
          {paidKey ? (
            <Connected>{t.other.verified(paidKey.label)}</Connected>
          ) : (
            <>
              <p className="text-body leading-snug text-ink-muted">{t.other.text}</p>
              <KeyForm
                label={t.other.keyLabel}
                // i18n-ignore: the starts of the keys
                placeholder="sk-ant-…, sk-…, AIza…, gsk_…"
                hint={t.openrouter.keyHint}
                unknown={t.other.unknown}
                onOpenRouter={() => {
                  setKeyReady(true);
                  setSelected('openrouter');
                }}
                onOther={setPaidKey}
              />
            </>
          )}
          <Note icon={Key}>
            <p>
              {t.other.noteBefore}{' '}
              <strong className="font-semibold text-ink">{t.other.noteStrong}</strong>
              {t.other.noteAfter}
            </p>
          </Note>
        </div>
      )}

      <div className="flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1">
          <Button
            variant="ghost"
            aria-expanded={other}
            aria-controls={otherId}
            onClick={() => setOther((v) => !v)}
          >
            {t.other.otherWays}
          </Button>
          {/* With a model already connected there is nothing to leave for later. */}
          {!primary && (
            <Button variant="ghost" onClick={() => void skip()} disabled={busy !== null}>
              {busy === 'skip' ? t.oneMoment : t.later}
            </Button>
          )}
        </div>
        {/* The OpenRouter key has its own "Verify and continue": one way forward on screen. */}
        {(primary || selected !== 'openrouter' || busy === 'go') && (
          <Button
            ref={go}
            size="lg"
            onClick={() => {
              playSound('click');
              void proceed();
            }}
            disabled={!primary || busy !== null}
            data-testid="access-continue"
          >
            {busy === 'go' ? t.oneMoment : t.next}
            <ArrowRight size={18} aria-hidden />
          </Button>
        )}
      </div>
      {subs?.chatgpt.signedIn && !subs.chatgpt.welcomeSeen && (
        <ChatGPTWelcome
          onDone={() => {
            void getApi()
              .chatgptWelcomeSeen()
              .then(setSubs)
              .catch(() => {});
          }}
        />
      )}
    </div>
  );
}
