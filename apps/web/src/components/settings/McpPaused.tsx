import type { McpPausedTool, McpServerView, McpServersResponse } from '@monsters/shared';
import { useState } from 'react';
import { errorText, getApi, notify } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { mcpStrings } from './mcp.strings.ts';
import { ConfirmButton, Group, RowBody } from './parts.tsx';

/*
 * Tools of another program that are new or changed since you accepted them
 * (D-070, research 07 §5.9): the monsters do not get them until "Accept".
 * The card says what changed, the old description beside the new one, and
 * offers "Accept" or "Disconnect" (the app goes away).
 */

/** The fingerprints the card shows, sent back with "Accetta". */
function seenOf(tools: readonly McpPausedTool[]): Record<string, string> | undefined {
  const pairs = tools.flatMap((t) => (t.hash ? [[t.name, t.hash] as const] : []));
  return pairs.length === tools.length && pairs.length > 0 ? Object.fromEntries(pairs) : undefined;
}

function ToolChange({ tool }: { tool: McpPausedTool }) {
  const s = mcpStrings().paused;
  return (
    <li className="grid gap-1.5" data-testid={`mcp-paused-tool-${tool.name}`}>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-mono text-caption text-ink">{tool.name}</span>
        <span className="label text-ink-muted">
          {tool.change === 'new'
            ? s.isNew
            : tool.before !== undefined
              ? tool.schemaChanged
                ? s.descriptionAndArgs
                : s.description
              : s.args}
        </span>
      </p>
      {tool.before !== undefined && (
        <p className="screen rounded-[8px] px-2.5 py-1.5 font-mono text-micro leading-snug text-screen-muted line-through decoration-[var(--screen-muted)]">
          {tool.before || s.noDescription}
        </p>
      )}
      <p className="screen rounded-[8px] px-2.5 py-1.5 font-mono text-micro leading-snug text-screen-ink">
        {tool.description || s.noDescription}
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
  const s = mcpStrings().paused;
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
          {s.summary(tools.length, tools[0]?.change === 'new')}
        </p>
        <ul className="grid gap-3">
          {tools.map((t) => (
            <ToolChange key={t.name} tool={t} />
          ))}
        </ul>
        <p className="text-footnote leading-snug text-ink-muted">{s.warning}</p>
        <div className="flex flex-wrap justify-end gap-2.5">
          <ConfirmButton
            label={s.disconnect}
            question={s.removeQuestion(label)}
            confirm={s.disconnect}
            busy={busy}
            onConfirm={() =>
              void run(() => getApi().removeMcpServer(server.name), s.disconnected(label))
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
                s.accepted(tools.length),
              )
            }
          >
            {s.accept}
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
  const s = mcpStrings().paused;
  const waiting = data.servers.filter((s) => (s.pausedTools?.length ?? 0) > 0);
  if (waiting.length === 0) return null;
  return (
    <Group title={s.title} id="settings-pausa" testId="mcp-paused" description={s.cardDescription}>
      {waiting.map((s) => (
        <ServerChanges key={s.name} server={s} onData={onData} />
      ))}
    </Group>
  );
}
