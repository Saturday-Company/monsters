import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ClaudeAgentHarness,
  claudeRunSettings,
  codexThreadConfig,
  ProviderRegistry,
  RateBudget,
  type HarnessEvent,
  type HarnessProvider,
  type HarnessTask,
} from '@monsters/providers';
import { fake, FakeProvider, type FakeScript, type FakeStep } from '@monsters/providers/testing';
import {
  defineTool,
  MEMORY_TAINT_MARK,
  type FileMeta,
  type MonstersTool,
  type LogEvent,
  type ProjectView,
  type TelegramPairing,
} from '@monsters/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { FS_TOOLS } from '@monsters/tools';
import {
  ACCESS_REQUEST_TOOL,
  ALL_VAULT_TOOLS,
  PROJECT_TOOLS,
  TEAM_TOOLS,
  WEB_TOOLS,
  type HubOptions,
} from '../src/index.ts';
import { png } from './file-fixtures.ts';
import {
  CLAUDE_DEFAULT_TOOLS_2_1_303,
  CODEX_HANDLED_CLIENT_TOOLS,
  checkClaudeTools,
  claudeToolFlags,
} from './fixtures/probe-harness-tools.ts';
import { fakeWebSearch, startTestHub, type TestHub } from './hub-helpers.ts';
import { FAKE_TOKEN, FakeTelegram, type FakeUser } from './telegram-fake.ts';

/*
 * Defence D1 of the review of 19/10 (D-136): "visible == executable", for every harness
 * (our loop, Claude Code, Codex) and every context a run can be in. For each cell the core
 * runs a real request and the test reads what the model was given:
 * - our loop: the tool schemas of the request and the system prompt. Every tool the text
 *   names (`like_this`) is sent, or loads when the model calls it by name (deferred, D-134):
 *   the fake model calls every named tool it was not sent and the next request must have it;
 * - Claude Code: `--tools`/`--allowedTools` of the argv (nothing visible is refused by
 *   `dontAsk`: the check fails on the old `--tools default`), the tools of the run's MCP
 *   session as the harness lists them, the server's instructions and the appended prompt;
 * - Codex: the thread configuration, the MCP session, `request_user_input` answered by the
 *   core, the instructions.
 * And in every cell each «Non hai» of the card has its cause.
 */

// --- what a run gave its model ------------------------------------------------------------

interface Seen {
  harness: 'native' | 'claude-agent' | 'codex';
  agent: string;
  /** Tools the model may call now: schemas (native), MCP session + built-ins (harness). */
  visible: string[];
  /** Native: the tools of the next request, after the model called the named ones. */
  after?: string[];
  /** System prompt (native), appended prompt + AGENTS.md (harness). */
  text: string;
  task?: HarnessTask;
  /** The instructions the core's MCP server gives the harness. */
  mcpInstructions?: string;
}

/**
 * Every tool name of Monsters a text can name (a word in code that is none of these is not a
 * tool: `notes_check`, a field of `delegate`'s result; `menu_autunnale`, a note in an example).
 */
const TOOL_NAMES = new Set<string>([
  ...ALL_VAULT_TOOLS,
  ...WEB_TOOLS,
  ...TEAM_TOOLS,
  ...FS_TOOLS,
  ...PROJECT_TOOLS,
  'shell',
  ACCESS_REQUEST_TOOL,
  'project_propose',
  'project_docs_propose',
  'automation_propose',
  'artifact_create',
  'file_read',
  'preview_show',
  'result_read',
  'tools_search',
  'request_user_input',
]);

/** Tool names written as code in a text: `vault_write`, not `vault_*` or `monsters`. */
function mentioned(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/`([a-z][a-z0-9_]*)`/g)) {
    if (TOOL_NAMES.has(m[1]!)) out.add(m[1]!);
  }
  return [...out];
}

/** Offline `web_fetch`, so the web of a test run is the whole web of a real one. */
const fakeWebFetch: MonstersTool = defineTool({
  name: 'web_fetch',
  description: 'Reads web pages.',
  inputSchema: z.object({ urls: z.array(z.string()) }),
  readOnly: true,
  execute: () => Promise.resolve({ pages: [] }),
});

function systemOf(prompt: unknown): string {
  const first = (prompt as { role: string; content: unknown }[])[0];
  return first?.role === 'system' && typeof first.content === 'string' ? first.content : '';
}

/**
 * Our loop: records each request that starts a step of its own, and calls every named tool it
 * was not sent; the request after those calls records what came back (`after`).
 */
function probe(seen: Seen[], agent: string, first?: () => FakeStep): FakeScript {
  let waiting: Seen | undefined;
  let used = false;
  return (call) => {
    const tools = (call.options.tools ?? []).map((t) => t.name);
    if (waiting) {
      waiting.after = tools;
      waiting = undefined;
      return fake.text('ok');
    }
    const mine: Seen = {
      harness: 'native',
      agent,
      visible: tools,
      text: systemOf(call.options.prompt),
    };
    seen.push(mine);
    if (first && !used) {
      used = true;
      return first();
    }
    const missing = mentioned(mine.text).filter((n) => !tools.includes(n));
    if (missing.length > 0) {
      waiting = mine;
      return fake.toolCalls(missing.map((name, i) => ({ name, input: {}, id: `m${i}` })));
    }
    return fake.text('ok');
  };
}

/** One JSON-RPC message to the core's MCP endpoint (JSON or a short SSE stream). */
async function rpc(task: HarnessTask, body: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(task.mcp.url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      authorization: `Bearer ${task.mcp.token}`,
      'mcp-protocol-version': '2025-06-18',
    },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, ...body }),
  });
  const text = await res.text();
  const data = res.headers.get('content-type')?.includes('text/event-stream')
    ? (text
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .at(-1) ?? '{}')
    : text;
  return (JSON.parse(data) as { result?: unknown }).result;
}

/** A harness that records what it was given, lists its MCP tools, and may call one. */
function recordingHarness(
  id: 'claude-agent' | 'codex',
  seen: Seen[],
  act: (task: HarnessTask, index: number) => Promise<void> | void = () => {},
  first: (index: number) => HarnessEvent | undefined = () => undefined,
): HarnessProvider {
  let n = 0;
  return {
    id,
    kind: 'harness',
    auth: id === 'codex' ? 'oauth-siwc' : 'external-login',
    budget: new RateBudget({ id, windows: [], limitScope: 'account' }),
    listModels: () => Promise.resolve([]),
    async *run(task) {
      const index = n++;
      const init = (await rpc(task, {
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'matrix', version: '1' },
        },
      })) as { instructions?: string };
      const list = (await rpc(task, { method: 'tools/list' })) as { tools: { name: string }[] };
      const agentsMd = (() => {
        try {
          return readFileSync(join(task.cwd, 'AGENTS.md'), 'utf8');
        } catch {
          return '';
        }
      })();
      seen.push({
        harness: id,
        agent: '',
        visible: list.tools.map((t) => t.name),
        text: [task.instructions ?? '', id === 'codex' ? agentsMd : ''].join('\n'),
        task,
        ...(init.instructions ? { mcpInstructions: init.instructions } : {}),
      });
      const early = first(index);
      if (early) {
        yield early;
        return;
      }
      await act(task, index);
      yield { type: 'text', text: 'ok' };
      yield { type: 'done', reason: 'stop', text: 'ok' };
    },
  };
}

/** Calls a tool of the run's MCP session, as the harness would. */
const callTool = (task: HarnessTask, name: string, args: Record<string, unknown>) =>
  rpc(task, { method: 'tools/call', params: { name, arguments: args } });

// --- the invariant ------------------------------------------------------------------------

function checkCell(s: Seen): void {
  const where = `${s.harness} · ${s.agent || s.task?.cwd || ''}`;
  // Every «Non hai» says why (D-132).
  const none = s.text.split('\n').find((l) => l.startsWith('Non hai: '));
  if (none) {
    for (const item of none.slice('Non hai: '.length, -1).split('; ')) {
      expect(item, `${where}: «Non hai» without a cause`).toMatch(/\(.+\)$/);
    }
  }
  // Words that promise a tool: "delega" only with `delegate` (A5), the plan's search only with it.
  const callable = [...s.visible, ...(s.after ?? [])];
  if (/delega la ricerca/.test(s.text)) expect(callable, where).toContain('delegate');
  if (/(?:, il web|e il web)[^.]* nel server MCP/.test(s.text)) {
    expect(
      callable.some((n) => n.startsWith('web_')),
      where,
    ).toBe(true);
  }
  if (/la squadra (?:sono|è) nel server MCP/.test(s.text))
    expect(callable, where).toContain('delegate');
  if (s.harness === 'native') {
    for (const name of mentioned(s.text)) {
      expect(
        s.visible.includes(name) || (s.after ?? []).includes(name),
        `${where}: the text names ${name}, which is neither sent nor loadable`,
      ).toBe(true);
    }
    return;
  }
  const task = s.task!;
  // The text names Monsters' tools by their bare name: each must be in the MCP session.
  for (const name of mentioned(s.text)) {
    if (s.harness === 'codex' && CODEX_HANDLED_CLIENT_TOOLS.includes(name)) continue;
    expect(s.visible, `${where}: the text names ${name}, not in the session`).toContain(name);
  }
  // The MCP server's own instructions promise only what the session has (A5).
  const mcpText = s.mcpInstructions ?? '';
  if (mcpText.includes('the web')) expect(s.visible.some((n) => n.startsWith('web_'))).toBe(true);
  if (mcpText.includes('the team')) expect(s.visible).toContain('delegate');
  if (s.harness === 'claude-agent') {
    const argv = ClaudeAgentHarness.args(task, { mcpConfig: '/x/mcp.json' });
    const { tools } = claudeToolFlags(argv);
    // What the binary shows for `--tools` (2.1.303 drops LS; `default` is everything).
    const shown = tools.includes('default')
      ? [...CLAUDE_DEFAULT_TOOLS_2_1_303]
      : tools.filter((t) => t !== 'LS');
    expect(checkClaudeTools(argv, shown).errors, where).toEqual([]);
    // The text promises the plan's search only when the run has it.
    if (/ricerca \(WebSearch\)/.test(s.text)) expect(tools).toContain('WebSearch');
    // A built-in outside the list is answered by the core, never by `dontAsk` (D-127).
    const settings = claudeRunSettings(task) as {
      hooks?: { PreToolUse?: { matcher: string }[] };
    };
    if (!task.plain) {
      expect(settings.hooks?.PreToolUse?.some((h) => h.matcher.startsWith('^(?!mcp__)'))).toBe(
        true,
      );
    }
  } else {
    const config = codexThreadConfig(task.systemTools, task.webSearch === true) as {
      web_search: string;
      features?: Record<string, boolean>;
    };
    expect(config.web_search).toBe(task.webSearch ? 'live' : 'disabled');
    if (!task.systemTools) expect(config.features?.['shell_tool']).toBe(false);
    expect(CODEX_HANDLED_CLIENT_TOOLS).toContain('request_user_input');
  }
}

// --- the hubs -----------------------------------------------------------------------------

type Mode = 'native' | 'claude-agent' | 'codex';

interface Cell {
  t: TestHub;
  seen: Seen[];
}

/**
 * A hub where `agents` work on `mode`: our loop with probing fake models, or a recording
 * harness. `scripts` overrides the fake model of an agent (native).
 */
async function hubFor(
  mode: Mode,
  agents: readonly string[],
  options: {
    scripts?: Record<string, FakeScript>;
    hub?: HubOptions;
    act?: (task: HarnessTask, index: number) => Promise<void> | void;
    first?: (index: number) => HarnessEvent | undefined;
  } = {},
): Promise<Cell> {
  const seen: Seen[] = [];
  const scripts: Record<string, FakeScript> = {};
  for (const a of ['titan', 'rhea', 'dione', 'leda', 'pixel']) {
    scripts[a] = probe(seen, a);
  }
  Object.assign(scripts, options.scripts);
  const fakeProvider = new FakeProvider({ models: scripts });
  const providers = new ProviderRegistry().register(fakeProvider);
  const harness =
    mode === 'native' ? undefined : recordingHarness(mode, seen, options.act, options.first);
  if (harness) providers.register(harness);
  const t = await startTestHub(
    {},
    { hub: { providers, webTools: [fakeWebSearch, fakeWebFetch], ...options.hub } },
  );
  if (harness && !providers.has(harness.id)) providers.register(harness);
  if (harness) {
    for (const a of agents) await setOn(t, a, mode);
  }
  return { t, seen };
}

async function setOn(t: TestHub, agent: string, mode: Mode): Promise<void> {
  if (mode === 'native') return;
  await t.core.hub.team.setModels(agent, [
    { provider: mode, model: mode === 'codex' ? 'gpt-5.5' : 'sonnet' },
  ]);
}

async function send(t: TestHub, body: Record<string, unknown>): Promise<string> {
  const sent = await t.json<{ runId: string }>('POST', '/api/messages', body);
  await t.runEnded(sent.runId);
  return sent.runId;
}

/** Every cell of `seen`, with the agent named for the message. */
function check(seen: readonly Seen[], min = 1): void {
  expect(seen.length).toBeGreaterThanOrEqual(min);
  for (const s of seen) checkCell(s);
}

const MODES: readonly Mode[] = ['native', 'claude-agent', 'codex'];

// --- the matrix ---------------------------------------------------------------------------

describe.each(MODES)('visible == executable on %s (D1, D-136)', (mode) => {
  it('the orchestrator', async () => {
    const { t, seen } = await hubFor(mode, ['titan']);
    await send(t, { text: 'Riordina le note di ieri' });
    check(seen);
  });

  it('a project’s capo whose squad researches (D-026), and a member', async () => {
    const { t, seen } = await hubFor(mode, []);
    await t.json<ProjectView>('POST', '/api/projects', {
      name: 'Saturday',
      lead: { name: 'Leda' },
    });
    await t.json('POST', '/api/projects/saturday/members', { copyOf: 'rhea', name: 'Pixel' });
    t.core.hub.team.setPolicy({ vault: true, web: true, shell: true, folders: [] });
    const pixel = t.core.hub.team.members('saturday').find((d) => d.config.name === 'Pixel')!;
    await setOn(t, 'leda', mode);
    await setOn(t, pixel.config.id, mode);
    await send(t, { to: 'leda', text: 'Cerca i negozi di giochi a Bologna' });
    await send(t, { to: pixel.config.id, text: 'Cerca i negozi di giochi a Bologna' });
    check(seen, 2);
    // The capo has no web of its own: the card says who has it, never "denied".
    expect(seen[0]!.text).toMatch(/Non hai: web \(ce l’ha Pixel: delega la ricerca\)/);
    expect(seen[0]!.text).not.toContain('Permission to use');
  });

  it('a member of the personal squad, and one with the web permission off', async () => {
    const { t, seen } = await hubFor(mode, ['rhea', 'dione']);
    await send(t, { to: 'rhea', text: 'Le lune di Saturno' });
    await t.json('PUT', '/api/permissions', {
      agents: { rhea: { vault: true, web: false, shell: false, folders: [] } },
    });
    await send(t, { to: 'rhea', text: 'Le lune di Giove' });
    check(seen, 2);
    const off = seen.at(-1)!;
    // Rhea was made with the web: without it, no web method in her instructions (A7).
    expect(off.text).not.toContain('## Come cerchi sul web');
    expect(off.text).toContain(
      'web (spento per te: lo accende l’utente in Impostazioni → Permessi → Il web',
    );
  });

  it('a delegation', async () => {
    const delegate = { agent: 'Rhea', goal: 'Le lune di Saturno' };
    const { t, seen } = await hubFor(mode, ['titan', 'rhea'], {
      scripts: {
        titan: probe([], 'titan', () => fake.toolCall('delegate', delegate)),
      },
      act: async (task, index) => {
        if (index === 0) await callTool(task, 'delegate', delegate);
      },
    });
    await send(t, { text: 'Le lune di Saturno, chiedi a Rhea' });
    // The delegated monster's own run.
    check(seen, mode === 'native' ? 1 : 2);
    if (mode !== 'native') expect(seen[1]!.visible).toContain('web_search');
  });

  it('a run tainted from the start (its memory has a line from third-party text)', async () => {
    const { t, seen } = await hubFor(mode, ['titan']);
    const vault = t.core.hub.vault;
    const path = 'Agenti/Titan/MEMORY.md';
    const current = await vault.read({ agentId: 'system' }, { path });
    await vault.write(
      { agentId: 'system' },
      {
        path,
        content: `# Memoria\n- il cliente preferisce i post brevi ${MEMORY_TAINT_MARK}\n`,
        mode: 'overwrite',
        base_hash: current.hash,
      },
    );
    await send(t, { text: 'Prepara 3 post' });
    check(seen);
  });

  it('an automation', async () => {
    const { t, seen } = await hubFor(mode, ['titan']);
    await t.json('POST', '/api/automations', {
      name: 'Post della settimana',
      lead: 'titan',
      participants: ['rhea'],
      schedule: { cron: '0 23 * * 0', timezone: 'Europe/Rome' },
      objective: 'Prepara i post della pagina per la settimana dopo.',
      resultsFolder: 'Social/Settimana',
    });
    const now = await t.json<{ runId: string }>(
      'POST',
      '/api/automations/post-della-settimana/run',
    );
    await t.runEnded(now.runId);
    check(seen);
  });

  it('a file attached, without the terminal', async () => {
    const { t, seen } = await hubFor(mode, ['rhea']);
    const token = readFileSync(t.core.paths.cliToken, 'utf8').trim();
    const f = new FormData();
    f.set('file', new Blob([new Uint8Array(png())]), 'gatto.png');
    const meta = (await (
      await fetch(`${t.core.url}/api/files`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}` },
        body: f,
      })
    ).json()) as FileMeta;
    await send(t, { to: 'rhea', text: 'Cosa c’è in questa foto?', attachments: [meta.id] });
    check(seen);
    if (mode === 'claude-agent') {
      const { tools, allowed } = claudeToolFlags(
        ClaudeAgentHarness.args(seen[0]!.task!, { mcpConfig: '/x' }),
      );
      expect(tools).toContain('Read');
      expect(allowed.some((a) => a.startsWith('Read('))).toBe(true);
    }
  });

  it('a project with its web search off', async () => {
    const { t, seen } = await hubFor(mode, []);
    await t.json<ProjectView>('POST', '/api/projects', {
      name: 'Nebula',
      lead: { name: 'Leda' },
      webSearch: false,
    });
    await setOn(t, 'leda', mode);
    await send(t, { to: 'leda', text: 'Cerca i tornei di sabato' });
    check(seen);
    expect(seen[0]!.text).toContain('la ricerca sul web è spenta per il progetto «Nebula»');
  });
});

describe('visible == executable where only one harness goes (D1, D-136)', () => {
  it('a free chain whose request needs no web: the web waits for tools_search, never gone', async () => {
    const seen: Seen[] = [];
    const free = new FakeProvider({
      id: 'openrouter',
      models: { 'a:free': probe(seen, 'rhea') },
    });
    const port = {
      id: 'jev',
      decide: (request: { questions: { id: string; type: string; options?: unknown[] }[] }) =>
        Promise.resolve({
          answers: request.questions.map((q) => ({
            id: q.id,
            value:
              q.id === 'needs_web'
                ? 0.01
                : q.type === 'choice'
                  ? (q.options?.[0] as { label?: string } | string | undefined) &&
                    (typeof q.options![0] === 'string'
                      ? q.options![0]
                      : (q.options![0] as { label: string }).label)
                  : 0.5,
            confidence: 0.9,
          })),
          model: 'jev-1',
        }),
    };
    const providers = new ProviderRegistry()
      .register(new FakeProvider({ models: {} }))
      .register(free);
    const t = await startTestHub(
      {},
      {
        hub: {
          providers,
          webTools: [fakeWebSearch, fakeWebFetch],
          decisionPort: port as unknown as HubOptions['decisionPort'],
          settings: { instinct: { engine: 'jev' } },
        },
      },
    );
    await t.core.hub.team.setModels('rhea', [{ provider: 'openrouter', model: 'a:free' }]);
    const runId = await send(t, { to: 'rhea', text: 'Grazie, perfetto così' });
    check(seen);
    const s = seen[0]!;
    // Not sent at first, named by the card, loaded when called (D-134).
    expect(s.visible).not.toContain('web_search');
    expect(s.visible).toContain('tools_search');
    expect(s.text).toContain('(prima caricali con `tools_search`)');
    expect(s.after).toContain('web_search');
    // The note the model read says it was loaded, never that the web is denied.
    const instinct = t
      .events(runId)
      .find((e): e is LogEvent<'instinct'> => e.type === 'instinct' && e.data.action === 'tools');
    expect(instinct?.data.message).toContain('aspettano');
  });

  it('Opus at the plan’s limit goes on Sonnet with the same tools (D-093)', async () => {
    const { t, seen } = await hubFor('claude-agent', ['titan'], {
      first: (i) =>
        i === 0
          ? { type: 'done', reason: 'error', code: 'usage_limit', error: 'limit' }
          : undefined,
    });
    await t.core.hub.team.setModels('titan', [{ provider: 'claude-agent', model: 'opus' }]);
    await send(t, { text: 'Riordina le note' });
    expect(seen).toHaveLength(2);
    check(seen, 2);
    expect(seen[1]!.task!.model).toBe('sonnet');
    expect(seen[1]!.visible).toEqual(seen[0]!.visible);
    const argv = (s: Seen) => ClaudeAgentHarness.args(s.task!, { mcpConfig: '/x' });
    expect(claudeToolFlags(argv(seen[1]!))).toEqual(claudeToolFlags(argv(seen[0]!)));
  });

  it('our loop falls back to the next model with the same tools', async () => {
    const seen: Seen[] = [];
    const t0 = new FakeProvider({
      models: { titan: [fake.httpError(500, 'down')], backup: probe(seen, 'titan') },
    });
    const providers = new ProviderRegistry().register(t0);
    const t = await startTestHub({}, { hub: { providers } });
    await t.core.hub.team.setModels('titan', [
      { provider: 'fake', model: 'titan' },
      { provider: 'fake', model: 'backup' },
    ]);
    await send(t, { text: 'Riordina le note' });
    check(seen);
    const first = t0.callsTo('titan')[0]!.options.tools?.map((x) => x.name);
    expect(seen[0]!.visible).toEqual(first);
  });

  it('the old `--tools default` fails the check (D-127)', () => {
    const task: HarnessTask = {
      prompt: 'x',
      cwd: '/w',
      mcp: { name: 'monsters', url: 'http://127.0.0.1:1/mcp', token: 't' },
      systemTools: true,
      spawn: () => {
        throw new Error('not here');
      },
      scratchDir: '/s',
    };
    const argv = ClaudeAgentHarness.args(task, { mcpConfig: '/x' });
    const old = [...argv];
    old[old.indexOf('--tools') + 1] = 'default';
    const errors = checkClaudeTools(old, [...CLAUDE_DEFAULT_TOOLS_2_1_303]).errors;
    expect(errors.some((e) => e.startsWith('WebSearch'))).toBe(true);
    expect(errors.some((e) => e.startsWith('WebFetch'))).toBe(true);
    expect(
      checkClaudeTools(
        argv,
        claudeToolFlags(argv).tools.filter((x) => x !== 'LS'),
      ).errors,
    ).toEqual([]);
  });
});

// --- Telegram: a chat with other people (D-114) and a dedicated bot (D-107) ---------------

const GIULIO: FakeUser = { id: 1001, first_name: 'Giulio', username: 'giulio' };
const LIVIO: FakeUser = { id: 3003, first_name: 'Livio', username: 'livio' };
const RHEA_TOKEN = '222222222:AAbotForRheaOnlyInTests_abcdefghijk';
const RHEA_BOT = { id: 222222222, is_bot: true, first_name: 'Rhea', username: 'rhea_matrix_bot' };
const GROUP = { id: -100777, type: 'supergroup', title: 'Saturday Team' };
const RHEA = String(RHEA_BOT.id);

const isChannel =
  (action: string, extra: (e: LogEvent<'channel'>) => boolean = () => true) =>
  (e: LogEvent): e is LogEvent<'channel'> =>
    e.type === 'channel' && e.data.action === action && extra(e);

describe.each(MODES)('visible == executable in Telegram on %s (D1, D-136)', (mode) => {
  it('a person of a group asks (D-114), then Giulio in private on the dedicated bot (D-107)', async () => {
    const tg = await new FakeTelegram().start();
    try {
      tg.addBot(RHEA_TOKEN, RHEA_BOT);
      const telegram = {
        apiRoot: tg.url,
        pollTimeoutS: 1,
        retryBaseMs: 20,
        retryMaxMs: 80,
        chatGapMs: { private: 0, group: 0 },
      };
      const { t, seen } = await hubFor(mode, ['rhea'], { hub: { telegram } });
      await t.json('PUT', '/api/permissions', {
        agents: { rhea: { vault: true, web: true, shell: true, folders: [] } },
      });
      await t.json('PUT', '/api/telegram/token', { token: FAKE_TOKEN });
      await t.waitEvent(isChannel('connected', (e) => e.data.bot === undefined));
      const code = await t.json<TelegramPairing>('POST', '/api/telegram/pairing');
      tg.text(GIULIO, `/start ${code.code}`);
      await tg.waitMessage((m) => m.chat_id === GIULIO.id && m.text.includes('ora puoi comandare'));
      await t.json('POST', '/api/telegram/bots', { token: RHEA_TOKEN, agent: 'rhea' });
      await t.waitEvent(isChannel('connected', (e) => e.data.bot === RHEA));
      tg.addedToGroup(RHEA_TOKEN, GROUP, GIULIO);
      await t.waitEvent(isChannel('chat_pending', (e) => e.data.bot === RHEA));
      await t.json('POST', `/api/telegram/bots/${RHEA}/chats/${GROUP.id}/approve`);
      tg.text(LIVIO, '/join', { chat: GROUP, token: RHEA_TOKEN });
      await t.waitEvent(isChannel('person_pending', (e) => e.data.userId === String(LIVIO.id)));
      await t.json('POST', `/api/telegram/bots/${RHEA}/people/${LIVIO.id}/approve`);

      tg.text(LIVIO, '@rhea_matrix_bot usa il terminale e scrivi un file', {
        chat: GROUP,
        token: RHEA_TOKEN,
      });
      await tg.waitMessage((m) => m.token === RHEA_TOKEN && m.chat_id === GROUP.id);
      while (seen.length < 1) await new Promise((r) => setTimeout(r, 10));
      const group = seen[0]!;
      // No terminal and no file writes for the people of a chat: not visible at all.
      for (const closed of ['shell', 'fs_write', 'fs_delete']) {
        expect(group.visible).not.toContain(closed);
      }
      if (group.task) expect(group.task.systemTools).toBe(false);

      tg.text(GIULIO, 'Ciao Rhea', { token: RHEA_TOKEN });
      while (seen.length < 2) await new Promise((r) => setTimeout(r, 10));
      check(seen, 2);
    } finally {
      await tg.close();
    }
  });
});
