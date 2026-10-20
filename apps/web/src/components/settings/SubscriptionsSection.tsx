import { ArrowSquareOut, Terminal } from '@phosphor-icons/react';
import type { SubscriptionsResponse } from '@monsters/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, describeError } from '../../lib/api.ts';
import { cn } from '../../lib/utils.ts';
import { getApi, notify } from '../../store/app.ts';
import { Button, buttonVariants } from '../ui/button.tsx';
import { PlanLimitsBlock } from '../usage/PlanLimitsBlock.tsx';
import { ConfirmButton, RowBody, ServiceRow } from './parts.tsx';

/*
 * Settings → Modelli, the plans the user already pays for (M2.7, D-005,
 * D-035), only in the ways the providers allow; each one as a row of "Con
 * cosa pensano i mostri" once on, or of the list to connect.
 * - ChatGPT: OpenAI's required elements (UI/UX guidelines of Sign in with
 *   ChatGPT): "Continue with ChatGPT", the first-use modal, "Manage usage".
 * - Abbonamento Claude (the Claude Agent harness): plain text label, no logo,
 *   no login button: the login is done by the user in a terminal with Claude Code.
 * - Codex: the same ChatGPT sign-in.
 */

const USAGE_URL = 'https://chatgpt.com/settings/usage';

function errorOf(err: unknown): string {
  if (err instanceof ApiError && err.message && err.message !== err.code) return err.message;
  return describeError(err);
}

function ExternalLink({
  href,
  children,
  testId,
}: {
  href: string;
  children: string;
  testId?: string;
}) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      data-testid={testId}
      className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'text-ink')}
    >
      {children}
      <ArrowSquareOut size={16} weight="bold" aria-hidden />
    </a>
  );
}

/**
 * First sign-in with plan usage on: OpenAI's welcome, dismissable. Not a native
 * modal (`showModal` makes the whole page inert, kill switch included): a
 * dialog in a layer that starts below the top bar, so "Ferma tutto" stays
 * visible and clickable (ARCHITECTURE §8).
 */
export function ChatGPTWelcome({ onDone }: { onDone: () => void }) {
  const [open, setOpen] = useState(true);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  const close = useCallback(() => {
    setOpen(false);
    done.current();
  }, []);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);
  if (!open) return null;
  return createPortal(
    <div
      data-testid="chatgpt-welcome-layer"
      className="fixed inset-x-0 top-16 bottom-0 z-40 flex items-center justify-center bg-black/40 p-4"
    >
      <dialog
        open
        aria-labelledby="chatgpt-welcome-title"
        data-testid="chatgpt-welcome"
        className="raised relative m-0 w-[min(440px,100%)] rounded-[16px] p-6 text-ink"
      >
        <h2 id="chatgpt-welcome-title" className="text-title2 font-semibold">
          You&rsquo;re using your ChatGPT plan
        </h2>
        <p className="mt-2 text-large leading-snug text-ink-muted">
          Eligible usage in this app uses your ChatGPT plan. Manage usage in your{' '}
          <a href={USAGE_URL} target="_blank" rel="noreferrer" className="text-ink underline">
            ChatGPT settings
          </a>
          .
        </p>
        <p className="mt-2 text-footnote leading-snug text-ink-muted">
          I mostri che usano ChatGPT consumano il tuo piano. Il limite per Monsters lo scegli tu
          nelle impostazioni di ChatGPT.
        </p>
        <div className="mt-5 flex justify-end">
          <Button onClick={close} autoFocus>
            Got it
          </Button>
        </div>
      </dialog>
    </div>,
    document.body,
  );
}

/** The plans, read again while a sign-in waits for the browser or a package installs. */
export function useSubscriptions(onChanged?: () => void) {
  const [data, setData] = useState<SubscriptionsResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const last = useRef<string>('');
  const changed = useRef(onChanged);
  useEffect(() => {
    changed.current = onChanged;
  });

  const load = useCallback((check = false) => {
    getApi()
      .subscriptions({ check })
      .then((d) => {
        setData(d);
        setFailed(false);
        // Something set up or removed: the services of the chains change too.
        const key = `${d.chatgpt.signedIn}|${d.claude.enabled}|${d.codex.enabled}|${d.claude.state}`;
        if (last.current && last.current !== key) changed.current?.();
        last.current = key;
      })
      .catch(() => setFailed(true));
  }, []);

  useEffect(() => load(true), [load]);

  const waiting =
    !!data && (data.chatgpt.pending || data.claude.installing || data.codex.installing);
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => load(), 1200);
    return () => clearInterval(t);
  }, [waiting, load]);

  return { data, setData, failed, load };
}

type Refresh = (check?: boolean) => void;

function useAct(refresh: Refresh) {
  const [busy, setBusy] = useState(false);
  const act = async (work: () => Promise<unknown>, done?: string) => {
    setBusy(true);
    try {
      await work();
      if (done) notify(done, 'success');
      refresh();
    } catch (err) {
      notify(errorOf(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return { busy, act };
}

/** "Continue with ChatGPT", OpenAI's button, black with white text as their guidelines show it. */
function ContinueWithChatGPT({ busy, onClick }: { busy: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      data-testid="continue-with-chatgpt"
      className="inline-flex h-9 items-center justify-center rounded-full bg-[#0d0d0d] px-4 text-body font-medium text-white ring-1 ring-white/15 hover:bg-[#262626] active:translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink disabled:opacity-50"
    >
      Continue with ChatGPT
    </button>
  );
}

/** ChatGPT, signed in: the plan in use, "Manage usage", Scollega. */
export function ChatGPTConnected({ s, refresh }: { s: SubscriptionsResponse; refresh: Refresh }) {
  const { busy, act } = useAct(refresh);
  const c = s.chatgpt;
  return (
    <ServiceRow
      testId="subscription-chatgpt"
      configured
      title="ChatGPT"
      tag="Il tuo piano"
      status={
        <>
          Collegato{c.email ? ` come ${c.email}` : ''}. I mostri che scegli usano il tuo piano.
          {c.message ? ` ${c.message}` : ''}
        </>
      }
      actions={
        <>
          <ExternalLink href={c.usageUrl} testId="manage-usage">
            Manage usage
          </ExternalLink>
          <ConfirmButton
            label="Scollega"
            question="Scollego ChatGPT?"
            confirm="Sì, scollega"
            busy={busy}
            onConfirm={() => void act(() => getApi().chatgptLogout(), 'ChatGPT scollegato.')}
          />
        </>
      }
    >
      <RowBody>
        <PlanUsage title="Utilizzo del piano" plan="chatgpt" view={s.limits.chatgpt} />
      </RowBody>
    </ServiceRow>
  );
}

/** ChatGPT, not signed in: OpenAI's texts and button (D-005), then the wait for the browser. */
export function ChatGPTAdd({ s, refresh }: { s: SubscriptionsResponse; refresh: Refresh }) {
  const [busy, setBusy] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const c = s.chatgpt;
  const signIn = async () => {
    setBusy(true);
    try {
      const login = await getApi().chatgptLogin();
      setUrl(login.authorizeUrl);
      // The system browser, never an embedded page (OpenAI's rule).
      window.open(login.authorizeUrl, '_blank', 'noopener');
      refresh();
    } catch (err) {
      notify(errorOf(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <ServiceRow
      testId="subscription-chatgpt"
      configured={false}
      title="Use your ChatGPT plan"
      status={
        <>
          Complete eligible AI requests in this app with usage included in your ChatGPT plan or
          credits balance. Funziona con Plus e Pro ed è separato da Monsters: a noi non paghi
          niente.
          {c.message ? ` ${c.message}` : ''}
        </>
      }
      actions={<ContinueWithChatGPT busy={busy} onClick={() => void signIn()} />}
    >
      {c.pending && (
        <RowBody className="gap-1.5 text-footnote leading-snug text-ink-muted">
          <p>
            <strong className="font-semibold text-ink">Completa l’accesso nel browser.</strong>{' '}
            Questa pagina si aggiorna da sola quando hai finito.
            {url && (
              <>
                {' '}
                <a href={url} target="_blank" rel="noreferrer" className="text-ink underline">
                  Riapri la pagina di accesso
                </a>
                .
              </>
            )}
          </p>
          <p>
            Monsters gira su un altro computer? Prima apri il tunnel dal tuo:{' '}
            <code className="font-mono text-ink">
              ssh -L {c.callbackPort ?? 1455}:127.0.0.1:{c.callbackPort ?? 1455} utente@computer
            </code>
          </p>
        </RowBody>
      )}
    </ServiceRow>
  );
}

/** "Utilizzo del piano" (D-111): the windows of the plan, under its row. */
function PlanUsage({
  title,
  plan,
  view,
}: {
  title: string;
  plan: 'claude' | 'chatgpt';
  view: SubscriptionsResponse['limits']['claude'];
}) {
  return (
    <section className="grid gap-2" aria-label={title}>
      <h3 className="label text-ink-muted">{title}</h3>
      <PlanLimitsBlock plan={plan} view={view} />
    </section>
  );
}

function ClaudeTerminalHint() {
  return (
    <div
      className="flex gap-2.5 text-footnote leading-snug text-ink-muted"
      data-testid="claude-terminal-hint"
    >
      <Terminal size={20} aria-hidden className="mt-px shrink-0 text-ink" />
      <p>
        <strong className="font-semibold text-ink">Apri un terminale ed esegui</strong>{' '}
        <code className="font-mono text-ink">claude</code>, poi accedi con il tuo abbonamento (
        <code className="font-mono text-ink">/login</code>). Monsters non vede mai le tue
        credenziali: quando hai finito, premi «Ricontrolla».
      </p>
    </div>
  );
}

/** Abbonamento Claude, turned on: ready, or what is missing (the login is the user's, in a terminal). */
export function ClaudeConnected({ s, refresh }: { s: SubscriptionsResponse; refresh: Refresh }) {
  const { busy, act } = useAct(refresh);
  const c = s.claude;
  const needsLogin = c.state === 'logged_out' || c.state === 'unknown' || c.state === 'error';
  const status =
    c.state === 'subscription'
      ? `Pronto: i mostri che scegli lavorano con Claude Code e il tuo abbonamento${
          c.version ? ` (versione ${c.version})` : ''
        }.`
      : c.state === 'api_key'
        ? 'Claude Code userebbe una chiave API: pagheresti a consumo, non con l’abbonamento. Esegui claude e accedi con il tuo piano.'
        : c.state === 'other'
          ? 'Claude Code usa un altro metodo di accesso che hai impostato tu.'
          : c.state === 'not_found' && !c.installing
            ? 'Non trovo più Claude Code: reinstallalo, oppure scollega e collega di nuovo.'
            : c.installing
              ? 'Installo il componente di Anthropic, ci vuole qualche minuto…'
              : 'Manca l’accesso a Claude Code.';
  return (
    <ServiceRow
      testId="subscription-claude"
      configured
      title="Abbonamento Claude"
      tag="Claude Code"
      status={
        <>
          {status}
          {c.message ? ` ${c.message}` : ''}
        </>
      }
      actions={
        <>
          {c.state !== 'subscription' && (
            <Button variant="secondary" size="sm" disabled={busy} onClick={() => refresh(true)}>
              Ricontrolla
            </Button>
          )}
          <ConfirmButton
            label="Scollega"
            question="Scollego l’abbonamento Claude?"
            confirm="Sì, scollega"
            busy={busy}
            onConfirm={() => void act(() => getApi().deactivateHarness('claude-agent'))}
          />
        </>
      }
    >
      {needsLogin && (
        <RowBody>
          <ClaudeTerminalHint />
        </RowBody>
      )}
      {c.state === 'subscription' && (
        <RowBody>
          <PlanUsage title="Utilizzo del piano" plan="claude" view={s.limits.claude} />
        </RowBody>
      )}
    </ServiceRow>
  );
}

/** Abbonamento Claude, off: what it is, and the one button (no logo, no login of ours). */
export function ClaudeAdd({ s, refresh }: { s: SubscriptionsResponse; refresh: Refresh }) {
  const { busy, act } = useAct(refresh);
  const c = s.claude;
  const install = c.state === 'not_found';
  return (
    <ServiceRow
      testId="subscription-claude"
      configured={false}
      title="Abbonamento Claude"
      status={
        install
          ? `Usa Claude Code col tuo abbonamento. Non lo trovo su questo computer: puoi installarlo tu, oppure Monsters installa il componente ufficiale di Anthropic (${c.package.name} ${c.package.version}, licenza ${c.package.license}).`
          : 'Usa Claude Code sul computer dove gira Monsters, col tuo abbonamento. L’accesso lo fai tu, nel terminale.'
      }
      actions={
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || c.installing}
          onClick={() => void act(() => getApi().activateHarness('claude-agent', install))}
        >
          {c.installing ? 'Installo…' : install ? 'Installa e collega' : 'Collega'}
        </Button>
      }
    />
  );
}

/** Codex, turned on. */
export function CodexConnected({ s, refresh }: { s: SubscriptionsResponse; refresh: Refresh }) {
  const { busy, act } = useAct(refresh);
  const c = s.codex;
  return (
    <ServiceRow
      testId="subscription-codex"
      configured
      title="Codex (per programmare)"
      tag="Piano ChatGPT"
      status={
        <>
          {c.installing
            ? 'Installo Codex, ci vuole qualche minuto…'
            : c.state === 'ready'
              ? 'Pronto: usa il tuo piano ChatGPT.'
              : 'Codex non è ancora installato.'}
          {c.message ? ` ${c.message}` : ''}
        </>
      }
      actions={
        <ConfirmButton
          label="Scollega"
          question="Scollego Codex?"
          confirm="Sì, scollega"
          busy={busy}
          onConfirm={() => void act(() => getApi().deactivateHarness('codex'))}
        />
      }
    />
  );
}

/** Codex, off: it needs ChatGPT first, and is installed only on request. */
export function CodexAdd({ s, refresh }: { s: SubscriptionsResponse; refresh: Refresh }) {
  const { busy, act } = useAct(refresh);
  const c = s.codex;
  const install = c.state === 'not_found';
  return (
    <ServiceRow
      testId="subscription-codex"
      configured={false}
      title="Codex (per programmare)"
      status={
        c.state === 'needs_chatgpt'
          ? 'L’agente di OpenAI che scrive codice e usa il computer, con lo stesso accesso a ChatGPT. Collega prima ChatGPT.'
          : install
            ? `L’agente di OpenAI che scrive codice e usa il computer. Monsters installa il programma ufficiale (${c.package.name} ${c.package.version}, licenza ${c.package.license}, circa 450 MB) solo se lo chiedi tu.`
            : 'L’agente di OpenAI che scrive codice e usa il computer, con il tuo accesso a ChatGPT.'
      }
      actions={
        c.state !== 'needs_chatgpt' && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || c.installing}
            onClick={() => void act(() => getApi().activateHarness('codex', install))}
          >
            {c.installing ? 'Installo…' : install ? 'Installa e collega' : 'Collega'}
          </Button>
        )
      }
    />
  );
}

/** The first-use modal of ChatGPT, once, wherever the plans are shown. */
export function ChatGPTWelcomeOnce({
  s,
  onSeen,
}: {
  s: SubscriptionsResponse | null;
  onSeen: (next: SubscriptionsResponse) => void;
}) {
  if (!s?.chatgpt.signedIn || s.chatgpt.welcomeSeen) return null;
  return (
    <ChatGPTWelcome
      onDone={() => {
        void getApi()
          .chatgptWelcomeSeen()
          .then(onSeen)
          .catch(() => {});
      }}
    />
  );
}
