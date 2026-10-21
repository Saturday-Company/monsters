import {
  ClaudeAgentHarness,
  codexUserInputAnswer,
  codexUserInputResult,
  type HarnessTask,
} from '@monsters/providers';
import { describe, expect, it } from 'vitest';
import {
  CLAUDE_DEFAULT_TOOLS_2_1_303,
  CODEX_HANDLED_CLIENT_TOOLS,
  checkClaudeTools,
  checkCodexTools,
  claudeToolFlags,
  codexToolNames,
  probeCases,
  requestSigns,
} from './fixtures/probe-harness-tools.ts';
import { inLang } from './prompt-lang.ts';

/*
 * The comparison of the harness tools probe (D5, D-127), without any binary: argv of a
 * run + the `tools` of its `init` → what the model sees but the run would refuse.
 */

const DEFAULT_TOOLS_2_1_303 = CLAUDE_DEFAULT_TOOLS_2_1_303;
const MCP_TOOLS = ['mcp__monsters__echo', 'mcp__monsters__fail'];

function task(run: Pick<HarnessTask, 'systemTools' | 'webSearch' | 'readFiles'>): HarnessTask {
  return {
    prompt: 'ok',
    cwd: '/tmp/run',
    mcp: { name: 'monsters', url: 'http://127.0.0.1:1/mcp', token: 't' },
    ...run,
    spawn: () => {
      throw new Error('not used');
    },
    scratchDir: '/tmp/run/.scratch',
  };
}

const argvOf = (run: Pick<HarnessTask, 'systemTools' | 'webSearch' | 'readFiles'>) =>
  ClaudeAgentHarness.args(task(run), { mcpConfig: '/tmp/run/mcp.json', settings: '/tmp/s.json' });

/** The `--tools` value replaced, as before D-127. */
function withTools(argv: string[], value: string): string[] {
  const i = argv.indexOf('--tools');
  return [...argv.slice(0, i + 1), value, ...argv.slice(i + 2)];
}

/** The tool an error line is about (`WebSearch: visibile…`). */
const toolOf = (line: string) => line.slice(0, line.indexOf(':'));

/** What the binary lists for a `--tools` value: 2.1.303 drops `LS`. */
const listed = (argv: string[]) => [
  ...claudeToolFlags(argv).tools.filter((t) => t !== 'LS'),
  ...MCP_TOOLS,
];

describe('claudeToolFlags', () => {
  it('reads the comma list of --tools and the variadic --allowedTools up to the next flag', () => {
    const flags = claudeToolFlags([
      '-p',
      '--allowedTools',
      'mcp__monsters',
      'Bash',
      'Read(//tmp/a b.pdf)',
      'Edit,Write',
      '--tools',
      'Bash,Read,ToolSearch',
      '--setting-sources',
      '',
    ]);
    expect(flags.allowed).toEqual([
      'mcp__monsters',
      'Bash',
      'Read(//tmp/a b.pdf)',
      'Edit',
      'Write',
    ]);
    expect(flags.tools).toEqual(['Bash', 'Read', 'ToolSearch']);
  });

  it('reads an empty --tools as no built-in', () => {
    expect(claudeToolFlags(['--tools', '', '--model', 'haiku']).tools).toEqual([]);
  });

  it('reads the argv of a run with attachments', () => {
    const flags = claudeToolFlags(argvOf({ systemTools: false, readFiles: ['/tmp/x.pdf'] }));
    expect(flags.allowed).toEqual(['mcp__monsters', 'Read(//tmp/x.pdf)']);
    expect(flags.tools).toEqual(['Read', 'ToolSearch']);
  });
});

describe('checkClaudeTools', () => {
  it('fails on the old `--tools default` of a run with the terminal (19/10, Progetto Social)', () => {
    const argv = withTools(argvOf({ systemTools: true }), 'default');
    const check = checkClaudeTools(argv, [...DEFAULT_TOOLS_2_1_303, ...MCP_TOOLS]);
    const refused = check.errors.map(toolOf);
    expect(refused).toEqual(
      expect.arrayContaining([
        'WebSearch',
        'WebFetch',
        'Task',
        'NotebookEdit',
        'Skill',
        'Workflow',
      ]),
    );
    expect(refused).not.toContain('Bash');
    expect(refused).not.toContain('ToolSearch');
    expect(refused.some((t) => t.startsWith('mcp__'))).toBe(false);
    expect(check.errors[0]).toMatch(/non pre-approvato/);
  });

  it('passes on the current args of every probed run', () => {
    for (const probe of probeCases('/tmp/allegato.txt')) {
      const argv = argvOf(probe.task);
      const check = checkClaudeTools(argv, listed(argv));
      expect(check.errors, probe.id).toEqual([]);
      // `LS` is asked with the terminal and dropped by 2.1.303: a note, not an error.
      expect(check.notes, probe.id).toEqual(
        probe.task.systemTools ? ['LS: chiesto in --tools ma il binario non lo elenca'] : [],
      );
    }
  });

  it('counts the Read(<path>) rules of the attachments as approving Read', () => {
    const argv = argvOf({ systemTools: false, readFiles: ['/tmp/x.pdf'] });
    expect(checkClaudeTools(argv, ['Read', 'ToolSearch']).errors).toEqual([]);
    // Without attachments the same Read would be refused.
    expect(checkClaudeTools(argvOf({ systemTools: false }), ['Read']).errors).toHaveLength(1);
  });

  it('reports a built-in a new version shows although --tools does not ask for it', () => {
    const argv = argvOf({ systemTools: false });
    const check = checkClaudeTools(argv, ['ToolSearch', 'AskUserQuestion']);
    expect(check.errors).toHaveLength(1);
    expect(check.errors[0]).toMatch(/^AskUserQuestion: .*--tools non lo chiede/);
  });

  it('reports a WebSearch the run does not approve, and an MCP tool of another server', () => {
    const argv = argvOf({ systemTools: true });
    const check = checkClaudeTools(argv, ['Bash', 'WebSearch', 'mcp__other__x', ...MCP_TOOLS]);
    expect(check.errors.map(toolOf)).toEqual(['WebSearch', 'mcp__other__x']);
  });
});

describe('requestSigns', () => {
  it('is empty for init, the blocked prompt and an empty result (2.1.303)', () => {
    expect(
      requestSigns([
        { type: 'system', subtype: 'init', tools: ['Bash'] },
        {
          type: 'system',
          subtype: 'informational',
          prompt_submit_outcome: { kind: 'blocked_by_hook' },
        },
        {
          type: 'result',
          num_turns: 0,
          duration_api_ms: 0,
          total_cost_usd: 0,
          usage: { input_tokens: 0, output_tokens: 0 },
          modelUsage: {},
        },
      ]),
    ).toEqual([]);
  });

  it('sees a request in a model message, a limit event or a result with usage', () => {
    expect(requestSigns([{ type: 'stream_event' }])).toHaveLength(1);
    expect(requestSigns([{ type: 'rate_limit_event' }])).toHaveLength(1);
    expect(
      requestSigns([{ type: 'result', num_turns: 1, usage: { input_tokens: 12 } }]),
    ).toHaveLength(1);
  });
});

describe('Codex', () => {
  const body = (names: string[]) => ({
    model: 'gpt',
    tools: names.map((n) =>
      n === 'web_search' ? { type: 'web_search' } : { type: 'function', name: n },
    ),
  });

  it('reads the tool names of a Responses request, hosted and grouped ones too', () => {
    expect(
      codexToolNames({
        tools: [
          { type: 'function', name: 'shell' },
          { type: 'web_search' },
          { type: 'namespace', name: 'mcp__monsters', tools: [{ type: 'function', name: 'echo' }] },
        ],
      }),
    ).toEqual(['shell', 'web_search', 'mcp__monsters__echo']);
    expect(codexToolNames({})).toEqual([]);
  });

  it('passes a run with the terminal and the web', () => {
    const names = codexToolNames(
      body(['shell', 'apply_patch', 'update_plan', 'web_search', 'mcp__monsters__echo']),
    );
    expect(checkCodexTools(names, { systemTools: true, webSearch: true }).errors).toEqual([]);
  });

  it('fails on shell or web tools a run without them would see', () => {
    const names = codexToolNames(body(['exec_command', 'web_search', 'monsters__echo']));
    const errors = checkCodexTools(names, { systemTools: false }).errors;
    expect(errors.map(toolOf)).toEqual(['exec_command', 'web_search']);
  });

  it('request_user_input is visible and answered by codex.ts, never refused (D-135)', () => {
    inLang('it');
    expect(CODEX_HANDLED_CLIENT_TOOLS).toContain('request_user_input');
    expect(checkCodexTools(['request_user_input'], { systemTools: true }).errors).toEqual([]);
    const answer = codexUserInputResult({ questions: [{ id: 'q1', question: 'Procedo?' }] });
    expect(answer).toEqual({ answers: { q1: { answers: [codexUserInputAnswer()] } } });
    expect(codexUserInputAnswer()).toContain('non l’utente');
    expect(codexUserInputAnswer()).toContain('ask_user');
  });

  it('fails on a tool it does not know, and notes a web run without web_search', () => {
    const check = checkCodexTools(['brand_new_tool'], { systemTools: true, webSearch: true });
    expect(check.errors[0]).toMatch(/^brand_new_tool: .*sconosciuto/);
    expect(check.notes).toHaveLength(1);
  });
});
