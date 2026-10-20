/*
 * First start of an INSTALLED Monsters, up to the registration (M3.5). Plain JavaScript with no
 * dependencies, so it runs anywhere the package is tried, with Node 22 or later (the clean Ubuntu
 * of test-deb.sh gets a copy of the CI's Node in /tmp: the app's own binary is never a Node, its
 * RunAsNode fuse is off).
 *
 *   node install-probe.mjs --home <MONSTERS_HOME> --cdp <port> --version <v> [--timeout <s>]
 *                          [--window required|optional|none] [--first-start ask|skip]
 *
 * The app must have been started with that MONSTERS_HOME and `--remote-debugging-port=<port>`
 * (a Chromium switch: the fuses turn off Node's --inspect, not this; the port listens on
 * 127.0.0.1 only). Checks, in order:
 *   0. first start (audit UX 1.2, `--first-start ask`, the default): the window asks "Dove
 *      lavorano i tuoi mostri?" with "Su questo computer" focused, and no core is running yet;
 *      Enter (a real key event) picks this computer. `skip`: the user data folder already has
 *      a connections.json (install-test.ts writes one only for `--window optional`, where no
 *      window may ever appear) and the core starts by itself;
 *   1. core: `server.json` in the home, `/api/health` ok with the expected version;
 *   2. first start: `/api/setup-status` says needsSetup, the one-time `setup-code` file exists;
 *   3. window: a page of the app shows the core's registration screen ("Crea account"), with the
 *      setup code handed over by the app (data-testid=setup-code-from-app, no code to type);
 *   4. registration: email and password typed into that window (DevTools protocol, real input
 *      events), "Crea account" clicked; then the core has an account and the window shows the
 *      onboarding.
 * Prints one line per check; exit 0 when all pass, 1 otherwise.
 *
 * `--window optional` (macOS over SSH, where the CI user may have no graphical session): when no
 * window shows up within WINDOW_WAIT_S, the account is created through the core's own API with
 * the setup code instead, the probe says so and exits 3 ("registered, window NOT verified").
 * `--window none` (macOS without a graphical session, where the app itself cannot get past
 * Electron's `ready` and install-test.ts starts the package's core with its own Node instead):
 * only checks 1 and 2, then the account through the API, exit 3; `--cdp` is ignored.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    home: { type: 'string' },
    cdp: { type: 'string' },
    version: { type: 'string' },
    timeout: { type: 'string', default: '120' },
    window: { type: 'string', default: 'required' },
    'first-start': { type: 'string', default: 'ask' },
  },
});
const WINDOW_WAIT_S = 45;
const windowMode = values.window;
const noWindow = windowMode === 'none';
const windowOptional = windowMode === 'optional';
const askFirst = values['first-start'] !== 'skip' && !noWindow;
const home = values.home;
const cdpPort = Number(values.cdp);
const expectedVersion = values.version;
if (
  !home ||
  (!cdpPort && !noWindow) ||
  !expectedVersion ||
  !['required', 'optional', 'none'].includes(windowMode)
) {
  console.error(
    'usage: install-probe.mjs --home <dir> --cdp <port> --version <v> [--timeout <s>] ' +
      '[--window required|optional|none] [--first-start ask|skip]',
  );
  process.exit(2);
}
const deadline = Date.now() + Number(values.timeout) * 1000;
const started = Date.now();
const EMAIL = 'ci@monsters.invalid';
const PASSWORD = 'ci-install-probe-password';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const elapsed = () => `${((Date.now() - started) / 1000).toFixed(1)}s`;
const say = (line) => process.stdout.write(`probe: ${line}\n`);

class Failure extends Error {}
const fail = (message) => {
  throw new Failure(message);
};

/** Polls `fn` until it returns something truthy; fails with `what` at the deadline. */
async function until(what, fn, every = 500) {
  let last;
  while (Date.now() < deadline) {
    try {
      const v = await fn();
      if (v) return v;
    } catch (err) {
      last = err;
    }
    await sleep(every);
  }
  fail(`${what} (timeout${last ? `, last error: ${last.message}` : ''})`);
}

async function getJson(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.json();
}

/** A minimal DevTools protocol client on one page target. */
async function devtools(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((ok, ko) => {
    ws.addEventListener('open', ok, { once: true });
    ws.addEventListener('error', () => ko(new Error(`cannot connect to ${wsUrl}`)), { once: true });
  });
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(String(ev.data));
    const p = msg.id !== undefined ? pending.get(msg.id) : undefined;
    if (!p) return;
    pending.delete(msg.id);
    if (msg.error) p.ko(new Error(msg.error.message));
    else p.ok(msg.result);
  });
  const send = (method, params = {}) =>
    new Promise((ok, ko) => {
      const n = ++id;
      pending.set(n, { ok, ko });
      ws.send(JSON.stringify({ id: n, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
    return r.result.value;
  };
  return { send, evaluate, close: () => ws.close() };
}

/** 0. The first-start page: nothing running yet, Enter on "Su questo computer". */
async function chooseThisComputer() {
  const serverJson = join(home, 'server.json');
  const target = await until(
    'the first-start page of the app ("Dove lavorano i tuoi mostri?")',
    async () => {
      const list = await getJson(`http://127.0.0.1:${cdpPort}/json/list`);
      return list.find((t) => t.type === 'page' && t.url.startsWith('data:text/html'));
    },
  );
  const page = await devtools(target.webSocketDebuggerUrl);
  try {
    await until('the choice of the first start, "Su questo computer" focused', () =>
      page.evaluate(`(() => {
        const main = document.querySelector('main[data-status="welcome"]');
        const local = main && main.querySelector('button[data-action="local"]');
        return !!local && document.activeElement === local
          && document.querySelector('h1').textContent.trim() === 'Dove lavorano i tuoi mostri?';
      })()`),
    );
    if (existsSync(serverJson)) fail('a core is running before the choice of the first start');
    say(`window asks where the monsters work, no core yet, after ${elapsed()}`);
    for (const type of ['keyDown', 'keyUp']) {
      await page.send('Input.dispatchKeyEvent', {
        type,
        key: 'Enter',
        code: 'Enter',
        windowsVirtualKeyCode: 13,
        nativeVirtualKeyCode: 13,
        ...(type === 'keyDown' ? { text: '\r' } : {}),
      });
    }
    say('Enter: "Su questo computer"');
  } finally {
    page.close();
  }
}

async function main() {
  if (askFirst) await chooseThisComputer();
  // 1. core
  const serverJson = join(home, 'server.json');
  const health = await until('core healthy (server.json + /api/health)', async () => {
    if (!existsSync(serverJson)) return null;
    const { url } = JSON.parse(readFileSync(serverJson, 'utf8'));
    const h = await getJson(`${url}/api/health`);
    return h.ok ? { url, version: h.version } : null;
  });
  const url = health.url;
  say(`core healthy at ${url} after ${elapsed()}, version ${health.version}`);
  if (health.version !== expectedVersion) {
    fail(`the core reports version ${health.version}, the package is ${expectedVersion}`);
  }

  // 2. first start
  const setup = await getJson(`${url}/api/setup-status`);
  if (setup.needsSetup !== true) fail(`not a first start: setup-status ${JSON.stringify(setup)}`);
  if (!existsSync(join(home, 'setup-code'))) fail('no setup-code file in the home');
  say('first start: no account yet, setup code written by the core');
  if (noWindow) return registerThroughApi(url, 'no app window in this run (--window none)');

  // 3. window
  const findWindow = async () => {
    const list = await getJson(`http://127.0.0.1:${cdpPort}/json/list`);
    return list.find((t) => t.type === 'page' && t.url.startsWith(`${url}/`));
  };
  let target;
  if (windowOptional) {
    const until45 = Date.now() + WINDOW_WAIT_S * 1000;
    while (!target && Date.now() < until45) {
      target = await findWindow().catch(() => undefined);
      if (!target) await sleep(500);
    }
    if (!target) {
      // A page that is not on the core (the status page, an error) means a window exists and is
      // broken: that is a failure, never "no graphical session".
      const pages = await getJson(`http://127.0.0.1:${cdpPort}/json/list`)
        .then((list) => list.filter((t) => t.type === 'page'))
        .catch(() => []);
      if (pages.length > 0) {
        fail(
          `the window does not show the core: ${pages.map((p) => p.url.slice(0, 80)).join(', ')}`,
        );
      }
      return registerThroughApi(
        url,
        `no window of the app after ${WINDOW_WAIT_S}s (no graphical session?)`,
      );
    }
  } else {
    target = await until('a window of the app on the core', findWindow);
  }
  const page = await devtools(target.webSocketDebuggerUrl);
  try {
    await until('the registration screen with the setup code from the app', () =>
      page.evaluate(`(() => {
        const button = [...document.querySelectorAll('button[type=submit]')]
          .find((b) => b.textContent.trim() === 'Crea account');
        return !!button && !!document.querySelector('[data-testid="setup-code-from-app"]')
          && !!document.querySelector('input[type=email]');
      })()`),
    );
    const title = await page.evaluate(`document.querySelector('h1')?.textContent ?? ''`);
    say(
      `window shows the registration: "${title.trim()}" (setup code from the app) after ${elapsed()}`,
    );

    // 4. registration through the window
    for (const [selector, text] of [
      ['input[type=email]', EMAIL],
      ['input[type=password]', PASSWORD],
    ]) {
      await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).focus()`);
      await page.send('Input.insertText', { text });
    }
    await page.evaluate(`[...document.querySelectorAll('button[type=submit]')]
      .find((b) => b.textContent.trim() === 'Crea account').click()`);
    await until('the account created by the window', async () => {
      const s = await getJson(`${url}/api/setup-status`);
      return s.needsSetup === false;
    });
    await until('the onboarding after the registration', () =>
      page.evaluate(`!!document.querySelector('[data-testid="onboarding"]')`),
    );
    say(`registration done from the window, onboarding shown, after ${elapsed()}`);
  } finally {
    page.close();
  }
  say('OK');
}

/**
 * `--window optional` without a window, or `--window none`: the account through the API, as the
 * UI would create it.
 */
async function registerThroughApi(url, why) {
  say(`${why}: the window is NOT verified`);
  const setupCode = readFileSync(join(home, 'setup-code'), 'utf8').trim();
  const res = await fetch(`${url}/api/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-monsters-request': '1' },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD, setupCode }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) fail(`POST /api/setup: HTTP ${res.status} ${await res.text()}`);
  const s = await getJson(`${url}/api/setup-status`);
  if (s.needsSetup !== false) fail('no account after POST /api/setup');
  say(`registration done through the core's API (setup code from the home) after ${elapsed()}`);
  say('OK, window NOT verified');
  return 'no-window';
}

main().then(
  (r) => process.exit(r === 'no-window' ? 3 : 0),
  (err) => {
    say(`FAILED: ${err instanceof Failure ? err.message : (err?.stack ?? String(err))}`);
    process.exit(1);
  },
);
