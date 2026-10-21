import { EventEmitter } from 'node:events';
import {
  TunnelError,
  type ConnectionProfile,
  type HostKeyInfo,
  type RemoteHomeFile,
  type TunnelOptions,
  type TunnelState,
} from '@monsters/remote';
import { describe, expect, it } from 'vitest';
import type { CoreTarget } from '../src/main/local-core.ts';
import type { StoredProfile } from '../src/main/profiles.ts';
import {
  bannerHtml,
  bannerText,
  hostKeyChangedDialog,
  hostKeyDialog,
  linkStatusText,
  TRUST_BUTTON,
  trayTooltip,
} from '../src/main/remote-copy.ts';
import {
  isRemoteTarget,
  RemoteCore,
  type LinkState,
  type RemoteTarget,
  type TunnelLike,
} from '../src/main/remote-core.ts';
import { statusPageHtml, type StatusView } from '../src/main/status-page.ts';
import { TargetSwitcher, type CoreHost } from '../src/main/target-switch.ts';

/*
 * The client mode without Electron (M3.3, D-047): the switch between "Questo PC" and the
 * remote profiles, the remote core over a fake tunnel, the words shown to the user.
 */

class FakeHost extends EventEmitter implements CoreHost {
  target: CoreTarget | null = null;
  connects = 0;
  retries = 0;
  closed = false;
  gate: Promise<void> = Promise.resolve();
  fail = false;
  readonly name: string;
  readonly events: string[];
  constructor(name: string, events: string[]) {
    super();
    this.name = name;
    this.events = events;
  }
  connect(): Promise<void> {
    this.connects += 1;
    this.events.push(`connect ${this.name}`);
    return Promise.resolve();
  }
  retry(): void {
    this.retries += 1;
  }
  async shutdown(): Promise<void> {
    this.events.push(`close ${this.name}`);
    await this.gate;
    this.closed = true;
    if (this.fail) throw new Error('boom');
  }
}

function switcher() {
  const events: string[] = [];
  const hosts: FakeHost[] = [];
  const s = new TargetSwitcher<string>({
    create: (choice) => {
      events.push(`create ${choice}`);
      const h = new FakeHost(choice, events);
      hosts.push(h);
      return h;
    },
  });
  s.on('active', (choice) => events.push(`active ${choice}`));
  return { s, events, hosts };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe('target switch', () => {
  it('closes the current core before opening the next one', async () => {
    const { s, events, hosts } = switcher();
    expect(s.phase).toBe('idle');
    await s.switchTo('local');
    expect(s.phase).toBe('active');
    expect(s.choice).toBe('local');
    await s.switchTo('casa');
    await tick();
    expect(events).toEqual([
      'create local',
      'active local',
      'connect local',
      'close local',
      'create casa',
      'active casa',
      'connect casa',
    ]);
    expect(hosts[0]!.closed).toBe(true);
    expect(s.host).toBe(hosts[1]);
  });

  it('the same choice only retries when there is nothing to show; force reopens it', async () => {
    const { s, events, hosts } = switcher();
    await s.switchTo('casa');
    await s.switchTo('casa');
    expect(hosts).toHaveLength(1);
    expect(hosts[0]!.retries).toBe(1);
    hosts[0]!.target = {
      kind: 'remote',
      url: 'http://127.0.0.1:1',
      loginToken: () => Promise.resolve(null),
      setupCode: () => Promise.resolve(null),
    };
    await s.switchTo('casa');
    expect(hosts[0]!.retries).toBe(1);
    await s.switchTo('casa', { force: true });
    expect(hosts).toHaveLength(2);
    expect(events.filter((e) => e.startsWith('close'))).toEqual(['close casa']);
  });

  it('requests made while closing: the last one wins, the ones in between never open', async () => {
    const { s, events, hosts } = switcher();
    await s.switchTo('local');
    let release!: () => void;
    hosts[0]!.gate = new Promise((r) => (release = r));
    const first = s.switchTo('casa');
    const second = s.switchTo('ufficio');
    const third = s.switchTo('server');
    expect(first).toBe(second);
    expect(second).toBe(third);
    expect(s.phase).toBe('switching');
    expect(s.host).toBeNull();
    release();
    await third;
    expect(events.filter((e) => e.startsWith('create'))).toEqual(['create local', 'create server']);
    expect(s.choice).toBe('server');
  });

  it('a core that fails to close does not block the switch', async () => {
    const { s, hosts } = switcher();
    await s.switchTo('local');
    hosts[0]!.fail = true;
    await s.switchTo('casa');
    expect(s.choice).toBe('casa');
  });

  it('on quit: closes the current core, waits for a running switch, then ignores requests', async () => {
    const { s, events, hosts } = switcher();
    await s.switchTo('local');
    let release!: () => void;
    hosts[0]!.gate = new Promise((r) => (release = r));
    void s.switchTo('casa');
    const quitting = s.shutdown();
    release();
    await quitting;
    expect(s.phase).toBe('closed');
    expect(s.host).toBeNull();
    expect(events).not.toContain('create casa');
    await s.switchTo('ufficio');
    expect(events).not.toContain('create ufficio');
  });
});

class FakeTunnel implements TunnelLike {
  state: TunnelState = { status: 'connecting' };
  pid: number | undefined = 4242;
  readonly listeners = new Set<(s: TunnelState) => void>();
  readonly files: Partial<Record<RemoteHomeFile, string>> = {};
  readonly reads: RemoteHomeFile[] = [];
  reconnects = 0;
  retries = 0;
  closed = false;
  onState(l: (s: TunnelState) => void) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  emit(s: TunnelState): void {
    this.state = s;
    for (const l of this.listeners) l(s);
  }
  reconnectNow(): void {
    this.reconnects += 1;
  }
  retry(): void {
    this.retries += 1;
  }
  close(): Promise<void> {
    this.closed = true;
    this.emit({ status: 'closed' });
    return Promise.resolve();
  }
  readRemoteFile(file: RemoteHomeFile): Promise<string | null> {
    this.reads.push(file);
    return Promise.resolve(this.files[file] ?? null);
  }
}

const PROFILE: StoredProfile = {
  id: 'id-casa0000',
  name: 'PC di casa',
  host: 'casa',
  autoLogin: false,
};

const connected = (localPort: number, remotePort = 4747): TunnelState => ({
  status: 'connected',
  url: `http://127.0.0.1:${localPort}`,
  localPort,
  remotePort,
  remotePortSource: 'server.json',
  coreVersion: '0.0.0',
  originRewrite: localPort !== remotePort,
});

function remote(profile: StoredProfile = PROFILE, fetchImpl?: typeof fetch) {
  const tunnel = new FakeTunnel();
  const opened: { profile: ConnectionProfile; options: TunnelOptions }[] = [];
  const asked: HostKeyInfo[] = [];
  const core = new RemoteCore({
    profile,
    openTunnel: (p, options) => {
      opened.push({ profile: p, options });
      return tunnel;
    },
    tunnelOptions: { knownHostsFile: '/x/known_hosts' },
    confirmHostKey: (info) => {
      asked.push(info);
      return Promise.resolve(true);
    },
    ...(fetchImpl ? { fetch: fetchImpl } : {}),
  });
  const seen: { targets: CoreTarget[]; downs: StatusView[]; links: LinkState[] } = {
    targets: [],
    downs: [],
    links: [],
  };
  core.on('target', (t) => seen.targets.push(t));
  core.on('down', (v) => seen.downs.push(v));
  core.on('link', (l) => seen.links.push(l));
  return { core, tunnel, opened, asked, seen };
}

describe('remote core over the tunnel', () => {
  it('turns the tunnel states into what the window and the tray show', async () => {
    const { core, tunnel, opened, seen } = remote();
    await core.connect();
    expect(opened[0]!.options.knownHostsFile).toBe('/x/known_hosts');
    expect(seen.downs).toEqual([{ kind: 'remote-connecting', name: 'PC di casa' }]);
    expect(seen.links).toEqual([{ status: 'connecting', name: 'PC di casa' }]);

    tunnel.emit(connected(5000));
    expect(seen.targets).toHaveLength(1);
    const target = core.target!;
    expect(isRemoteTarget(target)).toBe(true);
    expect(target).toMatchObject({
      kind: 'remote',
      url: 'http://127.0.0.1:5000',
      ports: { localPort: 5000, remotePort: 4747 },
      originRewrite: true,
      name: 'PC di casa',
    });
    // The rewrite follows the target's ports, also while the tunnel has none.
    tunnel.emit({
      status: 'reconnecting',
      attempt: 1,
      delayMs: 1000,
      error: new TunnelError('connection-lost'),
    });
    expect(
      target.rewriteHeaders('ws://127.0.0.1:5000/api/stream', { Origin: 'http://127.0.0.1:5000' }),
    ).toEqual({ Origin: 'http://127.0.0.1:4747' });
    // Reconnecting: the page stays (no status page), the banner says it.
    expect(seen.downs).toHaveLength(1);
    expect(core.target).toBe(target);
    expect(seen.links.at(-1)).toMatchObject({ status: 'reconnecting', attempt: 1 });

    // Back on the same port: same target, no reload.
    tunnel.emit(connected(5000));
    expect(seen.targets).toHaveLength(1);
    expect(seen.links.at(-1)).toEqual({ status: 'connected', name: 'PC di casa' });
    // Back on another port (the old one was taken): a new target, the window reloads.
    tunnel.emit(connected(5001));
    expect(seen.targets).toHaveLength(2);
    expect((seen.targets[1] as RemoteTarget).ports.localPort).toBe(5001);

    tunnel.emit({
      status: 'failed',
      error: new TunnelError('auth-failed', { detail: 'Permission denied (publickey).' }),
    });
    expect(core.target).toBeNull();
    expect(seen.downs.at(-1)).toMatchObject({
      kind: 'remote-failed',
      name: 'PC di casa',
      errorKind: 'auth-failed',
      detail: 'Permission denied (publickey).',
    });
    // "Riprova": the tunnel starts again and the page says it is connecting.
    core.retry();
    expect(tunnel.retries).toBe(1);
    tunnel.emit({ status: 'connecting' });
    expect(seen.downs.at(-1)).toEqual({ kind: 'remote-connecting', name: 'PC di casa' });

    await core.shutdown();
    expect(tunnel.closed).toBe(true);
    expect(core.target).toBeNull();
    core.retry();
    expect(tunnel.retries).toBe(1);
  });

  it('"Riprova" asks the tunnel to try again even after a refused host key; a wake does not', async () => {
    const { core, tunnel } = remote();
    await core.connect();
    tunnel.emit({ status: 'failed', error: new TunnelError('host-key-changed') });
    // Wake from sleep, network back: the tunnel decides (a refused key stays refused).
    core.reconnectNow();
    expect(tunnel.reconnects).toBe(1);
    expect(tunnel.retries).toBe(0);
    // The user's "Riprova" / "Riconnetti": an explicit retry, whatever the error was.
    core.retry();
    expect(tunnel.retries).toBe(1);
    expect(tunnel.reconnects).toBe(1);
  });

  it('asks the user for an unknown host key with the profile', async () => {
    const { core, opened, asked } = remote();
    await core.connect();
    const info: HostKeyInfo = {
      host: 'casa',
      hostname: 'casa',
      port: 22,
      knownHostsName: 'casa',
      keys: [{ type: 'ssh-ed25519', key: 'AAAA', fingerprint: 'SHA256:abc' }],
    };
    expect(await opened[0]!.options.confirmHostKey!(info)).toBe(true);
    expect(asked).toEqual([info]);
  });

  it('automatic login only when the profile asks for it, with a token minted through the tunnel', async () => {
    const calls: { url: string; auth: string | null }[] = [];
    const fakeFetch = ((url: string, init?: RequestInit) => {
      calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
      return Promise.resolve(Response.json({ token: 'monouso' }, { status: 201 }));
    }) as typeof fetch;

    const off = remote(PROFILE, fakeFetch);
    await off.core.connect();
    off.tunnel.files['cli-token'] = 'segreto';
    off.tunnel.emit(connected(5000));
    expect(await off.core.target!.loginToken()).toBeNull();
    expect(off.tunnel.reads).toEqual([]);

    const on = remote({ ...PROFILE, autoLogin: true }, fakeFetch);
    await on.core.connect();
    on.tunnel.emit(connected(5000));
    expect(await on.core.target!.loginToken()).toBeNull();
    on.tunnel.files['cli-token'] = 'segreto';
    expect(await on.core.target!.loginToken()).toBe('monouso');
    expect(calls).toEqual([
      { url: 'http://127.0.0.1:5000/api/login/token', auth: 'Bearer segreto' },
    ]);
    // The setup code of a remote core never configured, read over SSH.
    on.tunnel.files['setup-code'] = 'ABCD-EFGH-IJKL';
    expect(await on.core.target!.setupCode()).toBe('ABCD-EFGH-IJKL');
  });
});

describe('words of the client mode', () => {
  const info: HostKeyInfo = {
    host: 'casa',
    hostname: '100.64.0.7',
    port: 2222,
    knownHostsName: '[100.64.0.7]:2222',
    keys: [{ type: 'ssh-ed25519', key: 'AAAA', fingerprint: 'SHA256:QmFzZTY0' }],
  };

  it('host key dialog: fingerprint, how to check it, "Cancel" by default', () => {
    const d = hostKeyDialog(info, 'Home PC');
    expect(d.buttons[d.defaultId]).toBe('Cancel');
    expect(d.cancelId).toBe(d.defaultId);
    expect(d.buttons[TRUST_BUTTON]).toBe('I trust it, connect');
    // Reassuring first line; address, fingerprint and the check after it.
    expect(d.message).toBe(
      'You’re connecting to “Home PC” for the first time. If you set it up yourself, that’s normal.',
    );
    expect(d.detail).toContain('100.64.0.7, port 2222');
    expect(d.detail).toContain('SHA256:QmFzZTY0');
    expect(d.detail).toContain('ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub');
    expect(hostKeyChangedDialog('Home PC')).toMatchObject({
      type: 'error',
      buttons: ['OK'],
    });
  });

  it('tray, banner and connections page say where the app is connected', () => {
    const name = 'Home PC';
    expect(trayTooltip(null)).toBe('Monsters · This computer');
    expect(trayTooltip({ status: 'connected', name })).toBe('Monsters · Connected to Home PC');
    const reconnecting: LinkState = {
      status: 'reconnecting',
      name,
      attempt: 2,
      delayMs: 2000,
      reason: 'x',
    };
    expect(trayTooltip(reconnecting)).toBe('Monsters · Reconnecting to Home PC…');
    expect(trayTooltip({ status: 'failed', name, kind: 'auth-failed', message: '' })).toBe(
      'Monsters · Disconnected from Home PC',
    );
    expect(bannerText(reconnecting)).toBe('Link to Home PC interrupted. Reconnecting… (attempt 2)');
    expect(bannerText(null)).toBeNull();
    expect(linkStatusText(null, true)).toBe('In use');
    expect(linkStatusText(reconnecting, false)).toBe('In use · reconnecting… (attempt 2)');
    const html = bannerHtml('<b>casa</b>', 'busy');
    expect(html).toContain('&#60;b&#62;casa');
    expect(html).toContain("default-src 'none'");
    expect(html).not.toContain('<script');
  });

  it('status page of a failed connection: message, tip, details, actions', () => {
    const html = statusPageHtml({
      kind: 'remote-failed',
      name: 'PC <casa>',
      address: 'casa.lan',
      errorKind: 'auth-failed',
      message: new TunnelError('auth-failed').message,
      detail: 'giulio@casa: Permission denied (publickey).',
    });
    expect(html).toContain('I can’t connect to PC &#60;casa&#62;');
    // The address tried, in plain words, and what to do.
    expect(html).toContain('“casa.lan” refused the sign-in');
    // The tip depends on the system: ssh-copy-id does not exist on Windows.
    expect(html).toContain(process.platform === 'win32' ? 'authorized_keys' : 'ssh-copy-id');
    expect(html).toContain('data-action="fix"');
    expect(html).toContain('<summary>Details</summary>');
    expect(html).toContain('data-action="local"');
    expect(html).toContain('data-action="connections"');
    expect(html).toContain('id="retry"');
    const connecting = statusPageHtml({ kind: 'remote-connecting', name: 'casa' });
    expect(connecting).not.toContain('id="retry"');
    expect(connecting).toContain('Use this computer');
  });
});
