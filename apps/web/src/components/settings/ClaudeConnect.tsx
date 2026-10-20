import { ArrowSquareOut } from '@phosphor-icons/react';
import {
  CLAUDE_CONNECTORS_URL,
  type ClaudeConnectionView,
  type ClaudeConnectionsResponse,
  type McpCatalogEntry,
  type McpServersResponse,
} from '@monsters/shared';
import { useState } from 'react';
import { getApi, notify } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { AgentPicker, Details, errorOf } from './mcp-parts.tsx';
import { ConfirmButton } from './parts.tsx';

/*
 * A gallery service connected "tramite Claude" (D-069): Claude is an approved
 * app of the service, so the user connects it on their Claude account (or,
 * for Claude Design, with `/design-login` in Claude Code), and the monsters
 * that work with the Claude plan get it in their runs. Monsters keeps only
 * the choice and asks Claude Code how it stands: it never sees a token.
 */

const STATE_SENTENCE: Record<ClaudeConnectionView['state'], string> = {
  connected: 'Pronto: lo usano i mostri che lavorano con Claude.',
  needs_login: 'Claude chiede di accedere di nuovo.',
  missing: 'Non lo trovo sul tuo account Claude.',
  unknown: 'Non l’ho ancora controllato.',
  error: 'Claude non riesce a raggiungerlo.',
};

/** One part of a service (Gmail, Drive, Calendar) in the details. */
const PART_STATE: Record<ClaudeConnectionView['state'], string> = {
  connected: 'pronto',
  needs_login: 'da ricollegare',
  missing: 'non è sul tuo account Claude',
  unknown: 'da controllare',
  error: 'problema',
};

function Code({ children }: { children: string }) {
  return (
    <code className="rounded-[6px] bg-well px-1.5 py-0.5 font-mono text-[0.85em] text-ink">
      {children}
    </code>
  );
}

function ConnectorsLink() {
  return (
    <a
      href={CLAUDE_CONNECTORS_URL}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 justify-self-start text-footnote font-medium text-signal-ink underline underline-offset-2"
    >
      Apri i connettori di Claude
      <ArrowSquareOut size={14} aria-hidden />
    </a>
  );
}

/** How to connect it, in two steps. */
function Steps({ entry }: { entry: McpCatalogEntry }) {
  const via = entry.viaClaude!;
  return (
    <ol className="grid list-decimal gap-1.5 pl-5 text-footnote leading-snug text-ink-muted">
      {via.login === 'design-login' ? (
        <li>
          In un terminale di questo computer scrivi <Code>claude</Code>, poi{' '}
          <Code>/design-login</Code> e accedi con il tuo account Claude.
        </li>
      ) : (
        <li className="grid gap-1">
          <span>
            Collega {entry.name} al tuo account Claude, se non l’hai già fatto (Impostazioni →
            Connettori).
          </span>
          <ConnectorsLink />
        </li>
      )}
      <li>Premi “Collega”: Monsters controlla che Claude lo veda.</li>
    </ol>
  );
}

/** What to do when it is not ready, with the way that fits its state. */
function NotReady({ entry, view }: { entry: McpCatalogEntry; view: ClaudeConnectionView }) {
  const via = entry.viaClaude!;
  if (view.state === 'connected') return null;
  const names = via.connectors.map((c) => `claude.ai ${c.name}`);
  return (
    <div
      className="grid gap-1.5 text-footnote leading-snug text-ink-muted"
      data-testid="claude-todo"
    >
      <p className={view.state === 'error' ? 'text-stop-ink' : undefined}>
        {view.message ?? STATE_SENTENCE[view.state]}
      </p>
      {via.login === 'claude-ai' && view.state !== 'unknown' && (
        <>
          <p>
            {view.state === 'needs_login' ? 'Ricollegalo' : 'Collegalo'} dai connettori di Claude,
            poi premi “Ricontrolla”.
          </p>
          <ConnectorsLink />
          {view.state === 'needs_login' && (
            <p>
              Oppure, in un terminale di questo computer:{' '}
              {names.map((n, i) => (
                <span key={n}>
                  {i > 0 && ', '}
                  <Code>{`claude mcp login "${n}"`}</Code>
                </span>
              ))}
            </p>
          )}
        </>
      )}
      {via.login === 'design-login' && view.state !== 'unknown' && !view.message && (
        <p>
          In un terminale scrivi <Code>claude</Code>, poi <Code>/design-login</Code>.
        </p>
      )}
    </div>
  );
}

/** The body of the gallery panel of a service reached through Claude. */
export function ClaudeConnectBody({
  entry,
  view,
  agents,
  onData,
}: {
  entry: McpCatalogEntry;
  view: ClaudeConnectionView;
  agents: McpServersResponse['agents'];
  onData: (d: ClaudeConnectionsResponse) => void;
}) {
  const [busy, setBusy] = useState<'add' | 'check' | 'remove' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [chosen, setChosen] = useState<string[]>(['*']);

  const act = async (
    kind: 'add' | 'check' | 'remove',
    work: () => Promise<ClaudeConnectionsResponse>,
  ) => {
    setBusy(kind);
    setError(null);
    try {
      const d = await work();
      onData(d);
      const after = d.connections.find((c) => c.id === entry.id);
      if (kind === 'add' && after?.state === 'connected') {
        notify(`${entry.name} collegato tramite Claude.`, 'success');
      }
      if (kind === 'remove') notify(`${entry.name} scollegato da Monsters.`, 'success');
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(null);
    }
  };

  const saveAgents = (next: string[]) => {
    if (!view.added) {
      setChosen(next);
      return;
    }
    getApi()
      .setClaudeConnection(entry.id, { agents: next })
      .then(onData)
      .catch((err: unknown) => notify(errorOf(err), 'error'));
  };

  return (
    <div className="grid gap-3.5" data-testid="claude-connect">
      <p className="text-footnote leading-snug text-ink-muted">
        Si collega tramite il tuo abbonamento Claude: lo usano i mostri che lavorano con Claude.
        L’accesso lo fai su Claude, Monsters non vede password né token.
      </p>
      {!view.added && <Steps entry={entry} />}
      {view.added && <NotReady entry={entry} view={view} />}
      <AgentPicker
        agents={agents}
        value={view.added ? view.agents : chosen}
        onChange={saveAgents}
      />
      {error && (
        <p className="text-footnote text-stop-ink" role="alert">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {!view.added ? (
          <Button
            size="sm"
            disabled={busy !== null}
            onClick={() =>
              void act('add', () => getApi().setClaudeConnection(entry.id, { agents: chosen }))
            }
          >
            {busy === 'add' ? 'Controllo…' : 'Collega'}
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => void act('check', () => getApi().checkClaudeConnection(entry.id))}
            >
              {busy === 'check' ? 'Controllo…' : 'Ricontrolla'}
            </Button>
            <ConfirmButton
              label="Scollega"
              question={`Scollego ${entry.name} da Monsters? Resta collegato al tuo account Claude.`}
              confirm="Sì, scollega"
              busy={busy !== null}
              onConfirm={() => void act('remove', () => getApi().removeClaudeConnection(entry.id))}
            />
          </>
        )}
      </div>
      {view.added && (
        <Details>
          {view.parts.length > 1 &&
            view.parts.map((p) => (
              <span key={p.name}>
                {p.name}: {PART_STATE[p.state]}
              </span>
            ))}
          <span>Tramite Claude Code e il tuo abbonamento Claude.</span>
          <a href={entry.docs} target="_blank" rel="noreferrer" className="underline">
            Documentazione di {entry.name}
          </a>
        </Details>
      )}
    </div>
  );
}
