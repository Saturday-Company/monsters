import { ArrowSquareOut, TelegramLogo, UserPlus } from '@phosphor-icons/react';
import {
  extractTelegramToken,
  TELEGRAM_TOKEN_SHAPE_MESSAGE,
  type TelegramPairing,
  type TelegramPrefs,
  type TelegramPrefsUpdate,
  type TelegramView,
  SETTINGS_SECTIONS,
} from '@monsters/shared';
import { useCallback, useEffect, useId, useState, type FormEvent } from 'react';
import { ApiError, describeError } from '../../lib/api.ts';
import { domId } from '../../lib/utils.ts';
import { getApi, notify } from '../../store/app.ts';
import { Button, buttonVariants } from '../ui/button.tsx';
import { Switch } from '../ui/controls.tsx';
import { Input } from '../ui/field.tsx';
import { ConfirmButton, fieldOnGroup, FormField, Group, Row, RowBody } from './parts.tsx';
import { pasteTelegramToken, TelegramBotsSection } from './TelegramBotsSection.tsx';

/*
 * Settings → Telegram (M2.6): the bot token (verified with Telegram, never
 * shown again), the accounts allowed to command the monsters (added only with
 * a one-time code), and which notifications arrive, with a quiet night.
 * Below, the bots dedicated to one monster (D-107), independent of this one.
 */

/** The message of the core when it has one in Italian, the generic one otherwise. */
function errorOf(err: unknown): string {
  if (
    err instanceof ApiError &&
    err.message &&
    err.message !== err.code &&
    [
      'invalid_token',
      'verification_failed',
      'token_from_env',
      'no_token',
      'not_found',
      'bot_in_use',
      'invalid_agent',
      'owner',
    ].includes(err.code)
  ) {
    return err.message;
  }
  return describeError(err);
}

const STATUS_TEXT: Record<TelegramView['status'], string> = {
  off: 'Non collegato.',
  connecting: 'Mi collego a Telegram…',
  online: 'Collegato: ti ascolta.',
  retrying: 'Telegram non risponde: riprovo da solo.',
  conflict: 'Un altro programma usa questo bot: fermalo, o creane uno nuovo.',
  error: 'Fermo: serve il tuo intervento.',
};

function useTelegram(): [TelegramView | null, (v: TelegramView) => void, () => void] {
  const [view, setView] = useState<TelegramView | null>(null);
  const [version, setVersion] = useState(0);
  useEffect(() => {
    let alive = true;
    getApi()
      .telegram()
      .then((v) => alive && setView(v))
      .catch(() => alive && setView(null));
    return () => {
      alive = false;
    };
  }, [version]);
  const reload = useCallback(() => setVersion((v) => v + 1), []);
  return [view, setView, reload];
}

function remaining(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

function TokenForm({
  onSaved,
  onCancel,
}: {
  onSaved: (v: TelegramView) => void;
  onCancel: () => void;
}) {
  const id = domId(useId());
  const [token, setToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const pasted = extractTelegramToken(token);
    if (!pasted) {
      setError(TELEGRAM_TOKEN_SHAPE_MESSAGE);
      return;
    }
    setSaving(true);
    try {
      const view = await getApi().setTelegramToken(pasted);
      setToken('');
      onSaved(view);
      notify(`Bot ${view.bot ? `@${view.bot.username} ` : ''}collegato.`, 'success');
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate>
      <RowBody>
        <ol className="grid list-decimal gap-1 pl-5 text-footnote leading-snug text-ink-muted">
          <li>
            Su Telegram apri{' '}
            <a
              href="https://t.me/BotFather"
              target="_blank"
              rel="noreferrer"
              className="font-medium text-ink underline underline-offset-2"
            >
              @BotFather
            </a>{' '}
            e scrivi{' '}
            <code className="rounded-[5px] bg-well px-1 font-mono text-[0.9em] text-ink">
              /newbot
            </code>
            .
          </li>
          <li>Scegli un nome: BotFather ti dà un codice (il token).</li>
          <li>Incollalo qui: Monsters controlla con Telegram che funzioni.</li>
        </ol>
        <FormField
          id={id}
          label="Codice del bot (token)"
          error={error}
          hint="Resta su questo computer, protetto: lo legge solo Monsters. Non lo mostriamo più."
        >
          <Input
            id={id}
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder="123456789:AAH…"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            onPaste={pasteTelegramToken(setToken)}
            className={fieldOnGroup}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : `${id}-hint`}
          />
        </FormField>
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={saving || !token.trim()}>
            {saving ? 'Controllo…' : 'Collega il bot'}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            Annulla
          </Button>
        </div>
      </RowBody>
    </form>
  );
}

function PairingPanel({
  pairing,
  onDone,
  onCancel,
}: {
  pairing: TelegramPairing;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const left = pairing.expiresAt - now;
  useEffect(() => {
    if (left <= 0) onDone();
  }, [left, onDone]);

  return (
    <div
      className="grid gap-3 px-4 py-3"
      data-testid="telegram-pairing"
      role="status"
      aria-live="polite"
    >
      <p className="text-footnote leading-snug text-ink-muted">
        Dal telefono, scrivi al bot questo messaggio (vale una volta sola):
      </p>
      <p
        className="font-mono text-title1 font-semibold tracking-[0.12em] text-ink select-all"
        data-testid="telegram-pairing-code"
      >
        /start {pairing.code}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {pairing.link && (
          <a
            href={pairing.link}
            target="_blank"
            rel="noreferrer"
            className={buttonVariants({ variant: 'primary', size: 'sm' })}
          >
            <ArrowSquareOut size={17} weight="bold" aria-hidden />
            Apri in Telegram
          </a>
        )}
        <Button variant="ghost" size="sm" onClick={onCancel}>
          Annulla
        </Button>
        <span className="text-footnote text-ink-muted">
          Scade tra {remaining(left)} · aspetto il messaggio…
        </span>
      </div>
    </div>
  );
}

function TimeInput({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const id = domId(useId());
  return (
    <label htmlFor={id} className="flex items-center gap-2 text-footnote text-ink-muted">
      {label}
      <Input
        id={id}
        type="time"
        value={value}
        onChange={(e) => {
          if (/^\d{2}:\d{2}$/.test(e.target.value)) onChange(e.target.value);
        }}
        className={`h-9 w-[7.5rem] px-3 text-body ${fieldOnGroup}`}
      />
    </label>
  );
}

function Notifications({
  prefs,
  onChange,
}: {
  prefs: TelegramPrefs;
  onChange: (update: TelegramPrefsUpdate) => void;
}) {
  const rows: { key: keyof TelegramPrefs['notify']; title: string; text: string }[] = [
    { key: 'questions', title: 'Domande in attesa', text: 'Con i pulsanti per rispondere.' },
    { key: 'done', title: 'Lavoro finito', text: 'Quando lo hai chiesto da qui o dal browser.' },
    { key: 'errors', title: 'Errori', text: 'Quando un lavoro non va a buon fine.' },
  ];
  return (
    <Group title="Notifiche su Telegram" level={3} testId="telegram-notifications">
      {rows.map((r) => (
        <Row key={r.key} label={r.title} description={r.text}>
          <Switch
            words
            checked={prefs.notify[r.key]}
            onCheckedChange={(v) => onChange({ notify: { [r.key]: v } })}
            label={r.title}
          />
        </Row>
      ))}
      <div>
        <Row
          label="Silenzioso di notte"
          description="Le notifiche aspettano il mattino; una domanda che blocca il lavoro arriva lo stesso, ma senza suono."
        >
          <Switch
            words
            checked={prefs.quietHours.enabled}
            onCheckedChange={(v) => onChange({ quietHours: { enabled: v } })}
            label="Silenzioso di notte"
          />
        </Row>
        {prefs.quietHours.enabled && (
          <div className="flex flex-wrap gap-4 px-4 pb-3">
            <TimeInput
              label="Dalle"
              value={prefs.quietHours.from}
              onChange={(v) => onChange({ quietHours: { from: v } })}
            />
            <TimeInput
              label="fino alle"
              value={prefs.quietHours.to}
              onChange={(v) => onChange({ quietHours: { to: v } })}
            />
          </div>
        )}
      </div>
    </Group>
  );
}

export function TelegramSection() {
  const [view, setView, reload] = useTelegram();
  const [pairing, setPairing] = useState<TelegramPairing | null>(null);
  const [busy, setBusy] = useState(false);
  const [connecting, setConnecting] = useState(false);

  // A bot just saved answers "connecting": the loop goes online a moment later, and nothing
  // else tells the page. Read the state again every 2 seconds until it settles.
  const settling = view?.status === 'connecting' || view?.status === 'retrying';
  useEffect(() => {
    if (!settling) return;
    const t = setInterval(() => {
      void getApi()
        .telegram()
        .then(setView)
        .catch(() => {});
    }, 2000);
    return () => clearInterval(t);
  }, [settling, setView]);

  // While a code is shown, look for the new account every 2 seconds.
  useEffect(() => {
    if (!pairing) return;
    const known = new Set(view?.users.map((u) => u.id) ?? []);
    const t = setInterval(() => {
      void getApi()
        .telegram()
        .then((next) => {
          setView(next);
          const added = next.users.find((u) => !known.has(u.id));
          if (added) {
            setPairing(null);
            notify(
              `Account collegato: ${added.name}. Può comandare i mostri da Telegram.`,
              'success',
            );
          } else if (!next.pairing) {
            setPairing(null);
          }
        })
        .catch(() => {});
    }, 2000);
    return () => clearInterval(t);
    // `view` changes at every poll: only a new code restarts the timer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pairing]);

  const act = async (job: () => Promise<TelegramView | void>, done?: string) => {
    setBusy(true);
    try {
      const next = await job();
      if (next) setView(next);
      if (done) notify(done, 'success');
    } catch (err) {
      notify(errorOf(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const startPairing = () =>
    act(async () => {
      setPairing(await getApi().startTelegramPairing());
      reload();
    });

  const fromEnv = view?.token.source === 'env';
  const connected = view?.token.set ?? false;

  const status = view && (
    <span
      className="flex items-center gap-1.5"
      data-testid="telegram-status"
      data-status={view.status}
    >
      <span
        className="led"
        data-tone={view.status === 'online' ? 'ok' : view.status === 'off' ? undefined : 'stop'}
        aria-hidden
      />
      <span>
        {view.bot ? `@${view.bot.username}. ` : ''}
        {view.error ?? STATUS_TEXT[view.status]}
      </span>
    </span>
  );

  return (
    <div className="grid gap-5" data-testid="telegram-settings">
      <Group
        title={SETTINGS_SECTIONS.telegram.label}
        level={3}
        description={
          <>
            Parla con i mostri dal telefono, rispondi alle loro domande e fermali con{' '}
            <code className="text-ink">/ferma</code>. Il bot è tuo: solo gli account che colleghi
            qui possono comandarlo.
          </>
        }
        footer={
          connected ? (
            <>
              Dal telefono: <code>/ferma</code>, <code>/riprendi</code>, <code>/nuova</code>,{' '}
              <code>/stato</code>.
              {fromEnv ? ' Il codice del bot arriva dalla variabile TELEGRAM_BOT_TOKEN.' : ''}
            </>
          ) : undefined
        }
      >
        <Row
          label="Bot"
          description={status}
          leading={<TelegramLogo size={20} aria-hidden className="text-ink-muted" />}
        >
          {view && !connected && !connecting && (
            <Button variant="secondary" size="sm" onClick={() => setConnecting(true)}>
              Collega un bot
            </Button>
          )}
          {connected && !fromEnv && (
            <ConfirmButton
              label="Scollega il bot"
              question="Scollego il bot?"
              confirm="Sì, scollega"
              busy={busy}
              onConfirm={() =>
                void act(async () => {
                  setPairing(null);
                  return getApi().removeTelegramToken();
                }, 'Bot scollegato.')
              }
            />
          )}
        </Row>
        {view && !connected && connecting && (
          <TokenForm
            onSaved={(v) => {
              setConnecting(false);
              setView(v);
              // The last step at once: without an account the bot ignores every message.
              if (v.users.length === 0) void startPairing();
            }}
            onCancel={() => setConnecting(false)}
          />
        )}
      </Group>

      {view && connected && (
        <>
          <Group
            title="Chi può comandare i mostri"
            level={3}
            as="ul"
            testId="telegram-users"
            footer="Gli altri messaggi al bot vengono ignorati e finiscono in Attività."
          >
            {view.users.length === 0 && (
              <Row
                as="li"
                label="Nessun account ancora"
                description="Collega il tuo: finché non lo fai, il bot ignora tutti i messaggi, anche i tuoi."
              />
            )}
            {view.users.map((u) => (
              <Row
                key={u.id}
                as="li"
                testId="telegram-user"
                label={
                  <>
                    {u.name}
                    {u.username ? <span className="text-ink-muted"> · @{u.username}</span> : null}
                  </>
                }
                description={`Collegato il ${new Date(u.addedAt).toLocaleDateString('it-IT')}`}
              >
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void act(
                      () => getApi().removeTelegramUser(u.id),
                      `${u.name} non può più comandare i mostri.`,
                    )
                  }
                  aria-label={`Togli ${u.name}`}
                >
                  Togli
                </Button>
              </Row>
            ))}
            <li>
              {pairing ? (
                <PairingPanel
                  pairing={pairing}
                  onDone={() => setPairing(null)}
                  onCancel={() =>
                    void act(async () => {
                      setPairing(null);
                      return getApi().cancelTelegramPairing();
                    })
                  }
                />
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void startPairing()}
                  className="row-key flex min-h-[52px] w-full items-center gap-2.5 px-4 text-left text-body font-medium text-ink [&_svg]:text-signal-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink"
                >
                  <UserPlus size={18} aria-hidden />
                  Collega un account
                </button>
              )}
            </li>
          </Group>

          <Notifications
            prefs={view.prefs}
            onChange={(update) => void act(() => getApi().setTelegramPrefs(update))}
          />
        </>
      )}

      {view && (
        <TelegramBotsSection view={view} setView={setView} reload={reload} errorOf={errorOf} />
      )}
    </div>
  );
}
