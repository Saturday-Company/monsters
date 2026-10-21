import { CaretRight, Warning } from '@phosphor-icons/react';
import type { McpServerStatus, McpServersResponse, McpTestResponse } from '@monsters/shared';
import { useId, useState, type CSSProperties, type ReactNode } from 'react';
import { ApiError, describeError } from '../../lib/api.ts';
import { cn, domId } from '../../lib/utils.ts';
import { getApi } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { Meter } from '../ui/Meter.tsx';
import { mcpStrings } from './mcp.strings.ts';

/*
 * Pieces shared by the MCP settings (McpServersSection) and the gallery of
 * services (McpGallery, D-063): status, who uses a server, the test and its
 * result, the technical details.
 */

export type Agents = McpServersResponse['agents'];

/** The message of the core when it has a specific one, the generic one otherwise. */
export function errorOf(err: unknown): string {
  if (
    err instanceof ApiError &&
    err.message &&
    err.message !== err.code &&
    ['invalid_server', 'unknown_server', 'unknown_agent', 'invalid_request'].includes(err.code)
  ) {
    return err.message;
  }
  return describeError(err);
}

/**
 * The state of a server with its light (UI-22): green when it is on and ready
 * (started, or waiting for its first use), grey and "Off" when it is off.
 */
export function StatusPill({
  status,
  error,
  enabled = true,
}: {
  status: McpServerStatus;
  error?: string | undefined;
  /** The user's lever: a server turned off is "Off" whatever its process says. */
  enabled?: boolean;
}) {
  const shown: McpServerStatus = enabled ? status : 'off';
  const ready = shown === 'running' || shown === 'idle';
  return (
    <span
      className={cn(
        'label inline-flex shrink-0 items-center gap-1.5',
        shown === 'error' ? 'text-stop-ink' : ready ? 'text-ink' : 'text-ink-muted',
      )}
      data-testid="mcp-status"
      data-status={shown}
      title={error}
    >
      <span
        aria-hidden
        className="led"
        data-tone={shown === 'error' ? 'stop' : ready ? 'ok' : undefined}
      />
      {mcpStrings().parts.status[shown]}
    </span>
  );
}

export function AgentPicker({
  agents,
  value,
  onChange,
  needsWeb,
  disabled,
}: {
  agents: Agents;
  value: string[];
  onChange: (next: string[]) => void;
  needsWeb?: boolean;
  disabled?: boolean;
}) {
  const s = mcpStrings().parts;
  const all = value.includes('*');
  const has = (id: string) => all || value.includes(id);
  const toggle = (id: string) => {
    const current = all ? agents.map((a) => a.id) : value;
    onChange(has(id) ? current.filter((x) => x !== id) : [...current, id]);
  };
  return (
    <div className="grid gap-2">
      <p className="text-footnote font-medium text-ink">{s.whoUses}</p>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label={s.whoUsesLabel}>
        {agents.map((a) => {
          const blocked = needsWeb && !a.web;
          const on = has(a.id) && !blocked;
          return (
            <button
              key={a.id}
              type="button"
              aria-pressed={on}
              disabled={disabled || blocked}
              onClick={() => toggle(a.id)}
              title={blocked ? s.noWebTitle(a.name) : undefined}
              data-pressed={on ? 'true' : undefined}
              className={cn(
                'key inline-flex h-9 items-center gap-2 rounded-[9px] px-3.5 text-footnote font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink disabled:opacity-50',
                on
                  ? 'font-semibold text-ink [--cap:var(--panel)]'
                  : 'text-ink-muted hover:text-ink',
              )}
            >
              <span
                className="led"
                data-tone={on ? 'ok' : undefined}
                style={on ? ({ '--led': a.color } as CSSProperties) : undefined}
                aria-hidden
              />
              {a.name}
              {blocked ? s.noWebSuffix : ''}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function ToolsResult({ result }: { result: McpTestResponse | null }) {
  const s = mcpStrings().parts;
  if (!result) return null;
  if (!result.ok) {
    return (
      <p
        className="flex gap-2 rounded-[10px] bg-stop-soft px-3 py-2.5 text-footnote leading-snug text-stop-ink"
        role="alert"
        data-testid="mcp-test-error"
      >
        <Warning size={18} aria-hidden className="mt-px shrink-0" />
        <span>{result.error ?? s.cantStart}</span>
      </p>
    );
  }
  const usable = result.tools.filter((t) => !t.skipped);
  return (
    <div className="grid gap-1.5" data-testid="mcp-tools">
      <p className="flex items-center gap-1.5 text-footnote font-medium text-ink">
        <span aria-hidden className="led mx-1" data-tone="ok" />
        {s.works(result.server, usable.length)}
      </p>
      <ul className="grid gap-0.5 text-footnote text-ink-muted">
        {result.tools.map((t) => (
          <li key={t.name} className="min-w-0">
            <span className="font-mono text-caption text-ink">{t.name}</span>
            {t.skipped ? (
              <span className="text-stop-ink">{s.unusable(t.skipped)}</span>
            ) : t.description ? (
              <span> · {t.description}</span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function useTest(name: string, reload: () => void) {
  const [result, setResult] = useState<McpTestResponse | null>(null);
  const [testing, setTesting] = useState(false);
  const run = async () => {
    setTesting(true);
    setResult(null);
    try {
      setResult(await getApi().testMcpServer(name));
    } catch (err) {
      setResult({ ok: false, tools: [], error: errorOf(err) });
    } finally {
      setTesting(false);
      // Status and known tools changed on the core.
      reload();
    }
  };
  return { result, testing, run };
}

export function TestButton({ testing, onClick }: { testing: boolean; onClick: () => void }) {
  return (
    <Button variant="secondary" size="sm" onClick={onClick} disabled={testing}>
      {testing ? <Meter active className="text-ink-muted" /> : null}
      {testing ? mcpStrings().parts.testing : mcpStrings().parts.test}
    </Button>
  );
}

/** Technical details (address, command, profile folder), out of the way until asked for. */
export function Details({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const id = domId(useId());
  return (
    <div className="grid gap-1.5">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={id}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 justify-self-start rounded text-footnote font-medium text-ink-muted hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal-ink"
      >
        <CaretRight size={12} aria-hidden className={cn('turn', open && 'rotate-90')} />
        {mcpStrings().parts.details}
      </button>
      {open && (
        <div
          id={id}
          className="grid gap-0.5 pl-4 text-footnote break-all text-ink-muted"
          data-testid="mcp-details"
        >
          {children}
        </div>
      )}
    </div>
  );
}
