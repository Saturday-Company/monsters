// A fake `codex app-server` for the tests: JSON-RPC lines without the
// `jsonrpc` field, as documented. Fake options come first:
//   node codex.mjs --fake-record=<file> --fake-scenario=<tool|loop|hang|noinit|usage_limit|longcmd|netcmd|mcpfail|limit> app-server …
// `--fake-wrap=obey|ignore|done`: what the `limit` scenario does after the core's note (D-170);
// `done`: the request that reaches the limit already ends with a complete answer, the note comes
// (and is answered) before the turn completes, and the model makes no further request.
// `--fake-answer=<text>`: the last message of the `tool` scenario (default «Fatto: <prompt>»).
// `--fake-limits=off` leaves out the plan limits notification (D-111).
// `longcmd`: a command that runs silent for `--fake-cmd-ms` (default 600), then prints a line.
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { callMcpTool } from './mcp-call.js';

const raw = process.argv.slice(2);
const fake = Object.fromEntries(
  raw.filter((a) => a.startsWith('--fake-')).map((a) => a.slice(7).split('=')),
);
const args = raw.filter((a) => !a.startsWith('--fake-'));
const record = (entry) => {
  if (fake.record) appendFileSync(fake.record, `${JSON.stringify(entry)}\n`);
};
const send = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const notify = (method, params) => send({ method, params });
const scenario = fake.scenario ?? 'tool';
record({ kind: 'start', pid: process.pid, argv: args, env: process.env, cwd: process.cwd() });

/** `-c key=value` overrides, values parsed as TOML scalars (strings are JSON-quoted). */
const config = {};
for (let i = 0; i < args.length; i++) {
  if (args[i] !== '-c') continue;
  const [key, ...rest] = args[i + 1].split('=');
  const value = rest.join('=');
  config[key] = value.startsWith('"')
    ? JSON.parse(value)
    : value === 'true'
      ? true
      : value === 'false'
        ? false
        : value;
}

const thread = 'thr_123';
const turn = 'turn_456';
/** Token totals of the thread (a resumed thread starts with its earlier turns). */
const totals = { input: 0, output: 0 };
function tokenUsage(input, output) {
  totals.input += input;
  totals.output += output;
  const breakdown = (i, o) => ({
    totalTokens: i + o,
    inputTokens: i,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: o,
    reasoningOutputTokens: 0,
  });
  notify('thread/tokenUsage/updated', {
    threadId: thread,
    turnId: turn,
    tokenUsage: {
      total: breakdown(totals.input, totals.output),
      last: breakdown(input, output),
      modelContextWindow: 200000,
    },
  });
}
/** The same update again, as app-server may send it. */
function tokenUsageAgain() {
  const breakdown = (i, o) => ({
    totalTokens: i + o,
    inputTokens: i,
    cachedInputTokens: 0,
    cacheWriteInputTokens: 0,
    outputTokens: o,
    reasoningOutputTokens: 0,
  });
  notify('thread/tokenUsage/updated', {
    threadId: thread,
    turnId: turn,
    tokenUsage: {
      total: breakdown(totals.input, totals.output),
      last: breakdown(200, 100),
      modelContextWindow: 200000,
    },
  });
}
/** The fields of the real `RateLimitSnapshot` besides the windows. */
function rateLimitSnapshot() {
  return {
    limitId: 'codex',
    limitName: null,
    normalModelSlug: null,
    credits: null,
    individualLimit: null,
    spendControlReached: null,
    planType: null,
    rateLimitReachedType: null,
  };
}
if (scenario === 'hang') {
  process.on('SIGINT', () => {});
  process.on('SIGTERM', () => {});
}

/** Answers of the client to our own requests (approvals), by id. */
const answers = new Map();
let nextServerId = 0;
/** A request of app-server to the client; resolves with its `result`. */
function ask(method, params) {
  const id = nextServerId++;
  send({ id, method, params });
  return new Promise((resolve) => answers.set(id, resolve));
}

/**
 * `netcmd`: a command that needs the network, asked outside the sandbox, in the shapes of
 * codex 0.163.0 (captured from the real binary against a local Responses backend, D-158):
 * `item/started` first, then `item/commandExecution/requestApproval` with the command in
 * Codex's `bash -lc` wrapper; `accept` runs it, `decline` ends the item as `declined`. The
 * token update counts prompt-cache reads in `cachedInputTokens`, part of `inputTokens`.
 */
async function netcmd() {
  const command = "/usr/bin/bash -lc 'git push origin main && echo \"it'\"'\"'s done\"'";
  const item = {
    type: 'commandExecution',
    id: 'exec-1',
    command,
    cwd: process.cwd(),
    processId: null,
    source: 'agent',
    status: 'inProgress',
    commandActions: [{ type: 'unknown', command: 'git push origin main' }],
    aggregatedOutput: null,
    exitCode: null,
    durationMs: null,
  };
  notify('item/started', { threadId: thread, turnId: turn, item, startedAtMs: Date.now() });
  const answer = await ask('item/commandExecution/requestApproval', {
    kind: 'command',
    threadId: thread,
    turnId: turn,
    itemId: item.id,
    startedAtMs: Date.now(),
    environmentId: 'local',
    reason: 'Do you want to push the branch?',
    command,
    cwd: process.cwd(),
    commandActions: item.commandActions,
    proposedExecpolicyAmendment: ['/usr/bin/bash', '-lc', 'git push origin main'],
    availableDecisions: ['accept', 'cancel'],
  });
  record({ kind: 'approval', answer });
  const accepted = answer?.decision === 'accept';
  notify('item/completed', {
    threadId: thread,
    turnId: turn,
    item: accepted
      ? { ...item, status: 'completed', aggregatedOutput: 'pushed\n', exitCode: 0, durationMs: 5 }
      : { ...item, status: 'declined' },
  });
  const usage = (i, cached, o) => ({
    totalTokens: i + o,
    inputTokens: i,
    cachedInputTokens: cached,
    cacheWriteInputTokens: 0,
    outputTokens: o,
    reasoningOutputTokens: 0,
  });
  notify('thread/tokenUsage/updated', {
    threadId: thread,
    turnId: turn,
    tokenUsage: {
      total: usage(1000, 600, 20),
      last: usage(1000, 600, 20),
      modelContextWindow: 258400,
    },
  });
  notify('item/completed', {
    threadId: thread,
    turnId: turn,
    item: { type: 'agentMessage', id: 'a1', text: accepted ? 'Pushed.' : 'Not pushed.' },
  });
  notify('thread/tokenUsage/updated', {
    threadId: thread,
    turnId: turn,
    tokenUsage: {
      total: usage(2001, 1201, 40),
      last: usage(1001, 601, 20),
      modelContextWindow: 258400,
    },
  });
  notify('turn/completed', {
    threadId: thread,
    turn: { id: turn, status: 'completed', items: [], error: null },
  });
}

/** Notes the client added to the thread (`thread/inject_items`), as they arrive. */
const notes = [];
let onNote = () => {};
const nextNote = (ms) =>
  notes.length > 0
    ? Promise.resolve(notes.shift())
    : new Promise((resolve) => {
        const timer = setTimeout(() => resolve(null), ms);
        onNote = () => {
          clearTimeout(timer);
          resolve(notes.shift());
        };
      });

/**
 * `limit` (D-170): a call of Monsters' tool and the request that reaches the run's limit; the
 * core's note comes before the next request. `--fake-wrap=obey` (default): one more call
 * (refused by the core), then the report; `ignore`: calls tools until it is interrupted.
 */
async function limitTurn(mcpName) {
  const url = config[`mcp_servers.${mcpName}.url`];
  const token = process.env[config[`mcp_servers.${mcpName}.bearer_token_env_var`]];
  const mcpCall = async (id, query) => {
    const item = {
      type: 'mcpToolCall',
      id,
      server: mcpName,
      tool: 'vault_search',
      arguments: { query },
      status: 'inProgress',
      result: null,
      error: null,
    };
    notify('item/started', { threadId: thread, turnId: turn, item });
    const called = await callMcpTool(url, token, 'vault_search', { query });
    record({ kind: 'mcp', id, ...called });
    const failed = Boolean(called.error || called.result?.isError);
    notify('item/completed', {
      threadId: thread,
      turnId: turn,
      item: {
        ...item,
        status: failed ? 'failed' : 'completed',
        result: failed ? null : { content: called.result.content, structuredContent: null },
        error: failed ? { message: JSON.stringify(called.result?.content ?? called.error) } : null,
      },
    });
  };
  if (fake.wrap === 'done') {
    notify('item/completed', {
      threadId: thread,
      turnId: turn,
      item: { type: 'agentMessage', id: 'a1', text: 'Risposta completa: 2 lune trovate.' },
    });
    tokenUsage(200, 100);
    record({ kind: 'note', note: await nextNote(2000) });
    notify('turn/completed', {
      threadId: thread,
      turn: { id: turn, status: 'completed', items: [], error: null },
    });
    return;
  }
  await mcpCall('m1', 'lune');
  tokenUsage(200, 100);
  const note = await nextNote(2000);
  record({ kind: 'note', note });
  const rounds = fake.wrap === 'ignore' ? 10 : 1;
  for (let i = 2; i <= rounds + 1; i++) {
    await mcpCall(`m${i}`, `lune ${i}`);
    tokenUsage(50, 5);
  }
  notify('item/completed', {
    threadId: thread,
    turnId: turn,
    item: {
      type: 'agentMessage',
      id: 'a9',
      text: 'Rapporto: 2 lune in Ricerche/Lune.md; manca la terza.',
    },
  });
  tokenUsage(60, 15);
  notify('turn/completed', {
    threadId: thread,
    turn: { id: turn, status: 'completed', items: [], error: null },
  });
}

const rl = createInterface({ input: process.stdin });
for await (const line of rl) {
  if (!line.trim()) continue;
  const msg = JSON.parse(line);
  record({ kind: 'rpc', msg });
  if (msg.method === undefined && answers.has(msg.id)) {
    answers.get(msg.id)(msg.result);
    answers.delete(msg.id);
    continue;
  }
  if (msg.method === 'thread/inject_items') {
    notes.push(msg.params);
    onNote();
    send({ id: msg.id, result: {} });
    continue;
  }
  if (msg.method === 'initialize' && scenario === 'noinit') {
    continue; // never answers: a hung app-server
  }
  if (msg.method === 'initialize') {
    send({
      id: msg.id,
      result: { userAgent: 'fake-codex/0.159.2', platformFamily: 'unix', platformOs: 'linux' },
    });
  } else if (msg.method === 'thread/resume' && String(msg.params.threadId).startsWith('gone')) {
    // A thread this CODEX_HOME does not have (D-195).
    send({
      id: msg.id,
      error: { code: -32600, message: `no rollout found for thread id ${msg.params.threadId}` },
    });
  } else if (msg.method === 'thread/start' || msg.method === 'thread/resume') {
    const server = Object.keys(config)
      .find((k) => k.startsWith('mcp_servers.') && k.endsWith('.url'))
      ?.split('.')[1];
    if (scenario === 'mcpfail') {
      // A `required` MCP server that did not start: the thread is never made (0.163.0's words).
      notify('mcpServer/startupStatus/updated', {
        threadId: null,
        name: server,
        status: 'failed',
        error: 'handshaking with MCP server failed',
        failureReason: null,
      });
      send({
        id: msg.id,
        error: {
          code: -32603,
          message: `error creating thread: Fatal error: Failed to initialize session: required MCP servers failed to initialize: ${server}: handshaking with MCP server failed: Send message error Transport error: Client error: HTTP request failed`,
        },
      });
      continue;
    }
    if (scenario === 'netcmd') {
      notify('mcpServer/startupStatus/updated', {
        threadId: thread,
        name: server,
        status: 'starting',
        error: null,
        failureReason: null,
      });
    }
    if (msg.method === 'thread/resume') {
      totals.input = 5000;
      totals.output = 900;
    }
    send({
      id: msg.id,
      result: {
        thread: { id: msg.params.threadId ?? thread },
        model: msg.params.model ?? 'gpt-test',
        modelProvider: config.model_provider,
      },
    });
    notify('thread/started', { thread: { id: thread } });
    if (scenario === 'netcmd') {
      notify('mcpServer/startupStatus/updated', {
        threadId: thread,
        name: server,
        status: 'ready',
        error: null,
        failureReason: null,
      });
    }
  } else if (msg.method === 'turn/interrupt') {
    if (scenario !== 'hang') {
      send({ id: msg.id, result: {} });
      notify('turn/completed', {
        threadId: thread,
        turn: { id: turn, status: 'interrupted', items: [], error: null },
      });
    }
  } else if (msg.method === 'turn/start') {
    send({
      id: msg.id,
      result: { turn: { id: turn, status: 'inProgress', items: [], error: null } },
    });
    notify('turn/started', { threadId: thread, turn: { id: turn } });
    const prompt = msg.params.input[0].text;
    // The plan's limits (D-111), as the app-server announces them: usedPercent,
    // windowDurationMins and resetsAt (unix seconds), in the shape of codex 0.163.0 (captured from
    // the real binary). `--fake-limits=off` sends none; `--fake-limits=empty` sends what the real
    // one sends when the backend's response had no `x-codex-*` headers: both windows null.
    if (fake.limits === 'empty') {
      notify('account/rateLimits/updated', {
        rateLimits: { ...rateLimitSnapshot(), primary: null, secondary: null },
      });
    } else if (fake.limits !== 'off') {
      const nowSec = Math.floor(Date.now() / 1000);
      notify('account/rateLimits/updated', {
        rateLimits: {
          ...rateLimitSnapshot(),
          primary: { usedPercent: 24, windowDurationMins: 300, resetsAt: nowSec + 75 * 60 },
          secondary: { usedPercent: 81, windowDurationMins: 10080, resetsAt: nowSec + 4 * 86_400 },
          planType: 'plus',
        },
      });
    }
    if (scenario === 'limit') {
      // Not awaited: the core's note comes on this same input.
      const mcpName = Object.keys(config)
        .find((k) => k.startsWith('mcp_servers.') && k.endsWith('.url'))
        .split('.')[1];
      void limitTurn(mcpName);
      continue;
    }
    if (scenario === 'netcmd') {
      // Not awaited here: the client's answer to the approval comes on this same input.
      void netcmd();
      continue;
    }
    if (scenario === 'hang') {
      notify('item/agentMessage/delta', {
        threadId: thread,
        turnId: turn,
        itemId: 'a0',
        delta: 'Lavoro…',
      });
      continue;
    }
    if (scenario === 'loop') {
      // A model that keeps calling tools until it is interrupted.
      for (let i = 1; i <= 5; i++) {
        notify('item/started', {
          threadId: thread,
          turnId: turn,
          item: {
            type: 'mcpToolCall',
            id: `l${i}`,
            server: 'monsters',
            tool: 'vault_search',
            arguments: { query: String(i) },
            status: 'inProgress',
            result: null,
            error: null,
          },
        });
        tokenUsage(10, 5);
      }
      continue;
    }
    if (scenario === 'longcmd') {
      const item = {
        type: 'commandExecution',
        id: 'c1',
        command: 'pnpm test',
        status: 'inProgress',
      };
      notify('item/started', { threadId: thread, turnId: turn, item });
      await new Promise((r) => setTimeout(r, Number(fake['cmd-ms'] ?? 600)));
      notify('item/commandExecution/outputDelta', {
        threadId: thread,
        turnId: turn,
        itemId: 'c1',
        delta: 'ok\n',
      });
      notify('item/completed', {
        threadId: thread,
        turnId: turn,
        item: { ...item, status: 'completed', aggregatedOutput: 'ok\n', exitCode: 0 },
      });
      notify('item/completed', {
        threadId: thread,
        turnId: turn,
        item: { type: 'agentMessage', id: 'a2', text: 'Test verdi.' },
      });
      notify('turn/completed', {
        threadId: thread,
        turn: { id: turn, status: 'completed', items: [], error: null },
      });
      continue;
    }
    if (scenario === 'usage_limit') {
      notify('error', {
        threadId: thread,
        turnId: turn,
        willRetry: false,
        error: { message: 'You have hit your usage limit.', codexErrorInfo: 'usageLimitExceeded' },
      });
      notify('turn/completed', {
        threadId: thread,
        turn: {
          id: turn,
          status: 'failed',
          items: [],
          error: {
            message: 'You have hit your usage limit.',
            codexErrorInfo: 'usageLimitExceeded',
            additionalDetails: null,
          },
        },
      });
      continue;
    }
    notify('item/started', {
      threadId: thread,
      turnId: turn,
      item: { type: 'agentMessage', id: 'a1', text: '' },
    });
    notify('item/agentMessage/delta', {
      threadId: thread,
      turnId: turn,
      itemId: 'a1',
      delta: 'Cerco.',
    });
    notify('item/completed', {
      threadId: thread,
      turnId: turn,
      item: { type: 'agentMessage', id: 'a1', text: 'Cerco.' },
    });
    const mcpName = Object.keys(config)
      .find((k) => k.startsWith('mcp_servers.') && k.endsWith('.url'))
      .split('.')[1];
    const item = {
      type: 'mcpToolCall',
      id: 'm1',
      server: mcpName,
      tool: 'vault_search',
      arguments: { query: 'ricette' },
      status: 'inProgress',
      result: null,
      error: null,
    };
    notify('item/started', { threadId: thread, turnId: turn, item });
    const called = await callMcpTool(
      config[`mcp_servers.${mcpName}.url`],
      process.env[config[`mcp_servers.${mcpName}.bearer_token_env_var`]],
      'vault_search',
      { query: 'ricette' },
    );
    record({ kind: 'mcp', ...called });
    notify('item/completed', {
      threadId: thread,
      turnId: turn,
      item: {
        ...item,
        status: called.error ? 'failed' : 'completed',
        result: called.result
          ? { content: called.result.content, structuredContent: null, _meta: null }
          : null,
        error: called.error ? { message: String(called.error) } : null,
      },
    });
    tokenUsage(200, 100);
    notify('item/completed', {
      threadId: thread,
      turnId: turn,
      item: { type: 'agentMessage', id: 'a2', text: fake.answer ?? `Fatto: ${prompt}` },
    });
    tokenUsageAgain();
    notify('turn/completed', {
      threadId: thread,
      turn: { id: turn, status: 'completed', items: [], error: null },
    });
  }
}
