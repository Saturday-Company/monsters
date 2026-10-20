import type { McpPausedTool, McpServerView, McpServersResponse } from '@monsters/shared';
import { useState } from 'react';
import { errorText, getApi, notify } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { ConfirmButton, Group, RowBody } from './parts.tsx';

/*
 * Tools of another program that are new or changed since you accepted them
 * (D-070, research 07 §5.9): the monsters do not get them until "Accetta".
 * The card says what changed, the old description beside the new one, and
 * offers "Accetta" or "Scollega" (the program goes away).
 */

/** The fingerprints the card shows, sent back with "Accetta". */
function seenOf(tools: readonly McpPausedTool[]): Record<string, string> | undefined {
  const pairs = tools.flatMap((t) => (t.hash ? [[t.name, t.hash] as const] : []));
  return pairs.length === tools.length && pairs.length > 0 ? Object.fromEntries(pairs) : undefined;
}

function ToolChange({ tool }: { tool: McpPausedTool }) {
  return (
    <li className="grid gap-1.5" data-testid={`mcp-paused-tool-${tool.name}`}>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-caption text-ink">{tool.name}</span>
        <span className="label text-ink-muted">
          {tool.change === 'new'
            ? 'nuovo'
            : tool.before !== undefined
              ? tool.schemaChanged
                ? 'descrizione e argomenti cambiati'
                : 'descrizione cambiata'
              : 'argomenti cambiati'}
        </span>
      </p>
      {tool.before !== undefined && (
        <p className="screen rounded-[8px] px-2.5 py-1.5 font-mono text-micro leading-snug text-screen-muted line-through decoration-[var(--screen-muted)]">
          {tool.before || '(nessuna descrizione)'}
        </p>
      )}
      <p className="screen rounded-[8px] px-2.5 py-1.5 font-mono text-micro leading-snug text-screen-ink">
        {tool.description || '(nessuna descrizione)'}
      </p>
    </li>
  );
}

function ServerChanges({
  server,
  onData,
}: {
  server: McpServerView;
  onData: (d: McpServersResponse) => void;
}) {
  const [busy, setBusy] = useState(false);
  const tools = server.pausedTools ?? [];
  const label = server.label;
  const run = async (work: () => Promise<McpServersResponse>, done: string) => {
    setBusy(true);
    try {
      onData(await work());
      notify(done, 'success');
    } catch (err) {
      notify(errorText(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <RowBody>
      <div className="grid gap-3" data-testid={`mcp-paused-${server.name}`}>
        <p className="text-body text-ink">
          <span className="font-medium">{label}</span>{' '}
          {tools.length === 1
            ? `ha ${tools[0]!.change === 'new' ? 'uno strumento nuovo' : 'cambiato uno strumento'}: i mostri non lo usano finché non lo accetti.`
            : `ha ${tools.length} strumenti nuovi o cambiati: i mostri non li usano finché non li accetti.`}
        </p>
        <ul className="grid gap-3">
          {tools.map((t) => (
            <ToolChange key={t.name} tool={t} />
          ))}
        </ul>
        <p className="text-footnote leading-snug text-ink-muted">
          Una descrizione cambiata è il modo in cui un programma può dare ordini nuovi ai mostri:
          leggila prima di accettare.
        </p>
        <div className="flex flex-wrap justify-end gap-2.5">
          <ConfirmButton
            label="Scollega"
            question={`Togliere ${label}?`}
            confirm="Scollega"
            busy={busy}
            onConfirm={() =>
              void run(() => getApi().removeMcpServer(server.name), `${label} scollegato.`)
            }
          />
          <Button
            variant="primary"
            size="sm"
            disabled={busy}
            data-testid={`mcp-accept-${server.name}`}
            onClick={() =>
              void run(
                // What this card shows: a tool that changed again stays paused.
                () => getApi().acceptMcpTools(server.name, undefined, seenOf(tools)),
                tools.length === 1 ? 'Strumento accettato.' : 'Strumenti accettati.',
              )
            }
          >
            Accetta
          </Button>
        </div>
      </div>
    </RowBody>
  );
}

/** The card above the other programs, only when something waits. */
export function McpPausedCard({
  data,
  onData,
}: {
  data: McpServersResponse;
  onData: (d: McpServersResponse) => void;
}) {
  const waiting = data.servers.filter((s) => (s.pausedTools?.length ?? 0) > 0);
  if (waiting.length === 0) return null;
  return (
    <Group
      title="Strumenti in pausa"
      id="settings-pausa"
      testId="mcp-paused"
      description="Sono cambiati da quando li hai collegati. Gli altri strumenti degli stessi programmi funzionano come prima."
    >
      {waiting.map((s) => (
        <ServerChanges key={s.name} server={s} onData={onData} />
      ))}
    </Group>
  );
}
