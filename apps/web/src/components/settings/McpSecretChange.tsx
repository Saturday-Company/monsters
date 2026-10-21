import { ArrowSquareOut } from '@phosphor-icons/react';
import type { McpServerRequest, McpServerView, McpServersResponse } from '@monsters/shared';
import { useId, useState, type FormEvent } from 'react';
import { domId } from '../../lib/utils.ts';
import { getApi, notify } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { Segmented } from '../ui/controls.tsx';
import { Input } from '../ui/field.tsx';
import { errorOf } from './mcp-parts.tsx';
import { mcpStrings } from './mcp.strings.ts';
import { FormField } from './parts.tsx';
import { partsStrings } from './parts.strings.ts';

/*
 * "Change the token" (D-072): a new value for the secret of a connection,
 * without disconnecting it. Only that value changes: the other variables or
 * headers are sent empty (the core keeps them), the address, who uses it and
 * the permissions stay as they are. The core stops the old connection; the
 * test that follows connects again with the new token.
 */

/** The token way of a service of the gallery: header, prefix, words and page. */
export interface TokenWay {
  header: string;
  prefix: string;
  label: string;
  createUrl?: string | undefined;
}

/** The request that changes one secret and keeps every other one (empty = keep). */
export function secretChangeRequest(
  server: Pick<McpServerView, 'transport' | 'envKeys' | 'headerKeys'>,
  key: string,
  value: string,
): McpServerRequest {
  const keys = server.transport === 'http' ? server.headerKeys : server.envKeys;
  const values: Record<string, string> = Object.fromEntries(keys.map((k) => [k, '']));
  // The same name with another case would be two headers: replace the saved one.
  const saved = keys.find((k) => k.toLowerCase() === key.toLowerCase());
  values[saved ?? key] = value;
  return server.transport === 'http' ? { headers: values } : { env: values };
}

export function SecretChange({
  server,
  token,
  service,
  onSaved,
  onTest,
  disabled,
}: {
  server: McpServerView;
  /** Gallery: the token way of the service; else the saved names are offered. */
  token?: TokenWay | undefined;
  /** Name shown in the messages. */
  service: string;
  onSaved: (data: McpServersResponse) => void;
  /** Runs the test after the change (it connects again with the new token). */
  onTest?: () => void;
  disabled?: boolean;
}) {
  const s = mcpStrings().secret;
  const common = partsStrings();
  const id = domId(useId());
  const keys = token ? [token.header] : [...server.envKeys, ...server.headerKeys];
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(keys[0] ?? '');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (keys.length === 0 || server.oauth) return null;

  const close = () => {
    setOpen(false);
    setValue('');
    setError(null);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const v = value.trim();
    if (!v) {
      setError(s.empty);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const data = await getApi().saveMcpServer(
        server.name,
        secretChangeRequest(server, key, `${token?.prefix ?? ''}${v}`),
      );
      onSaved(data);
      close();
      notify(s.changed(service), 'success');
      onTest?.();
    } catch (err) {
      setError(errorOf(err));
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
        data-testid="mcp-change-token"
      >
        {s.change}
      </Button>
    );
  }

  return (
    <form
      className="grid w-full gap-3"
      onSubmit={(e) => void save(e)}
      noValidate
      data-testid="mcp-token-form"
    >
      {keys.length > 1 && (
        <Segmented<string>
          value={key}
          onChange={setKey}
          label={s.which}
          size="sm"
          className="justify-self-start"
          options={keys.map((k) => ({ value: k, label: k }))}
        />
      )}
      <FormField
        id={id}
        label={token?.label ?? (keys.length === 1 ? s.newValueOf(key) : s.newValue)}
        error={error}
        hint={s.hint}
      >
        <div className="grid gap-2">
          <Input
            id={id}
            type="password"
            value={value}
            autoComplete="off"
            spellCheck={false}
            autoFocus
            onChange={(e) => setValue(e.target.value)}
            aria-invalid={error ? true : undefined}
            className="font-mono text-footnote"
          />
          {token?.createUrl && (
            <a
              href={token.createUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 justify-self-start text-footnote font-medium text-signal-ink underline underline-offset-2"
            >
              {s.create}
              <ArrowSquareOut size={14} aria-hidden />
            </a>
          )}
        </div>
      </FormField>
      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? common.saving : s.saveAndTest}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={close}>
          {common.cancel}
        </Button>
      </div>
    </form>
  );
}
