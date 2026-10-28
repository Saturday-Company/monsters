import { EventEmitter } from 'node:events';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { TunnelError, type ConnectionProfile, type TunnelState } from '@monsters/remote';
import { describe, expect, it } from 'vitest';
import {
  forgetHostKey,
  hostCheck,
  knownHostsNames,
  parseSshG,
  sshDefaults,
  testConnection,
  withoutHosts,
  type SshRunner,
} from '../src/main/connection-check.ts';
import { connectionsPageHtml } from '../src/main/connections-page.ts';
import {
  activeRunCount,
  leaveLocalDialog,
  quitDialog,
  shouldConfirmStop,
} from '../src/main/core-jobs.ts';
import { fromAppPage, fromCorePage, targetInfo } from '../src/main/ipc-guards.ts';
import {
  duplicateNameMessage,
  hostLooksLikeName,
  hostWarning,
  parseProfileForm,
  ProfileStore,
} from '../src/main/profiles.ts';
import { remoteFailureCopy } from '../src/main/remote-copy.ts';
import type { TunnelLike } from '../src/main/remote-core.ts';
import { isStatusAction, statusPageHtml } from '../src/main/status-page.ts';
import { TargetSwitcher, type CoreHost } from '../src/main/target-switch.ts';
import { updateReadyDialog } from '../src/main/updater.ts';
import { tempDir } from './helpers.ts';

/*
 * First start and connections of the desktop app (audit UX, section 1): the choice of the
 * first start, the connections form and its checks, "Try" without changing computer, the
 * confirmation before stopping work in progress, the IPC of the new bridge calls.
 */

function storePath(): string {
  const dir = tempDir();
  mkdirSync(dir, { recursive: true });
  return join(dir, 'connections.json');
}

describe('first start', () => {
  it('no connections.json: the app asks; the first choice writes the file', () => {
    const path = storePath();
    const store = new ProfileStore(path);
    expect(store.firstStart).toBe(true);
    store.setLast('local');
    expect(JSON.parse(readFileSync(path, 'utf8'))).toMatchObject({ last: 'local' });
    expect(new ProfileStore(path).firstStart).toBe(false);
    // A file left by an older app (or a broken one) is not a first start.
    writeFileSync(path, '{ broken');
    expect(new ProfileStore(path).firstStart).toBe(false);
  });

  it('the page: "Where do your monsters work?", this computer recommended and focused', () => {
    const html = statusPageHtml({ kind: 'welcome' });
    expect(html).toContain('<h1>Where do your monsters work?</h1>');
    expect(html).toContain('<html lang="en"');
    expect(html).toContain('data-status="welcome"');
    const local = /<button[^>]*data-action="local"[^>]*>/.exec(html)?.[0] ?? '';
    expect(local).toContain('autofocus');
    expect(html).toContain('On this computer <em>Recommended</em>');
    expect(html).toContain('data-action="add-connection"');
    expect(html).toContain('On another computer of mine');
    // Only one autofocus: Enter chooses this computer.
    expect(html.match(/\sautofocus[\s>]/g)).toHaveLength(1);
    expect(html).toMatch(/script-src 'sha256-[^']+'/);
    expect(html).not.toContain('unsafe-eval');
  });

  it('starting, failed, locked: "Connections…" is always there; failed opens the log', () => {
    for (const view of [
      { kind: 'starting' as const },
      { kind: 'failed' as const, logPath: '/l' },
      { kind: 'locked' as const, home: '/h' },
    ]) {
      expect(statusPageHtml(view)).toContain('data-action="connections"');
    }
    expect(statusPageHtml({ kind: 'failed', logPath: '/l' })).toContain('Open the log');
    expect(isStatusAction('open-log')).toBe(true);
    expect(isStatusAction('evil')).toBe(false);
  });

  it('a start the core refused: its words, the log, "Try again"; it is not the "already running" page', () => {
    const html = statusPageHtml({
      kind: 'start-failed',
      message: 'settings.json: unexpected token <at line 3>',
      logPath: '/h/logs/desktop.log',
    });
    expect(html).toContain('Monsters couldn’t start');
    expect(html).toContain('data-status="start-failed"');
    // The core's message is on the page (escaped), the log path behind "Details".
    expect(html).toContain('settings.json: unexpected token &#60;at line 3&#62;');
    expect(html).toContain('The log is at /h/logs/desktop.log');
    expect(html).toContain('id="retry"');
    expect(html).toContain('data-action="open-log"');
    expect(html).toContain('data-action="connections"');
    expect(html).not.toContain('already running');
    expect(statusPageHtml({ kind: 'start-failed', message: '', logPath: '/l' })).toContain(
      'id="retry"',
    );
  });

  it('a start the core refused: its words, the log, "Try again"; not the "already running" page', () => {
    const html = statusPageHtml({
      kind: 'start-failed',
      message: 'settings.json: unexpected token <at line 3>',
      logPath: '/h/logs/desktop.log',
    });
    expect(html).toContain('Monsters couldn’t start');
    expect(html).toContain('data-status="start-failed"');
    // The core's message is on the page (escaped), the log path behind "Details".
    expect(html).toContain('settings.json: unexpected token &#60;at line 3&#62;');
    expect(html).toContain('The log is at /h/logs/desktop.log');
    expect(html).toContain('id="retry"');
    expect(html).toContain('data-action="open-log"');
    expect(html).toContain('data-action="connections"');
    expect(html).not.toContain('already running');
    expect(statusPageHtml({ kind: 'start-failed', message: '', logPath: '/l' })).toContain(
      'id="retry"',
    );
  });

  it('no developer commands in a packaged app, no "engine" anywhere', () => {
    const packaged = statusPageHtml({ kind: 'missing', path: '/opt/m/core.js', dev: false });
    expect(packaged).not.toContain('pnpm');
    expect(packaged).toContain('reinstall Monsters');
    expect(statusPageHtml({ kind: 'missing', path: '/x', dev: true })).toContain('pnpm build:core');
    for (const view of [
      { kind: 'starting' as const },
      { kind: 'restarting' as const, attempt: 1, maxAttempts: 5, delayMs: 1000 },
      { kind: 'failed' as const, logPath: '/l' },
      { kind: 'locked' as const, home: '/h' },
      { kind: 'remote-connecting' as const, name: 'casa' },
    ]) {
      const html = statusPageHtml(view);
      expect(html).not.toMatch(/engine|This PC|lsof|ss -ltnp/);
    }
  });

  it('error text can be selected: only a top strip drags the window', () => {
    const html = statusPageHtml({ kind: 'failed', logPath: '/l' });
    expect(html).toMatch(/\.drag\{[^}]*height:52px[^}]*-webkit-app-region:drag/);
    expect(html).not.toMatch(/body\{[^}]*-webkit-app-region:drag/);
  });
});

describe('connections form', () => {
  it('Computer first, Name optional, the rest under "Advanced options" (closed)', () => {
    const html = connectionsPageHtml();
    expect(html.indexOf('for="host"')).toBeLessThan(html.indexOf('for="name"'));
    expect(html).toContain('placeholder="192.168.1.20 or home-pc.local"');
    const advanced = html.slice(html.indexOf('<details class="advanced"'));
    for (const f of ['user', 'sshPort', 'identityFile', 'remotePort', 'remoteHome']) {
      expect(advanced).toContain(`for="${f}"`);
    }
    expect(html).not.toMatch(/<details class="advanced"[^>]* open/);
    // Enter is "Save and connect"; "Try" next to it.
    expect(html).toMatch(/<button type="submit" id="save-connect">Save and connect<\/button>/);
    expect(html).toContain('<button type="button" id="test">Try</button>');
    // No sysadmin words in the visible text.
    const text = html
      .replace(/<script>[\s\S]*<\/script>/, '')
      .replace(/<style>[\s\S]*<\/style>/, '');
    expect(text).not.toMatch(/MONSTERS_HOME|~\/\.ssh\/config|command-line token|This PC/);
    expect(text).toContain('Sign in without a password');
  });

  it('empty name: the address; same name twice refused, whatever the case', () => {
    expect(parseProfileForm({ host: 'pc-casa.local' })).toMatchObject({
      ok: true,
      profile: { name: 'pc-casa.local', host: 'pc-casa.local', autoLogin: true },
    });
    const store = new ProfileStore(storePath(), {
      newId: () => `id-${Math.random().toString(36).slice(2, 10)}`,
    });
    const first = store.save({ name: 'Casa', host: 'casa.lan' });
    expect(first.ok).toBe(true);
    expect(store.save({ name: ' casa ', host: 'altro.lan' })).toEqual({
      ok: false,
      errors: { name: duplicateNameMessage() },
    });
    // The name taken from the address: the message goes to the address.
    store.save({ name: 'ufficio.lan', host: 'x.lan' });
    expect(store.save({ host: 'ufficio.lan' })).toEqual({
      ok: false,
      errors: { host: duplicateNameMessage() },
    });
    // Editing a profile keeps its own name.
    if (first.ok) {
      expect(store.save({ id: first.profile.id, name: 'Casa', host: 'casa2.lan' }).ok).toBe(true);
    }
  });

  it('warns when the address looks like the name of the connection', () => {
    expect(hostWarning('Casa', 'Casa')).toBe(hostLooksLikeName());
    expect(hostWarning('PC di casa', '')).toBe(hostLooksLikeName());
    expect(hostWarning('casa.lan', 'casa.lan')).toBeNull();
    expect(hostWarning('192.168.1.20', 'Casa')).toBeNull();
    expect(hostWarning('', 'Casa')).toBeNull();
  });

  it('ssh -G gives the defaults of the advanced options', async () => {
    const out = 'user giulio\nhostname 100.64.0.7\nport 2222\nproxyjump none\nhostkeyalias none\n';
    expect(parseSshG(out, 'casa')).toEqual({
      hostname: '100.64.0.7',
      user: 'giulio',
      port: 2222,
      proxied: false,
      hostKeyAlias: null,
    });
    const calls: string[][] = [];
    const ssh: SshRunner = {
      dump: (args) => {
        calls.push(args);
        return Promise.resolve(out);
      },
    };
    await sshDefaults({ host: 'casa', user: 'g', sshPort: 22 }, ssh, '/cfg');
    expect(calls[0]).toEqual(['-G', '-F', '/cfg', '-l', 'g', '-p', '22', '--', 'casa']);
    // Never something ssh would read as an option.
    expect(await sshDefaults({ host: '-oProxyCommand=x' }, ssh)).toBeNull();
    expect(calls).toHaveLength(1);
  });

  it('an address the DNS does not know is reported, naming it; proxied hosts are not looked up', async () => {
    const ssh = (out: string): SshRunner => ({ dump: () => Promise.resolve(out) });
    const unknown = () => Promise.resolve(false);
    const known = () => Promise.resolve(true);
    expect(await hostCheck({ host: 'casa' }, ssh('hostname casa\n'), unknown)).toMatch(
      /^I can’t find “casa” on the network\./,
    );
    expect(await hostCheck({ host: 'casa' }, ssh('hostname casa\n'), known)).toBeNull();
    expect(
      await hostCheck({ host: 'casa' }, ssh('hostname casa\nproxyjump bastion\n'), unknown),
    ).toBeNull();
    // No answer from the resolver: no warning (offline is not "unknown name").
    expect(
      await hostCheck({ host: 'casa' }, ssh('hostname casa\n'), () => Promise.resolve(null)),
    ).toBeNull();
  });
});

class FakeTunnel implements TunnelLike {
  state: TunnelState = { status: 'connecting' };
  pid = undefined;
  closed = false;
  readonly listeners = new Set<(s: TunnelState) => void>();
  onState(l: (s: TunnelState) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  emit(s: TunnelState): void {
    this.state = s;
    for (const l of this.listeners) l(s);
  }
  reconnectNow(): void {}
  retry(): void {}
  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
  readRemoteFile(): Promise<string | null> {
    return Promise.resolve(null);
  }
}

class StayingHost extends EventEmitter implements CoreHost {
  target = null;
  closed = false;
  connect(): Promise<void> {
    return Promise.resolve();
  }
  retry(): void {}
  shutdown(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}

describe('"Try"', () => {
  const profile = { name: 'Home PC', host: 'casa.lan' };

  it('opens a tunnel of its own, says the version, closes it; the destination stays', async () => {
    const local = new StayingHost();
    const switcher = new TargetSwitcher<string>({ create: () => local });
    await switcher.switchTo('local');
    const tunnel = new FakeTunnel();
    let opened: ConnectionProfile | null = null;
    const result = testConnection(profile, (p) => {
      opened = p;
      return tunnel;
    });
    tunnel.emit({
      status: 'connected',
      url: 'http://127.0.0.1:5000',
      localPort: 5000,
      remotePort: 4747,
      remotePortSource: 'server.json',
      coreVersion: '0.1.0',
      originRewrite: true,
    });
    expect(await result).toEqual({
      ok: true,
      message: 'It works: Monsters 0.1.0 is answering on “Home PC”.',
    });
    expect(opened).toMatchObject({ host: 'casa.lan' });
    expect(tunnel.closed).toBe(true);
    expect(switcher.choice).toBe('local');
    expect(local.closed).toBe(false);
  });

  it('a failure names the address and the field to fix; the tunnel is closed anyway', async () => {
    const tunnel = new FakeTunnel();
    const result = testConnection(profile, () => tunnel);
    tunnel.emit({ status: 'failed', error: new TunnelError('host-not-found') });
    expect(await result).toEqual({
      ok: false,
      kind: 'host-not-found',
      message: expect.stringMatching(
        /^I can’t find “casa\.lan” on the network\. Check the address/,
      ) as unknown,
      field: 'host',
    });
    expect(tunnel.closed).toBe(true);
    const slow = new FakeTunnel();
    expect(await testConnection(profile, () => slow, 10)).toMatchObject({ ok: false });
    expect(slow.closed).toBe(true);
  });
});

describe('failures in plain words', () => {
  it('cite the address, say what to do, point at the field', () => {
    expect(remoteFailureCopy('auth-failed', 'Casa', 'casa.lan', '', 'linux')).toMatchObject({
      message: expect.stringContaining('“casa.lan” refused the sign-in') as unknown,
      tip: expect.stringContaining('ssh-copy-id') as unknown,
      fix: 'user',
    });
    // ssh-copy-id does not exist on Windows.
    expect(remoteFailureCopy('auth-failed', 'Casa', 'casa.lan', '', 'win32').tip).not.toContain(
      'ssh-copy-id',
    );
    expect(remoteFailureCopy('core-unreachable', 'Casa', 'casa.lan').fix).toBeNull();
    expect(remoteFailureCopy('host-key-changed', 'Casa', 'casa.lan').forgetKey).toBe(true);
    const html = statusPageHtml({
      kind: 'remote-failed',
      name: 'Casa',
      address: 'casa',
      errorKind: 'host-not-found',
      message: 'x',
      detail: '',
    });
    expect(html).toContain('I can’t find “casa” on the network.');
    // "Fix the connection" is the primary button, before "Try again".
    expect(html).toMatch(
      /<button type="button" data-action="fix">Fix the connection<\/button><button id="retry" type="button" class="secondary">/,
    );
    const changed = statusPageHtml({
      kind: 'remote-failed',
      name: 'Casa',
      errorKind: 'host-key-changed',
      message: 'x',
      detail: '',
    });
    expect(changed).toContain('data-action="forget-key"');
    expect(changed).not.toContain('known_hosts');
  });

  it('forgetting a key touches only the app’s known_hosts lines of that host', () => {
    const text = [
      'casa.lan ssh-ed25519 AAAA',
      '[casa.lan]:2222 ssh-ed25519 BBBB',
      'altro,casa.lan ecdsa-sha2-nistp256 CCCC',
      '# casa.lan comment',
      'ufficio ssh-ed25519 DDDD',
    ].join('\n');
    expect(withoutHosts(text, ['casa.lan'])).toEqual({
      kept: [
        '[casa.lan]:2222 ssh-ed25519 BBBB',
        '# casa.lan comment',
        'ufficio ssh-ed25519 DDDD',
      ].join('\n'),
      removed: 2,
    });
    expect(
      knownHostsNames({ hostname: 'h', user: '', port: 2222, proxied: false, hostKeyAlias: null }),
    ).toEqual(['[h]:2222']);
    const dir = tempDir();
    mkdirSync(dir, { recursive: true });
    const file = join(dir, 'known_hosts');
    writeFileSync(file, text);
    expect(forgetHostKey(file, ['ufficio'])).toBe(1);
    expect(readFileSync(file, 'utf8')).not.toContain('ufficio');
    expect(forgetHostKey(join(dir, 'none'), ['x'])).toBe(0);
  });
});

describe('work in progress before stopping the local core', () => {
  it('counts the active runs with the CLI token; unknown when the core does not answer', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const ok = ((url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get('authorization') });
      return Promise.resolve(Response.json({ runs: [{}, {}], halted: false }));
    }) as typeof fetch;
    expect(await activeRunCount('http://127.0.0.1:1', { bearer: 'tok' }, ok)).toBe(2);
    expect(seen).toEqual([{ url: 'http://127.0.0.1:1/api/status', auth: 'Bearer tok' }]);
    const refused = (() => Promise.resolve(new Response('', { status: 401 }))) as typeof fetch;
    expect(await activeRunCount('http://x', { bearer: 't' }, refused)).toBeNull();
    const down = (() => Promise.reject(new Error('ECONNREFUSED'))) as typeof fetch;
    expect(await activeRunCount('http://x', { bearer: 't' }, down)).toBeNull();
    expect(await activeRunCount('http://x', null, ok)).toBeNull();
  });

  it('asks only for a core the app started, with work or when it cannot know', () => {
    expect(shouldConfirmStop('owned', 2)).toBe(true);
    expect(shouldConfirmStop('owned', null)).toBe(true);
    expect(shouldConfirmStop('owned', 0)).toBe(false);
    expect(shouldConfirmStop('attached', 3)).toBe(false);
    expect(shouldConfirmStop('remote', 3)).toBe(false);
    expect(shouldConfirmStop(null, null)).toBe(false);
  });

  it('dialogs: the count, "Cancel" by default', () => {
    const leave = leaveLocalDialog('Home PC', 2);
    expect(leave.message).toBe(
      'On this computer there are 2 jobs running: if you switch to “Home PC” they will stop.',
    );
    expect(leave.buttons).toEqual(['Switch anyway', 'Cancel']);
    expect(leave.buttons[leave.defaultId]).toBe('Cancel');
    expect(leave.cancelId).toBe(leave.defaultId);
    expect(leaveLocalDialog('x', null).message).toBe('Switch to “x”?');
    expect(quitDialog(1).message).toBe(
      'On this computer there’s a job running: if you quit it will stop.',
    );
    expect(quitDialog(1, 'update').buttons[0]).toBe('Restart');
    const update = updateReadyDialog('0.2.0');
    expect(update.buttons).toEqual(['Restart now', 'Later']);
    expect(update.cancelId).toBe(1);
  });
});

describe('IPC of the bridge', () => {
  const frame = (url: string, origin?: string) => ({ url, origin: origin ?? new URL(url).origin });
  const wc = (main: { url: string }) => ({ mainFrame: main });

  it('the core page only: main frame of the main window, at the core origin', () => {
    const main = frame('http://127.0.0.1:4747/chat');
    const win = wc(main);
    const origin = 'http://127.0.0.1:4747';
    expect(fromCorePage({ sender: win, senderFrame: main }, win, origin)).toBe(true);
    // A subframe, another window, another origin, a status page, no core shown.
    expect(fromCorePage({ sender: win, senderFrame: frame(main.url) }, win, origin)).toBe(false);
    expect(fromCorePage({ sender: wc(main), senderFrame: main }, win, origin)).toBe(false);
    expect(fromCorePage({ sender: win, senderFrame: main }, win, 'http://127.0.0.1:1')).toBe(false);
    expect(fromCorePage({ sender: win, senderFrame: main }, win, null)).toBe(false);
    const data = frame('data:text/html;base64,AAAA');
    expect(fromCorePage({ sender: wc(data), senderFrame: data }, wc(data), origin)).toBe(false);
    expect(fromCorePage({ sender: win, senderFrame: null }, win, origin)).toBe(false);
    expect(fromCorePage({ sender: win, senderFrame: main }, null, origin)).toBe(false);
  });

  it('a document of the core with an opaque origin is not the core page (B12)', () => {
    // CSP `sandbox`: the URL is the core's, the origin is not.
    const sandboxed = frame('http://127.0.0.1:4747/api/files/x/raw', 'null');
    const win = wc(sandboxed);
    expect(
      fromCorePage({ sender: win, senderFrame: sandboxed }, win, 'http://127.0.0.1:4747'),
    ).toBe(false);
    // A frame that says nothing about its origin is refused too.
    const bare = { url: 'http://127.0.0.1:4747/' };
    expect(
      fromCorePage({ sender: wc(bare), senderFrame: bare }, wc(bare), 'http://127.0.0.1:4747'),
    ).toBe(false);
  });

  it('the app pages only: a data: HTML document in the main frame', () => {
    const data = frame('data:text/html;charset=utf-8;base64,AAAA');
    const win = wc(data);
    expect(fromAppPage({ sender: win, senderFrame: data }, win)).toBe(true);
    const core = frame('http://127.0.0.1:4747/');
    expect(fromAppPage({ sender: wc(core), senderFrame: core }, wc(core))).toBe(false);
    const svg = frame('data:image/svg+xml,<svg/>');
    expect(fromAppPage({ sender: wc(svg), senderFrame: svg }, wc(svg))).toBe(false);
    expect(fromAppPage({ sender: win, senderFrame: frame(data.url) }, win)).toBe(false);
  });

  it('where the window is connected: name and state, nothing else', () => {
    expect(targetInfo(null, true)).toEqual({
      kind: 'local',
      name: 'This computer',
      state: 'ready',
    });
    expect(targetInfo(null, false).state).toBe('starting');
    expect(targetInfo({ status: 'connected', name: 'Casa' }, false)).toEqual({
      kind: 'remote',
      name: 'Casa',
      state: 'ready',
    });
    expect(
      targetInfo(
        { status: 'reconnecting', name: 'Casa', attempt: 1, delayMs: 1, reason: '' },
        false,
      ).state,
    ).toBe('reconnecting');
    expect(
      targetInfo({ status: 'failed', name: 'Casa', kind: 'auth-failed', message: '' }, false).state,
    ).toBe('offline');
  });
});
