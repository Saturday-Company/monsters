import { SETTINGS_SECTIONS } from '@monsters/shared';
import { Plus } from '@phosphor-icons/react';
import type {
  AgentModels,
  ProviderView,
  ProvidersResponse,
  SettingsResponse,
} from '@monsters/shared';
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { cn } from '../../lib/utils.ts';
import { PATHS } from '../../lib/router.ts';
import { errorText, getApi, notify } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { Switch } from '../ui/controls.tsx';
import { serviceLabel, useSettings } from './data.ts';
import { SpendSection } from './SpendSection.tsx';
import { ConfirmButton, Group, Row, RowBody, ServiceRow } from './parts.tsx';
import {
  ABOUT,
  ChainsGroup,
  errorOf,
  PaidNotice,
  ProviderForm,
  tagOf,
} from './ProvidersSection.tsx';
import {
  ChatGPTAdd,
  ChatGPTConnected,
  ChatGPTWelcomeOnce,
  ClaudeAdd,
  ClaudeConnected,
  CodexAdd,
  CodexConnected,
  useSubscriptions,
} from './SubscriptionsSection.tsx';

/*
 * Settings → Modelli (audit 6.2, 6.3): first what the monsters think with
 * ("Abbonamento Claude · OpenRouter…"), each with Cambia or Scollega; "Collega
 * un altro modello" opens the rest; then the model of each monster, saved by
 * itself.
 */

/**
 * "Usa anche modelli a pagamento" (OpenRouter): off by default, only `:free`
 * models and the free router. Turning it on shows the cost note first and asks
 * to confirm; the core applies it at once, no restart.
 */
function OpenRouterPaidModels({
  freeOnly,
  onChanged,
}: {
  freeOnly: boolean;
  onChanged: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const on = !freeOnly;

  const apply = async (allowPaid: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await getApi().setOpenRouterFreeOnly(!allowPaid);
      setConfirming(false);
      onChanged();
      notify(
        allowPaid
          ? 'Modelli a pagamento di OpenRouter attivi, da subito.'
          : 'Di nuovo solo modelli gratuiti, da subito.',
        'success',
      );
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div data-testid="openrouter-paid" data-on={on ? 'yes' : 'no'}>
      <Row
        label="Usa anche modelli a pagamento"
        description={
          on
            ? 'I mostri possono usare tutti i modelli di OpenRouter. Quelli a pagamento li paghi tu.'
            : 'Spento: solo i modelli gratuiti (quelli che finiscono con “:free”), senza costi.'
        }
      >
        <Switch
          words
          checked={on || confirming}
          disabled={busy}
          onCheckedChange={(v) => {
            if (v) setConfirming(true);
            else if (confirming) setConfirming(false);
            else void apply(false);
          }}
          label="Usa anche modelli a pagamento"
        />
      </Row>
      {(on || confirming || error) && (
        <RowBody className="pt-0">
          {(on || confirming) && <PaidNotice provider={{ label: 'OpenRouter', freeTier: false }} />}
          {confirming && !on && (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => void apply(true)}>
                {busy ? 'Attivo…' : 'Attiva i modelli a pagamento'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                disabled={busy}
                onClick={() => setConfirming(false)}
              >
                Annulla
              </Button>
            </div>
          )}
          {error && (
            <p className="text-footnote text-stop-ink" role="alert">
              {error}
            </p>
          )}
        </RowBody>
      )}
    </div>
  );
}

/** Removes a key or disconnects a local server, after a confirmation in place. */
function Disconnect({ p, onChanged }: { p: ProviderView; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const label = serviceLabel(p.id, p.label);
  const remove = async () => {
    setBusy(true);
    try {
      if (p.local) await getApi().removeProviderUrl(p.id);
      else await getApi().removeProviderKey(p.id);
      notify(p.local ? `${label} scollegato.` : `Chiave di ${label} tolta.`, 'success');
      onChanged();
    } catch (err) {
      notify(errorOf(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  if (p.source === 'env') return null;
  return (
    <ConfirmButton
      label="Scollega"
      question={`Scollego ${label}?`}
      confirm="Sì, scollega"
      busy={busy}
      onConfirm={() => void remove()}
    />
  );
}

function OpenRouterConnected({
  p,
  settings,
  onChanged,
}: {
  p: ProviderView;
  settings: SettingsResponse | null;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [changingKey, setChangingKey] = useState(false);
  const freeOnly = p.freeOnly ?? settings?.openrouterKey.freeOnly ?? true;
  const keyName = settings?.openrouterKey.label;
  const fromEnv = p.source === 'env';
  return (
    <ServiceRow
      testId="provider-row-openrouter"
      configured
      title="OpenRouter"
      tag={freeOnly ? 'Solo gratuiti' : 'Anche a pagamento'}
      status={
        <span data-testid="key-status" data-set="yes">
          Chiave attiva{keyName ? ` (“${keyName}”)` : ''}
          {fromEnv ? `, dalla variabile ${p.envVar ?? ''}` : ''}.
        </span>
      }
      actions={
        <>
          <Button
            variant="secondary"
            size="sm"
            aria-expanded={open}
            onClick={() => {
              setOpen((o) => !o);
              setChangingKey(false);
            }}
          >
            {open ? 'Chiudi' : 'Cambia'}
          </Button>
          <Disconnect p={p} onChanged={onChanged} />
        </>
      }
    >
      {open && (
        <div className="set-rows">
          <OpenRouterPaidModels freeOnly={freeOnly} onChanged={onChanged} />
          {!fromEnv &&
            (changingKey ? (
              <ProviderForm
                p={p}
                onCancel={() => setChangingKey(false)}
                onDone={() => {
                  setChangingKey(false);
                  onChanged();
                }}
              />
            ) : (
              <Row label="Chiave" description="La chiave salvata non si mostra più.">
                <Button variant="secondary" size="sm" onClick={() => setChangingKey(true)}>
                  Cambia chiave
                </Button>
              </Row>
            ))}
        </div>
      )}
    </ServiceRow>
  );
}

function ProviderConnected({ p, onChanged }: { p: ProviderView; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const fromEnv = p.source === 'env';
  const status = p.local
    ? `Collegato a ${p.baseURL ?? ''}.`
    : fromEnv
      ? `Chiave attiva, dalla variabile ${p.envVar ?? ''}.`
      : 'Chiave attiva.';
  return (
    <ServiceRow
      testId={`provider-row-${p.id}`}
      configured
      title={serviceLabel(p.id, p.label)}
      tag={tagOf(p)}
      status={status}
      actions={
        <>
          {!fromEnv && (
            <Button
              variant="secondary"
              size="sm"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? 'Chiudi' : p.local ? 'Cambia indirizzo' : 'Cambia chiave'}
            </Button>
          )}
          <Disconnect p={p} onChanged={onChanged} />
        </>
      }
    >
      {open && (
        <ProviderForm
          p={p}
          onCancel={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            onChanged();
          }}
        />
      )}
    </ServiceRow>
  );
}

function ProviderAdd({
  p,
  status,
  onChanged,
}: {
  p: ProviderView;
  status?: ReactNode;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <ServiceRow
      testId={`provider-row-${p.id}`}
      configured={false}
      title={serviceLabel(p.id, p.label)}
      tag={tagOf(p)}
      status={status ?? ABOUT[p.id]}
      actions={
        !open && (
          <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
            {p.local ? 'Collega' : 'Aggiungi la chiave'}
          </Button>
        )
      }
    >
      {open && (
        <ProviderForm
          p={p}
          onCancel={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            onChanged();
          }}
        />
      )}
    </ServiceRow>
  );
}

export function ModelsTab() {
  const [settings, reloadSettings] = useSettings();
  const [data, setData] = useState<ProvidersResponse | null>(null);
  const [failed, setFailed] = useState(false);
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const reloadProviders = useCallback(() => setVersion((v) => v + 1), []);
  const subs = useSubscriptions(reloadProviders);

  useEffect(() => {
    let alive = true;
    getApi()
      .providers()
      .then((d) => {
        if (!alive) return;
        setData(d);
        setFailed(false);
      })
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [version]);

  /** A key, a server or OpenRouter's paid models changed: everything that shows them reads again. */
  const changed = useCallback(() => {
    reloadProviders();
    reloadSettings();
  }, [reloadProviders, reloadSettings]);

  const onChainSaved = useCallback((saved: AgentModels) => {
    setData((d) =>
      d ? { ...d, agents: d.agents.map((a) => (a.id === saved.id ? saved : a)) } : d,
    );
  }, []);

  if (failed || subs.failed) {
    return (
      <p className="px-1 text-footnote text-ink-muted" role="status">
        Non riesco a leggere i modelli adesso. Riprova tra poco.
      </p>
    );
  }
  if (!data || !subs.data) return null;
  const s = subs.data;
  const refresh = (check?: boolean) => subs.load(check);

  const keyed = data.providers.filter((p) => !p.subscription);
  const openrouter = keyed.find((p) => p.id === 'openrouter');
  const others = keyed.filter((p) => p.id !== 'openrouter');

  const connected: ReactNode[] = [];
  const subsToAdd: ReactNode[] = [];
  const keysToAdd: ReactNode[] = [];
  (s.claude.enabled ? connected : subsToAdd).push(
    s.claude.enabled ? (
      <ClaudeConnected key="claude" s={s} refresh={refresh} />
    ) : (
      <ClaudeAdd key="claude" s={s} refresh={refresh} />
    ),
  );
  (s.chatgpt.signedIn ? connected : subsToAdd).push(
    s.chatgpt.signedIn ? (
      <ChatGPTConnected key="chatgpt" s={s} refresh={refresh} />
    ) : (
      <ChatGPTAdd key="chatgpt" s={s} refresh={refresh} />
    ),
  );
  (s.codex.enabled ? connected : subsToAdd).push(
    s.codex.enabled ? (
      <CodexConnected key="codex" s={s} refresh={refresh} />
    ) : (
      <CodexAdd key="codex" s={s} refresh={refresh} />
    ),
  );
  if (openrouter?.configured) {
    connected.push(
      <OpenRouterConnected
        key="openrouter"
        p={openrouter}
        settings={settings}
        onChanged={changed}
      />,
    );
  }
  for (const p of others) {
    if (p.configured) connected.push(<ProviderConnected key={p.id} p={p} onChanged={changed} />);
  }
  const none = connected.length === 0;
  if (openrouter && !openrouter.configured) {
    keysToAdd.push(
      <ProviderAdd
        key="openrouter"
        p={openrouter}
        onChanged={changed}
        status={
          <span data-testid="key-status" data-set="no">
            {none
              ? 'Tanti modelli con una chiave sola, anche gratis: il modo più semplice per cominciare.'
              : 'Nessuna chiave OpenRouter (facoltativa se hai già un altro modello).'}
          </span>
        }
      />,
    );
  }
  for (const p of others) {
    if (!p.configured) keysToAdd.push(<ProviderAdd key={p.id} p={p} onChanged={changed} />);
  }
  const showAdd = none || adding;

  return (
    <>
      <Group title="Con cosa pensano i mostri" as="ul" testId="models-connected">
        {connected}
        {none && (
          <Row
            as="li"
            label="Nessun modello collegato"
            description="Senza un modello i mostri non possono pensare: collegane uno qui sotto."
          />
        )}
        {!none && (
          <li>
            <button
              type="button"
              aria-expanded={adding}
              onClick={() => setAdding((a) => !a)}
              className="row-key flex min-h-[52px] w-full items-center gap-2.5 px-4 text-left text-body font-medium text-ink [&_svg]:text-signal-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink"
            >
              <Plus size={16} aria-hidden className={cn('turn', adding && 'rotate-45')} />
              Collega un altro modello
            </button>
          </li>
        )}
      </Group>

      {showAdd && (subsToAdd.length > 0 || keysToAdd.length > 0) && (
        <div className="grid gap-5" data-testid="models-add">
          {subsToAdd.length > 0 && (
            <Group
              title={SETTINGS_SECTIONS.abbonamenti.label}
              description="I mostri usano il tuo piano, nei modi che OpenAI e Anthropic permettono."
              as="ul"
              level={3}
            >
              {subsToAdd}
            </Group>
          )}
          {keysToAdd.length > 0 && (
            <Group title="Con una chiave o sul tuo computer" as="ul" level={3} testId="providers">
              {keysToAdd}
            </Group>
          )}
        </div>
      )}

      <Group title="Ricerca sul web" testId="search-link">
        <Row
          label="La ricerca a pagamento"
          description="Si accende in Collegamenti, insieme alla ricerca gratuita e alla chiave di Brave."
        >
          <a
            href={`${PATHS.settings}?sezione=collegamenti`}
            className="text-footnote font-medium text-ink underline underline-offset-2"
            data-testid="search-link-go"
          >
            Vai a Collegamenti
          </a>
        </Row>
      </Group>

      <ChainsGroup
        providers={data.providers}
        agents={data.agents}
        onPaidEnabled={changed}
        onSaved={onChainSaved}
      />

      <SpendSection />

      <ChatGPTWelcomeOnce s={s} onSeen={subs.setData} />
    </>
  );
}
