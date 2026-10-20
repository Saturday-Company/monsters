import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ClaudeAgentHarness,
  ProviderRegistry,
  claudeRunSettings,
  RateBudget,
  type HarnessEvent,
  type HarnessProvider,
  type HarnessTask,
} from '@monsters/providers';
import { FakeProvider } from '@monsters/providers/testing';
import type { LogEvent, MonstersTool, ProjectView } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseAgentConfig, type AgentDefinition } from '../src/agents/definition.ts';
import { answerHarnessHook, unavailableBuiltin } from '../src/agents/harness-hooks.ts';
import { HarnessToolSessions } from '../src/agents/harness-tools.ts';
import {
  monstersToolsSection,
  refusedBuiltin,
  runHarnessAgent,
} from '../src/agents/run-harness.ts';
import { ControlScope } from '../src/kill/control-scope.ts';
import { buildReceipt } from '../src/team/instinct/receipt.ts';
import { EventLog, coreMigrations, migrate, openDb } from '../src/index.ts';
import { startTestHub } from './hub-helpers.ts';

/*
 * D-127 (19/10/2026, Progetto Social): a capo whose squad has the web gets no
 * web of its own (D-026), but with the terminal its Claude Code saw every
 * built-in (`--tools default`): it called WebSearch, `dontAsk` refused it with
 * "let the user decide", and it told the user the web was denied.
 */

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

/** The `--tools` value of the argv Claude Code would get for this task. */
function toolsArg(task: HarnessTask): string {
  const argv = ClaudeAgentHarness.args(task, { mcpConfig: '/x/mcp.json' });
  return argv[argv.indexOf('--tools') + 1]!;
}

function recordingHarness(
  events: HarnessEvent[] = [],
  denials?: { tool: string; id: string }[],
): HarnessProvider & { tasks: HarnessTask[] } {
  const tasks: HarnessTask[] = [];
  return {
    id: 'claude-agent',
    kind: 'harness',
    auth: 'external-login',
    budget: new RateBudget({ id: 'claude-agent', windows: [], limitScope: 'account' }),
    tasks,
    listModels: () => Promise.resolve([]),
    async *run(task) {
      tasks.push(task);
      await Promise.resolve();
      for (const e of events) yield e;
      yield { type: 'text', text: 'ok' };
      yield { type: 'done', reason: 'stop', text: 'ok', ...(denials ? { denials } : {}) };
    },
  };
}

describe('a capo of a project on Claude Code (Luna, 19/10)', () => {
  it('sees no WebSearch when its squad has the web, and knows who has it', async () => {
    const harness = recordingHarness();
    const providers = new ProviderRegistry()
      .register(new FakeProvider({ models: {} }))
      .register(harness);
    const t = await startTestHub({}, { hub: { providers } });
    // The plan is not enabled in the subscriptions of this home: the test puts the harness back.
    if (!providers.has(harness.id)) providers.register(harness);
    await t.json<ProjectView>('POST', '/api/projects', {
      name: 'Saturday',
      lead: { name: 'Leda' },
    });
    // A researcher of the project: the web is the squad's (D-026).
    await t.json('POST', '/api/projects/saturday/members', {
      copyOf: 'rhea',
      name: 'Pixel',
    });
    const team = t.core.hub.team;
    // Every monster has the terminal, as on Giulio's computer.
    team.setPolicy({ vault: true, web: true, shell: true, folders: [] });
    await team.setModels('leda', [{ provider: 'claude-agent', model: 'sonnet' }]);
    const pixel = team.members('saturday').find((d) => d.config.name === 'Pixel')!;
    expect(pixel.config.tools).toContain('web_search');
    // The cause: a covered capo has no web tool of its own (D-026, team-service.ts).
    expect(team.byId('leda')!.config.tools).not.toContain('web_search');

    const sent = await t.json<{ runId: string }>('POST', '/api/messages', {
      to: 'leda',
      text: 'Cerca gli indirizzi dei negozi su Instagram',
    });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const task = harness.tasks[0]!;
    expect(task.systemTools).toBe(true);
    expect(task.webSearch).toBeUndefined();
    // Before D-127: `default`, every built-in visible, WebSearch refused by `dontAsk`.
    expect(toolsArg(task)).toBe('Bash,Read,Edit,Write,Glob,Grep,LS,ToolSearch');
    expect(task.instructions).toContain('Il web non è tra i tuoi strumenti: ce l’ha Pixel');
    expect(task.instructions).toContain('web (ce l’ha Pixel: delega la ricerca)');
    expect(task.instructions).not.toContain('il web e la squadra');
  });
});

describe('Claude Code built-ins of a run (D-127)', () => {
  const base: HarnessTask = {
    prompt: 'x',
    cwd: '/w',
    instructions: '',
    mcp: { name: 'monsters', url: 'http://127.0.0.1:1/mcp', token: 't' },
    systemTools: false,
    spawn: () => {
      throw new Error('not here');
    },
    scratchDir: '/s',
  };

  it('lists exactly what the run may use, never `default`', () => {
    expect(toolsArg({ ...base, systemTools: true })).toBe(
      'Bash,Read,Edit,Write,Glob,Grep,LS,ToolSearch',
    );
    expect(toolsArg({ ...base, systemTools: true, webSearch: true })).toBe(
      'Bash,Read,Edit,Write,Glob,Grep,LS,WebSearch,ToolSearch',
    );
    expect(toolsArg({ ...base, webSearch: true })).toBe('WebSearch,ToolSearch');
    expect(toolsArg(base)).toBe('ToolSearch');
    for (const t of [
      { ...base, systemTools: true, webSearch: true },
      { ...base, systemTools: true },
    ]) {
      const visible = toolsArg(t).split(',');
      for (const never of ['WebFetch', 'Task', 'TodoWrite', 'MultiEdit', 'NotebookEdit']) {
        expect(visible).not.toContain(never);
      }
      // Everything visible is pre-approved (`dontAsk` refuses nothing it shows).
      const argv = ClaudeAgentHarness.args(t, { mcpConfig: '/x/mcp.json' });
      const allowed = argv.slice(argv.indexOf('--allowedTools') + 1, argv.indexOf('--tools'));
      for (const v of visible.filter((x) => x !== 'ToolSearch')) expect(allowed).toContain(v);
    }
  });

  it('the core refuses a built-in outside the run with its own words, before `dontAsk`', async () => {
    const db = openDb(':memory:');
    migrate(db, 'core', coreMigrations);
    const log = new EventLog(db);
    const web = { search: true, fetch: true, own: false };
    const out = await answerHarnessHook(
      { hook_event_name: 'PreToolUse', tool_name: 'WebFetch', tool_input: { url: 'https://x' } },
      {
        log,
        agentId: 'leda',
        runId: 'r1',
        parentId: null,
        monstersServer: 'monsters',
        callEvent: () => 'e1',
        lastText: () => '',
        outside: {
          builtins: ['Bash', 'ToolSearch'],
          reason: (tool) => unavailableBuiltin(tool, web, 'monsters').model,
        },
      },
      new AbortController().signal,
    );
    const reason = (out['hookSpecificOutput'] as { permissionDecisionReason: string })
      .permissionDecisionReason;
    expect(out['hookSpecificOutput']).toMatchObject({ permissionDecision: 'deny' });
    expect(reason).toContain('WebFetch is not one of your tools in this run');
    expect(reason).toContain('not a refusal of the user');
    expect(reason).toContain('`web_fetch` of `monsters` to read a page');
    // A tool of the run goes on to the other checks.
    const own = await answerHarnessHook(
      { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'ls' } },
      {
        log,
        agentId: 'leda',
        runId: 'r1',
        parentId: null,
        monstersServer: 'monsters',
        callEvent: () => 'e1',
        lastText: () => '',
        outside: { builtins: ['Bash', 'ToolSearch'], reason: () => 'no' },
      },
      new AbortController().signal,
    );
    expect(own).toEqual({});
  });

  it('says who has the web to a monster without it, never "denied"', () => {
    const none = unavailableBuiltin(
      'WebSearch',
      { search: false, fetch: false, own: false, elsewhere: ['Pixel'] },
      'monsters',
    );
    expect(none.model).toContain('You have no web tools: Pixel has them');
    expect(none.user).toBe(
      'WebSearch di Claude Code non è tra gli strumenti di questo lavoro: non l’hai negato tu. Il web in questa squadra ce l’ha Pixel.',
    );
    const alone = unavailableBuiltin('WebSearch', { search: false, fetch: false, own: false }, 'm');
    expect(alone.user).toContain('Questo mostro non ha il web.');
    const read = unavailableBuiltin(
      'Read',
      { search: false, fetch: false, own: false, attachmentsOnly: true },
      'm',
    );
    expect(read.user).toContain('Read di Claude Code apre solo i file allegati');
  });

  it('finds the refusals of a built-in in the results, not those of the core', () => {
    const denial =
      "Permission to use WebSearch has been denied because Claude Code is running in don't ask mode. IMPORTANT: …";
    expect(refusedBuiltin('WebSearch', denial, ['Bash', 'ToolSearch'])).toEqual({
      tool: 'WebSearch',
      refusal: 'not_in_run',
    });
    // A future binary that shows a tool `--tools` did not name: refused by the core's hook.
    expect(
      refusedBuiltin('Workflow', 'PreToolUse:Workflow hook error: …', ['Bash', 'ToolSearch']),
    ).toEqual({ tool: 'Workflow', refusal: 'not_in_run' });
    // A deny rule of the run (a project's CLAUDE.md, 18/10): Monsters' rule.
    expect(
      refusedBuiltin(
        'Edit',
        '<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>',
        ['Edit', 'ToolSearch'],
      ),
    ).toEqual({ tool: 'Edit', refusal: 'monsters_rule' });
    // The lockout refuses a tool of the run: its words stay.
    expect(refusedBuiltin('Bash', 'I file interni di Monsters…', ['Bash'])).toBeNull();
    expect(refusedBuiltin('mcp__claude_ai_Canva__x', 'error', ['Bash'])).toBeNull();
    // Codex has no such list.
    expect(refusedBuiltin('WebSearch', denial, undefined)).toBeNull();
  });

  it('the run section says the web of the run exactly', () => {
    const own = monstersToolsSection('claude-agent', { search: true, fetch: true, own: true });
    expect(own).toContain('usa la tua ricerca (WebSearch)');
    expect(own).toContain('WebFetch di Claude Code non è tra i tuoi strumenti');
    const monsters = monstersToolsSection('claude-agent', {
      search: true,
      fetch: true,
      own: false,
    });
    expect(monsters).toContain(
      'Per il web usa `web_search` (cercare) e `web_fetch` (leggere una pagina) di `monsters`',
    );
    const none = monstersToolsSection('claude-agent', { search: false, fetch: false, own: false });
    expect(none).toContain('Il web non è tra i tuoi strumenti. Non è un divieto dell’utente');
    expect(none).not.toContain('il web e la squadra');
    const two = monstersToolsSection('codex', {
      search: false,
      fetch: false,
      own: false,
      elsewhere: ['Pixel', 'Rhea'],
    });
    expect(two).toContain('ce l’ha Pixel e Rhea');
    expect(two).not.toContain('Claude Code');
    // With the terminal: a deny rule is Monsters', never the user's permission.
    const terminal = monstersToolsSection(
      'claude-agent',
      { search: false, fetch: false, own: false },
      { terminal: true, docsPropose: true },
    );
    expect(terminal).toContain(
      '«denied by your permission settings» è una regola fissa di Monsters',
    );
    expect(terminal).toContain('`project_docs_propose`');
  });

  it('without the terminal, Read opens only the attachments: another path gets the core’s words', async () => {
    const db = openDb(':memory:');
    migrate(db, 'core', coreMigrations);
    const log = new EventLog(db);
    const web = { search: false, fetch: false, own: false, attachmentsOnly: true };
    const ctx = {
      log,
      agentId: 'rhea',
      runId: 'r1',
      parentId: null,
      monstersServer: 'monsters',
      callEvent: () => 'e1',
      lastText: () => '',
      outside: {
        builtins: ['Read', 'ToolSearch'],
        reason: (tool: string) => unavailableBuiltin(tool, web, 'monsters').model,
        readable: ['/home/g/File/foto.png'],
      },
    };
    const read = (file_path: string) =>
      answerHarnessHook(
        { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path } },
        ctx,
        new AbortController().signal,
      );
    expect(await read('/home/g/File/foto.png')).toEqual({});
    const other = await read('/etc/hosts');
    expect(JSON.stringify(other)).toContain('Read opens only the files the user attached');
    // The settings send `Read` to the core in that case only.
    const task = {
      prompt: 'x',
      cwd: '/w',
      instructions: '',
      mcp: { name: 'monsters', url: 'http://127.0.0.1:1/mcp', token: 't' },
      systemTools: false,
      readFiles: ['/home/g/File/foto.png'],
      hooks: { url: 'http://127.0.0.1:9/hook', token: 't', stop: false },
      scratchDir: '/s',
    } as unknown as HarnessTask;
    const settings = claudeRunSettings(task) as { hooks: { PreToolUse: { matcher: string }[] } };
    expect(settings.hooks.PreToolUse.map((p) => p.matcher)).toContain('^Read$');
    const noFiles = claudeRunSettings({ ...task, readFiles: [] }) as {
      hooks: { PreToolUse: { matcher: string }[] };
    };
    expect(noFiles.hooks.PreToolUse.map((p) => p.matcher)).not.toContain('^Read$');
  });
});

describe('harness runner: a refused built-in in the log (D-127)', () => {
  it('logs plain Italian, not the binary’s "denied"', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'monsters-builtins-'));
    dirs.push(dir);
    const harness = recordingHarness(
      [
        { type: 'tool-call', id: 't1', name: 'WebSearch', input: { query: 'negozi Prato' } },
        {
          type: 'tool-result',
          id: 't1',
          output:
            "Permission to use WebSearch has been denied because Claude Code is running in don't ask mode. IMPORTANT: …",
          isError: true,
        },
        { type: 'tool-call', id: 't2', name: 'Edit', input: { file_path: '/p/CLAUDE.md' } },
        {
          type: 'tool-result',
          id: 't2',
          output:
            '<tool_use_error>File is in a directory that is denied by your permission settings.</tool_use_error>',
          isError: true,
        },
        // A refusal in words this core does not know (a later binary): only `permission_denials` says it.
        { type: 'tool-call', id: 't3', name: 'Bash', input: { command: 'x' } },
        { type: 'tool-result', id: 't3', output: 'Nope.', isError: true },
      ],
      [
        { tool: 'WebSearch', id: 't1' },
        { tool: 'Edit', id: 't2' },
        { tool: 'Bash', id: 't3' },
      ],
    );
    const db = openDb(':memory:');
    const request = { id: '' };
    migrate(db, 'core', coreMigrations);
    const log = new EventLog(db);
    const agent: AgentDefinition = {
      config: parseAgentConfig({
        id: 'nova',
        name: 'Nova',
        role: 'regole',
        color: '#336699',
        models: [{ provider: 'claude-agent', model: 'sonnet' }],
        tools: ['vault_read'],
      }),
      instructions: 'Sei Nova.',
    };
    const vaultRead: MonstersTool = {
      name: 'vault_read',
      description: 'Reads a note',
      inputSchema: z.object({}),
      execute: () => Promise.resolve('x'),
    };
    const scope = new ControlScope('run', 'r1', null, 100);
    request.id = log.append({
      agent: 'user',
      runId: 'r1',
      type: 'message',
      data: { role: 'user', text: 'cerca', to: 'nova', channel: 'ui' },
    }).id;
    await runHarnessAgent({
      agent,
      harness,
      task: 'cerca',
      tools: [vaultRead],
      signal: scope.signal,
      scope,
      log,
      runId: 'r1',
      sessions: new HarnessToolSessions(log),
      mcpUrl: () => 'http://127.0.0.1:1/api/harness/mcp',
      workspace: join(dir, 'ws'),
      scratchRoot: join(dir, 'scratch'),
      systemTools: true,
      webSearch: true,
      webElsewhere: ['Pixel'],
      hookUrl: () => 'http://127.0.0.1:1/api/harness/hook',
    });
    const result = log
      .query({ limit: 100 })
      .find((e): e is LogEvent<'tool_result'> => e.type === 'tool_result')!;
    expect(result.data).toMatchObject({ tool: 'claude-agent.WebSearch', ok: false });
    expect(result.data.error).toBe(
      'WebSearch di Claude Code non è tra gli strumenti di questo lavoro: non l’hai negato tu. Il web in questa squadra ce l’ha Pixel.',
    );
    expect(result.data.refusal).toBe('not_in_run');
    expect(JSON.stringify(result.data)).not.toContain('denied');
    const rule = log
      .query({ limit: 100 })
      .find(
        (e): e is LogEvent<'tool_result'> => e.type === 'tool_result' && e.data.callId === 't2',
      )!;
    expect(rule.data).toMatchObject({ refusal: 'monsters_rule', ok: false });
    expect(rule.data.error).toContain('regola fissa di Monsters');
    expect(rule.data.error).toContain('non per un tuo permesso');
    // Only the refusal the core could not read gets a line of its own.
    const refused = log
      .query({ limit: 100 })
      .filter(
        (e): e is LogEvent<'error'> => e.type === 'error' && e.data.code === 'harness_refused',
      );
    expect(refused.map((e) => e.data.message)).toEqual([
      'Bash di Claude Code è stato rifiutato dalle regole di questo lavoro, non da te.',
    ]);
    // The receipt says why, never that the user denied it.
    const receipt = buildReceipt({
      log,
      runId: 'r1',
      requestEventId: request.id,
      request: 'cerca',
      agent: 'nova',
      status: 'completed',
      agentName: () => 'Nova',
    });
    expect(receipt.externalTools).toEqual(
      expect.arrayContaining([
        {
          tool: 'claude-agent.WebSearch',
          calls: 1,
          failed: 1,
          why: 'non era tra gli strumenti del lavoro, non l’hai negato tu',
          // The cause the core wrote (D-132), the same words for every path.
          causes: ['not_in_run'],
        },
        {
          tool: 'claude-agent.Edit',
          calls: 1,
          failed: 1,
          why: 'regola fissa di Monsters, non un tuo permesso',
          causes: ['monsters_policy'],
        },
      ]),
    );
    // No web of its own: no WebSearch in its task, and its instructions say who has it.
    const task = harness.tasks[0]!;
    expect(task.webSearch).toBeUndefined();
    expect(task.instructions).toContain('web (ce l’ha Pixel)');
    expect(task.instructions).toContain('Il web non è tra i tuoi strumenti: ce l’ha Pixel');
  });
});
