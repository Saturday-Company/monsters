import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { RateBudget, type HarnessProvider } from '@monsters/providers';
import { fake } from '@monsters/providers/testing';
import {
  EventInputSchema,
  ToolError,
  type FileMeta,
  type LogEvent,
  type ToolContext,
  type ToolEmittedEvent,
} from '@monsters/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parseAgentConfig } from '../src/agents/definition.ts';
import { HarnessToolSessions } from '../src/agents/harness-tools.ts';
import { monstersCard } from '../src/agents/monsters-card.ts';
import { runHarnessAgent } from '../src/agents/run-harness.ts';
import { ControlScope } from '../src/kill/control-scope.ts';
import {
  EventLog,
  coreMigrations,
  describeToolCall,
  fileIdOf,
  migrate,
  openDb,
  previewShowTool,
  previewTools,
  PreviewShowInput,
  type PreviewFiles,
} from '../src/index.ts';
import { startTestHub, type TestHub } from './hub-helpers.ts';

/*
 * `preview_show` (plan of 16/10 feature 4, D-075): a monster shows the user a
 * note (read as itself) or a file in the preview pane; a `preview` event, the
 * tool returns at once.
 */

type Sent = { runId: string };
const user = { agentId: 'user' };

async function seed(t: TestHub): Promise<void> {
  const vault = t.core.hub.vault;
  await vault.write(user, { path: 'Risorse/Lisbona', content: '# Lisbona\n\nTram 28.\n' });
  await vault.write(user, {
    path: 'Privato/Diario segreto',
    content: '# Diario\n\nSolo per me.\n',
    frontmatter: { private: true },
  });
}

function context(agentId: string): { tc: ToolContext; emitted: ToolEmittedEvent[] } {
  const emitted: ToolEmittedEvent[] = [];
  return {
    emitted,
    tc: {
      agentId,
      runId: 'r1',
      signal: new AbortController().signal,
      emit: (e) => emitted.push(e),
    },
  };
}

const meta: FileMeta = {
  id: '01JFILE0000000000000000000',
  name: 'Grafico vendite.html',
  mime: 'text/html',
  size: 120,
  kind: 'html',
  source: 'agent',
  agent: 'rhea',
  path: 'File/2026-10/Grafico vendite.html',
  hasThumb: false,
  hasText: false,
  createdAt: 1,
};
const files: PreviewFiles = { get: (id) => (id === meta.id ? meta : null) };

async function errorOf(p: Promise<unknown>): Promise<ToolError> {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(ToolError);
  return err as ToolError;
}

describe('preview_show', { timeout: 30_000 }, () => {
  it('shows a note from a chat: a `preview` event of the run, the tool returns at once', async () => {
    const t = await startTestHub({
      titan: [
        fake.toolCall('preview_show', { note: 'Lisbona', caption: 'Ecco la nota' }),
        fake.text('È la nota su Lisbona.'),
      ],
    });
    await seed(t);
    const sent = await t.json<Sent>('POST', '/api/messages', { text: 'Fammi vedere Lisbona' });
    expect((await t.runEnded(sent.runId)).data.status).toBe('completed');
    const call = t
      .events(sent.runId)
      .find(
        (e): e is LogEvent<'tool_call'> => e.type === 'tool_call' && e.data.tool === 'preview_show',
      );
    const shown = t
      .events(sent.runId)
      .filter((e): e is LogEvent<'preview'> => e.type === 'preview');
    expect(shown).toHaveLength(1);
    expect(shown[0]).toMatchObject({
      agent: 'titan',
      runId: sent.runId,
      parentId: call!.id,
      data: {
        item: { kind: 'note', path: 'Risorse/Lisbona.md' },
        name: 'Lisbona',
        caption: 'Ecco la nota',
      },
    });
    const result = t
      .events(sent.runId)
      .find(
        (e): e is LogEvent<'tool_result'> =>
          e.type === 'tool_result' && e.data.tool === 'preview_show',
      );
    expect(JSON.stringify(result?.data)).toContain('do not describe it again');
  });

  it('every monster that reads notes has it, also in a team created before it', async () => {
    const t = await startTestHub({});
    for (const id of ['titan', 'rhea', 'dione']) {
      expect(t.core.hub.team.get(id)!.config.tools).toContain('preview_show');
    }
    expect(previewTools(['vault_search', 'vault_read'])).toEqual(['preview_show']);
    expect(previewTools(['web_search'])).toEqual([]);
  });

  it('reads the note as the calling monster: private notes only for the user and the capo', async () => {
    const t = await startTestHub({});
    await seed(t);
    const tool = previewShowTool({ vault: t.core.hub.vault, files });
    const rhea = context('rhea');
    const denied = await errorOf(
      tool.execute(PreviewShowInput.parse({ note: 'Privato/Diario segreto' }), rhea.tc),
    );
    expect(denied.code).toBe('BLOCKED_BY_POLICY');
    expect(rhea.emitted).toEqual([]);
    const missing = await errorOf(
      tool.execute(PreviewShowInput.parse({ note: 'Nessuna nota' }), rhea.tc),
    );
    expect(missing.code).toBe('NOT_FOUND');

    const titan = context('titan');
    await tool.execute(PreviewShowInput.parse({ note: '[[Diario segreto]]' }), titan.tc);
    expect(titan.emitted).toEqual([
      {
        type: 'preview',
        data: { item: { kind: 'note', path: 'Privato/Diario segreto.md' }, name: 'Diario segreto' },
      },
    ]);
  });

  it('a file through the files store: by id or by its /api/files URL; unknown or no store refused', async () => {
    const vault = { read: () => Promise.reject(new Error('not used')) };
    const tool = previewShowTool({ vault, files: () => files });
    for (const file of [meta.id, `/api/files/${meta.id}`, `/api/files/${meta.id}/content`]) {
      const { tc, emitted } = context('dione');
      const out = await tool.execute(PreviewShowInput.parse({ file, caption: 'Il grafico' }), tc);
      expect(out).toMatchObject({ status: 'shown', name: 'Grafico vendite.html' });
      expect(emitted).toEqual([
        {
          type: 'preview',
          data: {
            item: { kind: 'file', fileId: meta.id },
            name: 'Grafico vendite.html',
            fileKind: 'html',
            caption: 'Il grafico',
          },
        },
      ]);
      // What the runtime appends: a valid `preview` event.
      expect(
        EventInputSchema.safeParse({ agent: 'dione', runId: 'r1', ...emitted[0] }).success,
      ).toBe(true);
    }
    const { tc } = context('dione');
    expect((await errorOf(tool.execute({ file: 'nope' }, tc))).code).toBe('NOT_FOUND');
    const without = previewShowTool({ vault });
    expect((await errorOf(without.execute({ file: meta.id }, tc))).code).toBe('UNAVAILABLE');

    // A page of a run that read third-party text (D-085): the event says inert, the app never opens it.
    const inertMeta: FileMeta = { ...meta, inert: true };
    const inertTool = previewShowTool({ vault, files: { get: () => inertMeta } });
    const shown = context('dione');
    const out = await inertTool.execute({ file: meta.id }, shown.tc);
    expect(out).toMatchObject({ status: 'chip' });
    expect(shown.emitted[0]).toMatchObject({
      type: 'preview',
      data: { inert: true, fileKind: 'html' },
    });
    expect(fileIdOf('http://127.0.0.1:4747/api/files/abc/content?x=1')).toBe('abc');
  });

  it('exactly one of note and file; a file of the vault is not a note', async () => {
    const vault = {
      read: () => Promise.resolve({ path: 'Risorse/foto.png', title: 'foto', content: null }),
    } as never;
    const tool = previewShowTool({ vault, files });
    const { tc, emitted } = context('rhea');
    const both = await errorOf(tool.execute({ note: 'a', file: 'b' }, tc));
    expect(both.code).toBe('INVALID_INPUT');
    expect(both.hint).toContain('exactly one');
    expect((await errorOf(tool.execute({}, tc))).code).toBe('INVALID_INPUT');
    const png = await errorOf(tool.execute({ note: 'Risorse/foto.png' }, tc));
    expect(png.code).toBe('INVALID_INPUT');
    expect(png.hint).toContain('for files use `file` with the id');
    expect(emitted).toEqual([]);
  });

  it('speech bubble and card', () => {
    expect(describeToolCall('preview_show', { note: 'Risorse/Lisbona' })).toBe(
      'shows you Risorse/Lisbona',
    );
    expect(describeToolCall('preview_show', { file: meta.id })).toBe('shows you a file');
    expect(monstersCard({ toolNames: ['vault_read', 'preview_show'] })).toContain(
      '- anteprima: mostri note e file (`preview_show`)',
    );
  });
});

describe('preview_show on a harness', () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'monsters-preview-harness-'));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it('is served over the MCP session of the run when the monster has it', async () => {
    const db = openDb(':memory:');
    migrate(db, 'core', coreMigrations);
    const log = new EventLog(db);
    const sessions = new HarnessToolSessions(log);
    let served: string[] = [];
    const harness: HarnessProvider = {
      id: 'claude-agent',
      kind: 'harness',
      auth: 'external-login',
      budget: new RateBudget({ id: 'claude-agent', windows: [], limitScope: 'account' }),
      listModels: () => Promise.resolve([]),
      // eslint-disable-next-line @typescript-eslint/require-await
      async *run(task) {
        served = (sessions.get(task.mcp.token)?.tools ?? []).map((x) => x.name);
        yield { type: 'done', reason: 'stop', text: 'ok' };
      },
    };
    const config = parseAgentConfig({
      id: 'rhea',
      name: 'Rhea',
      kind: 'subagent',
      role: 'ricerca',
      color: '#4f8df7',
      models: [{ provider: 'claude-agent', model: 'haiku' }],
      tools: ['vault_read', 'preview_show'],
    });
    const scope = new ControlScope('run', 'r1', null, 100);
    await runHarnessAgent({
      agent: { config, instructions: '# Rhea' },
      harness,
      task: 'mostrami la nota',
      tools: [previewShowTool({ vault: { read: () => Promise.reject(new Error('no')) } })],
      signal: scope.signal,
      scope,
      log,
      runId: 'r1',
      sessions,
      mcpUrl: () => 'http://127.0.0.1:1/api/harness/mcp',
      workspace: join(dir, 'ws'),
      scratchRoot: join(dir, 'scratch'),
      systemTools: false,
    });
    expect(served).toEqual(['preview_show']);
    db.close();
  });
});
