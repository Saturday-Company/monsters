// A fake `claude` binary for the tests: it speaks the documented stream-json
// protocol of `claude -p` and `claude auth status`. Fake options come first:
//   node claude.mjs --fake-record=<file> --fake-scenario=<tool|hooks|saved|remind|denied|ask|files|limit|steps|nostream|linger|hang|notlogged> <claude args…>
// `--fake-wrap=obey|ignore|hang`: what the `limit` and `steps` scenarios do once the core refused their tools (D-170).
// `steps` (D-196): a model that never finishes by itself, one request after another, stopped by
// `--max-turns` like the real binary; `--fake-first=mcp|bash` is the tool each request calls first.
// `--fake-limits=off|rejected`: the plan limits events (D-111).
// `--fake-mcp=failed|pending|needs-auth|missing`: the status of Monsters' server at the init (D-160).
// `--fake-error=<text>`: the run ends with an error result saying <text> (after the limits events).
// `hooks` calls the HTTP hooks of the run's --settings file (D-069) around a
// web search, a push and a tool of a claude.ai connector, then at the stop.
// Like the real binary, it reads its own login from $HOME/.claude: the test
// checks that Monsters itself never does.
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { callMcpTool } from './mcp-call.js';

const raw = process.argv.slice(2);
const fake = Object.fromEntries(
  raw
    .filter((a) => a.startsWith('--fake-'))
    .map((a) => {
      // Split at the first '=' only: a record path may hold one.
      const i = a.indexOf('=');
      return i < 0 ? [a.slice(7), ''] : [a.slice(7, i), a.slice(i + 1)];
    }),
);
const args = raw.filter((a) => !a.startsWith('--fake-'));
const record = (entry) => {
  if (fake.record) appendFileSync(fake.record, `${JSON.stringify(entry)}\n`);
};
const out = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const home = process.env.HOME ?? process.env.USERPROFILE ?? '';
const loggedIn = existsSync(join(home, '.claude', '.credentials.json'));

if (args[0] === '--version') {
  record({ kind: 'version', env: process.env });
  process.stdout.write('2.1.286 (Claude Code)\n');
  process.exit(0);
}
if (args[0] === 'auth' && args[1] === 'status') {
  record({ kind: 'status', env: process.env });
  const method = process.env.ANTHROPIC_API_KEY
    ? 'api_key'
    : loggedIn
      ? (JSON.parse(readFileSync(join(home, '.claude', '.credentials.json'), 'utf8')).method ??
        'claude.ai')
      : 'none';
  process.stdout.write(`${JSON.stringify({ loggedIn: method !== 'none', authMethod: method })}\n`);
  process.exit(method === 'none' ? 1 : 0);
}

if (args[0] === 'mcp' && args[1] === 'get') {
  // claude.ai connectors of the fake account: Figma connected, Slack to sign in again.
  record({ kind: 'mcp-get', name: args[2], cwd: process.cwd() });
  const known = { 'claude.ai Figma': '✔ Connected', 'claude.ai Slack': '! Needs authentication' };
  if (!known[args[2]]) {
    process.stdout.write(`No MCP server named "${args[2]}". Configured servers: claude.ai Figma\n`);
    process.exit(1);
  }
  process.stdout.write(`${args[2]}:\n  Scope: claude.ai config\n  Status: ${known[args[2]]}\n`);
  process.exit(0);
}

const flag = (name) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};

let stdin = '';
process.stdin.setEncoding('utf8');
for await (const chunk of process.stdin) stdin += chunk;
const first = JSON.parse(stdin.split('\n').find((l) => l.trim()) ?? '{}');
const prompt = first?.message?.content ?? '';
const mcpConfig = JSON.parse(readFileSync(flag('--mcp-config'), 'utf8'));
// A plain run (a summary, D-082) has no MCP server at all.
const server = Object.entries(mcpConfig.mcpServers)[0] ?? [null];
record({
  kind: 'run',
  pid: process.pid,
  argv: args,
  env: process.env,
  cwd: process.cwd(),
  prompt,
  mcpServer: server[0],
  mcpConfig,
});

const session = 'sess-0001';
const scenario = fake.scenario ?? 'tool';
out({
  type: 'system',
  subtype: 'init',
  session_id: session,
  model: 'claude-sonnet-test',
  apiKeySource: 'none',
  tools: [],
  // `--fake-mcp=<status>`: how the first server (Monsters') came up, as 2.1.308 prints it
  // (`failed` with the core down or the token refused, `pending` past the startup wait).
  // `missing`: the init leaves it out, as a settings allowlist that does not admit it does.
  mcp_servers: Object.keys(mcpConfig.mcpServers)
    .filter((name) => !(fake.mcp === 'missing' && name === server[0]))
    .map((name) => ({
      name,
      status: fake.mcp && name === server[0] ? fake.mcp : 'connected',
    })),
});
if (fake.mcp && fake.mcp !== 'connected') {
  // Its tools are missing, the model would go on without them: the core stops it first.
  await new Promise((resolve) => setTimeout(resolve, 30_000));
}

if (!loggedIn || scenario === 'notlogged') {
  out({
    type: 'result',
    subtype: 'success',
    is_error: true,
    result: 'Not logged in · Please run /login',
    session_id: session,
    num_turns: 0,
    total_cost_usd: 0,
    usage: {},
  });
  process.exit(1);
}

// One model request as the binary prints it with --include-partial-messages:
// message_start (counts at the start: output ~1), the text deltas, one
// `assistant` message per content block carrying those same starting counts,
// then message_delta with the final counts and message_stop. Without the
// partial messages (`nostream`) only the `assistant` messages are printed.
const partial = scenario !== 'nostream';
const model = 'claude-sonnet-test';
const stream = (event, parent = null) =>
  out({ type: 'stream_event', event, parent_tool_use_id: parent, session_id: session });
function request({ id, start, end, blocks, parent = null }) {
  if (partial) stream({ type: 'message_start', message: { id, model, usage: start } }, parent);
  for (const block of blocks) {
    if (partial && block.type === 'text') {
      stream(
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: block.text } },
        parent,
      );
    }
    out({
      type: 'assistant',
      message: { id, model, role: 'assistant', content: [block], usage: start },
      parent_tool_use_id: parent,
      session_id: session,
    });
  }
  if (partial) {
    stream({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: end }, parent);
    stream({ type: 'message_stop' }, parent);
  }
}

// A run with no tool (the summary of a conversation, D-082): one answer that
// quotes the facts of the prompt it recognises, then the result.
if (server[0] === null) {
  const facts = [...prompt.matchAll(/si chiama (\w+)/g)].map((m) => `- Si chiama ${m[1]}.`);
  const text = `## Fatti dati dall'utente\n${facts.join('\n') || '- (niente)'}`;
  request({
    id: 'msg-plain',
    start: { input_tokens: 900, output_tokens: 1 },
    end: { input_tokens: 900, output_tokens: 30 },
    blocks: [{ type: 'text', text }],
  });
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    session_id: session,
    num_turns: 1,
    total_cost_usd: 0.001,
    usage: { input_tokens: 900, output_tokens: 30 },
  });
  process.exit(0);
}

// The plan's limits (D-111), as Claude Code 2.1.302 prints them: utilization is a
// fraction of the window, resetsAt in unix seconds. `--fake-limits=off` prints none,
// `--fake-limits=rejected` is a request the plan refused (the result below says so).
const nowSec = Math.floor(Date.now() / 1000);
if (fake.limits !== 'off') {
  const rejected = fake.limits === 'rejected';
  out({
    type: 'rate_limit_event',
    rate_limit_info: {
      status: rejected ? 'rejected' : 'allowed',
      resetsAt: nowSec + 90 * 60,
      rateLimitType: 'five_hour',
      ...(rejected ? { utilization: 1 } : {}),
      unifiedWindows: {
        five_hour: { utilization: rejected ? 1 : 0.09, resetsAt: nowSec + 92 * 60 },
        seven_day: { utilization: 0.63, resetsAt: nowSec + 3 * 86_400 },
      },
      isUsingOverage: false,
    },
    uuid: 'rl-0001',
    session_id: session,
  });
  out({
    type: 'rate_limit_event',
    rate_limit_info: {
      status: 'allowed_warning',
      resetsAt: nowSec + 3 * 86_400,
      rateLimitType: 'seven_day_opus',
      utilization: 0.41,
    },
    uuid: 'rl-0002',
    session_id: session,
  });
  // A type this code does not know, and one with no window: both ignored.
  out({
    type: 'rate_limit_event',
    rate_limit_info: { status: 'allowed', rateLimitType: 'something_new' },
    uuid: 'rl-0003',
    session_id: session,
  });
}
if (fake.limits === 'rejected') {
  out({
    type: 'result',
    subtype: 'success',
    is_error: true,
    result: fake.error ?? "You've hit your usage limit",
    session_id: session,
    num_turns: 0,
    total_cost_usd: 0,
    usage: {},
  });
  process.exit(1);
}
if (fake.error) {
  out({
    type: 'result',
    subtype: 'success',
    is_error: true,
    result: fake.error,
    session_id: session,
    num_turns: 0,
    total_cost_usd: 0,
    usage: {},
  });
  process.exit(1);
}

// The hooks of the run's --settings file (D-069), called like the real binary does.
const settingsFile = flag('--settings');
const settings = settingsFile ? JSON.parse(readFileSync(settingsFile, 'utf8')) : {};
if (settingsFile) record({ kind: 'settings', settings });
async function callHook(event, payload) {
  for (const group of settings.hooks?.[event] ?? []) {
    if (group.matcher && !new RegExp(group.matcher).test(payload.tool_name ?? '')) continue;
    for (const h of group.hooks) {
      const res = await fetch(h.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...h.headers },
        body: JSON.stringify({ hook_event_name: event, session_id: session, ...payload }),
      });
      const answer = await res.json();
      record({ kind: 'hook', event, status: res.status, payload, answer });
      return answer;
    }
  }
  return {};
}
async function hookedTool(id, name, input, output, extra = {}) {
  const answer = await callHook('PreToolUse', {
    tool_name: name,
    tool_input: input,
    tool_use_id: id,
    ...extra,
  });
  const denied = answer?.hookSpecificOutput?.permissionDecision === 'deny';
  out({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: id,
          content: denied
            ? `PreToolUse:${name} hook error: ${answer.hookSpecificOutput.permissionDecisionReason}`
            : output,
          ...(denied ? { is_error: true } : {}),
        },
      ],
    },
    parent_tool_use_id: null,
    session_id: session,
  });
  return answer;
}

if (scenario === 'hooks') {
  request({
    id: 'msg_h1',
    start: { input_tokens: 50, output_tokens: 1 },
    end: { output_tokens: 10 },
    blocks: [
      { type: 'tool_use', id: 'toolu_ws', name: 'WebSearch', input: { query: prompt } },
      {
        type: 'tool_use',
        id: 'toolu_sh',
        name: 'Bash',
        input: { command: 'git push origin main', description: 'Push' },
      },
      { type: 'tool_use', id: 'toolu_fg', name: 'mcp__claude_ai_Figma__whoami', input: {} },
    ],
  });
  await hookedTool(
    'toolu_ws',
    'WebSearch',
    { query: prompt },
    'Links: [{"title":"Pasta","url":"https://ricette.example/pasta"}]',
  );
  await hookedTool('toolu_sh', 'Bash', { command: 'git push origin main' }, 'pushed');
  await hookedTool('toolu_fg', 'mcp__claude_ai_Figma__whoami', {}, '{"handle":"demo"}');
  let text = 'Fatto.';
  request({
    id: 'msg_h2',
    start: { input_tokens: 60, output_tokens: 1 },
    end: { output_tokens: 5 },
    blocks: [{ type: 'text', text }],
  });
  const stop = await callHook('Stop', { stop_hook_active: false, last_assistant_message: text });
  if (stop?.decision === 'block') {
    out({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: `Stop hook feedback:\n${stop.reason}` }],
      },
      parent_tool_use_id: null,
      session_id: session,
    });
    text = 'Rapporto rifatto.';
    request({
      id: 'msg_h3',
      start: { input_tokens: 70, output_tokens: 1 },
      end: { output_tokens: 5 },
      blocks: [{ type: 'text', text }],
    });
    await callHook('Stop', { stop_hook_active: true, last_assistant_message: text });
  }
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    session_id: session,
    num_turns: 2,
    usage: {},
  });
} else if (scenario === 'saved') {
  // D-198: `Read` of the paths in `--fake-reads=a|b|c`, as the real binary asks the hook: with the
  // session and its transcript (`--fake-projects=<folder>` holds `<project>/<session>.jsonl`).
  const reads = (fake.reads ?? '').split('|').filter(Boolean);
  const transcript_path = join(fake.projects ?? '', '-project', `${session}.jsonl`);
  request({
    id: 'msg_s1',
    start: { input_tokens: 50, output_tokens: 1 },
    end: { output_tokens: 10 },
    blocks: reads.map((file_path, i) => ({
      type: 'tool_use',
      id: `toolu_r${i}`,
      name: 'Read',
      input: { file_path },
    })),
  });
  for (const [i, file_path] of reads.entries()) {
    await hookedTool(`toolu_r${i}`, 'Read', { file_path }, 'bytes', { transcript_path });
  }
  request({
    id: 'msg_s2',
    start: { input_tokens: 60, output_tokens: 1 },
    end: { output_tokens: 5 },
    blocks: [{ type: 'text', text: 'Letto.' }],
  });
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Letto.',
    session_id: session,
    num_turns: 2,
    usage: {},
  });
} else if (scenario === 'denied') {
  // D-140: the answer says an access was denied (the words of 19/10); the Stop hook of the
  // core sends the causes back once, and the model rewrites it (`--fake-answer=<text>`).
  const answer = fake.answer ?? 'Il web mi è stato negato in questa sessione.';
  request({
    id: 'msg_d1',
    start: { input_tokens: 50, output_tokens: 1 },
    end: { output_tokens: 12 },
    blocks: [{ type: 'text', text: answer }],
  });
  const stop = await callHook('Stop', { stop_hook_active: false, last_assistant_message: answer });
  let text = answer;
  if (stop?.decision === 'block') {
    record({ kind: 'stop-reason', reason: stop.reason });
    out({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: `Stop hook feedback:\n${stop.reason}` }],
      },
      parent_tool_use_id: null,
      session_id: session,
    });
    text = 'Riscritto: il web non ce l’ho in questo lavoro, la ricerca la fa chi ce l’ha.';
    request({
      id: 'msg_d2',
      start: { input_tokens: 70, output_tokens: 1 },
      end: { output_tokens: 12 },
      blocks: [{ type: 'text', text }],
    });
    await callHook('Stop', { stop_hook_active: true, last_assistant_message: text });
  }
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    session_id: session,
    num_turns: 2,
    usage: {},
  });
} else if (scenario === 'remind') {
  // D-108, as seen in the Automatica eval: the answer ends with a question in
  // the text, the Stop hook sends the reminder back, the model replies "OK"
  // (`--fake-reply=ok`), or calls ask_user and then says "OK" (`ask`).
  // `ok-late` calls the hook before printing the answer (the core's stream
  // reader behind the hook).
  const reply = fake.reply ?? 'ok';
  const answer =
    'La mail è pronta in Inbox/Bozze/Sollecito.md, con i segnaposto. Se mi dai nome e importo, la compilo?';
  const first = { id: 'msg_r1', start: { input_tokens: 50, output_tokens: 1 } };
  if (reply !== 'ok-late')
    request({ ...first, end: { output_tokens: 20 }, blocks: [{ type: 'text', text: answer }] });
  const stop = await callHook('Stop', { stop_hook_active: false, last_assistant_message: answer });
  if (reply === 'ok-late')
    request({ ...first, end: { output_tokens: 20 }, blocks: [{ type: 'text', text: answer }] });
  let text = answer;
  if (stop?.decision === 'block') {
    out({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: `Stop hook feedback:\n${stop.reason}` }],
      },
      parent_tool_use_id: null,
      session_id: session,
    });
    if (reply === 'ask') {
      const input = { question: 'Nome del cliente e importo?', options: [] };
      request({
        id: 'msg_r2',
        start: { input_tokens: 60, output_tokens: 1 },
        end: { output_tokens: 8 },
        blocks: [{ type: 'tool_use', id: 'toolu_ask', name: `mcp__${server[0]}__ask_user`, input }],
      });
      const called = await callMcpTool(
        server[1].url,
        String(server[1].headers.Authorization).replace(/^Bearer /, ''),
        'ask_user',
        input,
      );
      record({ kind: 'mcp', ...called });
      out({
        type: 'user',
        message: {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'toolu_ask',
              content: called.result?.content ?? [],
            },
          ],
        },
        parent_tool_use_id: null,
        session_id: session,
      });
    }
    text = 'OK';
    request({
      id: 'msg_r3',
      start: { input_tokens: 70, output_tokens: 1 },
      end: { output_tokens: 2 },
      blocks: [{ type: 'text', text }],
    });
    await callHook('Stop', { stop_hook_active: true, last_assistant_message: text });
  }
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    session_id: session,
    num_turns: 2,
    usage: {},
  });
} else if (scenario === 'ask') {
  // D-078: `ask_user` over MCP returns at once; the turn ends on one line.
  // The answer comes back as a new run whose prompt carries it.
  const answered = prompt.includes('Risposta alla tua domanda');
  let text = `Bene, procedo: ${prompt}`;
  if (!answered) {
    request({
      id: 'msg_a1',
      start: { input_tokens: 40, output_tokens: 1 },
      end: { output_tokens: 8 },
      blocks: [
        {
          type: 'tool_use',
          id: 'toolu_ask',
          name: `mcp__${server[0]}__ask_user`,
          input: { question: 'Che tono?', options: ['Ironico', 'Serio'], kind: 'taste' },
        },
      ],
    });
    const called = await callMcpTool(
      server[1].url,
      String(server[1].headers.Authorization).replace(/^Bearer /, ''),
      'ask_user',
      { question: 'Che tono?', options: ['Ironico', 'Serio'], kind: 'taste' },
    );
    record({ kind: 'mcp', ...called });
    out({
      type: 'user',
      message: {
        role: 'user',
        content: [
          { type: 'tool_result', tool_use_id: 'toolu_ask', content: called.result?.content ?? [] },
        ],
      },
      parent_tool_use_id: null,
      session_id: session,
    });
    text = 'Ti ho chiesto il tono: aspetto la tua risposta.';
  }
  request({
    id: 'msg_a2',
    start: { input_tokens: 50, output_tokens: 1 },
    end: { output_tokens: 6 },
    blocks: [{ type: 'text', text }],
  });
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    session_id: session,
    num_turns: 1,
    usage: {},
  });
} else if (scenario === 'files') {
  // D-078: the terminal and the file tools ask the core first; the data folder is closed.
  const calls = [
    ['toolu_f1', 'Read', { file_path: join(process.cwd(), 'AGENTS.md') }],
    ['toolu_f2', 'Read', { file_path: '../../agents/titan/agent.yaml' }],
    ['toolu_f3', 'Bash', { command: 'cat ../../secrets/keys.json' }],
    ['toolu_f4', 'Grep', { pattern: 'token', path: '../..' }],
    ['toolu_f5', 'Bash', { command: 'ls -la' }],
  ];
  request({
    id: 'msg_f1',
    start: { input_tokens: 40, output_tokens: 1 },
    end: { output_tokens: 8 },
    blocks: calls.map(([id, name, input]) => ({ type: 'tool_use', id, name, input })),
  });
  for (const [id, name, input] of calls) await hookedTool(id, name, input, 'ok');
  request({
    id: 'msg_f2',
    start: { input_tokens: 50, output_tokens: 1 },
    end: { output_tokens: 6 },
    blocks: [{ type: 'text', text: 'Fatto.' }],
  });
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'Fatto.',
    session_id: session,
    num_turns: 1,
    usage: {},
  });
} else if (scenario === 'limit') {
  // D-170: the first request reaches a limit of the run, then the model calls a built-in, the
  // built-in search and one of Monsters' tools: the core refuses them all and asks for the
  // report. `--fake-wrap=obey` (default) writes it and stops; `ignore` keeps calling tools
  // until it is stopped; `hang` waits after the refusals (a kill switch, the wrap-up's time).
  const wrap = fake.wrap ?? 'obey';
  // The real binary runs a tool after the request's last lines: the core reads them first.
  const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
  request({
    id: 'msg_l1',
    start: { input_tokens: 1200, output_tokens: 1 },
    end: { output_tokens: 20 },
    blocks: [
      { type: 'text', text: 'Comincio dal terminale.' },
      { type: 'tool_use', id: 'toolu_l1', name: 'Bash', input: { command: 'ls' } },
      { type: 'tool_use', id: 'toolu_l2', name: 'ToolSearch', input: { query: 'vault' } },
      {
        type: 'tool_use',
        id: 'toolu_l3',
        name: `mcp__${server[0]}__vault_search`,
        input: { query: 'lune' },
      },
    ],
  });
  await pause();
  await hookedTool('toolu_l1', 'Bash', { command: 'ls' }, 'note.md');
  await hookedTool('toolu_l2', 'ToolSearch', { query: 'vault' }, 'vault_search');
  const called = await callMcpTool(
    server[1].url,
    String(server[1].headers.Authorization).replace(/^Bearer /, ''),
    'vault_search',
    { query: 'lune' },
  );
  record({ kind: 'mcp', ...called });
  out({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_l3',
          content: called.result?.content ?? [{ type: 'text', text: String(called.error) }],
          is_error: Boolean(called.error || called.result?.isError),
        },
      ],
    },
    parent_tool_use_id: null,
    session_id: session,
  });
  if (wrap === 'hang') {
    await new Promise((resolve) => setTimeout(resolve, 30_000));
  } else if (wrap === 'ignore') {
    for (let i = 2; i <= 10; i++) {
      record({ kind: 'more-work', request: i });
      request({
        id: `msg_l${i}`,
        start: { input_tokens: 50, output_tokens: 1 },
        end: { output_tokens: 5 },
        blocks: [{ type: 'tool_use', id: `toolu_m${i}`, name: 'Bash', input: { command: 'ls' } }],
      });
      await pause();
      await hookedTool(`toolu_m${i}`, 'Bash', { command: 'ls' }, 'note.md');
    }
  }
  const text = 'Rapporto: trovate 2 lune, salvate in Ricerche/Lune.md; manca la terza.';
  request({
    id: 'msg_lr',
    start: { input_tokens: 60, output_tokens: 1 },
    end: { output_tokens: 15 },
    blocks: [{ type: 'text', text }],
  });
  await callHook('Stop', { stop_hook_active: false, last_assistant_message: text });
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    session_id: session,
    num_turns: 2,
    usage: {},
  });
} else if (scenario === 'steps') {
  // D-196: each request calls Monsters' `vault_search` and the terminal (in the order of
  // `--fake-first`). The real binary ends with `error_max_turns` once `--max-turns` requests ran
  // their tools. What the core said to the model (a hook's `additionalContext`, a text block of
  // Monsters' result) is recorded as `context`; with `--fake-wrap=obey` the refusal of the limit
  // gets the report, `ignore` goes on calling tools.
  const wrap = fake.wrap ?? 'obey';
  const maxTurns = Number(flag('--max-turns') ?? 0) || 100;
  const pause = () => new Promise((resolve) => setTimeout(resolve, 100));
  const token = String(server[1].headers.Authorization).replace(/^Bearer /, '');
  const limited = (text) => /Limit reached|Limite raggiunto/.test(text);
  let refused = false;
  const mcpTool = async (n) => {
    const called = await callMcpTool(server[1].url, token, 'vault_search', { query: `passo ${n}` });
    record({ kind: 'mcp', request: n, ...called });
    const blocks = called.result?.content ?? [{ type: 'text', text: String(called.error) }];
    for (const b of blocks.slice(1))
      record({ kind: 'context', request: n, via: 'mcp', text: b.text });
    if (limited(JSON.stringify(blocks))) refused = true;
    out({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            tool_use_id: `toolu_v${n}`,
            content: blocks,
            is_error: Boolean(called.error || called.result?.isError),
          },
        ],
      },
      parent_tool_use_id: null,
      session_id: session,
    });
  };
  const bash = async (n) => {
    const answer = await hookedTool(`toolu_b${n}`, 'Bash', { command: `echo ${n}` }, `${n}`);
    const context = answer?.hookSpecificOutput?.additionalContext;
    if (context) record({ kind: 'context', request: n, via: 'hook', text: context });
    if (limited(answer?.hookSpecificOutput?.permissionDecisionReason ?? '')) refused = true;
  };
  let turns = 0;
  let ended = false;
  while (turns < maxTurns) {
    turns++;
    record({ kind: 'request', request: turns });
    const vault = {
      type: 'tool_use',
      id: `toolu_v${turns}`,
      name: `mcp__${server[0]}__vault_search`,
      input: { query: `passo ${turns}` },
    };
    const term = {
      type: 'tool_use',
      id: `toolu_b${turns}`,
      name: 'Bash',
      input: { command: `echo ${turns}` },
    };
    const mcpFirst = fake.first !== 'bash';
    request({
      id: `msg_s${turns}`,
      start: { input_tokens: 100, output_tokens: 1 },
      end: { output_tokens: 10 },
      blocks: [
        { type: 'text', text: `Passo ${turns}.` },
        ...(mcpFirst ? [vault, term] : [term, vault]),
      ],
    });
    await pause();
    if (mcpFirst) {
      await mcpTool(turns);
      await bash(turns);
    } else {
      await bash(turns);
      await mcpTool(turns);
    }
    if (refused && wrap === 'obey') {
      const text = 'Rapporto: grafica a metà, transazione Canva ancora aperta; mancano i testi.';
      request({
        id: 'msg_sr',
        start: { input_tokens: 60, output_tokens: 1 },
        end: { output_tokens: 15 },
        blocks: [{ type: 'text', text }],
      });
      await callHook('Stop', { stop_hook_active: false, last_assistant_message: text });
      out({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: text,
        session_id: session,
        num_turns: turns + 1,
        usage: {},
      });
      ended = true;
      break;
    }
  }
  if (!ended) {
    record({ kind: 'max-turns', turns });
    out({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      session_id: session,
      num_turns: turns,
      usage: {},
    });
  }
} else if (scenario === 'hang') {
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => {});
  stream({
    type: 'message_start',
    message: {
      id: 'msg_h',
      model,
      usage: { input_tokens: 80, cache_creation_input_tokens: 20, output_tokens: 1 },
    },
  });
  stream({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Lavoro…' } });
  setInterval(() => {}, 1000);
} else {
  request({
    id: 'msg_1',
    start: { input_tokens: 100, output_tokens: 1, cache_read_input_tokens: 5 },
    end: { output_tokens: 20 },
    blocks: [
      { type: 'text', text: 'Cerco nel vault.' },
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: `mcp__${server[0]}__vault_search`,
        input: { query: 'ricette' },
      },
    ],
  });
  const called = await callMcpTool(
    server[1].url,
    String(server[1].headers.Authorization).replace(/^Bearer /, ''),
    'vault_search',
    { query: 'ricette' },
  );
  record({ kind: 'mcp', ...called });
  out({
    type: 'user',
    message: {
      role: 'user',
      content: [
        {
          type: 'tool_result',
          tool_use_id: 'toolu_1',
          content: called.result?.content ?? [{ type: 'text', text: String(called.error) }],
          is_error: Boolean(called.error || called.result?.isError),
        },
      ],
    },
    parent_tool_use_id: null,
    session_id: session,
  });
  // A sub-agent's request: stays inside the harness, only the result's total counts it.
  request({
    id: 'msg_sub',
    start: { input_tokens: 7, output_tokens: 1 },
    end: { output_tokens: 3 },
    blocks: [{ type: 'text', text: 'interno' }],
    parent: 'toolu_x',
  });
  request({
    id: 'msg_2',
    start: { input_tokens: 150, output_tokens: 1 },
    end: { output_tokens: 30 },
    blocks: [{ type: 'text', text: `Fatto: ${prompt}` }],
  });
  out({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: `Fatto: ${prompt}`,
    session_id: session,
    num_turns: 2,
    total_cost_usd: 0.01,
    usage: { input_tokens: 257, cache_read_input_tokens: 5, output_tokens: 53 },
  });
  if (scenario === 'linger') {
    // A binary that does not leave after its answer.
    process.on('SIGINT', () => {});
    process.on('SIGTERM', () => {});
    setInterval(() => {}, 1000);
  }
}
