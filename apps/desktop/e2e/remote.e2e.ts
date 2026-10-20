import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { startTestSshd, type TestSshd } from '@monsters/remote/testing';
import { expect, test, type ElectronApplication, type Locator, type Page } from '@playwright/test';
import {
  api,
  appEnv,
  isAlive,
  lockPid,
  BUNDLE,
  clickMenu,
  EMAIL,
  launch,
  PASSWORD,
  quit,
  tempRoot,
} from './helpers.ts';

/*
 * The client mode end to end (M3.3, D-047): a real sshd as the current user on a random port
 * (temp host key and authorized_keys, never ~/.ssh), a real core on a temp data directory as
 * "the remote computer", and the app with its own local data directory. In order: add a
 * profile, confirm the fingerprint (dialog stubbed in the main process), first start of the
 * remote core with the setup code read over SSH, Origin rewrite on HTTP and WebSocket, kill
 * switch from the menu on the remote core, ssh killed → reconnection, back to "Questo PC";
 * then a relaunch straight on the remote profile with automatic login; then a refused key.
 */

test.describe.configure({ mode: 'serial' });

let dirs: ReturnType<typeof tempRoot>;
let sshd: TestSshd | null = null;
let skip = '';
let remote: ChildProcess | null = null;
let remoteHome = '';
let remoteUrl = '';
let remotePort = 0;

const PROFILE = 'PC di prova';

test.beforeAll(async () => {
  dirs = tempRoot();
  const started = await startTestSshd();
  if ('skip' in started) {
    skip = started.skip;
    return;
  }
  sshd = started;
  remoteHome = join(dirs.root, 'remote-home');
  remote = spawn(process.execPath, [BUNDLE, 'start', '--home', remoteHome, '--port', '0'], {
    env: appEnv(remoteHome, dirs.userData(99)),
    stdio: 'ignore',
  });
  await expect
    .poll(() => existsSync(join(remoteHome, 'server.json')), { timeout: 30_000 })
    .toBe(true);
  const info = JSON.parse(readFileSync(join(remoteHome, 'server.json'), 'utf8')) as {
    url: string;
    port: number;
  };
  remoteUrl = info.url;
  remotePort = info.port;
});

test.afterAll(async () => {
  if (remote && remote.exitCode === null) {
    const exited = new Promise((r) => remote!.once('exit', r));
    remote.kill('SIGTERM');
    await exited;
  }
  await sshd?.stop();
  dirs?.cleanup();
});

/** The app with ssh pointed at the test server only (no ~/.ssh, no agent). */
function launchClient(userData: string) {
  return launch(dirs.home, userData, {
    MONSTERS_DESKTOP_SSH_CONFIG: sshd!.sshConfig,
    MONSTERS_DESKTOP_SSH_KNOWN_HOSTS: '',
    SSH_AUTH_SOCK: '',
  });
}

/** Replaces dialog.showMessageBox in the main process: records it, answers the last button. */
async function stubDialogs(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog }) => {
    const g = globalThis as { __dialogs?: unknown[] };
    g.__dialogs = [];
    dialog.showMessageBox = (...args: unknown[]) => {
      const opts = (args.length > 1 ? args[1] : args[0]) as {
        type?: string;
        message: string;
        detail?: string;
        buttons?: string[];
        defaultId?: number;
        cancelId?: number;
      };
      g.__dialogs?.push(opts);
      return Promise.resolve({ response: (opts.buttons?.length ?? 1) - 1, checkboxChecked: false });
    };
  });
}

interface Recorded {
  type?: string;
  message: string;
  detail?: string;
  buttons?: string[];
  defaultId?: number;
  cancelId?: number;
}

function dialogs(app: ElectronApplication): Promise<Recorded[]> {
  return app.evaluate(() => ((globalThis as { __dialogs?: Recorded[] }).__dialogs ?? []).slice());
}

/** The first window of the app (pages come and go when the session changes) matching `ok`. */
async function windowWhere(
  app: ElectronApplication,
  ok: (page: Page) => Promise<boolean> | boolean,
  timeout = 30_000,
): Promise<Page> {
  let found: Page | null = null;
  await expect
    .poll(
      async () => {
        for (const page of app.windows()) {
          try {
            if (!page.isClosed() && (await ok(page))) {
              found = page;
              return true;
            }
          } catch {
            // closing meanwhile
          }
        }
        return false;
      },
      { timeout },
    )
    .toBe(true);
  return found!;
}

const onOrigin = (origin: string) => (page: Page) => page.url().startsWith(`${origin}/`);

const hasStatus = (kind: string) => async (page: Page) =>
  page.url().startsWith('data:') && (await page.locator(`main[data-status="${kind}"]`).count()) > 0;

function desktopLog(): string {
  return readFileSync(join(dirs.home, 'logs', 'desktop.log'), 'utf8');
}

function localOrigin(): string {
  return (JSON.parse(readFileSync(join(dirs.home, 'server.json'), 'utf8')) as { url: string }).url;
}

async function remoteStatus(): Promise<{ halted: boolean }> {
  const token = readFileSync(join(remoteHome, 'cli-token'), 'utf8').trim();
  const res = await fetch(`${remoteUrl}/api/status`, {
    headers: { authorization: `Bearer ${token}` },
  });
  return (await res.json()) as { halted: boolean };
}

/** pids of the ssh tunnels to the test server (the guard shell and ssh itself). */
function tunnelPids(): number[] {
  const out = spawnSync(
    'pgrep',
    ['-f', '--', `-p ${sshd!.port} .* -N .*127\\.0\\.0\\.1:${remotePort}`],
    {
      encoding: 'utf8',
    },
  );
  return out.stdout
    .split('\n')
    .map((l) => Number(l.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
}

/** Screenshots for the docs and reviews, only with MONSTERS_E2E_SHOTS=<folder>. */
const SHOTS = process.env['MONSTERS_E2E_SHOTS'];
async function shot(page: Page, name: string): Promise<void> {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: join(SHOTS, name) });
  // The same page in the dark theme (Playwright emulates the colour scheme of its pages).
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.screenshot({ path: join(SHOTS, name.replace(/\.png$/, '-scuro.png')) });
  await page.emulateMedia({ colorScheme: 'light' });
}
/** The whole virtual screen (the banner is a view over the page, not part of it). */
function screen(name: string): void {
  const display = process.env['DISPLAY'];
  if (!SHOTS || !display) return;
  mkdirSync(SHOTS, { recursive: true });
  const args = ['-loglevel', 'error', '-y', '-f', 'x11grab', '-i', display, '-frames:v', '1'];
  spawnSync('ffmpeg', [...args, join(SHOTS, name)]);
}

async function openConnections(app: ElectronApplication): Promise<Page> {
  await clickMenu(app, 'monsters-connections');
  return windowWhere(app, async (p) => (await p.title()) === 'Connessioni · Monsters');
}

async function fill(page: Page, label: string, value: string): Promise<Locator> {
  const field = page.getByLabel(label, { exact: true });
  await field.fill(value);
  return field;
}

test('add a profile, trust the host, first start of the remote core, kill switch, reconnection, back home', async () => {
  test.skip(skip !== '', skip);
  const { app, page: first } = await launchClient(dirs.userData(1));
  await expect.poll(() => first.url(), { timeout: 30_000 }).toMatch(/^http:\/\/127\.0\.0\.1:/);
  const local = localOrigin();
  await stubDialogs(app);

  // The connections window: "Questo computer" in use, a new computer with a wrong port first.
  const conn = await openConnections(app);
  await expect(
    conn.locator('article[data-choice="local"] [data-testid="current-status"]'),
  ).toHaveText('In uso');
  await conn.getByRole('button', { name: 'Aggiungi un computer' }).click();
  // "Computer" first and focused; the rest under "Opzioni avanzate", closed.
  await expect(conn.getByLabel('Computer', { exact: true })).toBeFocused();
  await expect(conn.getByLabel('Porta', { exact: true })).toBeHidden();
  await fill(conn, 'Computer', '127.0.0.1');
  await fill(conn, 'Nome', PROFILE);
  await conn.getByText('Opzioni avanzate').click();
  await fill(conn, 'Porta', '99999');
  await fill(conn, 'Chiave', sshd!.clientKey);
  await fill(conn, 'Cartella dati', remoteHome);
  await conn.getByRole('button', { name: 'Salva', exact: true }).click();
  await expect(conn.locator('#err-sshPort')).toHaveText(/tra 1 e 65535/);
  await fill(conn, 'Porta', String(sshd!.port));
  await expect(conn.locator('#err-sshPort')).toHaveText('');
  // Automatic login is on for a new computer (decided 15/10/2026).
  await expect(conn.getByLabel('Entra senza password')).toBeChecked();
  await shot(conn, 'connessioni-nuovo.png');

  // "Prova": a tunnel of its own, the fingerprint asked once; the window stays on this
  // computer and its core keeps running.
  const localPid = lockPid(dirs.home);
  expect(localPid).not.toBeNull();
  await conn.getByRole('button', { name: 'Prova' }).click();
  await expect(conn.locator('#test-result')).toHaveText(
    /^Funziona: Monsters \S+ risponde su «PC di prova»\.$/,
    { timeout: 30_000 },
  );
  await shot(conn, 'connessioni-prova.png');
  expect(first.url().startsWith(`${local}/`)).toBe(true);
  expect(isAlive(localPid!)).toBe(true);
  expect(lockPid(dirs.home)).toBe(localPid);
  await expect.poll(() => tunnelPids()).toEqual([]);
  expect(desktopLog()).toContain(`connections: try of "${PROFILE}": ok`);

  // Enter in the form is "Salva e collega".
  await conn.getByLabel('Nome', { exact: true }).press('Enter');

  // The window moves to the remote core (a new window: one session per destination).
  const page = await windowWhere(
    app,
    (p) => /^http:\/\/127\.0\.0\.1:\d+\//.test(p.url()) && !p.url().startsWith(`${local}/`),
  );
  const tunnelOrigin = new URL(page.url()).origin;
  // Same machine: the remote core's port is taken here, so the tunnel uses another one.
  expect(new URL(tunnelOrigin).port).not.toBe(String(remotePort));

  // The fingerprint was shown (by "Prova"), "Annulla" by default; nothing else was asked
  // (no work in progress on this computer).
  const [hostKey, ...others] = await dialogs(app);
  expect(others).toEqual([]);
  expect(hostKey).toMatchObject({
    type: 'warning',
    buttons: ['Annulla', 'Mi fido, collegati'],
    defaultId: 0,
    cancelId: 0,
  });
  expect(hostKey!.detail).toContain(sshd!.hostFingerprint);
  expect(hostKey!.detail).toContain('ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub');

  // First start of the remote core: the setup code comes over SSH, only email and password.
  await expect(page.getByTestId('setup-code-from-app')).toBeVisible();
  await page.getByLabel('Email').fill(EMAIL);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Crea account' }).click();
  await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', 'key');
  expect(await api(page, '/api/me')).toEqual({
    email: EMAIL,
    via: 'session',
    owner: true,
    recent: true,
  });
  await shot(page, 'remoto-onboarding.png');

  // The Origin rewrite reaches the WebSocket upgrade too: the stream opens through the tunnel.
  const ws = await page.evaluate(
    (url) =>
      new Promise<string>((resolve) => {
        const s = new WebSocket(url);
        s.onopen = () => {
          s.close();
          resolve('open');
        };
        s.onerror = () => resolve('error');
      }),
    `${tunnelOrigin.replace('http:', 'ws:')}/api/stream`,
  );
  expect(ws).toBe('open');
  expect(desktopLog()).toMatch(/origin rewrite: \d+ → \d+ \(HTTP and WebSocket\)/);
  expect(desktopLog()).toContain(`tray: Monsters · Collegato a ${PROFILE}`);

  // "Ferma tutto" from the menu stops the remote core (the one the window shows).
  await clickMenu(app, 'monsters-kill');
  await expect.poll(async () => (await remoteStatus()).halted).toBe(true);
  await clickMenu(app, 'monsters-resume');
  await expect.poll(async () => (await remoteStatus()).halted).toBe(false);

  // ssh dies (network gone): banner and tray say so, the tunnel comes back on the same port.
  const pids = tunnelPids();
  expect(pids.length).toBeGreaterThan(0);
  for (const pid of pids) process.kill(pid, 'SIGKILL');
  await expect
    .poll(() => desktopLog(), { timeout: 15_000 })
    .toContain(`tray: Monsters · Mi ricollego a ${PROFILE}…`);
  screen('banner-riconnessione.png');
  await expect
    .poll(() => desktopLog().match(/link: connected/g)?.length ?? 0, { timeout: 20_000 })
    .toBeGreaterThanOrEqual(2);
  screen('banner-collegato.png');
  expect(page.url().startsWith(`${tunnelOrigin}/`)).toBe(true);
  expect(await api(page, '/api/me')).toEqual({
    email: EMAIL,
    via: 'session',
    owner: true,
    recent: true,
  });
  expect(tunnelPids().some((p) => !pids.includes(p))).toBe(true);

  // Wake from sleep: the link is checked at once; a healthy one stays as it is.
  const reconnections = desktopLog().match(/link: reconnecting/g)?.length ?? 0;
  await app.evaluate(({ powerMonitor }) => {
    powerMonitor.emit('resume');
  });
  await expect.poll(() => desktopLog()).toContain('resume: checking the link');
  await page.waitForTimeout(500);
  expect(desktopLog().match(/link: reconnecting/g)?.length ?? 0).toBe(reconnections);

  // Control: without the rewrite the same WebSocket (and the API) are refused by the core.
  const id = (
    JSON.parse(readFileSync(join(dirs.userData(1), 'connections.json'), 'utf8')) as {
      profiles: { id: string }[];
    }
  ).profiles[0]!.id;
  await app.evaluate(({ session }, partition) => {
    session.fromPartition(partition).webRequest.onBeforeSendHeaders(null);
  }, `persist:remote-${id}`);
  const refused = await page.evaluate(
    async (url) => {
      // A POST carries Origin (a same-origin GET does not).
      const res = await fetch('/api/resume', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-monsters-request': '1' },
        body: '{}',
      });
      const ws = await new Promise<string>((resolve) => {
        const s = new WebSocket(url);
        s.onopen = () => {
          s.close();
          resolve('open');
        };
        s.onerror = () => resolve('error');
      });
      return { post: res.status, ws };
    },
    `${tunnelOrigin.replace('http:', 'ws:')}/api/stream`,
  );
  expect(refused).toEqual({ post: 403, ws: 'error' });

  // Back to "Questo computer": the tunnel is closed, the window shows the local core again.
  await clickMenu(app, 'monsters-target-local');
  await windowWhere(
    app,
    (p) => /^http:\/\/127\.0\.0\.1:\d+\//.test(p.url()) && !p.url().startsWith(`${tunnelOrigin}/`),
  );
  await expect.poll(() => tunnelPids()).toEqual([]);
  expect(desktopLog()).toContain(`remote: disconnected from "${PROFILE}"`);
  expect(desktopLog()).toContain('tray: Monsters · Questo computer');
  const saved = JSON.parse(readFileSync(join(dirs.userData(1), 'connections.json'), 'utf8')) as {
    last: string;
    profiles: { name: string; autoLogin: boolean }[];
  };
  expect(saved).toMatchObject({ last: 'local', profiles: [{ name: PROFILE, autoLogin: true }] });
  await quit(app);
});

test('relaunch on the remote profile: known host, automatic login, quit closes the tunnel', async () => {
  test.skip(skip !== '', skip);
  // A new device (fresh user data): same profile with automatic login, the host already known.
  const userData = dirs.userData(2);
  mkdirSync(userData, { recursive: true });
  const old = JSON.parse(readFileSync(join(dirs.userData(1), 'connections.json'), 'utf8')) as {
    profiles: { id: string }[];
  };
  const profile = { ...old.profiles[0]!, autoLogin: true };
  writeFileSync(
    join(userData, 'connections.json'),
    JSON.stringify({ version: 1, profiles: [profile], last: profile.id }),
  );
  copyFileSync(join(dirs.userData(1), 'known_hosts'), join(userData, 'known_hosts'));

  const { app } = await launchClient(userData);
  await stubDialogs(app);
  const page = await windowWhere(app, (p) => /^http:\/\/127\.0\.0\.1:\d+\//.test(p.url()));
  // No password: a single-use token minted with the remote CLI token read over SSH.
  await expect(page.getByTestId('onboarding')).toBeVisible();
  expect(await api(page, '/api/me')).toEqual({
    email: EMAIL,
    via: 'session',
    owner: false,
    recent: false,
  });
  expect(await dialogs(app)).toEqual([]);
  // The local core was never started: client mode only.
  expect(desktopLog().split('Monsters desktop').at(-1)).not.toContain('started core at');
  expect(tunnelPids().length).toBeGreaterThan(0);
  await quit(app);
  await expect.poll(() => tunnelPids()).toEqual([]);
});

test('a key the computer refuses: clear message, "Correggi la connessione", then "Usa questo computer"', async () => {
  test.skip(skip !== '', skip);
  const { app } = await launchClient(dirs.userData(1));
  await windowWhere(app, (p) => /^http:\/\/127\.0\.0\.1:\d+\//.test(p.url()));
  await stubDialogs(app);
  const conn = await openConnections(app);
  await expect(conn.locator('article[data-choice] h2')).toHaveText(['Questo computer', PROFILE]);
  await shot(conn, 'connessioni-elenco.png');
  await conn.getByRole('button', { name: `Modifica ${PROFILE}` }).click();
  // Advanced options already set: the section is open.
  await fill(conn, 'Chiave', sshd!.strangerKey);
  await conn.getByRole('button', { name: 'Salva e collega' }).click();
  const failed = await windowWhere(app, hasStatus('remote-failed'));
  await expect(failed.getByRole('heading')).toHaveText(`Non riesco a collegarmi a ${PROFILE}`);
  await expect(failed.getByText(/«127\.0\.0\.1» ha rifiutato l’accesso/)).toBeVisible();
  await expect(failed.getByText(/solo con una chiave SSH/)).toBeVisible();
  await expect(failed.getByText(/ssh-copy-id/)).toBeVisible();
  await shot(failed, 'remoto-chiave-rifiutata.png');
  // "Correggi la connessione": the form of this profile, on the user field.
  await failed.getByRole('button', { name: 'Correggi la connessione' }).click();
  const fix = await windowWhere(app, async (p) => (await p.title()) === 'Connessioni · Monsters');
  await expect(fix.locator('#form-title')).toHaveText(`Modifica ${PROFILE}`);
  await expect(fix.getByLabel('Utente', { exact: true })).toBeFocused();
  await expect(fix.getByLabel('Utente', { exact: true })).toHaveClass(/highlight/);
  await shot(fix, 'connessioni-correggi.png');
  await failed.getByRole('button', { name: 'Usa questo computer' }).click();
  // The local core starts again (new port): read server.json at every look.
  await windowWhere(app, (p) => onOrigin(localOrigin())(p));
  await quit(app);
});
