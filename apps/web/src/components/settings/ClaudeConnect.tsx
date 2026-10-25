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
import { AgentPicker, Details, errorOf, useSavedAgents } from './mcp-parts.tsx';
import { mcpStrings } from './mcp.strings.ts';
import { ConfirmButton } from './parts.tsx';

/*
 * A gallery service connected "through Claude" (D-069): Claude is an approved
 * app of the service, so the user connects it on their Claude account (or,
 * for Claude Design, with `/design-login` in Claude Code), and the monsters
 * that work with the Claude plan get it in their runs. Monsters keeps only
 * the choice and asks Claude Code how it stands: it never sees a token.
 */

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
      {mcpStrings().claude.openConnectors}
      <ArrowSquareOut size={14} aria-hidden />
    </a>
  );
}

/** How to connect it, in two steps. */
function Steps({ entry }: { entry: McpCatalogEntry }) {
  const s = mcpStrings().claude;
  const via = entry.viaClaude!;
  return (
    <ol className="grid list-decimal gap-1.5 pl-5 text-footnote leading-snug text-ink-muted">
      {via.login === 'design-login' ? (
        <li>
          {s.designLogin.before}
          <Code>{'claude'}</Code>
          {s.designLogin.then}
          <Code>{'/design-login'}</Code>
          {s.designLogin.after}
        </li>
      ) : (
        <li className="grid gap-1">
          <span>{s.connectOnClaude(entry.name)}</span>
          <ConnectorsLink />
        </li>
      )}
      <li>{s.pressConnect}</li>
    </ol>
  );
}

/** What to do when it is not ready, with the way that fits its state. */
function NotReady({ entry, view }: { entry: McpCatalogEntry; view: ClaudeConnectionView }) {
  const s = mcpStrings().claude;
  const via = entry.viaClaude!;
  if (view.state === 'connected') return null;
  const names = via.connectors.map((c) => `claude.ai ${c.name}`);
  return (
    <div
      className="grid gap-1.5 text-footnote leading-snug text-ink-muted"
      data-testid="claude-todo"
    >
      <p className={view.state === 'error' ? 'text-stop-ink' : undefined}>
        {view.message ?? s.state[view.state]}
      </p>
      {via.login === 'claude-ai' && view.state !== 'unknown' && (
        <>
          <p>{s.reconnect(view.state === 'needs_login')}</p>
          <ConnectorsLink />
          {view.state === 'needs_login' && (
            <p>
              {s.orTerminal}{' '}
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
          {s.designTerminal.before}
          <Code>{'claude'}</Code>
          {s.designTerminal.then}
          <Code>{'/design-login'}</Code>
          {s.designTerminal.after}
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
  const s = mcpStrings().claude;
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
        notify(s.connectedVia(entry.name), 'success');
      }
      if (kind === 'remove') notify(s.removed(entry.name), 'success');
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(null);
    }
  };

  const savedAgents = useSavedAgents(view.added ? view.agents : [], (next) =>
    getApi().setClaudeConnection(entry.id, { agents: next }).then(onData),
  );
  const saveAgents = (next: string[]) => {
    if (!view.added) {
      setChosen(next);
      return;
    }
    savedAgents.change(next);
  };

  return (
    <div className="grid gap-3.5" data-testid="claude-connect">
      <p className="text-footnote leading-snug text-ink-muted">{s.intro}</p>
      {!view.added && <Steps entry={entry} />}
      {view.added && <NotReady entry={entry} view={view} />}
      <AgentPicker
        agents={agents}
        value={view.added ? savedAgents.value : chosen}
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
            {busy === 'add' ? s.checking : s.connect}
          </Button>
        ) : (
          <>
            <Button
              variant="secondary"
              size="sm"
              disabled={busy !== null}
              onClick={() => void act('check', () => getApi().checkClaudeConnection(entry.id))}
            >
              {busy === 'check' ? s.checking : s.checkAgain}
            </Button>
            <ConfirmButton
              label={s.disconnect}
              question={s.disconnectQuestion(entry.name)}
              confirm={s.disconnectConfirm}
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
                {p.name}: {s.partState[p.state]}
              </span>
            ))}
          <span>{s.through}</span>
          <a href={entry.docs} target="_blank" rel="noreferrer" className="underline">
            {s.docs(entry.name)}
          </a>
        </Details>
      )}
    </div>
  );
}
