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
import { Button } from '../components/ui/button.tsx';
import { Field, Input } from '../components/ui/field.tsx';
import { ApiError, describeError } from '../lib/api.ts';
import { cn, domId, eurFirst } from '../lib/utils.ts';
import { getApi } from '../store/app.ts';
import { onboardingApi, onboardingError } from './api.ts';
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
  title: string;
  text: string;
  /** Name in the guide's confirmation. */
  done: string;
}

const WAYS: Way[] = [
  // The subscription first (choice of 16/10), the free models last.
  {
    id: 'claude-agent',
    icon: Terminal,
    title: 'Abbonamento Claude',
    text: 'Con Claude Code e il tuo piano, sul computer dove gira Monsters.',
    done: 'Claude Code e il tuo abbonamento',
  },
  {
    id: 'chatgpt',
    icon: ChatCircleDots,
    title: 'Piano ChatGPT',
    text: 'Plus o Pro: accedi con il tuo account di OpenAI.',
    done: 'il tuo piano ChatGPT',
  },
  {
    id: 'openrouter',
    icon: Gift,
    title: 'Modelli gratuiti',
    text: 'Con una chiave di OpenRouter. Gratis, con un limite di richieste al giorno.',
    done: 'i modelli gratuiti di OpenRouter',
  },
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
            Collegato
          </span>
        ) : (
          <span aria-hidden className="led" data-tone={selected ? 'signal' : undefined} />
        )}
      </span>
      <span className="text-large leading-tight font-semibold text-ink">{way.title}</span>
      <span className="text-footnote leading-snug text-ink-muted">{way.text}</span>
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
  submit = 'Verifica e salva',
  quiet = false,
  onOpenRouter,
  onOther,
}: {
  label: string;
  placeholder: string;
  hint: string;
  /** Error for a key that matches no known prefix. */
  unknown: string;
  /** The words of the key: "Verifica e continua" where the key is all the step needs. */
  submit?: string;
  /** Another way is connected already: its "Continua" is the orange key, this one is normal. */
  quiet?: boolean;
  onOpenRouter: () => void;
  onOther: (kind: KeyKind) => void;
}) {
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
          {busy && !offer ? 'Controllo…' : submit}
        </Button>
      </div>
      {offer && (
        <div
          role="status"
          data-testid="key-offer"
          className="card grid gap-3 rounded-[12px] px-3.5 py-3 text-body leading-snug text-ink"
        >
          <p>
            <strong className="font-semibold">
              Questa è una chiave di {offer.label}: la uso per i mostri?
            </strong>{' '}
            <span className="text-ink-muted">
              È a pagamento: i costi li paghi tu a {offer.label}, in base a quanto lavorano.
            </span>
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" disabled={busy} onClick={() => void saveOther(offer)}>
              {busy ? 'Controllo…' : 'Sì, usala'}
            </Button>
            <Button size="sm" variant="ghost" disabled={busy} onClick={() => setOffer(null)}>
              No
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
  if (ready) return <Connected>Chiave verificata: i mostri usano i modelli gratuiti.</Connected>;
  return (
    <div className="grid gap-4">
      <p className="text-body leading-snug text-ink-muted">
        Apri{' '}
        <a
          href="https://openrouter.ai/keys"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 font-medium text-signal-ink hover:underline"
        >
          openrouter.ai/keys
          <ArrowSquareOut size={15} aria-hidden />
        </a>
        , entra, premi “Create API key” e incolla qui la chiave: la controllo io.
      </p>
      <KeyForm
        label="La tua chiave di OpenRouter"
        placeholder="sk-or-v1-…"
        hint="Resta su questo computer, protetta: la legge solo Monsters."
        unknown="Incolla la chiave completa: inizia con “sk-or-”."
        submit="Verifica e continua"
        quiet={quiet}
        onOpenRouter={onReady}
        onOther={onOther}
      />
      <Note>
        <p>
          <strong className="font-semibold text-ink">Gratis, con un limite:</strong> 50 richieste al
          giorno, 1.000 dopo una ricarica una tantum di circa {eurFirst(10, undefined, 0)}. Alcuni
          modelli gratuiti possono usare quello che scrivi per migliorarsi: non dargli dati
          delicati.
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
        {c.state === 'subscription'
          ? `Claude Code è pronto con il tuo abbonamento${c.version ? ` (versione ${c.version})` : ''}.`
          : 'Claude Code è pronto, con il metodo di accesso che hai impostato tu.'}
      </Connected>
    );
  }

  const check = (
    <Button variant="secondary" disabled={busy} onClick={() => void act(() => refresh(true))}>
      {busy ? 'Controllo…' : 'Ricontrolla'}
    </Button>
  );

  return (
    <div className="grid gap-4">
      <p className="text-body leading-snug text-ink-muted">
        Monsters usa Claude Code installato{' '}
        <strong className="font-semibold text-ink">sul computer dove gira Monsters</strong> (se lo
        usi da un altro computer, è quello remoto). L’accesso a Claude lo fai tu, nel terminale:
        Monsters non vede mai le tue credenziali.
      </p>
      {c.installing ? (
        <Working>Installo il componente di Anthropic, ci vuole qualche minuto…</Working>
      ) : !c.enabled ? (
        c.state === 'not_found' ? (
          <div className="grid gap-3">
            <Note>
              <p>
                Non trovo Claude Code su quel computer. Puoi installarlo tu, oppure lascio che
                Monsters installi il componente ufficiale di Anthropic ({c.package.name}{' '}
                {c.package.version}, licenza {c.package.license}).
              </p>
            </Note>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy}
                onClick={() => void act(() => getApi().activateHarness('claude-agent', true))}
              >
                Installa e usa Claude Code
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
              {busy ? 'Un attimo…' : 'Usa Claude Code'}
            </Button>
          </div>
        )
      ) : (
        <div className="grid gap-3">
          {c.state === 'api_key' ? (
            <Note>
              <p>
                Claude Code userebbe una chiave API: pagheresti a consumo, non con l’abbonamento.
                Esegui <code className="font-mono text-ink">claude</code> e accedi con il tuo piano.
              </p>
            </Note>
          ) : c.state === 'not_found' ? (
            <Note>
              <p>Non trovo più Claude Code su quel computer: installalo e premi «Ricontrolla».</p>
            </Note>
          ) : (
            <Note icon={Terminal}>
              <p data-testid="claude-terminal-hint">
                <strong className="font-semibold text-ink">
                  Sul computer dove gira Monsters apri un terminale ed esegui
                </strong>{' '}
                <code className="font-mono text-ink">claude</code>, poi accedi con il tuo
                abbonamento (<code className="font-mono text-ink">/login</code>). Me ne accorgo da
                solo, oppure premi «Ricontrolla».
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
 * OpenAI's own words stay in English (D-005), on lines of their own: the Italian
 * comes after, never in the same sentence (audit 2.6).
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
        <Connected>
          ChatGPT collegato{c.email ? ` come ${c.email}` : ''}: i mostri usano il tuo piano.
        </Connected>
        <a
          href={c.usageUrl}
          target="_blank"
          rel="noreferrer"
          lang="en"
          className="inline-flex w-fit items-center gap-1 pl-1 text-body font-medium text-signal-ink hover:underline"
        >
          Manage usage <ArrowSquareOut size={15} aria-hidden />
        </a>
      </div>
    );
  }

  return (
    <div className="grid gap-4">
      <div className="grid justify-items-start gap-3">
        <p lang="en" className="text-body leading-snug text-ink">
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
          Continue with ChatGPT
        </button>
      </div>
      <p className="text-footnote leading-snug text-ink-muted">
        Funziona con i piani Plus e Pro. L’accesso si apre nel browser; a Monsters non paghi niente.
      </p>
      {c.pending && (
        <Note>
          <Working>Completa l’accesso nel browser: me ne accorgo da solo.</Working>
          {url && (
            <a href={url} target="_blank" rel="noreferrer" className="text-signal-ink underline">
              Riapri la pagina di accesso
            </a>
          )}
          <p>
            Monsters gira su un altro computer? Prima apri il tunnel dal tuo:{' '}
            <code className="font-mono break-all text-ink">
              ssh -L {c.callbackPort ?? 1455}:127.0.0.1:{c.callbackPort ?? 1455} utente@computer
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
  if (typeof c === 'object') return `i modelli di ${c.key.label}`;
  return WAYS.find((w) => w.id === c)!.done;
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
        <ErrorLine>Non riesco a leggere gli abbonamenti. Riprova tra poco.</ErrorLine>
      ) : (
        <Working>Guardo cosa c’è su quel computer…</Working>
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
        say={
          primary ? (
            <>Fatto! Adesso penso con {doneText(primary)}.</>
          ) : (
            'Ciao! Per pensare mi serve un modello. Come lo raggiungo?'
          )
        }
        hint={primary ? chainHint(connected) : 'Ne basta uno. Gli altri li aggiungi quando vuoi.'}
      />

      <div
        role="radiogroup"
        aria-label="Come raggiungo un modello"
        className="grid gap-2.5 sm:grid-cols-3"
      >
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
            <Connected>
              Chiave di {paidKey.label} verificata: i mostri useranno i suoi modelli, a pagamento.
            </Connected>
          ) : (
            <>
              <p className="text-body leading-snug text-ink-muted">
                Hai già una chiave di Anthropic, OpenAI, Google o Groq? Incollala qui: la riconosco
                dall’inizio. Sono a pagamento, con i costi a tuo carico.
              </p>
              <KeyForm
                label="La tua chiave"
                placeholder="sk-ant-…, sk-…, AIza…, gsk_…"
                hint="Resta su questo computer, protetta: la legge solo Monsters."
                unknown="Non riconosco questa chiave: di solito inizia con sk-ant-, sk-, AIza o gsk_."
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
              Mistral, o un modello sul tuo computer con Ollama o LM Studio: finisci il primo avvio
              e li aggiungi in{' '}
              <strong className="font-semibold text-ink">Impostazioni → Modelli</strong>, con il
              modello di ogni mostro. Lì trovi anche Codex.
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
            Altri modi
          </Button>
          {/* With a model already connected there is nothing to leave for later. */}
          {!primary && (
            <Button variant="ghost" onClick={() => void skip()} disabled={busy !== null}>
              {busy === 'skip' ? 'Un attimo…' : 'Lo faccio dopo'}
            </Button>
          )}
        </div>
        {/* The OpenRouter key has its own "Verifica e continua": one way forward on screen. */}
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
            {busy === 'go' ? 'Un attimo…' : 'Continua'}
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
