import { Browser, Plugs, Plus } from '@phosphor-icons/react';
import {
  MCP_CATALOG,
  type McpServerRequest,
  type McpServerView,
  type McpServersResponse,
  SETTINGS_SECTIONS,
} from '@monsters/shared';
import { useEffect, useId, useState, type FormEvent } from 'react';
import { cn, domId } from '../../lib/utils.ts';
import { getApi, notify } from '../../store/app.ts';
import { Button } from '../ui/button.tsx';
import { Segmented, Switch } from '../ui/controls.tsx';
import { Input } from '../ui/field.tsx';
import { McpGallery } from './McpGallery.tsx';
import { mcpStrings } from './mcp.strings.ts';
import { partsStrings } from './parts.strings.ts';
import { SecretChange } from './McpSecretChange.tsx';
import {
  AgentPicker,
  Details,
  errorOf,
  StatusPill,
  TestButton,
  ToolsResult,
  useTest,
  type Agents,
} from './mcp-parts.tsx';
import {
  ConfirmButton,
  DisclosureRow,
  fieldOnGroup,
  FormField,
  Group,
  Row,
  RowBody,
  textareaClass,
} from './parts.tsx';

/*
 * Settings → Connections → Apps and services (MCP, M2.5): servers the monsters can use, who
 * may use each one, a test that lists its tools, and the browser preset
 * (Playwright with a profile of its own), off until the user turns it on.
 */

/** Splits a command line like a shell would for plain words and quotes. */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quote: '"' | "'" | null = null;
  let has = false;
  for (const ch of line.trim()) {
    if (quote) {
      if (ch === quote) quote = null;
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (/\s/.test(ch)) {
      if (has || cur) out.push(cur);
      cur = '';
      has = false;
    } else {
      cur += ch;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

const quoteArg = (a: string) => (/[\s"']/.test(a) || a === '' ? JSON.stringify(a) : a);

/** `NAME=value` lines → record; empty values keep what is saved. */
export function parsePairs(text: string, sep: '=' | ':'): Record<string, string> | string {
  const out: Record<string, string> = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const i = line.indexOf(sep);
    if (i <= 0) return mcpStrings().servers.pairsFormat(sep === '=' ? '=' : ': ');
    out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

function BrowserRow({
  data,
  server,
  onSave,
  reload,
}: {
  data: McpServersResponse;
  server: McpServerView | undefined;
  onSave: (name: string, body: McpServerRequest, done: string) => Promise<void>;
  reload: () => void;
}) {
  const s = mcpStrings().servers;
  const on = server?.enabled ?? false;
  const [busy, setBusy] = useState(false);
  const test = useTest('browser', reload);
  const save = async (body: McpServerRequest, done: string) => {
    setBusy(true);
    try {
      await onSave('browser', { preset: 'browser', ...body }, done);
    } finally {
      setBusy(false);
    }
  };
  const defaultAgents = data.agents.filter((a) => !a.isOrchestrator && a.web).map((a) => a.id);
  return (
    <li data-testid="mcp-browser">
      <Row
        leading={<Browser size={20} aria-hidden className="text-ink-muted" />}
        label={
          <span className="flex flex-wrap items-center gap-2">
            {s.browser.name}
            {server && on && <StatusPill status={server.status} error={server.error} />}
          </span>
        }
        description={s.browser.description}
      >
        <span className={cn(busy && 'pointer-events-none opacity-60')}>
          <Switch
            words
            checked={on}
            label={s.browser.name}
            onCheckedChange={(v) =>
              void save(
                v && !server ? { enabled: true, agents: defaultAgents } : { enabled: v },
                v ? s.browser.on : s.browser.off,
              ).catch((err: unknown) => notify(errorOf(err), 'error'))
            }
          />
        </span>
      </Row>
      {server && on && (
        <RowBody className="set-seam-t">
          <AgentPicker
            agents={data.agents}
            value={server.agents}
            needsWeb
            disabled={busy}
            onChange={(agents) =>
              void save({ agents }, s.browser.done).catch((err: unknown) =>
                notify(errorOf(err), 'error'),
              )
            }
          />
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-footnote font-medium text-ink">{s.browser.showWindow}</p>
              <p className="text-footnote text-ink-muted">{s.browser.showWindowHint}</p>
            </div>
            <Switch
              words
              checked={server.showWindow ?? false}
              label={s.browser.showWindowLabel}
              onCheckedChange={(v) =>
                void save({ showWindow: v }, s.browser.done).catch((err: unknown) =>
                  notify(errorOf(err), 'error'),
                )
              }
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <TestButton testing={test.testing} onClick={() => void test.run()} />
          </div>
          <ToolsResult result={test.result} />
          <Details>
            <span>
              {s.browser.profileIn}
              <span className="font-mono">{data.browser.profileDir}</span>
            </span>
            <span className="font-mono">{data.browser.package}</span>
            <span>{s.browser.downloads}</span>
          </Details>
        </RowBody>
      )}
    </li>
  );
}

function ServerRow({
  server,
  agents,
  onSave,
  onRemove,
  reload,
}: {
  server: McpServerView;
  agents: Agents;
  onSave: (name: string, body: McpServerRequest, done: string) => Promise<void>;
  onRemove: (name: string) => Promise<void>;
  reload: () => void;
}) {
  const s = mcpStrings().servers;
  const [busy, setBusy] = useState(false);
  const test = useTest(server.name, reload);
  const where =
    server.transport === 'http'
      ? server.url
      : [server.command ?? '', ...(server.args ?? [])].map(quoteArg).join(' ');
  const save = (body: McpServerRequest, done: string) => {
    setBusy(true);
    return onSave(server.name, body, done)
      .catch((err: unknown) => notify(errorOf(err), 'error'))
      .finally(() => setBusy(false));
  };
  const known = server.knownTools?.filter((t) => !t.skipped).length;
  const secrets = [...server.envKeys, ...server.headerKeys];

  return (
    <DisclosureRow
      testId={`mcp-server-${server.name}`}
      leading={<Plugs size={20} aria-hidden className="text-ink-muted" />}
      label={server.label}
      description={s.kind(server.transport === 'http', known)}
      trailing={<StatusPill status={server.status} error={server.error} enabled={server.enabled} />}
    >
      <Row label={s.on}>
        <Switch
          words
          checked={server.enabled}
          label={s.turnOn(server.label)}
          onCheckedChange={(v) => void save({ enabled: v }, v ? s.turnedOn : s.turnedOff)}
        />
      </Row>
      <RowBody className="set-seam-t">
        {server.error && (
          <p className="text-footnote text-stop-ink" data-testid="mcp-error">
            {server.error}
          </p>
        )}
        <AgentPicker
          agents={agents}
          value={server.agents}
          disabled={busy}
          onChange={(next) => void save({ agents: next }, s.done)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <TestButton testing={test.testing} onClick={() => void test.run()} />
          <ConfirmButton
            label={s.remove}
            question={s.removeQuestion}
            confirm={s.removeConfirm}
            busy={busy}
            onConfirm={() => {
              setBusy(true);
              void onRemove(server.name)
                .catch((err: unknown) => notify(errorOf(err), 'error'))
                .finally(() => setBusy(false));
            }}
          />
          <SecretChange
            server={server}
            service={server.label}
            onSaved={() => reload()}
            onTest={() => void test.run()}
            disabled={busy}
          />
        </div>
        <ToolsResult result={test.result} />
        <Details>
          <span className="font-mono">{where}</span>
          {secrets.length > 0 && <span>{s.hidden(secrets.join(', '))}</span>}
          <span>{s.nameIs(server.name)}</span>
        </Details>
      </RowBody>
    </DisclosureRow>
  );
}

function AddServerForm({
  agents,
  taken,
  onDone,
  onCancel,
}: {
  agents: Agents;
  taken: string[];
  onDone: (data: McpServersResponse, name: string) => void;
  onCancel: () => void;
}) {
  const s = mcpStrings().servers.add;
  const common = partsStrings();
  const ids = {
    name: domId(useId()),
    command: domId(useId()),
    url: domId(useId()),
    secrets: domId(useId()),
  };
  const [name, setName] = useState('');
  const [transport, setTransport] = useState<'stdio' | 'http'>('stdio');
  const [command, setCommand] = useState('');
  const [url, setUrl] = useState('');
  const [secrets, setSecrets] = useState('');
  const [chosen, setChosen] = useState<string[]>(
    agents.filter((a) => !a.isOrchestrator).map((a) => a.id),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const next: Record<string, string> = {};
    const id = name.trim();
    if (!/^[a-z][a-z0-9-]{0,23}$/.test(id)) {
      next['name'] = s.nameInvalid;
    } else if (taken.includes(id)) {
      next['name'] = s.nameTaken;
    }
    const parts = splitCommand(command);
    if (transport === 'stdio' && parts.length === 0) next['command'] = s.commandMissing;
    if (transport === 'http' && !/^https?:\/\/\S+$/.test(url.trim())) {
      next['url'] = s.urlInvalid;
    }
    const pairs = parsePairs(secrets, transport === 'stdio' ? '=' : ':');
    if (typeof pairs === 'string') next['secrets'] = pairs;
    setErrors(next);
    if (Object.keys(next).length > 0 || typeof pairs === 'string') return;
    const body: McpServerRequest =
      transport === 'stdio'
        ? {
            transport,
            command: parts[0] ?? '',
            args: parts.slice(1),
            env: pairs,
            agents: chosen,
          }
        : { transport, url: url.trim(), headers: pairs, agents: chosen };
    setBusy(true);
    try {
      onDone(await getApi().saveMcpServer(id, body), id);
    } catch (err) {
      setErrors({ form: errorOf(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} noValidate data-testid="mcp-add-form">
      <RowBody>
        <p className="text-body font-medium text-ink">{s.title}</p>
        <FormField id={ids.name} label={s.name} error={errors['name']} hint={s.nameHint}>
          <Input
            id={ids.name}
            value={name}
            autoComplete="off"
            spellCheck={false}
            // i18n-ignore: an example value, not copy
            placeholder="github"
            onChange={(e) => setName(e.target.value.toLowerCase())}
            className={fieldOnGroup}
            aria-invalid={errors['name'] ? true : undefined}
          />
        </FormField>
        <Segmented<'stdio' | 'http'>
          value={transport}
          onChange={setTransport}
          label={s.where}
          size="sm"
          className="justify-self-start"
          options={[
            { value: 'stdio', label: s.local },
            { value: 'http', label: s.web },
          ]}
        />
        {transport === 'stdio' ? (
          <FormField
            id={ids.command}
            label={s.command}
            error={errors['command']}
            hint={s.commandHint}
          >
            <Input
              id={ids.command}
              value={command}
              autoComplete="off"
              spellCheck={false}
              className={cn(fieldOnGroup, 'font-mono text-footnote')}
              // i18n-ignore: an example value, not copy
              placeholder="npx -y @modelcontextprotocol/server-everything"
              onChange={(e) => setCommand(e.target.value)}
              aria-invalid={errors['command'] ? true : undefined}
            />
          </FormField>
        ) : (
          <FormField id={ids.url} label={s.address} error={errors['url']}>
            <Input
              id={ids.url}
              value={url}
              type="url"
              autoComplete="off"
              spellCheck={false}
              placeholder={s.addressExample}
              onChange={(e) => setUrl(e.target.value)}
              className={fieldOnGroup}
              aria-invalid={errors['url'] ? true : undefined}
            />
          </FormField>
        )}
        <FormField
          id={ids.secrets}
          label={transport === 'stdio' ? s.variables : s.headers}
          error={errors['secrets']}
          hint={s.secretsHint}
        >
          <textarea
            id={ids.secrets}
            value={secrets}
            rows={2}
            autoComplete="off"
            spellCheck={false}
            placeholder={transport === 'stdio' ? 'API_KEY=…' : 'Authorization: Bearer …'}
            onChange={(e) => setSecrets(e.target.value)}
            className={cn(textareaClass, 'font-mono text-footnote')}
          />
        </FormField>
        <AgentPicker agents={agents} value={chosen} onChange={setChosen} />
        {errors['form'] && (
          <p className="text-footnote text-stop-ink" role="alert">
            {errors['form']}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={busy}>
            {busy ? s.adding : s.submit}
          </Button>
          <Button variant="ghost" size="sm" onClick={onCancel}>
            {common.cancel}
          </Button>
        </div>
      </RowBody>
    </form>
  );
}

/** The servers of the core, read once and kept: the tab shows them in two places (paused, apps). */
export function useMcpServers() {
  const s = mcpStrings().servers;
  const [data, setData] = useState<McpServersResponse | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    getApi()
      .mcpServers()
      .then((d) => alive && setData(d))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const onSave = async (name: string, body: McpServerRequest, done: string) => {
    setData(await getApi().saveMcpServer(name, body));
    notify(done, 'success');
  };
  const reload = () => {
    getApi()
      .mcpServers()
      .then(setData)
      .catch(() => {});
  };
  const onRemove = async (name: string) => {
    setData(await getApi().removeMcpServer(name));
    notify(s.removed, 'success');
  };
  return { data, setData, failed, onSave, reload, onRemove };
}

export type McpServers = ReturnType<typeof useMcpServers>;

/**
 * Apps and services, one group (D-063, M2.5): the gallery of services, then the
 * browser, the apps added by hand and "Add a custom app" as its last rows.
 */
export function McpServersSection({ mcp }: { mcp: McpServers }) {
  const s = mcpStrings().servers;
  const { data, setData, failed, onSave, onRemove, reload } = mcp;
  const [adding, setAdding] = useState(false);

  const browser = data?.servers.find((s) => s.preset === 'browser');
  const fromGallery = new Set(MCP_CATALOG.map((e) => e.id));
  const others =
    data?.servers.filter(
      (s) => s.preset !== 'browser' && !(s.catalog && fromGallery.has(s.catalog)),
    ) ?? [];

  return (
    <div data-testid="mcp-settings">
      {!data && failed && (
        <Group title={SETTINGS_SECTIONS.altriProgrammi.label} level={3} as="ul">
          <Row as="li" label={s.failed} />
        </Group>
      )}
      {data && (
        <McpGallery data={data} onData={setData} reload={reload}>
          <ul className="set-rows">
            <BrowserRow data={data} server={browser} onSave={onSave} reload={reload} />
            {others.map((o) => (
              <ServerRow
                key={o.name}
                server={o}
                agents={data.agents}
                onSave={onSave}
                onRemove={onRemove}
                reload={reload}
              />
            ))}
            <li>
              {adding ? (
                <AddServerForm
                  agents={data.agents}
                  taken={data.servers.map((x) => x.name)}
                  onCancel={() => setAdding(false)}
                  onDone={(d, name) => {
                    setData(d);
                    setAdding(false);
                    notify(s.add.added(name), 'success');
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setAdding(true)}
                  className="row-key flex min-h-[52px] w-full items-center gap-2.5 px-4 py-2 text-left [&_svg]:text-signal-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-signal-ink"
                >
                  <Plus size={18} aria-hidden />
                  <span className="grid min-w-0">
                    <span className="text-body font-medium text-ink">{s.add.button}</span>
                    <span className="text-footnote text-ink-muted">{s.add.buttonHint}</span>
                  </span>
                </button>
              )}
            </li>
          </ul>
        </McpGallery>
      )}
    </div>
  );
}
