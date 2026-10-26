import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  answerHarnessHook,
  sessionOutputsDir,
  unavailableBuiltin,
  type HarnessHookContext,
} from '../src/agents/harness-hooks.ts';
import { monstersToolsSection } from '../src/agents/run-harness.ts';
import { tempHome } from './helpers.ts';

/*
 * D-195: what Claude Code saves for a run's own session (`<projects>/<project>/<session>/tool-results/`,
 * a result too large for the context or an image of a service) is readable by that run, read-only, and
 * nothing else in `projects` is; and an image block is never touched by the injection check.
 */

const SESSION = '9c029193-36e9-4f89-9c5c-7fde1aff1f97';
const OTHER = '11111111-2222-4333-8444-555555555555';
const signal = new AbortController().signal;

/** A `projects` folder with a project holding two sessions, each with a saved image. */
function projectsFolder() {
  const projects = join(tempHome(), '.claude', 'projects');
  const project = join(projects, '-home-alice-project');
  const mine = join(project, SESSION, 'tool-results');
  const theirs = join(project, OTHER, 'tool-results');
  for (const d of [mine, theirs]) mkdirSync(d, { recursive: true });
  const png = join(mine, 'mcp-claude_ai_Canva-blob-1-abc.png');
  writeFileSync(png, 'png');
  writeFileSync(join(theirs, 'mcp-claude_ai_Canva-blob-2-def.png'), 'png');
  writeFileSync(join(project, `${SESSION}.jsonl`), '{}');
  writeFileSync(join(project, `${OTHER}.jsonl`), '{}');
  return { projects, project, mine, theirs, png };
}

const call = (
  p: ReturnType<typeof projectsFolder>,
  tool_name: string,
  tool_input: unknown,
  extra: Record<string, unknown> = {},
) => ({
  hook_event_name: 'PreToolUse',
  tool_name,
  tool_input,
  session_id: SESSION,
  transcript_path: join(p.project, `${SESSION}.jsonl`),
  cwd: join(p.projects, '..', '..', 'ws'),
  ...extra,
});

function context(p: ReturnType<typeof projectsFolder>, extra: Partial<HarnessHookContext> = {}) {
  const ws = join(p.projects, '..', '..', 'ws');
  mkdirSync(ws, { recursive: true });
  const message = 'Transcripts are closed.';
  const ctx: HarnessHookContext = {
    log: { append: (e: never) => e } as never,
    agentId: 'titan',
    runId: 'r1',
    parentId: null,
    monstersServer: 'monsters',
    callEvent: () => '01JABCDEFGHJKMNPQRSTVWXYZ1',
    lastText: () => '',
    closed: [
      {
        lock: { dataDir: p.projects, allowed: [], home: join(p.projects, '..', '..') },
        cwd: ws,
        message,
        ownOutputs: true,
      },
    ],
    ...extra,
  };
  return { ctx, message };
}

describe('the outputs of the run’s own session (D-195)', () => {
  it('finds the folder from the call’s session and transcript, and from nothing else', async () => {
    const p = projectsFolder();
    const transcript_path = join(p.project, `${SESSION}.jsonl`);
    expect(await sessionOutputsDir(p.projects, { session_id: SESSION, transcript_path })).toBe(
      p.mine,
    );
    for (const input of [
      {},
      { session_id: SESSION },
      { transcript_path },
      // The id and the file disagree, or the id is no id.
      { session_id: OTHER, transcript_path },
      { session_id: '..', transcript_path: join(p.project, '...jsonl') },
      { session_id: `${SESSION}/../x`, transcript_path },
      // A transcript outside `projects`, deeper in it, or relative.
      { session_id: SESSION, transcript_path: join(p.projects, '..', `${SESSION}.jsonl`) },
      { session_id: SESSION, transcript_path: join(p.project, 'a', `${SESSION}.jsonl`) },
      { session_id: SESSION, transcript_path: join(p.projects, `${SESSION}.jsonl`) },
      { session_id: SESSION, transcript_path: `${SESSION}.jsonl` },
    ]) {
      expect(await sessionOutputsDir(p.projects, input), JSON.stringify(input)).toBeNull();
    }
  });

  it('follows a `projects` folder reached through a link (CLAUDE_CONFIG_DIR)', async () => {
    const p = projectsFolder();
    const link = join(p.projects, '..', 'linked');
    symlinkSync(p.projects, link);
    const transcript_path = join(link, '-home-alice-project', `${SESSION}.jsonl`);
    expect(await sessionOutputsDir(p.projects, { session_id: SESSION, transcript_path })).toBe(
      join(link, '-home-alice-project', SESSION, 'tool-results'),
    );
  });

  it('with the terminal: Read, Grep, Glob and LS open this session’s outputs, nothing else', async () => {
    const p = projectsFolder();
    const { ctx, message } = context(p);
    const pre = (tool: string, input: unknown, extra?: Record<string, unknown>) =>
      answerHarnessHook(call(p, tool, input, extra), ctx, signal);
    for (const [tool, input] of [
      ['Read', { file_path: p.png }],
      [
        'Read',
        { file_path: join(p.mine, '..', 'tool-results', 'mcp-claude_ai_Canva-blob-1-abc.png') },
      ],
      ['Grep', { pattern: 'x', path: p.mine }],
      ['Glob', { pattern: '*.png', path: p.mine }],
      ['LS', { path: p.mine }],
    ] as const) {
      expect(await pre(tool, input), `${tool} ${JSON.stringify(input)}`).toEqual({});
    }
    for (const [tool, input] of [
      // Another session's outputs and transcript, this session's transcript, the rest of `projects`.
      ['Read', { file_path: join(p.theirs, 'mcp-claude_ai_Canva-blob-2-def.png') }],
      ['Read', { file_path: join(p.project, `${SESSION}.jsonl`) }],
      ['Read', { file_path: join(p.project, `${OTHER}.jsonl`) }],
      ['Read', { file_path: join(p.mine, '..', '..', `${OTHER}.jsonl`) }],
      ['Read', { file_path: join(p.mine, '..', 'x.txt') }],
      ['Grep', { pattern: 'x', path: p.projects }],
      ['Grep', { pattern: 'x', path: p.project }],
      ['Grep', { pattern: 'x', path: join(p.mine, '..') }],
      ['Glob', { pattern: '**/*.png', path: p.projects }],
      ['Glob', { pattern: `${p.projects}/*/*.jsonl` }],
      ['Glob', { pattern: '../../*.jsonl', path: p.mine }],
      ['LS', { path: p.projects }],
      ['LS', { path: p.theirs }],
    ] as const) {
      expect(JSON.stringify(await pre(tool, input)), `${tool} ${JSON.stringify(input)}`).toContain(
        message,
      );
    }
    // The session the call says it is in decides: with no session, or another one, it is closed.
    for (const extra of [
      { session_id: undefined, transcript_path: undefined },
      { session_id: OTHER },
      { transcript_path: join(p.project, `${OTHER}.jsonl`) },
    ]) {
      expect(
        JSON.stringify(await pre('Read', { file_path: p.png }, extra)),
        JSON.stringify(extra),
      ).toContain(message);
    }
  });

  it('never opens it for a write, nor for the terminal', async () => {
    const p = projectsFolder();
    const { ctx, message } = context(p);
    const pre = (tool: string, input: unknown) =>
      answerHarnessHook(call(p, tool, input), ctx, signal);
    for (const [tool, input] of [
      ['Write', { file_path: join(p.mine, 'x.png'), content: 'x' }],
      ['Edit', { file_path: p.png, old_string: 'a', new_string: 'b' }],
      ['MultiEdit', { file_path: p.png, edits: [] }],
      ['NotebookEdit', { notebook_path: join(p.mine, 'x.ipynb') }],
      ['Bash', { command: `cat ${p.png}` }],
      ['Bash', { command: `rm ${p.png}` }],
      ['Bash', { command: `ls ${p.mine}` }],
    ] as const) {
      expect(JSON.stringify(await pre(tool, input)), `${tool} ${JSON.stringify(input)}`).toContain(
        message,
      );
    }
  });

  it('a link in the outputs that leads out is not the outputs', async () => {
    const p = projectsFolder();
    const secret = join(p.project, `${OTHER}.jsonl`);
    symlinkSync(secret, join(p.mine, 'innocent.png'));
    symlinkSync(p.theirs, join(p.mine, 'other'));
    const { ctx, message } = context(p);
    for (const file_path of [
      join(p.mine, 'innocent.png'),
      join(p.mine, 'other', 'mcp-claude_ai_Canva-blob-2-def.png'),
    ]) {
      expect(
        JSON.stringify(await answerHarnessHook(call(p, 'Read', { file_path }), ctx, signal)),
        file_path,
      ).toContain(message);
    }
  });

  it('a folder that is not flagged stays closed to its own outputs', async () => {
    const p = projectsFolder();
    const { ctx, message } = context(p);
    const closed = ctx.closed!.map((f) => ({ ...f, ownOutputs: false }));
    expect(
      JSON.stringify(
        await answerHarnessHook(call(p, 'Read', { file_path: p.png }), { ...ctx, closed }, signal),
      ),
    ).toContain(message);
  });

  it('without the terminal: Read opens the attached files and this session’s outputs only', async () => {
    const p = projectsFolder();
    const attached = join(p.projects, '..', '..', 'files', 'a.pdf');
    const reason = 'Read is not yours.';
    const { ctx } = context(p, {
      closed: [],
      outside: {
        builtins: ['Read', 'ToolSearch'],
        reason: () => reason,
        readable: [attached],
        sessionOutputs: p.projects,
      },
    });
    const pre = (input: unknown, extra?: Record<string, unknown>) =>
      answerHarnessHook(call(p, 'Read', input, extra), ctx, signal);
    expect(await pre({ file_path: attached })).toEqual({});
    expect(await pre({ file_path: p.png })).toEqual({});
    for (const [input, extra] of [
      [{ file_path: join(p.theirs, 'mcp-claude_ai_Canva-blob-2-def.png') }, undefined],
      [{ file_path: join(p.project, `${SESSION}.jsonl`) }, undefined],
      [{ file_path: join(p.mine, '..', '..', `${OTHER}.jsonl`) }, undefined],
      [{ file_path: join(p.projects, '..', '..', 'home.txt') }, undefined],
      [{ file_path: p.png }, { session_id: OTHER }],
      [{ file_path: p.png }, { transcript_path: undefined }],
    ] as const) {
      expect(
        JSON.stringify(await pre(input, extra)),
        `${JSON.stringify(input)} ${JSON.stringify(extra)}`,
      ).toContain(reason);
    }
    // Without the saved outputs, only the attached files, as before.
    const only = {
      ...ctx,
      outside: { builtins: ['Read'], reason: () => reason, readable: [attached] },
    };
    expect(
      JSON.stringify(await answerHarnessHook(call(p, 'Read', { file_path: p.png }), only, signal)),
    ).toContain(reason);
  });

  it('says what Read opens when it is refused, and tells the model where the files are', () => {
    const web = { search: false, fetch: false, own: false };
    expect(
      unavailableBuiltin('Read', { ...web, attachmentsOnly: true }, 'monsters').model,
    ).toContain('only the files the user attached.');
    const saved = unavailableBuiltin(
      'Read',
      { ...web, attachmentsOnly: true, savedOutputs: true },
      'monsters',
    );
    expect(saved.model).toContain('results saved for this session');
    expect(saved.user).toContain('results saved for this session');
    const section = monstersToolsSection('claude-agent', web, { saved: true });
    expect(section).toContain('tool-results');
    expect(monstersToolsSection('claude-agent', web, { saved: true, terminal: true })).toContain(
      'Grep',
    );
    expect(monstersToolsSection('claude-agent', web)).not.toContain('tool-results');
    expect(monstersToolsSection('codex', web, { saved: true })).not.toContain('tool-results');
  });
});

describe('an image of a service reaches the model whole (D-195)', () => {
  it('the injection check neither reads nor changes the bytes or the type of an image', async () => {
    const png = 'iVBORw0KGgo'.repeat(2000);
    const seen: string[] = [];
    const guard = {
      afterCall: () => {},
      // The worst case: whatever it is given, it says every character is an order and takes it away.
      external: ({ body }: { body: string }) => {
        seen.push(body);
        return Promise.resolve({
          body: '[parte tolta: conteneva istruzioni per gli agenti]',
          warning: 'w',
        });
      },
    };
    const response = [
      { type: 'text', text: '{"status":"edits_unverified","page_index":1}' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: png } },
      { type: 'image', data: png, mimeType: 'image/png' },
      { type: 'resource', resource: { blob: png, mimeType: 'image/png', uri: 'blob:x' } },
      { type: 'text', text: '[Image: source: /x/tool-results/a.png]' },
    ];
    const out = (await answerHarnessHook(
      {
        hook_event_name: 'PostToolUse',
        tool_name: 'mcp__claude_ai_Canva__edit-design',
        tool_input: {},
        tool_response: response,
      },
      {
        log: { append: () => ({ id: 'e' }) } as never,
        agentId: 'a',
        runId: 'r',
        parentId: null,
        monstersServer: 'monsters',
        guard,
        callEvent: () => 'c',
        lastText: () => '',
      },
      signal,
    )) as { hookSpecificOutput: { updatedToolOutput: typeof response } };
    // The check read the texts only.
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('edits_unverified');
    expect(seen[0]).not.toContain('iVBOR');
    const updated = out.hookSpecificOutput.updatedToolOutput;
    expect(updated[1]).toEqual(response[1]);
    expect(updated[2]).toEqual(response[2]);
    expect(updated[3]).toEqual(response[3]);
    // The texts around it were flagged and changed, as before.
    expect(updated[0]).not.toEqual(response[0]);
  });
});
