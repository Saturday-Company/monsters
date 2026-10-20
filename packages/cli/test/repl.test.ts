import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import {
  orchestratorBlueprint,
  startCore,
  writeAgentFolder,
  type CoreServer,
} from '@monsters/core';
import { ProviderRegistry } from '@monsters/providers';
import { fake, FakeProvider, type FakeScript } from '@monsters/providers/testing';
import type { LogEvent } from '@monsters/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { run, type Io } from '../src/main.ts';

/*
 * `monsters chat` without a message: the interactive chat used over SSH
 * (D-014). Lines go in through a stream, as typed in a terminal.
 */

const dirs: string[] = [];
const cores: CoreServer[] = [];
afterEach(async () => {
  for (const c of cores.splice(0)) await c.close();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const never = new Promise<never>(() => {});

async function core(
  scripts: Record<string, FakeScript>,
): Promise<{ home: string; core: CoreServer }> {
  const dir = mkdtempSync(join(tmpdir(), 'monsters-repl-'));
  dirs.push(dir);
  const home = join(dir, 'home');
  await writeAgentFolder(
    join(home, 'agents', 'titan'),
    orchestratorBlueprint({ user: 'Giulio', models: [{ provider: 'fake', model: 'titan' }] }),
  );
  const providers = new ProviderRegistry().register(new FakeProvider({ models: scripts }));
  const c = await startCore({
    home,
    port: 0,
    env: {},
    hub: { providers, decisionPort: null, webTools: [], settings: { watchVault: false } },
  });
  cores.push(c);
  return { home, core: c };
}

function terminal(): Io & {
  input: PassThrough;
  screen: () => string;
  type: (line: string) => void;
} {
  const input = new PassThrough();
  let screen = '';
  return {
    input,
    out: (l) => (screen += `${l}\n`),
    err: (l) => (screen += `ERR ${l}\n`),
    write: (t) => (screen += t),
    screen: () => screen,
    type: (line) => input.write(`${line}\n`),
  };
}

async function until(check: () => boolean, what: string, ms = 5000): Promise<void> {
  const started = Date.now();
  while (!check()) {
    if (Date.now() - started > ms) throw new Error(`timeout waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe('monsters chat (interactive, for SSH)', () => {
  it('streams answers, answers by number, /stop in less than 2 s, /riprendi, /nuova', async () => {
    const { home, core: c } = await core({
      titan: [
        fake.toolCall('ask_user', {
          question: 'Pubblico il post?',
          options: [
            { label: 'Sì', description: 'adesso' },
            { label: 'No', description: 'resta una bozza' },
          ],
          recommended: 'No',
          kind: 'publish',
        }),
        fake.text('Ok, non pubblico.'),
        fake.text('mai', { gate: never }),
      ],
    });
    const tty = terminal();
    const chat = run(['chat', '--home', home], tty);
    await until(() => tty.screen().includes('/aiuto for the commands'), 'banner');

    tty.type('pubblica il post');
    await until(() => tty.screen().includes('2) No (recommended) - resta una bozza'), 'question');
    expect(tty.screen()).toContain('? Titan asks: Pubblico il post?\n   1) Sì - adesso');
    expect(tty.screen()).toContain('Type the number of your choice');
    tty.type('3');
    await until(() => tty.screen().includes('choose a number from 1 to 2'), 'range check');
    tty.type('2');
    await until(() => tty.screen().includes('Ok, non pubblico.'), 'answer');
    await until(() => tty.screen().includes('(end: completed)'), 'end');
    const answer = c.log.query({ type: 'answer' })[0] as LogEvent<'answer'>;
    expect(answer.data).toMatchObject({ optionId: '2', channel: 'cli' });
    // Streamed or not, the answer is printed once.
    expect(tty.screen().split('Ok, non pubblico.').length).toBe(2);

    tty.type('lavora a lungo');
    await until(() => c.runs.activeRuns().length === 1, 'running');
    const sent = Date.now();
    tty.type('/stop');
    await until(() => tty.screen().includes('■ Stopped. Runs aborted: 1'), 'stop');
    expect(Date.now() - sent).toBeLessThan(2000);
    expect(c.runs.halted).toBe(true);
    expect(c.runs.activeRuns()).toEqual([]);

    tty.type('/stato');
    await until(() => tty.screen().includes('Kill switch: ENGAGED'), 'status');
    tty.type('/riprendi');
    await until(() => tty.screen().includes('Let the agents work again? [y/N]'), 'confirm');
    expect(c.runs.halted).toBe(true);
    tty.type('s');
    await until(() => tty.screen().includes('Resumed: the agents can work again.'), 'resume');
    expect(c.runs.halted).toBe(false);

    tty.type('/nuova');
    await until(() => tty.screen().includes('New conversation:'), 'new conversation');
    tty.type('/boh');
    await until(() => tty.screen().includes('unknown command /boh'), 'unknown');
    tty.type('/esci');
    expect(await chat).toBe(0);
  });

  it('a script piped in: waits for the work it started, then ends', async () => {
    const { home } = await core({ titan: [fake.text('Ciao dal terminale.')] });
    const io = terminal();
    const { write: _write, ...lines } = io;
    expect(
      await run(['chat', '--home', home], { ...lines, input: Readable.from(['ciao\n']) }),
    ).toBe(0);
    expect(io.screen()).toContain('Titan: Ciao dal terminale.');
    expect(io.screen()).toContain('(end: completed)');
  });

  it('a system reminder (D-025) is never printed and the answer appears once', async () => {
    const { home, core: c } = await core({
      titan: [fake.text('Ho finito la bozza. Vuoi che la pubblichi?'), fake.text('ok')],
    });
    const tty = terminal();
    const chat = run(['chat', '--home', home], tty);
    await until(() => tty.screen().includes('/aiuto for the commands'), 'banner');
    tty.type('scrivi la bozza');
    await until(() => tty.screen().includes('(end: completed)'), 'end');
    tty.type('/esci');
    expect(await chat).toBe(0);
    const reminder = c.log
      .query({ type: 'message' })
      .find((e) => e.type === 'message' && e.data.role === 'system');
    expect(reminder).toBeDefined();
    const screen = tty.screen();
    expect(screen).not.toContain((reminder as LogEvent<'message'>).data.text);
    expect(screen.split('Vuoi che la pubblichi?').length - 1).toBe(1);
  });

  it('agent text never drives the terminal: control sequences are stripped', async () => {
    const evil = 'Fatto\x1b]52;c;ZWNobyBwd25lZA==\x07\x1b[2J\x1b]8;;https://x.it\x07link\u202e.';
    const { home } = await core({
      titan: [fake.toolCall('ask_user', { question: `Ok?\x1b[2J`, options: [] }), fake.text(evil)],
    });
    const tty = terminal();
    const chat = run(['chat', '--home', home], tty);
    await until(() => tty.screen().includes('/aiuto for the commands'), 'banner');
    tty.type('vai');
    await until(() => tty.screen().includes('Answer with /risposta'), 'question');
    tty.type('/risposta si');
    await until(() => tty.screen().includes('(end: completed)'), 'end');
    tty.type('/esci');
    expect(await chat).toBe(0);
    const screen = tty.screen();
    expect(screen).toContain('Fatto]52;c;ZWNobyBwd25lZA==');
    // eslint-disable-next-line no-control-regex
    expect(screen).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202E]/);

    // The one-shot chat too.
    const { home: other } = await core({ titan: [fake.text(evil)] });
    const once = terminal();
    expect(await run(['chat', 'vai', '--home', other], once)).toBe(0);
    expect(once.screen()).toContain('Titan: Fatto');
    // eslint-disable-next-line no-control-regex
    expect(once.screen()).not.toMatch(/[\u0000-\u0008\u000B-\u001F\u007F-\u009F\u202E]/);
  });
});
