import {
  ArrowSquareOut,
  BookOpenText,
  ChatsCircle,
  Fire,
  Kanban,
  MagnifyingGlass,
  PaintBrush,
  Plugs,
  X,
  type Icon,
} from '@phosphor-icons/react';
import {
  MCP_CATALOG,
  catalogCreateUrl,
  catalogUrl,
  launcherOf,
  needsTenant,
  parseTenant,
  tenantOfUrl,
  type ClaudeConnectionView,
  type ClaudeConnectionsResponse,
  type McpCatalogAuth,
  type McpCatalogEntry,
  type McpServerRequest,
  type McpServerView,
  type McpServersResponse,
} from '@monsters/shared';
import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { cn, domId, toName } from '../../lib/utils.ts';
import { getApi, notify } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { Segmented } from '../ui/controls.tsx';
import { Input } from '../ui/field.tsx';
import { Meter } from '../ui/Meter.tsx';
import { BRAND_ICONS } from './brand-icons.ts';
import { SATURDAY_ICONS } from './saturday-icons.ts';
import { ClaudeConnectBody } from './ClaudeConnect.tsx';
import { AgentPicker, Details, errorOf, TestButton, ToolsResult, useTest } from './mcp-parts.tsx';
import { OAuthPaste } from './McpOAuthPaste.tsx';
import { SecretChange } from './McpSecretChange.tsx';
import { ConfirmButton, FormField, Group } from './parts.tsx';

/*
 * Settings → Collegamenti → App e servizi (D-063): the services of
 * `MCP_CATALOG` as keys with their mark on a small screen, the name, one
 * sentence and the state. A key opens a panel that asks only what is needed
 * (nothing, a sign-in in the browser, or a token with the link to create it),
 * then "Prova" and who uses it. Servers added here are normal MCP servers of
 * the core, tagged with `catalog`.
 */

/** Generic marks for services simple-icons does not carry. */
export const GENERIC_ICONS: Record<string, Icon> = {
  slack: ChatsCircle,
  canva: PaintBrush,
  context7: BookOpenText,
  exa: MagnifyingGlass,
  firecrawl: Fire,
  monday: Kanban,
};

/** Keys shown before "Mostra tutti". */
const FIRST = 8;

export type GalleryState =
  'soon' | 'claude' | 'off' | 'login' | 'signin' | 'waiting' | 'connected' | 'error';

const STATE_TEXT: Record<GalleryState, string> = {
  soon: 'Presto',
  claude: 'Collega tramite Claude',
  off: 'Da collegare',
  login: 'Da collegare',
  signin: 'Serve l’accesso',
  waiting: 'In attesa',
  connected: 'Collegato',
  error: 'Problema',
};

/** The server added from an entry: tagged with it, or (older) with its name and address. */
export function serverOf(
  entry: McpCatalogEntry,
  servers: McpServerView[],
): McpServerView | undefined {
  return (
    servers.find((s) => s.catalog === entry.id) ??
    servers.find(
      (s) => s.name === entry.id && !s.catalog && s.url !== undefined && s.url === entry.url,
    )
  );
}

export function galleryState(
  entry: McpCatalogEntry,
  server: McpServerView | undefined,
): GalleryState {
  if (!server) return entry.soon ? 'soon' : 'off';
  if (server.oauth?.pending) return 'waiting';
  // The service refused a sign-in that worked (connettori 1): "Collega" again.
  if (server.oauth?.needsSignIn) return 'signin';
  // A call was refused for a permission the access lacks: "Collega" asks for it.
  if (server.oauth?.moreScope) return 'signin';
  if (server.oauth && !server.oauth.connected) return 'login';
  if (server.status === 'error') return 'error';
  return 'connected';
}

/**
 * A service reached through Claude (D-069): its own states once the Claude
 * plan is connected; "Collega tramite Claude" until the user chooses it.
 */
export function claudeGalleryState(view: ClaudeConnectionView): GalleryState {
  if (!view.added) return 'claude';
  if (view.state === 'connected') return 'connected';
  if (view.state === 'error') return 'error';
  return 'login';
}

/** The connection through Claude of an entry, when the Claude plan is connected. */
export function viaClaudeOf(
  entry: McpCatalogEntry,
  claude: ClaudeConnectionsResponse | null,
): ClaudeConnectionView | undefined {
  if (!entry.viaClaude || !claude?.claude) return undefined;
  return claude.connections.find((c) => c.id === entry.id);
}

/** A free server name for an entry: its id, or the id with a number when a custom server has it. */
function freeName(entry: McpCatalogEntry, servers: McpServerView[]): string {
  const taken = new Set(servers.map((s) => s.name));
  if (!taken.has(entry.id)) return entry.id;
  for (let i = 2; ; i++) {
    const name = `${entry.id.slice(0, 21)}-${i}`;
    if (!taken.has(name)) return name;
  }
}

/** The mark of a service as light on a small black screen (docs/design.md, "Schermo"). */
export function BrandScreen({ icon, size = 44 }: { icon: string; size?: number }) {
  const brand = BRAND_ICONS[icon];
  const own = SATURDAY_ICONS[icon];
  const Generic = GENERIC_ICONS[icon] ?? Plugs;
  const glyph = Math.round(size * 0.5);
  return (
    <span
      aria-hidden
      className="screen flex shrink-0 items-center justify-center rounded-[10px]"
      style={{ width: size, height: size }}
    >
      {own ? (
        <svg viewBox={own.viewBox} width={glyph} height={glyph} data-icon={icon}>
          {own.paths.map((p) =>
            p.stroke ? (
              <path
                key={p.d}
                d={p.d}
                fill="none"
                stroke={own.light}
                strokeWidth={p.stroke}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ) : (
              <path key={p.d} d={p.d} fill={own.light} />
            ),
          )}
        </svg>
      ) : brand ? (
        <svg viewBox="0 0 24 24" width={glyph} height={glyph} fill={brand.light}>
          <path d={brand.path} />
        </svg>
      ) : (
        <Generic size={glyph} weight="bold" className="text-screen-ink" />
      )}
    </span>
  );
}

function StateLabel({ state }: { state: GalleryState }) {
  const tone =
    state === 'connected'
      ? 'ok'
      : state === 'waiting'
        ? 'signal'
        : state === 'error' || state === 'signin'
          ? 'stop'
          : undefined;
  return (
    <span
      className={cn(
        'label inline-flex items-center gap-1.5',
        state === 'connected'
          ? 'text-ink'
          : state === 'error' || state === 'signin'
            ? 'text-stop-ink'
            : 'text-ink-muted',
      )}
      data-testid="gallery-state"
    >
      {tone && <span aria-hidden className="led" data-tone={tone} />}
      {STATE_TEXT[state]}
    </span>
  );
}

function authLabel(entry: McpCatalogEntry, a: McpCatalogAuth): string {
  if (a.kind === 'oauth') return `Accedi ${toName(entry.name)}`;
  if (a.kind === 'token') return a.label;
  return 'Senza accesso';
}

/** What follows the company in the address: `.anteiku.it`. */
function tenantSuffix(entry: McpCatalogEntry): string {
  if (!entry.urlTemplate) return '';
  return new URL(entry.urlTemplate.replace('{azienda}', 'x')).hostname.slice(1);
}

/** Polls the servers while a sign-in waits for the browser. */
function useWaiting(waiting: boolean, onData: (d: McpServersResponse) => void): void {
  const cb = useRef(onData);
  useEffect(() => {
    cb.current = onData;
  });
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => {
      getApi()
        .mcpServers()
        .then((d) => cb.current(d))
        .catch(() => {});
    }, 1200);
    return () => clearInterval(t);
  }, [waiting]);
}

/** The panel of one service: connect, or test, choose who uses it and disconnect. */
function ConnectPanel({
  entry,
  data,
  onData,
  reload,
  onClose,
  via,
  onClaude,
}: {
  entry: McpCatalogEntry;
  data: McpServersResponse;
  onData: (d: McpServersResponse) => void;
  reload: () => void;
  onClose: () => void;
  /** Reached through Claude (D-069): the panel connects it there. */
  via?: ClaudeConnectionView | undefined;
  onClaude: (d: ClaudeConnectionsResponse) => void;
}) {
  const server = serverOf(entry, data.servers);
  const state = via ? claudeGalleryState(via) : galleryState(entry, server);
  const titleId = `${domId(useId())}-title`;
  const tokenId = domId(useId());
  const methods = entry.auth;
  const [methodIndex, setMethodIndex] = useState(() => {
    // An entry added with a token keeps showing the token way.
    const withToken = server && server.headerKeys.length > 0 && !server.oauth;
    const i = withToken ? methods.findIndex((m) => m.kind === 'token') : 0;
    return Math.max(0, i);
  });
  const method = methods[methodIndex] ?? methods[0]!;
  const [token, setToken] = useState('');
  /** One server per company (Anteiku, WitDesk): which one, as the user typed it. */
  const [tenantInput, setTenantInput] = useState(() => tenantOfUrl(entry, server?.url) ?? '');
  const [tenantError, setTenantError] = useState<string | null>(null);
  const tenantId = domId(useId());
  const perCompany = needsTenant(entry);
  /** The program a stdio server starts with (`uvx`, `npx`), and where to get it. */
  const launcher =
    entry.transport === 'stdio' && entry.command ? launcherOf(entry.command) : undefined;
  const tenant = perCompany ? parseTenant(entry, tenantInput) : undefined;
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [authUrl, setAuthUrl] = useState<string | null>(null);
  /** The core says the callback page will not open here: paste its address (D-072). */
  const [paste, setPaste] = useState(false);
  const [agents, setAgents] = useState<string[]>(['*']);
  const name = server?.name ?? freeName(entry, data.servers);
  const test = useTest(name, reload);
  const tested = useRef(false);
  const runTest = test.run;

  useWaiting(state === 'waiting', onData);

  // Once connected (a sign-in that came back, a token saved), try it at once.
  useEffect(() => {
    if (state === 'connected' && !tested.current && authUrl !== null) {
      tested.current = true;
      void runTest();
    }
  }, [state, authUrl, runTest]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const connect = async (e?: FormEvent) => {
    e?.preventDefault();
    setError(null);
    setTenantError(null);
    if (perCompany && !tenant) {
      setTenantError(
        tenantInput.trim()
          ? `Non è il nome di un’azienda: scrivi solo la parte prima di ${tenantSuffix(entry)}.`
          : `Scrivi il nome della tua azienda su ${entry.name}.`,
      );
      return;
    }
    if (method.kind === 'token' && !token.trim()) {
      setError(`Incolla qui il codice che hai creato su ${entry.name}.`);
      return;
    }
    const url = catalogUrl(entry, method, tenant);
    const body: McpServerRequest =
      entry.transport === 'stdio'
        ? {
            transport: 'stdio',
            command: entry.command ?? '',
            args: entry.args,
            env: {},
            label: entry.name,
            catalog: entry.id,
            agents,
            // Only when adding: a value the user changed later is theirs.
            ...(!server && entry.timeoutSec ? { timeoutSec: entry.timeoutSec } : {}),
          }
        : {
            transport: 'http',
            url: url ?? '',
            label: entry.name,
            catalog: entry.id,
            oauth: method.kind === 'oauth',
            headers:
              method.kind === 'token' ? { [method.header]: `${method.prefix}${token.trim()}` } : {},
            ...(server ? {} : { agents }),
          };
    setBusy(true);
    try {
      const saved = await getApi().saveMcpServer(name, body);
      onData(saved);
      if (method.kind === 'oauth') {
        const start = await getApi().startMcpOAuth(name);
        setPaste(start.paste === true);
        if (start.status === 'redirect' && start.authorizationUrl) {
          setAuthUrl(start.authorizationUrl);
          // The system browser (the desktop app hands web links to it).
          window.open(start.authorizationUrl, '_blank', 'noopener');
        } else {
          setAuthUrl('');
        }
        onData(await getApi().mcpServers());
      } else {
        setToken('');
        notify(`${entry.name} collegato.`, 'success');
        tested.current = true;
        void runTest();
      }
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  const disconnect = async () => {
    if (!server) return;
    setBusy(true);
    try {
      onData(await getApi().removeMcpServer(server.name));
      notify(`${entry.name} scollegato.`, 'success');
      tested.current = false;
      setAuthUrl(null);
    } catch (err) {
      notify(errorOf(err), 'error');
    } finally {
      setBusy(false);
    }
  };

  const saveAgents = (next: string[]) => {
    if (!server) {
      setAgents(next);
      return;
    }
    getApi()
      .saveMcpServer(server.name, { agents: next })
      .then(onData)
      .catch((err: unknown) => notify(errorOf(err), 'error'));
  };

  const connected = state === 'connected' || state === 'error';
  // "Cambia il token" (D-072): the token way of the service, when it has one.
  const tokenAuth = methods.find((m) => m.kind === 'token');
  const tokenWay = tokenAuth?.kind === 'token' ? tokenAuth : undefined;
  const tools = server?.knownTools?.filter((t) => !t.skipped).length;

  return createPortal(
    <div
      className="fixed inset-x-0 top-[52px] bottom-0 z-40 flex items-end justify-center bg-black/40 sm:items-center sm:p-4"
      data-testid="gallery-layer"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <dialog
        open
        aria-labelledby={titleId}
        aria-modal="true"
        data-testid={`gallery-panel-${entry.id}`}
        className="popover relative m-0 grid max-h-full w-full gap-4 overflow-y-auto rounded-t-[16px] p-5 text-ink sm:w-[min(480px,100%)] sm:rounded-[16px] sm:p-6"
      >
        <div className="flex items-start gap-3.5">
          <BrandScreen icon={entry.icon} size={52} />
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="text-title3 font-semibold">
              {entry.name}
            </h2>
            <p className="text-footnote leading-snug text-ink-muted">{entry.description}</p>
            <div className="mt-1.5">
              <StateLabel state={state} />
            </div>
          </div>
          <Button variant="ghost" size="iconSm" aria-label="Chiudi" onClick={onClose} autoFocus>
            <X size={18} aria-hidden />
          </Button>
        </div>

        {via && (
          <ClaudeConnectBody entry={entry} view={via} agents={data.agents} onData={onClaude} />
        )}

        {!via && state === 'soon' && (
          <div className="grid gap-2 text-footnote leading-snug text-ink-muted">
            <p data-testid="gallery-soon">{entry.soon}</p>
            <p>
              Se hai già l’indirizzo e la chiave del programma (un “server MCP”), puoi aggiungerlo
              da “Aggiungi un programma”.
            </p>
          </div>
        )}

        {!via && state !== 'soon' && !connected && (
          <form className="grid gap-3.5" onSubmit={(e) => void connect(e)} noValidate>
            {methods.length > 1 && (
              <Segmented<string>
                value={String(methodIndex)}
                onChange={(v) => {
                  setMethodIndex(Number(v));
                  setError(null);
                }}
                label="Come collegarlo"
                size="sm"
                className="justify-self-start"
                options={methods.map((m, i) => ({ value: String(i), label: authLabel(entry, m) }))}
              />
            )}
            {perCompany && state !== 'waiting' && (
              <FormField
                id={tenantId}
                label={entry.tenantLabel ?? 'La tua azienda'}
                error={tenantError}
                hint={
                  tenant ? (
                    <>
                      Indirizzo:{' '}
                      <span className="font-mono" data-testid="gallery-tenant-url">
                        {catalogUrl(entry, method, tenant)}
                      </span>
                    </>
                  ) : (
                    entry.tenantHint
                  )
                }
              >
                <div className="flex items-center gap-1.5">
                  <Input
                    id={tenantId}
                    value={tenantInput}
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    placeholder={entry.tenantExample}
                    onChange={(e) => {
                      setTenantInput(e.target.value);
                      setTenantError(null);
                    }}
                    aria-invalid={tenantError ? true : undefined}
                    aria-describedby={`${tenantId}-${tenantError ? 'error' : 'hint'}`}
                    className="font-mono text-footnote"
                    data-testid="gallery-tenant"
                  />
                  <span className="shrink-0 font-mono text-footnote text-ink-muted">
                    {tenantSuffix(entry)}
                  </span>
                </div>
              </FormField>
            )}
            {method.kind === 'oauth' && state !== 'waiting' && server?.oauth?.moreScope && (
              <p className="text-footnote leading-snug text-ink" data-testid="gallery-more-scope">
                {entry.name} chiede un permesso in più per quello che i mostri gli hanno chiesto. Il
                resto funziona già: con Collega lo confermi sulla sua pagina.
              </p>
            )}
            {method.kind === 'oauth' && state !== 'waiting' && (
              <p className="text-footnote leading-snug text-ink-muted">
                Si apre la pagina di {entry.name}: accedi e conferma, poi torna qui. Monsters non
                vede la tua password.
              </p>
            )}
            {method.kind === 'none' && (
              <p className="text-footnote leading-snug text-ink-muted">
                Non serve nessun accesso: basta collegarlo.
                {launcher && (
                  <span data-testid="gallery-launcher">
                    {' '}
                    Si avvia con {entry.command}, che fa parte di {launcher.needs}: se non ce l’hai,{' '}
                    <a
                      href={launcher.url}
                      target="_blank"
                      rel="noreferrer"
                      className="font-medium text-signal-ink underline underline-offset-2"
                    >
                      installa {launcher.needs}
                    </a>
                    .
                  </span>
                )}
              </p>
            )}
            {method.kind === 'token' && (
              <FormField
                id={tokenId}
                label={method.label}
                error={error ?? undefined}
                hint={method.hint ?? 'Resta su questo computer e non lo mostriamo più.'}
              >
                <div className="grid gap-2">
                  <Input
                    id={tokenId}
                    type="password"
                    value={token}
                    autoComplete="off"
                    spellCheck={false}
                    onChange={(e) => setToken(e.target.value)}
                    aria-invalid={error ? true : undefined}
                    className="font-mono text-footnote"
                  />
                  <a
                    href={catalogCreateUrl(method, tenant) ?? undefined}
                    aria-disabled={catalogCreateUrl(method, tenant) ? undefined : true}
                    onClick={(e) => {
                      if (catalogCreateUrl(method, tenant)) return;
                      e.preventDefault();
                      setTenantError(`Scrivi prima la tua azienda su ${entry.name}.`);
                    }}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 justify-self-start text-footnote font-medium text-signal-ink underline underline-offset-2"
                  >
                    Crea il token
                    <ArrowSquareOut size={14} aria-hidden />
                  </a>
                </div>
              </FormField>
            )}
            {state === 'waiting' && (
              <p
                className="flex gap-2 text-footnote leading-snug text-ink-muted"
                data-testid="gallery-waiting"
              >
                <Meter active className="mt-1.5 shrink-0 text-signal-ink" />
                <span>
                  <strong className="font-semibold text-ink">
                    Completa l’accesso nel browser.
                  </strong>{' '}
                  Questa finestra si aggiorna da sola.
                  {authUrl && (
                    <>
                      {' '}
                      <a
                        href={authUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-ink underline"
                      >
                        Riapri la pagina di accesso
                      </a>
                      .
                    </>
                  )}
                </span>
              </p>
            )}
            {!server && <AgentPicker agents={data.agents} value={agents} onChange={setAgents} />}
            {entry.note && (
              <p className="text-footnote leading-snug text-ink-muted">{entry.note}</p>
            )}
            {error && method.kind !== 'token' && (
              <p className="text-footnote text-stop-ink" role="alert">
                {error}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                {busy ? 'Collego…' : state === 'waiting' ? 'Ricomincia' : 'Collega'}
              </Button>
              {server && (
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => void disconnect()}>
                  Annulla
                </Button>
              )}
            </div>
          </form>
        )}
        {state === 'waiting' && (
          <OAuthPaste
            key={paste ? 'paste' : 'link'}
            open={paste}
            onDone={() => void getApi().mcpServers().then(onData)}
          />
        )}

        {!via && connected && server && (
          <div className="grid gap-3.5">
            {server.error && (
              <p className="text-footnote text-stop-ink" data-testid="gallery-error">
                {server.error}
              </p>
            )}
            {tools !== undefined && !test.result && (
              <p className="text-footnote text-ink-muted">{tools} strumenti pronti per i mostri.</p>
            )}
            <AgentPicker agents={data.agents} value={server.agents} onChange={saveAgents} />
            <div className="flex flex-wrap items-center gap-2">
              <TestButton testing={test.testing} onClick={() => void test.run()} />
              <ConfirmButton
                label="Scollega"
                question={`Scollego ${entry.name}?`}
                confirm="Sì, scollega"
                busy={busy}
                onConfirm={() => void disconnect()}
              />
              {tokenWay && server.headerKeys.length > 0 && (
                <SecretChange
                  server={server}
                  token={tokenWay}
                  service={entry.name}
                  onSaved={onData}
                  onTest={() => void test.run()}
                  disabled={busy}
                />
              )}
            </div>
            <ToolsResult result={test.result} />
            <Details>
              <span className="font-mono">
                {server.url ?? [server.command, ...(server.args ?? [])].join(' ')}
              </span>
              {server.headerKeys.length > 0 && (
                <span>{server.headerKeys.join(', ')} (valore nascosto)</span>
              )}
              {server.oauth && <span>Accesso con OAuth: i token restano su questo computer.</span>}
              <a href={entry.docs} target="_blank" rel="noreferrer" className="underline">
                Documentazione di {entry.name}
              </a>
            </Details>
          </div>
        )}
      </dialog>
    </div>,
    document.body,
  );
}

/** The gallery: a grid of keys, connected ones first, "Presto" last. */
export function McpGallery({
  data,
  onData,
  reload,
}: {
  data: McpServersResponse;
  onData: (d: McpServersResponse) => void;
  reload: () => void;
}) {
  const [open, setOpen] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [claude, setClaude] = useState<ClaudeConnectionsResponse | null>(null);
  const opener = useRef<HTMLButtonElement | null>(null);
  // Services through Claude (D-069): the choice at once, then how they stand (asked to Claude Code).
  useEffect(() => {
    let live = true;
    getApi()
      .claudeConnections()
      .then((d) => {
        if (!live) return;
        setClaude(d);
        if (d.claude && d.connections.some((c) => c.added)) {
          void getApi()
            .claudeConnections({ check: true })
            .then((checked) => live && setClaude(checked))
            .catch(() => {});
        }
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  const order: Record<GalleryState, number> = {
    connected: 0,
    error: 0,
    waiting: 0,
    login: 0,
    signin: 0,
    off: 1,
    claude: 1,
    soon: 2,
  };
  const entries = MCP_CATALOG.map((entry, i) => {
    const via = viaClaudeOf(entry, claude);
    const server = serverOf(entry, data.servers);
    return { entry, state: via ? claudeGalleryState(via) : galleryState(entry, server), i };
  }).sort((a, b) => order[a.state] - order[b.state] || a.i - b.i);
  const shown = all ? entries : entries.filter((e, i) => i < FIRST || order[e.state] === 0);
  const current = MCP_CATALOG.find((e) => e.id === open);
  const close = useCallback(() => {
    setOpen(null);
    opener.current?.focus();
  }, []);

  return (
    <Group
      title="App e servizi"
      level={3}
      testId="mcp-gallery"
      description="Collega i servizi che usi e i mostri potranno leggerli e usarli. Ogni uso finisce in Attività e “Ferma” li ferma subito."
    >
      <div className="grid gap-3 p-3 sm:p-4">
        <ul
          className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,264px),1fr))] gap-2.5"
          aria-label="App e servizi"
        >
          {shown.map(({ entry, state }) => (
            <li key={entry.id}>
              <button
                type="button"
                onClick={(e) => {
                  opener.current = e.currentTarget;
                  setOpen(entry.id);
                }}
                data-testid={`gallery-${entry.id}`}
                aria-haspopup="dialog"
                className={cn(
                  'key flex h-full min-h-[96px] w-full items-center gap-3.5 rounded-[12px] px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink',
                  state === 'soon' && '[--cap:var(--panel)]',
                )}
              >
                <BrandScreen icon={entry.icon} />
                <span className="grid min-w-0 flex-1 gap-0.5">
                  <span className="truncate text-body font-semibold text-ink">{entry.name}</span>
                  <span className="line-clamp-2 text-footnote leading-snug text-ink-muted">
                    {entry.description}
                  </span>
                  <span className="mt-1">
                    <StateLabel state={state} />
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
        {!all && entries.length > shown.length && (
          <Button
            variant="secondary"
            size="sm"
            className="justify-self-start"
            onClick={() => setAll(true)}
          >
            Mostra tutti ({entries.length})
          </Button>
        )}
      </div>
      {current && (
        <ConnectPanel
          key={current.id}
          entry={current}
          data={data}
          onData={onData}
          reload={reload}
          onClose={close}
          via={viaClaudeOf(current, claude)}
          onClaude={setClaude}
        />
      )}
    </Group>
  );
}
