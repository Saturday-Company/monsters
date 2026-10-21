import { ArrowSquareOut, Terminal } from '@phosphor-icons/react';
import type { SubscriptionsResponse } from '@monsters/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, describeError } from '../../lib/api.ts';
import { cn } from '../../lib/utils.ts';
import { getApi, notify } from '../../store/app.ts';
import { Button, buttonVariants } from '../ui/button.tsx';
import { PlanLimitsBlock } from '../usage/PlanLimitsBlock.tsx';
import { serviceLabel } from './data.ts';
import { ConfirmButton, RowBody, ServiceRow } from './parts.tsx';
import { subscriptionsStrings } from './subscriptions.strings.ts';

/*
 * Settings → Modelli, the plans the user already pays for (M2.7, D-005,
 * D-035), only in the ways the providers allow; each one as a row of "What
 * the monsters think with" once on, or of the list to connect.
 * - ChatGPT: OpenAI's required elements (UI/UX guidelines of Sign in with
 *   ChatGPT): "Continue with ChatGPT", the first-use modal, "Manage usage".
 * - Claude subscription (the Claude Agent harness): plain text label, no logo,
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
 * dialog in a layer that starts below the top bar, so "Stop everything" stays
 * visible and clickable (ARCHITECTURE §8).
 */
export function ChatGPTWelcome({ onDone }: { onDone: () => void }) {
  const s = subscriptionsStrings();
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
          {s.welcomeTitle}
        </h2>
        <p className="mt-2 text-large leading-snug text-ink-muted">
          {s.welcomeBefore}
          <a href={USAGE_URL} target="_blank" rel="noreferrer" className="text-ink underline">
            {s.welcomeLink}
          </a>
          {s.welcomeAfter}
        </p>
        <p className="mt-2 text-footnote leading-snug text-ink-muted">{s.welcomeNote}</p>
        <div className="mt-5 flex justify-end">
          <Button onClick={close} autoFocus>
            {s.gotIt}
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
      {subscriptionsStrings().continue}
    </button>
  );
}

/** ChatGPT, signed in: the plan in use, "Manage usage", Disconnect. */
export function ChatGPTConnected({ s, refresh }: { s: SubscriptionsResponse; refresh: Refresh }) {
  const t = subscriptionsStrings();
  const { busy, act } = useAct(refresh);
  const c = s.chatgpt;
  return (
    <ServiceRow
      testId="subscription-chatgpt"
      configured
      title="ChatGPT"
      tag={t.chatgpt.tag}
      status={
        <>
          {t.chatgpt.connected(c.email)}
          {c.message ? ` ${c.message}` : ''}
        </>
      }
      actions={
        <>
          <ExternalLink href={c.usageUrl} testId="manage-usage">
            {t.manageUsage}
          </ExternalLink>
          <ConfirmButton
            label={t.chatgpt.disconnect}
            question={t.chatgpt.disconnectQuestion}
            confirm={t.chatgpt.disconnectConfirm}
            busy={busy}
            onConfirm={() => void act(() => getApi().chatgptLogout(), t.chatgpt.disconnected)}
          />
        </>
      }
    >
      <RowBody>
        <PlanUsage title={t.planUsage} plan="chatgpt" view={s.limits.chatgpt} />
      </RowBody>
    </ServiceRow>
  );
}

/** ChatGPT, not signed in: OpenAI's texts and button (D-005), then the wait for the browser. */
export function ChatGPTAdd({ s, refresh }: { s: SubscriptionsResponse; refresh: Refresh }) {
  const t = subscriptionsStrings();
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
      title={t.addTitle}
      status={
        <>
          {t.addStatus} {t.chatgpt.addNote}
          {c.message ? ` ${c.message}` : ''}
        </>
      }
      actions={<ContinueWithChatGPT busy={busy} onClick={() => void signIn()} />}
    >
      {c.pending && (
        <RowBody className="gap-1.5 text-footnote leading-snug text-ink-muted">
          <p>
            <strong className="font-semibold text-ink">{t.chatgpt.finish}</strong>{' '}
            {t.chatgpt.updates}
            {url && (
              <>
                {' '}
                <a href={url} target="_blank" rel="noreferrer" className="text-ink underline">
                  {t.chatgpt.reopen}
                </a>
                .
              </>
            )}
          </p>
          <p>
            {t.chatgpt.tunnel}
            <code className="font-mono text-ink">
              {t.chatgpt.sshCommand(c.callbackPort ?? 1455)}
            </code>
          </p>
        </RowBody>
      )}
    </ServiceRow>
  );
}

/** "Plan usage" (D-111): the windows of the plan, under its row. */
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
  const t = subscriptionsStrings().claude;
  return (
    <div
      className="flex gap-2.5 text-footnote leading-snug text-ink-muted"
      data-testid="claude-terminal-hint"
    >
      <Terminal size={20} aria-hidden className="mt-px shrink-0 text-ink" />
      <p>
        <strong className="font-semibold text-ink">{t.terminalTitle}</strong>{' '}
        <code className="font-mono text-ink">{'claude'}</code>
        {t.terminalMid}
        <code className="font-mono text-ink">{'/login'}</code>
        {t.terminalAfter}
      </p>
    </div>
  );
}

/** Claude subscription, turned on: ready, or what is missing (the login is the user's, in a terminal). */
export function ClaudeConnected({ s, refresh }: { s: SubscriptionsResponse; refresh: Refresh }) {
  const t = subscriptionsStrings().claude;
  const { busy, act } = useAct(refresh);
  const c = s.claude;
  const needsLogin = c.state === 'logged_out' || c.state === 'unknown' || c.state === 'error';
  const status =
    c.state === 'subscription'
      ? t.ready(c.version)
      : c.state === 'api_key'
        ? t.apiKey
        : c.state === 'other'
          ? t.other
          : c.state === 'not_found' && !c.installing
            ? t.notFound
            : c.installing
              ? t.installing
              : t.missingLogin;
  return (
    <ServiceRow
      testId="subscription-claude"
      configured
      title={serviceLabel('claude-agent')}
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
              {t.checkAgain}
            </Button>
          )}
          <ConfirmButton
            label={t.disconnect}
            question={t.disconnectQuestion}
            confirm={t.disconnectConfirm}
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
          <PlanUsage
            title={subscriptionsStrings().planUsage}
            plan="claude"
            view={s.limits.claude}
          />
        </RowBody>
      )}
    </ServiceRow>
  );
}

/** Claude subscription, off: what it is, and the one button (no logo, no login of ours). */
export function ClaudeAdd({ s, refresh }: { s: SubscriptionsResponse; refresh: Refresh }) {
  const t = subscriptionsStrings().claude;
  const { busy, act } = useAct(refresh);
  const c = s.claude;
  const install = c.state === 'not_found';
  return (
    <ServiceRow
      testId="subscription-claude"
      configured={false}
      title={serviceLabel('claude-agent')}
      status={
        install
          ? t.addInstall(
              c.package.name,
              c.package.version,
              subscriptionsStrings().license(c.package.license),
            )
          : t.add
      }
      actions={
        <Button
          variant="secondary"
          size="sm"
          disabled={busy || c.installing}
          onClick={() => void act(() => getApi().activateHarness('claude-agent', install))}
        >
          {c.installing ? t.installingButton : install ? t.installAndConnect : t.connect}
        </Button>
      }
    />
  );
}

/** Codex, turned on. */
export function CodexConnected({ s, refresh }: { s: SubscriptionsResponse; refresh: Refresh }) {
  const t = subscriptionsStrings().codex;
  const { busy, act } = useAct(refresh);
  const c = s.codex;
  return (
    <ServiceRow
      testId="subscription-codex"
      configured
      title={serviceLabel('codex')}
      tag={t.tag}
      status={
        <>
          {c.installing ? t.installing : c.state === 'ready' ? t.ready : t.notInstalled}
          {c.message ? ` ${c.message}` : ''}
        </>
      }
      actions={
        <ConfirmButton
          label={t.disconnect}
          question={t.disconnectQuestion}
          confirm={t.disconnectConfirm}
          busy={busy}
          onConfirm={() => void act(() => getApi().deactivateHarness('codex'))}
        />
      }
    />
  );
}

/** Codex, off: it needs ChatGPT first, and is installed only on request. */
export function CodexAdd({ s, refresh }: { s: SubscriptionsResponse; refresh: Refresh }) {
  const t = subscriptionsStrings().codex;
  const { busy, act } = useAct(refresh);
  const c = s.codex;
  const install = c.state === 'not_found';
  return (
    <ServiceRow
      testId="subscription-codex"
      configured={false}
      title={serviceLabel('codex')}
      status={
        c.state === 'needs_chatgpt'
          ? t.needsChatgpt
          : install
            ? t.addInstall(
                c.package.name,
                c.package.version,
                subscriptionsStrings().license(c.package.license),
              )
            : t.add
      }
      actions={
        c.state !== 'needs_chatgpt' && (
          <Button
            variant="secondary"
            size="sm"
            disabled={busy || c.installing}
            onClick={() => void act(() => getApi().activateHarness('codex', install))}
          >
            {c.installing ? t.installingButton : install ? t.installAndConnect : t.connect}
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
