import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  orchestratorBlueprint,
  rheaBlueprint,
  startCore,
  writeAgentFolder,
  type CoreServer,
} from '@monsters/core';
import { ProviderRegistry } from '@monsters/providers';
import { fake, FakeProvider, type FakeScript } from '@monsters/providers/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocketServer } from 'ws';
import { cmdChat, parseNewConversation } from '../src/chat.ts';
import { run, type Io } from '../src/main.ts';

const dirs: string[] = [];
const cores: CoreServer[] = [];
afterEach(async () => {
  for (const c of cores.splice(0)) await c.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

function capture(): Io & { lines: string[]; errors: string[] } {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (l) => lines.push(l), err: (l) => errors.push(l) };
}

async function core(scripts: Record<string, FakeScript>, withTeam = true): Promise<string> {
  const dir = mkdtempSync(join(tmpdir(), 'monsters-chat-'));
  dirs.push(dir);
  const home = join(dir, 'home');
  const models = (id: string) => [{ provider: 'fake', model: id }];
  if (withTeam) await writeTeam(home, models);
  const providers = new ProviderRegistry().register(new FakeProvider({ models: scripts }));
  const c = await startCore({
    home,
    port: 0,
    env: {},
    hub: { providers, decisionPort: null, webTools: [], settings: { watchVault: false } },
  });
  cores.push(c);
  return home;
}

async function writeTeam(
  home: string,
  models: (id: string) => { provider: string; model: string }[],
) {
  await writeAgentFolder(
    join(home, 'agents', 'titan'),
    orchestratorBlueprint({ user: 'Giulio', models: models('titan') }),
  );
  await writeAgentFolder(
    join(home, 'agents', 'rhea'),
    rheaBlueprint({ user: 'Giulio', models: models('rhea') }),
  );
}

describe('monsters chat', () => {
  it('sends a message and prints the run until it ends', async () => {
    const home = await core({
      titan: [
        fake.toolCall('delegate', { agent: 'Rhea', goal: 'Cerca le lune di Saturno' }),
        fake.text('Ciao Giulio, Rhea ha trovato 146 lune.'),
      ],
      rhea: [fake.toolCall('vault_list', {}), fake.text('Saturno ha 146 lune note.')],
    });
    const io = capture();
    expect(await run(['chat', 'quante', 'lune?', '--home', home], io)).toBe(0);
    const out = io.lines.join('\n');
    expect(out).toMatch(/\(Titan is working, run /);
    expect(out).toContain('→ Titan delegates to Rhea: Cerca le lune di Saturno');
    expect(out).toContain('  · Rhea: looks at the notes');
    expect(out).toContain('← Rhea finished:\n    Saturno ha 146 lune note.');
    expect(out).toContain('Titan: Ciao Giulio, Rhea ha trovato 146 lune.');
    expect(out).toContain('(end: completed · 4 model requests: rhea, titan)');
  });

  it('talks to one agent with --to and answers questions with `monsters answer`', async () => {
    const home = await core({
      rhea: [fake.text('Sono Rhea.')],
      titan: [
        fake.toolCall('ask_user', {
          question: 'Pubblico?',
          options: ['Sì', 'No'],
          recommended: 'No',
          kind: 'publish',
        }),
        fake.text('Ok, non pubblico.'),
      ],
    });
    const direct = capture();
    expect(await run(['chat', 'ciao', '--to', 'rhea', '--home', home], direct)).toBe(0);
    expect(direct.lines.join('\n')).toContain('Rhea: Sono Rhea.');

    const io = capture();
    const chat = run(['chat', 'pubblica il post', '--home', home], io);
    const started = Date.now();
    let id: string | undefined;
    while (!id) {
      if (Date.now() - started > 5000) throw new Error('no question');
      id = /monsters answer (\S+)/.exec(io.lines.join('\n'))?.[1];
      await new Promise((r) => setTimeout(r, 20));
    }
    expect(io.lines.join('\n')).toContain(
      '? Titan asks: Pubblico?\n   1) Sì\n   2) No (recommended)',
    );
    const answer = capture();
    expect(await run(['answer', id, '2', '--home', home], answer)).toBe(0);
    expect(answer.lines).toEqual(['Answer sent: No']);
    expect(await chat).toBe(0);
    expect(io.lines.join('\n')).toContain('Titan: Ok, non pubblico.');

    const vault = capture();
    expect(await run(['vault', 'reindex', '--home', home], vault)).toBe(0);
    expect(vault.lines[0]).toMatch(/^Index rebuilt: \d+ files in \d+ ms/);
    expect(await run(['vault', 'nope', '--home', home], capture())).toBe(2);
  });

  it('/nuova and /new start a new conversation, for everyone or for one agent', async () => {
    expect(parseNewConversation('/nuova')).toEqual({ to: undefined });
    expect(parseNewConversation(' /NEW ')).toEqual({ to: undefined });
    expect(parseNewConversation('/nuova @Rhea')).toEqual({ to: 'Rhea' });
    expect(parseNewConversation('/new', 'rhea')).toEqual({ to: 'rhea' });
    expect(parseNewConversation('/nuovissima')).toBeNull();
    expect(parseNewConversation('una /nuova idea')).toBeNull();

    const home = await core({ titan: [fake.text('Ciao!'), fake.text('Di nuovo ciao!')] });
    expect(await run(['chat', 'parliamo di Lisbona', '--home', home], capture())).toBe(0);
    const io = capture();
    expect(await run(['chat', '/nuova', '--home', home], io)).toBe(0);
    expect(io.lines).toEqual([
      'New conversation started: the earlier messages stay in the log, but the agents no longer see them.',
    ]);
    const direct = capture();
    expect(await run(['chat', '/new', '@Rhea', '--home', home], direct)).toBe(0);
    expect(direct.lines[0]).toMatch(/^New conversation started with Rhea:/);
    const resets = cores[0]!.log.query({ type: 'new_conversation' });
    expect(resets.map((e) => e.data)).toEqual([{ channel: 'cli' }, { to: 'rhea', channel: 'cli' }]);
    const unknown = capture();
    expect(await run(['chat', '/nuova', '--to', 'nessuno', '--home', home], unknown)).toBe(1);
    expect(unknown.errors.join('\n')).toContain('no agent called "nessuno"');
  });

  it('asks to complete the first start in the UI before chatting, without creating a team', async () => {
    const home = await core({ titan: [fake.text('Ciao!')] }, false);
    const io = capture();
    expect(await run(['chat', 'ciao', '--home', home], io)).toBe(1);
    expect(io.errors.join('\n')).toMatch(/Finish the first start in the interface first/);
    expect(cores[0]!.hub.team.list()).toEqual([]);
  });
});

describe('the event stream of the chat (F-B12)', () => {
  it('a bad frame does not crash the CLI and a socket closed before the hello ends the chat', async () => {
    const server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
    await new Promise<void>((resolve) => server.once('listening', resolve));
    server.on('connection', (ws) => {
      ws.send('not json');
      ws.close();
    });
    try {
      const { port } = server.address() as { port: number };
      const io = capture();
      const access = {
        url: `http://127.0.0.1:${port}`,
        token: 't',
        request: () => Promise.resolve([]),
      };
      await expect(cmdChat('ciao', {}, access as never, io)).rejects.toThrow(/stream/);
    } finally {
      server.close();
    }
  });
});
