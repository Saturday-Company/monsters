import { codexUserInputAnswer, codexUserInputResult } from '@monsters/providers';
import {
  TOOL_CAUSE_NOTE,
  ToolError,
  toolFailureCause,
  type LogEvent,
  type MonstersTool,
} from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseAgentConfig } from '../src/agents/definition.ts';
import { harnessMcpInstructions } from '../src/agents/harness-tools.ts';
import { buildSystemPrompt, instructionsForTools } from '../src/agents/run-agent.ts';
import { monstersToolsSection } from '../src/agents/run-harness.ts';
import { sourcesRule, webMethod } from '../src/agents/templates.ts';
import { adaptTools } from '../src/agents/tool-adapter.ts';
import { buildReceipt } from '../src/team/instinct/receipt.ts';
import { createCoreServices, type CoreServices } from '../src/index.ts';
import { tempHome } from './helpers.ts';
import { inLang } from './prompt-lang.ts';

/*
 * D2/D6 of the review of 19/10 (D-132): who said no is part of the code, and the cause of
 * every failed call is written by the core, on every path: the model reads it next to the
 * error, the log keeps it on the `tool_result`, the receipt shows it. Only `USER_DECLINED` is
 * the user's no.
 */

const opened: CoreServices[] = [];
afterEach(() => {
  for (const s of opened.splice(0)) s.db.close();
});

function services(): CoreServices {
  const s = createCoreServices({ home: tempHome() });
  opened.push(s);
  return s;
}

const failing = (name: string, err: Error): MonstersTool => ({
  name,
  description: `Tool ${name}`,
  inputSchema: z.object({}).passthrough(),
  execute: () => Promise.reject(err),
});

async function call(set: ReturnType<typeof adaptTools>, name: string): Promise<unknown> {
  const execute = set[name]!.execute as unknown as (
    input: unknown,
    options: { toolCallId: string; messages: [] },
  ) => Promise<unknown>;
  return execute({}, { toolCallId: `c-${name}`, messages: [] });
}

describe('the cause of a failed call (D-132)', () => {
  it('maps the codes, and only USER_DECLINED is the user', () => {
    inLang('it');
    expect(toolFailureCause('USER_DECLINED')).toBe('user_declined');
    expect(toolFailureCause('SITE_REFUSED')).toBe('site_refused');
    expect(toolFailureCause('BLOCKED_BY_POLICY')).toBe('monsters_policy');
    expect(toolFailureCause('SETTING_OFF')).toBe('setting_off');
    expect(toolFailureCause('NOT_LINKED')).toBe('not_linked');
    expect(toolFailureCause('NOT_IN_RUN')).toBe('not_in_run');
    expect(toolFailureCause('LIMIT_REACHED')).toBe('limit');
    expect(toolFailureCause('INTERNAL')).toBe('error');
    expect(TOOL_CAUSE_NOTE.user_declined).toBeUndefined();
    for (const note of Object.values(TOOL_CAUSE_NOTE))
      expect(note).toMatch(/non è (un|uno|un suo)/);
  });

  it('our loop: the model reads the cause, the log keeps it, the receipt says it', async () => {
    inLang('it');
    const s = services();
    const request = s.log.append({
      agent: 'user',
      runId: 'r1',
      type: 'message',
      data: { role: 'user', text: 'cerca' },
    });
    const set = adaptTools(
      [
        failing(
          'web_fetch',
          new ToolError('SITE_REFUSED', 'il sito example.com ha rifiutato la lettura (HTTP 403)'),
        ),
        failing('shell', new ToolError('USER_DECLINED', 'the user said no to this action')),
        failing('fs_write', new ToolError('BLOCKED_BY_POLICY', 'off in this chat')),
        failing('mcp__x__y', new Error('boom')),
      ],
      { log: s.log, agentId: 'rhea', runId: 'r1', signal: new AbortController().signal },
    );
    const site = (await call(set, 'web_fetch')) as { error: { code: string; cause?: string } };
    expect(site.error.code).toBe('SITE_REFUSED');
    expect(site.error.cause).toBe(TOOL_CAUSE_NOTE.site_refused);
    expect(JSON.stringify(site)).not.toMatch(/PERMISSION|denied/i);
    const no = (await call(set, 'shell')) as { error: { cause?: string } };
    // The user's no needs no note: it is what it says.
    expect(no.error.cause).toBeUndefined();
    await call(set, 'fs_write');
    await call(set, 'mcp__x__y');
    const results = s.log.query({
      type: 'tool_result',
      limit: 10,
      order: 'asc',
    }) as LogEvent<'tool_result'>[];
    expect(Object.fromEntries(results.map((e) => [e.data.tool, e.data.cause]))).toEqual({
      web_fetch: 'site_refused',
      shell: 'user_declined',
      fs_write: 'monsters_policy',
      mcp__x__y: 'error',
    });
    const receipt = buildReceipt({
      log: s.log,
      runId: 'r1',
      requestEventId: request.id,
      request: 'cerca',
      agent: 'rhea',
      status: 'completed',
      agentName: () => 'Rhea',
    });
    const byTool = new Map(receipt.externalTools.map((t) => [t.tool, t]));
    expect(byTool.get('web_fetch')).toMatchObject({
      why: 'il sito ha rifiutato, non un tuo permesso',
      causes: ['site_refused'],
    });
    expect(byTool.get('shell')).toMatchObject({ why: 'hai detto no', causes: ['user_declined'] });
  });

  it('a brake card nobody answered is not the user’s no (user_no_answer)', async () => {
    const s = services();
    const set = adaptTools(
      [
        {
          ...failing('mcp__mail__send', new Error('not reached')),
          execute: () => Promise.resolve('sent'),
        },
      ],
      {
        log: s.log,
        agentId: 'rhea',
        runId: 'r1',
        signal: new AbortController().signal,
        guard: {
          beforeCall: () =>
            Promise.reject(new ToolError('ABORTED', 'the card was not answered in time')),
        },
      },
    );
    const out = (await call(set, 'mcp__mail__send')) as { error: { cause?: string } };
    expect(out.error.cause).toBe(TOOL_CAUSE_NOTE.user_no_answer);
    const result = s.log.query({ type: 'tool_result', limit: 1 })[0] as LogEvent<'tool_result'>;
    expect(result.data.cause).toBe('user_no_answer');
  });

  it('the rule of the system says it to every monster', () => {
    inLang('it');
    const prompt = buildSystemPrompt({
      agent: {
        config: parseAgentConfig({
          id: 'rhea',
          name: 'Rhea',
          role: 'ricerche',
          color: '#4f8df7',
          models: [{ provider: 'fake', model: 'x' }],
        }),
        instructions: '# Rhea',
      },
      toolNames: ['vault_search'],
    });
    expect(prompt).toContain('Solo il codice USER_DECLINED è un no dell’utente');
  });
});

describe('what a harness reads of its tools (A5, M4, D-132, D-135)', () => {
  it('the MCP server promises the web and the team only to who has them', () => {
    const plain = harnessMcpInstructions([{ name: 'vault_search' }]);
    expect(plain).not.toContain('the web');
    expect(plain).not.toContain('the team');
    const full = harnessMcpInstructions([
      { name: 'vault_search' },
      { name: 'web_fetch' },
      { name: 'delegate' },
    ]);
    expect(full).toContain("the vault (the user's notes), the web, the team");
  });

  it('"la squadra" only with delegate; Codex: questions with ask_user, no network for commands', () => {
    inLang('it');
    const web = { search: false, fetch: false, own: false };
    expect(monstersToolsSection('claude-agent', web)).toContain(
      "Il vault dell'utente è nel server MCP",
    );
    expect(monstersToolsSection('claude-agent', web, { team: true })).toContain(
      "Il vault dell'utente e la squadra sono nel server MCP",
    );
    const codex = monstersToolsSection('codex', web, { ask: true, terminal: true });
    expect(codex).toContain(
      'usa `ask_user` di `monsters`: `request_user_input` di Codex non arriva a nessuno',
    );
    expect(codex).toContain('I tuoi comandi non hanno rete');
    expect(monstersToolsSection('codex', web)).toContain('scrivi la domanda nel rapporto');
    expect(monstersToolsSection('claude-agent', web)).not.toContain('request_user_input');
  });

  it('Codex’s request_user_input gets Monsters’ words, never an error or the user’s voice', () => {
    expect(codexUserInputResult({ questions: [{ id: 'a' }, { id: 'b' }, { nope: 1 }] })).toEqual({
      answers: {
        a: { answers: [codexUserInputAnswer()] },
        b: { answers: [codexUserInputAnswer()] },
      },
    });
    expect(codexUserInputResult(undefined)).toEqual({ answers: {} });
  });

  it('AGENTS.md without web tools loses the web method and the sources rule (A7)', () => {
    inLang('it');
    const md = `# Rhea\n\n## Regole\n- una regola\n- ${sourcesRule('it')}\n${webMethod('it')}\n## Rapporto\n- breve\n`;
    const without = instructionsForTools(md, ['vault_search']);
    expect(without).not.toContain('## Come cerchi sul web');
    expect(without).not.toContain(sourcesRule('it'));
    expect(without).toContain('## Rapporto');
    expect(without).toContain('- una regola');
    expect(instructionsForTools(md, ['web_search'])).toBe(md);
  });
});
